import { stat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { type Config, type Target } from "./types";
import { ghBase, resolveSource, encodeProjectPath } from "./paths";

export async function enumerateTargets(
  cfg: Config,
  localRoot: string,
  remoteRoot: string,
  remoteHome: string,
): Promise<{ targets: Target[]; warnings: string[] }> {
  const targets: Target[] = [];
  const warnings: string[] = [];
  const ghBaseLocal = ghBase(localRoot);
  const ghBaseRemote = ghBase(remoteRoot);
  const ownerDir = `${ghBaseLocal}/${cfg.owner}`;

  // 1. main repo
  const mainLocal = `${ghBaseLocal}/${cfg.owner}/${cfg.repo}`;
  const mainReal = await resolveSource(mainLocal, localRoot);
  if (mainReal) {
    targets.push({
      kind: "repo",
      label: cfg.repo,
      localPath: mainLocal,
      remotePath: `${ghBaseRemote}/${cfg.owner}/${cfg.repo}`,
      realLocal: mainReal,
    });
  } else if (cfg.direction === "push") {
    warnings.push(`main repo absent locally: ${mainLocal}`);
  }

  // 2. worktrees (default; --no-worktrees to skip)
  if (!cfg.noWorktrees) {
    try {
      const entries = await readdir(ownerDir);
      const wtPrefix = cfg.repo + ".wt-";
      for (const e of entries.sort()) {
        if (!e.startsWith(wtPrefix)) continue;
        const wtLocal = `${ownerDir}/${e}`;
        const wtReal = await resolveSource(wtLocal, localRoot);
        if (!wtReal) continue;
        targets.push({
          kind: "repo",
          label: e,
          localPath: wtLocal,
          remotePath: `${ghBaseRemote}/${cfg.owner}/${e}`,
          realLocal: wtReal,
        });
      }
    } catch {
      // owner dir doesn't exist or unreadable — skip silently
    }
  }

  // 3. session dirs (--sessions or --all)
  if (cfg.sessions) {
    const localClaude = `${homedir()}/.claude/projects`;
    const remoteClaude = `${remoteHome}/.claude/projects`;
    for (const t of [...targets]) {
      const encoded = encodeProjectPath(t.localPath);
      const sessionLocal = `${localClaude}/${encoded}`;
      try {
        await stat(sessionLocal);
        targets.push({
          kind: "session",
          label: `${localClaude}/${encoded}`,
          localPath: sessionLocal,
          remotePath: `${remoteClaude}/${encoded}`,
          realLocal: sessionLocal,
        });
      } catch {
        // no session dir for this worktree — fine
      }
    }
  }

  return { targets, warnings };
}
