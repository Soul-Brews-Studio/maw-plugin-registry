/**
 * ls — peer extension tests (#1327).
 *
 * Covers the cross-node listing added on top of the existing local `maw ls`:
 *   • local path (no args, --fix, API source) — preserves pre-1.1.0 behavior
 *   • <peer> alias resolution against ~/.maw/peers.json (PEERS_FILE override)
 *   • curlFetch is called with `${peerUrl}/api/sessions` + from:"auto"
 *   • --all fans out + aggregates with per-peer try/catch
 *   • --json emits a parseable structured shape
 *   • 4xx / 5xx / throw surface clean { ok:false, error } (no stack trace)
 *
 * Mocking strategy:
 *   • bun:test `mock.module` stubs `maw-js/sdk` (curlFetch) and
 *     `maw-js/commands/shared/comm` (cmdList) so tests don't touch tmux,
 *     the real fleet, or the network.
 *   • `PEERS_FILE` env var (honored by peer-resolve.ts) points at a temp
 *     peers.json so each test gets an isolated alias registry.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { writeFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { InvokeContext } from "maw-js/plugin/types";

// ---------------------------------------------------------------------------
// Module mocks — registered BEFORE handler import so the dynamic imports
// inside index.ts / peer-call.ts resolve to these stubs.
// ---------------------------------------------------------------------------
// Widened return type so per-test mockImplementationOnce overrides (4xx/5xx
// bodies with { error: ... } shapes) don't fight the inferred narrow type.
interface MockFetchResult {
  ok: boolean;
  status?: number;
  data?: any;
}
const curlFetchMock = mock(
  async (_url: string, _opts: any): Promise<MockFetchResult> => ({
    ok: true,
    status: 200,
    data: [],
  }),
);
const cmdListMock = mock(async (_opts?: { fix?: boolean }) => {
  // mimic real cmdList by emitting one line so the handler's logs array
  // captures something — exercises the console.log -> ctx.writer plumbing.
  console.log("local ls (mock)");
});

mock.module("maw-js/sdk", () => ({ curlFetch: curlFetchMock }));
mock.module("maw-js/commands/shared/comm", () => ({ cmdList: cmdListMock }));

// Now safe to import the plugin (its top-level imports + dynamic imports
// will pick up the mocks above).
import handler, { command } from "./index";
import { fetchPeerSessions } from "./internal/peer-call";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
let peersDir: string;
let peersFile: string;

function writePeers(peers: Record<string, { url?: string; node?: string }>) {
  writeFileSync(peersFile, JSON.stringify({ peers }, null, 2));
}

beforeEach(() => {
  peersDir = mkdtempSync(join(tmpdir(), "mpr-ls-test-"));
  peersFile = join(peersDir, "peers.json");
  process.env.PEERS_FILE = peersFile;
  curlFetchMock.mockClear();
  cmdListMock.mockClear();
});

afterEach(() => {
  if (existsSync(peersDir)) rmSync(peersDir, { recursive: true, force: true });
  delete process.env.PEERS_FILE;
});

// ---------------------------------------------------------------------------
// 1. Smoke
// ---------------------------------------------------------------------------
describe("ls plugin — smoke", () => {
  it("exports command metadata", () => {
    expect(command.name).toBe("ls");
    expect(command.description).toBeTruthy();
  });

  it("--help returns usage block mentioning peers", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["--help"] };
    const res = await handler(ctx);
    expect(res.ok).toBe(true);
    expect(res.output ?? "").toContain("maw ls");
    expect(res.output ?? "").toContain("peer");
    expect(curlFetchMock).not.toHaveBeenCalled();
    expect(cmdListMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Local path (existing behavior preserved)
// ---------------------------------------------------------------------------
describe("ls plugin — local path (existing behavior)", () => {
  it("API source (non-CLI) — calls cmdList with no opts, returns ok", async () => {
    const ctx: InvokeContext = { source: "api", args: {} as any };
    const res = await handler(ctx);
    expect(res.ok).toBe(true);
    expect(cmdListMock).toHaveBeenCalledTimes(1);
    expect(cmdListMock.mock.calls[0][0]).toBeUndefined();
    expect(curlFetchMock).not.toHaveBeenCalled();
  });

  it("CLI no args — calls cmdList({fix:false}), no peer dispatch", async () => {
    const ctx: InvokeContext = { source: "cli", args: [] };
    const res = await handler(ctx);
    expect(res.ok).toBe(true);
    expect(cmdListMock).toHaveBeenCalledTimes(1);
    expect(cmdListMock.mock.calls[0][0]).toEqual({ fix: false });
    expect(curlFetchMock).not.toHaveBeenCalled();
  });

  it("CLI --fix flag — forwarded to cmdList({fix:true})", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["--fix"] };
    const res = await handler(ctx);
    expect(res.ok).toBe(true);
    expect(cmdListMock).toHaveBeenCalledTimes(1);
    expect(cmdListMock.mock.calls[0][0]).toEqual({ fix: true });
    expect(curlFetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Single peer (maw ls <peer>)
// ---------------------------------------------------------------------------
describe("ls plugin — single peer", () => {
  it("unknown peer alias → { ok:false } with 'unknown peer alias', NEVER falls through to local ls", async () => {
    writePeers({}); // empty registry on disk
    const ctx: InvokeContext = { source: "cli", args: ["ghost-peer"] };
    const res = await handler(ctx);
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("unknown peer alias");
    expect(res.error ?? "").toContain("ghost-peer");
    // critical: must NOT silently fall through to local sessions
    expect(cmdListMock).not.toHaveBeenCalled();
    expect(curlFetchMock).not.toHaveBeenCalled();
  });

  it("unknown peer alias (no peers.json at all) → also clean error", async () => {
    // PEERS_FILE points at a path that doesn't exist
    const ctx: InvokeContext = { source: "cli", args: ["whoever"] };
    const res = await handler(ctx);
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("unknown peer alias");
    expect(cmdListMock).not.toHaveBeenCalled();
  });

  it("known peer — curlFetch called with `${url}/api/sessions` + from:'auto' + GET", async () => {
    writePeers({ "white-wg": { url: "http://10.0.0.5:47777", node: "m5" } });
    curlFetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      data: [{ name: "01-mawjs", windows: [{ name: "shell", index: 0, active: true }] }],
    }));

    const ctx: InvokeContext = { source: "cli", args: ["white-wg"] };
    const res = await handler(ctx);

    expect(res.ok).toBe(true);
    expect(curlFetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = curlFetchMock.mock.calls[0];
    expect(url).toBe("http://10.0.0.5:47777/api/sessions");
    expect(opts.method).toBe("GET");
    expect(opts.from).toBe("auto"); // federation signing, not hand-rolled HMAC
    expect(typeof opts.timeout).toBe("number");
    expect(res.output ?? "").toContain("white-wg");
    expect(res.output ?? "").toContain("01-mawjs");
    expect(cmdListMock).not.toHaveBeenCalled();
  });

  it("known peer + --json → emits parseable JSON shape", async () => {
    writePeers({ "white-wg": { url: "http://10.0.0.5:47777" } });
    curlFetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      data: [{ name: "ide", windows: [{ name: "vim" }] }],
    }));

    const ctx: InvokeContext = { source: "cli", args: ["white-wg", "--json"] };
    const res = await handler(ctx);

    expect(res.ok).toBe(true);
    const parsed = JSON.parse(res.output ?? "");
    expect(parsed.peer).toBe("white-wg");
    expect(parsed.url).toBe("http://10.0.0.5:47777");
    expect(parsed.sessions).toEqual([{ name: "ide", windows: [{ name: "vim" }] }]);
  });

  it("peer offline / 5xx → graceful { ok:false }, no crash", async () => {
    writePeers({ "white-wg": { url: "http://10.0.0.5:47777" } });
    curlFetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 503,
      data: { error: "service unavailable" },
    }));

    const ctx: InvokeContext = { source: "cli", args: ["white-wg"] };
    const res = await handler(ctx);

    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("white-wg");
    expect(res.error ?? "").toContain("service unavailable");
  });

  it("peer 404 → 'does not support /api/sessions' guidance", async () => {
    writePeers({ "old-node": { url: "http://10.0.0.6:47777" } });
    curlFetchMock.mockImplementationOnce(async () => ({ ok: false, status: 404 }));

    const ctx: InvokeContext = { source: "cli", args: ["old-node"] };
    const res = await handler(ctx);

    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("/api/sessions");
    expect(res.error ?? "").toContain("404");
  });

  it("peer 401 → federation/peer-identity hint", async () => {
    writePeers({ "locked": { url: "http://10.0.0.7:47777" } });
    curlFetchMock.mockImplementationOnce(async () => ({ ok: false, status: 401 }));

    const ctx: InvokeContext = { source: "cli", args: ["locked"] };
    const res = await handler(ctx);

    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("401");
    expect(res.error ?? "").toMatch(/federation|peer-identity/);
  });

  it("curlFetch throws (DNS/network) → caught + surfaced cleanly", async () => {
    writePeers({ "dns-fail": { url: "http://nope.invalid:47777" } });
    curlFetchMock.mockImplementationOnce(async () => {
      throw new Error("ENOTFOUND");
    });

    const ctx: InvokeContext = { source: "cli", args: ["dns-fail"] };
    const res = await handler(ctx);

    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("ENOTFOUND");
    expect(res.error ?? "").toContain("dns-fail");
  });
});

// ---------------------------------------------------------------------------
// 4. --all aggregation
// ---------------------------------------------------------------------------
describe("ls plugin — --all aggregation", () => {
  it("no peers configured → { ok:false } with guidance, no fetches", async () => {
    writePeers({});
    const ctx: InvokeContext = { source: "cli", args: ["--all"] };
    const res = await handler(ctx);
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("no peers configured");
    expect(curlFetchMock).not.toHaveBeenCalled();
  });

  it("--all fans out + aggregates across multiple peers", async () => {
    writePeers({
      "alpha": { url: "http://a:47777" },
      "beta": { url: "http://b:47777" },
    });
    curlFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("http://a")) {
        return { ok: true, status: 200, data: [{ name: "a1", windows: [] }] };
      }
      if (url.startsWith("http://b")) {
        return {
          ok: true,
          status: 200,
          data: [{ name: "b1", windows: [] }, { name: "b2", windows: [] }],
        };
      }
      return { ok: false, status: 500 };
    });

    const ctx: InvokeContext = { source: "cli", args: ["--all"] };
    const res = await handler(ctx);

    expect(res.ok).toBe(true);
    expect(curlFetchMock).toHaveBeenCalledTimes(2);
    expect(res.output ?? "").toContain("alpha");
    expect(res.output ?? "").toContain("beta");
    expect(res.output ?? "").toContain("a1");
    expect(res.output ?? "").toContain("b1");
    expect(res.output ?? "").toContain("b2");
    // header summarizes peers + total sessions
    expect(res.output ?? "").toMatch(/2 peers/);
    expect(res.output ?? "").toMatch(/3 sessions total/);
  });

  it("--all with one peer offline → still ok:true, inline error for the dead one", async () => {
    writePeers({
      "alpha": { url: "http://a:47777" },
      "down": { url: "http://nope:47777" },
    });
    curlFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("http://a")) {
        return { ok: true, status: 200, data: [{ name: "a1", windows: [] }] };
      }
      throw new Error("ECONNREFUSED");
    });

    const ctx: InvokeContext = { source: "cli", args: ["--all"] };
    const res = await handler(ctx);

    expect(res.ok).toBe(true); // one bad peer must NOT short-circuit aggregation
    expect(res.output ?? "").toContain("alpha");
    expect(res.output ?? "").toContain("a1");
    expect(res.output ?? "").toContain("down");
    expect(res.output ?? "").toContain("ECONNREFUSED");
  });

  it("--all --json → { peers:[...] } with mixed success/error entries", async () => {
    writePeers({
      "alpha": { url: "http://a:47777" },
      "down": { url: "http://nope:47777" },
    });
    curlFetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith("http://a")) {
        return { ok: true, status: 200, data: [{ name: "a1", windows: [] }] };
      }
      return { ok: false, status: 502, data: { error: "bad gateway" } };
    });

    const ctx: InvokeContext = { source: "cli", args: ["--all", "--json"] };
    const res = await handler(ctx);

    expect(res.ok).toBe(true);
    const parsed = JSON.parse(res.output ?? "");
    expect(Array.isArray(parsed.peers)).toBe(true);
    expect(parsed.peers).toHaveLength(2);
    const byAlias = Object.fromEntries(parsed.peers.map((p: any) => [p.alias, p]));
    expect(byAlias["alpha"].sessions).toEqual([{ name: "a1", windows: [] }]);
    expect(byAlias["down"].error).toContain("bad gateway");
    expect(byAlias["down"].sessions).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. peer-call unit (direct exports)
// ---------------------------------------------------------------------------
describe("peer-call — direct unit", () => {
  it("fetchPeerSessions hits `${url}/api/sessions` with from:'auto'", async () => {
    curlFetchMock.mockImplementationOnce(async () => ({ ok: true, status: 200, data: [] }));
    const res = await fetchPeerSessions("http://x:47777");
    expect(res.ok).toBe(true);
    expect(curlFetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = curlFetchMock.mock.calls[0];
    expect(url).toBe("http://x:47777/api/sessions");
    expect(opts.method).toBe("GET");
    expect(opts.from).toBe("auto");
  });
});

// ---------------------------------------------------------------------------
// Live fleet smoke — covered by manual `maw ls white-wg` against the real
// m5 node (see handoff 2026-05-14 cross-node-ls). Skipped in CI.
// ---------------------------------------------------------------------------
describe.skip("ls plugin — live fleet (manual)", () => {
  it.skip("hits real /api/sessions on m5", () => {});
});
