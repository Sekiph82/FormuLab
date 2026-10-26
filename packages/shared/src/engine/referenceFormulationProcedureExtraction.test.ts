import { describe, expect, it } from "vitest";
import { referenceFormulationSourceSchema } from "../schemas/referenceFormulationSource";
import { extractReferenceFormulationProcedure } from "./referenceFormulationProcedureExtraction";

const HASH = "f".repeat(64);
const source = () => referenceFormulationSourceSchema.parse({
  schemaVersion: "1.0", id: "formula-source-1", supplierId: "supplier-croda", providerId: "croda-public", surfaceId: "formulation-library",
  sourceProduct: { tradeName: "Example supplier product" }, acquisitionCode: "supplierdoc-formula-1", sourcePdfSha256: HASH,
  acquisitionMethod: "manual_assisted", sourceFileSelection: { selectionId: "selection-1", originalFilename: "formula.pdf", sourceFileSha256: HASH, selectedAt: "2026-10-26T08:00:00.000Z", selectedBy: "owner-1" },
  originalFilename: "formula.pdf", sourceByteSize: 2048, acquiredAt: "2026-10-26T08:00:00.000Z", title: "Example formula", market: "EU", language: "en",
  parserVersion: "formulab-reference-formulation-layout-v1", rights: { status: "unknown", redistribution: "unknown", evidenceRefs: [] }, createdAt: "2026-10-26T08:01:00.000Z",
});

describe("reference formulation procedure extraction", () => {
  it("extracts ordered instructions and explicit process conditions from semantic sections", () => {
    const result = extractReferenceFormulationProcedure({
      source: source(),
      pages: [
        { pageNumber: 1, blocks: [
          { type: "heading", blockIndex: 0, text: "Manufacturing Procedure", source: "digital" },
          { type: "text", blockIndex: 1, text: "1. Add phase A slowly and mix until clear at 70–75°C for 10–15 min at 500–700 rpm.", source: "digital", position: { x: 50, y: 120 } },
          { type: "text", blockIndex: 2, text: "Adjust pH to 5.2, then add thickener and mix until homogeneous.", source: "digital" },
          { type: "heading", blockIndex: 3, text: "Finished Product", source: "digital" },
          { type: "text", blockIndex: 4, text: "Target pH 5.5", source: "digital" },
        ] },
      ],
    });
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({
      sequenceOrder: 1,
      printedStepNumber: "1",
      rawInstruction: "1. Add phase A slowly and mix until clear at 70–75°C for 10–15 min at 500–700 rpm.",
      actions: ["addition", "mix", "appearance_check"],
      conditions: [
        { kind: "temperature", rawValue: "70–75°C", evidence: { pageNumber: 1, blockIndex: 1 } },
        { kind: "time", rawValue: "10–15 min", evidence: { pageNumber: 1, blockIndex: 1 } },
        { kind: "speed", rawValue: "500–700 rpm", evidence: { pageNumber: 1, blockIndex: 1 } },
        { kind: "appearance", rawValue: "clear", evidence: { pageNumber: 1, blockIndex: 1 } },
      ],
      reviewRequired: true,
    });
    expect(result.steps[1]).toMatchObject({
      sequenceOrder: 2,
      actions: ["addition", "mix", "adjust_ph", "thicken"],
      conditions: [
        { kind: "ph", rawValue: "pH to 5.2" },
        { kind: "homogeneity", rawValue: "homogeneous" },
      ],
    });
    expect(result.steps.some((step) => step.rawInstruction === "Target pH 5.5")).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("extracts process-table rows and cites condition cells individually", () => {
    const result = extractReferenceFormulationProcedure({
      source: source(),
      pages: [{ pageNumber: 2, blocks: [
        { type: "heading", blockIndex: 0, text: "Process", source: "digital" },
        { type: "table", blockIndex: 1, source: "mixed", confidence: 0.82, rows: [
          ["Step", "Operation", "Temperature", "Hold Time", "Speed", "pH"],
          ["A", "Dissolve polymer with mixing", "65-70°C", "30 min", "600 rpm", "5.0"],
        ] },
      ] }],
    });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({
      extractionMethod: "procedure_table_column",
      printedStepNumber: "A",
      rawInstruction: "Dissolve polymer with mixing",
      rawContextCells: ["A", "Dissolve polymer with mixing", "65-70°C", "30 min", "600 rpm", "5.0"],
      actions: ["dissolve", "mix"],
      conditions: [
        { kind: "temperature", rawValue: "65-70°C", evidence: { rowIndex: 1, cellIndex: 2 } },
        { kind: "time", rawValue: "30 min", evidence: { rowIndex: 1, cellIndex: 3 } },
        { kind: "speed", rawValue: "600 rpm", evidence: { rowIndex: 1, cellIndex: 4 } },
        { kind: "ph", rawValue: "5.0", evidence: { rowIndex: 1, cellIndex: 5 } },
      ],
      reviewRequired: true,
    });
    expect(result.warnings).toContain("ocr_process_requires_review");
    expect(result.steps[0]?.conditions).toContainEqual(expect.objectContaining({ kind: "ph", rawValue: "5.0", evidence: expect.objectContaining({ cellIndex: 5 }) }));
    expect(result.steps[0]?.evidence.source).toBe("mixed");
  });

  it("uses a semantic procedure table even when the document has no separate procedure heading", () => {
    const result = extractReferenceFormulationProcedure({ source: source(), pages: [{ pageNumber: 1, blocks: [
      { type: "table", blockIndex: 0, rows: [["Step", "Operation", "Temperature"], ["1", "Add water and mix", "25°C"]] },
    ] }] });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ rawInstruction: "Add water and mix", actions: ["addition", "mix"] });
    expect(result.warnings).not.toContain("procedure_section_not_detected");
  });

  it("does not infer steps outside procedure sections and reports ambiguous table columns", () => {
    const noProcedure = extractReferenceFormulationProcedure({ source: source(), pages: [{ pageNumber: 1, blocks: [
      { type: "text", blockIndex: 0, text: "Add water and mix.", source: "digital" },
    ] }] });
    expect(noProcedure).toMatchObject({ steps: [], warnings: ["procedure_section_not_detected", "no_procedure_steps"] });

    const ambiguous = extractReferenceFormulationProcedure({ source: source(), pages: [{ pageNumber: 1, blocks: [
      { type: "heading", blockIndex: 0, text: "Procedure", source: "digital" },
      { type: "table", blockIndex: 1, rows: [["Procedure", "Instructions"], ["Add water", "Mix"]] },
    ] }] });
    expect(ambiguous.steps).toEqual([]);
    expect(ambiguous.warnings).toContain("ambiguous_procedure_columns");
  });
});
