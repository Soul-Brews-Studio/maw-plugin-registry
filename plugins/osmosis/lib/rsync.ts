import { spawn } from "node:child_process";

export const SAFE_EXCLUDES = [".git/", "node_modules/", ".DS_Store", "._*", ".tmp/"];

const STAT_RE = /^(Number of|Total |sent .* bytes|receiv|File list|Matched|Unmatched|speedup|sending |receiving )/;
const SKIP_RE = /^(Transfer starting|created directory|\.\/|\s*$)/;

export function buildRsyncArgs(src: string, dst: string, apply: boolean): string[] {
  const args = ["-rltDvz", "--stats", "--update", "--partial", "--no-owner", "--no-group"];
  for (const e of SAFE_EXCLUDES) args.push("--exclude", e);
  if (!apply) args.push("--dry-run");
  args.push(src + "/", dst + "/");
  return args;
}

export async function runRsync(args: string[]): Promise<{ code: number; lines: string[] }> {
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

export function partitionRsyncOutput(lines: string[]): { files: string[]; stats: string[] } {
  const files: string[] = [];
  const stats: string[] = [];
  for (const line of lines) {
    if (!line.trim() || SKIP_RE.test(line)) continue;
    if (STAT_RE.test(line)) stats.push(line);
    else files.push(line);
  }
  return { files, stats };
}

export function renderPreview(files: string[], stats: string[], verbose: boolean): void {
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

export function promptYesNo(question: string): Promise<boolean> {
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
