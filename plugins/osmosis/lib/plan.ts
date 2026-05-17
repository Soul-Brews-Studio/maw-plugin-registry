import { type Config, type Target, type TargetState } from "./types";
import { countAndSize, fmtBytes } from "./paths";
import { targetState } from "./ghq";

export type PlanRow = Target & {
  files: number;
  bytes: number;
  remoteState: TargetState;
  skip: boolean;
  skipReason?: string;
};

export async function buildPlan(
  targets: Target[],
  cfg: Config,
): Promise<{ plan: PlanRow[]; sshError?: string }> {
  const plan: PlanRow[] = [];
  for (const t of targets) {
    const { files, bytes } = cfg.direction === "push"
      ? await countAndSize(t.realLocal)
      : { files: 0, bytes: 0 };
    const state = await targetState(cfg.host, t.remotePath);
    if (typeof state === "object" && "error" in state) {
      return { plan, sshError: state.error };
    }
    const skip = cfg.direction === "pull" && state === "absent";
    plan.push({
      ...t,
      files,
      bytes,
      remoteState: state,
      skip,
      skipReason: skip ? "absent on remote" : undefined,
    });
  }
  return { plan };
}

export function renderPlan(plan: PlanRow[], nRepos: number, nSessions: number, cfg: Config): void {
  const groupHeader = (items: PlanRow[]): string => {
    if (items.length === 0) return "";
    const localParents = new Set(items.map((p) => p.localPath.split("/").slice(0, -1).join("/")));
    const remoteParents = new Set(items.map((p) => p.remotePath.split("/").slice(0, -1).join("/")));
    const localPrefix = localParents.size === 1 ? Array.from(localParents)[0] : "(mixed)";
    const remotePrefix = remoteParents.size === 1 ? Array.from(remoteParents)[0] : "(mixed)";
    if (localPrefix === remotePrefix) return localPrefix;
    const arrow = cfg.direction === "push" ? "→" : "←";
    return `${localPrefix} ${arrow} ${cfg.host}:${remotePrefix}`;
  };

  const renderGroup = (label: string, items: PlanRow[]) => {
    if (items.length === 0) return;
    console.log(`   ${label}   ${groupHeader(items)}`);
    for (const p of items) {
      const glyph = p.skip ? "⊘" : p.remoteState === "present" ? "↻" : "✦";
      const basename = p.localPath.split("/").pop() || p.label;
      const symlink = p.realLocal !== p.localPath ? ` (→ ${p.realLocal.split("/").pop()})` : "";
      const size = p.skip
        ? `SKIP — ${p.skipReason}`
        : cfg.direction === "push"
          ? `${p.files} files, ${fmtBytes(p.bytes)}`
          : "(pull)";
      console.log(`     ${glyph} ${(basename + symlink).padEnd(58)} ${size}`);
    }
    console.log("");
  };

  renderGroup(`REPOS (${nRepos})`, plan.filter((p) => p.kind === "repo"));
  if (nSessions > 0) {
    renderGroup(`SESSIONS (${nSessions})`, plan.filter((p) => p.kind === "session"));
  } else if (!cfg.sessions) {
    console.log(`   SESSIONS: skipped (use --sessions or --all to include)\n`);
  }
  const totalFiles = plan.reduce((s, p) => s + p.files, 0);
  const totalBytes = plan.reduce((s, p) => s + p.bytes, 0);
  console.log(`   ─────────────────────────────────`);
  console.log(`   TOTAL: ${plan.length} transfer${plan.length === 1 ? "" : "s"}, ${totalFiles} files, ${fmtBytes(totalBytes)}\n`);
}
