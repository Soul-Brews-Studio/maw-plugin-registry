# maw-rename

> Tmux window rename with oracle-prefix auto-format.

A community plugin for [maw-js](https://github.com/Soul-Brews-Studio/maw-js)
that renames a tmux window in the current session and auto-prefixes the new
name with the oracle name derived from the session.

## Status

Extracted from `maw-js` v26.4.x bundled set on 2026-04-29 as part of the
lean-core extraction (Path A.3 of #640). Selected by audit (#640 comment
4337675455) for its tight scope: 63 LOC, leaf plugin, no state, pure tmux.

Tmux access uses `node:child_process.spawnSync` directly — the same pattern
shipped in [maw-bg](https://github.com/Soul-Brews-Studio/maw-bg). The
public `@maw-js/sdk` doesn't currently expose `tmux` (tracked in
[maw-js#855](https://github.com/Soul-Brews-Studio/maw-js/issues/855)).

## Install

```bash
maw plugin install rename
```

The plugin is sha256-pinned in the
[maw-plugin-registry](https://github.com/Soul-Brews-Studio/maw-plugin-registry).

## Usage

```bash
maw rename <tab# or name> <new-name>
```

Examples (assuming you're in tmux session `03-neo`):

```bash
maw rename 6 claude-proxy           # tab 6 → "neo-claude-proxy"
maw rename old-tab new-tab          # tab named "old-tab" → "neo-new-tab"
maw rename 2 neo-already-prefixed   # idempotent — stays "neo-already-prefixed"
```

The oracle name is extracted from the session by stripping a leading
`<digits>-` prefix (`03-neo` → `neo`, `12-mawjs` → `mawjs`, `neo` → `neo`).
If the new name already starts with `${oracle}-`, no prefix is added.

## Development

```bash
bun install         # install peerDeps locally for testing
bun test            # run autoPrefix + handler tests
```

## License

MIT — Copyright (c) 2026 Soul-Brews-Studio
