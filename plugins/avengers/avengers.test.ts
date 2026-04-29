import { describe, it, expect } from "bun:test";
import type { InvokeContext } from "../../../plugin/types";
import handler, { command } from "./index";

describe("avengers plugin — smoke", () => {
  it("exports command metadata", () => {
    expect(command.name).toBe("avengers");
    expect(command.description).toBeTruthy();
  });

  it("CLI — --help returns ok and writes usage via writer", async () => {
    const writes: string[] = [];
    const ctx: InvokeContext = {
      source: "cli",
      args: ["--help"],
      writer: (...a: unknown[]) => { writes.push(a.map(String).join(" ")); },
    };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(writes.join("\n")).toContain("usage:");
    expect(writes.join("\n")).toContain("maw avengers");
  });

  it("CLI — -h short flag also returns ok via writer", async () => {
    const writes: string[] = [];
    const ctx: InvokeContext = {
      source: "cli",
      args: ["-h"],
      writer: (...a: unknown[]) => { writes.push(a.map(String).join(" ")); },
    };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(writes.join("\n")).toContain("usage:");
  });

  it("CLI — --help without writer still returns ok (prints to stdout)", async () => {
    // The --help branch early-returns before logs[] capture, so stdout is used
    // when no writer is provided. Smoke: handler should not throw + returns ok.
    const ctx: InvokeContext = { source: "cli", args: ["--help"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
  });
});
