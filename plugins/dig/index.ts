import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";

export const command = {
  name: "dig",
  description: "Session mining CLI — human/AI message separation, time-range filters, keyword grep.",
};

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  dim: "\x1b[90m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  bold: "\x1b[1m",
};

interface Message {
  type: "human" | "assistant" | "tool" | "system";
  timestamp: string;
  text: string;
  sessionId: string;
  repo: string;
}

interface DigOptions {
  count: number;
  recentMin?: number;
  all: boolean;
  timeline: boolean;
  deep: boolean;
  humanOnly: boolean;
  aiOnly: boolean;
  showTools: boolean;
  grep?: string;
  oracle?: string;
  repo?: string;
}

function encodePwd(dir: string): string {
  return dir.replace(/^\//, "-").replace(/[/.]/g, "-");
}

function findProjectDirs(opts: DigOptions): string[] {
  const base = join(homedir(), ".claude", "projects");
  try {
    if (!existsSync(base)) return [];
    const allDirs = readdirSync(base)
      .map(d => join(base, d))
      .filter(d => { try { return statSync(d).isDirectory(); } catch { return false; } });

    if (opts.all) return allDirs;

    if (opts.repo) {
      const filter = opts.repo.replace(/[/.]/g, "-");
      return allDirs.filter(d => basename(d).includes(filter));
    }

    if (opts.oracle) {
      const filter = opts.oracle.replace(/[/.]/g, "-");
      return allDirs.filter(d => basename(d).includes(filter));
    }

    // Default: match cwd
    const encoded = encodePwd(process.cwd());
    const exact = join(base, encoded);
    if (existsSync(exact)) return [exact];

    // Fallback: match by last path segment
    const cwdTail = process.cwd().split("/").pop() ?? "";
    const matches = allDirs.filter(d => basename(d).endsWith(`-${cwdTail}`));
    return matches.length > 0 ? matches : [];
  } catch {
    return [];
  }
}

function collectFiles(
  projectDirs: string[],
  deep: boolean,
): Array<{ path: string; dir: string; mtime: number }> {
  const seen = new Map<string, { path: string; dir: string; mtime: number }>();

  for (const dir of projectDirs) {
    try {
      for (const f of readdirSync(dir).filter(f => f.endsWith(".jsonl"))) {
        const fp = join(dir, f);
        try {
          const mtime = statSync(fp).mtime.getTime();
          if (!seen.has(fp)) seen.set(fp, { path: fp, dir, mtime });
        } catch {}
      }

      if (deep) {
        for (const sub of readdirSync(dir)) {
          const subDir = join(dir, sub, "subagents");
          try {
            if (statSync(subDir).isDirectory()) {
              for (const f of readdirSync(subDir).filter(f => f.endsWith(".jsonl"))) {
                const fp = join(subDir, f);
                try {
                  const st = statSync(fp);
                  if (st.size > 0 && !seen.has(fp)) {
                    seen.set(fp, { path: fp, dir, mtime: st.mtime.getTime() });
                  }
                } catch {}
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  return [...seen.values()].sort((a, b) => b.mtime - a.mtime);
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    for (const c of content) {
      if (c?.type === "text" && typeof c.text === "string") return c.text.trim();
    }
  }
  return "";
}

function isSystemInjected(text: string): boolean {
  return (
    text.startsWith("<") ||
    text.startsWith("[Request interrupted") ||
    text.startsWith("[System:") ||
    text.startsWith("(no response yet)")
  );
}

function repoLabel(dir: string): string {
  const parts = basename(dir).split("-");
  return parts[parts.length - 1] || basename(dir);
}

function parseMessages(filePath: string, sessionId: string, repo: string): Message[] {
  const messages: Message[] = [];
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        const ts = (obj.timestamp as string) || "";
        const type = (obj.type as string) || "";
        const msgContent = (obj.message as Record<string, unknown> | undefined)?.content;

        if (type === "user") {
          const text = extractText(msgContent);
          if (!text || isSystemInjected(text)) continue;
          messages.push({ type: "human", timestamp: ts, text, sessionId, repo });
        } else if (type === "assistant") {
          if (Array.isArray(msgContent)) {
            for (const c of msgContent as Array<Record<string, unknown>>) {
              if (c?.type === "text" && typeof c.text === "string" && c.text.trim()) {
                messages.push({ type: "assistant", timestamp: ts, text: c.text.trim(), sessionId, repo });
                break;
              }
            }
            for (const c of msgContent as Array<Record<string, unknown>>) {
              if (c?.type === "tool_use") {
                const inputStr = c.input ? JSON.stringify(c.input).slice(0, 80) : "";
                const toolText = `${c.name as string || "tool"} ${inputStr}`.trim();
                messages.push({ type: "tool", timestamp: ts, text: toolText, sessionId, repo });
              }
            }
          } else if (typeof msgContent === "string" && msgContent.trim()) {
            messages.push({ type: "assistant", timestamp: ts, text: msgContent.trim(), sessionId, repo });
          }
        } else if (type === "summary") {
          const text = (obj.summary as string) || "";
          if (text) {
            messages.push({
              type: "system",
              timestamp: ts,
              text: `[compact] ${text.slice(0, 100)}`,
              sessionId,
              repo,
            });
          }
        }
      } catch {}
    }
  } catch {}
  return messages;
}

function formatTime(ts: string): string {
  if (!ts) return "??:??";
  try {
    return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "??:??";
  }
}

function formatDateKey(ts: string): string {
  if (!ts) return "????-??-??";
  try {
    return new Date(ts).toLocaleDateString("en-GB", {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  } catch {
    return "????-??-??";
  }
}

function renderMessages(messages: Message[], opts: DigOptions): void {
  for (const m of messages) {
    let prefix: string;
    let color: string;

    switch (m.type) {
      case "human":
        prefix = "[human    ]";
        color = C.green;
        break;
      case "assistant":
        prefix = "[assistant]";
        color = C.dim;
        break;
      case "tool":
        prefix = "[tool     ]";
        color = C.blue;
        break;
      case "system":
        prefix = "[system   ]";
        color = C.yellow;
        break;
      default:
        prefix = "[unknown  ]";
        color = C.reset;
    }

    const time = formatTime(m.timestamp);
    const text = m.text.replace(/\n/g, " ").slice(0, 140);
    console.log(`${C.dim}${time}${C.reset} ${color}${prefix}${C.reset} ${text}`);
  }
}

function parseArgs(args: string[]): DigOptions {
  const getFlag = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith("--")) return args[idx + 1];
    return undefined;
  };

  let count = 10;
  for (const a of args) {
    if (/^\d+$/.test(a)) { count = parseInt(a, 10); break; }
  }

  let recentMin: number | undefined;
  const recentStr = getFlag("--recent");
  if (recentStr) {
    const m = recentStr.match(/^(\d+)m?$/);
    if (m) recentMin = parseInt(m[1], 10);
  }

  return {
    count,
    recentMin,
    all: args.includes("--all"),
    timeline: args.includes("--timeline"),
    deep: args.includes("--deep"),
    humanOnly: args.includes("--human"),
    aiOnly: args.includes("--ai"),
    showTools: args.includes("--tools"),
    grep: getFlag("--grep"),
    oracle: getFlag("--oracle"),
    repo: getFlag("--repo"),
  };
}

async function execute(args: string[], options: { exitOnMissing?: boolean } = {}): Promise<void> {
  const opts = parseArgs(args);
  const projectDirs = findProjectDirs(opts);

  if (projectDirs.length === 0) {
    console.error("  No session data found. Run from a git repo or use --all / --repo.");
    if (options.exitOnMissing) process.exitCode = 1;
    return;
  }

  const files = collectFiles(projectDirs, opts.deep).slice(0, opts.count);

  if (files.length === 0) {
    console.log("  No .jsonl sessions found.");
    return;
  }

  let allMessages: Message[] = [];
  for (const { path, dir } of files) {
    const sessionId = basename(path, ".jsonl").slice(0, 8);
    const repo = repoLabel(dir);
    allMessages.push(...parseMessages(path, sessionId, repo));
  }

  allMessages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (opts.recentMin !== undefined) {
    const cutoff = new Date(Date.now() - opts.recentMin * 60 * 1000);
    allMessages = allMessages.filter(m => {
      try { return new Date(m.timestamp) >= cutoff; } catch { return false; }
    });
  }

  if (opts.humanOnly) {
    allMessages = allMessages.filter(m => m.type === "human");
  } else if (opts.aiOnly) {
    allMessages = allMessages.filter(m => m.type === "assistant");
  }

  if (!opts.showTools) {
    allMessages = allMessages.filter(m => m.type !== "tool");
  }

  if (opts.grep) {
    const needle = opts.grep.toLowerCase();
    allMessages = allMessages.filter(m => m.text.toLowerCase().includes(needle));
  }

  if (allMessages.length === 0) {
    console.log("  No messages found matching filters.");
    return;
  }

  if (opts.timeline) {
    const byDay = new Map<string, Message[]>();
    for (const m of allMessages) {
      const day = formatDateKey(m.timestamp);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(m);
    }
    for (const [day, msgs] of byDay) {
      console.log(`\n${C.bold}${C.cyan}── ${day} — ${msgs.length} messages${C.reset}`);
      renderMessages(msgs, opts);
    }
  } else {
    console.log(
      `\n  ${C.cyan}dig${C.reset} — ${files.length} session(s) · ${allMessages.length} messages\n`,
    );
    renderMessages(allMessages, opts);
    console.log();
  }
}

function argsFromContext(ctx: InvokeContext): string[] {
  return ctx.source === "cli" && Array.isArray(ctx.args) ? (ctx.args as string[]) : [];
}

async function captureOutput(args: string[]): Promise<InvokeResult> {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  try {
    console.log = (...values: unknown[]) => lines.push(values.map(String).join(" "));
    console.error = (...values: unknown[]) => lines.push(values.map(String).join(" "));
    await execute(args);
    const output = lines.join("\n");
    return output ? { ok: true, output } : { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const output = lines.join("\n");
    return { ok: false, error: message, ...(output ? { output } : {}) };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

export default async function handler(ctxOrArgs: InvokeContext | string[]): Promise<InvokeResult | void> {
  if (Array.isArray(ctxOrArgs)) return execute(ctxOrArgs, { exitOnMissing: true });
  return captureOutput(argsFromContext(ctxOrArgs));
}

if (import.meta.main) {
  execute(process.argv.slice(2), { exitOnMissing: true }).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
