import { describe, it, expect } from "bun:test";
import type { InvokeContext } from "../../../plugin/types";
import handler, { command } from "./index";

describe("find plugin — smoke", () => {
  it("exports command metadata", () => {
    expect(command.name).toBe("find");
    expect(command.description).toBeTruthy();
  });

  it("CLI — no keyword returns usage error (does not throw)", async () => {
    const ctx: InvokeContext = { source: "cli", args: [] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toContain("usage");
  });

  it("API — no args treated as empty, returns usage error", async () => {
    // API source skips args parsing (ctx.args = [] internally), so same path
    const ctx: InvokeContext = { source: "api", args: {} };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toContain("usage");
  });

  // Keyword-path (which grep's the fleet) requires live fleet state + filesystem.
  // Smoke-tested only for the argument-validation branch above.
  it.skip("CLI — valid keyword searches fleet (requires live fleet + ψ/memory)", () => {});
});
