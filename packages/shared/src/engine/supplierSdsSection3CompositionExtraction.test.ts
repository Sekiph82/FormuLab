import { describe, expect, it } from "vitest";
import { detectSupplierSdsSections, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";
import { extractSupplierSdsSection3Composition } from "./supplierSdsSection3CompositionExtraction";

const HASH = "d".repeat(64);
const line = (pageNumber: number, lineNumber: number, text: string, extra: Partial<SupplierSdsSectionLine> = {}): SupplierSdsSectionLine => ({
  pageNumber,
  lineNumber,
  text,
  source: "digital",
  ...extra,
});

describe("supplier SDS Section 3 composition extraction", () => {
  it("extracts declared mixture and component identity and retains concentration ranges and basis", () => {
    const lines = [
      line(1, 1, "SECTION 3: Composition/information on ingredients"),
      line(1, 2, "Product type: Mixture"),
      line(1, 3, "Chemical name: Sodium laureth sulfate"),
      line(1, 4, "CAS number: 68891-38-3"),
      line(1, 5, "EC number: 500-234-8"),
      line(1, 6, "Concentration: 10–<20 % w/w"),
      line(1, 7, "M-factor: 1"),
      line(1, 8, "Specific concentration limit: 5%"),
      line(1, 9, "ATE: 500 mg/l"),
      line(1, 10, "SECTION 4: First aid measures"),
    ];
    const result = extractSupplierSdsSection3Composition({ sourceDocumentHash: HASH, lines, sections: detectSupplierSdsSections(lines) });
    expect(result.declaration).toMatchObject({ rawValue: "Mixture", reviewRequired: true });
    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({
      originalName: { rawValue: "Sodium laureth sulfate" },
      casNumber: { rawValue: "68891-38-3" },
      ecNumber: { rawValue: "500-234-8" },
      concentration: { rawValue: "10–<20 % w/w", parsed: { kind: "range", lowerBound: "10", upperBound: "<20", unit: "%", basis: "w/w" } },
      mFactor: { rawValue: "1" },
      specificConcentrationLimit: { rawValue: "5%" },
      acuteToxicityEstimate: { rawValue: "500 mg/l" },
    });
    expect(result.warnings).toContain("human_review_required");
    expect(result.components[0]?.originalName?.evidence[0]).toMatchObject({ sourceDocumentHash: HASH, sectionNumber: 3 });
  });

  it("parses exact and ranged concentrations without guessing missing units or basis", () => {
    const lines = [
      line(1, 1, "SECTION 3: Composition/information on ingredients"),
      line(1, 2, "Name: Component A"),
      line(1, 3, "CAS No: 111-11-1"),
      line(1, 4, "Concentration: 15%"),
      line(1, 5, "Name: Component B"),
      line(1, 6, "CAS No: 222-22-2"),
      line(1, 7, "Concentration: 5 - 10"),
      line(1, 8, "Name: Component C"),
      line(1, 9, "CAS No: 333-33-3"),
      line(1, 10, "Concentration: <1%"),
      line(1, 11, "Name: Component D"),
      line(1, 12, "CAS No: 444-44-4"),
      line(1, 13, "Concentration: >= 2 %"),
      line(1, 14, "SECTION 4: First aid measures"),
    ];
    const result = extractSupplierSdsSection3Composition({ sourceDocumentHash: HASH, lines });
    expect(result.components).toHaveLength(4);
    expect(result.components[0]?.concentration?.parsed).toEqual({ kind: "exact", lowerBound: "15", unit: "%" });
    expect(result.components[1]?.concentration?.parsed).toEqual({ kind: "range", lowerBound: "5", upperBound: "10" });
    expect(result.components[2]?.concentration?.parsed).toEqual({ kind: "bounded", bound: "1", comparator: "<", unit: "%" });
    expect(result.components[3]?.concentration?.parsed).toEqual({ kind: "bounded", bound: "2", comparator: ">=", unit: "%" });
    expect(result.warnings).toContain("concentration_unit_or_basis_unknown");
  });

  it("parses delimited component tables using their explicit header columns", () => {
    const lines = [
      line(1, 1, "SECTION 3: Composition/information on ingredients"),
      line(1, 2, "Name | CAS No | EC No | Concentration"),
      line(1, 3, "Ethanol | 64-17-5 | 200-578-6 | 30-40% w/w"),
      line(1, 4, "SECTION 4: First aid measures"),
    ];
    const result = extractSupplierSdsSection3Composition({ sourceDocumentHash: HASH, lines });
    expect(result.components).toMatchObject([{
      originalName: { rawValue: "Ethanol" },
      casNumber: { rawValue: "64-17-5" },
      ecNumber: { rawValue: "200-578-6" },
      concentration: { rawValue: "30-40% w/w", parsed: { kind: "range", lowerBound: "30", upperBound: "40", unit: "%", basis: "w/w" } },
    }]);
  });

  it("retains disclosure states found inside delimited composition rows", () => {
    const lines = [
      line(1, 1, "SECTION 3: Composition/information on ingredients"),
      line(1, 2, "Name | CAS No | Concentration | Disclosure"),
      line(1, 3, "Blend component | 555-55-5 | Confidential | Other ingredients not disclosed"),
      line(1, 4, "SECTION 4: First aid measures"),
    ];
    const result = extractSupplierSdsSection3Composition({ sourceDocumentHash: HASH, lines });
    expect(result.components[0]?.tradeSecretDisclosures).toMatchObject([{ rawValue: "Confidential" }]);
    expect(result.disclosureEvidence.map(({ rawValue }) => rawValue)).toEqual(expect.arrayContaining(["Confidential", "Other ingredients not disclosed"]));
    expect(result.warnings).toContain("trade_secret_or_proprietary_disclosure");
    expect(result.warnings).toContain("undisclosed_remainder_disclosed");
  });

  it("preserves explicit trade-secret and undisclosed-remainder statements without filling in hidden chemistry", () => {
    const lines = [
      line(1, 1, "SECTION 3: Composition/information on ingredients"),
      line(1, 2, "Chemical name: Surfactant blend"),
      line(1, 3, "CAS number: 333-33-3"),
      line(1, 4, "Other ingredients not disclosed as confidential business information."),
      line(1, 5, "SECTION 4: First aid measures"),
    ];
    const result = extractSupplierSdsSection3Composition({ sourceDocumentHash: HASH, lines });
    expect(result.disclosureEvidence.map(({ rawValue }) => rawValue)).toContain("Other ingredients not disclosed as confidential business information.");
    expect(result.warnings).toContain("trade_secret_or_proprietary_disclosure");
    expect(result.warnings).toContain("undisclosed_remainder_disclosed");
    expect(result.components[0]?.originalName?.rawValue).toBe("Surfactant blend");
    expect(result.components[0]?.casNumber?.rawValue).toBe("333-33-3");
  });

  it("preserves duplicate component fields and conflicting declarations instead of overwriting", () => {
    const lines = [
      line(1, 1, "SECTION 3: Composition/information on ingredients"),
      line(1, 2, "Product type: Mixture"),
      line(1, 3, "Substance"),
      line(1, 4, "Chemical name: Component X"),
      line(1, 5, "CAS number: 111-11-1"),
      line(1, 6, "CAS number: 222-22-2"),
      line(1, 7, "SECTION 4: First aid measures"),
    ];
    const result = extractSupplierSdsSection3Composition({ sourceDocumentHash: HASH, lines });
    expect(result.declaration).toMatchObject({ rawValue: "Mixture" });
    expect(result.declarationAlternates).toMatchObject([{ rawValue: "Substance" }]);
    expect(result.components[0]).toMatchObject({
      casNumber: { rawValue: "111-11-1" },
      alternateFacts: [{ field: "cas_number", fact: { rawValue: "222-22-2" } }],
    });
    expect(result.warnings).toContain("conflicting_component_values");
    expect(result.warnings).toContain("conflicting_declaration_values");
  });

  it("checks units and basis on alternate concentration candidates too", () => {
    const lines = [
      line(1, 1, "SECTION 3: Composition/information on ingredients"),
      line(1, 2, "Chemical name: Component with conflicting ranges"),
      line(1, 3, "CAS number: 666-66-6"),
      line(1, 4, "Concentration: 10% w/w"),
      line(1, 5, "Concentration: 5"),
      line(1, 6, "SECTION 4: First aid measures"),
    ];
    const result = extractSupplierSdsSection3Composition({ sourceDocumentHash: HASH, lines });
    expect(result.components[0]?.alternateFacts).toMatchObject([{ field: "concentration", fact: { rawValue: "5", parsed: { kind: "exact" } } }]);
    expect(result.warnings).toContain("concentration_unit_or_basis_unknown");
  });

  it("keeps flattened table values with CAS/EC/concentration as evidence and leaves missing identity unknown", () => {
    const lines = [
      line(1, 1, "SECTION 3: Composition/information on ingredients"),
      line(1, 2, "Glycerol 56-81-5 200-289-5 15-25% w/w"),
      line(1, 3, "77-92-9 201-069-1 2-5%"),
      line(1, 4, "SECTION 4: First aid measures"),
    ];
    const result = extractSupplierSdsSection3Composition({ sourceDocumentHash: HASH, lines });
    expect(result.components).toHaveLength(2);
    expect(result.components[0]).toMatchObject({ originalName: { rawValue: "Glycerol" }, casNumber: { rawValue: "56-81-5" }, ecNumber: { rawValue: "200-289-5" } });
    expect(result.components[1]).toMatchObject({ casNumber: { rawValue: "77-92-9" }, ecNumber: { rawValue: "201-069-1" } });
    expect(result.components[1]?.originalName).toBeUndefined();
    expect(result.warnings).toContain("component_identity_missing");
  });

  it("refuses to assign later document rows if the Section 3-to-4 boundary is incomplete", () => {
    const lines = [
      line(1, 1, "SECTION 3: Composition/information on ingredients"),
      line(1, 2, "Chemical name: Not safely bounded"),
      line(1, 3, "SECTION 4: Unrecognized first aid heading"),
      line(2, 1, "CAS number: Later content"),
      line(3, 1, "SECTION 5: Firefighting measures"),
    ];
    const result = extractSupplierSdsSection3Composition({ sourceDocumentHash: HASH, lines });
    expect(result.components).toEqual([]);
    expect(result.warnings).toEqual(["section_3_boundary_incomplete"]);
  });

  it("reports a missing section and never treats missing composition as an empty mixture", () => {
    const result = extractSupplierSdsSection3Composition({ sourceDocumentHash: HASH, lines: [line(1, 1, "No composition data")] });
    expect(result.declaration).toBeUndefined();
    expect(result.components).toEqual([]);
    expect(result.warnings).toEqual(["section_3_not_detected"]);
  });

  it("retains OCR provenance and always requires human review", () => {
    const lines = [
      line(1, 1, "SECTION 3: Composition/information on ingredients"),
      line(1, 2, "Chemical name: Example", { source: "ocr", confidence: 0.38, position: { x: 8, y: 13 } }),
      line(1, 3, "CAS No: 444-44-4", { source: "ocr", confidence: 0.38 }),
      line(1, 4, "SECTION 4: First aid measures"),
    ];
    const result = extractSupplierSdsSection3Composition({ sourceDocumentHash: HASH, lines, ocrParserVersion: "local-ocr-7" });
    expect(result.ocrParserVersion).toBe("local-ocr-7");
    expect(result.components[0]?.originalName).toMatchObject({ reviewRequired: true, evidence: [{ source: "ocr", confidence: 0.38, position: { x: 8, y: 13 } }] });
    expect(result.warnings).toContain("section_3_ocr_requires_review");
    expect(result.warnings).toContain("human_review_required");
  });

  it("reports OCR provenance on standalone declarations and disclosure evidence", () => {
    const lines = [
      line(1, 1, "SECTION 3: Composition/information on ingredients"),
      line(1, 2, "Product type: Mixture", { source: "ocr", confidence: 0.3 }),
      line(1, 3, "Other ingredients not disclosed as confidential business information.", { source: "ocr", confidence: 0.3 }),
      line(1, 4, "SECTION 4: First aid measures"),
    ];
    const result = extractSupplierSdsSection3Composition({ sourceDocumentHash: HASH, lines });
    expect(result.warnings).toContain("section_3_ocr_requires_review");
    expect(result.warnings).toContain("human_review_required");
    expect(result.disclosureEvidence[0]?.evidence[0]).toMatchObject({ source: "ocr", confidence: 0.3 });
  });

  it("rejects a non-SHA-256 source hash", () => {
    expect(() => extractSupplierSdsSection3Composition({ sourceDocumentHash: "sds.pdf", lines: [] })).toThrow(/SHA-256/);
  });
});
