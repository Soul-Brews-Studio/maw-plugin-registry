/**
 * `maw attach <name>` cascade — Phase 1 (#25).
 *
 *   Tier 1 (live):     attach immediately via `maw tmux attach <session>`
 *   Tier 2 (sleeping): prompt → `maw wake <fleet-name>` → attach
 *   no match:          error + list of available oracles
 *
 * Deferred to follow-up issues: T3 (ghq clone, no fleet), T4 (remote-only on
 * GitHub), T5 (nothing exists), and the non-interactive variant beyond -y.
 */
import { listSessions } from "maw-js/sdk";
import { loadFleet } from "maw-js/commands/shared/fleet-load";
import { resolveAttachTarget, type ResolveResult } from "./resolve-attach-target";

export interface AttachOpts {
  /** Skip the human-confirmation prompt on Tier 2 (agents / scripted). */
  yes?: boolean;
  /** Show what the cascade picked + planned action, no side effects. */
  dryRun?: boolean;
}

/**
 * Read a single y/n from /dev/tty (not stdin) so a piped upstream tool can't
 * break the prompt. Defaults to N on error or any non-y answer.
 * Duplicates the helper in plugins/awaken/impl.ts — Phase 1 keeps these
 * inline; a shared helper can land in a refactor PR once two more plugins
 * grow the same pattern.
 */
function askYesNo(question: string): boolean {
  const fs = require("fs");
  let fd: number | null = null;
  try {
    fd = fs.openSync("/dev/tty", "r");
    process.stderr.write(question);
    const buf = Buffer.alloc(8);
    const bytesRead = fs.readSync(fd, buf, 0, 8, null);
    const answer = buf.toString("utf-8", 0, bytesRead).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } catch {
    return false;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
  }
}

function listAvailable(fleet: { name: string }[], sessions: { name: string }[]): string {
  const all = new Set<string>([...sessions.map(s => s.name), ...fleet.map(f => f.name)]);
  if (all.size === 0) return "(none)";
  return [...all].sort().join(", ");
}

export async function cmdAttach(name: string, opts: AttachOpts = {}): Promise<void> {
  if (!name) {
    console.error("usage: maw attach <name> [--dry-run] [-y]");
    throw new Error("name required");
  }

  const deps = { listSessions, loadFleet };
  const result: ResolveResult = await resolveAttachTarget(name, deps);

  if (!result) {
    const sessions = await listSessions();
    console.error(`\x1b[31m✗\x1b[0m no oracle named '${name}' is live or in the fleet`);
    console.error(`  available: ${listAvailable(loadFleet(), sessions)}`);
    throw new Error(`oracle '${name}' not found`);
  }

  // Ambiguous match: list candidates, stop. User picks one and re-runs with
  // the full name. (Auto-prompt for selection can land in Phase 2.)
  if (result.ambiguousCandidates && result.ambiguousCandidates.length > 1) {
    console.error(`\x1b[33m⚠\x1b[0m '${name}' is ambiguous — ${result.ambiguousCandidates.length} matches:`);
    for (const c of result.ambiguousCandidates) console.error(`    • ${c}`);
    console.error(`  use the full name: \x1b[36mmaw attach <exact-name>\x1b[0m`);
    throw new Error(`ambiguous: ${name}`);
  }

  if (result.tier === 1) {
    if (opts.dryRun) {
      console.log(`  \x1b[36m·\x1b[0m [dry-run] Tier 1 (live) — would attach to ${result.sessionName}`);
      return;
    }
    console.log(`  \x1b[32m→\x1b[0m attaching to ${result.sessionName}`);
    await spawnMaw(["tmux", "attach", result.sessionName]);
    return;
  }

  // Tier 2 — sleeping, prompt for wake.
  if (opts.dryRun) {
    console.log(`  \x1b[36m·\x1b[0m [dry-run] Tier 2 (sleeping) — would wake ${result.fleetName}, then attach`);
    return;
  }

  console.log(`  \x1b[33m○\x1b[0m '${result.fleetName}' is sleeping (fleet-registered, not running)`);
  const promptable = !opts.yes && Boolean(process.stdin.isTTY);
  if (promptable && !askYesNo(`  Wake \"${result.fleetName}\"? [y/N] `)) {
    console.log("  aborted — no changes made.");
    return;
  }

  console.log(`  \x1b[36m⚡\x1b[0m waking ${result.fleetName}...`);
  await spawnMaw(["wake", result.fleetName]);
  console.log(`  \x1b[32m→\x1b[0m attaching to ${result.fleetName}`);
  await spawnMaw(["tmux", "attach", result.fleetName]);
}

/**
 * Invoke `maw` as a subprocess so we go through the same dispatch path the
 * user would use directly. tmux attach takes over the terminal — `inherit`
 * stdio is required for that handoff to work.
 */
async function spawnMaw(args: string[]): Promise<void> {
  const proc = Bun.spawn(["maw", ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`maw ${args.join(" ")} exited ${exitCode}`);
  }
}
