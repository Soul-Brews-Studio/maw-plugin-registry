import { describe, it, expect } from "bun:test";
import { dirNameToWindowName } from "./stillborn-worktrees";

describe("dirNameToWindowName (#19)", () => {
  it("maps oracle worktree dir to expected window", () => {
    expect(dirNameToWindowName("discord-oracle.wt-1-awaken")).toBe("discord-awaken");
  });

  it("strips numeric prefix from wt name", () => {
    expect(dirNameToWindowName("neo-oracle.wt-3-feature-foo")).toBe("neo-feature-foo");
  });

  it("strips -oracle suffix from stem", () => {
    expect(dirNameToWindowName("hermes-oracle.wt-2-bitkub")).toBe("hermes-bitkub");
  });

  it("non-oracle stem passes through", () => {
    expect(dirNameToWindowName("myrepo.wt-1-task")).toBe("myrepo-task");
  });

  it("multi-part wt name preserved", () => {
    expect(dirNameToWindowName("mother-oracle.wt-5-awaken-thor")).toBe("mother-awaken-thor");
  });

  it("multi-digit wt index", () => {
    expect(dirNameToWindowName("neo-oracle.wt-15-mawui")).toBe("neo-mawui");
  });

  it("non-worktree dir name returns as-is", () => {
    expect(dirNameToWindowName("not-a-worktree")).toBe("not-a-worktree");
  });
});
