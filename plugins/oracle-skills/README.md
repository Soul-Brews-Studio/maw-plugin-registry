# maw oracle-skills

Wraps the [`arra-oracle-skills`](https://github.com/Soul-Brews-Studio/arra-oracle-skills-cli) CLI as a maw plugin. Installs Oracle skills to Claude Code, OpenCode, Cursor, and 11+ AI coding agents.

This plugin is a thin dispatcher: every `maw oracle-skills <verb> [args]` call is forwarded to `arra-oracle-skills <verb> [args]` with stdio inherited. The upstream CLI owns help text, verb routing, and output.

## Install

```bash
bun add -g arra-oracle-skills
maw plugin install oracle-skills
```

For local dev against an unpublished checkout:

```bash
cd /path/to/arra-oracle-skills-cli && bun link && bun link arra-oracle-skills
```

## Usage

```bash
maw oracle-skills --help
maw oracle-skills agents          # list supported AI agents
maw oracle-skills install         # install skills to agents
maw oracle-skills list            # show installed skills
maw oracle-skills awaken          # Oracle awakening ritual
maw oracle-skills xray memory     # deep scan
```

All verbs from `arra-oracle-skills` pass through transparently: `agents`, `install`, `init`, `uninstall`, `select`, `list`, `profiles`, `about`, `awaken`, `inspect`, `xray`, `shortcut`, `contacts`.

## Failure mode

If `arra-oracle-skills` is not on `$PATH`, the wrapper fails with an install hint. No auto-install — consistent with `maw token` (which assumes `pass` / `direnv` are present).

## License

MIT
