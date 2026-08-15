import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { afterEach, describe, expect, test } from "bun:test";
import { enumerateTargets } from "./targets";
import type { Config } from "./types";

const temps: string[] = [];

function cfg(overrides: Partial<Config> = {}): Config {
  return {
    host: "alpha@white",
    remoteUser: "alpha",
    direction: "push",
    repo: "odin-oracle",
    owner: "laris-co",
    apply: false,
    json: false,
    verbose: false,
    safe: false,
    force: false,
    yes: false,
    noWorktrees: true,
    sessions: false,
    diff: false,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("osmosis target paths", () => {
  test("per-user ssh targets sync repos into /opt/<user>/Code ghq trees", async () => {
    const root = realpathSync(await mkdtemp(join(tmpdir(), "osmosis-targets-")));
    temps.push(root);
    await mkdir(join(root, "github.com/laris-co/odin-oracle"), { recursive: true });

    const { targets } = await enumerateTargets(cfg(), root, "/opt/alpha/Code", "/home/alpha");

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      localPath: `${root}/github.com/laris-co/odin-oracle`,
      remotePath: "/opt/alpha/Code/github.com/laris-co/odin-oracle",
      realLocal: `${root}/github.com/laris-co/odin-oracle`,
    });
  });
});
