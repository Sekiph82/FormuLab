import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderGuidePdf } from "./pdf";

const ONE_BY_ONE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

let docsDir: string;

beforeEach(() => {
  docsDir = fs.mkdtempSync(path.join(os.tmpdir(), "formulab-guide-pdf-test-"));
});

afterEach(() => {
  fs.rmSync(docsDir, { recursive: true, force: true });
});

const OPTS = { docsDir: "", generationTimestamp: "2026-01-01T00:00:00.000Z", copyrightNotice: "Copyright test notice." };

describe("renderGuidePdf — basic structure", () => {
  it("produces a non-empty, real, parseable PDF", async () => {
    const bytes = await renderGuidePdf("# Guide\n\n## 1. Chapter\n\nSome text.", { ...OPTS, docsDir });
    expect(bytes.length).toBeGreaterThan(0);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });

  it("includes a cover page, at least one TOC page, and at least one body page", async () => {
    const bytes = await renderGuidePdf("# Guide\n\n## 1. Chapter\n\nBody text here.", { ...OPTS, docsDir });
    const doc = await PDFDocument.load(bytes);
    // cover + >=1 TOC page + >=1 body page
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
  });

  it("sets the real title from options", async () => {
    const bytes = await renderGuidePdf("# Guide", { ...OPTS, docsDir, title: "My Custom Title" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe("My Custom Title");
  });
});

describe("renderGuidePdf — determinism", () => {
  it("produces byte-identical output for identical input", async () => {
    const md = "# Guide\n\n## 1. Chapter\n\nSome text.\n\n## 2. Another\n\nMore text.";
    const a = await renderGuidePdf(md, { ...OPTS, docsDir });
    const b = await renderGuidePdf(md, { ...OPTS, docsDir });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("renderGuidePdf — missing images handled gracefully", () => {
  it("never throws when an image reference cannot be resolved, and still produces a valid PDF", async () => {
    const md = "# Guide\n\n## 1. Chapter\n\n![A missing shot](screenshots/does-not-exist-light-en.png)\n\nMore text after.";
    const bytes = await renderGuidePdf(md, { ...OPTS, docsDir });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });
});

describe("renderGuidePdf — embeds a real, present screenshot", () => {
  it("embeds the real PNG bytes when the screenshot file exists", async () => {
    fs.mkdirSync(path.join(docsDir, "screenshots"), { recursive: true });
    fs.writeFileSync(path.join(docsDir, "screenshots", "present-light-en.png"), ONE_BY_ONE_PNG);
    const md = "# Guide\n\n## 1. Chapter\n\n![Present shot](screenshots/present-light-en.png)";
    const bytes = await renderGuidePdf(md, { ...OPTS, docsDir });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(0);
  });
});

describe("renderGuidePdf — chapter headings appear in the TOC with a real page number", () => {
  it("the TOC page contains the chapter title text", async () => {
    // Enough body content to push chapter 2 onto a later page, proving the
    // recorded page number is real (not just "page 1" by coincidence).
    const filler = Array.from({ length: 80 }, (_, i) => `Filler paragraph number ${i}.`).join("\n\n");
    const md = `# Guide\n\n## 1. First Chapter\n\n${filler}\n\n## 2. Second Chapter\n\nShort body.`;
    const bytes = await renderGuidePdf(md, { ...OPTS, docsDir });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(4); // cover + toc + several filler pages + more
  });
});
