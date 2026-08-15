import { describe, it, expect, mock } from "bun:test";
import type { InvokeContext } from "maw-js/plugin/types";

mock.module("maw-js/commands/shared/fleet", () => ({
  cmdSleep: async () => {
    console.log("fleet stopped");
  },
}));

const { default: handler } = await import("./index");

describe("stop plugin", () => {
  it("CLI — stops all fleet sessions ok", async () => {
    const ctx: InvokeContext = { source: "cli", args: [] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("fleet stopped");
  });

  it("API — stops all fleet sessions ok", async () => {
    const ctx: InvokeContext = { source: "api", args: {} };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("fleet stopped");
  });

  it("CLI — extra args ignored", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["--ignore-me"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
  });
});
