/**
 * attach plugin tests (#25 Phase 1) — Smart Local.
 *
 * Two layers:
 *   1. Resolver — pure, no mocks, exercises Tier 1 / 2 / ambiguous / null
 *   2. Handler — mocks listSessions + loadFleet + the maw subprocess via
 *      mock.module on Bun.spawn, verifies the cascade emits the right command
 */

import { test, expect, mock } from "bun:test";
import {
  resolveAttachTarget,
  type SessionLike,
  type FleetLike,
} from "./resolve-attach-target";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Resolver tests
// ─────────────────────────────────────────────────────────────────────────────

function makeDeps(sessions: SessionLike[], fleet: FleetLike[]) {
  return {
    listSessions: async () => sessions,
    loadFleet: () => fleet,
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
// 1b. #1342 — fuzzy mode (post-wake re-resolve)
// ─────────────────────────────────────────────────────────────────────────────
//
// Strict mode is the default for every direct caller (`maw attach <name>`).
// Fuzzy is opt-in via `{ fuzzy: true }` and is ONLY used by cmdAttach's
// post-wake re-resolve path: wake resolves "wind" → "01-Somwind" but doesn't
// surface the resolved name to the caller, so the original input no longer
// matches under strict rules. Loosening the comparator catches wake's intent.
//
// Tests verify: fuzzy positive match, fuzzy false-positive guard, strict
// default preserved (bare fuzzy input misses), and exact-input still wins.

test("#1342 resolver: fuzzy mode — substring match resolves 'wind' → '01-Somwind'", async () => {
  const deps = makeDeps([{ name: "01-Somwind", windows: [{ name: "Somwind-oracle" }] }], []);
  const r = await resolveAttachTarget("wind", deps, { fuzzy: true });
  expect(r).toEqual({ tier: 1, sessionName: "01-Somwind" });
});

test("#1342 resolver: fuzzy mode — case-insensitive substring ('WIND' → '01-Somwind')", async () => {
  const deps = makeDeps([{ name: "01-Somwind", windows: [{ name: "x" }] }], []);
  const r = await resolveAttachTarget("WIND", deps, { fuzzy: true });
  expect(r).toEqual({ tier: 1, sessionName: "01-Somwind" });
});

test("#1342 resolver: fuzzy mode — non-match still returns null (no false positives)", async () => {
  const deps = makeDeps([{ name: "01-Somwind", windows: [{ name: "x" }] }], []);
  const r = await resolveAttachTarget("zebra", deps, { fuzzy: true });
  expect(r).toBeNull();
});

test("#1342 resolver: STRICT default preserved — bare 'wind' against '01-Somwind' → null", async () => {
  // Regression test for the very bug #1342 fixes: under strict rules, the
  // post-wake re-resolve missed the freshly-created session because the
  // resolved name wasn't surfaced. This confirms strict mode (the default
  // for every other caller) is unchanged — only the opt-in fuzzy path loosens.
  const deps = makeDeps([{ name: "01-Somwind", windows: [{ name: "x" }] }], []);
  const r = await resolveAttachTarget("wind", deps);
  expect(r).toBeNull();
});

test("#1342 resolver: STRICT default — bare fuzzy input misses without opts.fuzzy", async () => {
  const deps = makeDeps([{ name: "01-Somwind", windows: [{ name: "x" }] }], []);
  const r = await resolveAttachTarget("wind", deps, { fuzzy: false });
  expect(r).toBeNull();
});

test("#1342 resolver: exact name still wins under fuzzy mode (no degradation)", async () => {
  const deps = makeDeps([{ name: "01-Somwind", windows: [{ name: "x" }] }], []);
  const r = await resolveAttachTarget("01-Somwind", deps, { fuzzy: true });
  expect(r).toEqual({ tier: 1, sessionName: "01-Somwind" });
});

test("#1342 resolver: slot-suffix match still works under fuzzy mode", async () => {
  // Strict rule (n.endsWith(`-${t}`)) should still pass first under fuzzy.
  const deps = makeDeps([{ name: "24-discord-oracle", windows: [{ name: "x" }] }], []);
  const r = await resolveAttachTarget("discord-oracle", deps, { fuzzy: true });
  expect(r).toEqual({ tier: 1, sessionName: "24-discord-oracle" });
});

test("#1342 resolver: fuzzy reaches Tier 2 — substring matches sleeping fleet entry", async () => {
  const deps = makeDeps([], [{ name: "01-Somwind", windows: [{ name: "x" }] }]);
  const r = await resolveAttachTarget("wind", deps, { fuzzy: true });
  expect(r).toEqual({ tier: 2, fleetName: "01-Somwind" });
});

test("#1342 resolver: fuzzy with empty target string → null (defensive)", async () => {
  // Guard against `t.length > 0` regression — empty target must never match
  // every session via the includes("") short-circuit.
  const deps = makeDeps([{ name: "01-Somwind", windows: [{ name: "x" }] }], []);
  const r = await resolveAttachTarget("", deps, { fuzzy: true });
  expect(r).toBeNull();
});

test("#1342 resolver: fuzzy match still detects ambiguity", async () => {
  // Two sessions both contain "win" — fuzzy must report ambiguous, not
  // silently pick one. Same surface the strict-mode ambiguous case provides.
  const deps = makeDeps(
    [
      { name: "01-Somwind", windows: [{ name: "x" }] },
      { name: "02-Winterfell", windows: [{ name: "x" }] },
    ],
    [],
  );
  const r = await resolveAttachTarget("win", deps, { fuzzy: true });
  expect(r?.tier).toBe(1);
  expect(r?.ambiguousCandidates).toEqual(["01-Somwind", "02-Winterfell"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Handler tests — cascade + flag plumbing
// ─────────────────────────────────────────────────────────────────────────────

function setupHandlerMocks(opts: {
  sessions?: SessionLike[];
  fleet?: FleetLike[];
}) {
  const spawnCalls: string[][] = [];

  mock.module("maw-js/sdk", () => ({
    listSessions: async () => opts.sessions ?? [],
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

test("handler: no match — delegates to `maw wake <name>` then re-resolves", async () => {
  // Mock starts with no sessions for 'nonexistent'. After wake runs (mocked
  // as exit 0), the re-resolve still finds nothing → handler errors. In a
  // real run, wake would create the session and the second resolve hits Tier 1.
  const ctx = setupHandlerMocks({
    sessions: [{ name: "foo-oracle", windows: [{ name: "x" }] }],
    fleet: [{ name: "bar-oracle", windows: [{ name: "x" }] }],
  });
  try {
    const handler = (await import("./index")).default;
    const result = await handler({ source: "cli", args: ["nonexistent"], writer: undefined } as any);
    // Wake was attempted
    expect(ctx.spawnCalls.length).toBeGreaterThanOrEqual(1);
    expect(ctx.spawnCalls[0]).toEqual(["maw", "wake", "nonexistent"]);
    expect(result.output).toMatch(/not local — delegating to wake/);
    // Re-resolve missed (mock didn't add a new session) → error path
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/wake did not create a session/);
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
