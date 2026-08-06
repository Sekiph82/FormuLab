import { describe, expect, it } from "vitest";
import { assessApprovalReadiness, canTransitionWithReadiness, type ApprovalReadiness } from "./approvalReadiness";
import type { Actor } from "../schemas/status";
import type { ValidationFinding } from "./formula";
import type { CompatibilityFinding } from "../schemas/compatibility";
import type { SafetyFinding } from "../schemas/safety";

const CHEMIST: Actor = { kind: "human", role: "chemist", userId: "u1" };
const QUALITY: Actor = { kind: "human", role: "quality", userId: "u2" };
const AGENT: Actor = { kind: "agent", runId: "run-1" };
const SYSTEM: Actor = { kind: "system", reason: "batch job" };
const IMPORT: Actor = { kind: "import", source: "supplier.csv" };

const blockingValidation: ValidationFinding = {
  id: "v1",
  severity: "blocking",
  code: "TOTAL_NOT_100",
  message: "Formula totals 97%, not 100%.",
};

const blockingCompat: CompatibilityFinding = {
  id: "c1",
  ruleId: "compat-acid-hypochlorite",
  ruleVersion: "1.0",
  severity: "blocking",
  materialIds: ["m1"],
  lineIds: ["l1"],
  message: "Acid + hypochlorite.",
  verificationStatus: "human_review_required",
  triggeredConditions: [0, 1],
  dataIncomplete: false,
};

const blockingSafety: SafetyFinding = {
  id: "s1",
  ruleId: "safety-acid-hypochlorite",
  ruleVersion: "1.0",
  severity: "blocking",
  category: "acid_hypochlorite",
  affectedMaterialIds: ["m1"],
  affectedLineIds: ["l1"],
  message: "Acid + hypochlorite releases chlorine gas.",
  requiredPpe: ["goggles"],
  requiredEngineeringControls: [],
  verificationStatus: "human_review_required",
  humanReviewRequired: true,
  dataIncomplete: false,
};

describe("assessApprovalReadiness", () => {
  it("is ready when there is nothing to block it", () => {
    const r = assessApprovalReadiness({ validationFindings: [], compatibilityFindings: [], safetyFindings: [] });
    expect(r.ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("blocks on a blocking formula validation error", () => {
    const r = assessApprovalReadiness({
      validationFindings: [blockingValidation],
      compatibilityFindings: [],
      safetyFindings: [],
    });
    expect(r.ready).toBe(false);
    expect(r.blockers[0].source).toBe("validation");
  });

  it("blocks on a blocking compatibility finding", () => {
    const r = assessApprovalReadiness({ validationFindings: [], compatibilityFindings: [blockingCompat], safetyFindings: [] });
    expect(r.ready).toBe(false);
    expect(r.blockers[0].source).toBe("compatibility");
  });

  it("blocks on a blocking safety finding", () => {
    const r = assessApprovalReadiness({ validationFindings: [], compatibilityFindings: [], safetyFindings: [blockingSafety] });
    expect(r.ready).toBe(false);
    expect(r.blockers[0].source).toBe("safety");
  });

  it("blocks on unresolved mandatory human review by product classification", () => {
    const r = assessApprovalReadiness({
      validationFindings: [],
      compatibilityFindings: [],
      safetyFindings: [],
      productClassification: "hazardous_lawful_product",
    });
    expect(r.ready).toBe(false);
    expect(r.blockers[0].source).toBe("human_review");
  });

  it("clears the human-review blocker once acknowledged", () => {
    const r = assessApprovalReadiness({
      validationFindings: [],
      compatibilityFindings: [],
      safetyFindings: [],
      productClassification: "hazardous_lawful_product",
      humanReviewAcknowledged: true,
    });
    expect(r.ready).toBe(true);
  });

  it("does not block on an ordinary classification", () => {
    const r = assessApprovalReadiness({
      validationFindings: [],
      compatibilityFindings: [],
      safetyFindings: [],
      productClassification: "ordinary_consumer_product",
    });
    expect(r.ready).toBe(true);
  });

  it("a resolved finding no longer blocks, but a different unresolved one still does", () => {
    const r = assessApprovalReadiness({
      validationFindings: [],
      compatibilityFindings: [blockingCompat],
      safetyFindings: [blockingSafety],
      resolvedFindingIds: [blockingCompat.id],
    });
    expect(r.ready).toBe(false);
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0].source).toBe("safety");
  });

  it("keeps warnings distinct from blockers", () => {
    const warn: ValidationFinding = { id: "v2", severity: "warning", code: "TECHNICAL_MAX_EXCEEDED", message: "High usage." };
    const r = assessApprovalReadiness({ validationFindings: [warn], compatibilityFindings: [], safetyFindings: [] });
    expect(r.ready).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.blockers).toHaveLength(0);
  });

  it("is ready when the applied optimization run's stored status is optimal", () => {
    const r = assessApprovalReadiness({
      validationFindings: [],
      compatibilityFindings: [],
      safetyFindings: [],
      appliedOptimizationRun: { code: "opt-1", status: "optimal" },
    });
    expect(r.ready).toBe(true);
  });

  it("blocks when a version claims an optimization run whose stored status is infeasible", () => {
    const r = assessApprovalReadiness({
      validationFindings: [],
      compatibilityFindings: [],
      safetyFindings: [],
      appliedOptimizationRun: { code: "opt-1", status: "infeasible" },
    });
    expect(r.ready).toBe(false);
    expect(r.blockers[0].source).toBe("optimization");
    expect(r.blockers[0].id).toBe("optimization-run:opt-1");
  });

  it("blocks when a version claims an optimization run that does not exist in the store", () => {
    const r = assessApprovalReadiness({
      validationFindings: [],
      compatibilityFindings: [],
      safetyFindings: [],
      appliedOptimizationRun: { code: "opt-forged", status: undefined },
    });
    expect(r.ready).toBe(false);
    expect(r.blockers[0].message).toContain("no such run record exists");
  });

  it("is ready when the applied substitution run's stored status is candidates_found and a candidate is selected", () => {
    const r = assessApprovalReadiness({
      validationFindings: [],
      compatibilityFindings: [],
      safetyFindings: [],
      appliedSubstitutionRun: { code: "sub-1", status: "candidates_found", selectedCandidateId: "cand-1" },
    });
    expect(r.ready).toBe(true);
  });

  it("blocks when a version claims a substitution run with no valid candidate", () => {
    const r = assessApprovalReadiness({
      validationFindings: [],
      compatibilityFindings: [],
      safetyFindings: [],
      appliedSubstitutionRun: { code: "sub-1", status: "no_valid_candidate" },
    });
    expect(r.ready).toBe(false);
    expect(r.blockers[0].source).toBe("substitution");
  });

  it("blocks when a version claims a forged substitution run", () => {
    const r = assessApprovalReadiness({
      validationFindings: [],
      compatibilityFindings: [],
      safetyFindings: [],
      appliedSubstitutionRun: { code: "sub-forged", status: undefined },
    });
    expect(r.ready).toBe(false);
    expect(r.blockers[0].message).toContain("no such run record exists");
  });

  it("blocks when the applied substitution run has candidates but nothing was selected", () => {
    const r = assessApprovalReadiness({
      validationFindings: [],
      compatibilityFindings: [],
      safetyFindings: [],
      appliedSubstitutionRun: { code: "sub-1", status: "candidates_found" },
    });
    expect(r.ready).toBe(false);
    expect(r.blockers[0].message).toContain("no selected candidate recorded");
  });

  it("blocks when the applied substitution run's selected candidate is itself blocked", () => {
    const r = assessApprovalReadiness({
      validationFindings: [],
      compatibilityFindings: [],
      safetyFindings: [],
      appliedSubstitutionRun: {
        code: "sub-1",
        status: "candidates_found",
        selectedCandidateId: "cand-1",
        selectedCandidateBlocked: true,
      },
    });
    expect(r.ready).toBe(false);
    expect(r.blockers[0].message).toContain("blocking compatibility or safety finding");
  });
});

describe("canTransitionWithReadiness — bypass attempts", () => {
  const NOT_READY: ApprovalReadiness = {
    ready: false,
    blockers: [{ id: "s1", source: "safety", message: "Acid + hypochlorite." }],
    warnings: [],
  };
  const READY: ApprovalReadiness = { ready: true, blockers: [], warnings: [] };

  it("blocks a human approver when readiness says not ready, even with an approval record", () => {
    const r = canTransitionWithReadiness("pilot_candidate", "pilot_approved", CHEMIST, NOT_READY, {
      hasApprovalRecord: true,
    });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("NOT_READY_FOR_APPROVAL");
  });

  it("allows a human approver through once readiness is clear", () => {
    const r = canTransitionWithReadiness("pilot_candidate", "pilot_approved", CHEMIST, READY, {
      hasApprovalRecord: true,
    });
    expect(r.allowed).toBe(true);
  });

  it("still refuses an agent regardless of readiness (actor gate runs first)", () => {
    const r = canTransitionWithReadiness("pilot_candidate", "pilot_approved", AGENT, READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("APPROVAL_REQUIRES_HUMAN");
  });

  it("still refuses a system actor regardless of readiness", () => {
    const r = canTransitionWithReadiness("pilot_candidate", "pilot_approved", SYSTEM, READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("APPROVAL_REQUIRES_HUMAN");
  });

  it("still refuses an import actor regardless of readiness", () => {
    const r = canTransitionWithReadiness("pilot_candidate", "pilot_approved", IMPORT, READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("APPROVAL_REQUIRES_HUMAN");
  });

  it("readiness has no effect on non-approval transitions", () => {
    const r = canTransitionWithReadiness("concept", "chemist_review", AGENT, NOT_READY);
    expect(r.allowed).toBe(true);
  });

  it("production approval is also gated by readiness", () => {
    const r = canTransitionWithReadiness("pilot_approved", "production_approved", QUALITY, NOT_READY, {
      hasApprovalRecord: true,
    });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("NOT_READY_FOR_APPROVAL");
  });
});

describe("assessApprovalReadiness — laboratory readiness (spec §16)", () => {
  it("is unaffected when labReadiness is omitted", () => {
    const r = assessApprovalReadiness({ validationFindings: [], compatibilityFindings: [], safetyFindings: [] });
    expect(r.ready).toBe(true);
  });

  it("blocks on missing_required_trial when configured and no trial is complete", () => {
    const r = assessApprovalReadiness({
      validationFindings: [], compatibilityFindings: [], safetyFindings: [],
      labReadiness: {
        policy: { requireCompletedTrial: true },
        hasCompletedTrial: false, allRequiredTestsCompleted: true, allCriticalTestsPassed: true,
        hasUnresolvedCriticalDeviation: false, hasUnresolvedCriticalCorrectiveAction: false,
      },
    });
    expect(r.ready).toBe(false);
    expect(r.blockers[0].code).toBe("missing_required_trial");
  });

  it("blocks on critical_test_failed", () => {
    const r = assessApprovalReadiness({
      validationFindings: [], compatibilityFindings: [], safetyFindings: [],
      labReadiness: {
        policy: { requireAllCriticalTestsPassed: true },
        hasCompletedTrial: true, allRequiredTestsCompleted: true, allCriticalTestsPassed: false,
        hasUnresolvedCriticalDeviation: false, hasUnresolvedCriticalCorrectiveAction: false,
      },
    });
    expect(r.blockers.map((b) => b.code)).toContain("critical_test_failed");
  });

  it("blocks on critical_deviation_open", () => {
    const r = assessApprovalReadiness({
      validationFindings: [], compatibilityFindings: [], safetyFindings: [],
      labReadiness: {
        policy: { requireNoUnresolvedCriticalDeviation: true },
        hasCompletedTrial: true, allRequiredTestsCompleted: true, allCriticalTestsPassed: true,
        hasUnresolvedCriticalDeviation: true, hasUnresolvedCriticalCorrectiveAction: false,
      },
    });
    expect(r.blockers.map((b) => b.code)).toContain("critical_deviation_open");
  });

  it("is ready once every configured lab requirement is satisfied", () => {
    const r = assessApprovalReadiness({
      validationFindings: [], compatibilityFindings: [], safetyFindings: [],
      labReadiness: {
        policy: { requireCompletedTrial: true, requireAllCriticalTestsPassed: true, requireNoUnresolvedCriticalDeviation: true },
        hasCompletedTrial: true, allRequiredTestsCompleted: true, allCriticalTestsPassed: true,
        hasUnresolvedCriticalDeviation: false, hasUnresolvedCriticalCorrectiveAction: false,
      },
    });
    expect(r.ready).toBe(true);
  });
});

describe("assessApprovalReadiness — stability readiness (spec §16)", () => {
  it("is unaffected when stabilityReadiness is omitted", () => {
    const r = assessApprovalReadiness({ validationFindings: [], compatibilityFindings: [], safetyFindings: [] });
    expect(r.ready).toBe(true);
  });

  it("blocks on stability_study_missing", () => {
    const r = assessApprovalReadiness({
      validationFindings: [], compatibilityFindings: [], safetyFindings: [],
      stabilityReadiness: {
        policy: { requireActiveStudy: true },
        hasActiveOrCompletedStudy: false, initialTestsPassed: true, completedTimePointCount: 0,
        hasUnresolvedCriticalFailure: false, packagingCompatibilityPassed: true,
      },
    });
    expect(r.blockers[0].code).toBe("stability_study_missing");
  });

  it("blocks on required_time_point_missing using the organization's own configured count, never a hardcoded 3/6/12 months", () => {
    const r = assessApprovalReadiness({
      validationFindings: [], compatibilityFindings: [], safetyFindings: [],
      stabilityReadiness: {
        policy: { minimumRequiredTimePoints: 5 },
        hasActiveOrCompletedStudy: true, initialTestsPassed: true, completedTimePointCount: 2,
        hasUnresolvedCriticalFailure: false, packagingCompatibilityPassed: true,
      },
    });
    expect(r.blockers[0].code).toBe("required_time_point_missing");
    expect(r.blockers[0].message).toContain("5");
  });

  it("blocks on stability_failure_open", () => {
    const r = assessApprovalReadiness({
      validationFindings: [], compatibilityFindings: [], safetyFindings: [],
      stabilityReadiness: {
        policy: { requireNoUnresolvedCriticalFailure: true },
        hasActiveOrCompletedStudy: true, initialTestsPassed: true, completedTimePointCount: 0,
        hasUnresolvedCriticalFailure: true, packagingCompatibilityPassed: true,
      },
    });
    expect(r.blockers.map((b) => b.code)).toContain("stability_failure_open");
  });

  it("blocks on packaging_test_failed", () => {
    const r = assessApprovalReadiness({
      validationFindings: [], compatibilityFindings: [], safetyFindings: [],
      stabilityReadiness: {
        policy: { requirePackagingCompatibilityPassed: true },
        hasActiveOrCompletedStudy: true, initialTestsPassed: true, completedTimePointCount: 0,
        hasUnresolvedCriticalFailure: false, packagingCompatibilityPassed: false,
      },
    });
    expect(r.blockers.map((b) => b.code)).toContain("packaging_test_failed");
  });

  it("human resolution (caller flips hasUnresolvedCriticalFailure to false) removes the blocker", () => {
    const blocked = assessApprovalReadiness({
      validationFindings: [], compatibilityFindings: [], safetyFindings: [],
      stabilityReadiness: {
        policy: { requireNoUnresolvedCriticalFailure: true },
        hasActiveOrCompletedStudy: true, initialTestsPassed: true, completedTimePointCount: 0,
        hasUnresolvedCriticalFailure: true, packagingCompatibilityPassed: true,
      },
    });
    expect(blocked.ready).toBe(false);
    const resolved = assessApprovalReadiness({
      validationFindings: [], compatibilityFindings: [], safetyFindings: [],
      stabilityReadiness: {
        policy: { requireNoUnresolvedCriticalFailure: true },
        hasActiveOrCompletedStudy: true, initialTestsPassed: true, completedTimePointCount: 0,
        hasUnresolvedCriticalFailure: false, packagingCompatibilityPassed: true,
      },
    });
    expect(resolved.ready).toBe(true);
  });
});

describe("assessApprovalReadiness — lab/stability bypass attempts", () => {
  const BLOCKED_BY_LAB: ApprovalReadiness = {
    ready: false,
    blockers: [{ id: "lab:missing_required_trial", source: "laboratory", code: "missing_required_trial", message: "No completed trial." }],
    warnings: [],
  };

  it("an agent event cannot bypass a laboratory blocker", () => {
    const r = canTransitionWithReadiness("pilot_candidate", "pilot_approved", AGENT, BLOCKED_BY_LAB, { hasApprovalRecord: true });
    expect(r.allowed).toBe(false);
  });

  it("an import actor cannot bypass a laboratory blocker", () => {
    const r = canTransitionWithReadiness("pilot_candidate", "pilot_approved", IMPORT, BLOCKED_BY_LAB, { hasApprovalRecord: true });
    expect(r.allowed).toBe(false);
  });

  it("a human is still blocked until the underlying lab state actually changes", () => {
    const r = canTransitionWithReadiness("pilot_candidate", "pilot_approved", CHEMIST, BLOCKED_BY_LAB, { hasApprovalRecord: true });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("NOT_READY_FOR_APPROVAL");
  });
});
