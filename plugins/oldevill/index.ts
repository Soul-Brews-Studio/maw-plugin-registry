import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import * as impl from "./internal/impl";

export const command = {
  name: ["oldevill", "odv"],
  description: "Oldevill Oracle — identity, philosophy, status, voice.",
};

const SUBS = ["whoami", "philosophy", "status", "say", "chronicle", "voice"];

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const out = (line = "") => {
    if (ctx.writer) ctx.writer(line);
    else logs.push(line);
  };

  // normalize args: cli => string[], api => Record
  let argv: string[];
  if (ctx.source === "cli") {
    argv = (ctx.args as string[]) ?? [];
  } else {
    const a = (ctx.args as Record<string, unknown>) ?? {};
    argv = [String(a.sub ?? ""), ...(Array.isArray(a.rest) ? (a.rest as string[]) : [])].filter(Boolean);
  }

  const sub = (argv[0] || "whoami").toLowerCase();
  const rest = argv.slice(1).join(" ");
  const done = (): InvokeResult => ({ ok: true, output: logs.join("\n") || undefined });

  switch (sub) {
    case "whoami": impl.whoami(out); return done();
    case "philosophy":
    case "family": impl.philosophy(out); return done();
    case "status": impl.status(out); return done();
    case "say": impl.say(out, rest); return done();
    case "voice": impl.voice(out, rest); return done();
    case "chronicle": impl.chronicle(out, rest, new Date().toISOString()); return done();
    default:
      return { ok: false, error: `unknown subcommand "${sub}". use: ${SUBS.join(" | ")}` };
  }
}
