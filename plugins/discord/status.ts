/**
 * `maw discord status` — fleet inspection from this host's perspective.
 *
 * Surfaces the configuration chain per bot:
 *   pass token  →  legacy state-dir  →  hybrid .discord/  →  tmux session  →  state-dirs.ts registry
 *
 * Union of pass(20) ∪ state-dirs.ts(18) so anomalies are visible:
 *   - token-only (orphan in pass)
 *   - registered-only (broken: registered but no token)
 *   - normal intersection
 *
 * No side effects. Read-only filesystem + optional Discord REST (--check).
 * Flags: --check (ping Discord REST), --redact (hide dates), --json (machine-readable),
 *        <bot> narrows to a single detail card.
 */
import {
  listPassTokens, decryptToken, pingDiscord,
  findLegacyStateDir, findHybridDiscord, findTmuxSession,
  loadStateDirsRegistry, fmtSize,
} from "./lib";
import { readdirSync, statSync } from "fs";
import { join } from "path";

interface BotRow {
  bot: string;
  inPass: boolean;
  inRegistry: boolean;
  legacyPath: string | null;
  hybridPath: string | null;
  tmuxLine: string | null;
  discordOK?: boolean;
  discordStatus?: number;
  discordUsername?: string;
}

type Severity = "ok" | "warn" | "info" | "error";

function classifyBot(row: BotRow): { severity: Severity; reason: string } {
  // error: registered but no token (broken bot)
  if (row.inRegistry && !row.inPass) {
    return { severity: "error", reason: "registered but no token in pass" };
  }
  // error: token in pass but not registered (orphan)
  if (row.inPass && !row.inRegistry) {
    return { severity: "error", reason: "token in pass but not in state-dirs.ts" };
  }
  // error: --check showed Discord REST failure
  if (row.discordOK === false) {
    return { severity: "error", reason: `Discord REST returned ${row.discordStatus}` };
  }
  // info: hybrid pattern not yet applied (migration TODO)
  if (row.inPass && row.inRegistry && !row.hybridPath) {
    return { severity: "info", reason: "legacy state-dir only — hybrid pattern not applied" };
  }
  // warn: registered, has hybrid, but not running locally (probably fine, just offline on this host)
  if (row.inRegistry && !row.tmuxLine) {
    return { severity: "warn", reason: "not running locally on this host" };
  }
  return { severity: "ok", reason: "" };
}

async function gatherRows(): Promise<BotRow[]> {
  const tokens = listPassTokens();
  const registry = await loadStateDirsRegistry();
  const allBots = new Set<string>([...tokens.map(t => t.bot), ...registry]);

  const rows: BotRow[] = [];
  for (const bot of Array.from(allBots).sort()) {
    const inPass = tokens.some(t => t.bot === bot);
    const inRegistry = registry.has(bot);
    const legacyPath = findLegacyStateDir(bot);
    const hybridPath = await findHybridDiscord(bot);
    const tmuxLine = await findTmuxSession(bot);
    rows.push({ bot, inPass, inRegistry, legacyPath, hybridPath, tmuxLine });
  }
  return rows;
}

async function addDiscordChecks(rows: BotRow[]): Promise<void> {
  const tokens = listPassTokens();
  // Sequential — Discord REST 50 req/s global, serial keeps output readable + leaves headroom
  for (const row of rows) {
    if (!row.inPass) continue;
    const tokEntry = tokens.find(t => t.bot === row.bot);
    if (!tokEntry) continue;
    const tok = await decryptToken(tokEntry.name);
    if (!tok) {
      row.discordOK = false;
      row.discordStatus = 0;
      continue;
    }
    const ping = await pingDiscord(tok);
    row.discordOK = ping.ok;
    row.discordStatus = ping.status;
    row.discordUsername = ping.username;
  }
}

function sym(b: boolean): string {
  return b ? "✓" : "·";
}

function sevIcon(s: Severity): string {
  switch (s) {
    case "ok": return "✓";
    case "warn": return "○";
    case "info": return "·";
    case "error": return "✗";
  }
}

interface StatusOpts {
  check: boolean;
  redact: boolean;
  json: boolean;
  filter?: string;
}

function parseOpts(args: string[]): StatusOpts {
  const opts: StatusOpts = {
    check: args.includes("--check"),
    redact: args.includes("--redact"),
    json: args.includes("--json"),
  };
  const positional = args.filter(a => !a.startsWith("--"));
  if (positional[0]) opts.filter = positional[0];
  return opts;
}

export const cmdStatus = {
  async run(log: (s: string) => void, args: string[]): Promise<void> {
    const opts = parseOpts(args);

    let rows = await gatherRows();
    if (opts.filter) {
      rows = rows.filter(r => r.bot === opts.filter || r.bot === `${opts.filter}-oracle`);
      if (rows.length === 0) {
        log(`✗ no bot matching '${opts.filter}' in pass or state-dirs.ts`);
        return;
      }
    }

    if (opts.check) {
      await addDiscordChecks(rows);
    }

    if (opts.json) {
      return this.emitJson(log, rows, opts);
    }

    if (opts.filter && rows.length === 1) {
      return this.emitDetailed(log, rows[0]!, opts);
    }

    return this.emitTable(log, rows, opts);
  },

  emitTable(log: (s: string) => void, rows: BotRow[], opts: StatusOpts): void {
    log(`🔍 maw discord status — ${rows.length} bot(s) | ${opts.redact ? "REDACTED · " : ""}${opts.check ? "with Discord REST" : "stat only — use --check for REST"}`);
    log("");
    const head = opts.check
      ? "  bot                          pass  legacy  hybrid  tmux  reg  discord       severity"
      : "  bot                          pass  legacy  hybrid  tmux  reg               severity";
    log(head);
    log("  " + "─".repeat(head.length - 2));

    const counts: Record<Severity, number> = { ok: 0, warn: 0, info: 0, error: 0 };
    for (const row of rows) {
      const cls = classifyBot(row);
      counts[cls.severity]++;
      const bot = row.bot.padEnd(28);
      const pass = sym(row.inPass).padEnd(5);
      const legacy = sym(!!row.legacyPath).padEnd(7);
      const hybrid = sym(!!row.hybridPath).padEnd(7);
      const tmux = sym(!!row.tmuxLine).padEnd(5);
      const reg = sym(row.inRegistry).padEnd(4);
      const sev = `${sevIcon(cls.severity)} ${cls.severity}`;

      if (opts.check) {
        const discord = row.discordOK === undefined
          ? "—            "
          : row.discordOK
            ? `✓ 200 ${(row.discordUsername || "—").slice(0, 6).padEnd(7)}`
            : `✗ ${(row.discordStatus || "ERR").toString().padEnd(11)}`;
        log(`  ${bot}${pass} ${legacy} ${hybrid} ${tmux} ${reg} ${discord} ${sev}`);
      } else {
        log(`  ${bot}${pass} ${legacy} ${hybrid} ${tmux} ${reg}              ${sev}`);
      }
    }

    log("");
    log(`summary: ${counts.ok} ok · ${counts.warn} warn · ${counts.info} info · ${counts.error} error`);
    if (counts.error > 0) {
      log(`run 'maw discord status <bot>' for details on any error/info row`);
    }
  },

  emitDetailed(log: (s: string) => void, row: BotRow, opts: StatusOpts): void {
    const cls = classifyBot(row);
    log(`🔍 ${row.bot}    ${sevIcon(cls.severity)} ${cls.severity}${cls.reason ? ` — ${cls.reason}` : ""}`);
    log("");

    // Pass token
    if (row.inPass) {
      const tokens = listPassTokens();
      const t = tokens.find(x => x.bot === row.bot);
      if (t) {
        const when = opts.redact ? "—" : t.mtime.toISOString().slice(0, 10);
        log(`  Pass token:        ✓ discord/${t.name} (${fmtSize(t.sizeBytes)}, ${when})`);
      }
    } else {
      log(`  Pass token:        ✗ missing — no discord/${row.bot}-token in pass`);
    }

    // Legacy state-dir
    if (row.legacyPath) {
      log(`  Legacy state-dir:  ✓ ${row.legacyPath}/`);
      try {
        const entries = readdirSync(row.legacyPath).filter(f => !f.startsWith("."));
        const hidden = readdirSync(row.legacyPath).filter(f => f.startsWith("."));
        for (const e of [...hidden, ...entries]) {
          const sub = join(row.legacyPath, e);
          try {
            const s = statSync(sub);
            const when = opts.redact ? "—" : s.mtime.toISOString().slice(0, 10);
            log(`                       - ${e.padEnd(20)} ${fmtSize(s.size).padStart(6)}  ${when}`);
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    } else {
      log(`  Legacy state-dir:  ✗ not found at ~/.claude/channels/${row.bot}/`);
    }

    // Hybrid pattern
    if (row.hybridPath) {
      log(`  Hybrid .discord/:  ✓ ${row.hybridPath}/`);
    } else {
      log(`  Hybrid .discord/:  ✗ not migrated yet (run 'maw discord bind' once shipped)`);
    }

    // tmux
    if (row.tmuxLine) {
      log(`  Local tmux:        ✓ ${row.tmuxLine}`);
    } else {
      log(`  Local tmux:        ✗ not running on this host`);
    }

    // Registry
    if (row.inRegistry) {
      log(`  state-dirs.ts:     ✓ registered (discord-oracle dashboard sees it)`);
    } else {
      log(`  state-dirs.ts:     ✗ NOT registered — add to discord-oracle/src/state-dirs.ts`);
    }

    // Discord
    if (opts.check) {
      if (row.discordOK) {
        log(`  Discord identity:  ✓ ${row.discordStatus} — ${row.discordUsername || "—"}`);
      } else if (row.discordStatus !== undefined) {
        log(`  Discord identity:  ✗ ${row.discordStatus || "ERR"}`);
      }
    } else {
      log(`  Discord identity:  (run with --check to verify)`);
    }
  },

  emitJson(log: (s: string) => void, rows: BotRow[], _opts: StatusOpts): void {
    const out = rows.map(r => {
      const cls = classifyBot(r);
      return {
        bot: r.bot,
        severity: cls.severity,
        reason: cls.reason,
        in_pass: r.inPass,
        in_registry: r.inRegistry,
        legacy_path: r.legacyPath,
        hybrid_path: r.hybridPath,
        tmux_running: !!r.tmuxLine,
        discord_ok: r.discordOK,
        discord_status: r.discordStatus,
        discord_username: r.discordUsername,
      };
    });
    log(JSON.stringify(out, null, 2));
  },
};
