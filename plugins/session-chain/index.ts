import { readdirSync, readFileSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";

export const command = {
  name: "session-chain",
  description: "Session history as a linked list across /forward, /compact, and continuation sessions.",
};

interface SessionNode {
  id: string;
  shortId: string;
  repo: string;
  startTime: string;
  endTime: string;
  durationMin: number;
  messageCount: number;
  humanMessages: number;
  toolCalls: number;
  summary: string;
  handoffTo?: string;
  continuedFrom?: string;
  filePath: string;
  fileSize: number;
}

interface SessionChain {
  nodes: SessionNode[];
  repo: string;
  totalDuration: number;
  totalMessages: number;
}

function encodePwd(dir: string): string {
  return dir.replace(/^\//, "-").replace(/[/.]/g, "-");
}

function findProjectDirs(repo?: string): string[] {
  const base = join(homedir(), ".claude", "projects");
  try {
    const dirs = readdirSync(base)
      .filter(d => {
        if (repo) return d.includes(repo.replace(/[/.]/g, "-"));
        return true;
      })
      .map(d => join(base, d))
      .filter(d => {
        try { return statSync(d).isDirectory(); } catch { return false; }
      });
    return dirs;
  } catch { return []; }
}

function parseJsonlSession(filePath: string): SessionNode | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    if (lines.length === 0) return null;

    const id = basename(filePath, ".jsonl");
    let startTime = "";
    let endTime = "";
    let messageCount = 0;
    let humanMessages = 0;
    let toolCalls = 0;
    let summary = "";
    let handoffTo: string | undefined;
    let continuedFrom: string | undefined;

    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        const ts = msg.timestamp || "";

        if (ts && !startTime) startTime = ts;
        if (ts) endTime = ts;

        if (msg.type === "user") {
          messageCount++;
          const content = msg.message?.content;
          let text = "";
          if (typeof content === "string") text = content;
          else if (Array.isArray(content)) {
            for (const c of content) {
              if (c?.type === "text") { text = c.text || ""; break; }
            }
          }

          if (text && !text.startsWith("<")) {
            humanMessages++;
            if (!summary && text.length > 10) {
              summary = text.slice(0, 80).replace(/\n/g, " ");
            }
          }

          if (text.includes("/forward") || text.includes("/forward-bg")) {
            const sessionMatch = text.match(/session[:\s]+([a-f0-9]{8})/i);
            if (sessionMatch) handoffTo = sessionMatch[1];
          }
        }

        if (msg.type === "assistant") {
          messageCount++;
          const content = msg.message?.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c?.type === "tool_use") toolCalls++;
              if (c?.type === "text" && typeof c.text === "string") {
                if (c.text.includes("continued from") || c.text.includes("Continuing from")) {
                  const match = c.text.match(/([a-f0-9]{8})/);
                  if (match) continuedFrom = match[1];
                }
              }
            }
          }
        }
      } catch {}
    }

    if (!startTime) return null;

    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMin = Math.round((end.getTime() - start.getTime()) / 60000);
    const fileSize = statSync(filePath).size;

    return {
      id,
      shortId: id.slice(0, 8),
      repo: "",
      startTime,
      endTime,
      durationMin: Math.max(0, durationMin),
      messageCount,
      humanMessages,
      toolCalls,
      summary: summary || "(no summary)",
      handoffTo,
      continuedFrom,
      filePath,
      fileSize,
    };
  } catch {
    return null;
  }
}

function buildChain(projectDir: string): SessionChain {
  const repo = basename(projectDir);
  const nodes: SessionNode[] = [];

  try {
    const files = readdirSync(projectDir)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => join(projectDir, f))
      .sort((a, b) => {
        try {
          return statSync(a).mtime.getTime() - statSync(b).mtime.getTime();
        } catch { return 0; }
      });

    for (const file of files) {
      const node = parseJsonlSession(file);
      if (node) {
        node.repo = repo;
        nodes.push(node);
      }
    }
  } catch {}

  // Link chains: if session B's continuedFrom matches session A's shortId
  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1];
    const curr = nodes[i];
    if (!curr.continuedFrom) {
      // Auto-link by time proximity (< 5 min gap = likely continuation)
      const prevEnd = new Date(prev.endTime).getTime();
      const currStart = new Date(curr.startTime).getTime();
      const gapMin = (currStart - prevEnd) / 60000;
      if (gapMin >= 0 && gapMin < 5) {
        curr.continuedFrom = prev.shortId;
        prev.handoffTo = curr.shortId;
      }
    }
  }

  const totalDuration = nodes.reduce((sum, n) => sum + n.durationMin, 0);
  const totalMessages = nodes.reduce((sum, n) => sum + n.messageCount, 0);

  return { nodes, repo, totalDuration, totalMessages };
}

function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

function renderList(chain: SessionChain, limit: number, json: boolean): void {
  const nodes = chain.nodes.slice(-limit);

  if (json) {
    console.log(JSON.stringify({ repo: chain.repo, totalDuration: chain.totalDuration, totalMessages: chain.totalMessages, sessions: nodes }, null, 2));
    return;
  }

  console.log(`\n  \x1b[36mSession Chain\x1b[0m — ${chain.repo}`);
  console.log(`  ${chain.nodes.length} sessions · ${formatDuration(chain.totalDuration)} total · ${chain.totalMessages} messages\n`);

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const link = n.continuedFrom ? `← ${n.continuedFrom}` : i === 0 ? "◆ start" : "· · ·";
    const arrow = n.handoffTo ? `→ ${n.handoffTo}` : i === nodes.length - 1 ? "◆ current" : "";

    const time = new Date(n.startTime).toLocaleString("en-GB", {
      timeZone: "Asia/Bangkok",
      month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });

    console.log(`  \x1b[90m${link.padEnd(12)}\x1b[0m \x1b[33m${n.shortId}\x1b[0m  ${time}  ${formatDuration(n.durationMin).padEnd(6)} ${String(n.humanMessages).padStart(3)} msgs  ${String(n.toolCalls).padStart(4)} tools  ${formatSize(n.fileSize).padEnd(6)} ${n.summary.slice(0, 50)}`);

    if (arrow && i < nodes.length - 1) {
      console.log(`  \x1b[90m${arrow}\x1b[0m`);
    }
  }

  console.log();
}

function renderGraph(chain: SessionChain, limit: number): void {
  const nodes = chain.nodes.slice(-limit);

  console.log(`\n  \x1b[36mSession Graph\x1b[0m — ${chain.repo}\n`);

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const isLast = i === nodes.length - 1;
    const connector = isLast ? "◆" : "│";
    const branch = isLast ? "└─" : "├─";

    const time = new Date(n.startTime).toLocaleString("en-GB", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit", minute: "2-digit",
      month: "short", day: "2-digit",
    });

    console.log(`  ${branch} \x1b[33m${n.shortId}\x1b[0m  ${time}  ${formatDuration(n.durationMin)}  ${n.humanMessages} human  ${n.summary.slice(0, 40)}`);

    if (!isLast) {
      const next = nodes[i + 1];
      const gap = (new Date(next.startTime).getTime() - new Date(n.endTime).getTime()) / 60000;
      if (gap > 5) {
        console.log(`  │  \x1b[90m· · · ${formatDuration(Math.round(gap))} gap\x1b[0m`);
      }
    }
  }

  console.log();
}

// --- Main ---
// CLI entrypoint when run directly via bun
if (import.meta.main) {
  const args = process.argv.slice(2);
  execute(args, { exitOnMissing: true }).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

async function execute(args: string[], options: { exitOnMissing?: boolean } = {}): Promise<void> {
  const sub = args[0] || "list";
  const flags = args.slice(1);

  const limit = (() => {
    const idx = flags.indexOf("--limit");
    if (idx >= 0 && flags[idx + 1]) return parseInt(flags[idx + 1], 10);
    return 20;
  })();

  const json = flags.includes("--json");

  const repoFilter = (() => {
    const idx = flags.indexOf("--repo");
    if (idx >= 0 && flags[idx + 1]) return flags[idx + 1];
    return undefined;
  })();

  // Find project dirs
  const cwd = process.cwd();
  const encoded = encodePwd(cwd);
  const projectDirs = repoFilter
    ? findProjectDirs(repoFilter)
    : [join(homedir(), ".claude", "projects", encoded)];

  if (projectDirs.length === 0) {
    console.error("  No session data found. Run from a git repo or use --repo.");
    if (options.exitOnMissing) process.exitCode = 1;
    return;
  }

  for (const dir of projectDirs) {
    try { statSync(dir); } catch {
      console.error(`  No sessions found at ${dir}`);
      continue;
    }

    const chain = buildChain(dir);
    if (chain.nodes.length === 0) {
      console.log("  No sessions found.");
      continue;
    }

    switch (sub) {
      case "list":
        renderList(chain, limit, json);
        break;
      case "show": {
        const target = flags[0] || chain.nodes[chain.nodes.length - 1]?.shortId;
        const node = chain.nodes.find(n => n.shortId === target || n.id === target);
        if (!node) {
          console.error(`  Session ${target} not found.`);
          break;
        }
        if (json) {
          console.log(JSON.stringify(node, null, 2));
        } else {
          console.log(`\n  \x1b[33m${node.shortId}\x1b[0m — ${node.summary}`);
          console.log(`  Start:    ${node.startTime}`);
          console.log(`  End:      ${node.endTime}`);
          console.log(`  Duration: ${formatDuration(node.durationMin)}`);
          console.log(`  Messages: ${node.messageCount} (${node.humanMessages} human)`);
          console.log(`  Tools:    ${node.toolCalls}`);
          console.log(`  Size:     ${formatSize(node.fileSize)}`);
          console.log(`  File:     ${node.filePath}`);
          if (node.continuedFrom) console.log(`  From:     ${node.continuedFrom}`);
          if (node.handoffTo) console.log(`  To:       ${node.handoffTo}`);
          console.log();
        }
        break;
      }
      case "graph":
        renderGraph(chain, limit);
        break;
      default:
        console.log("  usage: maw session-chain [list|show|graph] [--limit N] [--json] [--repo name]");
    }
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
    console.log = (...values: unknown[]) => {
      lines.push(values.map(value => String(value)).join(" "));
    };
    console.error = (...values: unknown[]) => {
      lines.push(values.map(value => String(value)).join(" "));
    };

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
  if (Array.isArray(ctxOrArgs)) {
    return execute(ctxOrArgs, { exitOnMissing: true });
  }

  return captureOutput(argsFromContext(ctxOrArgs));
}
