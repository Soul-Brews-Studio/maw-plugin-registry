import { stat } from "node:fs/promises";
import { type Config, UsageError } from "./types";
import { parseArgs, help } from "./config";
import { ghBase } from "./paths";
import { ghqRoot, ghqRemoteRoot, ghqResolveRepo, resolveFleetRepo, remoteHomedir } from "./ghq";
import { enumerateTargets } from "./targets";
import { type PlanRow, buildPlan, renderPlan } from "./plan";
import { runPreviews, renderPreviews } from "./preview";
import { collectDirtyReports, dirtyInspectionErrors, renderDirtyReports, summarizeDirty } from "./dirty";
import { confirmApply, runApply } from "./apply";
import { runMembrane } from "./membrane";

export async function execute(args: string[], options: { exitOnMissing?: boolean } = {}): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(help());
    return;
  }

  let cfg: Config;
  try {
    cfg = parseArgs(args);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`✖ ${e.message}`);
      console.error("");
      console.error(help());
      if (options.exitOnMissing) process.exitCode = 1;
      return;
    }
    throw e;
  }

  if (!cfg.repo) {
    console.error("✖ --repo required (could not derive from pwd)");
    console.error(help());
    if (options.exitOnMissing) process.exitCode = 1;
    return;
  }

  const localRoot = await ghqRoot();
  const ownerErr = await resolveRepository(cfg, args, localRoot);
  if (ownerErr) {
    console.error(`✖ ${ownerErr}`);
    if (options.exitOnMissing) process.exitCode = 1;
    return;
  }

  let remoteRoot = cfg.remoteUser ? `/opt/${cfg.remoteUser}/Code` : localRoot;
  if (!cfg.remoteUser) {
    try { remoteRoot = await ghqRemoteRoot(cfg.host); } catch { /* surfaced via targetState */ }
  }
  const remoteHome = await remoteHomedir(cfg.host);

  const { targets, warnings } = await enumerateTargets(cfg, localRoot, remoteRoot, remoteHome);
  if (targets.length === 0) {
    const msg = `no targets found for ${cfg.owner}/${cfg.repo}`;
    if (cfg.json) console.log(JSON.stringify({ ok: false, error: msg, warnings }));
    else {
      console.error(`✖ ${msg}`);
      for (const w of warnings) console.error(`   ${w}`);
    }
    if (options.exitOnMissing) process.exitCode = 1;
    return;
  }

  printHeader(cfg, warnings);

  const repos = targets.filter((t) => t.kind === "repo");
  const sessions = targets.filter((t) => t.kind === "session");
  if (!cfg.json) {
    console.log(`📋 plan — ${repos.length} repo${repos.length === 1 ? "" : "s"}, ${sessions.length} session dir${sessions.length === 1 ? "" : "s"}\n`);
  }

  const { plan, sshError } = await buildPlan(targets, cfg);
  if (sshError) {
    const msg = `ssh to ${cfg.host} failed: ${sshError}`;
    if (cfg.json) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(`✖ ${msg}`);
    if (options.exitOnMissing) process.exitCode = 4;
    return;
  }
  if (!cfg.json) renderPlan(plan, repos.length, sessions.length, cfg);

  let dirtyReports = [] as Awaited<ReturnType<typeof collectDirtyReports>>;
  if (!cfg.force) {
    dirtyReports = await collectDirtyReports(plan, cfg);
    if (!cfg.json) renderDirtyReports(dirtyReports, cfg.host, cfg.verbose);
    const dirtySummary = summarizeDirty(dirtyReports);
    const dirtyErrors = dirtyInspectionErrors(dirtyReports);
    if (cfg.diff) {
      if (cfg.json) console.log(JSON.stringify({ ok: true, mode: "diff", dirty: dirtySummary, reports: dirtyReports }, null, 2));
      return;
    }
    if (cfg.apply && dirtyErrors.length > 0) {
      const msg = `dirty check could not inspect both sides; re-run with --force to bypass: ${dirtyErrors.join("; ")}`;
      if (cfg.json) console.log(JSON.stringify({ ok: false, error: msg, dirty: dirtySummary }));
      else console.error(`✖ ${msg}`);
      if (options.exitOnMissing) process.exitCode = 2;
      return;
    }
    if (cfg.apply && dirtySummary.conflict > 0) {
      const msg = `dirty check found ${dirtySummary.conflict} conflict${dirtySummary.conflict === 1 ? "" : "s"}; resolve manually or re-run with --force`;
      if (cfg.json) console.log(JSON.stringify({ ok: false, error: msg, dirty: dirtySummary }));
      else console.error(`✖ ${msg}`);
      if (options.exitOnMissing) process.exitCode = 2;
      return;
    }
  }

  if (cfg.safe) {
    const aborted = await safeStep(plan, cfg, options);
    if (aborted) return;
  }

  const previews = await runPreviews(plan, cfg);
  if (!cfg.json) renderPreviews(previews, cfg);

  if (cfg.json) {
    console.log(JSON.stringify({
      ok: true,
      mode: cfg.apply ? "apply-pending" : "dry-run",
      direction: cfg.direction,
      host: cfg.host,
      owner: cfg.owner,
      repo: cfg.repo,
      targets: plan.map((p) => ({
        kind: p.kind, label: p.label, localPath: p.localPath, remotePath: p.remotePath,
        realLocal: p.realLocal, files: p.files, bytes: p.bytes,
        remoteState: typeof p.remoteState === "string" ? p.remoteState : "error",
      })),
      dirty: cfg.force ? undefined : summarizeDirty(dirtyReports),
      summary: {
        transfers: plan.length,
        files: plan.reduce((s, p) => s + p.files, 0),
        bytes: plan.reduce((s, p) => s + p.bytes, 0),
      },
    }, null, 2));
  }

  if (!cfg.apply) {
    if (!cfg.json) console.log("\n💡 dry-run done. Re-run with --apply to commit.");
    return;
  }

  const decision = await confirmApply(plan, previews, cfg);
  if (!decision.proceed) {
    if (!cfg.json) console[decision.reason === "aborted by user" ? "log" : "error"](`✖ ${decision.reason}`);
    if (options.exitOnMissing) process.exitCode = decision.reason === "aborted by user" ? 130 : 1;
    return;
  }
  await runApply(plan, cfg, options);
}

export type ResolveRepositoryDeps = {
  stat?: typeof stat;
  resolveFleetRepo?: typeof resolveFleetRepo;
  ghqResolveRepo?: typeof ghqResolveRepo;
};

export async function resolveRepository(
  cfg: Config,
  args: string[],
  localRoot: string,
  deps: ResolveRepositoryDeps = {},
): Promise<string | null> {
  if (args.includes("--owner")) return null;

  const resolveFromFleet = deps.resolveFleetRepo ?? resolveFleetRepo;
  const resolveFromGhq = deps.ghqResolveRepo ?? ghqResolveRepo;
  const statPath = deps.stat ?? stat;

  try {
    const fleet = await resolveFromFleet(cfg.repo);
    if (fleet && (fleet.owner !== cfg.owner || fleet.repo !== cfg.repo)) {
      cfg.owner = fleet.owner;
      cfg.repo = fleet.repo;
      cfg.derivedFrom = `${fleet.owner}/${fleet.repo} (via ${fleet.source})`;
      return null;
    }
  } catch (e) {
    if (e instanceof UsageError) return e.message;
    throw e;
  }

  const tryPath = `${ghBase(localRoot)}/${cfg.owner}/${cfg.repo}`;
  try { await statPath(tryPath); return null; } catch { /* not found locally */ }

  try {
    const resolved = await resolveFromGhq(cfg.repo);
    if (resolved && (resolved.owner !== cfg.owner || resolved.repo !== cfg.repo)) {
      cfg.owner = resolved.owner;
      cfg.repo = resolved.repo;
      cfg.derivedFrom = `${resolved.owner}/${resolved.repo} (via ghq)`;
    }
    return null;
  } catch (e) {
    if (e instanceof UsageError) return e.message;
    throw e;
  }
}

function printHeader(cfg: Config, warnings: string[]): void {
  if (cfg.json) return;
  const arrow = cfg.direction === "push" ? `m5 → ${cfg.host}` : `${cfg.host} → m5`;
  console.log(`🧬 ${cfg.owner}/${cfg.repo}  ${arrow}`);
  if (cfg.derivedFrom) console.log(`   ↪ derived: ${cfg.derivedFrom}`);
  console.log(`   mode: ${cfg.apply ? "🔴 APPLY" : "🟢 dry-run"}\n`);
  for (const w of warnings) console.log(`⚠ ${w}`);
}

async function safeStep(plan: PlanRow[], cfg: Config, options: { exitOnMissing?: boolean }): Promise<boolean> {
  if (cfg.direction === "pull") {
    if (!cfg.json) console.log("⚠ --safe with --pull is a no-op (audit would need ssh-side find)\n");
    return false;
  }
  const main = plan.find((p) => p.kind === "repo" && p.label === cfg.repo);
  if (!main) return false;
  if (!cfg.json) console.log(`🔬 membrane audit on ${main.label}…`);
  const report = await runMembrane(main.realLocal);
  const findings = report.caseCollisions.length + report.secrets.length;
  if (!cfg.json) {
    const renderList = (items: string[]) => {
      const max = cfg.verbose ? items.length : 5;
      return items.slice(0, max).map((p) => `      ${p}`).join("\n") +
        (items.length > max ? `\n      … and ${items.length - max} more (--verbose to see all)` : "");
    };
    console.log(`  ${report.caseCollisions.length === 0 ? "✓" : "✗"} case-collisions  ${report.caseCollisions.length}`);
    if (report.caseCollisions.length > 0) console.log(renderList(report.caseCollisions));
    console.log(`  ${report.secrets.length === 0 ? "✓" : "✗"} secrets          ${report.secrets.length}`);
    if (report.secrets.length > 0) console.log(renderList(report.secrets));
    console.log(`  ✓ apple-double    ${report.appleDouble}${report.appleDouble > 0 ? " (excluded via ._*)" : ""}\n`);
  }
  if (findings > 0 && !cfg.force) {
    if (!cfg.json) {
      console.error("✖ membrane found issues — review above, re-run with --force to override\n");
    } else {
      console.log(JSON.stringify({ ok: false, membrane: report }));
    }
    if (options.exitOnMissing) process.exitCode = 2;
    return true;
  }
  return false;
}
