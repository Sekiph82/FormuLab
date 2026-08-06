/**
 * Test-result calculation: replicate statistics, deterministic pass/fail
 * evaluation against a `TestDefinition`, human overrides, and append-only
 * revisions. All arithmetic goes through `decimal.js` (`engine/decimal.ts`)
 * — never native JS floating point — because a mean or a standard
 * deviation a chemist compares against a spec limit is exactly the kind of
 * number `0.1 + 0.2 !== 0.3` corrupts silently.
 */
import { dec, fmt, tryDec } from "./decimal";
import Decimal from "decimal.js";
import { newId } from "./versioning";
import type { Actor } from "../schemas/status";
import type { PassFailLogic, ReplicateStats, TestDefinition, TestReplicate, TestResult, TestResultOverride } from "../schemas/testDefinitions";

/**
 * Sample standard deviation (n-1) — the correct choice for a handful of lab
 * replicates, which are a sample of the batch's true variability, not the
 * whole population. Returns `undefined` for fewer than 2 numeric values,
 * never a fabricated 0.
 */
export function computeReplicateStats(replicates: TestReplicate[], opts: { excludeOutliers?: boolean } = {}): ReplicateStats {
  const considered = opts.excludeOutliers ? replicates.filter((r) => !r.isOutlier) : replicates;
  const values = considered.map((r) => tryDec(r.numericValue)).filter((v): v is Decimal => v !== undefined);

  if (values.length === 0) {
    return { count: 0 };
  }

  const sum = values.reduce((acc, v) => acc.plus(v), dec(0));
  const mean = sum.div(values.length);
  const minimum = values.reduce((min, v) => (v.lessThan(min) ? v : min), values[0]);
  const maximum = values.reduce((max, v) => (v.greaterThan(max) ? v : max), values[0]);

  let standardDeviation: Decimal | undefined;
  if (values.length >= 2) {
    const sumSquaredDiff = values.reduce((acc, v) => acc.plus(v.minus(mean).pow(2)), dec(0));
    standardDeviation = sumSquaredDiff.div(values.length - 1).sqrt();
  }

  const cv = standardDeviation !== undefined && !mean.isZero() ? standardDeviation.div(mean).times(100).abs() : undefined;

  return {
    count: values.length,
    mean: fmt(mean, "measurement"),
    minimum: fmt(minimum, "measurement"),
    maximum: fmt(maximum, "measurement"),
    standardDeviation: standardDeviation !== undefined ? fmt(standardDeviation, "measurement") : undefined,
    coefficientOfVariationPercent: cv !== undefined ? fmt(cv, "measurement") : undefined,
  };
}

/**
 * Deterministic pass/fail from a `TestDefinition.passFailLogic` against the
 * value(s) actually recorded. `manual_judgment` (or no logic at all) always
 * returns `not_evaluated` — this function never guesses a verdict a human
 * has to make.
 */
export function evaluatePassFail(
  logic: PassFailLogic | undefined,
  value: { numeric?: string; text?: string; boolean?: boolean; categorical?: string },
  bounds: { targetValue?: string; minimum?: string; maximum?: string } = {},
): "pass" | "fail" | "not_evaluated" {
  if (!logic || logic.rule === "manual_judgment") return "not_evaluated";

  switch (logic.rule) {
    case "within_range": {
      const v = tryDec(value.numeric);
      const min = tryDec(bounds.minimum);
      const max = tryDec(bounds.maximum);
      if (v === undefined || (min === undefined && max === undefined)) return "not_evaluated";
      if (min !== undefined && v.lessThan(min)) return "fail";
      if (max !== undefined && v.greaterThan(max)) return "fail";
      return "pass";
    }
    case "at_least": {
      const v = tryDec(value.numeric);
      const min = tryDec(bounds.minimum ?? bounds.targetValue);
      if (v === undefined || min === undefined) return "not_evaluated";
      return v.greaterThanOrEqualTo(min) ? "pass" : "fail";
    }
    case "at_most": {
      const v = tryDec(value.numeric);
      const max = tryDec(bounds.maximum ?? bounds.targetValue);
      if (v === undefined || max === undefined) return "not_evaluated";
      return v.lessThanOrEqualTo(max) ? "pass" : "fail";
    }
    case "equals": {
      if (value.numeric !== undefined && bounds.targetValue !== undefined) {
        const v = tryDec(value.numeric);
        const target = tryDec(bounds.targetValue);
        if (v === undefined || target === undefined) return "not_evaluated";
        return v.equals(target) ? "pass" : "fail";
      }
      if (value.text !== undefined && bounds.targetValue !== undefined) {
        return value.text === bounds.targetValue ? "pass" : "fail";
      }
      if (value.boolean !== undefined && bounds.targetValue !== undefined) {
        return String(value.boolean) === bounds.targetValue ? "pass" : "fail";
      }
      return "not_evaluated";
    }
    case "in_set": {
      if (value.categorical === undefined || !logic.allowedValues || logic.allowedValues.length === 0) return "not_evaluated";
      return logic.allowedValues.includes(value.categorical) ? "pass" : "fail";
    }
    default:
      return "not_evaluated";
  }
}

/**
 * Evaluate pass/fail for a numeric result using its own computed stats'
 * mean — the natural "one verdict per result" reading when several
 * replicates were taken. Callers with a single value can pass `evaluatePassFail`
 * directly instead.
 */
export function evaluateNumericResultPassFail(definition: TestDefinition, stats: ReplicateStats): "pass" | "fail" | "not_evaluated" {
  return evaluatePassFail(definition.passFailLogic, { numeric: stats.mean }, definition);
}

/**
 * A human override — the only legitimate way a result's evaluation can be
 * changed from what the deterministic rule produced. Requires a human
 * actor; an agent/system/import actor gets a thrown error, not a silently
 * ignored call.
 */
export function applyResultOverride(
  result: TestResult,
  actor: Actor,
  input: { reason: string; overriddenEvaluation: string },
): TestResult {
  if (actor.kind !== "human") {
    throw new Error("Only a human may override a test result's evaluation.");
  }
  const override: TestResultOverride = {
    reviewerId: actor.userId,
    reason: input.reason,
    at: new Date().toISOString(),
    originalEvaluation: result.passFail,
    overriddenEvaluation: input.overriddenEvaluation,
  };
  return {
    ...result,
    override,
    passFail: input.overriddenEvaluation === "pass" || input.overriddenEvaluation === "fail" ? input.overriddenEvaluation : result.passFail,
    updatedAt: override.at,
  };
}

/**
 * Editing a recorded result never mutates it — this returns a NEW record
 * (`revisesResultId` pointing at the one being revised) so the original
 * stays exactly as first entered. Both records persist in the append-only
 * `test_results`/`stability_results` collection.
 */
export function reviseTestResult(previous: TestResult, updates: Partial<TestResult>, revisedBy: string): TestResult {
  const now = new Date().toISOString();
  return {
    ...previous,
    ...updates,
    id: newId("testresult"),
    revisesResultId: previous.id,
    override: undefined,
    performedBy: updates.performedBy ?? previous.performedBy,
    createdAt: now,
    updatedAt: now,
    reviewedBy: revisedBy,
    reviewedAt: now,
  };
}

/**
 * A conservative, deterministic outlier flag using the 1.5×IQR rule on the
 * numeric replicates — flags, never removes. Fewer than 4 values is too
 * small a sample for IQR to mean anything, so nothing is flagged.
 */
export function flagOutliers(replicates: TestReplicate[]): TestReplicate[] {
  const numeric = replicates
    .map((r, i) => ({ i, v: tryDec(r.numericValue) }))
    .filter((x): x is { i: number; v: Decimal } => x.v !== undefined)
    .sort((a, b) => a.v.comparedTo(b.v));
  if (numeric.length < 4) return replicates;

  const q1Index = Math.floor(numeric.length * 0.25);
  const q3Index = Math.floor(numeric.length * 0.75);
  const q1 = numeric[q1Index].v;
  const q3 = numeric[q3Index].v;
  const iqr = q3.minus(q1);
  const lower = q1.minus(iqr.times(1.5));
  const upper = q3.plus(iqr.times(1.5));

  const outlierIndices = new Set(numeric.filter((x) => x.v.lessThan(lower) || x.v.greaterThan(upper)).map((x) => x.i));

  return replicates.map((r, i) =>
    outlierIndices.has(i) ? { ...r, isOutlier: true, outlierReason: r.outlierReason ?? "Outside 1.5×IQR of this result's replicates." } : r,
  );
}
