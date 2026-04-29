# maw-bg

> Run long commands in detached tmux; sample output non-destructively.

A `maw-js` community plugin that spawns long-running shell commands inside
detached `tmux` sessions and exposes a small surface for inspecting / managing
them without ever blocking the caller or destroying buffered output.

## Status

**v0.1.0-pre — implemented per [RFC #1](https://github.com/Soul-Brews-Studio/maw-bg/issues/1).**

All six subcommands are wired and tested. Pure-logic tests run unconditionally;
tmux orchestration tests are gated behind `TMUX_TESTS=1` so CI without tmux
can opt out cleanly.

This is **Path A.1**: the first Phase 1 extraction demo for the maw plugin
ecosystem. It is built directly as a community plugin — it does not exist in
the bundled `maw-js` set.

## Subcommands

| Command                                      | Purpose                                                          |
|----------------------------------------------|------------------------------------------------------------------|
| `maw bg "<cmd>" [--name X]`                  | Spawn a command in a detached tmux session (auto- or named slug) |
| `maw bg ls [--json]`                         | List active sessions: slug, status, age, last-line preview       |
| `maw bg tail <slug> [--lines N] [--follow]`  | Sample last N lines (default 200) non-destructively              |
| `maw bg attach <slug>`                       | Re-attach a TTY (or `switch-client` inside an existing tmux)     |
| `maw bg kill <slug>` / `maw bg kill --all`   | Terminate a session (or every `maw-bg-*` session)                |
| `maw bg gc [--dry-run] [--older-than DUR]`   | Reap `done` sessions older than DUR (default 24h)                |

### Slug references

Anywhere a `<slug>` is accepted, you can pass:

- the full slug (`pnpmbuild-a3f1`),
- the 4-hex hash suffix alone (`a3f1`),
- a unique stem prefix (`pnpm`).

### Auto-slug shape

```
<sanitized-stem-≤16>-<sha256(cmd)[:4]>
```

Examples: `npm test` → `npmtest-a3f1`, `cargo build --release` → `cargo-2b8c`,
`./run.sh foo` → `runsh-9d04`, `λ_weird_thing` → `cmd-7f10`.

`--name X` overrides auto-naming. Validation: `^[a-z0-9][a-z0-9-]{0,31}$`.

## Install (from registry)

```bash
maw plugin install bg
```

## Capabilities

Declared in `plugin.json`:

- `tmux` — requires a working `tmux` binary on `PATH`

## Tmux session anatomy

Each spawn creates a single-window, single-pane session named `maw-bg-<slug>`
running:

```
<cmd>; rc=$?; printf '\n[done — exit %d]\n' "$rc"; while :; do read -r _ 2>/dev/null || sleep 3600; done
```

The `read || sleep` tail keeps the pane alive after `<cmd>` exits so
`bg tail` and `bg ls` can still inspect the post-mortem buffer until the
user explicitly `bg kill`s (or `bg gc` does).

## Output preservation

| Phase                   | Mechanism                          | Notes                                  |
|-------------------------|------------------------------------|----------------------------------------|
| Live (running cmd)      | `bg tail` → `tmux capture-pane`    | Non-destructive; default 200 lines     |
| Post-exit, pre-kill     | Same `bg tail` works               | Buffer = tmux's `history-limit`        |
| Post-kill               | **Not preserved**                  | v2 candidate; would need `fs` cap      |

## Tests

```bash
bun test                    # pure-logic tests only
TMUX_TESTS=1 bun test       # also exercises real tmux
```

## License

MIT — community-friendly. (Note: `maw-js` core is BUSL-1.1; this plugin
deliberately uses MIT to lower the contribution barrier for community
extensions.)

## Author

[Soul-Brews-Studio](https://github.com/Soul-Brews-Studio) Oracle colony.
