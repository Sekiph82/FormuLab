import { describe, expect, it } from "vitest";
import { supplierProductClaimReviewSchema } from "./supplierProductEvidence";

const claim = {
  id: "claim-active-matter",
  fieldCode: "active_matter",
  subject: "product" as const,
  rawValue: "38%",
  normalizedValue: "38",
  originalUnit: "%",
  normalizedUnit: "%",
  qualifier: "specified" as const,
  basis: "as_supplied" as const,
  context: { sampleConcentration: "as supplied" },
  extraction: { method: "table_cell" as const, parserVersion: "supplier-product-v1", confidence: 0.97 },
  evidence: [{
    documentHash: "a".repeat(64),
    pageNumber: 2,
    lineNumber: 4,
    excerpt: "Active matter: 38%",
    source: "digital" as const,
  }],
};

const review = {
  recordType: "claim_review" as const,
  schemaVersion: "1.0" as const,
  id: "review-1",
  productCardId: "card-1",
  sourceEvidenceId: "evidence-1",
  claimId: claim.id,
  claimSnapshot: claim,
  decision: "accepted" as const,
  evidenceRefs: ["a".repeat(64) + ":p2:l4"],
  reviewedBy: "chemist-1",
  reviewerRole: "administrator",
  reviewedAt: "2026-10-28T08:00:00Z",
};

describe("supplier product claim review", () => {
  it("preserves an exact source claim and its page citation with a named reviewer", () => {
    expect(supplierProductClaimReviewSchema.parse(review)).toMatchObject({
      decision: "accepted",
      claimSnapshot: claim,
      reviewedBy: "chemist-1",
      evidenceRefs: ["a".repeat(64) + ":p2:l4"],
    });
  });

  it("rejects decisions whose citations differ from the extracted claim", () => {
    expect(() => supplierProductClaimReviewSchema.parse({
      ...review,
      evidenceRefs: ["b".repeat(64) + ":p2:l4"],
    })).toThrow(/exactly reference/);
  });

  it("rejects duplicate references that omit a source citation", () => {
    const secondCitationClaim = {
      ...claim,
      evidence: [...claim.evidence, {
        documentHash: "b".repeat(64), pageNumber: 3, lineNumber: 1,
        excerpt: "Active matter table", source: "digital" as const,
      }],
    };
    expect(() => supplierProductClaimReviewSchema.parse({
      ...review,
      claimSnapshot: secondCitationClaim,
      evidenceRefs: ["a".repeat(64) + ":p2:l4", "a".repeat(64) + ":p2:l4"],
    })).toThrow(/exactly reference/);
  });

  it("requires a note when a claim is rejected or needs further review", () => {
    expect(() => supplierProductClaimReviewSchema.parse({ ...review, decision: "rejected" })).toThrow(/require a note/);
    expect(supplierProductClaimReviewSchema.parse({ ...review, decision: "rejected", decisionNote: "The table row is ambiguous." }).decision)
      .toBe("rejected");
  });
});
