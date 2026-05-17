export type Direction = "push" | "pull";

export type Config = {
  host: string;
  direction: Direction;
  repo: string;
  owner: string;
  apply: boolean;
  json: boolean;
  verbose: boolean;
  safe: boolean;
  force: boolean;
  yes: boolean;
  noWorktrees: boolean;
  sessions: boolean;
  diff: boolean;
  derivedFrom?: string;
};

export type Target = {
  kind: "repo" | "session";
  label: string;
  localPath: string;
  remotePath: string;
  realLocal: string;
};

export type TargetState = "present" | "absent" | { error: string };

export type ExecResult = { stdout: string; stderr: string; code: number };

export type MembraneReport = {
  caseCollisions: string[];
  secrets: string[];
  appleDouble: number;
};

export class UsageError extends Error {}
