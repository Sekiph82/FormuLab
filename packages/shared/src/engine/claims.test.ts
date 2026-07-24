import { describe, expect, it } from "vitest";
import {
  acceptClaimEvidenceLink,
  activeLinksForClaim,
  calculateClaimsReadiness,
  classifyClaimCategory,
  compareClaimRevisionToReviewedSnapshot,
  createClaim,
  deriveClaimEffectiveStatus,
  deriveClaimRisk,
  deriveClaimStatus,
  evaluateClaimAgainstRules,
  evaluateClaimEvidence,
  evaluateClaimEvidenceEligibility,
  findClaimConflicts,
  isClaimImmutable,
  isClaimReviewActive,
  normalizeClaimText,
  proposeClaimEvidenceLink,
  recordClaimReview,
  rejectClaimEvidenceLink,
  reviseClaim,
  revokeClaimEvidenceLink,
  revokeClaimReview,
  updateClaimStatus,
} from "./claims";
import type { Actor } from "../schemas/status";
import type { RegulatoryDossierEvidenceItem } from "../schemas/dossier";
import type { RegulatoryJurisdiction, RegulatoryRule } from "../schemas/regulatory";
import type { ClaimFinding, ProductClaim } from "../schemas/claimsLabels";

const HUMAN: Actor = { kind: "human", role: "researcher", userId: "alice" };
const REGULATORY_ACTOR: Actor = { kind: "human", role: "regulatory", userId: "bob" };
const AI_ACTOR: Actor = { kind: "system", reason: "automated import" };

function claim(over: Partial<ProductClaim> = {}): ProductClaim {
  return {
    ...createClaim(
      {
        claimCode: "CLM-1",
        claimText: "Kills 99.9% of bacteria",
        formulationId: "proj-1",
        formulaVersionId: "version-1",
        jurisdictions: ["KE"],
        languages: ["en"],
      },
      HUMAN,
    ),
    ...over,
  };
}

function rule(over: Partial<RegulatoryRule> = {}): RegulatoryRule {
  return {
    schemaVersion: "1.0",
    id: "rule-1",
    code: "RULE-1",
    name: "Antibacterial claim substantiation",
    jurisdiction: "KE",
    authority: "KEBS",
    ruleType: "claim_evidence_requirement",
    productCategories: [],
    requirement: "Antibacterial efficacy claims require a lab challenge test.",
    severity: "warning",
    status: "draft",
    conditions: [],
    claimKeywordsAny: ["kills 99.9% of bacteria"],
    requiredEvidenceTypes: ["challenge_test_report"],
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
    createdBy: "seed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function evidence(over: Partial<RegulatoryDossierEvidenceItem> = {}): RegulatoryDossierEvidenceItem {
  return {
    schemaVersion: "1.0",
    id: "evidence-1",
    dossierId: "dossier-1",
    formulationId: "proj-1",
    formulaVersionId: "version-1",
    packagingSkuCode: "SKU-1",
    jurisdictions: ["KE"],
    evidenceType: "challenge_test_report",
    title: "Challenge test report",
    status: "verified",
    sourceType: "uploaded",
    attachmentIds: [],
    confidentiality: "normal",
    createdBy: "alice",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("normalizeClaimText / classifyClaimCategory", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeClaimText("  Kills   99.9% OF Bacteria ")).toBe("kills 99.9% of bacteria");
  });
  it("classifies from real keyword matches, never guessing beyond the text", () => {
    expect(classifyClaimCategory("Kills 99.9% of bacteria")).toBe("antibacterial");
    expect(classifyClaimCategory("Hypoallergenic formula")).toBe("hypoallergenic");
    expect(classifyClaimCategory("A pleasant fragrance")).toBe("other");
  });
});

describe("createClaim", () => {
  it("refuses a non-human actor", () => {
    expect(() =>
      createClaim({ claimCode: "CLM-1", claimText: "Vegan", formulationId: "proj-1", formulaVersionId: "version-1", jurisdictions: ["KE"], languages: ["en"] }, AI_ACTOR),
    ).toThrow();
  });
  it("refuses an empty formula version or jurisdiction/language list", () => {
    expect(() => createClaim({ claimCode: "CLM-1", claimText: "Vegan", formulationId: "proj-1", formulaVersionId: "", jurisdictions: ["KE"], languages: ["en"] }, HUMAN)).toThrow();
    expect(() => createClaim({ claimCode: "CLM-1", claimText: "Vegan", formulationId: "proj-1", formulaVersionId: "version-1", jurisdictions: [], languages: ["en"] }, HUMAN)).toThrow();
    expect(() => createClaim({ claimCode: "CLM-1", claimText: "Vegan", formulationId: "proj-1", formulaVersionId: "version-1", jurisdictions: ["KE"], languages: [] }, HUMAN)).toThrow();
  });
  it("any human role may draft a claim, starting in draft status with an auto-classified category", () => {
    const c = claim();
    expect(c.status).toBe("draft");
    expect(c.claimCategory).toBe("antibacterial");
    expect(c.normalizedClaim).toBe("kills 99.9% of bacteria");
  });
});

describe("claim lifecycle", () => {
  it("refuses to change status once immutable, and refuses a non-human actor", () => {
    const c = { ...claim(), status: "supported" as const };
    expect(isClaimImmutable(c)).toBe(true);
    expect(() => updateClaimStatus(c, "restricted", REGULATORY_ACTOR)).toThrow();
    expect(() => updateClaimStatus(claim(), "proposed", AI_ACTOR)).toThrow();
  });

  it("revising a claim supersedes the original and starts a new draft revision", () => {
    const original = { ...claim(), status: "supported" as const };
    const { superseded, revised } = reviseClaim(original, { claimText: "Kills 99.99% of bacteria" }, HUMAN);
    expect(superseded.status).toBe("superseded");
    expect(revised.status).toBe("draft");
    expect(revised.supersedesClaimId).toBe(original.id);
    expect(revised.normalizedClaim).toBe("kills 99.99% of bacteria");
    expect(deriveClaimEffectiveStatus(superseded, [superseded, revised])).toBe("superseded");
  });
});

describe("evaluateClaimAgainstRules", () => {
  it("only flags a finding from a real, configured rule whose claimKeywordsAny matches — never invents one", () => {
    const findings = evaluateClaimAgainstRules(claim(), { jurisdictions: ["KE"], rules: [rule()] });
    expect(findings.some((f) => f.ruleId === "rule-1")).toBe(true);
    const noMatch = evaluateClaimAgainstRules(claim(), { jurisdictions: ["KE"], rules: [rule({ claimKeywordsAny: ["something else entirely"] })] });
    expect(noMatch.some((f) => f.ruleId === "rule-1")).toBe(false);
  });
  it("always flags a high-risk category (germ_kill/medical/etc.) as requiring human review, regardless of rule coverage", () => {
    const findings = evaluateClaimAgainstRules(claim(), { jurisdictions: ["KE"], rules: [] });
    expect(findings.some((f) => f.findingType === "high_risk_claim" && f.humanReviewRequired)).toBe(true);
  });
  it("never evaluates a jurisdiction the claim isn't scoped to", () => {
    const findings = evaluateClaimAgainstRules(claim(), { jurisdictions: ["UG"], rules: [rule()] });
    expect(findings.some((f) => f.jurisdiction === "KE")).toBe(false);
  });
});

describe("claim evidence links and eligibility", () => {
  it("proposing a link never satisfies the claim — only an accepted link with verified, eligible evidence counts", () => {
    const c = claim();
    const proposed = proposeClaimEvidenceLink(c.id, "evidence-1", "dossier-1", 1, HUMAN);
    expect(proposed.linkStatus).toBe("proposed");
    let result = evaluateClaimEvidence(c, [proposed], [evidence()], { formulaVersionId: "version-1", packagingSkuCode: "SKU-1", jurisdictions: ["KE"] as RegulatoryJurisdiction[] });
    expect(result.hasVerifiedEligibleEvidence).toBe(false);

    const accepted = acceptClaimEvidenceLink(proposed, HUMAN);
    expect(accepted.linkStatus).toBe("accepted");
    result = evaluateClaimEvidence(c, [accepted], [evidence()], { formulaVersionId: "version-1", packagingSkuCode: "SKU-1", jurisdictions: ["KE"] as RegulatoryJurisdiction[] });
    expect(result.hasVerifiedEligibleEvidence).toBe(true);
    expect(result.missingEvidence).toBe(false);
  });

  it("rejects wrong-version, wrong-SKU, wrong-jurisdiction, expired, rejected and revoked evidence as ineligible", () => {
    const ctx = { formulaVersionId: "version-1", packagingSkuCode: "SKU-1", jurisdictions: ["KE"] as RegulatoryJurisdiction[] };
    expect(evaluateClaimEvidenceEligibility(evidence({ formulaVersionId: "version-2" }), ctx).eligible).toBe(false);
    expect(evaluateClaimEvidenceEligibility(evidence({ packagingSkuCode: "SKU-2" }), ctx).eligible).toBe(false);
    expect(evaluateClaimEvidenceEligibility(evidence({ jurisdictions: ["UG"] as RegulatoryJurisdiction[] }), ctx).eligible).toBe(false);
    expect(evaluateClaimEvidenceEligibility(evidence({ expiresAt: "2020-01-01T00:00:00.000Z" }), ctx).eligible).toBe(false);
    expect(evaluateClaimEvidenceEligibility(evidence({ status: "rejected" }), ctx).eligible).toBe(false);
    expect(evaluateClaimEvidenceEligibility(evidence({ status: "revoked" }), ctx).eligible).toBe(false);
    expect(evaluateClaimEvidenceEligibility(evidence(), ctx).eligible).toBe(true);
  });

  it("reports missing evidence when there is no accepted link at all", () => {
    const result = evaluateClaimEvidence(claim(), [], [], { formulaVersionId: "version-1", jurisdictions: ["KE"] as RegulatoryJurisdiction[] });
    expect(result.missingEvidence).toBe(true);
    expect(result.findings[0].findingType).toBe("missing_evidence");
  });

  it("rejecting and revoking a link require a non-empty reason", () => {
    const proposed = proposeClaimEvidenceLink("claim-1", "evidence-1", "dossier-1", 1, HUMAN);
    expect(() => rejectClaimEvidenceLink(proposed, HUMAN, "")).toThrow();
    expect(() => revokeClaimEvidenceLink(proposed, HUMAN, "")).toThrow();
    const accepted = acceptClaimEvidenceLink(proposed, HUMAN);
    const revoked = revokeClaimEvidenceLink(accepted, HUMAN, "Wrong document");
    expect(revoked.linkStatus).toBe("revoked");
    expect(revoked.revokesLinkId).toBe(accepted.id);
  });

  it("activeLinksForClaim takes the latest row per evidence item and excludes revoked", () => {
    const proposed = proposeClaimEvidenceLink("claim-1", "evidence-1", "dossier-1", 1, HUMAN);
    const accepted = { ...acceptClaimEvidenceLink(proposed, HUMAN), id: proposed.id };
    const active = activeLinksForClaim([proposed, accepted], "claim-1");
    expect(active).toHaveLength(1);
    expect(active[0].linkStatus).toBe("accepted");
  });
});

describe("deriveClaimStatus / deriveClaimRisk", () => {
  it("unknown never equals supported — a human-review-required finding keeps status unknown even with evidence", () => {
    const findings: ClaimFinding[] = [{ claimId: "c1", jurisdiction: "KE", language: "en", findingType: "high_risk_claim", severity: "warning", status: "under_review", message: "x", requiredEvidence: [], conditions: [], humanReviewRequired: true }];
    expect(deriveClaimStatus(findings, { hasVerifiedEligibleEvidence: true, missingEvidence: false })).toBe("unknown");
  });
  it("a prohibited-rule finding always wins regardless of evidence", () => {
    const findings: ClaimFinding[] = [{ claimId: "c1", jurisdiction: "KE", language: "en", findingType: "prohibited", severity: "blocking", status: "prohibited", message: "x", requiredEvidence: [], conditions: [], humanReviewRequired: false }];
    expect(deriveClaimStatus(findings, { hasVerifiedEligibleEvidence: true, missingEvidence: false })).toBe("prohibited");
  });
  it("supported only when there are no blocking findings and evidence is verified", () => {
    expect(deriveClaimStatus([], { hasVerifiedEligibleEvidence: true, missingEvidence: false })).toBe("supported");
    expect(deriveClaimStatus([], { hasVerifiedEligibleEvidence: false, missingEvidence: true })).toBe("proposed");
  });
  it("high-risk categories are never rated low risk", () => {
    expect(deriveClaimRisk(claim(), [])).toBe("high");
  });
});

describe("findClaimConflicts", () => {
  it("flags two active claims with identical normalized text and overlapping scope, never merging them", () => {
    const a = claim();
    const b = { ...claim(), id: "claim-2", claimCode: "CLM-2" };
    const conflicts = findClaimConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toEqual({ claimAId: a.id, claimBId: b.id, reason: "duplicate_text_same_scope" });
  });
  it("does not flag a superseded claim against its own replacement", () => {
    const original = claim();
    const { superseded, revised } = reviseClaim(original, {}, HUMAN);
    expect(findClaimConflicts([superseded, revised])).toHaveLength(0);
  });
});

describe("calculateClaimsReadiness", () => {
  it("no claims is not_ready, never a fabricated ready state", () => {
    expect(calculateClaimsReadiness([], new Map()).overallReadiness).toBe("not_ready");
  });
  it("a human-review-required finding makes the whole readiness unknown, highest priority", () => {
    const c = claim();
    const findings = new Map([[c.id, [{ claimId: c.id, jurisdiction: "KE", language: "en", findingType: "high_risk_claim", severity: "warning", status: "under_review", message: "x", requiredEvidence: [], conditions: [], humanReviewRequired: true } as ClaimFinding]]]);
    expect(calculateClaimsReadiness([c], findings).overallReadiness).toBe("unknown");
  });
  it("all claims supported is ready_for_review", () => {
    const c = { ...claim(), status: "supported" as const };
    expect(calculateClaimsReadiness([c], new Map()).overallReadiness).toBe("ready_for_review");
  });
});

describe("claim reviews", () => {
  it("requires an authorized actor and non-empty notes", () => {
    expect(() =>
      recordClaimReview({ claimId: "c1", claimRevision: 1, formulationId: "proj-1", formulaVersionId: "version-1", jurisdiction: "KE", language: "en", outcome: "supported", notes: "Looks good." }, HUMAN),
    ).toThrow();
    expect(() =>
      recordClaimReview({ claimId: "c1", claimRevision: 1, formulationId: "proj-1", formulaVersionId: "version-1", jurisdiction: "KE", language: "en", outcome: "supported", notes: "" }, REGULATORY_ACTOR),
    ).toThrow();
  });
  it("binds to an exact claim revision — a review of revision 1 doesn't cover revision 2", () => {
    const review = recordClaimReview(
      { claimId: "c1", claimRevision: 1, formulationId: "proj-1", formulaVersionId: "version-1", jurisdiction: "KE", language: "en", outcome: "supported", notes: "Looks good." },
      REGULATORY_ACTOR,
    );
    expect(isClaimReviewActive(review, [], 1)).toBe(true);
    expect(isClaimReviewActive(review, [], 2)).toBe(false);
  });
  it("revocation is append-only and deactivates the review", () => {
    const review = recordClaimReview(
      { claimId: "c1", claimRevision: 1, formulationId: "proj-1", formulaVersionId: "version-1", jurisdiction: "KE", language: "en", outcome: "supported", notes: "Looks good." },
      REGULATORY_ACTOR,
    );
    expect(() => revokeClaimReview(review.id, REGULATORY_ACTOR, "")).toThrow();
    const revocation = revokeClaimReview(review.id, REGULATORY_ACTOR, "Made in error");
    expect(isClaimReviewActive(review, [revocation], 1)).toBe(false);
  });
});

describe("compareClaimRevisionToReviewedSnapshot", () => {
  it("flags staleness when the claim was updated after the review", () => {
    const c = claim();
    const review = recordClaimReview(
      { claimId: c.id, claimRevision: 1, formulationId: "proj-1", formulaVersionId: "version-1", jurisdiction: "KE", language: "en", outcome: "supported", notes: "ok" },
      REGULATORY_ACTOR,
    );
    const updated = { ...c, updatedAt: new Date(Date.now() + 60_000).toISOString() };
    expect(compareClaimRevisionToReviewedSnapshot(updated, review)).toBe(true);
    expect(compareClaimRevisionToReviewedSnapshot(c, review)).toBe(false);
  });
});
