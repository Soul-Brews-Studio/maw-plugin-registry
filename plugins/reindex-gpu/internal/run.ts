import { existsSync } from "fs";
import { spawn } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { DEFAULT_BATCH, DEFAULT_ENDPOINT, MODEL, type OpResult, type Options } from "./types";
import { probeWithDefaultFallback } from "./probe";

const VECTOR_COUNT_RE = /vectorized\s+(\d+)\/(\d+)/i;

export async function runReindex(options: Options): Promise<OpResult> {
  const endpoint = options.gpuEndpoint ?? DEFAULT_ENDPOINT;
  const batch = options.batch ?? DEFAULT_BATCH;
  const probe = await probeWithDefaultFallback(endpoint);

  if (!probe.ok) {
    const error = `embed endpoint unreachable: ${probe.error}`;
    console.error(error);
    return { ok: false, error };
  }

  const arraDir = resolveArraDir(options.arraDir);
  const script = join(arraDir, "src/scripts/index-model.ts");
  if (!existsSync(script)) {
    const error = `arra indexer not found: ${script}`;
    console.error(error);
    return { ok: false, error };
  }

  console.log(`reindex via GPU endpoint ${probe.endpoint}`);
  console.log(`OLLAMA_BASE_URL=${probe.baseUrl}`);
  console.log(`batch=${batch} (ORACLE_EMBED_BATCH_SIZE + OLLAMA_EMBED_BATCH)`);
  if (options.dataDir) console.log(`ORACLE_DATA_DIR=${options.dataDir}`);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OLLAMA_BASE_URL: probe.baseUrl,
    // ORACLE_EMBED_BATCH_SIZE is canonical (arra main #1433); OLLAMA_EMBED_BATCH is interim for the deployed VPS arra until it aligns to main.
    ORACLE_EMBED_BATCH_SIZE: String(batch),
    OLLAMA_EMBED_BATCH: String(batch),
    ORACLE_EMBEDDING_MODEL: MODEL,
  };
  if (options.dataDir) env.ORACLE_DATA_DIR = options.dataDir;

  const child = spawn("bun", [script, MODEL], {
    cwd: arraDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let combined = "";
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    combined += text;
    for (const line of text.split(/\r?\n/)) if (line.length > 0) console.log(line);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    combined += text;
    for (const line of text.split(/\r?\n/)) if (line.length > 0) console.error(line);
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  const count = combined.match(VECTOR_COUNT_RE);
  if (count) console.log(`vectorized ${count[1]}/${count[2]}`);

  if (exitCode !== 0) {
    const error = `incomplete reindex: indexer exited ${exitCode}${count ? ` after vectorized ${count[1]}/${count[2]}` : ""}`;
    console.error(error);
    return { ok: false, error };
  }

  return { ok: true, output: count ? `vectorized ${count[1]}/${count[2]}` : "reindex complete" };
}

function resolveArraDir(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.ARRA_DIR) return process.env.ARRA_DIR;
  return join(homedir(), "arra-oracle-v3");
}
