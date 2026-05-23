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
  // Allowlist of chars safe to pass unquoted to a shell. Fast path returns
  // the string as-is.
  if (/^[A-Za-z0-9_@.\-\/:]+$/.test(s)) return s;

  // For strings with special chars, escape each meta-char with `\`. We use
  // backslash-escaping instead of single-quote wrapping because the latter
  // can lose its quote layer in nested eval scenarios — specifically the
  // `maw new --cmd "$cmd" → tmux send to pane → zsh evaluates` chain.
  // Single quotes get consumed once by tmux/zsh, then brackets in the
  // resulting string get re-globbed by zsh ("no matches found").
  //
  // Backslash escapes survive one layer of eval (the `\[` becomes `[` after
  // one pass, but no glob fires). Reported by ccc-oracle 2026-05-23 for
  // `--model 'claude-opus-4-6[1m]'` 1M-context modifier.
  return s.replace(/([\\$`"'\s\[\]\(\)\*\?\<\>\|\&;{}!])/g, "\\$1");
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
