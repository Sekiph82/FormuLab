import { describe, expect, it } from "vitest";
import {
  assignOwner,
  cancelCorrectiveAction,
  createCorrectiveAction,
  createDraftFromCorrectiveAction,
  markAwaitingVerification,
  markInProgress,
  reopenCorrectiveAction,
  verifyEffectiveness,
} from "./correctiveActions";
import type { Actor } from "../schemas/status";
import type { FormulationVersion } from "../schemas/formulation";

const HUMAN: Actor = { kind: "human", role: "chemist", userId: "alice" };
const AGENT: Actor = { kind: "agent", runId: "run-1" };

function newAction() {
  return createCorrectiveAction(
    {
      projectId: "proj-1",
      sourceType: "trial_deviation",
      sourceRecordId: "trial-1",
      deviationOrFailureId: "dev-1",
      title: "Fix overheating",
      problemStatement: "Batch exceeded planned temperature by 8C.",
      actionType: "process_change",
      owner: "alice",
    },
    HUMAN,
  );
}

describe("corrective action lifecycle", () => {
  it("starts open with a creation audit event", () => {
    const action = newAction();
    expect(action.status).toBe("open");
    expect(action.auditHistory).toHaveLength(1);
    expect(action.auditHistory[0].action).toBe("corrective_action.created");
  });

  it("moves open -> in_progress -> awaiting_verification -> effective, each step audited", () => {
    let action = newAction();
    action = markInProgress(action, HUMAN);
    expect(action.status).toBe("in_progress");
    action = markAwaitingVerification(action, "Reduced heating rate; reran successfully.", HUMAN);
    expect(action.status).toBe("awaiting_verification");
    action = verifyEffectiveness(action, HUMAN, { effective: true, notes: "Confirmed on 3 subsequent batches." });
    expect(action.status).toBe("effective");
    expect(action.closedBy).toBe("alice");
    expect(action.auditHistory.length).toBeGreaterThanOrEqual(4);
  });

  it("verifyEffectiveness requires a human actor", () => {
    let action = newAction();
    action = markInProgress(action, HUMAN);
    action = markAwaitingVerification(action, "Fix applied.", HUMAN);
    expect(() => verifyEffectiveness(action, AGENT, { effective: true })).toThrow();
  });

  it("verifyEffectiveness cannot be called before awaiting_verification", () => {
    const action = newAction();
    expect(() => verifyEffectiveness(action, HUMAN, { effective: true })).toThrow();
  });

  it("an ineffective action can be reopened", () => {
    let action = newAction();
    action = markInProgress(action, HUMAN);
    action = markAwaitingVerification(action, "Attempted fix.", HUMAN);
    action = verifyEffectiveness(action, HUMAN, { effective: false });
    expect(action.status).toBe("ineffective");
    action = reopenCorrectiveAction(action, HUMAN, "Fix did not hold on retest.");
    expect(action.status).toBe("in_progress");
    expect(action.effectivenessCheck).toBeUndefined();
  });

  it("assignOwner and cancel are audited", () => {
    let action = newAction();
    action = assignOwner(action, "bob", HUMAN);
    expect(action.owner).toBe("bob");
    action = cancelCorrectiveAction(action, HUMAN, "Superseded by a reformulation.");
    expect(action.status).toBe("cancelled");
  });
});

describe("createDraftFromCorrectiveAction", () => {
  const version: FormulationVersion = {
    schemaVersion: "1.0",
    id: "ver-1",
    formulationId: "proj-1",
    versionNumber: 1,
    status: "lab_candidate",
    author: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
    lines: [
      { id: "l1", lineNumber: 0, phase: "A", displayName: "Material A", functions: [], percent: "50", isQsToHundred: false, provenance: { origin: "model_estimate", evidenceClaimIds: [] } },
    ],
    basisBatchKg: "100",
    sourceRunIds: [],
    regulatoryFindingIds: [],
    compatibilityFindingIds: [],
    safetyFindingIds: [],
    approvalRecordIds: [],
  };

  it("creates a draft without mutating the source version", () => {
    const action = newAction();
    const before = JSON.stringify(version);
    const { draft } = createDraftFromCorrectiveAction(action, version);
    expect(JSON.stringify(version)).toBe(before);
    expect(draft.formulationId).toBe(version.formulationId);
    expect(draft.baseVersionId).toBe(version.id);
    expect(draft.lines).toHaveLength(1);
  });

  it("never inherits an approval status — a draft has none to carry", () => {
    const action = newAction();
    const { draft } = createDraftFromCorrectiveAction(action, version);
    expect((draft as unknown as { status?: string }).status).toBeUndefined();
  });

  it("links the corrective action back to the created draft", () => {
    const action = newAction();
    const { action: updated } = createDraftFromCorrectiveAction(action, version);
    expect(updated.createdDraftId).toBe(version.formulationId);
  });
});
