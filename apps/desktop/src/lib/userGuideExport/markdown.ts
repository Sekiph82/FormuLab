/**
 * Phase 10 Session 6 — a small, purpose-built Markdown block parser for
 * `docs/USER_GUIDE.md`. Deliberately not a general-purpose Markdown engine
 * (no new `unified`/`remark` dependency — `react-markdown`'s own remark
 * pipeline is render-time-only and not reusable here): this only needs to
 * understand the subset the guide actually uses (headings, paragraphs,
 * ordered/unordered lists, blockquote callouts, GFM pipe tables, fenced
 * code, and image references), which it recognizes exactly the way the
 * guide already writes them. `docs/USER_GUIDE.md` stays the single source
 * of truth — `pdf.ts`/`docx.ts` both render THIS parser's output, never a
 * second, independently-authored content model (see `content.ts`'s own
 * `buildDossierDocumentContent` for the equivalent Dossier-side precedent
 * this deliberately does not reuse — a guide chapter isn't a dossier
 * section).
 */

export type GuideBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string; id: string }
  | { kind: "paragraph"; text: string }
  | { kind: "listItem"; ordered: boolean; text: string }
  | { kind: "callout"; tone: "warning" | "note"; text: string }
  | { kind: "image"; alt: string; src: string }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "codeBlock"; text: string };

/** GitHub-style heading-anchor slug — lowercase, spaces to hyphens, strips
 *  everything but word characters/hyphens. Matches how `docs/USER_GUIDE.md`'s
 *  own internal `#anchor` links already assume headings resolve (e.g.
 *  `#18-corrective-actions`), so a real link in the guide's prose can be
 *  cross-checked against a real parsed heading id in tests. */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function stripInlineMarkup(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

/** Bold-aware inline segments, for renderers (DOCX) that can show real
 *  bold runs. PDF rendering uses `stripInlineMarkup` instead — matching
 *  `dossierPdf.ts`'s own plain-text convention, never per-run font
 *  switching in `pdf-lib`. */
export interface InlineSegment {
  text: string;
  bold: boolean;
}

export function parseInlineSegments(raw: string): InlineSegment[] {
  const withoutLinks = raw.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/`([^`]+)`/g, "$1");
  const segments: InlineSegment[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutLinks))) {
    if (m.index > last) segments.push({ text: withoutLinks.slice(last, m.index), bold: false });
    segments.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < withoutLinks.length) segments.push({ text: withoutLinks.slice(last), bold: false });
  return segments.filter((s) => s.text.length > 0);
}

function isBlockStart(line: string): boolean {
  return (
    /^#{1,6}\s/.test(line) ||
    /^[-*]\s/.test(line) ||
    /^\d+\.\s/.test(line) ||
    /^>\s/.test(line) ||
    /^```/.test(line) ||
    /^\|/.test(line) ||
    /^!\[/.test(line) ||
    line.trim() === ""
  );
}

export function parseGuideMarkdown(markdown: string): GuideBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: GuideBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block.
    if (/^```/.test(line)) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume closing fence
      blocks.push({ kind: "codeBlock", text: codeLines.join("\n") });
      continue;
    }

    // Heading.
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      const text = stripInlineMarkup(headingMatch[2]);
      blocks.push({ kind: "heading", level, text, id: slugifyHeading(text) });
      i++;
      continue;
    }

    // Image (its own line — `![alt](src)` or `![alt](src "title")`; the
    // optional title is dropped, never merged into `src` — a real bug
    // caught by `generate.test.ts`'s manifest cross-check the first time
    // this parser ran against the guide's own title-carrying image lines).
    const imageMatch = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/.exec(line);
    if (imageMatch) {
      blocks.push({ kind: "image", alt: imageMatch[1], src: imageMatch[2] });
      i++;
      continue;
    }

    // Blockquote callout — collects contiguous `>`-prefixed lines.
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const text = stripInlineMarkup(quoteLines.join(" ").trim());
      const tone: "warning" | "note" = /^warning:/i.test(text) ? "warning" : "note";
      blocks.push({ kind: "callout", tone, text });
      continue;
    }

    // GFM pipe table — a header row, a `---` separator row, then data rows.
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(lines[i + 1])) {
      const splitRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => stripInlineMarkup(c.trim()));
      const headers = splitRow(line);
      i += 2; // header + separator
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    // List item (unordered or ordered), with wrapped continuation lines
    // joined onto the same logical item — the guide wraps long bullets
    // across several physical lines with a leading `- `/`1. ` marker only
    // on the first one.
    const unorderedMatch = /^[-*]\s+(.*)$/.exec(line);
    const orderedMatch = /^\d+\.\s+(.*)$/.exec(line);
    if (unorderedMatch || orderedMatch) {
      const ordered = !!orderedMatch;
      const parts = [(unorderedMatch ?? orderedMatch)![1]];
      i++;
      while (i < lines.length && !isBlockStart(lines[i]) && lines[i].trim() !== "") {
        parts.push(lines[i].trim());
        i++;
      }
      blocks.push({ kind: "listItem", ordered, text: stripInlineMarkup(parts.join(" ")) });
      continue;
    }

    // Paragraph — join contiguous non-block-start lines.
    const parts = [line];
    i++;
    while (i < lines.length && !isBlockStart(lines[i])) {
      parts.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "paragraph", text: stripInlineMarkup(parts.join(" ")) });
  }

  return blocks;
}
