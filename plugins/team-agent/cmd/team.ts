import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { spawnSync, execSync } from "child_process";
import { homedir } from "os";
import { generateReadableUuid, resolveParentUuid, UUID_RE } from "../lib/uuid";
import { TEAMS_DIR, teamDir, configPath, inboxesDir, inboxPath, readConfig, writeConfig, readInbox, appendInbox } from "../lib/config";
import { VALID_COLORS, findClaudeBin, shellQuote, parseMemberSpec, nowMs, nowISO } from "../lib/helpers";
import { parseSimpleYaml, resolveTemplate } from "../lib/yaml";
import { PRESETS, renderCharterYaml } from "../lib/presets";

export async function cmdCreate(args: string[], flags: Record<string, unknown>): Promise<void> {
  const name = args[0];
  if (!name) throw new Error("usage: maw team-agent create <name> [description] [--session-id <uuid>]");
  const description = args.slice(1).join(" ") || `Team created by maw team-agent at ${nowISO()}`;
  const dryRun = flags["--dry-run"] === true;

  if (existsSync(configPath(name))) {
    const force = flags["--force"] === true;
    const yes = flags["--yes"] === true || flags["-y"] === true;
    const existing = readConfig(name);
    const existingSid = existing.sessionId || existing.teamId;
    const newSidPreview = (flags["--session-id"] as string) || "(auto-generated)";

    console.log(`\x1b[33m⚠\x1b[0m team already exists: \x1b[1m${name}\x1b[0m`);
    console.log(`  existing:`);
    console.log(`    session-id: ${existingSid}`);
    console.log(`    description: ${existing.description || "—"}`);
    console.log(`    members: ${existing.members.length} (${existing.members.map((m: any) => m.name).join(", ")})`);
    console.log(`    created: ${existing.createdAtIso || "?"}`);
    console.log(`  new:`);
    console.log(`    session-id: ${newSidPreview}`);
    console.log(`    description: ${description}`);

    const doOverwrite = () => {
      // Kill ALL tmux sessions matching <team>-* (covers orphans not in config)
      let killed = 0;
      try {
        const list = spawnSync("tmux", ["list-sessions", "-F", "#{session_name}"], { stdio: "pipe" });
        const sessions = (list.stdout?.toString() || "").split("\n").filter((s: string) => s.startsWith(`${name}-`));
        for (const s of sessions) {
          spawnSync("tmux", ["kill-session", "-t", s], { stdio: "pipe" });
          killed++;
        }
      } catch {}
      rmSync(teamDir(name), { recursive: true, force: true });
      console.log(`\x1b[90m  killed ${killed} session(s) matching '${name}-*', removed team dir\x1b[0m`);
    };

    if (force || yes) {
      console.log(`\x1b[33m→ --force/--yes set, overwriting...\x1b[0m`);
      doOverwrite();
    } else if (process.stdin.isTTY) {
      const answer = prompt(`\x1b[36mOverwrite? [y/N]\x1b[0m`) || "";
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log(`\x1b[90m  cancelled — existing team kept\x1b[0m`);
        return;
      }
      doOverwrite();
    } else {
      throw new Error(`team already exists: ${name} — pass --force to overwrite (or --yes for non-interactive)`);
    }
  }

  // Lead's session-id. This IS the team identity — every teammate spawn
  // references it via --parent-session-id. Counter-first decimal format.
  let sessionId = (flags["--session-id"] || flags["--team-id"]) as string | undefined;
  let shortRef = "";
  if (sessionId && !UUID_RE.test(sessionId)) {
    throw new Error(`--session-id must be a valid UUID (got: ${sessionId})`);
  }
  if (!sessionId) {
    const gen = generateReadableUuid();
    sessionId = gen.uuid;
    shortRef = gen.shortRef;
  }

  const cfg = {
    name,
    sessionId,                                 // lead's session-id = team identity
    teamId: sessionId,                         // backward compat alias
    description,
    createdAt: nowMs(),
    createdAtIso: nowISO(),
    leadAgentId: `shell-lead@${name}`,
    leadSessionId: sessionId,
    members: [
      {
        agentId: `shell-lead@${name}`,
        name: "shell-lead",
        agentType: "shell",
        model: "n/a",
        sessionId,
        parentSessionId: null,
        joinedAt: nowMs(),
        tmuxPaneId: process.env.TMUX_PANE || "",
        cwd: process.cwd(),
        subscriptions: [],
      },
    ],
  };

  if (dryRun) {
    console.log(`\x1b[33mdry-run\x1b[0m would write: ${configPath(name)}`);
    console.log(JSON.stringify(cfg, null, 2));
    return;
  }
  writeConfig(name, cfg);
  mkdirSync(inboxesDir(name), { recursive: true });
  console.log(`\x1b[32m✓\x1b[0m team created: \x1b[1m${name}\x1b[0m`);
  console.log(`  session-id: \x1b[1m${sessionId}\x1b[0m${shortRef ? `  \x1b[33m[${shortRef}]\x1b[0m` : ""}`);
  console.log(`  config:     ${configPath(name)}`);
  console.log(`  lead:       shell-lead (cwd=${process.cwd()})`);
  console.log(``);
  console.log(`\x1b[36mTip:\x1b[0m every spawn auto-uses this session-id as --parent-session-id.`);
  console.log(`     Manual override:  maw team-agent spawn ${name} <role>@<cwd> --parent ${sessionId}`);
}

export async function cmdSpawn(args: string[], flags: Record<string, unknown>): Promise<void> {
  const team = args[0];
  const memberSpec = args[1];
  if (!team || !memberSpec) {
    throw new Error("usage: maw team-agent spawn <team> <role>@<cwd>[:<color>] [--mission \"<text>\"]");
  }
  const cfg = readConfig(team);
  const idx = cfg.members.length; // for color rotation
  const overrideColor = flags["--color"] as string | undefined;
  const m = parseMemberSpec(memberSpec, idx);
  if (overrideColor) m.color = overrideColor;

  const mission = flags["--mission"] as string | undefined;
  const systemPrompt = flags["--system-prompt"] as string | undefined;
  const model = (flags["--model"] as string) || "sonnet";

  // Parent UUID — 4-tier resolution:
  //   1. explicit --parent flag
  //   2. team's sessionId from config.json (THE NATURAL DEFAULT — lead IS the parent)
  //   3. $CLAUDE_SESSION_ID env var
  //   4. JSONL scan of current cwd
  let parent = flags["--parent"] as string | undefined;
  let parentSource = "flag";
  const teamSessionId = cfg.sessionId || cfg.teamId; // backward compat
  if (!parent && teamSessionId && UUID_RE.test(teamSessionId)) {
    parent = teamSessionId;
    parentSource = "session-id";
  }
  if (!parent) {
    parent = process.env.CLAUDE_SESSION_ID;
    parentSource = "env";
  }
  if (!parent) {
    parent = resolveParentUuid() || undefined;
    parentSource = "jsonl-scan";
  }
  if (!parent) {
    throw new Error("could not resolve parent UUID (tried --parent flag, team-id, $CLAUDE_SESSION_ID, JSONL scan). Pass --parent <uuid> explicitly.");
  }
  if (!UUID_RE.test(parent)) {
    throw new Error(`--parent must be uuid (got: ${parent})`);
  }

  // Teammate session ID — optional explicit, otherwise auto-generate (counter-first readable UUID)
  let teammateSessionId = flags["--session-id"] as string | undefined;
  let teammateShortRef = "";
  let teammateCounter = 0;
  if (teammateSessionId && !UUID_RE.test(teammateSessionId)) {
    throw new Error(`--session-id must be uuid (got: ${teammateSessionId})`);
  }
  if (!teammateSessionId) {
    const gen = generateReadableUuid();
    teammateSessionId = gen.uuid;
    teammateShortRef = gen.shortRef;
    teammateCounter = gen.counter;
  }

  if (cfg.members.find((mem: any) => mem.name === m.role)) {
    throw new Error(`member already exists in team: ${m.role}`);
  }
  // No TMUX requirement — maw new creates a new tmux session standalone.
  // User can `tmux attach -t <team>-<role>` after spawn to see the worker.
  const inTmux = !!process.env.TMUX;

  const claudeBin = findClaudeBin();
  // Forward auth env from the caller's shell so spawned panes (which inherit
  // the tmux server's frozen env, not direnv-injected vars) can authenticate.
  const authEnvParts: string[] = [];
  for (const key of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_TOKEN_NAME"]) {
    const val = process.env[key];
    if (val) authEnvParts.push(`${key}=${shellQuote(val)}`);
  }
  const authEnv = authEnvParts.length ? authEnvParts.join(" ") + " " : "";
  const env = `CLAUDECODE=1 CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 ${authEnv}`.trim();

  // Teammate's --session-id is OPT-IN (per ccc-oracle feature request):
  // default = omit so claude.exe auto-generates and avoids "session-id already
  // in use" runtime-registry locks. Pass --with-session-id (or an explicit
  // --session-id <uuid>) to keep the old fixed-UUID behavior.
  const withSessionId = flags["--with-session-id"] === true || flags["--session-id"] !== undefined;
  const cmdParts: string[] = [`env ${env} ${shellQuote(claudeBin)}`];
  if (withSessionId) cmdParts.push(`--session-id ${teammateSessionId}`);
  cmdParts.push(
    `--agent-id ${m.role}@${team}`,
    `--agent-name ${m.role}`,
    `--team-name ${team}`,
    `--agent-color ${m.color}`,
    `--parent-session-id ${parent}`,
    `--model ${model}`,
  );
  if (systemPrompt) cmdParts.push(`--system-prompt ${shellQuote(systemPrompt)}`);
  cmdParts.push(`--dangerously-skip-permissions`);
  const cmd = cmdParts.join(" \\\n");

  const dryRun = flags["--dry-run"] === true;
  console.log(`\x1b[36m⚡\x1b[0m team-agent spawn ${team}/${m.role} (${m.color}) in ${m.cwd}`);
  console.log(`  parent uuid:    ${parent} (resolved via ${parentSource})`);
  const refTag = teammateShortRef ? ` \x1b[1m\x1b[33m[run ${teammateShortRef}]\x1b[0m` : "";
  console.log(`  teammate uuid:  ${teammateSessionId}${refTag}`);
  if (teammateShortRef) {
    console.log(`                    ↑ counter #${teammateCounter} (8-hex prefix, decimal: ${teammateCounter})`);
  }
  // Always show the claude.exe command (learning + debug)
  const cmdOneLine = cmdParts.join(" ");
  console.log(`  \x1b[90mcmd: ${cmdOneLine}\x1b[0m`);

  if (dryRun) {
    console.log(`  \x1b[33mdry-run\x1b[0m — not spawned`);
    return;
  }

  // Run maw new — two modes:
  //   default:   new tmux SESSION named "<team>-<role>" (deterministic, unique per teammate)
  //   --split:   new tmux PANE in the current window (no separate session)
  const useSplit = flags["--split"] === true;
  const sessionName = `${team}-${m.role}`;
  // Add --print so maw new returns JSON {session, window, pane_id, ...} we can
  // parse to capture the pane_id at spawn time (closes the "killed 0 pane(s)"
  // gap — cleanup needs pane_id to actually kill the right pane later).
  const mawArgs = useSplit
    ? ["new", "--split", "--path", m.cwd, "--cmd", cmd, "--print"]
    : ["new", sessionName, "--path", m.cwd, "--cmd", cmd, "--no-attach", "--print"];
  const result = spawnSync("maw", mawArgs, {
    stdio: ["inherit", "pipe", "inherit"],
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(useSplit
      ? `maw new --split failed (exit ${result.status}) — are you in tmux?`
      : `maw new failed (exit ${result.status}) — session may already exist: ${sessionName}`);
  }

  // Parse the JSON payload printed by maw new --print to capture pane_id.
  let capturedPaneId = "";
  try {
    const stdout = (result.stdout || "").trim();
    // Find the last JSON-looking line (maw may print loader noise before it)
    const lines = stdout.split("\n").filter((l: string) => l.trim().startsWith("{"));
    if (lines.length) {
      const info = JSON.parse(lines[lines.length - 1]);
      if (info && typeof info.pane_id === "string") {
        capturedPaneId = info.pane_id;
        console.log(`  \x1b[32m✓\x1b[0m spawned pane ${capturedPaneId}${info.session ? ` (session ${info.session})` : ""}`);
      }
    }
  } catch (e: any) {
    console.log(`  \x1b[33m⚠\x1b[0m could not parse maw new --print output: ${e.message}`);
  }

  // Hint how to view the worker if outside tmux
  if (!inTmux && !useSplit) {
    console.log(`  \x1b[90m→ attach: tmux attach -t ${sessionName}\x1b[0m`);
  }

  // Record the member in config.json — tmuxPaneId now populated when --print parses successfully
  cfg.members.push({
    agentId: `${m.role}@${team}`,
    name: m.role,
    agentType: "claude.exe",
    model,
    color: m.color,
    sessionId: teammateSessionId,
    parentSessionId: parent,
    systemPrompt: systemPrompt || null,
    runCounter: teammateCounter || null,
    shortRef: teammateShortRef || null,
    joinedAt: nowMs(),
    tmuxPaneId: capturedPaneId,
    cwd: m.cwd,
    subscriptions: [],
  });
  writeConfig(team, cfg);

  // If mission provided, write to inbox immediately
  if (mission) {
    appendInbox(team, m.role, {
      from: "shell-lead",
      text: mission,
      summary: mission.split(/\s+/).slice(0, 8).join(" ").slice(0, 60),
      timestamp: nowISO(),
      color: m.color,
      read: false,
    });
    console.log(`\x1b[32m✓\x1b[0m member added + mission queued (inbox: ${inboxPath(team, m.role)})`);
  } else {
    console.log(`\x1b[32m✓\x1b[0m member added to config`);
  }
  console.log(`  tip: 'maw team-agent ls ${team}' shows the team state`);
}

export async function cmdLs(args: string[], flags: Record<string, unknown>): Promise<void> {
  const team = args[0];
  const json = flags["--json"] === true;
  if (!existsSync(TEAMS_DIR)) {
    if (json) console.log("[]");
    else console.log("(no teams — ~/.claude/teams/ does not exist)");
    return;
  }

  if (!team) {
    const teams = readdirSync(TEAMS_DIR).filter((d: string) => existsSync(configPath(d)));
    if (json) {
      console.log(JSON.stringify(teams));
      return;
    }
    console.log(`\x1b[36m${teams.length}\x1b[0m teams in ~/.claude/teams/`);
    for (const t of teams) {
      const cfg = readConfig(t);
      console.log(`  \x1b[32m●\x1b[0m ${t}  (${cfg.members.length} members)`);
    }
    return;
  }

  const cfg = readConfig(team);
  if (json) {
    const inboxes: Record<string, number> = {};
    for (const m of cfg.members) {
      inboxes[m.name] = readInbox(team, m.name).length;
    }
    console.log(JSON.stringify({ team: cfg.name, description: cfg.description, members: cfg.members, inbox_counts: inboxes }, null, 2));
    return;
  }

  console.log(`\x1b[36mteam:\x1b[0m \x1b[1m${cfg.name}\x1b[0m`);
  const displaySid = cfg.sessionId || cfg.teamId;
  if (displaySid) console.log(`  session-id: \x1b[1m${displaySid}\x1b[0m`);
  console.log(`  description: ${cfg.description}`);
  console.log(`  lead: ${cfg.leadAgentId} (session: ${cfg.leadSessionId})`);
  console.log(`  members:`);
  for (const m of cfg.members) {
    const inboxCount = readInbox(team, m.name).length;
    const color = m.color ? `\x1b[3${VALID_COLORS.indexOf(m.color) + 1}m●\x1b[0m ` : "  ";
    const ref = m.shortRef ? ` \x1b[33m${m.shortRef}\x1b[0m` : "";
    const sid = m.sessionId ? ` \x1b[90mssn=${m.sessionId.slice(0, 8)}\x1b[0m` : "";
    console.log(`    ${color}${m.name.padEnd(28)} ${m.agentType.padEnd(12)} inbox: ${inboxCount}${ref}${sid}`);
  }
}

export async function cmdMsg(args: string[], flags: Record<string, unknown>): Promise<void> {
  const team = args[0];
  const all = flags["--all"] === true;

  // --all: broadcast to every non-shell teammate (skip shell-lead and any agentType==="shell")
  // signature shifts: args[1] is the text (not a role)
  if (all) {
    const text = args.slice(1).join(" ");
    if (!team || !text) {
      throw new Error("usage: maw team-agent msg <team> --all \"<text>\" [--by <sender>]");
    }
    const cfg = readConfig(team);
    const targets = cfg.members.filter((m: any) => m.agentType !== "shell" && m.name);
    if (targets.length === 0) {
      throw new Error(`no broadcast targets in team ${team} (no claude.exe members)`);
    }
    const by = (flags["--by"] as string) || "shell";
    const summary = text.split(/\s+/).slice(0, 8).join(" ").slice(0, 60);
    const ts = nowISO();

    console.log(`\x1b[36m📢\x1b[0m broadcasting to ${targets.length} teammate(s) in ${team}:`);
    for (const m of targets) {
      const entry = { from: by, text, summary, timestamp: ts, color: undefined, read: false };
      appendInbox(team, m.name, entry);
      console.log(`  \x1b[32m✓\x1b[0m ${m.name}  ${inboxPath(team, m.name)}`);
    }
    return;
  }

  // single-role send (original behavior)
  const role = args[1];
  const text = args.slice(2).join(" ");
  if (!team || !role || !text) {
    throw new Error("usage: maw team-agent msg <team> <role> \"<text>\" [--by <sender>]\n   or: maw team-agent msg <team> --all \"<text>\" [--by <sender>]");
  }
  readConfig(team); // verify team exists
  const by = (flags["--by"] as string) || "shell";
  const summary = text.split(/\s+/).slice(0, 8).join(" ").slice(0, 60);

  const entry = {
    from: by,
    text,
    summary,
    timestamp: nowISO(),
    color: undefined,
    read: false,
  };
  appendInbox(team, role, entry);
  console.log(`\x1b[32m✓\x1b[0m message queued to ${team}/${role} inbox`);
  console.log(`  ${inboxPath(team, role)}`);
}

export async function cmdShutdown(args: string[], _flags: Record<string, unknown>): Promise<void> {
  const team = args[0];
  const role = args[1];
  if (!team || !role) throw new Error("usage: maw team-agent shutdown <team> <role>");
  readConfig(team);
  const requestId = `shutdown-${Date.now()}@${role}`;
  const envelope = {
    type: "shutdown_request",
    request_id: requestId,
    from: "shell-lead",
    text: JSON.stringify({ type: "shutdown_request", request_id: requestId }),
    summary: "shutdown request",
    timestamp: nowISO(),
    read: false,
  };
  appendInbox(team, role, envelope);
  console.log(`\x1b[32m✓\x1b[0m shutdown_request queued to ${team}/${role}`);
  console.log(`  request_id: ${requestId}`);
  console.log(`  inbox: ${inboxPath(team, role)}`);
}

export async function cmdKill(args: string[], _flags: Record<string, unknown>): Promise<void> {
  const team = args[0];
  const role = args[1];
  if (!team || !role) throw new Error("usage: maw team-agent kill <team> <role>");
  const cfg = readConfig(team);
  const member = cfg.members.find((m: any) => m.name === role);
  if (!member) throw new Error(`member not found: ${role} in team ${team}`);
  const paneId = member.tmuxPaneId;
  if (!paneId) {
    console.log(`\x1b[33m⚠\x1b[0m no tmuxPaneId stored for ${role} — trying fallbacks`);
    // Fallback 1: tmux session named "<team>-<role>" (default from `maw new <name>`)
    const sessName = `${team}-${role}`;
    try {
      execSync(`tmux has-session -t ${sessName} 2>/dev/null`);
      execSync(`tmux kill-session -t ${sessName} 2>/dev/null`);
      console.log(`\x1b[32m✓\x1b[0m killed session ${sessName}`);
      return;
    } catch {
      // session doesn't exist — try next fallback
    }
    // Fallback 2: search tmux panes for one with the role name in its title
    try {
      const out = execSync(`tmux list-panes -s -F "#{pane_id} #{pane_title}" 2>/dev/null | grep "${role}" | head -1`, { encoding: "utf-8" }).trim();
      if (out) {
        const id = out.split(" ")[0];
        execSync(`tmux kill-pane -t ${id} 2>/dev/null`);
        console.log(`\x1b[32m✓\x1b[0m killed pane ${id} (matched by title)`);
        return;
      }
    } catch {}
    throw new Error(`could not locate pane or session for ${team}/${role}`);
  }
  execSync(`tmux kill-pane -t ${paneId} 2>/dev/null`);
  console.log(`\x1b[32m✓\x1b[0m killed pane ${paneId}`);
}

export async function cmdDelete(args: string[], flags: Record<string, unknown>): Promise<void> {
  const team = args[0];
  if (!team) throw new Error("usage: maw team-agent delete <team> --confirm");
  if (!existsSync(teamDir(team))) throw new Error(`team not found: ${team}`);
  const confirm = flags["--confirm"] === true;
  const dryRun = flags["--dry-run"] === true;

  if (!confirm && !dryRun) {
    throw new Error("destructive op — pass --confirm to proceed, or --dry-run to preview");
  }
  if (dryRun) {
    console.log(`\x1b[33mdry-run\x1b[0m would rm: ${teamDir(team)}`);
    const cfg = readConfig(team);
    console.log(`  team has ${cfg.members.length} members + inboxes`);
    return;
  }
  rmSync(teamDir(team), { recursive: true, force: true });
  console.log(`\x1b[32m✓\x1b[0m deleted ${teamDir(team)}`);
}


