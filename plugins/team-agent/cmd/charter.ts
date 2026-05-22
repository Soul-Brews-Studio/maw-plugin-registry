import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { spawnSync } from "child_process";
import { homedir } from "os";
import { generateReadableUuid, resolveParentUuid, UUID_RE } from "../lib/uuid";
import { TEAMS_DIR, teamDir, configPath, inboxesDir, inboxPath, readConfig, writeConfig, readInbox, appendInbox } from "../lib/config";
import { VALID_COLORS, findClaudeBin, shellQuote, parseMemberSpec, nowMs, nowISO } from "../lib/helpers";
import { parseSimpleYaml, resolveTemplate } from "../lib/yaml";
import { PRESETS, renderCharterYaml } from "../lib/presets";
import { cmdCreate, cmdSpawn } from "./team";

export async function cmdFrom(args: string[], flags: Record<string, unknown>): Promise<void> {
  const filePath = args[0];
  if (!filePath) throw new Error("usage: maw team-agent from <team.yaml>");
  if (!existsSync(filePath)) throw new Error(`file not found: ${filePath}`);

  // Pass 1: built-in vars
  const flagSessionId = (flags["--session-id"] as string) || undefined;
  const gen = generateReadableUuid();
  const builtins: Record<string, string> = {
    SESSION_ID: flagSessionId || gen.uuid,
    PROJECT_ROOT: process.cwd(),
    PROJECT_NAME: process.cwd().split("/").pop() || "project",
    HOME: homedir(),
    USER: process.env.USER || process.env.USERNAME || "user",
    DATE: new Date().toISOString().slice(0, 10),
    TIME: new Date().toTimeString().slice(0, 5),
    COUNTER: String(gen.counter),
  };

  // Pass 2: resolve builtins first, then parse to extract vars:
  const raw = readFileSync(filePath, "utf-8");
  const pass1 = resolveTemplate(raw, builtins);
  const preparse = parseSimpleYaml(pass1);

  // Pass 3: merge user-defined vars: section → re-resolve
  if (preparse.vars && typeof preparse.vars === "object") {
    for (const [k, v] of Object.entries(preparse.vars as Record<string, string>)) {
      builtins[k] = String(v);
    }
  }
  // Also support top-level key: value pairs as vars (simple strings)
  // vars: block is parsed specially by parseSimpleYaml — handle inline "vars-KEY: val" too
  const text = resolveTemplate(pass1, builtins);
  const charter = parseSimpleYaml(text);

  if (!charter.name) throw new Error("charter missing 'name' field");
  if (!charter.members || charter.members.length === 0) throw new Error("charter missing 'members'");

  // Top-level cwd as default for members
  const defaultCwd = charter.cwd || process.cwd();

  const dryRun = flags["--dry-run"] === true;
  const resolvedSessionId = builtins.SESSION_ID;

  console.log(`\x1b[36m📋 charter:\x1b[0m ${filePath}`);
  console.log(`  name:       ${charter.name}`);
  console.log(`  members:    ${charter.members.length}`);
  console.log(`  session-id: ${resolvedSessionId}`);
  if (charter.description) console.log(`  description: ${charter.description}`);
  console.log(``);

  await cmdCreate([charter.name, charter.description || ""], {
    "--session-id": resolvedSessionId,
    "--dry-run": dryRun,
    "--force": flags["--force"] === true,
    "--yes": flags["--yes"] === true,
    "-y": flags["-y"] === true,
  });
  console.log(``);

  for (const member of charter.members) {
    let cwd = member.cwd || defaultCwd;
    const color = member.color || "cyan";

    // Auto worktree: if member has `branch:`, create git worktree
    if (member.branch) {
      const branch = member.branch as string;
      const wtName = member["worktree-name"] || `.wt-${member.role}`;
      const wtPath = join(defaultCwd, wtName);

      if (dryRun) {
        console.log(`\x1b[33mdry-run\x1b[0m would create worktree: ${wtPath} (branch: ${branch})`);
      } else if (existsSync(wtPath)) {
        console.log(`\x1b[36m🌳\x1b[0m worktree exists: ${wtPath}`);
      } else {
        console.log(`\x1b[36m🌳\x1b[0m creating worktree: ${wtPath} (branch: ${branch})`);
        const wtResult = spawnSync("git", ["worktree", "add", wtPath, "-b", branch], {
          stdio: "pipe",
          cwd: defaultCwd,
        });
        if (wtResult.status !== 0) {
          // Branch might exist — try without -b
          const wtRetry = spawnSync("git", ["worktree", "add", wtPath, branch], {
            stdio: "pipe",
            cwd: defaultCwd,
          });
          if (wtRetry.status !== 0) {
            const err = wtRetry.stderr?.toString().trim() || "unknown error";
            throw new Error(`git worktree add failed for ${member.role}: ${err}`);
          }
        }
        console.log(`\x1b[32m✓\x1b[0m worktree created`);
      }
      cwd = wtPath;
    }

    const spec = `${member.role}@${cwd}:${color}`;
    const spawnFlags: Record<string, unknown> = {
      "--model": member.model || "sonnet",
      "--dry-run": dryRun,
      "--split": flags["--split"] === true,
    };
    if (member["system-prompt"]) spawnFlags["--system-prompt"] = member["system-prompt"];
    if (member.mission) spawnFlags["--mission"] = member.mission;

    await cmdSpawn([charter.name, spec], spawnFlags);
    console.log(``);
  }

  // If --split was used, retile to main-vertical so the operator stays
  // big-left and all newly-spawned teammates stack on the right.
  if (flags["--split"] === true && process.env.TMUX && !dryRun) {
    try {
      spawnSync("tmux", ["select-layout", "main-vertical"], { stdio: "ignore" });
      console.log(`\x1b[32m✓\x1b[0m retiled main-vertical (operator left, teammates right)`);
    } catch {}
  }

  console.log(`\x1b[32m✓\x1b[0m charter loaded: ${charter.members.length} members spawned from ${filePath}`);

  // Offer to attach if outside tmux + interactive
  const inTmux = !!process.env.TMUX;
  const noAttach = flags["--no-attach"] === true;
  if (!inTmux && !dryRun && !noAttach && process.stdin.isTTY) {
    console.log(``);
    console.log(`\x1b[36mAttach to a worker?\x1b[0m`);
    for (let i = 0; i < charter.members.length; i++) {
      const m = charter.members[i];
      console.log(`  ${i + 1}. ${charter.name}-${m.role}`);
    }
    console.log(`  0. skip (manually: tmux attach -t ${charter.name}-<role>)`);
    const answer = (prompt(`\x1b[36mPick [1-${charter.members.length}]:\x1b[0m`) || "").trim();
    const idx = parseInt(answer, 10);
    if (idx >= 1 && idx <= charter.members.length) {
      const sessionName = `${charter.name}-${charter.members[idx - 1].role}`;
      console.log(`\x1b[36m→ attaching to ${sessionName}...\x1b[0m`);
      spawnSync("tmux", ["attach", "-t", sessionName], { stdio: "inherit" });
    } else {
      console.log(`\x1b[90m  skipped — sessions still running in background\x1b[0m`);
    }
  }
}

// ---------------------------------------------------------------------------
// cmdInit — generate YAML charter scaffold
// ---------------------------------------------------------------------------


export async function cmdQuick(args: string[], flags: Record<string, unknown>): Promise<void> {
  const name = args[0];
  if (!name) throw new Error("usage: maw team-agent quick <name> [<role>@<cwd>[:<color>] ...] [--preset <name>]");

  const memberArgs = args.slice(1);

  let yaml: string;
  let modeDesc: string;

  if (memberArgs.length > 0) {
    // Inline mode: positional member specs
    const lines: string[] = [
      `name: ${name}`,
      `description: "Inline quick team"`,
      `session-id: \${SESSION_ID}`,
      `cwd: \${PROJECT_ROOT}`,
      ``,
      `members:`,
    ];
    for (let i = 0; i < memberArgs.length; i++) {
      const m = parseMemberSpec(memberArgs[i]!, i);
      lines.push(`  - role: ${m.role}`);
      lines.push(`    cwd: ${m.cwd}`);
      lines.push(`    color: ${m.color}`);
      lines.push(`    model: sonnet`);
      lines.push(`    system-prompt: "You are ${m.role}."`);
      lines.push(``);
    }
    yaml = lines.join("\n");
    modeDesc = `inline (${memberArgs.length} members)`;
  } else {
    // Preset mode
    const presetName = (flags["--preset"] as string) || "pair";
    if (!(presetName in PRESETS)) {
      throw new Error(`unknown preset: ${presetName}\n  valid: ${Object.keys(PRESETS).join(", ")}`);
    }
    yaml = renderCharterYaml(name, presetName);
    modeDesc = `preset: ${presetName}`;
  }

  const tmpPath = join("/tmp", `team-agent-quick-${Date.now()}-${name}.yaml`);
  writeFileSync(tmpPath, yaml);

  console.log(`\x1b[36m⚡ start\x1b[0m: ${name} (${modeDesc})`);
  console.log(`  tmp charter: ${tmpPath}`);
  console.log(``);

  await cmdFrom([tmpPath], flags);
}

export async function cmdInit(args: string[], flags: Record<string, unknown>): Promise<void> {
  const name = args[0];
  if (!name) throw new Error("usage: maw team-agent init <name> [--preset blank|solo|pair|trio|review|stack] [--force]");

  const presetName = (flags["--preset"] as string) || "blank";
  if (!(presetName in PRESETS)) {
    throw new Error(`unknown preset: ${presetName}\n  valid: ${Object.keys(PRESETS).join(", ")}`);
  }

  // Output path resolution:
  //   --out <path>  → exact path (file or dir)
  //   --here        → current dir
  //   default       → ψ/teams/ if exists in git root, else current dir
  let outPath: string;
  const outFlag = flags["--out"] as string | undefined;
  const hereFlag = flags["--here"] === true;

  if (outFlag) {
    outPath = outFlag.endsWith(".yaml") ? outFlag : join(outFlag, `${name}.yaml`);
  } else if (hereFlag) {
    outPath = join(process.cwd(), `${name}.yaml`);
  } else {
    // Try ψ/teams/ in git root
    let gitRoot = process.cwd();
    try {
      const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { stdio: "pipe", cwd: process.cwd() });
      if (result.status === 0) gitRoot = result.stdout.toString().trim();
    } catch {}
    const psiTeams = join(gitRoot, "ψ", "teams");
    if (existsSync(psiTeams)) {
      outPath = join(psiTeams, `${name}.yaml`);
    } else {
      outPath = join(process.cwd(), `${name}.yaml`);
    }
  }

  const force = flags["--force"] === true;
  if (existsSync(outPath) && !force) {
    throw new Error(`file already exists: ${outPath} (use --force to overwrite)`);
  }

  const yaml = renderCharterYaml(name, presetName);

  const dryRun = flags["--dry-run"] === true;
  if (dryRun) {
    console.log(`\x1b[33mdry-run\x1b[0m would write: ${outPath}`);
    console.log(`---`);
    console.log(yaml);
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, yaml);

  const preset = PRESETS[presetName];
  console.log(`\x1b[32m✓\x1b[0m charter generated: \x1b[1m${outPath}\x1b[0m`);
  console.log(`  preset:   ${presetName}`);
  console.log(`  members:  ${preset.members.length} (${preset.members.map((m: { role: string }) => m.role).join(", ")})`);
  console.log(`  size:     ${yaml.length} bytes`);
  console.log(``);
  console.log(`\x1b[36mNext:\x1b[0m`);
  console.log(`  1. Edit ${outPath} — fill in TODOs, set cwd paths, customize prompts`);
  console.log(`  2. Preview:  maw team-agent from ${outPath} --dry-run`);
  console.log(`  3. Launch:   maw team-agent from ${outPath}`);
}

// ---------------------------------------------------------------------------
// cmdWizard — interactive step-by-step team setup
// ---------------------------------------------------------------------------

