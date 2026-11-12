import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_HEIGHT = 26;
const LINE_GAP = 3;
const WINANSI_SAFE_EXTENDED = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x2022, 0x00a7, 0x00b0, 0x00b5, 0x00d7, 0x2122, 0x00a9, 0x00ae]);

type ReportBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string };

function pdfSafeText(value: string): string {
  return Array.from(value.replace(/[\u00a0\t\r]+/g, " ").replace(/\s+/g, " ").trim())
    .map((character) => {
      const codePoint = character.codePointAt(0)!;
      if (codePoint <= 0xff || WINANSI_SAFE_EXTENDED.has(codePoint)) return character;
      if (character === "✓") return "Yes";
      if (character === "✕") return "x";
      if (character === "→") return "->";
      return "?";
    })
    .join("");
}

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = pdfSafeText(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const sourceWord of words) {
    let word = sourceWord;
    while (font.widthOfTextAtSize(word, size) > maxWidth && word.length > 1) {
      let splitAt = word.length - 1;
      while (splitAt > 1 && font.widthOfTextAtSize(word.slice(0, splitAt), size) > maxWidth) splitAt--;
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(word.slice(0, splitAt));
      word = word.slice(splitAt);
    }
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

function htmlToReportBlocks(html: string): ReportBlock[] {
  const document = new DOMParser().parseFromString(html, "text/html");
  const blocks: ReportBlock[] = [];

  const visit = (element: Element) => {
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      blocks.push({ kind: "heading", level: Number(tag.slice(1)), text: element.textContent ?? "" });
      return;
    }
    if (tag === "p") {
      const text = element.textContent?.trim();
      if (text) blocks.push({ kind: "paragraph", text });
      return;
    }
    if (tag === "table") {
      const rows = Array.from(element.querySelectorAll("tr"));
      const headers = Array.from(rows[0]?.querySelectorAll("th,td") ?? []).map((cell) => cell.textContent?.trim() ?? "");
      rows.slice(1).forEach((row) => {
        const values = Array.from(row.querySelectorAll("th,td")).map((cell) => cell.textContent?.trim() ?? "");
        const details = values.map((value, index) => headers[index] ? `${headers[index]}: ${value || "—"}` : value).filter(Boolean);
        if (details.length) blocks.push({ kind: "paragraph", text: details.join("  |  ") });
      });
      if (rows.length <= 1) {
        const text = rows[0]?.textContent?.trim();
        if (text) blocks.push({ kind: "paragraph", text });
      }
      return;
    }
    Array.from(element.children).forEach(visit);
  };

  Array.from(document.body.children).forEach(visit);
  return blocks;
}

/** Render the same complete report HTML as a paginated, printable PDF. */
export async function renderFormulationReportPdf(html: string, sessionId: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`FormuLab Formulation Report — ${sessionId}`);
  pdf.setAuthor("FormuLab");
  pdf.setSubject(`Formulation session ${sessionId}`);
  pdf.setProducer("FormuLab");
  pdf.setCreator("FormuLab");

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const blocks = htmlToReportBlocks(html);
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  const bodyPages: PDFPage[] = [page];

  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    bodyPages.push(page);
    y = PAGE_HEIGHT - MARGIN;
  };
  const ensureSpace = (height: number) => {
    if (y - height < MARGIN + FOOTER_HEIGHT) newPage();
  };
  const drawWrapped = (text: string, size: number, useFont: PDFFont, indent = 0) => {
    const lineHeight = size + LINE_GAP;
    for (const line of wrapLines(text, useFont, size, CONTENT_WIDTH - indent)) {
      ensureSpace(lineHeight);
      page.drawText(line, { x: MARGIN + indent, y, size, font: useFont, color: rgb(0.13, 0.16, 0.2) });
      y -= lineHeight;
    }
  };

  blocks.forEach((block, index) => {
    if (block.kind === "heading") {
      const size = block.level <= 1 ? 19 : block.level === 2 ? 14 : block.level === 3 ? 11 : 10;
      ensureSpace(size + 14);
      y -= block.level <= 2 ? 6 : 3;
      drawWrapped(block.text, size, boldFont);
      if (block.level <= 2) {
        page.drawLine({ start: { x: MARGIN, y: y + 1 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 1 }, thickness: 0.6, color: rgb(0.72, 0.76, 0.81) });
        y -= 5;
      }
    } else {
      drawWrapped(block.text, 8.5, font, 4);
      y -= 3;
    }
    if (index === 0 && block.kind === "heading") y -= 3;
  });

  bodyPages.forEach((pdfPage, index) => {
    const label = `FormuLab  |  ${sessionId}  |  Page ${index + 1} of ${bodyPages.length}`;
    pdfPage.drawLine({ start: { x: MARGIN, y: MARGIN - 8 }, end: { x: PAGE_WIDTH - MARGIN, y: MARGIN - 8 }, thickness: 0.4, color: rgb(0.82, 0.84, 0.87) });
    pdfPage.drawText(pdfSafeText(label), { x: MARGIN, y: MARGIN - 20, size: 7, font, color: rgb(0.4, 0.43, 0.48) });
  });

  return pdf.save();
}
