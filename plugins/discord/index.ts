import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { cmdTokens } from "./tokens";
import { cmdStatus } from "./status";

export const command = {
  name: "discord",
  description: "Discord fleet ops — tokens, status, (bind/pair/route/serve coming).",
};

function printUsage(log: (s: string) => void): void {
  log("usage: maw discord <subcommand> [args]");
  log("");
  log("subcommands (v0.2):");
  log("  tokens ls                          list all Discord bot tokens in pass (no reveal)");
  log("  tokens check [bot]                 verify each token decrypts + Discord REST 200");
  log("  status [bot] [--check] [--redact] [--json]");
  log("                                     fleet inspection from this host — pass × legacy × hybrid × tmux × registry");
  log("");
  log("subcommands (v0.3 planned):");
  log("  bind <bot>                         end-to-end onboard (ghq get + direnv + maw wake)");
  log("  pair <oracle> <channel>            access.json + channel-map.json bootstrap");
  log("  route <from> <to>                  channel-map.json entry");
  log("  serve [--detach] [--port N]        discord daemon — heartbeat, presence, webhook receive");
  log("");
  log("token strategy: HYBRID — tokens in pass (central), .discord/ config in bot repo.");
  log("see: ψ/outbox/ideas/2026-05-17_self-contained-bot-repo-gpg-pattern.md");
}

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const log = (s: string) => {
    if (ctx.writer) ctx.writer(s);
    else logs.push(s);
  };

  try {
    const args = ctx.source === "cli" ? (ctx.args as string[]) : [];
    const sub = args[0]?.toLowerCase();

    if (!sub || sub === "help" || sub === "-h" || sub === "--help") {
      printUsage(log);
      return { ok: true, output: logs.join("\n") };
    }

    if (sub === "tokens") {
      const action = args[1]?.toLowerCase();
      if (!action || action === "ls") {
        await cmdTokens.ls(log);
      } else if (action === "check") {
        await cmdTokens.check(log, args[2]);
      } else {
        log(`unknown subcommand: tokens ${action}`);
        log("usage: maw discord tokens <ls|check> [bot]");
        return { ok: false, error: `unknown action: ${action}`, output: logs.join("\n") };
      }
      return { ok: true, output: logs.join("\n") };
    }

    if (sub === "status") {
      await cmdStatus.run(log, args.slice(1));
      return { ok: true, output: logs.join("\n") };
    }

    if (sub === "bind" || sub === "pair" || sub === "route" || sub === "serve") {
      log(`✗ '${sub}' not implemented yet (v0.2 ships with 'tokens' + 'status' only).`);
      log("planned for v0.3 — see 'maw discord' for full subcommand list.");
      return { ok: false, error: `${sub} not implemented`, output: logs.join("\n") };
    }

    log(`unknown subcommand: ${sub}`);
    printUsage(log);
    return { ok: false, error: `unknown subcommand: ${sub}`, output: logs.join("\n") };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e), output: logs.join("\n") };
  }
}
