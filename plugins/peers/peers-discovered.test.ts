/**
 * maw peers list --discovered + accept (#1237, slice 1) — CLI tests.
 *
 * The data layer lives in maw-js (`/api/peers/discoveries` + `/api/peers/accept`)
 * — these tests stub fetch() so we exercise the CLI dispatcher in isolation:
 *   - argument parsing (--all, --limit, --alias, --json, --discovered, --all)
 *   - render of fixed-width table from a mocked response
 *   - error surfacing (daemon down, ambiguous prefix, impersonation guard)
 *
 * The on-disk store is not touched (writes happen daemon-side).
 */
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

mock.module("maw-js/config", () => ({
  loadConfig: () => ({ port: 3456 }),
}));

let lastRequest: { url: string; init?: RequestInit } | null = null;
let nextResponse: { status: number; body: any } = { status: 200, body: {} };
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  lastRequest = null;
  nextResponse = { status: 200, body: {} };
  // Mock global fetch — every test sets `nextResponse` to drive behavior.
  // We can't use Bun's mock.module for `fetch` (it's a global), so reassign.
  // @ts-expect-error — overwrite global
  globalThis.fetch = async (url: string, init?: RequestInit) => {
    lastRequest = { url: String(url), init };
    return new Response(JSON.stringify(nextResponse.body), {
      status: nextResponse.status,
      headers: { "content-type": "application/json" },
    });
  };
});

afterEach(() => {
  // Restore — otherwise our mock leaks into peers.test.ts / peers-probe.test.ts
  // and causes their network-dependent tests to time out.
  globalThis.fetch = ORIGINAL_FETCH;
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maw-peers-discov-"));
  process.env.PEERS_FILE = join(dir, "peers.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PEERS_FILE;
});

// ─── discovered.ts unit tests ─────────────────────────────────────────────

describe("discovered.ts — HTTP client", () => {
  it("fetchDiscoveries → calls GET /api/peers/discoveries on configured port", async () => {
    nextResponse = { status: 200, body: { ok: true, total: 0, shown: 0, filtered: true, peers: [] } };
    const { fetchDiscoveries } = await import("./discovered");
    const r = await fetchDiscoveries({});
    expect(r.ok).toBe(true);
    expect(lastRequest?.url).toBe("http://localhost:3456/api/peers/discoveries");
  });

  it("fetchDiscoveries → forwards --all and --limit as query params", async () => {
    nextResponse = { status: 200, body: { ok: true, total: 0, shown: 0, filtered: false, peers: [] } };
    const { fetchDiscoveries } = await import("./discovered");
    await fetchDiscoveries({ all: true, limit: 25 });
    expect(lastRequest?.url).toContain("all=1");
    expect(lastRequest?.url).toContain("limit=25");
  });

  it("fetchDiscoveries → returns daemon_unreachable when fetch throws", async () => {
    // @ts-expect-error
    globalThis.fetch = async () => { throw new Error("ECONNREFUSED 127.0.0.1:3456"); };
    const { fetchDiscoveries } = await import("./discovered");
    const r = await fetchDiscoveries({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("daemon_unreachable");
      expect(r.hint).toContain("maw serve");
    }
  });

  it("fetchDiscoveries → surfaces daemon-side error body when status >= 400", async () => {
    nextResponse = { status: 503, body: { ok: false, error: "scout_unavailable", hint: "rebind multicast" } };
    const { fetchDiscoveries } = await import("./discovered");
    const r = await fetchDiscoveries({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("scout_unavailable");
      expect(r.status).toBe(503);
    }
  });

  it("acceptPeer → POSTs id+alias as JSON body", async () => {
    nextResponse = { status: 200, body: { ok: true, alias: "mba", node: "mba", url: "http://1.2.3.4:3456" } };
    const { acceptPeer } = await import("./discovered");
    const r = await acceptPeer({ id: "mba", alias: "snow" });
    expect(r.ok).toBe(true);
    expect(lastRequest?.init?.method).toBe("POST");
    expect(JSON.parse(String(lastRequest?.init?.body))).toEqual({ id: "mba", alias: "snow" });
  });

  it("formatDiscoveries → renders a table with the design's columns", async () => {
    const { formatDiscoveries } = await import("./discovered");
    const out = formatDiscoveries({
      ok: true,
      total: 1,
      shown: 1,
      filtered: true,
      peers: [{
        zid: "abcdef1234567890" + "0".repeat(16),
        node: "mba",
        oracle: "neo",
        host: "192.168.1.5",
        locators: ["http://192.168.1.5:3456"],
        capabilities: ["pair", "feed"],
        oracles: [],
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        seenRel: "2s ago",
        paired: false,
      }],
    });
    for (const col of ["zid", "node", "oracle", "host", "seen", "paired", "caps"]) {
      expect(out).toContain(col);
    }
    expect(out).toContain("abcdef12");
    expect(out).toContain("mba");
    expect(out).toContain("2s ago");
    expect(out).toContain("pair,feed");
  });

  it("formatDiscoveries → empty filtered set renders helpful hint", async () => {
    const { formatDiscoveries } = await import("./discovered");
    const out = formatDiscoveries({ ok: true, total: 0, shown: 0, filtered: true, peers: [] });
    expect(out).toContain("--all");
  });
});

// ─── Dispatcher integration ───────────────────────────────────────────────

describe("dispatcher — list --discovered (#1237)", () => {
  it("list --discovered → fetches from daemon and renders table", async () => {
    nextResponse = {
      status: 200,
      body: {
        ok: true, total: 1, shown: 1, filtered: true,
        peers: [{
          zid: "aa".repeat(16), node: "mba", oracle: "neo", host: "10.0.0.5",
          locators: ["http://10.0.0.5:3456"], capabilities: ["pair"], oracles: [],
          firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(),
          seenRel: "1s ago", paired: false,
        }],
      },
    };
    const { default: handler } = await import("./index");
    const r = await handler({ source: "cli", args: ["list", "--discovered"] });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("mba");
    expect(r.output).toContain("10.0.0.5");
    expect(lastRequest?.url).toContain("/api/peers/discoveries");
  });

  it("list --discovered --all --limit 25 → passes both query params through", async () => {
    nextResponse = { status: 200, body: { ok: true, total: 0, shown: 0, filtered: false, peers: [] } };
    const { default: handler } = await import("./index");
    await handler({ source: "cli", args: ["list", "--discovered", "--all", "--limit", "25"] });
    expect(lastRequest?.url).toContain("all=1");
    expect(lastRequest?.url).toContain("limit=25");
  });

  it("list --discovered --json → emits JSON not table", async () => {
    nextResponse = { status: 200, body: { ok: true, total: 0, shown: 0, filtered: true, peers: [] } };
    const { default: handler } = await import("./index");
    const r = await handler({ source: "cli", args: ["list", "--discovered", "--json"] });
    expect(r.ok).toBe(true);
    expect(r.output).toContain('"peers"');
  });

  it("list --discovered surfaces daemon_unreachable (open question #1: hard error)", async () => {
    // @ts-expect-error
    globalThis.fetch = async () => { throw new Error("ECONNREFUSED 127.0.0.1:3456"); };
    const { default: handler } = await import("./index");
    const r = await handler({ source: "cli", args: ["list", "--discovered"] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("daemon_unreachable");
  });
});

describe("dispatcher — accept (#1237)", () => {
  it("accept <node> → POSTs to daemon and reports success", async () => {
    nextResponse = { status: 200, body: { ok: true, alias: "mba", node: "mba", url: "http://10.0.0.5:3456" } };
    const { default: handler } = await import("./index");
    const r = await handler({ source: "cli", args: ["accept", "mba"] });
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/accepted mba/);
    expect(JSON.parse(String(lastRequest?.init?.body))).toEqual({ id: "mba", alias: undefined });
  });

  it("accept <prefix> --alias snow → forwards alias override", async () => {
    nextResponse = { status: 200, body: { ok: true, alias: "snow", node: "mba", url: "http://10.0.0.5:3456" } };
    const { default: handler } = await import("./index");
    const r = await handler({ source: "cli", args: ["accept", "ab12", "--alias", "snow"] });
    expect(r.ok).toBe(true);
    expect(JSON.parse(String(lastRequest?.init?.body))).toEqual({ id: "ab12", alias: "snow" });
    expect(r.output).toMatch(/accepted snow/);
  });

  it("accept --all → POSTs { all: true } and renders accepted + skipped", async () => {
    nextResponse = {
      status: 200,
      body: {
        ok: true,
        accepted: [{ ok: true, alias: "n1" }, { ok: true, alias: "n2" }],
        skipped: [{ id: "zid-ghost", ok: false, error: "impersonation_guard", hint: "alias collides" }],
      },
    };
    const { default: handler } = await import("./index");
    const r = await handler({ source: "cli", args: ["accept", "--all"] });
    expect(r.ok).toBe(true);
    expect(JSON.parse(String(lastRequest?.init?.body))).toEqual({ all: true });
    expect(r.output).toContain("accepted n1");
    expect(r.output).toContain("accepted n2");
    expect(r.output).toContain("impersonation_guard");
  });

  it("accept missing args → usage error", async () => {
    const { default: handler } = await import("./index");
    const r = await handler({ source: "cli", args: ["accept"] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("usage:");
  });

  it("accept ambiguous prefix → surfaces candidate list (decision #3)", async () => {
    nextResponse = {
      status: 409,
      body: {
        ok: false,
        error: "ambiguous",
        candidates: [
          { zid: "ab" + "1".repeat(30), node: "a1", host: "10.0.0.1" },
          { zid: "ab" + "2".repeat(30), node: "a2", host: "10.0.0.2" },
        ],
        hint: "Disambiguate.",
      },
    };
    const { default: handler } = await import("./index");
    const r = await handler({ source: "cli", args: ["accept", "ab"] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("ambiguous");
    expect(r.output).toContain("a1");
    expect(r.output).toContain("a2");
  });

  it("accept refused by impersonation_guard → fails loudly, no rewrite", async () => {
    nextResponse = {
      status: 409,
      body: {
        ok: false, error: "impersonation_guard",
        hint: "pubkey already pins under alias \"ghost\".",
      },
    };
    const { default: handler } = await import("./index");
    const r = await handler({ source: "cli", args: ["accept", "evil", "--alias", "twin"] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("impersonation_guard");
    expect(r.output).toContain("ghost");
  });

  it("accept surfaces daemon_unreachable when daemon is down", async () => {
    // @ts-expect-error
    globalThis.fetch = async () => { throw new Error("ECONNREFUSED 127.0.0.1:3456"); };
    const { default: handler } = await import("./index");
    const r = await handler({ source: "cli", args: ["accept", "mba"] });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("daemon_unreachable");
  });
});

describe("help text (#1237)", () => {
  it("help mentions accept + list --discovered", async () => {
    const { default: handler } = await import("./index");
    const r = await handler({ source: "cli", args: [] });
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/list\s+\[--discovered\]/);
    expect(r.output).toMatch(/accept\s+<node\|zid-prefix>/);
    expect(r.output).toContain("impersonation guard");
  });
});
