import { PDFDocument } from "pdf-lib";

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
  | { status: "admitted"; safeFilename: string; byteSize: number; pageCount: number; parser: "pdf-lib" }
  | { status: "quarantined"; reason: SupplierPdfQuarantineReason };

export interface SupplierPdfAdmissionOptions {
  maxBytes?: number;
  maxPages?: number;
}

const SAFE_FILENAME_CHARS = /^[A-Za-z0-9][A-Za-z0-9._ ()-]{0,149}\.pdf$/i;
const WINDOWS_DEVICE_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i;

function safeFilename(value: string): string | undefined {
  // eslint-disable-next-line no-control-regex -- untrusted filenames must reject all ASCII control characters.
  if (!value || value !== value.trim() || /[\\/\u0000-\u001f\u007f]/.test(value)) return undefined;
  const leaf = value.normalize("NFC");
  if (!SAFE_FILENAME_CHARS.test(leaf) || leaf.startsWith(".") || leaf.includes("..")) return undefined;
  if (WINDOWS_DEVICE_NAME.test(leaf)) return undefined;
  return leaf;
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

  try {
    const document = await PDFDocument.load(input.bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
      capNumbers: true,
    });
    if (document.isEncrypted) return { status: "quarantined", reason: "encrypted_pdf" };
    const pageCount = document.getPageCount();
    if (pageCount < 1) return { status: "quarantined", reason: "malformed_pdf" };
    if (pageCount > maxPages) return { status: "quarantined", reason: "page_limit_exceeded" };
    return {
      status: "admitted",
      safeFilename: filename,
      byteSize: input.bytes.byteLength,
      pageCount,
      parser: "pdf-lib",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      status: "quarantined",
      reason: /encrypt/i.test(message) ? "encrypted_pdf" : "malformed_pdf",
    };
  }
}
