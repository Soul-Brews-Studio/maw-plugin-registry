import { execSync } from "child_process";
import { existsSync, readdirSync, statSync, readFileSync } from "fs";
import { join, basename } from "path";

const AUTH_KEY = process.env.AUTH_KEY;
const SIGNAL_URL = process.env.SIGNAL_URL || "wss://phd-signaling.laris.workers.dev/ws";

if (!AUTH_KEY) {
  throw new Error(
    "AUTH_KEY not set — get the key from your team's private channel, " +
    "then: export AUTH_KEY=<key>"
  );
}

function formatSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(1)} GB`;
}

export async function ensureDeps(pluginDir: string, log: (...a: unknown[]) => void): Promise<void> {
  const nm = join(pluginDir, "node_modules");
  if (existsSync(nm)) return;

  log("First run — installing WebRTC dependencies (werift)...");
  try {
    execSync("bun install --no-save", { cwd: pluginDir, stdio: "pipe" });
    log("Dependencies installed.");
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer };
    const msg = err.stderr?.toString() || "unknown error";
    throw new Error(`Failed to install dependencies in ${pluginDir}: ${msg}`);
  }
}

export function runSend(pluginDir: string, args: string[]): void {
  const sendTs = join(pluginDir, "send.ts");
  if (!existsSync(sendTs)) {
    throw new Error(`send.ts not found at ${sendTs} — plugin may be corrupted`);
  }
  try {
    execSync(
      `bun run ${sendTs} ${args.map(a => `"${a}"`).join(" ")}`,
      {
        stdio: "inherit",
        cwd: pluginDir,
        env: { ...process.env, AUTH_KEY, SIGNAL_URL },
      }
    );
  } catch (e: unknown) {
    const err = e as { status?: number };
    if (err.status) process.exit(err.status);
  }
}

export function listPeers(pluginDir: string, log: (...a: unknown[]) => void): void {
  runSend(pluginDir, ["--list"]);
}

export function listUploads(log: (...a: unknown[]) => void): void {
  log("list/index commands require access to the m5 receiver.");
  log("Use on m5 directly, or check the web UI.");
  log("");
  log("If you have the phd-satellite-data repo cloned:");
  log("  cd phd-satellite-data/phd/dropbox");
  log("  ls uploads/");
}

interface IndexEntry {
  ts: string;
  originalName: string;
  savedAs: string;
  date: string;
  size: number;
  sender: string;
  senderId: string;
}

export function queryIndex(filter: string | undefined, log: (...a: unknown[]) => void): void {
  const tryPaths = [
    join(process.env.HOME || "~", "Code/github.com/the-oracle-keeps-the-human-human/phd-satellite-data/phd/dropbox/uploads/index.jsonl"),
    "/opt/Code/github.com/the-oracle-keeps-the-human-human/phd-satellite-data/phd/dropbox/uploads/index.jsonl",
  ];

  let indexPath = "";
  for (const p of tryPaths) {
    if (existsSync(p)) { indexPath = p; break; }
  }

  if (!indexPath) {
    log("No index found locally — index is on m5 receiver.");
    log("SSH to m5 and run: maw dropbox index");
    return;
  }

  const lines = readFileSync(indexPath, "utf8").trim().split("\n").filter(Boolean);
  let entries: IndexEntry[] = lines.map(l => JSON.parse(l));

  if (filter) {
    const q = filter.toLowerCase();
    entries = entries.filter(e =>
      e.originalName.toLowerCase().includes(q) ||
      e.sender.toLowerCase().includes(q) ||
      e.date.includes(q)
    );
  }

  if (!entries.length) {
    log(filter ? `No matches for "${filter}"` : "Index is empty");
    return;
  }

  log(`\n  ${"Date".padEnd(12)} ${"Sender".padEnd(20)} ${"File".padEnd(40)} ${"Size".padStart(10)}`);
  log(`  ${"─".repeat(12)} ${"─".repeat(20)} ${"─".repeat(40)} ${"─".repeat(10)}`);

  for (const e of entries) {
    const time = e.ts.slice(11, 19);
    log(`  ${e.date} ${e.sender.padEnd(20)} ${e.originalName.slice(0, 40).padEnd(40)} ${formatSize(e.size).padStart(10)}  ${time}`);
  }

  log(`\n  ${entries.length} entries`);
}

export function showHelp(log: (...a: unknown[]) => void): void {
  log(`
maw dropbox — P2P file sharing via WebRTC DataChannel

  maw dropbox send <file> [file2...]     Send to m5-receiver (default)
  maw dropbox send --to <name> <file>    Send to specific peer
  maw dropbox peers                      List online peers
  maw dropbox list                       List received files (m5 only)
  maw dropbox index [query]              Search index (m5 only)
  maw dropbox version                    Show version

  Shortcuts: s=send, p=peers, ls=list, i=index, v=version

  Env:
    AUTH_KEY      Signaling auth (REQUIRED — get from private channel)
    PEER_NAME     Your peer name (default: cli-HHMM-hash)
    SIGNAL_URL    Signaling server (default: phd-signaling.laris.workers.dev)

  First run auto-installs WebRTC dependencies (werift).
`);
}
