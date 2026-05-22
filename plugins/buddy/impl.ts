import { tmux } from "maw-js/sdk";
import { ghqFind } from "maw-js/core/ghq";
import { cmdWake } from "maw-js/commands/shared/wake-cmd";
import { buildBuddyPriming } from "./lib";

export interface BuddyOptions {
  task: string;
  engineA?: string;
  engineB?: string;
  roleA?: string;
  roleB?: string;
  worktreeName?: string;
  noPrime?: boolean;
  dryRun?: boolean;
}

const DEFAULT_ENGINE_A = "claude";
const DEFAULT_ENGINE_B = "codex";
const DEFAULT_ROLE_A = "spec";
const DEFAULT_ROLE_B = "impl";

export function slugifyTask(task: string): string {
  return task.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
}

async function resolveRepoBare(oracle: string): Promise<{ repoPath: string; repoName: string }> {
  const searchTerm = oracle.includes("/") ? oracle.split("/").pop()! : oracle;
  const repoPath = await ghqFind(`/${searchTerm}$`);
  if (!repoPath) throw new Error(`repo not found: ${oracle}`);
  return { repoPath, repoName: repoPath.split("/").pop()! };
}

export async function cmdBuddy(oracle: string, opts: BuddyOptions): Promise<void> {
  const engineA = opts.engineA ?? DEFAULT_ENGINE_A;
  const engineB = opts.engineB ?? DEFAULT_ENGINE_B;
  const roleA = opts.roleA ?? DEFAULT_ROLE_A;
  const roleB = opts.roleB ?? DEFAULT_ROLE_B;
  const taskSlug = opts.worktreeName ?? slugifyTask(opts.task);

  const { repoPath, repoName } = await resolveRepoBare(oracle);
  const worktreePath = `${repoPath}.wt-${taskSlug}`;

  const nameA = `${repoName}-${taskSlug}-${engineA}`;
  const nameB = `${repoName}-${taskSlug}-${engineB}`;
  const contextPath = `ψ/inbox/buddy/${taskSlug}.md`;

  console.log(`\x1b[36m⚡\x1b[0m maw buddy — ${opts.task}`);
  console.log(`\x1b[36m→\x1b[0m repo:     ${repoName}`);
  console.log(`\x1b[36m→\x1b[0m worktree: ${taskSlug}`);
  console.log(`\x1b[36m→\x1b[0m pair:     ${engineA} (A=${roleA}) × ${engineB} (B=${roleB})`);
  console.log(`\x1b[36m→\x1b[0m names:    ${nameA} ↔ ${nameB}`);

  if (opts.dryRun) {
    console.log(`\n\x1b[33mdry-run\x1b[0m — would spawn:`);
    console.log(`  1. wake ${oracle} --wt ${taskSlug} --engine ${engineA}`);
    console.log(`  2. wake ${oracle} --wt ${taskSlug} --engine ${engineB} --split`);
    if (!opts.noPrime) console.log(`  3. prime both via tmux.sendText`);
    return;
  }

  await cmdWake(oracle, { wt: taskSlug, engine: engineA } as any);
  await cmdWake(oracle, { wt: taskSlug, engine: engineB, split: true } as any);

  if (opts.noPrime) {
    console.log(`\x1b[33m⚠\x1b[0m --no-prime — buddies are NOT identity-primed`);
    return;
  }

  const leadPane = process.env.TMUX_PANE ?? "lead";
  const lineage = `Buddy pair born ${new Date().toISOString()} by ${process.env.USER ?? "unknown"}`;

  const primingA = buildBuddyPriming({
    selfName: nameA,
    buddyName: nameB,
    selfAddress: nameA,
    buddyAddress: nameB,
    selfRole: roleA,
    buddyRole: roleB,
    engine: engineA,
    buddyEngine: engineB,
    task: opts.task,
    taskContextPath: contextPath,
    worktreePath,
    lineage,
    leadPane,
  });
  const primingB = buildBuddyPriming({
    selfName: nameB,
    buddyName: nameA,
    selfAddress: nameB,
    buddyAddress: nameA,
    selfRole: roleB,
    buddyRole: roleA,
    engine: engineB,
    buddyEngine: engineA,
    task: opts.task,
    taskContextPath: contextPath,
    worktreePath,
    lineage,
    leadPane,
  });

  await tmux.sendText(nameA, primingA.message);
  await tmux.sendText(nameB, primingB.message);
  console.log(`\n\x1b[32m✓\x1b[0m buddy pair primed — they know each other`);
}
