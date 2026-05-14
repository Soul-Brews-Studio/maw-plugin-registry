/**
 * kill — peer extension tests (#1333).
 *
 * Covers the cross-node kill added on top of the existing local `maw kill`:
 *   • no --peer → existing local cmdKill (backward compat preserved)
 *   • --peer <alias> resolved against ~/.maw/peers.json (PEERS_FILE override)
 *   • curlFetch is called with POST `${peerUrl}/api/kill` + from:"auto"
 *   • --pane forwarded into the JSON body when --peer set
 *   • 4xx / 5xx / throw surface a clean { ok:false, error } (no stack trace)
 *
 * Mocking strategy:
 *   • bun:test `mock.module` stubs `maw-js/sdk` (curlFetch) and `./impl`
 *     (cmdKill) so tests don't touch tmux, the real fleet, or the network.
 *   • `PEERS_FILE` env var (honored by peer-resolve.ts) points at a temp
 *     peers.json so each test gets an isolated alias registry.
 *
 * Mirrors plugins/ls/ls.test.ts in shape — same fixtures, same mock pattern.
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
interface MockFetchResult {
  ok: boolean;
  status?: number;
  data?: any;
}
const curlFetchMock = mock(
  async (_url: string, _opts: any): Promise<MockFetchResult> => ({
    ok: true,
    status: 200,
    data: { ok: true },
  }),
);
const cmdKillMock = mock(async (_target: string, _opts?: { pane?: number }) => {
  // Mimic real cmdKill side effect: emit a confirmation line so the handler's
  // logs array captures something — exercises the console.log -> ctx.writer
  // plumbing.
  console.log("local kill (mock)");
});

mock.module("maw-js/sdk", () => ({ curlFetch: curlFetchMock }));
mock.module("./impl", () => ({ cmdKill: cmdKillMock }));

// Now safe to import the plugin — its top-level `import { cmdKill } from "./impl"`
// and the dynamic `import("maw-js/sdk")` inside peer-call.ts will both pick up
// the mocks above.
import handler, { command } from "./index";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
let peersDir: string;
let peersFile: string;

function writePeers(peers: Record<string, { url?: string; node?: string }>) {
  writeFileSync(peersFile, JSON.stringify({ peers }, null, 2));
}

beforeEach(() => {
  peersDir = mkdtempSync(join(tmpdir(), "mpr-kill-test-"));
  peersFile = join(peersDir, "peers.json");
  process.env.PEERS_FILE = peersFile;
  curlFetchMock.mockClear();
  cmdKillMock.mockClear();
});

afterEach(() => {
  if (existsSync(peersDir)) rmSync(peersDir, { recursive: true, force: true });
  delete process.env.PEERS_FILE;
});

// ---------------------------------------------------------------------------
// 1. Smoke
// ---------------------------------------------------------------------------
describe("kill plugin — smoke", () => {
  it("exports command metadata", () => {
    expect(command.name).toBe("kill");
    expect(command.description).toBeTruthy();
  });

  it("--help / no target → usage block mentioning --peer", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["--help"] };
    const res = await handler(ctx);
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("maw kill");
    expect(res.error ?? "").toContain("--peer");
    expect(curlFetchMock).not.toHaveBeenCalled();
    expect(cmdKillMock).not.toHaveBeenCalled();
  });

  it("bare flag-looking target → 'looks like a flag' guard", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["--bogus"] };
    const res = await handler(ctx);
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("looks like a flag");
    expect(curlFetchMock).not.toHaveBeenCalled();
    expect(cmdKillMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. Local path (existing behavior preserved — backward compat)
// ---------------------------------------------------------------------------
describe("kill plugin — local path (existing behavior)", () => {
  it("CLI bare target → cmdKill(target, {pane:undefined}), no peer dispatch", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["mawjs"] };
    const res = await handler(ctx);
    expect(res.ok).toBe(true);
    expect(cmdKillMock).toHaveBeenCalledTimes(1);
    expect(cmdKillMock.mock.calls[0][0]).toBe("mawjs");
    expect(cmdKillMock.mock.calls[0][1]).toEqual({ pane: undefined });
    expect(curlFetchMock).not.toHaveBeenCalled();
  });

  it("CLI target:window → cmdKill receives the full composite target", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["mawjs:1"] };
    const res = await handler(ctx);
    expect(res.ok).toBe(true);
    expect(cmdKillMock).toHaveBeenCalledTimes(1);
    expect(cmdKillMock.mock.calls[0][0]).toBe("mawjs:1");
    expect(curlFetchMock).not.toHaveBeenCalled();
  });

  it("CLI --pane N → forwarded to cmdKill({pane:N})", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["mawjs", "--pane", "2"] };
    const res = await handler(ctx);
    expect(res.ok).toBe(true);
    expect(cmdKillMock).toHaveBeenCalledTimes(1);
    expect(cmdKillMock.mock.calls[0][0]).toBe("mawjs");
    expect(cmdKillMock.mock.calls[0][1]).toEqual({ pane: 2 });
    expect(curlFetchMock).not.toHaveBeenCalled();
  });

  it("API source (non-CLI) → cmdKill called from body, never dispatches peer", async () => {
    const ctx: InvokeContext = { source: "api", args: { target: "mawjs", pane: 3 } as any };
    const res = await handler(ctx);
    expect(res.ok).toBe(true);
    expect(cmdKillMock).toHaveBeenCalledTimes(1);
    expect(cmdKillMock.mock.calls[0][0]).toBe("mawjs");
    expect(cmdKillMock.mock.calls[0][1]).toEqual({ pane: 3 });
    expect(curlFetchMock).not.toHaveBeenCalled();
  });

  it("API source missing target → ok:false 'target is required'", async () => {
    const ctx: InvokeContext = { source: "api", args: {} as any };
    const res = await handler(ctx);
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("target is required");
    expect(cmdKillMock).not.toHaveBeenCalled();
    expect(curlFetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. --peer dispatch (cross-node)
// ---------------------------------------------------------------------------
describe("kill plugin — --peer dispatch", () => {
  it("unknown peer alias → { ok:false } with 'unknown peer alias', NEVER falls through to local kill", async () => {
    writePeers({}); // empty registry on disk
    const ctx: InvokeContext = { source: "cli", args: ["mawjs", "--peer", "ghost-peer"] };
    const res = await handler(ctx);
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("unknown peer alias");
    expect(res.error ?? "").toContain("ghost-peer");
    // critical: must NOT silently fall through to local kill
    expect(cmdKillMock).not.toHaveBeenCalled();
    expect(curlFetchMock).not.toHaveBeenCalled();
  });

  it("unknown peer (no peers.json at all) → also clean error, no local fall-through", async () => {
    // PEERS_FILE points at a path that doesn't exist (no writePeers call)
    const ctx: InvokeContext = { source: "cli", args: ["mawjs", "--peer", "whoever"] };
    const res = await handler(ctx);
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("unknown peer alias");
    expect(cmdKillMock).not.toHaveBeenCalled();
    expect(curlFetchMock).not.toHaveBeenCalled();
  });

  it("known peer → curlFetch hits POST `${url}/api/kill` with from:'auto' + JSON body", async () => {
    writePeers({ "white-wg": { url: "http://10.0.0.5:47777", node: "m5" } });
    curlFetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      data: { ok: true, output: "killed session mawjs on m5" },
    }));

    const ctx: InvokeContext = { source: "cli", args: ["mawjs", "--peer", "white-wg"] };
    const res = await handler(ctx);

    expect(res.ok).toBe(true);
    expect(curlFetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = curlFetchMock.mock.calls[0];
    expect(url).toBe("http://10.0.0.5:47777/api/kill");
    expect(opts.method).toBe("POST");
    expect(opts.from).toBe("auto"); // federation signing, not hand-rolled HMAC
    const body = JSON.parse(opts.body);
    expect(body).toEqual({ target: "mawjs" });
    expect(res.output ?? "").toContain("white-wg");
    expect(res.output ?? "").toContain("mawjs");
    // local must NOT have run
    expect(cmdKillMock).not.toHaveBeenCalled();
  });

  it("known peer + --pane → pane forwarded in JSON body", async () => {
    writePeers({ "white-wg": { url: "http://10.0.0.5:47777" } });
    curlFetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      data: { ok: true },
    }));

    const ctx: InvokeContext = {
      source: "cli",
      args: ["mawjs:0", "--pane", "1", "--peer", "white-wg"],
    };
    const res = await handler(ctx);

    expect(res.ok).toBe(true);
    expect(curlFetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(curlFetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ target: "mawjs:0", pane: 1 });
    expect(cmdKillMock).not.toHaveBeenCalled();
  });

  it("peer 5xx → graceful { ok:false }, error includes alias + url + detail", async () => {
    writePeers({ "white-wg": { url: "http://10.0.0.5:47777" } });
    curlFetchMock.mockImplementationOnce(async () => ({
      ok: false,
      status: 503,
      data: { error: "service unavailable" },
    }));

    const ctx: InvokeContext = { source: "cli", args: ["mawjs", "--peer", "white-wg"] };
    const res = await handler(ctx);

    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("white-wg");
    expect(res.error ?? "").toContain("service unavailable");
    expect(cmdKillMock).not.toHaveBeenCalled();
  });

  it("peer 404 → 'does not support /api/kill' guidance", async () => {
    writePeers({ "old-node": { url: "http://10.0.0.6:47777" } });
    curlFetchMock.mockImplementationOnce(async () => ({ ok: false, status: 404 }));

    const ctx: InvokeContext = { source: "cli", args: ["mawjs", "--peer", "old-node"] };
    const res = await handler(ctx);

    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("/api/kill");
    expect(res.error ?? "").toContain("404");
    expect(cmdKillMock).not.toHaveBeenCalled();
  });

  it("peer non-2xx with no body.error → falls back to 'HTTP <status>' detail", async () => {
    writePeers({ "weird": { url: "http://10.0.0.8:47777" } });
    curlFetchMock.mockImplementationOnce(async () => ({ ok: false, status: 418 }));

    const ctx: InvokeContext = { source: "cli", args: ["mawjs", "--peer", "weird"] };
    const res = await handler(ctx);

    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("weird");
    expect(res.error ?? "").toContain("HTTP 418");
    expect(cmdKillMock).not.toHaveBeenCalled();
  });

  it("curlFetch throws (DNS/network) → caught + surfaced cleanly with alias", async () => {
    writePeers({ "dns-fail": { url: "http://nope.invalid:47777" } });
    curlFetchMock.mockImplementationOnce(async () => {
      throw new Error("ENOTFOUND");
    });

    const ctx: InvokeContext = { source: "cli", args: ["mawjs", "--peer", "dns-fail"] };
    const res = await handler(ctx);

    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("ENOTFOUND");
    expect(res.error ?? "").toContain("dns-fail");
    expect(cmdKillMock).not.toHaveBeenCalled();
  });

  it("peer success with no remote output → still ok:true with local summary", async () => {
    writePeers({ "white-wg": { url: "http://10.0.0.5:47777" } });
    curlFetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      data: { ok: true }, // no `output` field
    }));

    const ctx: InvokeContext = { source: "cli", args: ["mawjs", "--peer", "white-wg"] };
    const res = await handler(ctx);

    expect(res.ok).toBe(true);
    expect(res.output ?? "").toContain("forwarded kill");
    expect(res.output ?? "").toContain("white-wg");
    expect(res.output ?? "").toContain("mawjs");
    expect(cmdKillMock).not.toHaveBeenCalled();
  });
});
