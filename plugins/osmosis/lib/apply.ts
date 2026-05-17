import { type Config } from "./types";
import { type PlanRow } from "./plan";
import { type PreviewResult } from "./preview";
import { fmtBytes } from "./paths";
import { buildRsyncArgs, runRsync, partitionRsyncOutput, promptYesNo } from "./rsync";

export async function confirmApply(
  plan: PlanRow[],
  previews: PreviewResult[],
  cfg: Config,
): Promise<{ proceed: boolean; reason?: string }> {
  const interactive = process.stdin.isTTY === true && !cfg.json;
  if (cfg.yes) return { proceed: true };
  if (!interactive) return { proceed: false, reason: "no TTY for prompt; pass --yes to skip" };
  const totalFiles = previews.reduce((s, p) => s + p.previewFiles.length, 0);
  const totalBytes = plan.reduce((s, p) => s + p.bytes, 0);
  const yes = await promptYesNo(
    `\n❓ proceed with ${plan.length} transfer${plan.length === 1 ? "" : "s"} (${totalFiles} files, ${fmtBytes(totalBytes)}) → ${cfg.host}? [y/N]: `,
  );
  return { proceed: yes, reason: yes ? undefined : "aborted by user" };
}

export async function runApply(
  plan: PlanRow[],
  cfg: Config,
  options: { exitOnMissing?: boolean },
): Promise<void> {
  if (!cfg.json) console.log("\n💧 transferring…\n");
  const failures: string[] = [];
  let skipped = 0;

  for (const p of plan) {
    if (p.skip) {
      if (!cfg.json) console.log(`   ${p.label} … ⊘ skipped (${p.skipReason})`);
      skipped++;
      continue;
    }
    const src = cfg.direction === "push" ? p.realLocal : `${cfg.host}:${p.remotePath}`;
    const dst = cfg.direction === "push" ? `${cfg.host}:${p.remotePath}` : p.localPath;
    if (!cfg.json) process.stdout.write(`   ${p.label} …`);
    const { code, lines } = await runRsync(buildRsyncArgs(src, dst, true));
    if (code !== 0) {
      failures.push(`${p.label} (exit ${code})`);
      if (!cfg.json) console.log(` ✖ exit ${code}`);
    } else {
      const { stats } = partitionRsyncOutput(lines);
      const transferred = stats.find((s) => /Number of files transferred/.test(s));
      if (!cfg.json) console.log(` ✓ ${transferred ? transferred.trim() : "done"}`);
    }
  }

  if (!cfg.json) {
    console.log("");
    const ran = plan.length - skipped;
    const ok = ran - failures.length;
    const skipNote = skipped > 0 ? `, ${skipped} skipped` : "";
    if (failures.length === 0) {
      console.log(`✨ ${ok}/${ran} done${skipNote}.`);
    } else {
      console.log(`⚠ ${ok}/${ran} succeeded, ${failures.length} failed${skipNote}:`);
      for (const f of failures) console.log(`   ✖ ${f}`);
      if (options.exitOnMissing) process.exitCode = failures.length;
    }
  } else {
    console.log(JSON.stringify({
      ok: failures.length === 0,
      applied: true,
      succeeded: plan.length - skipped - failures.length,
      skipped,
      failed: failures.length,
      failures,
    }));
  }
}
