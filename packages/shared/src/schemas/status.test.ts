import { describe, expect, it } from "vitest";
import { canTransitionTo, type Actor } from "./status";

const AGENT: Actor = { kind: "agent", runId: "run-1" };
const SYSTEM: Actor = { kind: "system", reason: "import" };
const CHEMIST: Actor = { kind: "human", role: "chemist", userId: "u1" };
const QUALITY: Actor = { kind: "human", role: "quality", userId: "u2" };
const RESEARCHER: Actor = { kind: "human", role: "researcher", userId: "u3" };

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
    const res = canTransitionTo("pilot_candidate", "pilot_approved", CHEMIST);
    expect(res.allowed).toBe(false);
    expect(res.code).toBe("APPROVAL_RECORD_REQUIRED");
  });

  it("checks the role can grant that specific approval", () => {
    // A researcher may not sign off a pilot.
    const res = canTransitionTo("pilot_candidate", "pilot_approved", RESEARCHER, {
      hasApprovalRecord: true,
    });
    expect(res.allowed).toBe(false);
    expect(res.code).toBe("ROLE_NOT_AUTHORIZED");

    // A chemist may.
    expect(
      canTransitionTo("pilot_candidate", "pilot_approved", CHEMIST, {
        hasApprovalRecord: true,
      }).allowed,
    ).toBe(true);
  });

  it("allows production approval only from pilot_approved, by an authorised role", () => {
    expect(
      canTransitionTo("pilot_approved", "production_approved", QUALITY, {
        hasApprovalRecord: true,
      }).allowed,
    ).toBe(true);

    // Cannot leap from a lab candidate straight to production.
    const leap = canTransitionTo("lab_candidate", "production_approved", QUALITY, {
      hasApprovalRecord: true,
    });
    expect(leap.allowed).toBe(false);
    expect(leap.code).toBe("NOT_A_VALID_TRANSITION");
  });

  it("treats a production-approved formula as terminal except for retirement", () => {
    expect(canTransitionTo("production_approved", "retired", QUALITY, {
      hasApprovalRecord: true,
    }).allowed).toBe(true);
    expect(
      canTransitionTo("production_approved", "concept", CHEMIST).allowed,
    ).toBe(false);
  });
});
