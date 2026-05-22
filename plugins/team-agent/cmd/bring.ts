import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { spawnSync } from "child_process";
import { homedir } from "os";
import { generateReadableUuid, resolveParentUuid, UUID_RE } from "../lib/uuid";
import { TEAMS_DIR, teamDir, configPath, inboxesDir, inboxPath, readConfig, writeConfig, readInbox, appendInbox } from "../lib/config";
import { VALID_COLORS, findClaudeBin, shellQuote, parseMemberSpec, nowMs, nowISO } from "../lib/helpers";
import { parseSimpleYaml, resolveTemplate } from "../lib/yaml";
import { PRESETS, renderCharterYaml } from "../lib/presets";

export async function cmdBring(args: string[], flags: Record<string, unknown>): Promise<void> {
  const team = args[0];
  if (!team) {
    throw new Error("usage: maw team-agent bring <team> [<role>] [--split|--switch|--list]");
  }

  if (!existsSync(configPath(team))) {
    throw new Error(`team not found: ${team}`);
  }

  const cfg = readConfig(team);
  const workers = cfg.members.filter((m: any) => m.agentType !== "shell");

  if (workers.length === 0) {
    throw new Error(`no workers in team ${team}`);
  }

  // --list → just show
  if (flags["--list"] === true) {
    console.log(`\x1b[36mteam:\x1b[0m \x1b[1m${team}\x1b[0m`);
    for (let i = 0; i < workers.length; i++) {
      const w = workers[i];
      console.log(`  ${i + 1}. ${team}-${w.name}  \x1b[90m(${w.color}, ssn=${(w.sessionId || "").slice(0, 8)})\x1b[0m`);
    }
    return;
  }

  // Resolve target role: positional or prompt
  let role = args[1];
  if (!role) {
    if (!process.stdin.isTTY) {
      throw new Error(`missing role — usage: maw team-agent bring ${team} <role>`);
    }
    console.log(`\x1b[36mteam:\x1b[0m \x1b[1m${team}\x1b[0m`);
    for (let i = 0; i < workers.length; i++) {
      const w = workers[i];
      console.log(`  ${i + 1}. ${team}-${w.name}  \x1b[90m(${w.color})\x1b[0m`);
    }
    const answer = (prompt(`\x1b[36mPick [1-${workers.length}]:\x1b[0m`) || "").trim();
    const idx = parseInt(answer, 10);
    if (idx < 1 || idx > workers.length) {
      console.log(`\x1b[90m  cancelled\x1b[0m`);
      return;
    }
    role = workers[idx - 1].name;
  }

  // Verify worker exists
  const worker = workers.find((m: any) => m.name === role);
  if (!worker) {
    throw new Error(`worker not found in team: ${role} (valid: ${workers.map((m: any) => m.name).join(", ")})`);
  }

  const sessionName = `${team}-${role}`;

  // Verify tmux session exists
  const check = spawnSync("tmux", ["has-session", "-t", sessionName], { stdio: "pipe" });
  if (check.status !== 0) {
    throw new Error(`tmux session not found: ${sessionName} (worker may have exited)`);
  }

  const inTmux = !!process.env.TMUX;
  const split = flags["--split"] === true;
  const switchClient = flags["--switch"] === true;

  if (split) {
    if (!inTmux) throw new Error(`--split requires being inside tmux`);
    console.log(`\x1b[36m→ split:\x1b[0m new pane → ${sessionName}`);
    spawnSync("tmux", ["split-window", "-h", `tmux attach -t ${sessionName}`], { stdio: "inherit" });
  } else if (switchClient || inTmux) {
    console.log(`\x1b[36m→ switch:\x1b[0m ${sessionName}`);
    spawnSync("tmux", ["switch-client", "-t", sessionName], { stdio: "inherit" });
  } else {
    console.log(`\x1b[36m→ attach:\x1b[0m ${sessionName}`);
    spawnSync("tmux", ["attach", "-t", sessionName], { stdio: "inherit" });
  }
}
