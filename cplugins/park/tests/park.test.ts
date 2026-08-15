/**
 * Tests for maw-park — pure-function logic at the extraction.
 *
 * Tmux + git side-effects are not exercised here (covered by integration
 * downstream). We test:
 *   - resolvePark: argv → (target, note) classification
 *   - timeAgo: parkedAt formatting
 *   - command metadata export
 */

import { describe, test, expect } from "bun:test";
import { command } from "../src/index";
import { resolvePark, timeAgo } from "../src/impl";

describe("maw park — metadata", () => {
  test("exports command with name + description", () => {
    expect(command.name).toBe("park");
    expect(command.description.toLowerCase()).toContain("park");
  });
});

describe("resolvePark — argv classification", () => {
  test("no args → target = current, no note", () => {
    expect(resolvePark([], "currentwin", ["currentwin", "other"])).toEqual({
      target: "currentwin",
      note: undefined,
    });
  });

  test("single arg matching a non-current window → that's the target, no note", () => {
    expect(resolvePark(["other"], "currentwin", ["currentwin", "other"])).toEqual({
      target: "other",
      note: undefined,
    });
  });

  test("single arg NOT matching a window → target = current, note = arg", () => {
    expect(resolvePark(["a quick fix"], "currentwin", ["currentwin", "other"])).toEqual({
      target: "currentwin",
      note: "a quick fix",
    });
  });

  test("first arg matches window + extra args → target = match, note = rest joined", () => {
    expect(resolvePark(["other", "fix", "the", "thing"], "currentwin", ["currentwin", "other"])).toEqual({
      target: "other",
      note: "fix the thing",
    });
  });

  test("first arg matches CURRENT window name → treated as note (current is implicit)", () => {
    // Avoids the user typing the current window's name and having it silently
    // become the target — explicit-only routing for non-current windows.
    expect(resolvePark(["currentwin", "note text"], "currentwin", ["currentwin", "other"])).toEqual({
      target: "currentwin",
      note: "currentwin note text",
    });
  });

  test("multi-word note when no first-arg window match", () => {
    expect(resolvePark(["paying", "rent"], "currentwin", ["currentwin"])).toEqual({
      target: "currentwin",
      note: "paying rent",
    });
  });
});

describe("timeAgo — relative duration formatting", () => {
  const now = Date.parse("2026-04-29T12:00:00Z");

  test("under 60 minutes → '<m>m ago'", () => {
    const iso = new Date(now - 5 * 60_000).toISOString();
    expect(timeAgo(iso, now)).toBe("5m ago");
  });

  test("just-now (under one minute) → '0m ago'", () => {
    const iso = new Date(now - 30_000).toISOString();
    expect(timeAgo(iso, now)).toBe("0m ago");
  });

  test("under 24 hours → '<h>h ago'", () => {
    const iso = new Date(now - 3 * 60 * 60_000).toISOString();
    expect(timeAgo(iso, now)).toBe("3h ago");
  });

  test("24h+ → '<d>d ago'", () => {
    const iso = new Date(now - 2 * 24 * 60 * 60_000).toISOString();
    expect(timeAgo(iso, now)).toBe("2d ago");
  });

  test("boundary: exactly 60 minutes → '1h ago'", () => {
    const iso = new Date(now - 60 * 60_000).toISOString();
    expect(timeAgo(iso, now)).toBe("1h ago");
  });

  test("boundary: exactly 24 hours → '1d ago'", () => {
    const iso = new Date(now - 24 * 60 * 60_000).toISOString();
    expect(timeAgo(iso, now)).toBe("1d ago");
  });
});
