# Contributing to maw-plugin-registry

Thanks for wanting to list a plugin. The process is intentionally small.

**Important**: Plugins live here in the registry, NOT in the [maw-js](https://github.com/Soul-Brews-Studio/maw-js) core repo. PRs adding plugins to maw-js will be closed and redirected here.

## Submitting a new plugin

1. **Fork** this repo and create a branch.
2. **Add your plugin** to `plugins/<your-plugin-name>/`:
   - `index.ts` — plugin handler
   - `plugin.json` — plugin metadata (name, version, entry, description)
   - `registry.meta.json` — registry-specific metadata (see below)
3. **Run the build script**: `python3 scripts/build-registry.py`
4. **Open a PR** titled `add plugin: <your-plugin-name>`.

### Plugin files

**`plugins/<name>/plugin.json`** — your plugin's identity:
```json
{
  "name": "your-plugin-name",
  "version": "0.1.0",
  "entry": "./index.ts",
  "sdk": "^1.0.0",
  "description": "What it does in one line.",
  "cli": {
    "command": "your-plugin-name",
    "help": "maw your-plugin-name [args]"
  }
}
```

**`plugins/<name>/registry.meta.json`** — registry listing:
```json
{
  "version": "0.1.0",
  "source": "your-org/your-plugin-repo@v0.1.0",
  "sha256": null,
  "summary": "One sentence (≤ 140 chars) describing what the plugin does.",
  "author": "Your Name or Org",
  "license": "MIT",
  "homepage": "https://github.com/your-org/your-plugin-repo",
  "addedAt": "2026-04-18T00:00:00Z"
}
```

### Build step

After adding your files, regenerate `registry.json`:
```bash
python3 scripts/build-registry.py
```

This combines all `plugins/*/registry.meta.json` into the single `registry.json`. Do NOT edit `registry.json` by hand — it's generated.

### Required fields

| field      | what it is                                                     |
|------------|----------------------------------------------------------------|
| `version`  | semver of the published plugin                                 |
| `source`   | `owner/repo[/subpath][@ref]` — see [Source format](#source-format) below |
| `summary`  | one line (≤ 140 chars)                                         |
| `author`   | person or org                                                  |
| `license`  | SPDX identifier (e.g. `MIT`, `Apache-2.0`, `BUSL-1.1`)         |
| `addedAt`  | ISO-8601 timestamp (set once, never edited)                    |

### Source format

The `source` field is a bare github-style locator: `owner/repo[/subpath][@ref]`.

| shape                                | meaning                                                  |
|--------------------------------------|----------------------------------------------------------|
| `owner/repo`                         | whole-repo plugin, default branch                        |
| `owner/repo@v1.2.3`                  | whole-repo plugin pinned to a tag (or branch / SHA)      |
| `owner/repo/path/to/plugin`          | monorepo subpath, default branch                         |
| `owner/repo/path/to/plugin@v1.2.3`   | monorepo subpath pinned to a tag                         |

**Examples:**

```jsonc
// whole-repo plugin
"source": "your-org/your-plugin-repo@v0.1.0"

// monorepo subpath plugin (this registry's own plugins live this way)
"source": "soul-brews-studio/maw-plugin-registry/bg@v0.1.2-bg"
```

The migration from `monorepo:plugins/<name>@<tag>` to the bare
`owner/repo/<name>@<tag>` form has shipped — all 72 entries now use the bare
github form (see PR #6 + the federation/swarm finisher). The legacy
`github:owner/repo#ref` form remains accepted for third-party entries but is
being phased out. CI enforces this via
[`scripts/migrate-source-format.ts --check`](./scripts/migrate-source-format.ts),
which fails on any unknown source shape.

### Optional fields

| field      | notes                                                          |
|------------|----------------------------------------------------------------|
| `sha256`   | left `null` on submission — CI populates on first release tag  |
| `homepage` | usually the plugin's GitHub repo URL                           |

## What CI checks

Two workflows run on every PR:

### Validation Checks

**Fast checks** ([`.github/workflows/validate.yml`](./.github/workflows/validate.yml))
— always run, seconds to complete:

| check | what it does |
|-------|--------------|
| JSONSchema validate | `registry.json` validates against [`schema/registry.json`](./schema/registry.json) |
| source-format guard | `bun scripts/migrate-source-format.ts --check` — rejects any unknown source shape |
| source-format self-test | `bun scripts/migrate-source-format.ts --self-test` |

**Deep PR checks** ([`.github/workflows/validate-pr.yml`](./.github/workflows/validate-pr.yml))
— run when `registry.json`, `plugins/**`, or `schema/**` change:

| step | what it does |
|------|--------------|
| detect changed plugins | scopes downstream checks to plugins touched by your PR |
| regenerate-and-clean | runs `python3 scripts/build-registry.py` and asserts no `registry.json` drift — catches "forgot to run the build script" |
| plugin-json | per-plugin JSONSchema validation of `plugins/<name>/plugin.json` against [`schema/plugin.json`](./schema/plugin.json) |
| license | each touched plugin's `license` field must be one of: `MIT`, `Apache-2.0`, `BUSL-1.1`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause` |
| source-format | each touched plugin's `source` field matches the schema regex; legacy `monorepo:` prefix is rejected with a recovery hint |

When a deep check fails, the workflow posts a comment on your PR with the
expected/actual values and the exact recovery commands.

**Deferred to a follow-up PR** (network-dependent, slow): `gh repo view` to
prove the source repo exists, `gh release view` to prove the pinned ref is a
GitHub release tag, and `sha256` verification of the resolved tarball. Tracked
under defense-in-depth in issue #1.

### Run the deep checks locally

```bash
# scan all plugins, warning-only on legacy entries
bun scripts/validate-registry.ts --step source-format

# scope to specific plugins (PR-equivalent — hard-fails on legacy)
bun scripts/validate-registry.ts --step license --plugins my-plugin
bun scripts/validate-registry.ts --step plugin-json --plugins my-plugin
```

## Plugin side

Your plugin's own repo should have a `plugin.json` that validates against
[`schema/plugin.json`](./schema/plugin.json). Reference it in your manifest via:

```json
{
  "$schema": "https://maw.soulbrews.studio/schema/plugin.json"
}
```

See the reference implementation:
[`Soul-Brews-Studio/maw-cross-team-queue`](https://github.com/Soul-Brews-Studio/maw-cross-team-queue).

## Reviewer guidelines

- Verify the `source` repo exists and is public.
- Verify the `summary` is specific — not marketing copy.
- Do **not** ask for changes to `addedAt` timestamps after a PR is open.
- Prefer merging over long discussion — curation is minimal-taste, not gatekeeping.
