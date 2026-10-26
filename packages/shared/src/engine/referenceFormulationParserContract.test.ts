import { describe, expect, it } from "vitest";
import { analyzeReferenceFormulationLayout } from "./referenceFormulationParserContract";

const HASH = "b".repeat(64);

describe("reference formulation layout parser contract", () => {
  it("finds ingredient tables by semantic headers across different page layouts and positions", () => {
    const crodaLike = analyzeReferenceFormulationLayout({
      sourceDocumentHash: HASH,
      pages: [{
        pageNumber: 1,
        blocks: [
          { type: "heading", blockIndex: 0, text: "Formulation Title", source: "digital", position: { x: 20, y: 24 } },
          { type: "text", blockIndex: 1, text: "Hand dishwash example", source: "digital" },
          { type: "heading", blockIndex: 2, text: "Composition", source: "digital", position: { x: 30, y: 200 } },
          { type: "table", blockIndex: 3, source: "digital", position: { x: 30, y: 230 }, rows: [
            ["Trade Name", "Supplier Code", "Phase", "% w/w", "Function"],
            ["Example surfactant", "ABC-1", "A", "12.5", "Primary surfactant"],
          ] },
        ],
      }],
    });
    const alternateLayout = analyzeReferenceFormulationLayout({
      sourceDocumentHash: HASH.toUpperCase(),
      pages: [{
        pageNumber: 4,
        blocks: [
          { type: "text", blockIndex: 0, text: "Supplier technical reference", source: "digital" },
          { type: "heading", blockIndex: 1, text: "Ingredients", source: "ocr", confidence: 0.92, position: { x: 430, y: 80 } },
          { type: "table", blockIndex: 2, source: "ocr", confidence: 0.88, position: { x: 410, y: 140 }, rows: [
            ["Formula components"],
            ["Raw Material", "Dosage", "Stage"],
            ["Example polymer", "1-2%", "B"],
          ] },
        ],
      }],
    });

    expect(crodaLike).toMatchObject({
      sourceDocumentHash: HASH,
      headings: [{ kind: "title" }, { kind: "ingredients" }],
      ingredientTables: [{ pageNumber: 1, blockIndex: 3, headerRowIndex: 0, columns: { ingredient: 0, product_code: 1, phase: 2, amount: 3, function: 4 }, dataRowCount: 1 }],
      warnings: [],
      reviewRequired: true,
    });
    expect(alternateLayout).toMatchObject({
      sourceDocumentHash: HASH,
      headings: [{ kind: "ingredients", pageNumber: 4, blockIndex: 1 }],
      ingredientTables: [{ pageNumber: 4, blockIndex: 2, headerRowIndex: 1, columns: { ingredient: 0, amount: 1, phase: 2 }, dataRowCount: 1, source: "ocr" }],
      warnings: [],
    });
    expect(crodaLike.ingredientTables[0]?.rawHeaders).toEqual(["Trade Name", "Supplier Code", "Phase", "% w/w", "Function"]);
    expect(crodaLike.ingredientTables[0]?.columns).not.toBe(alternateLayout.ingredientTables[0]?.columns);
  });

  it("reports missing or ambiguous semantic structure instead of guessing from layout coordinates", () => {
    const noTable = analyzeReferenceFormulationLayout({ sourceDocumentHash: HASH, pages: [{ pageNumber: 1, blocks: [] }] });
    expect(noTable.warnings).toEqual(["no_semantic_headings", "no_ingredient_table_candidates"]);

    const ambiguous = analyzeReferenceFormulationLayout({
      sourceDocumentHash: HASH,
      pages: [{ pageNumber: 2, blocks: [{ type: "table", blockIndex: 0, rows: [
        ["Ingredient", "Amount"], ["Material", "Quantity"], ["A", "10%"],
      ] }] }],
    });
    expect(ambiguous.ingredientTables).toHaveLength(1);
    expect(ambiguous.ingredientTables[0]?.ambiguousHeaderRows).toEqual([0, 1]);
    expect(ambiguous.warnings).toContain("ambiguous_table_headers");
    expect(ambiguous.ingredientTables[0]?.reviewRequired).toBe(true);
  });

  it("rejects invalid page/block provenance and duplicate indexes", () => {
    expect(() => analyzeReferenceFormulationLayout({
      sourceDocumentHash: HASH,
      pages: [{ pageNumber: 0, blocks: [{ type: "text", blockIndex: 0, text: "Invalid page" }] }],
    })).toThrow();
    expect(() => analyzeReferenceFormulationLayout({
      sourceDocumentHash: HASH,
      pages: [{ pageNumber: 1, blocks: [
        { type: "text", blockIndex: 0, text: "First" },
        { type: "text", blockIndex: 0, text: "Duplicate" },
      ] }],
    })).toThrow(/Block indexes must be unique/);
  });
});
