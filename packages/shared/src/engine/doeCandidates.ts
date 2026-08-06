/**
 * Desirability scoring and candidate-condition search.
 *
 * A candidate is a proposed factor setting drawn from within the design's
 * own space, scored by a Derringer-Suich-style weighted desirability over
 * every non-`observe_only` response, using ONLY predictions from a stored,
 * already-fitted `DoeAnalysis` (never a fresh unaudited fit). Applying a
 * candidate never overwrites a saved formula version — it only produces the
 * structured deltas a caller applies to a *working draft* (spec §8/§10).
 */
import {
  doeCandidateSchema,
  type DoeCandidate,
  type DoeConstraint,
  type DoeConstraintStatus,
  type DoeDesign,
  type DoeFactor,
  type DoeFactorSetting,
  type DoePredictedResponse,
  type DoeResponse,
} from "../schemas/doe";
import { continuousActualFromCoded, createSeededRandom, newDoeId } from "./doeDesign";
import { evaluateDoeExpression } from "./doeExpression";
import { predictDoeResponse, type CodedRange } from "./doeAnalysis";
import type { Vector } from "./doeMath";
import { requireHumanActor } from "./regulatoryAuthorization";
import type { Actor } from "../schemas/status";

// ---------------------------------------------------------------------------
// Desirability
// ---------------------------------------------------------------------------

/** One response's desirability in [0,1] for a predicted value, following the
 *  standard Derringer-Suich piecewise transforms per objective. `observe_only`
 *  responses are always fully desirable (they don't drive the search). */
export function calculateResponseDesirability(response: DoeResponse, predictedValue: number): number {
  const shapeExponent = response.desirabilityShape === "concave" ? 0.5 : response.desirabilityShape === "convex" ? 2 : 1;
  const low = response.lowerLimit !== undefined ? Number(response.lowerLimit) : undefined;
  const high = response.upperLimit !== undefined ? Number(response.upperLimit) : undefined;
  const target = response.targetValue !== undefined ? Number(response.targetValue) : undefined;

  switch (response.objective) {
    case "observe_only":
      return 1;
    case "maximize": {
      const lo = low ?? target;
      const hi = high ?? target;
      if (lo === undefined || hi === undefined || hi <= lo) return 0;
      if (predictedValue <= lo) return 0;
      if (predictedValue >= hi) return 1;
      return Math.pow((predictedValue - lo) / (hi - lo), shapeExponent);
    }
    case "minimize": {
      const lo = low ?? target;
      const hi = high ?? target;
      if (lo === undefined || hi === undefined || hi <= lo) return 0;
      if (predictedValue <= lo) return 1;
      if (predictedValue >= hi) return 0;
      return Math.pow((hi - predictedValue) / (hi - lo), shapeExponent);
    }
    case "target": {
      if (target === undefined) return 0;
      const lo = low ?? target;
      const hi = high ?? target;
      if (predictedValue === target) return 1;
      if (predictedValue < target) {
        if (lo >= target || predictedValue <= lo) return 0;
        return Math.pow((predictedValue - lo) / (target - lo), shapeExponent);
      }
      if (hi <= target || predictedValue >= hi) return 0;
      return Math.pow((hi - predictedValue) / (hi - target), shapeExponent);
    }
    case "within_range":
      if (low === undefined || high === undefined) return 0;
      return predictedValue >= low && predictedValue <= high ? 1 : 0;
    default:
      return 0;
  }
}

/** Weighted geometric mean of every response's desirability — the standard
 *  Derringer-Suich overall desirability `D = (prod d_i^w_i)^(1/sum w_i)`.
 *  Any response scoring 0 forces `D = 0` (a single failed objective sinks
 *  the whole candidate, matching the standard convention). */
export function calculateOverallDesirability(responses: readonly DoeResponse[], predictedByResponseId: ReadonlyMap<string, number>): number {
  let weightedLogSum = 0;
  let totalWeight = 0;
  for (const r of responses) {
    if (r.objective === "observe_only") continue;
    const value = predictedByResponseId.get(r.id);
    if (value === undefined) continue;
    const d = calculateResponseDesirability(r, value);
    const w = Number(r.weight) || 1;
    totalWeight += w;
    if (d <= 0) return 0;
    weightedLogSum += w * Math.log(d);
  }
  if (totalWeight === 0) return 0;
  return Math.exp(weightedLogSum / totalWeight);
}

// ---------------------------------------------------------------------------
// Candidate search
// ---------------------------------------------------------------------------

export interface AnalysisForPrediction {
  responseId: string;
  analysisId: string;
  terms: string[];
  coefficients: Vector;
  observedCodedRanges: Record<string, CodedRange>;
}

export interface SearchDoeCandidateSpaceInput {
  factors: readonly DoeFactor[];
  constraints: readonly DoeConstraint[];
  responses: readonly DoeResponse[];
  analyses: readonly AnalysisForPrediction[];
  seed: number;
  candidateCount?: number;
}

export interface RawDoeCandidate {
  factorSettings: DoeFactorSetting[];
  predictedResponses: DoePredictedResponse[];
  desirability: number;
  constraintStatus: DoeConstraintStatus[];
}

/** Random search over the design's own coded space (uniform on [-1,1] for
 *  non-mixture numeric factors, a Dirichlet-like normalized-exponential draw
 *  for mixture components so every sample sums to exactly 1, uniform pick
 *  among levels for categorical factors) — seeded, so the same seed always
 *  returns the same candidate set. Hard-constraint-violating points are
 *  dropped before scoring; soft/warning violations are recorded but kept
 *  visible on the candidate. */
export function searchDoeCandidateSpace(input: SearchDoeCandidateSpaceInput): RawDoeCandidate[] {
  const rng = createSeededRandom(input.seed);
  const count = input.candidateCount ?? 200;
  const mixtureFactors = input.factors.filter((f) => f.isMixtureComponent);
  const nonMixtureNumeric = input.factors.filter((f) => !f.isMixtureComponent && f.factorType !== "categorical" && f.factorType !== "ordinal");
  const categoricalFactors = input.factors.filter((f) => f.factorType === "categorical" || f.factorType === "ordinal");

  const candidates: RawDoeCandidate[] = [];
  for (let i = 0; i < count; i++) {
    const settings: DoeFactorSetting[] = [];
    for (const f of nonMixtureNumeric) {
      const coded = -1 + 2 * rng();
      settings.push({ factorCode: f.factorCode, codedValue: coded.toFixed(4), actualValue: continuousActualFromCoded(f, coded) });
    }
    for (const f of categoricalFactors) {
      const level = f.categoricalLevels[Math.floor(rng() * f.categoricalLevels.length)] ?? f.categoricalLevels[0];
      settings.push({ factorCode: f.factorCode, codedValue: level, actualValue: level });
    }
    if (mixtureFactors.length > 0) {
      const draws = mixtureFactors.map(() => -Math.log(rng() + 1e-12));
      const sum = draws.reduce((s, v) => s + v, 0);
      mixtureFactors.forEach((f, idx) => {
        const fraction = sum > 0 ? draws[idx] / sum : 1 / mixtureFactors.length;
        settings.push({ factorCode: f.factorCode, codedValue: fraction.toString(), actualValue: fraction.toFixed(f.precision) });
      });
    }

    const predictedResponses: DoePredictedResponse[] = [];
    const predictedByResponseId = new Map<string, number>();
    for (const analysis of input.analyses) {
      const { value, isExtrapolated } = predictDoeResponse(analysis.terms, analysis.coefficients, settings, analysis.observedCodedRanges);
      predictedResponses.push({ responseId: analysis.responseId, predictedValue: value, isExtrapolated, analysisId: analysis.analysisId });
      predictedByResponseId.set(analysis.responseId, value);
    }

    const vars: Record<string, number> = {};
    for (const s of settings) {
      const n = Number(s.actualValue);
      if (Number.isFinite(n)) vars[s.factorCode] = n;
    }
    const constraintStatus: DoeConstraintStatus[] = [];
    let violatesHard = false;
    for (const c of input.constraints) {
      const evaluated = evaluateDoeExpression(c.expression, vars);
      const satisfied = evaluated.ok ? (evaluated.satisfied ?? true) : false;
      constraintStatus.push({ constraintId: c.id, satisfied, severity: c.severity, message: evaluated.ok ? undefined : evaluated.error });
      if (!satisfied && c.severity === "hard") violatesHard = true;
    }
    if (violatesHard) continue;

    const desirability = calculateOverallDesirability(input.responses, predictedByResponseId);
    candidates.push({ factorSettings: settings, predictedResponses, desirability, constraintStatus });
  }
  return candidates;
}

/** Sorts by desirability (descending) and assigns 1-based ranks. Ties keep
 *  their relative search order (a stable sort), so re-ranking the same
 *  search result is itself deterministic. */
export function rankDoeCandidates(candidates: readonly RawDoeCandidate[]): (RawDoeCandidate & { rank: number })[] {
  return [...candidates]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.desirability - a.c.desirability || a.i - b.i)
    .map(({ c }, index) => ({ ...c, rank: index + 1 }));
}

export function validateDoeCandidate(candidate: { constraintStatus: readonly DoeConstraintStatus[] }): { valid: boolean; issues: string[] } {
  const hardViolations = candidate.constraintStatus.filter((c) => !c.satisfied && c.severity === "hard");
  return { valid: hardViolations.length === 0, issues: hardViolations.map((v) => v.message ?? `Constraint ${v.constraintId} violated.`) };
}

export interface CreateDoeCandidatesInput {
  studyId: string;
  studyRevision: number;
  analysisIds: string[];
  ranked: readonly (RawDoeCandidate & { rank: number })[];
}

/** Persists a ranked candidate set as real `DoeCandidate` records — proposal
 *  only (`status: "proposed"`); shortlisting/selecting/applying are separate,
 *  later human actions with their own audit events. */
export function createDoeCandidates(input: CreateDoeCandidatesInput, actor: Actor): DoeCandidate[] {
  requireHumanActor(actor, "generate DOE candidates");
  const now = new Date().toISOString();
  return input.ranked.map((c) =>
    doeCandidateSchema.parse({
      schemaVersion: "1.0",
      id: newDoeId("doecandidate"),
      studyId: input.studyId,
      studyRevision: input.studyRevision,
      analysisIds: input.analysisIds,
      factorSettings: c.factorSettings,
      predictedResponses: c.predictedResponses,
      desirability: c.desirability,
      constraintStatus: c.constraintStatus,
      rank: c.rank,
      status: "proposed",
      createdBy: actor.userId,
      createdAt: now,
    }),
  );
}

// ---------------------------------------------------------------------------
// Applying a candidate to a working draft
// ---------------------------------------------------------------------------

export interface DoeCandidateMaterialQuantity {
  materialId: string;
  /** The candidate's real, engineering-unit value for this material — a
   *  decimal string, matching the rest of the app's `decimalString` convention. */
  quantity: string;
}

export interface DoeCandidateProcessSetting {
  key: string;
  value: string;
  unit?: string;
}

export interface DoeCandidateApplication {
  materialQuantities: DoeCandidateMaterialQuantity[];
  processSettings: DoeCandidateProcessSetting[];
  lineage: { candidateId: string; analysisIds: string[]; studyId: string; designId: string };
}

/** Resolves a candidate's factor settings back to real formula-material
 *  quantities and process settings via each factor's `sourceType`/
 *  `sourceEntityId` — a pure, side-effect-free mapping. The caller (the
 *  Laboratory/Formulation-integration layer, task #119) uses this to update
 *  a WORKING DRAFT through the existing draft-composition workflow; this
 *  function never touches a saved version and never mutates anything itself
 *  — spec §8/§10: "applying a candidate only creates/updates a working
 *  draft, never overwrites a saved version." */
export function applyDoeCandidateToDraft(candidate: DoeCandidate, factors: readonly DoeFactor[], design: DoeDesign): DoeCandidateApplication {
  const materialQuantities: DoeCandidateMaterialQuantity[] = [];
  const processSettings: DoeCandidateProcessSetting[] = [];
  for (const setting of candidate.factorSettings) {
    const factor = factors.find((f) => f.factorCode === setting.factorCode);
    if (!factor) continue;
    if (factor.sourceType === "formula_material" && factor.sourceEntityId) {
      materialQuantities.push({ materialId: factor.sourceEntityId, quantity: setting.actualValue });
    } else if (factor.sourceType !== "formula_total") {
      processSettings.push({ key: factor.sourceEntityId ?? factor.factorCode, value: setting.actualValue, unit: factor.unit });
    }
  }
  return {
    materialQuantities,
    processSettings,
    lineage: { candidateId: candidate.id, analysisIds: candidate.analysisIds, studyId: candidate.studyId, designId: design.id },
  };
}
