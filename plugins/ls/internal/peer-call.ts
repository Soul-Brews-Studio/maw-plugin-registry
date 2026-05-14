/**
 * Cross-node session listing for `maw ls <peer>` and `maw ls --all`.
 *
 * Thin wrapper over `curlFetch` (re-exported from `maw-js/sdk`) so the
 * network call can be stubbed in tests without dragging in the full
 * sdk module graph. `from: "auto"` enables federation signing when
 * peer-identity keys are configured (see ADR docs/federation/0001-peer-identity.md)
 * — do NOT hand-roll HMAC here. Endpoint is `GET /api/sessions`
 * (confirmed in maw-js/src/api/sessions.ts:61 — proposal accurate).
 *
 * Two entry points:
 *   - `lsPeer(alias, {json})` — fetch one peer's sessions
 *   - `lsAllPeers({json})`   — fan out to every alias in ~/.maw/peers.json
 *
 * Errors are returned as `{ ok: false, error }` (never thrown) so the
 * plugin handler can surface a clean CLI message without a stack trace.
 */

import type { InvokeResult } from "maw-js/plugin/types";

export interface PeerSession {
  name: string;
  windows: { name: string; index?: number; active?: boolean }[];
  source?: string;
}

export interface FetchResult {
  ok: boolean;
  status?: number;
  data?: any;
}

const DEFAULT_TIMEOUT_MS = 5000;

export async function fetchPeerSessions(peerUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<FetchResult> {
  const { curlFetch } = await import("maw-js/sdk");
  return await curlFetch(`${peerUrl}/api/sessions`, {
    method: "GET",
    from: "auto",
    timeout: timeoutMs,
  });
}

function renderPeerHeader(alias: string, url: string, count: number): string {
  return `\x1b[36m📡 ${alias}\x1b[0m \x1b[90m@ ${url}\x1b[0m · ${count} session${count === 1 ? "" : "s"}`;
}

function renderPeerSessions(sessions: PeerSession[]): string[] {
  const lines: string[] = [];
  for (const s of sessions) {
    const tag = s.source && s.source !== "local" ? ` \x1b[90mvia ${s.source}\x1b[0m` : "";
    lines.push(`  \x1b[34m●\x1b[0m \x1b[36m${s.name}\x1b[0m${tag}`);
    for (const w of s.windows || []) {
      const dot = w.active ? "\x1b[32m●\x1b[0m" : "\x1b[90m●\x1b[0m";
      const idx = typeof w.index === "number" ? `${w.index}: ` : "";
      lines.push(`     ${dot} ${idx}${w.name}`);
    }
  }
  return lines;
}

export async function lsPeer(alias: string, opts: { json?: boolean }): Promise<InvokeResult> {
  const { resolvePeer } = await import("./peer-resolve");
  const peer = resolvePeer(alias);
  if (!peer) {
    return { ok: false, error: `unknown peer alias: ${alias} (see: maw peers list)` };
  }

  let res: FetchResult;
  try {
    res = await fetchPeerSessions(peer.url);
  } catch (e: any) {
    return { ok: false, error: `peer ls failed (${alias} ${peer.url}): ${e?.message || e}` };
  }

  if (!res?.ok) {
    if (res?.status === 404) {
      return { ok: false, error: `peer ${alias} does not support /api/sessions (HTTP 404 at ${peer.url})` };
    }
    if (res?.status === 401 || res?.status === 403) {
      return { ok: false, error: `peer ${alias} rejected (HTTP ${res.status} at ${peer.url}) — check federationToken / peer-identity keys` };
    }
    const detail = res?.data?.error || (res?.status ? `HTTP ${res.status}` : "no response");
    return { ok: false, error: `peer ls failed (${alias} ${peer.url}): ${detail}` };
  }

  const sessions: PeerSession[] = Array.isArray(res.data) ? res.data : [];

  if (opts.json) {
    return { ok: true, output: JSON.stringify({ peer: alias, url: peer.url, sessions }, null, 2) };
  }

  const lines: string[] = [renderPeerHeader(alias, peer.url, sessions.length), ""];
  if (sessions.length === 0) {
    lines.push("\x1b[90m  (no sessions)\x1b[0m");
  } else {
    lines.push(...renderPeerSessions(sessions));
  }
  lines.push("", `\x1b[90m  → maw hey ${alias}:<session>:<window>   send a message\x1b[0m`);
  return { ok: true, output: lines.join("\n") };
}

export async function lsAllPeers(opts: { json?: boolean }): Promise<InvokeResult> {
  const { resolveAllPeers } = await import("./peer-resolve");
  const peers = resolveAllPeers();
  if (peers.length === 0) {
    return { ok: false, error: "no peers configured (see: maw peers add)" };
  }

  // Fan out concurrently. We catch per-peer so one offline node doesn't
  // short-circuit the whole aggregation — mirrors the proposal's
  // "graceful on peer offline" requirement (proposal §4).
  const results = await Promise.all(
    peers.map(async (p) => {
      try {
        const res = await fetchPeerSessions(p.url);
        if (!res?.ok) {
          const detail = res?.data?.error || (res?.status ? `HTTP ${res.status}` : "no response");
          return { alias: p.alias, url: p.url, error: detail } as const;
        }
        const sessions: PeerSession[] = Array.isArray(res.data) ? res.data : [];
        return { alias: p.alias, url: p.url, sessions } as const;
      } catch (e: any) {
        return { alias: p.alias, url: p.url, error: e?.message || String(e) } as const;
      }
    }),
  );

  if (opts.json) {
    return { ok: true, output: JSON.stringify({ peers: results }, null, 2) };
  }

  const total = results.reduce((n, r) => n + ("sessions" in r && r.sessions ? r.sessions.length : 0), 0);
  const lines: string[] = [
    `\x1b[36m📡 fleet view · ${peers.length} peer${peers.length === 1 ? "" : "s"} · ${total} session${total === 1 ? "" : "s"} total\x1b[0m`,
    "",
  ];
  for (const r of results) {
    if ("error" in r) {
      lines.push(`  \x1b[31m✗\x1b[0m ${r.alias} \x1b[90m(${r.url}) — ${r.error}\x1b[0m`);
      continue;
    }
    lines.push(
      `  \x1b[34m●\x1b[0m \x1b[36m${r.alias}\x1b[0m \x1b[90m(${r.url}) · ${r.sessions.length} session${r.sessions.length === 1 ? "" : "s"}\x1b[0m`,
    );
    for (const s of r.sessions) {
      const tag = s.source && s.source !== "local" ? ` \x1b[90mvia ${s.source}\x1b[0m` : "";
      lines.push(`     \x1b[90m●\x1b[0m ${s.name}${tag}`);
    }
  }
  lines.push("", "\x1b[90m  → maw ls <peer>   drill into one\x1b[0m");
  return { ok: true, output: lines.join("\n") };
}
