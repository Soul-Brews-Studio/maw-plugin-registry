import { describe, it, expect } from "bun:test";
import type { InvokeContext } from "../../../plugin/types";
import handler, { command } from "./index";

describe("mega plugin — smoke", () => {
  it("exports command metadata", () => {
    expect(command.name).toBe("mega");
    expect(command.description).toBeTruthy();
  });

  it("CLI — unknown sub returns ok with usage hint", async () => {
    // Any sub not in {status,ls,tree,stop,kill,empty} hits the help branch.
    const ctx: InvokeContext = { source: "cli", args: ["--help"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output ?? "").toContain("maw mega");
  });

  it("CLI — 'help' sub also hits usage branch", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["help"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output ?? "").toContain("MegaAgent");
  });

  // status/ls/tree/<empty> paths read ~/.claude/teams and call tmux.listPaneIds.
  // stop/kill path kills tmux panes. Both require live side-effecty state.
  it.skip("CLI — status reads teams dir (requires ~/.claude/teams + tmux)", () => {});
  it.skip("CLI — stop kills panes (requires live tmux session)", () => {});
});
