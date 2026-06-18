export const DEFAULT_ENDPOINT = "https://embed.oracles.asia/api/embed";
export const FALLBACK_ENDPOINT = "http://115.73.210.129:23882/api/embed";
export const MODEL = "bge-m3";
export const DEFAULT_BATCH = 128;
export const DEFAULT_TUNNEL_LOCAL_PORT = 11435;
export const DEFAULT_TUNNEL_REMOTE_PORT = 11434;
export const TUNNEL_PROCESS_NAME = "gpu-embed-tunnel";

export type CommandName = "run" | "status" | "tunnel" | "setup";
export type TunnelAction = "up" | "down";

export interface Options {
  gpuEndpoint?: string;
  batch?: number;
  dataDir?: string;
  arraDir?: string;
  remote?: string;
  localPort?: number;
  remotePort?: number;
}

export interface ParsedRequest {
  command: CommandName | string;
  tunnelAction: TunnelAction;
  options: Options;
  help: boolean;
}

export interface OpResult {
  ok: boolean;
  output?: string;
  error?: string;
}

export interface ProbeResult {
  ok: boolean;
  endpoint: string;
  baseUrl: string;
  dimensions?: number;
  error?: string;
}
