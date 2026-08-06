/**
 * Deterministic DOE statistical-analysis engine. Every number here comes
 * from `doeMath.ts`'s OLS/matrix primitives applied to the study's own
 * recorded observations — never from an AI model, never fabricated. A
 * response that cannot be estimated (too few runs, a singular model,
 * missing data) produces an explicit, visible failure/warning, never a
 * silently-guessed number. Spec §7: "AI may explain results, but AI must
 * not be the source of coefficients, ANOVA or fit metrics."
 */
import {
  DOE_CONTINUOUS_ANALYSIS_RESPONSE_TYPES,
  doeAnalysisSchema,
  type DoeAnalysis,
  type DoeAnalysisType,
  type DoeAnovaRow,
  type DoeCoefficient,
  type DoeDesign,
  type DoeEffectEstimate,
  type DoeFactor,
  type DoeFactorSetting,
  type DoeObservation,
  type DoeOutlierSuggestion,
  type DoeResidualPoint,
  type DoeResponse,
  type DoeRun,
} from "../schemas/doe";
import { cooksDistances, fitOrdinaryLeastSquares, type Matrix, type Vector } from "./doeMath";
import { newDoeId } from "./doeDesign";
import { requireHumanActor } from "./regulatoryAuthorization";
import type { Actor } from "../schemas/status";

// ---------------------------------------------------------------------------
// Statistical distributions (Numerical-Recipes-style regularized incomplete
// beta / Lanczos log-gamma) — the standard closed-form building blocks
// needed for honest F-test and t-test p-values. No dependency added; this
// is ~40 lines of well-known, exhaustively-testable numerical code.
// ---------------------------------------------------------------------------

function logGamma(x: number): number {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-9;
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta function I_x(a,b), in [0,1]. */
export function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betaContinuedFraction(a, b, x)) / a;
  return 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Upper-tail p-value for an F statistic with (df1, df2) degrees of freedom. */
export function fDistributionUpperTailPValue(f: number, df1: number, df2: number): number | undefined {
  if (!(f >= 0) || df1 <= 0 || df2 <= 0) return undefined;
  if (!Number.isFinite(f)) return 0;
  return regularizedIncompleteBeta(df2 / 2, df1 / 2, df2 / (df2 + df1 * f));
}

/** Two-sided p-value for a t statistic with `df` degrees of freedom. */
export function tDistributionTwoSidedPValue(t: number, df: number): number | undefined {
  if (df <= 0) return undefined;
  return regularizedIncompleteBeta(df / 2, 0.5, df / (df + t * t));
}

/** Inverse of the two-sided t CDF via bisection (the forward CDF above is
 *  monotonic in |t|, so bisection is exact enough for a 95% CI in <100
 *  iterations without needing a closed-form inverse). */
function inverseTwoSidedT(alpha: number, df: number): number {
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const p = tDistributionTwoSidedPValue(mid, df) ?? 0;
    if (p > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// Model terms + design matrix
// ---------------------------------------------------------------------------

export type DoeModelType = "main" | "factorial" | "quadratic" | "mixture_linear" | "mixture_quadratic";

export function modelTypeForAnalysisType(analysisType: DoeAnalysisType): DoeModelType {
  switch (analysisType) {
    case "quadratic_response_surface":
      return "quadratic";
    case "factorial":
      return "factorial";
    case "mixture_model":
      return "mixture_linear";
    case "main_effects":
    case "screening":
    default:
      return "main";
  }
}

function modelNumericFactors(factors: readonly DoeFactor[], isMixture: boolean): DoeFactor[] {
  const numeric = factors.filter((f) => f.factorType !== "categorical" && f.factorType !== "ordinal");
  return isMixture ? numeric.filter((f) => f.isMixtureComponent) : numeric;
}

/** The exact list of model term names for a given factor set + model type —
 *  shared by `buildDesignMatrix` (per-run rows) and `predictDoeResponse`
 *  (a single new point), so a prediction always uses precisely the terms
 *  the fit was estimated with. */
export function deriveModelTerms(factors: readonly DoeFactor[], modelType: DoeModelType): string[] {
  const isMixture = modelType === "mixture_linear" || modelType === "mixture_quadratic";
  const categoricalFactors = factors.filter((f) => f.factorType === "categorical" || f.factorType === "ordinal");
  const numericFactors = modelNumericFactors(factors, isMixture);

  const terms: string[] = [];
  if (!isMixture) terms.push("intercept");
  for (const f of numericFactors) terms.push(f.factorCode);
  if (!isMixture) {
    for (const f of categoricalFactors) {
      for (const level of f.categoricalLevels.slice(1)) terms.push(`${f.factorCode}:${level}`);
    }
  }
  if (modelType === "factorial" || modelType === "quadratic" || modelType === "mixture_quadratic") {
    for (let i = 0; i < numericFactors.length; i++) {
      for (let j = i + 1; j < numericFactors.length; j++) {
        terms.push(`${numericFactors[i].factorCode}*${numericFactors[j].factorCode}`);
      }
    }
  }
  if (modelType === "quadratic") {
    for (const f of numericFactors) terms.push(`${f.factorCode}^2`);
  }
  return terms;
}

/** Evaluates every model term for one point's factor settings — the single
 *  place that knows how to read a term name (`"intercept"`, a plain factor
 *  code, `"code:level"`, `"a*b"`, `"code^2"`) back into a number. */
export function evaluateModelTerms(terms: readonly string[], factorSettings: readonly DoeFactorSetting[]): Vector {
  const numericValue = (code: string): number => {
    const setting = factorSettings.find((s) => s.factorCode === code);
    if (!setting) return 0;
    const n = Number(setting.codedValue);
    return Number.isFinite(n) ? n : 0;
  };
  const rawValue = (code: string): string | undefined => factorSettings.find((s) => s.factorCode === code)?.codedValue;

  return terms.map((term) => {
    if (term === "intercept") return 1;
    if (term.includes(":")) {
      const [code, level] = term.split(":");
      return rawValue(code) === level ? 1 : 0;
    }
    if (term.endsWith("^2")) {
      const code = term.slice(0, -2);
      const v = numericValue(code);
      return v * v;
    }
    if (term.includes("*")) {
      const [a, b] = term.split("*");
      return numericValue(a) * numericValue(b);
    }
    return numericValue(term);
  });
}

export function buildDesignMatrix(runs: readonly DoeRun[], factors: readonly DoeFactor[], modelType: DoeModelType): { matrix: Matrix; terms: string[] } {
  const terms = deriveModelTerms(factors, modelType);
  const matrix = runs.map((run) => evaluateModelTerms(terms, run.factorSettings));
  return { matrix, terms };
}

// ---------------------------------------------------------------------------
// Model fitting wrappers
// ---------------------------------------------------------------------------

export interface DoeModelFitSuccess {
  ok: true;
  terms: string[];
  coefficients: Vector;
  fitted: Vector;
  residuals: Vector;
  leverage: Vector;
  xtxInverse: Matrix;
  rss: number;
  residualDegreesOfFreedom: number;
}
export interface DoeModelFitFailure {
  ok: false;
  terms: string[];
  error: string;
}
export type DoeModelFitResult = DoeModelFitSuccess | DoeModelFitFailure;

function fitModel(runs: readonly DoeRun[], factors: readonly DoeFactor[], y: Vector, modelType: DoeModelType): DoeModelFitResult {
  const { matrix, terms } = buildDesignMatrix(runs, factors, modelType);
  const ols = fitOrdinaryLeastSquares(matrix, y);
  if (!ols.ok) return { ok: false, terms, error: ols.error };
  return { terms, ...ols };
}

export function fitFactorialModel(runs: readonly DoeRun[], factors: readonly DoeFactor[], y: Vector): DoeModelFitResult {
  return fitModel(runs, factors, y, "factorial");
}

export function fitResponseSurfaceModel(runs: readonly DoeRun[], factors: readonly DoeFactor[], y: Vector): DoeModelFitResult {
  return fitModel(runs, factors, y, "quadratic");
}

export function fitMixtureModel(runs: readonly DoeRun[], factors: readonly DoeFactor[], y: Vector, degree: "linear" | "quadratic" = "linear"): DoeModelFitResult {
  return fitModel(runs, factors, y, degree === "linear" ? "mixture_linear" : "mixture_quadratic");
}

// ---------------------------------------------------------------------------
// ANOVA, fit metrics, residual diagnostics, outliers
// ---------------------------------------------------------------------------

export function calculateAnova(y: Vector, fitted: Vector, p: number, hasIntercept: boolean, replicateGroupKeys?: readonly string[]): DoeAnovaRow[] {
  const n = y.length;
  const mean = hasIntercept ? y.reduce((s, v) => s + v, 0) / n : 0;
  const sst = y.reduce((s, v) => s + (v - mean) * (v - mean), 0);
  const sse = y.reduce((s, v, i) => s + (v - fitted[i]) * (v - fitted[i]), 0);
  const ssr = sst - sse;
  const dfModel = p - (hasIntercept ? 1 : 0);
  const dfResidual = n - p;
  const dfTotal = n - (hasIntercept ? 1 : 0);
  const msr = dfModel > 0 ? ssr / dfModel : undefined;
  const mse = dfResidual > 0 ? sse / dfResidual : undefined;
  const fStat = msr !== undefined && mse !== undefined && mse > 0 ? msr / mse : undefined;
  const pValue = fStat !== undefined && dfModel > 0 && dfResidual > 0 ? fDistributionUpperTailPValue(fStat, dfModel, dfResidual) : undefined;

  const rows: DoeAnovaRow[] = [
    { source: "Model", sumOfSquares: ssr, degreesOfFreedom: dfModel, meanSquare: msr, fStatistic: fStat, pValue },
    { source: "Residual", sumOfSquares: sse, degreesOfFreedom: dfResidual, meanSquare: mse },
    { source: "Total", sumOfSquares: sst, degreesOfFreedom: dfTotal },
  ];

  if (replicateGroupKeys) {
    const groups = new Map<string, number[]>();
    replicateGroupKeys.forEach((key, i) => {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(i);
    });
    let pureErrorSS = 0;
    let dfPureError = 0;
    for (const idxs of groups.values()) {
      if (idxs.length < 2) continue;
      const groupMean = idxs.reduce((s, i) => s + y[i], 0) / idxs.length;
      pureErrorSS += idxs.reduce((s, i) => s + (y[i] - groupMean) * (y[i] - groupMean), 0);
      dfPureError += idxs.length - 1;
    }
    if (dfPureError > 0) {
      const lofSS = sse - pureErrorSS;
      const dfLof = dfResidual - dfPureError;
      if (dfLof > 0) {
        const msLof = lofSS / dfLof;
        const msPure = pureErrorSS / dfPureError;
        const fLof = msPure > 0 ? msLof / msPure : undefined;
        const pLof = fLof !== undefined ? fDistributionUpperTailPValue(fLof, dfLof, dfPureError) : undefined;
        rows.push({ source: "Lack of Fit", sumOfSquares: lofSS, degreesOfFreedom: dfLof, meanSquare: msLof, fStatistic: fLof, pValue: pLof });
        rows.push({ source: "Pure Error", sumOfSquares: pureErrorSS, degreesOfFreedom: dfPureError, meanSquare: msPure });
      }
    }
  }

  return rows;
}

export interface DoeFitMetricsResult {
  rSquared?: number;
  adjustedRSquared?: number;
  rmse?: number;
  mae?: number;
  residualDegreesOfFreedom?: number;
  lackOfFitPValue?: number;
}

export function calculateFitMetrics(y: Vector, fitted: Vector, p: number, hasIntercept: boolean, lackOfFitPValue?: number): DoeFitMetricsResult {
  const n = y.length;
  const mean = hasIntercept ? y.reduce((s, v) => s + v, 0) / n : 0;
  const sst = y.reduce((s, v) => s + (v - mean) * (v - mean), 0);
  const residuals = y.map((v, i) => v - fitted[i]);
  const sse = residuals.reduce((s, r) => s + r * r, 0);
  const dfResidual = n - p;
  const dfTotal = n - (hasIntercept ? 1 : 0);
  const rSquared = sst > 0 ? 1 - sse / sst : undefined;
  const adjustedRSquared = rSquared !== undefined && dfResidual > 0 && dfTotal > 0 ? 1 - (1 - rSquared) * (dfTotal / dfResidual) : undefined;
  const rmse = dfResidual > 0 ? Math.sqrt(sse / dfResidual) : undefined;
  const mae = n > 0 ? residuals.reduce((s, r) => s + Math.abs(r), 0) / n : undefined;
  return {
    rSquared,
    adjustedRSquared,
    rmse,
    mae,
    residualDegreesOfFreedom: dfResidual >= 0 ? dfResidual : undefined,
    lackOfFitPValue,
  };
}

export function calculateResidualDiagnostics(runIds: readonly string[], y: Vector, fitted: Vector, residuals: Vector, leverage: Vector, p: number, mse: number): DoeResidualPoint[] {
  const cooks = cooksDistances(residuals, leverage, p, mse);
  return runIds.map((runId, i) => ({
    runId,
    observed: y[i],
    predicted: fitted[i],
    residual: residuals[i],
    leverage: leverage[i],
    cooksDistance: Number.isFinite(cooks[i]) ? cooks[i] : undefined,
    standardizedResidual: mse > 0 && leverage[i] < 1 ? residuals[i] / Math.sqrt(mse * (1 - leverage[i])) : undefined,
  }));
}

/** Suggests (never auto-excludes — spec §7/§9.8) runs whose standardized
 *  residual or Cook's distance clears a standard influence threshold. */
export function suggestOutliers(diagnostics: readonly DoeResidualPoint[]): DoeOutlierSuggestion[] {
  const suggestions: DoeOutlierSuggestion[] = [];
  for (const d of diagnostics) {
    const reasons: string[] = [];
    if (d.standardizedResidual !== undefined && Math.abs(d.standardizedResidual) > 2.5) {
      reasons.push(`Standardized residual ${d.standardizedResidual.toFixed(2)} exceeds the typical |2.5| flag threshold.`);
    }
    if (d.cooksDistance !== undefined && d.cooksDistance > 1) {
      reasons.push(`Cook's distance ${d.cooksDistance.toFixed(2)} exceeds the standard influence threshold of 1.`);
    }
    if (reasons.length > 0) {
      suggestions.push({ runId: d.runId, reason: reasons.join(" "), standardizedResidual: d.standardizedResidual, cooksDistance: d.cooksDistance });
    }
  }
  return suggestions;
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

export interface CodedRange {
  min: number;
  max: number;
}

/** The observed coded range of every numeric factor across a design's runs
 *  — used to flag a prediction as extrapolated when it falls outside the
 *  space the model was actually fit on (spec §8: "extrapolation warnings"). */
export function deriveObservedCodedRanges(runs: readonly DoeRun[]): Record<string, CodedRange> {
  const ranges: Record<string, CodedRange> = {};
  for (const run of runs) {
    for (const setting of run.factorSettings) {
      const v = Number(setting.codedValue);
      if (!Number.isFinite(v)) continue;
      const existing = ranges[setting.factorCode];
      if (!existing) ranges[setting.factorCode] = { min: v, max: v };
      else {
        existing.min = Math.min(existing.min, v);
        existing.max = Math.max(existing.max, v);
      }
    }
  }
  return ranges;
}

export interface PredictDoeResponseResult {
  value: number;
  isExtrapolated: boolean;
}

export function predictDoeResponse(terms: readonly string[], coefficients: Vector, factorSettings: readonly DoeFactorSetting[], observedCodedRanges: Record<string, CodedRange>): PredictDoeResponseResult {
  const rowValues = evaluateModelTerms(terms, factorSettings);
  const value = rowValues.reduce((sum, v, i) => sum + v * coefficients[i], 0);
  const epsilon = 1e-6;
  let isExtrapolated = false;
  for (const setting of factorSettings) {
    const range = observedCodedRanges[setting.factorCode];
    if (!range) continue;
    const v = Number(setting.codedValue);
    if (!Number.isFinite(v)) continue;
    if (v < range.min - epsilon || v > range.max + epsilon) isExtrapolated = true;
  }
  return { value, isExtrapolated };
}

export function comparePredictedAndObserved(terms: readonly string[], coefficients: Vector, runs: readonly DoeRun[], observedByRunId: ReadonlyMap<string, number>): DoeResidualPoint[] {
  const points: DoeResidualPoint[] = [];
  for (const run of runs) {
    const observed = observedByRunId.get(run.id);
    if (observed === undefined) continue;
    const rowValues = evaluateModelTerms(terms, run.factorSettings);
    const predicted = rowValues.reduce((sum, v, i) => sum + v * coefficients[i], 0);
    points.push({ runId: run.id, observed, predicted, residual: observed - predicted });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Estimability
// ---------------------------------------------------------------------------

export function validateAnalysisEstimability(runCount: number, termCount: number): { valid: boolean; message?: string } {
  if (runCount <= termCount) {
    return { valid: false, message: `${runCount} included run(s) cannot estimate ${termCount} model term(s) — add more runs, remove terms, or simplify the model.` };
  }
  if (runCount - termCount < 3) {
    return { valid: true, message: `Only ${runCount - termCount} residual degree(s) of freedom — fit metrics and p-values will be unstable with this few.` };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Full analysis assembly
// ---------------------------------------------------------------------------

export interface CreateDoeAnalysisInput {
  studyId: string;
  studyRevision: number;
  design: DoeDesign;
  runs: readonly DoeRun[];
  observations: readonly DoeObservation[];
  response: DoeResponse;
  analysisType: DoeAnalysisType;
  mixtureDegree?: "linear" | "quadratic";
  supersedesAnalysisId?: string;
}

/** Coefficient statistics (SE/t/p/CI) computed from `(X'X)^-1`, `mse`, and
 *  residual degrees of freedom — every field a real computed value, `undefined`
 *  where it cannot be honestly computed (e.g. zero residual df). */
function coefficientRows(terms: readonly string[], coefficients: Vector, xtxInverse: Matrix, mse: number, dfResidual: number): DoeCoefficient[] {
  const tCrit = dfResidual > 0 ? inverseTwoSidedT(0.05, dfResidual) : undefined;
  return terms.map((term, i) => {
    const variance = mse * xtxInverse[i][i];
    const se = variance > 0 ? Math.sqrt(variance) : undefined;
    const t = se && se > 0 ? coefficients[i] / se : undefined;
    const pValue = t !== undefined && dfResidual > 0 ? tDistributionTwoSidedPValue(t, dfResidual) : undefined;
    const ci = se !== undefined && tCrit !== undefined ? [coefficients[i] - tCrit * se, coefficients[i] + tCrit * se] : undefined;
    return {
      term,
      estimate: coefficients[i],
      standardError: se,
      tStatistic: t,
      pValue,
      confidenceIntervalLow: ci?.[0],
      confidenceIntervalHigh: ci?.[1],
    };
  });
}

function effectEstimateRows(terms: readonly string[], coefficients: Vector): DoeEffectEstimate[] {
  return terms
    .map((term, i) => ({ term, effect: 2 * coefficients[i], absoluteEffect: Math.abs(2 * coefficients[i]) }))
    .filter((row) => row.term !== "intercept");
}

/** The single entry point that turns a study's recorded observations for
 *  one response into a full, honest `DoeAnalysis` record. Refuses (throws)
 *  rather than fabricating when the response type can't go through OLS, or
 *  the model is not estimable from the included runs. Missing/excluded
 *  observations are dropped from the fit but always listed — never treated
 *  as zero (spec §11: "never treat missing future time points as zero"). */
export function createDoeAnalysis(input: CreateDoeAnalysisInput, actor: Actor): DoeAnalysis {
  requireHumanActor(actor, "run a DOE analysis");

  if (!DOE_CONTINUOUS_ANALYSIS_RESPONSE_TYPES.includes(input.response.responseType)) {
    throw new Error(`Response "${input.response.name}" has type "${input.response.responseType}" — only continuous/integer responses are regressed. Use a categorical-comparison summary for this response type instead.`);
  }

  const observationsByRunId = new Map(input.observations.filter((o) => o.responseId === input.response.id).map((o) => [o.runId, o]));

  const includedRuns: DoeRun[] = [];
  const excludedRunIds: string[] = [];
  const warnings: string[] = [];
  const y: number[] = [];

  for (const run of input.runs) {
    const obs = observationsByRunId.get(run.id);
    if (!obs) {
      excludedRunIds.push(run.id);
      warnings.push(`Run ${run.runNumber}: no observation recorded for this response — excluded from the fit (not treated as zero).`);
      continue;
    }
    if (obs.status === "missing") {
      excludedRunIds.push(run.id);
      warnings.push(`Run ${run.runNumber}: observation is marked missing — excluded from the fit (not treated as zero).`);
      continue;
    }
    if (obs.status === "excluded" || obs.status === "invalid") {
      excludedRunIds.push(run.id);
      warnings.push(`Run ${run.runNumber}: observation is ${obs.status}${obs.exclusionReason ? ` (${obs.exclusionReason})` : ""} — excluded from the fit.`);
      continue;
    }
    if (obs.value === undefined) {
      excludedRunIds.push(run.id);
      warnings.push(`Run ${run.runNumber}: observation has no numeric value — excluded from the fit.`);
      continue;
    }
    includedRuns.push(run);
    y.push(Number(obs.value));
    if (obs.status === "outlier_flagged") warnings.push(`Run ${run.runNumber}: observation is flagged as a possible outlier but is still included — outliers are never auto-excluded.`);
  }

  const modelType = input.analysisType === "mixture_model" ? (input.mixtureDegree === "quadratic" ? "mixture_quadratic" : "mixture_linear") : modelTypeForAnalysisType(input.analysisType);
  const isMixture = modelType === "mixture_linear" || modelType === "mixture_quadratic";
  const terms = deriveModelTerms(input.design.factorSnapshot, modelType);

  const estimability = validateAnalysisEstimability(includedRuns.length, terms.length);
  if (!estimability.valid) {
    throw new Error(`Cannot run analysis: ${estimability.message}`);
  }
  if (estimability.message) warnings.push(estimability.message);

  const fit = fitModel(includedRuns, input.design.factorSnapshot, y, modelType);
  if (!fit.ok) {
    throw new Error(`Analysis failed: ${fit.error}`);
  }

  const p = terms.length;
  const mse = fit.residualDegreesOfFreedom > 0 ? fit.rss / fit.residualDegreesOfFreedom : 0;
  const replicateGroupKeys = includedRuns.map((run) => run.factorSettings.map((s) => `${s.factorCode}=${s.codedValue}`).sort().join("|"));
  const anova = calculateAnova(y, fit.fitted, p, !isMixture, replicateGroupKeys);
  const lackOfFitRow = anova.find((row) => row.source === "Lack of Fit");
  const fitMetrics = calculateFitMetrics(y, fit.fitted, p, !isMixture, lackOfFitRow?.pValue);
  const diagnostics = calculateResidualDiagnostics(
    includedRuns.map((r) => r.id),
    y,
    fit.fitted,
    fit.residuals,
    fit.leverage,
    p,
    mse,
  );
  const outliers = suggestOutliers(diagnostics);
  for (const o of outliers) warnings.push(`Run flagged as a possible outlier: ${o.reason}`);

  const coefficients = coefficientRows(terms, fit.coefficients, fit.xtxInverse, mse, fit.residualDegreesOfFreedom);
  const effectEstimates = effectEstimateRows(terms, fit.coefficients);

  const now = new Date().toISOString();
  const analysis: DoeAnalysis = doeAnalysisSchema.parse({
    schemaVersion: "1.0",
    id: newDoeId("doeanalysis"),
    studyId: input.studyId,
    studyRevision: input.studyRevision,
    designId: input.design.id,
    responseId: input.response.id,
    analysisType: input.analysisType,
    includedRunIds: includedRuns.map((r) => r.id),
    excludedRunIds,
    modelTerms: terms,
    coefficients,
    effectEstimates,
    anova,
    diagnostics,
    fitMetrics,
    predictions: diagnostics,
    warnings,
    createdBy: actor.userId,
    createdAt: now,
    supersedesAnalysisId: input.supersedesAnalysisId,
  });
  return analysis;
}
