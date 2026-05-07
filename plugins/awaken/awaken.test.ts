/**
 * awaken — composition + dispatch tests.
 *
 * 3 layers:
 *   1. CLI test  — handler arg parsing (flag forwarding to cmdBud, --no-trigger, --trigger override)
 *   2. Call test — cmdAwaken composes bud + sendText (with stubs)
 *   3. Smoke test — dry-run end-to-end through handler
 */

import { test, expect, mock } from "bun:test";

// Stub out cmdBud + cmdSendText + sdk so awaken.test.ts can run without
// real GitHub / tmux. Each test re-imports `./impl` after mocking so
// module bindings pick up the stubs.

function setupHappyPathMocks() {
  const calls = {
    bud: [] as Array<{ name: string; opts: any }>,
    sendText: [] as Array<{ target: string; text: string }>,
  };

  mock.module("../bud/impl", () => ({
    cmdBud: async (name: string, opts: any) => {
      calls.bud.push({ name, opts });
    },
  }));

  mock.module("../send-text/impl", () => ({
    cmdSendText: async (opts: any) => {
      calls.sendText.push(opts);
    },
  }));

  mock.module("maw-js/sdk", () => ({
    listSessions: async () => [{ name: "01-foo", windows: [{ name: "foo" }] }],
    resolveTarget: () => ({ type: "local", target: "01-foo:foo" }),
  }));

  mock.module("maw-js/config", () => ({ loadConfig: () => ({}) }));
  mock.module("maw-js/cli/parse-args", () => ({
    parseFlags: (args: string[], schema: any, _positional: number) => {
      const out: any = { _: [] };
      for (let i = 0; i < args.length; i++) {
        const a = args[i];
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

  return calls;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CLI tests — handler dispatch + flag forwarding
// ─────────────────────────────────────────────────────────────────────────────

test("CLI: missing name returns usage error", async () => {
  setupHappyPathMocks();
  const handler = (await import("./index")).default;
  const result = await handler({ source: "cli", args: [], writer: () => {} } as any);
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/usage/);
  mock.restore();
});

test("CLI: name starting with dash treated as flag-mistake", async () => {
  setupHappyPathMocks();
  const handler = (await import("./index")).default;
  // Single-dash arg lands as positional in our mock parser → triggers the
  // "looks like a flag" guard since name.startsWith("-").
  const result = await handler({
    source: "cli",
    args: ["-bad-name"],
    writer: () => {},
  } as any);
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/looks like a flag/);
  mock.restore();
});

test("CLI: --from forwarded to cmdBud", async () => {
  const calls = setupHappyPathMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "cli",
    args: ["foo-stem", "--from", "neo"],
    writer: () => {},
  } as any);
  expect(result.ok).toBe(true);
  expect(calls.bud[0].name).toBe("foo-stem");
  expect(calls.bud[0].opts.from).toBe("neo");
  mock.restore();
});

test("CLI: all bud flags forward (parity with maw bud)", async () => {
  const calls = setupHappyPathMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "cli",
    args: [
      "newoarcle",
      "--from",
      "neo",
      "--org",
      "Soul-Brews-Studio",
      "--repo",
      "Soul-Brews-Studio/template",
      "--issue",
      "42",
      "--note",
      "born for tor workshop",
      "--nickname",
      "Newoarcle",
      "--fast",
      "--seed",
      "--split",
    ],
    writer: () => {},
  } as any);
  expect(result.ok).toBe(true);
  const bud = calls.bud[0].opts;
  expect(bud.from).toBe("neo");
  expect(bud.org).toBe("Soul-Brews-Studio");
  expect(bud.repo).toBe("Soul-Brews-Studio/template");
  expect(bud.issue).toBe(42);
  expect(bud.note).toBe("born for tor workshop");
  expect(bud.nickname).toBe("Newoarcle");
  expect(bud.fast).toBe(true);
  expect(bud.seed).toBe(true);
  expect(bud.split).toBe(true);
  mock.restore();
});

test("CLI: --no-trigger skips sendText", async () => {
  const calls = setupHappyPathMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "cli",
    args: ["foo", "--root", "--no-trigger"],
    writer: () => {},
  } as any);
  expect(result.ok).toBe(true);
  expect(calls.bud.length).toBe(1);
  expect(calls.sendText.length).toBe(0);
  mock.restore();
});

test("CLI: --trigger overrides default /awaken", async () => {
  const calls = setupHappyPathMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "cli",
    args: ["foo", "--root", "--trigger", "/awaken --fast"],
    writer: () => {},
  } as any);
  expect(result.ok).toBe(true);
  expect(calls.sendText.length).toBe(1);
  expect(calls.sendText[0].text).toBe("/awaken --fast");
  mock.restore();
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Call tests — cmdAwaken composes bud + sendText directly
// ─────────────────────────────────────────────────────────────────────────────

test("call: cmdAwaken composes bud → sendText('/awaken')", async () => {
  const calls = setupHappyPathMocks();
  const { cmdAwaken } = await import("./impl");
  await cmdAwaken("foo-stem", { from: "neo" });
  expect(calls.bud.length).toBe(1);
  expect(calls.bud[0].opts.from).toBe("neo");
  expect(calls.sendText.length).toBe(1);
  expect(calls.sendText[0].target).toBe("foo-stem");
  expect(calls.sendText[0].text).toBe("/awaken");
  mock.restore();
});

test("call: cmdAwaken with --no-trigger does NOT send", async () => {
  const calls = setupHappyPathMocks();
  const { cmdAwaken } = await import("./impl");
  await cmdAwaken("foo", { root: true, noTrigger: true });
  expect(calls.bud.length).toBe(1);
  expect(calls.sendText.length).toBe(0);
  mock.restore();
});

test("call: cmdAwaken --dry-run logs intent without sending", async () => {
  const calls = setupHappyPathMocks();
  const { cmdAwaken } = await import("./impl");
  await cmdAwaken("foo", { root: true, dryRun: true });
  expect(calls.bud.length).toBe(1);
  // dry-run should NOT call sendText
  expect(calls.sendText.length).toBe(0);
  mock.restore();
});

test("call: send-text failure does not throw (logged + recoverable)", async () => {
  setupHappyPathMocks();
  // Override sendText to throw
  mock.module("../send-text/impl", () => ({
    cmdSendText: async () => {
      throw new Error("tmux pane dead");
    },
  }));
  const { cmdAwaken } = await import("./impl");
  // Should NOT throw — graceful degradation per Q2 (no-wait / robust)
  await expect(cmdAwaken("foo", { root: true })).resolves.toBeUndefined();
  mock.restore();
});

test("call: unresolvable target after wake → warn but no throw", async () => {
  setupHappyPathMocks();
  mock.module("maw-js/sdk", () => ({
    listSessions: async () => [],
    resolveTarget: () => null, // unresolvable
  }));
  const { cmdAwaken } = await import("./impl");
  await expect(cmdAwaken("ghost-oracle", { root: true })).resolves.toBeUndefined();
  mock.restore();
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Smoke test — full handler end-to-end via dry-run (no real bud/wake)
// ─────────────────────────────────────────────────────────────────────────────

test("smoke: handler dry-run returns ok without side effects", async () => {
  const calls = setupHappyPathMocks();
  const handler = (await import("./index")).default;
  const writes: string[] = [];
  const result = await handler({
    source: "cli",
    args: ["smoke-test-oracle", "--root", "--dry-run"],
    writer: (...a: any[]) => writes.push(a.map(String).join(" ")),
  } as any);

  expect(result.ok).toBe(true);
  expect(calls.bud.length).toBe(1);
  expect(calls.bud[0].opts.dryRun).toBe(true);
  // dry-run should NOT actually send
  expect(calls.sendText.length).toBe(0);
  // But should log the intent
  expect(writes.some((s) => s.includes("/awaken"))).toBe(true);
  mock.restore();
});

test("smoke: API dispatch with name+from", async () => {
  const calls = setupHappyPathMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "api",
    args: { name: "api-oracle", from: "neo", noTrigger: true },
  } as any);
  expect(result.ok).toBe(true);
  expect(calls.bud.length).toBe(1);
  expect(calls.bud[0].opts.from).toBe("neo");
  expect(calls.sendText.length).toBe(0); // noTrigger
  mock.restore();
});

test("smoke: API dispatch missing name returns error", async () => {
  setupHappyPathMocks();
  const handler = (await import("./index")).default;
  const result = await handler({ source: "api", args: {} } as any);
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/name required/);
  mock.restore();
});
