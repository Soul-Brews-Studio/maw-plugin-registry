import { spawn } from "node:child_process";
import { type Config } from "./types";
import { type PlanRow } from "./plan";

export type DirtyKind = "new" | "mod" | "del" | "ren";
export type DirtyCategory = "push" | "pull" | "conflict";

export type DirtyEntry = {
  path: string;
  kind: DirtyKind;
  raw: string;
};

export type DirtyRow = {
  path: string;
  category: DirtyCategory;
  local?: DirtyEntry;
  remote?: DirtyEntry;
};

export type DirtyReport = {
  label: string;
  localPath: string;
  remotePath: string;
  rows: DirtyRow[];
  localError?: string;
  remoteError?: string;
};

export type DirtySummary = {
  push: number;
  pull: number;
  conflict: number;
};

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function run(cmd: string, args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

export function parseGitStatusShort(stdout: string): DirtyEntry[] {
  const entries: DirtyEntry[] = [];
  for (const raw of stdout.split("\n")) {
    if (!raw.trim()) continue;
    const xy = raw.slice(0, 2);
    const pathPart = raw.slice(3).trim();
    if (!pathPart) continue;
    const path = pathPart.includes(" -> ") ? pathPart.split(" -> ").pop()!.trim() : pathPart;
    let kind: DirtyKind = "mod";
    if (xy === "??" || xy.includes("A")) kind = "new";
    else if (xy.includes("D")) kind = "del";
    else if (xy.includes("R")) kind = "ren";
    entries.push({ path, kind, raw });
  }
  return entries;
}

export function compareDirty(local: DirtyEntry[], remote: DirtyEntry[]): DirtyRow[] {
  const localByPath = new Map(local.map((entry) => [entry.path, entry]));
  const remoteByPath = new Map(remote.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...localByPath.keys(), ...remoteByPath.keys()])].sort();
  return paths.map((path) => {
    const localEntry = localByPath.get(path);
    const remoteEntry = remoteByPath.get(path);
    if (localEntry && remoteEntry) return { path, category: "conflict", local: localEntry, remote: remoteEntry };
    if (localEntry) return { path, category: "push", local: localEntry };
    return { path, category: "pull", remote: remoteEntry! };
  });
}


export function dirtyInspectionErrors(reports: DirtyReport[]): string[] {
  const errors: string[] = [];
  for (const report of reports) {
    if (report.localError) errors.push(`${report.label} local: ${report.localError}`);
    if (report.remoteError && report.remoteError !== "remote repo absent") {
      errors.push(`${report.label} remote: ${report.remoteError}`);
    }
  }
  return errors;
}

export function summarizeDirty(reports: DirtyReport[]): DirtySummary {
  const summary: DirtySummary = { push: 0, pull: 0, conflict: 0 };
  for (const report of reports) {
    for (const row of report.rows) summary[row.category]++;
  }
  return summary;
}

async function localDirty(path: string): Promise<{ entries: DirtyEntry[]; error?: string }> {
  const result = await run("git", ["status", "--short"], path);
  if (result.code !== 0) return { entries: [], error: result.stderr.trim() || `git status exit ${result.code}` };
  return { entries: parseGitStatusShort(result.stdout) };
}

async function remoteDirty(host: string, path: string): Promise<{ entries: DirtyEntry[]; error?: string }> {
  const cmd = `cd ${shQuote(path)} && (command -v rtk >/dev/null 2>&1 && rtk git status --short || git status --short)`;
  const result = await run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "--", host, cmd]);
  if (result.code !== 0) return { entries: [], error: result.stderr.trim() || `ssh git status exit ${result.code}` };
  return { entries: parseGitStatusShort(result.stdout) };
}

export async function collectDirtyReports(plan: PlanRow[], cfg: Config): Promise<DirtyReport[]> {
  const reports: DirtyReport[] = [];
  for (const row of plan) {
    if (row.kind !== "repo" || row.skip) continue;
    const local = await localDirty(row.realLocal);
    const remote = row.remoteState === "present"
      ? await remoteDirty(cfg.host, row.remotePath)
      : { entries: [], error: row.remoteState === "absent" ? "remote repo absent" : "remote state unknown" };
    reports.push({
      label: row.label,
      localPath: row.realLocal,
      remotePath: row.remotePath,
      rows: compareDirty(local.entries, remote.entries),
      localError: local.error,
      remoteError: remote.error,
    });
  }
  return reports;
}

function kindLabel(entry?: DirtyEntry): string {
  if (!entry) return "—";
  return entry.kind;
}

function sideLabel(entry?: DirtyEntry): string {
  if (!entry) return "—";
  return `${entry.path} (${kindLabel(entry)})`;
}

export function renderDirtyReports(reports: DirtyReport[], host: string, verbose: boolean): void {
  console.log("🧭 dirty check");
  if (reports.length === 0) {
    console.log("   (no repo targets to compare)\n");
    return;
  }

  for (const report of reports) {
    const rows = verbose ? report.rows : report.rows.slice(0, 20);
    console.log(`   ${report.label}`);
    if (report.localError) console.log(`     ⚠ local: ${report.localError}`);
    if (report.remoteError) console.log(`     ⚠ remote: ${report.remoteError}`);
    if (report.rows.length === 0) {
      console.log("     ✓ clean on both sides");
      continue;
    }
    console.log(`     ${"LOCAL (m5)".padEnd(42)} ${`REMOTE (${host})`.padEnd(42)} action`);
    for (const row of rows) {
      const action = row.category === "conflict" ? "CONFLICT" : row.category;
      console.log(`     ${sideLabel(row.local).padEnd(42)} ${sideLabel(row.remote).padEnd(42)} ${action}`);
    }
    if (!verbose && report.rows.length > rows.length) {
      console.log(`     … and ${report.rows.length - rows.length} more (--verbose to see all)`);
    }
  }

  const summary = summarizeDirty(reports);
  console.log(`   summary: ${summary.push} to push, ${summary.pull} to pull, ${summary.conflict} conflict${summary.conflict === 1 ? "" : "s"}\n`);
}
