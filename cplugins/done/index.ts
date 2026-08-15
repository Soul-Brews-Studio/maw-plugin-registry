import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { cmdDone, cmdDoneAll } from "./impl";

export const command = {
  name: ["done", "finish"],
  description: "Clean up a finished worktree window: rrr, git save, kill, remove worktree.",
};

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...a: any[]) => {
    if (ctx.writer) ctx.writer(...a);
    else logs.push(a.map(String).join(" "));
  };
  console.error = (...a: any[]) => {
    if (ctx.writer) ctx.writer(...a);
    else logs.push(a.map(String).join(" "));
  };
  try {
    let force: boolean | undefined;
    let dryRun: boolean | undefined;
    let all: boolean | undefined;

    if (ctx.source === "cli") {
      const args = ctx.args as string[];
      force = args.includes("--force");
      dryRun = args.includes("--dry-run");
      all = args.includes("--all");

      if (all) {
        await cmdDoneAll({ force, dryRun });
        return { ok: true, output: logs.join("\n") || undefined };
      }

      const positional = args.filter(a => !a.startsWith("--"));
      if (!positional[0]) {
        return { ok: false, error: "usage: maw done <window-name> [--force] [--dry-run]\n       maw done --all [--force] [--dry-run]" };
      }
      await cmdDone(positional[0], { force, dryRun });
    } else {
      const args = ctx.args as Record<string, unknown>;
      force = args.force as boolean | undefined;
      dryRun = args.dryRun as boolean | undefined;
      all = args.all as boolean | undefined;

      if (all) {
        await cmdDoneAll({ force, dryRun });
        return { ok: true, output: logs.join("\n") || undefined };
      }

      if (!args.name) {
        return { ok: false, error: "name is required (or pass all: true)" };
      }
      await cmdDone(args.name as string, { force, dryRun });
    }

    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return { ok: false, error: logs.join("\n") || e.message, output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}
