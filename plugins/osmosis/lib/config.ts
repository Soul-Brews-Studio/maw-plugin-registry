import { type Config, type Direction, UsageError } from "./types";

const VALID_NAME = /^[A-Za-z0-9._-]+$/;

export function deriveFromPwd(cwd: string): { owner?: string; repo?: string; worktreeSuffix?: string } {
  const m = cwd.match(/\/opt\/Code\/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) return {};
  const owner = m[1];
  const full = m[2];
  const wt = full.match(/^(.+?)\.wt-(.+)$/);
  if (wt) return { owner, repo: wt[1], worktreeSuffix: wt[2] };
  return { owner, repo: full };
}

export function validate(name: string, value: string): void {
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
    diff: argv.includes("--diff"),
    derivedFrom,
  };

  validate("host", cfg.host);
  validate("owner", cfg.owner);
  if (cfg.repo) validate("repo", cfg.repo);
  return cfg;
}

export function help(): string {
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
    "  --diff            show two-way dirty check only; do not rsync/apply",
    "  --apply           actually transfer (default: dry-run; prompts y/N first)",
    "  --yes, -y         skip the y/N prompt under --apply",
    "  --safe            audit main repo (case-collisions, secrets, AppleDouble);",
    "                    abort if findings unless --force",
    "  --force           skip dirty-check preview; also override --safe rejection",
    "  --json            machine-readable output (also skips prompt)",
    "  --verbose         show every file in preview + full rsync command",
    "",
    "  excludes: .git/ node_modules/ .DS_Store ._* .tmp/",
  ].join("\n");
}
