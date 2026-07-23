import { describe, expect, it } from "vitest";
import { attemptApprovalTransition, attemptLifecycleTransition, effectiveStatus } from "./lifecycle";
import type { ApprovalReadiness } from "./approvalReadiness";
import type { Actor } from "../schemas/status";
import type { AuditEvent, FormulationVersion } from "../schemas/formulation";

const CHEMIST: Actor = { kind: "human", role: "chemist", userId: "u1" };
const QUALITY: Actor = { kind: "human", role: "quality", userId: "u2" };
const RESEARCHER: Actor = { kind: "human", role: "researcher", userId: "u3" };
const AGENT: Actor = { kind: "agent", runId: "run-1" };
const SYSTEM: Actor = { kind: "system", reason: "migration" };
const IMPORT: Actor = { kind: "import", source: "legacy.xlsx" };

const READY: ApprovalReadiness = { ready: true, blockers: [], warnings: [] };
const NOT_READY: ApprovalReadiness = {
  ready: false,
  blockers: [{ id: "b1", source: "validation", message: "Total is not 100%." }],
  warnings: [],
};

function version(status: FormulationVersion["status"]): FormulationVersion {
  return {
    schemaVersion: "1.0",
    id: "v1",
    formulationId: "f1",
    versionNumber: 1,
    status,
    author: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    lines: [],
    basisBatchKg: "100",
    sourceRunIds: [],
    regulatoryFindingIds: [],
    compatibilityFindingIds: [],
    safetyFindingIds: [],
    approvalRecordIds: [],
  };
}

function event(action: string, at: string, versionId = "v1"): AuditEvent {
  return { id: `e-${at}`, formulationId: "f1", versionId, at, actor: "chemist", actorKind: "human", action };
}

describe("effectiveStatus", () => {
  it("is the saved status when no lifecycle event exists", () => {
    expect(effectiveStatus(version("pilot_approved"), [])).toBe("pilot_approved");
  });

  it("reflects a retire event", () => {
    const events = [event("version.saved", "2026-01-01T00:00:00.000Z"), event("version.retired", "2026-02-01T00:00:00.000Z")];
    expect(effectiveStatus(version("pilot_approved"), events)).toBe("retired");
  });

  it("reflects the latest of several lifecycle events, not the first", () => {
    const events = [
      event("version.rejected", "2026-01-01T00:00:00.000Z"),
      event("version.reopened", "2026-02-01T00:00:00.000Z"),
    ];
    expect(effectiveStatus(version("concept"), events)).toBe("concept");
  });

  it("ignores events for a different version id", () => {
    const events = [event("version.retired", "2026-02-01T00:00:00.000Z", "other-version")];
    expect(effectiveStatus(version("pilot_approved"), events)).toBe("pilot_approved");
  });
});

describe("attemptLifecycleTransition", () => {
  it("allows a human to retire an approved version", () => {
    const r = attemptLifecycleTransition("pilot_approved", "retired", CHEMIST);
    expect(r.allowed).toBe(true);
    expect(r.action).toBe("version.retired");
  });

  it("allows a human to reject a candidate version", () => {
    const r = attemptLifecycleTransition("chemist_review", "rejected", CHEMIST);
    expect(r.allowed).toBe(true);
    expect(r.action).toBe("version.rejected");
  });

  it("allows a human to reopen a rejected version back to concept", () => {
    const r = attemptLifecycleTransition("rejected", "concept", CHEMIST);
    expect(r.allowed).toBe(true);
    expect(r.action).toBe("version.reopened");
  });

  it("refuses an invalid transition (production_approved cannot reject)", () => {
    const r = attemptLifecycleTransition("production_approved", "rejected", CHEMIST);
    expect(r.allowed).toBe(false);
  });

  it("refuses reopening a version that is not rejected", () => {
    const r = attemptLifecycleTransition("concept", "concept", CHEMIST);
    expect(r.allowed).toBe(false);
  });

  it("still evaluates the same for an agent actor (retire/reject are not human-only in the status graph)", () => {
    const r = attemptLifecycleTransition("pilot_approved", "retired", AGENT);
    expect(r.allowed).toBe(true);
  });
});

describe("attemptApprovalTransition", () => {
  it("grants pilot_approved to an authorized, ready human with an approval record", () => {
    const r = attemptApprovalTransition("pilot_candidate", "pilot_approved", CHEMIST, READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(true);
    expect(r.action).toBe("version.approved.pilot_approved");
  });

  it("grants production_approved to an authorized, ready human with an approval record", () => {
    const r = attemptApprovalTransition("pilot_approved", "production_approved", QUALITY, READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(true);
    expect(r.action).toBe("version.approved.production_approved");
  });

  it("blocks when readiness is not ready, even for an authorized human with a record", () => {
    const r = attemptApprovalTransition("pilot_candidate", "pilot_approved", CHEMIST, NOT_READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("NOT_READY_FOR_APPROVAL");
  });

  it("blocks a role not authorized for the target status, even when ready", () => {
    const r = attemptApprovalTransition("pilot_candidate", "pilot_approved", RESEARCHER, READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("ROLE_NOT_AUTHORIZED");
  });

  it("blocks without an approval record even when ready and authorized", () => {
    const r = attemptApprovalTransition("pilot_candidate", "pilot_approved", CHEMIST, READY, { hasApprovalRecord: false });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("APPROVAL_RECORD_REQUIRED");
  });

  it("refuses an agent actor regardless of readiness", () => {
    const r = attemptApprovalTransition("pilot_candidate", "pilot_approved", AGENT, READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("APPROVAL_REQUIRES_HUMAN");
  });

  it("refuses a system actor regardless of readiness", () => {
    const r = attemptApprovalTransition("pilot_candidate", "pilot_approved", SYSTEM, READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("APPROVAL_REQUIRES_HUMAN");
  });

  it("refuses an import actor regardless of readiness", () => {
    const r = attemptApprovalTransition("pilot_candidate", "pilot_approved", IMPORT, READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("APPROVAL_REQUIRES_HUMAN");
  });

  it("rejects an invalid status graph edge before readiness is even considered", () => {
    const r = attemptApprovalTransition("concept", "production_approved", QUALITY, READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("NOT_A_VALID_TRANSITION");
  });
});

describe("effectiveStatus with an approval event", () => {
  it("reflects a granted pilot approval", () => {
    const events = [event("version.approved.pilot_approved", "2026-02-01T00:00:00.000Z")];
    expect(effectiveStatus(version("pilot_candidate"), events)).toBe("pilot_approved");
  });

  it("reflects the most recent of an approval followed by a retirement", () => {
    const events = [
      event("version.approved.pilot_approved", "2026-02-01T00:00:00.000Z"),
      event("version.retired", "2026-03-01T00:00:00.000Z"),
    ];
    expect(effectiveStatus(version("pilot_candidate"), events)).toBe("retired");
  });
});
