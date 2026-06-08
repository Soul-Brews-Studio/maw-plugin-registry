import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface QuotaData {
  fiveHour: { utilization: number; resetsAt: string; resetsInSeconds: number } | null;
  sevenDay: { utilization: number; resetsAt: string } | null;
  sevenDaySonnet: { utilization: number; resetsAt: string } | null;
  sevenDayOpus: { utilization: number; resetsAt: string } | null;
  extraUsage: { isEnabled: boolean; utilization: number | null } | null;
  status: "ok" | "low" | "exhausted";
  raw: Record<string, unknown>;
}

const USAGE_API = "https://api.anthropic.com/api/oauth/usage";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const CACHE_DIR = join(homedir(), ".cache/maw");
const CACHE_FILE = join(CACHE_DIR, "quota.json");
const LOCK_FILE = join(CACHE_DIR, "quota.lock");
const CACHE_TTL_MS = 120_000;
const LOCK_STALE_MS = 30_000;

function getAccessToken(): string | null {
  const account = process.env.USER || homedir().split("/").pop() || "user";
  try {
    const raw = execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${account}" -w`,
      { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    const data = JSON.parse(raw);
    return data?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

function curlUsageApi(token: string): Record<string, unknown> {
  const raw = execSync(
    `curl -sf "${USAGE_API}" -H "Authorization: Bearer ${token}" -H "anthropic-beta: oauth-2025-04-20"`,
    { encoding: "utf-8", timeout: 15000, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
  return JSON.parse(raw);
}

function readCache(): { data: Record<string, unknown>; fetchedAt: number } | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const content = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
    if (!content?.data || !content?.fetched_at) return null;
    return { data: content.data, fetchedAt: content.fetched_at };
  } catch {
    return null;
  }
}

function writeCache(data: Record<string, unknown>) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify({ fetched_at: Date.now(), ttl_ms: CACHE_TTL_MS, data }, null, 2));
}

function acquireLock(): boolean {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (existsSync(LOCK_FILE)) {
    try {
      const lockTime = parseInt(readFileSync(LOCK_FILE, "utf-8").trim(), 10);
      if (Date.now() - lockTime < LOCK_STALE_MS) return false;
    } catch {}
  }
  writeFileSync(LOCK_FILE, String(Date.now()));
  return true;
}

function releaseLock() {
  try { unlinkSync(LOCK_FILE); } catch {}
}

function parseWindow(raw: unknown): { utilization: number; resetsAt: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.utilization !== "number") return null;
  return { utilization: obj.utilization, resetsAt: String(obj.resets_at ?? "") };
}

function buildQuotaData(raw: Record<string, unknown>, warnThreshold: number, criticalThreshold: number): QuotaData {
  const fiveHour = parseWindow(raw.five_hour);
  const sevenDay = parseWindow(raw.seven_day);
  const sevenDaySonnet = parseWindow(raw.seven_day_sonnet);
  const sevenDayOpus = parseWindow(raw.seven_day_opus);

  let resetsInSeconds = 0;
  if (fiveHour?.resetsAt) {
    resetsInSeconds = Math.max(0, Math.round((new Date(fiveHour.resetsAt).getTime() - Date.now()) / 1000));
  }

  const extra = raw.extra_usage as Record<string, unknown> | null;
  const extraUsage = extra ? {
    isEnabled: !!extra.is_enabled,
    utilization: typeof extra.utilization === "number" ? extra.utilization : null,
  } : null;

  const maxUtil = Math.max(
    fiveHour?.utilization ?? 0,
    sevenDay?.utilization ?? 0,
    sevenDaySonnet?.utilization ?? 0,
    sevenDayOpus?.utilization ?? 0,
  );

  const status: "ok" | "low" | "exhausted" =
    maxUtil >= criticalThreshold ? "exhausted" :
    maxUtil >= warnThreshold ? "low" : "ok";

  return {
    fiveHour: fiveHour ? { ...fiveHour, resetsInSeconds } : null,
    sevenDay,
    sevenDaySonnet,
    sevenDayOpus,
    extraUsage,
    status,
    raw,
  };
}

export function resetCache() {
  try { unlinkSync(CACHE_FILE); } catch {}
  releaseLock();
}

export async function fetchQuota(warnThreshold = 80, criticalThreshold = 95): Promise<QuotaData> {
  const cache = readCache();
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return buildQuotaData(cache.data, warnThreshold, criticalThreshold);
  }

  const token = getAccessToken();
  if (!token) throw new Error("no OAuth token — run `claude login` first");

  if (!acquireLock()) {
    // Another process is fetching — wait briefly then read cache
    await new Promise(r => setTimeout(r, 2000));
    const fresh = readCache();
    if (fresh) return buildQuotaData(fresh.data, warnThreshold, criticalThreshold);
    throw new Error("usage API busy — another process is fetching. Try again shortly.");
  }

  try {
    const raw = curlUsageApi(token);
    writeCache(raw);
    return buildQuotaData(raw, warnThreshold, criticalThreshold);
  } catch {
    if (cache) return buildQuotaData(cache.data, warnThreshold, criticalThreshold);
    throw new Error("usage API unavailable — rate limited or token expired. Try again in a few minutes.");
  } finally {
    releaseLock();
  }
}
