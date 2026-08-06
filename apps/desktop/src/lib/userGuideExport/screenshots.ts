/**
 * Phase 10 Session 6 — resolves a guide `image` block's `src` (a path
 * relative to `docs/`, e.g. `screenshots/formulation-live-generation-
 * light-en.png`) against a real file on disk. Pure aside from the single
 * `fs.readFileSync`/`fs.existsSync` call each resolution needs — never
 * throws on a missing file, since "graceful handling of missing images" is
 * a hard requirement here (every screenshot is genuinely missing this
 * session — see `docs/PHASE10_SCREENSHOT_MANIFEST.json`, every entry's
 * `lastCapturedCommit` is still `null`).
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface ResolvedScreenshot {
  found: true;
  bytes: Uint8Array;
  absolutePath: string;
}

export interface MissingScreenshot {
  found: false;
  reason: string;
}

export function resolveScreenshotSrc(docsDir: string, src: string): ResolvedScreenshot | MissingScreenshot {
  const absolutePath = path.join(docsDir, ...src.split("/"));
  if (!fs.existsSync(absolutePath)) {
    return { found: false, reason: `not yet captured (docs/PHASE10_SCREENSHOT_MANIFEST.json still has lastCapturedCommit: null for it): ${src}` };
  }
  const bytes = fs.readFileSync(absolutePath);
  return { found: true, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), absolutePath };
}

/** Reads the pixel width/height straight out of a PNG's IHDR chunk
 *  (bytes 16-23, big-endian uint32 each) — `docx`'s `ImageRun` needs real
 *  dimensions for its `transformation` option and exposes no PNG decoder
 *  of its own (unlike `pdf-lib`'s `embedPng`, which `pdf.ts` uses
 *  instead). Throws on a non-PNG buffer — every screenshot this system
 *  produces is a PNG by convention (the naming convention itself ends
 *  `.png`), so a different format here would be a real bug to surface,
 *  not silently paper over. */
export function readPngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const isPng = bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!isPng) throw new Error("readPngDimensions: not a PNG file (missing PNG signature)");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}
