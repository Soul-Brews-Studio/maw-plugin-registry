import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { type ExecResult, type TargetState, UsageError } from "./types";

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
