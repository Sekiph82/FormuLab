import { describe, expect, it } from "vitest";
import { attemptLifecycleTransition, effectiveStatus } from "./lifecycle";
import type { Actor } from "../schemas/status";
import type { AuditEvent, FormulationVersion } from "../schemas/formulation";

const CHEMIST: Actor = { kind: "human", role: "chemist", userId: "u1" };
const AGENT: Actor = { kind: "agent", runId: "run-1" };

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
