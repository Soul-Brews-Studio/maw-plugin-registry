/**
 * `maw attach <name>` cascade — Phase 1 (#25) — Smart Local.
 *
 *   Tier 1 (live):     attach immediately via `maw tmux attach <session>`
 *   Tier 2 (sleeping): prompt → `maw wake <fleet-name>` → attach
 *   no match:          error + list of available oracles
 *
 * Cross-node attach (Tier 3) used to live here. It was pulled back out —
 * the built-in stays local-only. Federation lives in the `attach-ssh`
 * plugin (registry). Install it if you want cross-node attach.
 */
import { listSessions } from "maw-js/sdk";
import { loadFleet } from "maw-js/commands/shared/fleet-load";
import {
  resolveAttachTarget,
  type ResolveResult,
} from "./resolve-attach-target";

export interface AttachOpts {
  /** Skip the human-confirmation prompt on Tier 2 (agents / scripted). */
  yes?: boolean;
  /** Show what the cascade picked + planned action, no side effects. */
  dryRun?: boolean;
}

/**
 * Read a single y/n from /dev/tty (not stdin) so a piped upstream tool can't
 * break the prompt. Defaults to N on error or any non-y answer.
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
    console.error("usage: maw attach <name> [--dry-run] [-y|--yes]");
    throw new Error("name required");
  }

  const deps = { listSessions, loadFleet };
  const result: ResolveResult = await resolveAttachTarget(name, deps);

  if (!result) {
    // Local Tier 1+2 missed. Delegate to wake — it runs the full chain:
    // ghqFind → fleet pin → worktree → ghq get -u clone → GitHub org scan →
    // scanSuggestOracle interactive "Scan now? [y/N]" → wake.
    // After wake, re-resolve — should now be Tier 1 → attach.
    // See ψ/memory/traces/2026-05-13/1203_attach-find-or-scan-flow.md
    if (opts.dryRun) {
      console.log(`  \x1b[36m·\x1b[0m [dry-run] '${name}' not local — would: maw wake ${name} → re-resolve → attach`);
      return;
    }
    console.log(`  \x1b[36m·\x1b[0m '${name}' not local — delegating to wake`);
    await spawnMaw(["wake", name]);
    // Wake created the session. Re-resolve — should hit Tier 1 now.
    //
    // #1342 — wake fuzzy-resolves the original input (e.g. "wind" →
    // "Somwind-oracle", session "01-Somwind") but doesn't surface the
    // resolved name structurally to this caller. A strict re-resolve using
    // the original input therefore misses the session wake just created.
    // Pass `fuzzy: true` so the second pass uses a case-insensitive
    // substring comparator that matches wake's intent. Wake's success
    // implies a fuzzy match exists; if not, the same `still not running
    // after wake` error fires as before.
    const retried = await resolveAttachTarget(name, deps, { fuzzy: true });
    if (retried && retried.tier === 1) {
      console.log(`  \x1b[32m→\x1b[0m attaching to ${retried.sessionName}`);
      await spawnMaw(["tmux", "attach", retried.sessionName]);
      return;
    }
    console.error(`\x1b[31m✗\x1b[0m '${name}' still not running after wake`);
    throw new Error(`wake did not create a session for '${name}'`);
  }

  // Ambiguous match: list candidates, stop. User picks one and re-runs.
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

  if (result.tier === 2) {
    if (opts.dryRun) {
      console.log(`  \x1b[36m·\x1b[0m [dry-run] Tier 2 (sleeping) — would wake ${result.fleetName}, then attach`);
      return;
    }

    console.log(`  \x1b[33m○\x1b[0m '${result.fleetName}' is sleeping (fleet-registered, not running)`);
    const promptable = !opts.yes && Boolean(process.stdin.isTTY);
    if (promptable && !askYesNo(`  Wake "${result.fleetName}"? [y/N] `)) {
      console.log("  aborted — no changes made.");
      return;
    }

    console.log(`  \x1b[36m⚡\x1b[0m waking ${result.fleetName}...`);
    await spawnMaw(["wake", result.fleetName]);
    console.log(`  \x1b[32m→\x1b[0m attaching to ${result.fleetName}`);
    await spawnMaw(["tmux", "attach", result.fleetName]);
    return;
  }
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
