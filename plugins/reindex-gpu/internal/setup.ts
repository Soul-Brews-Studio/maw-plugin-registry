import { status } from "./status";
import { tunnel } from "./tunnel";
import type { OpResult, Options } from "./types";

export async function setupGpu(options: Options): Promise<OpResult> {
  const statusResult = await status(options);
  if (!statusResult.ok) return statusResult;
  if (!options.remote) return statusResult;
  return tunnel("up", options);
}
