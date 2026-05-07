import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import { checkMawJsBranch } from "./maw-js-branch-check";

// We test the full check by setting $MAW_JS_SOURCE to a tmp git repo
// and exercising each branch state.

function init(repo: string) {
  execSync(`git -C '${repo}' init -q`);
  execSync(`git -C '${repo}' config user.email t@e`);
  execSync(`git -C '${repo}' config user.name t`);
  execSync(`git -C '${repo}' commit --allow-empty -q -m base`);
}

describe("checkMawJsBranch (#1180)", () => {
  let tmp: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "maw-js-test-"));
    prevEnv = process.env.MAW_JS_SOURCE;
    process.env.MAW_JS_SOURCE = tmp;
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (prevEnv === undefined) delete process.env.MAW_JS_SOURCE;
    else process.env.MAW_JS_SOURCE = prevEnv;
  });

  it("missing clone → ok with skip message", async () => {
    process.env.MAW_JS_SOURCE = "/nonexistent/path";
    const result = await checkMawJsBranch();
    expect(result.ok).toBe(true);
    expect(result.message).toContain("no local maw-js clone found");
  });

  it("on alpha → ok", async () => {
    init(tmp);
    execSync(`git -C '${tmp}' checkout -q -b alpha`);
    const result = await checkMawJsBranch();
    expect(result.ok).toBe(true);
    expect(result.message).toContain("on alpha");
  });

  it("on other branch with no alpha ref → ok, no comparison", async () => {
    init(tmp);
    execSync(`git -C '${tmp}' checkout -q -b feat/foo`);
    const result = await checkMawJsBranch();
    expect(result.ok).toBe(true);
    expect(result.message).toContain("no local alpha ref");
  });

  it("on other branch, alpha at parity → ok", async () => {
    init(tmp);
    execSync(`git -C '${tmp}' checkout -q -b alpha`);
    execSync(`git -C '${tmp}' checkout -q -b feat/foo`);
    const result = await checkMawJsBranch();
    expect(result.ok).toBe(true);
    expect(result.message).toContain("at parity");
  });

  it("on other branch, alpha ahead → WARN with count", async () => {
    init(tmp);
    execSync(`git -C '${tmp}' checkout -q -b feat/foo`);
    execSync(`git -C '${tmp}' checkout -q -b alpha`);
    execSync(`git -C '${tmp}' commit --allow-empty -q -m fix1`);
    execSync(`git -C '${tmp}' commit --allow-empty -q -m fix2`);
    execSync(`git -C '${tmp}' commit --allow-empty -q -m fix3`);
    execSync(`git -C '${tmp}' checkout -q feat/foo`);

    const result = await checkMawJsBranch();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("3 unmerged commits");
    expect(result.message).toContain("git checkout alpha");
  });

  it("singular commit count uses 'commit' not 'commits'", async () => {
    init(tmp);
    execSync(`git -C '${tmp}' checkout -q -b feat/foo`);
    execSync(`git -C '${tmp}' checkout -q -b alpha`);
    execSync(`git -C '${tmp}' commit --allow-empty -q -m fix1`);
    execSync(`git -C '${tmp}' checkout -q feat/foo`);

    const result = await checkMawJsBranch();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("1 unmerged commit ");
    expect(result.message).not.toContain("1 unmerged commits");
  });
});
