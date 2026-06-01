/**
 * resolvePsi — cwd-independent vault resolution.
 *
 * Regression cover for the #102 follow-through: `maw team delete` removes the
 * vault manifest via resolvePsi(), so resolution MUST agree with `create`
 * regardless of the process cwd (interactive shell vs launchd daemon).
 *
 * Precedence under test:
 *   1. MAW_PSI env override — explicit, works from any cwd.
 *   2. walk UP for an oracle root (CLAUDE.md + ψ/ both present).
 *   3. ~/ψ stable fallback — never mints a stray ψ in an arbitrary cwd.
 *
 * realpathSync() normalizes mkdtemp paths because macOS symlinks
 * /var/folders → /private/var/folders, which process.cwd() resolves.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { resolvePsi } from "./team-helpers";

describe("resolvePsi — cwd-independent vault resolution", () => {
  const origCwd = process.cwd();
  const origEnv = process.env.MAW_PSI;
  const made: string[] = [];

  const sandbox = (prefix: string) => {
    const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    made.push(d);
    return d;
  };

  afterEach(() => {
    process.chdir(origCwd);
    if (origEnv === undefined) delete process.env.MAW_PSI;
    else process.env.MAW_PSI = origEnv;
    for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("honors MAW_PSI override from a cwd with no oracle root", () => {
    process.chdir(sandbox("psi-noroot-"));
    process.env.MAW_PSI = "/explicit/vault/ψ";
    expect(resolvePsi()).toBe("/explicit/vault/ψ");
  });

  it("falls back to ~/ψ — never cwd/ψ — when no oracle root is found", () => {
    const dir = sandbox("psi-noroot-");
    delete process.env.MAW_PSI;
    process.chdir(dir);
    const r = resolvePsi();
    expect(r).toBe(join(homedir(), "ψ"));
    expect(r).not.toBe(join(dir, "ψ")); // the orphan the old fallback produced
  });

  it("walks up to the nearest oracle root (CLAUDE.md + ψ/)", () => {
    const root = sandbox("psi-oracle-");
    mkdirSync(join(root, "ψ"));
    writeFileSync(join(root, "CLAUDE.md"), "# test oracle\n");
    const sub = join(root, "a", "b");
    mkdirSync(sub, { recursive: true });
    delete process.env.MAW_PSI;
    process.chdir(sub);
    expect(resolvePsi()).toBe(join(root, "ψ"));
  });
});
