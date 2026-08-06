import { describe, expect, it } from "vitest";
import {
  acceptDeviationWithJustification,
  canTransitionTrial,
  compareTrials,
  computeActualFormulaPercent,
  computeBatchWeightVariance,
  computeMaterialUsageDeviation,
  computeProcessStepDeviation,
  evaluateWeightTolerance,
  hasOpenCriticalDeviation,
  resolveTrialDeviation,
  snapshotFormulaForTrial,
} from "./laboratory";
import type { Actor } from "../schemas/status";
import type { FormulationLine } from "../schemas/formulation";
import type { LaboratoryTrial, TrialDeviation, TrialMaterialUsage, TrialProcessStep } from "../schemas/laboratory";
import type { TestResult } from "../schemas/testDefinitions";

const HUMAN: Actor = { kind: "human", role: "chemist", userId: "alice" };
const AGENT: Actor = { kind: "agent", runId: "run-1" };

function line(over: Partial<FormulationLine> & { id: string; displayName: string; percent: string }): FormulationLine {
  return { lineNumber: 0, phase: "A", functions: [], isQsToHundred: false, provenance: { origin: "model_estimate", evidenceClaimIds: [] }, ...over };
}

describe("snapshotFormulaForTrial", () => {
  it("copies lines rather than referencing them", () => {
    const lines = [line({ id: "l1", displayName: "A", percent: "50" })];
    const snapshot = snapshotFormulaForTrial({ lines, basisBatchKg: "100" });
    lines[0].percent = "99";
    expect(snapshot.lines[0].percent).toBe("50");
  });
});

describe("canTransitionTrial", () => {
  it("allows a documented transition", () => {
    expect(canTransitionTrial("planned", "materials_prepared", HUMAN).allowed).toBe(true);
  });

  it("rejects an undocumented transition", () => {
    const r = canTransitionTrial("planned", "completed", HUMAN);
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("NOT_A_VALID_TRANSITION");
  });

  it("refuses to let an agent complete a trial", () => {
    const r = canTransitionTrial("awaiting_results", "completed", AGENT);
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("REQUIRES_HUMAN");
  });

  it("blocks completion while a critical deviation is open", () => {
    const deviation: TrialDeviation = {
      schemaVersion: "1.0",
      id: "dev-1",
      trialId: "trial-1",
      severity: "critical",
      status: "open",
      description: "Batch overheated.",
      detectedBy: "alice",
      detectedAt: "2026-01-01T00:00:00.000Z",
      correctiveActionIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const r = canTransitionTrial("awaiting_results", "completed", HUMAN, { openCriticalDeviations: [deviation] });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("OPEN_CRITICAL_DEVIATION");
  });

  it("allows completion once the critical deviation is resolved", () => {
    const deviation: TrialDeviation = {
      schemaVersion: "1.0",
      id: "dev-1",
      trialId: "trial-1",
      severity: "critical",
      status: "resolved",
      description: "Batch overheated.",
      detectedBy: "alice",
      detectedAt: "2026-01-01T00:00:00.000Z",
      correctiveActionIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const r = canTransitionTrial("awaiting_results", "completed", HUMAN, { openCriticalDeviations: [deviation] });
    expect(r.allowed).toBe(true);
  });
});

function usage(over: Partial<TrialMaterialUsage> = {}): TrialMaterialUsage {
  return {
    id: "usage-1",
    formulaLineId: "line-1",
    materialCode: "A",
    materialName: "Material A",
    targetPercent: "50",
    targetWeight: "50",
    weightUnit: "kg",
    coaStatus: "pending",
    quarantined: false,
    released: false,
    ...over,
  };
}

describe("computeMaterialUsageDeviation", () => {
  it("returns undefined deviations when actual has not been entered", () => {
    const d = computeMaterialUsageDeviation(usage());
    expect(d.absoluteDeviation).toBeUndefined();
    expect(d.percentageDeviation).toBeUndefined();
  });

  it("computes absolute and percentage deviation from an entered actual", () => {
    const d = computeMaterialUsageDeviation(usage({ targetWeight: "50", actualWeight: "51" }));
    expect(d.absoluteDeviation).toBe("1.000000");
    expect(d.percentageDeviation).toBe("2.000000");
  });

  it("treats a zero actual as a real, calculated 100% deficit — never silently zero", () => {
    const d = computeMaterialUsageDeviation(usage({ targetWeight: "50", actualWeight: "0" }));
    expect(d.absoluteDeviation).toBe("-50.000000");
    expect(d.percentageDeviation).toBe("-100.000000");
  });
});

describe("evaluateWeightTolerance", () => {
  it("is not_evaluated when there is no deviation to check", () => {
    expect(evaluateWeightTolerance(undefined, { warningPercent: "0.5", failurePercent: "2" })).toBe("not_evaluated");
  });

  it("classifies ok / warning / failure using caller-supplied tolerances, not a hardcoded standard", () => {
    expect(evaluateWeightTolerance("0.1", { warningPercent: "0.5", failurePercent: "2" })).toBe("ok");
    expect(evaluateWeightTolerance("1.0", { warningPercent: "0.5", failurePercent: "2" })).toBe("warning");
    expect(evaluateWeightTolerance("3.0", { warningPercent: "0.5", failurePercent: "2" })).toBe("failure");
  });
});

describe("computeBatchWeightVariance", () => {
  it("reports a partial sum and allWeighed:false while any actual is missing", () => {
    const usages = [usage({ id: "u1", targetWeight: "50", actualWeight: "50" }), usage({ id: "u2", targetWeight: "50" })];
    const v = computeBatchWeightVariance(usages);
    expect(v.allWeighed).toBe(false);
    expect(v.missingCount).toBe(1);
    expect(v.totalActualWeight).toBe("50.000000"); // lower bound, not 100 and not 0
    expect(v.varianceAbsolute).toBeUndefined();
  });

  it("computes full variance once every line is weighed", () => {
    const usages = [usage({ id: "u1", targetWeight: "50", actualWeight: "51" }), usage({ id: "u2", targetWeight: "50", actualWeight: "50" })];
    const v = computeBatchWeightVariance(usages);
    expect(v.allWeighed).toBe(true);
    expect(v.varianceAbsolute).toBe("1.000000");
  });
});

describe("computeActualFormulaPercent", () => {
  it("is undefined until the whole batch is weighed", () => {
    const usages = [usage({ id: "u1", targetWeight: "50", actualWeight: "50" }), usage({ id: "u2", targetWeight: "50" })];
    const variance = computeBatchWeightVariance(usages);
    expect(computeActualFormulaPercent(usages[0], variance)).toBeUndefined();
  });

  it("computes the real actual percentage once the batch total is known", () => {
    const usages = [usage({ id: "u1", targetWeight: "50", actualWeight: "60" }), usage({ id: "u2", targetWeight: "50", actualWeight: "40" })];
    const variance = computeBatchWeightVariance(usages);
    expect(computeActualFormulaPercent(usages[0], variance)).toBe("60.000000");
  });
});

function step(over: Partial<TrialProcessStep> = {}): TrialProcessStep {
  return {
    id: "step-1",
    stepNumber: 1,
    phase: "A",
    plannedInstruction: "Heat to 70C",
    requiredEquipment: [],
    status: "completed",
    unplanned: false,
    attachments: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("computeProcessStepDeviation", () => {
  it("reports no temperature deviation within the planned range", () => {
    const d = computeProcessStepDeviation(step({ plannedTemperatureMinC: "65", plannedTemperatureMaxC: "75", actualTemperatureC: "70" }));
    expect(d.temperatureDeviationC).toBeUndefined();
  });

  it("reports how far outside the planned range the actual temperature was", () => {
    const d = computeProcessStepDeviation(step({ plannedTemperatureMinC: "65", plannedTemperatureMaxC: "75", actualTemperatureC: "80" }));
    expect(d.temperatureDeviationC).toBe("5.000000");
  });

  it("never fabricates a measurement that was not entered", () => {
    const d = computeProcessStepDeviation(step());
    expect(d.temperatureDeviationC).toBeUndefined();
    expect(d.mixingSpeedDeviationRpm).toBeUndefined();
    expect(d.durationDeviationMinutes).toBeUndefined();
  });
});

describe("deviation lifecycle", () => {
  function deviation(over: Partial<TrialDeviation> = {}): TrialDeviation {
    return {
      schemaVersion: "1.0",
      id: "dev-1",
      trialId: "trial-1",
      severity: "major",
      status: "open",
      description: "Off-spec viscosity.",
      detectedBy: "alice",
      detectedAt: "2026-01-01T00:00:00.000Z",
      correctiveActionIds: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...over,
    };
  }

  it("resolves only for a human actor", () => {
    expect(() => resolveTrialDeviation(deviation(), AGENT, "Fixed.")).toThrow();
    const resolved = resolveTrialDeviation(deviation(), HUMAN, "Reweighed and reheated.");
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedBy).toBe("alice");
  });

  it("accept-with-justification requires a human and a justification", () => {
    const accepted = acceptDeviationWithJustification(deviation(), HUMAN, "Within acceptable process variation for this scale-up.");
    expect(accepted.status).toBe("accepted_with_justification");
    expect(accepted.justification).toBeTruthy();
  });

  it("hasOpenCriticalDeviation is true only for open/under_review critical severity", () => {
    expect(hasOpenCriticalDeviation([deviation({ severity: "critical", status: "open" })])).toBe(true);
    expect(hasOpenCriticalDeviation([deviation({ severity: "critical", status: "resolved" })])).toBe(false);
    expect(hasOpenCriticalDeviation([deviation({ severity: "minor", status: "open" })])).toBe(false);
  });
});

describe("compareTrials", () => {
  function trial(over: Partial<LaboratoryTrial> = {}): LaboratoryTrial {
    return {
      schemaVersion: "1.0",
      id: "trial-1",
      code: "TRIAL-1",
      projectId: "proj-1",
      sourceType: "working_draft",
      sourceDraftId: "proj-1",
      formulaSnapshot: { lines: [line({ id: "l1", displayName: "A", percent: "50" })], basisBatchKg: "100", capturedAt: "2026-01-01T00:00:00.000Z" },
      productFamilyId: "fam-1",
      targetPackagingSkuIds: [],
      title: "Trial 1",
      batchSize: "1",
      batchUnit: "kg",
      status: "completed",
      priority: "normal",
      equipmentIds: [],
      materialUsage: [],
      processSteps: [],
      observations: [],
      hasOpenCriticalDeviation: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...over,
    };
  }

  it("requires at least two trials", () => {
    expect(() => compareTrials({ projectId: "proj-1", trials: [trial()], deviationsByTrial: {}, testResultsByTrial: {}, testDefinitionsById: {} })).toThrow();
  });

  it("reports pass/fail counts and a mean difference per shared test", () => {
    const t1 = trial({ id: "t1", code: "T1" });
    const t2 = trial({ id: "t2", code: "T2" });
    const result1: TestResult = {
      schemaVersion: "1.0", id: "r1", trialId: "t1", testDefinitionId: "def-ph", resultType: "numeric",
      replicates: [], attachments: [], stats: { count: 1, mean: "7.0" }, passFail: "pass", performedBy: "alice", performedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const result2: TestResult = { ...result1, id: "r2", trialId: "t2", stats: { count: 1, mean: "7.5" }, passFail: "fail" };

    const comparison = compareTrials({
      projectId: "proj-1",
      trials: [t1, t2],
      deviationsByTrial: {},
      testResultsByTrial: { t1: [result1], t2: [result2] },
      testDefinitionsById: { "def-ph": { schemaVersion: "1.0", code: "TEST-PH", name: "pH", category: "physical_chemical", resultType: "numeric", replicatesRequired: 1, requiredEquipment: [], requiredAttachment: false, applicableProductFamilies: [], applicableProductSkus: [], criticalTestFlag: false, verificationStatus: "not_verified", active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } },
    });

    expect(comparison.rows).toHaveLength(2);
    expect(comparison.rows[0].passCount).toBe(1);
    expect(comparison.rows[1].failCount).toBe(1);
    expect(comparison.testComparisons[0].meanDifference).toBe("0.500000");
    expect(comparison.aiInterpretation).toBeUndefined();
  });

  it("is deterministic", () => {
    const t1 = trial({ id: "t1" });
    const t2 = trial({ id: "t2" });
    const input = { projectId: "proj-1", trials: [t1, t2], deviationsByTrial: {}, testResultsByTrial: {}, testDefinitionsById: {} };
    const a = compareTrials(input);
    const b = compareTrials(input);
    expect(a.rows).toEqual(b.rows);
  });
});
