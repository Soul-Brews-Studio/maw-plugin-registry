import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { InvokeContext } from "../../../plugin/types";
import handler, { command } from "./index";

describe("pr plugin — smoke", () => {
  const origTmux = process.env.TMUX;

  beforeEach(() => {
    // Force the "not in tmux" guard path so the test is deterministic
    // regardless of whether `bun test` is invoked from inside tmux.
    delete process.env.TMUX;
  });

  afterEach(() => {
    if (origTmux !== undefined) process.env.TMUX = origTmux;
    else delete process.env.TMUX;
  });

  it("exports command metadata", () => {
    expect(command.name).toBe("pr");
    expect(command.description).toBeTruthy();
  });

  it("CLI — outside tmux returns error about tmux", async () => {
    const ctx: InvokeContext = { source: "cli", args: [] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toContain("tmux");
  });

  it("CLI — window arg outside tmux still errors on tmux guard", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["some-window"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toContain("tmux");
  });

  // Inside-tmux path requires live tmux + git repo + gh auth. Pure smoke
  // covers the argument + env-guard branch only.
  it.skip("CLI — inside tmux creates PR (requires live tmux + git + gh)", () => {});
});
