/**
 * Stability Studies — configurable storage conditions and time points
 * (never presented as universal regulatory requirements), pull-point
 * samples, and the deterministic trend/failure machinery built on top of
 * them. Nothing here predicts shelf life; see `engine/stability.ts`'s
 * trend functions and docs/STABILITY_TRENDS.md for exactly why.
 */
import { z } from "zod";
import { decimalString } from "./formulation";
import { trialFormulaSnapshotSchema, TRIAL_DEVIATION_SEVERITIES } from "./laboratory";
import {
  attachmentReferenceSchema,
  testReplicateSchema,
  replicateStatsSchema,
  testResultOverrideSchema,
  testRequirementSnapshotSchema,
} from "./testDefinitions";

// ---------------------------------------------------------------------------
// Conditions and time points — configurable, not hardcoded requirements
// ---------------------------------------------------------------------------

export const LIGHT_CONDITIONS = ["none", "ambient", "uv", "other"] as const;
export type LightCondition = (typeof LIGHT_CONDITIONS)[number];

export const SAMPLE_ORIENTATIONS = ["upright", "inverted", "horizontal", "not_applicable"] as const;
export type SampleOrientation = (typeof SAMPLE_ORIENTATIONS)[number];

export const stabilityConditionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  code: z.string().min(1),
  label: z.string().min(1),
  temperatureC: decimalString.optional(),
  temperatureToleranceC: decimalString.optional(),
  humidityPercent: decimalString.optional(),
  humidityTolerancePercent: decimalString.optional(),
  lightCondition: z.enum(LIGHT_CONDITIONS).default("none"),
  orientation: z.enum(SAMPLE_ORIENTATIONS).default("not_applicable"),
  /** Free text, e.g. "24h at -20C, 24h at 25C, repeat" — a structured cycle
   *  grammar is not modelled; a lab's exact freeze-thaw protocol varies too
   *  much to force into fixed fields. */
  freezeThawCycleDefinition: z.string().optional(),
  customInstructions: z.string().optional(),
  /** These are structural starting examples (4°C, 25°C, accelerated,
   *  freeze-thaw...), never a claim that this set is what any regulator
   *  requires — same honesty convention as an optimization profile. */
  verificationStatus: z.enum(["verified", "not_verified"]).default("not_verified"),
  active: z.boolean().default(true),
});
export type StabilityCondition = z.infer<typeof stabilityConditionSchema>;

export const stabilityTimePointSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  code: z.string().min(1),
  label: z.string().min(1),
  daysFromStart: z.number().int().nonnegative(),
  custom: z.boolean().default(false),
  notes: z.string().optional(),
});
export type StabilityTimePoint = z.infer<typeof stabilityTimePointSchema>;

// ---------------------------------------------------------------------------
// Study
// ---------------------------------------------------------------------------

export const STABILITY_STUDY_STATUSES = ["planned", "active", "paused", "completed", "failed", "cancelled", "archived"] as const;
export type StabilityStudyStatus = (typeof STABILITY_STUDY_STATUSES)[number];

export const STABILITY_SOURCE_TYPES = ["saved_version", "working_draft"] as const;
export type StabilitySourceType = (typeof STABILITY_SOURCE_TYPES)[number];

export const packagingBomLineSnapshotSchema = z.object({
  componentCode: z.string().min(1),
  quantityPerUnit: decimalString,
  wasteFactorPercent: decimalString.optional(),
});
export type PackagingBomLineSnapshot = z.infer<typeof packagingBomLineSnapshotSchema>;

/** A frozen copy of the packaging BOM a study is running against — captured
 *  once, at study creation, so a later packaging-component price or BOM
 *  edit cannot silently change what an in-progress study is protocol-bound
 *  to. Mirrors `TrialFormulaSnapshot`'s "capture once, never re-read live"
 *  principle. */
export const packagingSystemSnapshotSchema = z.object({
  skuCode: z.string().min(1),
  bomCode: z.string().optional(),
  lines: z.array(packagingBomLineSnapshotSchema).default([]),
  fillQuantity: decimalString.optional(),
  fillUnit: z.enum(["g", "kg", "ml", "L", "pieces"]).optional(),
  fillLossPercent: decimalString.optional(),
  capturedAt: z.string(),
});
export type PackagingSystemSnapshot = z.infer<typeof packagingSystemSnapshotSchema>;

export const stabilityStudySchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  code: z.string().min(1),
  projectId: z.string().min(1),

  sourceType: z.enum(STABILITY_SOURCE_TYPES),
  sourceFormulaVersionId: z.string().optional(),
  sourceDraftId: z.string().optional(),
  formulaSnapshot: trialFormulaSnapshotSchema,

  productFamilyId: z.string().min(1),
  packagingSkuCode: z.string().min(1),
  packagingSnapshot: packagingSystemSnapshotSchema,

  laboratoryTrialId: z.string().optional(),

  title: z.string().min(1),
  owner: z.string().min(1),
  /** Free text — the lab's own written protocol reference/summary. Not a
   *  structured, enforced procedure; this platform does not validate that a
   *  study followed any particular regulatory protocol. */
  protocol: z.string().optional(),

  status: z.enum(STABILITY_STUDY_STATUSES).default("planned"),
  startDate: z.string().optional(),
  completedAt: z.string().optional(),

  /** The condition/time-point/test-definition ids this study actually uses
   *  — references into the shared `stability_conditions`/
   *  `stability_time_points` collections and `test_definitions`, not
   *  embedded copies (unlike the formula/packaging snapshots above, which
   *  must never change; a condition's own label/tolerance is fine to read
   *  live since it does not retroactively change what was already measured). */
  conditionIds: z.array(z.string()).default([]),
  timePointIds: z.array(z.string()).default([]),
  requiredTestDefinitionIds: z.array(z.string()).default([]),
  replicatesPerPullPoint: z.number().int().positive().default(1),

  /** Captured once at creation — see docs/TEST_APPLICABILITY.md and
   *  `LaboratoryTrial.testRequirementSnapshot`. */
  testRequirementSnapshot: testRequirementSnapshotSchema.optional(),

  hasOpenCriticalFailure: z.boolean().default(false),
  failureReason: z.string().optional(),
  cancellationReason: z.string().optional(),

  createdAt: z.string(),
  createdBy: z.string().default("local"),
  updatedAt: z.string(),
});
export type StabilityStudy = z.infer<typeof stabilityStudySchema>;

// ---------------------------------------------------------------------------
// Samples — one pull-point physical unit per (condition, time point,
// packaging, replicate) combination, tested once then disposed.
// ---------------------------------------------------------------------------

export const STABILITY_SAMPLE_STATUSES = ["planned", "stored", "due", "overdue", "testing", "completed", "failed", "disposed"] as const;
export type StabilitySampleStatus = (typeof STABILITY_SAMPLE_STATUSES)[number];

export const stabilitySampleSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  sampleCode: z.string().min(1),
  studyId: z.string().min(1),
  conditionId: z.string().min(1),
  timePointId: z.string().min(1),
  packagingSkuCode: z.string().min(1),
  packagingComponentLot: z.string().optional(),
  fillQuantity: decimalString.optional(),
  replicateNumber: z.number().int().positive(),
  storageLocation: z.string().optional(),
  status: z.enum(STABILITY_SAMPLE_STATUSES).default("planned"),
  /** Computed deterministically at generation time from the study's
   *  `startDate` plus the time point's `daysFromStart` — see
   *  `engine/stability.ts`'s `generateStabilitySamples`. */
  dueDate: z.string().optional(),
  testDefinitionIds: z.array(z.string()).default([]),
  disposedAt: z.string().optional(),
  createdAt: z.string(),
});
export type StabilitySample = z.infer<typeof stabilitySampleSchema>;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export const stabilityResultSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  studyId: z.string().min(1),
  sampleId: z.string().min(1),
  conditionId: z.string().min(1),
  timePointId: z.string().min(1),
  testDefinitionId: z.string().min(1),

  resultType: z.enum(["numeric", "text", "boolean", "pass_fail", "categorical", "visual_rating"]),
  replicates: z.array(testReplicateSchema).default([]),
  stats: replicateStatsSchema.optional(),
  textValue: z.string().optional(),
  categoricalValue: z.string().optional(),
  booleanValue: z.boolean().optional(),
  passFail: z.enum(["pass", "fail", "not_evaluated"]).default("not_evaluated"),

  unit: z.string().optional(),
  notes: z.string().optional(),
  attachments: z.array(attachmentReferenceSchema).default([]),

  performedBy: z.string().min(1),
  performedAt: z.string(),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().optional(),

  override: testResultOverrideSchema.optional(),
  /** Append-only: editing a recorded result creates a NEW record with this
   *  set to the prior result's id, never mutates history in place. */
  revisesResultId: z.string().optional(),

  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StabilityResult = z.infer<typeof stabilityResultSchema>;

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

export const STABILITY_FAILURE_TYPES = [
  "out_of_specification",
  "phase_separation",
  "precipitation",
  "color_change",
  "odor_change",
  "viscosity_drift",
  "ph_drift",
  "active_loss",
  "packaging_failure",
  "leakage",
  "seal_failure",
  "microbiological_failure",
  "other",
] as const;
export type StabilityFailureType = (typeof STABILITY_FAILURE_TYPES)[number];

export const STABILITY_INVESTIGATION_STATUSES = ["open", "investigating", "root_cause_identified", "closed"] as const;
export type StabilityInvestigationStatus = (typeof STABILITY_INVESTIGATION_STATUSES)[number];

export const stabilityFailureSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  studyId: z.string().min(1),
  sampleId: z.string().min(1),
  conditionId: z.string().min(1),
  timePointId: z.string().min(1),
  testResultId: z.string().optional(),

  type: z.enum(STABILITY_FAILURE_TYPES),
  severity: z.enum(TRIAL_DEVIATION_SEVERITIES),
  description: z.string().min(1),
  immediateAction: z.string().optional(),

  investigationStatus: z.enum(STABILITY_INVESTIGATION_STATUSES).default("open"),
  rootCauseNotes: z.string().optional(),
  correctiveActionIds: z.array(z.string()).default([]),
  /** Additive — absent on a failure recorded before this phase. */
  attachments: z.array(attachmentReferenceSchema).optional(),

  /** Only ever set by a named human via `engine/stability.ts`'s
   *  `resolveStabilityFailure` — never by an agent/system/import actor. */
  resolvedBy: z.string().optional(),
  resolvedAt: z.string().optional(),

  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StabilityFailure = z.infer<typeof stabilityFailureSchema>;

// ---------------------------------------------------------------------------
// Trend (computed, cacheable)
// ---------------------------------------------------------------------------

export const stabilityTrendPointSchema = z.object({
  timePointId: z.string().min(1),
  daysFromStart: z.number().int().nonnegative(),
  mean: decimalString.optional(),
  count: z.number().int().nonnegative(),
});
export type StabilityTrendPoint = z.infer<typeof stabilityTrendPointSchema>;

export const stabilityTrendSchema = z.object({
  schemaVersion: z.literal("1.0"),
  studyId: z.string().min(1),
  conditionId: z.string().min(1),
  testDefinitionId: z.string().min(1),
  points: z.array(stabilityTrendPointSchema),

  absoluteChangeFromInitial: decimalString.optional(),
  percentageChangeFromInitial: decimalString.optional(),
  changeFromPrevious: decimalString.optional(),
  /** Per calendar day, between the two most recent points with data —
   *  `undefined` when fewer than two numeric points exist. */
  ratePerDay: decimalString.optional(),
  minimum: decimalString.optional(),
  maximum: decimalString.optional(),
  mean: decimalString.optional(),
  standardDeviation: decimalString.optional(),

  /** Set when a point crossed the test definition's own min/max — never
   *  inferred from anywhere else. */
  limitCrossing: z
    .object({
      timePointId: z.string(),
      direction: z.enum(["above_maximum", "below_minimum"]),
    })
    .optional(),

  /** Only ever present when `engine/stability.ts`'s documented minimum-data
   *  rule is met (see docs/STABILITY_TRENDS.md) — always labeled, never a
   *  validated shelf-life claim. */
  projection: z
    .object({
      label: z.literal("experimental estimate — not validated — human review required"),
      estimatedDaysToLimit: z.number().int().positive().optional(),
      basis: z.string(),
    })
    .optional(),

  computedAt: z.string(),
});
export type StabilityTrend = z.infer<typeof stabilityTrendSchema>;
