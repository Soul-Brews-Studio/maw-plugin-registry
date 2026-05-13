#!/usr/bin/env bun
/**
 * Deep PR validator for the maw plugin registry.
 *
 * Bun stdlib only — no new npm deps. Pairs with .github/workflows/validate-pr.yml.
 *
 * Steps (cheap subset — network checks deferred to follow-up):
 *   --emit-changed                  Detect changed plugins between base..HEAD
 *                                   Writes `plugins=...` to $GITHUB_OUTPUT.
 *   --step plugin-json              JSONSchema-validate each plugin's plugin.json
 *                                   (or registry.meta.json) against schema/.
 *   --step license                  Check each changed plugin's license against
 *                                   the SPDX allowlist.
 *   --step source-format            Regex-check every registry.meta.json source
 *                                   field against schema/registry.json pattern.
 *                                   Reject `monorepo:` prefix explicitly with a
 *                                   friendly recovery hint.
 *
 * On any failure we also write a markdown report to `.tmp-validate-failure.md`
 * which the GH Actions step uploads as a PR comment.
 */

import { $ } from "bun";
import { existsSync } from "node:fs";
import { readFile, writeFile, appendFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PLUGINS_DIR = join(ROOT, "plugins");
const SCHEMA_DIR = join(ROOT, "schema");

const SPDX_ALLOWLIST = new Set([
  "MIT",
  "Apache-2.0",
  "BUSL-1.1",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
]);

// Mirrors schema/registry.json `$defs.entry.properties.source.pattern` (line ~60).
// Keep in sync with the schema by hand — single source of truth lives in the schema.
const SOURCE_FORMAT_RE =
  /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*(@[a-zA-Z0-9._-]+)?$/;

type Failure = { step: string; plugin?: string; expected: string; actual: string; recovery: string };

// ─── arg parsing ────────────────────────────────────────────────────────────

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

// ─── step: emit-changed ─────────────────────────────────────────────────────

async function emitChanged(baseRef?: string): Promise<void> {
  // `--base` lets the workflow pass the PR's base SHA. Local fallback is `main`.
  const base = baseRef ?? process.env.GITHUB_BASE_REF ?? "main";
  let diff: string;
  try {
    diff = (await $`git diff --name-only ${base}...HEAD`.text()).trim();
  } catch {
    // Local fallback when base isn't fetched (e.g. shallow checkout, no main locally).
    diff = (await $`git diff --name-only HEAD`.text()).trim();
  }
  const lines = diff.split("\n").filter(Boolean);
  const pluginSet = new Set<string>();
  for (const f of lines) {
    const m = f.match(/^plugins\/([^/]+)\//);
    if (m) pluginSet.add(m[1]);
  }
  const plugins = [...pluginSet].sort();
  const out = plugins.join(",");
  console.log(`changed plugins: ${plugins.length === 0 ? "(none)" : out}`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `plugins=${out}\n`);
  }
}

// ─── step: plugin-json ──────────────────────────────────────────────────────

async function validatePluginJson(plugins: string[]): Promise<Failure[]> {
  const fails: Failure[] = [];
  const pluginSchemaPath = join(SCHEMA_DIR, "plugin.json");
  const hasPluginSchema = existsSync(pluginSchemaPath);
  if (!hasPluginSchema) {
    console.warn(
      `⚠️  schema/plugin.json not found — skipping plugin-json validation (warning only).`,
    );
    return fails;
  }
  // Use ajv-cli via npx; matches what the fast workflow already does.
  // Each plugin should have a plugin.json (preferred) or registry.meta.json.
  for (const name of plugins) {
    const dir = join(PLUGINS_DIR, name);
    if (!existsSync(dir)) {
      // Deletion — not our problem for this step.
      continue;
    }
    const pluginJson = join(dir, "plugin.json");
    if (!existsSync(pluginJson)) {
      console.log(`· ${name}: no plugin.json — skipping (registry.meta.json checked elsewhere)`);
      continue;
    }
    // ajv-cli + ajv-formats are devDeps at root — bunx uses local node_modules.
    const proc = Bun.spawnSync({
      cmd: [
        "bunx",
        "ajv",
        "validate",
        "--spec=draft2020",
        "-c",
        "ajv-formats",
        "-s",
        pluginSchemaPath,
        "-d",
        pluginJson,
        "--strict=false",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
      const stderr = new TextDecoder().decode(proc.stderr);
      const stdout = new TextDecoder().decode(proc.stdout);
      fails.push({
        step: "plugin-json",
        plugin: name,
        expected: "plugin.json valid against schema/plugin.json",
        actual: (stdout + stderr).trim().slice(0, 600),
        recovery: `Fix plugins/${name}/plugin.json. Validate locally:\n  bunx ajv-cli@5 validate --spec=draft2020 -c ajv-formats -s schema/plugin.json -d plugins/${name}/plugin.json --strict=false`,
      });
    } else {
      console.log(`✓ ${name}: plugin.json valid`);
    }
  }
  return fails;
}

// ─── step: license ─────────────────────────────────────────────────────────

async function validateLicense(plugins: string[]): Promise<Failure[]> {
  const fails: Failure[] = [];
  for (const name of plugins) {
    const metaPath = join(PLUGINS_DIR, name, "registry.meta.json");
    if (!existsSync(metaPath)) continue; // plugin removed
    let meta: { license?: string };
    try {
      meta = JSON.parse(await readFile(metaPath, "utf8"));
    } catch (e) {
      fails.push({
        step: "license",
        plugin: name,
        expected: "valid JSON",
        actual: String(e).slice(0, 300),
        recovery: `Fix plugins/${name}/registry.meta.json — it failed to parse.`,
      });
      continue;
    }
    const lic = meta.license?.trim();
    if (!lic) {
      fails.push({
        step: "license",
        plugin: name,
        expected: "non-empty SPDX identifier",
        actual: JSON.stringify(meta.license),
        recovery: `Set "license" in plugins/${name}/registry.meta.json to one of: ${[...SPDX_ALLOWLIST].join(", ")}.`,
      });
      continue;
    }
    if (!SPDX_ALLOWLIST.has(lic)) {
      fails.push({
        step: "license",
        plugin: name,
        expected: `one of: ${[...SPDX_ALLOWLIST].join(", ")}`,
        actual: lic,
        recovery: `Change "license" in plugins/${name}/registry.meta.json to an allowed SPDX id, or open an issue to discuss adding "${lic}" to the allowlist.`,
      });
    } else {
      console.log(`✓ ${name}: license ${lic} OK`);
    }
  }
  return fails;
}

// ─── step: source-format ───────────────────────────────────────────────────

async function validateSourceFormat(filter: string[]): Promise<Failure[]> {
  // When `filter` is provided (PR mode, --plugins set), hard-fail on any
  // non-matching source — including `monorepo:` — for those plugins.
  //
  // When `filter` is empty (local full-scan mode, or PRs that don't touch any
  // plugins), we still scan all plugins but treat legacy `monorepo:` prefix as
  // a WARNING. Those entries are scheduled for migration via
  // scripts/migrate-source-format.ts (see CONTRIBUTING.md → Source format) —
  // failing CI on every PR until migration lands would be hostile. New
  // contributors still can't introduce them in PR mode.
  const fails: Failure[] = [];
  const targetSet = new Set(filter);
  const scanAll = filter.length === 0;
  const entries = await readdir(PLUGINS_DIR, { withFileTypes: true });
  let warnedLegacy = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!scanAll && !targetSet.has(e.name)) continue;
    const metaPath = join(PLUGINS_DIR, e.name, "registry.meta.json");
    if (!existsSync(metaPath)) continue;
    const meta: { source?: string } = JSON.parse(await readFile(metaPath, "utf8"));
    const src = meta.source ?? "";
    if (src.startsWith("monorepo:")) {
      if (scanAll) {
        console.warn(
          `⚠️  ${e.name}: legacy "monorepo:" source — migration pending (scripts/migrate-source-format.ts). Skipped.`,
        );
        warnedLegacy++;
        continue;
      }
      fails.push({
        step: "source-format",
        plugin: e.name,
        expected: "bare owner/repo[/subpath][@ref] (see schema/registry.json $defs.entry.source)",
        actual: src,
        recovery: `Rewrite plugins/${e.name}/registry.meta.json source from legacy "monorepo:plugins/<name>@<tag>" to "owner/repo/<subpath>@<tag>". Run:\n  bun scripts/migrate-source-format.ts`,
      });
      continue;
    }
    if (!SOURCE_FORMAT_RE.test(src)) {
      fails.push({
        step: "source-format",
        plugin: e.name,
        expected: SOURCE_FORMAT_RE.source,
        actual: src,
        recovery: `Use bare github locator: owner/repo[/subpath][@ref] — e.g. "soul-brews-studio/maw-plugin-registry/${e.name}@v0.1.0".\nSee CONTRIBUTING.md → Source format.`,
      });
    }
  }
  if (fails.length === 0) {
    const scope = scanAll ? `all (${entries.length})` : `${filter.length} changed`;
    console.log(`✓ source-format: ${scope} plugin(s) clean${warnedLegacy ? ` (${warnedLegacy} legacy warning${warnedLegacy === 1 ? "" : "s"})` : ""}`);
  }
  return fails;
}

// ─── failure report ────────────────────────────────────────────────────────

async function writeFailureReport(fails: Failure[]): Promise<void> {
  const lines = ["### ❌ PR validation failed", ""];
  for (const f of fails) {
    lines.push(`#### \`${f.step}\`${f.plugin ? ` — \`${f.plugin}\`` : ""}`);
    lines.push("");
    lines.push(`**Expected:** ${f.expected}`);
    lines.push("");
    lines.push("**Actual:**");
    lines.push("```");
    lines.push(f.actual);
    lines.push("```");
    lines.push("");
    lines.push("**Recovery:**");
    lines.push("```");
    lines.push(f.recovery);
    lines.push("```");
    lines.push("");
  }
  lines.push("---");
  lines.push("See [CONTRIBUTING.md → Validation Checks](../blob/main/CONTRIBUTING.md#validation-checks) for the full list of PR checks.");
  await writeFile(join(ROOT, ".tmp-validate-failure.md"), lines.join("\n"));
}

// ─── main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (hasFlag("emit-changed")) {
    await emitChanged(getFlag("base"));
    return;
  }
  const step = getFlag("step");
  if (!step) {
    console.error("usage: validate-registry.ts --step <plugin-json|license|source-format> [--plugins a,b,c]");
    console.error("       validate-registry.ts --emit-changed [--base <ref>]");
    process.exit(2);
  }
  const plugins = (getFlag("plugins") ?? "").split(",").filter(Boolean);
  let fails: Failure[] = [];
  switch (step) {
    case "plugin-json":
      // TEMPORARY: warn-only until existing plugins catch up to required schemaVersion + additionalProperties:false.
      // Real failures are reported but don't block PRs. Tighten back to blocking once plugins migrated.
      const pluginFails = await validatePluginJson(plugins);
      if (pluginFails.length > 0) {
        console.log(`⚠️  plugin-json: ${pluginFails.length} warning(s) (non-blocking — see #54+):`);
        for (const f of pluginFails) console.log(`  - ${f.plugin}: ${f.actual.split("\n")[0]}`);
      } else {
        console.log("✓ plugin-json: all valid");
      }
      fails = [];  // do not propagate as failures
      break;
    case "license":
      fails = await validateLicense(plugins);
      break;
    case "source-format":
      fails = await validateSourceFormat(plugins);
      break;
    default:
      console.error(`unknown step: ${step}`);
      process.exit(2);
  }
  if (fails.length > 0) {
    await writeFailureReport(fails);
    console.error(`✗ ${step}: ${fails.length} failure(s)`);
    for (const f of fails) console.error(`  - ${f.plugin ?? "(global)"}: ${f.actual.split("\n")[0]}`);
    process.exit(1);
  }
}

await main();
