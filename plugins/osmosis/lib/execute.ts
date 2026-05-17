import { stat } from "node:fs/promises";
import { type Config, type Target, type TargetState, UsageError } from "./types";
import { parseArgs, help } from "./config";
import { ghBase, countAndSize, fmtBytes } from "./paths";
import { ghqRoot, ghqRemoteRoot, ghqResolveOwner, remoteHomedir, targetState } from "./ghq";
import { buildRsyncArgs, runRsync, partitionRsyncOutput, renderPreview, promptYesNo } from "./rsync";
import { runMembrane } from "./membrane";
import { enumerateTargets } from "./targets";

type PlanRow = Target & { files: number; bytes: number; remoteState: TargetState; skip: boolean; skipReason?: string };
type PreviewResult = PlanRow & { previewFiles: string[]; previewStats: string[]; previewCode: number };

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

  // Owner resolution: explicit --owner wins; otherwise check pwd-derived path,
  // fall back to ghq disambiguation if not found locally.
  const ownerExplicit = args.includes("--owner");
  if (!ownerExplicit) {
    const tryPath = `${ghBase(localRoot)}/${cfg.owner}/${cfg.repo}`;
    let exists = false;
    try { await stat(tryPath); exists = true; } catch { /* nope */ }
    if (!exists) {
      try {
        const resolved = await ghqResolveOwner(cfg.repo);
        if (resolved && resolved !== cfg.owner) {
          cfg.owner = resolved;
          cfg.derivedFrom = `${resolved}/${cfg.repo} (via ghq)`;
        }
      } catch (e) {
        if (e instanceof UsageError) {
          console.error(`✖ ${e.message}`);
          if (options.exitOnMissing) process.exitCode = 1;
          return;
        }
        throw e;
      }
    }
  }

  let remoteRoot = localRoot;
  try {
    remoteRoot = await ghqRemoteRoot(cfg.host);
  } catch {
    // assume same as local if ssh fails — surface via targetState
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

  // Header
  if (!cfg.json) {
    const arrow = cfg.direction === "push" ? `m5 → ${cfg.host}` : `${cfg.host} → m5`;
    console.log(`🧬 ${cfg.owner}/${cfg.repo}  ${arrow}`);
    if (cfg.derivedFrom) console.log(`   ↪ derived: ${cfg.derivedFrom}`);
    console.log(`   mode: ${cfg.apply ? "🔴 APPLY" : "🟢 dry-run"}\n`);
    for (const w of warnings) console.log(`⚠ ${w}`);
  }

  // Plan: enumerate and size each target
  const repos = targets.filter((t) => t.kind === "repo");
  const sessions = targets.filter((t) => t.kind === "session");
  const plan: PlanRow[] = [];

  if (!cfg.json) {
    console.log(`📋 plan — ${repos.length} repo${repos.length === 1 ? "" : "s"}, ${sessions.length} session dir${sessions.length === 1 ? "" : "s"}\n`);
  }

  for (const t of targets) {
    const { files, bytes } = cfg.direction === "push" ? await countAndSize(t.realLocal) : { files: 0, bytes: 0 };
    const state = await targetState(cfg.host, t.remotePath);
    if (typeof state === "object" && "error" in state) {
      const msg = `ssh to ${cfg.host} failed: ${state.error}`;
      if (cfg.json) console.log(JSON.stringify({ ok: false, error: msg }));
      else console.error(`✖ ${msg}`);
      if (options.exitOnMissing) process.exitCode = 4;
      return;
    }
    const skip = cfg.direction === "pull" && state === "absent";
    plan.push({ ...t, files, bytes, remoteState: state, skip, skipReason: skip ? "absent on remote" : undefined });
  }

  if (!cfg.json) renderPlan(plan, repos.length, sessions.length, cfg);

  // --safe membrane audit on main repo (push only)
  if (cfg.safe && cfg.direction === "push") {
    const aborted = await runMembraneStep(plan, cfg, options);
    if (aborted) return;
  } else if (cfg.safe && cfg.direction === "pull") {
    if (!cfg.json) console.log("⚠ --safe with --pull is a no-op (audit would need ssh-side find)\n");
  }

  // Phase 1: run all dry-run previews (collect, no render yet)
  const previews: PreviewResult[] = [];
  for (const p of plan) {
    if (p.skip) {
      previews.push({ ...p, previewFiles: [], previewStats: [], previewCode: 0 });
      continue;
    }
    const src = cfg.direction === "push" ? p.realLocal : `${cfg.host}:${p.remotePath}`;
    const dst = cfg.direction === "push" ? `${cfg.host}:${p.remotePath}` : p.localPath;
    const { code, lines } = await runRsync(buildRsyncArgs(src, dst, false));
    const { files, stats } = partitionRsyncOutput(lines);
    previews.push({ ...p, previewFiles: files, previewStats: stats, previewCode: code });
  }

  // Phase 2: render
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
        kind: p.kind,
        label: p.label,
        localPath: p.localPath,
        remotePath: p.remotePath,
        realLocal: p.realLocal,
        files: p.files,
        bytes: p.bytes,
        remoteState: typeof p.remoteState === "string" ? p.remoteState : "error",
      })),
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

  // --apply: confirm + sequential real rsync
  const interactive = process.stdin.isTTY === true && !cfg.json;
  if (interactive && !cfg.yes) {
    const totalFiles = previews.reduce((s, p) => s + p.previewFiles.length, 0);
    const totalBytes = plan.reduce((s, p) => s + p.bytes, 0);
    const proceed = await promptYesNo(
      `\n❓ proceed with ${plan.length} transfer${plan.length === 1 ? "" : "s"} (${totalFiles} files, ${fmtBytes(totalBytes)}) → ${cfg.host}? [y/N]: `,
    );
    if (!proceed) {
      console.log("✖ aborted by user");
      if (options.exitOnMissing) process.exitCode = 130;
      return;
    }
  } else if (!cfg.yes && !cfg.json) {
    console.error("\n✖ refusing to --apply non-interactively without --yes (no TTY for prompt)");
    if (options.exitOnMissing) process.exitCode = 1;
    return;
  }

  await runApply(plan, cfg, options);
}

function renderPlan(plan: PlanRow[], nRepos: number, nSessions: number, cfg: Config): void {
  const groupHeader = (items: PlanRow[]): string => {
    if (items.length === 0) return "";
    const localParents = new Set(items.map((p) => p.localPath.split("/").slice(0, -1).join("/")));
    const remoteParents = new Set(items.map((p) => p.remotePath.split("/").slice(0, -1).join("/")));
    const localPrefix = localParents.size === 1 ? Array.from(localParents)[0] : "(mixed)";
    const remotePrefix = remoteParents.size === 1 ? Array.from(remoteParents)[0] : "(mixed)";
    if (localPrefix === remotePrefix) return localPrefix;
    const arrow = cfg.direction === "push" ? "→" : "←";
    return `${localPrefix} ${arrow} ${cfg.host}:${remotePrefix}`;
  };

  const renderGroup = (label: string, items: PlanRow[]) => {
    if (items.length === 0) return;
    console.log(`   ${label}   ${groupHeader(items)}`);
    for (const p of items) {
      const glyph = p.skip ? "⊘" : p.remoteState === "present" ? "↻" : "✦";
      const basename = p.localPath.split("/").pop() || p.label;
      const symlink = p.realLocal !== p.localPath ? ` (→ ${p.realLocal.split("/").pop()})` : "";
      const size = p.skip
        ? `SKIP — ${p.skipReason}`
        : cfg.direction === "push"
          ? `${p.files} files, ${fmtBytes(p.bytes)}`
          : "(pull)";
      console.log(`     ${glyph} ${(basename + symlink).padEnd(58)} ${size}`);
    }
    console.log("");
  };

  renderGroup(`REPOS (${nRepos})`, plan.filter((p) => p.kind === "repo"));
  if (nSessions > 0) {
    renderGroup(`SESSIONS (${nSessions})`, plan.filter((p) => p.kind === "session"));
  } else if (!cfg.sessions) {
    console.log(`   SESSIONS: skipped (use --sessions or --all to include)\n`);
  }
  const totalFiles = plan.reduce((s, p) => s + p.files, 0);
  const totalBytes = plan.reduce((s, p) => s + p.bytes, 0);
  console.log(`   ─────────────────────────────────`);
  console.log(`   TOTAL: ${plan.length} transfer${plan.length === 1 ? "" : "s"}, ${totalFiles} files, ${fmtBytes(totalBytes)}\n`);
}

async function runMembraneStep(plan: PlanRow[], cfg: Config, options: { exitOnMissing?: boolean }): Promise<boolean> {
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

function renderPreviews(previews: PreviewResult[], cfg: Config): void {
  const baseline = cfg.diff ? previews.find((p) => p.kind === "repo" && p.label === cfg.repo) : undefined;
  const baselineSet = baseline ? new Set(baseline.previewFiles) : null;

  for (const pv of previews) {
    if (pv.skip) continue;
    console.log(`🔍 preview · ${pv.label}`);
    if (pv.previewCode !== 0) {
      console.error(`   ✖ preview exit ${pv.previewCode}\n`);
      continue;
    }
    const useDiff = cfg.diff && baselineSet && pv !== baseline && pv.kind === "repo";
    if (useDiff) {
      const unique = pv.previewFiles.filter((f) => !baselineSet!.has(f));
      const common = pv.previewFiles.length - unique.length;
      console.log(`   diff vs ${baseline!.label}:`);
      if (unique.length === 0) {
        console.log(`     (no unique files — fully shared with ${baseline!.label})`);
      } else {
        const max = cfg.verbose ? unique.length : 15;
        for (const f of unique.slice(0, max)) console.log(`     + ${f}`);
        if (unique.length > max) console.log(`     … and ${unique.length - max} more unique (--verbose to see all)`);
      }
      console.log(`     ─ ${common} files shared with ${baseline!.label}\n`);
      for (const s of pv.previewStats.slice(0, 6)) console.log(`   ${s}`);
      console.log("");
    } else {
      renderPreview(pv.previewFiles, pv.previewStats, cfg.verbose);
      console.log("");
    }
  }
}

async function runApply(plan: PlanRow[], cfg: Config, options: { exitOnMissing?: boolean }): Promise<void> {
  if (!cfg.json) console.log("\n💧 transferring…\n");
  const failures: string[] = [];
  let skipped = 0;
  for (const p of plan) {
    if (p.skip) {
      if (!cfg.json) console.log(`   ${p.label} … ⊘ skipped (${p.skipReason})`);
      skipped++;
      continue;
    }
    const src = cfg.direction === "push" ? p.realLocal : `${cfg.host}:${p.remotePath}`;
    const dst = cfg.direction === "push" ? `${cfg.host}:${p.remotePath}` : p.localPath;
    if (!cfg.json) process.stdout.write(`   ${p.label} …`);
    const { code, lines } = await runRsync(buildRsyncArgs(src, dst, true));
    if (code !== 0) {
      failures.push(`${p.label} (exit ${code})`);
      if (!cfg.json) console.log(` ✖ exit ${code}`);
    } else {
      const { stats } = partitionRsyncOutput(lines);
      const transferred = stats.find((s) => /Number of files transferred/.test(s));
      if (!cfg.json) console.log(` ✓ ${transferred ? transferred.trim() : "done"}`);
    }
  }

  if (!cfg.json) {
    console.log("");
    const ran = plan.length - skipped;
    const ok = ran - failures.length;
    const skipNote = skipped > 0 ? `, ${skipped} skipped` : "";
    if (failures.length === 0) {
      console.log(`✨ ${ok}/${ran} done${skipNote}.`);
    } else {
      console.log(`⚠ ${ok}/${ran} succeeded, ${failures.length} failed${skipNote}:`);
      for (const f of failures) console.log(`   ✖ ${f}`);
      if (options.exitOnMissing) process.exitCode = failures.length;
    }
  } else {
    console.log(JSON.stringify({ ok: failures.length === 0, applied: true, succeeded: plan.length - skipped - failures.length, skipped, failed: failures.length, failures }));
  }
}
