import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { spawnSync } from "child_process";
import { homedir } from "os";
import { generateReadableUuid, resolveParentUuid, UUID_RE } from "../lib/uuid";
import { TEAMS_DIR, teamDir, configPath, inboxesDir, inboxPath, readConfig, writeConfig, readInbox, appendInbox } from "../lib/config";
import { VALID_COLORS, findClaudeBin, shellQuote, parseMemberSpec, nowMs, nowISO } from "../lib/helpers";
import { parseSimpleYaml, resolveTemplate } from "../lib/yaml";
import { PRESETS, renderCharterYaml } from "../lib/presets";

export async function cmdUuid(args: string[], flags: Record<string, unknown>): Promise<void> {
  const count = Math.max(1, Math.min(parseInt(args[0] || "1", 10) || 1, 100));
  const json = flags["--json"] === true;
  const bare = flags["--bare"] === true || flags["--quiet"] === true;
  const human = flags["--human"] === true || flags["--decimal"] === true;
  const marker = (flags["--marker"] as string) || "00000000";

  const out: Array<{ uuid: string; counter: number; shortRef: string; human: string }> = [];
  for (let i = 0; i < count; i++) {
    const g = generateReadableUuid(marker);
    // Human format: #<counter>@<ISO timestamp>  — parseable from the new layout:
    //   NNNNNNNN-YYYY-MMDD-HHMM-YYMMDDHHMMSS
    // Example: "#91@2026-05-22T01:07:42"
    const m = g.uuid.match(/^\d{8}-(\d{4})-(\d{2})(\d{2})-(\d{2})(\d{2})-\d{6}(\d{2})\d{2}$/);
    let humanStr = g.shortRef;
    if (m) {
      const [, yyyy, mm, dd, hh, mi, ss] = m;
      humanStr = `#${g.counter}@${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
    }
    out.push({ ...g, human: humanStr });
  }

  if (json) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  if (bare) {
    for (const g of out) console.log(human ? g.human : g.uuid);
    return;
  }
  for (const g of out) {
    if (human) {
      console.log(`\x1b[33m${g.human}\x1b[0m`);
    } else {
      console.log(`\x1b[33m${g.shortRef.padEnd(7)}\x1b[0m ${g.uuid}  \x1b[90m${g.human}\x1b[0m`);
    }
  }
  if (count > 1) {
    console.log(`\x1b[90m  → counter at ~/.claude/team-agent-counter (now: ${out[out.length - 1].counter})\x1b[0m`);
  }
}

