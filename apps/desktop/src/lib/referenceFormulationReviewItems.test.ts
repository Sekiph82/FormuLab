import { describe, expect, it } from "vitest";
import { buildReferenceFormulationReviewItems } from "./referenceFormulationReviewItems";

const evidence = { pageNumber: 1, blockIndex: 2, rowIndex: 1, cellIndex: 1, source: "digital", confidence: 0.9 };
const record = {
  id: "reference-1", identityCandidates: [], procedureSteps: [], targetCandidates: [],
  ingredientLines: [{ id: "line-1", rawRow: ["Texapon N 70", "Sodium Laureth Sulfate", "10"],
    inciOrChemicalName: { rawValue: "Sodium Laureth Sulfate", evidence } }],
} as never;
const normalization = (recordId: string) => ({
  id: "normalization-auto-1", referenceFormulationRecordId: recordId,
  lines: [{ sourceLineId: "line-1", canonicalChemistry: { status: "proposed", candidateIds: ["inci:sodium-laureth-sulfate"] } }],
}) as never;

describe("canonical-chemistry review items", () => {
  it("offers one decision per candidate with the key the prior adapter and native command expect", () => {
    const item = buildReferenceFormulationReviewItems(record, normalization("reference-1")).find((entry) => entry.label === "Canonical chemistry");
    expect(item).toMatchObject({
      targetType: "ingredient",
      targetKey: "normalization:normalization-auto-1:line:line-1:canonicalChemistry:inci:sodium-laureth-sulfate",
      fieldPath: "normalizations[normalization-auto-1].lines[line-1].canonicalChemistry",
      sourceValue: "inci:sodium-laureth-sulfate",
      evidenceExcerpt: "Texapon N 70 | Sodium Laureth Sulfate | 10",
      pageNumber: 1, blockIndex: 2, rowIndex: 1, cellIndex: 1,
    });
  });

  it("ignores a normalization that belongs to another record", () => {
    expect(buildReferenceFormulationReviewItems(record, normalization("other")).some((entry) => entry.label === "Canonical chemistry")).toBe(false);
  });
});
