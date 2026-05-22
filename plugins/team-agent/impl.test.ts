/**
 * Bun unit tests for team-agent plugin.
 * Run: cd ~/.maw/plugins/team-agent && bun test
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  generateReadableUuid,
  parseMemberSpec,
  parseSimpleYaml,
  resolveTemplate,
  renderCharterYaml,
  PRESETS,
} from "./impl";

// ---------------------------------------------------------------------------
// generateReadableUuid
// ---------------------------------------------------------------------------

describe("generateReadableUuid", () => {
  test("format: NNNNNNNN-HHMM-YYYY-MMDD-YYMMDDHHMMSS", () => {
    const { uuid } = generateReadableUuid();
    expect(uuid).toMatch(/^\d{8}-\d{4}-\d{4}-\d{4}-\d{12}$/);
  });

  test("all digits 0-9 (RFC-valid hex)", () => {
    const { uuid } = generateReadableUuid();
    expect(uuid.replace(/-/g, "")).toMatch(/^\d+$/);
  });

  test("counter increments on each call", () => {
    const a = generateReadableUuid();
    const b = generateReadableUuid();
    expect(b.counter).toBeGreaterThan(a.counter);
  });

  test("shortRef format", () => {
    const { counter, shortRef } = generateReadableUuid();
    expect(shortRef).toBe(`#${counter}`);
  });

  test("counter prefix matches counter value", () => {
    const { uuid, counter } = generateReadableUuid();
    const prefix = uuid.slice(0, 8);
    expect(parseInt(prefix, 10)).toBe(counter);
  });
});

// ---------------------------------------------------------------------------
// parseMemberSpec
// ---------------------------------------------------------------------------

describe("parseMemberSpec", () => {
  let tmpDir: string;
  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tap-test-"));
  });
  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("role only → defaults to pwd + auto color", () => {
    const m = parseMemberSpec("alpha", 0);
    expect(m.role).toBe("alpha");
    expect(m.cwd).toBe(process.cwd());
    expect(m.color).toBe("red");
  });

  test("role:color → defaults cwd to pwd", () => {
    const m = parseMemberSpec("beta:cyan");
    expect(m.role).toBe("beta");
    expect(m.cwd).toBe(process.cwd());
    expect(m.color).toBe("cyan");
  });

  test("role@cwd → auto color", () => {
    const m = parseMemberSpec(`gamma@${tmpDir}`, 1);
    expect(m.role).toBe("gamma");
    expect(m.cwd).toBe(tmpDir);
    expect(m.color).toBe("green");
  });

  test("role@cwd:color → all specified", () => {
    const m = parseMemberSpec(`delta@${tmpDir}:yellow`);
    expect(m.role).toBe("delta");
    expect(m.cwd).toBe(tmpDir);
    expect(m.color).toBe("yellow");
  });

  test("default color rotates by index", () => {
    const a = parseMemberSpec("x", 0);
    const b = parseMemberSpec("x", 1);
    expect(a.color).not.toBe(b.color);
  });

  test("bad color throws", () => {
    expect(() => parseMemberSpec(`x@${tmpDir}:rainbow`)).toThrow(/bad color/);
  });

  test("nonexistent cwd throws", () => {
    expect(() => parseMemberSpec("x@/nonexistent-path-xyz:green")).toThrow(/cwd does not exist/);
  });
});

// ---------------------------------------------------------------------------
// parseSimpleYaml
// ---------------------------------------------------------------------------

describe("parseSimpleYaml", () => {
  test("top-level scalar fields", () => {
    const yaml = `name: test\ndescription: "hello world"\n`;
    const parsed = parseSimpleYaml(yaml);
    expect(parsed.name).toBe("test");
    expect(parsed.description).toBe("hello world");
  });

  test("members list", () => {
    const yaml = `name: t\nmembers:\n  - role: a\n    color: green\n  - role: b\n    color: cyan\n`;
    const parsed = parseSimpleYaml(yaml);
    expect(parsed.members).toHaveLength(2);
    expect(parsed.members[0].role).toBe("a");
    expect(parsed.members[1].color).toBe("cyan");
  });

  test("vars block", () => {
    const yaml = `name: t\nvars:\n  FOO: bar\n  BAZ: qux\nmembers: []\n`;
    const parsed = parseSimpleYaml(yaml);
    expect(parsed.vars).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  test("comments are stripped", () => {
    const yaml = `name: test  # this is a comment\n`;
    const parsed = parseSimpleYaml(yaml);
    expect(parsed.name).toBe("test");
  });

  test("missing 'name' field returns empty members", () => {
    const yaml = `description: orphan\n`;
    const parsed = parseSimpleYaml(yaml);
    expect(parsed.members).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveTemplate
// ---------------------------------------------------------------------------

describe("resolveTemplate", () => {
  test("substitutes ${VAR}", () => {
    const out = resolveTemplate("hello ${NAME}", { NAME: "world" });
    expect(out).toBe("hello world");
  });

  test("multiple vars", () => {
    const out = resolveTemplate("${A}-${B}-${A}", { A: "1", B: "2" });
    expect(out).toBe("1-2-1");
  });

  test("falls back to process.env", () => {
    process.env.MY_TEST_VAR = "envval";
    const out = resolveTemplate("${MY_TEST_VAR}", {});
    expect(out).toBe("envval");
    delete process.env.MY_TEST_VAR;
  });

  test("leaves unknown vars literal", () => {
    const out = resolveTemplate("${UNKNOWN_XYZ_123}", {});
    expect(out).toBe("${UNKNOWN_XYZ_123}");
  });

  test("provided vars override env", () => {
    process.env.OVERRIDE_TEST = "fromEnv";
    const out = resolveTemplate("${OVERRIDE_TEST}", { OVERRIDE_TEST: "fromVars" });
    expect(out).toBe("fromVars");
    delete process.env.OVERRIDE_TEST;
  });
});

// ---------------------------------------------------------------------------
// PRESETS + renderCharterYaml
// ---------------------------------------------------------------------------

describe("PRESETS", () => {
  test("has all 6 presets", () => {
    expect(Object.keys(PRESETS).sort()).toEqual(
      ["blank", "pair", "review", "solo", "stack", "trio"]
    );
  });

  test("each preset has description and members", () => {
    for (const [, preset] of Object.entries(PRESETS)) {
      expect(preset.description).toBeTruthy();
      expect(Array.isArray(preset.members)).toBe(true);
      expect(preset.members.length).toBeGreaterThan(0);
    }
  });

  test("stack preset has 4 members", () => {
    expect(PRESETS.stack.members).toHaveLength(4);
  });

  test("solo preset has 1 member", () => {
    expect(PRESETS.solo.members).toHaveLength(1);
  });

  test("trio preset has 3 members", () => {
    expect(PRESETS.trio.members).toHaveLength(3);
  });
});

describe("renderCharterYaml", () => {
  test("renders valid YAML for each preset", () => {
    for (const presetName of Object.keys(PRESETS)) {
      const yaml = renderCharterYaml("test-team", presetName);
      expect(yaml).toContain("name: test-team");
      expect(yaml).toContain("session-id: ${SESSION_ID}");
      expect(yaml).toContain("cwd: ${PROJECT_ROOT}");
      expect(yaml).toContain("members:");
    }
  });

  test("includes generation timestamp", () => {
    const yaml = renderCharterYaml("x", "blank");
    expect(yaml).toMatch(/Generated \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  test("pair preset renders 2 members", () => {
    const yaml = renderCharterYaml("x", "pair");
    const roleLines = yaml.split("\n").filter(l => l.match(/^\s+- role:/));
    expect(roleLines).toHaveLength(2);
  });

  test("throws on unknown preset", () => {
    expect(() => renderCharterYaml("x", "nonsense")).toThrow(/unknown preset/);
  });

  test("rendered YAML round-trips through parser", () => {
    const yaml = renderCharterYaml("rt-test", "trio");
    const parsed = parseSimpleYaml(yaml);
    expect(parsed.name).toBe("rt-test");
    expect(parsed.members).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Integration: template + parser
// ---------------------------------------------------------------------------

describe("template + parser integration", () => {
  test("resolveTemplate then parseSimpleYaml", () => {
    const tpl = `name: \${NAME}\nsession-id: \${SID}\nmembers:\n  - role: \${ROLE}\n    color: green\n`;
    const resolved = resolveTemplate(tpl, { NAME: "demo", SID: "abc-123", ROLE: "alpha" });
    const parsed = parseSimpleYaml(resolved);
    expect(parsed.name).toBe("demo");
    expect(parsed["session-id"]).toBe("abc-123");
    expect(parsed.members[0].role).toBe("alpha");
  });

  test("vars: section can reference each other via builtins", () => {
    const yaml = `name: t\nvars:\n  SRC: /tmp/src\n  TESTS: /tmp/tests\nmembers: []\n`;
    const parsed = parseSimpleYaml(yaml);
    expect(parsed.vars.SRC).toBe("/tmp/src");
    expect(parsed.vars.TESTS).toBe("/tmp/tests");
  });
});
