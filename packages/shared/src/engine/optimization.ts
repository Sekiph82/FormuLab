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
import { MATERIAL_FUNCTIONS, type MaterialFunction } from "../schemas/formulation";
import {
  FORMULATION_PROPERTIES,
  PROPERTY_CLASSIFICATIONS,
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

