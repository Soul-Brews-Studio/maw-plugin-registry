/**
 * cmdTutorial — generic Claude Code team protocol tutorial.
 *
 * Teaches the RAW claude.exe + session-id + parent-session-id mechanics.
 * Each step shows the bare command — maw team-agent shortcut shown for reference.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
import { generateReadableUuid } from "../lib/uuid";
import { findClaudeBin, expandTilde } from "../lib/helpers";

const STATE_FILE = join(homedir(), ".claude", "team-agent-tutorial-state.json");

function readState(): Record<string, string> {
  if (!existsSync(STATE_FILE)) return {};
  try { return JSON.parse(readFileSync(STATE_FILE, "utf-8")); } catch { return {}; }
}

function writeState(state: Record<string, string>): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

const blue = "\x1b[36m"; const dim = "\x1b[90m"; const grn = "\x1b[32m"; const rst = "\x1b[0m"; const yel = "\x1b[33m"; const bold = "\x1b[1m"; const mag = "\x1b[35m";

function header(n: number, title: string): void {
  console.log(`${blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${rst}`);
  console.log(`${blue}  TUTORIAL — Step ${n}${rst}  ${bold}${title}${rst}`);
  console.log(`${blue}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${rst}`);
  console.log(``);
}

function section(label: string, lines: string[]): void {
  console.log(`  ${grn}${label}${rst}`);
  for (const l of lines) console.log(`    ${l}`);
  console.log(``);
}

function shortcut(line: string): void {
  console.log(`  ${mag}maw team-agent shortcut:${rst}  ${dim}${line}${rst}`);
  console.log(``);
}

export async function cmdTutorial(args: string[], flags: Record<string, unknown>): Promise<void> {
  const stepNum = args[0] || "0";
  const claudeBin = findClaudeBin();
  const apply = flags["--apply"] === true;

  switch (stepNum) {
    case "reset":
    case "clear": {
      writeState({});
      console.log(`${grn}✓${rst} tutorial state cleared (${STATE_FILE})`);
      return;
    }
    case "state":
    case "status": {
      const s = readState();
      console.log(`${bold}tutorial state:${rst}`);
      console.log(JSON.stringify(s, null, 2));
      return;
    }
    case "0":
    case "list":
    case "":
      console.log(`${bold}Claude Code Team Protocol — tutorial${rst}`);
      console.log(`${dim}Learn the raw mechanics. Copy-paste your way through.${rst}`);
      console.log(``);
      console.log(`  ${yel}maw team-agent tutorial 1 [team-name]${rst}     ${dim}— lead creates team (1×)${rst}`);
      console.log(`  ${yel}maw team-agent tutorial 2 [role] [cwd] [color]${rst}  ${dim}— add a teammate (N×)${rst}`);
      console.log(`  ${yel}maw team-agent tutorial 3 [role]${rst}          ${dim}— send a message${rst}`);
      console.log(`  ${yel}maw team-agent tutorial 4${rst}                  ${dim}— how teammate sees it (XML wire)${rst}`);
      console.log(`  ${yel}maw team-agent tutorial 5 [role]${rst}          ${dim}— graceful shutdown${rst}`);
      console.log(`  ${yel}maw team-agent tutorial 6${rst}                  ${dim}— cleanup (kill + rm config)${rst}`);
      console.log(``);
      console.log(`${dim}Add ${rst}${yel}--apply${rst}${dim} to any step to actually execute (instead of just printing).${rst}`);
      console.log(`${dim}State persists in ${STATE_FILE} — reset with: ${rst}${yel}maw team-agent tutorial reset${rst}`);
      return;

    case "1": {
      const teamName = args[1] || "my-team";
      const { uuid } = generateReadableUuid();
      writeState({ leadSessionId: uuid, teamName });
      header(1, "Lead creates the team");
      console.log(`${dim}  The lead's session-id IS the team identity.${rst}`);
      console.log(`${dim}  Lead does TWO things:${rst}`);
      console.log(`${dim}    a) start claude.exe with --session-id <uuid>${rst}`);
      console.log(`${dim}    b) register the team in ~/.claude/teams/<team>/config.json${rst}`);
      console.log(`${dim}  Then teammates can JOIN the team in step 2 (repeatable, one per member).${rst}`);
      console.log(``);
      section("(a) start lead claude.exe (minimum: 5 flags + 2 env vars):", [
        `${yel}env CLAUDECODE=1 CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 \\${rst}`,
        `${yel}  ${claudeBin} \\${rst}`,
        `${yel}    --session-id ${uuid} \\${rst}`,
        `${yel}    --team-name ${teamName} \\${rst}`,
        `${yel}    --agent-id shell-lead@${teamName} \\${rst}`,
        `${yel}    --agent-name shell-lead${rst}`,
        ``,
        `${dim}# flags explained:${rst}`,
        `${dim}#   CLAUDECODE=1                          enter agent mode${rst}`,
        `${dim}#   CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1  enable team protocol${rst}`,
        `${dim}#   --session-id  lead's UUID — IS the team identity${rst}`,
        `${dim}#   --team-name   binds claude.exe to this team's config.json${rst}`,
        `${dim}#   --agent-id    unique slot: <role>@<team>${rst}`,
        `${dim}#   --agent-name  display name (shown in status bar)${rst}`,
        ``,
        `${dim}# optional cosmetic/behavior flags:${rst}`,
        `${dim}#   --agent-color magenta                tmux status bar color${rst}`,
        `${dim}#   --model sonnet                       defaults vary by setup${rst}`,
        `${dim}#   --dangerously-skip-permissions       headless mode${rst}`,
        ``,
        `${dim}# (running just 'claude --session-id ${uuid}' is NOT enough —${rst}`,
        `${dim}#  without --team-name + --agent-id the process won't join the team)${rst}`,
      ]);
      section(`(b) register team "${teamName}" (raw — file write):`, [
        `${yel}mkdir -p ~/.claude/teams/${teamName}/inboxes${rst}`,
        `${yel}cat > ~/.claude/teams/${teamName}/config.json <<EOF${rst}`,
        `${yel}{${rst}`,
        `${yel}  "name": "${teamName}",${rst}`,
        `${yel}  "sessionId": "${uuid}",${rst}`,
        `${yel}  "teamId": "${uuid}",${rst}`,
        `${yel}  "leadAgentId": "shell-lead@${teamName}",${rst}`,
        `${yel}  "leadSessionId": "${uuid}",${rst}`,
        `${yel}  "members": [${rst}`,
        `${yel}    { "agentId": "shell-lead@${teamName}", "name": "shell-lead", "agentType": "shell" }${rst}`,
        `${yel}  ]${rst}`,
        `${yel}}${rst}`,
        `${yel}EOF${rst}`,
      ]);
      console.log(`  ${grn}team identity:${rst}  ${bold}${uuid}${rst}`);
      console.log(`  ${dim}saved to ${STATE_FILE}${rst}`);
      console.log(``);
      shortcut(`maw team-agent create ${teamName} --session-id ${uuid}    (does (b) — file write)`);
      if (apply) {
        console.log(`${blue}━━ --apply ━━${rst}  ${dim}registering team now...${rst}`);
        const create = spawnSync("maw", ["team-agent", "create", teamName, "--session-id", uuid, "--force"], { stdio: "inherit" });
        if (create.status !== 0) throw new Error(`maw team-agent create failed (exit ${create.status})`);
        console.log(``);
        console.log(`${grn}✓ team "${teamName}" registered. Lead is shell-lead. Now spawn teammates in step 2.${rst}`);
      }
      console.log(`${dim}Next: ${rst}${yel}maw team-agent tutorial 2 [role] [cwd] [color]${rst}  ${dim}(repeat for each teammate)${rst}`);
      return;
    }

    case "2": {
      const state = readState();
      const teamName = state.teamName || "my-team";
      const parentSid = state.leadSessionId || "(run step 1 first!)";
      const memberCount = (state.memberCount ? parseInt(state.memberCount) : 0) + 1;

      // Defaults — prefilled, user can override
      const defaultColors = ["yellow", "green", "cyan", "magenta", "blue", "purple", "red", "white"];
      let role = args[1] || `member-${memberCount}`;
      let cwd = args[2] || process.cwd();
      let color = args[3] || defaultColors[(memberCount - 1) % defaultColors.length];

      header(2, "Add a teammate (interactive)");
      console.log(`${dim}  Each call adds ONE teammate. Repeat with different role for more members.${rst}`);
      console.log(`${dim}  Press Enter to keep default, or type a new value.${rst}`);
      console.log(``);

      // Interactive prompts (only if TTY) — echo confirmed value after each
      if (process.stdin.isTTY) {
        const r = (prompt(`  ${grn}role${rst}    [${role}]:`) || "").trim();
        if (r) role = r;
        console.log(`    ${dim}→ ${rst}${bold}${role}${rst}${r ? `  ${dim}(changed)${rst}` : `  ${dim}(kept default)${rst}`}`);

        const c = (prompt(`  ${grn}cwd${rst}     [${cwd}]:`) || "").trim();
        if (c) cwd = expandTilde(c);
        console.log(`    ${dim}→ ${rst}${bold}${cwd}${rst}${c ? `  ${dim}(changed)${rst}` : `  ${dim}(kept default)${rst}`}`);

        const col = (prompt(`  ${grn}color${rst}   [${color}]:`) || "").trim();
        if (col) color = col;
        console.log(`    ${dim}→ ${rst}${bold}${color}${rst}${col ? `  ${dim}(changed)${rst}` : `  ${dim}(kept default)${rst}`}`);
        console.log(``);
      }

      const { uuid: childSid } = generateReadableUuid();
      writeState({ ...state, lastRole: role, memberCount: String(memberCount) });

      console.log(`${dim}  Adding member #${memberCount}:  ${rst}${bold}${role}${rst}${dim} in ${cwd} (${color})${rst}`);
      console.log(`${dim}  Joining team: ${rst}${bold}${teamName}${rst}${dim} (parent ${parentSid})${rst}`);
      console.log(``);
      console.log(`${dim}  Each call adds ONE teammate. Run this N times for N members.${rst}`);
      console.log(`${dim}  Each teammate gets:${rst}`);
      console.log(`${dim}    - its OWN --session-id${rst}`);
      console.log(`${dim}    - --parent-session-id = lead's uuid (from step 1)${rst}`);
      console.log(`${dim}    - appended to ~/.claude/teams/${teamName}/config.json members${rst}`);
      console.log(``);
      console.log(`${dim}  Adding:  ${rst}${bold}${role}${rst}${dim} in ${cwd} (${color})${rst}`);
      console.log(`${dim}  Joining team: ${rst}${bold}${teamName}${rst}${dim} (parent ${parentSid})${rst}`);
      console.log(``);
      console.log(`${dim}  Teammate has its OWN session-id. parent-session-id points back to the lead.${rst}`);
      console.log(`${dim}  --agent-id / --agent-name / --team-name / --agent-color teach Claude this is a team member.${rst}`);
      console.log(``);
      section("raw command (copy-paste into the teammate's terminal):", [
        `${yel}cd ${cwd} && \\${rst}`,
        `${yel}  env CLAUDECODE=1 CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 \\${rst}`,
        `${yel}  ${claudeBin} \\${rst}`,
        `${yel}    --session-id ${childSid} \\${rst}`,
        `${yel}    --agent-id ${role}@${teamName} \\${rst}`,
        `${yel}    --agent-name ${role} \\${rst}`,
        `${yel}    --team-name ${teamName} \\${rst}`,
        `${yel}    --agent-color ${color} \\${rst}`,
        `${yel}    --parent-session-id ${parentSid} \\${rst}`,
        `${yel}    --model sonnet \\${rst}`,
        `${yel}    --dangerously-skip-permissions${rst}`,
      ]);
      console.log(`  ${grn}flag breakdown:${rst}`);
      console.log(`    ${dim}--session-id        teammate's OWN uuid (this run)${rst}`);
      console.log(`    ${dim}--parent-session-id lead's uuid (from step 1)${rst}`);
      console.log(`    ${dim}--agent-id          unique key: <role>@<team>${rst}`);
      console.log(`    ${dim}--agent-name        display name${rst}`);
      console.log(`    ${dim}--team-name         team registry key${rst}`);
      console.log(`    ${dim}--agent-color       tmux status bar color${rst}`);
      console.log(``);
      console.log(`  ${grn}(a) append member to config.json:${rst}`);
      console.log(`    ${dim}jq '.members += [...]' ~/.claude/teams/${teamName}/config.json${rst}`);
      console.log(`    ${dim}— see 'maw team-agent ls ${teamName}' for current members${rst}`);
      console.log(``);
      shortcut(`maw team-agent spawn ${teamName} ${role}@${cwd}:${color} --mission "..."  (writes config + spawns)`);

      // Interactive apply prompt if TTY and --apply not explicit
      let doApply = apply;
      if (!apply && process.stdin.isTTY) {
        const ans = (prompt(`  ${grn}apply now?${rst} [Y/n]:`) || "").trim();
        doApply = !/^n(o)?$/i.test(ans);
      }

      if (doApply) {
        console.log(``);
        console.log(`${blue}━━ apply ━━${rst}  ${dim}adding ${role} to ${teamName}...${rst}`);
        const spawn = spawnSync("maw", ["team-agent", "spawn", teamName, `${role}@${cwd}:${color}`], { stdio: "inherit" });
        if (spawn.status !== 0) throw new Error(`maw team-agent spawn failed (exit ${spawn.status})`);
        console.log(``);
        console.log(`${grn}✓ ${role} added to ${teamName}. Lead's SendMessage can now find them.${rst}`);
        console.log(`${dim}  → repeat ${rst}${yel}maw team-agent tutorial 2${rst}${dim} to add more members${rst}`);
      } else {
        console.log(`${dim}  not applied — copy the raw command above to do it manually${rst}`);
      }

      console.log(``);
      console.log(`${dim}Next: ${rst}${yel}maw team-agent tutorial 3${rst}  ${dim}(send a message) or ${rst}${yel}tutorial 2${rst}${dim} again for more${rst}`);
      return;
    }

    case "3": {
      const state = readState();
      const teamName = args[1] || state.teamName || "my-team";
      const role = args[2] || state.role || "architect";
      const inboxPath = `~/.claude/teams/${teamName}/inboxes/${role}.json`;

      header(3, "Send a message (inbox JSON envelope)");
      console.log(`${dim}  Claude Code reads messages from ~/.claude/teams/<team>/inboxes/<role>.json${rst}`);
      console.log(`${dim}  It's a JSON array of envelopes. Append to send.${rst}`);
      console.log(``);
      section("envelope format:", [
        `${yel}{${rst}`,
        `${yel}  "from": "shell-lead",${rst}`,
        `${yel}  "text": "Review the auth flow",${rst}`,
        `${yel}  "summary": "auth review",${rst}`,
        `${yel}  "timestamp": "${new Date().toISOString()}",${rst}`,
        `${yel}  "color": "yellow",${rst}`,
        `${yel}  "read": false${rst}`,
        `${yel}}${rst}`,
      ]);
      section("append via shell (raw):", [
        `${yel}mkdir -p ~/.claude/teams/${teamName}/inboxes${rst}`,
        `${yel}jq '. += [{from: "shell", text: "your msg", timestamp: "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'", read: false}]' \\${rst}`,
        `${yel}   ${inboxPath} > /tmp/inbox.tmp && mv /tmp/inbox.tmp ${inboxPath}${rst}`,
      ]);
      shortcut(`maw team-agent msg ${teamName} ${role} "your msg here"`);
      console.log(`${dim}Next: ${rst}${yel}maw team-agent tutorial 4${rst}  ${dim}(how teammate sees it)${rst}`);
      return;
    }

    case "4": {
      header(4, "How the teammate sees the message");
      console.log(`${dim}  When the teammate's claude.exe reads the inbox, it renders each envelope as XML:${rst}`);
      console.log(``);
      section("rendered as XML in teammate's context:", [
        `${yel}<teammate-message teammate_id="shell-lead" color="yellow" summary="auth review">${rst}`,
        `${yel}Review the auth flow${rst}`,
        `${yel}</teammate-message>${rst}`,
      ]);
      console.log(`  ${grn}where this happens:${rst}`);
      console.log(`    ${dim}- Regex baked into claude.exe binary (5 body shapes: text/json/shutdown/idle/error)${rst}`);
      console.log(`    ${dim}- See ψ/ralph/55-teammate-message-wire.md for the literal regex${rst}`);
      console.log(``);
      console.log(`  ${grn}teammate's REPLY appears in the LEAD's context the same way:${rst}`);
      console.log(`    ${yel}<teammate-message teammate_id="architect" color="yellow" summary="...">${rst}`);
      console.log(`    ${yel}reply text${rst}`);
      console.log(`    ${yel}</teammate-message>${rst}`);
      console.log(``);
      console.log(`${dim}Next: ${rst}${yel}maw team-agent tutorial 5${rst}  ${dim}(graceful shutdown)${rst}`);
      return;
    }

    case "5": {
      const state = readState();
      const teamName = args[1] || state.teamName || "my-team";
      const role = args[2] || state.role || "architect";

      header(5, "Graceful shutdown (shutdown_request envelope)");
      console.log(`${dim}  Append a special envelope. Claude.exe sees it, replies shutdown_approved, then exits.${rst}`);
      console.log(``);
      section("envelope format:", [
        `${yel}{${rst}`,
        `${yel}  "type": "shutdown_request",${rst}`,
        `${yel}  "request_id": "shutdown-${Date.now()}@${role}",${rst}`,
        `${yel}  "from": "shell-lead",${rst}`,
        `${yel}  "text": "{\\"type\\":\\"shutdown_request\\"}",${rst}`,
        `${yel}  "timestamp": "${new Date().toISOString()}",${rst}`,
        `${yel}  "read": false${rst}`,
        `${yel}}${rst}`,
      ]);
      console.log(`  ${grn}teammate replies with:${rst}`);
      console.log(`    ${yel}<teammate-message teammate_id="${role}">${rst}`);
      console.log(`    ${yel}{"type":"shutdown_approved","requestId":"..."}${rst}`);
      console.log(`    ${yel}</teammate-message>${rst}`);
      console.log(``);
      shortcut(`maw team-agent shutdown ${teamName} ${role}`);
      console.log(`${dim}Next: ${rst}${yel}maw team-agent tutorial 6${rst}  ${dim}(cleanup)${rst}`);
      return;
    }

    case "6": {
      const state = readState();
      const teamName = args[1] || state.teamName || "my-team";
      const role = args[2] || state.role || "architect";

      header(6, "Cleanup (kill + rm config)");
      console.log(`${dim}  Force-kill claude.exe process (if shutdown didn't work), remove team dir.${rst}`);
      console.log(``);
      section("kill the tmux session running claude.exe:", [
        `${yel}tmux kill-session -t ${teamName}-${role}${rst}`,
      ]);
      section("or kill all sessions matching team:", [
        `${yel}for s in $(tmux list-sessions -F "#{session_name}" | grep "^${teamName}-"); do${rst}`,
        `${yel}  tmux kill-session -t "$s"${rst}`,
        `${yel}done${rst}`,
      ]);
      section("remove team dir:", [
        `${yel}rm -rf ~/.claude/teams/${teamName}${rst}`,
      ]);
      shortcut(`maw team-agent cleanup ${teamName} --confirm --all`);
      console.log(`${grn}✓ tutorial complete!${rst}`);
      console.log(``);
      console.log(`${dim}You now know the raw Claude Code team protocol:${rst}`);
      console.log(`  ${dim}1. --session-id locks lead's identity${rst}`);
      console.log(`  ${dim}2. --parent-session-id + team flags spawn a teammate${rst}`);
      console.log(`  ${dim}3. Inbox JSON envelopes deliver messages${rst}`);
      console.log(`  ${dim}4. <teammate-message> XML is how Claude sees them${rst}`);
      console.log(`  ${dim}5. shutdown_request envelope = graceful exit${rst}`);
      console.log(`  ${dim}6. tmux kill-session + rm = cleanup${rst}`);
      console.log(``);
      console.log(`${dim}Production wrapper: ${rst}${yel}maw team-agent start <name> --preset trio${rst}  ${dim}(does steps 1-2 in 1 command)${rst}`);
      return;
    }

    default:
      throw new Error(`unknown step: ${stepNum} — valid: 1-6, or 'list'`);
  }
}
