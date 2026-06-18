import type { InvokeContext, InvokeResult } from "maw-js/sdk";
import { runReindex } from "./internal/run";
import { setupGpu } from "./internal/setup";
import { showHelp, status } from "./internal/status";
import { tunnel } from "./internal/tunnel";
import { parseApiArgs, parseCliArgs } from "./internal/args";

export const command = {
  name: ["reindex-gpu", "rgpu"],
  description: "Thin GPU orchestration for arra bge-m3 reindexing.",
};

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  const writer = (ctx as any).writer as ((...args: unknown[]) => void) | undefined;
  const streamed = Boolean(writer);

  console.log = (...a: any[]) => {
    if (writer) writer(...a);
    else logs.push(a.map(String).join(" "));
  };
  console.error = (...a: any[]) => {
    if (writer) writer(...a);
    else logs.push(a.map(String).join(" "));
  };

  try {
    const request = ctx.source === "cli"
      ? parseCliArgs(ctx.args as string[])
      : parseApiArgs(ctx.args as Record<string, unknown>);

    if (request.help) {
      showHelp();
      return { ok: true, output: logs.join("\n") || undefined };
    }

    if (request.command === "run") {
      const result = await runReindex(request.options);
      return {
        ok: result.ok,
        output: logs.join("\n") || undefined,
        error: result.ok || streamed ? undefined : result.error,
      };
    }

    if (request.command === "status") {
      const result = await status(request.options);
      return {
        ok: result.ok,
        output: logs.join("\n") || undefined,
        error: result.ok || streamed ? undefined : result.error,
      };
    }

    if (request.command === "tunnel") {
      const result = await tunnel(request.tunnelAction, request.options);
      return {
        ok: result.ok,
        output: logs.join("\n") || undefined,
        error: result.ok || streamed ? undefined : result.error,
      };
    }

    if (request.command === "setup") {
      const result = await setupGpu(request.options);
      return {
        ok: result.ok,
        output: logs.join("\n") || undefined,
        error: result.ok || streamed ? undefined : result.error,
      };
    }

    showHelp();
    return { ok: false, output: logs.join("\n") || undefined, error: streamed ? undefined : `unknown command: ${request.command}` };
  } catch (e: any) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: streamed ? undefined : message, output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}
