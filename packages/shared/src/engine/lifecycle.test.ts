import { describe, expect, it } from "vitest";
import { attemptApprovalTransition, attemptLifecycleTransition, attemptStageAdvance, effectiveStatus, STAGE_ADVANCE_NEXT, type StageAdvanceStatus } from "./lifecycle";
import type { ApprovalReadiness } from "./approvalReadiness";
import type { Actor } from "../schemas/status";
import type { AuditEvent, FormulationVersion } from "../schemas/formulation";

const RESEARCH_MANAGER: Actor = { kind: "human", role: "research_manager", userId: "u1" };
const QUALITY_MANAGER: Actor = { kind: "human", role: "quality_manager", userId: "u2" };
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
    const r = attemptLifecycleTransition("pilot_approved", "retired", RESEARCH_MANAGER);
    expect(r.allowed).toBe(true);
    expect(r.action).toBe("version.retired");
  });

  it("allows a human to reject a candidate version", () => {
    const r = attemptLifecycleTransition("chemist_review", "rejected", RESEARCH_MANAGER);
    expect(r.allowed).toBe(true);
    expect(r.action).toBe("version.rejected");
  });

  it("allows a human to reopen a rejected version back to concept", () => {
    const r = attemptLifecycleTransition("rejected", "concept", RESEARCH_MANAGER);
    expect(r.allowed).toBe(true);
    expect(r.action).toBe("version.reopened");
  });

  it("refuses an invalid transition (production_approved cannot reject)", () => {
    const r = attemptLifecycleTransition("production_approved", "rejected", RESEARCH_MANAGER);
    expect(r.allowed).toBe(false);
  });

  it("refuses reopening a version that is not rejected", () => {
    const r = attemptLifecycleTransition("concept", "concept", RESEARCH_MANAGER);
    expect(r.allowed).toBe(false);
  });

  it("still evaluates the same for an agent actor (retire/reject are not human-only in the status graph)", () => {
    const r = attemptLifecycleTransition("pilot_approved", "retired", AGENT);
    expect(r.allowed).toBe(true);
  });
});

describe("attemptApprovalTransition", () => {
  it("grants pilot_approved to an authorized, ready human with an approval record", () => {
    const r = attemptApprovalTransition("pilot_candidate", "pilot_approved", RESEARCH_MANAGER, READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(true);
    expect(r.action).toBe("version.approved.pilot_approved");
  });

  it("grants production_approved to an authorized, ready human with an approval record", () => {
    const r = attemptApprovalTransition("pilot_approved", "production_approved", QUALITY_MANAGER, READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(true);
    expect(r.action).toBe("version.approved.production_approved");
  });

  it("blocks when readiness is not ready, even for an authorized human with a record", () => {
    const r = attemptApprovalTransition("pilot_candidate", "pilot_approved", RESEARCH_MANAGER, NOT_READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("NOT_READY_FOR_APPROVAL");
  });

  it("blocks a role not authorized for the target status, even when ready", () => {
    const r = attemptApprovalTransition("pilot_candidate", "pilot_approved", RESEARCHER, READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("ROLE_NOT_AUTHORIZED");
  });

  it("blocks without an approval record even when ready and authorized", () => {
    const r = attemptApprovalTransition("pilot_candidate", "pilot_approved", RESEARCH_MANAGER, READY, { hasApprovalRecord: false });
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
    const r = attemptApprovalTransition("concept", "production_approved", QUALITY_MANAGER, READY, { hasApprovalRecord: true });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("NOT_A_VALID_TRANSITION");
  });
});

describe("attemptStageAdvance", () => {
  it("walks the full canonical pipeline from concept to pilot_candidate, one hop at a time", () => {
    let status: FormulationVersion["status"] = "concept";
    const path: string[] = [status];
    for (let i = 0; i < 10; i++) {
      const next: StageAdvanceStatus | undefined = STAGE_ADVANCE_NEXT[status];
      if (!next) break;
      const r = attemptStageAdvance(status, next, RESEARCH_MANAGER);
      expect(r.allowed).toBe(true);
      expect(r.action).toBe(`version.advanced.${next}`);
      status = next;
      path.push(status);
    }
    expect(path).toEqual(["concept", "chemist_review", "lab_candidate", "stability_testing", "pilot_candidate"]);
    expect(STAGE_ADVANCE_NEXT["pilot_candidate"]).toBeUndefined();
  });

  it("refuses skipping a stage (concept cannot advance straight to lab_candidate)", () => {
    const r = attemptStageAdvance("concept", "lab_candidate", RESEARCH_MANAGER);
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("NOT_A_VALID_TRANSITION");
  });

  it("refuses advancing a retired/rejected/approved version", () => {
    expect(attemptStageAdvance("retired", "chemist_review", RESEARCH_MANAGER).allowed).toBe(false);
    expect(attemptStageAdvance("rejected", "chemist_review", RESEARCH_MANAGER).allowed).toBe(false);
    expect(attemptStageAdvance("pilot_approved", "chemist_review", RESEARCH_MANAGER).allowed).toBe(false);
  });

  it("allows an agent or system actor to advance a stage — none of these are HUMAN_ONLY_STATUSES", () => {
    expect(attemptStageAdvance("concept", "chemist_review", AGENT).allowed).toBe(true);
    expect(attemptStageAdvance("concept", "chemist_review", SYSTEM).allowed).toBe(true);
  });

  it("effectiveStatus reflects a stage-advance event", () => {
    const events = [event("version.advanced.chemist_review", "2026-02-01T00:00:00.000Z")];
    expect(effectiveStatus(version("concept"), events)).toBe("chemist_review");
  });

  it("effectiveStatus reflects the latest of several stage-advance events, not the first", () => {
    const events = [
      event("version.advanced.chemist_review", "2026-02-01T00:00:00.000Z"),
      event("version.advanced.lab_candidate", "2026-02-02T00:00:00.000Z"),
      event("version.advanced.stability_testing", "2026-02-03T00:00:00.000Z"),
    ];
    expect(effectiveStatus(version("concept"), events)).toBe("stability_testing");
  });

  it("effectiveStatus reflects a stage-advance chain followed by pilot approval", () => {
    const events = [
      event("version.advanced.chemist_review", "2026-02-01T00:00:00.000Z"),
      event("version.advanced.lab_candidate", "2026-02-02T00:00:00.000Z"),
      event("version.advanced.stability_testing", "2026-02-03T00:00:00.000Z"),
      event("version.advanced.pilot_candidate", "2026-02-04T00:00:00.000Z"),
      event("version.approved.pilot_approved", "2026-02-05T00:00:00.000Z"),
    ];
    expect(effectiveStatus(version("concept"), events)).toBe("pilot_approved");
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
