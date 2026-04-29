# Contributing to maw-plugin-registry

Thanks for wanting to list a plugin. The process is intentionally small.

## Submitting a new plugin

1. **Fork** this repo and create a branch.
2. **Add one entry** to [`registry.json`](./registry.json) under the `plugins`
   object, keyed by your plugin's canonical name (kebab-case).
3. **Bump** the top-level `updated` field to the current ISO-8601 UTC timestamp.
4. **Open a PR** titled `add plugin: <your-plugin-name>`.

### Example entry

```jsonc
{
  "your-plugin-name": {
    "version": "0.1.0",
    "source": "your-org/your-plugin-repo@v0.1.0",
    "sha256": null,
    "summary": "One sentence (≤ 140 chars) describing what the plugin does.",
    "author": "Your Name or Org",
    "license": "MIT",
    "homepage": "https://github.com/your-org/your-plugin-repo",
    "addedAt": "2026-04-18T00:00:00Z"
  }
}
```

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

The legacy `github:owner/repo#ref` form is being phased out — see
[`scripts/migrate-source-format.ts`](./scripts/migrate-source-format.ts). Once
the github: resolver in maw-js ships (maw-js#939), that script will rewrite all
existing `monorepo:plugins/<name>@<tag>` entries to the bare form above.

### Optional fields

| field      | notes                                                          |
|------------|----------------------------------------------------------------|
| `sha256`   | left `null` on submission — CI populates on first release tag  |
| `homepage` | usually the plugin's GitHub repo URL                           |

## What CI checks

Every PR runs a JSONSchema validation against
[`schema/registry.json`](./schema/registry.json). Keep your entry valid and the
check turns green.

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
