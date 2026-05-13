/**
 * Resolve a `maw attach <target>` invocation into a tiered match.
 *
 * Phase 1 — Smart Local (#25):
 *   Tier 1 — running:  tmux session matches (incl. slot prefix / stem suffix)
 *                      → attach immediately, no prompt
 *   Tier 2 — sleeping: fleet entry matches but no live tmux session
 *                      → prompt to wake, then attach
 *   null               → nothing matched: caller emits "available oracles" hint
 *
 * Tier 3 (cross-node federation attach) lived here briefly (#1236). It was
 * pulled back out — the built-in stays local-only. Cross-node attach is now
 * the job of the `attach-ssh` plugin (registry). Operators who want it
 * install that plugin explicitly. See:
 *   ψ/memory/traces/2026-05-13/1124_maw-a-original.md
 *
 * Deps are injected for testability — same shape as the sleep resolver.
 */

export interface SessionLike {
  name: string;
  windows: Array<{ name: string }>;
}

export interface FleetLike {
  name: string;
  windows: Array<{ name: string }>;
}

export interface ResolveDeps {
  listSessions: () => Promise<SessionLike[]>;
  loadFleet: () => FleetLike[];
}

export type ResolveResult =
  | {
      tier: 1;
      sessionName: string;
      windowName?: string;
      ambiguousCandidates?: string[];
    }
  | { tier: 2; fleetName: string; ambiguousCandidates?: string[] }
  | null;

const stripDash = (s: string) => s.replace(/-+$/, "");

/**
 * Try every reasonable name comparison: exact, slot-suffix
 * (`-${target}`), and dash-trimmed stem. Matches the conventions
 * established by sleep/done resolvers.
 */
function nameMatches(name: string, target: string): boolean {
  const n = name.toLowerCase();
  const t = target.toLowerCase();
  return (
    n === t ||
    n.endsWith(`-${t}`) ||
    stripDash(n) === stripDash(t)
  );
}

export async function resolveAttachTarget(
  target: string,
  deps: ResolveDeps,
): Promise<ResolveResult> {
  const sessions = await deps.listSessions();

  // Tier 1 — live tmux session matches.
  const runningMatches = sessions.filter(s => nameMatches(s.name, target));
  if (runningMatches.length === 1) {
    return { tier: 1, sessionName: runningMatches[0].name };
  }
  if (runningMatches.length > 1) {
    return {
      tier: 1,
      sessionName: runningMatches[0].name,
      ambiguousCandidates: runningMatches.map(s => s.name),
    };
  }

  // Tier 2 — fleet-registered, sleeping.
  const fleet = deps.loadFleet();
  const fleetMatches = fleet.filter(f => nameMatches(f.name, target));
  if (fleetMatches.length === 1) {
    return { tier: 2, fleetName: fleetMatches[0].name };
  }
  if (fleetMatches.length > 1) {
    return {
      tier: 2,
      fleetName: fleetMatches[0].name,
      ambiguousCandidates: fleetMatches.map(f => f.name),
    };
  }

  return null;
}
