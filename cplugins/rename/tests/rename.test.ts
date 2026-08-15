/**
 * Tests for maw-rename — added at extraction (a3-scout flagged the gap).
 *
 * The auto-prefix regex is the part with real branching logic; the rest
 * of cmdRename is tmux-IO and is covered by integration testing
 * downstream. We test:
 *   - autoPrefix: oracle extraction from numbered sessions ("03-neo" → "neo")
 *   - autoPrefix: idempotence when name already prefixed
 *   - autoPrefix: bare-session passthrough (no number prefix)
 *   - handler: usage-error path (missing args)
 *   - command metadata export
 */

import { describe, test, expect } from "bun:test";
import handler, { command } from "../src/index";
import { autoPrefix } from "../src/impl";
import type { InvokeContext } from "@maw-js/sdk/plugin";

function makeCtx(args: string[]): InvokeContext {
  return { source: "cli", args } as InvokeContext;
}

describe("maw rename — metadata", () => {
  test("exports command with name + description", () => {
    expect(command.name).toBe("rename");
    expect(command.description.toLowerCase()).toContain("rename");
  });
});

describe("autoPrefix — oracle-prefix derivation", () => {
  test("numbered session 03-neo + bare name → prefixed", () => {
    expect(autoPrefix("03-neo", "claude-proxy")).toBe("neo-claude-proxy");
  });

  test("numbered session 12-mawjs + already-prefixed name → idempotent", () => {
    expect(autoPrefix("12-mawjs", "mawjs-agent")).toBe("mawjs-agent");
  });

  test("bare session (no number prefix) → oracle == session", () => {
    expect(autoPrefix("neo", "agent")).toBe("neo-agent");
  });

  test("multi-digit numbered prefix is stripped", () => {
    expect(autoPrefix("123-foo", "bar")).toBe("foo-bar");
  });

  test("partial-match name does NOT count as prefixed", () => {
    // "neo-x" must not match "neon-y" prefix — startsWith("neon-") is false
    expect(autoPrefix("01-neon", "neo-x")).toBe("neon-neo-x");
  });
});

describe("maw rename — handler error paths", () => {
  test("missing both args → usage error", async () => {
    const result = await handler(makeCtx([]));
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase() ?? "").toContain("usage");
  });

  test("missing second arg → usage error", async () => {
    const result = await handler(makeCtx(["1"]));
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase() ?? "").toContain("usage");
  });
});
