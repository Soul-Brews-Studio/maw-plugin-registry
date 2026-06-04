// session-carry — carry Claude Code session JSONLs cross-node (osmosis-style, Bun.$).
//
// A Claude session = one file <session-id>.jsonl under ~/.claude/projects/<encoded-cwd>/,
// where encoded-cwd = the project cwd with every '/' -> '-'. `/resume` lists sessions in the
// CURRENT project's encoded dir, keyed by (dir + session-id) — NOT by the JSONL's internal cwd.
// So dropping <id>.jsonl into the DEST project's encoded dir makes it appear in /resume live
// (no symlink, no app restart) — even when source and dest paths differ (m5 /opt/Code vs
// remote /home/<user>/ghq). osmosis's --sessions assumes matching encoding and skips silently
// on mismatch; this carry reconciles by writing at the explicit dest dir.
//
// Transport is often one-directional in a fleet (push side -> pull side), so we PUSH:
// rsync -> dest /tmp staging -> sudo install into the dest project dir (chowned, additive).
//
// SAFETY (osmosis lesson — gate before side-effect): DRY-RUN by default; --apply moves bytes;
// never --delete (dest sessions preserved).
import { $ } from "bun";
import { readdirSync, statSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface Config {
  srcDir: string;
  node: string;
  destUser: string;
  destDir: string;
  minMb: number;
  subagents: boolean;
  apply: boolean;
  help: boolean;
}

export interface Session {
  rel: string;
  bytes: number;
  title?: string;
}

/** Encode a project cwd the way Claude Code does: leading '-', then '/' and '.' -> '-'. */
export function encodeProjectPath(p: string): string {
  return "-" + p.replace(/^\//, "").replace(/[/.]/g, "-");
}

export function parseArgs(argv: string[]): Config {
  const has = (n: string) => argv.includes(n);
  const opt = (n: string) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    srcDir: opt("--src-dir") ?? "",
    node: opt("--node") ?? "",
    destUser: opt("--dest-user") ?? "",
    destDir: opt("--dest-dir") ?? "",
    minMb: Number(opt("--min-mb") ?? 0),
    subagents: has("--subagents"),
    apply: has("--apply"),
    help: has("-h") || has("--help"),
  };
}

const HELP = `session-carry — carry Claude session JSONLs cross-node (dry-run by default)

  --src-dir <NAME|PATH>   source project: encoded dir name under ~/.claude/projects/, or full path
  --node <ssh-host>       e.g. oracle-world
  --dest-user <user>      owner on dest, e.g. oss
  --dest-dir <ENC-NAME>   dest project encoded dir, e.g. -home-oss-ghq-...-maw-js
  --min-mb <N>            only carry sessions >= N MB (default 0 = all)
  --subagents             also carry nested subagent jsonls (default: top-level only)
  --apply                 perform transfer (default: dry-run)`;

function listSessions(srcPath: string, subagents: boolean, minMb: number): Session[] {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (subagents) out.push(...walk(p));
      } else if (e.name.endsWith(".jsonl")) out.push(p);
    }
    return out;
  };
  return walk(srcPath)
    .map((p) => {
      const bytes = statSync(p).size;
      let title: string | undefined;
      try {
        title = JSON.parse(readFileSync(p, "utf8").slice(0, 4096).split("\n")[0]).customTitle;
      } catch {}
      return { rel: p.slice(srcPath.length + 1), bytes, title };
    })
    .filter((s) => s.bytes >= minMb * 1048576)
    .sort((a, b) => b.bytes - a.bytes);
}

const mb = (b: number) => (b / 1048576).toFixed(b >= 1048576 ? 0 : 1);

export async function execute(
  argv: string[],
  opts: { exitOnMissing?: boolean } = {},
): Promise<void> {
  const cfg = parseArgs(argv);
  if (cfg.help) {
    console.log(HELP);
    return;
  }
  const missing = !cfg.srcDir || !cfg.node || !cfg.destUser || !cfg.destDir;
  if (missing) {
    console.error("✗ need --src-dir --node --dest-user --dest-dir (see --help)");
    if (opts.exitOnMissing) process.exitCode = 1;
    return;
  }

  const PROJ = join(homedir(), ".claude/projects");
  const srcPath = cfg.srcDir.startsWith("/") ? cfg.srcDir : join(PROJ, cfg.srcDir);
  if (!existsSync(srcPath)) {
    console.error(`✗ source not found: ${srcPath}`);
    if (opts.exitOnMissing) process.exitCode = 1;
    return;
  }
  const destPath = `/home/${cfg.destUser}/.claude/projects/${cfg.destDir}`;
  const stage = `/tmp/session-carry.${cfg.destUser}.${process.pid}`;

  const sessions = listSessions(srcPath, cfg.subagents, cfg.minMb);
  if (!sessions.length) {
    console.error("✗ no matching .jsonl files");
    if (opts.exitOnMissing) process.exitCode = 1;
    return;
  }

  const total = sessions.reduce((s, x) => s + x.bytes, 0);
  console.log(`═══ session-carry ${cfg.apply ? "[APPLY]" : "[DRY-RUN]"} ═══`);
  console.log(`  src : ${srcPath}`);
  console.log(`  dest: ${cfg.node}:${destPath}  (owner ${cfg.destUser})`);
  console.log(
    `  mode: ${cfg.subagents ? "sessions + subagents" : "top-level only"}${cfg.minMb ? `, >=${cfg.minMb}MB` : ""}\n`,
  );
  console.log(`── manifest (${sessions.length} files, ${mb(total)} MB) ──`);
  for (const s of sessions.slice(0, 12))
    console.log(`  ${mb(s.bytes).padStart(6)}MB  ${s.rel}${s.title ? `  · ${s.title}` : ""}`);
  if (sessions.length > 12) console.log(`  … +${sessions.length - 12} more`);
  console.log();

  if (!cfg.apply) {
    const exists = (
      await $`ssh ${cfg.node} sudo -u ${cfg.destUser} test -d ${destPath} && echo yes || echo no`.text()
    ).trim();
    console.log(`dest project dir: ${exists === "yes" ? "✓ exists" : "⚠ missing (created on --apply)"}`);
    console.log("DRY-RUN — nothing transferred. Re-run with --apply.");
    return;
  }

  // APPLY — transfer EXACTLY the manifest set (rsync --files-from), additive, no-delete.
  console.log(`→ rsync push → ${cfg.node}:${stage} …`);
  await $`ssh ${cfg.node} mkdir -p ${stage}`;
  const listFile = `/tmp/session-carry.list.${process.pid}`;
  await Bun.write(listFile, sessions.map((s) => s.rel).join("\n") + "\n");
  await $`rsync -a -h --partial --inplace --files-from=${listFile} -e ssh ${srcPath + "/"} ${cfg.node + ":" + stage + "/"}`;

  console.log(`→ install into dest (owner ${cfg.destUser}, additive, no-delete) …`);
  const remote = `set -e
sudo -u ${cfg.destUser} mkdir -p '${destPath}'
sudo cp -a '${stage}'/. '${destPath}'/
sudo chown -R ${cfg.destUser}:${cfg.destUser} '${destPath}'
sudo mv '${stage}' '${stage}.done' 2>/dev/null || true
sudo -u ${cfg.destUser} bash -c "ls -1 '${destPath}'/*.jsonl 2>/dev/null | wc -l | xargs echo '  dest sessions:'"`;
  await $`ssh ${cfg.node} bash -c ${remote}`;
  console.log("✓ carry complete — files appear in /resume for the dest project.");
}
