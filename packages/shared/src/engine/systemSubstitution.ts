/**
 * Multi-material system substitution (spec §A7): generating candidate
 * material COMBINATIONS (never by name similarity — only by function,
 * active matter, and the other real fields listed in
 * `docs/SYSTEM_SUBSTITUTION.md`), building the `FormulationProblem` that
 * routes a proposed combination through the real Advanced Optimizer, and
 * scoring the optimizer's result.
 *
 * This module never evaluates compatibility/safety itself — the caller
 * (the desktop UI, same as `AdvancedOptimizerPanel.tsx`) runs
 * `blockingExclusionConstraints`/`gradedRiskScores` (engine/optimization.ts)
 * against the candidate pool and passes the resulting constraints/scores in,
 * exactly like a plain optimizer run. That keeps "the optimizer never
 * duplicates compatibility/safety rules" true for system substitution too.
 */
import type { MaterialFunction } from "../schemas/formulation";
import type {
  AdvancedOptimizationResult,
  ConditionalConstraint,
  FormulationProblem,
  OptimizationMaterial,
  RatioConstraint,
} from "../schemas/optimization";
import type {
  RejectedSystemCandidate,
  SubstitutionRequest,
  SubstitutionScoreDimension,
  SystemCandidateLimits,
} from "../schemas/substitution";

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

export interface SystemSubstitutionTarget {
  /** The `OptimizationMaterial.id`s of the source lines being replaced. */
  sourceMaterialIds: string[];
  /** Functions the replacement system must collectively cover — usually the
   *  union of the source materials' own functions, but a caller may narrow
   *  or widen this deliberately (spec: "functions to preserve"). */
  preserveFunctions: MaterialFunction[];
}

export interface SystemCandidatePoolMaterial {
  materialId: string;
  materialCode: string;
  functions: MaterialFunction[];
  stockAvailableKg?: string;
  supplierApproved?: boolean;
  kenyaLocal?: boolean;
}

export interface SystemCandidateProposal {
  materialIds: string[];
  materialCodes: string[];
  matchedFunctions: MaterialFunction[];
  missingFunctions: MaterialFunction[];
}

function* combinations<T>(items: readonly T[], size: number): Generator<T[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let i = 0; i <= items.length - size; i++) {
    for (const rest of combinations(items.slice(i + 1), size - 1)) {
      yield [items[i], ...rest];
    }
  }
}

/**
 * Deterministic candidate-system generation: a prefilter (only materials
 * carrying at least one preserved function, honoring `requireStock`/
 * `requireApprovedSupplier`, sorted — Kenya-local first when
 * `preferKenyaLocal`, then by `materialCode` — for a reproducible order),
 * then combinations of increasing size up to `limits.maxMaterialsPerSystem`,
 * stopping the moment `limits.maxCandidateSystems` is reached. No name
 * matching anywhere in this function.
 */
export function generateSystemCandidates(
  target: SystemSubstitutionTarget,
  pool: SystemCandidatePoolMaterial[],
  limits: SystemCandidateLimits,
  filters: { requireStock?: boolean; requireApprovedSupplier?: boolean; preferKenyaLocal?: boolean } = {},
): { proposals: SystemCandidateProposal[]; rejected: RejectedSystemCandidate[] } {
  let relevant = pool.filter(
    (m) => target.preserveFunctions.length === 0 || m.functions.some((f) => target.preserveFunctions.includes(f)),
  );
  if (filters.requireStock) {
    relevant = relevant.filter((m) => m.stockAvailableKg !== undefined && Number(m.stockAvailableKg) > 0);
  }
  if (filters.requireApprovedSupplier) {
    relevant = relevant.filter((m) => m.supplierApproved === true);
  }
  relevant = relevant
    .slice()
    .sort((a, b) => {
      if (filters.preferKenyaLocal) {
        const ka = a.kenyaLocal ? 0 : 1;
        const kb = b.kenyaLocal ? 0 : 1;
        if (ka !== kb) return ka - kb;
      }
      return a.materialCode.localeCompare(b.materialCode);
    })
    .slice(0, limits.maxCandidateMaterials);

  if (relevant.length === 0) {
    return {
      proposals: [],
      rejected: [
        {
          materialIds: [],
          materialCodes: [],
          reason: "candidate_pool_exhausted",
          message:
            "No candidate material in the pool matches the required functions and filters (stock/approved supplier).",
        },
      ],
    };
  }

  const proposals: SystemCandidateProposal[] = [];
  const rejected: RejectedSystemCandidate[] = [];
  const seen = new Set<string>();

  for (let size = 1; size <= limits.maxMaterialsPerSystem; size++) {
    if (proposals.length >= limits.maxCandidateSystems) break;
    for (const combo of combinations(relevant, size)) {
      if (proposals.length >= limits.maxCandidateSystems) break;
      const key = combo
        .map((m) => m.materialId)
        .sort()
        .join("+");
      if (seen.has(key)) continue;
      seen.add(key);

      const comboFunctions = new Set(combo.flatMap((m) => m.functions));
      const matchedFunctions = target.preserveFunctions.filter((f) => comboFunctions.has(f));
      const missingFunctions = target.preserveFunctions.filter((f) => !comboFunctions.has(f));

      // A proposal must cover every preserved function on its own — a
      // system that leaves one out is not doing the job it was generated
      // for, so it is recorded as rejected (with which function is
      // missing), not silently offered as a partial match.
      if (missingFunctions.length > 0) {
        rejected.push({
          materialIds: combo.map((m) => m.materialId),
          materialCodes: combo.map((m) => m.materialCode),
          reason: "missing_required_function",
          message: `This combination does not cover: ${missingFunctions.join(", ")}.`,
        });
        continue;
      }

      proposals.push({
        materialIds: combo.map((m) => m.materialId),
        materialCodes: combo.map((m) => m.materialCode),
        matchedFunctions,
        missingFunctions,
      });
    }
  }

  return { proposals, rejected };
}

// ---------------------------------------------------------------------------
// Optimizer routing
// ---------------------------------------------------------------------------

export interface BuildSystemProblemInput {
  /** A normal `FormulationProblem` built the same way the plain Advanced
   *  Optimizer builds one (batch, full candidate materials incl. price/
   *  stock, objectives, solver config, precision policy) — this function
   *  only adds/adjusts what a system substitution specifically needs. */
  baseProblem: FormulationProblem;
  sourceMaterialIds: string[];
  proposal: SystemCandidateProposal;
  request: SubstitutionRequest;
  /** The replaced lines' original combined active-matter contribution, as a
   *  percent of the batch — required to honor `preserveActiveContribution`;
   *  omitted (or `undefined`) skips that constraint entirely rather than
   *  guessing a target. */
  originalActiveContributionPercent?: string;
  /** Extra hard exclusions the caller computed from the real compatibility/
   *  safety engines (see the module docstring) — merged in alongside
   *  whatever `baseProblem.conditionalConstraints` already had. */
  exclusionConstraints?: ConditionalConstraint[];
}

/**
 * Build the `FormulationProblem` for one proposed system: unaffected lines
 * locked at their current percentage, source lines removed as candidates
 * entirely, the proposal's materials left free for the solver to place,
 * technical maximums/stock/compatibility/safety enforced exactly as any
 * other optimizer run, a cost ceiling if requested, and (when
 * `preserveActiveContribution` is set) an exact-ratio constraint holding the
 * system's active-matter contribution to the original lines' own
 * contribution — expressed against the WHOLE candidate pool's raw-material
 * sum, which `total_equals_100` already fixes at `batch_kg`, so the ratio is
 * exact, not an approximation.
 */
export function buildSystemSubstitutionProblem(input: BuildSystemProblemInput): FormulationProblem {
  const { baseProblem, sourceMaterialIds, proposal, request } = input;
  const sourceSet = new Set(sourceMaterialIds);
  const systemSet = new Set(proposal.materialIds);

  // Source lines are removed as candidates entirely (spec §3.4.2) — they are
  // being replaced, not merely relaxed. Every other material keeps whatever
  // lock/percent it already had on `baseProblem` (the caller is expected to
  // have locked non-system, non-source materials to their current
  // percentage before calling this, the same "lock unaffected lines" step
  // spec §3.4.1 asks for).
  const materials: OptimizationMaterial[] = baseProblem.materials
    .filter((m) => !sourceSet.has(m.id))
    .map((m) => (systemSet.has(m.id) ? { ...m, excluded: false, lockedPercent: undefined } : m));

  const functionalConstraints = [...baseProblem.functionalConstraints];
  for (const fn of request.preserveFunctions ?? []) {
    functionalConstraints.push({
      id: `sys_preserve_fn_${fn}`,
      displayName: `Preserve ${fn}`,
      functionGroups: [fn],
      basis: "raw_material",
      constraintType: "min_total",
      value: "0.001",
      severity: "warning",
      strictness: "hard",
      verificationStatus: "not_verified",
      active: true,
    });
  }

  const ratioConstraints: RatioConstraint[] = [...baseProblem.ratioConstraints];
  if (request.preserveActiveContribution && input.originalActiveContributionPercent !== undefined) {
    ratioConstraints.push({
      id: "sys_preserve_active_contribution",
      displayName: "Preserve active-matter contribution",
      numerator: { materialIds: proposal.materialIds, basis: "active_matter" },
      denominator: { materialIds: materials.map((m) => m.id), basis: "raw_material" },
      ratioType: "exact_ratio",
      value: String(Number(input.originalActiveContributionPercent) / 100),
      severity: "warning",
      // Soft, not hard: an exact ratio is what is REQUESTED, but a system
      // substitution that must relax it slightly to stay feasible is still
      // a usable result, reported honestly via constraintResults — a hard
      // version would make many otherwise-good systems needlessly
      // infeasible over a fraction of a percentage point.
      strictness: "soft",
      penaltyWeight: "5",
      penaltyType: "linear_absolute",
      allowedDeviation: "0",
      verificationStatus: "not_verified",
      active: true,
    });
  }

  const conditionalConstraints = [...baseProblem.conditionalConstraints, ...(input.exclusionConstraints ?? [])];

  const costCeiling =
    request.costCeiling !== undefined
      ? { value: request.costCeiling, currency: "KES", penaltyWeight: "1" }
      : baseProblem.costCeiling;

  return {
    ...baseProblem,
    materials,
    functionalConstraints,
    ratioConstraints,
    conditionalConstraints,
    costCeiling,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function dim(dimension: string, weight: number, score: number | undefined, explanation: string): SubstitutionScoreDimension {
  if (score === undefined) return { dimension, weight, missingData: true, explanation };
  const clamped = Math.max(0, Math.min(1, score));
  return { dimension, weight, normalizedScore: clamped, contribution: clamped * weight, missingData: false, explanation };
}

/**
 * Score one optimizer result for a proposed system. Deterministic and
 * read directly from the result's own fields — no re-solving, no guessing.
 * Feasibility dominates the score (a `feasible_with_penalties` result is
 * real and usable, but scores below a clean `optimal`); cost, soft-penalty
 * count, and the two graded risk objectives (when the caller included them)
 * fill the rest.
 */
export function scoreSystemResult(
  result: AdvancedOptimizationResult,
  originalCostPerBatch?: number,
): { totalScore: number; dimensions: SubstitutionScoreDimension[] } {
  const dims: SubstitutionScoreDimension[] = [];

  const feasibilityScore =
    result.status === "optimal" ? 1 : result.status === "feasible" ? 0.9 : result.status === "feasible_with_penalties" ? 0.6 : 0;
  dims.push(dim("feasibility", 0.35, feasibilityScore, `Solver status: ${result.status}.`));

  const violated = result.constraintResults.filter((c) => c.strictness === "soft" && !c.satisfied).length;
  dims.push(
    dim(
      "soft_constraint_penalties",
      0.15,
      Math.max(0, 1 - violated * 0.2),
      violated === 0 ? "No soft-constraint violations." : `${violated} soft-constraint violation(s).`,
    ),
  );

  const newCost = result.totals?.totalRawMaterialCost !== undefined ? Number(result.totals.totalRawMaterialCost) : undefined;
  const costScore =
    newCost === undefined || originalCostPerBatch === undefined || originalCostPerBatch === 0
      ? undefined
      : Math.max(0, Math.min(1, 1 - (newCost - originalCostPerBatch) / originalCostPerBatch / 2));
  dims.push(
    dim(
      "cost_impact",
      0.2,
      costScore,
      costScore === undefined
        ? "Cost not comparable — missing the original batch cost or this result's cost."
        : `Original raw-material cost ${originalCostPerBatch}, new ${newCost}.`,
    ),
  );

  const compat = result.objectiveResults.find((o) => o.metric === "compatibility_risk");
  dims.push(
    dim(
      "compatibility_risk",
      0.15,
      compat ? 1 - Number(compat.rawValue) : undefined,
      compat ? `Compatibility risk objective value ${compat.rawValue}.` : "Compatibility-risk objective was not included in this run.",
    ),
  );

  const safety = result.objectiveResults.find((o) => o.metric === "safety_risk");
  dims.push(
    dim(
      "safety_risk",
      0.15,
      safety ? 1 - Number(safety.rawValue) : undefined,
      safety ? `Safety risk objective value ${safety.rawValue}.` : "Safety-risk objective was not included in this run.",
    ),
  );

  const totalWeight = dims.reduce((s, d) => s + d.weight, 0) || 1;
  const totalScore = dims.reduce((s, d) => s + (d.missingData ? 0 : d.contribution ?? 0), 0) / totalWeight;
  return { totalScore: Math.max(0, Math.min(1, totalScore)), dimensions: dims };
}
