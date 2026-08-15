# maw-park

> Park (pause) tmux windows with git context for later resume.

A community plugin for [maw-js](https://github.com/Soul-Brews-Studio/maw-js)
that snapshots a tmux window's git context (branch, last commit, dirty files)
plus an optional human-readable note, and writes it to
`~/.config/maw/parked/<window>.json` for later resumption.

Pair with the `resume` subcommand (currently shipped in `maw-js` core; tracking
co-extraction in [maw-js#640](https://github.com/Soul-Brews-Studio/maw-js/issues/640))
to send a recap-style prompt back to the parked window when ready to continue.

## Status

Extracted from `maw-js` v26.4.x bundled set on 2026-04-29 as part of the
lean-core extraction (Path A.4 of #640). Audit-flagged at 9/10 — refactored
at extraction to use direct `node:child_process.spawnSync` for tmux + git
(bg-pattern) since the public `@maw-js/sdk` doesn't expose `tmux` or
`hostExec` (tracked in
[maw-js#855](https://github.com/Soul-Brews-Studio/maw-js/issues/855)).

The original `cmdResume` lived in `park/impl.ts`; on extraction it stays
in maw-js and inlines into the `resume` plugin (cross-plugin coupling
unwound — see the maw-js refactor PR linked from #640).

## Install

```bash
maw plugin install park
```

The plugin is sha256-pinned in the
[maw-plugin-registry](https://github.com/Soul-Brews-Studio/maw-plugin-registry).

## Usage

```bash
maw park                          # park current window
maw park "fix that bug later"     # park current window with a note
maw park other-window             # park a sibling window by name
maw park other-window "WIP"       # park a sibling window with a note
maw park ls                       # list parked windows
```

The snapshot includes:
- `window`, `session` — tmux coordinates
- `branch`, `lastCommit`, `dirtyFiles` — git context derived from the pane's
  `pane_current_path`
- `note` — your free-form text, if any
- `parkedAt` — ISO-8601 timestamp

Files live in `~/.config/maw/parked/<window>.json`.

## Development

```bash
bun install         # install peerDeps locally for testing
bun test            # run pure-fn tests (resolvePark, timeAgo, metadata)
```

## License

MIT — Copyright (c) 2026 Soul-Brews-Studio
