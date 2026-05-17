/**
 * Shared utilities for the `maw discord` plugin family.
 *
 * All side-effect-free or read-only. Subcommand modules (tokens.ts, status.ts)
 * import from here so we never duplicate decrypt/REST/filesystem helpers.
 */
import { hostExec } from "maw-js/sdk";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const PASS_DIR = join(homedir(), ".password-store", "discord");
export const LEGACY_STATE_DIR_ROOT = join(homedir(), ".claude", "channels");

export interface TokenEntry {
  name: string;     // e.g. "pulse-oracle-token"
  bot: string;      // e.g. "pulse-oracle"  (token name without -token suffix)
  file: string;
  sizeBytes: number;
  mtime: Date;
}

export function listPassTokens(): TokenEntry[] {
  if (!existsSync(PASS_DIR)) return [];
  return readdirSync(PASS_DIR)
    .filter(f => f.endsWith(".gpg"))
    .map(f => {
      const file = join(PASS_DIR, f);
      const stat = statSync(file);
      const name = f.replace(/\.gpg$/, "");
      const bot = name.replace(/-token$/, "");
      return { name, bot, file, sizeBytes: stat.size, mtime: stat.mtime };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function decryptToken(passName: string): Promise<string | null> {
  try {
    const out = await hostExec(`pass show discord/${passName} 2>/dev/null`);
    return out.trim() || null;
  } catch {
    return null;
  }
}

export interface DiscordPing {
  ok: boolean;
  status: number;
  username?: string;
}

export async function pingDiscord(token: string, timeoutMs = 5000): Promise<DiscordPing> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
      signal: ctrl.signal,
    });
    if (res.ok) {
      const data: any = await res.json();
      return { ok: true, status: res.status, username: data.username };
    }
    return { ok: false, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a bot/repo name to its on-disk ghq path. Returns the first match
 * (prefers Soul-Brews-Studio over forks if both exist).
 */
export async function findGhqPath(name: string): Promise<string | null> {
  try {
    // grep (not -F) for end-of-line anchor; escape regex metacharacters in name
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const out = await hostExec(`ghq list -p 2>/dev/null | grep "/${escaped}$" || true`);
    const lines = out.split("\n").map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    // Prefer Soul-Brews-Studio paths over forks/duplicates
    const preferred = lines.find(l => l.includes("/Soul-Brews-Studio/"));
    return preferred ?? lines[0];
  } catch {
    return null;
  }
}

/**
 * Legacy state-dir check: `~/.claude/channels/<bot>/` exists?
 */
export function findLegacyStateDir(bot: string): string | null {
  const path = join(LEGACY_STATE_DIR_ROOT, bot);
  return existsSync(path) ? path : null;
}

/**
 * Hybrid pattern check: `<bot-repo>/.discord/` exists?
 */
export async function findHybridDiscord(bot: string): Promise<string | null> {
  const repo = await findGhqPath(bot);
  if (!repo) return null;
  const discoDir = join(repo, ".discord");
  return existsSync(discoDir) ? discoDir : null;
}

/**
 * tmux session lookup — finds any session whose name contains <bot>.
 * Returns the full session line (e.g. "07-pulse-oracle: 1 windows ...") or null.
 */
export async function findTmuxSession(bot: string): Promise<string | null> {
  try {
    const out = await hostExec(`tmux ls 2>/dev/null | grep -F "${bot}" || true`);
    const first = out.split("\n")[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
}

/**
 * Parse discord-oracle/src/state-dirs.ts to get the set of registered bots.
 * Returns empty set if discord-oracle isn't cloned locally.
 */
export async function loadStateDirsRegistry(): Promise<Set<string>> {
  const repo = await findGhqPath("discord-oracle");
  if (!repo) return new Set();
  const file = join(repo, "src", "state-dirs.ts");
  if (!existsSync(file)) return new Set();
  try {
    const content = readFileSync(file, "utf8");
    // Match keys of the STATE_DIRS object: `"<bot-name>":`
    const matches = content.matchAll(/"([a-z][a-z0-9-]+)":/gi);
    return new Set(Array.from(matches, m => m[1]!));
  } catch {
    return new Set();
  }
}

/**
 * Pretty-printed file size — bytes only for v0.2 (most files <1KB).
 */
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}K`;
}
