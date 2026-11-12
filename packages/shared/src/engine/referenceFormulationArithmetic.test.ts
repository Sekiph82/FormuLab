import { describe, expect, it } from "vitest";
import { referenceFormulationSourceSchema } from "../schemas/referenceFormulationSource";
import { extractReferenceFormulationIngredientLines } from "./referenceFormulationIngredientExtraction";
import { validateReferenceFormulationArithmetic } from "./referenceFormulationArithmetic";

const HASH = "e".repeat(64);
const source = () => referenceFormulationSourceSchema.parse({
  schemaVersion: "1.0", id: "formula-source-1", supplierId: "supplier-croda", providerId: "croda-public", surfaceId: "formulation-library",
  sourceProduct: { tradeName: "Example supplier product" }, acquisitionCode: "supplierdoc-formula-1", sourcePdfSha256: HASH,
  acquisitionMethod: "manual_assisted", sourceFileSelection: { selectionId: "selection-1", originalFilename: "formula.pdf", sourceFileSha256: HASH, selectedAt: "2026-10-26T08:00:00.000Z", selectedBy: "owner-1" },
  originalFilename: "formula.pdf", sourceByteSize: 2048, acquiredAt: "2026-10-26T08:00:00.000Z", title: "Example formula", market: "EU", language: "en",
  parserVersion: "formulab-reference-formulation-layout-v1", rights: { status: "unknown", redistribution: "unknown", evidenceRefs: [] }, createdAt: "2026-10-26T08:01:00.000Z",
});

function lines(rows: string[][]) {
  return extractReferenceFormulationIngredientLines({
    source: source(),
    pages: [{ pageNumber: 1, blocks: [{ type: "table", blockIndex: 0, rows: [["Ingredient", "Amount", "Unit", "Basis"], ...rows] }] }],
  }).lines;
}

const declaredTotal = (rawValue: string) => ({
  rawValue,
  unit: "%",
  basis: "w/w",
  evidence: { sourceDocumentHash: HASH, pageNumber: 2, blockIndex: 1, excerpt: `Total: ${rawValue} % w/w`, source: "digital" as const },
});

describe("reference formulation arithmetic validation", () => {
  it("calculates exact % w/w totals and compares them with a cited source total without altering source values", () => {
    const ingredientLines = lines([["Surfactant", "30", "%", "w/w"], ["Water", "70", "%", "w/w"]]);
    const result = validateReferenceFormulationArithmetic({ source: source(), lines: ingredientLines, sourceDeclaredTotal: declaredTotal("100") });
    expect(result).toMatchObject({
      arithmeticStatus: "consistent",
      calculatedTotal: { kind: "exact", lowerBound: "100", upperBound: "100", unit: "% w/w" },
      sourceDeclaredTotal: { rawValue: "100", evidence: { pageNumber: 2, blockIndex: 1 } },
      lineCount: 2,
      warnings: [],
      reviewRequired: true,
    });
    expect(ingredientLines[0]?.amount?.rawValue).toBe("30");
    expect(ingredientLines[1]?.amount?.rawValue).toBe("70");
  });

  it("keeps interval arithmetic and flags non-matching or non-comparable source totals", () => {
    const ranged = validateReferenceFormulationArithmetic({
      source: source(), lines: lines([["Surfactant", "20-30", "%", "w/w"], ["Water", "70-80", "%", "w/w"]]), sourceDeclaredTotal: declaredTotal("100"),
    });
    expect(ranged).toMatchObject({ arithmeticStatus: "overlap", calculatedTotal: { kind: "range", lowerBound: "90", upperBound: "110" } });
    expect(ranged.warnings).toContain("source_total_overlap");

    const mismatch = validateReferenceFormulationArithmetic({
      source: source(), lines: lines([["Surfactant", "40", "%", "w/w"], ["Water", "50", "%", "w/w"]]), sourceDeclaredTotal: declaredTotal("100"),
    });
    expect(mismatch).toMatchObject({ arithmeticStatus: "inconsistent", calculatedTotal: { lowerBound: "90", upperBound: "90" } });
    expect(mismatch.warnings).toContain("source_total_mismatch");

    const unknownSourceTotal = validateReferenceFormulationArithmetic({
      source: source(), lines: lines([["Surfactant", "100", "%", "w/w"]]), sourceDeclaredTotal: { ...declaredTotal("100"), unit: undefined, basis: undefined },
    });
    expect(unknownSourceTotal.arithmeticStatus).toBe("source_total_not_comparable");
  });

  it("leaves q.s. and unsupported units unresolved and flags duplicate ingredient rows without deduplicating", () => {
    const incomplete = validateReferenceFormulationArithmetic({
      source: source(), lines: lines([["Water", "q.s. to 100%", "", "w/w"], ["Glycerin", "5", "g", ""]]),
    });
    expect(incomplete).toMatchObject({ arithmeticStatus: "incomplete", lineCount: 2 });
    expect(incomplete).not.toHaveProperty("calculatedTotal");
    expect(incomplete.warnings).toEqual(expect.arrayContaining(["q_s_prevents_total", "unknown_unit_or_basis"]));

    const duplicate = validateReferenceFormulationArithmetic({
      source: source(), lines: lines([["Water", "40", "%", "w/w"], [" water ", "60", "%", "w/w"]]),
    });
    expect(duplicate).toMatchObject({ lineCount: 2, duplicateLineGroups: [["formula-source-1:p1:b0:r1", "formula-source-1:p1:b0:r2"]], calculatedTotal: { lowerBound: "100", upperBound: "100" } });
    expect(duplicate.warnings).toContain("duplicate_ingredient_rows");

    const conflictingBasis = validateReferenceFormulationArithmetic({
      source: source(), lines: lines([["Surfactant", "10", "% w/w", "v/v"]]),
    });
    expect(conflictingBasis.arithmeticStatus).toBe("incomplete");
    expect(conflictingBasis.warnings).toContain("unknown_unit_or_basis");
  });

  it("rejects foreign ingredient/total evidence and reports missing rows without inventing zero", () => {
    const foreignLine = lines([["Water", "100", "%", "w/w"]]);
    foreignLine[0] = { ...foreignLine[0]!, sourceDocumentHash: "f".repeat(64) };
    expect(() => validateReferenceFormulationArithmetic({ source: source(), lines: foreignLine })).toThrow(/same immutable formulation source/);

    const foreignFieldCitation = lines([["Water", "100", "%", "w/w"]]);
    foreignFieldCitation[0] = {
      ...foreignFieldCitation[0]!,
      ingredientName: { ...foreignFieldCitation[0]!.ingredientName!, evidence: { ...foreignFieldCitation[0]!.ingredientName!.evidence, sourceDocumentHash: "f".repeat(64) } },
    };
    expect(() => validateReferenceFormulationArithmetic({ source: source(), lines: foreignFieldCitation })).toThrow(/field evidence must reference the same source PDF/);

    expect(() => validateReferenceFormulationArithmetic({
      source: source(), lines: lines([["Water", "100", "%", "w/w"]]), sourceDeclaredTotal: {
        ...declaredTotal("100"), evidence: { ...declaredTotal("100").evidence, sourceDocumentHash: "f".repeat(64) },
      },
    })).toThrow(/same source PDF hash/);
    const empty = validateReferenceFormulationArithmetic({ source: source(), lines: [] });
    expect(empty).toMatchObject({ arithmeticStatus: "no_ingredient_rows", lineCount: 0, warnings: ["no_ingredient_rows"] });
    expect(empty).not.toHaveProperty("calculatedTotal");
  });

  it("flags OCR-derived source total comparisons for human review", () => {
    const declared = declaredTotal("100");
    const total = { ...declared, evidence: { ...declared.evidence, source: "ocr" as const } };
    const result = validateReferenceFormulationArithmetic({ source: source(), lines: lines([["Water", "100", "%", "w/w"]]), sourceDeclaredTotal: total });
    expect(result.arithmeticStatus).toBe("consistent");
    expect(result.warnings).toContain("ocr_arithmetic_requires_review");
  });
});
