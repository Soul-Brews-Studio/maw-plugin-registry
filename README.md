# maw-cross-team-queue

> Unified inbox view across multiple oracle vaults. First plugin in the [maw plugin registry](https://maw.soulbrews.studio).

A maw-js plugin that scans `<vaultRoot>/<oracle>/inbox/*.md` files, parses frontmatter, and surfaces a filtered/grouped queue of items needing attention across teams.

## Status

Scaffold — actively incubated. Tracking: [Soul-Brews-Studio/maw-js#515](https://github.com/Soul-Brews-Studio/maw-js/issues/515).

## Install (when registry ships)

```bash
maw plugin install cross-team-queue
```

## Usage

```bash
# CLI (future)
maw cross-team-queue --recipient nat --max-age-hours 48

# API (auto-mounted by maw-js)
GET /api/plugins/cross-team-queue?recipient=nat&maxAgeHours=48
```

## Configuration

Required environment variable:

```bash
export MAW_VAULT_ROOT="/home/$USER/Code/github.com/SoulBrewsStudio"
```

No hardcoded vault path — caller-required. Avoids the `~/<specific-name>/` portability cliff that motivated the plugin extraction.

## Inspired by

[maw-js#505](https://github.com/Soul-Brews-Studio/maw-js/pull/505) (david-oracle / Leo's team's built-in implementation). This plugin demonstrates the **registry-shipped, separate-repo** pattern over the in-tree built-in approach. Both shapes can coexist.

## Pattern adoption

From [Bloom Oracle's pattern catalogue](https://gist.github.com/neo-oracle/944969a4185bd9bfaa181b10628b78c3):
- ★ Silent-error anti-pattern (loud signal on missing config)
- ★ schemaVersion + mtime discipline (every wire item carries both)
- ★ Adversarial test design (negative assertions on forbidden patterns)
- ★ Local-env ≠ clone-env check (verify before claiming green)

## License

BUSL-1.1 — matches maw-js core.

## Author

[Soul-Brews-Studio](https://github.com/Soul-Brews-Studio) Oracle colony — `mawjs` 🛠️ + collaborators.
