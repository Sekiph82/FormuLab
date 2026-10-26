import { describe, expect, it } from "vitest";
import { appendIdentityFieldReview, identityFieldReviewSchema, recordIdentityFieldReview } from "./identityFieldReview";
import type { Actor } from "./status";

const rawMaterialReviewer: Actor = { kind: "human", role: "raw_material", userId: "reviewer-1" };
const procurementReviewer: Actor = { kind: "human", role: "procurement", userId: "reviewer-2" };
const automatedActor: Actor = { kind: "agent", runId: "agent-1" };
const base = {
  id: "identity-review-1", commercialProductId: "product-1", sourceEvidenceId: "sds-1", targetRecordId: "component-1", field: "component" as const,
  decision: "accepted" as const, proposedValueSnapshot: JSON.stringify({ name: "Surfactant", cas: "123-45-6" }),
  evidenceRefs: ["sds:section3:p2:l4"], reviewedAt: "2026-10-26T09:00:00.000Z",
};

describe("commercial-product identity field review", () => {
  it("records named authorized human decisions and appends them without losing history", () => {
    const accepted = recordIdentityFieldReview(base, rawMaterialReviewer);
    const edited = recordIdentityFieldReview({
      ...base, id: "identity-review-2", decision: "edited",
      reviewedValueSnapshot: JSON.stringify({ name: "Surfactant", cas: "123-45-6", reviewed: true }),
      decisionNote: "Reviewer corrected the component label based on the cited source.",
      supersedesReviewId: accepted.id,
    }, procurementReviewer);
    expect(accepted).toMatchObject({ reviewedBy: "reviewer-1", reviewerRole: "raw_material", decision: "accepted" });
    expect(appendIdentityFieldReview([accepted], edited)).toEqual([accepted, edited]);
    expect(() => appendIdentityFieldReview([accepted], recordIdentityFieldReview({
      ...base, id: "identity-review-alias", field: "alias", decision: "edited",
      reviewedValueSnapshot: JSON.stringify({ value: "Alternate name" }), decisionNote: "Alias correction.", supersedesReviewId: accepted.id,
    }, procurementReviewer))).toThrow(/same product, target record and field/);
  });

  it("requires evidence, preserves edit values and rejects automation or unauthorized roles", () => {
    expect(() => recordIdentityFieldReview(base, automatedActor)).toThrow(/Only a human/);
    expect(() => recordIdentityFieldReview(base, { kind: "human", role: "researcher", userId: "researcher-1" })).toThrow(/edit access/);
    expect(() => identityFieldReviewSchema.parse({ ...base, reviewedBy: "", reviewerRole: "raw_material", schemaVersion: "1.0" })).toThrow();
    expect(() => recordIdentityFieldReview({ ...base, decision: "edited" }, rawMaterialReviewer)).toThrow(/edited decisions require/);
    expect(() => recordIdentityFieldReview({ ...base, decision: "rejected" }, rawMaterialReviewer)).toThrow(/require a note/);
    expect(() => appendIdentityFieldReview([recordIdentityFieldReview(base, rawMaterialReviewer)], recordIdentityFieldReview(base, rawMaterialReviewer)))
      .toThrow(/IDs must be unique/);
  });
});
