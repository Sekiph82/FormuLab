import { describe, expect, it } from "vitest";
import { detectSupplierSdsSections, type SupplierSdsSectionLine } from "./supplierSdsSectionDetection";
import { extractSupplierSdsSection7StorageHandling } from "./supplierSdsSection7StorageHandling";

const HASH = "e".repeat(64);
const line = (pageNumber: number, lineNumber: number, text: string, extra: Partial<SupplierSdsSectionLine> = {}): SupplierSdsSectionLine => ({
  pageNumber,
  lineNumber,
  text,
  source: "digital",
  ...extra,
});

describe("supplier SDS Section 7 storage and handling extraction", () => {
  it("extracts labeled temperature, storage, container, shelf-life and incompatibility values", () => {
    const lines = [
      line(1, 1, "SECTION 7: Handling and storage"),
      line(1, 2, "Storage temperature: 5–25 °C"),
      line(1, 3, "Storage conditions: Keep in a cool, dry place."),
      line(1, 4, "Suitable container material: Stainless steel"),
      line(1, 5, "Shelf life: 24 months"),
      line(1, 6, "Storage stability: Stable for 12 months in unopened packaging."),
      line(1, 7, "Incompatible materials: Strong oxidizers"),
      line(1, 8, "SECTION 8: Exposure controls/personal protection"),
      line(1, 9, "Wear protective gloves."),
    ];
    const result = extractSupplierSdsSection7StorageHandling({ sourceDocumentHash: HASH, lines, sections: detectSupplierSdsSections(lines) });
    expect(result.candidates.map(({ field, rawValue }) => [field, rawValue])).toEqual([
      ["storage_temperature", "5–25 °C"],
      ["storage_conditions", "Keep in a cool, dry place."],
      ["container_material_compatibility", "Stainless steel"],
      ["shelf_life", "24 months"],
      ["storage_stability", "Stable for 12 months in unopened packaging."],
      ["incompatible_materials", "Strong oxidizers"],
    ]);
    expect(result.candidates.every((candidate) => candidate.reviewRequired && candidate.evidence[0]?.sectionNumber === 7)).toBe(true);
    expect(result.warnings).toContain("human_review_required");
  });

  it("captures explicit handling constraints and their wrapped evidence", () => {
    const lines = [
      line(1, 1, "SECTION 7: Handling and storage"),
      line(1, 2, "Precautions for safe handling: Avoid contact with eyes."),
      line(1, 3, "Use local exhaust ventilation during transfer."),
      line(1, 4, "Storage temperature: 10 °C"),
      line(1, 5, "SECTION 8: Exposure controls/personal protection"),
    ];
    const result = extractSupplierSdsSection7StorageHandling({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toMatchObject([
      { field: "handling_constraints", rawValue: "Avoid contact with eyes. Use local exhaust ventilation during transfer.", evidence: [{ lineNumber: 2 }, { lineNumber: 3 }] },
      { field: "storage_temperature", rawValue: "10 °C" },
    ]);
  });

  it("extracts explicit storage instructions as evidence without inferring material compatibility", () => {
    const lines = [
      line(1, 1, "SECTION 7: Handling and storage"),
      line(1, 2, "Store in the original container and protect from direct sunlight."),
      line(1, 3, "SECTION 8: Exposure controls/personal protection"),
    ];
    const result = extractSupplierSdsSection7StorageHandling({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toMatchObject([{ field: "storage_conditions", rawValue: "Store in the original container and protect from direct sunlight." }]);
    expect(result.candidates.some(({ field }) => field === "container_material_compatibility")).toBe(false);
  });

  it("keeps label-only values and grouped instructions complete without duplicate candidates", () => {
    const lines = [
      line(1, 1, "SECTION 7: Handling and storage"),
      line(1, 2, "Storage temperature"),
      line(1, 3, "5–10 °C"),
      line(1, 4, "Store in a cool place."),
      line(1, 5, "Protect from sunlight."),
      line(1, 6, "SECTION 8: Exposure controls/personal protection"),
    ];
    const result = extractSupplierSdsSection7StorageHandling({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toMatchObject([
      { field: "storage_temperature", rawValue: "5–10 °C", evidence: [{ lineNumber: 2 }, { lineNumber: 3 }] },
      { field: "storage_conditions", rawValue: "Store in a cool place. Protect from sunlight.", evidence: [{ lineNumber: 4 }, { lineNumber: 5 }] },
    ]);
    expect(result.warnings).not.toContain("conflicting_section_7_candidates");
  });

  it("classifies ignition-source avoidance as a handling constraint, not storage compatibility", () => {
    const lines = [
      line(1, 1, "SECTION 7: Handling and storage"),
      line(1, 2, "Keep away from ignition sources during transfer."),
      line(1, 3, "SECTION 8: Exposure controls/personal protection"),
    ];
    const result = extractSupplierSdsSection7StorageHandling({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toMatchObject([{ field: "handling_constraints", rawValue: "Keep away from ignition sources during transfer." }]);
  });

  it("surfaces handling clauses inside a combined storage-and-handling field separately", () => {
    const lines = [
      line(1, 1, "SECTION 7: Handling and storage"),
      line(1, 2, "Storage and handling: Avoid contact with eyes during transfer; keep container closed."),
      line(1, 3, "SECTION 8: Exposure controls/personal protection"),
    ];
    const result = extractSupplierSdsSection7StorageHandling({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toMatchObject([
      { field: "storage_conditions", rawValue: "Avoid contact with eyes during transfer; keep container closed." },
      { field: "handling_constraints", rawValue: "Avoid contact with eyes during transfer" },
    ]);
  });

  it("separates adjacent storage and handling instructions in either order", () => {
    const storageThenHandling = [
      line(1, 1, "SECTION 7: Handling and storage"),
      line(1, 2, "Store in a cool place."),
      line(1, 3, "Avoid contact with eyes during transfer."),
      line(1, 4, "SECTION 8: Exposure controls/personal protection"),
    ];
    const first = extractSupplierSdsSection7StorageHandling({ sourceDocumentHash: HASH, lines: storageThenHandling });
    expect(first.candidates).toMatchObject([
      { field: "storage_conditions", rawValue: "Store in a cool place." },
      { field: "handling_constraints", rawValue: "Avoid contact with eyes during transfer." },
    ]);

    const handlingThenStorage = [
      line(1, 1, "SECTION 7: Handling and storage"),
      line(1, 2, "Avoid contact with eyes during transfer."),
      line(1, 3, "Store in a cool place."),
      line(1, 4, "SECTION 8: Exposure controls/personal protection"),
    ];
    const second = extractSupplierSdsSection7StorageHandling({ sourceDocumentHash: HASH, lines: handlingThenStorage });
    expect(second.candidates).toMatchObject([
      { field: "handling_constraints", rawValue: "Avoid contact with eyes during transfer." },
      { field: "storage_conditions", rawValue: "Store in a cool place." },
    ]);
  });

  it("flags conflicting explicit values instead of selecting one", () => {
    const lines = [
      line(1, 1, "SECTION 7: Handling and storage"),
      line(1, 2, "Storage temperature: 5 °C"),
      line(1, 3, "Storage temperature: 25 °C"),
      line(1, 4, "SECTION 8: Exposure controls/personal protection"),
    ];
    const result = extractSupplierSdsSection7StorageHandling({ sourceDocumentHash: HASH, lines });
    expect(result.candidates.filter(({ field }) => field === "storage_temperature")).toHaveLength(2);
    expect(result.warnings).toContain("conflicting_section_7_candidates");
  });

  it("does not attribute later sections when Section 8 is missing or unreadable", () => {
    const lines = [
      line(1, 1, "SECTION 7: Handling and storage"),
      line(1, 2, "Storage temperature: 5 °C"),
      line(1, 3, "SECTION 8: Unknown exposure heading"),
      line(2, 1, "Shelf life: unrelated later text"),
      line(3, 1, "SECTION 9: Physical and chemical properties"),
    ];
    const result = extractSupplierSdsSection7StorageHandling({ sourceDocumentHash: HASH, lines });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(["section_7_boundary_incomplete"]);
  });

  it("returns an explicit no-section result instead of inferring handling values", () => {
    const result = extractSupplierSdsSection7StorageHandling({ sourceDocumentHash: HASH, lines: [line(1, 1, "Keep away from heat.")] });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(["section_7_not_detected"]);
  });

  it("retains OCR provenance and requires human review", () => {
    const lines = [
      line(1, 1, "SECTION 7: Handling and storage"),
      line(1, 2, "Storage temperature: 5–25 °C", { source: "ocr", confidence: 0.42, position: { x: 4, y: 7 } }),
      line(1, 3, "SECTION 8: Exposure controls/personal protection"),
    ];
    const result = extractSupplierSdsSection7StorageHandling({ sourceDocumentHash: HASH, lines, ocrParserVersion: "local-ocr-v7" });
    expect(result.ocrParserVersion).toBe("local-ocr-v7");
    expect(result.candidates[0]).toMatchObject({ reviewRequired: true, evidence: [{ source: "ocr", confidence: 0.42, position: { x: 4, y: 7 } }] });
    expect(result.warnings).toContain("section_7_ocr_requires_review");
  });

  it("rejects an invalid document hash", () => {
    expect(() => extractSupplierSdsSection7StorageHandling({ sourceDocumentHash: "sds.pdf", lines: [] })).toThrow(/SHA-256/);
  });
});
