/**
 * incubate — bud + wake + fire /incubate <source> tests.
 *
 * 3 layers (mirrors awaken):
 *   1. CLI test  — buildSkillCommand + resolveMode + deriveStemFromSource
 *   2. Call test — cmdIncubate composes cmdBud + cmdSendText (with stubs)
 *   3. Smoke test — full handler dispatch via dry-run + edge cases
 */

import { test, expect, mock } from "bun:test";
import {
  buildSkillCommand,
  resolveMode,
  deriveStemFromSource,
} from "./impl";

// ─────────────────────────────────────────────────────────────────────────────
// 1. CLI tests — pure helpers (no IO)
// ─────────────────────────────────────────────────────────────────────────────

test("deriveStemFromSource: org/repo slug", () => {
  expect(deriveStemFromSource("Soul-Brews-Studio/foo")).toBe("foo");
});

test("deriveStemFromSource: GitHub URL", () => {
  expect(deriveStemFromSource("https://github.com/org/foo")).toBe("foo");
});

test("deriveStemFromSource: URL with .git suffix", () => {
  expect(deriveStemFromSource("https://github.com/org/foo.git")).toBe("foo");
});

test("deriveStemFromSource: bare name (no slash)", () => {
  expect(deriveStemFromSource("foo")).toBe("foo");
});

test("deriveStemFromSource: complex name preserved", () => {
  expect(deriveStemFromSource("Soul-Brews-Studio/arra-oracle-skills-cli")).toBe(
    "arra-oracle-skills-cli",
  );
});

test("buildSkillCommand: bare source", () => {
  expect(buildSkillCommand({ source: "Soul-Brews-Studio/foo" })).toBe(
    "/incubate Soul-Brews-Studio/foo",
  );
});

test("buildSkillCommand: source + flash", () => {
  expect(buildSkillCommand({ source: "org/foo", mode: "flash" })).toBe(
    "/incubate org/foo --flash",
  );
});

test("buildSkillCommand: source + contribute", () => {
  expect(buildSkillCommand({ source: "org/foo", mode: "contribute" })).toBe(
    "/incubate org/foo --contribute",
  );
});

test("buildSkillCommand: trigger override wins", () => {
  expect(
    buildSkillCommand({ source: "org/foo", trigger: "/foo-custom" }),
  ).toBe("/foo-custom");
});

test("resolveMode: no flags → default", () => {
  expect(resolveMode(false, false)).toBe("default");
});

test("resolveMode: --flash", () => {
  expect(resolveMode(true, false)).toBe("flash");
});

test("resolveMode: --contribute", () => {
  expect(resolveMode(false, true)).toBe("contribute");
});

test("resolveMode: throws on flash + contribute", () => {
  expect(() => resolveMode(true, true)).toThrow(/mutually exclusive/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Call tests — cmdIncubate composes cmdBud + cmdSendText
// ─────────────────────────────────────────────────────────────────────────────

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

test("call: cmdIncubate composes bud → sendText('/incubate <source>')", async () => {
  const calls = setupHappyPathMocks();
  const { cmdIncubate } = await import("./impl");

  await cmdIncubate({ source: "Soul-Brews-Studio/foo", root: true });

  expect(calls.bud.length).toBe(1);
  expect(calls.bud[0].name).toBe("foo");                  // stem derived
  expect(calls.bud[0].opts.repo).toBe("Soul-Brews-Studio/foo"); // source as bud --repo
  expect(calls.bud[0].opts.root).toBe(true);              // bud passthrough
  expect(calls.bud[0].opts.source).toBeUndefined();       // not bud's flag
  expect(calls.sendText.length).toBe(1);
  expect(calls.sendText[0].target).toBe("foo");           // stem
  expect(calls.sendText[0].text).toBe("/incubate Soul-Brews-Studio/foo");
  mock.restore();
});

test("call: cmdIncubate with --stem override", async () => {
  const calls = setupHappyPathMocks();
  const { cmdIncubate } = await import("./impl");

  await cmdIncubate({
    source: "Soul-Brews-Studio/very-long-name",
    stem: "vln",
    root: true,
  });

  expect(calls.bud[0].name).toBe("vln");
  expect(calls.sendText[0].target).toBe("vln");
  expect(calls.sendText[0].text).toBe("/incubate Soul-Brews-Studio/very-long-name");
  mock.restore();
});

test("call: cmdIncubate with --flash mode", async () => {
  const calls = setupHappyPathMocks();
  const { cmdIncubate } = await import("./impl");

  await cmdIncubate({
    source: "org/foo",
    mode: "flash",
    root: true,
  });

  expect(calls.sendText[0].text).toBe("/incubate org/foo --flash");
  mock.restore();
});

test("call: cmdIncubate with --contribute mode", async () => {
  const calls = setupHappyPathMocks();
  const { cmdIncubate } = await import("./impl");

  await cmdIncubate({
    source: "org/foo",
    mode: "contribute",
    root: true,
  });

  expect(calls.sendText[0].text).toBe("/incubate org/foo --contribute");
  mock.restore();
});

test("call: cmdIncubate --no-trigger does NOT send", async () => {
  const calls = setupHappyPathMocks();
  const { cmdIncubate } = await import("./impl");

  await cmdIncubate({
    source: "org/foo",
    noTrigger: true,
    root: true,
  });

  expect(calls.bud.length).toBe(1);
  expect(calls.sendText.length).toBe(0);
  mock.restore();
});

test("call: cmdIncubate --dry-run does NOT send", async () => {
  const calls = setupHappyPathMocks();
  const { cmdIncubate } = await import("./impl");

  await cmdIncubate({
    source: "org/foo",
    dryRun: true,
    root: true,
  });

  expect(calls.bud[0].opts.dryRun).toBe(true);
  expect(calls.sendText.length).toBe(0);
  mock.restore();
});

test("call: missing source throws usage", async () => {
  setupHappyPathMocks();
  const { cmdIncubate } = await import("./impl");
  await expect(cmdIncubate({ source: "" } as any)).rejects.toThrow(/usage/);
  mock.restore();
});

test("call: send-text failure does NOT throw — graceful", async () => {
  setupHappyPathMocks();
  mock.module("../send-text/impl", () => ({
    cmdSendText: async () => { throw new Error("tmux pane dead"); },
  }));
  const { cmdIncubate } = await import("./impl");
  // Should NOT throw — graceful per awaken pattern
  await expect(
    cmdIncubate({ source: "org/foo", root: true }),
  ).resolves.toBeUndefined();
  mock.restore();
});

test("call: unresolvable target after wake → warn but no throw", async () => {
  setupHappyPathMocks();
  mock.module("maw-js/sdk", () => ({
    listSessions: async () => [],
    resolveTarget: () => null,
  }));
  const { cmdIncubate } = await import("./impl");
  await expect(
    cmdIncubate({ source: "org/foo", root: true }),
  ).resolves.toBeUndefined();
  mock.restore();
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Smoke tests — full handler dispatch
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

test("smoke: handler CLI dispatch with source + --root", async () => {
  const calls = setupHandlerMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "cli",
    args: ["Soul-Brews-Studio/foo", "--root"],
    writer: () => {},
  } as any);

  expect(result.ok).toBe(true);
  expect(calls.bud[0].name).toBe("foo");
  expect(calls.sendText[0].text).toBe("/incubate Soul-Brews-Studio/foo");
  mock.restore();
});

test("smoke: handler CLI --stem + --flash", async () => {
  const calls = setupHandlerMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "cli",
    args: ["Soul-Brews-Studio/long-name", "--stem", "lname", "--flash", "--root"],
    writer: () => {},
  } as any);

  expect(result.ok).toBe(true);
  expect(calls.bud[0].name).toBe("lname");
  expect(calls.sendText[0].text).toBe("/incubate Soul-Brews-Studio/long-name --flash");
  mock.restore();
});

test("smoke: handler missing source returns usage", async () => {
  setupHandlerMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "cli",
    args: [],
    writer: () => {},
  } as any);

  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/usage/);
  mock.restore();
});

test("smoke: handler rejects flag-shaped source", async () => {
  setupHandlerMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "cli",
    args: ["-bad-name"],
    writer: () => {},
  } as any);

  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/looks like a flag/);
  mock.restore();
});

test("smoke: handler rejects --flash + --contribute", async () => {
  setupHandlerMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "cli",
    args: ["org/foo", "--root", "--flash", "--contribute"],
    writer: () => {},
  } as any);

  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/mutually exclusive/);
  mock.restore();
});

test("smoke: API dispatch", async () => {
  const calls = setupHandlerMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "api",
    args: { source: "org/api-test", root: true, mode: "flash" },
  } as any);

  expect(result.ok).toBe(true);
  expect(calls.bud[0].name).toBe("api-test");
  expect(calls.sendText[0].text).toBe("/incubate org/api-test --flash");
  mock.restore();
});

test("smoke: API rejects missing source", async () => {
  setupHandlerMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "api",
    args: { root: true },
  } as any);

  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/source required/);
  mock.restore();
});

test("smoke: API rejects invalid mode", async () => {
  setupHandlerMocks();
  const handler = (await import("./index")).default;
  const result = await handler({
    source: "api",
    args: { source: "org/foo", mode: "garbage" },
  } as any);

  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/invalid mode/);
  mock.restore();
});
