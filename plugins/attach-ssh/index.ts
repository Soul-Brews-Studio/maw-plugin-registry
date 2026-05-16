/**
 * attach-ssh — explicit SSH+tmux attach command and Tier 3 strategy.
 *
 * This plugin used to be only an `attach:strategy`, but the host-side Tier 3
 * dispatcher is dormant. Keep the strategy shape available for future hosts
 * while also exposing a direct command:
 *
 *   maw attach-ssh <node>:<session> [--ssh-alias <alias>] [--dry-run]
 *   maw attach-ssh <node> <session> [--ssh-alias <alias>] [--dry-run]
 */
import type { InvokeContext, InvokeResult } from "maw-js/plugin/types";
import { parseFlags } from "maw-js/cli/parse-args";

export const command = {
  name: "attach-ssh",
  description: "Attach to a remote tmux session over SSH.",
};

const USAGE =
  "usage: maw attach-ssh <node>:<session> [--ssh-alias <alias>] [--dry-run]\n" +
  "   or: maw attach-ssh <node> <session> [--ssh-alias <alias>] [--dry-run]";

const SAFE_SSH_ALIAS = /^[A-Za-z0-9._@%+=:/-]+$/;

export interface Tier3Target {
  tier: 3;
  sessionName: string;
  node: string;
  peerUrl?: string;
  sshAlias: string;
}

export interface AttachRemoteSessionRequest {
  node: string;
  sshAlias: string;
  sessionName: string;
}

export type AttachRemoteSession = (request: AttachRemoteSessionRequest) => void | Promise<void>;

export interface ExecuteOpts {
  /** Test seam — swap the SSH helper. Defaults to this plugin's SSH+tmux helper. */
  ssh?: AttachRemoteSession;
}

export interface ParsedAttachSshCommand {
  target: Tier3Target;
  dryRun: boolean;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function assertSafeSshAlias(value: string): void {
  if (!value || !SAFE_SSH_ALIAS.test(value)) {
    throw new Error(`unsafe ssh alias: ${value || "(empty)"}`);
  }
}

export async function attachRemoteSession(request: AttachRemoteSessionRequest): Promise<void> {
  const { node, sshAlias, sessionName } = request;
  if (!node) throw new Error("node required");
  if (!sessionName) throw new Error("session required");
  assertSafeSshAlias(sshAlias);

  const remoteCommand = `tmux attach-session -t ${shellQuote(sessionName)}`;
  const proc = Bun.spawn(["ssh", "-tt", sshAlias, remoteCommand], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`ssh attach failed for ${node}:${sessionName} via ${sshAlias} (exit ${code})`);
  }
}

export async function execute(target: Tier3Target, opts: ExecuteOpts = {}): Promise<void> {
  const ssh = opts.ssh ?? attachRemoteSession;
  await ssh({
    node: target.node,
    sshAlias: target.sshAlias,
    sessionName: target.sessionName,
  });
}

export function parseAttachSshCommand(args: string[]): ParsedAttachSshCommand {
  const flags = parseFlags(
    args,
    {
      "--dry-run": Boolean,
      "--ssh-alias": String,
    },
    0,
  );

  const positionals = flags._ as string[];
  if (positionals.includes("--help") || positionals.includes("-h")) {
    throw new Error(USAGE);
  }

  let node = "";
  let sessionName = "";
  if (positionals.length === 1 && positionals[0].includes(":")) {
    const idx = positionals[0].indexOf(":");
    node = positionals[0].slice(0, idx);
    sessionName = positionals[0].slice(idx + 1);
  } else if (positionals.length >= 2) {
    node = positionals[0];
    sessionName = positionals.slice(1).join(" ");
  }

  if (!node || !sessionName) {
    throw new Error(USAGE);
  }
  if (node.startsWith("-") || sessionName.startsWith("-")) {
    throw new Error(`node/session cannot look like flags\n  ${USAGE}`);
  }

  const sshAlias = (flags["--ssh-alias"] as string | undefined) || node;
  assertSafeSshAlias(sshAlias);

  return {
    dryRun: Boolean(flags["--dry-run"]),
    target: {
      tier: 3,
      node,
      sshAlias,
      sessionName,
    },
  };
}

async function handler(ctx: InvokeContext): Promise<InvokeResult> {
  try {
    if (ctx.source === "api") {
      const body = (ctx.args ?? {}) as Record<string, unknown>;
      const node = String(body.node ?? "");
      const sessionName = String(body.sessionName ?? body.session ?? "");
      const sshAlias = String(body.sshAlias ?? node);
      if (!node || !sessionName) return { ok: false, error: "node and sessionName required" };
      const target: Tier3Target = { tier: 3, node, sessionName, sshAlias };
      if (body.dryRun) return { ok: true, output: formatDryRun(target) };
      await execute(target);
      return { ok: true };
    }

    const { target, dryRun } = parseAttachSshCommand((ctx.args ?? []) as string[]);
    if (dryRun) return { ok: true, output: formatDryRun(target) };
    await execute(target);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function formatDryRun(target: Tier3Target): string {
  return `would ssh ${target.sshAlias} and attach tmux session ${target.sessionName} (${target.node})`;
}

// Preserve the old strategy-plugin shape for any host that still loads
// `default.execute(target)`, while making the default export callable by the
// modern plugin dispatcher.
(handler as typeof handler & { execute: typeof execute }).execute = execute;

export default handler as typeof handler & { execute: typeof execute };
