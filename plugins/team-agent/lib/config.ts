/**
 * Team config + inbox IO.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const TEAMS_DIR = join(homedir(), ".claude", "teams");

export function teamDir(name: string): string { return join(TEAMS_DIR, name); }
export function configPath(name: string): string { return join(teamDir(name), "config.json"); }
export function inboxesDir(name: string): string { return join(teamDir(name), "inboxes"); }
export function inboxPath(team: string, role: string): string { return join(inboxesDir(team), `${role}.json`); }

export function readConfig(team: string): any {
  if (!existsSync(configPath(team))) throw new Error(`team not found: ${team} (no ${configPath(team)})`);
  return JSON.parse(readFileSync(configPath(team), "utf-8"));
}

export function writeConfig(team: string, cfg: any): void {
  mkdirSync(teamDir(team), { recursive: true });
  writeFileSync(configPath(team), JSON.stringify(cfg, null, 2));
}

export function readInbox(team: string, role: string): any[] {
  const p = inboxPath(team, role);
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf-8"));
}

export function appendInbox(team: string, role: string, entry: any): void {
  mkdirSync(inboxesDir(team), { recursive: true });
  const inbox = readInbox(team, role);
  inbox.push(entry);
  writeFileSync(inboxPath(team, role), JSON.stringify(inbox, null, 2));
}
