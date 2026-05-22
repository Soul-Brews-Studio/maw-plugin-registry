/**
 * Tests for `maw buddy` — verifies the cross-engine pair spawn pattern.
 *
 * Stubs ghq/wake/tmux so the test never touches disk or tmux.
 * Each test asserts the recorded wake invocations + sendText payloads.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";

type WakeCall = { oracle: string; opts: Record<string, unknown> };
type SendCall = { target: string; text: string };

let wakeCalls: WakeCall[] = [];
let sendCalls: SendCall[] = [];
let ghqResult: string | null = "/ghq/github.com/Soul-Brews-Studio/maw-js";

mock.module("maw-js/sdk", () => ({
  tmux: {
    sendText: async (target: string, text: string) => {
      sendCalls.push({ target, text });
    },
  },
}));

mock.module("maw-js/core/ghq", () => ({
  ghqFind: async (_: string) => ghqResult,
}));

mock.module("maw-js/commands/shared/wake-cmd", () => ({
  cmdWake: async (oracle: string, opts: Record<string, unknown>) => {
    wakeCalls.push({ oracle, opts });
    return "stub-session";
  },
}));

import { cmdBuddy, slugifyTask } from "./impl";

describe("slugifyTask", () => {
  test("lowercases + replaces non-alnum with hyphens", () => {
    expect(slugifyTask("Fix The Resolver!")).toBe("fix-the-resolver");
  });
  test("strips leading and trailing hyphens", () => {
    expect(slugifyTask("---hello---")).toBe("hello");
  });
  test("truncates to 40 chars", () => {
    const long = "a".repeat(100);
    expect(slugifyTask(long).length).toBe(40);
  });
});

describe("cmdBuddy", () => {
  beforeEach(() => {
    wakeCalls = [];
    sendCalls = [];
    ghqResult = "/ghq/github.com/Soul-Brews-Studio/maw-js";
  });

  test("default pair: spawns claude then codex on shared worktree, primes both", async () => {
    await cmdBuddy("maw-js", { task: "fix the resolver" });

    expect(wakeCalls).toEqual([
      { oracle: "maw-js", opts: { wt: "fix-the-resolver", engine: "claude" } },
      { oracle: "maw-js", opts: { wt: "fix-the-resolver", engine: "codex", split: true } },
    ]);

    expect(sendCalls).toHaveLength(2);
    expect(sendCalls[0].target).toBe("maw-js-fix-the-resolver-claude");
    expect(sendCalls[1].target).toBe("maw-js-fix-the-resolver-codex");

    // A side: paired with B
    expect(sendCalls[0].text).toContain("You are maw-js-fix-the-resolver-claude, paired with maw-js-fix-the-resolver-codex.");
    expect(sendCalls[0].text).toContain("YOUR ROLE: spec");
    expect(sendCalls[0].text).toContain("BUDDY ROLE: impl");
    // B side: paired with A
    expect(sendCalls[1].text).toContain("You are maw-js-fix-the-resolver-codex, paired with maw-js-fix-the-resolver-claude.");
    expect(sendCalls[1].text).toContain("YOUR ROLE: impl");
    expect(sendCalls[1].text).toContain("BUDDY ROLE: spec");
  });

  test("--engine-a/--engine-b override defaults", async () => {
    await cmdBuddy("maw-js", { task: "twin", engineA: "claude", engineB: "claude" });
    expect(wakeCalls[0].opts.engine).toBe("claude");
    expect(wakeCalls[1].opts.engine).toBe("claude");
    expect(sendCalls[0].target).toBe("maw-js-twin-claude");
    expect(sendCalls[1].target).toBe("maw-js-twin-claude");
  });

  test("--role-a/--role-b flow into priming", async () => {
    await cmdBuddy("maw-js", { task: "wire", roleA: "frontend", roleB: "backend" });
    expect(sendCalls[0].text).toContain("YOUR ROLE: frontend");
    expect(sendCalls[0].text).toContain("BUDDY ROLE: backend");
    expect(sendCalls[1].text).toContain("YOUR ROLE: backend");
    expect(sendCalls[1].text).toContain("BUDDY ROLE: frontend");
  });

  test("--wt overrides slug from task", async () => {
    await cmdBuddy("maw-js", { task: "anything goes here", worktreeName: "custom-wt" });
    expect(wakeCalls[0].opts.wt).toBe("custom-wt");
    expect(wakeCalls[1].opts.wt).toBe("custom-wt");
    expect(sendCalls[0].target).toBe("maw-js-custom-wt-claude");
  });

  test("--no-prime spawns pair but sends no priming text", async () => {
    await cmdBuddy("maw-js", { task: "no prime", noPrime: true });
    expect(wakeCalls).toHaveLength(2);
    expect(sendCalls).toHaveLength(0);
  });

  test("--dry-run skips wake AND priming", async () => {
    await cmdBuddy("maw-js", { task: "dry", dryRun: true });
    expect(wakeCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  test("priming includes the shared worktree path", async () => {
    await cmdBuddy("maw-js", { task: "shared" });
    const expectedWt = "/ghq/github.com/Soul-Brews-Studio/maw-js.wt-shared";
    expect(sendCalls[0].text).toContain(`WORKTREE: ${expectedWt}`);
    expect(sendCalls[1].text).toContain(`WORKTREE: ${expectedWt}`);
  });

  test("priming context path lives under ψ/inbox/buddy/<slug>.md", async () => {
    await cmdBuddy("maw-js", { task: "ctx" });
    expect(sendCalls[0].text).toContain("CONTEXT: ψ/inbox/buddy/ctx.md");
  });

  test("unknown repo throws a clear error", async () => {
    ghqResult = null;
    await expect(cmdBuddy("does-not-exist", { task: "x" })).rejects.toThrow(/repo not found: does-not-exist/);
    expect(wakeCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  test("org-prefixed oracle resolves by repo basename", async () => {
    await cmdBuddy("Soul-Brews-Studio/maw-js", { task: "org-prefix" });
    expect(wakeCalls[0].oracle).toBe("Soul-Brews-Studio/maw-js");
    expect(sendCalls[0].target).toBe("maw-js-org-prefix-claude");
  });
});
