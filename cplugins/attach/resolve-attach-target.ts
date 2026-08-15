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
 *
 * #1342 — when `fuzzy` is true, also accept a case-insensitive substring
 * match (`n.includes(t)`). This is the second-pass mode used by
 * `cmdAttach` AFTER `maw wake <input>` has succeeded: wake fuzzy-resolved
 * the input (e.g. "wind" → "Somwind-oracle" → session "01-Somwind") but
 * doesn't surface the resolved name structurally, so the original input no
 * longer matches the freshly-created session under strict rules. Wake's
 * success implies a fuzzy match exists; loosening the comparator finds it.
 *
 * Strict mode (default) is preserved for every other caller — fuzzy is
 * opt-in and only enabled on the post-wake re-resolve callsite.
 */
function nameMatches(name: string, target: string, fuzzy: boolean = false): boolean {
  const n = name.toLowerCase();
  const t = target.toLowerCase();
  if (n === t || n.endsWith(`-${t}`) || stripDash(n) === stripDash(t)) return true;
  if (fuzzy && t.length > 0 && n.includes(t)) return true;
  return false;
}

export async function resolveAttachTarget(
  target: string,
  deps: ResolveDeps,
  opts: { fuzzy?: boolean } = {},
): Promise<ResolveResult> {
  const fuzzy = Boolean(opts.fuzzy);
  const sessions = await deps.listSessions();

  // Tier 1 — live tmux session matches.
  const runningMatches = sessions.filter(s => nameMatches(s.name, target, fuzzy));
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
  const fleetMatches = fleet.filter(f => nameMatches(f.name, target, fuzzy));
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
