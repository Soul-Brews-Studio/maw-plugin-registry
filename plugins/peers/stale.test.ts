/**
 * maw peers — TTL stale-peer detection tests (#1238).
 *
 * Covers:
 *   - `isStale()` truth table across (lastSeen, addedAt) × (fresh, old, null).
 *   - `getStaleTtlMs()` default + env override.
 *   - `staleAgeMs()` picks lastSeen over addedAt, handles unparseable.
 *   - `cmdList()` populates stale + staleAgeMs on every row.
 *   - `formatList()` appends the dim "(stale, last seen Nd ago)" suffix
 *     to stale rows and leaves fresh rows untouched.
 *
 * Each test uses a tmp PEERS_FILE so they're hermetic & parallel-safe.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Hand-write peers.json so tests don't depend on `cmdAdd`'s network probe. */
function writePeers(peers: Record<string, any>) {
  writeFileSync(process.env.PEERS_FILE!, JSON.stringify({ version: 1, peers }, null, 2));
}
function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maw-peers-stale-"));
  process.env.PEERS_FILE = join(dir, "peers.json");
  delete process.env.MAW_PEER_STALE_TTL_MS;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PEERS_FILE;
  delete process.env.MAW_PEER_STALE_TTL_MS;
});

describe("isStale truth table", () => {
  it("fresh lastSeen → not stale", async () => {
    const { isStale, DEFAULT_STALE_TTL_MS } = await import("./store");
    const now = Date.now();
    const peer = {
      url: "http://x",
      node: "x",
      addedAt: new Date(now - 30 * DAY_MS).toISOString(),
      lastSeen: new Date(now - 1 * DAY_MS).toISOString(),
    };
    expect(isStale(peer, DEFAULT_STALE_TTL_MS, now)).toBe(false);
  });

  it("old lastSeen (>TTL) → stale", async () => {
    const { isStale, DEFAULT_STALE_TTL_MS } = await import("./store");
    const now = Date.now();
    const peer = {
      url: "http://x",
      node: "x",
      addedAt: new Date(now - 30 * DAY_MS).toISOString(),
      lastSeen: new Date(now - 8 * DAY_MS).toISOString(),
    };
    expect(isStale(peer, DEFAULT_STALE_TTL_MS, now)).toBe(true);
  });

  it("null lastSeen + fresh addedAt → not stale (grace period via addedAt)", async () => {
    const { isStale, DEFAULT_STALE_TTL_MS } = await import("./store");
    const now = Date.now();
    const peer = {
      url: "http://x",
      node: "x",
      addedAt: new Date(now - 1 * DAY_MS).toISOString(),
      lastSeen: null,
    };
    expect(isStale(peer, DEFAULT_STALE_TTL_MS, now)).toBe(false);
  });

  it("null lastSeen + old addedAt → stale", async () => {
    const { isStale, DEFAULT_STALE_TTL_MS } = await import("./store");
    const now = Date.now();
    const peer = {
      url: "http://x",
      node: "x",
      addedAt: new Date(now - 30 * DAY_MS).toISOString(),
      lastSeen: null,
    };
    expect(isStale(peer, DEFAULT_STALE_TTL_MS, now)).toBe(true);
  });

  it("unparseable timestamps → stale (defensive)", async () => {
    const { isStale, DEFAULT_STALE_TTL_MS } = await import("./store");
    const peer = {
      url: "http://x",
      node: "x",
      addedAt: "not-a-date",
      lastSeen: null,
    };
    expect(isStale(peer, DEFAULT_STALE_TTL_MS)).toBe(true);
  });

  it("exactly at TTL boundary → not stale (uses strict >)", async () => {
    const { isStale } = await import("./store");
    const now = Date.now();
    const ttl = 1000;
    const peer = {
      url: "http://x",
      node: "x",
      addedAt: new Date(now - ttl).toISOString(),
      lastSeen: new Date(now - ttl).toISOString(),
    };
    expect(isStale(peer, ttl, now)).toBe(false);
  });
});

describe("getStaleTtlMs", () => {
  it("default = 7 days when env unset", async () => {
    const { getStaleTtlMs, DEFAULT_STALE_TTL_MS } = await import("./store");
    expect(getStaleTtlMs()).toBe(DEFAULT_STALE_TTL_MS);
    expect(DEFAULT_STALE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("MAW_PEER_STALE_TTL_MS env override (positive integer)", async () => {
    process.env.MAW_PEER_STALE_TTL_MS = "12345";
    const { getStaleTtlMs } = await import("./store");
    expect(getStaleTtlMs()).toBe(12345);
  });

  it("MAW_PEER_STALE_TTL_MS bad value (NaN) → falls back to default", async () => {
    process.env.MAW_PEER_STALE_TTL_MS = "garbage";
    const { getStaleTtlMs, DEFAULT_STALE_TTL_MS } = await import("./store");
    expect(getStaleTtlMs()).toBe(DEFAULT_STALE_TTL_MS);
  });

  it("MAW_PEER_STALE_TTL_MS negative → falls back to default", async () => {
    process.env.MAW_PEER_STALE_TTL_MS = "-100";
    const { getStaleTtlMs, DEFAULT_STALE_TTL_MS } = await import("./store");
    expect(getStaleTtlMs()).toBe(DEFAULT_STALE_TTL_MS);
  });
});

describe("staleAgeMs", () => {
  it("prefers lastSeen over addedAt when both set", async () => {
    const { staleAgeMs } = await import("./store");
    const now = Date.now();
    const peer = {
      url: "http://x",
      node: "x",
      addedAt: new Date(now - 30 * DAY_MS).toISOString(),
      lastSeen: new Date(now - 2 * DAY_MS).toISOString(),
    };
    const age = staleAgeMs(peer, now);
    expect(age).not.toBeNull();
    // ~2 days, within a few ms tolerance
    expect(Math.abs(age! - 2 * DAY_MS)).toBeLessThan(1000);
  });

  it("falls back to addedAt when lastSeen null", async () => {
    const { staleAgeMs } = await import("./store");
    const now = Date.now();
    const peer = {
      url: "http://x",
      node: "x",
      addedAt: new Date(now - 5 * DAY_MS).toISOString(),
      lastSeen: null,
    };
    const age = staleAgeMs(peer, now);
    expect(Math.abs(age! - 5 * DAY_MS)).toBeLessThan(1000);
  });

  it("returns null when timestamps unparseable", async () => {
    const { staleAgeMs } = await import("./store");
    const peer = { url: "http://x", node: "x", addedAt: "junk", lastSeen: null };
    expect(staleAgeMs(peer)).toBeNull();
  });
});

describe("cmdList stale wiring", () => {
  it("populates stale + staleAgeMs on every row", async () => {
    writePeers({
      fresh: { url: "http://a", node: "a", addedAt: isoAgo(DAY_MS), lastSeen: isoAgo(DAY_MS) },
    });
    const { cmdList } = await import("./impl");
    const rows = cmdList();
    expect(rows).toHaveLength(1);
    expect(typeof rows[0].stale).toBe("boolean");
    expect(rows[0].stale).toBe(false);
    expect(rows[0].staleAgeMs).not.toBeNull();
  });

  it("flags peers older than the configured TTL as stale", async () => {
    writePeers({
      old: { url: "http://a", node: "a", addedAt: isoAgo(30 * DAY_MS), lastSeen: isoAgo(30 * DAY_MS) },
    });
    const { cmdList } = await import("./impl");
    const rows = cmdList();
    expect(rows[0].stale).toBe(true);
  });
});

describe("formatList stale annotation", () => {
  it("appends dim '(stale, last seen Nd ago)' to stale rows", async () => {
    const { formatList } = await import("./impl");
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 10 * DAY_MS).toISOString();
    const out = formatList([
      { alias: "fresh", url: "http://a", node: "a", addedAt: now, lastSeen: now, stale: false, staleAgeMs: 0 },
      { alias: "old", url: "http://b", node: "b", addedAt: old, lastSeen: old, stale: true, staleAgeMs: 10 * DAY_MS },
    ]);
    expect(out).toContain("(stale, last seen 10d ago)");
    // Dim ANSI escape present on the stale annotation.
    expect(out).toMatch(/\x1b\[2m\(stale,/);
    // Fresh row has no stale suffix.
    const freshLine = out.split("\n").find(l => l.startsWith("fresh "));
    expect(freshLine).toBeDefined();
    expect(freshLine!).not.toContain("(stale");
  });

  it("never-seen peer renders '(stale, never seen)'", async () => {
    const { formatList } = await import("./impl");
    const oldAdded = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const out = formatList([
      { alias: "z", url: "http://z", node: "z", addedAt: oldAdded, lastSeen: null, stale: true, staleAgeMs: null },
    ]);
    expect(out).toContain("(stale, never seen)");
  });

  it("rows without stale metadata render unchanged (back-compat)", async () => {
    const { formatList } = await import("./impl");
    const now = new Date().toISOString();
    const out = formatList([
      { alias: "x", url: "http://x", node: "x", addedAt: now, lastSeen: now },
    ]);
    expect(out).not.toContain("(stale");
  });
});

describe("dispatcher ls shows stale annotation", () => {
  it("maw peers ls flags an aged-out peer", async () => {
    writePeers({
      ancient: { url: "http://a.local", node: "a", addedAt: isoAgo(30 * DAY_MS), lastSeen: isoAgo(30 * DAY_MS) },
    });
    const { default: handler } = await import("./index");
    const ls = await handler({ source: "cli", args: ["ls"] });
    expect(ls.ok).toBe(true);
    expect(ls.output).toContain("ancient");
    expect(ls.output).toContain("(stale,");
  });
});
