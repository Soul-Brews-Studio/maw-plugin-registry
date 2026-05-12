/**
 * Tier 3 resolver — cross-node attach via aggregated peer sessions (#1236).
 *
 * Consults `getAggregatedSessions()` (peers' tmux state) and the user's
 * `namedPeers[]` config to figure out which remote node owns a name and how
 * to SSH there. Pure logic — the deps are injected so tests can drive it
 * without touching the federation layer.
 *
 * SSH alias resolution order (design §4):
 *   1. `namedPeers[n].ssh`        — explicit override, preferred
 *   2. URL hostname stripped of scheme/port  (`http://mba.wg:9090` → `mba.wg`)
 *   3. literal node name          (last-resort fallback)
 *
 * Tier 4 (remote wake via /api/wake) is deliberately out of scope here —
 * `resolveRemoteAttachTarget` only returns matches for sessions that are
 * already LIVE on a peer. Sleeping-remote handling lands in a follow-up.
 */

import type { PeerConfig } from "maw-js/config/types";

export interface AggregatedSessionLike {
  name: string;
  windows: Array<{ name: string }>;
  /** "local" or the peer URL the session came from. */
  source?: string;
  /** Peer's logical node identity from /api/identity (when available). */
  node?: string;
}

export interface RemoteResolveDeps {
  getAggregatedSessions: (localSessions: AggregatedSessionLike[]) => Promise<AggregatedSessionLike[]>;
  namedPeers: () => PeerConfig[];
}

export interface RemoteMatch {
  sessionName: string;
  /** Logical node identity for friendly messaging. Falls back to URL host. */
  node: string;
  /** Full peer URL (the `source` tag from getAggregatedSessions). */
  peerUrl: string;
  /** SSH host/alias to hand to `attachRemoteSession`. */
  sshAlias: string;
}

/** Reuses the same loose name comparison as the local resolver. */
const stripDash = (s: string) => s.replace(/-+$/, "");
function nameMatches(name: string, target: string): boolean {
  const n = name.toLowerCase();
  const t = target.toLowerCase();
  return (
    n === t ||
    n.endsWith(`-${t}`) ||
    stripDash(n) === stripDash(t)
  );
}

/**
 * Extract a sane SSH alias for a peer URL using the design's resolution order.
 *
 * `null` means we have nothing better than "guess literally" — caller should
 * still try, but error UX will be vague. Most named peers in practice carry
 * a wireguard hostname inside the URL, which `ssh` resolves directly.
 */
export function resolveSshAlias(
  peerUrl: string,
  node: string | undefined,
  namedPeers: PeerConfig[],
): string {
  // 1. namedPeers[n].ssh override
  const named = namedPeers.find(p => p.url === peerUrl);
  if (named?.ssh && named.ssh.length > 0) return named.ssh;

  // 2. URL hostname stripped of scheme/port
  try {
    const u = new URL(peerUrl);
    if (u.hostname) return u.hostname;
  } catch {
    /* fall through */
  }

  // 3. literal node name (will fail at ssh if not in ~/.ssh/config, but we
  //    surface a helpful error message at the helper layer)
  return node ?? peerUrl;
}

/**
 * Resolve a bare name to a Tier 3 match across all peers.
 *
 * Returns:
 *   - `match` (single hit)        — caller proceeds to attach
 *   - `ambiguous` (multiple hits) — caller stops and lists candidates
 *   - `null`                       — no peer has a live session matching
 *
 * Local sessions are filtered out — local matches belong to Tier 1.
 */
export async function resolveRemoteAttachTarget(
  target: string,
  deps: RemoteResolveDeps,
): Promise<
  | { kind: "match"; match: RemoteMatch }
  | { kind: "ambiguous"; candidates: RemoteMatch[] }
  | null
> {
  const aggregated = await deps.getAggregatedSessions([]);
  const named = deps.namedPeers();

  const hits: RemoteMatch[] = [];
  for (const s of aggregated) {
    // Tier 3 is peer-only. "local" tag (or absent source) means Tier 1's job.
    if (!s.source || s.source === "local") continue;
    if (!nameMatches(s.name, target)) continue;
    const peerUrl = s.source;
    const node = s.node ?? safeHost(peerUrl) ?? peerUrl;
    hits.push({
      sessionName: s.name,
      node,
      peerUrl,
      sshAlias: resolveSshAlias(peerUrl, s.node, named),
    });
  }

  if (hits.length === 0) return null;
  if (hits.length === 1) return { kind: "match", match: hits[0] };
  return { kind: "ambiguous", candidates: hits };
}

function safeHost(url: string): string | undefined {
  try { return new URL(url).hostname || undefined; } catch { return undefined; }
}

/**
 * Explicit `node:agent` syntax — caller specifies the node, we only look up
 * the agent on THAT peer. Short-circuits past Tier 1/2 per design §6.
 *
 * The node may match either the peer's `/api/identity.node` OR the URL host
 * (so `mba:homekeeper` works whether the federation knows the node as
 * "mba" or just has `http://mba.wg:9090` configured).
 */
export async function resolveExplicitNodeTarget(
  nodePart: string,
  agentPart: string,
  deps: RemoteResolveDeps,
): Promise<RemoteMatch | null> {
  const aggregated = await deps.getAggregatedSessions([]);
  const named = deps.namedPeers();
  const want = nodePart.toLowerCase();

  for (const s of aggregated) {
    if (!s.source || s.source === "local") continue;
    if (!nameMatches(s.name, agentPart)) continue;
    const host = safeHost(s.source) ?? "";
    const nodeMatches =
      (s.node && s.node.toLowerCase() === want) ||
      host.toLowerCase() === want ||
      host.toLowerCase().startsWith(`${want}.`);
    if (!nodeMatches) continue;
    return {
      sessionName: s.name,
      node: s.node ?? host ?? nodePart,
      peerUrl: s.source,
      sshAlias: resolveSshAlias(s.source, s.node, named),
    };
  }
  return null;
}
