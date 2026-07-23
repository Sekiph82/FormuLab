import { describe, expect, it } from "vitest";
import {
  compareReviewRuleSnapshotToCurrentRules,
  declareRegulatoryReviewEquivalence,
  deriveRegulatoryReviewStatus,
  findApplicableRegulatoryReview,
  isRegulatoryReviewCurrent,
  recordEvidenceConfirmation,
  recordRegulatoryReview,
  revokeEvidenceConfirmation,
  revokeRegulatoryReview,
  revokeRegulatoryReviewEquivalence,
} from "./regulatoryReviews";
import type { Actor } from "../schemas/status";
import type { RegulatoryReview, RegulatoryRule } from "../schemas/regulatory";

const REGULATORY_ACTOR: Actor = { kind: "human", role: "regulatory", userId: "alice" };
const QUALITY_ACTOR: Actor = { kind: "human", role: "quality", userId: "quinn" };
const ADMIN_ACTOR: Actor = { kind: "human", role: "administrator", userId: "root" };
const CHEMIST_ACTOR: Actor = { kind: "human", role: "chemist", userId: "bob" };
const RESEARCHER_ACTOR: Actor = { kind: "human", role: "researcher", userId: "rae" };
const AGENT_ACTOR: Actor = { kind: "agent", runId: "run-1" };
const SYSTEM_ACTOR: Actor = { kind: "system", reason: "scheduled sync" };
const IMPORT_ACTOR: Actor = { kind: "import", source: "spreadsheet.csv" };

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-02-01T00:00:00.000Z";

function rule(over: Partial<RegulatoryRule> = {}): RegulatoryRule {
  return {
    schemaVersion: "1.0",
    id: "rule-1",
    code: "KE-TEST-001",
    name: "Test rule",
    jurisdiction: "KE",
    authority: "Test authority",
    ruleType: "document_requirement",
    productCategories: [],
    requirement: "Placeholder.",
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

function review(over: Partial<RegulatoryReview> = {}): RegulatoryReview {
  return {
    schemaVersion: "1.0",
    id: "review-1",
    formulationId: "proj-1",
    formulaVersionId: "v1",
    jurisdiction: "KE",
    classificationSnapshot: { category: "disinfectant", confidence: 0.8, reasoning: ["test"], uncertain: false },
    findingSnapshot: [],
    ruleVersionSnapshot: [{ ruleId: "rule-1", ruleCode: "KE-TEST-001", version: 1, verificationStatus: "not_verified" }],
    reviewedBy: "alice",
    reviewerRole: "regulatory",
    reviewedAt: NOW,
    outcome: "compliant",
    notes: "Looks fine.",
    ...over,
  };
}

const RECORD_INPUT = {
  formulationId: "proj-1",
  formulaVersionId: "v1",
  jurisdiction: "KE" as const,
  classificationSnapshot: { category: "disinfectant" as const, confidence: 0.8, reasoning: ["test"], uncertain: false },
  findingSnapshot: [],
  ruleVersionSnapshot: [],
  outcome: "compliant" as const,
  notes: "Reviewed findings and classification; compliant.",
};

describe("recordRegulatoryReview", () => {
  it("refuses a non-human actor", () => {
    expect(() => recordRegulatoryReview(RECORD_INPUT, AGENT_ACTOR)).toThrow();
    expect(() => recordRegulatoryReview(RECORD_INPUT, IMPORT_ACTOR)).toThrow();
  });

  it("refuses a human without an authorized regulatory/quality/administrator role", () => {
    expect(() => recordRegulatoryReview(RECORD_INPUT, CHEMIST_ACTOR)).toThrow();
    expect(() => recordRegulatoryReview(RECORD_INPUT, RESEARCHER_ACTOR)).toThrow();
  });

  it("refuses a system actor", () => {
    expect(() => recordRegulatoryReview(RECORD_INPUT, SYSTEM_ACTOR)).toThrow();
  });

  it("a quality or administrator role may also record a review", () => {
    expect(recordRegulatoryReview(RECORD_INPUT, QUALITY_ACTOR).reviewerRole).toBe("quality");
    expect(recordRegulatoryReview(RECORD_INPUT, ADMIN_ACTOR).reviewerRole).toBe("administrator");
  });

  it("refuses an empty formulaVersionId", () => {
    expect(() => recordRegulatoryReview({ ...RECORD_INPUT, formulaVersionId: "" }, REGULATORY_ACTOR)).toThrow();
  });

  it("refuses empty notes", () => {
    expect(() => recordRegulatoryReview({ ...RECORD_INPUT, notes: "  " }, REGULATORY_ACTOR)).toThrow();
  });

  it("records a review bound to the exact version, jurisdiction, reviewer and role", () => {
    const r = recordRegulatoryReview(RECORD_INPUT, REGULATORY_ACTOR);
    expect(r.formulaVersionId).toBe("v1");
    expect(r.jurisdiction).toBe("KE");
    expect(r.reviewedBy).toBe("alice");
    expect(r.reviewerRole).toBe("regulatory");
  });
});

describe("revokeRegulatoryReview", () => {
  it("refuses a non-regulatory human", () => {
    expect(() => revokeRegulatoryReview("review-1", CHEMIST_ACTOR, "Mistake.")).toThrow();
    expect(() => revokeRegulatoryReview("review-1", RESEARCHER_ACTOR, "Mistake.")).toThrow();
  });

  it("refuses a non-human actor", () => {
    expect(() => revokeRegulatoryReview("review-1", AGENT_ACTOR, "Mistake.")).toThrow();
    expect(() => revokeRegulatoryReview("review-1", SYSTEM_ACTOR, "Mistake.")).toThrow();
    expect(() => revokeRegulatoryReview("review-1", IMPORT_ACTOR, "Mistake.")).toThrow();
  });

  it("a quality or administrator role may also revoke a review", () => {
    expect(revokeRegulatoryReview("review-1", QUALITY_ACTOR, "Mistake.").revokedByRole).toBe("quality");
    expect(revokeRegulatoryReview("review-1", ADMIN_ACTOR, "Mistake.").revokedByRole).toBe("administrator");
  });

  it("refuses an empty reason", () => {
    expect(() => revokeRegulatoryReview("review-1", REGULATORY_ACTOR, "")).toThrow();
  });

  it("produces a revocation record pointing at the original, never mutating it", () => {
    const revocation = revokeRegulatoryReview("review-1", REGULATORY_ACTOR, "Incorrect outcome recorded.");
    expect(revocation.revokesReviewId).toBe("review-1");
    expect(revocation.revokedBy).toBe("alice");
  });
});

describe("compareReviewRuleSnapshotToCurrentRules", () => {
  it("is not stale when every snapshotted rule's version matches current", () => {
    const result = compareReviewRuleSnapshotToCurrentRules([{ ruleId: "rule-1", ruleCode: "KE-TEST-001", version: 1, verificationStatus: "not_verified" }], [rule({ version: 1 })]);
    expect(result.stale).toBe(false);
  });

  it("is stale when a snapshotted rule's version has since changed", () => {
    const result = compareReviewRuleSnapshotToCurrentRules([{ ruleId: "rule-1", ruleCode: "KE-TEST-001", version: 1, verificationStatus: "not_verified" }], [rule({ version: 2 })]);
    expect(result.stale).toBe(true);
    expect(result.changedRuleIds).toEqual(["rule-1"]);
  });

  it("is stale when a snapshotted rule no longer exists at all", () => {
    const result = compareReviewRuleSnapshotToCurrentRules([{ ruleId: "rule-1", ruleCode: "KE-TEST-001", version: 1, verificationStatus: "not_verified" }], []);
    expect(result.stale).toBe(true);
  });
});

describe("deriveRegulatoryReviewStatus / isRegulatoryReviewCurrent", () => {
  const ctx = { formulaVersionId: "v1", jurisdiction: "KE" as const, packagingSkuCode: undefined };

  it("is current when everything matches and rules haven't drifted", () => {
    const r = review();
    expect(deriveRegulatoryReviewStatus(r, ctx, [], [r], [rule({ version: 1 })])).toBe("current");
    expect(isRegulatoryReviewCurrent(r, ctx, [], [r], [rule({ version: 1 })])).toBe(true);
  });

  it("wrong jurisdiction is reported specifically, not silently ignored", () => {
    const r = review({ jurisdiction: "UG" });
    expect(deriveRegulatoryReviewStatus(r, ctx, [], [r], [rule()])).toBe("wrong_jurisdiction");
  });

  it("wrong packaging SKU is reported specifically", () => {
    const r = review({ packagingSkuCode: "SKU-A" });
    expect(deriveRegulatoryReviewStatus(r, { ...ctx, packagingSkuCode: "SKU-B" }, [], [r], [rule()])).toBe("wrong_packaging_sku");
  });

  it("a different formula version is stale_formula_version, never silently accepted", () => {
    const r = review({ formulaVersionId: "v2" });
    expect(deriveRegulatoryReviewStatus(r, ctx, [], [r], [rule()])).toBe("stale_formula_version");
  });

  it("a working_draft-recorded review never satisfies a saved version", () => {
    const r = review({ formulaVersionId: "working_draft" });
    expect(deriveRegulatoryReviewStatus(r, ctx, [], [r], [rule()])).toBe("stale_formula_version");
  });

  it("a revoked review is revoked regardless of everything else matching", () => {
    const r = review({ id: "r1" });
    const revocation = { schemaVersion: "1.0" as const, id: "rv1", revokesReviewId: "r1", revokedBy: "alice", revokedAt: LATER, reason: "Wrong." };
    expect(deriveRegulatoryReviewStatus(r, ctx, [revocation], [r], [rule()])).toBe("revoked");
  });

  it("an older review is superseded by a later one for the exact same scope", () => {
    const older = review({ id: "r1", reviewedAt: NOW });
    const newer = review({ id: "r2", reviewedAt: LATER });
    expect(deriveRegulatoryReviewStatus(older, ctx, [], [older, newer], [rule()])).toBe("superseded");
    expect(deriveRegulatoryReviewStatus(newer, ctx, [], [older, newer], [rule()])).toBe("current");
  });

  it("rule-version drift is stale_rule_version", () => {
    const r = review();
    expect(deriveRegulatoryReviewStatus(r, ctx, [], [r], [rule({ version: 2 })])).toBe("stale_rule_version");
  });
});

describe("findApplicableRegulatoryReview", () => {
  const ctx = { formulaVersionId: "v1", jurisdiction: "KE" as const, packagingSkuCode: undefined };

  it("finds a directly matching current review", () => {
    const r = review();
    const result = findApplicableRegulatoryReview(ctx, [r], [], [], [rule()]);
    expect(result?.review.id).toBe(r.id);
    expect(result?.reusedViaEquivalenceId).toBeUndefined();
  });

  it("returns undefined when nothing applies and no equivalence permits reuse", () => {
    const r = review({ formulaVersionId: "v2" });
    expect(findApplicableRegulatoryReview(ctx, [r], [], [], [rule()])).toBeUndefined();
  });

  it("finds a review reused via an active equivalence declaration for the exact target/jurisdiction/SKU", () => {
    const sourceReview = review({ id: "r-source", formulaVersionId: "v0" });
    const equivalence = declareRegulatoryReviewEquivalence(
      { formulationId: "proj-1", targetVersionId: "v1", sourceVersionId: "v0", jurisdiction: "KE", justification: "Only fragrance changed; regulatory picture identical." },
      REGULATORY_ACTOR,
    );
    const result = findApplicableRegulatoryReview(ctx, [sourceReview], [], [equivalence], [rule()]);
    expect(result?.review.id).toBe("r-source");
    expect(result?.reusedViaEquivalenceId).toBe(equivalence.id);
  });

  it("a revoked equivalence never permits reuse", () => {
    const sourceReview = review({ id: "r-source", formulaVersionId: "v0" });
    const equivalence = declareRegulatoryReviewEquivalence(
      { formulationId: "proj-1", targetVersionId: "v1", sourceVersionId: "v0", jurisdiction: "KE", justification: "Only fragrance changed." },
      REGULATORY_ACTOR,
    );
    const revoked = revokeRegulatoryReviewEquivalence(equivalence, REGULATORY_ACTOR, "Formulas diverged more than expected.");
    expect(findApplicableRegulatoryReview(ctx, [sourceReview], [], [equivalence, revoked], [rule()])).toBeUndefined();
  });

  it("laboratory-only equivalence reuse never silently grants regulatory reuse (no regulatory equivalence declared at all)", () => {
    const sourceReview = review({ id: "r-source", formulaVersionId: "v0" });
    // No RegulatoryReviewEquivalence declared for v0 -> v1 at all.
    expect(findApplicableRegulatoryReview(ctx, [sourceReview], [], [], [rule()])).toBeUndefined();
  });
});

describe("evidence confirmations", () => {
  const CONFIRM_INPUT = {
    formulationId: "proj-1",
    formulaVersionId: "v1",
    jurisdiction: "KE" as const,
    ruleId: "rule-1",
    requirementType: "document" as const,
    requirementCode: "sds",
    status: "confirmed" as const,
  };

  it("refuses a non-human actor", () => {
    expect(() => recordEvidenceConfirmation(CONFIRM_INPUT, AGENT_ACTOR)).toThrow();
    expect(() => recordEvidenceConfirmation(CONFIRM_INPUT, SYSTEM_ACTOR)).toThrow();
    expect(() => recordEvidenceConfirmation(CONFIRM_INPUT, IMPORT_ACTOR)).toThrow();
  });

  it("refuses a human without an authorized regulatory/quality/administrator role", () => {
    expect(() => recordEvidenceConfirmation(CONFIRM_INPUT, CHEMIST_ACTOR)).toThrow(/authorized regulatory, quality or administrator/);
    expect(() => recordEvidenceConfirmation(CONFIRM_INPUT, RESEARCHER_ACTOR)).toThrow();
  });

  it("regulatory, quality and administrator roles may each confirm evidence", () => {
    expect(recordEvidenceConfirmation(CONFIRM_INPUT, REGULATORY_ACTOR).confirmedBy).toBe("alice");
    expect(recordEvidenceConfirmation(CONFIRM_INPUT, QUALITY_ACTOR).confirmedBy).toBe("quinn");
    expect(recordEvidenceConfirmation(CONFIRM_INPUT, ADMIN_ACTOR).confirmedBy).toBe("root");
  });

  it("records a confirmation bound to the exact version/jurisdiction", () => {
    const c = recordEvidenceConfirmation(CONFIRM_INPUT, REGULATORY_ACTOR);
    expect(c.formulaVersionId).toBe("v1");
    expect(c.confirmedBy).toBe("alice");
    expect(c.reviewerRole).toBe("regulatory");
  });

  it("no confirmation record is produced when authorization fails", () => {
    expect(() => recordEvidenceConfirmation(CONFIRM_INPUT, CHEMIST_ACTOR)).toThrow();
    // The throw happens before any record is built — there is nothing a
    // caller could have persisted even if it ignored the exception.
  });

  it("revoking requires an authorized regulatory/quality/administrator actor and a reason", () => {
    expect(() => revokeEvidenceConfirmation("c1", AGENT_ACTOR, "reason")).toThrow();
    expect(() => revokeEvidenceConfirmation("c1", CHEMIST_ACTOR, "reason")).toThrow();
    expect(() => revokeEvidenceConfirmation("c1", REGULATORY_ACTOR, "")).toThrow();
    const revocation = revokeEvidenceConfirmation("c1", REGULATORY_ACTOR, "Document was actually missing.");
    expect(revocation.revokesConfirmationId).toBe("c1");
  });
});

describe("regulatory review equivalence", () => {
  it("refuses a non-human actor", () => {
    expect(() =>
      declareRegulatoryReviewEquivalence({ formulationId: "p1", targetVersionId: "v1", sourceVersionId: "v0", jurisdiction: "KE", justification: "x" }, AGENT_ACTOR),
    ).toThrow();
    expect(() =>
      declareRegulatoryReviewEquivalence({ formulationId: "p1", targetVersionId: "v1", sourceVersionId: "v0", jurisdiction: "KE", justification: "x" }, SYSTEM_ACTOR),
    ).toThrow();
    expect(() =>
      declareRegulatoryReviewEquivalence({ formulationId: "p1", targetVersionId: "v1", sourceVersionId: "v0", jurisdiction: "KE", justification: "x" }, IMPORT_ACTOR),
    ).toThrow();
  });

  it("refuses a human without an authorized regulatory/quality/administrator role", () => {
    expect(() =>
      declareRegulatoryReviewEquivalence({ formulationId: "p1", targetVersionId: "v1", sourceVersionId: "v0", jurisdiction: "KE", justification: "x" }, CHEMIST_ACTOR),
    ).toThrow(/authorized regulatory, quality or administrator/);
    expect(() =>
      declareRegulatoryReviewEquivalence({ formulationId: "p1", targetVersionId: "v1", sourceVersionId: "v0", jurisdiction: "KE", justification: "x" }, RESEARCHER_ACTOR),
    ).toThrow();
  });

  it("regulatory, quality and administrator roles may each declare an equivalence", () => {
    for (const actor of [REGULATORY_ACTOR, QUALITY_ACTOR, ADMIN_ACTOR]) {
      const eq = declareRegulatoryReviewEquivalence(
        { formulationId: "p1", targetVersionId: "v1", sourceVersionId: "v0", jurisdiction: "KE", justification: "Only fragrance changed." },
        actor,
      );
      expect(eq.declaredByRole).toBe(actor.role);
    }
  });

  it("an unauthorized actor's revocation attempt is rejected", () => {
    const equivalence = declareRegulatoryReviewEquivalence(
      { formulationId: "p1", targetVersionId: "v1", sourceVersionId: "v0", jurisdiction: "KE", justification: "Only fragrance changed." },
      REGULATORY_ACTOR,
    );
    expect(() => revokeRegulatoryReviewEquivalence(equivalence, CHEMIST_ACTOR, "Reconsidered.")).toThrow();
    expect(() => revokeRegulatoryReviewEquivalence(equivalence, AGENT_ACTOR, "Reconsidered.")).toThrow();
  });

  it("refuses an empty justification", () => {
    expect(() =>
      declareRegulatoryReviewEquivalence({ formulationId: "p1", targetVersionId: "v1", sourceVersionId: "v0", jurisdiction: "KE", justification: "  " }, REGULATORY_ACTOR),
    ).toThrow();
  });

  it("refuses a version declared equivalent to itself", () => {
    expect(() =>
      declareRegulatoryReviewEquivalence({ formulationId: "p1", targetVersionId: "v1", sourceVersionId: "v1", jurisdiction: "KE", justification: "x" }, REGULATORY_ACTOR),
    ).toThrow();
  });

  it("revocation is a new record, the original is never mutated", () => {
    const equivalence = declareRegulatoryReviewEquivalence(
      { formulationId: "p1", targetVersionId: "v1", sourceVersionId: "v0", jurisdiction: "KE", justification: "Only fragrance changed." },
      REGULATORY_ACTOR,
    );
    const revoked = revokeRegulatoryReviewEquivalence(equivalence, REGULATORY_ACTOR, "Formulas diverged.");
    expect(equivalence.revokesEquivalenceId).toBeUndefined();
    expect(revoked.revokesEquivalenceId).toBe(equivalence.id);
    expect(revoked.id).not.toBe(equivalence.id);
  });

  it("a revocation record cannot itself be revoked", () => {
    const equivalence = declareRegulatoryReviewEquivalence(
      { formulationId: "p1", targetVersionId: "v1", sourceVersionId: "v0", jurisdiction: "KE", justification: "Only fragrance changed." },
      REGULATORY_ACTOR,
    );
    const revoked = revokeRegulatoryReviewEquivalence(equivalence, REGULATORY_ACTOR, "Formulas diverged.");
    expect(() => revokeRegulatoryReviewEquivalence(revoked, REGULATORY_ACTOR, "again")).toThrow();
  });
});
