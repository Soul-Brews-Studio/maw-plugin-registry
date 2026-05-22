import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { spawnSync } from "child_process";
import { homedir } from "os";
import { generateReadableUuid, resolveParentUuid, UUID_RE } from "../lib/uuid";
import { TEAMS_DIR, teamDir, configPath, inboxesDir, inboxPath, readConfig, writeConfig, readInbox, appendInbox } from "../lib/config";
import { VALID_COLORS, findClaudeBin, shellQuote, parseMemberSpec, nowMs, nowISO } from "../lib/helpers";
import { parseSimpleYaml, resolveTemplate } from "../lib/yaml";
import { PRESETS, renderCharterYaml } from "../lib/presets";

export async function cmdHelp(): Promise<void> {
  console.log(`\x1b[36mmaw team-agent\x1b[0m — manual team-agent spawn (no Claude tools required)

\x1b[1mUSAGE\x1b[0m
  maw team-agent <subcommand> [args] [flags]

\x1b[1mSUBCOMMANDS\x1b[0m
  create <name> [description]
      Register a team — writes ~/.claude/teams/<name>/config.json with the
      invoking shell as the lead.

  spawn <team> <role>@<cwd>[:<color>] [--mission "<text>"] [--parent <uuid>] [--session-id <uuid>]
      Spawn a new claude.exe teammate via 'maw tile --path --cmd' with the
      8 canonical TeamCreate flags (incl. --session-id for deterministic
      teammate UUIDs). Adds the member to config.json. If --mission is given,
      writes it to the teammate's inbox immediately.

      AUTO-GENERATED session ID format (counter-first, eyeball-readable):
        CCCCCCCC-yymm-ddhh-mmss-RRRRRRRRRRRR
        ^^^^^^^^
        run counter (1,2,3,...) — first 8 hex chars, zero-padded
        Example: 00000007-2605-2216-4530-a3b21c4d5e6f = run #7, 2026-05-22 16:45:30
      Counter persists at ~/.claude/team-agent-counter — survives across sessions.
      Sort UUIDs lexically = creation order.

      PARENT resolution (in order): --parent flag → $CLAUDE_SESSION_ID env →
      newest .jsonl in ~/.claude/projects/<encoded-pwd>/.

  ls [<team>]
      Without args: list all teams.
      With team: show members + inbox counts for that team.

  msg <team> <role> "<text>" [--by <sender>]
      Append a message envelope to inboxes/<role>.json. Mimics SendMessage.
      Default sender is "shell".

  shutdown <team> <role>
      Append {"type":"shutdown_request"} envelope to inboxes/<role>.json.

  kill <team> <role>
      tmux kill-pane on the teammate's pane (looked up from config.json).
      Does NOT remove the member from config — use 'delete' for that.

  delete <team> --confirm
      Remove ~/.claude/teams/<team>/. Requires --confirm. Use --dry-run first.

  uuid [N] [--bare] [--json]
      Generate N counter-first readable UUIDs (default N=1, max 100).
      Each call increments the persisted counter at ~/.claude/team-agent-counter.

      Format: CCCCCCCC-yymm-ddhh-mmss-RRRRRRRRRRRR  (run #N, decimal timestamp prefix)
      Use --bare for plain UUIDs (no #N prefix), --json for structured output.

      Aliases: 'gen', 'generate'.

  help
      Show this message.

\x1b[1mFLAGS\x1b[0m
  --mission <text>      Initial mission text for spawn (delivered to inbox)
  --color <color>       Override color (red|green|yellow|blue|purple|cyan|magenta|white)
  --model <id>          claude.exe model (default: sonnet)
  --parent <uuid>       --parent-session-id for claude.exe (default: $CLAUDE_SESSION_ID)
  --by <sender>         Sender label for msg (default: "shell")
  --confirm             Required for destructive ops
  --dry-run             Print what would happen
  --json                Machine-readable output

\x1b[1mEXAMPLES — parent ID flow\x1b[0m
  # 1. Create a team. A fixed Team UUID is generated automatically
  #    (counter-first decimal) and stored in config.json as 'teamId'.
  maw team-agent create my-demo "Quick test team"
  # → ✓ team created: my-demo
  #   team-id: 00000091-2026-0522-0730-260522073005   ← THE PARENT UUID
  #   config:  ~/.claude/teams/my-demo/config.json

  # 2. Spawn a teammate. --parent is auto-set to the team's teamId
  #    (the lookup is config.json → teamId). You can override explicitly.
  maw team-agent spawn my-demo reader-a@/opt/Code/foo:magenta \\
                       --mission "Read README.md and reply with title"
  # → ⚡ team-agent spawn my-demo/reader-a (magenta) in /opt/Code/foo
  #   parent uuid:    00000091-2026-0522-0730-260522073005 (resolved via team-id) ← USES THE TEAM-ID
  #   teammate uuid:  00000092-2026-0522-0731-260522073155 [run #92]

  # 3. Explicit parent override (rare — uses team-id by default)
  maw team-agent spawn my-demo reader-b@/opt/Code/bar:cyan \\
                       --parent 00000091-2026-0522-0730-260522073005

  # 4. Fixed team-id at create (for reproducibility / cross-host pairing)
  TEAM_ID=\$(maw team-agent uuid --bare | head -1)
  maw team-agent create scripted-team --team-id "\$TEAM_ID"

  # other ops
  maw team-agent ls my-demo            # shows team-id + members
  maw team-agent msg my-demo reader-a "Quick follow-up question"
  maw team-agent shutdown my-demo reader-a
  maw team-agent kill my-demo reader-a
  maw team-agent delete my-demo --confirm

\x1b[1mSTORAGE\x1b[0m
  Teams:     ~/.claude/teams/<name>/config.json
  Inboxes:   ~/.claude/teams/<name>/inboxes/<role>.json
  Same on-disk format used by Claude Code's TeamCreate/SendMessage tools
  — interoperable from both sides.

\x1b[1mWIRE FORMAT\x1b[0m
  See ψ/ralph/55-teammate-message-wire.md for the <teammate-message> XML
  schema. Messages written by this CLI WILL be rendered as XML in any
  Claude session whose teammate-receiver was spawned with --agent-id env.
`);
}

