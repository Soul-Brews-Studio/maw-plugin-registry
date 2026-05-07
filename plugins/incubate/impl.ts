/**
 * incubate — fire `/incubate` skill into an oracle's Claude TUI.
 *
 * Composition:
 *   1. Resolve target oracle (from --oracle flag or inferred from cwd).
 *   2. Build the slash-command line: `/incubate <source> [mode flags]`.
 *   3. Send via cmdSendText so the skill runs inside the oracle's session.
 *
 * The plugin is a THIN ROUTER. The `/incubate` skill at
 * ~/.claude/skills/incubate/SKILL.md does the actual work:
 *   - ghq clone of source
 *   - symlink into ψ/incubate/<owner>/<repo>/origin
 *   - update .origins manifest
 *   - create hub file REPO.md
 *   - mode-specific behavior (--flash / --contribute / --status / --offload)
 *
 * This decouples CLI contract from skill implementation — skill can evolve
 * without breaking plugin's public surface.
 *
 * Sister of `awaken` (which fires `/awaken`) and `send-text` (the underlying
 * send primitive).
 */
import { cmdSendText } from "../send-text/impl";
import { listSessions, resolveTarget } from "maw-js/sdk";
import { loadConfig } from "maw-js/config";
import { existsSync } from "fs";
import { join } from "path";

export type IncubateMode = "default" | "flash" | "contribute" | "status" | "offload";

export interface IncubateOptions {
  /** Source repo (org/repo, URL, or slug). Required unless mode is "status" or --init. */
  source?: string;
  /** Target oracle to fire skill into. Default: inferred from cwd. */
  oracle?: string;
  /** Mode passed to the skill. */
  mode?: IncubateMode;
  /** Restore all origins from .origins manifest. */
  init?: boolean;
  /** Custom trigger override (replaces auto-built `/incubate <args>`). */
  trigger?: string;
  /** Skip firing the skill (dispatch only, debug). */
  noTrigger?: boolean;
  /** Don't actually send — just print what would be sent. */
  dryRun?: boolean;
}

const SKILL = "/incubate";

/**
 * Build the slash-command line from options. Pure function — testable.
 *
 *   { source: "org/foo" }                       → "/incubate org/foo"
 *   { source: "org/foo", mode: "flash" }        → "/incubate org/foo --flash"
 *   { mode: "status" }                          → "/incubate --status"
 *   { init: true }                              → "/incubate --init"
 *   { trigger: "/incubate-custom" }             → "/incubate-custom"  (override)
 */
export function buildSkillCommand(opts: IncubateOptions): string {
  if (opts.trigger) return opts.trigger;

  const parts: string[] = [SKILL];
  if (opts.source) parts.push(opts.source);

  if (opts.mode === "flash") parts.push("--flash");
  else if (opts.mode === "contribute") parts.push("--contribute");
  else if (opts.mode === "status") parts.push("--status");
  else if (opts.mode === "offload") parts.push("--offload");

  if (opts.init) parts.push("--init");

  return parts.join(" ");
}

/**
 * Resolve mode from flag booleans. Mutually exclusive.
 */
export function resolveMode(
  flash: boolean,
  contribute: boolean,
  status: boolean,
  offload: boolean,
): IncubateMode {
  const count = [flash, contribute, status, offload].filter(Boolean).length;
  if (count > 1) {
    throw new Error("--flash, --contribute, --status, --offload are mutually exclusive");
  }
  if (flash) return "flash";
  if (contribute) return "contribute";
  if (status) return "status";
  if (offload) return "offload";
  return "default";
}

/**
 * Infer the current oracle from cwd. Walks up to find a CLAUDE.md + ψ/ pair
 * (oracle root signature). Returns the basename (which matches the fleet
 * stem when the oracle was created via `maw bud`).
 *
 * Returns null if no oracle root found above cwd.
 */
export function inferCurrentOracle(cwd: string = process.cwd()): string | null {
  let dir = cwd;
  while (dir && dir !== "/") {
    if (existsSync(join(dir, "CLAUDE.md")) && existsSync(join(dir, "ψ"))) {
      // Strip "-oracle" suffix if present, mirror fleet stem convention.
      const base = dir.split("/").pop() || "";
      return base.replace(/-oracle$/, "");
    }
    dir = dir.split("/").slice(0, -1).join("/");
  }
  return null;
}

export async function cmdIncubate(opts: IncubateOptions): Promise<void> {
  // Validate input
  if (opts.mode !== "status" && !opts.init && !opts.source) {
    throw new Error('usage: maw incubate <source> [--oracle <name>] [--flash | --contribute | --status | --offload | --init]');
  }

  // Resolve target oracle
  const target = opts.oracle ?? inferCurrentOracle();
  if (!target) {
    throw new Error(
      'could not infer current oracle from cwd — run from inside an oracle repo or pass --oracle <name>',
    );
  }

  // Verify the oracle resolves to a live target before sending
  const config = loadConfig();
  const sessions = await listSessions();
  const result = resolveTarget(target, config, sessions);
  if (!result || result.type === "error") {
    const hint = result?.type === "error" && result.hint ? ` — ${result.hint}` : "";
    throw new Error(`could not resolve oracle "${target}"${hint} — try: maw wake ${target}`);
  }

  // Build the skill command
  const cmd = buildSkillCommand(opts);

  if (opts.dryRun) {
    console.log(`\x1b[33m[dry-run]\x1b[0m would send to \x1b[36m${target}\x1b[0m: ${cmd}`);
    return;
  }

  if (opts.noTrigger) {
    console.log(`\x1b[90m○\x1b[0m --no-trigger: would have sent to ${target}: ${cmd}`);
    return;
  }

  // Fire the skill via send-text
  console.log(`\x1b[36m🔔\x1b[0m firing \x1b[33m${cmd}\x1b[0m → ${target}`);
  try {
    await cmdSendText({ target, text: cmd });
    console.log(`\x1b[32m✓\x1b[0m skill dispatched`);
  } catch (e: any) {
    console.log(`\x1b[33m⚠\x1b[0m send-text failed: ${e?.message || e}`);
    console.log(`\x1b[90m  try manually: maw send-text ${target} '${cmd}'\x1b[0m`);
    throw e;
  }
}
