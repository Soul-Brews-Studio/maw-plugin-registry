/**
 * Tests for fleet-as-truth smart-default org resolution.
 *
 * Pure dependency injection — pass mock `loadFleetFn` and `execFn` directly.
 * No `mock.module` calls, so this test file doesn't pollute Bun's
 * process-global module cache or interact with neighboring test files.
 */
import { describe, test, expect } from "bun:test";
import {
  smartDefaultOrgFromFleet,
  fetchGhDefaultLogin,
  resolveOrg,
  formatOrgSource,
} from "./smart-default-org";

describe("smartDefaultOrgFromFleet — fleet (FTS) tier", () => {
  test("returns null on empty fleet", () => {
    expect(smartDefaultOrgFromFleet(() => [])).toBeNull();
  });

  test("returns most-recent budded_at org", () => {
    const fleet = [
      { name: "01-old", windows: [{ name: "old", repo: "Old-Org/old-oracle" }], budded_at: "2026-01-01T00:00:00Z" },
      { name: "26-new", windows: [{ name: "new", repo: "New-Org/new-oracle" }], budded_at: "2026-05-04T00:00:00Z" },
      { name: "12-mid", windows: [{ name: "mid", repo: "Mid-Org/mid-oracle" }], budded_at: "2026-03-15T00:00:00Z" },
    ] as any;
    const result = smartDefaultOrgFromFleet(() => fleet);
    expect(result?.org).toBe("New-Org");
    expect(result?.oracle).toBe("new");
    expect(result?.date).toBe("2026-05-04");
  });

  test("falls back to numeric prefix when budded_at missing", () => {
    const fleet = [
      { name: "05-foo", windows: [{ name: "foo", repo: "Foo-Org/foo-oracle" }] },
      { name: "20-bar", windows: [{ name: "bar", repo: "Bar-Org/bar-oracle" }] },
    ] as any;
    expect(smartDefaultOrgFromFleet(() => fleet)?.org).toBe("Bar-Org");
  });

  test("skips entries with malformed repo field (defensive #1133)", () => {
    const fleet = [
      { name: "01-bad", windows: [{ name: "bad" }] },
      { name: "02-also-bad", windows: [{ name: "also-bad", repo: "no-slash-here" }] },
      { name: "03-good", windows: [{ name: "good", repo: "Good/good-oracle" }], budded_at: "2026-04-01T00:00:00Z" },
    ] as any;
    expect(smartDefaultOrgFromFleet(() => fleet)?.org).toBe("Good");
  });

  test("handles entries with empty windows array", () => {
    const fleet = [
      { name: "weird", windows: [] },
      { name: "01-good", windows: [{ name: "good", repo: "Good/good-oracle" }], budded_at: "2026-04-01T00:00:00Z" },
    ] as any;
    expect(smartDefaultOrgFromFleet(() => fleet)?.org).toBe("Good");
  });
});

describe("fetchGhDefaultLogin — gh (vector) cold-start", () => {
  test("returns trimmed login on success", async () => {
    const exec = async (cmd: string) => cmd.includes("gh api user") ? "nazt\n" : "";
    expect(await fetchGhDefaultLogin(exec)).toBe("nazt");
  });

  test("returns null on hostExec error (gh missing/unauthed)", async () => {
    const exec = async () => { throw new Error("gh: command not found"); };
    expect(await fetchGhDefaultLogin(exec)).toBeNull();
  });

  test("returns null on empty output (gh succeeded but no login)", async () => {
    const exec = async () => "\n";
    expect(await fetchGhDefaultLogin(exec)).toBeNull();
  });
});

describe("resolveOrg — full precedence chain", () => {
  const fleet = [{ name: "01-x", windows: [{ name: "x", repo: "Fleet-Org/x" }], budded_at: "2026-05-01" }] as any;

  test("--org flag wins over everything", async () => {
    const r = await resolveOrg(
      { flag: "Flag-Org", env: "Env-Org", config: "Config-Org" },
      { loadFleetFn: () => fleet, execFn: async () => "gh-user\n" },
    );
    expect(r.org).toBe("Flag-Org");
    expect(r.source).toBe("flag");
  });

  test("env wins over config + fleet when no flag", async () => {
    const r = await resolveOrg(
      { env: "Env-Org", config: "Config-Org" },
      { loadFleetFn: () => fleet },
    );
    expect(r.org).toBe("Env-Org");
    expect(r.source).toBe("env");
  });

  test("config wins over fleet when no flag/env", async () => {
    const r = await resolveOrg(
      { config: "Config-Org" },
      { loadFleetFn: () => fleet },
    );
    expect(r.org).toBe("Config-Org");
    expect(r.source).toBe("config");
  });

  test("fleet (FTS) wins over gh + default when populated", async () => {
    const r = await resolveOrg(
      {},
      { loadFleetFn: () => fleet, execFn: async () => "gh-user\n" },
    );
    expect(r.org).toBe("Fleet-Org");
    expect(r.source).toBe("fleet");
    expect(r.detail).toContain("most recent: x");
  });

  test("gh (vector) wins over default on empty fleet", async () => {
    const r = await resolveOrg(
      {},
      { loadFleetFn: () => [], execFn: async () => "nazt\n" },
    );
    expect(r.org).toBe("nazt");
    expect(r.source).toBe("gh");
  });

  test("default fallback when both fleet empty AND gh fails", async () => {
    const r = await resolveOrg(
      {},
      {
        loadFleetFn: () => [],
        execFn: async () => { throw new Error("gh: not authed"); },
      },
    );
    expect(r.org).toBe("Soul-Brews-Studio");
    expect(r.source).toBe("default");
  });
});

describe("formatOrgSource — echo line label", () => {
  test("flag → '--org flag'", () => {
    expect(formatOrgSource({ org: "X", source: "flag" })).toBe("--org flag");
  });

  test("fleet with detail → 'fleet (most recent: foo, 2026-05-01)'", () => {
    expect(formatOrgSource({ org: "X", source: "fleet", detail: "most recent: foo, 2026-05-01" }))
      .toBe("fleet (most recent: foo, 2026-05-01)");
  });

  test("gh with detail → 'gh user (cold start — no fleet entries)'", () => {
    expect(formatOrgSource({ org: "X", source: "gh", detail: "cold start — no fleet entries" }))
      .toBe("gh user (cold start — no fleet entries)");
  });

  test("default → 'hardcoded default (Soul-Brews-Studio)'", () => {
    expect(formatOrgSource({ org: "Soul-Brews-Studio", source: "default" }))
      .toBe("hardcoded default (Soul-Brews-Studio)");
  });
});
