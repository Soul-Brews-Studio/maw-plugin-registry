/**
 * send-text — argument parser + handler tests.
 *
 * 3 layers:
 *   1. CLI test  — parseSendTextArgs (string-array → SendTextOpts)
 *   2. Call test — cmdSendText programmatic invocation (with stub Tmux)
 *   3. Smoke test — full handler dispatch via invokeContext shape
 */

import { test, expect, mock } from "bun:test";
import { parseSendTextArgs } from "./impl";

// ─────────────────────────────────────────────────────────────────────────────
// 1. CLI tests — parser only (no IO)
// ─────────────────────────────────────────────────────────────────────────────

test("parseSendTextArgs: target + single-word text", () => {
  const opts = parseSendTextArgs(["mba:sloworacle", "echo"]);
  expect(opts.target).toBe("mba:sloworacle");
  expect(opts.text).toBe("echo");
});

test("parseSendTextArgs: target + multi-word text joined with spaces", () => {
  const opts = parseSendTextArgs(["mba:sloworacle", "echo", "hello", "world"]);
  expect(opts.target).toBe("mba:sloworacle");
  expect(opts.text).toBe("echo hello world");
});

test("parseSendTextArgs: text with shell metacharacters preserved", () => {
  const opts = parseSendTextArgs(["local:bash-pane", "ls", "|", "grep", "foo"]);
  expect(opts.text).toBe("ls | grep foo");
});

test("parseSendTextArgs: missing target throws", () => {
  expect(() => parseSendTextArgs([])).toThrow(/usage/);
});

test("parseSendTextArgs: missing text throws", () => {
  expect(() => parseSendTextArgs(["mba:sloworacle"])).toThrow(/text is required/);
});

test("parseSendTextArgs: cross-node target accepted", () => {
  const opts = parseSendTextArgs(["clinic:01-mawjs", "make", "test"]);
  expect(opts.target).toBe("clinic:01-mawjs");
  expect(opts.text).toBe("make test");
});

test("parseSendTextArgs: pane-specific target accepted", () => {
  const opts = parseSendTextArgs(["session:1.2", "exit"]);
  expect(opts.target).toBe("session:1.2");
  expect(opts.text).toBe("exit");
});

test("parseSendTextArgs: /awaken slash command (the awaken use case)", () => {
  const opts = parseSendTextArgs(["01-newoarcle:newoarcle", "/awaken"]);
  expect(opts.target).toBe("01-newoarcle:newoarcle");
  expect(opts.text).toBe("/awaken");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Call test — cmdSendText with mocked Tmux + resolveTarget
// ─────────────────────────────────────────────────────────────────────────────

test("cmdSendText: empty target throws (call-level guard)", async () => {
  // Re-import so mocks below don't pollute this minimal guard test
  const { cmdSendText } = await import("./impl");
  await expect(cmdSendText({ target: "", text: "x" })).rejects.toThrow(/usage/);
});

test("cmdSendText: empty text throws (call-level guard)", async () => {
  const { cmdSendText } = await import("./impl");
  await expect(cmdSendText({ target: "x", text: "" })).rejects.toThrow(/text is required/);
});

test("cmdSendText: unresolvable target throws", async () => {
  // Mock resolveTarget to return null (unresolvable)
  mock.module("maw-js/sdk", () => ({
    listSessions: async () => [],
    resolveTarget: () => null,
    Tmux: class {},
    curlFetch: async () => ({ ok: false }),
  }));
  mock.module("maw-js/config", () => ({ loadConfig: () => ({}) }));
  mock.module("maw-js/commands/shared/comm-send", () => ({
    resolveOraclePane: async (t: string) => t,
  }));

  // Re-import after mocks
  const { cmdSendText } = await import("./impl");
  await expect(cmdSendText({ target: "no-such-oracle", text: "/awaken" })).rejects.toThrow(/could not resolve/);
  mock.restore();
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Smoke test — full handler dispatch (CLI source)
// ─────────────────────────────────────────────────────────────────────────────

test("handler: CLI dispatch with valid args returns ok", async () => {
  const sentCalls: Array<{ target: string; text: string }> = [];
  mock.module("maw-js/sdk", () => ({
    listSessions: async () => [{ name: "01-foo", windows: [{ name: "foo" }] }],
    resolveTarget: () => ({ type: "local", target: "01-foo:foo" }),
    Tmux: class {
      async sendText(target: string, text: string) {
        sentCalls.push({ target, text });
      }
    },
    curlFetch: async () => ({ ok: true, data: { ok: true } }),
  }));
  mock.module("maw-js/config", () => ({ loadConfig: () => ({}) }));
  mock.module("maw-js/commands/shared/comm-send", () => ({
    resolveOraclePane: async (t: string) => t,
  }));

  const handler = (await import("./index")).default;
  const writes: string[] = [];
  const result = await handler({
    source: "cli",
    args: ["01-foo", "/awaken"],
    writer: (...a: any[]) => writes.push(a.map(String).join(" ")),
  } as any);

  expect(result.ok).toBe(true);
  expect(sentCalls.length).toBe(1);
  expect(sentCalls[0].target).toBe("01-foo:foo");
  expect(sentCalls[0].text).toBe("/awaken");
  expect(writes.some((s) => s.includes("/awaken"))).toBe(true);
  mock.restore();
});

test("handler: API dispatch with target+text body", async () => {
  const sentCalls: Array<{ target: string; text: string }> = [];
  mock.module("maw-js/sdk", () => ({
    listSessions: async () => [],
    resolveTarget: () => ({ type: "local", target: "01-bar:bar" }),
    Tmux: class {
      async sendText(target: string, text: string) {
        sentCalls.push({ target, text });
      }
    },
    curlFetch: async () => ({ ok: true, data: { ok: true } }),
  }));
  mock.module("maw-js/config", () => ({ loadConfig: () => ({}) }));
  mock.module("maw-js/commands/shared/comm-send", () => ({
    resolveOraclePane: async (t: string) => t,
  }));

  const handler = (await import("./index")).default;
  const result = await handler({
    source: "api",
    args: { target: "bar", text: "echo from api" },
  } as any);

  expect(result.ok).toBe(true);
  expect(sentCalls[0].text).toBe("echo from api");
  mock.restore();
});

test("handler: invalid CLI args returns error", async () => {
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "cli",
    args: [],
    writer: () => {},
  } as any);

  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/usage/);
});
