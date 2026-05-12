/**
 * doctor/internal/stale-peers.test.ts — #1238.
 *
 * Black-box tests for the stale-peer doctor surface:
 *
 *   - `findStalePeers()` — pure enumeration over `~/.maw/peers.json`.
 *   - `checkStalePeers()` — `maw doctor` check entry: ok:true when
 *     none, ok:false with operator-pointer message otherwise.
 *   - `cmdFixStalePeers()` — destructive sweep. We drive it under
 *     `MAW_TEST_MODE=1` to skip the 3s abort countdown and assert
 *     the on-disk state mutates correctly.
 *   - Integration via `cmdDoctor(['--fix-stale'])` so the full
 *     index.ts → impl.ts → stale-peers.ts wire-up is exercised.
 *
 * Tests use a tmp PEERS_FILE for hermeticity; MAW_TEST_MODE is set
 * once per test to keep the countdown out of the test loop.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const DAY_MS = 24 * 60 * 60 * 1000;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maw-doctor-stale-"));
  process.env.PEERS_FILE = join(dir, "peers.json");
  process.env.MAW_TEST_MODE = "1";
  delete process.env.MAW_PEER_STALE_TTL_MS;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PEERS_FILE;
  delete process.env.MAW_TEST_MODE;
  delete process.env.MAW_PEER_STALE_TTL_MS;
});

/** Hand-write peers.json so we can backdate timestamps without waiting. */
function writePeers(peers: Record<string, any>) {
  const path = process.env.PEERS_FILE!;
  writeFileSync(path, JSON.stringify({ version: 1, peers }, null, 2));
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

describe("findStalePeers", () => {
  it("empty store → []", async () => {
    const { findStalePeers } = await import("./stale-peers");
    expect(findStalePeers()).toEqual([]);
  });

  it("returns only peers older than the TTL, sorted by alias", async () => {
    writePeers({
      fresh: { url: "http://fresh.local", node: "f", addedAt: isoAgo(DAY_MS), lastSeen: isoAgo(DAY_MS) },
      zebra: { url: "http://z.local", node: "z", addedAt: isoAgo(10 * DAY_MS), lastSeen: isoAgo(10 * DAY_MS) },
      ancient: { url: "http://a.local", node: "a", addedAt: isoAgo(60 * DAY_MS), lastSeen: isoAgo(60 * DAY_MS) },
    });
    const { findStalePeers } = await import("./stale-peers");
    const stale = findStalePeers();
    expect(stale.map(s => s.alias)).toEqual(["ancient", "zebra"]);
  });

  it("treats null lastSeen + old addedAt as stale", async () => {
    writePeers({
      never: { url: "http://n.local", node: "n", addedAt: isoAgo(30 * DAY_MS), lastSeen: null },
    });
    const { findStalePeers } = await import("./stale-peers");
    expect(findStalePeers().map(s => s.alias)).toEqual(["never"]);
  });
});

describe("checkStalePeers", () => {
  it("no peers → ok:true 'no stale peers'", async () => {
    const { checkStalePeers } = await import("./stale-peers");
    const r = checkStalePeers();
    expect(r.ok).toBe(true);
    expect(r.name).toBe("peers:stale");
    expect(r.message).toBe("no stale peers");
  });

  it("stale peers present → ok:false with count + pointer", async () => {
    writePeers({
      a: { url: "http://a", node: "a", addedAt: isoAgo(10 * DAY_MS), lastSeen: isoAgo(10 * DAY_MS) },
      b: { url: "http://b", node: "b", addedAt: isoAgo(20 * DAY_MS), lastSeen: isoAgo(20 * DAY_MS) },
    });
    const { checkStalePeers } = await import("./stale-peers");
    const r = checkStalePeers();
    expect(r.ok).toBe(false);
    expect(r.message).toContain("2 stale peers");
    expect(r.message).toContain("--fix-stale");
  });

  it("singular phrasing when exactly one stale peer", async () => {
    writePeers({
      only: { url: "http://o", node: "o", addedAt: isoAgo(10 * DAY_MS), lastSeen: isoAgo(10 * DAY_MS) },
    });
    const { checkStalePeers } = await import("./stale-peers");
    const r = checkStalePeers();
    expect(r.message).toContain("1 stale peer ");
    expect(r.message).not.toContain("1 stale peers");
  });

  it("respects MAW_PEER_STALE_TTL_MS override", async () => {
    process.env.MAW_PEER_STALE_TTL_MS = String(365 * DAY_MS); // 1 year — even a 30d old peer is fresh
    writePeers({
      mid: { url: "http://m", node: "m", addedAt: isoAgo(30 * DAY_MS), lastSeen: isoAgo(30 * DAY_MS) },
    });
    const { checkStalePeers } = await import("./stale-peers");
    expect(checkStalePeers().ok).toBe(true);
  });
});

describe("cmdFixStalePeers", () => {
  it("no stale peers → no-op, ok:true", async () => {
    writePeers({
      fresh: { url: "http://f", node: "f", addedAt: isoAgo(DAY_MS), lastSeen: isoAgo(DAY_MS) },
    });
    const { cmdFixStalePeers } = await import("./stale-peers");
    const r = await cmdFixStalePeers();
    expect(r.ok).toBe(true);
    expect(r.checks[0].message).toContain("no stale");
    // Fresh peer survives.
    const after = JSON.parse(readFileSync(process.env.PEERS_FILE!, "utf-8"));
    expect(after.peers.fresh).toBeDefined();
  });

  it("removes stale peers, keeps fresh ones", async () => {
    writePeers({
      fresh: { url: "http://f", node: "f", addedAt: isoAgo(DAY_MS), lastSeen: isoAgo(DAY_MS) },
      stale1: { url: "http://s1", node: "s1", addedAt: isoAgo(20 * DAY_MS), lastSeen: isoAgo(20 * DAY_MS) },
      stale2: { url: "http://s2", node: "s2", addedAt: isoAgo(30 * DAY_MS), lastSeen: null },
    });
    const { cmdFixStalePeers } = await import("./stale-peers");
    const r = await cmdFixStalePeers();
    expect(r.ok).toBe(true);
    expect(r.checks[0].message).toContain("removed 2");

    const after = JSON.parse(readFileSync(process.env.PEERS_FILE!, "utf-8"));
    expect(after.peers.fresh).toBeDefined();
    expect(after.peers.stale1).toBeUndefined();
    expect(after.peers.stale2).toBeUndefined();
  });

  it("MAW_TEST_MODE bypasses the 3s countdown (fast)", async () => {
    writePeers({
      old: { url: "http://o", node: "o", addedAt: isoAgo(30 * DAY_MS), lastSeen: isoAgo(30 * DAY_MS) },
    });
    const { cmdFixStalePeers } = await import("./stale-peers");
    const t0 = Date.now();
    await cmdFixStalePeers();
    const elapsed = Date.now() - t0;
    // Should be far under 3000ms — call it 2s to be tolerant of slow CI.
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("cmdDoctor --fix-stale integration", () => {
  it("doctor --fix-stale removes stale peers end-to-end", async () => {
    writePeers({
      keep: { url: "http://k", node: "k", addedAt: isoAgo(DAY_MS), lastSeen: isoAgo(DAY_MS) },
      drop: { url: "http://d", node: "d", addedAt: isoAgo(20 * DAY_MS), lastSeen: isoAgo(20 * DAY_MS) },
    });
    const { cmdDoctor } = await import("../impl");
    const r = await cmdDoctor(["--fix-stale"]);
    expect(r.ok).toBe(true);
    expect(r.checks[0].name).toBe("peers:fix-stale");
    expect(r.checks[0].message).toContain("removed 1");

    const after = JSON.parse(readFileSync(process.env.PEERS_FILE!, "utf-8"));
    expect(after.peers.keep).toBeDefined();
    expect(after.peers.drop).toBeUndefined();
  });

  it("doctor --fix-stale on a clean store reports no stale peers", async () => {
    const { cmdDoctor } = await import("../impl");
    const r = await cmdDoctor(["--fix-stale"]);
    expect(r.ok).toBe(true);
    expect(r.checks[0].message).toContain("no stale");
  });

  it("doctor peers check surfaces the new peers:stale entry", async () => {
    writePeers({
      drop: { url: "http://d", node: "d", addedAt: isoAgo(30 * DAY_MS), lastSeen: isoAgo(30 * DAY_MS) },
    });
    const { cmdDoctor } = await import("../impl");
    const r = await cmdDoctor(["peers"]);
    const stale = r.checks.find(c => c.name === "peers:stale");
    expect(stale).toBeDefined();
    expect(stale!.ok).toBe(false);
    expect(stale!.message).toContain("--fix-stale");
  });
});

// Sanity guard: the file we wrote actually exists where we expect.
describe("setup sanity", () => {
  it("PEERS_FILE points at the tmp dir", () => {
    expect(process.env.PEERS_FILE).toContain("maw-doctor-stale-");
    writePeers({ x: { url: "http://x", node: "x", addedAt: new Date().toISOString(), lastSeen: null } });
    expect(existsSync(process.env.PEERS_FILE!)).toBe(true);
  });
});
