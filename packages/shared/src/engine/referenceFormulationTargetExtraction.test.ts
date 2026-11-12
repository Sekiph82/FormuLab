import { describe, expect, it } from "vitest";
import { referenceFormulationSourceSchema } from "../schemas/referenceFormulationSource";
import { extractReferenceFormulationTargets } from "./referenceFormulationTargetExtraction";

const HASH = "a".repeat(64);
const source = () => referenceFormulationSourceSchema.parse({
  schemaVersion: "1.0", id: "formula-source-targets", supplierId: "supplier-croda", providerId: "croda-public", surfaceId: "formulation-library",
  sourceProduct: { tradeName: "Example supplier product" }, acquisitionCode: "supplierdoc-formula-targets", sourcePdfSha256: HASH,
  acquisitionMethod: "manual_assisted", sourceFileSelection: { selectionId: "selection-targets", originalFilename: "formula.pdf", sourceFileSha256: HASH, selectedAt: "2026-10-26T08:00:00.000Z", selectedBy: "owner-1" },
  originalFilename: "formula.pdf", sourceByteSize: 2048, acquiredAt: "2026-10-26T08:00:00.000Z", title: "Example formula", market: "EU", language: "en",
  parserVersion: "formulab-reference-formulation-layout-v1", rights: { status: "unknown", redistribution: "unknown", evidenceRefs: [] }, createdAt: "2026-10-26T08:01:00.000Z",
});

describe("reference formulation target/result extraction", () => {
  it("extracts labeled target and typical-result values with range and approximation semantics", () => {
    const result = extractReferenceFormulationTargets({ source: source(), pages: [{ pageNumber: 1, blocks: [
      { type: "heading", blockIndex: 0, text: "Target Values", source: "digital" },
      { type: "text", blockIndex: 1, text: "pH: approximately 5.0–5.5", source: "digital" },
      { type: "text", blockIndex: 2, text: "Density: approximately 1.02 g/mL at 25°C", source: "digital" },
      { type: "heading", blockIndex: 3, text: "Typical Results", source: "digital" },
      { type: "text", blockIndex: 4, text: "Viscosity: ~375 cP at 20°C", source: "digital" },
      { type: "text", blockIndex: 5, text: "Appearance: clear, pale yellow liquid", source: "digital" },
    ] }] });

    expect(result.candidates).toHaveLength(4);
    expect(result.candidates.map(({ field, rawValue, valueShape, resultSemantics }) => ({ field, rawValue, valueShape, resultSemantics }))).toEqual([
      { field: "ph", rawValue: "approximately 5.0–5.5", valueShape: "approximate_range", resultSemantics: "target" },
      { field: "density", rawValue: "approximately 1.02 g/mL at 25°C", valueShape: "approximate", resultSemantics: "target" },
      { field: "viscosity", rawValue: "~375 cP at 20°C", valueShape: "approximate", resultSemantics: "typical_result" },
      { field: "appearance", rawValue: "clear, pale yellow liquid", valueShape: "point_or_exact", resultSemantics: "typical_result" },
    ]);
    expect(result.candidates[0]).toMatchObject({ reviewRequired: true, evidence: { sourceDocumentHash: HASH, pageNumber: 1, blockIndex: 1 } });
    expect(result.warnings).toEqual([]);
  });

  it("extracts property table cells with row/cell citations and preserves OCR review state", () => {
    const result = extractReferenceFormulationTargets({ source: source(), pages: [{ pageNumber: 2, blocks: [
      { type: "table", blockIndex: 0, source: "mixed", confidence: 0.81, rows: [
        ["pH", "Viscosity", "Density"],
        ["~7.0", "350–400 cP", "1.01 g/mL"],
      ] },
    ] }] });

    expect(result.candidates).toHaveLength(3);
    expect(result.candidates).toContainEqual(expect.objectContaining({ field: "ph", rawValue: "~7.0", valueShape: "approximate", evidence: expect.objectContaining({ rowIndex: 1, cellIndex: 0, source: "mixed", confidence: 0.81 }) }));
    expect(result.candidates).toContainEqual(expect.objectContaining({ field: "viscosity", rawValue: "350–400 cP", valueShape: "range", evidence: expect.objectContaining({ rowIndex: 1, cellIndex: 1 }) }));
    expect(result.warnings).toContain("ocr_target_results_require_review");
  });

  it("does not treat process or ingredient prose as finished-product results", () => {
    const result = extractReferenceFormulationTargets({ source: source(), pages: [{ pageNumber: 1, blocks: [
      { type: "heading", blockIndex: 0, text: "Procedure", source: "digital" },
      { type: "text", blockIndex: 1, text: "Adjust pH: 5.2 while mixing.", source: "digital" },
      { type: "heading", blockIndex: 2, text: "Ingredients", source: "digital" },
      { type: "text", blockIndex: 3, text: "Viscosity: 10 cP", source: "digital" },
      { type: "text", blockIndex: 4, text: "pH: 5.0", source: "digital" },
    ] }] });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(["no_target_result_section", "no_target_result_candidates"]);
  });

  it("does not treat process-table conditions as finished-product targets", () => {
    const result = extractReferenceFormulationTargets({ source: source(), pages: [{ pageNumber: 1, blocks: [
      { type: "heading", blockIndex: 0, text: "Procedure", source: "digital" },
      { type: "table", blockIndex: 1, rows: [["Step", "Operation", "pH"], ["1", "Adjust during mixing", "5.2"]] },
    ] }] });
    expect(result.candidates).toEqual([]);
    expect(result.warnings).toEqual(["no_target_result_section", "no_target_result_candidates"]);

    const unheaded = extractReferenceFormulationTargets({ source: source(), pages: [{ pageNumber: 1, blocks: [
      { type: "table", blockIndex: 0, rows: [["Step", "Operation", "pH"], ["1", "Adjust during mixing", "5.2"]] },
    ] }] });
    expect(unheaded.candidates).toEqual([]);

    const headed = extractReferenceFormulationTargets({ source: source(), pages: [{ pageNumber: 1, blocks: [
      { type: "heading", blockIndex: 0, text: "Finished Product", source: "digital" },
      { type: "table", blockIndex: 1, rows: [["Step", "Operation", "pH"], ["1", "Adjust during mixing", "5.2"]] },
    ] }] });
    expect(headed.candidates).toEqual([]);
  });
});
