import { describe, expect, test } from "bun:test";
import { fleetUiFetch } from "./index";

const rows = [
  { id: "%1", target: "54-mawjs:mawjs-oracle.0", session: "54-mawjs", command: "claude.exe", title: "✳ Claude", status: "active", lastActivitySec: 3 },
  { id: "%2", target: "54-mawjs:mawjs-issuer.0", session: "54-mawjs", command: "zsh", title: "issuer", status: "stale", lastActivitySec: 9 },
  { id: "%3", target: "58-volt:volt-oracle.0", session: "58-volt", command: "codex", title: "codex", status: "stale", lastActivitySec: 7 },
];

function runner(calls: string[][] = []) {
  return async (args: string[]) => {
    calls.push(args);
    if (args[0] === "ls") return { code: 0, stdout: JSON.stringify(rows), stderr: "" };
    return { code: 0, stdout: `ran ${args.join(" ")}`, stderr: "" };
  };
}

describe("fleet-ui", () => {
  test("health endpoint is cheap and local", async () => {
    const res = await fleetUiFetch(new Request("http://x/health"), { runMaw: runner() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, plugin: "fleet-ui" });
  });

  test("sessions endpoint groups maw ls --json pane rows", async () => {
    const calls: string[][] = [];
    const res = await fleetUiFetch(new Request("http://x/sessions"), { runMaw: runner(calls) });
    const body = await res.json() as any;
    expect(calls).toEqual([["ls", "--json"]]);
    expect(body.ok).toBe(true);
    expect(body.panes).toHaveLength(3);
    expect(body.sessions.find((s: any) => s.name === "54-mawjs")).toMatchObject({ panes: 2, agents: 1, status: "active" });
  });

  test("action endpoints decode target and invoke maw without a shell", async () => {
    const calls: string[][] = [];
    const target = encodeURIComponent("54-mawjs:mawjs-oracle.0");
    const res = await fleetUiFetch(new Request(`http://x/kill/${target}`, { method: "POST" }), { runMaw: runner(calls) });
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.command).toEqual(["kill", "54-mawjs:mawjs-oracle.0"]);
    expect(calls).toEqual([["kill", "54-mawjs:mawjs-oracle.0"]]);
  });

  test("browser shell is served at standalone and proxied roots", async () => {
    const standalone = await fleetUiFetch(new Request("http://x/fleet-ui"), { runMaw: runner() });
    const proxied = await fleetUiFetch(new Request("http://x/"), { runMaw: runner() });
    expect(await standalone.text()).toContain("MAW Fleet UI");
    expect(await proxied.text()).toContain("/api/fleet-ui");
  });
});
