import { expect, test } from "bun:test";
import handler, { execute, parseAttachSshCommand, type Tier3Target } from "./index";
import type { InvokeContext } from "maw-js/plugin/types";

test("parseAttachSshCommand parses node:session syntax", () => {
  const parsed = parseAttachSshCommand(["m5:54-mawjs"]);
  expect(parsed).toEqual({
    dryRun: false,
    target: { tier: 3, node: "m5", sshAlias: "m5", sessionName: "54-mawjs" },
  });
});

test("parseAttachSshCommand parses node session syntax and ssh alias", () => {
  const parsed = parseAttachSshCommand(["m5", "54-mawjs", "--ssh-alias", "m5.wg", "--dry-run"]);
  expect(parsed).toEqual({
    dryRun: true,
    target: { tier: 3, node: "m5", sshAlias: "m5.wg", sessionName: "54-mawjs" },
  });
});

test("parseAttachSshCommand rejects missing session", () => {
  expect(() => parseAttachSshCommand(["m5"])).toThrow("usage: maw attach-ssh");
});

test("parseAttachSshCommand rejects unsafe ssh alias", () => {
  expect(() => parseAttachSshCommand(["m5:54-mawjs", "--ssh-alias", "bad alias"])).toThrow("unsafe ssh alias");
});

test("execute delegates to SSH helper with strategy target", async () => {
  const calls: any[] = [];
  const target: Tier3Target = {
    tier: 3,
    node: "m5",
    peerUrl: "http://m5.example",
    sshAlias: "m5.wg",
    sessionName: "54-mawjs",
  };
  await execute(target, { ssh: async (request) => calls.push(request) });
  expect(calls).toEqual([{ node: "m5", sshAlias: "m5.wg", sessionName: "54-mawjs" }]);
});

test("default export remains strategy-compatible", async () => {
  expect(typeof handler).toBe("function");
  expect(typeof handler.execute).toBe("function");
});

test("handler dry-run is user-callable without SSH side effects", async () => {
  const ctx: InvokeContext = { source: "cli", args: ["m5:54-mawjs", "--dry-run"] };
  const result = await handler(ctx);
  expect(result.ok).toBe(true);
  expect(result.output).toContain("would ssh m5");
  expect(result.output).toContain("54-mawjs");
});

test("handler reports usage for invalid direct command", async () => {
  const ctx: InvokeContext = { source: "cli", args: ["m5"] };
  const result = await handler(ctx);
  expect(result.ok).toBe(false);
  expect(result.error).toContain("usage: maw attach-ssh");
});
