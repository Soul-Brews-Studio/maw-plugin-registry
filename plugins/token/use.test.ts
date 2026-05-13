/**
 * use.ts — atomic .envrc rewrite tests.
 *
 * `buildEnvrcContent` is pure (no filesystem, no subprocess) — exercise
 * it directly to lock in the cleanup rules: strip old token-related
 * lines in 4+ formats, preserve everything else, trim trailing blanks,
 * append new export block.
 */

import { describe, expect, it } from "bun:test";
import { buildEnvrcContent } from "./use";

describe("buildEnvrcContent", () => {
  it("creates a fresh .envrc when none existed", () => {
    const out = buildEnvrcContent("", "foo", false);
    expect(out).toContain('export CLAUDE_TOKEN_NAME="foo"');
    expect(out).toContain(
      'export CLAUDE_CODE_OAUTH_TOKEN="$(pass show claude/token-foo)"',
    );
    expect(out).toContain("export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1");
  });

  it("--no-team omits the EXPERIMENTAL_AGENT_TEAMS line", () => {
    const out = buildEnvrcContent("", "foo", true);
    expect(out).not.toContain("EXPERIMENTAL_AGENT_TEAMS");
  });

  it("strips old export CLAUDE_TOKEN_NAME lines", () => {
    const existing = [
      'export CLAUDE_TOKEN_NAME="old"',
      'export CLAUDE_CODE_OAUTH_TOKEN="$(pass show claude/token-old)"',
      'export OTHER=keepme',
    ].join("\n") + "\n";

    const out = buildEnvrcContent(existing, "new", false);
    expect(out).toContain('export OTHER=keepme');
    expect(out).toContain('export CLAUDE_TOKEN_NAME="new"');
    // Old "old" name should not appear anywhere.
    expect(out).not.toMatch(/CLAUDE_TOKEN_NAME="old"/);
    expect(out).not.toMatch(/token-old\)/);
  });

  it("strips bare (no `export`) CLAUDE_CODE_OAUTH_TOKEN assignments", () => {
    const existing = 'CLAUDE_CODE_OAUTH_TOKEN=stale\nKEEPME=yes\n';
    const out = buildEnvrcContent(existing, "x", true);
    expect(out).toContain("KEEPME=yes");
    expect(out).not.toContain("=stale");
  });

  it("strips legacy TOKEN_PYM/DO/TING_TING var-ref lines", () => {
    const existing = [
      'TOKEN_PYM="$(pass show claude/token-pym)"',
      'export TOKEN_DO="$(pass show claude/token-do)"',
      'TOKEN_TING_TING="$(pass show claude/token-ting)"',
      'OTHER=preserved',
    ].join("\n") + "\n";
    const out = buildEnvrcContent(existing, "new", true);
    expect(out).not.toContain("TOKEN_PYM");
    expect(out).not.toContain("TOKEN_DO");
    expect(out).not.toContain("TOKEN_TING_TING");
    expect(out).toContain("OTHER=preserved");
  });

  it("preserves comments and non-token exports", () => {
    const existing = [
      "# my project envrc",
      'export PROJECT="alpha"',
      'export CLAUDE_TOKEN_NAME="old"',
      "",
    ].join("\n");
    const out = buildEnvrcContent(existing, "new", true);
    expect(out).toContain("# my project envrc");
    expect(out).toContain('export PROJECT="alpha"');
    expect(out).toContain('export CLAUDE_TOKEN_NAME="new"');
  });

  it("trims trailing blank lines before appending token block", () => {
    const existing = "KEEPME=1\n\n\n\n";
    const out = buildEnvrcContent(existing, "n", true);
    // Should not produce 4 blank lines in a row.
    expect(out).not.toMatch(/\n\n\n\n/);
  });

  it("never includes a token VALUE — only `pass show` indirection", () => {
    // Even if the caller passes a name that looks like a secret, the
    // output references it via `pass show`, never inlines a value.
    const out = buildEnvrcContent("", "abcd1234efgh5678", false);
    // The "value" we're worried about is a hypothetical secret like
    // sk-ant-...; our function only writes pass-show subshells, not
    // literal token text.
    expect(out).not.toMatch(/CLAUDE_CODE_OAUTH_TOKEN="sk-/);
    expect(out).not.toMatch(/CLAUDE_CODE_OAUTH_TOKEN="[A-Za-z0-9]{30,}"/);
  });
});
