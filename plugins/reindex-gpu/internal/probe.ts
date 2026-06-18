import { DEFAULT_ENDPOINT, FALLBACK_ENDPOINT, MODEL, type ProbeResult } from "./types";

export function endpointToBaseUrl(endpoint: string): string {
  return endpoint.replace(/\/api\/(?:embed|embeddings)\/?$/i, "").replace(/\/$/, "");
}

export async function probeEndpoint(endpoint: string): Promise<ProbeResult> {
  const baseUrl = endpointToBaseUrl(endpoint);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, input: ["ping"] }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return { ok: false, endpoint, baseUrl, error: `HTTP ${response.status} ${response.statusText}`.trim() };
    }

    const json = await response.json() as any;
    const embeddings = json?.embeddings;
    const first = Array.isArray(embeddings) ? embeddings[0] : undefined;
    if (!Array.isArray(embeddings) || !Array.isArray(first)) {
      return { ok: false, endpoint, baseUrl, error: "HTTP 200 but response did not include embeddings[]" };
    }

    return { ok: true, endpoint, baseUrl, dimensions: first.length };
  } catch (e: any) {
    return { ok: false, endpoint, baseUrl, error: errorMessage(e) };
  }
}

export async function probeWithDefaultFallback(endpoint: string): Promise<ProbeResult> {
  const primary = await probeEndpoint(endpoint);
  if (primary.ok || endpoint !== DEFAULT_ENDPOINT) return primary;

  const fallback = await probeEndpoint(FALLBACK_ENDPOINT);
  if (fallback.ok) {
    console.log(`primary endpoint unreachable (${primary.error}); using fallback ${FALLBACK_ENDPOINT}`);
    return fallback;
  }

  return {
    ok: false,
    endpoint,
    baseUrl: primary.baseUrl,
    error: `${primary.error}; fallback ${FALLBACK_ENDPOINT}: ${fallback.error}`,
  };
}

function errorMessage(e: any): string {
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "timeout after 8s";
  if (e instanceof Error) return e.message;
  return String(e);
}
