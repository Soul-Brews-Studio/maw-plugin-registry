import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { cmdAbsorb, formatAbsorbReport } from "./impl";

export const command = {
  name: "absorb",
  description: "Retire one oracle into another with consent and provenance.",
};

function parseArgs(args: string[]) {
  const out: Record<string, string | boolean | undefined> & { _: string[] } = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--into" || arg === "--reason" || arg === "--fleet-dir") {
      out[arg] = args[++i];
    } else if (["--dry-run", "--yes", "--consent", "--no-archive", "--no-broadcast", "--no-fleet", "--json"].includes(arg)) {
      out[arg] = true;
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function help() {
  return [
    "usage: maw absorb <donor> --into <receiver> [--dry-run] [--yes --reason <why>]",
    "",
    "Absorb retires a donor oracle into an existing receiver oracle.",
    "It copies donor ψ/ into receiver ψ/from-<donor>/, writes ABSORB.md,",
    "marks donor fleet config status=absorbed, archives donor repo, and broadcasts.",
    "",
    "Safety: non-dry-run requires --yes (or --consent) and should include --reason.",
    "Use --no-archive, --no-broadcast, or --no-fleet to skip side-effect steps.",
  ].join("\n");
}

export default async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  const args = ctx.source === "cli" ? (ctx.args as string[]) : [];
  if (ctx.source !== "cli") return { ok: false, error: "absorb currently supports CLI invocation only" };
  if (args.includes("--help") || args.includes("-h")) return { ok: true, output: help() };

  const logs: string[] = [];
  const flags = parseArgs(args);
  try {
    const donor = flags._[0];
    const receiver = flags["--into"] as string | undefined;
    const report = await cmdAbsorb({
      donor,
      receiver: receiver ?? "",
      dryRun: !!flags["--dry-run"],
      yes: !!flags["--yes"] || !!flags["--consent"],
      reason: flags["--reason"] as string | undefined,
      fleetDir: flags["--fleet-dir"] as string | undefined,
      skipArchive: !!flags["--no-archive"],
      skipBroadcast: !!flags["--no-broadcast"],
      skipFleet: !!flags["--no-fleet"],
    }, {
      log: (...line) => logs.push(line.map(String).join(" ")),
    });
    if (flags["--json"]) return { ok: true, output: JSON.stringify(report, null, 2) };
    return { ok: true, output: logs.join("\n") || formatAbsorbReport(report) };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e), output: logs.join("\n") || undefined };
  }
}
