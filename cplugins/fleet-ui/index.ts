import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { spawn } from "child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const PLUGIN = "fleet-ui";
const ENGINE_PREFIX = "/api/fleet-ui";
const ENGINE_EVENTS = ["MessageSend", "MessageDeliver", "MessageFail"];
const DEFAULT_PORT = 47_778;
const DEFAULT_ENGINE_PORT = "3456";
const MAX_OUTPUT = 80_000;

type MawRunResult = { code: number; stdout: string; stderr: string };
type MawRunner = (args: string[]) => Promise<MawRunResult>;
type FleetUiFetchOptions = { runMaw?: MawRunner };

type PaneRow = {
  id?: string;
  target?: string;
  session?: string;
  command?: string;
  title?: string;
  annotation?: string;
  status?: string;
  lastActivitySec?: number;
};

type SessionSummary = {
  name: string;
  status: string;
  panes: number;
  agents: number;
  targets: string[];
  titles: string[];
  lastActivitySec?: number;
};

const eventLog: unknown[] = [];
const sockets = new Set<ServerWebSocket<unknown>>();

export const command = {
  name: "fleet-ui",
  description: "Web dashboard for fleet control (wake/kill/done/sleep).",
};

function readOption(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0) return undefined;
  const value = args[idx + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function engineUrlFromArgs(args: string[]): string {
  const raw = readOption(args, "--engine") ?? process.env.MAW_ENGINE_URL ?? `http://127.0.0.1:${process.env.MAW_PORT || DEFAULT_ENGINE_PORT}`;
  return raw.replace(/\/+$/, "");
}

function parsePort(args: string[]): number {
  const raw = readOption(args, "--port") ?? process.env.MAW_FLEET_UI_PORT ?? String(DEFAULT_PORT);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`invalid --port: ${raw}`);
  return port;
}

function activeMawHome(): string {
  return process.env.MAW_HOME || join(homedir(), ".maw");
}

function supervisorDir(): string {
  return join(activeMawHome(), "engine-plugins");
}

function pidPath(): string {
  return join(supervisorDir(), `${PLUGIN}.pid`);
}

function logPath(): string {
  return join(supervisorDir(), `${PLUGIN}.log`);
}

function ensureSupervisorDir(): void {
  mkdirSync(supervisorDir(), { recursive: true });
}

function readPid(): number | null {
  try {
    const pid = Number(readFileSync(pidPath(), "utf-8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writePid(pid: number): void {
  ensureSupervisorDir();
  writeFileSync(pidPath(), `${pid}\n`, "utf-8");
}

function removePidFile(): void {
  try { unlinkSync(pidPath()); } catch {}
}

function isAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

function tailLog(maxBytes = 1_200): string {
  try {
    const raw = readFileSync(logPath());
    return raw.subarray(Math.max(0, raw.length - maxBytes)).toString("utf-8").trim();
  } catch {
    return "";
  }
}

function currentMawCommand(): { command: string; argsPrefix: string[] } {
  if (process.argv[0] && process.argv[1]) return { command: process.argv[0], argsPrefix: [process.argv[1]] };
  return { command: "maw", argsPrefix: [] };
}

async function defaultRunMaw(args: string[]): Promise<MawRunResult> {
  const maw = currentMawCommand();
  const proc = Bun.spawn([maw.command, ...maw.argsPrefix, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout: stdout.slice(0, MAX_OUTPUT), stderr: stderr.slice(0, MAX_OUTPUT) };
}

function jsonFromStdout(stdout: string): unknown {
  const trimmed = stdout.trim();
  const start = Math.min(
    ...[trimmed.indexOf("["), trimmed.indexOf("{")].filter((i) => i >= 0),
  );
  if (!Number.isFinite(start)) throw new Error("maw command did not return JSON");
  return JSON.parse(trimmed.slice(start));
}

function summarizeRows(rows: PaneRow[]): SessionSummary[] {
  const bySession = new Map<string, PaneRow[]>();
  for (const row of rows) {
    const session = row.session || row.target?.split(":")[0];
    if (!session) continue;
    const list = bySession.get(session) ?? [];
    list.push(row);
    bySession.set(session, list);
  }
  return [...bySession.entries()].map(([name, panes]) => {
    const statuses = panes.map((p) => p.status || "unknown");
    const status = statuses.includes("active") ? "active" : statuses.includes("stale") ? "stale" : statuses[0] || "unknown";
    const lastValues = panes.map((p) => p.lastActivitySec).filter((v): v is number => typeof v === "number");
    const agents = panes.filter((p) => /claude|codex|gemini|agent/i.test(`${p.command ?? ""} ${p.title ?? ""}`)).length;
    return {
      name,
      status,
      panes: panes.length,
      agents,
      targets: panes.map((p) => p.target).filter((v): v is string => !!v),
      titles: panes.map((p) => p.title).filter((v): v is string => !!v),
      ...(lastValues.length ? { lastActivitySec: Math.min(...lastValues) } : {}),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

async function fleetPayload(runMaw: MawRunner): Promise<{ ok: true; sessions: SessionSummary[]; panes: PaneRow[] }> {
  const result = await runMaw(["ls", "--json"]);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || `maw ls --json exited ${result.code}`);
  const parsed = jsonFromStdout(result.stdout);
  const panes = Array.isArray(parsed) ? parsed as PaneRow[] : [];
  return { ok: true, sessions: summarizeRows(panes), panes };
}

function html(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MAW Fleet UI</title>
<style>
:root{color-scheme:dark;background:#101114;color:#eee;font-family:ui-sans-serif,system-ui,sans-serif}body{margin:0;padding:24px}header{display:flex;gap:16px;align-items:center;justify-content:space-between}button{background:#7dd3fc;border:0;border-radius:8px;padding:6px 10px;cursor:pointer}button.danger{background:#fb7185}button.warn{background:#fbbf24}table{border-collapse:collapse;width:100%;margin-top:18px}th,td{border-bottom:1px solid #2a2d34;padding:9px;text-align:left}tr:hover{background:#171923}.pill{border-radius:999px;padding:2px 8px;background:#272b33}.active{color:#86efac}.stale{color:#facc15}.unknown{color:#cbd5e1}pre{white-space:pre-wrap;background:#171923;padding:12px;border-radius:8px;max-height:220px;overflow:auto}</style>
</head>
<body>
<header><div><h1>MAW Fleet UI</h1><div id="summary">loading…</div></div><button onclick="refresh()">refresh</button></header>
<table><thead><tr><th>Session</th><th>Status</th><th>Panes</th><th>Agents</th><th>Targets</th><th>Actions</th></tr></thead><tbody id="sessions"></tbody></table>
<h2>Events</h2><pre id="events">[]</pre>
<script>
const apiBase = location.pathname.startsWith('/api/fleet-ui') ? '/api/fleet-ui' : '';
async function api(path, init){ const r = await fetch(apiBase + path, init); const j = await r.json(); if(!r.ok || j.ok===false) throw new Error(j.error || r.statusText); return j; }
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function action(kind,target){ if(!target) return; if(!confirm(kind+' '+target+'?')) return; try{ const r=await api('/'+kind+'/'+encodeURIComponent(target),{method:'POST'}); alert((r.stdout||r.stderr||'ok').slice(0,1200)); await refresh(); }catch(e){ alert(e.message); } }
async function refresh(){
 const data = await api('/sessions');
 document.getElementById('summary').textContent = data.sessions.length+' sessions · '+data.panes.length+' panes';
 document.getElementById('sessions').innerHTML = data.sessions.map(s=>'<tr><td>'+esc(s.name)+'</td><td class="'+esc(s.status)+'">● '+esc(s.status)+'</td><td>'+s.panes+'</td><td>'+s.agents+'</td><td>'+s.targets.map(esc).join('<br>')+'</td><td><button onclick="action(\'wake\',\''+esc(s.name.replace(/^\\d+-/,''))+'\')">wake</button> <button class="warn" onclick="action(\'sleep\',\''+esc(s.name)+'\')">sleep</button> <button class="warn" onclick="action(\'done\',\''+esc(s.name)+'\')">done</button> <button class="danger" onclick="action(\'kill\',\''+esc(s.name)+'\')">kill</button></td></tr>').join('');
 const events = await api('/events'); document.getElementById('events').textContent = JSON.stringify(events.events.slice(-20), null, 2);
}
refresh(); setInterval(refresh, 5000);
</script>
</body></html>`;
}

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

async function runAction(kind: string, value: string, runMaw: MawRunner): Promise<Response> {
  const command: Record<string, string> = { wake: "wake", kill: "kill", done: "done", sleep: "sleep" };
  const cmd = command[kind];
  if (!cmd || !value) return json({ ok: false, error: "invalid action" }, { status: 400 });
  const result = await runMaw([cmd, value]);
  return json({ ok: result.code === 0, action: kind, target: value, command: [cmd, value], ...result }, { status: result.code === 0 ? 200 : 500 });
}

export async function fleetUiFetch(req: Request, options: FleetUiFetchOptions = {}): Promise<Response> {
  const runMaw = options.runMaw ?? defaultRunMaw;
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "GET" && path === "/health") return json({ ok: true, plugin: PLUGIN });
  if (req.method === "GET" && (path === "/" || path === "/fleet-ui")) return new Response(html(), { headers: { "content-type": "text/html; charset=utf-8" } });
  if (req.method === "GET" && path === "/sessions") return json(await fleetPayload(runMaw));
  if (req.method === "GET" && path.startsWith("/sessions/")) {
    const name = decodeURIComponent(path.slice("/sessions/".length));
    const payload = await fleetPayload(runMaw);
    return json({ ...payload, sessions: payload.sessions.filter((s) => s.name === name || s.name.replace(/^\d+-/, "") === name), panes: payload.panes.filter((p) => p.session === name || p.session?.replace(/^\d+-/, "") === name) });
  }
  const actionMatch = path.match(/^\/(wake|kill|done|sleep)\/(.+)$/);
  if (req.method === "POST" && actionMatch) return runAction(actionMatch[1], decodeURIComponent(actionMatch[2]), runMaw);
  if (path === "/events") {
    if (req.method === "GET") return json({ ok: true, events: eventLog });
    if (req.method === "POST") {
      const event = await req.json().catch(() => null);
      if (event) {
        eventLog.push(event);
        while (eventLog.length > 200) eventLog.shift();
        const message = JSON.stringify(event);
        for (const ws of sockets) ws.send(message);
      }
      return json({ ok: true, recorded: Boolean(event) });
    }
  }
  return json({ ok: false, error: "not_found" }, { status: 404 });
}

async function registerWithEngine(engineUrl: string, upstream: string): Promise<void> {
  const response = await fetch(`${engineUrl}/api/_engine/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plugin: PLUGIN, prefix: ENGINE_PREFIX, upstream, events: ENGINE_EVENTS, eventPath: "/events", health: "/health" }),
  });
  if (!response.ok) throw new Error(`engine register failed ${response.status}: ${await response.text()}`);
}

async function unregisterFromEngine(engineUrl: string): Promise<void> {
  await fetch(`${engineUrl}/api/_engine/unregister`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plugin: PLUGIN, prefix: ENGINE_PREFIX }),
  }).catch(() => undefined);
}

async function engineRegistration(engineUrl: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${engineUrl}/api/_engine/registrations`, { signal: AbortSignal.timeout(1_000) });
  if (!response.ok) return null;
  const body = await response.json() as { registrations?: Array<Record<string, unknown>> };
  return body.registrations?.find((registration) => registration.plugin === PLUGIN) ?? null;
}

async function waitForRegistration(engineUrl: string, wantPresent: boolean, timeoutMs = 2_500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const present = Boolean(await engineRegistration(engineUrl).catch(() => null));
    if (present === wantPresent) return true;
    await Bun.sleep(100);
  }
  return false;
}

async function waitForPidExit(pid: number | null, timeoutMs = 2_500): Promise<boolean> {
  if (!pid) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await Bun.sleep(100);
  }
  return !isAlive(pid);
}

function emit(ctx: InvokeContext, logs: string[], line: string): void {
  if (ctx.writer) ctx.writer(line);
  else logs.push(line);
}

async function serveEngine(ctx: InvokeContext, args: string[]): Promise<InvokeResult> {
  const logs: string[] = [];
  if (args.includes("--detach")) return detachEngine(ctx, args.filter((arg) => arg !== "--detach"));

  const engineUrl = engineUrlFromArgs(args);
  let server: Server;
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: parsePort(args),
      fetch(req, server) {
        const url = new URL(req.url);
        if (url.pathname.replace(/\/+$/, "") === "/events" && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
          return server.upgrade(req) ? undefined : new Response("websocket upgrade failed", { status: 400 });
        }
        return fleetUiFetch(req);
      },
      websocket: {
        open(ws) { sockets.add(ws); },
        close(ws) { sockets.delete(ws); },
      },
    });
  } catch (err) {
    return { ok: false, error: `failed to start ${PLUGIN} server: ${err instanceof Error ? err.message : String(err)}` };
  }
  const upstream = `http://127.0.0.1:${server.port}`;

  try {
    await registerWithEngine(engineUrl, upstream);
  } catch (err) {
    server.stop(true);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  emit(ctx, logs, `maw fleet-ui serve → ${upstream}/fleet-ui (registered ${ENGINE_PREFIX} on ${engineUrl})`);
  emit(ctx, logs, `proxied dashboard: ${engineUrl}${ENGINE_PREFIX}/`);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    unregisterFromEngine(engineUrl).finally(() => {
      server.stop(true);
      process.exit(0);
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  await new Promise(() => undefined);
  return { ok: true, output: logs.join("\n") };
}

async function detachEngine(ctx: InvokeContext, args: string[]): Promise<InvokeResult> {
  const logs: string[] = [];
  const engineUrl = engineUrlFromArgs(args);
  const existingPid = readPid();
  const existingRegistration = await engineRegistration(engineUrl).catch(() => null);
  if (isAlive(existingPid) && existingRegistration) return { ok: true, output: `maw fleet-ui serve already running (PID ${existingPid}, ${ENGINE_PREFIX} registered)\nlog: ${logPath()}` };
  if (isAlive(existingPid)) {
    try { process.kill(existingPid!, "SIGTERM"); } catch { removePidFile(); }
    if (!(await waitForPidExit(existingPid, 1_000))) return { ok: false, error: `live PID ${existingPid} is not registered; run: maw fleet-ui stop --engine ${engineUrl}` };
    removePidFile();
  }
  if (existingPid && !isAlive(existingPid)) removePidFile();

  ensureSupervisorDir();
  const outFd = openSync(logPath(), "a");
  const childArgs = ["fleet-ui", "serve"];
  const engine = readOption(args, "--engine");
  const port = readOption(args, "--port");
  if (engine) childArgs.push("--engine", engine);
  if (port) childArgs.push("--port", port);

  const maw = currentMawCommand();
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(maw.command, [...maw.argsPrefix, ...childArgs], { detached: true, stdio: ["ignore", outFd, outFd], env: { ...process.env, MAW_ENGINE_URL: engineUrl } });
  } catch (err) {
    closeSync(outFd);
    return { ok: false, error: `failed to spawn maw fleet-ui serve: ${err instanceof Error ? err.message : String(err)}` };
  }
  closeSync(outFd);
  if (!child.pid) return { ok: false, error: `failed to spawn maw fleet-ui serve: no child PID\nlog: ${logPath()}` };
  child.unref();
  writePid(child.pid);

  if (!(await waitForRegistration(engineUrl, true))) {
    return { ok: false, error: [`maw fleet-ui serve --detach did not register ${ENGINE_PREFIX}`, `pid: ${child.pid}`, `log: ${logPath()}`, tailLog() ? `tail:\n${tailLog()}` : ""].filter(Boolean).join("\n") };
  }

  emit(ctx, logs, `maw fleet-ui serve detached (PID ${child.pid})`);
  emit(ctx, logs, `dashboard: http://127.0.0.1:${port ?? DEFAULT_PORT}/fleet-ui`);
  emit(ctx, logs, `registered: ${ENGINE_PREFIX} on ${engineUrl}`);
  emit(ctx, logs, `log: ${logPath()}`);
  return { ok: true, output: logs.join("\n") };
}

async function statusEngine(args: string[]): Promise<InvokeResult> {
  const engineUrl = engineUrlFromArgs(args);
  const pid = readPid();
  const alive = isAlive(pid);
  const registration = await engineRegistration(engineUrl).catch(() => null);
  return { ok: true, output: [
    `maw fleet-ui serve: ${alive ? "running" : "stopped"}${pid ? ` (PID ${pid})` : ""}`,
    `engine: ${engineUrl}`,
    `registered: ${registration ? `${registration.prefix ?? ENGINE_PREFIX} → ${registration.upstream ?? "unknown"}` : "no"}`,
    `dashboard: http://127.0.0.1:${process.env.MAW_FLEET_UI_PORT || DEFAULT_PORT}/fleet-ui`,
    `log: ${logPath()}`,
    !alive && pid && existsSync(pidPath()) ? "note: stale pid file present" : "",
  ].filter(Boolean).join("\n") };
}

async function stopEngine(args: string[]): Promise<InvokeResult> {
  const engineUrl = engineUrlFromArgs(args);
  const pid = readPid();
  const lines: string[] = [];
  if (isAlive(pid)) {
    try { process.kill(pid!, "SIGTERM"); lines.push(`sent SIGTERM to PID ${pid}`); }
    catch (err) { lines.push(`PID ${pid} was already gone (${err instanceof Error ? err.message : String(err)})`); removePidFile(); }
    if (await waitForPidExit(pid)) { lines.push(`stopped PID ${pid}`); removePidFile(); }
    else return { ok: false, error: [...lines, `PID ${pid} did not exit after SIGTERM`, `log: ${logPath()}`].join("\n") };
  } else {
    lines.push("maw fleet-ui serve already stopped");
    if (pid && existsSync(pidPath())) { removePidFile(); lines.push("removed stale pid file"); }
  }
  if (!(await waitForRegistration(engineUrl, false))) { await unregisterFromEngine(engineUrl); lines.push(`forced unregister ${ENGINE_PREFIX}`); }
  return { ok: true, output: lines.join("\n") };
}

function usage(): string {
  return "maw fleet-ui serve [--detach] [--engine URL] [--port N] | status [--engine URL] | stop [--engine URL] | --json";
}

export default async function handler(ctx: InvokeContext): Promise<InvokeResult & Record<string, unknown>> {
  const args = ctx.source === "cli" && Array.isArray(ctx.args) ? ctx.args : [];
  if (args[0] === "serve") return serveEngine(ctx, args.slice(1));
  if (args[0] === "status") return statusEngine(args.slice(1));
  if (args[0] === "stop") return stopEngine(args.slice(1));
  if (ctx.source === "api") {
    const payload = await fleetPayload(defaultRunMaw);
    return { ...payload, output: JSON.stringify(payload, null, 2) };
  }
  if (args.includes("--json")) {
    const payload = await fleetPayload(defaultRunMaw);
    return { ...payload, output: JSON.stringify(payload, null, 2) };
  }
  return { ok: true, output: usage() };
}
