/**
 * Fleet convention: session = "NN-stem", window = "stem-oracle".
 * Strip the slot prefix so `maw sleep 29-foo` resolves to window `foo-oracle`.
 * Explicit window argument is used as-is. (#1181)
 */
export function deriveWindowName(oracle: string, window?: string): string {
  const stem = oracle.replace(/^\d+-/, "");
  return window ?? `${stem}-oracle`;
}
