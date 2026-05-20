import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { cmdBuddy } from "./impl";

export const command = {
  name: "buddy",
  description: "Spawn a cross-engine buddy pair on a shared worktree.",
};

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const logs: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...a: any[]) => { if (ctx.writer) ctx.writer(...a); else logs.push(a.map(String).join(" ")); };
  console.error = (...a: any[]) => { if (ctx.writer) ctx.writer(...a); else logs.push(a.map(String).join(" ")); };
  try {
    const args = ctx.source === "cli" ? (ctx.args as string[]) : [];
    if (!args[0] || !args[1]) {
      throw new Error("usage: maw buddy <oracle> <task> [--engine-a X --engine-b Y]");
    }
    const oracle = args[0];
    const task = args[1];
    const flags = (ctx.flags ?? {}) as Record<string, unknown>;
    await cmdBuddy(oracle, {
      task,
      engineA: flags["--engine-a"] as string | undefined,
      engineB: flags["--engine-b"] as string | undefined,
      roleA: flags["--role-a"] as string | undefined,
      roleB: flags["--role-b"] as string | undefined,
      worktreeName: flags["--wt"] as string | undefined,
      noPrime: flags["--no-prime"] === true,
      dryRun: flags["--dry-run"] === true,
    });
    return { ok: true, output: logs.join("\n") };
  } catch (e: any) {
    return { ok: false, error: e.message ?? String(e) };
  } finally {
    console.log = origLog;
    console.error = origError;
  }
}
