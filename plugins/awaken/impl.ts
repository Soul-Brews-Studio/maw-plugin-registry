/**
 * awaken — bud a new oracle then fire /awaken into its Claude TUI.
 *
 * Composition:
 *   1. cmdBud(name, opts) — creates repo, ψ vault, fleet config, AND wakes
 *      the oracle with noAttach (cmdBud already calls cmdWake at step 8).
 *   2. resolveTarget(name) — finds the freshly-woken pane.
 *   3. cmdSendText({ target, text: trigger }) — types `/awaken` + Enter
 *      into the Claude prompt.
 *
 * This is `maw bud` + the awakening ritual, in one verb. Without --no-trigger,
 * the new oracle is fully alive and starting its /awaken skill by the time
 * `maw awaken` returns.
 *
 * Flags mirror `maw bud` exactly + 2 awaken-specific:
 *   --trigger <text>   custom slash command to send (default: /awaken)
 *   --no-trigger       bud + wake but skip the slash command (debug)
 */
import { cmdBud, type BudOpts } from "../bud/impl";
import { cmdSendText } from "../send-text/impl";
import { listSessions, resolveTarget } from "maw-js/sdk";
import { loadConfig } from "maw-js/config";

export interface AwakenOpts extends BudOpts {
  /** Slash command to fire after wake. Default: "/awaken". */
  trigger?: string;
  /** Skip the trigger send entirely (just bud+wake). */
  noTrigger?: boolean;
}

const DEFAULT_TRIGGER = "/awaken";

export async function cmdAwaken(name: string, opts: AwakenOpts = {}): Promise<void> {
  const trigger = opts.noTrigger ? null : (opts.trigger ?? DEFAULT_TRIGGER);

  // Step 1: bud (which also wakes via finalizeBud → cmdWake noAttach)
  await cmdBud(name, opts);

  // Dry-run / root-without-wake: bud already returned early, nothing to send
  if (opts.dryRun) {
    if (trigger) {
      console.log(`  \x1b[36m⬡\x1b[0m [dry-run] would send \x1b[33m${trigger}\x1b[0m to ${name}`);
    } else {
      console.log(`  \x1b[36m⬡\x1b[0m [dry-run] --no-trigger: would NOT fire /awaken`);
    }
    return;
  }

  if (!trigger) {
    console.log(`  \x1b[90m○\x1b[0m --no-trigger: bud + wake done, skipping /awaken`);
    return;
  }

  // Step 2: resolve the target pane (no readiness wait — Q2: "no-wait")
  const config = loadConfig();
  const sessions = await listSessions();
  const result = resolveTarget(name, config, sessions);

  if (!result || result.type === "error") {
    console.log(
      `  \x1b[33m⚠\x1b[0m could not resolve ${name} after wake — skipping ${trigger}`,
    );
    console.log(`  \x1b[90m  try manually: maw send-text ${name} ${trigger}\x1b[0m`);
    return;
  }

  // Step 3: fire the trigger (e.g. /awaken)
  console.log(`  \x1b[36m🔔\x1b[0m firing \x1b[33m${trigger}\x1b[0m → ${name}`);
  try {
    await cmdSendText({ target: name, text: trigger });
    console.log(`  \x1b[32m✓\x1b[0m awakened`);
  } catch (e: any) {
    console.log(`  \x1b[33m⚠\x1b[0m send-text failed: ${e?.message || e}`);
    console.log(`  \x1b[90m  try manually: maw send-text ${name} ${trigger}\x1b[0m`);
  }
}
