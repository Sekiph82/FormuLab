import { describe, expect, it } from "vitest";
import { canTransitionTo, type Actor } from "./status";

const AGENT: Actor = { kind: "agent", runId: "run-1" };
const SYSTEM: Actor = { kind: "system", reason: "import" };
const RESEARCHER: Actor = { kind: "human", role: "researcher", userId: "u1" };
const RESEARCH_MANAGER: Actor = { kind: "human", role: "research_manager", userId: "u1m" };
const QUALITY: Actor = { kind: "human", role: "quality", userId: "u2" };
const QUALITY_MANAGER: Actor = { kind: "human", role: "quality_manager", userId: "u2m" };
const PRODUCTION_MANAGER: Actor = { kind: "human", role: "production_manager", userId: "u4m" };
const ADMINISTRATOR: Actor = { kind: "human", role: "administrator", userId: "u5" };

describe("formula status transitions", () => {
  it("lets an agent move a draft along the research path", () => {
    expect(canTransitionTo("concept", "literature_candidate", AGENT).allowed).toBe(
      true,
    );
  });

  it("REFUSES to let an agent approve a formula for pilot or production", () => {
    // The load-bearing rule of the whole platform: a generated formulation is a
    // candidate. No model conclusion can make it an approved product.
    for (const target of ["pilot_approved", "production_approved"] as const) {
      const from = target === "pilot_approved" ? "pilot_candidate" : "pilot_approved";
      const res = canTransitionTo(from, target, AGENT, { hasApprovalRecord: true });
      expect(res.allowed).toBe(false);
      expect(res.code).toBe("APPROVAL_REQUIRES_HUMAN");
    }
  });

  it("refuses system/automation approval too", () => {
    const res = canTransitionTo("pilot_candidate", "pilot_approved", SYSTEM, {
      hasApprovalRecord: true,
    });
    expect(res.allowed).toBe(false);
    expect(res.code).toBe("APPROVAL_REQUIRES_HUMAN");
  });

  it("requires an approval record even for an authorised human", () => {
    const res = canTransitionTo("pilot_candidate", "pilot_approved", RESEARCH_MANAGER);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe("APPROVAL_RECORD_REQUIRED");
  });

  it("checks the role can grant that specific approval", () => {
    // A researcher may not sign off a pilot — that's their manager's gate.
    const res = canTransitionTo("pilot_candidate", "pilot_approved", RESEARCHER, {
      hasApprovalRecord: true,
    });
    expect(res.allowed).toBe(false);
    expect(res.code).toBe("ROLE_NOT_AUTHORIZED");

    // A research manager may.
    expect(
      canTransitionTo("pilot_candidate", "pilot_approved", RESEARCH_MANAGER, {
        hasApprovalRecord: true,
      }).allowed,
    ).toBe(true);
  });

  it("role-model regression: an employee-tier role never inherits its manager's approval authority", () => {
    // Phase 13 Session 1's central rule: completing your own work is not the
    // same as your manager approving it. Employee-tier roles must be refused
    // on both approval gates even with a valid approval record.
    for (const employee of [RESEARCHER, QUALITY]) {
      for (const [from, to] of [
        ["pilot_candidate", "pilot_approved"],
        ["pilot_approved", "production_approved"],
      ] as const) {
        const res = canTransitionTo(from, to, employee, { hasApprovalRecord: true });
        expect(res.allowed).toBe(false);
        expect(res.code).toBe("ROLE_NOT_AUTHORIZED");
      }
    }
  });

  it("allows production approval only from pilot_approved, by an authorised (manager-tier) role", () => {
    expect(
      canTransitionTo("pilot_approved", "production_approved", QUALITY_MANAGER, {
        hasApprovalRecord: true,
      }).allowed,
    ).toBe(true);
    expect(
      canTransitionTo("pilot_approved", "production_approved", PRODUCTION_MANAGER, {
        hasApprovalRecord: true,
      }).allowed,
    ).toBe(true);

    // Plain "quality" (employee tier) cannot grant it — only quality_manager can.
    expect(
      canTransitionTo("pilot_approved", "production_approved", QUALITY, {
        hasApprovalRecord: true,
      }).allowed,
    ).toBe(false);

    // Cannot leap from a lab candidate straight to production.
    const leap = canTransitionTo("lab_candidate", "production_approved", QUALITY_MANAGER, {
      hasApprovalRecord: true,
    });
    expect(leap.allowed).toBe(false);
    expect(leap.code).toBe("NOT_A_VALID_TRANSITION");
  });

  it("administrator retains approval authority on both gates (explicit, user-approved exception)", () => {
    expect(
      canTransitionTo("pilot_candidate", "pilot_approved", ADMINISTRATOR, {
        hasApprovalRecord: true,
      }).allowed,
    ).toBe(true);
    expect(
      canTransitionTo("pilot_approved", "production_approved", ADMINISTRATOR, {
        hasApprovalRecord: true,
      }).allowed,
    ).toBe(true);
  });

  it("treats a production-approved formula as terminal except for retirement", () => {
    expect(canTransitionTo("production_approved", "retired", QUALITY_MANAGER, {
      hasApprovalRecord: true,
    }).allowed).toBe(true);
    expect(
      canTransitionTo("production_approved", "concept", RESEARCH_MANAGER).allowed,
    ).toBe(false);
  });
});
