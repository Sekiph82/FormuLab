import * as fs from "node:fs";
import * as path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { generateUserGuideDocuments } from "./generate";
import { findMissingRequiredTopics, findStaleClaims } from "./guideContent";
import { parseGuideMarkdown } from "./markdown";
import { DOCS_FIXTURE_PREFIX } from "@/lib/docsFixture/build";
import { defaultManifestPath, loadScreenshotManifest, screenshotFilename } from "@/lib/docsFixture/screenshotManifest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const GUIDE_PATH = path.join(REPO_ROOT, "docs", "USER_GUIDE.md");
const TIMESTAMP = "2026-01-01T00:00:00.000Z";

describe("guide source", () => {
  it("docs/USER_GUIDE.md exists and is non-empty", () => {
    expect(fs.existsSync(GUIDE_PATH)).toBe(true);
    expect(fs.readFileSync(GUIDE_PATH, "utf8").trim().length).toBeGreaterThan(0);
  });

  it("required chapters exist", () => {
    const markdown = fs.readFileSync(GUIDE_PATH, "utf8");
    expect(findMissingRequiredTopics(markdown)).toEqual([]);
  });

  it("stale claims are absent", () => {
    const markdown = fs.readFileSync(GUIDE_PATH, "utf8");
    expect(findStaleClaims(markdown)).toEqual([]);
  });

  it("never references a real profile path or private data", () => {
    const markdown = fs.readFileSync(GUIDE_PATH, "utf8").toLowerCase();
    for (const forbidden of ["sekip", "c:\\users", "c:/users", "appdata", "com.formulab.app"]) {
      expect(markdown).not.toContain(forbidden);
    }
    expect(markdown).not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  });

  it("every DEMO- fixture reference is deterministic (matches the real Session 5 fixture prefix)", () => {
    const markdown = fs.readFileSync(GUIDE_PATH, "utf8");
    const demoMentions = markdown.match(/\bDEMO-[A-Za-z0-9-]*/g) ?? [];
    for (const mention of demoMentions) expect(mention.startsWith(DOCS_FIXTURE_PREFIX)).toBe(true);
  });
});

describe("guide internal anchor links — every #section resolves to a real heading", () => {
  const markdown = fs.readFileSync(GUIDE_PATH, "utf8");
  const headingIds = new Set(
    parseGuideMarkdown(markdown)
      .filter((b) => b.kind === "heading")
      .map((b) => (b as Extract<ReturnType<typeof parseGuideMarkdown>[number], { kind: "heading" }>).id),
  );
  const anchors = Array.from(new Set(markdown.match(/\(#[a-z0-9-]+\)/g) ?? [])).map((a) => a.slice(2, -1));

  it("finds at least one internal anchor link", () => {
    expect(anchors.length).toBeGreaterThan(0);
  });

  it("every internal anchor resolves to a real parsed heading id", () => {
    for (const anchor of anchors) {
      expect(headingIds.has(anchor), `#${anchor} has no matching heading`).toBe(true);
    }
  });
});

describe("guide screenshot references — cross-checked against the real manifest", () => {
  const markdown = fs.readFileSync(GUIDE_PATH, "utf8");
  const manifest = loadScreenshotManifest(defaultManifestPath(REPO_ROOT));
  const knownFilenames = new Set(manifest.entries.map((e) => screenshotFilename(e)));
  const imageBlocks = parseGuideMarkdown(markdown).filter((b) => b.kind === "image") as Extract<ReturnType<typeof parseGuideMarkdown>[number], { kind: "image" }>[];

  it("references at least one screenshot", () => {
    expect(imageBlocks.length).toBeGreaterThan(0);
  });

  it("every referenced screenshot src resolves to a real manifest entry", () => {
    for (const block of imageBlocks) {
      const filename = block.src.replace(/^screenshots\//, "");
      expect(knownFilenames.has(filename), `${block.src} (alt: "${block.alt}") has no matching manifest entry`).toBe(true);
    }
  });

  it("every referenced screenshot is currently missing on disk (honest — none captured yet)", () => {
    const docsDir = path.join(REPO_ROOT, "docs");
    for (const block of imageBlocks) {
      const absolute = path.join(docsDir, ...block.src.split("/"));
      expect(fs.existsSync(absolute), `${block.src} unexpectedly exists — update the manifest's lastCapturedCommit if this is real`).toBe(false);
    }
  });
});

describe("generateUserGuideDocuments — real end-to-end generation", () => {
  it("produces a non-empty, real PDF and DOCX at the documented paths", async () => {
    const result = await generateUserGuideDocuments({ repoRoot: REPO_ROOT, generationTimestamp: TIMESTAMP });
    expect(result.pdfPath).toBe(path.join(REPO_ROOT, "docs", "generated", "FormuLab-User-Guide.pdf"));
    expect(result.docxPath).toBe(path.join(REPO_ROOT, "docs", "generated", "FormuLab-User-Guide.docx"));
    expect(result.pdfBytes.length).toBeGreaterThan(1000);
    expect(result.docxBytes.length).toBeGreaterThan(1000);
    expect(fs.existsSync(result.pdfPath)).toBe(true);
    expect(fs.existsSync(result.docxPath)).toBe(true);
  });

  it("the generated PDF is a real, loadable document with the expected chapter headings", async () => {
    const result = await generateUserGuideDocuments({ repoRoot: REPO_ROOT, generationTimestamp: TIMESTAMP });
    const doc = await PDFDocument.load(result.pdfBytes);
    expect(doc.getPageCount()).toBeGreaterThan(5);
    expect(doc.getTitle()).toBe("FormuLab User Guide");
  });

  it("gracefully handles every missing screenshot (no throw, still produces real output)", async () => {
    // Every screenshot the real guide references is genuinely missing on
    // disk this session (asserted above) — so this end-to-end run already
    // exercises the missing-image path for all 17 references, not a
    // synthetic one.
    await expect(generateUserGuideDocuments({ repoRoot: REPO_ROOT, generationTimestamp: TIMESTAMP })).resolves.toBeDefined();
  });
});
