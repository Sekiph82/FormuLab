/**
 * Phase 10 Session 6 — DOCX rendering of the illustrated user guide.
 * Same `docx` package `documentExports/dossierDocx.ts` already uses, but
 * a guide-appropriate content model (see `markdown.ts`), and a genuinely
 * richer "internal document structure" than the PDF path can offer: real
 * Word heading styles (`HeadingLevel.HEADING_1/2/3`) drive Word's own
 * navigation pane, and a native `TableOfContents` field auto-populates
 * real page numbers when Word opens the document and updates fields —
 * not a hand-computed page-number map like `pdf.ts` has to build.
 *
 * Known non-determinism (same as `dossierDocx.ts`, same reason): the
 * `docx` package's public API exposes no way to override its zip-archive
 * timestamps, so byte-for-byte output is not guaranteed even for
 * identical input. `docx.test.ts` compares the extracted `word/
 * document.xml` content instead — see that file's own comment.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { parseGuideMarkdown, parseInlineSegments } from "./markdown";
import { readPngDimensions, resolveScreenshotSrc } from "./screenshots";

export interface GuideDocxOptions {
  title?: string;
  docsDir: string;
  copyrightNotice: string;
}

const CALLOUT_COLOR: Record<"warning" | "note", string> = {
  warning: "990000",
  note: "1A4488",
};

function textRuns(text: string): TextRun[] {
  return parseInlineSegments(text).map((seg) => new TextRun({ text: seg.text, bold: seg.bold }));
}

function tableCell(text: string, bold: boolean): TableCell {
  return new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

export async function renderGuideDocx(markdown: string, options: GuideDocxOptions): Promise<Uint8Array> {
  const blocks = parseGuideMarkdown(markdown);
  const title = options.title ?? "FormuLab User Guide";

  const children: (Paragraph | Table | TableOfContents)[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
    new Paragraph({ children: [new TextRun({ text: "Local-first formulation research workbench", italics: true })] }),
    ...options.copyrightNotice.split("\n").map((line) => new Paragraph({ children: [new TextRun({ text: line, size: 18, color: "666666" })] })),
    new Paragraph({ text: "", pageBreakBefore: true }),
    new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
    new Paragraph({ text: "", pageBreakBefore: true }),
  ];

  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const level = block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
        children.push(new Paragraph({ text: block.text, heading: level }));
        break;
      }
      case "paragraph":
        children.push(new Paragraph({ children: textRuns(block.text) }));
        break;
      case "listItem":
        children.push(new Paragraph({ children: textRuns(block.text), bullet: { level: 0 } }));
        break;
      case "callout": {
        const label = block.tone === "warning" ? "Warning" : "Note";
        children.push(
          new Paragraph({
            children: [new TextRun({ text: `${label}: `, bold: true, color: CALLOUT_COLOR[block.tone] }), new TextRun({ text: block.text, color: CALLOUT_COLOR[block.tone] })],
          }),
        );
        break;
      }
      case "codeBlock":
        for (const line of block.text.split("\n")) {
          children.push(new Paragraph({ children: [new TextRun({ text: line, font: "Courier New", size: 18 })] }));
        }
        break;
      case "table": {
        const headerRow = new TableRow({ children: block.headers.map((h) => tableCell(h, true)) });
        const rows = block.rows.map((r) => new TableRow({ children: r.map((c) => tableCell(c, false)) }));
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [headerRow, ...rows],
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
              insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
            },
          }),
        );
        break;
      }
      case "image": {
        const resolved = resolveScreenshotSrc(options.docsDir, block.src);
        if (resolved.found) {
          const { width, height } = readPngDimensions(resolved.bytes);
          const maxWidth = 500;
          const scale = Math.min(maxWidth / width, 1);
          children.push(
            new Paragraph({
              children: [new ImageRun({ type: "png", data: resolved.bytes, transformation: { width: width * scale, height: height * scale } })],
            }),
          );
          children.push(new Paragraph({ children: [new TextRun({ text: block.alt, italics: true, size: 16, color: "666666" })] }));
        } else {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: `[Screenshot not yet captured: ${block.alt}]`, italics: true, color: "888888" })],
            }),
          );
        }
        break;
      }
    }
  }

  const doc = new Document({
    creator: "FormuLab",
    title,
    subject: "FormuLab illustrated user guide",
    description: options.copyrightNotice,
    sections: [
      {
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun("Page "), new TextRun({ children: [PageNumber.CURRENT] }), new TextRun(" of "), new TextRun({ children: [PageNumber.TOTAL_PAGES] })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const arrayBuffer = await Packer.toArrayBuffer(doc);
  return new Uint8Array(arrayBuffer);
}
