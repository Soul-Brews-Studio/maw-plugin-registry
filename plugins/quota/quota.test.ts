import { describe, test, expect, mock } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const MOCK_API_RESPONSE = {
  five_hour: { utilization: 29, resets_at: "2026-06-08T18:50:00.480633+00:00" },
  seven_day: { utilization: 48, resets_at: "2026-06-10T03:00:00.480655+00:00" },
  seven_day_sonnet: { utilization: 73, resets_at: "2026-06-10T03:00:00.480662+00:00" },
  seven_day_opus: null,
  extra_usage: { is_enabled: false, utilization: null },
};

let apiResponse: unknown = MOCK_API_RESPONSE;
const TEST_HOME = join(tmpdir(), `maw-quota-test-${Date.now()}`);
const TEST_CACHE_DIR = join(TEST_HOME, ".cache/maw");
const TEST_CACHE_FILE = join(TEST_CACHE_DIR, "quota.json");
const TEST_LOCK_FILE = join(TEST_CACHE_DIR, "quota.lock");

mock.module("child_process", () => ({
  execSync: (cmd: string) => {
    if (cmd.includes("security find-generic-password")) {
      return JSON.stringify({ claudeAiOauth: { accessToken: "test-token" } });
    }
    if (cmd.includes("curl")) {
      return JSON.stringify(apiResponse);
    }
    throw new Error(`unexpected command: ${cmd}`);
  },
}));

mock.module("os", () => ({
  homedir: () => TEST_HOME,
  tmpdir,
}));

const { fetchQuota, resetCache } = await import("./lib/tracker");
const { formatJson, formatQuota } = await import("./lib/format");

function cleanCache() {
  try { unlinkSync(TEST_CACHE_FILE); } catch {}
  try { unlinkSync(TEST_LOCK_FILE); } catch {}
}

describe("quota tracker (API-based)", () => {
  test("parses five_hour utilization", async () => {
    cleanCache();
    apiResponse = MOCK_API_RESPONSE;
    const data = await fetchQuota();
    expect(data.fiveHour).not.toBeNull();
    expect(data.fiveHour!.utilization).toBe(29);
  });

  test("parses seven_day utilization", async () => {
    cleanCache();
    const data = await fetchQuota();
    expect(data.sevenDay!.utilization).toBe(48);
  });

  test("parses seven_day_sonnet utilization", async () => {
    cleanCache();
    const data = await fetchQuota();
    expect(data.sevenDaySonnet!.utilization).toBe(73);
  });

  test("seven_day_opus is null when not present", async () => {
    cleanCache();
    const data = await fetchQuota();
    expect(data.sevenDayOpus).toBeNull();
  });

  test("extra_usage is parsed", async () => {
    cleanCache();
    const data = await fetchQuota();
    expect(data.extraUsage).not.toBeNull();
    expect(data.extraUsage!.isEnabled).toBe(false);
  });

  test("status is ok when below warn threshold", async () => {
    cleanCache();
    const data = await fetchQuota(80, 95);
    expect(data.status).toBe("ok");
  });

  test("status is low when sonnet hits warn threshold", async () => {
    cleanCache();
    const data = await fetchQuota(70, 95);
    expect(data.status).toBe("low");
  });

  test("status is exhausted when sonnet hits critical threshold", async () => {
    cleanCache();
    const data = await fetchQuota(70, 73);
    expect(data.status).toBe("exhausted");
  });

  test("resetsInSeconds is computed", async () => {
    cleanCache();
    const data = await fetchQuota();
    expect(data.fiveHour!.resetsInSeconds).toBeGreaterThanOrEqual(0);
  });

  test("raw response is preserved", async () => {
    cleanCache();
    const data = await fetchQuota();
    expect(data.raw).toHaveProperty("five_hour");
  });

  test("uses file cache on second call", async () => {
    cleanCache();
    apiResponse = MOCK_API_RESPONSE;
    await fetchQuota();
    apiResponse = { ...MOCK_API_RESPONSE, five_hour: { utilization: 99, resets_at: "2026-06-08T20:00:00Z" } };
    const data = await fetchQuota();
    expect(data.fiveHour!.utilization).toBe(29);
  });

  test("falls back to stale cache on API failure", async () => {
    cleanCache();
    apiResponse = MOCK_API_RESPONSE;
    await fetchQuota();
    cleanCache();
    mkdirSync(TEST_CACHE_DIR, { recursive: true });
    writeFileSync(
      TEST_CACHE_FILE,
      JSON.stringify({ fetched_at: Date.now() - 200_000, ttl_ms: 120000, data: MOCK_API_RESPONSE }),
    );
    apiResponse = null;
    const data = await fetchQuota();
    expect(data.fiveHour!.utilization).toBe(29);
    apiResponse = MOCK_API_RESPONSE;
  });
});

describe("quota format", () => {
  test("formatJson produces valid structure", async () => {
    cleanCache();
    apiResponse = MOCK_API_RESPONSE;
    const data = await fetchQuota();
    const json = formatJson(data) as Record<string, unknown>;
    expect(json).toHaveProperty("five_hour");
    expect(json).toHaveProperty("seven_day");
    expect(json).toHaveProperty("seven_day_sonnet");
    expect(json).toHaveProperty("status");
    expect(json.status).toBe("ok");
  });

  test("formatQuota produces human-readable output", async () => {
    cleanCache();
    apiResponse = MOCK_API_RESPONSE;
    const data = await fetchQuota();
    const output = formatQuota(data);
    expect(output).toContain("5h Cycle: 29% used");
    expect(output).toContain("Weekly (all): 48% used");
    expect(output).toContain("Weekly Sonnet: 73% used");
    expect(output).not.toContain("Weekly Opus");
  });

  test("formatQuota shows opus when present", async () => {
    cleanCache();
    apiResponse = {
      ...MOCK_API_RESPONSE,
      seven_day_opus: { utilization: 15, resets_at: "2026-06-10T03:00:00Z" },
    };
    const data = await fetchQuota();
    const output = formatQuota(data);
    expect(output).toContain("Weekly Opus: 15% used");
  });
});
