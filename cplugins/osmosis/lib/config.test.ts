import { describe, expect, test } from "bun:test";
import { parseArgs, parseHostTarget } from "./config";
import { UsageError } from "./types";

describe("osmosis host target parsing", () => {
  test("keeps plain hosts as the ssh target without a remote user", () => {
    expect(parseHostTarget("white.local")).toEqual({ host: "white.local", remoteUser: undefined });
  });

  test("accepts ssh-style user@host and exposes the user for remote ghq root selection", () => {
    expect(parseHostTarget("alpha@white.local")).toEqual({ host: "alpha@white.local", remoteUser: "alpha" });
  });

  test("--user is alternate spelling for user@host", () => {
    expect(parseHostTarget("white.local", "alpha")).toEqual({ host: "alpha@white.local", remoteUser: "alpha" });
  });

  test("rejects conflicting --user and user@host values", () => {
    expect(() => parseHostTarget("alpha@white.local", "beta")).toThrow(UsageError);
  });

  test("rejects shell-shaped ssh targets instead of passing arbitrary ssh strings", () => {
    expect(() => parseHostTarget("alpha@white.local -oProxyCommand=oops")).toThrow(UsageError);
    expect(() => parseHostTarget("alpha@white.local:/opt/alpha/Code")).toThrow(UsageError);
  });

  test("parseArgs stores the normalized ssh target and remote user", () => {
    const cfg = parseArgs(["--push", "alpha@white", "--repo", "odin-oracle"], "/tmp/no-derive");
    expect(cfg.host).toBe("alpha@white");
    expect(cfg.remoteUser).toBe("alpha");
    expect(cfg.repo).toBe("odin-oracle");
  });
});
