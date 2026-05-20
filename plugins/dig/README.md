# maw dig

Session mining CLI — view Claude Code `.jsonl` conversation history with human/AI message separation, time-range filters, and keyword grep.

## Usage

```bash
maw dig                          # current repo, last 10 sessions
maw dig 5                        # last 5 sessions
maw dig --recent 10m             # messages from the last 10 minutes
maw dig --recent 15m             # messages from the last 15 minutes
maw dig --all                    # all repos, all sessions
maw dig --timeline               # day-by-day grouped output
maw dig --deep                   # include subagent .jsonl files
```

### Filters

```bash
maw dig --human                  # human messages only
maw dig --ai                     # AI messages only
maw dig --grep "plugin"          # filter messages containing "plugin"
maw dig --oracle <name>          # sessions for a specific oracle (by name fragment)
maw dig --repo <path>            # sessions for a specific repo path fragment
maw dig --tools                  # include tool calls (shown with [tool] prefix)
```

### Combining flags

```bash
maw dig --all --human --grep "error"   # all repos, human-only, matching "error"
maw dig 20 --ai --timeline             # last 20 sessions, AI messages, grouped by day
maw dig --deep --tools --grep "Read"   # deep scan including tool calls matching "Read"
```

## Output format

Color-coded output:

```
15:20 [human    ] create we just create new team? right here?
15:20 [assistant] Anonymous test team — let's go.
15:21 [assistant] Team `anon` is live. 3 oracle members registered.
15:23 [human    ] test it — `maw hey team:anon "hello"`
15:23 [tool     ] Bash {"command":"maw hey ..."}
15:23 [assistant] ✅ 3/3 delivered, 0 failed.
```

- `[human    ]` — green: messages you typed
- `[assistant]` — dim/gray: AI responses
- `[tool     ]` — blue: tool calls (only with `--tools`)
- `[system   ]` — yellow: compaction summaries and hooks

## Session discovery

`maw dig` reads `~/.claude/projects/<encoded-cwd>/*.jsonl`. The encoding maps `/` and `.` to `-`, stripping the leading `/`.

- Default: sessions for the current working directory's repo
- `--all`: all project directories under `~/.claude/projects/`
- `--repo <fragment>`: directories whose name contains the fragment
- `--oracle <fragment>`: alias for `--repo` (oracle name fragment match)
- `--deep`: also scans `<project>/<uuid>/subagents/*.jsonl` for subagent sessions

## Implementation notes

Pure TypeScript/Bun — no Python dependency. Reads `.jsonl` files directly. Each line is a JSON object with `type`, `timestamp`, and `message.content` fields. Human messages are filtered from `type: "user"` entries; system-injected XML blobs are excluded automatically.
