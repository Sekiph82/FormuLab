import { describe, expect, it } from "vitest";
import { applyResultOverride, computeReplicateStats, evaluatePassFail, flagOutliers, reviseTestResult } from "./testResults";
import type { TestReplicate, TestResult } from "../schemas/testDefinitions";
import { testDefinitionSchema, testResultSchema } from "../schemas/testDefinitions";

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
    const overridden = applyResultOverride(result, { kind: "human", role: "researcher", userId: "alice" }, {
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
    const automatedActors = [
      { kind: "agent", runId: "run-1" },
      { kind: "system", reason: "scheduled evaluation" },
      { kind: "import", source: "instrument.csv" },
    ] as const;
    for (const actor of automatedActors) {
      expect(() => applyResultOverride(result, actor, { reason: "x", overriddenEvaluation: "pass" })).toThrow(/Only a human/);
    }
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

describe("FVL-06 measured-response contracts", () => {
  it("round-trips metric definitions, raw values, exact linkage, timestamps and import provenance", () => {
    const result = testResultSchema.parse(baseResult({
      schemaVersion: "1.1",
      formulaVersionId: "formula-version-7",
      sampleId: "sample-A",
      metricSnapshot: { metricCode: "SR-405", family: "soil_removal", description: "Source-defined soil removal response" },
      measurementContext: { wavelengthNm: "405", referenceContext: "unsoiled swatch, source instrument export" },
      replicates: [{
        replicateNumber: 1,
        numericValue: "0",
        normalizedPerformance: { value: "0", ruleId: "vendor-export-normalization", ruleVersion: "2", inputs: { reference: "0", sample: "0" } },
        isOutlier: false,
      }],
      sourceProvenance: [{
        fileName: "instrument-export.csv", fileType: "csv", mimeType: "text/csv", sha256: "a".repeat(64),
        importJobId: "dxjob-1", rowNumber: 2,
      }],
      importedAt: "2026-04-01T12:00:00.000Z",
      performedAt: "2026-04-01T11:59:00.000Z",
    }));
    expect(result.formulaVersionId).toBe("formula-version-7");
    expect(result.replicates[0].numericValue).toBe("0");
    expect(result.replicates[0].normalizedPerformance?.ruleVersion).toBe("2");
    expect(result.sourceProvenance?.[0].rowNumber).toBe(2);
    expect(testResultSchema.parse(result)).toEqual(result);
  });

  it("keeps missing raw and normalized values absent and rejects untraceable normalization", () => {
    const missing = testResultSchema.parse(baseResult({ schemaVersion: "1.1", replicates: [{ replicateNumber: 1, isOutlier: false }] }));
    expect(missing.replicates[0].numericValue).toBeUndefined();
    expect(missing.replicates[0].normalizedPerformance).toBeUndefined();
    expect(testResultSchema.safeParse({
      ...missing,
      replicates: [{
        replicateNumber: 1,
        normalizedPerformance: { value: "4", ruleId: "rule-v1", ruleVersion: "1", inputs: { scale: "source-defined" } },
        isOutlier: false,
      }],
    }).success).toBe(false);
    expect(testResultSchema.safeParse({ ...missing, replicates: [{ replicateNumber: 1, numericValue: "5", normalizedPerformance: { value: "4", ruleId: "", ruleVersion: "1", inputs: {} }, isOutlier: false }] }).success).toBe(false);
  });

  it("supports source-defined metric families without assigning scientific equations", () => {
    const definition = testDefinitionSchema.parse({
      schemaVersion: "1.1", code: "TEST-REFLECT", name: "Reflectance at 405 nm", category: "performance",
      resultType: "numeric", metric: { metricCode: "REF-405", family: "reflectance", wavelengthNm: "405" },
      createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z",
    });
    expect(definition.metric?.metricCode).toBe("REF-405");
    expect(testDefinitionSchema.parse(definition)).toEqual(definition);
  });
});
