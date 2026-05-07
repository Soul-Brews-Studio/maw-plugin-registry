import { describe, it, expect, mock } from "bun:test";
import { join } from "path";
import type { InvokeContext } from "maw-js/plugin/types";
import { deriveWindowName } from "./derive-window-name";

const root = join(import.meta.dir, "../../..");

mock.module(join(root, "commands/plugins/sleep/impl"), () => ({
  cmdSleepOne: async (oracle: string, window?: string) => {
    console.log(`sleep ${oracle}${window ? ` window=${window}` : ""}`);
  },
}));

const { default: handler } = await import("./index");

describe("deriveWindowName (#1181)", () => {
  it("stem oracle → stem-oracle", () => {
    expect(deriveWindowName("neo")).toBe("neo-oracle");
  });

  it("slot-prefixed oracle → stem-oracle (slot stripped)", () => {
    expect(deriveWindowName("29-arra-oracle-skills-cli")).toBe("arra-oracle-skills-cli-oracle");
  });

  it("multi-digit slot prefix stripped", () => {
    expect(deriveWindowName("123-foo")).toBe("foo-oracle");
  });

  it("explicit window arg used as-is — no concat", () => {
    expect(deriveWindowName("29-arra-oracle-skills-cli", "arra-oracle-skills-cli-oracle"))
      .toBe("arra-oracle-skills-cli-oracle");
  });

  it("explicit window arg used as-is even with stem oracle", () => {
    expect(deriveWindowName("neo", "skills")).toBe("skills");
  });

  it("oracle without slot prefix passes through unchanged", () => {
    expect(deriveWindowName("homekeeper")).toBe("homekeeper-oracle");
  });
});

describe("sleep plugin", () => {
  it("CLI — valid oracle sleeps ok", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["neo"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("sleep neo");
  });

  it("CLI — oracle + window sleeps ok", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["neo", "skills"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("window=skills");
  });

  it("CLI — missing oracle returns error", async () => {
    const ctx: InvokeContext = { source: "cli", args: [] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("usage");
  });

  it("CLI — --all-done stub returns ok", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["--all-done"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Not yet implemented");
  });

  it("API — valid oracle sleeps ok", async () => {
    const ctx: InvokeContext = { source: "api", args: { oracle: "neo" } };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("sleep neo");
  });

  it("API — missing oracle returns error", async () => {
    const ctx: InvokeContext = { source: "api", args: {} };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("oracle is required");
  });
});
