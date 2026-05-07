import { describe, it, expect, mock } from "bun:test";
import { join } from "path";
import type { InvokeContext } from "maw-js/plugin/types";
import {
  resolveSleepTarget,
  type ResolveDeps,
  type SessionLike,
  type FleetLike,
} from "./resolve-target";

// Mock the actual ./impl resolution path the handler uses (#18 fix).
mock.module(join(import.meta.dir, "impl"), () => ({
  cmdSleepOne: async (oracle: string, window?: string) => {
    console.log(`sleep ${oracle}${window ? ` window=${window}` : ""}`);
  },
}));

const { default: handler } = await import("./index");

// ─────────────────────────────────────────────────────────────────────
// resolveSleepTarget — Tier 1-2-3 resolver tests (#1182)
// ─────────────────────────────────────────────────────────────────────

function makeDeps(opts: {
  sessions?: SessionLike[];
  fleet?: FleetLike[];
  detect?: (oracle: string) => string | null;
}): ResolveDeps {
  return {
    listSessions: async () => opts.sessions ?? [],
    loadFleet: () => opts.fleet ?? [],
    detectSession: async (oracle: string) =>
      opts.detect ? opts.detect(oracle) : null,
  };
}

describe("resolveSleepTarget — Tier 1: window-name match across sessions", () => {
  it("matches a worktree window invisible to fleet", async () => {
    const deps = makeDeps({
      sessions: [
        {
          name: "24-discord-oracle",
          windows: [
            { name: "discord-oracle" },
            { name: "discord-awaken" }, // worktree window, NOT in fleet
          ],
        },
      ],
      fleet: [
        {
          name: "24-discord-oracle",
          windows: [{ name: "discord-oracle" }],
        },
      ],
    });

    const result = await resolveSleepTarget("discord-awaken", undefined, deps);
    expect(result).toEqual({ session: "24-discord-oracle", window: "discord-awaken" });
  });

  it("case-insensitive match", async () => {
    const deps = makeDeps({
      sessions: [{ name: "01-neo", windows: [{ name: "neo-oracle" }] }],
    });
    const result = await resolveSleepTarget("Neo-Oracle", undefined, deps);
    expect(result?.window).toBe("neo-oracle");
  });

  it("trailing-dash normalized (#206 inheritance)", async () => {
    const deps = makeDeps({
      sessions: [
        { name: "10-fireman", windows: [{ name: "fireman-1w-test-" }] },
      ],
    });
    const result = await resolveSleepTarget("fireman-1w-test", undefined, deps);
    expect(result?.window).toBe("fireman-1w-test-");
  });
});

describe("resolveSleepTarget — Tier 2: session-name match → fleet primary", () => {
  it("slot-prefixed full session name → fleet primary", async () => {
    const deps = makeDeps({
      sessions: [
        {
          name: "29-arra-oracle-skills-cli",
          windows: [{ name: "arra-oracle-skills-cli-oracle" }],
        },
      ],
      fleet: [
        {
          name: "29-arra-oracle-skills-cli",
          windows: [{ name: "arra-oracle-skills-cli-oracle" }],
        },
      ],
    });
    const result = await resolveSleepTarget("29-arra-oracle-skills-cli", undefined, deps);
    expect(result).toEqual({
      session: "29-arra-oracle-skills-cli",
      window: "arra-oracle-skills-cli-oracle",
    });
  });

  it("Pattern B: stem-already-has-`-oracle` (24-discord-oracle)", async () => {
    const deps = makeDeps({
      sessions: [
        {
          name: "24-discord-oracle",
          windows: [{ name: "discord-oracle" }, { name: "discord-awaken" }],
        },
      ],
      fleet: [
        {
          name: "24-discord-oracle",
          windows: [{ name: "discord-oracle" }],
        },
      ],
    });
    // CAUTION: bare "discord-oracle" hits Tier 1 first (window match).
    // Slot-prefixed input correctly hits Tier 2 → fleet primary "discord-oracle".
    const result = await resolveSleepTarget("24-discord-oracle", undefined, deps);
    expect(result).toEqual({ session: "24-discord-oracle", window: "discord-oracle" });
  });

  it("session ends with -<target> → fleet primary", async () => {
    const deps = makeDeps({
      sessions: [
        { name: "22-metis", windows: [{ name: "metis-oracle" }] },
      ],
      fleet: [
        { name: "22-metis", windows: [{ name: "metis-oracle" }] },
      ],
    });
    const result = await resolveSleepTarget("metis", undefined, deps);
    // "metis" hits no Tier 1 window. Tier 2 catches "22-metis" via -metis suffix.
    expect(result).toEqual({ session: "22-metis", window: "metis-oracle" });
  });
});

describe("resolveSleepTarget — Tier 3: detectSession fallback", () => {
  it("stem-only resolves via detectSession", async () => {
    const deps = makeDeps({
      sessions: [{ name: "01-neo", windows: [{ name: "neo-oracle" }] }],
      fleet: [{ name: "01-neo", windows: [{ name: "neo-oracle" }] }],
      detect: (o) => (o === "neo" ? "01-neo" : null),
    });
    // Bare "neo": no Tier 1 hit (no window named "neo").
    // Tier 2: "01-neo".endsWith("-neo") → true. So Tier 2 catches first.
    // Either Tier 2 or Tier 3 should reach the same result.
    const result = await resolveSleepTarget("neo", undefined, deps);
    expect(result).toEqual({ session: "01-neo", window: "neo-oracle" });
  });
});

describe("resolveSleepTarget — windowOverride", () => {
  it("windowOverride bypasses Tier 1 and is used as-is at Tier 2", async () => {
    const deps = makeDeps({
      sessions: [
        {
          name: "24-discord-oracle",
          windows: [{ name: "discord-oracle" }, { name: "discord-awaken" }],
        },
      ],
      fleet: [
        { name: "24-discord-oracle", windows: [{ name: "discord-oracle" }] },
      ],
    });
    const result = await resolveSleepTarget(
      "24-discord-oracle",
      "discord-awaken",
      deps,
    );
    expect(result).toEqual({ session: "24-discord-oracle", window: "discord-awaken" });
  });
});

describe("resolveSleepTarget — no match", () => {
  it("returns null when no resolver tier matches", async () => {
    const deps = makeDeps({
      sessions: [{ name: "01-neo", windows: [{ name: "neo-oracle" }] }],
    });
    const result = await resolveSleepTarget("nonexistent", undefined, deps);
    expect(result).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// handler integration tests (mocked cmdSleepOne)
// ─────────────────────────────────────────────────────────────────────

describe("sleep plugin handler", () => {
  it("CLI — valid oracle sleeps ok", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["neo"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("sleep neo");
  });

  it("CLI — oracle + window sleeps ok", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["neo", "skills"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("window=skills");
  });

  it("CLI — missing oracle returns error", async () => {
    const ctx: InvokeContext = { source: "cli", args: [] };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("usage");
  });

  it("CLI — --all-done stub returns ok", async () => {
    const ctx: InvokeContext = { source: "cli", args: ["--all-done"] };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Not yet implemented");
  });

  it("API — valid oracle sleeps ok", async () => {
    const ctx: InvokeContext = { source: "api", args: { oracle: "neo" } };
    const result = await handler(ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("sleep neo");
  });

  it("API — missing oracle returns error", async () => {
    const ctx: InvokeContext = { source: "api", args: {} };
    const result = await handler(ctx);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("oracle is required");
  });
});
