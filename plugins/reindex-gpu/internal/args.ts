import { DEFAULT_BATCH, DEFAULT_ENDPOINT, DEFAULT_TUNNEL_LOCAL_PORT, DEFAULT_TUNNEL_REMOTE_PORT, type Options, type ParsedRequest, type TunnelAction } from "./types";

const HELP_FLAGS = new Set(["--help", "-h", "help"]);

export function parseCliArgs(args: string[]): ParsedRequest {
  const help = args.length === 0 || args.some((arg) => HELP_FLAGS.has(arg));
  const command = normalizeCommand(args[0] ?? "status");
  const tunnelAction = normalizeTunnelAction(command === "tunnel" ? args[1] : undefined);
  const flags = command === "tunnel" ? args.slice(2) : args.slice(1);

  return {
    command,
    tunnelAction,
    options: parseFlags(flags),
    help,
  };
}

export function parseApiArgs(args: Record<string, unknown>): ParsedRequest {
  const method = String(args.method ?? args.httpMethod ?? "").toUpperCase();
  const command = normalizeCommand(String(args.command ?? (method === "GET" ? "status" : "run")));
  const tunnelAction = normalizeTunnelAction(args.action === undefined ? undefined : String(args.action));

  return {
    command,
    tunnelAction,
    options: {
      gpuEndpoint: stringOpt(args.gpuEndpoint ?? args["gpu-endpoint"] ?? args.endpoint) ?? DEFAULT_ENDPOINT,
      batch: numberOpt(args.batch) ?? DEFAULT_BATCH,
      dataDir: stringOpt(args.dataDir ?? args["data-dir"]),
      arraDir: stringOpt(args.arraDir ?? args["arra-dir"]),
      remote: stringOpt(args.remote),
      localPort: numberOpt(args.localPort ?? args["local-port"]) ?? DEFAULT_TUNNEL_LOCAL_PORT,
      remotePort: numberOpt(args.remotePort ?? args["remote-port"]) ?? DEFAULT_TUNNEL_REMOTE_PORT,
    },
    help: Boolean(args.help),
  };
}

function parseFlags(args: string[]): Options {
  const options: Options = {
    gpuEndpoint: DEFAULT_ENDPOINT,
    batch: DEFAULT_BATCH,
    localPort: DEFAULT_TUNNEL_LOCAL_PORT,
    remotePort: DEFAULT_TUNNEL_REMOTE_PORT,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const [flag, inline] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];
    const next = inline ?? args[++i];

    if (flag === "--gpu-endpoint" || flag === "--endpoint") options.gpuEndpoint = requireValue(flag, next);
    else if (flag === "--batch") options.batch = parsePositiveInt(flag, requireValue(flag, next));
    else if (flag === "--data-dir") options.dataDir = requireValue(flag, next);
    else if (flag === "--arra-dir") options.arraDir = requireValue(flag, next);
    else if (flag === "--remote") options.remote = requireValue(flag, next);
    else if (flag === "--local-port") options.localPort = parsePositiveInt(flag, requireValue(flag, next));
    else if (flag === "--remote-port") options.remotePort = parsePositiveInt(flag, requireValue(flag, next));
    else throw new Error(`unknown flag: ${flag}`);
  }

  return options;
}

function normalizeCommand(command: string): string {
  if (command === "r" || command === "index") return "run";
  if (command === "s" || command === "check") return "status";
  return command;
}

function normalizeTunnelAction(action: string | undefined): TunnelAction {
  if (!action) return "up";
  if (action === "up" || action === "down") return action;
  throw new Error("usage: maw reindex-gpu tunnel <up|down> [--remote <host>] [--local-port <n>] [--remote-port <n>]");
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveInt(flag: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function stringOpt(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOpt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}
