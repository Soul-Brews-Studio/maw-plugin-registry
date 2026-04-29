import { describe, it, expect, mock } from "bun:test";
import { join } from "path";
import type { InvokeContext } from "../../../plugin/types";

const root = join(import.meta.dir, "../../..");
const { mockConfigModule } = await import("../../../../test/helpers/mock-config");

mock.module(join(root, "config"), () => mockConfigModule(() => ({
  namedPeers: [{ name: "white", url: "http://white.local:3456" }],
  peers: [],
  federationToken: "test-token",
})));

mock.module(join(root, "core/transport/curl-fetch"), () => ({
  curlFetch: async (_url: string) => ({
    ok: true,
    data: { node: "white", version: "2.0.0-alpha.10" },
  }),
}));

const { default: handler } = await import("./index");

describe("ping plugin", () => {
  it("CLI — pings known peer", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["white"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
  });

  it("API — ping returns ok", async () => {
    const ctx: InvokeContext = { source: "api", args: { node: "white" } };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
  });
});
