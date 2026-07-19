/**
 * Optimizer-adjacent helpers that do NOT solve anything.
 *
 * The actual constrained solve is a mixed-integer/linear program, run by
 * `runtime/formulation/advanced_optimizer.py` (PuLP + CBC) — see
 * docs/SOLVER_ARCHITECTURE.md for why that stays in Python rather than being
 * reimplemented here. What belongs in TypeScript is everything the UI and
 * the substitution engine need without a solver: turning current formula
 * state into a `FormulationProblem`, recomputing the same active-matter and
 * functional-group totals the solver used (so the UI can redisplay or
 * sanity-check a result without re-solving), and the fixed ceiling on what
 * this platform is honestly capable of computing for a given property.
 */
import { dec, fmt, ZERO } from "./decimal";
import { newId } from "./versioning";
import { evaluateCompatibility } from "./compatibility";
import { evaluateSafety } from "./safety";
import { SEED_COMPATIBILITY_RULES } from "../catalog/compatibilityRules";
import { SEED_SAFETY_RULES } from "../catalog/safetyRules";
import { MATERIAL_FUNCTIONS, type FormulationLine, type MaterialFunction } from "../schemas/formulation";
import type { RawMaterial } from "../schemas/materials";
import {
  FORMULATION_PROPERTIES,
  PROPERTY_CLASSIFICATIONS,
  type ConditionalConstraint,
  type FormulationProperty,
  type FunctionalConstraintBasis,
  type OptimizedFormulaLine,
  type PropertyClassification,
} from "../schemas/optimization";

/**
 * The best classification this platform can honestly claim for a property,
 * regardless of what a `PropertyTarget.requestedClassification` asks for.
 * `active_matter` and `total_solids` are exact sums over the formula lines,
 * so they are always `calculated`. `ph` and `hlb` are estimable from a
 * weighted average of material-level figures IF the candidate materials
 * carry them (an approximation industry tools commonly use for a first
 * pass — real pH is not perfectly linear in concentration, hence
 * `rule_based_estimate`, never `calculated`). Everything else — viscosity,
 * foam, hard-water tolerance, and anything stability- or efficacy-adjacent —
 * has no validated predictive model in this platform and is always
 * `laboratory_required`.
 */
export const PROPERTY_CAPABILITY: Record<FormulationProperty, PropertyClassification> = {
  active_matter: "calculated",
  total_solids: "calculated",
  ph: "rule_based_estimate",
  hlb: "rule_based_estimate",
  density: "rule_based_estimate",
  available_chlorine: "rule_based_estimate",
  peroxide_active: "rule_based_estimate",
  qac_active: "rule_based_estimate",
  chlorhexidine_active: "rule_based_estimate",
  fluoride_level: "rule_based_estimate",
  viscosity: "laboratory_required",
  foam_profile: "laboratory_required",
  hard_water_tolerance: "laboratory_required",
  wet_wipe_lotion_loading: "laboratory_required",
};

/** The classification a property target's result actually gets, capped at
 *  `PROPERTY_CAPABILITY` no matter what was requested — this is the one
 *  function anything reporting a property target result must call, so a
 *  hopeful `requestedClassification: "calculated"` on viscosity can never
 *  leak into the UI as if it were true. */
export function actualPropertyClassification(property: FormulationProperty): PropertyClassification {
  return PROPERTY_CAPABILITY[property];
}

if (process.env.NODE_ENV !== "production") {
  const missing = FORMULATION_PROPERTIES.filter((p) => !(p in PROPERTY_CAPABILITY));
  if (missing.length > 0) {
    throw new Error(`PROPERTY_CAPABILITY is missing an entry for: ${missing.join(", ")}`);
  }
}
void PROPERTY_CLASSIFICATIONS;

/** Sum of `activeContributionPercent` across a set of resolved formula
 *  lines — the same "10% of a 70%-active surfactant contributes 7% active"
 *  arithmetic the solver used, recomputable here for display and for
 *  cross-checking a persisted `OptimizationRun` without re-solving. */
export function totalActiveContribution(lines: readonly OptimizedFormulaLine[]): string {
  return fmt(lines.reduce((sum, l) => sum.plus(dec(l.activeContributionPercent)), ZERO), "percent");
}

/** Sum of raw-material `percent` across a set of resolved formula lines. */
export function totalRawPercent(lines: readonly OptimizedFormulaLine[]): string {
  return fmt(lines.reduce((sum, l) => sum.plus(dec(l.percent)), ZERO), "percent");
}

/**
 * A line's contribution to a functional-group total, on the requested
 * basis. `materialFunctions`/`materialActivePercent` come from the
 * `OptimizationMaterial` the line was resolved from (or, in a plain
 * `FormulationLine` context, its own `functions`/`activeMatterPercent`).
 * Returns 0 when the line's material has none of `groups`.
 */
export function functionalGroupContribution(
  line: { percent: string; activeContributionPercent?: string },
  materialFunctions: readonly MaterialFunction[],
  groups: readonly MaterialFunction[],
  basis: FunctionalConstraintBasis,
): string {
  const inGroup = materialFunctions.some((f) => (groups as readonly string[]).includes(f));
  if (!inGroup) return "0";
  const value =
    basis === "active_matter" && line.activeContributionPercent !== undefined
      ? line.activeContributionPercent
      : line.percent;
  return fmt(dec(value), "percent");
}

/** Every function group this platform models, for UI pickers — re-exported
 *  here rather than importing `MATERIAL_FUNCTIONS` directly in the optimizer
 *  UI, so a reader can find every optimizer-adjacent export from one module. */
export const OPTIMIZER_FUNCTION_GROUPS = MATERIAL_FUNCTIONS;

/** `AuditEvent.action` values for the optimizer, matching the dot-namespaced
 *  convention `engine/lifecycle.ts` established (`"version.retired"`, ...).
 *  Written by whichever layer performs the action (the Rust command layer
 *  for a run, the desktop UI for "applied") — this module only names them
 *  so every writer uses the same string. See docs/APPROVAL_READINESS.md. */
export const OPTIMIZATION_AUDIT_ACTIONS = {
  started: "optimization.started",
  completed: "optimization.completed",
  applied: "optimization.applied",
} as const;

// ---------------------------------------------------------------------------
// Compatibility/safety exclusion + graded risk (spec §A4/§A7)
//
// Shared by the Advanced Optimizer panel AND the Substitution panel's system-
// substitution mode, both of which need to check a candidate pool with the
// SAME real evaluateCompatibility/evaluateSafety engines before ever
// building a FormulationProblem — living here once instead of being
// re-implemented per screen.
// ---------------------------------------------------------------------------

/** Build a minimal, schema-valid two-line formulation so the real
 *  compatibility/safety engines can be asked "would these two candidates,
 *  together in a formula, produce a finding?" — this is the ONLY thing
 *  these synthetic lines are for; they are never displayed or persisted. */
export function syntheticLine(m: RawMaterial, lineNumber: number): FormulationLine {
  return {
    id: `synthetic-${m.code}`,
    lineNumber,
    phase: "A",
    materialCode: m.code,
    displayName: m.displayName,
    functions: m.functions,
    percent: "10",
    isQsToHundred: false,
    activeMatterPercent: m.activeMatterPercent,
    provenance: { origin: "model_estimate", evidenceClaimIds: [] },
  };
}

/**
 * The real implementation of `compatibilityPolicy`/`safetyPolicy`'s
 * `"exclude_blocking"` mode: every pair of candidate materials is checked
 * with the SAME engines the Compatibility/Safety tabs use, and a pair that
 * produces a `blocking` finding becomes an `if_present_then_excluded`
 * conditional constraint, so the solver can never select both. O(n²) rule
 * evaluations over the candidate pool — fine at the pool sizes (tens of
 * materials) this deals with, not attempted for a full raw-material library.
 */
export function blockingExclusionConstraints(
  chosen: RawMaterial[],
  allMaterials: RawMaterial[],
): ConditionalConstraint[] {
  const constraints: ConditionalConstraint[] = [];
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      const a = chosen[i];
      const b = chosen[j];
      const lines = [syntheticLine(a, 0), syntheticLine(b, 1)];
      const compat = evaluateCompatibility(lines, SEED_COMPATIBILITY_RULES, { materials: allMaterials });
      const safety = evaluateSafety(lines, SEED_SAFETY_RULES, { materials: allMaterials });
      const blocked = compat.some((f) => f.severity === "blocking") || safety.some((f) => f.severity === "blocking");
      if (!blocked) continue;
      constraints.push({
        id: newId("cond"),
        displayName: `${a.code} excludes ${b.code}`,
        conditionType: "if_present_then_excluded",
        trigger: { materialId: a.code },
        target: { materialId: b.code },
        severity: "blocking",
        strictness: "hard",
        verificationStatus: "not_verified",
        presenceThresholdPercent: "0.001",
        active: true,
      });
    }
  }
  return constraints;
}

const SEVERITY_RISK_WEIGHT: Record<"info" | "warning" | "error", number> = {
  info: 0.1,
  warning: 0.4,
  error: 0.8,
};

/** A `human_review_required`/incomplete-data finding is weighted UP, not
 *  skipped — unknown data is never treated as safe (the platform-wide
 *  DATA_STATES convention, applied here to risk scoring). */
const UNVERIFIED_RISK_MULTIPLIER = 1.3;

/**
 * The real implementation behind the `compatibility_risk`/`safety_risk`
 * objective metrics (spec §A4). `blockingExclusionConstraints` above already
 * turns every `blocking` finding into a hard exclusion — this instead scores
 * every non-blocking finding (info/warning/error) so the optimizer can
 * genuinely prefer a lower-risk candidate when cost/other constraints allow
 * it, rather than the two risk objectives evaluating to a flat, meaningless
 * zero. Uses the SAME evaluateCompatibility/evaluateSafety engines — no rule
 * logic is duplicated here.
 *
 * Scored per MATERIAL (summed across every pairing it appears in among the
 * chosen candidates, capped at 1.0), because the solver's objective is
 * linear in one variable per material, not a pairwise matrix. Every chosen
 * material gets an explicit `0`, never `undefined`, as soon as there is at
 * least one other candidate to pair it against — `undefined` (meaning "no
 * data, contributes nothing to the objective") is reserved for the genuine
 * edge case of a single-candidate pool where no pairwise evaluation is even
 * possible, never used as a shortcut for "did not bother checking".
 */
export function gradedRiskScores(
  chosen: RawMaterial[],
  allMaterials: RawMaterial[],
): { compatibilityRisk: Record<string, number>; safetyRisk: Record<string, number> } {
  const compatibilityRisk: Record<string, number> = {};
  const safetyRisk: Record<string, number> = {};
  if (chosen.length < 2) return { compatibilityRisk, safetyRisk };

  for (const m of chosen) {
    compatibilityRisk[m.code] = 0;
    safetyRisk[m.code] = 0;
  }

  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      const lines = [syntheticLine(chosen[i], 0), syntheticLine(chosen[j], 1)];
      const compat = evaluateCompatibility(lines, SEED_COMPATIBILITY_RULES, { materials: allMaterials });
      const safety = evaluateSafety(lines, SEED_SAFETY_RULES, { materials: allMaterials });

      for (const f of compat) {
        if (f.severity === "blocking") continue; // already a hard exclusion via blockingExclusionConstraints.
        let weight = SEVERITY_RISK_WEIGHT[f.severity];
        if (f.verificationStatus === "human_review_required" || f.dataIncomplete) weight *= UNVERIFIED_RISK_MULTIPLIER;
        for (const code of f.materialIds) {
          if (code in compatibilityRisk) compatibilityRisk[code] = Math.min(1, compatibilityRisk[code] + weight);
        }
      }
      for (const f of safety) {
        if (f.severity === "blocking") continue;
        let weight = SEVERITY_RISK_WEIGHT[f.severity];
        if (f.humanReviewRequired || f.dataIncomplete) weight *= UNVERIFIED_RISK_MULTIPLIER;
        for (const code of f.affectedMaterialIds) {
          if (code in safetyRisk) safetyRisk[code] = Math.min(1, safetyRisk[code] + weight);
        }
      }
    }
  }

  return { compatibilityRisk, safetyRisk };
}

