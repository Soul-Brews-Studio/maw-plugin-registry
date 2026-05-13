/**
 * lib.ts — unit tests for the helpers most likely to leak.
 *
 * Coverage focus:
 *   - detectActiveToken handles all 3 historical formats
 *   - stripAnsi removes the codes that `pass ls` emits
 *   - defaultName falls back to cwd basename
 *   - redact replaces every occurrence and refuses to redact short
 *     strings (refusal is critical: a 3-char "secret" would otherwise
 *     mass-replace `the` everywhere)
 */

import { describe, expect, it } from "bun:test";
import {
  defaultName,
  detectActiveToken,
  redact,
  stripAnsi,
} from "./lib";

describe("detectActiveToken", () => {
  it("matches new format CLAUDE_TOKEN_NAME", () => {
    expect(detectActiveToken('export CLAUDE_TOKEN_NAME="foo"\n')).toBe("foo");
  });

  it("matches direct pass-show format", () => {
    const c = 'export CLAUDE_CODE_OAUTH_TOKEN="$(pass show claude/token-bar)"\n';
    expect(detectActiveToken(c)).toBe("bar");
  });

  it("matches legacy var-ref format (TOKEN_FOO → pass show)", () => {
    const c = [
      'TOKEN_FOO="$(pass show claude/token-baz)"',
      "export CLAUDE_CODE_OAUTH_TOKEN=$TOKEN_FOO",
    ].join("\n");
    expect(detectActiveToken(c)).toBe("baz");
  });

  it("returns null when no format matches", () => {
    expect(detectActiveToken("export FOO=bar\n")).toBeNull();
    expect(detectActiveToken("")).toBeNull();
  });

  it("skips commented lines", () => {
    const c = '# export CLAUDE_TOKEN_NAME="ignored"\nexport CLAUDE_TOKEN_NAME="kept"\n';
    expect(detectActiveToken(c)).toBe("kept");
  });

  it("new format wins over direct when both present", () => {
    const c = [
      'export CLAUDE_TOKEN_NAME="winner"',
      'export CLAUDE_CODE_OAUTH_TOKEN="$(pass show claude/token-loser)"',
    ].join("\n");
    expect(detectActiveToken(c)).toBe("winner");
  });

  it("handles names with dashes, dots, underscores", () => {
    expect(
      detectActiveToken('export CLAUDE_TOKEN_NAME="my-token_v2.0"\n'),
    ).toBe("my-token_v2.0");
  });
});

describe("stripAnsi", () => {
  it("removes color codes from pass ls output", () => {
    const colored = "\x1b[01;34mclaude\x1b[0m";
    expect(stripAnsi(colored)).toBe("claude");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("plain")).toBe("plain");
  });
});

describe("defaultName", () => {
  it("returns provided name when truthy", () => {
    expect(defaultName("explicit", "/some/path")).toBe("explicit");
  });

  it("falls back to cwd basename when name is empty", () => {
    expect(defaultName(undefined, "/home/nat/code/myrepo")).toBe("myrepo");
    expect(defaultName("", "/home/nat/code/myrepo")).toBe("myrepo");
  });

  it("handles trailing slash", () => {
    expect(defaultName(undefined, "/home/nat/code/myrepo/")).toBe("myrepo");
  });
});

describe("redact", () => {
  it("replaces every occurrence of a secret", () => {
    // Placeholder fingerprint — NOT a real token.
    const secret = "abcd1234efgh5678";
    const input = `token=${secret} and also ${secret} again`;
    expect(redact(input, secret)).toBe(
      "token=***REDACTED*** and also ***REDACTED*** again",
    );
  });

  it("refuses to redact strings shorter than 4 chars", () => {
    // A short "secret" of 3 chars would otherwise mass-replace.
    const input = "the quick brown fox the the";
    expect(redact(input, "the")).toBe(input);
  });

  it("handles regex metacharacters in the secret safely", () => {
    // A literal "." in the secret must not be treated as regex wildcard.
    const secret = "abc.def.ghi.jkl";
    const input = `value=${secret}`;
    expect(redact(input, secret)).toBe("value=***REDACTED***");
    // Confirm it did NOT also redact "abcXdefXghiXjkl" (regex would).
    const negative = "abcXdefXghiXjkl";
    expect(redact(negative, secret)).toBe(negative);
  });

  it("redacts multiple secrets in one call", () => {
    const s1 = "secretone1";
    const s2 = "secrettwo2";
    expect(redact(`${s1} ${s2}`, s1, s2)).toBe("***REDACTED*** ***REDACTED***");
  });

  it("no-ops on empty secret", () => {
    expect(redact("untouched", "")).toBe("untouched");
  });
});
