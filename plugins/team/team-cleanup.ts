import { existsSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { cmdTeamTaskDeleteAll } from "./task-ops";
import { resolvePsi } from "./team-helpers";

const TEAMS_DIR = join(homedir(), ".claude/teams");

export async function cmdTeamDelete(teamName: string): Promise<void> {
  // 1. Delete task files
  cmdTeamTaskDeleteAll(teamName);
  console.log(`  \x1b[32m✓\x1b[0m tasks cleared`);

  // 2. Remove team directory
  const teamDir = join(TEAMS_DIR, teamName);
  if (existsSync(teamDir)) {
    rmSync(teamDir, { recursive: true, force: true });
    console.log(`  \x1b[32m✓\x1b[0m team dir removed: ${teamDir}`);
  } else {
    console.log(`  \x1b[90mℹ team dir not found (already clean)\x1b[0m`);
  }

  // 3. Remove the durable vault manifest created by `maw team create`,
  //    so vault-only manifests are not orphaned after delete.
  const vaultTeamDir = join(resolvePsi(), "memory", "mailbox", "teams", teamName);
  if (existsSync(vaultTeamDir)) {
    rmSync(vaultTeamDir, { recursive: true, force: true });
    console.log(`  \x1b[32m✓\x1b[0m vault manifest removed: ${vaultTeamDir}`);
  } else {
    console.log(`  \x1b[90mℹ vault manifest not found (already clean)\x1b[0m`);
  }

  console.log(`\x1b[32m✓\x1b[0m team "${teamName}" deleted`);
}
