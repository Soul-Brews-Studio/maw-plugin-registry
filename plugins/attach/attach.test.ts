/**
 * attach plugin tests (#25 Phase 1 + #1236 Tier 3).
 *
 * Three layers:
 *   1. Resolver — pure, no mocks, exercises Tier 1 / 2 / 3 / ambiguous / null
 *   2. Handler — mocks listSessions + loadFleet + the maw subprocess via
 *      mock.module on Bun.spawn, verifies the cascade emits the right command
 *   3. Tier 3 — peer-aware resolver + handler with stubbed SSH
 */

import { test, expect, mock } from "bun:test";
import {
  resolveAttachTarget,
  type SessionLike,
  type FleetLike,
} from "./resolve-attach-target";
import {
  resolveRemoteAttachTarget,
  resolveSshAlias,
  type AggregatedSessionLike,
} from "./resolve-remote-target";
import type { PeerConfig } from "maw-js/config/types";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Resolver tests
// ─────────────────────────────────────────────────────────────────────────────

function makeDeps(sessions: SessionLike[], fleet: FleetLike[]) {
  return {
    listSessions: async () => sessions,
    loadFleet: () => fleet,
  };
}

function makeRemoteDeps(opts: {
  sessions?: SessionLike[];
  fleet?: FleetLike[];
  aggregated?: AggregatedSessionLike[];
  namedPeers?: PeerConfig[];
}) {
  return {
    listSessions: async () => opts.sessions ?? [],
    loadFleet: () => opts.fleet ?? [],
    getAggregatedSessions: async () => opts.aggregated ?? [],
    namedPeers: () => opts.namedPeers ?? [],
  };
}

test("resolver: Tier 1 — exact session name match", async () => {
  const deps = makeDeps([{ name: "discord-oracle", windows: [{ name: "discord-oracle" }] }], []);
  const r = await resolveAttachTarget("discord-oracle", deps);
  expect(r).toEqual({ tier: 1, sessionName: "discord-oracle" });
});

test("resolver: Tier 1 — slot-prefix-aware suffix match", async () => {
  const deps = makeDeps([{ name: "24-discord-oracle", windows: [{ name: "discord-oracle" }] }], []);
  const r = await resolveAttachTarget("discord-oracle", deps);
  expect(r).toEqual({ tier: 1, sessionName: "24-discord-oracle" });
});

test("resolver: Tier 1 — case-insensitive match", async () => {
  const deps = makeDeps([{ name: "Discord-Oracle", windows: [{ name: "x" }] }], []);
  const r = await resolveAttachTarget("DISCORD-ORACLE", deps);
  expect(r).toEqual({ tier: 1, sessionName: "Discord-Oracle" });
});

test("resolver: Tier 2 — fleet entry, no live session", async () => {
  const deps = makeDeps([], [{ name: "24-discord-oracle", windows: [{ name: "discord-oracle" }] }]);
  const r = await resolveAttachTarget("discord-oracle", deps);
  expect(r).toEqual({ tier: 2, fleetName: "24-discord-oracle" });
});

test("resolver: ambiguous Tier 1 — multiple live sessions match", async () => {
  const deps = makeDeps(
    [
      { name: "24-discord-oracle", windows: [{ name: "x" }] },
      { name: "99-discord-oracle", windows: [{ name: "x" }] },
    ],
    [],
  );
  const r = await resolveAttachTarget("discord-oracle", deps);
  expect(r?.tier).toBe(1);
  expect(r?.ambiguousCandidates).toEqual(["24-discord-oracle", "99-discord-oracle"]);
});

test("resolver: ambiguous Tier 2 — multiple fleet entries match", async () => {
  const deps = makeDeps(
    [],
    [
      { name: "24-discord-oracle", windows: [{ name: "x" }] },
      { name: "30-discord-oracle", windows: [{ name: "x" }] },
    ],
  );
  const r = await resolveAttachTarget("discord-oracle", deps);
  expect(r?.tier).toBe(2);
  expect(r?.ambiguousCandidates).toEqual(["24-discord-oracle", "30-discord-oracle"]);
});

test("resolver: no match → null", async () => {
  const deps = makeDeps([{ name: "foo-oracle", windows: [{ name: "x" }] }], [{ name: "bar-oracle", windows: [{ name: "x" }] }]);
  const r = await resolveAttachTarget("does-not-exist", deps);
  expect(r).toBeNull();
});

test("resolver: live session takes precedence over fleet entry", async () => {
  const deps = makeDeps(
    [{ name: "24-foo-oracle", windows: [{ name: "x" }] }],
    [{ name: "24-foo-oracle", windows: [{ name: "x" }] }],
  );
  const r = await resolveAttachTarget("foo-oracle", deps);
  expect(r).toEqual({ tier: 1, sessionName: "24-foo-oracle" });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Handler tests — cascade + flag plumbing
// ─────────────────────────────────────────────────────────────────────────────

function setupHandlerMocks(opts: {
  sessions?: SessionLike[];
  fleet?: FleetLike[];
}) {
  const spawnCalls: string[][] = [];

  // Tier 3 surface mocked-out (empty aggregated, no SSH calls). Existing
  // handler tests don't exercise it, but impl.ts imports the symbols
  // unconditionally — so they must resolve.
  class FakeSshAttachError extends Error {
    constructor(message: string) { super(message); this.name = "SshAttachError"; }
  }
  mock.module("maw-js/sdk", () => ({
    listSessions: async () => opts.sessions ?? [],
    getAggregatedSessions: async () => [],
    attachRemoteSession: () => { throw new Error("attachRemoteSession not stubbed in this test"); },
    SshAttachError: FakeSshAttachError,
  }));
  mock.module("maw-js/config", () => ({
    loadConfig: () => ({ namedPeers: [] }),
  }));
  mock.module("maw-js/commands/shared/fleet-load", () => ({
    loadFleet: () => opts.fleet ?? [],
  }));

  // Bun.spawn is global — patch it with a stub that records args + returns
  // an immediately-resolved exited promise.
  const realSpawn = Bun.spawn;
  (Bun as any).spawn = (args: string[]) => {
    spawnCalls.push(args);
    return {
      exited: Promise.resolve(0),
    };
  };

  mock.module("maw-js/cli/parse-args", () => ({
    parseFlags: (args: string[], schema: any) => {
      const out: any = { _: [] };
      const aliases: Record<string, string> = {};
      for (const [k, v] of Object.entries(schema)) {
        if (typeof v === "string" && v.startsWith("--")) aliases[k] = v;
      }
      for (let i = 0; i < args.length; i++) {
        let a = args[i];
        if (aliases[a]) a = aliases[a];
        if (a.startsWith("--")) {
          const ty = schema[a];
          if (ty === Boolean) out[a] = true;
          else if (ty === Number) out[a] = Number(args[++i]);
          else out[a] = args[++i];
        } else {
          out._.push(a);
        }
      }
      return out;
    },
  }));

  return {
    spawnCalls,
    restore: () => {
      (Bun as any).spawn = realSpawn;
      mock.restore();
    },
  };
}

test("handler: Tier 1 (live) — invokes `maw tmux attach <session>`", async () => {
  const ctx = setupHandlerMocks({
    sessions: [{ name: "24-discord-oracle", windows: [{ name: "x" }] }],
  });
  try {
    const handler = (await import("./index")).default;
    const result = await handler({ source: "cli", args: ["discord-oracle"], writer: undefined } as any);
    expect(result.ok).toBe(true);
    expect(ctx.spawnCalls.length).toBe(1);
    expect(ctx.spawnCalls[0]).toEqual(["maw", "tmux", "attach", "24-discord-oracle"]);
  } finally {
    ctx.restore();
  }
});

test("handler: Tier 1 dry-run — no spawn, prints plan", async () => {
  const ctx = setupHandlerMocks({
    sessions: [{ name: "24-discord-oracle", windows: [{ name: "x" }] }],
  });
  try {
    const handler = (await import("./index")).default;
    const result = await handler({ source: "cli", args: ["discord-oracle", "--dry-run"], writer: undefined } as any);
    expect(result.ok).toBe(true);
    expect(ctx.spawnCalls.length).toBe(0);
    expect(result.output).toMatch(/Tier 1/);
  } finally {
    ctx.restore();
  }
});

test("handler: Tier 2 with -y — wakes then attaches, no prompt", async () => {
  const ctx = setupHandlerMocks({
    fleet: [{ name: "24-discord-oracle", windows: [{ name: "x" }] }],
  });
  try {
    const handler = (await import("./index")).default;
    const result = await handler({ source: "cli", args: ["discord-oracle", "-y"], writer: undefined } as any);
    expect(result.ok).toBe(true);
    expect(ctx.spawnCalls.length).toBe(2);
    expect(ctx.spawnCalls[0]).toEqual(["maw", "wake", "24-discord-oracle"]);
    expect(ctx.spawnCalls[1]).toEqual(["maw", "tmux", "attach", "24-discord-oracle"]);
  } finally {
    ctx.restore();
  }
});

test("handler: Tier 2 dry-run — no spawn, says 'would wake … then attach'", async () => {
  const ctx = setupHandlerMocks({
    fleet: [{ name: "24-discord-oracle", windows: [{ name: "x" }] }],
  });
  try {
    const handler = (await import("./index")).default;
    const result = await handler({ source: "cli", args: ["discord-oracle", "--dry-run"], writer: undefined } as any);
    expect(result.ok).toBe(true);
    expect(ctx.spawnCalls.length).toBe(0);
    expect(result.output).toMatch(/Tier 2/);
    expect(result.output).toMatch(/would wake/);
  } finally {
    ctx.restore();
  }
});

test("handler: no match — returns error listing availables", async () => {
  const ctx = setupHandlerMocks({
    sessions: [{ name: "foo-oracle", windows: [{ name: "x" }] }],
    fleet: [{ name: "bar-oracle", windows: [{ name: "x" }] }],
  });
  try {
    const handler = (await import("./index")).default;
    const result = await handler({ source: "cli", args: ["nonexistent"], writer: undefined } as any);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/no oracle named 'nonexistent'/);
    expect(result.output).toMatch(/foo-oracle/);
    expect(result.output).toMatch(/bar-oracle/);
    expect(ctx.spawnCalls.length).toBe(0);
  } finally {
    ctx.restore();
  }
});

test("handler: ambiguous match — stops without spawning", async () => {
  const ctx = setupHandlerMocks({
    sessions: [
      { name: "24-discord-oracle", windows: [{ name: "x" }] },
      { name: "99-discord-oracle", windows: [{ name: "x" }] },
    ],
  });
  try {
    const handler = (await import("./index")).default;
    const result = await handler({ source: "cli", args: ["discord-oracle"], writer: undefined } as any);
    expect(result.ok).toBe(false);
    expect(result.output).toMatch(/ambiguous/);
    expect(ctx.spawnCalls.length).toBe(0);
  } finally {
    ctx.restore();
  }
});

test("handler: missing name returns usage", async () => {
  const ctx = setupHandlerMocks({});
  try {
    const handler = (await import("./index")).default;
    const result = await handler({ source: "cli", args: [], writer: undefined } as any);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/usage/);
  } finally {
    ctx.restore();
  }
});

test("API: dispatch invokes the cascade with yes=true (no TTY)", async () => {
  const ctx = setupHandlerMocks({
    fleet: [{ name: "24-foo-oracle", windows: [{ name: "x" }] }],
  });
  try {
    const handler = (await import("./index")).default;
    const result = await handler({ source: "api", args: { name: "foo-oracle" } } as any);
    expect(result.ok).toBe(true);
    expect(ctx.spawnCalls.length).toBe(2);
    expect(ctx.spawnCalls[0]).toEqual(["maw", "wake", "24-foo-oracle"]);
  } finally {
    ctx.restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Tier 3 — cross-node attach (#1236)
// ─────────────────────────────────────────────────────────────────────────────

test("resolveSshAlias: namedPeers[n].ssh override beats URL hostname", () => {
  const alias = resolveSshAlias(
    "http://mba.wg:9090",
    "mba",
    [{ name: "mba", url: "http://mba.wg:9090", ssh: "mba-tunnel" }],
  );
  expect(alias).toBe("mba-tunnel");
});

test("resolveSshAlias: URL hostname fallback when no override", () => {
  const alias = resolveSshAlias("http://mba.wg:9090", "mba", []);
  expect(alias).toBe("mba.wg");
});

test("resolveSshAlias: literal node name when URL is unparseable", () => {
  const alias = resolveSshAlias("not-a-url-at-all", "mba", []);
  expect(alias).toBe("mba");
});

test("remote resolver: Tier 3 — single peer match", async () => {
  const r = await resolveRemoteAttachTarget("homekeeper", {
    getAggregatedSessions: async () => [
      { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
    ],
    namedPeers: () => [],
  });
  expect(r?.kind).toBe("match");
  if (r?.kind !== "match") return;
  expect(r.match.sessionName).toBe("24-homekeeper");
  expect(r.match.node).toBe("mba");
  expect(r.match.sshAlias).toBe("mba.wg");
});

test("remote resolver: ignores local-tagged rows (those belong to Tier 1)", async () => {
  const r = await resolveRemoteAttachTarget("homekeeper", {
    getAggregatedSessions: async () => [
      { name: "homekeeper", windows: [{ name: "x" }], source: "local" },
    ],
    namedPeers: () => [],
  });
  expect(r).toBeNull();
});

test("remote resolver: multiple peers expose same name → ambiguous", async () => {
  const r = await resolveRemoteAttachTarget("homekeeper", {
    getAggregatedSessions: async () => [
      { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
      { name: "30-homekeeper", windows: [{ name: "x" }], source: "http://white.wg:9090", node: "white" },
    ],
    namedPeers: () => [],
  });
  expect(r?.kind).toBe("ambiguous");
  if (r?.kind !== "ambiguous") return;
  expect(r.candidates.length).toBe(2);
});

test("cascade: bare name with NO local match falls through to Tier 3", async () => {
  const result = await resolveAttachTarget("homekeeper", makeRemoteDeps({
    aggregated: [
      { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
    ],
  }));
  expect(result?.tier).toBe(3);
  if (result?.tier !== 3) return;
  expect(result.node).toBe("mba");
  expect(result.peerUrl).toBe("http://mba.wg:9090");
  expect(result.sshAlias).toBe("mba.wg");
});

test("cascade: ambiguity local+remote → prefer LOCAL, surface remote as alternates", async () => {
  const result = await resolveAttachTarget("homekeeper", makeRemoteDeps({
    sessions: [{ name: "homekeeper", windows: [{ name: "x" }] }],
    aggregated: [
      { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
    ],
  }));
  expect(result?.tier).toBe(1);
  if (result?.tier !== 1) return;
  expect(result.sessionName).toBe("homekeeper");
  expect(result.remoteAlternates?.length).toBe(1);
  expect(result.remoteAlternates?.[0].node).toBe("mba");
});

test("cascade: --remote-only skips Tier 1/2 and goes straight to Tier 3", async () => {
  const result = await resolveAttachTarget(
    "homekeeper",
    makeRemoteDeps({
      // Local has it AND a fleet entry has it — neither should win under remote-only.
      sessions: [{ name: "homekeeper", windows: [{ name: "x" }] }],
      fleet: [{ name: "homekeeper", windows: [{ name: "x" }] }],
      aggregated: [
        { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
      ],
    }),
    { remoteOnly: true },
  );
  expect(result?.tier).toBe(3);
});

test("cascade: explicit node:agent syntax short-circuits past Tier 1/2", async () => {
  const result = await resolveAttachTarget(
    "mba:homekeeper",
    makeRemoteDeps({
      sessions: [{ name: "homekeeper", windows: [{ name: "x" }] }],
      aggregated: [
        { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
      ],
    }),
  );
  expect(result?.tier).toBe(3);
  if (result?.tier !== 3) return;
  expect(result.node).toBe("mba");
});

test("cascade: bare name + no local + no remote → null", async () => {
  const result = await resolveAttachTarget("ghost", makeRemoteDeps({
    aggregated: [
      { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
    ],
  }));
  expect(result).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Tier 3 handler — SSH failure UX
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tier 3 handler tests stub `getAggregatedSessions` + `attachRemoteSession`
 * via mock.module on maw-js/sdk. cmdAttach reads the SDK directly so its
 * Tier 3 branch resolves to our fakes.
 */
function setupTier3Mocks(opts: {
  aggregated?: AggregatedSessionLike[];
  namedPeers?: PeerConfig[];
  sshThrows?: { kind: "unreachable" | "auth-failed" | "tmux-missing"; message: string };
}) {
  const sshCalls: any[] = [];

  // Build the SshAttachError-shaped throw without depending on the real class
  // (mock.module replaces the whole sdk surface, so we re-export a minimal
  // class that satisfies `instanceof SshAttachError` in the handler).
  class FakeSshAttachError extends Error {
    kind: string;
    constructor(kind: string, message: string) {
      super(message);
      this.kind = kind;
      this.name = "SshAttachError";
    }
  }

  mock.module("maw-js/sdk", () => ({
    listSessions: async () => [],
    getAggregatedSessions: async () => opts.aggregated ?? [],
    SshAttachError: FakeSshAttachError,
    attachRemoteSession: (sshArgs: any) => {
      sshCalls.push(sshArgs);
      if (opts.sshThrows) {
        throw new FakeSshAttachError(opts.sshThrows.kind, opts.sshThrows.message);
      }
    },
  }));
  mock.module("maw-js/commands/shared/fleet-load", () => ({
    loadFleet: () => [],
  }));
  mock.module("maw-js/config", () => ({
    loadConfig: () => ({ namedPeers: opts.namedPeers ?? [] }),
  }));

  const realSpawn = Bun.spawn;
  (Bun as any).spawn = () => ({ exited: Promise.resolve(0) });

  return {
    sshCalls,
    restore: () => {
      (Bun as any).spawn = realSpawn;
      mock.restore();
    },
  };
}

test("Tier 3 handler: happy path — calls attachRemoteSession with right args", async () => {
  const ctx = setupTier3Mocks({
    aggregated: [
      { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
    ],
  });
  try {
    const { cmdAttach } = await import("./impl");
    await cmdAttach("homekeeper", { sleep: async () => {} });
    expect(ctx.sshCalls.length).toBe(1);
    expect(ctx.sshCalls[0]).toEqual({
      node: "mba",
      sshAlias: "mba.wg",
      sessionName: "24-homekeeper",
    });
  } finally {
    ctx.restore();
  }
});

test("Tier 3 handler: namedPeers.ssh override is used as sshAlias", async () => {
  const ctx = setupTier3Mocks({
    aggregated: [
      { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
    ],
    namedPeers: [{ name: "mba", url: "http://mba.wg:9090", ssh: "mba-tunnel" }],
  });
  try {
    const { cmdAttach } = await import("./impl");
    await cmdAttach("homekeeper", { sleep: async () => {} });
    expect(ctx.sshCalls[0].sshAlias).toBe("mba-tunnel");
  } finally {
    ctx.restore();
  }
});

test("Tier 3 handler: dry-run prints plan without calling SSH", async () => {
  const ctx = setupTier3Mocks({
    aggregated: [
      { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
    ],
  });
  try {
    const { cmdAttach } = await import("./impl");
    await cmdAttach("homekeeper", { dryRun: true });
    expect(ctx.sshCalls.length).toBe(0);
  } finally {
    ctx.restore();
  }
});

test("Tier 3 handler: ssh exit 255 / Connection refused → throws UserError-ish", async () => {
  const ctx = setupTier3Mocks({
    aggregated: [
      { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
    ],
    sshThrows: { kind: "unreachable", message: "✗ can't reach mba via ssh — try: ssh mba.wg" },
  });
  try {
    const { cmdAttach } = await import("./impl");
    let threw: Error | null = null;
    try { await cmdAttach("homekeeper", { sleep: async () => {} }); } catch (e) { threw = e as Error; }
    expect(threw).not.toBeNull();
    expect(threw!.message).toContain("can't reach mba");
  } finally {
    ctx.restore();
  }
});

test("Tier 3 handler: Permission denied → auth-failed UserError", async () => {
  const ctx = setupTier3Mocks({
    aggregated: [
      { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
    ],
    sshThrows: { kind: "auth-failed", message: "✗ no SSH key for mba — ssh-add ~/.ssh/<your-key>" },
  });
  try {
    const { cmdAttach } = await import("./impl");
    let threw: Error | null = null;
    try { await cmdAttach("homekeeper", { sleep: async () => {} }); } catch (e) { threw = e as Error; }
    expect(threw).not.toBeNull();
    expect(threw!.message).toContain("no SSH key for mba");
  } finally {
    ctx.restore();
  }
});

test("Tier 3 handler: tmux not installed on remote → tmux-missing UserError", async () => {
  const ctx = setupTier3Mocks({
    aggregated: [
      { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
    ],
    sshThrows: { kind: "tmux-missing", message: "✗ tmux not installed on mba" },
  });
  try {
    const { cmdAttach } = await import("./impl");
    let threw: Error | null = null;
    try { await cmdAttach("homekeeper", { sleep: async () => {} }); } catch (e) { threw = e as Error; }
    expect(threw).not.toBeNull();
    expect(threw!.message).toContain("tmux not installed on mba");
  } finally {
    ctx.restore();
  }
});

test("Tier 3 handler: ambiguous across peers — refuses, prints pin hint", async () => {
  const ctx = setupTier3Mocks({
    aggregated: [
      { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
      { name: "30-homekeeper", windows: [{ name: "x" }], source: "http://white.wg:9090", node: "white" },
    ],
  });
  try {
    const { cmdAttach } = await import("./impl");
    let threw: Error | null = null;
    try { await cmdAttach("homekeeper", { sleep: async () => {} }); } catch (e) { threw = e as Error; }
    expect(threw).not.toBeNull();
    expect(threw!.message).toMatch(/ambiguous/i);
    expect(ctx.sshCalls.length).toBe(0);
  } finally {
    ctx.restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Tier 3 strategy hints (#1289) — print alternatives before auto-SSH
// ─────────────────────────────────────────────────────────────────────────────

test("Tier 3 hints: hint lines print BEFORE the SSH call", async () => {
  const ctx = setupTier3Mocks({
    aggregated: [
      { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
    ],
  });
  const lines: string[] = [];
  const origLog = console.log;
  let sshCalledAfterHints = false;
  console.log = (...a: any[]) => { lines.push(a.map(String).join(" ")); };
  try {
    const { cmdAttach } = await import("./impl");
    await cmdAttach("homekeeper", {
      sleep: async () => {
        // At sleep time, hints must already be in the buffer and SSH must not
        // have been called yet — proves ordering.
        sshCalledAfterHints = ctx.sshCalls.length === 0;
      },
    });
    console.log = origLog;

    const all = lines.join("\n");
    expect(all).toMatch(/maw clone homekeeper/);
    expect(all).toMatch(/maw sync homekeeper/);
    expect(all).toMatch(/auto-attaching via SSH in 1s/);
    expect(sshCalledAfterHints).toBe(true);
    expect(ctx.sshCalls.length).toBe(1);
  } finally {
    console.log = origLog;
    ctx.restore();
  }
});

test("Tier 3 --no-ssh: prints hints and exits without SSH-attaching", async () => {
  const ctx = setupTier3Mocks({
    aggregated: [
      { name: "24-homekeeper", windows: [{ name: "x" }], source: "http://mba.wg:9090", node: "mba" },
    ],
  });
  const lines: string[] = [];
  const origLog = console.log;
  console.log = (...a: any[]) => { lines.push(a.map(String).join(" ")); };
  try {
    const { cmdAttach } = await import("./impl");
    await cmdAttach("homekeeper", { noSsh: true, sleep: async () => {} });
    console.log = origLog;
    const all = lines.join("\n");
    expect(all).toMatch(/maw clone homekeeper/);
    expect(all).toMatch(/maw sync homekeeper/);
    expect(all).toMatch(/not attaching/);
    expect(ctx.sshCalls.length).toBe(0);
  } finally {
    console.log = origLog;
    ctx.restore();
  }
});
