import { describe, it, expect, mock } from "bun:test";
import { join } from "path";
import type { InvokeContext } from "maw-js/plugin/types";

mock.module(join(import.meta.dir, "./impl"), () => ({
  cmdDone: async (name: string, opts: { force?: boolean; dryRun?: boolean }) => {
    console.log(`done ${name} force=${!!opts.force} dryRun=${!!opts.dryRun}`);
  },
  cmdDoneAll: async (opts: { force?: boolean; dryRun?: boolean }) => {
    console.log(`done-all force=${!!opts.force} dryRun=${!!opts.dryRun}`);
  },
}));

const { default: handler } = await import("./index");

describe("done plugin", () => {
  it("CLI — valid window name completes ok", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["neo-freelance"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("done neo-freelance");
  });

  it("CLI — --force flag passes through", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["neo-freelance", "--force"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("force=true");
  });

  it("CLI — --dry-run flag passes through", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["neo-freelance", "--dry-run"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("dryRun=true");
  });

  it("CLI — --all flag calls cmdDoneAll", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["--all"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("done-all");
  });

  it("CLI — --all --force passes through", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["--all", "--force"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("force=true");
  });

  it("CLI — --all --dry-run passes through", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["--all", "--dry-run"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("dryRun=true");
  });

  it("CLI — missing name returns error", async () => {
    const ctx: InvokeContext = { source: "cli", args: [] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("usage");
  });

  it("API — name completes ok", async () => {
    const ctx: InvokeContext = { source: "api", args: { name: "neo-freelance" } };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("done neo-freelance");
  });

  it("API — all flag calls cmdDoneAll", async () => {
    const ctx: InvokeContext = { source: "api", args: { all: true } };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("done-all");
  });

  it("API — missing name returns error", async () => {
    const ctx: InvokeContext = { source: "api", args: {} };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("name is required");
  });
});
