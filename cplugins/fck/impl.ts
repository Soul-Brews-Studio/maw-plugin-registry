export type RunResult = { code: number; stdout: string; stderr: string };
export type Runner = (argv: string[], opts?: { stdin?: string }) => Promise<RunResult>;

export type FckOptions = {
  command?: string;
  stdout?: string;
  stderr?: string;
  json?: boolean;
  execute?: boolean;
  yes?: boolean;
  ai?: boolean;
  list?: boolean;
  installShell?: boolean;
};

export type Correction = {
  ok: boolean;
  candidate?: string;
  source?: string;
  confidence?: number;
  risk?: "low" | "medium" | "high";
  rationale?: string;
  requiresConfirmation?: boolean;
  error?: string;
  installHint?: string;
  executed?: RunResult;
};

const MAX_TEXT = 8_000;

export function parseFckArgs(args: string[]): FckOptions {
  const opts: FckOptions = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const readValue = (name: string): string => {
      const inline = arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : undefined;
      if (inline !== undefined) return inline;
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
      return value;
    };
    if (arg === "--command" || arg.startsWith("--command=")) opts.command = readValue("--command");
    else if (arg === "--stderr" || arg.startsWith("--stderr=")) opts.stderr = readValue("--stderr");
    else if (arg === "--stdout" || arg.startsWith("--stdout=")) opts.stdout = readValue("--stdout");
    else if (arg === "--json") opts.json = true;
    else if (arg === "--execute" || arg === "-x") opts.execute = true;
    else if (arg === "--yes" || arg === "-y") opts.yes = true;
    else if (arg === "--ai" || arg === "--spark") opts.ai = true;
    else if (arg === "--list") opts.list = true;
    else if (arg === "--install-shell") opts.installShell = true;
    else if (!arg.startsWith("-") && !opts.command) opts.command = args.slice(i).join(" ");
    else throw new Error(`unknown fck argument: ${arg}`);
  }
  opts.command ??= process.env.MAW_FCK_COMMAND;
  opts.stderr ??= process.env.MAW_FCK_STDERR ?? process.env.MAW_FCK_OUTPUT;
  opts.stdout ??= process.env.MAW_FCK_STDOUT;
  return opts;
}

function bounded(value?: string): string {
  return (value ?? "").slice(-MAX_TEXT);
}

function replaceFirstCommandToken(command: string, replacement: string): string {
  const parts = command.trim().split(/\s+/);
  if (parts[0] !== "maw" || parts.length < 2) return command;
  parts[1] = replacement;
  return parts.join(" ");
}

function replaceFlag(command: string, badFlag: string, goodFlag: string): string {
  return command.replace(new RegExp(`(^|\\s)${escapeRegExp(badFlag)}(?=$|\\s|=)`, "g"), `$1${goodFlag}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function staticCorrection(opts: FckOptions): Correction | null {
  const command = opts.command?.trim();
  const output = `${bounded(opts.stdout)}\n${bounded(opts.stderr)}`;
  if (!command) return null;

  const disabled = output.match(/['`]([a-z][a-z0-9-]*)['`] is installed but disabled[\s\S]*?maw plugin enable ([a-z][a-z0-9-]*)/i);
  if (disabled) {
    const plugin = disabled[2] ?? disabled[1]!;
    return {
      ok: true,
      candidate: `maw plugin enable ${plugin}`,
      source: "maw-static:disabled-plugin",
      confidence: 0.98,
      risk: "low",
      rationale: `Maw reported plugin '${plugin}' is installed but disabled.`,
      requiresConfirmation: false,
    };
  }

  const flag = output.match(/Unknown flag\s+(`?--[A-Za-z0-9-]+`?).*?(?:Did you mean|did you mean)\s+(`?--[A-Za-z0-9-]+`?)/is);
  if (flag) {
    const bad = flag[1]!.replace(/`/g, "");
    const good = flag[2]!.replace(/`/g, "");
    return {
      ok: true,
      candidate: replaceFlag(command, bad, good),
      source: "maw-static:flag-suggestion",
      confidence: 0.94,
      risk: "low",
      rationale: `Replace unknown flag ${bad} with suggested flag ${good}.`,
      requiresConfirmation: true,
    };
  }

  const unknown = output.match(/unknown command:\s*([a-z][a-z0-9-]*)[\s\S]*?did you mean:\s*([a-z][a-z0-9-]*)/i);
  if (unknown && command.startsWith("maw ")) {
    return {
      ok: true,
      candidate: replaceFirstCommandToken(command, unknown[2]!),
      source: "maw-static:command-suggestion",
      confidence: 0.82,
      risk: "low",
      rationale: `Maw suggested '${unknown[2]}' for unknown command '${unknown[1]}'.`,
      requiresConfirmation: true,
    };
  }

  if (/command not found:\s*maw|maw:\s*command not found/i.test(output)) {
    return {
      ok: true,
      candidate: "bun link maw-js",
      source: "maw-static:maw-not-found",
      confidence: 0.72,
      risk: "low",
      rationale: "The maw binary was not found; if this repo is linked locally, bun link restores the command.",
      requiresConfirmation: true,
    };
  }

  return null;
}

export async function defaultRunner(argv: string[], opts: { stdin?: string } = {}): Promise<RunResult> {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", stdin: opts.stdin ? "pipe" : "ignore" });
  if (opts.stdin && proc.stdin) {
    proc.stdin.write(opts.stdin);
    proc.stdin.end();
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout: stdout.slice(-MAX_TEXT), stderr: stderr.slice(-MAX_TEXT) };
}

export async function upstreamCorrection(opts: FckOptions, run: Runner = defaultRunner): Promise<Correction | null> {
  const command = opts.command?.trim();
  if (!command) return null;
  const args = ["thefuck"];
  if (opts.yes) args.push("--yes");
  args.push("--", ...command.split(/\s+/));
  const result = await run(args);
  if (result.code === 127 || /not found|No such file/i.test(result.stderr)) {
    return {
      ok: false,
      source: "thefuck",
      error: "thefuck binary not found",
      installHint: "Install upstream first, e.g. pipx install thefuck or brew install thefuck. Then rerun maw fck.",
    };
  }
  const text = `${result.stdout}\n${result.stderr}`.trim();
  if (result.code !== 0 && !text) return null;
  const candidate = text.split("\n").map((s) => s.trim()).filter(Boolean).find((line) => !/^No fucks given/i.test(line));
  if (!candidate) return null;
  return {
    ok: true,
    candidate,
    source: "thefuck",
    confidence: 0.7,
    risk: "medium",
    rationale: "Upstream thefuck produced a correction.",
    requiresConfirmation: true,
  };
}

export async function executeCandidate(candidate: string, run: Runner): Promise<RunResult> {
  return run(["sh", "-lc", candidate]);
}

export async function correct(opts: FckOptions, run: Runner = defaultRunner): Promise<Correction> {
  const staticHit = staticCorrection(opts);
  let correction = staticHit ?? await upstreamCorrection(opts, run);
  if (!correction) {
    correction = {
      ok: false,
      error: opts.command ? "no correction found" : "no failed command provided",
      installHint: opts.command ? "Try installing upstream thefuck for broader rules: pipx install thefuck" : "Pass --command '<failed command>' or set MAW_FCK_COMMAND from shell integration.",
    };
  }

  if (opts.ai && !correction.ok) {
    correction.installHint = `${correction.installHint ?? ""}\nSpark fallback is intentionally not implemented in v0.1.0; it will remain opt-in with JSON/risk guards.`.trim();
  }

  if (opts.execute && correction.ok && correction.candidate) {
    if (!opts.yes) {
      correction.requiresConfirmation = true;
      correction.error = "refusing to execute without --yes";
      return correction;
    }
    correction.executed = await executeCandidate(correction.candidate, run);
  }
  return correction;
}

export function listProviders(): string {
  return [
    "fck providers:",
    "  maw-static        disabled plugin, unknown command, flag typo, maw not found",
    "  thefuck          upstream binary wrapper when installed",
    "  codex-spark      planned opt-in fallback; not active in v0.1.0",
  ].join("\n");
}

export function shellSnippet(): string {
  return [
    "# maw fck shell helper (manual v0.1.0)",
    "# Capture a failed command explicitly:",
    "#   MAW_FCK_COMMAND='maw bud foo --orgs acme' MAW_FCK_STDERR='Unknown flag --orgs. Did you mean --org?' maw fck",
    "alias fck='maw fck'",
    "alias fuck='maw fck'",
    "alias please='maw fck'",
  ].join("\n");
}

export function formatCorrection(c: Correction): string {
  if (c.ok && c.candidate) {
    const lines = [`${c.candidate}`, `  source: ${c.source ?? "unknown"}`];
    if (c.rationale) lines.push(`  why: ${c.rationale}`);
    if (c.executed) lines.push(`  executed: exit ${c.executed.code}`);
    if (c.error) lines.push(`  note: ${c.error}`);
    return lines.join("\n");
  }
  return [`no correction: ${c.error ?? "unknown"}`, c.installHint ? `hint: ${c.installHint}` : ""].filter(Boolean).join("\n");
}
