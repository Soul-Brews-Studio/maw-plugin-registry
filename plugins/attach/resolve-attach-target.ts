/**
 * Resolve a `maw attach <target>` invocation into a tiered match. (#25 + #1236)
 *
 * Tier 1 — running:   tmux session matches (incl. slot prefix / stem suffix)
 *                     → attach immediately, no prompt
 * Tier 2 — sleeping:  fleet entry matches but no live tmux session
 *                     → prompt to wake, then attach
 * Tier 3 — remote:    peer reports a live session matching this name
 *                     → SSH + tmux attach on the remote node (#1236)
 * null                — nothing matched: caller emits "available oracles" hint
 *
 * Tier 4 (remote wake — peer is reachable, session sleeping there) is
 * deferred to a follow-up per cross-node-attach-design's phasing.
 *
 * Deps are injected for testability — same shape as the sleep resolver.
 */

import {
  resolveRemoteAttachTarget,
  resolveExplicitNodeTarget,
  type AggregatedSessionLike,
  type RemoteResolveDeps,
  type RemoteMatch,
} from "./resolve-remote-target";

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
  /** Tier 3 — aggregated sessions across federation peers. */
  getAggregatedSessions?: RemoteResolveDeps["getAggregatedSessions"];
  /** Tier 3 — namedPeers for sshAlias resolution. */
  namedPeers?: RemoteResolveDeps["namedPeers"];
}

export interface RemoteAlternate {
  sessionName: string;
  node: string;
}

export type ResolveResult =
  | {
      tier: 1;
      sessionName: string;
      windowName?: string;
      ambiguousCandidates?: string[];
      /** Remote-live candidates with the same bare name — printed as a hint (#1236 §6). */
      remoteAlternates?: RemoteAlternate[];
    }
  | { tier: 2; fleetName: string; ambiguousCandidates?: string[] }
  | {
      tier: 3;
      sessionName: string;
      node: string;
      peerUrl: string;
      sshAlias: string;
      /** When multiple peers expose a same-named session. */
      ambiguousCandidates?: RemoteAlternate[];
    }
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

export interface ResolveOptions {
  /** Skip Tier 1/2 entirely — go straight to Tier 3 (peer-only) lookup. */
  remoteOnly?: boolean;
  /** Pin the search to a specific node (e.g. `--node mba` or `node:agent` syntax). */
  node?: string;
}

export async function resolveAttachTarget(
  target: string,
  deps: ResolveDeps,
  opts: ResolveOptions = {},
): Promise<ResolveResult> {
  // `node:agent` short-circuits past Tier 1/2 — operator explicitly wants
  // a remote attach. Bare name (no colon) falls through to the cascade.
  let explicitNode = opts.node;
  let bare = target;
  if (target.includes(":") && !opts.node) {
    const [nodePart, agentPart] = target.split(":", 2);
    if (nodePart && agentPart) {
      explicitNode = nodePart;
      bare = agentPart;
    }
  }

  // Explicit node OR remote-only → skip Tier 1/2 and resolve Tier 3 directly.
  if (explicitNode || opts.remoteOnly) {
    return await tier3Only(bare, explicitNode, deps);
  }

  const sessions = await deps.listSessions();

  // Tier 1 — live tmux session matches.
  const runningMatches = sessions.filter(s => nameMatches(s.name, target));
  if (runningMatches.length === 1) {
    // Prefer-local: scan peers for same-named matches and surface as
    // alternates so the operator knows the remote exists (design §6).
    const remoteAlternates = await collectRemoteAlternates(target, deps).catch(() => []);
    return {
      tier: 1,
      sessionName: runningMatches[0].name,
      remoteAlternates: remoteAlternates.length > 0 ? remoteAlternates : undefined,
    };
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

  // Tier 3 — peer-live (#1236). Only attempted when local cascade missed.
  if (deps.getAggregatedSessions && deps.namedPeers) {
    const remote = await resolveRemoteAttachTarget(target, {
      getAggregatedSessions: deps.getAggregatedSessions,
      namedPeers: deps.namedPeers,
    });
    if (remote && remote.kind === "match") {
      return tier3From(remote.match);
    }
    if (remote && remote.kind === "ambiguous") {
      return {
        tier: 3,
        sessionName: remote.candidates[0].sessionName,
        node: remote.candidates[0].node,
        peerUrl: remote.candidates[0].peerUrl,
        sshAlias: remote.candidates[0].sshAlias,
        ambiguousCandidates: remote.candidates.map(c => ({
          sessionName: c.sessionName,
          node: c.node,
        })),
      };
    }
  }

  return null;
}

async function tier3Only(
  bare: string,
  explicitNode: string | undefined,
  deps: ResolveDeps,
): Promise<ResolveResult> {
  if (!deps.getAggregatedSessions || !deps.namedPeers) return null;

  if (explicitNode) {
    const m = await resolveExplicitNodeTarget(explicitNode, bare, {
      getAggregatedSessions: deps.getAggregatedSessions,
      namedPeers: deps.namedPeers,
    });
    return m ? tier3From(m) : null;
  }

  const r = await resolveRemoteAttachTarget(bare, {
    getAggregatedSessions: deps.getAggregatedSessions,
    namedPeers: deps.namedPeers,
  });
  if (!r) return null;
  if (r.kind === "match") return tier3From(r.match);
  return {
    tier: 3,
    sessionName: r.candidates[0].sessionName,
    node: r.candidates[0].node,
    peerUrl: r.candidates[0].peerUrl,
    sshAlias: r.candidates[0].sshAlias,
    ambiguousCandidates: r.candidates.map(c => ({
      sessionName: c.sessionName,
      node: c.node,
    })),
  };
}

function tier3From(m: RemoteMatch): ResolveResult {
  return {
    tier: 3,
    sessionName: m.sessionName,
    node: m.node,
    peerUrl: m.peerUrl,
    sshAlias: m.sshAlias,
  };
}

async function collectRemoteAlternates(
  target: string,
  deps: ResolveDeps,
): Promise<RemoteAlternate[]> {
  if (!deps.getAggregatedSessions || !deps.namedPeers) return [];
  const r = await resolveRemoteAttachTarget(target, {
    getAggregatedSessions: deps.getAggregatedSessions,
    namedPeers: deps.namedPeers,
  });
  if (!r) return [];
  const candidates = r.kind === "match" ? [r.match] : r.candidates;
  return candidates.map(c => ({ sessionName: c.sessionName, node: c.node }));
}

export type { AggregatedSessionLike };
