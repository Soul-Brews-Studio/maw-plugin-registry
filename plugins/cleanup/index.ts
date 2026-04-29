import type { InvokeContext, InvokeResult } from "../../../plugin/types";
import { cmdCleanupZombies } from "./internal/team-cleanup-zombies";

export const command = {
  name: "cleanup",
  description: "Cleanup zombie agent panes.",
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
    const args = ctx.source === "cli" ? (ctx.args as string[]) : [];

    if (args.includes("--zombie-agents") || args.includes("--zombies")) {
      await cmdCleanupZombies({ yes: args.includes("--yes") || args.includes("-y") });
    } else {
      logs.push("\x1b[36mmaw cleanup\x1b[0m \u2014 Cleanup utilities\n");
      logs.push("  maw cleanup --zombie-agents [--yes]  Find and kill orphan zombie panes");
      logs.push("  maw cleanup --zombies [--yes]        Alias for --zombie-agents\n");
      logs.push("\x1b[90mWithout --yes, only lists zombies without killing them.\x1b[0m");
    }

    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return { ok: false, error: logs.join("\n") || e.message, output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}
