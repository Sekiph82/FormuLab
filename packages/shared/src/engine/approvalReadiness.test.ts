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

  it("is ready when the applied substitution run's stored status is candidates_found", () => {
    const r = assessApprovalReadiness({
      validationFindings: [],
      compatibilityFindings: [],
      safetyFindings: [],
      appliedSubstitutionRun: { code: "sub-1", status: "candidates_found" },
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
