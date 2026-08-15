/**
 * scan.ts — fingerprint matching tests.
 *
 * Uses setRunOverride() to mock all subprocess calls (pass, ghq, etc.)
 * so the test never touches a real vault. Placeholder fingerprints
 * like "abcd1234efgh5678" stand in for real tokens — these are NOT
 * real secrets.
 *
 * Coverage focus:
 *   - fingerprint map keyed by full token value, never iterated for
 *     printing (asserted by checking formatScan never includes the
 *     placeholder)
 *   - scan refuses to fall back to ~/Code/github.com when ghq fails
 *   - formatScan groups by token name
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  type RunOptions,
  type RunResult,
  setRunOverride,
} from "./lib";
import { cmdScan, formatScan, resolveGhqRoot } from "./scan";

// Placeholder "token" values — 16 chars, NOT real OAuth tokens.
const FAKE_TOKEN_FOO = "abcd1234efgh5678";
const FAKE_TOKEN_BAR = "wxyz9999pppp1111";

let dir: string;
let ghqRoot: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "maw-token-scan-"));
  ghqRoot = join(dir, "ghq", "github.com");
  mkdirSync(ghqRoot, { recursive: true });
});

afterEach(() => {
  setRunOverride(null);
  rmSync(dir, { recursive: true, force: true });
});

function writeEnvrc(org: string, repo: string, body: string): void {
  const repoDir = join(ghqRoot, org, repo);
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(join(repoDir, ".envrc"), body);
}

function mockRunner(state: { tokenNames: string[]; tokenValues: Record<string, string> }) {
  return (cmd: string[], _opts?: RunOptions): RunResult => {
    if (cmd[0] === "ghq" && cmd[1] === "root") {
      return { ok: true, exitCode: 0, stdout: `${dir}/ghq\n`, stderr: "" };
    }
    if (cmd[0] === "pass" && cmd[1] === "ls" && cmd[2] === "claude") {
      const lines = state.tokenNames.map(n => `token-${n}`).join("\n");
      return { ok: true, exitCode: 0, stdout: lines, stderr: "" };
    }
    if (cmd[0] === "pass" && cmd[1] === "show") {
      const arg = cmd[2] ?? "";
      const name = arg.replace(/^claude\/token-/, "");
      const val = state.tokenValues[name];
      if (val) return { ok: true, exitCode: 0, stdout: val + "\n", stderr: "" };
      return { ok: false, exitCode: 1, stdout: "", stderr: "not found" };
    }
    // direnv allow, anything else
    return { ok: true, exitCode: 0, stdout: "", stderr: "" };
  };
}

describe("scan: fingerprint matching", () => {
  it("matches a repo via structured CLAUDE_TOKEN_NAME", () => {
    setRunOverride(mockRunner({
      tokenNames: ["foo"],
      tokenValues: { foo: FAKE_TOKEN_FOO },
    }));
    writeEnvrc("acme", "alpha", 'export CLAUDE_TOKEN_NAME="foo"\n');

    const r = cmdScan({ home: dir });
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      label: "acme/alpha",
      tokenName: "foo",
      method: "named",
    });
  });

  it("falls back to fingerprint when no structured name present", () => {
    setRunOverride(mockRunner({
      tokenNames: ["foo"],
      tokenValues: { foo: FAKE_TOKEN_FOO },
    }));
    // Repo with literal token embedded in .envrc and no CLAUDE_TOKEN_NAME.
    writeEnvrc("acme", "beta", `export CLAUDE_CODE_OAUTH_TOKEN="${FAKE_TOKEN_FOO}"\n`);

    const r = cmdScan({ home: dir });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      label: "acme/beta",
      tokenName: "foo",
      method: "matched",
    });
  });

  it("marks repos with CLAUDE_CODE_OAUTH_TOKEN but no known fingerprint as unmatched", () => {
    setRunOverride(mockRunner({
      tokenNames: ["foo"],
      tokenValues: { foo: FAKE_TOKEN_FOO },
    }));
    writeEnvrc("acme", "gamma", 'export CLAUDE_CODE_OAUTH_TOKEN="unknown-mystery-token"\n');

    const r = cmdScan({ home: dir });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      label: "acme/gamma",
      tokenName: "unknown",
      method: "unmatched",
    });
  });

  it("skips repos with no token references at all", () => {
    setRunOverride(mockRunner({
      tokenNames: ["foo"],
      tokenValues: { foo: FAKE_TOKEN_FOO },
    }));
    writeEnvrc("acme", "delta", 'export OTHER=irrelevant\n');

    const r = cmdScan({ home: dir });
    expect(r.rows).toHaveLength(0);
  });

  it("groups multiple repos under one token name in formatScan", () => {
    setRunOverride(mockRunner({
      tokenNames: ["foo", "bar"],
      tokenValues: { foo: FAKE_TOKEN_FOO, bar: FAKE_TOKEN_BAR },
    }));
    writeEnvrc("acme", "one", 'export CLAUDE_TOKEN_NAME="foo"\n');
    writeEnvrc("acme", "two", 'export CLAUDE_TOKEN_NAME="foo"\n');
    writeEnvrc("acme", "three", 'export CLAUDE_TOKEN_NAME="bar"\n');

    const r = cmdScan({ home: dir });
    expect(r.rows).toHaveLength(3);
    const output = formatScan(r);
    expect(output).toContain("foo (2 repos)");
    expect(output).toContain("bar (1 repos)");
    expect(output).toContain("acme/one");
    expect(output).toContain("acme/two");
    expect(output).toContain("acme/three");
  });

  it("CRITICAL: never prints token VALUE in scan output", () => {
    setRunOverride(mockRunner({
      tokenNames: ["foo"],
      tokenValues: { foo: FAKE_TOKEN_FOO },
    }));
    // Repo with the literal fingerprint embedded.
    writeEnvrc("acme", "leaky", `export CLAUDE_CODE_OAUTH_TOKEN="${FAKE_TOKEN_FOO}"\n`);

    const r = cmdScan({ home: dir });
    const output = formatScan(r);
    // The token VALUE must NOT appear anywhere in output.
    expect(output).not.toContain(FAKE_TOKEN_FOO);
    expect(output).not.toContain(FAKE_TOKEN_BAR);
    // The token NAME is fine to display.
    expect(output).toContain("foo");
  });

  it("refuses to scan when ghq root is unavailable (no hardcoded fallback)", () => {
    // Mock ghq to fail outright.
    setRunOverride((cmd: string[]): RunResult => {
      if (cmd[0] === "ghq") {
        return { ok: false, exitCode: 1, stdout: "", stderr: "ghq: not found" };
      }
      return { ok: true, exitCode: 0, stdout: "", stderr: "" };
    });

    const r = cmdScan({ home: dir });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ghq root unavailable/i);
    // Critically: error must NOT mention ~/Code/github.com as a fallback.
    expect(r.error ?? "").not.toContain("~/Code/github.com");
  });

  it("resolveGhqRoot returns null when ghq exits non-zero", () => {
    setRunOverride(() => ({
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: "",
    }));
    expect(resolveGhqRoot()).toBeNull();
  });
});

describe("scan: empty-vault and edge cases", () => {
  it("formats empty result correctly", () => {
    setRunOverride(mockRunner({
      tokenNames: [],
      tokenValues: {},
    }));
    const r = cmdScan({ home: dir });
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(0);
    expect(formatScan(r)).toContain("No .envrc files");
  });

  it("emits the `*` legend when at least one unmatched row exists", () => {
    setRunOverride(mockRunner({
      tokenNames: ["foo"],
      tokenValues: { foo: FAKE_TOKEN_FOO },
    }));
    writeEnvrc("acme", "mystery", 'export CLAUDE_CODE_OAUTH_TOKEN="not-in-vault"\n');

    const out = formatScan(cmdScan());
    expect(out).toContain("mystery *");
    expect(out).toContain("* = token not in pass vault");
  });
});
