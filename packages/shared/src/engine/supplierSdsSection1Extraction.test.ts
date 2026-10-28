import { describe, expect, it } from "vitest";
import { detectSupplierSdsSections, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";
import { extractSupplierSdsSection1 } from "./supplierSdsSection1Extraction";

const HASH = "b".repeat(64);
const line = (pageNumber: number, lineNumber: number, text: string, extra: Partial<SupplierSdsSectionLine> = {}): SupplierSdsSectionLine => ({
  pageNumber,
  lineNumber,
  text,
  source: "digital",
  ...extra,
});

describe("supplier SDS Section 1 commercial identity extraction", () => {
  it("extracts explicitly labeled Section 1 facts as distinct source-bound candidates", () => {
    const lines = [
      line(1, 1, "SECTION 1: Identification of the substance/mixture and of the company/undertaking"),
      line(1, 2, "Chemical name: Sodium example"),
      line(1, 3, "Chemical nature: aqueous solution"),
      line(1, 4, "CAS number: 123-45-6"),
      line(1, 5, "EC number: 200-001-8"),
      line(1, 6, "Recommended use: Industrial cleaning"),
      line(1, 7, "Uses advised against: Consumer spray applications"),
      line(1, 8, "Industry sector: Professional cleaning"),
      line(1, 9, "Product description: Clear surfactant blend"),
      line(1, 10, "SECTION 2: Hazards identification"),
      line(1, 11, "Chemical name: This must not be read from Section 2"),
    ];
    const result = extractSupplierSdsSection1({ sourceDocumentHash: HASH, lines, sections: detectSupplierSdsSections(lines) });
    expect(result.candidates.map(({ field, rawValue }) => [field, rawValue])).toEqual([
      ["declared_chemical_name", "Sodium example"],
      ["chemical_nature", "aqueous solution"],
      ["cas_number", "123-45-6"],
      ["ec_number", "200-001-8"],
      ["recommended_use", "Industrial cleaning"],
      ["use_restrictions", "Consumer spray applications"],
      ["industry_sector", "Professional cleaning"],
      ["product_description", "Clear surfactant blend"],
    ]);
    expect(result.candidates.every((candidate) => candidate.evidence.every((evidence) =>
      evidence.sectionNumber === 1 && evidence.sourceDocumentHash === HASH))).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("supports label-only lines with the next line as value and preserves both evidence lines", () => {
    const lines = [
      line(1, 1, "SECTION 1: Identification of the substance/mixture and of the company/undertaking"),
      line(1, 2, "1.1 Chemical name"),
      line(1, 3, "Example compound"),
      line(1, 4, "1.2 Recommended use"),
      line(1, 5, "Process aid"),
      line(1, 6, "SECTION 2: Hazards identification"),
    ];
    const result = extractSupplierSdsSection1({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toMatchObject([
      { field: "declared_chemical_name", rawValue: "Example compound", evidence: [{ pageNumber: 1, lineNumber: 2 }, { pageNumber: 1, lineNumber: 3 }] },
      { field: "recommended_use", rawValue: "Process aid", evidence: [{ pageNumber: 1, lineNumber: 4 }, { pageNumber: 1, lineNumber: 5 }] },
    ]);
  });

  it("keeps wrapped field values and all supporting lines until the next label", () => {
    const lines = [
      line(1, 1, "SECTION 1: Identification of the substance/mixture and of the company/undertaking"),
      line(1, 2, "Recommended use: Industrial cleaning"),
      line(1, 3, "Suitable for closed-process dosing only."),
      line(1, 4, "Uses advised against: Consumer spray applications"),
      line(1, 5, "Product description: Clear surfactant blend"),
      line(1, 6, "Supplied as a concentrated liquid."),
      line(1, 7, "SECTION 2: Hazards identification"),
    ];
    const result = extractSupplierSdsSection1({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toMatchObject([
      { field: "recommended_use", rawValue: "Industrial cleaning Suitable for closed-process dosing only.", evidence: [{ lineNumber: 2 }, { lineNumber: 3 }] },
      { field: "use_restrictions", rawValue: "Consumer spray applications" },
      { field: "product_description", rawValue: "Clear surfactant blend Supplied as a concentrated liquid.", evidence: [{ lineNumber: 5 }, { lineNumber: 6 }] },
    ]);
  });

  it("does not use Section 1 identity from other sections or infer chemical identity", () => {
    const lines = [
      line(1, 1, "SECTION 1: Identification of the substance/mixture and of the company/undertaking"),
      line(1, 2, "Trade product name: Blend Z"),
      line(1, 3, "SECTION 2: Hazards identification"),
      line(1, 4, "Chemical name: Ingredient Y"),
    ];
    const result = extractSupplierSdsSection1({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(["no_section_1_candidates"]);
  });

  it("leaves CAS unknown when Section 1 declares a product but no CAS identifier", () => {
    const lines = [
      line(1, 1, "SECTION 1: Identification of the substance/mixture and of the company/undertaking"),
      line(1, 2, "Chemical name: Supplier blend Q"),
      line(1, 3, "Chemical nature: mixture"),
      line(1, 4, "SECTION 2: Hazards identification"),
    ];

    const result = extractSupplierSdsSection1({ sourceDocumentHash: HASH, lines });

    expect(result.candidates.map(({ field }) => field)).toEqual(["declared_chemical_name", "chemical_nature"]);
    expect(result.candidates.some(({ field }) => field === "cas_number")).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("returns a clear absence warning when Section 1 is not detected", () => {
    const result = extractSupplierSdsSection1({ sourceDocumentHash: HASH, lines: [line(1, 1, "Supplier: Example")] });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(["section_1_not_detected"]);
  });

  it("does not treat the rest of a truncated or unrecognized document as Section 1", () => {
    const lines = [
      line(1, 1, "SECTION 1: Identification of the substance/mixture and of the company/undertaking"),
      line(1, 2, "Chemical name: Valid Section 1 value"),
      line(1, 3, "SECTION 2: Unknown localized hazard heading"),
      line(3, 1, "CAS number: Unrelated later content"),
    ];
    const result = extractSupplierSdsSection1({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(["section_1_boundary_incomplete"]);
  });

  it("requires Section 2 as the immediate boundary before treating later text as Section 1", () => {
    const lines = [
      line(1, 1, "SECTION 1: Identification of the substance/mixture and of the company/undertaking"),
      line(1, 2, "Chemical name: Valid Section 1 value"),
      line(1, 3, "SECTION 2: Unknown localized hazard heading"),
      line(2, 1, "SECTION 3: Composition/information on ingredients"),
      line(2, 2, "CAS number: Ingredient identifier, not Section 1 commercial identity"),
    ];
    const result = extractSupplierSdsSection1({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(["section_1_boundary_incomplete"]);
  });

  it("retains conflicting declared values and requires review", () => {
    const lines = [
      line(1, 1, "SECTION 1: Identification of the substance/mixture and of the company/undertaking"),
      line(1, 2, "CAS number: 123-45-6"),
      line(1, 3, "CAS number: 987-65-4"),
      line(1, 4, "SECTION 2: Hazards identification"),
    ];
    const result = extractSupplierSdsSection1({ sourceDocumentHash: HASH, lines });
    expect(result.candidates.filter(({ field }) => field === "cas_number")).toMatchObject([
      { rawValue: "123-45-6", reviewRequired: true },
      { rawValue: "987-65-4", reviewRequired: true },
    ]);
    expect(result.warnings).toContain("conflicting_section_1_candidates");
  });

  it("preserves OCR evidence and flags low or unknown provenance for human review", () => {
    const lines = [
      line(1, 1, "SECTION 1: Identification of the substance/mixture and of the company/undertaking"),
      line(1, 2, "Chemical name: Example", { source: "ocr", confidence: 0.4, position: { x: 1, y: 2 } }),
      line(1, 3, "SECTION 2: Hazards identification"),
    ];
    const result = extractSupplierSdsSection1({ sourceDocumentHash: HASH, lines, ocrParserVersion: "ocr-local-v7" });
    expect(result).toMatchObject({ ocrParserVersion: "ocr-local-v7" });
    expect(result.candidates[0]).toMatchObject({ reviewRequired: true, evidence: [{ source: "ocr", confidence: 0.4, position: { x: 1, y: 2 } }] });
    expect(result.warnings).toContain("section_1_ocr_requires_review");
  });

  it("rejects an invalid source hash before extraction", () => {
    expect(() => extractSupplierSdsSection1({ sourceDocumentHash: "file.pdf", lines: [] })).toThrow(/SHA-256/);
  });
});
