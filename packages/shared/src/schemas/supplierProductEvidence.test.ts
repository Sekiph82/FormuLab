import { describe, expect, it } from "vitest";
import {
  supplierProductClaimReviewSchema,
  supplierProductEvidenceRecordSchema,
  type SupplierProductClaimEvidence,
} from "./supplierProductEvidence";

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

describe("supplier product evidence persistence records", () => {
  it("round-trips SDS-only, TDS-only and paired-document card history with citations", () => {
    const timestamp = "2026-10-28T08:00:00Z";
    const makeClaim = (input: { id: string; fieldCode: string; rawValue: string; hash: string; page: number; section?: number }): SupplierProductClaimEvidence => ({
      id: input.id,
      fieldCode: input.fieldCode,
      ...(input.section ? { sectionNumber: input.section } : {}),
      subject: "product",
      rawValue: input.rawValue,
      qualifier: "specified",
      basis: input.fieldCode === "active_matter" ? "as_supplied" : "unknown",
      context: {},
      extraction: { method: input.fieldCode === "active_matter" ? "table_cell" : "explicit_label", parserVersion: "supplier-product-test-v1" },
      evidence: [{ documentHash: input.hash, pageNumber: input.page, excerpt: input.rawValue, source: "digital" }],
    });
    const sdsClaim = makeClaim({ id: "sds-identity", fieldCode: "product_identifier", rawValue: "SDS Only Product", hash: "c".repeat(64), page: 1, section: 1 });
    const tdsClaim = makeClaim({ id: "tds-active", fieldCode: "active_matter", rawValue: "38% as supplied", hash: "d".repeat(64), page: 2 });
    const pairedIdentityClaim = makeClaim({ id: "paired-identity", fieldCode: "product_identifier", rawValue: "Paired Product", hash: "e".repeat(64), page: 1, section: 1 });
    const pairedActiveClaim = makeClaim({ id: "paired-active", fieldCode: "active_matter", rawValue: "40% as supplied", hash: "f".repeat(64), page: 3 });
    const records = [
      { recordType: "document", schemaVersion: "1.0", id: "sds-doc", acquisitionCode: "acq-sds", productCardId: "sds-card", documentType: "SDS", documentHash: "c".repeat(64), parserVersion: "test-v1", claims: [sdsClaim], reviewStatus: "unreviewed", createdAt: timestamp },
      { recordType: "card_version", schemaVersion: "1.0", id: "sds-v1", productCardId: "sds-card", version: 1, tradeName: "SDS Only Product", market: "US", language: "en", identityStatus: "provisional", evidenceRecordIds: ["sds-doc"], claimIds: [sdsClaim.id], conflicts: [], createdAt: timestamp },
      { recordType: "document", schemaVersion: "1.0", id: "tds-doc", acquisitionCode: "acq-tds", productCardId: "tds-card", documentType: "TDS", documentHash: "d".repeat(64), parserVersion: "test-v1", claims: [tdsClaim], reviewStatus: "unreviewed", createdAt: timestamp },
      { recordType: "card_version", schemaVersion: "1.0", id: "tds-v1", productCardId: "tds-card", version: 1, tradeName: "TDS Only Product", market: "US", language: "en", identityStatus: "provisional", evidenceRecordIds: ["tds-doc"], claimIds: [tdsClaim.id], conflicts: [], createdAt: timestamp },
      { recordType: "document", schemaVersion: "1.0", id: "pair-tds-doc", acquisitionCode: "acq-pair-tds", productCardId: "pair-card", documentType: "TDS", documentHash: "f".repeat(64), parserVersion: "test-v1", claims: [pairedActiveClaim], reviewStatus: "unreviewed", createdAt: timestamp },
      { recordType: "card_version", schemaVersion: "1.0", id: "pair-v1", productCardId: "pair-card", version: 1, tradeName: "Paired Product", market: "US", language: "en", identityStatus: "provisional", evidenceRecordIds: ["pair-tds-doc"], claimIds: [pairedActiveClaim.id], conflicts: [], createdAt: timestamp },
      { recordType: "document", schemaVersion: "1.0", id: "pair-sds-doc", acquisitionCode: "acq-pair-sds", productCardId: "pair-card", documentType: "SDS", documentHash: "e".repeat(64), parserVersion: "test-v1", claims: [pairedIdentityClaim], reviewStatus: "unreviewed", createdAt: timestamp },
      { recordType: "card_version", schemaVersion: "1.0", id: "pair-v2", productCardId: "pair-card", version: 2, tradeName: "Paired Product", market: "US", language: "en", identityStatus: "provisional", evidenceRecordIds: ["pair-tds-doc", "pair-sds-doc"], claimIds: [pairedActiveClaim.id, pairedIdentityClaim.id], conflicts: [], createdAt: "2026-10-28T08:01:00Z" },
      { recordType: "claim_review", schemaVersion: "1.0", id: "paired-review", productCardId: "pair-card", sourceEvidenceId: "pair-tds-doc", claimId: pairedActiveClaim.id, claimSnapshot: pairedActiveClaim, decision: "accepted", evidenceRefs: ["f".repeat(64) + ":p3"], reviewedBy: "owner-1", reviewerRole: "administrator", reviewedAt: "2026-10-28T08:02:00Z" },
    ];
    const restored = JSON.parse(JSON.stringify(records)).map((record: unknown) => supplierProductEvidenceRecordSchema.parse(record));
    expect(restored.filter((record) => record.recordType === "card_version" && record.productCardId === "pair-card").map((record) => record.version)).toEqual([1, 2]);
    expect(restored.find((record) => record.recordType === "document" && record.id === "sds-doc")?.recordType).toBe("document");
    expect(restored.find((record) => record.recordType === "document" && record.id === "tds-doc")?.recordType).toBe("document");
    expect(restored.find((record) => record.recordType === "claim_review")?.evidenceRefs).toEqual(["f".repeat(64) + ":p3"]);
    expect(restored.find((record) => record.recordType === "document" && record.id === "pair-sds-doc")?.recordType).toBe("document");
  });
});
