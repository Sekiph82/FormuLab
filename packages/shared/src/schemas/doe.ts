/**
 * Design of Experiments (DOE) — planned, randomized formulation/process
 * experiments, deterministic statistical analysis of their results, and
 * desirability-ranked candidate conditions.
 *
 * A DOE study is bound to one exact SAVED formula version — never a working
 * draft — the same "no version drift" rule every other Phase 2-4 record
 * (dossier, claim, label) already enforces. A study's factors, constraints,
 * responses and design are frozen once runs are generated; a later change
 * to any of them is a new study revision (`supersedesStudyId`), never a
 * silent edit of history a completed analysis already depends on.
 *
 * This module NEVER computes a statistic or generates a design — it only
 * describes the shape of the records. See `engine/doeDesign.ts` for design
 * generation, `engine/doeAnalysis.ts` for the statistical-analysis engine,
 * and `engine/doeCandidates.ts` for desirability/candidate search.
 */
import { z } from "zod";
import { decimalString } from "./primitives";

// ---------------------------------------------------------------------------
// DoeStudy
// ---------------------------------------------------------------------------

export const DOE_STUDY_STATUSES = [
  "draft",
  "design_ready",
  "runs_generated",
  "in_progress",
  "data_complete",
  "analysis_ready",
  "analyzed",
  "candidate_selected",
  "completed",
  "cancelled",
  "superseded",
  "archived",
] as const;
export type DoeStudyStatus = (typeof DOE_STUDY_STATUSES)[number];

/** Once a study reaches one of these, its factors/constraints/responses/design
 *  are frozen — a meaningful change creates a new revision via `supersedesStudyId`
 *  rather than mutating the analyzed record, mirroring `CLAIM_IMMUTABLE_STATUSES`/
 *  `LABEL_IMMUTABLE_STATUSES` in `claimsLabels.ts`. */
export const DOE_STUDY_IMMUTABLE_STATUSES: readonly DoeStudyStatus[] = ["analyzed", "candidate_selected", "completed", "superseded", "archived"];

export const DOE_DESIGN_TYPES = [
  "full_factorial",
  "two_level_factorial",
  "fractional_factorial",
  "plackett_burman",
  "central_composite",
  "box_behnken",
  "latin_hypercube",
  "definitive_screening",
  "mixture_simplex_lattice",
  "mixture_simplex_centroid",
  "custom_manual",
] as const;
export type DoeDesignType = (typeof DOE_DESIGN_TYPES)[number];

/** `generateDesign` (engine/doeDesign.ts) implements exactly these — every
 *  other `DoeDesignType` above is a real enum value (so a study can record
 *  the intent / a future roadmap item) but is refused at generation time
 *  with an explicit "not implemented" error rather than silently producing
 *  a fake design. See docs/DOE_DESIGN_GENERATION.md. */
export const DOE_IMPLEMENTED_DESIGN_TYPES: readonly DoeDesignType[] = [
  "full_factorial",
  "two_level_factorial",
  "fractional_factorial",
  "plackett_burman",
  "central_composite",
  "box_behnken",
  "latin_hypercube",
  "mixture_simplex_lattice",
  "custom_manual",
];

export const DOE_REPLICATE_POLICIES = ["none", "all_points", "center_points_only", "custom"] as const;
export type DoeReplicatePolicy = (typeof DOE_REPLICATE_POLICIES)[number];

export const DOE_CENTER_POINT_POLICIES = ["none", "fixed_count", "auto_recommended"] as const;
export type DoeCenterPointPolicy = (typeof DOE_CENTER_POINT_POLICIES)[number];

export const doeStudySchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  studyCode: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  projectId: z.string().min(1),
  formulationId: z.string().min(1),
  /** A saved `FormulationVersion.id` — never a working draft. Enforced by
   *  `createDoeStudy` (engine/doeDesign.ts), not just documented here. */
  baselineFormulaVersionId: z.string().min(1),
  status: z.enum(DOE_STUDY_STATUSES).default("draft"),
  designType: z.enum(DOE_DESIGN_TYPES),
  randomizationEnabled: z.boolean().default(true),
  blockingEnabled: z.boolean().default(false),
  replicatePolicy: z.enum(DOE_REPLICATE_POLICIES).default("none"),
  centerPointPolicy: z.enum(DOE_CENTER_POINT_POLICIES).default("none"),
  /** Revision counter — bumped by `reviseDoeStudy`. Every child record
   *  (factor/constraint/response/design/run/observation/analysis/candidate)
   *  stores the `studyRevision` it belongs to, so a later revision never
   *  silently reinterprets an older analysis. */
  revision: z.number().int().positive().default(1),
  createdBy: z.string().min(1),
  createdAt: z.string(),
  updatedBy: z.string().optional(),
  updatedAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  supersedesStudyId: z.string().optional(),
});
export type DoeStudy = z.infer<typeof doeStudySchema>;

// ---------------------------------------------------------------------------
// DoeFactor
// ---------------------------------------------------------------------------

export const DOE_FACTOR_TYPES = ["continuous", "integer", "categorical", "ordinal", "mixture_component", "process_parameter"] as const;
export type DoeFactorType = (typeof DOE_FACTOR_TYPES)[number];

export const DOE_FACTOR_SOURCE_TYPES = [
  "formula_material",
  "formula_total",
  "process_parameter",
  "temperature",
  "mixing_speed",
  "mixing_time",
  "addition_order",
  "pH_target",
  "packaging",
  "custom",
] as const;
export type DoeFactorSourceType = (typeof DOE_FACTOR_SOURCE_TYPES)[number];

export const DOE_FACTOR_TRANSFORMATIONS = ["none", "log", "square_root", "inverse", "standardized", "custom"] as const;
export type DoeFactorTransformation = (typeof DOE_FACTOR_TRANSFORMATIONS)[number];

export const doeFactorSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  studyId: z.string().min(1),
  studyRevision: z.number().int().positive(),
  factorCode: z.string().min(1),
  name: z.string().min(1),
  factorType: z.enum(DOE_FACTOR_TYPES),
  /** Where this factor's value is applied — required so a run can be turned
   *  into a real formula composition/process setting deterministically,
   *  never guessed from the name. */
  sourceType: z.enum(DOE_FACTOR_SOURCE_TYPES),
  /** Material id (for `formula_material`) or a free-form key for process
   *  factors. Required for every source type except `custom`. */
  sourceEntityId: z.string().optional(),
  unit: z.string().optional(),
  lowValue: decimalString.optional(),
  centerValue: decimalString.optional(),
  highValue: decimalString.optional(),
  /** Required and non-empty for `categorical`/`ordinal` factor types. */
  categoricalLevels: z.array(z.string()).default([]),
  transformation: z.enum(DOE_FACTOR_TRANSFORMATIONS).default("none"),
  /** Decimal places a generated run's factor value is rounded to. */
  precision: z.number().int().min(0).max(6).default(2),
  isMixtureComponent: z.boolean().default(false),
  isProcessFactor: z.boolean().default(false),
  isControlled: z.boolean().default(true),
  createdAt: z.string(),
});
export type DoeFactor = z.infer<typeof doeFactorSchema>;

// ---------------------------------------------------------------------------
// DoeConstraint
// ---------------------------------------------------------------------------

export const DOE_CONSTRAINT_TYPES = [
  "lower_bound",
  "upper_bound",
  "sum_equals",
  "sum_min",
  "sum_max",
  "ratio_min",
  "ratio_max",
  "material_required",
  "material_forbidden",
  "conditional",
  "process_limit",
  "compatibility",
  "safety",
  "cost",
  "custom",
] as const;
export type DoeConstraintType = (typeof DOE_CONSTRAINT_TYPES)[number];

export const DOE_CONSTRAINT_SEVERITIES = ["hard", "soft", "warning"] as const;
export type DoeConstraintSeverity = (typeof DOE_CONSTRAINT_SEVERITIES)[number];

export const doeConstraintSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  studyId: z.string().min(1),
  studyRevision: z.number().int().positive(),
  constraintType: z.enum(DOE_CONSTRAINT_TYPES),
  /** A safe, deterministic expression evaluated by `evaluateDoeExpression`
   *  (engine/doeExpression.ts) — a tiny hand-rolled parser over
   *  factorCode/number/+-*÷/()/comparison tokens only. NEVER `eval`, `new
   *  Function`, a shell call, or a Python/JS/etc. subprocess. */
  expression: z.string().min(1),
  description: z.string().optional(),
  severity: z.enum(DOE_CONSTRAINT_SEVERITIES).default("hard"),
  /** Factor codes this constraint reads: informational for the UI, and used
   *  to validate that every referenced factor actually exists. */
  appliesTo: z.array(z.string()).default([]),
  createdBy: z.string().min(1),
  createdAt: z.string(),
});
export type DoeConstraint = z.infer<typeof doeConstraintSchema>;

// ---------------------------------------------------------------------------
// DoeResponse
// ---------------------------------------------------------------------------

export const DOE_RESPONSE_TYPES = ["continuous", "integer", "binary", "ordinal", "categorical", "pass_fail"] as const;
export type DoeResponseType = (typeof DOE_RESPONSE_TYPES)[number];

export const DOE_RESPONSE_OBJECTIVES = ["maximize", "minimize", "target", "within_range", "observe_only"] as const;
export type DoeResponseObjective = (typeof DOE_RESPONSE_OBJECTIVES)[number];

/** Only these two response types are put through OLS/response-surface
 *  regression by `engine/doeAnalysis.ts` — spec §7/§20: "categorical
 *  response must not be forced into OLS." Every other type is summarized
 *  (frequency table / pass rate) instead, never regressed. */
export const DOE_CONTINUOUS_ANALYSIS_RESPONSE_TYPES: readonly DoeResponseType[] = ["continuous", "integer"];

export const doeResponseSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  studyId: z.string().min(1),
  studyRevision: z.number().int().positive(),
  responseCode: z.string().min(1),
  name: z.string().min(1),
  responseType: z.enum(DOE_RESPONSE_TYPES),
  unit: z.string().optional(),
  objective: z.enum(DOE_RESPONSE_OBJECTIVES),
  targetValue: decimalString.optional(),
  lowerLimit: decimalString.optional(),
  upperLimit: decimalString.optional(),
  /** Relative weight in overall (multi-response) desirability, > 0. */
  weight: decimalString.default("1"),
  desirabilityShape: z.enum(["linear", "concave", "convex"]).default("linear"),
  /** When this response is actually a Laboratory `TestDefinition` result —
   *  lets `importDoeObservationsFromResults` pull real values automatically
   *  rather than requiring manual re-entry. */
  sourceTestDefinitionId: z.string().optional(),
  sourceResultField: z.string().optional(),
  createdAt: z.string(),
});
export type DoeResponse = z.infer<typeof doeResponseSchema>;

// ---------------------------------------------------------------------------
// DoeDesign
// ---------------------------------------------------------------------------

export const doeDesignDiagnosticsSchema = z.object({
  runCount: z.number().int().nonnegative(),
  degreesOfFreedom: z.number().int(),
  duplicateRunCount: z.number().int().nonnegative(),
  estimableTerms: z.array(z.string()).default([]),
  aliasedTerms: z.array(z.string()).default([]),
  /** `true` when every column of the coded design matrix has zero pairwise
   *  correlation with every other column — an honestly-computed property,
   *  not a claim of formal D/G-optimality. */
  isOrthogonal: z.boolean(),
  /** `true` when every factor level appears an equal number of times. */
  isBalanced: z.boolean(),
  /** Condition number of (X^T X) for the coded design matrix — a real,
   *  computed diagnostic of numerical stability, never a fabricated score. */
  conditionNumber: z.number().nonnegative().optional(),
  centerPointCount: z.number().int().nonnegative(),
  replicateCount: z.number().int().nonnegative(),
  constraintViolationCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()).default([]),
});
export type DoeDesignDiagnostics = z.infer<typeof doeDesignDiagnosticsSchema>;

export const doeDesignGenerationSettingsSchema = z.object({
  fractionDenominator: z.number().int().positive().optional(),
  alphaValue: decimalString.optional(),
  latinHypercubeSampleCount: z.number().int().positive().optional(),
  mixtureLatticeDegree: z.number().int().positive().optional(),
  notes: z.string().optional(),
});
export type DoeDesignGenerationSettings = z.infer<typeof doeDesignGenerationSettingsSchema>;

export const doeDesignSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  studyId: z.string().min(1),
  studyRevision: z.number().int().positive(),
  designType: z.enum(DOE_DESIGN_TYPES),
  /** Frozen copies of the factors/constraints/responses used to generate
   *  this design — never re-read live, so a later factor edit cannot
   *  retroactively reinterpret an already-generated design. */
  factorSnapshot: z.array(doeFactorSchema),
  constraintSnapshot: z.array(doeConstraintSchema),
  responseSnapshot: z.array(doeResponseSchema),
  generationSettings: doeDesignGenerationSettingsSchema.default({}),
  /** Integer seed — every randomization/sampling call in `doeDesign.ts` is a
   *  pure function of (seed, inputs), so the same seed always reproduces
   *  the same run order / Latin-hypercube sample. */
  seed: z.number().int(),
  runCount: z.number().int().nonnegative(),
  replicateCount: z.number().int().nonnegative().default(0),
  centerPointCount: z.number().int().nonnegative().default(0),
  blockCount: z.number().int().nonnegative().default(1),
  generatedBy: z.string().min(1),
  generatedAt: z.string(),
  diagnostics: doeDesignDiagnosticsSchema,
  supersedesDesignId: z.string().optional(),
});
export type DoeDesign = z.infer<typeof doeDesignSchema>;

// ---------------------------------------------------------------------------
// DoeRun
// ---------------------------------------------------------------------------

export const DOE_RUN_STATUSES = ["planned", "prepared", "trial_created", "in_progress", "completed", "failed", "excluded", "cancelled"] as const;
export type DoeRunStatus = (typeof DOE_RUN_STATUSES)[number];

/** A run's `factorSettings` are frozen once it leaves `planned` — spec §9.6:
 *  "run settings are immutable after execution begins." */
export const DOE_RUN_LOCKED_STATUSES: readonly DoeRunStatus[] = ["trial_created", "in_progress", "completed", "failed"];

export const doeFactorSettingSchema = z.object({
  factorCode: z.string().min(1),
  /** Coded level for a continuous/mixture factor, e.g. -1/0/+1 for a 2-level
   *  factorial, or the categorical level string itself. */
  codedValue: z.string(),
  /** The real, engineering-unit value this run actually uses. */
  actualValue: z.string(),
});
export type DoeFactorSetting = z.infer<typeof doeFactorSettingSchema>;

export const doeRunSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  studyId: z.string().min(1),
  studyRevision: z.number().int().positive(),
  designId: z.string().min(1),
  runNumber: z.number().int().positive(),
  standardOrder: z.number().int().positive(),
  randomizedOrder: z.number().int().positive(),
  block: z.number().int().positive().default(1),
  replicate: z.number().int().positive().default(1),
  isCenterPoint: z.boolean().default(false),
  factorSettings: z.array(doeFactorSettingSchema),
  status: z.enum(DOE_RUN_STATUSES).default("planned"),
  linkedTrialId: z.string().optional(),
  linkedFormulaVersionId: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  excludedAt: z.string().optional(),
  exclusionReason: z.string().optional(),
});
export type DoeRun = z.infer<typeof doeRunSchema>;

// ---------------------------------------------------------------------------
// DoeObservation
// ---------------------------------------------------------------------------

export const DOE_OBSERVATION_STATUSES = ["recorded", "validated", "missing", "invalid", "excluded", "outlier_flagged", "outlier_confirmed"] as const;
export type DoeObservationStatus = (typeof DOE_OBSERVATION_STATUSES)[number];

export const doeObservationSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  studyId: z.string().min(1),
  studyRevision: z.number().int().positive(),
  runId: z.string().min(1),
  responseId: z.string().min(1),
  value: decimalString.optional(),
  textValue: z.string().optional(),
  status: z.enum(DOE_OBSERVATION_STATUSES).default("recorded"),
  sourceTrialId: z.string().optional(),
  sourceTestResultId: z.string().optional(),
  measuredAt: z.string().optional(),
  recordedBy: z.string().min(1),
  recordedAt: z.string(),
  excludedAt: z.string().optional(),
  exclusionReason: z.string().optional(),
});
export type DoeObservation = z.infer<typeof doeObservationSchema>;

// ---------------------------------------------------------------------------
// DoeAnalysis
// ---------------------------------------------------------------------------

export const DOE_ANALYSIS_TYPES = ["main_effects", "factorial", "linear_regression", "quadratic_response_surface", "mixture_model", "screening", "categorical_comparison"] as const;
export type DoeAnalysisType = (typeof DOE_ANALYSIS_TYPES)[number];

export const doeCoefficientSchema = z.object({
  term: z.string(),
  estimate: z.number(),
  standardError: z.number().optional(),
  tStatistic: z.number().optional(),
  pValue: z.number().optional(),
  confidenceIntervalLow: z.number().optional(),
  confidenceIntervalHigh: z.number().optional(),
});
export type DoeCoefficient = z.infer<typeof doeCoefficientSchema>;

export const doeEffectEstimateSchema = z.object({
  term: z.string(),
  effect: z.number(),
  /** Absolute value of `effect`, precomputed for Pareto-chart ordering. */
  absoluteEffect: z.number(),
});
export type DoeEffectEstimate = z.infer<typeof doeEffectEstimateSchema>;

export const doeAnovaRowSchema = z.object({
  source: z.string(),
  sumOfSquares: z.number(),
  degreesOfFreedom: z.number().int(),
  meanSquare: z.number().optional(),
  fStatistic: z.number().optional(),
  pValue: z.number().optional(),
});
export type DoeAnovaRow = z.infer<typeof doeAnovaRowSchema>;

export const doeFitMetricsSchema = z.object({
  rSquared: z.number().optional(),
  adjustedRSquared: z.number().optional(),
  rmse: z.number().optional(),
  mae: z.number().optional(),
  residualDegreesOfFreedom: z.number().int().optional(),
  lackOfFitPValue: z.number().optional(),
});
export type DoeFitMetrics = z.infer<typeof doeFitMetricsSchema>;

export const doeResidualPointSchema = z.object({
  runId: z.string(),
  observed: z.number(),
  predicted: z.number(),
  residual: z.number(),
  leverage: z.number().optional(),
  cooksDistance: z.number().optional(),
  standardizedResidual: z.number().optional(),
});
export type DoeResidualPoint = z.infer<typeof doeResidualPointSchema>;

export const doeOutlierSuggestionSchema = z.object({
  runId: z.string(),
  reason: z.string(),
  standardizedResidual: z.number().optional(),
  cooksDistance: z.number().optional(),
});
export type DoeOutlierSuggestion = z.infer<typeof doeOutlierSuggestionSchema>;

export const doeAnalysisSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  studyId: z.string().min(1),
  studyRevision: z.number().int().positive(),
  designId: z.string().min(1),
  responseId: z.string().min(1),
  analysisType: z.enum(DOE_ANALYSIS_TYPES),
  includedRunIds: z.array(z.string()),
  excludedRunIds: z.array(z.string()).default([]),
  modelTerms: z.array(z.string()),
  coefficients: z.array(doeCoefficientSchema),
  effectEstimates: z.array(doeEffectEstimateSchema).default([]),
  anova: z.array(doeAnovaRowSchema).default([]),
  diagnostics: z.array(doeResidualPointSchema).default([]),
  fitMetrics: doeFitMetricsSchema,
  predictions: z.array(doeResidualPointSchema).default([]),
  /** Never empty for a categorical/insufficient-data response — see
   *  `fitOrdinaryLeastSquares`'s explicit-error convention, spec §7: "never
   *  silently return fabricated coefficients." */
  warnings: z.array(z.string()).default([]),
  createdBy: z.string().min(1),
  createdAt: z.string(),
  supersedesAnalysisId: z.string().optional(),
});
export type DoeAnalysis = z.infer<typeof doeAnalysisSchema>;

// ---------------------------------------------------------------------------
// DoeCandidate
// ---------------------------------------------------------------------------

export const DOE_CANDIDATE_STATUSES = ["proposed", "shortlisted", "selected", "rejected", "applied_to_draft", "experimentally_confirmed", "failed_confirmation"] as const;
export type DoeCandidateStatus = (typeof DOE_CANDIDATE_STATUSES)[number];

export const doePredictedResponseSchema = z.object({
  responseId: z.string(),
  predictedValue: z.number(),
  /** `true` when the candidate's factor settings fall outside the design's
   *  observed factor ranges — spec §8: "low-confidence or extrapolated
   *  candidates display warnings." */
  isExtrapolated: z.boolean().default(false),
  /** Which `DoeAnalysis.id` produced this prediction — a candidate must
   *  never present a number without saying which fitted model it came from. */
  analysisId: z.string(),
});
export type DoePredictedResponse = z.infer<typeof doePredictedResponseSchema>;

export const doeConstraintStatusSchema = z.object({
  constraintId: z.string(),
  satisfied: z.boolean(),
  severity: z.enum(DOE_CONSTRAINT_SEVERITIES),
  message: z.string().optional(),
});
export type DoeConstraintStatus = z.infer<typeof doeConstraintStatusSchema>;

export const doeCandidateSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  studyId: z.string().min(1),
  studyRevision: z.number().int().positive(),
  analysisIds: z.array(z.string()),
  factorSettings: z.array(doeFactorSettingSchema),
  predictedResponses: z.array(doePredictedResponseSchema),
  desirability: z.number().min(0).max(1),
  constraintStatus: z.array(doeConstraintStatusSchema).default([]),
  rank: z.number().int().positive(),
  status: z.enum(DOE_CANDIDATE_STATUSES).default("proposed"),
  createdBy: z.string().min(1),
  createdAt: z.string(),
  appliedDraftId: z.string().optional(),
  appliedAt: z.string().optional(),
});
export type DoeCandidate = z.infer<typeof doeCandidateSchema>;

// ---------------------------------------------------------------------------
// DoeReviewAction — a lightweight append-only log of human review/sign-off
// actions (validate observation, confirm exclusion, approve study
// completion) distinct from the general audit log so the Analysis/History
// views can show "who validated this" without scanning the whole audit
// stream. Mirrors `regulatory_dossier_manual_requirement_actions`'s
// append-only-justified-action shape.
// ---------------------------------------------------------------------------

export const DOE_REVIEW_ACTION_TYPES = ["observation_validated", "exclusion_confirmed", "study_completed_approved"] as const;
export type DoeReviewActionType = (typeof DOE_REVIEW_ACTION_TYPES)[number];

export const doeReviewActionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  studyId: z.string().min(1),
  actionType: z.enum(DOE_REVIEW_ACTION_TYPES),
  targetId: z.string().min(1),
  reason: z.string().optional(),
  actorUserId: z.string().min(1),
  actorRole: z.string().min(1),
  createdAt: z.string(),
});
export type DoeReviewAction = z.infer<typeof doeReviewActionSchema>;
