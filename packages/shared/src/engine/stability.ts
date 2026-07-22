/**
 * Stability study lifecycle, pull-point sample generation, due/overdue
 * calculation, and trend analysis. No shelf-life prediction: a `projection`
 * on a `StabilityTrend` is only ever a labeled, minimum-data-gated linear
 * extrapolation — see `docs/STABILITY_TRENDS.md` for exactly what "enough
 * data" means and why nothing here claims validated shelf life.
 */
import Decimal from "decimal.js";
import { dec, fmt, tryDec } from "./decimal";
import { newId } from "./versioning";
import type { Actor } from "../schemas/status";
import type {
  StabilityCondition,
  StabilityFailure,
  StabilityResult,
  StabilitySample,
  StabilityStudy,
  StabilityStudyStatus,
  StabilityTimePoint,
  StabilityTrend,
  StabilityTrendPoint,
} from "../schemas/stability";
import type { TestDefinition } from "../schemas/testDefinitions";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const STABILITY_ALLOWED_NEXT: Record<StabilityStudyStatus, readonly StabilityStudyStatus[]> = {
  planned: ["active", "cancelled"],
  active: ["paused", "completed", "failed", "cancelled"],
  paused: ["active", "cancelled"],
  completed: ["archived"],
  failed: ["archived"],
  cancelled: ["archived"],
  archived: [],
};

export interface StabilityTransitionResult {
  allowed: boolean;
  code?: "NOT_A_VALID_TRANSITION" | "REQUIRES_HUMAN" | "OPEN_CRITICAL_FAILURE";
  message?: string;
}

/** Same discipline as `canTransitionTrial` — `completed` requires a human
 *  actor and blocks while any `critical`-severity failure is still open. */
export function canTransitionStability(
  from: StabilityStudyStatus,
  to: StabilityStudyStatus,
  actor: Actor,
  opts: { openCriticalFailures?: StabilityFailure[] } = {},
): StabilityTransitionResult {
  if (!STABILITY_ALLOWED_NEXT[from]?.includes(to)) {
    return { allowed: false, code: "NOT_A_VALID_TRANSITION", message: `Study cannot move from ${from} to ${to}.` };
  }
  if (to === "completed") {
    if (actor.kind !== "human") {
      return {
        allowed: false,
        code: "REQUIRES_HUMAN",
        message: "Completing a stability study is a human acceptance decision.",
      };
    }
    const openCritical = (opts.openCriticalFailures ?? []).filter(
      (f) => f.severity === "critical" && f.investigationStatus !== "closed",
    );
    if (openCritical.length > 0) {
      return {
        allowed: false,
        code: "OPEN_CRITICAL_FAILURE",
        message: `${openCritical.length} critical failure(s) must be closed before this study can be completed.`,
      };
    }
  }
  return { allowed: true };
}

/** Same immutability discipline as `assertTrialEditable` — `stability_studies`
 *  is editable master data at the storage layer, so this application-level
 *  guard is what makes a completed study's protocol/execution record
 *  immutable in practice. */
const TERMINAL_STUDY_STATUSES: readonly StabilityStudyStatus[] = ["completed", "failed", "cancelled", "archived"];

export function assertStudyEditable(study: StabilityStudy): void {
  if (TERMINAL_STUDY_STATUSES.includes(study.status)) {
    throw new Error(
      `Study ${study.code} is ${study.status} and its protocol record is immutable — create a new study instead of editing this one.`,
    );
  }
}

export function resolveStabilityFailure(failure: StabilityFailure, actor: Actor, resolutionNotes: string): StabilityFailure {
  if (actor.kind !== "human") {
    throw new Error("Only a human may resolve a stability failure.");
  }
  const now = new Date().toISOString();
  return {
    ...failure,
    investigationStatus: "closed",
    rootCauseNotes: failure.rootCauseNotes ? `${failure.rootCauseNotes}\n\n${resolutionNotes}` : resolutionNotes,
    resolvedBy: actor.userId,
    resolvedAt: now,
    updatedAt: now,
  };
}

export function hasOpenCriticalFailure(failures: StabilityFailure[]): boolean {
  return failures.some((f) => f.severity === "critical" && f.investigationStatus !== "closed");
}

// ---------------------------------------------------------------------------
// Sample generation
// ---------------------------------------------------------------------------

/**
 * One pull-point sample per (condition × time point × replicate) — the
 * packaging system is the study's own fixed `packagingSkuCode`/snapshot
 * (a study links to exactly one packaging system, spec §10), so it is not
 * a fourth combinatorial axis here. `dueDate` is `study.startDate +
 * timePoint.daysFromStart`, computed once at generation time — deterministic,
 * never re-derived differently later.
 */
export function generateStabilitySamples(
  study: StabilityStudy,
  conditions: StabilityCondition[],
  timePoints: StabilityTimePoint[],
): StabilitySample[] {
  if (!study.startDate) {
    throw new Error("A study needs a startDate before samples can be generated (due dates are computed from it).");
  }
  const start = new Date(study.startDate);
  const samples: StabilitySample[] = [];
  const now = new Date().toISOString();

  for (const condition of conditions) {
    for (const timePoint of timePoints) {
      for (let replicate = 1; replicate <= study.replicatesPerPullPoint; replicate++) {
        const due = new Date(start.getTime());
        due.setDate(due.getDate() + timePoint.daysFromStart);
        samples.push({
          schemaVersion: "1.0",
          id: newId("stabsample"),
          sampleCode: `${study.code}-${condition.code}-${timePoint.code}-R${replicate}`,
          studyId: study.id,
          conditionId: condition.id,
          timePointId: timePoint.id,
          packagingSkuCode: study.packagingSkuCode,
          replicateNumber: replicate,
          status: "planned",
          dueDate: due.toISOString(),
          testDefinitionIds: study.requiredTestDefinitionIds,
          createdAt: now,
        });
      }
    }
  }
  return samples;
}

export type SampleDueState = "unchanged" | "due" | "overdue";

/** Deterministic from `sample.dueDate` and `asOf` alone — never a guess.
 *  Only meaningful while the sample is still `planned`/`stored`; a sample
 *  already `testing`/`completed`/`disposed` is left alone by the caller. */
export function computeSampleDueState(sample: StabilitySample, asOf: Date = new Date()): SampleDueState {
  if (!sample.dueDate) return "unchanged";
  if (sample.status !== "planned" && sample.status !== "stored" && sample.status !== "due" && sample.status !== "overdue") return "unchanged";
  const due = new Date(sample.dueDate);
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const asOfDay = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  if (asOfDay < dueDay) return "unchanged";
  if (asOfDay === dueDay) return "due";
  return "overdue";
}

/** Apply `computeSampleDueState` to every sample that is still awaiting
 *  testing, returning only the ones whose status actually needs to change. */
export function refreshSampleDueStates(samples: StabilitySample[], asOf: Date = new Date()): StabilitySample[] {
  const updated: StabilitySample[] = [];
  for (const sample of samples) {
    const state = computeSampleDueState(sample, asOf);
    if (state === "due" && sample.status !== "due") updated.push({ ...sample, status: "due" });
    else if (state === "overdue" && sample.status !== "overdue") updated.push({ ...sample, status: "overdue" });
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

/** At least this many numeric points, spanning at least this many days,
 *  before a projection is offered at all — see docs/STABILITY_TRENDS.md.
 *  Below this, `computeStabilityTrend` reports the real trend data with no
 *  `projection` field, rather than guessing from too little. */
export const MIN_PROJECTION_POINTS = 3;
export const MIN_PROJECTION_SPAN_DAYS = 14;

export interface ComputeTrendInput {
  studyId: string;
  conditionId: string;
  testDefinitionId: string;
  definition?: TestDefinition;
  /** One `StabilityResult` per time point this condition/test has been run
   *  at so far — the caller resolves sample→result, this function only
   *  needs the (timePoint, mean) pairs. */
  resultsByTimePoint: { timePoint: StabilityTimePoint; result: StabilityResult }[];
}

export function computeStabilityTrend(input: ComputeTrendInput): StabilityTrend {
  const sorted = [...input.resultsByTimePoint].sort((a, b) => a.timePoint.daysFromStart - b.timePoint.daysFromStart);

  const points: StabilityTrendPoint[] = sorted.map(({ timePoint, result }) => ({
    timePointId: timePoint.id,
    daysFromStart: timePoint.daysFromStart,
    mean: result.stats?.mean,
    count: result.stats?.count ?? 0,
  }));

  const numericPoints = points.filter((p) => p.mean !== undefined) as (StabilityTrendPoint & { mean: string })[];
  const initial = numericPoints.find((p) => p.daysFromStart === 0) ?? numericPoints[0];
  const latest = numericPoints[numericPoints.length - 1];
  const previous = numericPoints.length >= 2 ? numericPoints[numericPoints.length - 2] : undefined;

  let absoluteChangeFromInitial: string | undefined;
  let percentageChangeFromInitial: string | undefined;
  let changeFromPrevious: string | undefined;
  let ratePerDay: string | undefined;

  if (initial && latest && initial !== latest) {
    const initialVal = dec(initial.mean);
    const latestVal = dec(latest.mean);
    const diff = latestVal.minus(initialVal);
    absoluteChangeFromInitial = fmt(diff, "measurement");
    percentageChangeFromInitial = initialVal.isZero() ? undefined : fmt(diff.div(initialVal).times(100), "measurement");
  }

  if (previous && latest) {
    const prevVal = dec(previous.mean);
    const latestVal = dec(latest.mean);
    const diff = latestVal.minus(prevVal);
    changeFromPrevious = fmt(diff, "measurement");
    const dayDiff = latest.daysFromStart - previous.daysFromStart;
    if (dayDiff > 0) ratePerDay = fmt(diff.div(dayDiff), "measurement");
  }

  const allMeans = numericPoints.map((p) => dec(p.mean));
  let minimum: string | undefined;
  let maximum: string | undefined;
  let mean: string | undefined;
  let standardDeviation: string | undefined;
  if (allMeans.length > 0) {
    minimum = fmt(allMeans.reduce((m, v) => (v.lessThan(m) ? v : m), allMeans[0]), "measurement");
    maximum = fmt(allMeans.reduce((m, v) => (v.greaterThan(m) ? v : m), allMeans[0]), "measurement");
    const avg = allMeans.reduce((s, v) => s.plus(v), dec(0)).div(allMeans.length);
    mean = fmt(avg, "measurement");
    if (allMeans.length >= 2) {
      const sumSq = allMeans.reduce((s, v) => s.plus(v.minus(avg).pow(2)), dec(0));
      standardDeviation = fmt(sumSq.div(allMeans.length - 1).sqrt(), "measurement");
    }
  }

  let limitCrossing: StabilityTrend["limitCrossing"];
  const min = tryDec(input.definition?.minimum);
  const max = tryDec(input.definition?.maximum);
  for (const p of numericPoints) {
    const v = dec(p.mean);
    if (max !== undefined && v.greaterThan(max)) {
      limitCrossing = { timePointId: p.timePointId, direction: "above_maximum" };
      break;
    }
    if (min !== undefined && v.lessThan(min)) {
      limitCrossing = { timePointId: p.timePointId, direction: "below_minimum" };
      break;
    }
  }

  let projection: StabilityTrend["projection"];
  const span = latest && initial ? latest.daysFromStart - initial.daysFromStart : 0;
  if (
    !limitCrossing &&
    numericPoints.length >= MIN_PROJECTION_POINTS &&
    span >= MIN_PROJECTION_SPAN_DAYS &&
    ratePerDay !== undefined &&
    latest &&
    (min !== undefined || max !== undefined)
  ) {
    const rate = dec(ratePerDay);
    const latestVal = dec(latest.mean);
    let daysToLimit: Decimal | undefined;
    if (max !== undefined && rate.greaterThan(0)) {
      daysToLimit = max.minus(latestVal).div(rate);
    } else if (min !== undefined && rate.lessThan(0)) {
      daysToLimit = min.minus(latestVal).div(rate);
    }
    if (daysToLimit !== undefined && daysToLimit.greaterThan(0)) {
      projection = {
        label: "experimental estimate — not validated — human review required",
        estimatedDaysToLimit: Math.round(daysToLimit.toNumber()),
        basis: `Linear extrapolation of the observed rate of change (${ratePerDay}/day) over ${numericPoints.length} points spanning ${span} days. Not a validated shelf-life prediction.`,
      };
    }
  }

  return {
    schemaVersion: "1.0",
    studyId: input.studyId,
    conditionId: input.conditionId,
    testDefinitionId: input.testDefinitionId,
    points,
    absoluteChangeFromInitial,
    percentageChangeFromInitial,
    changeFromPrevious,
    ratePerDay,
    minimum,
    maximum,
    mean,
    standardDeviation,
    limitCrossing,
    projection,
    computedAt: new Date().toISOString(),
  };
}
