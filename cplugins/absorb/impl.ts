/**
 * maw absorb — consented retirement + knowledge donation.
 *
 * Absorb is intentionally not fuse: no new oracle is born. The donor retires
 * gracefully and the receiver keeps its identity while carrying the donor vault
 * under ψ/from-<donor>/ with explicit provenance.
 */

import { createHash } from "crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  readFileSync,
  symlinkSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from "fs";
import { dirname, basename, join, relative, resolve } from "path";
import { homedir } from "os";

export interface OracleRef {
  input: string;
  name: string;
  stem: string;
  repoName: string;
  path: string;
  psiPath: string;
  repoSlug: string | null;
}

export interface AbsorbOptions {
  donor: string;
  receiver: string;
  dryRun?: boolean;
  yes?: boolean;
  reason?: string;
  fleetDir?: string;
  skipFleet?: boolean;
  skipArchive?: boolean;
  skipBroadcast?: boolean;
}

export interface AbsorbDeps {
  cwd?: string;
  now?: () => Date;
  ghqList?: () => string[];
  spawnSync?: typeof Bun.spawnSync;
  log?: (...args: unknown[]) => void;
}

export interface CopyResult {
  relativePath: string;
  targetPath: string;
  action: "copy" | "skip" | "conflict";
  reason?: string;
}

export interface AbsorbReport {
  donor: OracleRef;
  receiver: OracleRef;
  namespace: string;
  namespacePath: string;
  dryRun: boolean;
  copied: number;
  skipped: number;
  conflicted: number;
  files: CopyResult[];
  absorbMdPath: string;
  fleet: { status: "updated" | "skipped" | "not-found" | "dry-run"; file?: string };
  archive: { status: "archived" | "skipped" | "dry-run" | "failed"; repo?: string; error?: string };
  broadcast: { status: "sent" | "skipped" | "dry-run" | "failed"; error?: string };
}

const FRONTMATTER = /^---\n[\s\S]*?\n---\n?/;
const ZERO_WIDTH = /[\u200B\u200C\u200D\uFEFF]/g;
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist"]);

export function normalizeOracleStem(input: string): string {
  const base = basename(input.trim().replace(/\/+$/, ""));
  return base.replace(/^\d+-/, "").replace(/-oracle$/, "");
}

export function namespaceForDonor(donorStem: string): string {
  return `from-${donorStem}`;
}

export function normalizeContent(content: string): string {
  return content
    .replace(/^\uFEFF/, "")
    .replace(FRONTMATTER, "")
    .replace(/\r\n/g, "\n")
    .replace(ZERO_WIDTH, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .normalize("NFC")
    .trim();
}

export function hashContent(content: string): string {
  return createHash("sha256").update(normalizeContent(content), "utf8").digest("hex");
}

function isExplicitPath(input: string): boolean {
  return input.startsWith("/") || input.startsWith("./") || input.startsWith("../") || input.startsWith("~/");
}

function defaultGhqList(): string[] {
  const result = Bun.spawnSync(["ghq", "list", "--full-path"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) return [];
  return new TextDecoder().decode(result.stdout).split("\n").map((s) => s.trim()).filter(Boolean);
}

function candidateRoots(cwd: string): string[] {
  return [
    cwd,
    dirname(cwd),
    "/opt/Code/github.com/Soul-Brews-Studio",
    "/opt/Code/github.com/laris-co",
    "/opt/Code/github.com/ARRA-01",
    join(homedir(), "Code", "github.com", "Soul-Brews-Studio"),
  ];
}

function uniqueExistingDirs(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const abs = resolve(p);
    if (seen.has(abs)) continue;
    seen.add(abs);
    try {
      if (existsSync(abs) && statSync(abs).isDirectory()) out.push(abs);
    } catch { /* ignore inaccessible candidates */ }
  }
  return out;
}

export function gitRepoSlug(repoPath: string, deps: AbsorbDeps = {}): string | null {
  const spawnSync = deps.spawnSync ?? Bun.spawnSync;
  const result = spawnSync(["git", "-C", repoPath, "remote", "get-url", "origin"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) return null;
  const raw = new TextDecoder().decode(result.stdout).trim();
  const match = raw.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/i);
  return match ? match[1] : null;
}

export function resolveOracle(input: string, deps: AbsorbDeps = {}): OracleRef {
  const cwd = deps.cwd ?? process.cwd();
  const stem = normalizeOracleStem(input);
  const repoName = `${stem}-oracle`;

  const chooseFromTier = (label: string, candidates: string[]): string | null => {
    const existing = uniqueExistingDirs(candidates);
    const withVault = existing.filter((p) => existsSync(join(p, "ψ")) && statSync(join(p, "ψ")).isDirectory());
    if (withVault.length === 0) return null;
    const exact = withVault.filter((p) => basename(p) === repoName || basename(p) === input);
    if (exact.length === 1) return exact[0];
    if (withVault.length === 1) return withVault[0];
    throw new Error(`ambiguous oracle '${input}' in ${label}:\n${withVault.map((p) => `  - ${p}`).join("\n")}`);
  };

  const tiers: Array<[string, string[]]> = [];
  if (isExplicitPath(input)) {
    const expanded = input.startsWith("~/") ? join(homedir(), input.slice(2)) : input;
    tiers.push(["explicit path", [expanded]]);
  } else {
    const ghqCandidates: string[] = [];
    for (const p of deps.ghqList ? deps.ghqList() : defaultGhqList()) {
      const b = basename(p);
      const ownerRepoSuffix = p.replace(/\\/g, "/").endsWith(`/${input}`);
      if (b === repoName || b === stem || b === input || ownerRepoSuffix) ghqCandidates.push(p);
    }
    tiers.push(["ghq", ghqCandidates]);
    const rootCandidates: string[] = [];
    for (const root of candidateRoots(cwd)) {
      rootCandidates.push(join(root, repoName), join(root, stem), join(root, input));
    }
    tiers.push(["known roots", rootCandidates]);
  }

  let chosen: string | null = null;
  for (const [label, candidates] of tiers) {
    chosen = chooseFromTier(label, candidates);
    if (chosen) break;
  }

  if (!chosen) {
    throw new Error(`oracle not found or missing ψ vault: ${input}`);
  }

  return {
    input,
    name: basename(chosen),
    stem,
    repoName,
    path: chosen,
    psiPath: join(chosen, "ψ"),
    repoSlug: gitRepoSlug(chosen, deps),
  };
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) out.push(full);
      if (st.isDirectory()) stack.push(full);
      else if (st.isFile()) out.push(full);
    }
  }
  return out.sort();
}

function provenanceHeader(opts: {
  donor: OracleRef;
  receiver: OracleRef;
  absorbedAt: string;
  originalPath: string;
  hash: string;
  reason?: string;
}): string {
  const lines = [
    "---",
    "absorb:",
    `  donor: ${opts.donor.name}`,
    `  receiver: ${opts.receiver.name}`,
    `  absorbedAt: ${opts.absorbedAt}`,
    `  originalPath: ${opts.originalPath}`,
    `  contentHash: sha256:${opts.hash}`,
  ];
  if (opts.reason) lines.push(`  reason: ${JSON.stringify(opts.reason)}`);
  lines.push("---", "");
  return lines.join("\n");
}

export function copyVaultIntoNamespace(
  donor: OracleRef,
  receiver: OracleRef,
  opts: { dryRun?: boolean; reason?: string; now?: Date } = {},
): { namespace: string; namespacePath: string; files: CopyResult[] } {
  const namespace = namespaceForDonor(donor.stem);
  const namespacePath = join(receiver.psiPath, namespace);
  const absorbedAt = (opts.now ?? new Date()).toISOString();
  const files: CopyResult[] = [];

  for (const src of walkFiles(donor.psiPath)) {
    const rel = relative(donor.psiPath, src);
    const target = join(namespacePath, rel);
    const srcStat = lstatSync(src);
    const isSymlink = srcStat.isSymbolicLink();
    const linkTarget = isSymlink ? readlinkSync(src) : null;
    const symlinkHash = isSymlink ? createHash("sha256").update(`symlink:${linkTarget}`, "utf8").digest("hex") : null;

    if (isSymlink) {
      if (existsSync(target)) {
        const same = lstatSync(target).isSymbolicLink() && readlinkSync(target) === linkTarget;
        if (same) {
          files.push({ relativePath: rel, targetPath: target, action: "skip", reason: "identical symlink" });
          continue;
        }
        const conflictTarget = `${target}.conflict-${absorbedAt.replace(/[:.]/g, "-")}`;
        files.push({ relativePath: rel, targetPath: conflictTarget, action: "conflict", reason: `existing path differs at ${target}` });
        if (!opts.dryRun) {
          mkdirSync(dirname(conflictTarget), { recursive: true });
          symlinkSync(linkTarget!, conflictTarget);
        }
        continue;
      }
      files.push({ relativePath: rel, targetPath: target, action: "copy", reason: `symlink sha256:${symlinkHash}` });
      if (!opts.dryRun) {
        mkdirSync(dirname(target), { recursive: true });
        symlinkSync(linkTarget!, target);
      }
      continue;
    }

    const raw = readFileSync(src);
    const text = raw.toString("utf8");
    const isMarkdown = rel.endsWith(".md");
    const hash = isMarkdown ? hashContent(text) : createHash("sha256").update(raw).digest("hex");

    if (existsSync(target)) {
      const existing = readFileSync(target);
      const same = isMarkdown
        ? hashContent(existing.toString("utf8")) === hash
        : createHash("sha256").update(existing).digest("hex") === hash;
      if (same) {
        files.push({ relativePath: rel, targetPath: target, action: "skip", reason: "identical" });
        continue;
      }
      const conflictTarget = `${target}.conflict-${absorbedAt.replace(/[:.]/g, "-")}`;
      files.push({ relativePath: rel, targetPath: conflictTarget, action: "conflict", reason: `existing file differs at ${target}` });
      if (!opts.dryRun) {
        mkdirSync(dirname(conflictTarget), { recursive: true });
        if (isMarkdown) {
          writeFileSync(conflictTarget, provenanceHeader({ donor, receiver, absorbedAt, originalPath: rel, hash, reason: opts.reason }) + text, "utf8");
        } else {
          copyFileSync(src, conflictTarget);
        }
      }
      continue;
    }

    files.push({ relativePath: rel, targetPath: target, action: "copy" });
    if (!opts.dryRun) {
      mkdirSync(dirname(target), { recursive: true });
      if (isMarkdown) {
        writeFileSync(target, provenanceHeader({ donor, receiver, absorbedAt, originalPath: rel, hash, reason: opts.reason }) + text, "utf8");
      } else {
        copyFileSync(src, target);
      }
    }
  }

  return { namespace, namespacePath, files };
}

function absorbMarkdown(report: Pick<AbsorbReport, "donor" | "receiver" | "namespace" | "copied" | "skipped" | "conflicted">, absorbedAt: string, reason?: string): string {
  return [
    "---",
    "absorb:",
    `  donor: ${report.donor.name}`,
    `  receiver: ${report.receiver.name}`,
    `  absorbedAt: ${absorbedAt}`,
    `  namespace: ${report.namespace}`,
    `  donorRepo: ${report.donor.repoSlug ?? "unknown"}`,
    `  receiverRepo: ${report.receiver.repoSlug ?? "unknown"}`,
    `  copied: ${report.copied}`,
    `  skipped: ${report.skipped}`,
    `  conflicted: ${report.conflicted}`,
    "---",
    "",
    `# Absorbed ${report.donor.name} into ${report.receiver.name}`,
    "",
    "Absorb is retirement plus knowledge donation, not fusion. No new oracle was born.",
    "The receiver keeps its identity and carries donor vault files under this namespace.",
    "",
    `- Donor path: ${report.donor.path}`,
    `- Receiver path: ${report.receiver.path}`,
    `- Namespace: ψ/${report.namespace}/`,
    `- Reason: ${reason || "not recorded"}`,
    "",
  ].join("\n");
}

export function markFleetAbsorbed(donor: OracleRef, receiver: OracleRef, opts: { dryRun?: boolean; fleetDir?: string; now?: Date } = {}): AbsorbReport["fleet"] {
  const fleetDir = opts.fleetDir ?? process.env.MAW_FLEET_DIR ?? join(homedir(), ".config", "maw", "fleet");
  if (!existsSync(fleetDir)) return { status: "not-found" };
  const files = readdirSync(fleetDir).filter((f) => f.endsWith(".json"));
  const match = files.find((file) => {
    try {
      const cfg = JSON.parse(readFileSync(join(fleetDir, file), "utf8"));
      const names = [cfg.name, file.replace(/\.json$/, ""), ...(cfg.windows ?? []).map((w: any) => w?.name)].filter(Boolean).map(String);
      return names.some((name) => normalizeOracleStem(name) === donor.stem || name === donor.name || name === donor.repoName);
    } catch { return false; }
  });
  if (!match) return { status: "not-found" };
  const file = join(fleetDir, match);
  if (opts.dryRun) return { status: "dry-run", file };
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  cfg.status = "absorbed";
  cfg.absorbed_into = receiver.name;
  cfg.absorbed_at = (opts.now ?? new Date()).toISOString();
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  return { status: "updated", file };
}

export function archiveDonorRepo(donor: OracleRef, opts: { dryRun?: boolean; skipArchive?: boolean; deps?: AbsorbDeps } = {}): AbsorbReport["archive"] {
  if (opts.skipArchive) return { status: "skipped", repo: donor.repoSlug ?? undefined };
  if (!donor.repoSlug) return { status: "skipped", error: "donor has no GitHub origin" };
  const originRepoName = donor.repoSlug.split("/").pop();
  if (originRepoName !== donor.name && originRepoName !== donor.repoName) {
    return {
      status: "skipped",
      repo: donor.repoSlug,
      error: `donor origin repo '${originRepoName}' does not match oracle '${donor.name}'`,
    };
  }
  if (opts.dryRun) return { status: "dry-run", repo: donor.repoSlug };
  const spawnSync = opts.deps?.spawnSync ?? Bun.spawnSync;
  const result = spawnSync(["gh", "repo", "archive", donor.repoSlug, "--yes"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const output = `${new TextDecoder().decode(result.stderr)}${new TextDecoder().decode(result.stdout)}`.trim();
    return { status: "failed", repo: donor.repoSlug, error: output || `gh exited ${result.exitCode}` };
  }
  return { status: "archived", repo: donor.repoSlug };
}

export function broadcastAbsorb(report: Pick<AbsorbReport, "donor" | "receiver" | "namespace">, opts: { dryRun?: boolean; skipBroadcast?: boolean; deps?: AbsorbDeps } = {}): AbsorbReport["broadcast"] {
  if (opts.skipBroadcast) return { status: "skipped" };
  const message = `[maw absorb] ${report.donor.name} retired into ${report.receiver.name}; vault namespace ψ/${report.namespace}/`;
  if (opts.dryRun) return { status: "dry-run" };
  const spawnSync = opts.deps?.spawnSync ?? Bun.spawnSync;
  const result = spawnSync(["maw", "hey", "federation", message], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    const output = `${new TextDecoder().decode(result.stderr)}${new TextDecoder().decode(result.stdout)}`.trim();
    return { status: "failed", error: output || `maw hey exited ${result.exitCode}` };
  }
  return { status: "sent" };
}

export async function cmdAbsorb(options: AbsorbOptions, deps: AbsorbDeps = {}): Promise<AbsorbReport> {
  if (!options.donor) throw new Error("usage: maw absorb <donor> --into <receiver> [--dry-run] [--yes --reason <why>]");
  if (!options.receiver) throw new Error("--into <receiver> required");
  if (normalizeOracleStem(options.donor) === normalizeOracleStem(options.receiver)) {
    throw new Error("donor and receiver must be different oracles");
  }
  if (!options.dryRun && !options.yes) {
    throw new Error("consent required: rerun with --yes --reason <why> after Nat/human approval");
  }

  const now = deps.now?.() ?? new Date();
  const donor = resolveOracle(options.donor, deps);
  const receiver = resolveOracle(options.receiver, deps);
  if (donor.path === receiver.path) throw new Error("donor and receiver resolved to the same path");

  const copy = copyVaultIntoNamespace(donor, receiver, { dryRun: options.dryRun, reason: options.reason, now });
  const copied = copy.files.filter((f) => f.action === "copy").length;
  const skipped = copy.files.filter((f) => f.action === "skip").length;
  const conflicted = copy.files.filter((f) => f.action === "conflict").length;
  const absorbMdPath = join(copy.namespacePath, "ABSORB.md");

  const partial = { donor, receiver, namespace: copy.namespace, copied, skipped, conflicted };
  if (!options.dryRun) {
    mkdirSync(copy.namespacePath, { recursive: true });
    writeFileSync(absorbMdPath, absorbMarkdown(partial, now.toISOString(), options.reason), "utf8");
  }

  const report: AbsorbReport = {
    donor,
    receiver,
    namespace: copy.namespace,
    namespacePath: copy.namespacePath,
    dryRun: !!options.dryRun,
    copied,
    skipped,
    conflicted,
    files: copy.files,
    absorbMdPath,
    fleet: options.skipFleet ? { status: "skipped" } : markFleetAbsorbed(donor, receiver, { dryRun: options.dryRun, fleetDir: options.fleetDir, now }),
    archive: archiveDonorRepo(donor, { dryRun: options.dryRun, skipArchive: options.skipArchive, deps }),
    broadcast: { status: "skipped" },
  };
  report.broadcast = broadcastAbsorb(report, { dryRun: options.dryRun, skipBroadcast: options.skipBroadcast, deps });

  deps.log?.(formatAbsorbReport(report));
  return report;
}

export function formatAbsorbReport(report: AbsorbReport): string {
  return [
    `${report.dryRun ? "[dry-run] " : ""}absorbed ${report.donor.name} → ${report.receiver.name}`,
    `namespace: ${report.namespacePath}`,
    `files: ${report.copied} copied, ${report.skipped} skipped, ${report.conflicted} conflicted`,
    `ABSORB.md: ${report.dryRun ? "would write " : "wrote "}${report.absorbMdPath}`,
    `fleet: ${report.fleet.status}${report.fleet.file ? ` (${report.fleet.file})` : ""}`,
    `archive: ${report.archive.status}${report.archive.repo ? ` (${report.archive.repo})` : ""}${report.archive.error ? ` — ${report.archive.error}` : ""}`,
    `broadcast: ${report.broadcast.status}${report.broadcast.error ? ` — ${report.broadcast.error}` : ""}`,
  ].join("\n");
}
