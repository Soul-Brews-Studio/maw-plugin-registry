import { stat, realpath, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";

export const command = {
  name: "osmosis",
  description:
    "Bidirectional rsync between trusted fleet hosts (m5 ↔ remote). Dry-run by default; --apply to commit.",
};

type Direction = "push" | "pull";

type Config = {
  host: string;
  direction: Direction;
  repo: string;
  owner: string;
  apply: boolean;
  json: boolean;
  verbose: boolean;
  safe: boolean;
  force: boolean;
  yes: boolean;
  noWorktrees: boolean;
  sessions: boolean;
  derivedFrom?: string;
};

const SAFE_EXCLUDES = [".git/", "node_modules/", ".DS_Store", "._*", ".tmp/"];
const M5_ROOT_FALLBACK = "/opt/Code";

function ghBase(root: string): string {
  return `${root}/github.com`;
}

let _ghqRootCache: string | null = null;
async function ghqRoot(): Promise<string> {
  if (_ghqRootCache) return _ghqRootCache;
  const { code, stdout } = await exec("ghq", ["root"]);
  if (code !== 0) return (_ghqRootCache = M5_ROOT_FALLBACK);
  return (_ghqRootCache = stdout.trim() || M5_ROOT_FALLBACK);
}

async function ghqRemoteRoot(host: string): Promise<string> {
  const { code, stdout } = await exec("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "--", host, "ghq root"]);
  if (code !== 0) throw new UsageError(`ghq root on ${host} failed`);
  return stdout.trim();
}

async function ghqResolveOwner(repo: string): Promise<string | null> {
  const { code, stdout } = await exec("ghq", ["list", "-p", repo]);
  if (code !== 0) return null;
  const matches = stdout.trim().split("\n").filter(Boolean);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new UsageError(`ambiguous repo "${repo}" — ghq found ${matches.length} matches:\n  ${matches.join("\n  ")}\nspecify --owner`);
  }
  // /opt/Code/github.com/<owner>/<repo>
  const m = matches[0].match(/\/github\.com\/([^/]+)\/[^/]+$/);
  return m ? m[1] : null;
}

const SECRET_FIND_EXPR = [
  "(",
  "-name", ".env",
  "-o", "-name", ".env.*",
  "-o", "-name", ".envrc",
  "-o", "-name", "*.key",
  "-o", "-name", "*.pem",
  "-o", "-name", "*.pfx",
  "-o", "-name", "*.p12",
  "-o", "-name", "*.kdbx",
  "-o", "-name", ".netrc",
  "-o", "-name", ".npmrc",
  "-o", "-name", ".git-credentials",
  "-o", "-name", "id_rsa",
  "-o", "-name", "id_ed25519",
  "-o", "-name", "id_ecdsa",
  "-o", "-name", "id_dsa",
  "-o", "-name", "terraform.tfstate",
  "-o", "-name", "terraform.tfstate.backup",
  "-o", "-name", "secrets.yaml",
  "-o", "-name", "secrets.yml",
  "-o", "-path", "*/wireguard/*",
  "-o", "-path", "*/.ssh/*",
  "-o", "-path", "*/.aws/*",
  "-o", "-path", "*/.kube/*",
  ")",
];
const VALID_NAME = /^[A-Za-z0-9._-]+$/;

class UsageError extends Error {}

export function deriveFromPwd(cwd: string): { owner?: string; repo?: string; worktreeSuffix?: string } {
  const m = cwd.match(/\/opt\/Code\/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) return {};
  const owner = m[1];
  const full = m[2];
  const wt = full.match(/^(.+?)\.wt-(.+)$/);
  if (wt) return { owner, repo: wt[1], worktreeSuffix: wt[2] };
  return { owner, repo: full };
}

function validate(name: string, value: string): void {
  if (!VALID_NAME.test(value)) {
    throw new UsageError(`invalid ${name}: ${JSON.stringify(value)} — must match ${VALID_NAME}`);
  }
  if (value.startsWith("-")) {
    throw new UsageError(`invalid ${name}: cannot start with '-'`);
  }
  if (value.includes("..")) {
    throw new UsageError(`invalid ${name}: cannot contain '..'`);
  }
}

export function parseArgs(argv: string[], cwd: string = process.cwd()): Config {
  const get = (name: string, fallback: string) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
  };

  const derived = deriveFromPwd(cwd);
  const derivedFrom = derived.repo
    ? `${derived.owner}/${derived.repo}${derived.worktreeSuffix ? ".wt-" + derived.worktreeSuffix : ""}`
    : undefined;

  const pushHost = get("--push", "");
  const pullHost = get("--pull", "");
  if (pushHost && pullHost) {
    throw new UsageError("--push and --pull are mutually exclusive");
  }
  const direction: Direction = pullHost ? "pull" : "push";
  const host = pushHost || pullHost;
  if (!host) {
    throw new UsageError("must specify --push <host> or --pull <host>");
  }

  const cfg: Config = {
    host,
    direction,
    repo: get("--repo", derived.repo ?? ""),
    owner: get("--owner", derived.owner ?? "laris-co"),
    apply: argv.includes("--apply"),
    json: argv.includes("--json"),
    verbose: argv.includes("--verbose"),
    safe: argv.includes("--safe"),
    force: argv.includes("--force"),
    yes: argv.includes("--yes") || argv.includes("--y") || argv.includes("-y"),
    noWorktrees: argv.includes("--no-worktrees"),
    sessions: argv.includes("--sessions") || argv.includes("--all"),
    derivedFrom,
  };

  validate("host", cfg.host);
  validate("owner", cfg.owner);
  if (cfg.repo) validate("repo", cfg.repo);

  return cfg;
}

export function repoPath(root: string, c: Config): string {
  return `${ghBase(root)}/${c.owner}/${c.repo}`;
}

export function encodeProjectPath(p: string): string {
  return "-" + p.replace(/^\//, "").replace(/[/.]/g, "-");
}

type Target = {
  kind: "repo" | "session";
  label: string;
  localPath: string;
  remotePath: string;
  realLocal: string;
};

async function enumerateTargets(
  cfg: Config,
  localRoot: string,
  remoteRoot: string,
  remoteHome: string,
): Promise<{ targets: Target[]; warnings: string[] }> {
  const targets: Target[] = [];
  const warnings: string[] = [];
  const ghBaseLocal = ghBase(localRoot);
  const ghBaseRemote = ghBase(remoteRoot);
  const ownerDir = `${ghBaseLocal}/${cfg.owner}`;

  // 1. main repo
  const mainLocal = `${ghBaseLocal}/${cfg.owner}/${cfg.repo}`;
  const mainReal = await resolveSource(mainLocal, localRoot);
  if (mainReal) {
    targets.push({
      kind: "repo",
      label: cfg.repo,
      localPath: mainLocal,
      remotePath: `${ghBaseRemote}/${cfg.owner}/${cfg.repo}`,
      realLocal: mainReal,
    });
  } else if (cfg.direction === "push") {
    warnings.push(`main repo absent locally: ${mainLocal}`);
  }

  // 2. worktrees (default; --no-worktrees to skip)
  if (!cfg.noWorktrees) {
    try {
      const entries = await readdir(ownerDir);
      const wtPrefix = cfg.repo + ".wt-";
      for (const e of entries.sort()) {
        if (!e.startsWith(wtPrefix)) continue;
        const wtLocal = `${ownerDir}/${e}`;
        const wtReal = await resolveSource(wtLocal, localRoot);
        if (!wtReal) continue;
        targets.push({
          kind: "repo",
          label: e,
          localPath: wtLocal,
          remotePath: `${ghBaseRemote}/${cfg.owner}/${e}`,
          realLocal: wtReal,
        });
      }
    } catch {
      // owner dir doesn't exist or unreadable — skip silently
    }
  }

  // 3. session dirs (--sessions or --all)
  if (cfg.sessions) {
    const localClaude = `${homedir()}/.claude/projects`;
    const remoteClaude = `${remoteHome}/.claude/projects`;
    for (const t of [...targets]) {
      const encoded = encodeProjectPath(t.localPath);
      const sessionLocal = `${localClaude}/${encoded}`;
      try {
        await stat(sessionLocal);
        targets.push({
          kind: "session",
          label: `${localClaude}/${encoded}`,
          localPath: sessionLocal,
          remotePath: `${remoteClaude}/${encoded}`,
          realLocal: sessionLocal,
        });
      } catch {
        // no session dir for this worktree — fine
      }
    }
  }

  return { targets, warnings };
}

async function countAndSize(dir: string): Promise<{ files: number; bytes: number }> {
  const excludeArgs = [
    "-not", "-path", "*/.git/*",
    "-not", "-path", "*/node_modules/*",
    "-not", "-name", ".DS_Store",
    "-not", "-name", "._*",
  ];
  const { stdout } = await exec("bash", [
    "-c",
    `find "$1" -type f ${excludeArgs.map((a) => `'${a}'`).join(" ")} -print0 | xargs -0 stat -f%z 2>/dev/null | awk '{s+=$1; n++} END {printf "%d %d", n, s}'`,
    "_", dir,
  ]);
  const [n, b] = stdout.trim().split(/\s+/).map((x) => parseInt(x, 10) || 0);
  return { files: n, bytes: b };
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function remoteHomedir(host: string): Promise<string> {
  const { code, stdout } = await exec("ssh", [
    "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "--", host, "echo $HOME",
  ]);
  if (code !== 0 || !stdout.trim()) return homedir();
  return stdout.trim();
}

export async function resolveSource(path: string, root: string): Promise<string | null> {
  try {
    await stat(path);
    const real = await realpath(path);
    if (!real.startsWith(ghBase(root) + "/")) {
      throw new UsageError(`resolved path escapes ${ghBase(root)}: ${real}`);
    }
    return real;
  } catch (e) {
    if (e instanceof UsageError) throw e;
    return null;
  }
}

type ExecResult = { stdout: string; stderr: string; code: number };

function exec(cmd: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

type TargetState = "present" | "absent" | { error: string };

export async function targetState(host: string, path: string): Promise<TargetState> {
  const remoteCmd = `test -d '${path.replace(/'/g, "'\\''")}' && echo PRESENT || echo ABSENT`;
  const { code, stdout, stderr } = await exec("ssh", [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=5",
    "--", host, remoteCmd,
  ]);
  if (code !== 0) return { error: stderr.trim() || `ssh exit ${code}` };
  if (stdout.includes("PRESENT")) return "present";
  if (stdout.includes("ABSENT")) return "absent";
  return { error: `unexpected output: ${stdout.trim()}` };
}

export function buildRsyncArgs(src: string, dst: string, apply: boolean): string[] {
  const args = ["-rltDvz", "--stats", "--update", "--partial", "--no-owner", "--no-group"];
  for (const e of SAFE_EXCLUDES) args.push("--exclude", e);
  if (!apply) args.push("--dry-run");
  args.push(src + "/", dst + "/");
  return args;
}

export type MembraneReport = {
  caseCollisions: string[];
  secrets: string[];
  appleDouble: number;
};

export async function runMembrane(dir: string): Promise<MembraneReport> {
  const collScript = `find "$1" -type f -not -path '*/.git/*' | awk '{ lc=tolower($0); paths[lc]=paths[lc] $0 "\\n"; cnt[lc]++ } END { for (k in cnt) if (cnt[k] > 1) printf "%s", paths[k] }'`;

  const [coll, secrets, apple] = await Promise.all([
    exec("bash", ["-c", collScript, "_", dir]),
    exec("find", [dir, "-type", "f", "-not", "-path", "*/.git/*", ...SECRET_FIND_EXPR]),
    exec("bash", ["-c", `find "$1" -name '._*' -not -path '*/.git/*' | wc -l`, "_", dir]),
  ]);

  return {
    caseCollisions: coll.stdout.trim().split("\n").filter(Boolean),
    secrets: secrets.stdout.trim().split("\n").filter(Boolean).map((p) => p.replace(dir + "/", "")),
    appleDouble: parseInt(apple.stdout.trim(), 10) || 0,
  };
}

function help(): string {
  return [
    "usage: maw osmosis (--push <host> | --pull <host>) [flags]",
    "",
    "  rsync between m5 and a trusted fleet host. Worktrees synced by default.",
    "",
    "  --push <host>     m5 → host",
    "  --pull <host>     host → m5",
    "  --repo NAME       repo name (default: derived from pwd)",
    "  --owner OWNER     github owner (default: pwd; ghq resolves; fallback laris-co)",
    "  --no-worktrees    repo only, skip <repo>.wt-* siblings",
    "  --sessions        also sync ~/.claude/projects/-<encoded> dirs per repo + worktree",
    "  --all             shorthand for --sessions",
    "  --apply           actually transfer (default: dry-run; prompts y/N first)",
    "  --yes, -y         skip the y/N prompt under --apply",
    "  --safe            audit main repo (case-collisions, secrets, AppleDouble);",
    "                    abort if findings unless --force",
    "  --force           override --safe rejection",
    "  --json            machine-readable output (also skips prompt)",
    "  --verbose         show every file in preview + full rsync command",
    "",
    "  excludes: .git/ node_modules/ .DS_Store ._* .tmp/",
  ].join("\n");
}

async function runRsync(args: string[]): Promise<{ code: number; lines: string[] }> {
  return new Promise((resolve) => {
    const child = spawn("rsync", args, { stdio: ["ignore", "pipe", "pipe"] });
    let buf = "";
    const lines: string[] = [];
    child.stdout.on("data", (b) => {
      buf += b.toString();
      const parts = buf.split("\n");
      buf = parts.pop() || "";
      for (const p of parts) lines.push(p);
    });
    child.stderr.on("data", (b) => process.stderr.write(b));
    child.on("close", (code) => {
      if (buf) lines.push(buf);
      resolve({ code: code ?? 0, lines });
    });
  });
}

const STAT_RE = /^(Number of|Total |sent .* bytes|receiv|File list|Matched|Unmatched|speedup|sending |receiving )/;
const SKIP_RE = /^(Transfer starting|created directory|\.\/|\s*$)/;

function partitionRsyncOutput(lines: string[]): { files: string[]; stats: string[] } {
  const files: string[] = [];
  const stats: string[] = [];
  for (const line of lines) {
    if (!line.trim() || SKIP_RE.test(line)) continue;
    if (STAT_RE.test(line)) stats.push(line);
    else files.push(line);
  }
  return { files, stats };
}

function renderPreview(files: string[], stats: string[], verbose: boolean): void {
  const shown = verbose ? files : files.slice(0, 15);
  if (shown.length > 0) {
    console.log("   files:");
    for (const f of shown) console.log(`     ${f}`);
    if (!verbose && files.length > shown.length) {
      console.log(`     … and ${files.length - shown.length} more (--verbose to see all)`);
    }
    console.log("");
  }
  for (const line of stats.slice(0, 8)) console.log(`   ${line}`);
}

function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    let buf = "";
    const onData = (chunk: Buffer) => {
      const s = chunk.toString();
      buf += s;
      if (s.includes("\n")) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        const answer = buf.trim().toLowerCase();
        resolve(answer === "y" || answer === "yes");
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

async function execute(args: string[], options: { exitOnMissing?: boolean } = {}): Promise<void> {
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

  // Owner resolution: explicit --owner wins. Otherwise try pwd-derived; if that
  // path doesn't exist locally, ask ghq to disambiguate from the repo name.
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
    // assume same as local if ssh fails — actual ssh issue will surface in targetState
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

  type PlanRow = Target & { files: number; bytes: number; remoteState: TargetState; skip: boolean; skipReason?: string };
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
    // Pull from an absent remote source: skip this target, mark with reason.
    const skip = cfg.direction === "pull" && state === "absent";
    plan.push({ ...t, files, bytes, remoteState: state, skip, skipReason: skip ? "absent on remote" : undefined });
  }

  if (!cfg.json) {
    const groupHeader = (items: PlanRow[]): string => {
      if (items.length === 0) return "";
      // common parent dir
      const localParents = new Set(items.map((p) => p.localPath.split("/").slice(0, -1).join("/")));
      const remoteParents = new Set(items.map((p) => p.remotePath.split("/").slice(0, -1).join("/")));
      const localPrefix = localParents.size === 1 ? Array.from(localParents)[0] : "(mixed)";
      const remotePrefix = remoteParents.size === 1 ? Array.from(remoteParents)[0] : "(mixed)";
      if (localPrefix === remotePrefix) return localPrefix;
      const arrow = cfg.direction === "push" ? "→" : "←";
      // m5Side is always m5's actual path; remoteSide is always white's actual path.
      // Only the arrow direction flips.
      return `${localPrefix} ${arrow} ${cfg.host}:${remotePrefix}`;
    };

    const renderGroup = (label: string, items: PlanRow[]) => {
      if (items.length === 0) return;
      console.log(`   ${label}   ${groupHeader(items)}`);
      for (const p of items) {
        const stateGlyph = p.skip ? "⊘" : p.remoteState === "present" ? "↻" : "✦";
        const basename = p.localPath.split("/").pop() || p.label;
        const symlink = p.realLocal !== p.localPath ? ` (→ ${p.realLocal.split("/").pop()})` : "";
        const sizeStr = p.skip
          ? `SKIP — ${p.skipReason}`
          : cfg.direction === "push"
            ? `${p.files} files, ${fmtBytes(p.bytes)}`
            : "(pull)";
        const row = basename + symlink;
        console.log(`     ${stateGlyph} ${row.padEnd(58)} ${sizeStr}`);
      }
      console.log("");
    };
    renderGroup(`REPOS (${repos.length})`, plan.filter((p) => p.kind === "repo"));
    if (sessions.length > 0) {
      renderGroup(`SESSIONS (${sessions.length})`, plan.filter((p) => p.kind === "session"));
    } else if (!cfg.sessions) {
      console.log(`   SESSIONS: skipped (use --sessions or --all to include)\n`);
    }
    const totalFiles = plan.reduce((s, p) => s + p.files, 0);
    const totalBytes = plan.reduce((s, p) => s + p.bytes, 0);
    console.log(`   ─────────────────────────────────`);
    console.log(`   TOTAL: ${plan.length} transfer${plan.length === 1 ? "" : "s"}, ${totalFiles} files, ${fmtBytes(totalBytes)}\n`);
  }

  // --safe membrane audit on main repo (push only)
  if (cfg.safe && cfg.direction === "push") {
    const main = plan.find((p) => p.kind === "repo" && p.label === cfg.repo);
    if (main) {
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
        return;
      }
    }
  } else if (cfg.safe && cfg.direction === "pull") {
    if (!cfg.json) console.log("⚠ --safe with --pull is a no-op (audit would need ssh-side find)\n");
  }

  // Per-target dry-run preview
  type PreviewResult = PlanRow & { previewFiles: string[]; previewStats: string[]; previewCode: number };
  const previews: PreviewResult[] = [];

  for (const p of plan) {
    if (p.skip) {
      previews.push({ ...p, previewFiles: [], previewStats: [], previewCode: 0 });
      continue;
    }
    const src = cfg.direction === "push" ? p.realLocal : `${cfg.host}:${p.remotePath}`;
    const dst = cfg.direction === "push" ? `${cfg.host}:${p.remotePath}` : p.localPath;
    if (!cfg.json) console.log(`🔍 preview · ${p.label}`);
    const previewArgs = buildRsyncArgs(src, dst, false);
    if (cfg.verbose && !cfg.json) console.log(`   rsync ${previewArgs.join(" ")}`);
    const { code, lines } = await runRsync(previewArgs);
    const { files, stats } = partitionRsyncOutput(lines);
    if (!cfg.json) {
      if (code !== 0) {
        console.error(`   ✖ preview exit ${code}\n`);
      } else {
        renderPreview(files, stats, cfg.verbose);
        console.log("");
      }
    }
    previews.push({ ...p, previewFiles: files, previewStats: stats, previewCode: code });
  }

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

  // --apply: prompt + sequential real rsync
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

function argsFromContext(ctx: InvokeContext): string[] {
  return ctx.source === "cli" && Array.isArray(ctx.args) ? (ctx.args as string[]) : [];
}

async function captureOutput(args: string[]): Promise<InvokeResult> {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  try {
    console.log = (...v: unknown[]) => lines.push(v.map(String).join(" "));
    console.error = (...v: unknown[]) => lines.push(v.map(String).join(" "));
    await execute(args);
    const output = lines.join("\n");
    return output ? { ok: true, output } : { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const output = lines.join("\n");
    return { ok: false, error: message, ...(output ? { output } : {}) };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  execute(argv, { exitOnMissing: true }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export default async function handler(ctxOrArgs: InvokeContext | string[]): Promise<InvokeResult | void> {
  if (Array.isArray(ctxOrArgs)) {
    return execute(ctxOrArgs, { exitOnMissing: true });
  }
  return captureOutput(argsFromContext(ctxOrArgs));
}

export { SAFE_EXCLUDES, validate, UsageError };
