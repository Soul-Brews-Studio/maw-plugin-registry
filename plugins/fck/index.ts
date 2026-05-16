import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { correct, formatCorrection, listProviders, parseFckArgs, shellSnippet } from "./impl";

export const command = {
  name: ["fck", "fuck", "please", "damnit"],
  description: "thefuck-style typo and command correction for maw CLI and shell commands.",
};

function usage(): string {
  return [
    "usage: maw fck [--command <cmd>] [--stderr <text>] [--stdout <text>] [--json] [--execute --yes]",
    "       maw fck --list",
    "       maw fck --install-shell",
    "",
    "v0.1.0 chain: maw-static rules → upstream thefuck (if installed). Spark fallback is planned but off.",
  ].join("\n");
}

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const args = ctx.source === "cli" ? (ctx.args as string[]) : [];
  try {
    if (args.includes("--help") || args.includes("-h")) return { ok: true, output: usage() };
    const opts = parseFckArgs(args);
    if (opts.list) return { ok: true, output: listProviders() };
    if (opts.installShell) return { ok: true, output: shellSnippet() };
    const result = await correct(opts);
    const output = opts.json ? JSON.stringify(result, null, 2) : formatCorrection(result);
    return { ok: result.ok && !result.error, output, error: result.ok ? result.error : result.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), output: usage() };
  }
}
