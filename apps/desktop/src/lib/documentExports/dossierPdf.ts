/**
 * Phase 8 — deterministic PDF rendering of a `DossierExportSnapshot`.
 * Pure, low-level `pdf-lib` text drawing — never an HTML/DOM-to-PDF
 * conversion, so there is no "ad hoc UI HTML" path into a regulatory
 * document. Every date is the caller-supplied `generationTimestamp`;
 * nothing here calls `Date.now()`/`new Date()` with no arguments.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { DossierExportSnapshot } from "@formulab/shared";
import { buildDossierDocumentContent, type RenderOptions } from "./content";

const PAGE_WIDTH = 595.28; // A4, points
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_GAP = 4;

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
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

/**
 * Renders a dossier export snapshot to PDF bytes. Deterministic for
 * identical input: the document's creation/modification dates are set
 * from `snapshot.generationTimestamp`, never the current wall clock, and
 * no other library-level randomness is introduced (no annotations, no
 * embedded images, no font subsetting beyond pdf-lib's own standard
 * WinAnsi font).
 */
export async function renderDossierPdf(snapshot: DossierExportSnapshot, options: RenderOptions = {}): Promise<Uint8Array> {
  const content = buildDossierDocumentContent(snapshot, options);
  const genDate = new Date(snapshot.generationTimestamp);
  const title = options.title ?? `Regulatory Dossier — ${snapshot.dossierCode}`;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(title);
  pdfDoc.setAuthor(snapshot.generatedBy);
  pdfDoc.setSubject(`Dossier ${snapshot.dossierCode} revision ${snapshot.meta.dossierRevision}`);
  pdfDoc.setProducer("FormuLab");
  pdfDoc.setCreator("FormuLab");
  pdfDoc.setCreationDate(genDate);
  pdfDoc.setModificationDate(genDate);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };
  const ensureSpace = (lineHeight: number) => {
    if (y - lineHeight < MARGIN) newPage();
  };
  const drawWrapped = (text: string, size: number, useFont: PDFFont, x: number, maxWidth: number, color = rgb(0, 0, 0)) => {
    const lineHeight = size + LINE_GAP;
    for (const line of wrapLines(text, useFont, size, maxWidth)) {
      ensureSpace(lineHeight);
      page.drawText(line, { x, y, size, font: useFont, color });
      y -= lineHeight;
    }
  };

  for (const block of content) {
    switch (block.kind) {
      case "title":
        ensureSpace(20);
        drawWrapped(block.text, 16, boldFont, MARGIN, CONTENT_WIDTH);
        y -= 6;
        break;
      case "heading":
        ensureSpace(18);
        y -= 8;
        drawWrapped(block.text, 12, boldFont, MARGIN, CONTENT_WIDTH);
        break;
      case "warning":
        drawWrapped(block.text, 10, boldFont, MARGIN, CONTENT_WIDTH, rgb(0.6, 0, 0));
        break;
      case "keyValue":
        drawWrapped(`${block.label}: ${block.value}`, 10, font, MARGIN, CONTENT_WIDTH);
        break;
      case "listItem":
        drawWrapped(`- ${block.text}`, 10, font, MARGIN + 10, CONTENT_WIDTH - 10);
        break;
      case "paragraph":
        drawWrapped(block.text, 10, font, MARGIN, CONTENT_WIDTH);
        break;
    }
  }

  return pdfDoc.save();
}
