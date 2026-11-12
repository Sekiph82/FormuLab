import { describe, expect, it } from "vitest";
import { referenceFormulationReviewSchema } from "./referenceFormulationReview";

const base = {
  schemaVersion: "1.0" as const,
  id: "rfreview-1",
  code: "rfreview-1",
  referenceFormulationRecordId: "reference-formula-1",
  sourceDocumentHash: "a".repeat(64),
  targetType: "ingredient" as const,
  targetKey: "ingredient-line-1:amount",
  fieldPath: "ingredientLines[line-1].amount",
  sourceValue: "10%",
  evidenceExcerpt: "Test Material | 10%",
  pageNumber: 2,
  blockIndex: 1,
  rowIndex: 1,
  cellIndex: 1,
  decision: "accepted" as const,
  reviewer: { userId: "user-1", displayName: "Review Chemist" },
  reviewedAt: "2026-10-26T10:00:00.000Z",
};

describe("append-only reference-formulation review decisions", () => {
  it("records a source-linked human acceptance without adding master-data approval fields", () => {
    expect(referenceFormulationReviewSchema.parse(base)).toMatchObject({
      referenceFormulationRecordId: "reference-formula-1",
      sourceDocumentHash: "a".repeat(64),
      decision: "accepted",
      reviewer: { userId: "user-1", displayName: "Review Chemist" },
    });
    expect(() => referenceFormulationReviewSchema.parse({ ...base, approved: true })).toThrow();
  });

  it("requires a proposed value for edits and excludes it from other decisions", () => {
    expect(() => referenceFormulationReviewSchema.parse({ ...base, decision: "edited" })).toThrow(/proposed value/);
    expect(referenceFormulationReviewSchema.parse({ ...base, decision: "edited", reviewedValue: "12%" }).reviewedValue).toBe("12%");
    expect(() => referenceFormulationReviewSchema.parse({ ...base, reviewedValue: "12%" })).toThrow(/Only edited decisions/);
  });
});
