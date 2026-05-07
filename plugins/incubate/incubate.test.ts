/**
 * incubate — thin-router tests for `maw incubate`.
 *
 * 3 layers:
 *   1. CLI test  — buildSkillCommand + resolveMode + handler arg parsing
 *   2. Call test — cmdIncubate composition (with stubbed send-text + sdk)
 *   3. Smoke test — full handler dispatch via dry-run
 */

import { test, expect, mock } from "bun:test";
import {
  buildSkillCommand,
  resolveMode,
  inferCurrentOracle,
} from "./impl";

// ─────────────────────────────────────────────────────────────────────────────
// 1. CLI tests — pure helpers (no IO)
// ─────────────────────────────────────────────────────────────────────────────

test("buildSkillCommand: bare source", () => {
  expect(buildSkillCommand({ source: "Soul-Brews-Studio/foo" })).toBe(
    "/incubate Soul-Brews-Studio/foo",
  );
});

test("buildSkillCommand: source + flash", () => {
  expect(
    buildSkillCommand({ source: "org/foo", mode: "flash" }),
  ).toBe("/incubate org/foo --flash");
});

test("buildSkillCommand: source + contribute", () => {
  expect(
    buildSkillCommand({ source: "org/foo", mode: "contribute" }),
  ).toBe("/incubate org/foo --contribute");
});

test("buildSkillCommand: status alone (no source needed)", () => {
  expect(buildSkillCommand({ mode: "status" })).toBe("/incubate --status");
});

test("buildSkillCommand: offload + source", () => {
  expect(
    buildSkillCommand({ source: "org/foo", mode: "offload" }),
  ).toBe("/incubate org/foo --offload");
});

test("buildSkillCommand: init alone", () => {
  expect(buildSkillCommand({ init: true })).toBe("/incubate --init");
});

test("buildSkillCommand: trigger override wins (custom)", () => {
  expect(
    buildSkillCommand({ source: "org/foo", trigger: "/incubate-mine" }),
  ).toBe("/incubate-mine");
});

test("resolveMode: no flags → default", () => {
  expect(resolveMode(false, false, false, false)).toBe("default");
});

test("resolveMode: --flash", () => {
  expect(resolveMode(true, false, false, false)).toBe("flash");
});

test("resolveMode: --status", () => {
  expect(resolveMode(false, false, true, false)).toBe("status");
});

test("resolveMode: throws on multiple modes", () => {
  expect(() => resolveMode(true, true, false, false)).toThrow(
    /mutually exclusive/,
  );
  expect(() => resolveMode(true, false, true, false)).toThrow(
    /mutually exclusive/,
  );
  expect(() => resolveMode(false, true, true, true)).toThrow(
    /mutually exclusive/,
  );
});

test("inferCurrentOracle: returns null for /tmp", () => {
  // /tmp doesn't have CLAUDE.md or ψ
  expect(inferCurrentOracle("/tmp")).toBeNull();
});

test("inferCurrentOracle: detects mawjs-oracle from its own cwd", () => {
  // Walking up from a known oracle subdir should land on the oracle
  const oracle = inferCurrentOracle(
    "/Users/nat/Code/github.com/Soul-Brews-Studio/mawjs-oracle/scripts",
  );
  expect(oracle).toBe("mawjs");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Call tests — cmdIncubate composes with stubbed send-text + sdk
// ─────────────────────────────────────────────────────────────────────────────

function setupHappyPathMocks() {
  const calls = {
    sendText: [] as Array<{ target: string; text: string }>,
  };

  mock.module("../send-text/impl", () => ({
    cmdSendText: async (opts: { target: string; text: string }) => {
      calls.sendText.push(opts);
    },
  }));

  mock.module("maw-js/sdk", () => ({
    listSessions: async () => [{ name: "01-foo", windows: [{ name: "foo" }] }],
    resolveTarget: () => ({ type: "local", target: "01-foo:foo" }),
  }));

  mock.module("maw-js/config", () => ({ loadConfig: () => ({}) }));

  return calls;
}

test("call: cmdIncubate fires /incubate with source + explicit oracle", async () => {
  const calls = setupHappyPathMocks();
  const { cmdIncubate } = await import("./impl");

  await cmdIncubate({
    source: "org/foo",
    oracle: "mawjs",
  });

  expect(calls.sendText.length).toBe(1);
  expect(calls.sendText[0].target).toBe("mawjs");
  expect(calls.sendText[0].text).toBe("/incubate org/foo");
  mock.restore();
});

test("call: cmdIncubate with --flash mode passes through", async () => {
  const calls = setupHappyPathMocks();
  const { cmdIncubate } = await import("./impl");

  await cmdIncubate({
    source: "org/foo",
    oracle: "mawjs",
    mode: "flash",
  });

  expect(calls.sendText[0].text).toBe("/incubate org/foo --flash");
  mock.restore();
});

test("call: cmdIncubate --status without source works", async () => {
  const calls = setupHappyPathMocks();
  const { cmdIncubate } = await import("./impl");

  await cmdIncubate({
    oracle: "mawjs",
    mode: "status",
  });

  expect(calls.sendText[0].text).toBe("/incubate --status");
  mock.restore();
});

test("call: cmdIncubate --init without source works", async () => {
  const calls = setupHappyPathMocks();
  const { cmdIncubate } = await import("./impl");

  await cmdIncubate({
    oracle: "mawjs",
    init: true,
  });

  expect(calls.sendText[0].text).toBe("/incubate --init");
  mock.restore();
});

test("call: cmdIncubate --no-trigger does NOT send", async () => {
  const calls = setupHappyPathMocks();
  const { cmdIncubate } = await import("./impl");

  await cmdIncubate({
    source: "org/foo",
    oracle: "mawjs",
    noTrigger: true,
  });

  expect(calls.sendText.length).toBe(0);
  mock.restore();
});

test("call: cmdIncubate --dry-run does NOT send", async () => {
  const calls = setupHappyPathMocks();
  const { cmdIncubate } = await import("./impl");

  await cmdIncubate({
    source: "org/foo",
    oracle: "mawjs",
    dryRun: true,
  });

  expect(calls.sendText.length).toBe(0);
  mock.restore();
});

test("call: missing source + non-status mode throws usage", async () => {
  setupHappyPathMocks();
  const { cmdIncubate } = await import("./impl");
  await expect(
    cmdIncubate({ oracle: "mawjs", mode: "default" }),
  ).rejects.toThrow(/usage/);
  mock.restore();
});

test("call: unresolvable oracle throws", async () => {
  mock.module("../send-text/impl", () => ({
    cmdSendText: async () => {},
  }));
  mock.module("maw-js/sdk", () => ({
    listSessions: async () => [],
    resolveTarget: () => null,
  }));
  mock.module("maw-js/config", () => ({ loadConfig: () => ({}) }));

  const { cmdIncubate } = await import("./impl");
  await expect(
    cmdIncubate({ source: "org/foo", oracle: "ghost-oracle" }),
  ).rejects.toThrow(/could not resolve oracle/);
  mock.restore();
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Smoke test — full handler dispatch
// ─────────────────────────────────────────────────────────────────────────────

function setupHandlerMocks() {
  const calls = setupHappyPathMocks();
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

test("smoke: handler CLI dispatch with source + --oracle", async () => {
  const calls = setupHandlerMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "cli",
    args: ["org/foo", "--oracle", "mawjs"],
    writer: () => {},
  } as any);

  expect(result.ok).toBe(true);
  expect(calls.sendText[0].text).toBe("/incubate org/foo");
  expect(calls.sendText[0].target).toBe("mawjs");
  mock.restore();
});

test("smoke: handler CLI --flash passes through", async () => {
  const calls = setupHandlerMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "cli",
    args: ["org/foo", "--oracle", "mawjs", "--flash"],
    writer: () => {},
  } as any);

  expect(result.ok).toBe(true);
  expect(calls.sendText[0].text).toBe("/incubate org/foo --flash");
  mock.restore();
});

test("smoke: handler CLI --status with no source", async () => {
  const calls = setupHandlerMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "cli",
    args: ["--oracle", "mawjs", "--status"],
    writer: () => {},
  } as any);

  expect(result.ok).toBe(true);
  expect(calls.sendText[0].text).toBe("/incubate --status");
  mock.restore();
});

test("smoke: handler rejects mutually exclusive modes", async () => {
  setupHandlerMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "cli",
    args: ["org/foo", "--oracle", "mawjs", "--flash", "--contribute"],
    writer: () => {},
  } as any);

  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/mutually exclusive/);
  mock.restore();
});

test("smoke: handler rejects flag-shaped source", async () => {
  setupHandlerMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "cli",
    args: ["-bad", "--oracle", "mawjs"],
    writer: () => {},
  } as any);

  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/looks like a flag/);
  mock.restore();
});

test("smoke: API dispatch", async () => {
  const calls = setupHandlerMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "api",
    args: { source: "org/api-test", oracle: "mawjs", mode: "flash" },
  } as any);

  expect(result.ok).toBe(true);
  expect(calls.sendText[0].text).toBe("/incubate org/api-test --flash");
  mock.restore();
});

test("smoke: API rejects invalid mode", async () => {
  setupHandlerMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "api",
    args: { source: "org/foo", oracle: "mawjs", mode: "garbage" },
  } as any);

  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/invalid mode/);
  mock.restore();
});
