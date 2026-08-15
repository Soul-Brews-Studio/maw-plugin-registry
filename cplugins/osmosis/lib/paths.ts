import { stat, realpath } from "node:fs/promises";
import { type Config, UsageError } from "./types";
import { exec } from "./ghq";

export function ghBase(root: string): string {
  return `${root}/github.com`;
}

export function repoPath(root: string, c: Config): string {
  return `${ghBase(root)}/${c.owner}/${c.repo}`;
}

export function encodeProjectPath(p: string): string {
  return "-" + p.replace(/^\//, "").replace(/[/.]/g, "-");
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

export async function countAndSize(dir: string): Promise<{ files: number; bytes: number }> {
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

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
