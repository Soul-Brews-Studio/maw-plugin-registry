/**
 * Helpers: types, colors, shell-quote, member-spec parser, find-claude-bin.
 */

import { existsSync } from "fs";
import { homedir } from "os";

export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return homedir() + p.slice(1);
  return p;
}

export type InvokeContext = {
  source: "cli" | string;
  args: string[];
  flags?: Record<string, unknown>;
  writer?: (...a: any[]) => void;
};
export type InvokeResult = { ok: boolean; output?: string; error?: string };

export const VALID_COLORS = ["red", "green", "yellow", "blue", "purple", "cyan", "magenta", "white"];

export function findClaudeBin(): string {
  const candidates = [
    `${homedir()}/.nvm/versions/node/v24.15.0/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`,
    `/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`,
    `${homedir()}/.bun/install/global/node_modules/@anthropic-ai/claude-code/bin/claude.exe`,
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return "claude";
}

export function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_@.\-\/:]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Member spec formats:
 *   role                       → cwd=pwd, color=auto
 *   role:color                 → cwd=pwd, color=specified
 *   role@cwd                   → cwd=specified, color=auto
 *   role@cwd:color             → all specified
 */
export function parseMemberSpec(spec: string, defaultColorIdx = 0): { role: string; cwd: string; color: string } {
  let role: string, cwd: string, color: string | undefined;
  const atIdx = spec.indexOf("@");
  if (atIdx < 0) {
    const colonIdx = spec.indexOf(":");
    if (colonIdx >= 0) {
      role = spec.slice(0, colonIdx);
      color = spec.slice(colonIdx + 1) || undefined;
    } else {
      role = spec;
    }
    cwd = process.cwd();
  } else {
    role = spec.slice(0, atIdx);
    const rest = spec.slice(atIdx + 1);
    const colonIdx = rest.indexOf(":");
    if (colonIdx >= 0) {
      cwd = rest.slice(0, colonIdx);
      color = rest.slice(colonIdx + 1) || undefined;
    } else {
      cwd = rest;
    }
  }
  if (!role) throw new Error(`bad member spec: missing role in "${spec}"`);
  if (!color) color = VALID_COLORS[defaultColorIdx % VALID_COLORS.length];
  if (!VALID_COLORS.includes(color)) throw new Error(`bad color "${color}" — valid: ${VALID_COLORS.join(",")}`);
  cwd = expandTilde(cwd);
  if (!existsSync(cwd)) throw new Error(`cwd does not exist: ${cwd}`);
  return { role, cwd, color };
}

export function nowMs(): number { return Date.now(); }
export function nowISO(): string { return new Date().toISOString(); }
