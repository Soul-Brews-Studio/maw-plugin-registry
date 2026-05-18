import { describe, expect, test } from "bun:test";
import { resolveFleetRepoFromSessions, resolveGhqRepoFromPaths } from "./ghq";
import { UsageError } from "./types";

describe("osmosis repository resolution", () => {
  test("maps oracle aliases through fleet windows before strict repo lookup", () => {
    const resolved = resolveFleetRepoFromSessions("homekeeper", [
      {
        name: "20-homekeeper",
        windows: [
          { name: "homekeeper-oracle", repo: "laris-co/homelab" },
        ],
      },
    ]);

    expect(resolved).toEqual({
      owner: "laris-co",
      repo: "homelab",
      source: "fleet:20-homekeeper",
    });
  });

  test("treats numbered fleet session names as oracle aliases", () => {
    const resolved = resolveFleetRepoFromSessions("homekeeper", [
      {
        name: "20-homekeeper",
        windows: [
          { name: "other-window", repo: "laris-co/homelab" },
        ],
      },
    ]);

    expect(resolved?.repo).toBe("homelab");
  });

  test("fails loudly when fleet has competing repo mappings for one alias", () => {
    expect(() => resolveFleetRepoFromSessions("homekeeper", [
      { name: "20-homekeeper", windows: [{ name: "homekeeper-oracle", repo: "laris-co/homelab" }] },
      { name: "21-homekeeper", windows: [{ name: "homekeeper-oracle", repo: "Soul-Brews-Studio/homekeeper-oracle" }] },
    ])).toThrow(UsageError);
  });

  test("prefers exact ghq repo matches before fuzzy oracle repo matches", () => {
    const resolved = resolveGhqRepoFromPaths("homekeeper", [
      "/opt/Code/github.com/laris-co/homekeeper-oracle",
      "/opt/Code/github.com/laris-co/homekeeper",
    ]);

    expect(resolved?.repo).toBe("homekeeper");
  });

  test("fuzzy-matches ghq oracle repos when no exact repo exists", () => {
    const resolved = resolveGhqRepoFromPaths("homekeeper", [
      "/opt/Code/github.com/laris-co/homekeeper-oracle",
    ]);

    expect(resolved).toMatchObject({ owner: "laris-co", repo: "homekeeper-oracle" });
  });
});
