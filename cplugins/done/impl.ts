import { join } from "path";
import { listSessions } from "maw-js/sdk";
import { getGhqRoot } from "maw-js/config/ghq-root";
import { FLEET_DIR } from "maw-js/sdk";
import { takeSnapshot } from "maw-js/sdk";
import { tmux, hostExec, scanWorktrees, cleanupWorktree } from "maw-js/sdk";
import { normalizeTarget } from "maw-js/core/matcher/normalize-target";
import { signalParentInbox, autoSave } from "./done-autosave";
import { removeWorktreeViaConfig, removeWorktreeByGhqScan, removeFromFleetConfig } from "./done-worktree";

export interface DoneOpts {
  force?: boolean;
  dryRun?: boolean;
}

/**
 * maw done <window-name> [--force] [--dry-run]
 *
 * Clean up a finished worktree window:
 * 0. Send /rrr to agent + git auto-save (unless --force)
 * 1. Kill the tmux window
 * 2. Remove git worktree (if it is one)
 * 3. Remove from fleet config JSON
 */
export async function cmdDone(windowName_: string, opts: DoneOpts = {}) {
  let windowName = normalizeTarget(windowName_);
  const sessions = await listSessions();
  const reposRoot = join(getGhqRoot(), "github.com");

  const windowNameLower = windowName.toLowerCase();
  let sessionName: string | null = null;
  let windowIndex: number | null = null;
  for (const s of sessions) {
    const w = s.windows.find(w => w.name.toLowerCase() === windowNameLower);
    if (w) { sessionName = s.name; windowIndex = w.index; windowName = w.name; break; }
  }

  // 0. Signal parent inbox (#81) — write before kill so parent knows
  if (sessionName) {
    await signalParentInbox(windowName, sessionName, sessions as any);
  }

  // 0.5. Auto-save: send /rrr + git commit + push (unless --force)
  if (sessionName !== null && windowIndex !== null && !opts.force) {
    const exited = await autoSave(windowName, sessionName, opts);
    // autoSave returns void; dryRun path returns early inside
    if (opts.dryRun) return;
  } else if (opts.dryRun) {
    console.log(`  \x1b[36m⬡\x1b[0m [dry-run] window '${windowName}' not running — nothing to auto-save`);
  }

  // 1. Kill tmux window
  if (sessionName !== null && windowIndex !== null) {
    try {
      await tmux.killWindow(`${sessionName}:${windowName}`);
      console.log(`  \x1b[32m✓\x1b[0m killed window ${sessionName}:${windowName}`);
    } catch {
      console.log(`  \x1b[33m⚠\x1b[0m could not kill window (may already be closed)`);
    }
  } else {
    console.log(`  \x1b[90m○\x1b[0m window '${windowName}' not running`);
  }

  // 2. Remove git worktree
  let removedWorktree = await removeWorktreeViaConfig(windowNameLower, reposRoot);
  if (!removedWorktree) {
    removedWorktree = await removeWorktreeByGhqScan(windowName, reposRoot);
  }
  if (!removedWorktree) {
    console.log(`  \x1b[90m○\x1b[0m no worktree to remove (may be a main window)`);
  }

  // 3. Remove from fleet config
  const removedFromConfig = removeFromFleetConfig(windowNameLower);
  if (!removedFromConfig) {
    console.log(`  \x1b[90m○\x1b[0m not in any fleet config`);
  }

  // Snapshot after done
  takeSnapshot("done").catch(() => {});

  console.log();
}

/**
 * maw done --all [--force] [--dry-run]
 *
 * Clean up ALL non-lead windows in the current tmux session:
 * 1. Detect current session
 * 2. Skip the lead window (index 0)
 * 3. Run cmdDone for each remaining window (reverse order — highest index first)
 * 4. Sweep orphan worktrees
 */
export async function cmdDoneAll(opts: DoneOpts = {}) {
  // Resolve current session name
  let sessionName: string;
  try {
    sessionName = (await hostExec("tmux display-message -p '#{session_name}'")).trim();
  } catch {
    console.log("  \x1b[31m✗\x1b[0m not inside a tmux session");
    return;
  }
  if (!sessionName) {
    console.log("  \x1b[31m✗\x1b[0m could not determine current session");
    return;
  }

  const sessions = await listSessions();
  const current = sessions.find(s => s.name === sessionName);
  if (!current || current.windows.length === 0) {
    console.log(`  \x1b[90m○\x1b[0m session '${sessionName}' has no windows`);
    return;
  }

  // Lead window = index 0; everything else gets cleaned up
  const leadWindow = current.windows.reduce((a, b) => a.index < b.index ? a : b);
  const targets = current.windows
    .filter(w => w.index !== leadWindow.index)
    .sort((a, b) => b.index - a.index); // reverse order — kill highest first

  if (targets.length === 0) {
    console.log(`  \x1b[90m○\x1b[0m no non-lead windows in session '${sessionName}'`);
  } else {
    console.log(`  \x1b[36m⬡\x1b[0m cleaning ${targets.length} window(s) in '${sessionName}' (keeping lead: ${leadWindow.name})\n`);
    for (const w of targets) {
      console.log(`─── done: ${w.name} ───`);
      try {
        await cmdDone(w.name, opts);
      } catch (e: any) {
        console.error(`  \x1b[33m⚠\x1b[0m failed: ${e.message || e}`);
      }
    }
  }

  // Sweep orphan worktrees
  if (opts.dryRun) {
    console.log(`  \x1b[36m⬡\x1b[0m [dry-run] would sweep orphan worktrees`);
  } else {
    console.log(`─── sweeping orphan worktrees ───`);
    try {
      const worktrees = await scanWorktrees();
      const orphans = worktrees.filter(w => w.status === "orphan");
      if (orphans.length === 0) {
        console.log(`  \x1b[90m○\x1b[0m no orphan worktrees`);
      } else {
        for (const o of orphans) {
          console.log(`  \x1b[36m⏳\x1b[0m cleaning orphan: ${o.name}`);
          const log = await cleanupWorktree(o.path);
          for (const line of log) console.log(`  ${line}`);
        }
      }
    } catch (e: any) {
      console.error(`  \x1b[33m⚠\x1b[0m orphan sweep failed: ${e.message || e}`);
    }
  }

  takeSnapshot("done-all").catch(() => {});
  console.log();
}
