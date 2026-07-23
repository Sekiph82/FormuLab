import { describe, expect, it } from "vitest";
import {
  clonePolicy,
  editPolicy,
  initialPolicyRevision,
  restorePolicyRevision,
  retirePolicy,
  setPolicyActive,
} from "./approvalPolicy";
import type { Actor } from "../schemas/status";
import type { ApprovalPolicy } from "../schemas/approvalPolicy";

const HUMAN: Actor = { kind: "human", role: "quality", userId: "alice" };
const AGENT: Actor = { kind: "agent", runId: "run-1" };

function policy(over: Partial<ApprovalPolicy> = {}): ApprovalPolicy {
  return {
    schemaVersion: "1.0",
    id: "policy-1",
    name: "Pilot lab gate",
    productFamilyCodes: [],
    packagingSkuCodes: [],
    targetStatus: "pilot_approved",
    verificationStatus: "not_verified",
    active: false,
    retired: false,
    revisionNumber: 1,
    requireCompletedTrial: true,
    requireAllRequiredTestsCompleted: false,
    requireAllCriticalTestsPassed: false,
    requireNoUnresolvedCriticalDeviation: false,
    requireNoUnresolvedCriticalCorrectiveAction: false,
    requireActiveStudy: false,
    requireInitialTestsPassed: false,
    requireNoUnresolvedCriticalFailure: false,
    requirePackagingCompatibilityPassed: false,
    requireCostSnapshot: false,
    createdBy: "alice",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("initialPolicyRevision", () => {
  it("records a created revision", () => {
    const rev = initialPolicyRevision(policy(), HUMAN);
    expect(rev.changeType).toBe("created");
    expect(rev.revisionNumber).toBe(1);
    expect(rev.policyId).toBe("policy-1");
  });

  it("refuses a non-human actor", () => {
    expect(() => initialPolicyRevision(policy(), AGENT)).toThrow();
  });
});

describe("editPolicy", () => {
  it("bumps the revision number and records the change reason", () => {
    const { policy: updated, revision } = editPolicy(policy(), { requireAllCriticalTestsPassed: true }, HUMAN, "Tightening the gate.");
    expect(updated.requireAllCriticalTestsPassed).toBe(true);
    expect(updated.revisionNumber).toBe(2);
    expect(revision.changeType).toBe("edited");
    expect(revision.changeReason).toBe("Tightening the gate.");
    expect(revision.snapshot).toEqual(updated);
  });

  it("requires a non-empty reason", () => {
    expect(() => editPolicy(policy(), { name: "New name" }, HUMAN, "  ")).toThrow();
  });

  it("refuses a non-human actor", () => {
    expect(() => editPolicy(policy(), { name: "New name" }, AGENT, "reason")).toThrow();
  });

  it("refuses to edit a retired policy", () => {
    expect(() => editPolicy(policy({ retired: true }), { name: "New name" }, HUMAN, "reason")).toThrow();
  });

  it("never mutates the original policy object", () => {
    const original = policy();
    editPolicy(original, { requireCostSnapshot: true }, HUMAN, "reason");
    expect(original.requireCostSnapshot).toBe(false);
    expect(original.revisionNumber).toBe(1);
  });
});

describe("setPolicyActive", () => {
  it("activates and records the revision", () => {
    const { policy: updated, revision } = setPolicyActive(policy(), true, HUMAN);
    expect(updated.active).toBe(true);
    expect(revision.changeType).toBe("activated");
  });

  it("deactivates and records the revision", () => {
    const { policy: updated, revision } = setPolicyActive(policy({ active: true }), false, HUMAN);
    expect(updated.active).toBe(false);
    expect(revision.changeType).toBe("deactivated");
  });

  it("refuses to reactivate a retired policy", () => {
    expect(() => setPolicyActive(policy({ retired: true }), true, HUMAN)).toThrow();
  });

  it("refuses a non-human actor", () => {
    expect(() => setPolicyActive(policy(), true, AGENT)).toThrow();
  });
});

describe("retirePolicy", () => {
  it("sets retired and deactivates, and cannot be undone by activation", () => {
    const { policy: retired } = retirePolicy(policy({ active: true }), HUMAN, "No longer needed.");
    expect(retired.retired).toBe(true);
    expect(retired.active).toBe(false);
    expect(() => setPolicyActive(retired, true, HUMAN)).toThrow();
  });

  it("requires a reason", () => {
    expect(() => retirePolicy(policy(), HUMAN, "")).toThrow();
  });

  it("refuses a non-human actor", () => {
    expect(() => retirePolicy(policy(), AGENT, "reason")).toThrow();
  });
});

describe("clonePolicy", () => {
  it("creates an independent, inactive policy with its own revision history", () => {
    const source = policy({ active: true, revisionNumber: 5 });
    const { policy: cloned, revision } = clonePolicy(source, HUMAN, "Pilot lab gate (EAC)");
    expect(cloned.id).not.toBe(source.id);
    expect(cloned.active).toBe(false);
    expect(cloned.revisionNumber).toBe(1);
    expect(cloned.name).toBe("Pilot lab gate (EAC)");
    expect(revision.changeType).toBe("cloned_from");
    expect(revision.clonedFromPolicyId).toBe(source.id);
  });

  it("refuses a non-human actor", () => {
    expect(() => clonePolicy(policy(), AGENT, "copy")).toThrow();
  });
});

describe("restorePolicyRevision", () => {
  it("applies an old revision's fields as a NEW revision, never rewriting history", () => {
    const v1 = policy();
    const rev1 = initialPolicyRevision(v1, HUMAN);
    const { policy: v2 } = editPolicy(v1, { requireCompletedTrial: false }, HUMAN, "Loosened.");
    const { policy: v3, revision: rev3 } = restorePolicyRevision(v2, rev1, HUMAN);
    // Restoring revision 1 brings the field back to what it said...
    expect(v3.requireCompletedTrial).toBe(true);
    // ...but as a brand new revision on top, not a rewrite of revision 1 or 2.
    expect(v3.revisionNumber).toBe(3);
    expect(rev3.changeType).toBe("restored");
    expect(rev3.restoredFromRevisionId).toBe(rev1.id);
  });

  it("refuses a revision that belongs to a different policy", () => {
    const other = initialPolicyRevision(policy({ id: "policy-2" }), HUMAN);
    expect(() => restorePolicyRevision(policy(), other, HUMAN)).toThrow();
  });

  it("refuses a non-human actor", () => {
    const rev = initialPolicyRevision(policy(), HUMAN);
    expect(() => restorePolicyRevision(policy(), rev, AGENT)).toThrow();
  });
});
