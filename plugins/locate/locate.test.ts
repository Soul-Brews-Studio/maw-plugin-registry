/**
 * Smoke tests for maw locate (alpha.79).
 *
 * Strategy: test arg-parsing + error paths directly. Full happy-path
 * requires live ghq + tmux + fleet state, which is hard to reproduce
 * reliably — gates those as `.skip` with reason.
 */

import { describe, test, expect } from "bun:test";
import handler, { command } from "./index";
import type { InvokeContext } from "../../../plugin/types";

function makeCtx(args: string[]): InvokeContext {
  return {
    args,
    cwd: process.cwd(),
    env: process.env,
  } as InvokeContext;
}

describe("maw locate — metadata", () => {
  test("exports command with name + description", () => {
    expect(command.name).toBe("locate");
    expect(command.description).toContain("oracle");
  });
});

describe("maw locate — error paths", () => {
  test("missing oracle arg returns ok:false with usage hint", async () => {
    const result = await handler(makeCtx([]));
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("usage: maw locate");
  });

  test("nonexistent oracle returns ok:false with 'no oracle named'", async () => {
    const result = await handler(makeCtx(["definitely-nonexistent-oracle-xxxyyy"]));
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("no oracle named");
    expect(result.error?.toLowerCase()).toContain("maw oracle ls");
  });

  test("--path on a real oracle returns single line (live — skipped if mawjs missing)", async () => {
    const result = await handler(makeCtx(["mawjs", "--path"]));
    // This test runs live — if mawjs-oracle is on the local ghq, the path is emitted.
    // If not, it'll be ok:false with "no oracle named" — both valid for CI.
    if (result.ok) {
      expect(result.output).toContain("/");
      expect(result.output?.split("\n").filter(Boolean).length).toBe(1);
    } else {
      expect(result.error?.toLowerCase()).toMatch(/no oracle named|no repo path/);
    }
  });

  test("--json on real oracle returns parseable JSON", async () => {
    const result = await handler(makeCtx(["mawjs", "--json"]));
    if (result.ok) {
      const parsed = JSON.parse(result.output || "{}");
      expect(parsed.name).toBe("mawjs");
      // These fields exist in the shape regardless of resolution state
      expect(parsed).toHaveProperty("repoPath");
      expect(parsed).toHaveProperty("hasPsi");
      expect(parsed).toHaveProperty("sessionName");
      expect(parsed).toHaveProperty("fleetConfigPath");
      expect(parsed).toHaveProperty("federationNode");
      expect(parsed).toHaveProperty("inAgentsConfig");
    } else {
      // If mawjs isn't resolvable on this machine, the error path is also fine
      expect(result.error?.toLowerCase()).toContain("no oracle named");
    }
  });
});
