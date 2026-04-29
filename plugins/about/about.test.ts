import { describe, it, expect, mock } from "bun:test";
import { join } from "path";
import type { InvokeContext } from "../../../plugin/types";

const root = join(import.meta.dir, "../../..");

mock.module(join(root, "commands/plugins/oracle/impl"), () => ({
  cmdOracleAbout: async (oracle: string) => {
    console.log(`Oracle — ${oracle}`);
    console.log(`  Repo:      /home/neo/ghq/github.com/Soul-Brews-Studio/${oracle}-oracle`);
    console.log(`  Session:   ${oracle}`);
  },
}));

const { default: handler } = await import("./index");

describe("about plugin", () => {
  it("CLI — shows info for named oracle", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["neo"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Oracle — neo");
  });

  it("CLI — missing oracle returns error", async () => {
    const ctx: InvokeContext = { source: "cli", args: [] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("usage");
  });

  it("API — oracle param shows info", async () => {
    const ctx: InvokeContext = { source: "api", args: { oracle: "white" } };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Oracle — white");
  });

  it("API — missing oracle returns error", async () => {
    const ctx: InvokeContext = { source: "api", args: {} };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("oracle is required");
  });
});
