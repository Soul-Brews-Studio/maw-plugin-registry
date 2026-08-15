/**
 * Tests for `maw cleanup --prune-stale` (#41).
 *
 * Pure bucketing + a smoke test for `cmdPruneStale` against a temp
 * oracles.json. The smoke test injects mock disk/git/manifest so it never
 * touches the operator's real `~/.config/maw/oracles.json`.
 */

import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  bucketEntry,
  isStaleByManifest,
  isCwdSelfExclude,
  findPruneCandidates,
  cmdPruneStale,
  readOraclesCache,
  writeOraclesCache,
  type OracleEntryLite,
  type DirStat,
  type GitStat,
} from "./prune-stale-oracles";
import type { OracleManifestEntry } from "maw-js/lib/oracle-manifest";

const NOW = new Date("2026-05-13T00:00:00Z").getTime();
const DAY_MS = 86_400_000;

const ENTRY: OracleEntryLite = {
  org: "Soul-Brews-Studio",
  repo: "demo-oracle",
  name: "demo",
  local_path: "/tmp/demo-oracle",
  has_psi: false,
  has_fleet_config: false,
  budded_from: null,
  budded_at: null,
  federation_node: null,
  detected_at: NOW.toString(),
};

const CLEAN_GIT: GitStat = {
  isClean: true,
  unpushed: 0,
  uncommitted: 0,
  totalCommits: 10,
  detached: false,
};

const EMPTY_GIT: GitStat = {
  isClean: true,
  unpushed: 0,
  uncommitted: 0,
  totalCommits: 0,
  detached: false,
};

const stat = (mtimeDaysAgo: number, kb: number): DirStat => ({
  mtimeMs: NOW - mtimeDaysAgo * DAY_MS,
  sizeBytes: kb * 1024,
});

// ─── isStaleByManifest ───────────────────────────────────────────────────────

test("isStaleByManifest: yes when only oracles-json", () => {
  const m: OracleManifestEntry = { name: "x", sources: ["oracles-json"], isLive: false };
  expect(isStaleByManifest(m)).toBe(true);
});

test("isStaleByManifest: no when fleet present", () => {
  const m: OracleManifestEntry = { name: "x", sources: ["oracles-json", "fleet"], isLive: false };
  expect(isStaleByManifest(m)).toBe(false);
});

test("isStaleByManifest: no when session present", () => {
  const m: OracleManifestEntry = { name: "x", sources: ["oracles-json", "session"], isLive: false };
  expect(isStaleByManifest(m)).toBe(false);
});

test("isStaleByManifest: no when agent present", () => {
  const m: OracleManifestEntry = { name: "x", sources: ["oracles-json", "agent"], isLive: false };
  expect(isStaleByManifest(m)).toBe(false);
});

// ─── bucketEntry ─────────────────────────────────────────────────────────────

test("bucketEntry: clone missing → SAFE", () => {
  const b = bucketEntry(ENTRY, null, null, NOW);
  expect(b.bucket).toBe("safe");
  expect(b.cloneMissing).toBe(true);
  expect(b.reason).toMatch(/clone missing/);
});

test("bucketEntry: empty repo (0 commits) → SAFE", () => {
  const b = bucketEntry(ENTRY, stat(60, 80), EMPTY_GIT, NOW);
  expect(b.bucket).toBe("safe");
  expect(b.reason).toMatch(/empty/);
});

test("bucketEntry: clean + 60d old → SAFE", () => {
  const b = bucketEntry(ENTRY, stat(60, 5000), CLEAN_GIT, NOW);
  expect(b.bucket).toBe("safe");
  expect(b.reason).toMatch(/60d old/);
});

test("bucketEntry: clean + 3d old → ASK-FIRST (recent)", () => {
  const b = bucketEntry(ENTRY, stat(3, 5000), CLEAN_GIT, NOW);
  expect(b.bucket).toBe("ask-first");
  expect(b.reason).toMatch(/recent/);
});

test("bucketEntry: 124-128K placeholder → ASK-FIRST", () => {
  const b = bucketEntry(ENTRY, stat(15, 126), CLEAN_GIT, NOW);
  expect(b.bucket).toBe("ask-first");
  expect(b.reason).toMatch(/126K/);
});

test("bucketEntry: clean + 15d old + normal size → ASK-FIRST (middle zone)", () => {
  const b = bucketEntry(ENTRY, stat(15, 5000), CLEAN_GIT, NOW);
  expect(b.bucket).toBe("ask-first");
  expect(b.reason).toMatch(/15d/);
});

test("bucketEntry: uncommitted → NEVER-TOUCH", () => {
  const dirty: GitStat = { ...CLEAN_GIT, isClean: false, uncommitted: 3 };
  const b = bucketEntry(ENTRY, stat(60, 5000), dirty, NOW);
  expect(b.bucket).toBe("never-touch");
  expect(b.reason).toMatch(/3 uncommitted/);
});

test("bucketEntry: unpushed → NEVER-TOUCH", () => {
  const ahead: GitStat = { ...CLEAN_GIT, unpushed: 57 };
  const b = bucketEntry(ENTRY, stat(60, 5000), ahead, NOW);
  expect(b.bucket).toBe("never-touch");
  expect(b.reason).toMatch(/57 unpushed commits/);
});

test("bucketEntry: detached HEAD with commits → NEVER-TOUCH", () => {
  const detached: GitStat = { ...CLEAN_GIT, detached: true };
  const b = bucketEntry(ENTRY, stat(60, 5000), detached, NOW);
  expect(b.bucket).toBe("never-touch");
  expect(b.reason).toMatch(/detached/);
});

test("bucketEntry: clone exists but git probe failed → NEVER-TOUCH (conservative)", () => {
  const b = bucketEntry(ENTRY, stat(60, 5000), null, NOW);
  expect(b.bucket).toBe("never-touch");
  expect(b.reason).toMatch(/git inspect failed/);
});

// ─── isCwdSelfExclude ────────────────────────────────────────────────────────

test("isCwdSelfExclude: exact match", () => {
  expect(isCwdSelfExclude("/a/b/c", "/a/b/c")).toBe(true);
});

test("isCwdSelfExclude: cwd inside clone", () => {
  expect(isCwdSelfExclude("/a/b/c", "/a/b/c/sub")).toBe(true);
});

test("isCwdSelfExclude: clone inside cwd (parent guard)", () => {
  expect(isCwdSelfExclude("/a/b/c", "/a/b")).toBe(true);
});

test("isCwdSelfExclude: unrelated paths", () => {
  expect(isCwdSelfExclude("/a/b/c", "/x/y/z")).toBe(false);
});

test("isCwdSelfExclude: trailing slash tolerated", () => {
  expect(isCwdSelfExclude("/a/b/c/", "/a/b/c")).toBe(true);
});

// ─── findPruneCandidates ─────────────────────────────────────────────────────

function manifestFor(names: { name: string; sources: OracleManifestEntry["sources"] }[]): OracleManifestEntry[] {
  return names.map(({ name, sources }) => ({ name, sources, isLive: false }));
}

test("findPruneCandidates: psi vault skipped (counted as kept)", async () => {
  const cacheEntries: OracleEntryLite[] = [
    { ...ENTRY, name: "with-psi", local_path: "/tmp/with-psi", has_psi: true },
    { ...ENTRY, name: "without-psi", local_path: "/tmp/without-psi", has_psi: false },
  ];
  const manifest = manifestFor([
    { name: "with-psi", sources: ["oracles-json"] },
    { name: "without-psi", sources: ["oracles-json"] },
  ]);
  const survey = await findPruneCandidates({
    manifest,
    cacheEntries,
    cwd: "/elsewhere",
    statDir: () => null, // clone missing for all
    checkGit: async () => CLEAN_GIT, // unused — stat null short-circuits
    now: NOW,
  });
  expect(survey.totalStale).toBe(2);
  expect(survey.withPsi).toBe(1);
  expect(survey.safe.length).toBe(1);
  expect(survey.safe[0]?.entry.name).toBe("without-psi");
});

test("findPruneCandidates: PWD self-exclude removes candidate", async () => {
  const cacheEntries: OracleEntryLite[] = [
    { ...ENTRY, name: "im-here", local_path: "/work/im-here" },
  ];
  const manifest = manifestFor([{ name: "im-here", sources: ["oracles-json"] }]);
  const survey = await findPruneCandidates({
    manifest,
    cacheEntries,
    cwd: "/work/im-here",
    statDir: () => stat(60, 5000),
    checkGit: async () => CLEAN_GIT,
    now: NOW,
  });
  expect(survey.totalStale).toBe(1);
  expect(survey.safe.length).toBe(0);
  expect(survey.neverTouch.length).toBe(0);
  expect(survey.askFirst.length).toBe(0);
});

test("findPruneCandidates: non-stale entries (with fleet) untouched", async () => {
  const cacheEntries: OracleEntryLite[] = [
    { ...ENTRY, name: "live", local_path: "/tmp/live" },
  ];
  const manifest = manifestFor([
    { name: "live", sources: ["oracles-json", "fleet"] },
  ]);
  const survey = await findPruneCandidates({
    manifest,
    cacheEntries,
    cwd: "/elsewhere",
    statDir: () => stat(60, 5000),
    checkGit: async () => CLEAN_GIT,
    now: NOW,
  });
  expect(survey.totalStale).toBe(0);
  expect(survey.safe.length).toBe(0);
});

test("findPruneCandidates: three-way bucket split", async () => {
  const entries: OracleEntryLite[] = [
    { ...ENTRY, name: "safe-old", local_path: "/tmp/safe-old" },
    { ...ENTRY, name: "ask-recent", local_path: "/tmp/ask-recent" },
    { ...ENTRY, name: "never-dirty", local_path: "/tmp/never-dirty" },
  ];
  const manifest = manifestFor(entries.map((e) => ({ name: e.name, sources: ["oracles-json"] })));
  const statByPath: Record<string, DirStat> = {
    "/tmp/safe-old": stat(60, 4000),
    "/tmp/ask-recent": stat(3, 4000),
    "/tmp/never-dirty": stat(60, 4000),
  };
  const gitByPath: Record<string, GitStat> = {
    "/tmp/safe-old": CLEAN_GIT,
    "/tmp/ask-recent": CLEAN_GIT,
    "/tmp/never-dirty": { ...CLEAN_GIT, isClean: false, uncommitted: 1 },
  };
  const survey = await findPruneCandidates({
    manifest,
    cacheEntries: entries,
    cwd: "/elsewhere",
    statDir: (p) => statByPath[p] ?? null,
    checkGit: async (p) => gitByPath[p]!,
    now: NOW,
  });
  expect(survey.safe.map((c) => c.entry.name)).toEqual(["safe-old"]);
  expect(survey.askFirst.map((c) => c.entry.name)).toEqual(["ask-recent"]);
  expect(survey.neverTouch.map((c) => c.entry.name)).toEqual(["never-dirty"]);
});

// ─── readOraclesCache / writeOraclesCache (preserves unknown keys) ───────────

test("readOraclesCache / writeOraclesCache: preserves unknown top-level keys", () => {
  const tmp = mkdtempSync(join(tmpdir(), "prune-stale-test-"));
  try {
    const file = join(tmp, "oracles.json");
    writeFileSync(
      file,
      JSON.stringify(
        {
          schema: 1,
          local_scanned_at: "2026-05-12T00:00:00Z",
          ghq_root: "/x",
          oracles: [{ ...ENTRY, name: "a" }, { ...ENTRY, name: "b" }],
          // legacy / external key — must be preserved on rewrite
          leaves: [{ name: "legacy-leaf" }],
        },
        null,
        2,
      ),
    );
    const cache = readOraclesCache(file)!;
    expect(cache.entries.length).toBe(2);
    expect(cache.raw.leaves).toEqual([{ name: "legacy-leaf" }]);

    writeOraclesCache({ raw: cache.raw, entries: cache.entries.filter((e) => e.name !== "b") }, file);
    const reread = JSON.parse(readFileSync(file, "utf-8"));
    expect(reread.oracles.length).toBe(1);
    expect(reread.oracles[0].name).toBe("a");
    expect(reread.leaves).toEqual([{ name: "legacy-leaf" }]);
    expect(reread.schema).toBe(1);
    expect(reread.ghq_root).toBe("/x");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ─── cmdPruneStale smoke ─────────────────────────────────────────────────────

test("cmdPruneStale: dry-run by default — does not mutate file", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "prune-stale-test-"));
  try {
    const file = join(tmp, "oracles.json");
    const initial = {
      schema: 1,
      local_scanned_at: "2026-05-12T00:00:00Z",
      ghq_root: "/x",
      oracles: [
        { ...ENTRY, name: "safe-old", local_path: "/tmp/safe-old" },
      ],
    };
    writeFileSync(file, JSON.stringify(initial, null, 2));
    const manifest = manifestFor([{ name: "safe-old", sources: ["oracles-json"] }]);

    await cmdPruneStale({
      cacheFile: file,
      env: {
        manifest,
        cwd: "/elsewhere",
        statDir: () => stat(60, 4000),
        checkGit: async () => CLEAN_GIT,
        now: NOW,
      },
    });

    const reread = JSON.parse(readFileSync(file, "utf-8"));
    expect(reread.oracles.length).toBe(1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("cmdPruneStale: --yes prunes SAFE bucket, leaves NEVER-TOUCH and ASK-FIRST", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "prune-stale-test-"));
  try {
    const file = join(tmp, "oracles.json");
    const oracles: OracleEntryLite[] = [
      { ...ENTRY, name: "safe-old", local_path: "/tmp/safe-old" },
      { ...ENTRY, name: "ask-recent", local_path: "/tmp/ask-recent" },
      { ...ENTRY, name: "never-dirty", local_path: "/tmp/never-dirty" },
      { ...ENTRY, name: "with-psi", local_path: "/tmp/with-psi", has_psi: true },
      { ...ENTRY, name: "live", local_path: "/tmp/live" },
    ];
    writeFileSync(file, JSON.stringify({ schema: 1, local_scanned_at: "x", ghq_root: "/x", oracles }, null, 2));

    const manifest = manifestFor([
      { name: "safe-old", sources: ["oracles-json"] },
      { name: "ask-recent", sources: ["oracles-json"] },
      { name: "never-dirty", sources: ["oracles-json"] },
      { name: "with-psi", sources: ["oracles-json"] },
      { name: "live", sources: ["oracles-json", "fleet"] }, // not stale
    ]);

    const statByPath: Record<string, DirStat> = {
      "/tmp/safe-old": stat(60, 4000),
      "/tmp/ask-recent": stat(3, 4000),
      "/tmp/never-dirty": stat(60, 4000),
      "/tmp/with-psi": stat(60, 4000),
      "/tmp/live": stat(1, 4000),
    };
    const gitByPath: Record<string, GitStat> = {
      "/tmp/safe-old": CLEAN_GIT,
      "/tmp/ask-recent": CLEAN_GIT,
      "/tmp/never-dirty": { ...CLEAN_GIT, isClean: false, uncommitted: 1 },
      "/tmp/with-psi": CLEAN_GIT,
      "/tmp/live": CLEAN_GIT,
    };

    await cmdPruneStale({
      yes: true,
      cacheFile: file,
      env: {
        manifest,
        cwd: "/elsewhere",
        statDir: (p) => statByPath[p] ?? null,
        checkGit: async (p) => gitByPath[p]!,
        now: NOW,
      },
    });

    const reread = JSON.parse(readFileSync(file, "utf-8"));
    const names = (reread.oracles as OracleEntryLite[]).map((e) => e.name).sort();
    expect(names).toEqual(["ask-recent", "live", "never-dirty", "with-psi"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("cmdPruneStale: --ask prunes only entries the prompt approves", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "prune-stale-test-"));
  try {
    const file = join(tmp, "oracles.json");
    const oracles: OracleEntryLite[] = [
      { ...ENTRY, name: "ask-a", local_path: "/tmp/ask-a" },
      { ...ENTRY, name: "ask-b", local_path: "/tmp/ask-b" },
    ];
    writeFileSync(file, JSON.stringify({ schema: 1, local_scanned_at: "x", ghq_root: "/x", oracles }, null, 2));

    const manifest = manifestFor([
      { name: "ask-a", sources: ["oracles-json"] },
      { name: "ask-b", sources: ["oracles-json"] },
    ]);
    const statByPath: Record<string, DirStat> = {
      "/tmp/ask-a": stat(3, 4000),
      "/tmp/ask-b": stat(3, 4000),
    };

    const seen: string[] = [];
    await cmdPruneStale({
      ask: true,
      cacheFile: file,
      prompt: async (q) => {
        seen.push(q);
        return q.includes("ask-a") ? "y" : "n";
      },
      env: {
        manifest,
        cwd: "/elsewhere",
        statDir: (p) => statByPath[p] ?? null,
        checkGit: async () => CLEAN_GIT,
        now: NOW,
      },
    });

    expect(seen.length).toBe(2);
    const reread = JSON.parse(readFileSync(file, "utf-8"));
    const names = (reread.oracles as OracleEntryLite[]).map((e) => e.name);
    expect(names).toEqual(["ask-b"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("cmdPruneStale: --yes with no SAFE entries leaves file unchanged", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "prune-stale-test-"));
  try {
    const file = join(tmp, "oracles.json");
    const oracles: OracleEntryLite[] = [
      { ...ENTRY, name: "only-dirty", local_path: "/tmp/only-dirty" },
    ];
    writeFileSync(file, JSON.stringify({ schema: 1, local_scanned_at: "x", ghq_root: "/x", oracles }, null, 2));

    const manifest = manifestFor([{ name: "only-dirty", sources: ["oracles-json"] }]);
    const statByPath: Record<string, DirStat> = {
      "/tmp/only-dirty": stat(60, 4000),
    };
    const gitByPath: Record<string, GitStat> = {
      "/tmp/only-dirty": { ...CLEAN_GIT, isClean: false, uncommitted: 1 },
    };

    await cmdPruneStale({
      yes: true,
      cacheFile: file,
      env: {
        manifest,
        cwd: "/elsewhere",
        statDir: (p) => statByPath[p] ?? null,
        checkGit: async (p) => gitByPath[p]!,
        now: NOW,
      },
    });

    const reread = JSON.parse(readFileSync(file, "utf-8"));
    expect(reread.oracles.length).toBe(1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
