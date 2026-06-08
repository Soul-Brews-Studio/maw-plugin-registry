import type { QuotaData } from "./tracker";

function color(pct: number, text: string): string {
  if (pct >= 80) return `\x1b[31m${text}\x1b[0m`;
  if (pct >= 50) return `\x1b[33m${text}\x1b[0m`;
  return `\x1b[32m${text}\x1b[0m`;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "resetting...";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtReset(iso: string): string {
  if (!iso) return "?";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16);
  }
}

export function formatQuota(data: QuotaData): string {
  const lines: string[] = [];

  if (data.fiveHour) {
    const f = data.fiveHour;
    lines.push(`  ${color(f.utilization, `⚡ 5h Cycle: ${f.utilization}% used`)} — resets in ${formatDuration(f.resetsInSeconds)}`);
  }

  if (data.sevenDay) {
    lines.push(`  ${color(data.sevenDay.utilization, `📅 Weekly (all): ${data.sevenDay.utilization}% used`)}`);
  }

  if (data.sevenDaySonnet) {
    lines.push(`  ${color(data.sevenDaySonnet.utilization, `📅 Weekly Sonnet: ${data.sevenDaySonnet.utilization}% used`)}`);
  }

  if (data.sevenDayOpus) {
    lines.push(`  ${color(data.sevenDayOpus.utilization, `📅 Weekly Opus: ${data.sevenDayOpus.utilization}% used`)}`);
  }

  if (data.fiveHour?.resetsAt) {
    lines.push(`  \x1b[90m🔄 Cycle reset: ${fmtReset(data.fiveHour.resetsAt)} GMT+7\x1b[0m`);
  }
  if (data.sevenDay?.resetsAt) {
    lines.push(`  \x1b[90m📅 Week reset: ${fmtReset(data.sevenDay.resetsAt)} GMT+7\x1b[0m`);
  }

  if (data.extraUsage) {
    const ex = data.extraUsage;
    lines.push(`  \x1b[90m💳 Extra usage: ${ex.isEnabled ? "enabled" : "disabled"}\x1b[0m`);
  }

  return lines.join("\n");
}

export function formatJson(data: QuotaData): object {
  return {
    five_hour: data.fiveHour ? {
      utilization: data.fiveHour.utilization,
      resets_at: data.fiveHour.resetsAt,
      resets_in_seconds: data.fiveHour.resetsInSeconds,
    } : null,
    seven_day: data.sevenDay,
    seven_day_sonnet: data.sevenDaySonnet,
    seven_day_opus: data.sevenDayOpus,
    extra_usage: data.extraUsage,
    status: data.status,
  };
}
