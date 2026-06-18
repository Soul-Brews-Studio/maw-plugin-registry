import { DEFAULT_ENDPOINT, type OpResult, type Options } from "./types";
import { probeWithDefaultFallback } from "./probe";

export async function status(options: Options): Promise<OpResult> {
  const endpoint = options.gpuEndpoint ?? DEFAULT_ENDPOINT;
  const probe = await probeWithDefaultFallback(endpoint);
  if (!probe.ok) {
    const error = `embed endpoint unreachable: ${probe.error}`;
    console.log(error);
    return { ok: false, error };
  }

  const dimText = probe.dimensions === 1024 ? "1024-dim" : `${probe.dimensions ?? "unknown"}-dim`;
  const output = `reachable: ${probe.endpoint} responds for bge-m3 (${dimText})`;
  console.log(output);
  return { ok: true, output };
}

export function showHelp(): void {
  console.log(`maw reindex-gpu <command> [flags]

Commands:
  status [--gpu-endpoint <url>]                 POST /api/embed probe for bge-m3
  run [--gpu-endpoint <url>] [--batch <n>]      precheck, then bun <arra>/src/scripts/index-model.ts bge-m3
      [--data-dir <p>] [--arra-dir <p>]
  tunnel up [--remote <host>] [--local-port 11435] [--remote-port 11434]
  tunnel down
  setup [--gpu-endpoint <url>] [--remote <host>]

Defaults:
  --gpu-endpoint https://embed.oracles.asia/api/embed
  --batch 128
  --arra-dir $ARRA_DIR or ~/arra-oracle-v3`);
}
