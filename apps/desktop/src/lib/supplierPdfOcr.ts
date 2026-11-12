import type { SupplierPdfTextExtractionResult, SupplierPdfTextWarningCode } from "./supplierPdfTextExtraction";
import { createSupplierPdfOcrBackend } from "./supplierPdfOcrBackend";

export interface SupplierPdfOcrLine {
  pageNumber: number;
  text: string;
  confidence: number;
  source: "ocr";
  reviewRequired: boolean;
}

export type SupplierPdfOcrWarning = SupplierPdfTextWarningCode
  | "ocr_unavailable"
  | "ocr_timeout"
  | "ocr_failed"
  | "ocr_page_limit_reached"
  | "ocr_image_too_large"
  | "ocr_low_confidence"
  | "ocr_empty_result"
  | "cancelled";

export interface SupplierPdfOcrBackend {
  renderPage(input: { pageNumber: number; scale: number; maxPixels: number; signal?: AbortSignal }): Promise<{ bytes: Uint8Array; mimeType: "image/png" | "image/jpeg" }>;
  recognize(input: { bytes: Uint8Array; mimeType: "image/png" | "image/jpeg"; languages: string[]; signal?: AbortSignal }): Promise<Array<{ text: string; confidence: number }>>;
  dispose?(): Promise<void>;
}

export interface SupplierPdfOcrOptions {
  /** A page below this much extracted digital text is eligible for OCR. */
  minimumDigitalTextCharacters?: number;
  maxPages?: number;
  maxImageBytes?: number;
  maxRasterPixels?: number;
  timeoutMsPerPage?: number;
  minimumConfidence?: number;
  scale?: number;
  languages: string[];
  /** Original admitted PDF bytes, required when using the bundled offline backend. */
  sourcePdfBytes?: Uint8Array;
  backend?: SupplierPdfOcrBackend;
}

export interface SupplierPdfOcrResult {
  status: "not_needed" | "completed" | "partial" | "manual_review_required" | "cancelled";
  sourceDocumentHash: string;
  parserVersion: string;
  lines: SupplierPdfOcrLine[];
  pagesAttempted: number[];
  warnings: SupplierPdfOcrWarning[];
}

const DEFAULTS = {
  minimumDigitalTextCharacters: 80,
  maxPages: 3,
  maxImageBytes: 8 * 1024 * 1024,
  maxRasterPixels: 16_000_000,
  timeoutMsPerPage: 10_000,
  minimumConfidence: 0.65,
  scale: 1.5,
} as const;
const HARD = { maxPages: 20, maxImageBytes: 20 * 1024 * 1024, maxRasterPixels: 40_000_000, timeoutMsPerPage: 60_000, scale: 3 } as const;

function checkedLimit(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < 1 || result > maximum) throw new RangeError("Supplier PDF OCR limits exceed the supported policy.");
  return result;
}

function checkedOptions(options: SupplierPdfOcrOptions) {
  const minimumDigitalTextCharacters = options.minimumDigitalTextCharacters ?? DEFAULTS.minimumDigitalTextCharacters;
  const minimumConfidence = options.minimumConfidence ?? DEFAULTS.minimumConfidence;
  if (!Number.isSafeInteger(minimumDigitalTextCharacters) || minimumDigitalTextCharacters < 0
    || !Number.isFinite(minimumConfidence) || minimumConfidence < 0 || minimumConfidence > 1
    || options.languages.length === 0 || options.languages.some((language) => !["eng", "deu", "tur"].includes(language))
    || new Set(options.languages).size !== options.languages.length) {
    throw new RangeError("Supplier PDF OCR language or threshold is invalid.");
  }
  return {
    minimumDigitalTextCharacters,
    minimumConfidence,
    maxPages: checkedLimit(options.maxPages, DEFAULTS.maxPages, HARD.maxPages),
    maxImageBytes: checkedLimit(options.maxImageBytes, DEFAULTS.maxImageBytes, HARD.maxImageBytes),
    maxRasterPixels: checkedLimit(options.maxRasterPixels, DEFAULTS.maxRasterPixels, HARD.maxRasterPixels),
    timeoutMsPerPage: checkedLimit(options.timeoutMsPerPage, DEFAULTS.timeoutMsPerPage, HARD.timeoutMsPerPage),
    scale: checkedLimit(options.scale, DEFAULTS.scale, HARD.scale),
  };
}

function sufficientText(extraction: SupplierPdfTextExtractionResult, pageNumber: number, minimum: number): boolean {
  if (extraction.status !== "extracted") return false;
  const page = extraction.pages.find((candidate) => candidate.pageNumber === pageNumber);
  return (page?.lines.reduce((length, line) => length + line.text.length, 0) ?? 0) >= minimum;
}

/**
 * Run OCR only for pages whose existing digital text layer is insufficient.
 * OCR runs locally through the bundled backend by default; tests or alternate
 * callers may inject a backend. It never silently downloads models or contacts
 * a service. OCR output stays separate from digital text and carries source
 * and confidence for review.
 */
export async function runConditionalSupplierPdfOcr(
  extraction: SupplierPdfTextExtractionResult,
  options: SupplierPdfOcrOptions,
  signal?: AbortSignal,
): Promise<SupplierPdfOcrResult> {
  if (extraction.status === "quarantined") {
    return {
      status: "manual_review_required",
      sourceDocumentHash: "",
      parserVersion: extraction.parserVersion,
      lines: [],
      pagesAttempted: [],
      warnings: ["ocr_unavailable"],
    };
  }
  const limits = checkedOptions(options);
  const pagesNeedingOcr = Array.from({ length: extraction.pageCount }, (_, index) => index + 1)
    .filter((pageNumber) => !sufficientText(extraction, pageNumber, limits.minimumDigitalTextCharacters));
  if (pagesNeedingOcr.length === 0) {
    return { status: "not_needed", sourceDocumentHash: extraction.documentHash, parserVersion: extraction.parserVersion, lines: [], pagesAttempted: [], warnings: [] };
  }
  if (signal?.aborted) {
    return { status: "cancelled", sourceDocumentHash: extraction.documentHash, parserVersion: extraction.parserVersion, lines: [], pagesAttempted: [], warnings: ["cancelled"] };
  }
  const backend = options.backend ?? (options.sourcePdfBytes ? createSupplierPdfOcrBackend(options.sourcePdfBytes) : undefined);
  if (!backend) {
    return { status: "manual_review_required", sourceDocumentHash: extraction.documentHash, parserVersion: extraction.parserVersion, lines: [], pagesAttempted: [], warnings: ["ocr_unavailable"] };
  }

  const selectedPages = pagesNeedingOcr.slice(0, limits.maxPages);
  const warnings: SupplierPdfOcrWarning[] = pagesNeedingOcr.length > selectedPages.length ? ["ocr_page_limit_reached"] : [];
  const lines: SupplierPdfOcrLine[] = [];
  const pagesAttempted: number[] = [];
  let failed = false;
  let cancelled = false;
  let backendDisposed = false;
  const disposeBackend = async () => {
    if (backendDisposed) return;
    backendDisposed = true;
    await backend?.dispose?.();
  };

  for (const pageNumber of selectedPages) {
    if (signal?.aborted) {
      warnings.push("cancelled");
      cancelled = true;
      break;
    }
    pagesAttempted.push(pageNumber);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let operation: Promise<void> | undefined;
    let removeCancelListener: () => void = () => {};
    try {
      operation = (async () => {
        const image = await backend.renderPage({ pageNumber, scale: limits.scale, maxPixels: limits.maxRasterPixels, signal: controller.signal });
        if (image.bytes.byteLength === 0 || image.bytes.byteLength > limits.maxImageBytes) {
          warnings.push("ocr_image_too_large");
          failed = true;
          return;
        }
        const recognized = await backend.recognize({
          bytes: image.bytes,
          mimeType: image.mimeType,
          languages: [...options.languages],
          signal: controller.signal,
        });
        let extractedLine = false;
        for (const item of recognized) {
          const text = item.text.replace(/\s+/g, " ").trim();
          if (!text || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) continue;
          const reviewRequired = item.confidence < limits.minimumConfidence;
          lines.push({ pageNumber, text, confidence: item.confidence, source: "ocr", reviewRequired });
          extractedLine = true;
          if (reviewRequired) warnings.push("ocr_low_confidence");
        }
        if (!extractedLine) {
          warnings.push("ocr_empty_result");
          failed = true;
        }
      })();
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve("timeout");
        }, limits.timeoutMsPerPage);
      });
      const cancelledPage = new Promise<"cancelled">((resolve) => {
        const onCancel = () => resolve("cancelled");
        signal?.addEventListener("abort", onCancel, { once: true });
        removeCancelListener = () => signal?.removeEventListener("abort", onCancel);
      });
      const pageOutcome = await Promise.race([operation.then(() => "done" as const), timeout, cancelledPage]);
      if (pageOutcome === "timeout") {
        warnings.push("ocr_timeout");
        failed = true;
        await disposeBackend();
        break;
      }
      if (pageOutcome === "cancelled") {
        warnings.push("cancelled");
        cancelled = true;
        await disposeBackend();
        break;
      }
    } catch (error) {
      const aborted = signal?.aborted === true;
      warnings.push(aborted ? "cancelled" : error instanceof Error && error.name === "SupplierPdfOcrRasterLimitError" ? "ocr_image_too_large" : "ocr_failed");
      failed = true;
      if (aborted) {
        cancelled = true;
        break;
      }
    } finally {
      if (timer) clearTimeout(timer);
      removeCancelListener();
      signal?.removeEventListener("abort", abort);
    }
  }

  await disposeBackend();

  const status = cancelled ? "cancelled"
    : failed ? lines.length > 0 ? "partial" : "manual_review_required"
      : lines.some((line) => line.reviewRequired) ? "manual_review_required" : "completed";
  return {
    status,
    sourceDocumentHash: extraction.documentHash,
    parserVersion: extraction.parserVersion,
    lines,
    pagesAttempted,
    warnings: [...new Set(warnings)],
  };
}
