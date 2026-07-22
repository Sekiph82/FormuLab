/**
 * Laboratory trial lifecycle, material-usage/process-step calculations, and
 * trial comparison. Every deviation figure goes through `decimal.js`
 * (`engine/decimal.ts`); a missing actual value is `undefined`, never 0 —
 * see `docs/TRIAL_EXECUTION.md`.
 */
import { dec, fmt, tryDec } from "./decimal";
import { newId } from "./versioning";
import type { Actor } from "../schemas/status";
import type { FormulationLine } from "../schemas/formulation";
import type {
  LaboratoryTrial,
  TrialComparison,
  TrialComparisonRow,
  TrialDeviation,
  TrialFormulaSnapshot,
  TrialMaterialUsage,
  TrialProcessStep,
  TrialStatus,
  TestResultComparison,
} from "../schemas/laboratory";
import type { TestDefinition, TestResult } from "../schemas/testDefinitions";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const TRIAL_ALLOWED_NEXT: Record<TrialStatus, readonly TrialStatus[]> = {
  planned: ["materials_prepared", "cancelled"],
  materials_prepared: ["in_progress", "cancelled"],
  in_progress: ["awaiting_results", "failed", "cancelled"],
  awaiting_results: ["completed", "failed"],
  completed: ["archived"],
  failed: ["archived"],
  cancelled: ["archived"],
  archived: [],
};

export interface TrialTransitionResult {
  allowed: boolean;
  code?: "NOT_A_VALID_TRANSITION" | "REQUIRES_HUMAN" | "OPEN_CRITICAL_DEVIATION";
  message?: string;
}

/**
 * May `actor` move a trial from `from` to `to`? Rejected here, not just
 * hidden in the UI — the same discipline `canTransitionTo` (schemas/status.ts)
 * applies to formula approval. `completed` always requires a human actor
 * (spec: "AI and system actors must not mark a trial completed"), and is
 * additionally blocked while any deviation on this trial is still `open` or
 * `under_review` at `critical` severity.
 */
export function canTransitionTrial(
  from: TrialStatus,
  to: TrialStatus,
  actor: Actor,
  opts: { openCriticalDeviations?: TrialDeviation[] } = {},
): TrialTransitionResult {
  if (!TRIAL_ALLOWED_NEXT[from]?.includes(to)) {
    return { allowed: false, code: "NOT_A_VALID_TRANSITION", message: `Trial cannot move from ${from} to ${to}.` };
  }
  if (to === "completed") {
    if (actor.kind !== "human") {
      return {
        allowed: false,
        code: "REQUIRES_HUMAN",
        message: "Completing a trial is a human acceptance decision, not something an agent or system process can grant.",
      };
    }
    const openCritical = (opts.openCriticalDeviations ?? []).filter(
      (d) => d.severity === "critical" && (d.status === "open" || d.status === "under_review"),
    );
    if (openCritical.length > 0) {
      return {
        allowed: false,
        code: "OPEN_CRITICAL_DEVIATION",
        message: `${openCritical.length} critical deviation(s) must be resolved or accepted-with-justification before this trial can be completed.`,
      };
    }
  }
  return { allowed: true };
}

/** A trial in any of these statuses is done changing — its execution
 *  record (material usage, process steps, the embedded formula snapshot)
 *  is immutable from here on. `laboratory_trials` is editable master data
 *  at the storage layer (like `materials`/`inventory`, not append-only like
 *  `test_results`), so this application-level guard is what actually makes
 *  a completed trial's record immutable — every mutation function in this
 *  module is expected to call it first. */
const TERMINAL_TRIAL_STATUSES: readonly TrialStatus[] = ["completed", "failed", "cancelled", "archived"];

export function assertTrialEditable(trial: LaboratoryTrial): void {
  if (TERMINAL_TRIAL_STATUSES.includes(trial.status)) {
    throw new Error(
      `Trial ${trial.code} is ${trial.status} and its execution record is immutable — create a new trial instead of editing this one.`,
    );
  }
}

export function snapshotFormulaForTrial(source: { lines: FormulationLine[]; basisBatchKg: string }): TrialFormulaSnapshot {
  return {
    lines: source.lines.map((l) => ({ ...l })),
    basisBatchKg: source.basisBatchKg,
    capturedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Material usage
// ---------------------------------------------------------------------------

export interface MaterialUsageDeviation {
  absoluteDeviation?: string;
  percentageDeviation?: string;
}

/** `undefined` for both fields when `actualWeight` has not been entered —
 *  never treated as a 0 deviation. */
export function computeMaterialUsageDeviation(usage: TrialMaterialUsage): MaterialUsageDeviation {
  const actual = tryDec(usage.actualWeight);
  if (actual === undefined) return {};
  const target = dec(usage.targetWeight);
  const absolute = actual.minus(target);
  const percentage = target.isZero() ? undefined : absolute.div(target).times(100);
  return {
    absoluteDeviation: fmt(absolute, "measurement"),
    percentageDeviation: percentage !== undefined ? fmt(percentage, "measurement") : undefined,
  };
}

export interface WeightToleranceConfig {
  warningPercent?: string;
  failurePercent?: string;
}

export type WeightToleranceResult = "ok" | "warning" | "failure" | "not_evaluated";

/** Tolerances are per-caller configuration (e.g. "±0.5% warning, ±2.0%
 *  failure"), never a hardcoded universal standard — see spec §3. */
export function evaluateWeightTolerance(percentageDeviation: string | undefined, tolerances: WeightToleranceConfig): WeightToleranceResult {
  if (percentageDeviation === undefined) return "not_evaluated";
  const dev = dec(percentageDeviation).abs();
  const failure = tryDec(tolerances.failurePercent);
  const warning = tryDec(tolerances.warningPercent);
  if (failure !== undefined && dev.greaterThan(failure)) return "failure";
  if (warning !== undefined && dev.greaterThan(warning)) return "warning";
  return "ok";
}

export interface BatchWeightVariance {
  totalTargetWeight: string;
  /** Sum of only the ACTUAL weights entered so far — a lower bound while
   *  any line is unweighed, exactly like the cost engine's "missing data is
   *  never zero" convention. */
  totalActualWeight: string;
  allWeighed: boolean;
  missingCount: number;
  varianceAbsolute?: string;
  variancePercentage?: string;
}

export function computeBatchWeightVariance(usages: TrialMaterialUsage[]): BatchWeightVariance {
  const totalTarget = usages.reduce((sum, u) => sum.plus(dec(u.targetWeight)), dec(0));
  const missing = usages.filter((u) => u.actualWeight === undefined);
  const totalActual = usages.reduce((sum, u) => {
    const actual = tryDec(u.actualWeight);
    return actual !== undefined ? sum.plus(actual) : sum;
  }, dec(0));

  const allWeighed = missing.length === 0;
  const variance = allWeighed
    ? { varianceAbsolute: fmt(totalActual.minus(totalTarget), "measurement"), variancePercentage: totalTarget.isZero() ? undefined : fmt(totalActual.minus(totalTarget).div(totalTarget).times(100), "measurement") }
    : {};

  return {
    totalTargetWeight: fmt(totalTarget, "measurement"),
    totalActualWeight: fmt(totalActual, "measurement"),
    allWeighed,
    missingCount: missing.length,
    ...variance,
  };
}

/** Only meaningful once every line has an actual weight — returns
 *  `undefined` while the batch total is still a partial (lower-bound) sum. */
export function computeActualFormulaPercent(usage: TrialMaterialUsage, variance: BatchWeightVariance): string | undefined {
  if (!variance.allWeighed) return undefined;
  const actual = tryDec(usage.actualWeight);
  const total = dec(variance.totalActualWeight);
  if (actual === undefined || total.isZero()) return undefined;
  return fmt(actual.div(total).times(100), "measurement");
}

// ---------------------------------------------------------------------------
// Process steps
// ---------------------------------------------------------------------------

export interface ProcessStepDeviation {
  temperatureDeviationC?: string;
  mixingSpeedDeviationRpm?: string;
  durationDeviationMinutes?: string;
}

/** Deterministic numeric differences only — never a fabricated "in spec"
 *  verdict; the caller decides what a meaningful deviation is for that step. */
export function computeProcessStepDeviation(step: TrialProcessStep): ProcessStepDeviation {
  const result: ProcessStepDeviation = {};

  const actualTemp = tryDec(step.actualTemperatureC);
  if (actualTemp !== undefined) {
    const min = tryDec(step.plannedTemperatureMinC);
    const max = tryDec(step.plannedTemperatureMaxC);
    if (min !== undefined && actualTemp.lessThan(min)) result.temperatureDeviationC = fmt(actualTemp.minus(min), "measurement");
    else if (max !== undefined && actualTemp.greaterThan(max)) result.temperatureDeviationC = fmt(actualTemp.minus(max), "measurement");
  }

  const actualSpeed = tryDec(step.actualMixingSpeedRpm);
  if (actualSpeed !== undefined) {
    const min = tryDec(step.plannedMixingSpeedMinRpm);
    const max = tryDec(step.plannedMixingSpeedMaxRpm);
    if (min !== undefined && actualSpeed.lessThan(min)) result.mixingSpeedDeviationRpm = fmt(actualSpeed.minus(min), "measurement");
    else if (max !== undefined && actualSpeed.greaterThan(max)) result.mixingSpeedDeviationRpm = fmt(actualSpeed.minus(max), "measurement");
  }

  const actualDuration = tryDec(step.actualDurationMinutes);
  const plannedDuration = tryDec(step.plannedDurationMinutes);
  if (actualDuration !== undefined && plannedDuration !== undefined) {
    result.durationDeviationMinutes = fmt(actualDuration.minus(plannedDuration), "measurement");
  }

  return result;
}

// ---------------------------------------------------------------------------
// Deviations
// ---------------------------------------------------------------------------

export function resolveTrialDeviation(deviation: TrialDeviation, actor: Actor, resolution: string): TrialDeviation {
  if (actor.kind !== "human") {
    throw new Error("Only a human may resolve a trial deviation.");
  }
  if (deviation.status !== "open" && deviation.status !== "under_review") {
    throw new Error(`Deviation ${deviation.id} must be open or under_review to resolve (is ${deviation.status}).`);
  }
  const now = new Date().toISOString();
  return { ...deviation, status: "resolved", resolution, resolvedBy: actor.userId, resolvedAt: now, updatedAt: now };
}

export function acceptDeviationWithJustification(deviation: TrialDeviation, actor: Actor, justification: string): TrialDeviation {
  if (actor.kind !== "human") {
    throw new Error("Only a human may accept a trial deviation with justification.");
  }
  const now = new Date().toISOString();
  return { ...deviation, status: "accepted_with_justification", justification, resolvedBy: actor.userId, resolvedAt: now, updatedAt: now };
}

export function hasOpenCriticalDeviation(deviations: TrialDeviation[]): boolean {
  return deviations.some((d) => d.severity === "critical" && (d.status === "open" || d.status === "under_review"));
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface CompareTrialsInput {
  projectId: string;
  trials: LaboratoryTrial[];
  /** Deviations, keyed by trial id — `TrialDeviation` is its own collection
   *  (spec §17), unlike material usage/process steps, which are embedded
   *  directly on each `LaboratoryTrial`. */
  deviationsByTrial: Record<string, TrialDeviation[]>;
  testResultsByTrial: Record<string, TestResult[]>;
  testDefinitionsById: Record<string, TestDefinition>;
  generatedBy?: string;
}

/**
 * Deterministic, source-of-truth comparison across two or more trials. No
 * causation is inferred — this only reports differences. A caller may
 * attach `aiInterpretation` afterward, always prefixed "AI-assisted
 * interpretation — requires chemist review" (spec §9); this function never
 * sets that field itself.
 */
export function compareTrials(input: CompareTrialsInput): TrialComparison {
  if (input.trials.length < 2) {
    throw new Error("Comparing trials requires at least two trials.");
  }

  const rows: TrialComparisonRow[] = input.trials.map((trial) => {
    const deviations = input.deviationsByTrial[trial.id] ?? [];
    const results = input.testResultsByTrial[trial.id] ?? [];
    return {
      trialId: trial.id,
      trialCode: trial.code,
      formulaVersionId: trial.sourceFormulaVersionId,
      lines: trial.formulaSnapshot.lines,
      materialUsageCount: trial.materialUsage.length,
      processDeviationCount: deviations.length,
      criticalDeviationCount: deviations.filter((d) => d.severity === "critical").length,
      testResultCount: results.length,
      passCount: results.filter((r) => r.passFail === "pass").length,
      failCount: results.filter((r) => r.passFail === "fail").length,
      optimizationRunCode: trial.sourceOptimizationRunCode,
      substitutionRunCode: trial.sourceSubstitutionRunCode,
      status: trial.status,
    };
  });

  // Every test definition id that appears in ANY compared trial's results.
  const testDefIds = new Set<string>();
  for (const trial of input.trials) {
    for (const r of input.testResultsByTrial[trial.id] ?? []) testDefIds.add(r.testDefinitionId);
  }

  const testComparisons: TestResultComparison[] = [...testDefIds].map((testDefId) => {
    const definition = input.testDefinitionsById[testDefId];
    const values = input.trials.map((trial) => {
      const result = (input.testResultsByTrial[trial.id] ?? []).find((r) => r.testDefinitionId === testDefId);
      return { trialId: trial.id, mean: result?.stats?.mean, passFail: result?.passFail };
    });

    const baseline = tryDec(values[0]?.mean);
    const comparator = tryDec(values[values.length - 1]?.mean);
    let meanDifference: string | undefined;
    let absoluteDifference: string | undefined;
    let percentageDifference: string | undefined;
    if (baseline !== undefined && comparator !== undefined) {
      const diff = comparator.minus(baseline);
      meanDifference = fmt(diff, "measurement");
      absoluteDifference = fmt(diff.abs(), "measurement");
      percentageDifference = baseline.isZero() ? undefined : fmt(diff.div(baseline).times(100), "measurement");
    }

    return {
      testDefinitionId: testDefId,
      testCode: definition?.code ?? testDefId,
      values,
      meanDifference,
      absoluteDifference,
      percentageDifference,
      standardDeviationDifference: undefined,
    };
  });

  return {
    schemaVersion: "1.0",
    id: newId("trialcmp"),
    projectId: input.projectId,
    trialIds: input.trials.map((t) => t.id),
    rows,
    testComparisons,
    generatedAt: new Date().toISOString(),
    generatedBy: input.generatedBy ?? "local",
  };
}
