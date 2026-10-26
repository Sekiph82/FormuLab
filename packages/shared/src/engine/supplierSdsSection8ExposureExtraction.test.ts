import { describe, expect, it } from "vitest";
import { detectSupplierSdsSections, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";
import { extractSupplierSdsSection8Exposure } from "./supplierSdsSection8ExposureExtraction";

const HASH = "f".repeat(64);
const line = (pageNumber: number, lineNumber: number, text: string, extra: Partial<SupplierSdsSectionLine> = {}): SupplierSdsSectionLine => ({
  pageNumber,
  lineNumber,
  text,
  source: "digital",
  ...extra,
});

describe("supplier SDS Section 8 exposure extraction", () => {
  it("extracts OEL/TWA/STEL, source, PPE, glove conditions, respirator and engineering controls", () => {
    const lines = [
      line(1, 1, "SECTION 8: Exposure controls/personal protection"),
      line(1, 2, "TWA: 10 ppm"),
      line(1, 3, "STEL: 20 ppm"),
      line(1, 4, "Source: ACGIH"),
      line(1, 5, "Personal protective equipment: Chemical-resistant protection is required."),
      line(1, 6, "Glove material: Butyl rubber"),
      line(1, 7, "Breakthrough time: >480 min"),
      line(1, 8, "Glove thickness: 0.5 mm"),
      line(1, 9, "Respiratory protection: Use an approved particulate respirator if ventilation is insufficient."),
      line(1, 10, "Engineering controls: Provide local exhaust ventilation."),
      line(1, 11, "SECTION 9: Physical and chemical properties"),
      line(1, 12, "No physical property values."),
    ];
    const result = extractSupplierSdsSection8Exposure({ sourceDocumentHash: HASH, lines, sections: detectSupplierSdsSections(lines) });
    expect(result.candidates.map(({ field, rawValue }) => [field, rawValue])).toEqual([
      ["occupational_exposure_limit", "10 ppm"],
      ["occupational_exposure_limit", "20 ppm"],
      ["exposure_limit_source", "ACGIH"],
      ["personal_protective_equipment", "Chemical-resistant protection is required."],
      ["glove_material", "Butyl rubber"],
      ["glove_breakthrough_time", ">480 min"],
      ["glove_thickness", "0.5 mm"],
      ["respiratory_protection", "Use an approved particulate respirator if ventilation is insufficient."],
      ["engineering_control", "Provide local exhaust ventilation."],
    ]);
    expect(result.candidates.every((candidate) => candidate.reviewRequired && candidate.evidence[0]?.sectionNumber === 8)).toBe(true);
    expect(result.warnings).toContain("human_review_required");
  });

  it("retains the complete printed limit row and source citation with units", () => {
    const lines = [
      line(1, 1, "SECTION 8: Exposure controls/personal protection"),
      line(1, 2, "Workplace Exposure Limit (EH40): 5 mg/m³, 8-hour TWA"),
      line(1, 3, "SECTION 9: Physical and chemical properties"),
    ];
    const result = extractSupplierSdsSection8Exposure({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "occupational_exposure_limit", rawValue: "Workplace Exposure Limit (EH40): 5 mg/m³, 8-hour TWA" }),
      expect.objectContaining({ field: "exposure_limit_source", rawValue: "EH40" }),
    ]));
  });

  it("keeps adjacent unlabeled TWA and STEL rows separate", () => {
    const lines = [
      line(1, 1, "SECTION 8: Exposure controls/personal protection"),
      line(1, 2, "8-hour TWA 5 ppm"),
      line(1, 3, "15-minute STEL 10 ppm"),
      line(1, 4, "SECTION 9: Physical and chemical properties"),
    ];
    const result = extractSupplierSdsSection8Exposure({ sourceDocumentHash: HASH, lines });
    expect(result.candidates.filter(({ field }) => field === "occupational_exposure_limit").map(({ rawValue }) => rawValue)).toEqual([
      "8-hour TWA 5 ppm", "15-minute STEL 10 ppm",
    ]);
  });

  it("extracts inline source and glove breakthrough/thickness details from labeled lines", () => {
    const lines = [
      line(1, 1, "SECTION 8: Exposure controls/personal protection"),
      line(1, 2, "TWA: 5 ppm (ACGIH)"),
      line(1, 3, "Glove material: Butyl rubber; breakthrough time >480 min; glove thickness 0.5 mm"),
      line(1, 4, "SECTION 9: Physical and chemical properties"),
    ];
    const result = extractSupplierSdsSection8Exposure({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "occupational_exposure_limit", rawValue: "5 ppm (ACGIH)" }),
      expect.objectContaining({ field: "exposure_limit_source", rawValue: "ACGIH" }),
      expect.objectContaining({ field: "glove_material", rawValue: "Butyl rubber; breakthrough time >480 min; glove thickness 0.5 mm" }),
      expect.objectContaining({ field: "glove_breakthrough_time", rawValue: "breakthrough time >480 min" }),
      expect.objectContaining({ field: "glove_thickness", rawValue: "glove thickness 0.5 mm" }),
    ]));
  });

  it("extracts separate source and glove details when they wrap to following lines", () => {
    const lines = [
      line(1, 1, "SECTION 8: Exposure controls/personal protection"),
      line(1, 2, "TWA: 5 ppm"),
      line(1, 3, "ACGIH"),
      line(1, 4, "Glove material: Butyl rubber"),
      line(1, 5, "Breakthrough time >480 min"),
      line(1, 6, "SECTION 9: Physical and chemical properties"),
    ];
    const result = extractSupplierSdsSection8Exposure({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toMatchObject([
      { field: "occupational_exposure_limit", rawValue: "5 ppm" },
      { field: "exposure_limit_source", rawValue: "ACGIH" },
      { field: "glove_material", rawValue: "Butyl rubber" },
      { field: "glove_breakthrough_time", rawValue: "Breakthrough time >480 min" },
    ]);
  });

  it("extracts glove metrics embedded in a general PPE-labeled statement", () => {
    const lines = [
      line(1, 1, "SECTION 8: Exposure controls/personal protection"),
      line(1, 2, "Personal protective equipment: Wear nitrile gloves; breakthrough time >480 min; thickness 0.5 mm"),
      line(1, 3, "SECTION 9: Physical and chemical properties"),
    ];
    const result = extractSupplierSdsSection8Exposure({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "personal_protective_equipment" }),
      expect.objectContaining({ field: "glove_breakthrough_time", rawValue: "breakthrough time >480 min" }),
      expect.objectContaining({ field: "glove_thickness", rawValue: "thickness 0.5 mm" }),
    ]));
  });

  it("captures explicit unlabeled respirator, engineering-control and PPE instructions", () => {
    const lines = [
      line(1, 1, "SECTION 8: Exposure controls/personal protection"),
      line(1, 2, "Use an approved respirator if ventilation is insufficient."),
      line(1, 3, "Provide local exhaust ventilation at transfer points."),
      line(1, 4, "Wear protective gloves and safety glasses."),
      line(1, 5, "SECTION 9: Physical and chemical properties"),
    ];
    const result = extractSupplierSdsSection8Exposure({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toMatchObject([
      { field: "respiratory_protection", rawValue: "Use an approved respirator if ventilation is insufficient." },
      { field: "engineering_control", rawValue: "Provide local exhaust ventilation at transfer points." },
      { field: "personal_protective_equipment", rawValue: "Wear protective gloves and safety glasses." },
    ]);
    expect(result.candidates.every((candidate) => candidate.reviewRequired)).toBe(true);
  });

  it("retains wrapped conditions and all evidence for unlabeled exposure instructions", () => {
    const lines = [
      line(1, 1, "SECTION 8: Exposure controls/personal protection"),
      line(1, 2, "Use an approved respirator if ventilation is"),
      line(1, 3, "insufficient."),
      line(1, 4, "Provide local exhaust"),
      line(1, 5, "ventilation at transfer points."),
      line(1, 6, "Wear protective gloves and safety"),
      line(1, 7, "glasses."),
      line(1, 8, "SECTION 9: Physical and chemical properties"),
    ];
    const result = extractSupplierSdsSection8Exposure({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toMatchObject([
      { field: "respiratory_protection", rawValue: "Use an approved respirator if ventilation is insufficient.", evidence: [{ lineNumber: 2 }, { lineNumber: 3 }] },
      { field: "engineering_control", rawValue: "Provide local exhaust ventilation at transfer points.", evidence: [{ lineNumber: 4 }, { lineNumber: 5 }] },
      { field: "personal_protective_equipment", rawValue: "Wear protective gloves and safety glasses.", evidence: [{ lineNumber: 6 }, { lineNumber: 7 }] },
    ]);
  });

  it("supports label-only exposure values and preserves wrapped evidence", () => {
    const lines = [
      line(1, 1, "SECTION 8: Exposure controls/personal protection"),
      line(1, 2, "Glove material"),
      line(1, 3, "Nitrile rubber"),
      line(1, 4, "Glove thickness: 0.4"),
      line(1, 5, "mm"),
      line(1, 6, "SECTION 9: Physical and chemical properties"),
    ];
    const result = extractSupplierSdsSection8Exposure({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toMatchObject([
      { field: "glove_material", rawValue: "Nitrile rubber", evidence: [{ lineNumber: 2 }, { lineNumber: 3 }] },
      { field: "glove_thickness", rawValue: "0.4 mm", evidence: [{ lineNumber: 4 }, { lineNumber: 5 }] },
    ]);
  });

  it("keeps conflicting limit values as separate candidates", () => {
    const lines = [
      line(1, 1, "SECTION 8: Exposure controls/personal protection"),
      line(1, 2, "TWA: 5 mg/m³"),
      line(1, 3, "TWA: 10 mg/m³"),
      line(1, 4, "SECTION 9: Physical and chemical properties"),
    ];
    const result = extractSupplierSdsSection8Exposure({ sourceDocumentHash: HASH, lines });
    expect(result.candidates.filter(({ field }) => field === "occupational_exposure_limit")).toHaveLength(2);
    expect(result.warnings).toContain("conflicting_section_8_candidates");
  });

  it("does not assign later section data when the Section 8 to 9 boundary is incomplete", () => {
    const lines = [
      line(1, 1, "SECTION 8: Exposure controls/personal protection"),
      line(1, 2, "Respiratory protection: Use suitable protection."),
      line(1, 3, "SECTION 9: Unknown physical properties heading"),
      line(2, 1, "TWA: unrelated later text"),
      line(3, 1, "SECTION 10: Stability and reactivity"),
    ];
    const result = extractSupplierSdsSection8Exposure({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(["section_8_boundary_incomplete"]);
  });

  it("reports a missing Section 8 without manufacturing exposure limits", () => {
    const result = extractSupplierSdsSection8Exposure({ sourceDocumentHash: HASH, lines: [line(1, 1, "TWA 10 ppm")] });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(["section_8_not_detected"]);
  });

  it("retains low-confidence OCR provenance and requires human review", () => {
    const lines = [
      line(1, 1, "SECTION 8: Exposure controls/personal protection"),
      line(1, 2, "TWA: 10 ppm", { source: "ocr", confidence: 0.4, position: { x: 2, y: 5 } }),
      line(1, 3, "SECTION 9: Physical and chemical properties"),
    ];
    const result = extractSupplierSdsSection8Exposure({ sourceDocumentHash: HASH, lines, ocrParserVersion: "local-ocr-v7" });
    expect(result.ocrParserVersion).toBe("local-ocr-v7");
    expect(result.candidates[0]).toMatchObject({ reviewRequired: true, evidence: [{ source: "ocr", confidence: 0.4, position: { x: 2, y: 5 } }] });
    expect(result.warnings).toContain("section_8_ocr_requires_review");
  });

  it("rejects an invalid source hash", () => {
    expect(() => extractSupplierSdsSection8Exposure({ sourceDocumentHash: "sds.pdf", lines: [] })).toThrow(/SHA-256/);
  });
});
