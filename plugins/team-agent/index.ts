/**
 * team-agent — manual team-agent spawn (no Claude tools required).
 *
 * Shell-driven TeamCreate teammate lifecycle:
 *   create  — write ~/.claude/teams/<name>/config.json
 *   spawn   — maw tile --path --cmd with the 7 canonical claude.exe team flags
 *   ls      — list teams + members + inbox counts
 *   msg     — write JSON envelope to inboxes/<role>.json (mimics SendMessage)
 *   shutdown — write {type:"shutdown_request"} envelope
 *   kill    — tmux kill-pane on the teammate's pane (from config.json tmuxPaneId)
 *   delete  — remove team dir (requires --confirm)
 *   help    — show usage
 *
 * No maw-js imports (standalone-friendly plugin, like maw-cell-plugin/packages/50-bud).
 * Just bun + tmux + maw tile (via shell).
 */

// Local types — no maw-js dep
type InvokeContext = {
  source: "cli" | string;
  args: string[];
  flags?: Record<string, unknown>;
  writer?: (...a: any[]) => void;
};
type InvokeResult = { ok: boolean; output?: string; error?: string };

import { cmdCreate, cmdSpawn, cmdLs, cmdMsg, cmdShutdown, cmdKill, cmdDelete, cmdHelp, cmdUuid, cmdCleanup, cmdFrom, cmdInit, cmdQuick, cmdBring, cmdWizard, cmdTutorial } from "./impl";

export const command = {
  name: "team-agent",
  description: "Manual team-agent spawn — shell-driven TeamCreate teammates without Claude tools.",
};

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...a: any[]) => { if (ctx.writer) ctx.writer(...a); else logs.push(a.map(String).join(" ")); };
  console.error = (...a: any[]) => { if (ctx.writer) ctx.writer(...a); else logs.push(a.map(String).join(" ")); };

  try {
    // maw loader sends raw argv in ctx.args but never populates ctx.flags (#1885).
    // Parse flags from args ourselves so `maw team-agent --bare` works.
    const rawArgs = ctx.source === "cli" ? (ctx.args as string[]) : [];
    const flags: Record<string, unknown> = { ...(ctx.flags ?? {}) };
    const positional: string[] = [];
    for (let i = 0; i < rawArgs.length; i++) {
      const a = rawArgs[i];
      if (a?.startsWith("--")) {
        // Honor known boolean flags so they don't greedily consume the next arg.
        const BOOLS = new Set(["--all", "--confirm", "--apply", "--force", "--here", "--yes", "-y", "--no-attach", "--list", "--split", "--switch", "--bare", "--quiet", "--human", "--decimal", "--dry-run", "--json", "--with-session-id"]);
        const next = rawArgs[i + 1];
        if (!BOOLS.has(a) && next && !next.startsWith("--")) { flags[a] = next; i++; }
        else { flags[a] = true; }
      } else {
        positional.push(a!);
      }
    }
    const args = positional;
    const sub = args[0];
    const rest = args.slice(1);

    if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
      cmdHelp();
      return { ok: true, output: logs.join("\n") };
    }

    switch (sub) {
      case "create":
        await cmdCreate(rest, flags);
        break;
      case "spawn":
        await cmdSpawn(rest, flags);
        break;
      case "ls":
      case "list":
        await cmdLs(rest, flags);
        break;
      case "msg":
      case "message":
      case "send":
        await cmdMsg(rest, flags);
        break;
      case "shutdown":
        await cmdShutdown(rest, flags);
        break;
      case "kill":
        await cmdKill(rest, flags);
        break;
      case "delete":
      case "rm":
        await cmdDelete(rest, flags);
        break;
      case "uuid":
      case "gen":
      case "generate":
        await cmdUuid(rest, flags);
        break;
      case "from":
      case "charter":
      case "yaml":
        await cmdFrom(rest, flags);
        break;
      case "init":
      case "scaffold":
      case "template":
        await cmdInit(rest, flags);
        break;
      case "start":
      case "go":
      case "run":
      case "quick":
      case "fast":
      case "now":
        await cmdQuick(rest, flags);
        break;
      case "bring":
      case "attach":
      case "join":
        await cmdBring(rest, flags);
        break;
      case "wizard":
      case "setup":
      case "guide":
        await cmdWizard(rest, flags);
        break;
      case "tutorial":
      case "lesson":
      case "step":
        await cmdTutorial(rest, flags);
        break;
      case "cleanup":
      case "nuke":
      case "reset":
        await cmdCleanup(rest, flags);
        break;
      default:
        throw new Error(`unknown subcommand: ${sub} — run 'maw team-agent help' for usage`);
    }
    return { ok: true, output: logs.join("\n") };
  } catch (e: any) {
    return { ok: false, error: e.message ?? String(e), output: logs.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}

// Allow direct invocation: `bun ~/.maw/plugins/team-agent/index.ts <subcommand> ...`
if (import.meta.main) {
  // Capture the ORIGINAL console.log BEFORE the handler can override it.
  const realLog = console.log.bind(console);
  const realErr = console.error.bind(console);
  const args = process.argv.slice(2);
  const flags: Record<string, unknown> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a?.startsWith("--")) {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) { flags[a] = next; i++; }
      else { flags[a] = true; }
    } else {
      positional.push(a!);
    }
  }
  const result = await handler({ source: "cli", args: positional, flags, writer: (...a) => realLog(...a) });
  if (!result.ok) {
    realErr(`\x1b[31merror:\x1b[0m ${result.error}`);
    process.exit(1);
  }
}
