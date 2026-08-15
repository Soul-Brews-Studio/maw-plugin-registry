import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { execute } from "./lib/execute";

export const command = {
  name: "osmosis",
  description:
    "Bidirectional rsync between trusted fleet hosts (m5 ↔ remote). Dry-run by default; --apply to commit.",
};

function argsFromContext(ctx: InvokeContext): string[] {
  return ctx.source === "cli" && Array.isArray(ctx.args) ? (ctx.args as string[]) : [];
}

async function captureOutput(args: string[]): Promise<InvokeResult> {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  try {
    console.log = (...v: unknown[]) => lines.push(v.map(String).join(" "));
    console.error = (...v: unknown[]) => lines.push(v.map(String).join(" "));
    await execute(args);
    const output = lines.join("\n");
    return output ? { ok: true, output } : { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const output = lines.join("\n");
    return { ok: false, error: message, ...(output ? { output } : {}) };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  execute(argv, { exitOnMissing: true }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

export default async function handler(
  ctxOrArgs: InvokeContext | string[],
): Promise<InvokeResult | void> {
  if (Array.isArray(ctxOrArgs)) {
    return execute(ctxOrArgs, { exitOnMissing: true });
  }
  return captureOutput(argsFromContext(ctxOrArgs));
}

// Re-exports for tests / external SDK users
export { parseArgs, deriveFromPwd } from "./lib/config";
export { SAFE_EXCLUDES, buildRsyncArgs } from "./lib/rsync";
