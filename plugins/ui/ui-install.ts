/**
 * maw ui install / maw ui status
 *
 * install: downloads + extracts a pre-built maw-ui dist from a GitHub Release.
 *          Uses `gh release download` so existing gh auth is reused.
 *
 * status:  reports whether a dist is installed and how many entries it has.
 *
 * After install, `maw serve` automatically serves the UI alongside the API on
 * port 3456.
 *
 * NOTE: the maw-ui repo's release workflow (build.yml tag trigger) publishes
 *       maw-ui-dist.tar.gz as a release asset. Asset name must match what this
 *       file downloads — see buildGhReleaseArgs below.
 */

import { spawnSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";

const REPO = "Soul-Brews-Studio/maw-ui";
const DIST_DIR = join(homedir(), ".maw", "ui", "dist");
const VERSION_MARKER = ".maw-ui-version";

/**
 * Resolve the installed maw-ui version by checking, in order:
 *   1. `.maw-ui-version` marker file written at install time (authoritative)
 *   2. `data-maw-ui-version="..."` attribute on index.html (legacy fallback)
 * Returns null if neither source yields a value. Pure: only reads from disk.
 */
export function resolveInstalledVersion(distDir: string): string | null {
  try {
    const marker = readFileSync(join(distDir, VERSION_MARKER), "utf-8").trim();
    if (marker) return marker;
  } catch { /* no marker — fall through */ }
  try {
    const indexHtml = readFileSync(join(distDir, "index.html"), "utf-8");
    const m = indexHtml.match(/data-maw-ui-version="([^"]+)"/);
    if (m) return m[1];
  } catch { /* no index.html — fall through */ }
  return null;
}

/**
 * Pure helper — returns the `gh` CLI args for downloading a release asset.
 * Extracted so tests can verify the command construction without mocking
 * spawnSync or touching the filesystem.
 *
 * When `ref` is undefined, the tag argument is omitted so `gh release
 * download` selects the latest release by default. Passing the literal
 * string "latest" would cause gh to look for a tag named "latest" — which
 * doesn't exist — and fail with "release not found".
 */
export function buildGhReleaseArgs(repo: string, ref: string | undefined, dir: string): string[] {
  const args = ["release", "download"];
  if (ref) args.push(ref);
  args.push("-R", repo, "--pattern", "maw-ui-dist.tar.gz", "--dir", dir);
  return args;
}

export async function cmdUiInstall(version?: string): Promise<void> {
  const displayRef = version ?? "latest";

  process.stdout.write(`⚡ downloading maw-ui ${displayRef} from ${REPO}...\n`);

  const tmpDir = mkdtempSync(join(tmpdir(), "maw-ui-"));
  try {
    const dl = spawnSync("gh", buildGhReleaseArgs(REPO, version, tmpDir), { encoding: "utf-8" });

    if (dl.status !== 0) {
      console.error(`  → ensure: gh auth status, and a release with maw-ui-dist.tar.gz asset exists`);
      throw new Error(`gh release download failed:\n${dl.stderr}`);
    }

    const tarPath = join(tmpDir, "maw-ui-dist.tar.gz");

    // Wipe + recreate target so no stale files remain
    rmSync(DIST_DIR, { recursive: true, force: true });
    mkdirSync(DIST_DIR, { recursive: true });

    const ext = spawnSync("tar", ["-xzf", tarPath, "-C", DIST_DIR, "--strip-components=1"], {
      encoding: "utf-8",
    });
    if (ext.status !== 0) {
      throw new Error(`tar extraction failed:\n${ext.stderr}`);
    }

    const files = readdirSync(DIST_DIR);
    if (files.length === 0) {
      throw new Error(`no files extracted to ${DIST_DIR}`);
    }

    // Write a version marker so `maw ui status` can report the real version.
    // If ref was undefined ("latest"), resolve the actual tag via gh so the
    // marker matches what was downloaded rather than the word "latest".
    let markerRef = version;
    if (!markerRef) {
      const tagLookup = spawnSync("gh", ["release", "view", "-R", REPO, "--json", "tagName", "-q", ".tagName"], { encoding: "utf-8" });
      if (tagLookup.status === 0) markerRef = tagLookup.stdout.trim();
    }
    if (markerRef) writeFileSync(join(DIST_DIR, VERSION_MARKER), markerRef + "\n");

    console.log(`✓ maw-ui ${displayRef} installed → ${DIST_DIR} (${files.length} top-level entries)`);
    console.log(`  → restart maw server to serve the new UI: pm2 restart maw OR maw serve`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function cmdUiStatus(): Promise<void> {
  if (!existsSync(DIST_DIR)) {
    console.log(`✗ maw-ui not installed`);
    console.log(`  → run: maw ui install`);
    return;
  }

  const files = readdirSync(DIST_DIR);
  const version = resolveInstalledVersion(DIST_DIR);
  const versionStr = version ? (version.startsWith("v") ? version : `v${version}`) : "(version unknown)";
  console.log(`✓ maw-ui ${versionStr} at ${DIST_DIR}`);
  console.log(`  ${files.length} top-level entries`);
}
