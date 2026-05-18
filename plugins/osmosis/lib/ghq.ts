import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ExecResult, type TargetState, UsageError } from "./types";


export type RepoSpec = {
  owner: string;
  repo: string;
  path?: string;
  source: string;
};

type FleetWindow = { name?: unknown; repo?: unknown };
type FleetSession = { name?: unknown; windows?: unknown };

function splitRepoSlug(slug: string): { owner: string; repo: string } | null {
  const cleaned = slug.trim().replace(/^github\.com\//, "").replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  return { owner, repo };
}

function repoFromGhqPath(path: string): RepoSpec | null {
  const m = path.match(/\/github\.com\/([^/]+)\/([^/]+)\/?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], path, source: "ghq" };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function stripOracleSuffix(name: string): string {
  return name.replace(/-oracle$/i, "");
}

function fleetSessionAliases(name: string): string[] {
  const normalized = normalizeName(name);
  const withoutOrdinal = normalized.replace(/^\d+[-_]/, "");
  return [...new Set([normalized, withoutOrdinal, stripOracleSuffix(normalized), stripOracleSuffix(withoutOrdinal)])];
}

function fleetWindowMatches(query: string, sessionName: string | undefined, windowName: string | undefined, repoSlug: string): boolean {
  const q = normalizeName(query);
  const repo = splitRepoSlug(repoSlug);
  const aliases = new Set<string>([q, `${q}-oracle`, stripOracleSuffix(q)]);
  if (windowName) {
    const win = normalizeName(windowName);
    if (aliases.has(win) || aliases.has(stripOracleSuffix(win))) return true;
  }
  if (sessionName && fleetSessionAliases(sessionName).some((a) => aliases.has(a))) return true;
  if (repo) {
    const repoName = normalizeName(repo.repo);
    if (aliases.has(repoName) || aliases.has(stripOracleSuffix(repoName))) return true;
  }
  return false;
}

function uniqueRepoSpecs(specs: RepoSpec[]): RepoSpec[] {
  const seen = new Map<string, RepoSpec>();
  for (const spec of specs) {
    const key = `${spec.owner}/${spec.repo}`;
    if (!seen.has(key)) seen.set(key, spec);
  }
  return [...seen.values()];
}

function pickSingleRepo(query: string, matches: RepoSpec[], source: string): RepoSpec | null {
  const unique = uniqueRepoSpecs(matches);
  if (unique.length === 0) return null;
  if (unique.length === 1) return unique[0];
  throw new UsageError(
    `ambiguous repo "${query}" — ${source} found ${unique.length} matches:\n  ${unique.map((m) => `${m.owner}/${m.repo}${m.path ? ` (${m.path})` : ""}`).join("\n  ")}\nspecify --owner and --repo`,
  );
}

export function fleetDir(): string {
  if (process.env.MAW_HOME) return join(process.env.MAW_HOME, "config", "fleet");
  return join(process.env.MAW_CONFIG_DIR || join(homedir(), ".config", "maw"), "fleet");
}

export function resolveFleetRepoFromSessions(query: string, sessions: FleetSession[]): RepoSpec | null {
  const matches: RepoSpec[] = [];
  for (const session of sessions) {
    const sessionName = typeof session.name === "string" ? session.name : undefined;
    const windows = Array.isArray(session.windows) ? session.windows as FleetWindow[] : [];
    for (const window of windows) {
      const repoSlug = typeof window.repo === "string" ? window.repo : "";
      if (!repoSlug || !fleetWindowMatches(query, sessionName, typeof window.name === "string" ? window.name : undefined, repoSlug)) continue;
      const split = splitRepoSlug(repoSlug);
      if (!split) continue;
      matches.push({ owner: split.owner, repo: split.repo, source: sessionName ? `fleet:${sessionName}` : "fleet" });
    }
  }
  return pickSingleRepo(query, matches, "fleet");
}

export async function resolveFleetRepo(query: string, dir: string = fleetDir()): Promise<RepoSpec | null> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }
  const sessions: FleetSession[] = [];
  for (const file of files.filter((f) => f.endsWith(".json") && !f.endsWith(".disabled")).sort()) {
    try {
      sessions.push(JSON.parse(await readFile(join(dir, file), "utf8")) as FleetSession);
    } catch {
      // Ignore malformed/stale fleet files; osmosis can still fall back to local paths/ghq.
    }
  }
  return resolveFleetRepoFromSessions(query, sessions);
}

export function resolveGhqRepoFromPaths(query: string, paths: string[]): RepoSpec | null {
  const repos = paths.map(repoFromGhqPath).filter((repo): repo is RepoSpec => !!repo);
  const q = normalizeName(query);
  const exact = repos.filter((r) => normalizeName(r.repo) === q);
  if (exact.length > 0) return pickSingleRepo(query, exact, "ghq");
  const fuzzy = repos.filter((r) => {
    const repo = normalizeName(r.repo);
    return stripOracleSuffix(repo) === q || repo.includes(q);
  });
  return pickSingleRepo(query, fuzzy, "ghq");
}

const M5_ROOT_FALLBACK = "/opt/Code";

export function exec(cmd: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });
}

let _ghqRootCache: string | null = null;

export async function ghqRoot(): Promise<string> {
  if (_ghqRootCache) return _ghqRootCache;
  const { code, stdout } = await exec("ghq", ["root"]);
  if (code !== 0) return (_ghqRootCache = M5_ROOT_FALLBACK);
  return (_ghqRootCache = stdout.trim() || M5_ROOT_FALLBACK);
}

export async function ghqRemoteRoot(host: string): Promise<string> {
  const { code, stdout } = await exec("ssh", [
    "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "--", host, "ghq root",
  ]);
  if (code !== 0) throw new UsageError(`ghq root on ${host} failed`);
  return stdout.trim();
}

export async function ghqResolveRepo(repo: string): Promise<RepoSpec | null> {
  const { code, stdout } = await exec("ghq", ["list", "-p", repo]);
  if (code !== 0) return null;
  const matches = stdout.trim().split("\n").filter(Boolean);
  return resolveGhqRepoFromPaths(repo, matches);
}

export async function ghqResolveOwner(repo: string): Promise<string | null> {
  const { code, stdout } = await exec("ghq", ["list", "-p", repo]);
  if (code !== 0) return null;
  const matches = stdout.trim().split("\n").filter(Boolean);
  if (matches.length === 0) return null;
  const owners = new Set(
    matches
      .map((m) => m.match(/\/github\.com\/([^/]+)\/[^/]+$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => m[1]),
  );
  if (owners.size === 1) return Array.from(owners)[0];
  throw new UsageError(
    `ambiguous repo "${repo}" — ghq found ${matches.length} matches across ${owners.size} owners:\n  ${matches.join("\n  ")}\nspecify --owner`,
  );
}

export async function remoteHomedir(host: string): Promise<string> {
  const { code, stdout } = await exec("ssh", [
    "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "--", host, "echo $HOME",
  ]);
  if (code !== 0 || !stdout.trim()) return homedir();
  return stdout.trim();
}

export async function targetState(host: string, path: string): Promise<TargetState> {
  const remoteCmd = `test -d '${path.replace(/'/g, "'\\''")}' && echo PRESENT || echo ABSENT`;
  const { code, stdout, stderr } = await exec("ssh", [
    "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "--", host, remoteCmd,
  ]);
  if (code !== 0) return { error: stderr.trim() || `ssh exit ${code}` };
  if (stdout.includes("PRESENT")) return "present";
  if (stdout.includes("ABSENT")) return "absent";
  return { error: `unexpected output: ${stdout.trim()}` };
}
