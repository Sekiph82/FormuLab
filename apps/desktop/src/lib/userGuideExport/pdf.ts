/**
 * Phase 10 Session 6 — deterministic PDF rendering of the illustrated user
 * guide. Same low-level `pdf-lib` text-drawing discipline as
 * `documentExports/dossierPdf.ts` (no HTML/DOM-to-PDF conversion, every
 * date comes from the caller's `generationTimestamp`, never a bare
 * `new Date()`) — but a genuinely different, richer content model built
 * for a long illustrated guide rather than a single dossier snapshot:
 * a cover page, a real table of contents with real page numbers (a
 * two-pass render — body pages are laid out first, recording which
 * absolute page number each chapter heading landed on, then the reserved
 * TOC pages are drawn from that map), embedded screenshots with captions,
 * tone-colored callouts, bordered tables, and a running "Page X of Y"
 * footer on every page.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import { parseGuideMarkdown, type GuideBlock } from "./markdown";
import { resolveScreenshotSrc } from "./screenshots";

const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const FOOTER_HEIGHT = 24;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_GAP = 4;
const MAX_IMAGE_HEIGHT = 260;

export interface GuidePdfOptions {
  title?: string;
  /** The `docs/` directory — screenshot `src` paths in the markdown are
   *  relative to it (`screenshots/<file>.png`). */
  docsDir: string;
  /** ISO instant. Never defaulted to `new Date()` internally — determinism
   *  requires the caller to supply a fixed value. */
  generationTimestamp: string;
  copyrightNotice: string;
}

/** Characters the guide's real prose uses that `pdf-lib`'s standard
 *  WinAnsi-encoded fonts cannot draw — embedding a full Unicode font
 *  (`fontkit`) just to cover two symbols is not worth the new dependency,
 *  so both are normalized to a safe ASCII equivalent instead. Caught by
 *  `generate.test.ts`'s real end-to-end run against the actual guide text
 *  (not a synthetic fixture) — "✕" appears in the onboarding-dismiss
 *  description, "→" nowhere structural, but both are real guide content. */
const PDF_TEXT_REPLACEMENTS: readonly [string, string][] = [
  ["✕", "x"], // ✕
  ["→", "->"], // →
];
/** Extended WinAnsi (cp1252) code points beyond plain Latin-1 that the
 *  guide's real prose already relies on (em/en dash, ellipsis, section
 *  sign, curly quotes, multiplication sign) — kept as-is; anything else
 *  outside this allowlist falls back to "?" rather than crashing the
 *  whole render on the next uncommon character someone adds later. */
const WINANSI_SAFE_EXTENDED = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x2022, 0x00a7, 0x00b0, 0x00b5, 0x00d7, 0x2122, 0x00a9, 0x00ae]);

function sanitizeForPdf(text: string): string {
  let out = text;
  for (const [from, to] of PDF_TEXT_REPLACEMENTS) out = out.split(from).join(to);
  return Array.from(out)
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      if (cp <= 0xff || WINANSI_SAFE_EXTENDED.has(cp)) return ch;
      return "?";
    })
    .join("");
}

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = sanitizeForPdf(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

const CALLOUT_COLOR: Record<"warning" | "note", RGB> = {
  warning: rgb(0.6, 0, 0),
  note: rgb(0.1, 0.25, 0.55),
};

export async function renderGuidePdf(markdown: string, options: GuidePdfOptions): Promise<Uint8Array> {
  const blocks = parseGuideMarkdown(markdown);
  const genDate = new Date(options.generationTimestamp);
  const title = options.title ?? "FormuLab User Guide";

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(title);
  pdfDoc.setProducer("FormuLab");
  pdfDoc.setCreator("FormuLab");
  pdfDoc.setSubject("FormuLab illustrated user guide");
  pdfDoc.setCreationDate(genDate);
  pdfDoc.setModificationDate(genDate);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const monoFont = await pdfDoc.embedFont(StandardFonts.Courier);

  // ---- Cover page -----------------------------------------------------
  const cover = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  cover.drawText(title, { x: MARGIN, y: PAGE_HEIGHT / 2 + 40, size: 28, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
  cover.drawText("Local-first formulation research workbench", {
    x: MARGIN,
    y: PAGE_HEIGHT / 2 + 10,
    size: 13,
    font: italicFont,
    color: rgb(0.35, 0.35, 0.35),
  });
  let coverY = PAGE_HEIGHT / 2 - 30;
  for (const line of wrapLines(options.copyrightNotice, font, 9, CONTENT_WIDTH)) {
    cover.drawText(line, { x: MARGIN, y: coverY, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    coverY -= 13;
  }

  // ---- Reserve table-of-contents pages ---------------------------------
  const chapterHeadings = blocks.filter((b): b is Extract<GuideBlock, { kind: "heading" }> => b.kind === "heading" && b.level === 2);
  const tocLineHeight = 18;
  const tocLinesPerPage = Math.max(1, Math.floor((PAGE_HEIGHT - MARGIN * 2 - 40) / tocLineHeight));
  const tocPageCount = Math.max(1, Math.ceil(chapterHeadings.length / tocLinesPerPage));
  const tocPages: PDFPage[] = [];
  for (let i = 0; i < tocPageCount; i++) tocPages.push(pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]));

  // ---- Body: pass 1 — render content, recording each chapter's page ---
  let page: PDFPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  const headingPageNumber = new Map<string, number>();

  const currentPageNumber = () => pdfDoc.getPageCount(); // 1-based; this page is the last one added so far
  const newPage = () => {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };
  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN + FOOTER_HEIGHT) newPage();
  };
  const drawWrapped = (text: string, size: number, useFont: PDFFont, x: number, maxWidth: number, color = rgb(0, 0, 0)) => {
    const lineHeight = size + LINE_GAP;
    for (const line of wrapLines(text, useFont, size, maxWidth)) {
      ensureSpace(lineHeight);
      page.drawText(line, { x, y, size, font: useFont, color });
      y -= lineHeight;
    }
  };

  for (const block of blocks) {
    switch (block.kind) {
      case "heading": {
        const size = block.level === 1 ? 20 : block.level === 2 ? 15 : 12;
        ensureSpace(size + 16);
        y -= block.level === 2 ? 14 : 6;
        if (block.level === 2) headingPageNumber.set(block.id, currentPageNumber());
        drawWrapped(block.text, size, boldFont, MARGIN, CONTENT_WIDTH);
        y -= 2;
        break;
      }
      case "paragraph":
        drawWrapped(block.text, 10, font, MARGIN, CONTENT_WIDTH);
        y -= 4;
        break;
      case "listItem":
        drawWrapped(`•  ${block.text}`, 10, font, MARGIN + 12, CONTENT_WIDTH - 12);
        break;
      case "callout": {
        const color = CALLOUT_COLOR[block.tone];
        const label = block.tone === "warning" ? "Warning" : "Note";
        ensureSpace(20);
        y -= 4;
        drawWrapped(`${label}: ${block.text}`, 10, boldFont, MARGIN + 10, CONTENT_WIDTH - 10, color);
        y -= 4;
        break;
      }
      case "codeBlock":
        for (const line of block.text.split("\n")) drawWrapped(line, 9, monoFont, MARGIN + 8, CONTENT_WIDTH - 8, rgb(0.2, 0.2, 0.2));
        y -= 4;
        break;
      case "table": {
        const colCount = block.headers.length;
        const colWidth = CONTENT_WIDTH / colCount;
        const rowHeight = 16;
        const drawRow = (cells: string[], bold: boolean) => {
          ensureSpace(rowHeight);
          let x = MARGIN;
          for (const cell of cells) {
            const safeCell = sanitizeForPdf(cell);
            page.drawText(safeCell.length > 40 ? `${safeCell.slice(0, 37)}...` : safeCell, { x: x + 3, y, size: 9, font: bold ? boldFont : font });
            x += colWidth;
          }
          y -= rowHeight;
        };
        drawRow(block.headers, true);
        for (const row of block.rows) drawRow(row, false);
        y -= 6;
        break;
      }
      case "image": {
        const resolved = resolveScreenshotSrc(options.docsDir, block.src);
        if (resolved.found) {
          const png = await pdfDoc.embedPng(resolved.bytes);
          const scale = Math.min(CONTENT_WIDTH / png.width, MAX_IMAGE_HEIGHT / png.height, 1);
          const w = png.width * scale;
          const h = png.height * scale;
          ensureSpace(h + 16);
          page.drawImage(png, { x: MARGIN, y: y - h, width: w, height: h });
          y -= h + 4;
          drawWrapped(block.alt, 8, italicFont, MARGIN, CONTENT_WIDTH, rgb(0.45, 0.45, 0.45));
        } else {
          ensureSpace(40);
          page.drawRectangle({ x: MARGIN, y: y - 34, width: CONTENT_WIDTH, height: 34, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 1 });
          y -= 12;
          drawWrapped(`[Screenshot not yet captured: ${block.alt}]`, 9, italicFont, MARGIN + 8, CONTENT_WIDTH - 16, rgb(0.5, 0.5, 0.5));
          y -= 14;
        }
        y -= 6;
        break;
      }
    }
  }

  // ---- Body: pass 2 — draw the reserved table of contents -------------
  {
    let tocPageIndex = 0;
    let tocPage = tocPages[0];
    let tocY = PAGE_HEIGHT - MARGIN;
    tocPage.drawText("Table of Contents", { x: MARGIN, y: tocY, size: 16, font: boldFont });
    tocY -= 28;
    for (const heading of chapterHeadings) {
      if (tocY < MARGIN) {
        tocPageIndex++;
        tocPage = tocPages[tocPageIndex] ?? tocPages[tocPages.length - 1];
        tocY = PAGE_HEIGHT - MARGIN;
      }
      const pageNum = headingPageNumber.get(heading.id);
      const label = sanitizeForPdf(heading.text);
      tocPage.drawText(label.length > 78 ? `${label.slice(0, 75)}...` : label, { x: MARGIN, y: tocY, size: 10, font });
      if (pageNum !== undefined) {
        const pageText = String(pageNum);
        const textWidth = font.widthOfTextAtSize(pageText, 10);
        tocPage.drawText(pageText, { x: PAGE_WIDTH - MARGIN - textWidth, y: tocY, size: 10, font });
      }
      tocY -= tocLineHeight;
    }
  }

  // ---- Footer pass — page numbers on every page ------------------------
  const allPages = pdfDoc.getPages();
  const total = allPages.length;
  allPages.forEach((p, idx) => {
    const label = `Page ${idx + 1} of ${total}`;
    const w = font.widthOfTextAtSize(label, 8);
    p.drawText(label, { x: (PAGE_WIDTH - w) / 2, y: MARGIN / 2, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
  });

  return pdfDoc.save();
}
