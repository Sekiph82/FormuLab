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

/**
 * FVL-04.014 hardening (Session 7, Part A1) — the same FNV-1a algorithm as
 * `fingerprint()`, run directly over raw bytes rather than a string. Used
 * for binary sources (XLSX) so the file-level fingerprint describes the
 * actual source file bytes, never a lossy string conversion of them and
 * never one selected sheet's own parsed rows. No call-stack-unsafe
 * spread/`String.fromCharCode(...)` over the whole buffer — iterates the
 * `Uint8Array` directly, safe for large files.
 */
export function fingerprintBytes(bytes: ArrayBuffer): string {
  let hash = 0x811c9dc5;
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i++) {
    hash ^= view[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
