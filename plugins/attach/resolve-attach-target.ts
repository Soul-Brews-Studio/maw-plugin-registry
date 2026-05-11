/**
 * Resolve a `maw attach <target>` invocation into a tiered match. (#25 Phase 1)
 *
 * Tier 1 — running:  tmux session matches (incl. slot prefix / stem suffix)
 *                    → attach immediately, no prompt
 * Tier 2 — sleeping: fleet entry matches but no live tmux session
 *                    → prompt to wake, then attach
 * null          — nothing matched: caller emits "available oracles" hint
 *
 * Phase 1 deliberately omits T3 (ghq clone without fleet), T4 (remote-only on
 * GitHub), and T5 (nothing exists). Those land in follow-up issues.
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
  | { tier: 1; sessionName: string; windowName?: string; ambiguousCandidates?: string[] }
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
    // Ambiguity in live sessions — surface every match for the caller's prompt.
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
