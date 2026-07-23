import { describe, expect, it } from "vitest";
import { declareEquivalence, revokeEquivalence } from "./equivalence";
import { activeEquivalencesFor, equivalentVersionIdsFor, isEquivalenceRevoked } from "../schemas/equivalence";
import type { Actor } from "../schemas/status";

const HUMAN: Actor = { kind: "human", role: "quality", userId: "alice" };
const AGENT: Actor = { kind: "agent", runId: "run-1" };
const SYSTEM: Actor = { kind: "system", reason: "migration" };
const IMPORT: Actor = { kind: "import", source: "legacy.xlsx" };

const INPUT = {
  formulationId: "proj-1",
  sourceVersionId: "version-2",
  equivalentVersionId: "version-1",
  evidenceReuseScope: "laboratory_and_stability" as const,
  justification: "Same core surfactant system, only the fragrance changed.",
};

describe("declareEquivalence", () => {
  it("a human can declare an equivalence", () => {
    const eq = declareEquivalence(INPUT, HUMAN);
    expect(eq.sourceVersionId).toBe("version-2");
    expect(eq.equivalentVersionId).toBe("version-1");
    expect(eq.declaredBy).toBe("alice");
  });

  it("an agent cannot declare an equivalence", () => {
    expect(() => declareEquivalence(INPUT, AGENT)).toThrow();
  });

  it("a system actor cannot declare an equivalence", () => {
    expect(() => declareEquivalence(INPUT, SYSTEM)).toThrow();
  });

  it("an import actor cannot declare an equivalence", () => {
    expect(() => declareEquivalence(INPUT, IMPORT)).toThrow();
  });

  it("requires a justification", () => {
    expect(() => declareEquivalence({ ...INPUT, justification: "  " }, HUMAN)).toThrow();
  });

  it("refuses a version declared equivalent to itself", () => {
    expect(() => declareEquivalence({ ...INPUT, equivalentVersionId: INPUT.sourceVersionId }, HUMAN)).toThrow();
  });
});

describe("revokeEquivalence", () => {
  it("a human can revoke — the revocation is a new record, not a mutation", () => {
    const eq = declareEquivalence(INPUT, HUMAN);
    const revocation = revokeEquivalence(eq, HUMAN, "Formula lines diverged after all.");
    expect(revocation.id).not.toBe(eq.id);
    expect(revocation.revokesEquivalenceId).toBe(eq.id);
    // The original record's own fields are untouched.
    expect(eq.revokesEquivalenceId).toBeUndefined();
  });

  it("an agent cannot revoke", () => {
    const eq = declareEquivalence(INPUT, HUMAN);
    expect(() => revokeEquivalence(eq, AGENT, "reason")).toThrow();
  });

  it("requires a reason", () => {
    const eq = declareEquivalence(INPUT, HUMAN);
    expect(() => revokeEquivalence(eq, HUMAN, "")).toThrow();
  });

  it("a revocation record cannot itself be revoked", () => {
    const eq = declareEquivalence(INPUT, HUMAN);
    const revocation = revokeEquivalence(eq, HUMAN, "reason");
    expect(() => revokeEquivalence(revocation, HUMAN, "reason 2")).toThrow();
  });
});

describe("activeEquivalencesFor / isEquivalenceRevoked / equivalentVersionIdsFor", () => {
  it("an unrevoked declaration is active", () => {
    const eq = declareEquivalence(INPUT, HUMAN);
    expect(activeEquivalencesFor("version-2", [eq])).toEqual([eq]);
    expect(isEquivalenceRevoked(eq.id, [eq])).toBe(false);
  });

  it("a revoked declaration is no longer active", () => {
    const eq = declareEquivalence(INPUT, HUMAN);
    const revocation = revokeEquivalence(eq, HUMAN, "reason");
    const all = [eq, revocation];
    expect(activeEquivalencesFor("version-2", all)).toEqual([]);
    expect(isEquivalenceRevoked(eq.id, all)).toBe(true);
  });

  it("equivalentVersionIdsFor respects the declared evidence-reuse scope", () => {
    const labOnly = declareEquivalence({ ...INPUT, equivalentVersionId: "version-lab", evidenceReuseScope: "laboratory_only" }, HUMAN);
    const stabilityOnly = declareEquivalence({ ...INPUT, equivalentVersionId: "version-stability", evidenceReuseScope: "stability_only" }, HUMAN);
    const both = declareEquivalence({ ...INPUT, equivalentVersionId: "version-both", evidenceReuseScope: "laboratory_and_stability" }, HUMAN);
    const all = [labOnly, stabilityOnly, both];

    expect(equivalentVersionIdsFor("version-2", "laboratory", all).sort()).toEqual(["version-both", "version-lab"]);
    expect(equivalentVersionIdsFor("version-2", "stability", all).sort()).toEqual(["version-both", "version-stability"]);
  });

  it("a revoked equivalence contributes no evidence to either scope", () => {
    const eq = declareEquivalence(INPUT, HUMAN);
    const revocation = revokeEquivalence(eq, HUMAN, "reason");
    const all = [eq, revocation];
    expect(equivalentVersionIdsFor("version-2", "laboratory", all)).toEqual([]);
    expect(equivalentVersionIdsFor("version-2", "stability", all)).toEqual([]);
  });
});
