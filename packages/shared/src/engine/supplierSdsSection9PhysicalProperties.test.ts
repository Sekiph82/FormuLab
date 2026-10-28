import { describe, expect, it } from "vitest";
import { detectSupplierSdsSections, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";
import { extractSupplierSdsSection9PhysicalProperties } from "./supplierSdsSection9PhysicalProperties";

const HASH = "a".repeat(64);
const line = (pageNumber: number, lineNumber: number, text: string, extra: Partial<SupplierSdsSectionLine> = {}): SupplierSdsSectionLine => ({
  pageNumber, lineNumber, text, source: "digital", ...extra,
});

describe("supplier SDS Section 9 physical-property extraction", () => {
  it("extracts labeled physical properties without normalizing printed values or units", () => {
    const lines = [
      line(1, 1, "SECTION 9: Physical and chemical properties"),
      line(1, 2, "Physical state: Liquid"),
      line(1, 3, "Appearance: Clear liquid"),
      line(1, 4, "Colour: pale yellow"),
      line(1, 5, "Odour: characteristic"),
      line(1, 6, "Odour threshold: 0.5 ppm"),
      line(1, 7, "pH: 5.0–6.0 (10% solution, 20 °C)"),
      line(1, 8, "Melting point/freezing point: < -20 °C"),
      line(1, 9, "Initial boiling point and boiling range: >100 °C at 101.3 kPa"),
      line(1, 10, "Flash point: >100 °C (closed cup)"),
      line(1, 11, "Density: 1.02 g/cm³ at 20 °C"),
      line(1, 12, "Relative density: 1.02 (water = 1)"),
      line(1, 13, "Solubility in water: completely miscible"),
      line(1, 14, "Vapour pressure: 2.4 kPa at 20 °C"),
      line(1, 15, "Log Pow: 3.2"),
      line(1, 16, "Dynamic viscosity: 120 mPa·s at 25 °C"),
      line(1, 17, "Molecular weight: 58.08 g/mol"),
      line(1, 18, "SECTION 10: Stability and reactivity"),
    ];
    const result = extractSupplierSdsSection9PhysicalProperties({ sourceDocumentHash: HASH, lines, sections: detectSupplierSdsSections(lines) });
    expect(result.candidates.map(({ field, rawValue }) => [field, rawValue])).toEqual([
      ["physical_state", "Liquid"], ["appearance", "Clear liquid"], ["color", "pale yellow"], ["odor", "characteristic"],
      ["odor_threshold", "0.5 ppm"], ["ph", "5.0–6.0 (10% solution, 20 °C)"], ["melting_freezing_point", "< -20 °C"],
      ["boiling_point", ">100 °C at 101.3 kPa"], ["flash_point", ">100 °C (closed cup)"],
      ["density", "1.02 g/cm³ at 20 °C"], ["relative_density", "1.02 (water = 1)"],
      ["solubility", "completely miscible"], ["vapor_pressure", "2.4 kPa at 20 °C"],
      ["partition_coefficient", "3.2"], ["viscosity", "120 mPa·s at 25 °C"], ["molecular_weight", "58.08 g/mol"],
    ]);
    expect(result.candidates.every((candidate) => candidate.reviewRequired && candidate.evidence[0]?.sectionNumber === 9)).toBe(true);
    expect(result.candidates.find(({ field }) => field === "ph")?.measurementContext).toMatchObject({
      originalText: "5.0–6.0 (10% solution, 20 °C)",
      normalizedValue: { status: "range_normalized", lowerBound: 5, upperBound: 6 },
      temperature: { value: 20, unit: "°C" },
      sampleConcentration: { value: 10, basis: "percent" },
    });
    expect(result.warnings).toContain("human_review_required");
  });

  it("retains wrapped value context, page evidence and OCR review metadata", () => {
    const lines = [
      line(2, 1, "SECTION 9: Physical and chemical properties"),
      line(2, 2, "pH"),
      line(2, 3, "5.5 in 1% aqueous solution"),
      line(2, 4, "at 23 °C", { source: "ocr", confidence: 0.71, position: { x: 20, y: 30 } }),
      line(2, 5, "Viscosity 80 mPa·s (Brookfield, 25 °C)"),
      line(2, 6, "SECTION 10: Stability and reactivity"),
    ];
    const result = extractSupplierSdsSection9PhysicalProperties({ sourceDocumentHash: HASH, lines, ocrParserVersion: "ocr-test-v1" });
    expect(result.candidates).toMatchObject([
      { field: "ph", rawValue: "5.5 in 1% aqueous solution at 23 °C", evidence: [{ pageNumber: 2, lineNumber: 2 }, { pageNumber: 2, lineNumber: 3 }, { pageNumber: 2, lineNumber: 4 }] },
      { field: "viscosity", rawValue: "80 mPa·s (Brookfield, 25 °C)" },
    ]);
    expect(result.candidates[0]?.evidence[2]).toMatchObject({ source: "ocr", confidence: 0.71, position: { x: 20, y: 30 } });
    expect(result.ocrParserVersion).toBe("ocr-test-v1");
    expect(result.warnings).toContain("section_9_ocr_requires_review");
  });

  it("preserves an ambiguous density label as such instead of choosing a field", () => {
    const lines = [line(1, 1, "SECTION 9: Physical and chemical properties"), line(1, 2, "Density and/or relative density: 1.04"), line(1, 3, "SECTION 10: Stability and reactivity")];
    const result = extractSupplierSdsSection9PhysicalProperties({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toMatchObject([{ field: "density_or_relative_density", rawValue: "1.04" }]);
  });

  it("warns that a source-stated typical physical value is not a specification", () => {
    const lines = [
      line(1, 1, "SECTION 9: Physical and chemical properties"),
      line(1, 2, "Density: Typical value 0.951 g/cm³ at 25 °C"),
      line(1, 3, "SECTION 10: Stability and reactivity"),
    ];
    const result = extractSupplierSdsSection9PhysicalProperties({ sourceDocumentHash: HASH, lines });
    expect(result.candidates[0]?.measurementContext).toMatchObject({
      originalText: "Typical value 0.951 g/cm³ at 25 °C",
      claimKind: "typical",
      deliveredFormBasis: "unspecified",
      temperature: { value: 25, unit: "°C" },
    });
    expect(result.warnings).toContain("section_9_typical_value_not_specification");
  });

  it("does not read beyond the explicit Section 10 boundary or infer missing values", () => {
    const complete = [
      line(1, 1, "SECTION 9: Physical and chemical properties"),
      line(1, 2, "pH: Data not available"),
      line(1, 3, "SECTION 10: Stability and reactivity"),
      line(1, 4, "Density: 1.2 g/cm³"),
    ];
    const result = extractSupplierSdsSection9PhysicalProperties({ sourceDocumentHash: HASH, lines: complete });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toContain("no_section_9_property_candidates");

    const incomplete = [line(1, 1, "SECTION 9: Physical and chemical properties"), line(1, 2, "Density: 1.2 g/cm³")];
    expect(extractSupplierSdsSection9PhysicalProperties({ sourceDocumentHash: HASH, lines: incomplete })).toMatchObject({
      candidates: [], warnings: ["section_9_boundary_incomplete"],
    });
  });

  it("reports missing Section 9 and rejects an invalid source hash", () => {
    expect(extractSupplierSdsSection9PhysicalProperties({ sourceDocumentHash: HASH, lines: [] }).warnings).toEqual(["section_9_not_detected"]);
    expect(() => extractSupplierSdsSection9PhysicalProperties({ sourceDocumentHash: "bad", lines: [] })).toThrow(/SHA-256/u);
  });

  it("leaves unsupported or absent Section 9 properties unavailable", () => {
    const lines = [
      line(1, 1, "SECTION 9: Physical and chemical properties"),
      line(1, 2, "Active matter: 40%"),
      line(1, 3, "Unknown supplier property: proprietary value"),
      line(1, 4, "SECTION 10: Stability and reactivity"),
    ];

    const result = extractSupplierSdsSection9PhysicalProperties({ sourceDocumentHash: HASH, lines });

    expect(result.candidates).toEqual([]);
    expect(result.warnings).toContain("no_section_9_property_candidates");
  });
});
