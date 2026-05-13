import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  extractTitle,
  extractSection,
  extractDetail,
  extractRepo,
  isNoise,
  daysFromFile,
  shareKeywords,
  deduplicateItems,
} from "./impl";

const NOW = new Date("2026-05-13T12:00:00.000Z").getTime();
const origDateNow = Date.now;
beforeAll(() => { Date.now = () => NOW; });
afterAll(() => { Date.now = origDateNow; });

describe("extractTitle", () => {
  it("extracts h1 heading", () => {
    expect(extractTitle("# Session Summary: Docker Fix\n\nDetails", "file.md")).toBe("Session Summary: Docker Fix");
  });

  it("extracts summary line", () => {
    expect(extractTitle("---\ntags: [x]\n---\nSummary: Fixed the auth module completely\nMore text", "file.md"))
      .toBe("Fixed the auth module completely");
  });

  it("falls back to filename when no heading", () => {
    const result = extractTitle("tags: [a, b]\ncreated: 2026-01-01", "../repo/ψ/memory/learnings/2026-05-01_docker-subnet-fix.md");
    expect(result).toContain("docker subnet fix");
  });

  it("ignores h1 lines starting with ---", () => {
    expect(extractTitle("# ---\nContent here", "ψ/file.md")).toBe("");
  });

  it("ignores short h1 headings and falls back to filename", () => {
    const result = extractTitle("# Hi\nContent", "../ghq/github.com/deachawatss/repo/ψ/memory/learnings/2026-05-01_real-title-here.md");
    expect(result).toContain("real title here");
  });

  it("truncates to 100 chars", () => {
    const long = "# " + "A".repeat(200);
    expect(extractTitle(long, "file.md").length).toBeLessThanOrEqual(100);
  });
});

describe("extractSection", () => {
  it("finds section and captures lines", () => {
    const content = "## Next Steps\n- item 1\n- item 2\n## Other";
    const result = extractSection(content, "Next Steps");
    expect(result).toContain("item 1");
    expect(result).toContain("item 2");
  });

  it("extracts inline value after colon", () => {
    const content = "Next Steps: Deploy to production and monitor\n## Other";
    expect(extractSection(content, "Next Steps")).toContain("Deploy to production");
  });

  it("returns null when heading not found", () => {
    expect(extractSection("## Something Else\ncontent", "Next Steps")).toBeNull();
  });

  it("breaks on next heading", () => {
    const content = "## Summary\nLine 1\nLine 2\n## Details\nLine 3";
    const result = extractSection(content, "Summary");
    expect(result).toContain("Line 1");
    expect(result).not.toContain("Line 3");
  });

  it("captures up to 5 lines", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`);
    const content = `## Summary\n${lines.join("\n")}`;
    const result = extractSection(content, "Summary")!;
    expect(result).toContain("Line 5");
    expect(result).not.toContain("Line 6");
  });
});

describe("extractDetail", () => {
  it("prefers Summary section", () => {
    const content = "## Summary\nThis is the summary\n## What Happened\nSomething else";
    expect(extractDetail(content)).toContain("This is the summary");
  });

  it("falls back to What Happened", () => {
    const content = "## What Happened\nThe server crashed during deploy";
    expect(extractDetail(content)).toContain("server crashed");
  });

  it("falls back to first meaningful line", () => {
    const content = "---\ntags: [x]\n---\nThe database migration failed silently and corrupted 3 tables";
    expect(extractDetail(content)).toContain("database migration");
  });
});

describe("extractRepo", () => {
  it("finds repo before ψ marker", () => {
    expect(extractRepo("../ghq/github.com/deachawatss/BME-Putaway/ψ/memory/retros/file.md")).toBe("BME-Putaway");
  });

  it("strips -oracle suffix", () => {
    expect(extractRepo("../ghq/github.com/deachawatss/gale-oracle/ψ/memory/file.md")).toBe("gale");
  });

  it("handles worktree paths", () => {
    expect(extractRepo("../ghq/github.com/deachawatss/leaf-oracle/.claude/worktrees/agent-abc123/ψ/memory/file.md")).toBe("leaf");
  });

  it("returns unknown when no ψ marker", () => {
    expect(extractRepo("/some/random/path/file.md")).toBe("unknown");
  });
});

describe("isNoise", () => {
  it("filters trading keywords", () => {
    expect(isNoise("TRADE CLOSE: SELL ETH/USDT @ 2,124")).toBe(true);
    expect(isNoise("BTC position opened")).toBe(true);
    expect(isNoise("buy signal triggered")).toBe(true);
  });

  it("passes normal project titles", () => {
    expect(isNoise("Docker subnet exhaustion fix")).toBe(false);
    expect(isNoise("BME-Putaway deadlock hardening")).toBe(false);
  });
});

describe("daysFromFile", () => {
  it("calculates days from YYYY-MM-DD in path", () => {
    expect(daysFromFile("ψ/memory/retrospectives/2026-05-13/file.md")).toBe(0);
    expect(daysFromFile("ψ/memory/retrospectives/2026-05-06/file.md")).toBe(7);
  });

  it("calculates days from YYYY/MM/DD path", () => {
    expect(daysFromFile("ψ/memory/retrospectives/2026/05/13/file.md")).toBe(0);
  });

  it("returns 999 when no date in path", () => {
    expect(daysFromFile("ψ/memory/learnings/random-file.md")).toBe(999);
  });
});

describe("shareKeywords", () => {
  it("detects shared keywords above threshold", () => {
    expect(shareKeywords("docker subnet exhaustion fix", "docker network subnet pool", 2)).toBe(true);
  });

  it("returns false below threshold", () => {
    expect(shareKeywords("docker fix", "auth module redesign", 2)).toBe(false);
  });

  it("ignores stop words", () => {
    expect(shareKeywords("the session was learned from", "this session learning done", 2)).toBe(false);
  });

  it("ignores words 3 chars or less", () => {
    expect(shareKeywords("the fix for bug", "a fix for issue", 2)).toBe(false);
  });
});

describe("deduplicateItems", () => {
  const makeItem = (cat: string, project: string, title: string) => ({
    category: cat as any,
    title,
    detail: "",
    source: "",
    project,
    confidence: "high" as const,
    daysAgo: 0,
  });

  it("removes duplicates by category:project:title", () => {
    const items = [
      makeItem("pain", "BME", "uncommitted changes"),
      makeItem("pain", "BME", "uncommitted changes"),
      makeItem("pain", "FG", "uncommitted changes"),
    ];
    expect(deduplicateItems(items)).toHaveLength(2);
  });

  it("keeps first occurrence", () => {
    const items = [
      makeItem("pain", "BME", "first version"),
      makeItem("pain", "BME", "first version — different suffix but same prefix"),
    ];
    const result = deduplicateItems(items);
    expect(result[0]!.title).toBe("first version");
  });

  it("handles empty array", () => {
    expect(deduplicateItems([])).toHaveLength(0);
  });
});
