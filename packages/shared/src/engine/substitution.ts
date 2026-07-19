/**
 * Deterministic raw-material substitution scoring (spec §5).
 *
 * Candidates are never ranked by name similarity. Every dimension below
 * traces to a real field this platform actually has on a raw material,
 * its price/inventory records, its supplier, or — for compatibility and
 * safety impact — a finding the real compatibility/safety engines produced
 * for the candidate already substituted into the formula (this module never
 * re-implements those rule sets; a caller runs `evaluateCompatibility`/
 * `evaluateSafety` against the candidate-substituted line set and passes the
 * summary in). A dimension this platform has no data for is reported
 * `missingData: true` and contributes `SubstitutionWeights.missingDataPenalty`
 * (0 by default) to the total — never a perfect-match 1.0.
 *
 * See docs/MATERIAL_SUBSTITUTION.md for the full weight table, which of the
 * spec's named dimensions are implemented for real here, and which are
 * listed as not modeled because no field on `RawMaterial` backs them yet
 * (e.g. foam-profile and mildness similarity have no numeric field in this
 * platform's material master — inventing a score for them would be exactly
 * the "ranked by name similarity" anti-pattern this module exists to avoid).
 */
import { dec, tryDec, Decimal } from "./decimal";
import type { IonicCharacter } from "../schemas/materials";
import type { MaterialFunction } from "../schemas/formulation";
import type {
  RequiredFormulaChange,
  SubstitutionCandidate,
  SubstitutionReason,
  SubstitutionScoreDimension,
  SubstitutionWeights,
} from "../schemas/substitution";

/** What is being replaced — pulled from the formula line and its resolved
 *  material, not re-derived here. */
export interface SubstitutionTarget {
  materialId: string;
  materialCode: string;
  linePercent: string;
  functions: MaterialFunction[];
  ionicCharacter?: IonicCharacter;
  activeMatterPercent?: string;
  hlb?: string;
  phMin?: string;
  phMax?: string;
  landedCost?: string;
}

/** Everything this module needs about one candidate, assembled by the
 *  caller from `RawMaterial` + `MaterialPrice` + `InventoryRecord` +
 *  `Supplier` + (optionally) a compatibility/safety re-evaluation. Every
 *  field is optional except identity — an absent field is a real "we do not
 *  have this data" and scores as `missingData`, not as a match. */
export interface SubstitutionCandidateInput {
  materialId: string;
  materialCode: string;
  name: string;
  functions: MaterialFunction[];
  ionicCharacter?: IonicCharacter;
  activeMatterPercent?: string;
  hlb?: string;
  phMin?: string;
  phMax?: string;
  recommendedMinPercent?: string;
  recommendedMaxPercent?: string;
  technicalMaxPercent?: string;
  regulatoryMaxPercent?: string;
  /** True/false only when a regulatory position for the target market(s) is
   *  `verified` or a clear `permitted`/`prohibited`; absent when
   *  `not_verified` or no position exists at all — that absence is real
   *  regulatory uncertainty, reported as such, never assumed permitted. */
  regulatoryPermitted?: boolean;

  landedCost?: string;
  currency?: string;
  availableStockKg?: string;
  supplierApproved?: boolean;
  supplierCountry?: string;
  leadTimeDays?: number;
  moqKg?: string;
  kenyaLocal?: boolean;
  evidenceConfidenceScore?: number;

  /** Set by the caller after re-running the real compatibility/safety
   *  engines with this candidate substituted in. */
  compatibilityFindingIds?: string[];
  hasBlockingCompatibilityFinding?: boolean;
  safetyFindingIds?: string[];
  hasBlockingSafetyFinding?: boolean;
}

/** Relative weights, documented in docs/MATERIAL_SUBSTITUTION.md. Normalized
 *  to sum to 1 at scoring time so a caller adding/removing a dimension via
 *  `SubstitutionWeights` does not have to keep the rest summing to exactly 1
 *  by hand. */
export const DEFAULT_SUBSTITUTION_WEIGHTS: Record<string, number> = {
  function_match: 0.16,
  active_matter_equivalence: 0.14,
  ionic_character_match: 0.08,
  hlb_similarity: 0.05,
  ph_compatibility: 0.05,
  recommended_use_overlap: 0.05,
  regulatory_status: 0.08,
  compatibility_impact: 0.12,
  safety_impact: 0.12,
  available_stock: 0.06,
  landed_cost: 0.05,
  supplier_approved: 0.02,
  lead_time: 0.01,
  kenya_local: 0.005,
  evidence_confidence: 0.005,
};

function dim(
  dimension: string,
  weight: number,
  explanation: string,
  score?: number,
  rawValue?: string,
): SubstitutionScoreDimension {
  if (score === undefined) {
    return { dimension, weight, missingData: true, explanation };
  }
  const clamped = Math.max(0, Math.min(1, score));
  return {
    dimension,
    weight,
    normalizedScore: clamped,
    contribution: clamped * weight,
    missingData: false,
    rawValue,
    explanation,
  };
}

function overlapRatio(aMin: number, aMax: number, bMin: number, bMax: number): number {
  const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
  const span = Math.max(aMax, bMax) - Math.min(aMin, bMin);
  if (span <= 0) return overlap >= 0 ? 1 : 0;
  return Math.max(0, overlap / span);
}

/** Score one candidate against `target`. Pure and deterministic: the same
 *  target + candidate + weights always produces the same score. */
export function scoreCandidate(
  target: SubstitutionTarget,
  candidate: SubstitutionCandidateInput,
  weights: Record<string, number> = DEFAULT_SUBSTITUTION_WEIGHTS,
  missingDataPenalty = 0,
): { totalScore: number; dimensions: SubstitutionScoreDimension[] } {
  const w = (name: string) => weights[name] ?? 0;
  const dims: SubstitutionScoreDimension[] = [];

  // function_match — Jaccard overlap of function sets.
  {
    const targetSet = new Set(target.functions);
    const candSet = new Set(candidate.functions);
    const intersection = [...targetSet].filter((f) => candSet.has(f)).length;
    const union = new Set([...targetSet, ...candSet]).size;
    const score = union === 0 ? undefined : intersection / union;
    dims.push(
      dim(
        "function_match",
        w("function_match"),
        score === undefined
          ? "Neither material has a recorded function."
          : `${intersection} of ${union} function role(s) shared.`,
        score,
      ),
    );
  }

  // ionic_character_match
  {
    const score =
      target.ionicCharacter === undefined || candidate.ionicCharacter === undefined
        ? undefined
        : target.ionicCharacter === candidate.ionicCharacter
          ? 1
          : 0;
    dims.push(
      dim(
        "ionic_character_match",
        w("ionic_character_match"),
        score === undefined
          ? "Ionic character not recorded for one or both materials."
          : score === 1
            ? `Both ${target.ionicCharacter}.`
            : `Target ${target.ionicCharacter ?? "?"}, candidate ${candidate.ionicCharacter ?? "?"}.`,
        score,
      ),
    );
  }

  // active_matter_equivalence — closeness of as-supplied active %.
  {
    const t = tryDec(target.activeMatterPercent);
    const c = tryDec(candidate.activeMatterPercent);
    const score =
      t === undefined || c === undefined
        ? undefined
        : t.isZero() && c.isZero()
          ? 1
          : 1 - Math.min(1, t.minus(c).abs().div(Decimal.max(t, c, 1)).toNumber());
    dims.push(
      dim(
        "active_matter_equivalence",
        w("active_matter_equivalence"),
        score === undefined
          ? "Active-matter percentage not recorded for one or both materials."
          : `Target ${target.activeMatterPercent ?? "?"}% active vs candidate ${candidate.activeMatterPercent ?? "?"}% active.`,
        score,
      ),
    );
  }

  // hlb_similarity
  {
    const t = tryDec(target.hlb);
    const c = tryDec(candidate.hlb);
    const score = t === undefined || c === undefined ? undefined : 1 - Math.min(1, t.minus(c).abs().div(20).toNumber());
    dims.push(
      dim(
        "hlb_similarity",
        w("hlb_similarity"),
        score === undefined ? "HLB not recorded for one or both materials." : `Target HLB ${target.hlb}, candidate HLB ${candidate.hlb}.`,
        score,
      ),
    );
  }

  // ph_compatibility — range overlap.
  {
    const tMin = tryDec(target.phMin)?.toNumber();
    const tMax = tryDec(target.phMax)?.toNumber();
    const cMin = tryDec(candidate.phMin)?.toNumber();
    const cMax = tryDec(candidate.phMax)?.toNumber();
    const score =
      tMin === undefined || tMax === undefined || cMin === undefined || cMax === undefined
        ? undefined
        : overlapRatio(tMin, tMax, cMin, cMax);
    dims.push(
      dim(
        "ph_compatibility",
        w("ph_compatibility"),
        score === undefined ? "pH range not recorded for one or both materials." : `pH range overlap ${(score * 100).toFixed(0)}%.`,
        score,
      ),
    );
  }

  // recommended_use_overlap — does the candidate's recommended range cover
  // the percentage the target line was used at?
  {
    const min = tryDec(candidate.recommendedMinPercent);
    const max = tryDec(candidate.recommendedMaxPercent);
    const used = tryDec(target.linePercent);
    const score =
      min === undefined || max === undefined || used === undefined
        ? undefined
        : used.greaterThanOrEqualTo(min) && used.lessThanOrEqualTo(max)
          ? 1
          : 0;
    dims.push(
      dim(
        "recommended_use_overlap",
        w("recommended_use_overlap"),
        score === undefined
          ? "Candidate has no recorded recommended-use range."
          : score === 1
            ? "The replaced line's percentage falls inside the candidate's recommended range."
            : "The replaced line's percentage falls outside the candidate's recommended range.",
        score,
      ),
    );
  }

  // regulatory_status
  {
    const score = candidate.regulatoryPermitted === undefined ? undefined : candidate.regulatoryPermitted ? 1 : 0;
    dims.push(
      dim(
        "regulatory_status",
        w("regulatory_status"),
        score === undefined
          ? "No verified regulatory position for the target market(s) — regulatory status is unknown, not assumed permitted."
          : score === 1
            ? "Verified permitted for the target market(s)."
            : "Verified prohibited or restricted for the target market(s).",
        score,
      ),
    );
  }

  // compatibility_impact — from a real evaluateCompatibility() re-run.
  {
    const score =
      candidate.hasBlockingCompatibilityFinding === undefined
        ? undefined
        : candidate.hasBlockingCompatibilityFinding
          ? 0
          : (candidate.compatibilityFindingIds?.length ?? 0) === 0
            ? 1
            : 0.5;
    dims.push(
      dim(
        "compatibility_impact",
        w("compatibility_impact"),
        score === undefined
          ? "Compatibility engine was not re-run for this candidate."
          : candidate.hasBlockingCompatibilityFinding
            ? "Substituting this candidate produces a blocking compatibility finding."
            : (candidate.compatibilityFindingIds?.length ?? 0) === 0
              ? "No compatibility findings for this candidate."
              : "Non-blocking compatibility findings for this candidate.",
        score,
      ),
    );
  }

  // safety_impact — from a real evaluateSafety() re-run.
  {
    const score =
      candidate.hasBlockingSafetyFinding === undefined
        ? undefined
        : candidate.hasBlockingSafetyFinding
          ? 0
          : (candidate.safetyFindingIds?.length ?? 0) === 0
            ? 1
            : 0.5;
    dims.push(
      dim(
        "safety_impact",
        w("safety_impact"),
        score === undefined
          ? "Safety engine was not re-run for this candidate."
          : candidate.hasBlockingSafetyFinding
            ? "Substituting this candidate produces a blocking safety finding."
            : (candidate.safetyFindingIds?.length ?? 0) === 0
              ? "No safety findings for this candidate."
              : "Non-blocking safety findings for this candidate.",
        score,
      ),
    );
  }

  // available_stock
  {
    const stock = tryDec(candidate.availableStockKg);
    const score = stock === undefined ? undefined : stock.greaterThan(0) ? 1 : 0;
    dims.push(
      dim(
        "available_stock",
        w("available_stock"),
        score === undefined ? "No inventory record for this candidate." : score === 1 ? "In stock." : "No available stock.",
        score,
      ),
    );
  }

  // landed_cost — lower than the target's own cost scores higher, capped at
  // a 2x-cost floor of 0 rather than going unbounded negative.
  {
    const t = tryDec(target.landedCost);
    const c = tryDec(candidate.landedCost);
    const score = t === undefined || c === undefined || t.isZero() ? undefined : Math.max(0, Math.min(1, 1 - c.minus(t).div(t).toNumber() / 2));
    dims.push(
      dim(
        "landed_cost",
        w("landed_cost"),
        score === undefined ? "Landed cost not recorded for the target or candidate." : `Target ${target.landedCost}, candidate ${candidate.landedCost} ${candidate.currency ?? ""}.`.trim(),
        score,
      ),
    );
  }

  // supplier_approved
  {
    const score = candidate.supplierApproved === undefined ? undefined : candidate.supplierApproved ? 1 : 0;
    dims.push(
      dim(
        "supplier_approved",
        w("supplier_approved"),
        score === undefined ? "No supplier record for this candidate." : score === 1 ? "Approved supplier." : "Supplier not approved.",
        score,
      ),
    );
  }

  // lead_time — <=7 days scores 1, >=60 days scores 0, linear between.
  {
    const days = candidate.leadTimeDays;
    const score = days === undefined ? undefined : Math.max(0, Math.min(1, 1 - (days - 7) / 53));
    dims.push(
      dim(
        "lead_time",
        w("lead_time"),
        score === undefined ? "Lead time not recorded." : `${days} day lead time.`,
        score,
      ),
    );
  }

  // kenya_local
  {
    const score = candidate.kenyaLocal === undefined ? undefined : candidate.kenyaLocal ? 1 : 0;
    dims.push(
      dim(
        "kenya_local",
        w("kenya_local"),
        score === undefined ? "Country of origin not recorded." : score === 1 ? "Kenya-local supply." : "Imported supply.",
        score,
      ),
    );
  }

  // evidence_confidence
  {
    const score = candidate.evidenceConfidenceScore;
    dims.push(
      dim(
        "evidence_confidence",
        w("evidence_confidence"),
        score === undefined ? "No evidence-confidence score recorded." : `Evidence confidence ${(score * 100).toFixed(0)}%.`,
        score,
      ),
    );
  }

  const totalWeight = dims.reduce((sum, d) => sum + d.weight, 0) || 1;
  const totalScore =
    dims.reduce((sum, d) => sum + (d.missingData ? missingDataPenalty * d.weight : (d.contribution ?? 0)), 0) / totalWeight;

  return { totalScore: Math.max(0, Math.min(1, totalScore)), dimensions: dims };
}

/**
 * Active-equivalent replacement (spec §5.3): a candidate at a different
 * as-supplied active-matter percentage than the target needs a different
 * raw-material percentage to contribute the same active matter, not the
 * same raw-material percentage. Returns `undefined` when either active
 * percentage is unknown — never guesses a 1:1 swap in that case.
 */
export function activeEquivalentPercent(
  targetLinePercent: string,
  targetActiveMatterPercent: string | undefined,
  candidateActiveMatterPercent: string | undefined,
): string | undefined {
  const targetActive = tryDec(targetActiveMatterPercent);
  const candidateActive = tryDec(candidateActiveMatterPercent);
  if (targetActive === undefined || candidateActive === undefined || candidateActive.isZero()) return undefined;
  const contributedActive = dec(targetLinePercent).times(targetActive).div(100);
  return contributedActive.times(100).div(candidateActive).toDecimalPlaces(4).toString();
}

/** Build the `SubstitutionCandidate` record from a scored candidate — the
 *  shape the UI and the persisted `SubstitutionRun` both consume. */
export function buildCandidateRecord(
  target: SubstitutionTarget,
  candidate: SubstitutionCandidateInput,
  scored: { totalScore: number; dimensions: SubstitutionScoreDimension[] },
  requiredFormulaChanges: RequiredFormulaChange[] = [],
): SubstitutionCandidate {
  const activeEquivalent = activeEquivalentPercent(
    target.linePercent,
    target.activeMatterPercent,
    candidate.activeMatterPercent,
  );
  const technicalCap = tryDec(candidate.technicalMaxPercent);
  const suggested = activeEquivalent ?? target.linePercent;
  const suggestedCapped =
    technicalCap !== undefined && dec(suggested).greaterThan(technicalCap) ? technicalCap.toString() : suggested;

  const reasons: string[] = [];
  if (candidate.hasBlockingCompatibilityFinding) reasons.push("blocking compatibility finding");
  if (candidate.hasBlockingSafetyFinding) reasons.push("blocking safety finding");
  if (candidate.availableStockKg !== undefined && dec(candidate.availableStockKg).lessThanOrEqualTo(0)) {
    reasons.push("no available stock");
  }
  const rankingReason =
    reasons.length > 0
      ? `Ranked down: ${reasons.join(", ")}.`
      : `Score ${(scored.totalScore * 100).toFixed(0)}% — ${scored.dimensions
          .filter((d) => !d.missingData && (d.normalizedScore ?? 0) >= 0.8)
          .map((d) => d.dimension)
          .join(", ") || "no standout dimension"}.`;

  return {
    id: `${target.materialId}->${candidate.materialId}`,
    materialId: candidate.materialId,
    materialCode: candidate.materialCode,
    name: candidate.name,
    isSystem: false,
    systemMaterialIds: [],
    suggestedPercent: suggestedCapped,
    activeEquivalentPercent: activeEquivalent,
    totalScore: scored.totalScore,
    scoreDimensions: scored.dimensions,
    compatibilityFindingIds: candidate.compatibilityFindingIds ?? [],
    safetyFindingIds: candidate.safetyFindingIds ?? [],
    hasBlockingCompatibilityFinding: candidate.hasBlockingCompatibilityFinding ?? false,
    hasBlockingSafetyFinding: candidate.hasBlockingSafetyFinding ?? false,
    costImpact:
      target.landedCost !== undefined && candidate.landedCost !== undefined
        ? dec(candidate.landedCost).minus(dec(target.landedCost)).toDecimalPlaces(6).toString()
        : undefined,
    landedCostImpact: undefined,
    stockAvailable: candidate.availableStockKg === undefined ? undefined : dec(candidate.availableStockKg).greaterThan(0),
    leadTimeDays: candidate.leadTimeDays,
    regulatoryUncertain: candidate.regulatoryPermitted === undefined,
    evidenceConfidenceScore: candidate.evidenceConfidenceScore,
    rankingReason,
    requiredFormulaChanges,
    requiresOptimization: false,
  };
}

/** Rank a set of already-scored candidates: blocking findings sort last
 *  regardless of score, then by score descending. Deterministic tie-break
 *  by `materialCode` so the same input always produces the same order. */
export function rankCandidates(candidates: SubstitutionCandidate[]): SubstitutionCandidate[] {
  return [...candidates].sort((a, b) => {
    const aBlocked = a.hasBlockingCompatibilityFinding || a.hasBlockingSafetyFinding;
    const bBlocked = b.hasBlockingCompatibilityFinding || b.hasBlockingSafetyFinding;
    if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return (a.materialCode ?? a.id).localeCompare(b.materialCode ?? b.id);
  });
}

export type { SubstitutionReason };
export const SUBSTITUTION_WEIGHTS_DEFAULT: SubstitutionWeights = {
  weights: DEFAULT_SUBSTITUTION_WEIGHTS,
  missingDataPenalty: 0,
};

/** `AuditEvent.action` values for substitution, same convention as
 *  `OPTIMIZATION_AUDIT_ACTIONS` (engine/optimization.ts). */
export const SUBSTITUTION_AUDIT_ACTIONS = {
  requested: "substitution.requested",
  candidateSelected: "substitution.candidate_selected",
  applied: "substitution.applied",
} as const;
