import { describe, expect, test } from "bun:test";
import { correct, parseFckArgs, staticCorrection, type Runner } from "./impl";
import handler from "./index";

const okRunner = (calls: string[][]): Runner => async (argv) => {
  calls.push(argv);
  if (argv[0] === "thefuck") return { code: 0, stdout: "git push --set-upstream origin main\n", stderr: "" };
  if (argv[0] === "sh") return { code: 0, stdout: "done\n", stderr: "" };
  return { code: 127, stdout: "", stderr: "not found" };
};

describe("fck parser", () => {
  test("parses explicit command/output flags", () => {
    expect(parseFckArgs(["--command", "maw bud x --orgs acme", "--stderr", "Unknown flag --orgs. Did you mean --org?", "--json"])).toMatchObject({
      command: "maw bud x --orgs acme",
      stderr: "Unknown flag --orgs. Did you mean --org?",
      json: true,
    });
  });
});

describe("maw-static provider", () => {
  test("turns disabled plugin hint into maw plugin enable command", () => {
    const hit = staticCorrection({
      command: "maw ls",
      stderr: "✗ 'shellenv' is installed but disabled.\n  Run: maw plugin enable shellenv",
    });
    expect(hit?.candidate).toBe("maw plugin enable shellenv");
    expect(hit?.source).toBe("maw-static:disabled-plugin");
  });

  test("rewrites unknown flag from maw suggestion", () => {
    const hit = staticCorrection({
      command: "maw bud demo --orgs laris-co",
      stderr: "Unknown flag --orgs. Did you mean --org?",
    });
    expect(hit?.candidate).toBe("maw bud demo --org laris-co");
  });

  test("rewrites unknown maw command from did-you-mean", () => {
    const hit = staticCorrection({
      command: "maw brng mawjs",
      stderr: "error: unknown command: brng\n  hint: did you mean: bring?",
    });
    expect(hit?.candidate).toBe("maw bring mawjs");
  });
});

describe("upstream wrapper and execution", () => {
  test("uses upstream thefuck when static provider misses", async () => {
    const calls: string[][] = [];
    const result = await correct({ command: "git push" }, okRunner(calls));
    expect(result.ok).toBe(true);
    expect(result.source).toBe("thefuck");
    expect(result.candidate).toBe("git push --set-upstream origin main");
    expect(calls[0]).toEqual(["thefuck", "--", "git", "push"]);
  });

  test("execute requires explicit --yes", async () => {
    const calls: string[][] = [];
    const blocked = await correct({ command: "git push", execute: true }, okRunner(calls));
    expect(blocked.error).toContain("without --yes");
    const executed = await correct({ command: "git push", execute: true, yes: true }, okRunner(calls));
    expect(executed.executed?.code).toBe(0);
    expect(calls.some((c) => c[0] === "sh" && c[1] === "-lc")).toBe(true);
  });
});

describe("handler", () => {
  test("returns JSON corrections", async () => {
    const res = await handler({ source: "cli", args: ["--command", "maw ls", "--stderr", "✗ 'shellenv' is installed but disabled. Run: maw plugin enable shellenv", "--json"] });
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.output!).candidate).toBe("maw plugin enable shellenv");
  });

  test("lists providers", async () => {
    const res = await handler({ source: "cli", args: ["--list"] });
    expect(res.ok).toBe(true);
    expect(res.output).toContain("maw-static");
  });
});
