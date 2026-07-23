import { describe, expect, it } from "vitest";
import { assessRegulatoryReadiness, deriveRegulatoryReadiness } from "./regulatoryApproval";
import type { RegulatoryFinding, RegulatoryReview, RegulatoryRule } from "../schemas/regulatory";

const NOW = "2026-01-01T00:00:00.000Z";

function baseRule(over: Partial<RegulatoryRule> = {}): RegulatoryRule {
  return {
    schemaVersion: "1.0",
    id: "rule-1",
    code: "KE-TEST-001",
    name: "Test rule",
    jurisdiction: "KE",
    authority: "Test authority",
    ruleType: "document_requirement",
    productCategories: [],
    requirement: "Placeholder requirement.",
    severity: "blocking",
    status: "draft",
    conditions: [],
    claimKeywordsAny: [],
    requiredEvidenceTypes: [],
    requiredLabelElements: [],
    requiredWarnings: [],
    requiredDocumentTypes: [],
    requiredTestTypes: [],
    requiredPackagingElements: [],
    requiredLanguages: [],
    requiresRegistration: false,
    requiresNotification: false,
    requiresResponsiblePartyInMarket: false,
    requiresMarketSpecificIdentifier: false,
    version: 1,
    verificationStatus: "not_verified",
    humanReviewStatus: "review_required",
    active: true,
    createdBy: "local",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function baseFinding(over: Partial<RegulatoryFinding> = {}): RegulatoryFinding {
  return {
    id: "finding-1",
    ruleId: "rule-1",
    ruleCode: "KE-TEST-001",
    ruleVersion: 1,
    jurisdiction: "KE",
    status: "missing_data",
    severity: "blocking",
    affectedMaterialCodes: [],
    affectedLineIds: [],
    reason: "Test reason.",
    evidenceRequired: [],
    verificationStatus: "not_verified",
    ...over,
  };
}

describe("assessRegulatoryReadiness", () => {
  it("is ready when every enabled gate is off (all defaults false)", () => {
    const result = assessRegulatoryReadiness({
      policy: {},
      classificationCompleted: false,
      hasBlockingFinding: true,
      allMandatoryDocumentsPresent: false,
      allMandatoryEvidencePresent: false,
      allRequiredClaimsReviewed: false,
      humanReviewCompleted: false,
    });
    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("blocks on missing classification only when the gate is enabled", () => {
    const result = assessRegulatoryReadiness({
      policy: { requireRegulatoryClassificationCompleted: true },
      classificationCompleted: false,
      hasBlockingFinding: false,
      allMandatoryDocumentsPresent: true,
      allMandatoryEvidencePresent: true,
      allRequiredClaimsReviewed: true,
      humanReviewCompleted: true,
    });
    expect(result.ready).toBe(false);
    expect(result.blockers[0].code).toBe("regulatory_classification_missing");
  });

  it("blocks on a blocking finding only when the gate is enabled", () => {
    const result = assessRegulatoryReadiness({
      policy: { requireNoBlockingRegulatoryFinding: true },
      classificationCompleted: true,
      hasBlockingFinding: true,
      allMandatoryDocumentsPresent: true,
      allMandatoryEvidencePresent: true,
      allRequiredClaimsReviewed: true,
      humanReviewCompleted: true,
    });
    expect(result.blockers.map((b) => b.code)).toEqual(["regulatory_finding_blocking"]);
  });

  it("blocks on missing mandatory documents", () => {
    const result = assessRegulatoryReadiness({
      policy: { requireAllMandatoryDocumentsPresent: true },
      classificationCompleted: true,
      hasBlockingFinding: false,
      allMandatoryDocumentsPresent: false,
      allMandatoryEvidencePresent: true,
      allRequiredClaimsReviewed: true,
      humanReviewCompleted: true,
    });
    expect(result.blockers.map((b) => b.code)).toEqual(["regulatory_documents_missing"]);
  });

  it("blocks on missing mandatory evidence", () => {
    const result = assessRegulatoryReadiness({
      policy: { requireAllMandatoryEvidencePresent: true },
      classificationCompleted: true,
      hasBlockingFinding: false,
      allMandatoryDocumentsPresent: true,
      allMandatoryEvidencePresent: false,
      allRequiredClaimsReviewed: true,
      humanReviewCompleted: true,
    });
    expect(result.blockers.map((b) => b.code)).toEqual(["regulatory_evidence_missing"]);
  });

  it("blocks on unreviewed required claims", () => {
    const result = assessRegulatoryReadiness({
      policy: { requireAllRequiredClaimsReviewed: true },
      classificationCompleted: true,
      hasBlockingFinding: false,
      allMandatoryDocumentsPresent: true,
      allMandatoryEvidencePresent: true,
      allRequiredClaimsReviewed: false,
      humanReviewCompleted: true,
    });
    expect(result.blockers.map((b) => b.code)).toEqual(["regulatory_claims_not_reviewed"]);
  });

  it("blocks on an incomplete human regulatory review", () => {
    const result = assessRegulatoryReadiness({
      policy: { requireHumanRegulatoryReviewCompleted: true },
      classificationCompleted: true,
      hasBlockingFinding: false,
      allMandatoryDocumentsPresent: true,
      allMandatoryEvidencePresent: true,
      allRequiredClaimsReviewed: true,
      humanReviewCompleted: false,
    });
    expect(result.blockers.map((b) => b.code)).toEqual(["regulatory_human_review_incomplete"]);
  });

  it("reports every unmet enabled gate at once, not just the first", () => {
    const result = assessRegulatoryReadiness({
      policy: { requireRegulatoryClassificationCompleted: true, requireNoBlockingRegulatoryFinding: true, requireHumanRegulatoryReviewCompleted: true },
      classificationCompleted: false,
      hasBlockingFinding: true,
      allMandatoryDocumentsPresent: true,
      allMandatoryEvidencePresent: true,
      allRequiredClaimsReviewed: true,
      humanReviewCompleted: false,
    });
    expect(result.blockers).toHaveLength(3);
  });
});

describe("deriveRegulatoryReadiness", () => {
  it("classificationCompleted reflects whether a classification actually ran", () => {
    const notClassified = deriveRegulatoryReadiness({
      policy: {},
      classified: false,
      findings: [],
      rules: [],
      reviews: [],
      versionId: "v1",
      jurisdiction: "KE",
    });
    expect(notClassified.classificationCompleted).toBe(false);
  });

  it("hasBlockingFinding is true when any non-compliant/missing/human-review/unknown finding exists in this jurisdiction", () => {
    const result = deriveRegulatoryReadiness({
      policy: {},
      classified: true,
      findings: [baseFinding({ status: "missing_data" })],
      rules: [baseRule()],
      reviews: [],
      versionId: "v1",
      jurisdiction: "KE",
    });
    expect(result.hasBlockingFinding).toBe(true);
  });

  it("hasBlockingFinding ignores findings from a different jurisdiction", () => {
    const result = deriveRegulatoryReadiness({
      policy: {},
      classified: true,
      findings: [baseFinding({ status: "non_compliant", jurisdiction: "UG" })],
      rules: [baseRule({ jurisdiction: "UG" })],
      reviews: [],
      versionId: "v1",
      jurisdiction: "KE",
    });
    expect(result.hasBlockingFinding).toBe(false);
  });

  it("compliant_with_rule and not_applicable findings never count as blocking", () => {
    const result = deriveRegulatoryReadiness({
      policy: {},
      classified: true,
      findings: [baseFinding({ status: "compliant_with_rule" }), baseFinding({ id: "f2", status: "not_applicable" })],
      rules: [baseRule()],
      reviews: [],
      versionId: "v1",
      jurisdiction: "KE",
    });
    expect(result.hasBlockingFinding).toBe(false);
  });

  it("allMandatoryDocumentsPresent is derived from document_requirement findings specifically", () => {
    const docRule = baseRule({ id: "doc-rule", ruleType: "document_requirement" });
    const otherRule = baseRule({ id: "other-rule", ruleType: "label_requirement" });
    const result = deriveRegulatoryReadiness({
      policy: {},
      classified: true,
      findings: [baseFinding({ ruleId: "doc-rule", status: "missing_data" }), baseFinding({ id: "f2", ruleId: "other-rule", status: "compliant_with_rule" })],
      rules: [docRule, otherRule],
      reviews: [],
      versionId: "v1",
      jurisdiction: "KE",
    });
    expect(result.allMandatoryDocumentsPresent).toBe(false);
  });

  it("allMandatoryEvidencePresent is true only once every claim_evidence_requirement finding is non-blocking", () => {
    const evidenceRule = baseRule({ id: "ev-rule", ruleType: "claim_evidence_requirement" });
    const result = deriveRegulatoryReadiness({
      policy: {},
      classified: true,
      findings: [baseFinding({ ruleId: "ev-rule", status: "compliant_with_rule" })],
      rules: [evidenceRule],
      reviews: [],
      versionId: "v1",
      jurisdiction: "KE",
    });
    expect(result.allMandatoryEvidencePresent).toBe(true);
  });

  it("humanReviewCompleted requires a review record for the exact version AND jurisdiction", () => {
    const review: RegulatoryReview = {
      schemaVersion: "1.0",
      id: "review-1",
      formulationId: "proj-1",
      versionId: "v1",
      jurisdiction: "KE",
      reviewedBy: "alice",
      reviewedAt: NOW,
      outcome: "compliant",
      notes: "Looks fine.",
    };
    const matching = deriveRegulatoryReadiness({ policy: {}, classified: true, findings: [], rules: [], reviews: [review], versionId: "v1", jurisdiction: "KE" });
    const wrongVersion = deriveRegulatoryReadiness({ policy: {}, classified: true, findings: [], rules: [], reviews: [review], versionId: "v2", jurisdiction: "KE" });
    const wrongJurisdiction = deriveRegulatoryReadiness({ policy: {}, classified: true, findings: [], rules: [], reviews: [review], versionId: "v1", jurisdiction: "UG" });
    expect(matching.humanReviewCompleted).toBe(true);
    expect(wrongVersion.humanReviewCompleted).toBe(false);
    expect(wrongJurisdiction.humanReviewCompleted).toBe(false);
  });
});
