import { describe, expect, it } from "vitest";
import {
  assessMultiJurisdictionRegulatoryReadiness,
  assessRegulatoryReadiness,
  deriveRegulatoryReadiness,
  resolveRegulatoryJurisdictions,
} from "./regulatoryApproval";
import type {
  RegulatoryEvidenceConfirmation,
  RegulatoryEvidenceConfirmationRevocation,
  RegulatoryFinding,
  RegulatoryReview,
  RegulatoryReviewRevocation,
  RegulatoryRule,
} from "../schemas/regulatory";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-02-01T00:00:00.000Z";

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

function baseReview(over: Partial<RegulatoryReview> = {}): RegulatoryReview {
  return {
    schemaVersion: "1.0",
    id: "review-1",
    formulationId: "proj-1",
    formulaVersionId: "v1",
    jurisdiction: "KE",
    classificationSnapshot: { category: "disinfectant", confidence: 0.8, reasoning: ["test"], uncertain: false },
    findingSnapshot: [],
    ruleVersionSnapshot: [],
    reviewedBy: "alice",
    reviewerRole: "regulatory",
    reviewedAt: NOW,
    outcome: "compliant",
    notes: "Looks fine.",
    ...over,
  };
}

function baseConfirmation(over: Partial<RegulatoryEvidenceConfirmation> = {}): RegulatoryEvidenceConfirmation {
  return {
    id: "confirm-1",
    schemaVersion: "1.0",
    formulationId: "proj-1",
    formulaVersionId: "v1",
    jurisdiction: "KE",
    ruleId: "rule-1",
    requirementType: "document",
    requirementCode: "sds",
    status: "confirmed",
    confirmedBy: "alice",
    reviewerRole: "regulatory",
    confirmedAt: NOW,
    attachmentIds: [],
    ...over,
  };
}

describe("assessRegulatoryReadiness", () => {
  const ready = {
    jurisdiction: "KE" as const,
    classificationCompleted: true,
    hasBlockingFinding: false,
    allMandatoryDocumentsPresent: true,
    allMandatoryEvidencePresent: true,
    allRequiredClaimsReviewed: true,
    humanReviewCompleted: true,
    humanReviewStatus: "current" as const,
  };

  it("is ready when every enabled gate is off (all defaults false)", () => {
    const result = assessRegulatoryReadiness({ ...ready, policy: {}, classificationCompleted: false, hasBlockingFinding: true, humanReviewCompleted: false, humanReviewStatus: "unknown" });
    expect(result.ready).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("blocks on missing classification only when the gate is enabled", () => {
    const result = assessRegulatoryReadiness({ ...ready, policy: { requireRegulatoryClassificationCompleted: true }, classificationCompleted: false });
    expect(result.ready).toBe(false);
    expect(result.blockers[0].code).toBe("regulatory_classification_missing");
    expect(result.blockers[0].jurisdiction).toBe("KE");
  });

  it("blocks on a blocking finding only when the gate is enabled", () => {
    const result = assessRegulatoryReadiness({ ...ready, policy: { requireNoBlockingRegulatoryFinding: true }, hasBlockingFinding: true });
    expect(result.blockers.map((b) => b.code)).toEqual(["regulatory_blocking_finding"]);
  });

  it("blocks on missing mandatory documents", () => {
    const result = assessRegulatoryReadiness({ ...ready, policy: { requireAllMandatoryDocumentsPresent: true }, allMandatoryDocumentsPresent: false });
    expect(result.blockers.map((b) => b.code)).toEqual(["regulatory_documents_missing"]);
  });

  it("blocks on missing mandatory evidence", () => {
    const result = assessRegulatoryReadiness({ ...ready, policy: { requireAllMandatoryEvidencePresent: true }, allMandatoryEvidencePresent: false });
    expect(result.blockers.map((b) => b.code)).toEqual(["regulatory_evidence_missing"]);
  });

  it("blocks on unreviewed required claims", () => {
    const result = assessRegulatoryReadiness({ ...ready, policy: { requireAllRequiredClaimsReviewed: true }, allRequiredClaimsReviewed: false });
    expect(result.blockers.map((b) => b.code)).toEqual(["regulatory_claims_unreviewed"]);
  });

  it("blocks on an incomplete human regulatory review with the generic missing code when no review exists at all", () => {
    const result = assessRegulatoryReadiness({ ...ready, policy: { requireHumanRegulatoryReviewCompleted: true }, humanReviewCompleted: false, humanReviewStatus: "unknown" });
    expect(result.blockers.map((b) => b.code)).toEqual(["regulatory_human_review_missing"]);
  });

  it("blocks with the specific wrong-version code when a review exists for a different version", () => {
    const result = assessRegulatoryReadiness({ ...ready, policy: { requireHumanRegulatoryReviewCompleted: true }, humanReviewCompleted: false, humanReviewStatus: "stale_formula_version" });
    expect(result.blockers.map((b) => b.code)).toEqual(["regulatory_review_wrong_version"]);
  });

  it("blocks with the specific stale-rules code when the review's rule snapshot has drifted", () => {
    const result = assessRegulatoryReadiness({ ...ready, policy: { requireHumanRegulatoryReviewCompleted: true }, humanReviewCompleted: false, humanReviewStatus: "stale_rule_version" });
    expect(result.blockers.map((b) => b.code)).toEqual(["regulatory_review_stale_rules"]);
  });

  it("blocks with the specific wrong-packaging code when the review covers a different SKU", () => {
    const result = assessRegulatoryReadiness({ ...ready, policy: { requireHumanRegulatoryReviewCompleted: true }, humanReviewCompleted: false, humanReviewStatus: "wrong_packaging_sku" });
    expect(result.blockers.map((b) => b.code)).toEqual(["regulatory_review_wrong_packaging"]);
  });

  it("a revoked review never satisfies the human-review gate", () => {
    const result = assessRegulatoryReadiness({ ...ready, policy: { requireHumanRegulatoryReviewCompleted: true }, humanReviewCompleted: false, humanReviewStatus: "revoked" });
    expect(result.ready).toBe(false);
  });

  it("a superseded review never satisfies the human-review gate", () => {
    const result = assessRegulatoryReadiness({ ...ready, policy: { requireHumanRegulatoryReviewCompleted: true }, humanReviewCompleted: false, humanReviewStatus: "superseded" });
    expect(result.ready).toBe(false);
  });

  it("reports every unmet enabled gate at once, not just the first", () => {
    const result = assessRegulatoryReadiness({
      ...ready,
      policy: { requireRegulatoryClassificationCompleted: true, requireNoBlockingRegulatoryFinding: true, requireHumanRegulatoryReviewCompleted: true },
      classificationCompleted: false,
      hasBlockingFinding: true,
      humanReviewCompleted: false,
      humanReviewStatus: "unknown",
    });
    expect(result.blockers).toHaveLength(3);
  });
});

describe("resolveRegulatoryJurisdictions", () => {
  it("defaults to the primary target market when nothing is configured (preserves prior behavior)", () => {
    expect(resolveRegulatoryJurisdictions({}, ["UG", "TZ"])).toEqual(["UG"]);
  });

  it("falls back to Kenya when there is no target market at all", () => {
    expect(resolveRegulatoryJurisdictions({}, [])).toEqual(["KE"]);
  });

  it("an explicit jurisdiction list always wins", () => {
    expect(resolveRegulatoryJurisdictions({ requiredRegulatoryJurisdictions: ["RW", "BI"] }, ["KE"])).toEqual(["RW", "BI"]);
  });

  it("requireAllTargetMarketsReviewed evaluates every target market", () => {
    expect(resolveRegulatoryJurisdictions({ requireAllTargetMarketsReviewed: true }, ["KE", "UG", "TZ"])).toEqual(["KE", "UG", "TZ"]);
  });

  it("allowPrimaryMarketOnly explicitly matches the primary-only default", () => {
    expect(resolveRegulatoryJurisdictions({ allowPrimaryMarketOnly: true }, ["SS", "RW"])).toEqual(["SS"]);
  });

  it("an explicit jurisdiction list takes precedence even when requireAllTargetMarketsReviewed is also set", () => {
    expect(resolveRegulatoryJurisdictions({ requiredRegulatoryJurisdictions: ["EAC"], requireAllTargetMarketsReviewed: true }, ["KE", "UG"])).toEqual(["EAC"]);
  });
});

describe("assessMultiJurisdictionRegulatoryReadiness", () => {
  it("is ready only when every resolved jurisdiction is ready", () => {
    const ready = { policy: { requireRegulatoryClassificationCompleted: true }, classificationCompleted: true, hasBlockingFinding: false, allMandatoryDocumentsPresent: true, allMandatoryEvidencePresent: true, allRequiredClaimsReviewed: true, humanReviewCompleted: true, humanReviewStatus: "current" as const };
    const result = assessMultiJurisdictionRegulatoryReadiness([
      { ...ready, jurisdiction: "KE" },
      { ...ready, jurisdiction: "UG", classificationCompleted: false },
    ]);
    expect(result.ready).toBe(false);
    expect(result.jurisdictionsEvaluated).toEqual(["KE", "UG"]);
    expect(result.blockers.some((b) => b.jurisdiction === "UG" && b.code === "regulatory_classification_missing")).toBe(true);
    expect(result.perJurisdiction.find((p) => p.jurisdiction === "KE")?.ready).toBe(true);
    expect(result.perJurisdiction.find((p) => p.jurisdiction === "UG")?.ready).toBe(false);
  });

  it("an empty jurisdiction list is itself a blocker, never silently ready", () => {
    const result = assessMultiJurisdictionRegulatoryReadiness([]);
    expect(result.ready).toBe(false);
    expect(result.blockers[0].code).toBe("regulatory_jurisdiction_missing");
  });
});

describe("deriveRegulatoryReadiness", () => {
  const baseInput = {
    policy: {},
    classified: true,
    findings: [] as RegulatoryFinding[],
    rules: [] as RegulatoryRule[],
    reviews: [] as RegulatoryReview[],
    reviewRevocations: [] as RegulatoryReviewRevocation[],
    reviewEquivalences: [],
    confirmations: [] as RegulatoryEvidenceConfirmation[],
    confirmationRevocations: [] as RegulatoryEvidenceConfirmationRevocation[],
    formulaVersionId: "v1",
    jurisdiction: "KE" as const,
  };

  it("classificationCompleted reflects whether a classification actually ran", () => {
    const result = deriveRegulatoryReadiness({ ...baseInput, classified: false });
    expect(result.classificationCompleted).toBe(false);
  });

  it("hasBlockingFinding is true when any non-compliant/missing/human-review/unknown finding exists in this jurisdiction", () => {
    const result = deriveRegulatoryReadiness({ ...baseInput, findings: [baseFinding({ status: "missing_data" })], rules: [baseRule()] });
    expect(result.hasBlockingFinding).toBe(true);
  });

  it("hasBlockingFinding ignores findings from a different jurisdiction", () => {
    const result = deriveRegulatoryReadiness({ ...baseInput, findings: [baseFinding({ status: "non_compliant", jurisdiction: "UG" })], rules: [baseRule({ jurisdiction: "UG" })] });
    expect(result.hasBlockingFinding).toBe(false);
  });

  it("compliant_with_rule and not_applicable findings never count as blocking", () => {
    const result = deriveRegulatoryReadiness({ ...baseInput, findings: [baseFinding({ status: "compliant_with_rule" }), baseFinding({ id: "f2", status: "not_applicable" })], rules: [baseRule()] });
    expect(result.hasBlockingFinding).toBe(false);
  });

  it("allMandatoryDocumentsPresent is false without a matching active confirmation, even if the live finding looks compliant", () => {
    const docRule = baseRule({ id: "doc-rule", ruleType: "document_requirement" });
    const result = deriveRegulatoryReadiness({ ...baseInput, findings: [baseFinding({ ruleId: "doc-rule", status: "missing_data" })], rules: [docRule] });
    expect(result.allMandatoryDocumentsPresent).toBe(false);
  });

  it("allMandatoryDocumentsPresent is true once a persisted confirmation exists for the exact version/jurisdiction", () => {
    const docRule = baseRule({ id: "doc-rule", ruleType: "document_requirement" });
    const result = deriveRegulatoryReadiness({
      ...baseInput,
      findings: [baseFinding({ ruleId: "doc-rule", status: "missing_data" })],
      rules: [docRule],
      confirmations: [baseConfirmation({ ruleId: "doc-rule", requirementType: "document" })],
    });
    expect(result.allMandatoryDocumentsPresent).toBe(true);
  });

  it("a confirmation for a different formula version does not satisfy the gate", () => {
    const docRule = baseRule({ id: "doc-rule", ruleType: "document_requirement" });
    const result = deriveRegulatoryReadiness({
      ...baseInput,
      findings: [baseFinding({ ruleId: "doc-rule", status: "missing_data" })],
      rules: [docRule],
      confirmations: [baseConfirmation({ ruleId: "doc-rule", formulaVersionId: "v2" })],
    });
    expect(result.allMandatoryDocumentsPresent).toBe(false);
  });

  it("a revoked confirmation does not satisfy the gate", () => {
    const docRule = baseRule({ id: "doc-rule", ruleType: "document_requirement" });
    const confirmation = baseConfirmation({ id: "c1", ruleId: "doc-rule" });
    const result = deriveRegulatoryReadiness({
      ...baseInput,
      findings: [baseFinding({ ruleId: "doc-rule", status: "missing_data" })],
      rules: [docRule],
      confirmations: [confirmation],
      confirmationRevocations: [{ id: "rv1", schemaVersion: "1.0", revokesConfirmationId: "c1", revokedBy: "bob", revokedAt: LATER, reason: "Mistake." }],
    });
    expect(result.allMandatoryDocumentsPresent).toBe(false);
  });

  it("allMandatoryEvidencePresent is true once a not_applicable confirmation exists", () => {
    const evidenceRule = baseRule({ id: "ev-rule", ruleType: "claim_evidence_requirement" });
    const result = deriveRegulatoryReadiness({
      ...baseInput,
      findings: [baseFinding({ ruleId: "ev-rule", status: "missing_data" })],
      rules: [evidenceRule],
      confirmations: [baseConfirmation({ ruleId: "ev-rule", requirementType: "evidence", status: "not_applicable" })],
    });
    expect(result.allMandatoryEvidencePresent).toBe(true);
  });

  it("humanReviewCompleted requires a review record for the exact formula version, jurisdiction and packaging SKU", () => {
    const review = baseReview();
    const matching = deriveRegulatoryReadiness({ ...baseInput, reviews: [review] });
    const wrongVersion = deriveRegulatoryReadiness({ ...baseInput, reviews: [review], formulaVersionId: "v2" });
    const wrongJurisdiction = deriveRegulatoryReadiness({ ...baseInput, reviews: [review], jurisdiction: "UG" });
    const wrongPackaging = deriveRegulatoryReadiness({ ...baseInput, reviews: [{ ...review, packagingSkuCode: "SKU-A" }], packagingSkuCode: "SKU-B" });
    expect(matching.humanReviewCompleted).toBe(true);
    expect(matching.humanReviewStatus).toBe("current");
    expect(wrongVersion.humanReviewCompleted).toBe(false);
    expect(wrongVersion.humanReviewStatus).toBe("stale_formula_version");
    expect(wrongJurisdiction.humanReviewCompleted).toBe(false);
    expect(wrongPackaging.humanReviewCompleted).toBe(false);
  });

  it("a working-draft-style review id never satisfies a saved version", () => {
    const draftReview = baseReview({ formulaVersionId: "working_draft" });
    const result = deriveRegulatoryReadiness({ ...baseInput, reviews: [draftReview], formulaVersionId: "v1" });
    expect(result.humanReviewCompleted).toBe(false);
    expect(result.humanReviewStatus).toBe("stale_formula_version");
  });

  it("a revoked review does not satisfy humanReviewCompleted", () => {
    const review = baseReview({ id: "r1" });
    const result = deriveRegulatoryReadiness({
      ...baseInput,
      reviews: [review],
      reviewRevocations: [{ schemaVersion: "1.0", id: "rv1", revokesReviewId: "r1", revokedBy: "bob", revokedAt: LATER, reason: "Incorrect outcome recorded." }],
    });
    expect(result.humanReviewCompleted).toBe(false);
    expect(result.humanReviewStatus).toBe("revoked");
  });

  it("an older review is superseded once a later one exists for the exact same scope", () => {
    const older = baseReview({ id: "r1", reviewedAt: NOW });
    const newer = baseReview({ id: "r2", reviewedAt: LATER });
    const resultForOlderOnly = deriveRegulatoryReadiness({ ...baseInput, reviews: [older] });
    const resultWithBoth = deriveRegulatoryReadiness({ ...baseInput, reviews: [older, newer] });
    expect(resultForOlderOnly.humanReviewCompleted).toBe(true);
    expect(resultWithBoth.humanReviewCompleted).toBe(true);
    expect(resultWithBoth.humanReviewStatus).toBe("current");
  });

  it("a review whose rule-version snapshot has drifted from today's rules is stale, not current", () => {
    const currentRule = baseRule({ id: "rule-1", version: 2 });
    const review = baseReview({ ruleVersionSnapshot: [{ ruleId: "rule-1", ruleCode: "KE-TEST-001", version: 1, verificationStatus: "not_verified" }] });
    const result = deriveRegulatoryReadiness({ ...baseInput, reviews: [review], rules: [currentRule] });
    expect(result.humanReviewCompleted).toBe(false);
    expect(result.humanReviewStatus).toBe("stale_rule_version");
  });
});
