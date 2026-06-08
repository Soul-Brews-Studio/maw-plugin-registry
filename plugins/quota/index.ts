import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { parseFlags } from "maw-js/cli/parse-args";
import { fetchQuota } from "./lib/tracker";
import { formatQuota, formatJson } from "./lib/format";

export const command = {
  name: "quota",
  description: "Claude Code subscription quota — utilization and time-to-reset from Anthropic API.",
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
    const isCliSource = ctx.source === "cli";
    const args = isCliSource ? ctx.args as string[] : [];
    const body = isCliSource ? {} : (ctx.args as Record<string, unknown>);

    const flags = isCliSource
      ? parseFlags(args, { "--json": Boolean, "--check": Boolean, "--warn": Number, "--critical": Number, "-j": "--json", "-c": "--check" }, 0)
      : {};

    const warn = Number(flags["--warn"] ?? body.warn ?? 80);
    const critical = Number(flags["--critical"] ?? body.critical ?? 95);
    const wantJson = !!(flags["--json"] ?? body.json);
    const wantCheck = !!(flags["--check"] ?? body.check);

    const data = await fetchQuota(warn, critical);

    if (wantCheck) {
      const code = data.status === "exhausted" ? 2 : data.status === "low" ? 1 : 0;
      console.log(data.status);
      return { ok: code === 0, exitCode: code, output: logs.join("\n") || undefined };
    }

    if (wantJson || !isCliSource) {
      console.log(JSON.stringify(formatJson(data), null, 2));
    } else {
      console.log(formatQuota(data));
    }

    return { ok: true, output: logs.join("\n") || undefined };
  } catch (e: any) {
    return { ok: false, error: e.message ?? String(e), output: logs.join("\n") || undefined };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}
