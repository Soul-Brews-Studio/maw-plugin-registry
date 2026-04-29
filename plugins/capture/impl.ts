import { listSessions, hostExec, tmuxCmd } from "../../../sdk";
import { resolveSessionTarget } from "../../../core/matcher/resolve-target";

export interface CaptureOpts {
  /** Pane index within the resolved window. Default: current/first. */
  pane?: number;
  /** Number of tail lines. Default: 50. Ignored if --full. */
  lines?: number;
  /** Capture the full scrollback history (-S -). */
  full?: boolean;
}

/**
 * maw capture <target> [--pane N] [--lines N] [--full]
 *
 * Capture tmux pane content. Wraps `tmux capture-pane -p` with sane
 * defaults so skills don't shell out directly.
 *
 *   --pane N    pick a specific pane of the resolved window (default 0)
 *   --lines N   tail the last N lines (default 50)
 *   --full      capture full scrollback — overrides --lines
 */
export async function cmdCapture(target: string, opts: CaptureOpts = {}) {
  if (!target) {
    throw new Error("usage: maw capture <target> [--pane N] [--lines N] [--full]\n  e.g. maw capture mawjs\n       maw capture neo:0 --pane 1 --lines 100\n       maw capture mawjs --full");
  }

  let resolved: string;
  if (target.includes(":")) {
    const [rawSession, rest] = target.split(":", 2);
    const sessions = await listSessions();
    const r = resolveSessionTarget(rawSession, sessions);
    if (r.kind === "ambiguous") {
      console.error(`  \x1b[31m✗\x1b[0m '${rawSession}' is ambiguous — matches ${r.candidates.length} sessions:`);
      for (const s of r.candidates) console.error(`  \x1b[90m    • ${s.name}\x1b[0m`);
      throw new Error(`'${rawSession}' is ambiguous — matches ${r.candidates.length} sessions`);
    }
    if (r.kind === "none") {
      if (r.hints && r.hints.length > 0) {
        console.error(`  \x1b[90m  did you mean:\x1b[0m`);
        for (const s of r.hints) console.error(`  \x1b[90m    • ${s.name}\x1b[0m`);
      }
      throw new Error(`session '${rawSession}' not found`);
    }
    resolved = `${r.match.name}:${rest}`;
  } else {
    const sessions = await listSessions();
    const r = resolveSessionTarget(target, sessions);
    if (r.kind === "ambiguous") {
      console.error(`  \x1b[31m✗\x1b[0m '${target}' is ambiguous — matches ${r.candidates.length} sessions:`);
      for (const s of r.candidates) console.error(`  \x1b[90m    • ${s.name}\x1b[0m`);
      throw new Error(`'${target}' is ambiguous — matches ${r.candidates.length} sessions`);
    }
    if (r.kind === "none") {
      if (r.hints && r.hints.length > 0) {
        console.error(`  \x1b[90m  did you mean:\x1b[0m`);
        for (const s of r.hints) console.error(`  \x1b[90m    • ${s.name}\x1b[0m`);
      } else {
        console.error(`  \x1b[90m  try: maw ls\x1b[0m`);
      }
      throw new Error(`session '${target}' not found`);
    }
    resolved = `${r.match.name}:${r.match.windows[0]?.index ?? 0}`;
  }

  const paneSuffix = opts.pane !== undefined ? `.${opts.pane}` : "";
  const full = resolved + paneSuffix;
  const tmux = tmuxCmd();

  try {
    let raw: string;
    if (opts.full) {
      // -S - means "from the beginning of history"
      raw = await hostExec(`${tmux} capture-pane -t '${full}' -p -S -`);
    } else {
      const lines = opts.lines ?? 50;
      raw = await hostExec(`${tmux} capture-pane -t '${full}' -p -S -${lines}`);
    }
    if (raw) console.log(raw);
  } catch (e: any) {
    throw new Error(`capture failed: ${e.message || e}`);
  }
}
