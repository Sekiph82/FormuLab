/**
 * A small, synchronous, deterministic string fingerprint — FNV-1a, 32-bit,
 * hex-encoded. Not a cryptographic hash and never used as one: this exists
 * only so a schema/raw-record fingerprint can be computed the same way in
 * the shared package (Node and browser both, no Web Crypto dependency) and
 * stay stable across runs. Same input, same output, always.
 */
export function fingerprint(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
