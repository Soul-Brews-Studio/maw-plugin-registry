# maw-plugin-registry

Curated registry for **maw** plugins — the manifest source-of-truth behind
[`maw.soulbrews.studio`](https://maw.soulbrews.studio).

## What this is

- [`registry.json`](./registry.json) — the canonical list of plugins the maw CLI
  can discover and install. Add an entry via PR to get your plugin listed.
- [`schema/registry.json`](./schema/registry.json) — JSONSchema describing the
  registry manifest format.
- [`schema/plugin.json`](./schema/plugin.json) — JSONSchema that individual
  plugin repos reference from their own `plugin.json`.
- [`index.html`](./index.html) — landing page that renders `registry.json`
  client-side; hosted on Cloudflare Pages at `maw.soulbrews.studio`.

## How it gets served

This repo is deployed to **Cloudflare Pages** as a static site:

- Build output: the repo root (no build step — pure static files).
- Served paths:
  - `/` → [`index.html`](./index.html) (landing page)
  - `/registry.json` → the manifest (fetched by `maw plugin install ...`)
  - `/schema/registry.json` → registry schema
  - `/schema/plugin.json` → plugin manifest schema

The custom domain `maw.soulbrews.studio` is configured in the Cloudflare Pages
dashboard (manual step by the maintainer — see the repo INCUBATED_BY breadcrumb
for context).

## How to add a plugin

See [CONTRIBUTING.md](./CONTRIBUTING.md). TL;DR: open a PR that appends one
entry to `registry.json`. CI validates the manifest against the schema.

## Curation policy

- Plugins must be public, open-source, and have a resolvable `github:` source.
- No plugin is removed once accepted — deprecation is expressed by setting a
  `deprecated: true` flag (future schema extension) rather than deletion.
  *Nothing is Deleted.*
- The registry does **not** host code. It only points to upstream repos + an
  optional `sha256` of a pinned source tarball.

## License

BUSL-1.1 — see [LICENSE](./LICENSE).

Plugins listed in the registry each carry their own license; the registry
license applies only to the manifest, schemas, and landing page in this repo.
