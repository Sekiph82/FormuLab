import { describe, expect, it } from "vitest";
import { applyResultOverride, computeReplicateStats, evaluatePassFail, flagOutliers, reviseTestResult } from "./testResults";
import type { TestReplicate, TestResult } from "../schemas/testDefinitions";

function replicate(n: number, value: string | undefined): TestReplicate {
  return { replicateNumber: n, numericValue: value, isOutlier: false };
}

describe("computeReplicateStats", () => {
  it("computes count/mean/min/max/stdDev/CV for numeric replicates", () => {
    const stats = computeReplicateStats([replicate(1, "10"), replicate(2, "12"), replicate(3, "11")]);
    expect(stats.count).toBe(3);
    expect(stats.mean).toBe("11.000000");
    expect(stats.minimum).toBe("10.000000");
    expect(stats.maximum).toBe("12.000000");
    expect(stats.standardDeviation).toBe("1.000000");
    expect(stats.coefficientOfVariationPercent).toBeDefined();
  });

  it("returns count 0 and no other fields for zero numeric replicates", () => {
    const stats = computeReplicateStats([replicate(1, undefined)]);
    expect(stats.count).toBe(0);
    expect(stats.mean).toBeUndefined();
  });

  it("does not compute standard deviation for a single replicate", () => {
    const stats = computeReplicateStats([replicate(1, "10")]);
    expect(stats.count).toBe(1);
    expect(stats.mean).toBe("10.000000");
    expect(stats.standardDeviation).toBeUndefined();
  });

  it("excludes flagged outliers when asked", () => {
    const replicates = [replicate(1, "10"), replicate(2, "10"), { ...replicate(3, "1000"), isOutlier: true }];
    const stats = computeReplicateStats(replicates, { excludeOutliers: true });
    expect(stats.count).toBe(2);
    expect(stats.mean).toBe("10.000000");
  });

  it("is deterministic", () => {
    const replicates = [replicate(1, "10"), replicate(2, "12"), replicate(3, "11")];
    expect(computeReplicateStats(replicates)).toEqual(computeReplicateStats(replicates));
  });
});

describe("evaluatePassFail", () => {
  it("within_range passes inside the bounds and fails outside", () => {
    expect(evaluatePassFail({ rule: "within_range" }, { numeric: "7" }, { minimum: "6", maximum: "8" })).toBe("pass");
    expect(evaluatePassFail({ rule: "within_range" }, { numeric: "9" }, { minimum: "6", maximum: "8" })).toBe("fail");
  });

  it("at_least / at_most", () => {
    expect(evaluatePassFail({ rule: "at_least" }, { numeric: "5" }, { minimum: "3" })).toBe("pass");
    expect(evaluatePassFail({ rule: "at_least" }, { numeric: "2" }, { minimum: "3" })).toBe("fail");
    expect(evaluatePassFail({ rule: "at_most" }, { numeric: "5" }, { maximum: "10" })).toBe("pass");
    expect(evaluatePassFail({ rule: "at_most" }, { numeric: "15" }, { maximum: "10" })).toBe("fail");
  });

  it("in_set matches a categorical value against allowed values", () => {
    expect(evaluatePassFail({ rule: "in_set", allowedValues: ["clear", "pale yellow"] }, { categorical: "clear" })).toBe("pass");
    expect(evaluatePassFail({ rule: "in_set", allowedValues: ["clear"] }, { categorical: "cloudy" })).toBe("fail");
  });

  it("manual_judgment and missing logic are never auto-evaluated", () => {
    expect(evaluatePassFail({ rule: "manual_judgment" }, { numeric: "7" }, { minimum: "6", maximum: "8" })).toBe("not_evaluated");
    expect(evaluatePassFail(undefined, { numeric: "7" })).toBe("not_evaluated");
  });

  it("returns not_evaluated rather than guessing when the value is missing", () => {
    expect(evaluatePassFail({ rule: "within_range" }, {}, { minimum: "6", maximum: "8" })).toBe("not_evaluated");
  });
});

function baseResult(over: Partial<TestResult> = {}): TestResult {
  return {
    schemaVersion: "1.0",
    id: "result-1",
    trialId: "trial-1",
    testDefinitionId: "def-1",
    resultType: "numeric",
    replicates: [],
    attachments: [],
    passFail: "fail",
    performedBy: "chemist",
    performedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("applyResultOverride", () => {
  it("records a full override with actor, reason and both evaluations", () => {
    const result = baseResult({ passFail: "fail" });
    const overridden = applyResultOverride(result, { kind: "human", role: "chemist", userId: "alice" }, {
      reason: "Instrument miscalibration confirmed after the fact.",
      overriddenEvaluation: "pass",
    });
    expect(overridden.override?.reviewerId).toBe("alice");
    expect(overridden.override?.originalEvaluation).toBe("fail");
    expect(overridden.override?.overriddenEvaluation).toBe("pass");
    expect(overridden.passFail).toBe("pass");
  });

  it("refuses an override from a non-human actor", () => {
    const result = baseResult();
    expect(() => applyResultOverride(result, { kind: "agent", runId: "run-1" }, { reason: "x", overriddenEvaluation: "pass" })).toThrow();
  });
});

describe("reviseTestResult", () => {
  it("creates a new record pointing at the one it revises, never mutating it", () => {
    const original = baseResult({ id: "result-1" });
    const revised = reviseTestResult(original, { notes: "Corrected transcription error." }, "bob");
    expect(revised.id).not.toBe(original.id);
    expect(revised.revisesResultId).toBe("result-1");
    expect(revised.notes).toBe("Corrected transcription error.");
    expect(original.notes).toBeUndefined(); // original untouched
  });
});

describe("flagOutliers", () => {
  it("flags a value far outside the others without deleting it", () => {
    const replicates = [replicate(1, "10"), replicate(2, "11"), replicate(3, "9"), replicate(4, "10.5"), replicate(5, "500")];
    const flagged = flagOutliers(replicates);
    expect(flagged).toHaveLength(5); // nothing removed
    const outlier = flagged.find((r) => r.replicateNumber === 5);
    expect(outlier?.isOutlier).toBe(true);
  });

  it("does not flag anything with fewer than 4 replicates", () => {
    const replicates = [replicate(1, "10"), replicate(2, "500")];
    const flagged = flagOutliers(replicates);
    expect(flagged.every((r) => !r.isOutlier)).toBe(true);
  });
});
