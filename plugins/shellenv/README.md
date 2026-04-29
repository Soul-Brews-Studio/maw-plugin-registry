# maw-shellenv

> Emit shell init code for the `maw warp` ergonomic.

A community plugin for [maw-js](https://github.com/Soul-Brews-Studio/maw-js) that emits
shell init code for `eval "$(maw shellenv <shell>)"` installation. Adds a `maw()` shell
function that intercepts `maw warp [<oracle>]` (in-shell `cd`) and passes everything else
through to the real binary.

Pattern borrowed from `direnv hook`, `zoxide init`, `starship init`, `brew shellenv`,
and `rbenv init` — five precedents users already trust.

## Status

Extracted from `maw-js` v26.4.x bundled set on 2026-04-29 as part of the lean-core
extraction (Path A.2 of #640).

## Install

```bash
maw plugin install shellenv
```

The plugin is sha256-pinned in the [maw-plugin-registry](https://github.com/Soul-Brews-Studio/maw-plugin-registry).

## Usage

Add to `~/.zshrc` (zsh) or `~/.bashrc` (bash):

```bash
eval "$(maw shellenv zsh)"     # zsh
eval "$(maw shellenv bash)"    # bash
```

Then:

```bash
maw warp            # cd into the default oracle (mawjs)
maw warp <oracle>   # cd into a specific oracle's repo
maw <other>         # everything else passes through to the real binary
```

`fish` is deferred to v2 — see [#812](https://github.com/Soul-Brews-Studio/maw-js/issues/812).

## Why a plugin?

`warp` is shell-only by design (a child process can't `cd` its parent). The init snippet
is the smallest workable surface that gives `maw warp` the same UX as `direnv` /
`zoxide`. Splitting it out of the core bundle keeps `maw-js` lean — users who don't want
the shell function never load it.

## Development

```bash
bun install         # install peerDeps locally for testing
bun test            # run smoke tests
```

## License

MIT — Copyright (c) 2026 Soul-Brews-Studio
