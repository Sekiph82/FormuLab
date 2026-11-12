import { describe, expect, it, vi } from "vitest";
import { SUPPLIER_PDF_TEXT_PARSER_VERSION, type SupplierPdfTextExtractionResult } from "./supplierPdfTextExtraction";
import { createSupplierPdfOcrBackend } from "./supplierPdfOcrBackend";
import { runConditionalSupplierPdfOcr } from "./supplierPdfOcr";

const extraction = (pageTexts: string[]): SupplierPdfTextExtractionResult => ({
  status: "extracted",
  documentHash: "a".repeat(64),
  parserVersion: SUPPLIER_PDF_TEXT_PARSER_VERSION,
  pageCount: pageTexts.length,
  pages: pageTexts.map((text, index) => ({ pageNumber: index + 1, lines: text ? [{ lineNumber: 1, text }] : [] })),
  warnings: [],
});

describe("conditional supplier PDF OCR", () => {
  it("does not OCR pages with sufficient digital text", async () => {
    const renderPage = vi.fn();
    const result = await runConditionalSupplierPdfOcr(extraction(["x".repeat(80)]), {
      languages: ["eng"],
      backend: { renderPage, recognize: vi.fn() },
    });
    expect(result.status).toBe("not_needed");
    expect(renderPage).not.toHaveBeenCalled();
  });

  it("OCRs only text-poor pages and preserves confidence and source", async () => {
    const renderPage = vi.fn(async () => ({ bytes: new Uint8Array([1, 2]), mimeType: "image/png" as const }));
    const recognize = vi.fn(async () => [
      { text: "  Safety   data  ", confidence: 0.92 },
      { text: "uncertain", confidence: 0.4 },
    ]);
    const result = await runConditionalSupplierPdfOcr(extraction(["x".repeat(80), ""]), {
      languages: ["eng", "deu"],
      backend: { renderPage, recognize },
    });
    expect(renderPage).toHaveBeenCalledTimes(1);
    expect(renderPage).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 2, maxPixels: 16_000_000 }));
    expect(recognize).toHaveBeenCalledWith(expect.objectContaining({ languages: ["eng", "deu"] }));
    expect(result).toMatchObject({ status: "manual_review_required", pagesAttempted: [2], sourceDocumentHash: "a".repeat(64) });
    expect(result.lines).toEqual([
      { pageNumber: 2, text: "Safety data", confidence: 0.92, source: "ocr", reviewRequired: false },
      { pageNumber: 2, text: "uncertain", confidence: 0.4, source: "ocr", reviewRequired: true },
    ]);
    expect(result.warnings).toContain("ocr_low_confidence");
  });

  it("requires manual review when the optional OCR backend is unavailable", async () => {
    const result = await runConditionalSupplierPdfOcr(extraction([""]), { languages: ["eng"] });
    expect(result).toMatchObject({ status: "manual_review_required", warnings: ["ocr_unavailable"], lines: [] });
  });

  it("enforces page, byte, pixel, and language bounds", async () => {
    const renderPage = vi.fn(async () => ({ bytes: new Uint8Array(17), mimeType: "image/png" as const }));
    const recognize = vi.fn();
    const result = await runConditionalSupplierPdfOcr(extraction(["", "", ""]), {
      languages: ["eng"], maxPages: 2, maxImageBytes: 16,
      backend: { renderPage, recognize },
    });
    expect(result.status).toBe("manual_review_required");
    expect(result.warnings).toContain("ocr_page_limit_reached");
    expect(result.warnings).toContain("ocr_image_too_large");
    expect(recognize).not.toHaveBeenCalled();
    await expect(runConditionalSupplierPdfOcr(extraction([""]), { languages: ["eng"], maxRasterPixels: 40_000_001 }))
      .rejects.toThrow(/limits exceed/);
  });

  it("stops at the page deadline and releases the backend", async () => {
    const dispose = vi.fn(async () => undefined);
    const result = await runConditionalSupplierPdfOcr(extraction([""]), {
      languages: ["eng"], timeoutMsPerPage: 1,
      backend: { renderPage: () => new Promise(() => undefined), recognize: vi.fn(), dispose },
    });
    expect(result).toMatchObject({ status: "manual_review_required", warnings: ["ocr_timeout"] });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("terminates OCR promptly when the caller cancels", async () => {
    const controller = new AbortController();
    const dispose = vi.fn(async () => undefined);
    const resultPromise = runConditionalSupplierPdfOcr(extraction([""]), {
      languages: ["eng"],
      backend: { renderPage: () => new Promise(() => undefined), recognize: vi.fn(), dispose },
    }, controller.signal);
    controller.abort();
    await expect(resultPromise).resolves.toMatchObject({ status: "cancelled", warnings: ["cancelled"] });
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("normalizes the real engine's 0..100 confidence scale and disposes local engines", async () => {
    const destroy = vi.fn(async () => undefined);
    const terminate = vi.fn(async () => undefined);
    const recognize = vi.fn(async () => ({ data: { lines: [{ text: "SDS section", confidence: 87 }] } }));
    const backend = createSupplierPdfOcrBackend(new Uint8Array([1]), {
      loadPdf: vi.fn(async () => ({ getPage: vi.fn(), destroy } as never)),
      createWorker: vi.fn(async () => ({ recognize, terminate })),
    });
    await expect(backend.recognize({ bytes: new Uint8Array([1]), mimeType: "image/png", languages: ["eng"] }))
      .resolves.toEqual([{ text: "SDS section", confidence: 0.87 }]);
    await backend.dispose?.();
    expect(terminate).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();
  });
});
