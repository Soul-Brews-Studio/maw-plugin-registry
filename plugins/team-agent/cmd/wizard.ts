import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { spawnSync } from "child_process";
import { homedir } from "os";
import { generateReadableUuid, resolveParentUuid, UUID_RE } from "../lib/uuid";
import { TEAMS_DIR, teamDir, configPath, inboxesDir, inboxPath, readConfig, writeConfig, readInbox, appendInbox } from "../lib/config";
import { VALID_COLORS, findClaudeBin, shellQuote, parseMemberSpec, nowMs, nowISO } from "../lib/helpers";
import { parseSimpleYaml, resolveTemplate } from "../lib/yaml";
import { PRESETS, renderCharterYaml } from "../lib/presets";
import { cmdQuick } from "./charter";

export async function cmdWizard(_args: string[], flags: Record<string, unknown>): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new Error("wizard requires interactive terminal (TTY)");
  }

  const dryRun = flags["--dry-run"] === true;
  const blue = "\x1b[36m"; const dim = "\x1b[90m"; const grn = "\x1b[32m"; const rst = "\x1b[0m"; const yel = "\x1b[33m";

  console.log(`${blue}┌─────────────────────────────────────────┐${rst}`);
  console.log(`${blue}│  maw team-agent wizard                  │${rst}`);
  console.log(`${blue}│  step-by-step team setup                │${rst}`);
  console.log(`${blue}└─────────────────────────────────────────┘${rst}`);
  console.log(``);

  console.log(`${blue}Step 1/6 — Verify plugin${rst}`);
  console.log(`${dim}  ✓ you're running maw team-agent (this command)${rst}`);
  console.log(``);

  console.log(`${blue}Step 2/6 — Team name${rst}`);
  const defaultName = `team-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const name = (prompt(`  team name [${defaultName}]:`) || "").trim() || defaultName;
  console.log(`${dim}  → ${name}${rst}`);
  console.log(``);

  console.log(`${blue}Step 3/6 — Preset${rst}`);
  console.log(`  1. blank   (1 TODO member)`);
  console.log(`  2. solo    (1 helper)`);
  console.log(`  3. pair    (reviewer + writer)  ${dim}← default${rst}`);
  console.log(`  4. trio    (reviewer + writer + lead)`);
  console.log(`  5. review  (security + docs)`);
  console.log(`  6. stack   (architect + frontend + backend + tester)`);
  const presetMap: Record<string, string> = { "1": "blank", "2": "solo", "3": "pair", "4": "trio", "5": "review", "6": "stack" };
  const pAns = (prompt(`  pick [1-6, default 3]:`) || "").trim() || "3";
  const presetName = presetMap[pAns] || "pair";
  console.log(`${dim}  → ${presetName}${rst}`);
  console.log(``);

  console.log(`${blue}Step 4/6 — Session ID${rst}`);
  const sidGen = generateReadableUuid();
  console.log(`${dim}  generated: ${sidGen.uuid} (${sidGen.shortRef})${rst}`);
  console.log(``);

  console.log(`${blue}Step 5/6 — Review${rst}`);
  console.log(`  ${grn}command to run:${rst}`);
  console.log(`    ${yel}maw team-agent start ${name} --preset ${presetName} --force --session-id ${sidGen.uuid}${rst}`);
  console.log(``);
  const goAhead = (prompt(`  proceed? [Y/n]:`) || "").trim();
  if (/^n(o)?$/i.test(goAhead)) {
    console.log(`${dim}  cancelled — nothing changed${rst}`);
    return;
  }
  console.log(``);

  console.log(`${blue}Step 6/6 — Launch${rst}`);
  if (dryRun) {
    console.log(`${yel}  dry-run — would execute:${rst}`);
    console.log(`    maw team-agent start ${name} --preset ${presetName} --force --session-id ${sidGen.uuid}`);
    return;
  }

  await cmdQuick([name], {
    "--preset": presetName,
    "--force": true,
    "--session-id": sidGen.uuid,
  });

  console.log(``);
  console.log(`${grn}✓ wizard complete${rst}`);
  console.log(`${dim}  next:${rst}`);
  console.log(`    maw team-agent ls ${name}`);
  console.log(`    maw team-agent bring ${name} --list`);
  console.log(`    maw team-agent bring ${name} <role>`);
  console.log(`    maw team-agent cleanup ${name} --confirm --all`);
}

// ---------------------------------------------------------------------------
// cmdBring — attach/split/switch to a worker's tmux session
// ---------------------------------------------------------------------------

