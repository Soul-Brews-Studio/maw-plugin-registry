#!/usr/bin/env bun
/**
 * Migrate `source` field in registry.json from the legacy
 * `monorepo:plugins/<name>@<tag>` shape to the new bare github-style
 * `owner/repo[/subpath][@ref]` shape.
 *
 * Concrete mapping for this repo:
 *   monorepo:plugins/<name>@<tag>
 *     → soul-brews-studio/maw-plugin-registry/<name>@<tag>
 *
 * Gated on maw-js#939 (the github: resolver) — do NOT run against the live
 * registry.json until that lands.
 *
 * Flags:
 *   --dry-run     Print the would-be diff to stdout, don't write.
 *   --check       Lint mode: exit 1 if any entry has a `source` that is
 *                 neither monorepo:* nor a bare owner/repo[...] github form.
 *   --drop-tag    Drop the trailing `@<tag>` (since `version` already
 *                 encodes it). Default OFF — first migration is conservative.
 *   --self-test   Run the inline fixture-based assertions and exit.
 *   --file <p>    Override path to registry.json (default: ./registry.json
 *                 relative to this script's repo root).
 *
 * Usage:
 *   bun scripts/migrate-source-format.ts --dry-run
 *   bun scripts/migrate-source-format.ts            # writes in place
 *   bun scripts/migrate-source-format.ts --self-test
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET_OWNER_REPO = "soul-brews-studio/maw-plugin-registry";
const MONOREPO_RE = /^monorepo:plugins\/([a-z][a-z0-9-]*)@(.+)$/;
// bare github form: owner/repo[/subpath][@ref] — owner & repo lower-permissive
const GITHUB_BARE_RE =
  /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+(?:\/[^@\s]+)?(?:@[^\s]+)?$/;
// legacy `github:owner/repo#ref`
const GITHUB_PREFIXED_RE = /^github:[^/]+\/[^#]+#[^#]+$/;

export type ConvertOpts = { dropTag?: boolean };
export type ConvertResult =
  | { kind: "converted"; from: string; to: string }
  | { kind: "untouched"; source: string; reason: string }
  | { kind: "warn-unknown"; source: string };

export function convertSource(source: string, opts: ConvertOpts = {}): ConvertResult {
  const m = source.match(MONOREPO_RE);
  if (m) {
    const [, name, tag] = m;
    const subpath = name;
    const ref = opts.dropTag ? "" : `@${tag}`;
    return {
      kind: "converted",
      from: source,
      to: `${TARGET_OWNER_REPO}/${subpath}${ref}`,
    };
  }
  if (GITHUB_PREFIXED_RE.test(source)) {
    return { kind: "untouched", source, reason: "github:-prefixed (legacy, leave alone)" };
  }
  if (GITHUB_BARE_RE.test(source)) {
    return { kind: "untouched", source, reason: "already in bare owner/repo form" };
  }
  return { kind: "warn-unknown", source };
}

type Registry = {
  $schema?: string;
  schemaVersion: number;
  updated: string;
  plugins: Record<string, Record<string, unknown> & { source: string }>;
};

export function migrateRegistry(
  registry: Registry,
  opts: ConvertOpts = {},
): { registry: Registry; results: Array<{ name: string; result: ConvertResult }> } {
  // Re-build with preserved key order. JSON.parse already preserves insertion
  // order in V8/JSC for string keys, and we don't add or reorder anything.
  const out: Registry = {
    ...registry,
    plugins: {} as Registry["plugins"],
  };
  const results: Array<{ name: string; result: ConvertResult }> = [];
  for (const [name, entry] of Object.entries(registry.plugins)) {
    const result = convertSource(entry.source, opts);
    const newEntry = { ...entry };
    if (result.kind === "converted") {
      newEntry.source = result.to;
    }
    out.plugins[name] = newEntry;
    results.push({ name, result });
  }
  return { registry: out, results };
}

// ---- CLI ----

function parseArgs(argv: string[]): {
  dryRun: boolean;
  check: boolean;
  dropTag: boolean;
  selfTest: boolean;
  file?: string;
} {
  const flags = { dryRun: false, check: false, dropTag: false, selfTest: false } as {
    dryRun: boolean;
    check: boolean;
    dropTag: boolean;
    selfTest: boolean;
    file?: string;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--check") flags.check = true;
    else if (a === "--drop-tag") flags.dropTag = true;
    else if (a === "--self-test") flags.selfTest = true;
    else if (a === "--file") flags.file = argv[++i];
    else if (a === "--help" || a === "-h") {
      printHelpAndExit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      printHelpAndExit(2);
    }
  }
  return flags;
}

function printHelpAndExit(code: number): never {
  console.error(
    `migrate-source-format.ts — convert monorepo: → owner/repo source format\n\n` +
      `flags:\n` +
      `  --dry-run    print diff, don't write\n` +
      `  --check      exit 1 if any source is neither monorepo: nor bare github form\n` +
      `  --drop-tag   drop trailing @<tag> (version field already encodes it)\n` +
      `  --self-test  run inline fixture assertions and exit\n` +
      `  --file <p>   path to registry.json (default: <repo>/registry.json)\n`,
  );
  process.exit(code);
}

function defaultRegistryPath(): string {
  // scripts/migrate-source-format.ts → ../registry.json
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(join(here, "..", "registry.json"));
}

function main(argv: string[]) {
  const flags = parseArgs(argv);

  if (flags.selfTest) {
    runSelfTest();
    return;
  }

  const path = flags.file ? resolve(flags.file) : defaultRegistryPath();
  const raw = readFileSync(path, "utf8");
  const registry = JSON.parse(raw) as Registry;

  if (flags.check) {
    let bad = 0;
    for (const [name, entry] of Object.entries(registry.plugins)) {
      const r = convertSource(entry.source);
      if (r.kind === "warn-unknown") {
        console.error(`[check] ${name}: unknown source format: ${entry.source}`);
        bad++;
      }
    }
    if (bad > 0) {
      console.error(`[check] ${bad} unknown source(s) — fail`);
      process.exit(1);
    }
    console.log(`[check] ok — ${Object.keys(registry.plugins).length} plugins`);
    return;
  }

  const { registry: migrated, results } = migrateRegistry(registry, { dropTag: flags.dropTag });

  let converted = 0;
  let unknown = 0;
  for (const { name, result } of results) {
    if (result.kind === "converted") {
      console.log(`[convert] ${name}: ${result.from}  →  ${result.to}`);
      converted++;
    } else if (result.kind === "warn-unknown") {
      console.error(`[warn]    ${name}: unknown source format, leaving alone: ${result.source}`);
      unknown++;
    }
  }
  console.log(
    `\nsummary: ${converted} converted, ${unknown} unknown, ${results.length - converted - unknown} untouched (already github form)`,
  );

  if (flags.dryRun) {
    console.log(`\n[dry-run] not writing.`);
    return;
  }

  // Write back. Preserve 2-space indent + trailing newline (match existing style).
  const json = JSON.stringify(migrated, null, 2) + "\n";
  writeFileSync(path, json);
  console.log(`\nwrote ${path}`);
}

// ---- inline self-test ----

function runSelfTest() {
  const fixture: Registry = {
    $schema: "./schema/registry.json",
    schemaVersion: 1,
    updated: "2026-04-29T00:00:00Z",
    plugins: {
      bg: {
        version: "0.1.2",
        source: "monorepo:plugins/bg@v0.1.2-bg",
        summary: "bg plugin",
        author: "Soul-Brews-Studio",
        license: "MIT",
        addedAt: "2026-04-28T17:28:03Z",
      },
      "third-party": {
        version: "1.0.0",
        source: "github:other-org/cool-plugin#main",
        summary: "third-party plugin (legacy github: form)",
        author: "Other Org",
        license: "MIT",
        addedAt: "2026-04-29T00:00:00Z",
      },
      "already-bare": {
        version: "2.0.0",
        source: "some-org/some-repo@v2.0.0",
        summary: "already in new form",
        author: "Some Org",
        license: "MIT",
        addedAt: "2026-04-29T00:00:00Z",
      },
    },
  };

  let failed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`  ✗ ${msg}`);
      failed++;
    } else {
      console.log(`  ✓ ${msg}`);
    }
  };

  console.log("self-test: convertSource (default)");
  {
    const r = convertSource("monorepo:plugins/bg@v0.1.2-bg");
    assert(r.kind === "converted", "monorepo: should convert");
    if (r.kind === "converted") {
      assert(
        r.to === "soul-brews-studio/maw-plugin-registry/bg@v0.1.2-bg",
        `bg → expected target, got: ${r.to}`,
      );
    }
  }
  console.log("self-test: convertSource (--drop-tag)");
  {
    const r = convertSource("monorepo:plugins/bg@v0.1.2-bg", { dropTag: true });
    assert(r.kind === "converted", "monorepo: should convert with drop-tag");
    if (r.kind === "converted") {
      assert(
        r.to === "soul-brews-studio/maw-plugin-registry/bg",
        `bg --drop-tag → no @ref, got: ${r.to}`,
      );
    }
  }
  console.log("self-test: convertSource (legacy github:)");
  {
    const r = convertSource("github:other-org/cool-plugin#main");
    assert(r.kind === "untouched", "github:-prefixed should be untouched");
  }
  console.log("self-test: convertSource (already bare)");
  {
    const r = convertSource("some-org/some-repo@v2.0.0");
    assert(r.kind === "untouched", "bare owner/repo@ref should be untouched");
  }
  console.log("self-test: convertSource (unknown)");
  {
    const r = convertSource("npm:some-package@1.0.0");
    assert(r.kind === "warn-unknown", "npm: should be flagged unknown");
  }

  console.log("self-test: migrateRegistry (happy path + untouched + key-order)");
  {
    const { registry: out, results } = migrateRegistry(fixture);
    assert(
      out.plugins.bg.source === "soul-brews-studio/maw-plugin-registry/bg@v0.1.2-bg",
      "bg got rewritten",
    );
    assert(
      out.plugins["third-party"].source === "github:other-org/cool-plugin#main",
      "third-party legacy github: untouched",
    );
    assert(
      out.plugins["already-bare"].source === "some-org/some-repo@v2.0.0",
      "already-bare untouched",
    );
    assert(
      JSON.stringify(Object.keys(out.plugins)) ===
        JSON.stringify(["bg", "third-party", "already-bare"]),
      "plugin key order preserved",
    );
    assert(out.schemaVersion === 1, "schemaVersion preserved");
    assert(out.updated === "2026-04-29T00:00:00Z", "updated preserved");
    assert(results.length === 3, "3 result rows");
  }

  console.log("self-test: pretty-print round-trip preserves shape");
  {
    const { registry: out } = migrateRegistry(fixture);
    const json = JSON.stringify(out, null, 2);
    assert(json.includes('"$schema": "./schema/registry.json"'), "$schema preserved");
    assert(json.includes("  "), "uses 2-space indent");
    // ensure no field added that wasn't there
    const reparsed = JSON.parse(json) as Registry;
    assert(
      Object.keys(reparsed.plugins.bg).join(",") === Object.keys(fixture.plugins.bg).join(","),
      "no extra keys added to entry",
    );
  }

  if (failed > 0) {
    console.error(`\nself-test: ${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log(`\nself-test: ok`);
}

// run if invoked as a script (Bun + Node compat)
const isDirectInvocation = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}` ||
      import.meta.url.endsWith(process.argv[1] ?? "");
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  main(process.argv.slice(2));
}
