import { describe, expect, it } from "vitest";
import { referenceFormulationSourceSchema } from "../schemas/referenceFormulationSource";
import { extractReferenceFormulationIngredientLines } from "./referenceFormulationIngredientExtraction";
import { analyzeReferenceFormulationLayout } from "./referenceFormulationParserContract";

const fixtures = [
  {
    family: "single-row trade-name layout",
    hash: "a".repeat(64),
    source: "digital" as const,
    page: 1,
    blocks: [
      { type: "heading" as const, blockIndex: 0, text: "Application", source: "digital" as const },
      { type: "text" as const, blockIndex: 1, text: "Synthetic fixture family A", source: "digital" as const },
      { type: "table" as const, blockIndex: 2, source: "digital" as const, rows: [
        ["Trade Name", "Material Code", "Stage", "Dosage", "Purpose"],
        ["Test material A", "TEST-A", "Phase 1", "10%", "Fixture label only"],
      ] },
    ],
    expected: { ingredient: 0, product_code: 1, phase: 2, amount: 3, function: 4 },
    expectedName: "Test material A",
    expectedLine: {
      supplierProductCode: { rawValue: "TEST-A", evidence: { cellIndex: 1 } },
      function: { rawValue: "Fixture label only", evidence: { cellIndex: 4 } },
      amount: { rawValue: "10%", evidence: { cellIndex: 3 } },
    },
  },
  {
    family: "multi-row raw-material composition layout",
    hash: "c".repeat(64),
    source: "ocr" as const,
    page: 3,
    blocks: [
      { type: "heading" as const, blockIndex: 0, text: "Raw Materials", source: "ocr" as const, confidence: 0.96 },
      { type: "table" as const, blockIndex: 1, source: "ocr" as const, confidence: 0.91, rows: [
        ["Formula Composition"],
        ["Raw Material", "Functionality", "Concentration", "Weight Basis"],
        ["Test material B", "Fixture label only", "20", "weight percent"],
      ] },
    ],
    expected: { ingredient: 0, function: 1, amount: 2, basis: 3 },
    expectedName: "Test material B",
    expectedLine: {
      function: { rawValue: "Fixture label only", evidence: { cellIndex: 1 } },
      amount: { rawValue: "20", evidence: { cellIndex: 2 } },
      basis: { rawValue: "weight percent", evidence: { cellIndex: 3 } },
    },
  },
];

function sourceFor(fixture: typeof fixtures[number]) {
  return referenceFormulationSourceSchema.parse({
    schemaVersion: "1.0",
    id: `synthetic-layout-${fixture.hash[0]}`,
    supplierId: "supplier-synthetic-fixture",
    providerId: "manual-assisted",
    surfaceId: "test-fixture",
    sourceProduct: { tradeName: "Synthetic parser layout fixture" },
    acquisitionCode: `supplierdoc-synthetic-${fixture.hash[0]}`,
    sourcePdfSha256: fixture.hash,
    acquisitionMethod: "manual_assisted",
    sourceFileSelection: {
      selectionId: `selection-${fixture.hash[0]}`,
      originalFilename: `synthetic-layout-${fixture.hash[0]}.pdf`,
      sourceFileSha256: fixture.hash,
      selectedAt: "2026-10-26T08:00:00.000Z",
      selectedBy: "test-owner",
    },
    originalFilename: `synthetic-layout-${fixture.hash[0]}.pdf`,
    sourceByteSize: 128,
    acquiredAt: "2026-10-26T08:00:00.000Z",
    title: "Synthetic parser layout fixture",
    market: "not applicable",
    language: "en",
    parserVersion: "formulab-reference-formulation-layout-v1",
    rights: { status: "unknown", redistribution: "unknown", evidenceRefs: [] },
    createdAt: "2026-10-26T08:01:00.000Z",
  });
}

describe("cross-supplier formulation layout harness", () => {
  it.each(fixtures)("recognizes $family without inferring chemistry", (fixture) => {
    const pages = [{ pageNumber: fixture.page, blocks: fixture.blocks }];
    const layout = analyzeReferenceFormulationLayout({ sourceDocumentHash: fixture.hash, pages });
    const ingredients = extractReferenceFormulationIngredientLines({ source: sourceFor(fixture), pages });

    expect(layout.ingredientTables).toHaveLength(1);
    expect(layout.ingredientTables[0]).toMatchObject({
      pageNumber: fixture.page,
      blockIndex: fixture.blocks.find((block) => block.type === "table")!.blockIndex,
      columns: fixture.expected,
      source: fixture.source,
      reviewRequired: true,
    });
    expect(ingredients.lines).toHaveLength(1);
    expect(ingredients.lines[0]).toMatchObject({
      ingredientName: { rawValue: fixture.expectedName },
      sourceDocumentHash: fixture.hash,
      reviewRequired: true,
      ...fixture.expectedLine,
    });
    expect(ingredients.lines[0]?.rawRow).not.toEqual([]);
    expect(layout.reviewRequired).toBe(true);
  });
});
