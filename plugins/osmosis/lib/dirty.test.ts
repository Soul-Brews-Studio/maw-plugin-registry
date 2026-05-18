import { describe, expect, test } from "bun:test";
import { compareDirty, dirtyInspectionErrors, parseGitStatusShort, renderDirtyReports, summarizeDirty } from "./dirty";

describe("osmosis dirty check", () => {
  test("parses git status --short into comparable entries", () => {
    expect(parseGitStatusShort(" M CLAUDE.md\n?? ψ/inbox/new.md\nD  old.txt\nR  a.txt -> b.txt\n")).toEqual([
      { path: "CLAUDE.md", kind: "mod", raw: " M CLAUDE.md" },
      { path: "ψ/inbox/new.md", kind: "new", raw: "?? ψ/inbox/new.md" },
      { path: "old.txt", kind: "del", raw: "D  old.txt" },
      { path: "b.txt", kind: "ren", raw: "R  a.txt -> b.txt" },
    ]);
  });

  test("compares local-only, remote-only, and both-dirty paths", () => {
    const rows = compareDirty(
      parseGitStatusShort(" M CLAUDE.md\n?? local.md\n"),
      parseGitStatusShort(" M CLAUDE.md\n?? remote.md\n"),
    );

    expect(rows).toEqual([
      expect.objectContaining({ path: "CLAUDE.md", category: "conflict" }),
      expect.objectContaining({ path: "local.md", category: "push" }),
      expect.objectContaining({ path: "remote.md", category: "pull" }),
    ]);
    expect(summarizeDirty([{ label: "repo", localPath: "", remotePath: "", rows }])).toEqual({ push: 1, pull: 1, conflict: 1 });
  });

  test("does not treat an absent remote repo as a failed inspection", () => {
    expect(dirtyInspectionErrors([
      { label: "new-repo", localPath: "/l", remotePath: "/r", rows: [], remoteError: "remote repo absent" },
      { label: "bad", localPath: "/l", remotePath: "/r", rows: [], remoteError: "ssh failed" },
    ])).toEqual(["bad remote: ssh failed"]);
  });

  test("renders the two-column dirty table and conflict summary", () => {
    const logs: string[] = [];
    const original = console.log;
    console.log = (line = "") => logs.push(String(line));
    try {
      const rows = compareDirty(
        parseGitStatusShort(" M CLAUDE.md\n?? local.md\n"),
        parseGitStatusShort(" M CLAUDE.md\n?? remote.md\n"),
      );
      renderDirtyReports([{ label: "homelab", localPath: "/l", remotePath: "/r", rows }], "white.local", false);
    } finally {
      console.log = original;
    }

    const output = logs.join("\n");
    expect(output).toContain("LOCAL (m5)");
    expect(output).toContain("REMOTE (white.local)");
    expect(output).toContain("CONFLICT");
    expect(output).toContain("summary: 1 to push, 1 to pull, 1 conflict");
  });
});
