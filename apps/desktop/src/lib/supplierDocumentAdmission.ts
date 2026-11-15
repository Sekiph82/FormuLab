import { PDFDict, PDFDocument, PDFName, PDFNumber } from "pdf-lib";

export const SUPPLIER_PDF_DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
export const SUPPLIER_PDF_HARD_MAX_BYTES = 100 * 1024 * 1024;
export const SUPPLIER_PDF_DEFAULT_MAX_PAGES = 1_000;
export const SUPPLIER_PDF_HARD_MAX_PAGES = 5_000;

export type SupplierPdfQuarantineReason =
  | "empty_file"
  | "file_too_large"
  | "invalid_content_type"
  | "invalid_signature"
  | "unsafe_filename"
  | "encrypted_pdf"
  | "malformed_pdf"
  | "page_limit_exceeded";

export type SupplierPdfAdmissionResult =
  | { status: "admitted"; safeFilename: string; byteSize: number; pageCount: number; parser: "pdf-lib"; encrypted: boolean; repaired: boolean }
  | { status: "quarantined"; reason: SupplierPdfQuarantineReason };

export interface SupplierPdfAdmissionOptions {
  maxBytes?: number;
  maxPages?: number;
}

const SAFE_FILENAME_CHARS = /^[A-Za-z0-9][A-Za-z0-9._ ()-]{0,149}\.pdf$/i;
const WINDOWS_DEVICE_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

function safeFilename(value: string): string | undefined {
  // eslint-disable-next-line no-control-regex -- untrusted filenames must reject all ASCII control characters.
  if (!value || value !== value.trim() || /[\\/:\u0000-\u001f\u007f]/.test(value)) return undefined;
  // Accented or punctuated supplier names ("Sérum équilibrant", "revive!") keep a readable ASCII form.
  const leaf = value.normalize("NFC").replace(/[^A-Za-z0-9._ ()-]/gu, "_");
  if (!SAFE_FILENAME_CHARS.test(leaf) || leaf.startsWith(".") || leaf.includes("..")) return undefined;
  if (WINDOWS_DEVICE_NAME.test(leaf)) return undefined;
  return leaf;
}

/**
 * Many supplier sheets carry permissions-only encryption: they open without a
 * password and allow text copying (permission bit 5 of /P). Reading their text
 * bypasses nothing, so only documents that withhold copying stay quarantined.
 * A document that also needs an open password fails later in PDF.js.
 */
function permitsTextCopy(document: PDFDocument): boolean {
  const reference = document.context.trailerInfo.Encrypt;
  const encrypt = reference ? document.context.lookupMaybe(reference, PDFDict) : undefined;
  const permissions = encrypt?.lookupMaybe(PDFName.of("P"), PDFNumber)?.asNumber();
  return permissions !== undefined && (permissions & 0b10000) !== 0;
}

function boundedLimit(value: number | undefined, fallback: number, hardLimit: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > hardLimit) return 0;
  return value;
}

/**
 * Validate an untrusted supplier PDF before it reaches extraction/OCR. This
 * function is read-only: quarantined bytes are returned to no parser, and an
 * admitted result contains metadata only. Persistence remains the native,
 * content-addressed supplier document store's responsibility.
 */
export async function admitSupplierPdf(input: {
  bytes: Uint8Array;
  filename: string;
  declaredMimeType: string;
}, options: SupplierPdfAdmissionOptions = {}): Promise<SupplierPdfAdmissionResult> {
  const maxBytes = boundedLimit(options.maxBytes, SUPPLIER_PDF_DEFAULT_MAX_BYTES, SUPPLIER_PDF_HARD_MAX_BYTES);
  const maxPages = boundedLimit(options.maxPages, SUPPLIER_PDF_DEFAULT_MAX_PAGES, SUPPLIER_PDF_HARD_MAX_PAGES);
  if (!maxBytes || !maxPages) throw new RangeError("Supplier PDF admission limits exceed the supported policy.");
  if (input.bytes.byteLength === 0) return { status: "quarantined", reason: "empty_file" };
  if (input.bytes.byteLength > maxBytes) return { status: "quarantined", reason: "file_too_large" };

  const mimeType = input.declaredMimeType.split(";", 1)[0]?.trim().toLowerCase();
  if (mimeType !== "application/pdf" && mimeType !== "application/octet-stream") {
    return { status: "quarantined", reason: "invalid_content_type" };
  }
  if (!input.bytes.subarray(0, 5).every((byte, index) => byte === [0x25, 0x50, 0x44, 0x46, 0x2d][index])) {
    return { status: "quarantined", reason: "invalid_signature" };
  }
  const filename = safeFilename(input.filename);
  if (!filename) return { status: "quarantined", reason: "unsafe_filename" };

  const load = (strict: boolean) => PDFDocument.load(input.bytes, {
    ignoreEncryption: true,
    throwOnInvalidObject: strict,
    updateMetadata: false,
    capNumbers: true,
  });
  try {
    let document: PDFDocument;
    let repaired = false;
    try {
      document = await load(true);
    } catch (error) {
      // One broken object (a bad font or annotation) does not make a supplier sheet unreadable:
      // reopen it leniently and let PDF.js, which tolerates such objects, read its text.
      if (error instanceof Error && /encrypt/i.test(error.message)) throw error;
      document = await load(false);
      repaired = true;
    }
    if (document.isEncrypted && !permitsTextCopy(document)) return { status: "quarantined", reason: "encrypted_pdf" };
    const pageCount = document.getPageCount();
    if (pageCount < 1) return { status: "quarantined", reason: "malformed_pdf" };
    if (pageCount > maxPages) return { status: "quarantined", reason: "page_limit_exceeded" };
    return {
      status: "admitted",
      safeFilename: filename,
      byteSize: input.bytes.byteLength,
      pageCount,
      parser: "pdf-lib",
      encrypted: document.isEncrypted,
      repaired,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      status: "quarantined",
      reason: /encrypt/i.test(message) ? "encrypted_pdf" : "malformed_pdf",
    };
  }
}
