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
  type DoeObservation,
  type DoePredictedResponse,
  type DoeResponse,
  type DoeRun,
  type DoeStudy,
} from "../schemas/doe";
import type { FormulationVersion } from "../schemas/formulation";
import type { InventoryRecord } from "../schemas/materials";
import type { RawMaterial } from "../schemas/materials";
import type { MaterialPrice } from "../schemas/materials";
import type { ExchangeRate } from "../schemas/costing";
import type { SafetyRule } from "../schemas/safety";
import type { RegulatoryJurisdiction, RegulatoryRule } from "../schemas/regulatory";
import { continuousActualFromCoded, createSeededRandom, newDoeId } from "./doeDesign";
import { evaluateDoeExpression } from "./doeExpression";
import { predictDoeResponse, type CodedRange } from "./doeAnalysis";
import type { Vector } from "./doeMath";
import { evaluateMaterialAvailability } from "./inventoryAvailability";
import { convertUnit } from "./unitConversion";
import { evaluateSafety } from "./safety";
import { evaluateRegulatory } from "./regulatoryRules";
import { applyDoeFactorsToLines } from "./doeLabIntegration";
import { requireHumanActor } from "./regulatoryAuthorization";
import { buildCostSnapshot } from "./cost";
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

export const DOE_EXPERIMENT_SPACE_POLICY_VERSION = "doe-experiment-space/v1" as const;
export const DOE_RECOMMENDATION_POLICY_VERSION = "doe-recommendation/v1" as const;
export const MAX_DOE_EXPERIMENT_CANDIDATES = 500;

/** A reproducible configuration over an existing frozen DOE design. This is
 *  deliberately metadata for DoeCandidate records, not a second experiment
 *  or recommendation model. */
export interface DoeExperimentSpace {
  policyVersion: typeof DOE_EXPERIMENT_SPACE_POLICY_VERSION;
  studyId: string;
  studyRevision: number;
  designId: string;
  sourceFormulaVersionId: string;
  seed: number;
  candidateCount: number;
  manipulatedFactorCodes: string[];
  unchangedFormulaLineIds: string[];
}

export interface DefineDoeExperimentSpaceInput {
  study: DoeStudy;
  design: DoeDesign;
  baselineFormulaVersion: FormulationVersion;
  factors: readonly DoeFactor[];
  constraints: readonly DoeConstraint[];
  responses: readonly DoeResponse[];
  seed: number;
  candidateCount?: number;
}

/** Validates lineage and every search dimension before defining a bounded
 *  candidate space. Missing ranges/levels are errors; they are never filled
 *  with defaults here. */
export function defineDoeExperimentSpace(input: DefineDoeExperimentSpaceInput): DoeExperimentSpace {
  const { study, design, baselineFormulaVersion: baseline } = input;
  if (study.id !== design.studyId || study.revision !== design.studyRevision) {
    throw new Error("DOE design does not belong to the current study revision.");
  }
  if (study.baselineFormulaVersionId !== baseline.id || study.formulationId !== baseline.formulationId) {
    throw new Error("DOE study baseline does not match the supplied saved formula version.");
  }
  if (!Number.isInteger(input.seed) || input.seed !== design.seed) {
    throw new Error("Candidate-space seed must match the frozen DOE design seed.");
  }
  const candidateCount = input.candidateCount ?? 200;
  if (!Number.isInteger(candidateCount) || candidateCount < 1 || candidateCount > MAX_DOE_EXPERIMENT_CANDIDATES) {
    throw new Error(`Candidate count must be an integer from 1 to ${MAX_DOE_EXPERIMENT_CANDIDATES}.`);
  }
  if (input.factors.length === 0) throw new Error("Candidate space requires at least one DOE factor.");

  const snapshotById = new Map(design.factorSnapshot.map((factor) => [factor.id, factor]));
  const factorCodes = new Set<string>();
  for (const factor of input.factors) {
    if (factor.studyId !== study.id || factor.studyRevision !== study.revision) {
      throw new Error(`DOE factor ${factor.factorCode} belongs to a different study revision.`);
    }
    const snapshot = snapshotById.get(factor.id);
    if (!snapshot || snapshot.factorCode !== factor.factorCode || snapshot.sourceType !== factor.sourceType || snapshot.sourceEntityId !== factor.sourceEntityId) {
      throw new Error(`DOE factor ${factor.factorCode} is not present in the frozen design snapshot.`);
    }
    if (factorCodes.has(factor.factorCode)) throw new Error(`Duplicate DOE factor code: ${factor.factorCode}.`);
    factorCodes.add(factor.factorCode);
    if (!factor.isControlled) throw new Error(`Uncontrolled DOE factor ${factor.factorCode} cannot be manipulated.`);

    if (factor.factorType === "categorical" || factor.factorType === "ordinal") {
      if (factor.categoricalLevels.length < 2 || new Set(factor.categoricalLevels).size !== factor.categoricalLevels.length) {
        throw new Error(`DOE factor ${factor.factorCode} needs at least two unique declared levels.`);
      }
    } else {
      const low = factor.lowValue === undefined ? Number.NaN : Number(factor.lowValue);
      const high = factor.highValue === undefined ? Number.NaN : Number(factor.highValue);
      const center = factor.centerValue === undefined ? (low + high) / 2 : Number(factor.centerValue);
      if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(center) || low >= high || center < low || center > high) {
        throw new Error(`DOE factor ${factor.factorCode} needs finite, ordered low/center/high values.`);
      }
      if (factor.factorType === "integer" && (![low, center, high].every(Number.isInteger))) {
        throw new Error(`Integer DOE factor ${factor.factorCode} must use integer low/center/high values.`);
      }
    }
  }
  if (input.factors.length !== design.factorSnapshot.length || input.constraints.length !== design.constraintSnapshot.length || input.responses.length !== design.responseSnapshot.length) {
    throw new Error("Candidate space inputs must match every factor, constraint, and response in the frozen design snapshot.");
  }
  for (const [name, records, snapshots] of [
    ["constraint", input.constraints, design.constraintSnapshot],
    ["response", input.responses, design.responseSnapshot],
  ] as const) {
    const snapshotIds = new Set(snapshots.map((record) => record.id));
    for (const record of records) {
      if (record.studyId !== study.id || record.studyRevision !== study.revision || !snapshotIds.has(record.id)) {
        throw new Error(`DOE ${name} ${record.id} is not part of the frozen design snapshot.`);
      }
    }
  }

  const manipulatedMaterials = new Set(input.factors.filter((factor) => factor.sourceType === "formula_material").map((factor) => factor.sourceEntityId).filter((id): id is string => Boolean(id)));
  return {
    policyVersion: DOE_EXPERIMENT_SPACE_POLICY_VERSION,
    studyId: study.id,
    studyRevision: study.revision,
    designId: design.id,
    sourceFormulaVersionId: baseline.id,
    seed: input.seed,
    candidateCount,
    manipulatedFactorCodes: [...input.factors].map((factor) => factor.factorCode).sort(),
    unchangedFormulaLineIds: baseline.lines.filter((line) => !line.materialId || !manipulatedMaterials.has(line.materialId)).map((line) => line.id).sort(),
  };
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
  const count = input.candidateCount ?? 200;
  if (!Number.isInteger(input.seed)) throw new Error("Candidate-space seed must be an integer.");
  if (!Number.isInteger(count) || count < 1 || count > MAX_DOE_EXPERIMENT_CANDIDATES) {
    throw new Error(`Candidate count must be an integer from 1 to ${MAX_DOE_EXPERIMENT_CANDIDATES}.`);
  }
  if (input.factors.length === 0) throw new Error("Candidate space requires at least one DOE factor.");
  const rng = createSeededRandom(input.seed);
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

export interface DoeCandidateFeasibility {
  policyVersion: "doe-feasibility/v1";
  evaluatedAt: string;
  status: "FEASIBLE" | "INFEASIBLE" | "UNKNOWN";
  reasons: { code: string; source: "material_inventory" | "doe_constraint" | "manufacturing_context"; sourceId?: string; message: string }[];
}

/** Evaluates material availability through the canonical inventory authority
 *  and uses the stored DOE hard-constraint results for declared process
 *  limits. Missing inventory or missing process-limit evidence remains
 *  UNKNOWN; it cannot silently pass. */
export function evaluateDoeCandidateFeasibility(input: {
  candidate: Pick<DoeCandidate, "factorSettings" | "constraintStatus">;
  baselineFormulaVersion: FormulationVersion;
  factors: readonly DoeFactor[];
  constraints: readonly DoeConstraint[];
  inventoryRecords: InventoryRecord[];
  evaluatedAt: string;
}): DoeCandidateFeasibility {
  const reasons: DoeCandidateFeasibility["reasons"] = [];
  const evaluatedConstraints = new Map(input.candidate.constraintStatus.map((status) => [status.constraintId, status]));
  const hardConstraints = input.constraints.filter((constraint) => constraint.severity === "hard");
  for (const constraint of hardConstraints) {
    const status = evaluatedConstraints.get(constraint.id);
    if (!status) {
      reasons.push({ code: "DOE_HARD_CONSTRAINT_UNEVALUATED", source: "doe_constraint", sourceId: constraint.id, message: `Hard DOE constraint ${constraint.id} has no candidate evaluation.` });
    } else if (!status.satisfied) {
      reasons.push({ code: "DOE_HARD_CONSTRAINT_FAILED", source: "doe_constraint", sourceId: constraint.id, message: status.message ?? `Hard DOE constraint ${constraint.id} failed.` });
    }
  }

  const processFactors = input.factors.filter((factor) => factor.isProcessFactor || factor.sourceType === "process_parameter" || factor.sourceType === "temperature" || factor.sourceType === "mixing_speed" || factor.sourceType === "mixing_time" || factor.sourceType === "addition_order" || factor.sourceType === "pH_target");
  for (const factor of processFactors) {
    const hasProcessLimit = input.constraints.some((constraint) => constraint.constraintType === "process_limit" && (constraint.appliesTo.length === 0 || constraint.appliesTo.includes(factor.factorCode)));
    if (!hasProcessLimit) {
      reasons.push({ code: "MANUFACTURING_LIMITS_UNAVAILABLE", source: "manufacturing_context", sourceId: factor.id, message: `No declared manufacturing process-limit constraint covers factor ${factor.factorCode}.` });
    }
  }

  const settingByMaterialId = new Map<string, string>();
  for (const setting of input.candidate.factorSettings) {
    const factor = input.factors.find((item) => item.factorCode === setting.factorCode);
    if (!factor) {
      reasons.push({ code: "DOE_FACTOR_MISSING", source: "manufacturing_context", sourceId: setting.factorCode, message: `Candidate setting ${setting.factorCode} has no matching DOE factor.` });
    } else if (factor.sourceType === "formula_material" && factor.sourceEntityId) {
      settingByMaterialId.set(factor.sourceEntityId, setting.actualValue);
    }
  }
  const batchKg = Number(input.baselineFormulaVersion.basisBatchKg);
  if (!Number.isFinite(batchKg) || batchKg <= 0) {
    reasons.push({ code: "FORMULA_BATCH_SIZE_UNKNOWN", source: "manufacturing_context", sourceId: input.baselineFormulaVersion.id, message: "The saved formula version has no usable batch size for inventory comparison." });
  }
  for (const line of input.baselineFormulaVersion.lines) {
    const percent = Number(line.materialId ? settingByMaterialId.get(line.materialId) ?? line.percent : line.percent);
    if (!line.materialCode) {
      reasons.push({ code: "FORMULA_MATERIAL_IDENTITY_UNKNOWN", source: "material_inventory", sourceId: line.id, message: `Formula line ${line.id} has no canonical material code.` });
      continue;
    }
    const availability = evaluateMaterialAvailability(input.inventoryRecords, line.materialCode, input.evaluatedAt);
    if (!availability.hasRecords) {
      reasons.push({ code: "MATERIAL_AVAILABILITY_UNKNOWN", source: "material_inventory", sourceId: line.materialCode, message: `No inventory records exist for material ${line.materialCode}.` });
      continue;
    }
    const requiredKg = (percent / 100) * batchKg;
    if (availability.usableQuantity !== undefined && Number(availability.usableQuantity.toString()) === 0) {
      if (Number.isFinite(requiredKg) && requiredKg > 0) {
        reasons.push({ code: "INSUFFICIENT_MATERIAL", source: "material_inventory", sourceId: line.materialCode, message: `No usable inventory remains for material ${line.materialCode}.` });
      }
      continue;
    }
    if (availability.usableQuantity === undefined || availability.unit === undefined || !Number.isFinite(percent) || !Number.isFinite(batchKg) || batchKg <= 0) {
      reasons.push({ code: "MATERIAL_QUANTITY_UNKNOWN", source: "material_inventory", sourceId: line.materialCode, message: `Usable inventory quantity or required formula quantity for ${line.materialCode} cannot be compared.` });
      continue;
    }
    const usableKg = convertUnit(Number(availability.usableQuantity.toString()), availability.unit, "kg");
    if (usableKg.value === undefined) {
      reasons.push({ code: "MATERIAL_UNIT_INCOMPATIBLE", source: "material_inventory", sourceId: line.materialCode, message: `Inventory unit ${availability.unit} cannot be converted to formula batch mass.` });
      continue;
    }
    if (usableKg.value < requiredKg) {
      reasons.push({ code: "INSUFFICIENT_MATERIAL", source: "material_inventory", sourceId: line.materialCode, message: `Usable inventory for ${line.materialCode} is below the candidate requirement.` });
    }
  }

  const hasFailure = reasons.some((reason) => reason.code === "DOE_HARD_CONSTRAINT_FAILED" || reason.code === "INSUFFICIENT_MATERIAL");
  const status = hasFailure ? "INFEASIBLE" : reasons.length > 0 ? "UNKNOWN" : "FEASIBLE";
  return { policyVersion: "doe-feasibility/v1", evaluatedAt: input.evaluatedAt, status, reasons };
}

export interface DoeCandidateHardExclusions {
  policyVersion: "doe-hard-exclusions/v1";
  safety: { status: "PASS" | "FAIL" | "UNKNOWN"; findingIds: string[]; reasons: string[] };
  regulatory: { status: "PASS" | "FAIL" | "UNKNOWN"; findingIds: string[]; reasons: string[] };
}

/** Runs the existing Safety and Regulatory authorities against the candidate
 *  composition. It records their verdicts/provenance without deriving new
 *  rules. Unverified, missing, or uncovered evidence remains UNKNOWN. */
export function evaluateDoeCandidateHardExclusions(input: {
  candidate: Pick<DoeCandidate, "factorSettings">;
  baselineFormulaVersion: FormulationVersion;
  factors: readonly DoeFactor[];
  materials: RawMaterial[];
  safetyRules: SafetyRule[];
  regulatoryRules: RegulatoryRule[];
  jurisdictions: readonly RegulatoryJurisdiction[];
  claims?: string[];
}): DoeCandidateHardExclusions {
  const lines = applyDoeFactorsToLines(input.baselineFormulaVersion.lines, input.candidate.factorSettings, input.factors).lines;
  const unresolvedMaterial = lines.some((line) => !line.materialCode || !input.materials.some((material) => material.code === line.materialCode));
  const activeSafetyRules = input.safetyRules.filter((rule) => rule.active && rule.status !== "deprecated");
  const safetyFindings = evaluateSafety(lines, input.safetyRules, { materials: input.materials });
  const safetyFailed = safetyFindings.some((finding) => finding.severity === "blocking");
  const safetyUnknown = unresolvedMaterial || activeSafetyRules.length === 0 || activeSafetyRules.some((rule) => rule.status !== "verified" || rule.verificationStatus !== "verified") || safetyFindings.some((finding) => finding.dataIncomplete || finding.verificationStatus !== "verified");

  const regulatoryFindings = input.jurisdictions.flatMap((jurisdiction) => evaluateRegulatory(lines, input.regulatoryRules, {
    jurisdiction,
    category: "human_review_required",
    materials: input.materials,
    claims: input.claims,
  }));
  const regulatoryFailed = regulatoryFindings.some((finding) => finding.status === "non_compliant");
  const regulatoryUnknown = unresolvedMaterial || input.jurisdictions.length === 0 || regulatoryFindings.length === 0 || regulatoryFindings.some((finding) => finding.status !== "compliant_with_rule" || finding.verificationStatus !== "verified");

  return {
    policyVersion: "doe-hard-exclusions/v1",
    safety: {
      status: safetyFailed ? "FAIL" : safetyUnknown ? "UNKNOWN" : "PASS",
      findingIds: safetyFindings.map((finding) => finding.id),
      reasons: safetyFailed ? safetyFindings.filter((finding) => finding.severity === "blocking").map((finding) => finding.message) : safetyUnknown ? ["Safety evidence is missing, unverified, incomplete, or does not cover every formula material."] : [],
    },
    regulatory: {
      status: regulatoryFailed ? "FAIL" : regulatoryUnknown ? "UNKNOWN" : "PASS",
      findingIds: regulatoryFindings.map((finding) => finding.id),
      reasons: regulatoryFailed ? regulatoryFindings.filter((finding) => finding.status === "non_compliant").map((finding) => finding.reason) : regulatoryUnknown ? ["Regulatory evidence is missing, unverified, incomplete, or does not cover the requested market."] : [],
    },
  };
}

/** A candidate can enter the recommendation shortlist only after canonical
 *  material/manufacturing feasibility and both hard authorities explicitly
 *  pass. Missing legacy evidence remains ineligible. */
export function isDoeCandidateEligibleForSelection(candidate: Pick<DoeCandidate, "feasibility" | "hardExclusions" | "acquisition">): boolean {
  return candidate.feasibility?.status === "FEASIBLE" && candidate.hardExclusions?.safety.status === "PASS" && candidate.hardExclusions?.regulatory.status === "PASS" && candidate.acquisition?.status === "AVAILABLE";
}

/** Shared gate for every conversion from a proposal to an executable action.
 *  Selection is a human lifecycle state and cannot be inferred from rank. */
export function assertDoeCandidateHumanSelected(candidate: Pick<DoeCandidate, "status" | "feasibility" | "hardExclusions" | "acquisition">, actor: Actor): void {
  requireHumanActor(actor, "accept DOE recommendation for execution");
  if (candidate.status !== "selected") throw new Error("Explicit human selection is required before creating a DOE run or laboratory trial.");
  if (!isDoeCandidateEligibleForSelection(candidate)) throw new Error("Recommendation cannot be executed without confirmed feasibility, Safety, Regulatory, and acquisition evidence.");
}

export interface DoeCandidateAcquisition {
  policyVersion: "doe-acquisition/v1";
  method: "nearest_measured_run_distance";
  status: "AVAILABLE" | "UNAVAILABLE";
  value?: number;
  sourceRunIds: string[];
  reason?: string;
}

/** Uses an explicit, versioned exploration fallback: standardized DOE-space
 *  distance to the nearest completed run with a recorded measured value.
 *  This does not claim uncertainty or information gain. Extrapolated model
 *  predictions and missing factor lineage make acquisition unavailable. */
export function evaluateDoeCandidateAcquisition(input: {
  candidate: Pick<DoeCandidate, "factorSettings" | "predictedResponses">;
  factors: readonly DoeFactor[];
  runs: readonly DoeRun[];
  observations: readonly DoeObservation[];
}): DoeCandidateAcquisition {
  const unavailable = (reason: string, sourceRunIds: string[] = []): DoeCandidateAcquisition => ({
    policyVersion: "doe-acquisition/v1", method: "nearest_measured_run_distance", status: "UNAVAILABLE", sourceRunIds, reason,
  });
  if (input.candidate.predictedResponses.some((prediction) => prediction.isExtrapolated)) {
    return unavailable("An extrapolated DOE prediction is not valid acquisition evidence.");
  }
  if (input.factors.length === 0) return unavailable("No declared DOE factors are available for a distance calculation.");

  const candidateByCode = new Map(input.candidate.factorSettings.map((setting) => [setting.factorCode, setting.codedValue]));
  if (input.factors.some((factor) => !candidateByCode.has(factor.factorCode))) {
    return unavailable("Candidate factor settings do not cover the frozen DOE factor space.");
  }
  const validRunIds = new Set(input.runs.filter((run) => run.status === "completed").filter((run) => input.observations.some((observation) =>
    observation.runId === run.id && (observation.status === "recorded" || observation.status === "validated" || observation.status === "outlier_flagged") && (observation.value !== undefined || observation.textValue !== undefined),
  )).map((run) => run.id));
  const measuredRuns = input.runs.filter((run) => validRunIds.has(run.id));
  if (measuredRuns.length === 0) return unavailable("No completed DOE run has a recorded measured response.");

  let nearestDistance = Number.POSITIVE_INFINITY;
  const comparableRunIds: string[] = [];
  for (const run of measuredRuns) {
    const runByCode = new Map(run.factorSettings.map((setting) => [setting.factorCode, setting.codedValue]));
    if (input.factors.some((factor) => !runByCode.has(factor.factorCode))) continue;
    let squaredDistance = 0;
    for (const factor of input.factors) {
      const candidateValue = candidateByCode.get(factor.factorCode)!;
      const runValue = runByCode.get(factor.factorCode)!;
      const candidateNumber = Number(candidateValue);
      const runNumber = Number(runValue);
      const difference = Number.isFinite(candidateNumber) && Number.isFinite(runNumber)
        ? candidateNumber - runNumber
        : candidateValue === runValue ? 0 : 1;
      squaredDistance += difference * difference;
    }
    const distance = Math.sqrt(squaredDistance / input.factors.length);
    comparableRunIds.push(run.id);
    if (distance < nearestDistance) nearestDistance = distance;
  }
  if (comparableRunIds.length === 0) return unavailable("Completed measured DOE runs do not share the candidate's factor space.");
  return {
    policyVersion: "doe-acquisition/v1",
    method: "nearest_measured_run_distance",
    status: "AVAILABLE",
    value: nearestDistance,
    sourceRunIds: comparableRunIds.sort(),
    reason: "Distance from completed measured DOE runs; it is an explicit space-coverage fallback, not model uncertainty.",
  };
}

/** Stable deterministic order: greater supported distance first; unavailable
 *  candidates retain input order after the available candidates. */
export function rankDoeCandidatesByAcquisition<T extends { acquisition?: DoeCandidateAcquisition }>(candidates: readonly T[]): (T & { rank: number })[] {
  return candidates.map((candidate, index) => ({ candidate, index })).sort((a, b) => {
    const aValue = a.candidate.acquisition?.status === "AVAILABLE" ? a.candidate.acquisition.value : undefined;
    const bValue = b.candidate.acquisition?.status === "AVAILABLE" ? b.candidate.acquisition.value : undefined;
    if (aValue !== undefined && bValue !== undefined) return bValue - aValue || a.index - b.index;
    if (aValue !== undefined) return -1;
    if (bValue !== undefined) return 1;
    return a.index - b.index;
  }).map(({ candidate }, index) => ({ ...candidate, rank: index + 1 }));
}

export interface DoeCandidateDiversity {
  policyVersion: "doe-diversity/v1";
  status: "AVAILABLE" | "UNAVAILABLE";
  distanceToSelected?: number;
  nearestSelectedCandidateIds: string[];
  reason: string;
}

/** Greedy maximin ordering over declared coded factor values. Acquisition
 *  order provides the deterministic seed and tie-break; diversity is an
 *  explicit coded-space distance, not a performance/confidence heuristic. */
export function diversifyDoeCandidates<T extends {
  id: string;
  factorSettings: readonly Pick<DoeFactorSetting, "factorCode" | "codedValue">[];
}>(candidates: readonly T[], options: { minimumDistance?: number } = {}): (T & { diversity: DoeCandidateDiversity })[] {
  const minimumDistance = options.minimumDistance ?? 0.1;
  if (!Number.isFinite(minimumDistance) || minimumDistance < 0) throw new Error("Minimum DOE diversity distance must be finite and non-negative.");
  if (candidates.length === 0) return [];
  const factorCodes = [...new Set(candidates.flatMap((candidate) => candidate.factorSettings.map((setting) => setting.factorCode)))].sort();
  if (factorCodes.length === 0 || candidates.some((candidate) => factorCodes.some((code) => !candidate.factorSettings.some((setting) => setting.factorCode === code)))) {
    return candidates.map((candidate) => ({ ...candidate, diversity: { policyVersion: "doe-diversity/v1", status: "UNAVAILABLE", nearestSelectedCandidateIds: [], reason: "Candidate factor lineage is incomplete for coded-space diversity." } }));
  }
  const distance = (a: T, b: T): number => {
    const aByCode = new Map(a.factorSettings.map((setting) => [setting.factorCode, setting.codedValue]));
    const bByCode = new Map(b.factorSettings.map((setting) => [setting.factorCode, setting.codedValue]));
    let sum = 0;
    for (const code of factorCodes) {
      const av = aByCode.get(code)!;
      const bv = bByCode.get(code)!;
      const an = Number(av);
      const bn = Number(bv);
      const delta = Number.isFinite(an) && Number.isFinite(bn) ? an - bn : av === bv ? 0 : 1;
      sum += delta * delta;
    }
    return Math.sqrt(sum / factorCodes.length);
  };
  const remaining = candidates.map((candidate, index) => ({ candidate, index }));
  const selected: typeof remaining = [];
  const output: (T & { diversity: DoeCandidateDiversity })[] = [];
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = selected.length === 0 ? Number.POSITIVE_INFINITY : -1;
    let nearestIds: string[] = [];
    for (let i = 0; i < remaining.length; i++) {
      if (selected.length === 0) break;
      const distances = selected.map(({ candidate }) => ({ id: candidate.id, value: distance(remaining[i].candidate, candidate) }));
      const minimum = Math.min(...distances.map((item) => item.value));
      if (minimum > bestDistance || (minimum === bestDistance && remaining[i].index < remaining[bestIndex].index)) {
        bestIndex = i;
        bestDistance = minimum;
        nearestIds = distances.filter((item) => item.value === minimum).map((item) => item.id).sort();
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    selected.push(chosen);
    output.push({
      ...chosen.candidate,
      diversity: {
        policyVersion: "doe-diversity/v1",
        status: "AVAILABLE",
        distanceToSelected: selected.length === 1 ? undefined : bestDistance,
        nearestSelectedCandidateIds: nearestIds,
        reason: selected.length === 1 ? "Seed recommendation follows acquisition order; subsequent candidates use maximin coded-factor distance." : bestDistance < minimumDistance ? `Closest coded-factor distance ${bestDistance.toFixed(4)} is below configured minimum ${minimumDistance.toFixed(4)}; retained after distinct candidates were exhausted.` : "Selected by maximum minimum coded-factor distance from earlier recommendations.",
      },
    });
  }
  return output;
}

export interface DoeCandidateMaterialCost {
  policyVersion: "doe-estimated-material-cost/v1";
  status: "AVAILABLE" | "UNAVAILABLE";
  amount?: number;
  currency?: string;
  source?: "FormuLab Cost Engine";
  priceRecordCodes: string[];
  exchangeRateCodes: string[];
  reason: string;
}

/** Estimates candidate batch material cost through the canonical Cost Engine.
 *  It intentionally reports only Cost Engine raw-material cost; no lab, labor,
 *  or campaign costs are inferred from formula prices. */
export function evaluateDoeCandidateMaterialCost(input: {
  candidate: Pick<DoeCandidate, "factorSettings">;
  baselineFormulaVersion: FormulationVersion;
  factors: readonly DoeFactor[];
  materials: RawMaterial[];
  prices: MaterialPrice[];
  rates: ExchangeRate[];
  currency: string;
  evaluatedAt: string;
}): DoeCandidateMaterialCost {
  const composition = applyDoeFactorsToLines(input.baselineFormulaVersion.lines, input.candidate.factorSettings, input.factors);
  const snapshot = buildCostSnapshot(input.baselineFormulaVersion.formulationId, input.baselineFormulaVersion.id, {
    lines: composition.lines,
    batchKg: input.baselineFormulaVersion.basisBatchKg,
    currency: input.currency,
    asOf: input.evaluatedAt,
    materials: input.materials,
    prices: input.prices,
    rates: input.rates,
  }, { code: "live" });
  const amount = snapshot.rawMaterialCost === undefined ? undefined : Number(snapshot.rawMaterialCost);
  const rawMaterialWarnings = snapshot.missingDataWarnings.filter((warning) => !warning.startsWith("No factory cost profile selected, so the figure is raw-material cost only"));
  const complete = composition.warnings.length === 0 && rawMaterialWarnings.length === 0 && amount !== undefined && Number.isFinite(amount) && amount >= 0;
  return {
    policyVersion: "doe-estimated-material-cost/v1",
    status: complete ? "AVAILABLE" : "UNAVAILABLE",
    amount: complete ? amount : undefined,
    currency: complete ? snapshot.currency : undefined,
    source: complete ? "FormuLab Cost Engine" : undefined,
    priceRecordCodes: snapshot.priceRecordCodes,
    exchangeRateCodes: snapshot.exchangeRateCodes,
    reason: complete ? "Complete canonical Cost Engine raw-material-only estimate for this candidate's batch; conversion and laboratory costs are not included." : [...composition.warnings, ...rawMaterialWarnings].join(" ") || "Cost Engine did not produce a complete raw-material estimate.",
  };
}

export interface CreateDoeCandidatesInput {
  studyId: string;
  studyRevision: number;
  analysisIds: string[];
  ranked: readonly (RawDoeCandidate & { rank: number })[];
  experimentSpace?: DoeExperimentSpace;
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
      recommendationPolicyVersion: DOE_RECOMMENDATION_POLICY_VERSION,
      experimentSpace: input.experimentSpace ? {
        policyVersion: input.experimentSpace.policyVersion,
        designId: input.experimentSpace.designId,
        sourceFormulaVersionId: input.experimentSpace.sourceFormulaVersionId,
        seed: input.experimentSpace.seed,
        candidateCount: input.experimentSpace.candidateCount,
        manipulatedFactorCodes: input.experimentSpace.manipulatedFactorCodes,
        unchangedFormulaLineIds: input.experimentSpace.unchangedFormulaLineIds,
      } : undefined,
      createdBy: actor.userId,
      createdAt: now,
    }),
  );
}

/** Creates an existing-domain DOE run from an explicitly selected proposal.
 *  It appends after the current design runs and retains recommendation and
 *  human-acceptance lineage on the new run. No trial is started or executed. */
export function createDoeRunFromAcceptedCandidate(input: {
  candidate: DoeCandidate;
  study: DoeStudy;
  design: DoeDesign;
  existingRuns: readonly DoeRun[];
  acceptedAt?: string;
}, actor: Actor): DoeRun {
  assertDoeCandidateHumanSelected(input.candidate, actor);
  if (input.candidate.studyId !== input.study.id || input.candidate.studyRevision !== input.study.revision) {
    throw new Error("Recommendation study identity or revision does not match the active DOE study.");
  }
  if (input.design.studyId !== input.study.id || input.design.studyRevision !== input.study.revision || input.candidate.experimentSpace?.designId !== input.design.id) {
    throw new Error("Recommendation DOE design lineage does not match the active design.");
  }
  if (input.candidate.experimentSpace.sourceFormulaVersionId !== input.study.baselineFormulaVersionId) {
    throw new Error("Recommendation source formula version does not match the DOE study baseline.");
  }
  const designRuns = input.existingRuns.filter((run) => run.studyId === input.study.id && run.designId === input.design.id);
  const runNumber = designRuns.reduce((maximum, run) => Math.max(maximum, run.runNumber), 0) + 1;
  const acceptedAt = input.acceptedAt ?? new Date().toISOString();
  const run: DoeRun = {
    schemaVersion: "1.0",
    id: newDoeId("doerun"),
    studyId: input.study.id,
    studyRevision: input.study.revision,
    designId: input.design.id,
    runNumber,
    standardOrder: runNumber,
    randomizedOrder: runNumber,
    block: 1,
    replicate: 1,
    isCenterPoint: false,
    factorSettings: input.candidate.factorSettings,
    status: "planned",
    recommendationId: input.candidate.id,
    recommendationPolicyVersion: input.candidate.recommendationPolicyVersion ?? DOE_RECOMMENDATION_POLICY_VERSION,
    recommendationAcceptedBy: actor.kind === "human" ? actor.userId : undefined,
    recommendationAcceptedAt: acceptedAt,
    createdAt: acceptedAt,
  };
  assertAcceptedRecommendationRunCanCreateTrial({ candidate: input.candidate, run, study: input.study, design: input.design }, actor);
  return run;
}

/** Revalidates persisted recommendation acceptance before a LaboratoryTrial
 *  may be created. This is separate from the initial run-creation gate because
 *  retries load persisted records that may be stale or malformed. */
export function assertAcceptedRecommendationRunCanCreateTrial(input: {
  candidate: DoeCandidate;
  run: DoeRun;
  study: DoeStudy;
  design: DoeDesign;
}, actor: Actor): void {
  requireHumanActor(actor, "create a LaboratoryTrial from a DOE recommendation");
  assertDoeCandidateHumanSelected(input.candidate, actor);

  const { candidate, run, study, design } = input;
  const experimentSpace = candidate.experimentSpace;
  if (!experimentSpace) throw new Error("Recommendation has no persisted experiment-space lineage.");
  if (candidate.recommendationPolicyVersion !== DOE_RECOMMENDATION_POLICY_VERSION || run.recommendationPolicyVersion !== candidate.recommendationPolicyVersion) {
    throw new Error("Recommendation policy lineage is missing or does not match the accepted DOE run.");
  }
  if (run.recommendationId !== candidate.id) throw new Error("DOE run recommendation identity does not match the selected candidate.");
  if (!run.recommendationAcceptedBy?.trim()) throw new Error("DOE run has no human acceptance actor provenance.");
  if (!run.recommendationAcceptedAt || !Number.isFinite(Date.parse(run.recommendationAcceptedAt))) {
    throw new Error("DOE run has no valid human acceptance timestamp provenance.");
  }
  if (candidate.studyId !== study.id || candidate.studyRevision !== study.revision || run.studyId !== study.id || run.studyRevision !== study.revision) {
    throw new Error("Recommendation and DOE run study identity or revision does not match the active study.");
  }
  if (design.studyId !== study.id || design.studyRevision !== study.revision || experimentSpace.designId !== design.id || run.designId !== design.id) {
    throw new Error("Recommendation and DOE run design lineage does not match the active design.");
  }
  if (experimentSpace.sourceFormulaVersionId !== study.baselineFormulaVersionId) {
    throw new Error("Recommendation source formula version does not match the DOE study baseline.");
  }
  if (run.factorSettings.length !== candidate.factorSettings.length || run.factorSettings.some((setting, index) => {
    const candidateSetting = candidate.factorSettings[index];
    return !candidateSetting || setting.factorCode !== candidateSetting.factorCode || setting.codedValue !== candidateSetting.codedValue || setting.actualValue !== candidateSetting.actualValue;
  })) {
    throw new Error("DOE run factor settings do not match the accepted recommendation.");
  }
  if (run.linkedTrialId || run.linkedFormulaVersionId) throw new Error("DOE run already has a LaboratoryTrial or formula-version link.");
  if (run.status !== "planned" && run.status !== "prepared") {
    throw new Error("DOE run lifecycle state does not allow LaboratoryTrial creation.");
  }
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
