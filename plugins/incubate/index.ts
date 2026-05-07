import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { cmdIncubate, resolveMode } from "./impl";
import { parseFlags } from "maw-js/cli/parse-args";

export const command = {
  name: "incubate",
  description: "Fire /incubate skill into an oracle's Claude TUI — thin router.",
};

const USAGE =
  "usage: maw incubate <source> [--oracle <name>] [--flash | --contribute | --status | --offload | --init] [--no-trigger] [--trigger <text>] [--dry-run]";

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
    if (ctx.source === "cli") {
      const args = ctx.args as string[];
      const flags = parseFlags(
        args,
        {
          "--oracle": String,
          "--trigger": String,
          "--no-trigger": Boolean,
          "--flash": Boolean,
          "--contribute": Boolean,
          "--status": Boolean,
          "--offload": Boolean,
          "--init": Boolean,
          "--dry-run": Boolean,
        },
        0,
      );

      let mode;
      try {
        mode = resolveMode(
          !!flags["--flash"],
          !!flags["--contribute"],
          !!flags["--status"],
          !!flags["--offload"],
        );
      } catch (e: any) {
        return { ok: false, error: e.message };
      }

      const source = flags._[0];
      // --status and --init don't need a source positional
      const needsSource = mode !== "status" && !flags["--init"];
      if (needsSource && !source) {
        return { ok: false, error: USAGE };
      }
      if (source && source.startsWith("-")) {
        return {
          ok: false,
          error: `"${source}" looks like a flag, not a source repo.\n  ${USAGE}`,
        };
      }

      await cmdIncubate({
        source,
        oracle: flags["--oracle"],
        mode,
        init: flags["--init"],
        trigger: flags["--trigger"],
        noTrigger: flags["--no-trigger"],
        dryRun: flags["--dry-run"],
      });
    } else if (ctx.source === "api") {
      const body = ctx.args as Record<string, unknown>;
      const source = body.source as string | undefined;
      const mode = (body.mode as string | undefined) ?? "default";
      if (!["default", "flash", "contribute", "status", "offload"].includes(mode)) {
        return { ok: false, error: `invalid mode: ${mode}` };
      }
      await cmdIncubate({
        source,
        oracle: body.oracle as string | undefined,
        mode: mode as any,
        init: body.init as boolean | undefined,
        trigger: body.trigger as string | undefined,
        noTrigger: body.noTrigger as boolean | undefined,
        dryRun: body.dryRun as boolean | undefined,
      });
    }

    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return {
      ok: false,
      error: logs.join("\n") || e.message,
      output: logs.join("\n") || undefined,
    };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}
