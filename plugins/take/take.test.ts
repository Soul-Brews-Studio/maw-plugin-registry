import { describe, it, expect, mock } from "bun:test";
import { join } from "path";
import type { InvokeContext } from "../../../plugin/types";

const root = join(import.meta.dir, "../../..");

mock.module(join(root, "commands/plugins/take/impl"), () => ({
  cmdTake: async (source: string, target?: string) => {
    console.log(`take ${source}${target ? ` → ${target}` : " (new session)"}`);
  },
}));

const { default: handler } = await import("./index");

describe("take plugin", () => {
  it("CLI — source without target creates new session", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["neo:neo-skills"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("take neo:neo-skills");
  });

  it("CLI — source with target moves to session", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["neo:neo-skills", "pulse"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("→ pulse");
  });

  it("CLI — missing source returns error", async () => {
    const ctx: InvokeContext = { source: "cli", args: [] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("usage");
  });

  it("API — source and target ok", async () => {
    const ctx: InvokeContext = { source: "api", args: { source: "neo:neo-skills", target: "pulse" } };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("→ pulse");
  });

  it("API — missing source returns error", async () => {
    const ctx: InvokeContext = { source: "api", args: {} };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("source is required");
  });
});
