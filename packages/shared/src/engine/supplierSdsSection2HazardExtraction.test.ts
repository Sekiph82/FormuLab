import { describe, expect, it } from "vitest";
import { detectSupplierSdsSections, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";
import { extractSupplierSdsSection2Hazards } from "./supplierSdsSection2HazardExtraction";

const HASH = "c".repeat(64);
const line = (pageNumber: number, lineNumber: number, text: string, extra: Partial<SupplierSdsSectionLine> = {}): SupplierSdsSectionLine => ({
  pageNumber,
  lineNumber,
  text,
  source: "digital",
  ...extra,
});

describe("supplier SDS Section 2 hazard extraction", () => {
  it("extracts explicit classification, signal word, H/P statements, pictograms and regulatory context", () => {
    const lines = [
      line(1, 1, "SECTION 2: Hazards identification"),
      line(1, 2, "Classification: Acute toxicity - Category 4; Skin corrosion - Category 1B"),
      line(1, 3, "Signal word: Danger"),
      line(1, 4, "H315 Causes skin irritation"),
      line(1, 5, "P264 Wash thoroughly after handling"),
      line(1, 6, "Pictograms: GHS05, GHS07"),
      line(1, 7, "This classification follows CLP Regulation (EC) No 1272/2008."),
      line(1, 8, "EUH208 Contains fragrance allergens."),
      line(1, 9, "PBT assessment: This substance is not considered PBT."),
      line(1, 10, "vPvB assessment: This substance is not considered vPvB."),
      line(1, 11, "No endocrine-disrupting properties are identified in this SDS."),
      line(1, 12, "Market: EU"),
      line(1, 13, "SECTION 3: Composition/information on ingredients"),
      line(1, 14, "Ingredient details."),
    ];
    const result = extractSupplierSdsSection2Hazards({ sourceDocumentHash: HASH, lines, sections: detectSupplierSdsSections(lines) });
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "hazard_classification", rawValue: expect.stringContaining("Category 4") }),
      expect.objectContaining({ field: "signal_word", rawValue: "Danger" }),
      expect.objectContaining({ field: "hazard_statement", rawValue: "H315 Causes skin irritation" }),
      expect.objectContaining({ field: "precautionary_statement", rawValue: "P264 Wash thoroughly after handling" }),
      expect.objectContaining({ field: "pictogram", rawValue: "GHS05" }),
      expect.objectContaining({ field: "pictogram", rawValue: "GHS07" }),
      expect.objectContaining({ field: "classification_scheme", rawValue: "CLP" }),
      expect.objectContaining({ field: "hazard_statement", rawValue: "EUH208 Contains fragrance allergens." }),
      expect.objectContaining({ field: "pbt_statement", rawValue: expect.stringContaining("not considered PBT") }),
      expect.objectContaining({ field: "vpvb_statement", rawValue: expect.stringContaining("not considered vPvB") }),
      expect.objectContaining({ field: "endocrine_disruption_statement", rawValue: expect.stringContaining("No endocrine") }),
      expect.objectContaining({ field: "market_context", rawValue: "EU" }),
    ]));
    expect(result.candidates.every((candidate) => candidate.reviewRequired === true
      && candidate.evidence.every((evidence) => evidence.sectionNumber === 2 && evidence.sourceDocumentHash === HASH))).toBe(true);
    expect(result.warnings).toContain("human_review_required");
  });

  it("extracts explicit H and P codes as their full printed statement evidence", () => {
    const lines = [
      line(1, 1, "SECTION 2: Hazards identification"),
      line(1, 2, "H315 Causes skin"),
      line(1, 3, "irritation."),
      line(1, 4, "P264 Wash thoroughly"),
      line(1, 5, "after handling."),
      line(1, 6, "SECTION 3: Composition/information on ingredients"),
    ];
    const result = extractSupplierSdsSection2Hazards({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toMatchObject([
      { field: "hazard_statement", rawValue: "H315 Causes skin irritation.", extractionMethod: "explicit_code", evidence: [{ lineNumber: 2 }, { lineNumber: 3 }] },
      { field: "precautionary_statement", rawValue: "P264 Wash thoroughly after handling.", extractionMethod: "explicit_code", evidence: [{ lineNumber: 4 }, { lineNumber: 5 }] },
    ]);
  });

  it("extracts signal words from localized labels", () => {
    const lines = [
      line(1, 1, "SECTION 2: Hazards identification"),
      line(1, 2, "Signalwort: Gefahr"),
      line(1, 3, "Mention d'avertissement: Attention"),
      line(1, 4, "SECTION 3: Composition/information on ingredients"),
    ];
    const result = extractSupplierSdsSection2Hazards({ sourceDocumentHash: HASH, lines });
    expect(result.candidates.filter(({ field }) => field === "signal_word")).toMatchObject([
      { rawValue: "Gefahr" }, { rawValue: "Attention" },
    ]);
  });

  it("does not pull content from later sections when Section 2 or Section 3 boundaries are missing", () => {
    const lines = [
      line(1, 1, "SECTION 2: Hazards identification"),
      line(1, 2, "Signal word: Danger"),
      line(1, 3, "SECTION 3: Unknown composition heading"),
      line(2, 1, "H315 appears in later unrelated text"),
      line(3, 1, "SECTION 4: First aid measures"),
    ];
    const result = extractSupplierSdsSection2Hazards({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(["section_2_boundary_incomplete"]);
  });

  it("reports absent Section 2 without inferring classifications", () => {
    const result = extractSupplierSdsSection2Hazards({ sourceDocumentHash: HASH, lines: [line(1, 1, "H315 Causes irritation")] });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(["section_2_not_detected"]);
  });

  it("preserves explicit market conflicts as evidence and reports ambiguity", () => {
    const lines = [
      line(1, 1, "SECTION 2: Hazards identification"),
      line(1, 2, "Market: EU"),
      line(1, 3, "Country/market: US"),
      line(1, 4, "SECTION 3: Composition/information on ingredients"),
    ];
    const result = extractSupplierSdsSection2Hazards({ sourceDocumentHash: HASH, lines });
    expect(result.candidates.filter(({ field }) => field === "market_context")).toHaveLength(2);
    expect(result.warnings).toContain("conflicting_market_context");
  });

  it("flags OCR and unknown provenance for human review and retains the source details", () => {
    const lines = [
      line(1, 1, "SECTION 2: Hazards identification"),
      line(1, 2, "H315 Causes skin irritation", { source: "ocr", confidence: 0.38, position: { x: 3, y: 9 } }),
      line(1, 3, "SECTION 3: Composition/information on ingredients"),
    ];
    const result = extractSupplierSdsSection2Hazards({ sourceDocumentHash: HASH, lines, ocrParserVersion: "local-tess-7" });
    expect(result).toMatchObject({ ocrParserVersion: "local-tess-7" });
    expect(result.candidates[0]).toMatchObject({ reviewRequired: true, evidence: [{ source: "ocr", confidence: 0.38, position: { x: 3, y: 9 } }] });
    expect(result.warnings).toContain("section_2_ocr_requires_review");
  });

  it("rejects an invalid source hash", () => {
    expect(() => extractSupplierSdsSection2Hazards({ sourceDocumentHash: "sample.pdf", lines: [] })).toThrow(/SHA-256/);
  });
});
