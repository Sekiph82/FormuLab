/**
 * The Advanced Formulation Constraint Optimizer's domain model.
 *
 * This module is the contract between the desktop UI, the persisted run
 * history, and the Python/PuLP solver (`runtime/formulation/
 * advanced_optimizer.py`) — the solver's JSON input and output are built to
 * validate against `formulationProblemSchema` and
 * `advancedOptimizationResultSchema` respectively, so a payload that fails
 * Zod here would also be rejected by the Pydantic model on the Python side
 * (see `docs/SOLVER_ARCHITECTURE.md` for how the two are kept in sync by
 * hand rather than generated, matching the same tradeoff already made for
 * `HUMAN_ONLY_STATUSES` and the compatibility/safety rule shapes).
 *
 * This is a separate, additive contract from the original simple optimizer
 * (`runtime/formulation/formulation_core.py`, `OptimizerPage.tsx`), which is
 * untouched and keeps working exactly as it did. Nothing here changes its
 * input or output shape.
 *
 * Percentages and money are decimal STRINGS (`decimalString`), same
 * convention as `schemas/formulation.ts` and `schemas/materials.ts` — this
 * schema does not introduce a second number representation into the
 * platform.
 */
import { z } from "zod";
import { decimalString, MATERIAL_FUNCTIONS } from "./formulation";
import { DATA_STATES, IONIC_CHARACTERS } from "./materials";

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/** Whether a constraint may be violated at all. A soft constraint can be
 *  violated only with a reported penalty and an explicit explanation in the
 *  result — it never just silently disappears. */
export const CONSTRAINT_STRICTNESS = ["hard", "soft"] as const;
export type ConstraintStrictness = (typeof CONSTRAINT_STRICTNESS)[number];

export const CONSTRAINT_SEVERITIES = ["info", "warning", "error", "blocking"] as const;
export type ConstraintSeverity = (typeof CONSTRAINT_SEVERITIES)[number];

/** Mirrors `RuleVerificationStatus` (schemas/compatibility.ts) so a
 *  constraint carries the same honesty convention as a compatibility or
 *  safety rule: nothing here is authoritative just because it is loaded into
 *  the solver. */
export const OPTIMIZATION_VERIFICATION_STATUSES = [
  "verified",
  "not_verified",
  "human_review_required",
] as const;
export type OptimizationVerificationStatus = (typeof OPTIMIZATION_VERIFICATION_STATUSES)[number];

/** How a soft constraint's deviation from target is penalized. `linear_absolute`
 *  penalizes distance from target in either direction; `under_target`/
 *  `over_target` penalize only the one direction that matters for a
 *  minimum-style or maximum-style constraint (a soft minimum is never
 *  penalized for exceeding it). */
export const SOFT_PENALTY_TYPES = ["linear_absolute", "under_target", "over_target"] as const;
export type SoftPenaltyType = (typeof SOFT_PENALTY_TYPES)[number];

/** Common metadata every constraint type carries, spread into each concrete
 *  constraint schema below rather than factored into a wrapper object — the
 *  solver and the UI both want a flat, constraint-type-specific shape. */
const constraintMetaShape = {
  id: z.string().min(1),
  displayName: z.string().min(1),
  severity: z.enum(CONSTRAINT_SEVERITIES).default("error"),
  strictness: z.enum(CONSTRAINT_STRICTNESS).default("hard"),
  source: z.string().optional(),
  verificationStatus: z.enum(OPTIMIZATION_VERIFICATION_STATUSES).default("not_verified"),
  explanation: z.string().optional(),
  active: z.boolean().default(true),
  /** Required when `strictness: "soft"`; ignored for a hard constraint. A
   *  soft constraint with no `penaltyWeight` is rejected by the solver
   *  (`OptimizerError`) rather than silently treated as unweighted (weight
   *  0 would mean "never enforce it," which is not the same as "soft"). */
  penaltyWeight: decimalString.optional(),
  penaltyType: z.enum(SOFT_PENALTY_TYPES).optional(),
  /** Deviation (in the constraint's own unit — percentage points for a
   *  composition/functional constraint, a ratio unit for a ratio
   *  constraint) within which a soft constraint counts as `satisfied`
   *  despite the slack not being exactly zero. Defaults to 0. */
  allowedDeviation: decimalString.optional(),
  deviationUnit: z.string().optional(),
  /** Lexicographic tier a soft constraint's penalty belongs to, mirroring
   *  `OptimizationObjective.priority` — a soft constraint can be prioritized
   *  against another the same way objectives are. Ignored for `weighted`. */
  priority: z.number().int().nonnegative().optional(),
};

// ---------------------------------------------------------------------------
// Optimization material
// ---------------------------------------------------------------------------

/** A value the solver needs, together with why it might be absent. Mirrors
 *  `DATA_STATES` (schemas/materials.ts): an unknown active-matter percentage,
 *  price or regulatory maximum is never silently treated as zero — the
 *  solver either excludes the material from the constraints that need that
 *  figure, or reports it as `dataIncomplete`, but it never guesses. */
export const optimizationValueSchema = z.object({
  value: decimalString.optional(),
  state: z.enum(DATA_STATES).default("missing"),
});
export type OptimizationValue = z.infer<typeof optimizationValueSchema>;

export const optimizationMaterialSchema = z.object({
  id: z.string().min(1),
  materialCode: z.string().min(1),
  name: z.string().min(1),
  supplierCode: z.string().optional(),

  price: optimizationValueSchema,
  currency: z.string().default("KES"),
  rawMaterialCost: optimizationValueSchema.optional(),
  landedCost: optimizationValueSchema.optional(),

  stock: optimizationValueSchema.optional(),
  reservedStock: optimizationValueSchema.optional(),
  /** Derived (`stock - reservedStock`) when both are known; carried
   *  explicitly so the solver and a human reading a saved problem agree on
   *  the same number without recomputing it differently. */
  availableStock: optimizationValueSchema.optional(),

  activeMatterPercent: optimizationValueSchema,
  solidsPercent: optimizationValueSchema.optional(),
  waterPercent: optimizationValueSchema.optional(),
  density: optimizationValueSchema.optional(),
  /** Hydrophile-lipophile balance, for the `hlb` property target's weighted
   *  average — a real linear calculation, still only a `rule_based_estimate`
   *  (see `PROPERTY_CAPABILITY`, engine/optimization.ts) since a formula's
   *  effective HLB is not a strict linear function of its emulsifiers'
   *  individual HLB values in reality. */
  hlb: optimizationValueSchema.optional(),

  functions: z.array(z.enum(MATERIAL_FUNCTIONS)).default([]),
  ionicCharacter: z.enum(IONIC_CHARACTERS).optional(),

  minUsePercent: decimalString.optional(),
  maxUsePercent: decimalString.optional(),
  technicalMaxPercent: decimalString.optional(),
  regulatoryMaxPercent: optimizationValueSchema.optional(),

  /** 0 (best) .. 1 (worst). Optional and never invented — absent unless a
   *  human or an explicit scoring rule set it. */
  supplyRiskScore: z.number().min(0).max(1).optional(),
  /** 0 (best) .. 1 (worst) graded compatibility/safety risk (spec §A4),
   *  computed by the CALLER from real `evaluateCompatibility`/`evaluateSafety`
   *  findings against the rest of the candidate pool — see
   *  `gradedRiskScores` in AdvancedOptimizerPanel.tsx. The solver only
   *  consumes these numbers; it never runs the compatibility/safety rules
   *  itself. A `blocking` finding never reaches here — that already became a
   *  hard `if_present_then_excluded` conditional constraint, so these two
   *  scores only ever reflect non-blocking (info/warning/error) findings. */
  compatibilityRiskScore: z.number().min(0).max(1).optional(),
  safetyRiskScore: z.number().min(0).max(1).optional(),
  /** 0 (no evidence) .. 1 (fully verified). */
  evidenceConfidenceScore: z.number().min(0).max(1).optional(),
  /** Lower is better; unit and basis are the caller's convention (e.g.
   *  kg CO2e / kg material) and are not standardized by this schema. */
  carbonScore: z.number().optional(),

  /** CAS numbers, for compatibility/safety rule matching via the same
   *  `RuleCondition.casNumbersAny` mechanism the compatibility and safety
   *  engines already use — see `compatibilityOptimizationPolicySchema`. */
  casNumbers: z.array(z.string()).default([]),
  /** True when this candidate is currently locked to a fixed percentage in
   *  the formula being optimized (spec: "Lock ingredient percentage"). */
  lockedPercent: decimalString.optional(),
  /** True when the user explicitly excluded this material from the run,
   *  distinct from it simply not being offered as a candidate. */
  excluded: z.boolean().default(false),
});
export type OptimizationMaterial = z.infer<typeof optimizationMaterialSchema>;

// ---------------------------------------------------------------------------
// Composition constraints
// ---------------------------------------------------------------------------

export const COMPOSITION_CONSTRAINT_TYPES = [
  "exact_percentage",
  "min_percentage",
  "max_percentage",
  "percentage_range",
  "fixed_ingredient",
  "excluded_ingredient",
  "total_equals_100",
  "water_qs",
  "min_phase_percentage",
  "max_phase_percentage",
  "min_total_active_matter",
  "max_total_active_matter",
  "min_total_solids",
  "max_total_solids",
  "min_total_water",
  "max_total_water",
] as const;
export type CompositionConstraintType = (typeof COMPOSITION_CONSTRAINT_TYPES)[number];

export const compositionConstraintSchema = z.object({
  ...constraintMetaShape,
  constraintType: z.enum(COMPOSITION_CONSTRAINT_TYPES),
  /** Required for a per-material constraint type; absent for the
   *  formula-wide types (`total_equals_100`, `min_total_active_matter`, ...). */
  materialId: z.string().optional(),
  /** Required for `min_phase_percentage` / `max_phase_percentage`. */
  phase: z.string().optional(),
  minPercent: decimalString.optional(),
  maxPercent: decimalString.optional(),
  exactPercent: decimalString.optional(),
});
export type CompositionConstraint = z.infer<typeof compositionConstraintSchema>;

// ---------------------------------------------------------------------------
// Functional-group constraints
// ---------------------------------------------------------------------------

/** Whether a functional constraint is measured on the raw-material
 *  percentage of the group's members, or on the active-matter percentage
 *  they actually contribute (10% of a 70%-active surfactant contributes 7%
 *  active surfactant — the two bases are not interchangeable). */
export const FUNCTIONAL_CONSTRAINT_BASES = ["raw_material", "active_matter"] as const;
export type FunctionalConstraintBasis = (typeof FUNCTIONAL_CONSTRAINT_BASES)[number];

export const FUNCTIONAL_CONSTRAINT_TYPES = ["min_total", "max_total", "at_least_one_present"] as const;
export type FunctionalConstraintType = (typeof FUNCTIONAL_CONSTRAINT_TYPES)[number];

export const functionalConstraintSchema = z.object({
  ...constraintMetaShape,
  functionGroups: z.array(z.enum(MATERIAL_FUNCTIONS)).min(1),
  basis: z.enum(FUNCTIONAL_CONSTRAINT_BASES).default("raw_material"),
  constraintType: z.enum(FUNCTIONAL_CONSTRAINT_TYPES),
  /** Required for `min_total` / `max_total`; ignored for `at_least_one_present`. */
  value: decimalString.optional(),
});
export type FunctionalConstraint = z.infer<typeof functionalConstraintSchema>;

// ---------------------------------------------------------------------------
// Ratio constraints
// ---------------------------------------------------------------------------

export const RATIO_CONSTRAINT_TYPES = ["min_ratio", "max_ratio", "exact_ratio"] as const;
export type RatioConstraintType = (typeof RATIO_CONSTRAINT_TYPES)[number];

/** One side of a ratio: either a specific set of materials (summed) or a set
 *  of functional groups (summed on the given basis). Exactly one of
 *  `materialIds` / `functionGroups` is expected — enforced by
 *  `engine/optimization.ts`, not by Zod, so the error message can name which
 *  side is malformed. */
export const ratioSideSchema = z.object({
  materialIds: z.array(z.string()).optional(),
  functionGroups: z.array(z.enum(MATERIAL_FUNCTIONS)).optional(),
  basis: z.enum(FUNCTIONAL_CONSTRAINT_BASES).default("raw_material"),
});
export type RatioSide = z.infer<typeof ratioSideSchema>;

export const ratioConstraintSchema = z.object({
  ...constraintMetaShape,
  numerator: ratioSideSchema,
  denominator: ratioSideSchema,
  ratioType: z.enum(RATIO_CONSTRAINT_TYPES),
  value: decimalString,
});
export type RatioConstraint = z.infer<typeof ratioConstraintSchema>;

// ---------------------------------------------------------------------------
// Conditional constraints
// ---------------------------------------------------------------------------

export const CONDITIONAL_CONSTRAINT_TYPES = [
  /** If the trigger material/group is present at all, the target
   *  material/group must also be present (at a minimum trace amount). */
  "if_present_then_required",
  /** If the trigger material's percentage exceeds `triggerThresholdPercent`,
   *  the target material/group must reach at least `targetMinPercent`. */
  "if_exceeds_then_min_required",
  /** If the trigger material/group is present, the target material/group is
   *  forced to zero (an adapter over the compatibility/safety engines'
   *  `forbidden_combination` rules — see `compatibilityOptimizationPolicySchema`). */
  "if_present_then_excluded",
] as const;
export type ConditionalConstraintType = (typeof CONDITIONAL_CONSTRAINT_TYPES)[number];

/** One side of a conditional trigger/target: a specific material, or any
 *  member of a functional group. */
export const conditionalSideSchema = z.object({
  materialId: z.string().optional(),
  functionGroup: z.enum(MATERIAL_FUNCTIONS).optional(),
});
export type ConditionalSide = z.infer<typeof conditionalSideSchema>;

export const conditionalConstraintSchema = z.object({
  ...constraintMetaShape,
  conditionType: z.enum(CONDITIONAL_CONSTRAINT_TYPES),
  trigger: conditionalSideSchema,
  target: conditionalSideSchema,
  /** Required for `if_exceeds_then_min_required`. */
  triggerThresholdPercent: decimalString.optional(),
  targetMinPercent: decimalString.optional(),
  /** Trace presence used for `if_present_then_required` — the smallest
   *  percentage that counts as "present" rather than absent-but-nonzero
   *  solver noise. Defaults to the same epsilon the solver clamps dust to. */
  presenceThresholdPercent: decimalString.default("0.001"),
});
export type ConditionalConstraint = z.infer<typeof conditionalConstraintSchema>;

// ---------------------------------------------------------------------------
// Property targets
// ---------------------------------------------------------------------------

export const FORMULATION_PROPERTIES = [
  "ph",
  "viscosity",
  "density",
  "active_matter",
  "total_solids",
  "available_chlorine",
  "peroxide_active",
  "qac_active",
  "chlorhexidine_active",
  "fluoride_level",
  "foam_profile",
  "hard_water_tolerance",
  "hlb",
  "wet_wipe_lotion_loading",
] as const;
export type FormulationProperty = (typeof FORMULATION_PROPERTIES)[number];

/** How a property's value in the result was obtained. Never claim more
 *  certainty than this: `viscosity`, `foam_profile`, `hard_water_tolerance`
 *  and stability-adjacent properties have no validated predictive model in
 *  this platform and are always `laboratory_required`, whatever a target
 *  asks for. */
export const PROPERTY_CLASSIFICATIONS = [
  "calculated",
  "rule_based_estimate",
  "model_estimate",
  "laboratory_required",
  "unknown",
] as const;
export type PropertyClassification = (typeof PROPERTY_CLASSIFICATIONS)[number];

export const propertyTargetSchema = z.object({
  id: z.string().min(1),
  property: z.enum(FORMULATION_PROPERTIES),
  targetValue: decimalString.optional(),
  minValue: decimalString.optional(),
  maxValue: decimalString.optional(),
  unit: z.string().optional(),
  /** Declared by the caller (a profile, or the user) as what this platform
   *  is capable of for this property — see `engine/optimization.ts`'s
   *  `PROPERTY_CAPABILITY` for the platform's actual, fixed capability per
   *  property, which the solver enforces regardless of what is requested
   *  here. */
  requestedClassification: z.enum(PROPERTY_CLASSIFICATIONS).default("unknown"),
  /** Only meaningful for a property whose `PROPERTY_CAPABILITY` is
   *  `calculated` or `rule_based_estimate` — a `laboratory_required`
   *  property can never be enforced as a constraint (`constraintStatus`
   *  will read `unsupported` in the result regardless of what is set here).
   *  Absent (the default) means the target is informational-only: reported,
   *  never enforced. */
  enforceAs: z.enum(["hard", "soft"]).optional(),
  penaltyWeight: decimalString.optional(),
  penaltyType: z.enum(SOFT_PENALTY_TYPES).optional(),
});
export type PropertyTarget = z.infer<typeof propertyTargetSchema>;

// ---------------------------------------------------------------------------
// Compatibility / safety / regulatory adapter policy
// ---------------------------------------------------------------------------

/** How the optimizer treats the compatibility engine's findings — it never
 *  duplicates the rule set, only reacts to findings the real engine (see
 *  `engine/compatibility.ts`) produces for a candidate combination.
 *  `exclude_blocking` (the default) turns every `blocking`-severity finding
 *  into a hard `if_present_then_excluded` pair; `penalize` instead adds a
 *  `compatibility_risk` objective contribution; `ignore_for_this_run` is
 *  available for exploratory scenarios but never changes what the
 *  Compatibility tab itself reports once a result is applied. */
export const compatibilityOptimizationPolicySchema = z.object({
  mode: z.enum(["exclude_blocking", "penalize", "ignore_for_this_run"]).default("exclude_blocking"),
  ruleSnapshotVersion: z.string().optional(),
});
export type CompatibilityOptimizationPolicy = z.infer<typeof compatibilityOptimizationPolicySchema>;

export const safetyOptimizationPolicySchema = z.object({
  mode: z.enum(["exclude_blocking", "penalize", "ignore_for_this_run"]).default("exclude_blocking"),
  ruleSnapshotVersion: z.string().optional(),
});
export type SafetyOptimizationPolicy = z.infer<typeof safetyOptimizationPolicySchema>;

/** The Regulatory Engine (spec §13) is not implemented — see
 *  `docs/architecture/IMPLEMENTATION_STATUS.md`. This policy is accepted so
 *  a `FormulationProblem` has a stable place for it to plug into later, but
 *  `mode` can currently only be `"not_available"`; the solver ignores it. */
export const regulatoryOptimizationPolicySchema = z.object({
  mode: z.literal("not_available").default("not_available"),
  notes: z.string().optional(),
});
export type RegulatoryOptimizationPolicy = z.infer<typeof regulatoryOptimizationPolicySchema>;

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

export const OPTIMIZATION_METRICS = [
  "raw_material_cost",
  "landed_cost",
  "total_factory_cost",
  "compatibility_risk",
  "safety_risk",
  "regulatory_uncertainty",
  "supply_risk",
  "carbon_score",
  "stock_utilization",
  "evidence_confidence",
  "performance_score",
] as const;
export type OptimizationMetric = (typeof OPTIMIZATION_METRICS)[number];

export const OBJECTIVE_DIRECTIONS = ["minimize", "maximize"] as const;
export type ObjectiveDirection = (typeof OBJECTIVE_DIRECTIONS)[number];

export const optimizationObjectiveSchema = z.object({
  metric: z.enum(OPTIMIZATION_METRICS),
  direction: z.enum(OBJECTIVE_DIRECTIONS),
  /** Required for `weighted`; ignored for `lexicographic`. */
  weight: decimalString.optional(),
  /** Required for `lexicographic` (lower runs first); ignored for `weighted`. */
  priority: z.number().int().nonnegative().optional(),
});
export type OptimizationObjective = z.infer<typeof optimizationObjectiveSchema>;

export const OBJECTIVE_STRATEGIES = ["weighted", "lexicographic"] as const;
export type ObjectiveStrategy = (typeof OBJECTIVE_STRATEGIES)[number];

export const objectiveConfigSchema = z.object({
  type: z.enum(OBJECTIVE_STRATEGIES),
  objectives: z.array(optimizationObjectiveSchema).min(1),
});
export type ObjectiveConfig = z.infer<typeof objectiveConfigSchema>;

// ---------------------------------------------------------------------------
// Solver configuration
// ---------------------------------------------------------------------------

export const solverConfigSchema = z.object({
  /** CBC is the only solver wired in — see docs/SOLVER_ARCHITECTURE.md for
   *  the adapter interface a future solver would implement. */
  solver: z.literal("cbc").default("cbc"),
  timeoutSeconds: z.number().positive().max(300).default(30),
  /** Best-effort: the Rust command can drop the child process, which ends
   *  the solve, but CBC itself is not asked to checkpoint a partial result. */
  cancellable: z.boolean().default(true),
  /** Write the generated LP model to a temp file for diagnosis. Never
   *  written into a workspace folder or provenance — see
   *  docs/SOLVER_ARCHITECTURE.md's "no secrets in solver files" note. */
  exportLpFile: z.boolean().default(false),
});
export type SolverConfig = z.infer<typeof solverConfigSchema>;

// ---------------------------------------------------------------------------
// The problem
// ---------------------------------------------------------------------------

export const batchDefinitionSchema = z.object({
  sizeKg: decimalString,
  densityKgPerL: decimalString.optional(),
});
export type BatchDefinition = z.infer<typeof batchDefinitionSchema>;

export const formulationProblemSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  projectId: z.string().min(1),
  formulaVersionId: z.string().optional(),
  productFamilyId: z.string().min(1),
  packagingSkuIds: z.array(z.string()).default([]),
  marketProfileIds: z.array(z.string()).default([]),

  batch: batchDefinitionSchema,
  materials: z.array(optimizationMaterialSchema).min(1),

  compositionConstraints: z.array(compositionConstraintSchema).default([]),
  functionalConstraints: z.array(functionalConstraintSchema).default([]),
  ratioConstraints: z.array(ratioConstraintSchema).default([]),
  conditionalConstraints: z.array(conditionalConstraintSchema).default([]),
  propertyTargets: z.array(propertyTargetSchema).default([]),
  /** A global raw-material-cost budget — the one soft constraint that is
   *  not per-material or per-group, so it gets its own field rather than a
   *  synthetic `CompositionConstraint`. Always `over_target`-style: cost
   *  above `value` is penalized, cost below it never is. Hard cost ceilings
   *  are not supported — a strict budget the solver cannot exceed under any
   *  circumstance is architecturally a hard hard-material-cost constraint,
   *  which would need a Big-M-free linear cap already achievable by
   *  tightening `raw_material_cost`'s weight; a true hard ceiling risks
   *  turning any tight budget into silent infeasibility with no
   *  informative cause, which is worse than a graded penalty. */
  costCeiling: z
    .object({
      value: decimalString,
      currency: z.string().default("KES"),
      penaltyWeight: decimalString,
    })
    .optional(),

  compatibilityPolicy: compatibilityOptimizationPolicySchema.default({
    mode: "exclude_blocking",
  }),
  safetyPolicy: safetyOptimizationPolicySchema.default({ mode: "exclude_blocking" }),
  regulatoryPolicy: regulatoryOptimizationPolicySchema.optional(),

  objectiveConfig: objectiveConfigSchema,
  solverConfig: solverConfigSchema.default({
    solver: "cbc",
    timeoutSeconds: 30,
    cancellable: true,
    exportLpFile: false,
  }),
  /** Documentation pointer, not a duplicated numeric table — the actual
   *  rounding/precision rules live in one place, `engine/decimal.ts` /
   *  `docs/PRECISION_POLICY.md`, and this field just records which version
   *  of that policy the problem was built under. */
  precisionPolicyVersion: z.string().default("1.0"),

  createdAt: z.string(),
});
export type FormulationProblem = z.infer<typeof formulationProblemSchema>;

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export const OPTIMIZATION_RUN_STATUSES = [
  "optimal",
  "feasible",
  /** Every hard constraint is satisfied, but at least one soft constraint's
   *  slack is nonzero beyond its `allowedDeviation` — the result is real and
   *  usable, but it is not the "everything requested was met" result an
   *  unqualified `optimal` would imply. See docs/SOFT_CONSTRAINTS.md. */
  "feasible_with_penalties",
  "infeasible",
  "unbounded",
  "timeout",
  "cancelled",
  "error",
] as const;
export type OptimizationRunStatus = (typeof OPTIMIZATION_RUN_STATUSES)[number];

export const optimizedFormulaLineSchema = z.object({
  materialId: z.string().min(1),
  materialCode: z.string().min(1),
  name: z.string().min(1),
  percent: decimalString,
  /** Active-matter percentage this line contributes to the formula total —
   *  distinct from the material's own as-supplied active-matter percentage. */
  activeContributionPercent: decimalString,
  quantityKg: decimalString,
  rawMaterialCost: decimalString.optional(),
  landedCost: decimalString.optional(),
});
export type OptimizedFormulaLine = z.infer<typeof optimizedFormulaLineSchema>;

export const optimizationTotalsSchema = z.object({
  batchKg: decimalString,
  totalPercent: decimalString,
  totalActiveMatterPercent: decimalString,
  totalRawMaterialCost: decimalString.optional(),
  totalLandedCost: decimalString.optional(),
});
export type OptimizationTotals = z.infer<typeof optimizationTotalsSchema>;

export const objectiveResultSchema = z.object({
  metric: z.enum(OPTIMIZATION_METRICS),
  direction: z.enum(OBJECTIVE_DIRECTIONS),
  /** The metric's own value, in its own unit (e.g. KES for cost). */
  rawValue: decimalString,
  /** 0..1, after the normalization described in
   *  docs/MULTI_OBJECTIVE_OPTIMIZATION.md — only meaningful for `weighted`. */
  normalizedValue: decimalString.optional(),
  weight: decimalString.optional(),
  contribution: decimalString.optional(),
  /** For `lexicographic`, which priority stage produced this value. */
  priority: z.number().int().nonnegative().optional(),
});
export type ObjectiveResult = z.infer<typeof objectiveResultSchema>;

export const constraintResultSchema = z.object({
  constraintId: z.string().min(1),
  kind: z.enum(["composition", "functional", "ratio", "conditional", "property", "cost"]),
  strictness: z.enum(CONSTRAINT_STRICTNESS),
  satisfied: z.boolean(),
  /** How far from the boundary the optimal solution landed (positive =
   *  slack/room to spare; only meaningful for inequality constraints). */
  slack: decimalString.optional(),
  /** The constraint's own target value, in its own unit — only set for a
   *  soft constraint (a hard constraint's target is exactly what its
   *  `minPercent`/`maxPercent`/`value`/etc. already says). */
  requestedTarget: decimalString.optional(),
  /** What the optimal solution actually achieved for this constraint's
   *  expression — set for a soft constraint alongside `requestedTarget`. */
  achievedValue: decimalString.optional(),
  /** `|achievedValue - requestedTarget|` in the constraint's own unit —
   *  zero for a fully-satisfied soft constraint, nonzero for a relaxed one. */
  deviation: decimalString.optional(),
  /** Set on a soft constraint the optimizer chose to violate. */
  penaltyApplied: decimalString.optional(),
  message: z.string().optional(),
});
export type ConstraintResult = z.infer<typeof constraintResultSchema>;

export const optimizationWarningSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(CONSTRAINT_SEVERITIES),
  message: z.string().min(1),
  materialIds: z.array(z.string()).default([]),
});
export type OptimizationWarning = z.infer<typeof optimizationWarningSchema>;

export const infeasibilityCauseSchema = z.object({
  code: z.string().min(1),
  constraintIds: z.array(z.string()).default([]),
  materialIds: z.array(z.string()).default([]),
  message: z.string().min(1),
  calculatedLimit: decimalString.optional(),
  requestedLimit: decimalString.optional(),
  suggestedActions: z.array(z.string()).default([]),
});
export type InfeasibilityCause = z.infer<typeof infeasibilityCauseSchema>;

export const infeasibilityReportSchema = z.object({
  causes: z.array(infeasibilityCauseSchema).min(1),
});
export type InfeasibilityReport = z.infer<typeof infeasibilityReportSchema>;

/** Shadow prices for the binding constraints of the LP relaxation. Only
 *  produced when the solved model was pure-LP (no active
 *  `if_present_then_*` conditional constraint introduced a binary variable)
 *  — CBC's duals are not meaningful for a mixed-integer solve, and this
 *  report says so rather than printing a number that looks precise but
 *  isn't. See docs/SOLVER_ARCHITECTURE.md. */
export const sensitivityReportSchema = z.object({
  available: z.boolean(),
  unavailableReason: z.string().optional(),
  shadowPrices: z
    .array(z.object({ constraintId: z.string(), shadowPrice: decimalString }))
    .default([]),
});
export type SensitivityReport = z.infer<typeof sensitivityReportSchema>;

export const solverMetadataSchema = z.object({
  solver: z.string().default("cbc"),
  solveTimeMs: z.number().nonnegative(),
  variableCount: z.number().int().nonnegative(),
  constraintCount: z.number().int().nonnegative(),
  isMixedInteger: z.boolean(),
  timeoutSeconds: z.number().positive(),
  cancelled: z.boolean().default(false),
});
export type SolverMetadata = z.infer<typeof solverMetadataSchema>;

/** What the solver actually did with one `PropertyTarget`. `constraintStatus`
 *  is separate from `classification`: a property can be `calculated` (an
 *  honest, exact figure) yet still `unsupported` as a *constraint* if the
 *  caller never asked `enforceAs` to bind it — the value is still reported,
 *  just not enforced. See docs/PROPERTY_TARGETS.md. */
export const PROPERTY_CONSTRAINT_STATUSES = [
  "enforced_hard",
  "enforced_soft_satisfied",
  "enforced_soft_violated",
  "reported_only",
  "unsupported",
] as const;
export type PropertyConstraintStatus = (typeof PROPERTY_CONSTRAINT_STATUSES)[number];

export const propertyResultSchema = z.object({
  targetId: z.string().min(1),
  property: z.enum(FORMULATION_PROPERTIES),
  targetValue: decimalString.optional(),
  /** The computed/estimated value — absent when the property is
   *  `laboratory_required` or data was too incomplete to compute even a
   *  rule-based estimate. */
  value: decimalString.optional(),
  /** Free-text, human-readable description of exactly how `value` was
   *  derived (e.g. "sum of active-matter contribution from materials
   *  functioning as qac_active", "batch_kg / sum(kg_i / density_i)") — so a
   *  chemist can judge the estimate's own reliability, not just its number. */
  method: z.string().optional(),
  dataCompleteness: z.enum(["complete", "partial", "insufficient"]),
  classification: z.enum(PROPERTY_CLASSIFICATIONS),
  constraintStatus: z.enum(PROPERTY_CONSTRAINT_STATUSES),
  /** True whenever `classification` is not `calculated` — i.e. for every
   *  `rule_based_estimate`/`model_estimate`/`laboratory_required` property,
   *  restated here as a plain boolean so a UI does not have to know the
   *  classification taxonomy just to decide whether to show a warning. */
  laboratoryConfirmationRequired: z.boolean(),
});
export type PropertyResult = z.infer<typeof propertyResultSchema>;

export const advancedOptimizationResultSchema = z.object({
  schemaVersion: z.literal("1.0"),
  runId: z.string().min(1),
  problemId: z.string().min(1),
  status: z.enum(OPTIMIZATION_RUN_STATUSES),

  formulaLines: z.array(optimizedFormulaLineSchema).default([]),
  totals: optimizationTotalsSchema.optional(),
  objectiveResults: z.array(objectiveResultSchema).default([]),
  constraintResults: z.array(constraintResultSchema).default([]),
  propertyResults: z.array(propertyResultSchema).default([]),
  warnings: z.array(optimizationWarningSchema).default([]),
  infeasibility: infeasibilityReportSchema.optional(),
  sensitivity: sensitivityReportSchema.optional(),
  solverMetadata: solverMetadataSchema,

  completedAt: z.string(),
});
export type AdvancedOptimizationResult = z.infer<typeof advancedOptimizationResultSchema>;

// ---------------------------------------------------------------------------
// Persisted run + scenario
// ---------------------------------------------------------------------------

/** One persisted optimization attempt: the exact problem sent to the solver
 *  and the result it returned, kept together so a saved run is
 *  self-explanatory without joining across files. Immutable once written —
 *  re-running with different inputs creates a new run, never edits this one. */
export const optimizationRunSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  projectId: z.string().min(1),
  formulaVersionId: z.string().optional(),
  scenarioId: z.string().optional(),
  problem: formulationProblemSchema,
  result: advancedOptimizationResultSchema,
  /** Set once a human applies this run's result to a new working draft.
   *  Optimization does not itself change any status — see
   *  docs/APPROVAL_READINESS.md. */
  appliedAt: z.string().optional(),
  appliedToDraftBy: z.string().optional(),
  createdAt: z.string(),
});
export type OptimizationRun = z.infer<typeof optimizationRunSchema>;

/** A scenario record's own lifecycle. `optimization_scenarios` is an
 *  append-only master-data collection (same immutability the module
 *  docstring above already promises for a run) — so "rename", "retire" and
 *  "save an edit" cannot rewrite an existing record in place. Each is
 *  instead a NEW record sharing the same `scenarioGroupId`, with a higher
 *  `revision`; the current state of a scenario is whichever record in its
 *  group has the highest revision. `active` is the normal, current state;
 *  `retired` marks a record (and therefore, once it is the latest in its
 *  group, the whole scenario) as no longer in active use — restoring a
 *  retired scenario always creates a brand-new group (see
 *  `docs/OPTIMIZATION_SCENARIOS.md`), never un-retires the old one. */
export const SCENARIO_STATUSES = ["active", "retired"] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

/** A named, comparable "what if" — e.g. "Lowest landed cost", "No SLES",
 *  "Kenya-local stock first". Stores enough of the problem and the resulting
 *  run to compare scenarios later without re-solving; historical scenario
 *  results are immutable, same as a run. */
export const optimizationScenarioSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  /** Stable across every revision of "the same" scenario (a save-edit,
   *  rename, or retire) — see `SCENARIO_STATUSES` above. A NEW value only
   *  when the scenario is genuinely a different one: created fresh, cloned,
   *  or restored from a retired scenario. */
  scenarioGroupId: z.string().min(1),
  /** 1 for the first record in a group; each subsequent save-edit/rename/
   *  retire within the same group increments it. The current state of a
   *  scenario is the highest-revision record in its group. */
  revision: z.number().int().positive().default(1),
  /** The record (by `code`, within the same `scenarioGroupId`) this
   *  revision supersedes — absent for a group's first record. */
  previousCode: z.string().optional(),
  /** The record this scenario was cloned or restored from, in a DIFFERENT
   *  group — absent for a scenario created from scratch. Distinct from
   *  `previousCode`, which only ever links revisions within one group. */
  clonedFromCode: z.string().optional(),
  status: z.enum(SCENARIO_STATUSES).default("active"),

  projectId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  baseFormulaVersionId: z.string().optional(),
  /** The working draft this scenario was created from, when it was not
   *  started from a saved version — distinct fields because a draft has no
   *  stable version id to point at. */
  sourceDraftId: z.string().optional(),
  includedMaterialIds: z.array(z.string()).default([]),
  excludedMaterialIds: z.array(z.string()).default([]),
  /** The full problem this scenario resolved to, after applying its
   *  inclusion/exclusion/constraint choices on top of the base problem —
   *  stored whole, not as a diff, so the scenario is self-contained.
   *  Locked materials, composition/functional/ratio/conditional
   *  constraints, property targets, soft-constraint penalties, objectives,
   *  solver settings and the compatibility/safety policy are all already
   *  part of this single embedded `FormulationProblem` — there is no
   *  separate, parallel copy of any of them on the scenario record itself. */
  problem: formulationProblemSchema,
  /** Prices/inventory are read live when a scenario is authored, then frozen
   *  here — re-opening a scenario later must not silently re-price it. */
  priceSnapshotAt: z.string(),
  inventorySnapshotAt: z.string(),
  /** The most recent run of this scenario, for a quick "last result" link —
   *  the full, append-only run history is `OptimizationRun` records whose
   *  `scenarioId` equals this scenario's `scenarioGroupId`, never only this
   *  one field. */
  runCode: z.string().optional(),
  createdBy: z.string().default("local"),
  createdAt: z.string(),
  /** Equal to `createdAt` for this immutable record — it is never mutated
   *  after being written. A caller wanting "when was this scenario last
   *  touched" reads the `createdAt` of the latest revision in its group,
   *  not a field that changes underneath an existing record. */
  updatedAt: z.string(),
});
export type OptimizationScenario = z.infer<typeof optimizationScenarioSchema>;

/** Editable, non-authoritative structural defaults for one Kenya product
 *  family — spec §4. A profile is a starting point for a chemist building an
 *  optimization problem, never an approved recipe, and every rule on it
 *  carries the same verification convention as a compatibility/safety rule. */
export const optimizationProfileSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  productFamilyCode: z.string().min(1),
  displayName: z.string().min(1),

  requiredFunctionGroups: z.array(z.enum(MATERIAL_FUNCTIONS)).default([]),
  allowedFunctionGroups: z.array(z.enum(MATERIAL_FUNCTIONS)).default([]),
  forbiddenFunctionGroups: z.array(z.enum(MATERIAL_FUNCTIONS)).default([]),

  defaultCompositionConstraints: z.array(compositionConstraintSchema).default([]),
  defaultFunctionalConstraints: z.array(functionalConstraintSchema).default([]),
  defaultRatioConstraints: z.array(ratioConstraintSchema).default([]),
  defaultConditionalConstraints: z.array(conditionalConstraintSchema).default([]),
  defaultPropertyTargets: z.array(propertyTargetSchema).default([]),

  applicableCompatibilityRuleIds: z.array(z.string()).default([]),
  applicableSafetyRuleIds: z.array(z.string()).default([]),
  suggestedObjectivePresets: z.array(objectiveConfigSchema).default([]),

  source: z.string().optional(),
  verificationStatus: z.enum(OPTIMIZATION_VERIFICATION_STATUSES).default("not_verified"),
  /** Always true on a seed profile — a human chemist must review a profile's
   *  structural defaults before they drive a real optimization run. */
  requiresChemistReview: z.boolean().default(true),
  editable: z.boolean().default(true),

  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OptimizationProfile = z.infer<typeof optimizationProfileSchema>;
