import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { spawnSync, execSync } from "child_process";
import { homedir } from "os";
import { generateReadableUuid, resolveParentUuid, UUID_RE } from "../lib/uuid";
import { TEAMS_DIR, teamDir, configPath, inboxesDir, inboxPath, readConfig, writeConfig, readInbox, appendInbox } from "../lib/config";
import { VALID_COLORS, findClaudeBin, shellQuote, parseMemberSpec, nowMs, nowISO } from "../lib/helpers";
import { parseSimpleYaml, resolveTemplate } from "../lib/yaml";
import { PRESETS, renderCharterYaml } from "../lib/presets";

export async function cmdCleanup(args: string[], flags: Record<string, unknown>): Promise<void> {
  // Kill all team-agent-spawned panes + optionally remove team dirs.
  // Usage:
  //   maw team-agent cleanup                 — list what would happen (dry-run by default)
  //   maw team-agent cleanup --confirm       — actually do it (keeps team dirs)
  //   maw team-agent cleanup --confirm --all — also delete all team dirs
  //   maw team-agent cleanup <team> --confirm — only clean up one team
  const target = args[0]; // optional team name
  const confirm = flags["--confirm"] === true;
  const all = flags["--all"] === true;
  const noDryRun = confirm;

  if (!existsSync(TEAMS_DIR)) {
    console.log("(no teams — ~/.claude/teams/ does not exist)");
    return;
  }

  const teams = target
    ? [target].filter((t: string) => existsSync(configPath(t)))
    : readdirSync(TEAMS_DIR).filter((d: string) => existsSync(configPath(d)));

  if (teams.length === 0) {
    console.log(target ? `team not found: ${target}` : "(no teams to clean up)");
    return;
  }

  console.log(`\x1b[36m🧹\x1b[0m cleanup target: ${teams.length} team(s)`);

  // Plan: collect pane IDs to kill + team dirs to remove
  const plan: Array<{ team: string; role: string; paneId?: string; sessionId?: string }> = [];
  for (const t of teams) {
    const cfg = readConfig(t);
    for (const m of cfg.members) {
      if (m.agentType === "shell") continue; // skip shell-lead (it's us!)
      plan.push({
        team: t,
        role: m.name,
        paneId: m.tmuxPaneId || undefined,
        sessionId: m.sessionId || undefined,
      });
    }
  }

  console.log(`  panes to kill: ${plan.length}`);
  for (const p of plan) {
    const idTag = p.sessionId ? ` ssn=${p.sessionId.slice(0, 8)}` : "";
    const paneTag = p.paneId ? ` pane=${p.paneId}` : " (no pane-id stored — title-search fallback)";
    console.log(`    ${p.team}/${p.role}${idTag}${paneTag}`);
  }
  console.log(`  team dirs to remove: ${all ? teams.length : 0}${all ? "" : " (pass --all to also rm team dirs)"}`);
  if (all) {
    for (const t of teams) console.log(`    ${teamDir(t)}`);
  }

  if (!noDryRun) {
    console.log(``);
    console.log(`\x1b[33mdry-run (default)\x1b[0m — pass --confirm to actually do it.`);
    return;
  }

  // Execute — three fallbacks for finding panes/sessions to kill:
  //   1. stored pane-id (most reliable)
  //   2. tmux session named "<team>-<role>" (default from `maw new <name>`)
  //   3. pane title containing the role name (last resort)
  console.log(``);
  console.log(`\x1b[36m→\x1b[0m killing panes/sessions...`);
  let killed = 0;
  for (const p of plan) {
    let done = false;

    // (1) try stored pane-id
    if (p.paneId) {
      try {
        execSync(`tmux kill-pane -t ${p.paneId} 2>/dev/null`);
        console.log(`  \x1b[32m✓\x1b[0m killed pane ${p.paneId} (${p.team}/${p.role})`);
        killed++;
        done = true;
      } catch {
        // fall through to next fallback
      }
    }

    // (2) try tmux session named "<team>-<role>"
    if (!done) {
      const sessName = `${p.team}-${p.role}`;
      try {
        execSync(`tmux has-session -t ${sessName} 2>/dev/null`);
        execSync(`tmux kill-session -t ${sessName} 2>/dev/null`);
        console.log(`  \x1b[32m✓\x1b[0m killed session ${sessName} (${p.team}/${p.role})`);
        killed++;
        done = true;
      } catch {
        // session doesn't exist — try next fallback
      }
    }

    // (3) last resort: pane title contains the role name
    if (!done) {
      try {
        const out = execSync(`tmux list-panes -s -F "#{pane_id} #{pane_title}" 2>/dev/null | grep "${p.role}" | head -1`, { encoding: "utf-8" }).trim();
        if (out) {
          const id = out.split(" ")[0];
          execSync(`tmux kill-pane -t ${id} 2>/dev/null`);
          console.log(`  \x1b[32m✓\x1b[0m killed ${id} (${p.team}/${p.role}, by title)`);
          killed++;
          done = true;
        }
      } catch {}
    }

    if (!done) {
      console.log(`  \x1b[33m⚠\x1b[0m ${p.team}/${p.role} — no pane/session found (already gone?)`);
    }
  }

  // (4) sweep any orphan tmux sessions matching "<team>-*" (e.g. from prior
  //     spawns where config got removed but the session lingered).
  for (const t of teams) {
    try {
      const orphans = execSync(`tmux list-sessions -F "#{session_name}" 2>/dev/null | grep "^${t}-" || true`, { encoding: "utf-8" }).trim();
      if (orphans) {
        for (const s of orphans.split("\n").filter(Boolean)) {
          try {
            execSync(`tmux kill-session -t ${s} 2>/dev/null`);
            console.log(`  \x1b[32m✓\x1b[0m killed orphan session ${s}`);
            killed++;
          } catch {}
        }
      }
    } catch {}
  }

  if (all) {
    console.log(``);
    console.log(`\x1b[36m→\x1b[0m removing team dirs...`);
    for (const t of teams) {
      rmSync(teamDir(t), { recursive: true, force: true });
      console.log(`  \x1b[32m✓\x1b[0m removed ${teamDir(t)}`);
    }
  }

  console.log(``);
  console.log(`\x1b[32m✓ done\x1b[0m — killed ${killed} pane(s)${all ? `, removed ${teams.length} team dir(s)` : ""}`);
}

