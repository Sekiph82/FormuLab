import { describe, expect, it, vi } from "vitest";
import { supplierDocumentAcquisitionSchema } from "@formulab/shared";
import { SUPPLIER_PDF_TEXT_PARSER_VERSION, type SupplierPdfTextExtractionResult } from "./supplierPdfTextExtraction";
import { runConditionalReferenceFormulationOcr } from "./referenceFormulationOcr";

const PARSER_VERSION = SUPPLIER_PDF_TEXT_PARSER_VERSION;
const hash = (byte: string) => byte.repeat(64);
const extraction = (documentHash: string, pageTexts: string[]): SupplierPdfTextExtractionResult => ({
  status: "extracted",
  documentHash,
  parserVersion: PARSER_VERSION,
  pageCount: pageTexts.length,
  pages: pageTexts.map((text, index) => ({ pageNumber: index + 1, lines: text ? [{ lineNumber: 1, text }] : [] })),
  warnings: [],
});
const acquisition = (documentType: "FORMULATION" | "SDS" = "FORMULATION", sha256 = hash("a")) => supplierDocumentAcquisitionSchema.parse({
  schemaVersion: "1.0",
  code: "supplierdoc-formula-1",
  supplierId: "supplier-croda",
  providerId: "croda-public",
  surfaceId: "formulation-library",
  documentType,
  acquisitionMethod: "manual_assisted",
  sourceFileSelection: {
    selectionId: "selection-1",
    originalFilename: "formulation.pdf",
    sourceFileSha256: sha256,
    selectedAt: "2026-10-26T08:00:00.000Z",
    selectedBy: "owner-1",
  },
  sourceProduct: { tradeName: "Example formulation" },
  market: "EU",
  language: "en",
  originalFilename: "formulation.pdf",
  mimeType: "application/pdf",
  sha256,
  byteSize: 1024,
  parserStatus: "not_started",
  acquiredAt: "2026-10-26T08:00:00.000Z",
  createdAt: "2026-10-26T08:00:00.000Z",
});

describe("conditional reference formulation OCR", () => {
  it("does not invoke OCR when the formulation already has sufficient digital text", async () => {
    const renderPage = vi.fn();
    const result = await runConditionalReferenceFormulationOcr({
      acquisition: acquisition(),
      extraction: extraction(hash("a"), ["x".repeat(80)]),
      options: { languages: ["eng"], backend: { renderPage, recognize: vi.fn() } },
    });
    expect(result).toMatchObject({ status: "not_needed", sourceDocumentHash: hash("a"), textExtractionParserVersion: PARSER_VERSION });
    expect(result.ocrParserVersion).toBe("formulab-reference-formulation-ocr-v1");
    expect(renderPage).not.toHaveBeenCalled();
  });

  it("runs OCR only on text-poor formulation pages and retains review provenance", async () => {
    const renderPage = vi.fn(async () => ({ bytes: new Uint8Array([1]), mimeType: "image/png" as const }));
    const recognize = vi.fn(async () => [{ text: "  Ingredients  ", confidence: 0.91 }]);
    const result = await runConditionalReferenceFormulationOcr({
      acquisition: acquisition(),
      extraction: extraction(hash("a"), ["x".repeat(80), ""]),
      options: { languages: ["eng"], backend: { renderPage, recognize } },
    });
    expect(renderPage).toHaveBeenCalledTimes(1);
    expect(renderPage).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 2, maxPixels: 16_000_000 }));
    expect(result).toMatchObject({ status: "completed", pagesAttempted: [2], sourceDocumentHash: hash("a") });
    expect(result.lines).toEqual([{ pageNumber: 2, text: "Ingredients", confidence: 0.91, source: "ocr", reviewRequired: false }]);
  });

  it("rejects non-formulation documents and any extraction/source-byte hash mismatch", async () => {
    const options = { languages: ["eng"], backend: { renderPage: vi.fn(), recognize: vi.fn() } };
    await expect(runConditionalReferenceFormulationOcr({ acquisition: acquisition("SDS"), extraction: extraction(hash("a"), [""]), options }))
      .rejects.toThrow(/FORMULATION document acquisition/);
    await expect(runConditionalReferenceFormulationOcr({ acquisition: acquisition(), extraction: extraction(hash("b"), [""]), options }))
      .rejects.toThrow(/extraction hash does not match/);

    const bytes = new Uint8Array([9, 8, 7]);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    const byteHash = [...digest].map((item) => item.toString(16).padStart(2, "0")).join("");
    await expect(runConditionalReferenceFormulationOcr({
      acquisition: acquisition("FORMULATION", byteHash),
      extraction: extraction(byteHash, [""]),
      options: { languages: ["eng"], sourcePdfBytes: new Uint8Array([1, 2, 3]), backend: options.backend },
    })).rejects.toThrow(/source PDF bytes do not match/);
  });
});
