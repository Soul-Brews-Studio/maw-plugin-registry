import { type Config } from "./types";
import { type PlanRow } from "./plan";
import { buildRsyncArgs, runRsync, partitionRsyncOutput, renderPreview, humanizeStatLine } from "./rsync";

export type PreviewResult = PlanRow & {
  previewFiles: string[];
  previewStats: string[];
  previewCode: number;
};

export async function runPreviews(plan: PlanRow[], cfg: Config): Promise<PreviewResult[]> {
  const previews: PreviewResult[] = [];
  for (const p of plan) {
    if (p.skip) {
      previews.push({ ...p, previewFiles: [], previewStats: [], previewCode: 0 });
      continue;
    }
    const src = cfg.direction === "push" ? p.realLocal : `${cfg.host}:${p.remotePath}`;
    const dst = cfg.direction === "push" ? `${cfg.host}:${p.remotePath}` : p.localPath;
    const { code, lines } = await runRsync(buildRsyncArgs(src, dst, false));
    const { files, stats } = partitionRsyncOutput(lines);
    previews.push({ ...p, previewFiles: files, previewStats: stats, previewCode: code });
  }
  return previews;
}

export function renderPreviews(previews: PreviewResult[], cfg: Config): void {
  const baseline = cfg.diff ? previews.find((p) => p.kind === "repo" && p.label === cfg.repo) : undefined;
  const baselineSet = baseline ? new Set(baseline.previewFiles) : null;

  for (const pv of previews) {
    if (pv.skip) continue;
    console.log(`🔍 preview · ${pv.label}`);
    if (pv.previewCode !== 0) {
      console.error(`   ✖ preview exit ${pv.previewCode}\n`);
      continue;
    }
    const useDiff = cfg.diff && baselineSet && pv !== baseline && pv.kind === "repo";
    if (useDiff) {
      const unique = pv.previewFiles.filter((f) => !baselineSet!.has(f));
      const common = pv.previewFiles.length - unique.length;
      console.log(`   diff vs ${baseline!.label}:`);
      if (unique.length === 0) {
        console.log(`     (no unique files — fully shared with ${baseline!.label})`);
      } else {
        const max = cfg.verbose ? unique.length : 15;
        for (const f of unique.slice(0, max)) console.log(`     + ${f}`);
        if (unique.length > max) {
          console.log(`     … and ${unique.length - max} more unique (--verbose to see all)`);
        }
      }
      console.log(`     ─ ${common} files shared with ${baseline!.label}\n`);
      for (const s of pv.previewStats.slice(0, 6)) console.log(`   ${humanizeStatLine(s)}`);
      console.log("");
    } else {
      renderPreview(pv.previewFiles, pv.previewStats, cfg.verbose);
      console.log("");
    }
  }
}
