/**
 * Shared registry test config mock.
 *
 * The registry test suite must not import maw-js/test/helpers/*: maw-js does not
 * export test helpers through package exports, so Bun package resolution rejects
 * that subpath. Keep the minimal complete `maw-js/config` mock local to this
 * repository instead.
 */

type ConfigLike = Record<string, any>;

type IntervalKey =
  | "capture"
  | "sessions"
  | "status"
  | "teams"
  | "preview"
  | "peerFetch"
  | "crashCheck";
type TimeoutKey =
  | "http"
  | "health"
  | "ping"
  | "pty"
  | "workspace"
  | "shellInit"
  | "wakeRetry"
  | "wakeVerify";
type LimitKey =
  | "feedMax"
  | "feedDefault"
  | "feedHistory"
  | "logsMax"
  | "logsDefault"
  | "logsTruncate"
  | "messageTruncate"
  | "ptyCols"
  | "ptyRows"
  | "maxConcurrentAgents";

const INTERVALS: Record<IntervalKey, number> = {
  capture: 50,
  sessions: 5000,
  status: 3000,
  teams: 3000,
  preview: 2000,
  peerFetch: 10000,
  crashCheck: 30000,
};

const TIMEOUTS: Record<TimeoutKey, number> = {
  http: 5000,
  health: 3000,
  ping: 5000,
  pty: 5000,
  workspace: 5000,
  shellInit: 3000,
  wakeRetry: 500,
  wakeVerify: 3000,
};

const LIMITS: Record<LimitKey, number> = {
  feedMax: 500,
  feedDefault: 50,
  feedHistory: 50,
  logsMax: 500,
  logsDefault: 50,
  logsTruncate: 500,
  messageTruncate: 100,
  ptyCols: 500,
  ptyRows: 200,
  maxConcurrentAgents: 0,
};

export const TEST_D = {
  intervals: INTERVALS,
  timeouts: TIMEOUTS,
  limits: LIMITS,
  hmacWindowSeconds: 300,
} as const;

export function mockConfigModule(loadConfig: () => Partial<ConfigLike>) {
  return {
    loadConfig,
    resetConfig: () => {},
    saveConfig: () => {},
    validateConfigShape: (c: unknown) => c,
    configForDisplay: () => ({}),
    buildCommand: (_name: string) => "echo test",
    buildCommandInDir: (_name: string, cwd: string) => `cd '${cwd}' && echo test`,
    getEnvVars: () => ({}),
    D: TEST_D,
    cfgInterval: (k: IntervalKey) => INTERVALS[k],
    cfgTimeout: (k: TimeoutKey) => TIMEOUTS[k],
    cfgLimit: (k: LimitKey) => LIMITS[k],
    cfg: (k: string) => loadConfig()[k],
  };
}
