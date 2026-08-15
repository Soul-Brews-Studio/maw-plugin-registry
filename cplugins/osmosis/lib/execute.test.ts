import { describe, expect, test } from "bun:test";
import { resolveRepository } from "./execute";
import type { Config } from "./types";

function cfg(repo: string): Config {
  return {
    host: "white.local",
    direction: "push",
    repo,
    owner: "laris-co",
    apply: false,
    json: false,
    verbose: false,
    safe: false,
    force: false,
    yes: false,
    noWorktrees: false,
    sessions: false,
    diff: true,
  };
}

describe("resolveRepository", () => {
  test("rewrites osmosis repo targets from fleet oracle mappings", async () => {
    const config = cfg("homekeeper");
    const err = await resolveRepository(config, [], "/opt/Code", {
      resolveFleetRepo: async () => ({ owner: "laris-co", repo: "homelab", source: "fleet:20-homekeeper" }),
      stat: (async () => { throw new Error("strict path should not be checked after fleet hit"); }) as any,
      ghqResolveRepo: async () => { throw new Error("ghq should not be checked after fleet hit"); },
    });

    expect(err).toBeNull();
    expect(config.owner).toBe("laris-co");
    expect(config.repo).toBe("homelab");
    expect(config.derivedFrom).toBe("laris-co/homelab (via fleet:20-homekeeper)");
  });

  test("respects explicit --owner by bypassing fuzzy resolution", async () => {
    const config = cfg("homekeeper");
    const err = await resolveRepository(config, ["--owner", "laris-co"], "/opt/Code", {
      resolveFleetRepo: async () => { throw new Error("fleet should be bypassed"); },
      stat: (async () => { throw new Error("stat should be bypassed"); }) as any,
      ghqResolveRepo: async () => { throw new Error("ghq should be bypassed"); },
    });

    expect(err).toBeNull();
    expect(config.repo).toBe("homekeeper");
  });

  test("falls back to ghq fuzzy repo matches when no fleet mapping or strict path exists", async () => {
    const config = cfg("homekeeper");
    const err = await resolveRepository(config, [], "/opt/Code", {
      resolveFleetRepo: async () => null,
      stat: (async () => { throw new Error("missing strict path"); }) as any,
      ghqResolveRepo: async () => ({ owner: "laris-co", repo: "homekeeper-oracle", source: "ghq" }),
    });

    expect(err).toBeNull();
    expect(config.repo).toBe("homekeeper-oracle");
    expect(config.derivedFrom).toBe("laris-co/homekeeper-oracle (via ghq)");
  });
});
