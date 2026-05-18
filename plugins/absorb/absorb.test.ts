import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import handler from "./index";
import {
  cmdAbsorb,
  copyVaultIntoNamespace,
  archiveDonorRepo,
  namespaceForDonor,
  normalizeOracleStem,
  resolveOracle,
} from "./impl";

const roots: string[] = [];
const fixedNow = new Date("2026-05-18T12:00:00.000Z");

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "maw-absorb-test-"));
  roots.push(root);
  return root;
}

function write(path: string, body: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}

function makeOracle(root: string, repoName: string, files: Record<string, string | Buffer> = {}) {
  const dir = join(root, repoName);
  mkdirSync(join(dir, "ψ"), { recursive: true });
  write(join(dir, ".git", "config"), "");
  for (const [rel, body] of Object.entries(files)) write(join(dir, "ψ", rel), body);
  return dir;
}

function fakeSpawn(calls: string[][] = []) {
  return ((cmd: string[]) => {
    calls.push(cmd);
    if (cmd[0] === "git") {
      const repoPath = cmd[2] ?? "";
      const repo = repoPath.includes("sage") || repoPath.includes("donor") ? "Soul-Brews-Studio/sage-vector-fix-oracle" : "Soul-Brews-Studio/arra-oracle-v3-oracle";
      return { exitCode: 0, stdout: new TextEncoder().encode(`git@github.com:${repo}.git\n`), stderr: new Uint8Array() } as any;
    }
    return { exitCode: 0, stdout: new Uint8Array(), stderr: new Uint8Array() } as any;
  }) as typeof Bun.spawnSync;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("absorb naming and resolution", () => {
  test("normalizes oracle names and namespaces without adding a second suffix", () => {
    expect(normalizeOracleStem("04-sage-vector-fix-oracle")).toBe("sage-vector-fix");
    expect(normalizeOracleStem("sage-vector-fix")).toBe("sage-vector-fix");
    expect(namespaceForDonor("sage-vector-fix")).toBe("from-sage-vector-fix");
  });

  test("resolves valid oracle vaults from ghq-style paths", () => {
    const root = tempRoot();
    const donor = makeOracle(root, "sage-vector-fix-oracle");
    const resolved = resolveOracle("sage-vector-fix", {
      cwd: root,
      ghqList: () => [donor],
      spawnSync: fakeSpawn(),
    });
    expect(resolved.name).toBe("sage-vector-fix-oracle");
    expect(resolved.stem).toBe("sage-vector-fix");
    expect(resolved.psiPath).toBe(join(donor, "ψ"));
    expect(resolved.repoSlug).toBe("Soul-Brews-Studio/sage-vector-fix-oracle");
  });
});

describe("copyVaultIntoNamespace", () => {
  test("copies donor ψ files under receiver ψ/from-donor with markdown provenance", () => {
    const root = tempRoot();
    const donorPath = makeOracle(root, "sage-vector-fix-oracle", {
      "memory/learnings/vector.md": "# Vector fix\nkeep this\n",
      "memory/traces/raw.bin": Buffer.from([1, 2, 3]),
    });
    const receiverPath = makeOracle(root, "arra-oracle-v3-oracle");
    const donor = resolveOracle(donorPath, { cwd: root, ghqList: () => [], spawnSync: fakeSpawn() });
    const receiver = resolveOracle(receiverPath, { cwd: root, ghqList: () => [], spawnSync: fakeSpawn() });

    const result = copyVaultIntoNamespace(donor, receiver, { now: fixedNow, reason: "Nat approved" });

    expect(result.namespace).toBe("from-sage-vector-fix");
    expect(result.files.map(f => f.action)).toEqual(["copy", "copy"]);
    const copied = readFileSync(join(receiverPath, "ψ/from-sage-vector-fix/memory/learnings/vector.md"), "utf8");
    expect(copied).toContain("absorb:");
    expect(copied).toContain("donor: sage-vector-fix-oracle");
    expect(copied).toContain("receiver: arra-oracle-v3-oracle");
    expect(copied).toContain("originalPath: memory/learnings/vector.md");
    expect(copied).toContain("# Vector fix");
    expect(readFileSync(join(receiverPath, "ψ/from-sage-vector-fix/memory/traces/raw.bin"))).toEqual(Buffer.from([1, 2, 3]));
  });

  test("dry-run classifies copies without writing and conflicts preserve existing files", () => {
    const root = tempRoot();
    const donorPath = makeOracle(root, "donor-oracle", { "memory/learnings/a.md": "new donor text\n" });
    const receiverPath = makeOracle(root, "receiver-oracle", { "from-donor/memory/learnings/a.md": "existing receiver text\n" });
    const donor = resolveOracle(donorPath, { cwd: root, ghqList: () => [], spawnSync: fakeSpawn() });
    const receiver = resolveOracle(receiverPath, { cwd: root, ghqList: () => [], spawnSync: fakeSpawn() });

    const dry = copyVaultIntoNamespace(donor, receiver, { dryRun: true, now: fixedNow });
    expect(dry.files[0].action).toBe("conflict");
    expect(readFileSync(join(receiverPath, "ψ/from-donor/memory/learnings/a.md"), "utf8")).toBe("existing receiver text\n");
    expect(existsSync(dry.files[0].targetPath)).toBe(false);
  });

  test("preserves vault symlinks without following dangling incubate targets", () => {
    const root = tempRoot();
    const donorPath = makeOracle(root, "sage-vector-fix-oracle");
    const receiverPath = makeOracle(root, "arra-oracle-v3-oracle");
    symlinkSync("/missing/incubate/origin", join(donorPath, "ψ", "incubate-origin"));
    const donor = resolveOracle(donorPath, { cwd: root, ghqList: () => [], spawnSync: fakeSpawn() });
    const receiver = resolveOracle(receiverPath, { cwd: root, ghqList: () => [], spawnSync: fakeSpawn() });

    const result = copyVaultIntoNamespace(donor, receiver, { now: fixedNow });

    expect(result.files).toEqual([
      expect.objectContaining({ action: "copy", relativePath: "incubate-origin" }),
    ]);
    expect(readlinkSync(join(receiverPath, "ψ/from-sage-vector-fix/incubate-origin"))).toBe("/missing/incubate/origin");
  });
});

describe("cmdAbsorb protocol", () => {
  test("requires explicit consent before any non-dry-run writes", async () => {
    const root = tempRoot();
    makeOracle(root, "donor-oracle", { "memory/learnings/a.md": "a" });
    makeOracle(root, "receiver-oracle");
    await expect(cmdAbsorb({ donor: "donor", receiver: "receiver" }, { cwd: root, ghqList: () => [], spawnSync: fakeSpawn(), now: () => fixedNow }))
      .rejects.toThrow("consent required");
  });

  test("refuses to archive when donor origin points at a different repo", () => {
    const root = tempRoot();
    const donorPath = makeOracle(root, "sage-vector-fix-oracle");
    const donor = resolveOracle(donorPath, {
      cwd: root,
      ghqList: () => [],
      spawnSync: ((cmd: string[]) => {
        if (cmd[0] === "git") {
          return {
            exitCode: 0,
            stdout: new TextEncoder().encode("https://github.com/Soul-Brews-Studio/other-oracle.git\n"),
            stderr: new Uint8Array(),
          } as any;
        }
        throw new Error("archive should not run for mismatched origins");
      }) as typeof Bun.spawnSync,
    });

    expect(archiveDonorRepo(donor)).toMatchObject({
      status: "skipped",
      repo: "Soul-Brews-Studio/other-oracle",
    });
  });

  test("runs the seven-step absorb path with copy, ABSORB.md, fleet mark, archive, and broadcast", async () => {
    const root = tempRoot();
    const donorPath = makeOracle(root, "sage-vector-fix-oracle", { "memory/learnings/a.md": "alpha\n" });
    const receiverPath = makeOracle(root, "arra-oracle-v3-oracle");
    const fleetDir = join(root, "fleet");
    write(join(fleetDir, "04-sage-vector-fix.json"), JSON.stringify({ name: "04-sage-vector-fix", windows: [{ name: "sage-vector-fix-oracle" }] }, null, 2));
    const calls: string[][] = [];

    const report = await cmdAbsorb({
      donor: "sage-vector-fix",
      receiver: "arra-oracle-v3",
      yes: true,
      reason: "Nat approved retirement",
      fleetDir,
    }, {
      cwd: root,
      ghqList: () => [donorPath, receiverPath],
      spawnSync: fakeSpawn(calls),
      now: () => fixedNow,
    });

    expect(report.copied).toBe(1);
    expect(report.fleet.status).toBe("updated");
    expect(report.archive).toMatchObject({ status: "archived", repo: "Soul-Brews-Studio/sage-vector-fix-oracle" });
    expect(report.broadcast.status).toBe("sent");
    expect(existsSync(join(receiverPath, "ψ/from-sage-vector-fix/ABSORB.md"))).toBe(true);
    const fleet = JSON.parse(readFileSync(join(fleetDir, "04-sage-vector-fix.json"), "utf8"));
    expect(fleet).toMatchObject({ status: "absorbed", absorbed_into: "arra-oracle-v3-oracle", absorbed_at: fixedNow.toISOString() });
    expect(calls.some(c => c.join(" ") === "gh repo archive Soul-Brews-Studio/sage-vector-fix-oracle --yes")).toBe(true);
    expect(calls.some(c => c[0] === "maw" && c[1] === "hey" && c[2] === "federation")).toBe(true);
  });

  test("plugin handler supports dry-run text output without side effects", async () => {
    const root = tempRoot();
    const donorPath = makeOracle(root, "donor-oracle", { "memory/learnings/a.md": "a" });
    const receiverPath = makeOracle(root, "receiver-oracle");
    const originalCwd = process.cwd();
    process.chdir(root);
    try {
      const result = await handler({
        source: "cli",
        args: [donorPath, "--into", receiverPath, "--dry-run", "--no-archive", "--no-broadcast", "--no-fleet"],
      } as any);
      expect(result.ok).toBe(true);
      expect(result.output).toContain("[dry-run] absorbed donor-oracle → receiver-oracle");
      expect(existsSync(join(receiverPath, "ψ/from-donor/ABSORB.md"))).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
