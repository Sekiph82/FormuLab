import { describe, expect, it } from "vitest";
import { detectSupplierSdsSections, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";
import { extractSupplierSdsDocumentIdentity } from "./supplierSdsDocumentIdentity";

const HASH = "a".repeat(64);
const line = (pageNumber: number, lineNumber: number, text: string, extra: Partial<SupplierSdsSectionLine> = {}): SupplierSdsSectionLine => ({
  pageNumber,
  lineNumber,
  text,
  source: "digital",
  ...extra,
});

describe("supplier SDS document identity extraction", () => {
  it("keeps supplier, manufacturer, product, trade name, codes, revision and dates distinct", () => {
    const lines = [
      line(1, 1, "Supplier: Acme Chemicals"),
      line(1, 2, "Manufacturer: Factory Ltd."),
      line(1, 3, "Product identifier: Blend 12"),
      line(1, 4, "Trade name: Acme Blend"),
      line(1, 5, "Supplier item code: SUP-004"),
      line(1, 6, "Material code: MAT-9"),
      line(1, 7, "SDS version: 4.1"),
      line(1, 8, "Revision number: Rev. C"),
      line(1, 9, "Revision date: 03/04/2025"),
      line(1, 10, "Issue date: 4 March 2025"),
      line(1, 11, "Print date: 2025-03-05 09:30"),
      line(1, 12, "SDS number: DOC-8841"),
    ];
    const result = extractSupplierSdsDocumentIdentity({ sourceDocumentHash: HASH, lines });
    expect(result.candidates.map(({ field, rawValue }) => [field, rawValue])).toEqual([
      ["supplier_name", "Acme Chemicals"], ["manufacturer_name", "Factory Ltd."],
      ["product_name", "Blend 12"], ["trade_name", "Acme Blend"],
      ["supplier_product_code", "SUP-004"], ["material_code", "MAT-9"],
      ["sds_version", "4.1"], ["revision_identifier", "Rev. C"],
      ["revision_date", "03/04/2025"], ["issue_date", "4 March 2025"],
      ["print_date", "2025-03-05 09:30"], ["source_identifier", "DOC-8841"],
    ]);
  });

  it("reads label-only lines followed by a value without consuming another recognized label", () => {
    const result = extractSupplierSdsDocumentIdentity({ sourceDocumentHash: HASH, lines: [
      line(1, 1, "Supplier"), line(1, 2, "Northwind GmbH"), line(1, 3, "Manufacturer:"),
      line(1, 4, "Manufacturer name"), line(1, 5, "Product identifier: X-1"),
    ] });
    expect(result.candidates.filter(({ field }) => field === "supplier_name" || field === "manufacturer_name"))
      .toMatchObject([{ field: "supplier_name", rawValue: "Northwind GmbH" }]);
    expect(result.candidates.some(({ field, rawValue }) => field === "manufacturer_name" && rawValue === "Product identifier: X-1")).toBe(false);
  });

  it("keeps explicit market separate from regulatory references and requires review", () => {
    const lines = [line(1, 1, "Market: EU"), line(1, 2, "SECTION 15: Regulatory information"), line(1, 3, "This product is governed by Regulation (EC) No 1907/2006 (REACH).")];
    const result = extractSupplierSdsDocumentIdentity({ sourceDocumentHash: HASH, lines, sections: detectSupplierSdsSections(lines) });
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "market", rawValue: "EU", reviewRequired: false }),
      expect.objectContaining({ field: "regulatory_regime", normalizedValue: "EU_REACH", reviewRequired: true }),
    ]));
    expect(result.warnings).toContain("regulatory_regime_requires_review");
  });

  it("does not interpret ordinary reach-out text as the REACH regulatory regime", () => {
    const result = extractSupplierSdsDocumentIdentity({ sourceDocumentHash: HASH, lines: [
      line(1, 1, "For support, please reach out to the supplier."),
    ] });
    expect(result.candidates.some(({ field }) => field === "regulatory_regime")).toBe(false);
  });

  it("normalizes explicit supported language and flags unknown printed language", () => {
    const known = extractSupplierSdsDocumentIdentity({ sourceDocumentHash: HASH, lines: [line(1, 1, "Document language: Türkçe")] });
    expect(known.candidates[0]).toMatchObject({ field: "document_language", rawValue: "Türkçe", normalizedValue: "tr", reviewRequired: false });
    const unknown = extractSupplierSdsDocumentIdentity({ sourceDocumentHash: HASH, lines: [line(1, 1, "Language: Norsk")] });
    expect(unknown.candidates[0]).toMatchObject({ field: "document_language", rawValue: "Norsk", reviewRequired: true });
    expect(unknown.warnings).toContain("unsupported_document_language");
  });

  it("reports language only after three matching section headings and retains their provenance", () => {
    const lines = [
      line(1, 1, "SECTION 1: Identification of the substance/mixture and of the company/undertaking", { source: "ocr", confidence: 0.52, position: { x: 12, y: 22 } }),
      line(1, 2, "SECTION 2: Hazards identification", { source: "ocr", confidence: 0.52 }),
      line(1, 3, "SECTION 3: Composition/information on ingredients", { source: "ocr", confidence: 0.52 }),
    ];
    const result = extractSupplierSdsDocumentIdentity({ sourceDocumentHash: HASH, lines, sections: detectSupplierSdsSections(lines), ocrParserVersion: "ocr-7" });
    expect(result).toMatchObject({ ocrParserVersion: "ocr-7" });
    expect(result.candidates[0]).toMatchObject({
      field: "document_language",
      rawValue: expect.stringContaining("SECTION 1: Identification of the substance/mixture"),
      normalizedValue: "en",
      reviewRequired: true,
    });
    expect(result.candidates[0]?.evidence[0]).toMatchObject({ sourceDocumentHash: HASH, pageNumber: 1, lineNumber: 1, source: "ocr", confidence: 0.52, position: { x: 12, y: 22 } });
    expect(result.warnings).toContain("ocr_identity_requires_review");
  });

  it("keeps acquisition metadata as a separate comparison and never inserts it as document evidence", () => {
    const acquisition = { code: "receipt-1", market: "EU", language: "English", sourceRevision: "Rev. C", sourceProduct: { tradeName: "Acme Blend" } };
    const result = extractSupplierSdsDocumentIdentity({ sourceDocumentHash: HASH, lines: [
      line(1, 1, "Trade name: Different Blend"), line(1, 2, "SDS version: 4.1"), line(1, 3, "Revision number: Rev. C"),
    ], acquisitionContext: acquisition });
    expect(result.acquisitionCode).toBe("receipt-1");
    expect(result.metadataComparisons).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "trade_name", result: "differs", acquisitionValue: "Acme Blend" }),
      expect.objectContaining({ field: "revision_identifier", result: "matches", acquisitionValue: "Rev. C" }),
    ]));
    expect(result.metadataComparisons.some(({ field }) => field === "document_language")).toBe(false);
    expect(result.candidates.some(({ rawValue }) => rawValue === "Acme Blend" || rawValue === "English")).toBe(false);
    expect(acquisition.sourceProduct.tradeName).toBe("Acme Blend");
  });

  it("retains conflicting printed identities and flags every candidate for review", () => {
    const result = extractSupplierSdsDocumentIdentity({ sourceDocumentHash: HASH, acquisitionContext: {
      code: "receipt-conflict", sourceProduct: { tradeName: "Blend A" },
    }, lines: [line(1, 1, "Trade name: Blend A"), line(1, 2, "Trade name: Blend B")] });
    expect(result.candidates.filter(({ field }) => field === "trade_name")).toMatchObject([
      { rawValue: "Blend A", reviewRequired: true }, { rawValue: "Blend B", reviewRequired: true },
    ]);
    expect(result.warnings).toContain("conflicting_identity_candidates");
    expect(result.metadataComparisons).toMatchObject([{ field: "trade_name", result: "ambiguous", reviewRequired: true }]);
  });

  it("does not derive printed identifiers from filenames, URLs, or absent fields", () => {
    const result = extractSupplierSdsDocumentIdentity({ sourceDocumentHash: HASH, lines: [line(1, 1, "Product for external reference https://example.test/SDS-123.pdf")] });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(["no_identity_candidates"]);
  });

  it("requires review for OCR identity with unknown confidence", () => {
    const result = extractSupplierSdsDocumentIdentity({ sourceDocumentHash: HASH, lines: [line(1, 1, "Supplier: Acme", { source: "ocr" })] });
    expect(result.candidates[0]).toMatchObject({ rawValue: "Acme", reviewRequired: true, evidence: [{ source: "ocr" }] });
    expect(result.warnings).toContain("ocr_identity_requires_review");
  });

  it("requires review when identity provenance is mixed or unknown", () => {
    const result = extractSupplierSdsDocumentIdentity({ sourceDocumentHash: HASH, lines: [
      line(1, 1, "Supplier: Acme", { source: "mixed" }),
    ] });
    expect(result.candidates[0]).toMatchObject({ rawValue: "Acme", reviewRequired: true });
    expect(result.warnings).toContain("identity_provenance_requires_review");
  });
});
