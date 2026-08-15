/**
 * Tests for relativeTime — the inbox WHEN column formatter.
 *
 * Regression for #1142: `new Date(0)` epoch-zero fallback in loadInboxMessages
 * produced "20578d ago" (~56 years) when frontmatter.timestamp was missing.
 * The fix makes relativeTime defensive against NaN, epoch-zero, future-dated,
 * and >30-day cases.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { relativeTime } from "./impl";

// Pin "now" so the relative outputs are deterministic.
const NOW = new Date("2026-05-05T08:00:00.000Z").getTime();
const origDateNow = Date.now;

beforeAll(() => { Date.now = () => NOW; });
afterAll(() => { Date.now = origDateNow; });

describe("relativeTime — defensive cases (#1142 regression)", () => {
  test("epoch zero → '—' (the bug from #1142)", () => {
    expect(relativeTime(new Date(0))).toBe("—");
  });

  test("NaN date → '—'", () => {
    expect(relativeTime(new Date("not-a-date"))).toBe("—");
  });

  test("future-dated (clock skew) → 'future'", () => {
    expect(relativeTime(new Date(NOW + 60_000))).toBe("future");
  });

  test("just-now (< 1 min) → 'just now'", () => {
    expect(relativeTime(new Date(NOW - 30_000))).toBe("just now");
  });

  test("minutes (< 60m) → 'Nm ago'", () => {
    expect(relativeTime(new Date(NOW - 5 * 60_000))).toBe("5m ago");
  });

  test("hours (< 24h) → 'Nh ago'", () => {
    expect(relativeTime(new Date(NOW - 3 * 60 * 60_000))).toBe("3h ago");
  });

  test("days (< 30d) → 'Nd ago'", () => {
    expect(relativeTime(new Date(NOW - 5 * 24 * 60 * 60_000))).toBe("5d ago");
  });

  test("≥ 30 days → absolute YYYY-MM-DD", () => {
    const d = new Date("2025-12-15T10:30:00.000Z");
    expect(relativeTime(d)).toBe("2025-12-15");
  });

  test("exactly 30 days → still relative is wrong; renders absolute", () => {
    const d = new Date(NOW - 30 * 24 * 60 * 60_000);
    // 30d → render absolute (per the contract; 365d cap was suggested in #1142
    // body but evaluators agreed 30d is more useful — older items get exact date)
    expect(relativeTime(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
