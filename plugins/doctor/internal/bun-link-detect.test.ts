import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { detectBunLinkedCheckout } from "./bun-link-detect";

// We exercise the helper with real symlinks in a tmp dir, mirroring the
// pattern used elsewhere in the doctor plugin (maw-js-branch-check.test.ts
// uses real git repos). Real symlinks make readlinkSync behave naturally
// without monkey-patching node:fs.

describe("detectBunLinkedCheckout (#1281)", () => {
  let tmp: string;
  let globalNm: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "bun-link-test-"));
    globalNm = join(tmp, "global-node-modules");
    mkdirSync(globalNm, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns the checkout path when maw-js is symlinked to a local checkout", () => {
    const checkout = join(tmp, "maw-js-checkout");
    mkdirSync(checkout, { recursive: true });
    writeFileSync(
      join(checkout, "package.json"),
      JSON.stringify({ name: "maw-js", version: "1.0.0" }),
    );
    symlinkSync(checkout, join(globalNm, "maw-js"));

    expect(detectBunLinkedCheckout(globalNm)).toBe(checkout);
  });

  it("returns null when maw-js is not present at all (not installed/linked)", () => {
    expect(detectBunLinkedCheckout(globalNm)).toBeNull();
  });

  it("returns null when maw-js is a real directory (npm/bun install — not a link)", () => {
    const realDir = join(globalNm, "maw-js");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(
      join(realDir, "package.json"),
      JSON.stringify({ name: "maw-js", version: "1.0.0" }),
    );

    expect(detectBunLinkedCheckout(globalNm)).toBeNull();
  });

  it("returns null when symlink target is not a maw-js checkout", () => {
    const otherPkg = join(tmp, "other-pkg");
    mkdirSync(otherPkg, { recursive: true });
    writeFileSync(
      join(otherPkg, "package.json"),
      JSON.stringify({ name: "some-other-pkg", version: "1.0.0" }),
    );
    symlinkSync(otherPkg, join(globalNm, "maw-js"));

    expect(detectBunLinkedCheckout(globalNm)).toBeNull();
  });

  it("returns null when symlink target has no package.json", () => {
    const emptyDir = join(tmp, "empty");
    mkdirSync(emptyDir, { recursive: true });
    symlinkSync(emptyDir, join(globalNm, "maw-js"));

    expect(detectBunLinkedCheckout(globalNm)).toBeNull();
  });
});
