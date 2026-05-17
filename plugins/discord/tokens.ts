/**
 * `maw discord tokens` — list/check Discord bot tokens in pass without revealing them.
 *
 * Hybrid pattern: tokens live in pass (~/.password-store/discord/*.gpg), config lives
 * in <bot-repo>/.discord/. This subcommand inspects ONLY the pass side.
 *
 * No side effects. Pure functions. Audit-friendly.
 */
import { hostExec } from "maw-js/sdk";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const PASS_DIR = join(homedir(), ".password-store", "discord");

interface TokenEntry {
  name: string;
  file: string;
  sizeBytes: number;
  mtime: Date;
}

function listTokens(): TokenEntry[] {
  if (!existsSync(PASS_DIR)) return [];
  return readdirSync(PASS_DIR)
    .filter(f => f.endsWith(".gpg"))
    .map(f => {
      const file = join(PASS_DIR, f);
      const stat = statSync(file);
      return {
        name: f.replace(/\.gpg$/, ""),
        file,
        sizeBytes: stat.size,
        mtime: stat.mtime,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function decryptToken(name: string): Promise<string | null> {
  try {
    const out = await hostExec(`pass show discord/${name} 2>/dev/null`);
    return out.trim() || null;
  } catch {
    return null;
  }
}

async function pingDiscord(token: string): Promise<{ ok: boolean; status: number; username?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
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

export const cmdTokens = {
  /**
   * `maw discord tokens ls` — list tokens in pass without decrypting.
   * Shows: name, size, last-modified. No reveals, no network.
   */
  async ls(log: (s: string) => void): Promise<void> {
    const tokens = listTokens();
    if (tokens.length === 0) {
      log(`✗ no tokens in ${PASS_DIR}`);
      log("hint: pass insert discord/<bot>-token");
      return;
    }

    log(`📦 ${tokens.length} token(s) in pass (~/.password-store/discord/)`);
    log("");
    log("  name                                  size    last-modified");
    log("  ──────────────────────────────────────────────────────────────");
    for (const t of tokens) {
      const name = t.name.padEnd(38);
      const size = `${t.sizeBytes}B`.padEnd(7);
      const when = t.mtime.toISOString().slice(0, 10);
      log(`  ${name}${size} ${when}`);
    }
    log("");
    log(`use 'maw discord tokens check' to verify each one decrypts + Discord 200`);
  },

  /**
   * `maw discord tokens check [bot]` — decrypt each token + ping Discord REST.
   * Shows: OK / FAIL with status code + bot username. Token itself is never printed.
   * Optional <bot> arg narrows to one entry.
   */
  async check(log: (s: string) => void, only?: string): Promise<void> {
    const tokens = listTokens();
    if (tokens.length === 0) {
      log(`✗ no tokens to check`);
      return;
    }

    const filtered = only
      ? tokens.filter(t => t.name === only || t.name === `${only}-token`)
      : tokens;

    if (filtered.length === 0) {
      log(`✗ no token matching '${only}' (tried '${only}' and '${only}-token')`);
      return;
    }

    log(`🔐 checking ${filtered.length} token(s)...`);
    log("");
    log("  name                                  decrypt  discord  bot");
    log("  ──────────────────────────────────────────────────────────────────");

    let okCount = 0;
    let failCount = 0;
    // Sequential intentional — Discord REST allows 50 req/s global, but serial
    // keeps debug output readable + leaves headroom for other clients on the host.
    // Each request times out at 5s (AbortController in pingDiscord).
    for (const t of filtered) {
      const tok = await decryptToken(t.name);
      const name = t.name.padEnd(38);

      if (!tok) {
        log(`  ${name}✗ fail   —        —`);
        failCount++;
        continue;
      }

      const ping = await pingDiscord(tok);
      const decrypt = "✓ OK   ";
      const status = ping.ok ? `✓ ${ping.status}    ` : `✗ ${ping.status || "ERR"}   `;
      const user = ping.username || (ping.ok ? "—" : "—");
      log(`  ${name}${decrypt} ${status} ${user}`);
      if (ping.ok) okCount++; else failCount++;
    }

    log("");
    log(`summary: ${okCount}/${filtered.length} green${failCount > 0 ? `, ${failCount} fail` : ""}`);
  },
};
