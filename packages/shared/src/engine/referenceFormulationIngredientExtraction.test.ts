import { describe, expect, it } from "vitest";
import { referenceFormulationSourceSchema } from "../schemas/referenceFormulationSource";
import { extractReferenceFormulationIngredientLines } from "./referenceFormulationIngredientExtraction";

const HASH = "e".repeat(64);
const source = () => referenceFormulationSourceSchema.parse({
  schemaVersion: "1.0",
  id: "formula-source-1",
  supplierId: "supplier-croda",
  providerId: "croda-public",
  surfaceId: "formulation-library",
  sourceProduct: { tradeName: "Example supplier product" },
  acquisitionCode: "supplierdoc-formula-1",
  sourcePdfSha256: HASH,
  acquisitionMethod: "manual_assisted",
  sourceFileSelection: {
    selectionId: "selection-1", originalFilename: "formula.pdf", sourceFileSha256: HASH,
    selectedAt: "2026-10-26T08:00:00.000Z", selectedBy: "owner-1",
  },
  originalFilename: "formula.pdf",
  sourceByteSize: 2048,
  acquiredAt: "2026-10-26T08:00:00.000Z",
  publicationDate: "2025-01-01",
  formulationCode: "HC-DW-22",
  title: "Hand Dishwash Example",
  market: "EU",
  language: "en",
  parserVersion: "formulab-reference-formulation-layout-v1",
  rights: { status: "unknown", redistribution: "unknown", evidenceRefs: [] },
  createdAt: "2026-10-26T08:01:00.000Z",
});

describe("reference formulation ingredient-line extraction", () => {
  it("preserves raw ingredient fields, order, q.s. meaning and field-level page/cell evidence", () => {
    const result = extractReferenceFormulationIngredientLines({
      source: source(),
      pages: [{ pageNumber: 2, blocks: [
        { type: "heading", blockIndex: 0, text: "Composition", source: "digital" },
        { type: "table", blockIndex: 1, source: "digital", position: { x: 60, y: 300 }, rows: [
          ["Trade Name", "Supplier Code", "INCI", "Function", "Phase", "Amount", "Unit", "Basis"],
          ["Example surfactant", "SURF-1", "Sodium laureth sulfate", "Primary surfactant", "A", "10–15", "%", "w/w"],
          ["Water", "", "Aqua", "Solvent", "A", "q.s. to 100%", "", "w/w"],
        ] },
      ] }],
    });

    expect(result).toMatchObject({
      sourceId: "formula-source-1",
      acquisitionCode: "supplierdoc-formula-1",
      sourceDocumentHash: HASH,
      lines: [
        {
          orderIndex: 1,
          pageNumber: 2,
          tableBlockIndex: 1,
          rowIndex: 1,
          ingredientName: { rawValue: "Example surfactant", evidence: { pageNumber: 2, blockIndex: 1, rowIndex: 1, cellIndex: 0, header: "Trade Name" } },
          supplierProductCode: { rawValue: "SURF-1", evidence: { cellIndex: 1, header: "Supplier Code" } },
          inciOrChemicalName: { rawValue: "Sodium laureth sulfate", evidence: { cellIndex: 2, header: "INCI" } },
          function: { rawValue: "Primary surfactant", evidence: { cellIndex: 3, header: "Function" } },
          phase: { rawValue: "A", evidence: { cellIndex: 4, header: "Phase" } },
          amount: { rawValue: "10–15", evidence: { cellIndex: 5, header: "Amount" } },
          unit: { rawValue: "%", evidence: { cellIndex: 6, header: "Unit" } },
          basis: { rawValue: "w/w", evidence: { cellIndex: 7, header: "Basis" } },
          quantitySemantics: "explicit_amount",
          reviewRequired: true,
        },
        {
          orderIndex: 2,
          rowIndex: 2,
          ingredientName: { rawValue: "Water" },
          amount: { rawValue: "q.s. to 100%", evidence: { cellIndex: 5, header: "Amount" } },
          quantitySemantics: "q_s",
          reviewRequired: true,
        },
      ],
      warnings: ["quantity_semantics_q_s_requires_review"],
      reviewRequired: true,
    });
    expect(result.lines[0]?.amount?.rawValue).toBe("10–15");
    expect(result.lines[1]?.quantitySemantics).toBe("q_s");
  });

  it("retains rows with missing ingredient names and does not invent lines when table structure is absent", () => {
    const result = extractReferenceFormulationIngredientLines({
      source: source(),
      pages: [{ pageNumber: 1, blocks: [{ type: "table", blockIndex: 0, rows: [
        ["Ingredient", "Amount"], ["", "5%"],
      ] }] }],
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ rawRow: ["", "5%"], quantitySemantics: "explicit_amount" });
    expect(result.lines[0]).not.toHaveProperty("ingredientName");
    expect(result.warnings).toContain("ingredient_name_missing");

    const empty = extractReferenceFormulationIngredientLines({ source: source(), pages: [{ pageNumber: 1, blocks: [] }] });
    expect(empty).toMatchObject({ lines: [], warnings: ["no_ingredient_table_candidates", "no_ingredient_rows"] });
  });

  it("withholds ambiguous repeated headers and duplicate ingredient columns instead of extracting them as rows", () => {
    const repeatedHeaders = extractReferenceFormulationIngredientLines({
      source: source(),
      pages: [{ pageNumber: 1, blocks: [{ type: "table", blockIndex: 0, rows: [
        ["Ingredient", "Amount"], ["Material", "Quantity"], ["Water", "10%"],
      ] }] }],
    });
    expect(repeatedHeaders.lines).toEqual([]);
    expect(repeatedHeaders.warnings).toContain("ambiguous_table_headers");

    const duplicateColumns = extractReferenceFormulationIngredientLines({
      source: source(),
      pages: [{ pageNumber: 1, blocks: [{ type: "table", blockIndex: 1, rows: [
        ["Ingredient", "Material", "Amount"], ["Water", "Water", "10%"],
      ] }] }],
    });
    expect(duplicateColumns.lines).toEqual([]);
    expect(duplicateColumns.warnings).toContain("ambiguous_ingredient_columns");
  });

  it("accepts plural ingredient headers and keeps OCR-derived rows review-required", () => {
    const pluralHeader = extractReferenceFormulationIngredientLines({
      source: source(),
      pages: [{ pageNumber: 1, blocks: [{ type: "table", blockIndex: 0, rows: [
        ["Ingredients", "Amount"], ["Water", "q.s."],
      ] }] }],
    });
    expect(pluralHeader.lines[0]?.ingredientName?.rawValue).toBe("Water");
    const ocr = extractReferenceFormulationIngredientLines({
      source: source(),
      pages: [{ pageNumber: 3, blocks: [{ type: "table", blockIndex: 0, source: "ocr", confidence: 0.52, rows: [
        ["Ingredient", "Amount"], ["Water", "q.s."],
      ] }] }],
    });
    expect(ocr.lines[0]).toMatchObject({ reviewRequired: true, ingredientName: { evidence: { source: "ocr", confidence: 0.52 } } });
    expect(ocr.warnings).toContain("ocr_ingredient_rows_require_review");
  });
});
