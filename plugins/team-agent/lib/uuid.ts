/**
 * UUID generation + parent resolution.
 *
 * Format: NNNNNNNN-HHMM-YYYY-MMDD-YYMMDDHHMMSS
 *   counter   time   year  date   compact timestamp
 *
 * All digits 0-9 → RFC-valid hex UUID. Counter persisted at ~/.claude/team-agent-counter.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const COUNTER_FILE = join(homedir(), ".claude", "team-agent-counter");

export function generateReadableUuid(
  _marker: string = "000000000000",
): { uuid: string; counter: number; shortRef: string } {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const yy   = yyyy.slice(2);
  const mm   = String(now.getMonth() + 1).padStart(2, "0");
  const dd   = String(now.getDate()).padStart(2, "0");
  const hh   = String(now.getHours()).padStart(2, "0");
  const mi   = String(now.getMinutes()).padStart(2, "0");
  const ss   = String(now.getSeconds()).padStart(2, "0");

  let counter = 0;
  try {
    if (existsSync(COUNTER_FILE)) {
      counter = parseInt(readFileSync(COUNTER_FILE, "utf-8").trim(), 10) || 0;
    }
  } catch {}
  counter += 1;
  try {
    mkdirSync(dirname(COUNTER_FILE), { recursive: true });
    writeFileSync(COUNTER_FILE, String(counter));
  } catch {}
  const ctr = String(counter % 100000000).padStart(8, "0");

  const g1 = ctr;
  const g2 = `${hh}${mi}`;
  const g3 = yyyy;
  const g4 = `${mm}${dd}`;
  const g5 = `${yy}${mm}${dd}${hh}${mi}${ss}`;

  return {
    uuid: `${g1}-${g2}-${g3}-${g4}-${g5}`,
    counter,
    shortRef: `#${counter}`,
  };
}

function encodePath(p: string): string {
  return p.replace(/^\//, "-").replace(/[/.]/g, "-");
}

/**
 * Resolve the parent (lead) session UUID.
 *   1. $CLAUDE_SESSION_ID env var
 *   2. Newest .jsonl in ~/.claude/projects/<encoded-pwd>/
 */
export function resolveParentUuid(cwd: string = process.cwd()): string | null {
  const env = process.env.CLAUDE_SESSION_ID;
  if (env && UUID_RE.test(env)) return env;

  const projectDir = join(homedir(), ".claude", "projects", encodePath(cwd));
  if (!existsSync(projectDir)) return null;
  try {
    const files = readdirSync(projectDir)
      .filter((f: string) => f.endsWith(".jsonl"))
      .map((f: string) => ({ name: f, mtime: statSync(join(projectDir, f)).mtimeMs }))
      .sort((a: { mtime: number }, b: { mtime: number }) => b.mtime - a.mtime);
    if (files.length === 0) return null;
    const newest = files[0].name.replace(/\.jsonl$/, "");
    return UUID_RE.test(newest) ? newest : null;
  } catch {
    return null;
  }
}
