import {
  PDFArray,
  PDFContentStream,
  PDFRawStream,
  PDFStream,
  PDFDocument,
  decodePDFRawStream,
} from "pdf-lib";
import { admitSupplierPdf } from "./supplierDocumentAdmission";

export const SUPPLIER_PDF_TEXT_PARSER_VERSION = "formulab-pdf-text-v1+pdf-lib-1.17.1";
export const SUPPLIER_PDF_TEXT_MAX_CHARS = 500_000;

export type SupplierPdfTextWarningCode =
  | "no_text_layer"
  | "unsupported_stream_filter"
  | "unsupported_character_encoding"
  | "text_limit_reached"
  | "unpositioned_text";

export interface SupplierPdfTextLine {
  lineNumber: number;
  text: string;
  /** PDF text-space origin when the source stream includes a text matrix. */
  position?: { x: number; y: number };
}

export interface SupplierPdfTextPage {
  pageNumber: number;
  lines: SupplierPdfTextLine[];
}

export type SupplierPdfTextExtractionResult =
  | { status: "quarantined"; reason: string; parserVersion: typeof SUPPLIER_PDF_TEXT_PARSER_VERSION }
  | {
    status: "extracted";
    documentHash: string;
    parserVersion: typeof SUPPLIER_PDF_TEXT_PARSER_VERSION;
    pageCount: number;
    pages: SupplierPdfTextPage[];
    warnings: SupplierPdfTextWarningCode[];
  };

type ContentToken = { kind: "text"; value: string } | { kind: "position"; operator: string; values: number[] };

// eslint-disable-next-line no-useless-escape -- escaped brackets make PDF array delimiters explicit.
const CONTENT_OPERATORS = /\(((?:\\.|[^\\()])*)\)\s*Tj|\[((?:\\.|[^\[\]])*)\]\s*TJ|<([\da-f\s]+)>\s*Tj|-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+Tm|-?[\d.]+\s+-?[\d.]+\s+T[dD]|-?[\d.]+\s+TL|T\*/gi;
const LITERAL_PARTS = /\(((?:\\.|[^\\()])*)\)|<([\da-f\s]+)>/gi;

function decodeLiteral(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code !== 0x5c) {
      bytes.push(code & 0xff);
      continue;
    }
    const next = value[++index];
    if (next === undefined) break;
    const escapes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
    if (next in escapes) bytes.push(escapes[next]!);
    else if (/[0-7]/.test(next)) {
      const octal = next + (value[index + 1] && /[0-7]/.test(value[index + 1]!) ? value[++index] : "")
        + (value[index + 1] && /[0-7]/.test(value[index + 1]!) ? value[++index] : "");
      bytes.push(Number.parseInt(octal, 8) & 0xff);
    } else if (next === "\r" || next === "\n") {
      if (next === "\r" && value[index + 1] === "\n") index += 1;
    } else bytes.push(next.charCodeAt(0) & 0xff);
  }
  return new Uint8Array(bytes);
}

function decodeHex(value: string): Uint8Array {
  const hex = value.replace(/\s/g, "");
  const padded = hex.length % 2 ? `${hex}0` : hex;
  return new Uint8Array(padded.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
}

function decodePdfText(bytes: Uint8Array): { text: string; unsupported: boolean } {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const values: number[] = [];
    for (let index = 2; index + 1 < bytes.length; index += 2) values.push((bytes[index]! << 8) | bytes[index + 1]!);
    return { text: String.fromCharCode(...values), unsupported: false };
  }
  const nonAscii = bytes.some((byte) => byte > 0x7f);
  if (bytes.some((byte) => byte === 0)) return { text: "", unsupported: true };
  return { text: new TextDecoder("windows-1252").decode(bytes), unsupported: nonAscii };
}

function textFromMatch(match: RegExpExecArray): string {
  if (match[1] !== undefined) return decodePdfText(decodeLiteral(match[1])).text;
  if (match[3] !== undefined) return decodePdfText(decodeHex(match[3])).text;
  const textArray = match[2] ?? "";
  const fragments: string[] = [];
  for (const part of textArray.matchAll(LITERAL_PARTS)) {
    const bytes = part[1] !== undefined ? decodeLiteral(part[1]) : decodeHex(part[2] ?? "");
    fragments.push(decodePdfText(bytes).text);
  }
  return fragments.join("");
}

function contentTokens(source: string, warnings: Set<SupplierPdfTextWarningCode>): ContentToken[] {
  const tokens: ContentToken[] = [];
  CONTENT_OPERATORS.lastIndex = 0;
  for (let match = CONTENT_OPERATORS.exec(source); match; match = CONTENT_OPERATORS.exec(source)) {
    if (match[1] !== undefined || match[2] !== undefined || match[3] !== undefined) {
      const decoded = decodePdfText(match[1] !== undefined ? decodeLiteral(match[1])
        : match[3] !== undefined ? decodeHex(match[3])
          : new Uint8Array());
      if (decoded.unsupported) warnings.add("unsupported_character_encoding");
      const value = match[2] !== undefined ? textFromMatch(match) : decoded.text;
      if (value) tokens.push({ kind: "text", value });
      continue;
    }
    const value = match[0];
    const operator = value.endsWith("Tm") ? "Tm"
      : value.endsWith("Td") ? "Td" : value.endsWith("TD") ? "TD"
        : value === "T*" ? "T*" : "TL";
    const operands = value.slice(0, value.length - operator.length).trim().split(/\s+/).filter(Boolean).map(Number);
    tokens.push({ kind: "position", operator, values: operands });
  }
  return tokens;
}

function collectLines(streams: readonly Uint8Array[], warnings: Set<SupplierPdfTextWarningCode>, remainingChars: number): SupplierPdfTextLine[] {
  const lines: SupplierPdfTextLine[] = [];
  let current = "";
  let x = 0;
  let y = 0;
  let hasPosition = false;
  let leading = 0;
  let charsWritten = 0;
  const flush = () => {
    const text = current.replace(/\s+/g, " ").trim();
    if (text && charsWritten < remainingChars) {
      const bounded = text.slice(0, remainingChars - charsWritten);
      lines.push({ lineNumber: lines.length + 1, text: bounded, ...(hasPosition ? { position: { x, y } } : {}) });
      charsWritten += bounded.length;
      if (bounded.length < text.length) warnings.add("text_limit_reached");
    }
    current = "";
  };

  for (const bytes of streams) {
    const source = new TextDecoder("latin1").decode(bytes);
    for (const token of contentTokens(source, warnings)) {
      if (token.kind === "text") {
        if (current && !current.endsWith(" ")) current += " ";
        current += token.value;
        if (current.length > remainingChars) {
          warnings.add("text_limit_reached");
          flush();
          return lines;
        }
        if (charsWritten >= remainingChars) {
          warnings.add("text_limit_reached");
          flush();
          return lines;
        }
        continue;
      }
      if (token.operator === "Tm" && token.values.length === 6) {
        const nextX = token.values[4]!;
        const nextY = token.values[5]!;
        if (current && hasPosition && Math.abs(nextY - y) > 0.5) flush();
        x = nextX;
        y = nextY;
        hasPosition = true;
      } else if ((token.operator === "Td" || token.operator === "TD") && token.values.length === 2) {
        const [dx, dy] = token.values;
        if (Math.abs(dy!) > 0.5 && current) flush();
        x += dx!;
        y += dy!;
        hasPosition = true;
      } else if (token.operator === "TL" && token.values.length === 1) {
        leading = token.values[0]!;
      } else if (token.operator === "T*" && current) {
        flush();
        y -= leading;
      }
    }
  }
  flush();
  if (lines.some(({ position }) => !position)) warnings.add("unpositioned_text");
  return lines;
}

function decodePageStreams(document: PDFDocument, pageIndex: number, warnings: Set<SupplierPdfTextWarningCode>): Uint8Array[] {
  const page = document.getPages()[pageIndex]!;
  const contents = page.node.Contents();
  if (!contents) return [];
  const resolved = document.context.lookup(contents);
  const streamObjects = resolved instanceof PDFArray
    ? resolved.asArray().map((item) => document.context.lookup(item))
    : [resolved];
  const decoded: Uint8Array[] = [];
  for (const stream of streamObjects) {
    if (stream instanceof PDFRawStream) {
      try {
        decoded.push(decodePDFRawStream(stream).decode());
      } catch {
        warnings.add("unsupported_stream_filter");
      }
    } else if (stream instanceof PDFContentStream) {
      decoded.push(stream.getUnencodedContents());
    } else if (stream instanceof PDFStream) {
      decoded.push(stream.getContents());
    }
  }
  return decoded;
}

function hasLikelyCorruptText(pages: SupplierPdfTextPage[]): boolean {
  const text = pages.flatMap((page) => page.lines).map((line) => line.text).join("");
  if (!text) return false;
  // eslint-disable-next-line no-control-regex -- decoded PDF text with control bytes is treated as corrupt input.
  const controls = text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g)?.length ?? 0;
  return controls / text.length > 0.01;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const ownedBytes = new Uint8Array(bytes.byteLength);
  ownedBytes.set(bytes);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", ownedBytes.buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Extract a reproducible, page-scoped text layer from an admitted supplier
 * PDF. It is intentionally conservative: OCR, image text and unsupported
 * stream/font encodings remain explicit gaps for the subsequent OCR/review tasks. */
export async function extractSupplierPdfText(input: {
  bytes: Uint8Array;
  filename: string;
  declaredMimeType: string;
}, options: { maxChars?: number; maxPages?: number } = {}): Promise<SupplierPdfTextExtractionResult> {
  const admission = await admitSupplierPdf(input, { maxPages: options.maxPages });
  if (admission.status === "quarantined") {
    return { status: "quarantined", reason: admission.reason, parserVersion: SUPPLIER_PDF_TEXT_PARSER_VERSION };
  }

  const warnings = new Set<SupplierPdfTextWarningCode>();
  const maxChars = Math.max(1, Math.min(SUPPLIER_PDF_TEXT_MAX_CHARS, Math.floor(options.maxChars ?? SUPPLIER_PDF_TEXT_MAX_CHARS)));
  const document = await PDFDocument.load(input.bytes, { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false, capNumbers: true });
  const pages: SupplierPdfTextPage[] = [];
  let charsUsed = 0;
  for (let index = 0; index < document.getPageCount(); index += 1) {
    const lines = collectLines(decodePageStreams(document, index, warnings), warnings, maxChars - charsUsed);
    charsUsed += lines.reduce((total, line) => total + line.text.length, 0);
    pages.push({ pageNumber: index + 1, lines });
    if (charsUsed >= maxChars) {
      warnings.add("text_limit_reached");
      break;
    }
  }
  if (hasLikelyCorruptText(pages)) warnings.add("unsupported_character_encoding");
  if (pages.every(({ lines }) => lines.length === 0)) warnings.add("no_text_layer");
  return {
    status: "extracted",
    documentHash: await sha256(input.bytes),
    parserVersion: SUPPLIER_PDF_TEXT_PARSER_VERSION,
    pageCount: admission.pageCount,
    pages,
    warnings: [...warnings].sort(),
  };
}
