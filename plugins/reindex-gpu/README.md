# reindex-gpu

`reindex-gpu` is a thin maw plugin that orchestrates GPU-backed arra reindexing. It does not embed or index documents itself; it validates the GPU embed endpoint, sets the environment arra expects, and delegates to:

```sh
bun <ARRA_DIR>/src/scripts/index-model.ts bge-m3
```

`ARRA_DIR` is discovered from `--arra-dir`, then `$ARRA_DIR`, then `~/arra-oracle-v3`.

## Commands

```sh
maw reindex-gpu status [--gpu-endpoint <url>]
maw reindex-gpu run --gpu-endpoint <url> --batch <n> [--data-dir <p>] [--arra-dir <p>]
maw reindex-gpu tunnel up --remote <host> [--local-port 11435] [--remote-port 11434]
maw reindex-gpu tunnel down
maw reindex-gpu setup [--gpu-endpoint <url>] [--remote <host>]
```

The default endpoint is `https://embed.oracles.asia/api/embed`; if that default is unreachable, the plugin tries `http://115.73.210.129:23882/api/embed`. The gateway also allows `/api/embeddings`, so unpatched arra can still use the same base URL after the plugin strips `/api/embed` or `/api/embeddings`.

## Safety contract

- Dedicated GPU only. Shared `nvshare` GPUs have crashed during indexing; use a dedicated GPU for production reindex jobs.
- Retry and fail-closed behavior is mandatory. A partial reindex must exit non-zero, and this plugin treats any non-zero arra indexer exit as incomplete.
- High tunnel RTT should use larger batches, usually `--batch 128`. Local or shared environments should use smaller batches to reduce timeout and memory pressure.

Before `run`, the plugin sends a real POST to the exact `/api/embed` endpoint:

```json
{"model":"bge-m3","input":["ping"]}
```

It expects HTTP 200 plus an `embeddings` array. If the probe fails or times out after 8 seconds, the plugin fails closed and does not start the arra indexer.

## API

- `GET /api/reindex-gpu` maps to `status`.
- `POST /api/reindex-gpu` maps to `run`.

API arguments use the same flags as object keys, for example `gpuEndpoint`, `batch`, `dataDir`, and `arraDir`.
