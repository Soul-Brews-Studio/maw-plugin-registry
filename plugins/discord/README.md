# maw discord

Discord fleet ops plugin — token audit (v0.1), bind/status/route/pair (v0.2+).

## Hybrid pattern

Tokens stay in **`pass`** (central, GPG-encrypted, shared via `laris-co/password-store`).
Per-bot non-secret state lives in **`<bot-repo>/.discord/`** (access.json, channel-map.json, config.json, .envrc).

See: `discord-oracle/ψ/outbox/ideas/2026-05-17_self-contained-bot-repo-gpg-pattern.md`

## Subcommands

### v0.1 (shipping)

| Command | Purpose | Side effects |
|---|---|---|
| `maw discord` | help | none |
| `maw discord tokens ls` | list all tokens in `~/.password-store/discord/` (name + size + mtime) | none (no decrypt, no network) |
| `maw discord tokens check [bot]` | decrypt each token + ping Discord REST | network (HTTPS to discord.com) |

### v0.2 (planned)

| Command | Purpose | Side effects |
|---|---|---|
| `maw discord bind <bot>` | end-to-end onboard (ghq get + direnv allow + maw wake) | writes `.discord/`, spawns tmux |
| `maw discord status` | all bots on this host, last heartbeat, channel binding | none |
| `maw discord pair <oracle> <channel>` | seed access.json + channel-map.json | writes 2 config files |
| `maw discord route <from> <to>` | rewire channel-map.json entry | writes config file |

## Known v0.1 caveats

- **`discord-token` returns 401** — legacy aggregate entry from early provisioning days, rotated away. Safe to remove from pass; not used by any active bot.
- **`timekeeper-oracle-token` returns 401** — known token attribution issue documented in `discord-oracle/CLAUDE.md` (Discord Setup → Other bots). Out of scope for this plugin.
- **`pulse-token` ≠ `pulse-oracle-token`** — duplicate entries in pass. Same identity (`Pulse Oracle`). Worth cleaning up but `tokens check` correctly reports both as green.

So a clean run shows **18/20 green**, and that's the expected baseline today.

## Security posture

- ✅ Tokens never printed (only username on successful Discord 200)
- ✅ Decrypt happens via `pass show` (caller must have GPG private key)
- ✅ `fetch()` calls use 5-second `AbortController` timeout (no hanging on hostile/slow Discord)
- ✅ Sequential REST calls (rate-limit polite, debug-friendly)
- ⚠️ No `--strict` mode yet — fail count goes to stdout but exit is `ok:true`. Scripted callers should grep `summary:` line. Add `--strict` in v0.2 if needed.

## Capabilities (plugin.json)

- `fs:read` — reads `~/.password-store/discord/*.gpg` (metadata only) + spawns `pass show`
- `net` — outbound HTTPS to `discord.com/api/v10/users/@me`

## Development

- Pattern reference: `maw-plugin-registry/plugins/team/index.ts` (mawjs-oracle's recommendation)
- SDK guide: shared by `[m5:homekeeper]` on 2026-05-17 (5-step quick start)
- First version shipped: 2026-05-17 by `[m5:discord-oracle]`
