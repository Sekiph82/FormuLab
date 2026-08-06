import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPngDimensions, resolveScreenshotSrc } from "./screenshots";

/** A real, valid, minimal 1x1 PNG (not a captured UI screenshot — a test
 *  fixture proving the "found" code path actually decodes and embeds a
 *  real image, since no real guide screenshot exists yet this session). */
const ONE_BY_ONE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

let docsDir: string;

beforeEach(() => {
  docsDir = fs.mkdtempSync(path.join(os.tmpdir(), "formulab-guide-screenshots-test-"));
});

afterEach(() => {
  fs.rmSync(docsDir, { recursive: true, force: true });
});

describe("resolveScreenshotSrc — missing image (the current real state of every manifest entry)", () => {
  it("returns found: false with an explanatory reason, never throws", () => {
    const result = resolveScreenshotSrc(docsDir, "screenshots/does-not-exist-light-en.png");
    expect(result.found).toBe(false);
    if (!result.found) expect(result.reason).toContain("not yet captured");
  });
});

describe("resolveScreenshotSrc — a real, present image", () => {
  it("returns found: true with the real file bytes", () => {
    fs.mkdirSync(path.join(docsDir, "screenshots"), { recursive: true });
    fs.writeFileSync(path.join(docsDir, "screenshots", "present-light-en.png"), ONE_BY_ONE_PNG);
    const result = resolveScreenshotSrc(docsDir, "screenshots/present-light-en.png");
    expect(result.found).toBe(true);
    if (result.found) expect(Buffer.from(result.bytes)).toEqual(ONE_BY_ONE_PNG);
  });
});

describe("readPngDimensions", () => {
  it("reads the real width/height out of a valid PNG's IHDR chunk", () => {
    expect(readPngDimensions(new Uint8Array(ONE_BY_ONE_PNG))).toEqual({ width: 1, height: 1 });
  });

  it("throws on a non-PNG buffer rather than returning a fabricated size", () => {
    expect(() => readPngDimensions(new Uint8Array([0, 1, 2, 3]))).toThrow(/not a PNG/);
  });
});
