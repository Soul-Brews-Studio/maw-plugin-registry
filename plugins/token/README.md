# maw token

Store & restore `.envrc` files via [`pass`](https://www.passwordstore.org/), manage active Claude OAuth tokens. Port of [laris-co/token-oracle](https://github.com/laris-co/token-oracle) (Python → TypeScript).

Tracking: [Soul-Brews-Studio/maw-plugin-registry#54](https://github.com/Soul-Brews-Studio/maw-plugin-registry/issues/54).

## Commands

```bash
maw token list                       # list vault tokens + saved .envrcs (active marked)
maw token use <name> [--no-team]     # switch active Claude token in local .envrc
maw token current                    # print active token name (for statuslines)
maw token save [name] [-f|--force]   # save .envrc to pass vault
maw token load [name] [-f|--force]   # restore .envrc from pass vault + direnv allow
maw token scan                       # scan ghq repos, map tokens to oracles
```

Aliases: `maw token tokens` and `maw token ls` are both `list`.

## Requirements

- [`pass`](https://www.passwordstore.org/) (GPG-encrypted vault)
- [`direnv`](https://direnv.net/) (for `use` / `load` activation)
- [`ghq`](https://github.com/x-motemen/ghq) (for `scan`)

## Vault layout

```
pass/
├── envrc/
│   ├── myrepo                # full .envrc contents
│   └── personal
└── claude/
    ├── token-foo             # Claude OAuth token
    ├── token-prod
    └── token-dev
```

## Security model

Token values are treated as secrets. The plugin enforces the following invariants:

1. **Memory only** — token values are read from `pass show`, used for matching, then dropped when the call returns. They are never persisted to logs, history, or temp files.
2. **No CLI argv leakage** — `pass insert --multiline --force` receives `.envrc` content via stdin, never via argv. (Argv is visible in `ps`.)
3. **Output is name-only** — every user-facing line surfaces a token *name* (e.g. `foo`) or a vault path (`claude/token-foo`). The actual secret never appears in `console.log`, `console.error`, or returned error strings.
4. **Substring tests only** — `scan` matches `.envrc` contents against in-memory token values via substring membership. The fingerprint map (`{tokenValue → name}`) is never iterated for printing.
5. **No `ghq root` fallback** — unlike the Python original, this port refuses to silently default to `~/Code/github.com`. If `ghq root` is unavailable, `scan` reports the gap loudly.
6. **`redact()` helper** — `src/lib.ts` exports `redact(text, ...secrets)` for audit-log paths that might quote `.envrc` contents or `pass` output. Substring-replace (not regex over the secret) keeps the value out of compiled patterns.

If you suspect a leak, audit by piping the suspicious output through `grep -E '(sk-ant-|CLAUDE_CODE_OAUTH_TOKEN=[^"$])'` — the only matches should be inside `pass show ...` subshell expressions inside written `.envrc` files (which is the intended behavior).

## Three `.envrc` formats

Active-token detection (`detectActiveToken` in `src/lib.ts`) handles three historical shapes:

```bash
# 1. New (recommended) — explicit name annotation
export CLAUDE_TOKEN_NAME="foo"
export CLAUDE_CODE_OAUTH_TOKEN="$(pass show claude/token-foo)"

# 2. Direct — pass call inline, name inferred from path
export CLAUDE_CODE_OAUTH_TOKEN="$(pass show claude/token-foo)"

# 3. Legacy var-ref — pass call assigned to a variable
TOKEN_FOO="$(pass show claude/token-foo)"
export CLAUDE_CODE_OAUTH_TOKEN=$TOKEN_FOO
```

## Testing

```bash
cd plugins/token
bun test tests/
```

Tests mock the subprocess runner (`setRunOverride`) so they exercise fingerprinting, `.envrc` parsing, and dispatcher routing without a real `pass` vault. No real tokens are checked into the repo.

## License

MIT — matches the surrounding registry.
