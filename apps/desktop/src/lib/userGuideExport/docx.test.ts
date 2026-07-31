/**
 * `docx`'s zip-archive timestamps are not overridable through its public
 * API (same known limitation `dossierDocx.ts` documents), so the
 * determinism test compares the extracted `word/document.xml` content —
 * the real document text/structure — rather than the raw byte buffer.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderGuideDocx } from "./docx";

const ONE_BY_ONE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

let docsDir: string;

beforeEach(() => {
  docsDir = fs.mkdtempSync(path.join(os.tmpdir(), "formulab-guide-docx-test-"));
});

afterEach(() => {
  fs.rmSync(docsDir, { recursive: true, force: true });
});

const OPTS = { docsDir: "", copyrightNotice: "Copyright test notice." };

async function documentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("word/document.xml missing from generated docx");
  return file.async("string");
}

describe("renderGuideDocx — basic structure", () => {
  it("produces a non-empty, real, unzippable DOCX", async () => {
    const bytes = await renderGuideDocx("# Guide\n\n## 1. Chapter\n\nSome text.", { ...OPTS, docsDir });
    expect(bytes.length).toBeGreaterThan(0);
    const xml = await documentXml(bytes);
    expect(xml.length).toBeGreaterThan(0);
  });

  it("includes the chapter heading text and a real table of contents field", async () => {
    const bytes = await renderGuideDocx("# Guide\n\n## 1. Chapter One\n\nBody.", { ...OPTS, docsDir });
    const xml = await documentXml(bytes);
    expect(xml).toContain("Chapter One");
    expect(xml).toContain("TOC"); // the native Word TOC field instruction
  });

  it("uses the real title from options", async () => {
    const bytes = await renderGuideDocx("# Guide", { ...OPTS, docsDir, title: "My Custom Title" });
    const xml = await documentXml(bytes);
    expect(xml).toContain("My Custom Title");
  });
});

describe("renderGuideDocx — determinism (structural, per the known docx zip-timestamp limitation)", () => {
  it("produces identical word/document.xml content for identical input", async () => {
    const md = "# Guide\n\n## 1. Chapter\n\nSome text.\n\n## 2. Another\n\nMore text.";
    const a = await renderGuideDocx(md, { ...OPTS, docsDir });
    const b = await renderGuideDocx(md, { ...OPTS, docsDir });
    expect(await documentXml(a)).toBe(await documentXml(b));
  });
});

describe("renderGuideDocx — missing images handled gracefully", () => {
  it("never throws when an image reference cannot be resolved", async () => {
    const md = "# Guide\n\n## 1. Chapter\n\n![A missing shot](screenshots/does-not-exist-light-en.png)\n\nMore text.";
    const bytes = await renderGuideDocx(md, { ...OPTS, docsDir });
    const xml = await documentXml(bytes);
    expect(xml).toContain("not yet captured");
  });
});

describe("renderGuideDocx — embeds a real, present screenshot", () => {
  it("embeds real image media when the screenshot file exists", async () => {
    fs.mkdirSync(path.join(docsDir, "screenshots"), { recursive: true });
    fs.writeFileSync(path.join(docsDir, "screenshots", "present-light-en.png"), ONE_BY_ONE_PNG);
    const md = "# Guide\n\n## 1. Chapter\n\n![Present shot](screenshots/present-light-en.png)";
    const bytes = await renderGuideDocx(md, { ...OPTS, docsDir });
    const zip = await JSZip.loadAsync(bytes);
    const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith("word/media/"));
    expect(mediaFiles.length).toBeGreaterThan(0);
  });
});

describe("renderGuideDocx — tables and callouts render as real content", () => {
  it("includes table cell text and callout text", async () => {
    const md = ["# Guide", "", "## 1. Chapter", "", "| Role | Can approve |", "| --- | --- |", "| chemist | yes |", "", "> **Warning:** be careful."].join("\n");
    const bytes = await renderGuideDocx(md, { ...OPTS, docsDir });
    const xml = await documentXml(bytes);
    expect(xml).toContain("chemist");
    expect(xml).toContain("be careful");
  });
});
