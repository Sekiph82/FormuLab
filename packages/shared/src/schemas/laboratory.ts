/**
 * Laboratory Trials — the record of what actually happened at the bench,
 * distinct from the formula it started from. A `FormulationVersion` is
 * already immutable once saved (see `engine/versioning.ts`); a trial
 * additionally embeds its own `formulaSnapshot` so a trial started from the
 * mutable WORKING DRAFT is just as immune to later edits, and so reading a
 * trial never requires joining back to a formula version that might not
 * exist under that id forever.
 *
 * Material usage, process steps and observations are embedded ARRAYS on
 * the trial record, not separate master-data collections — a trial is one
 * mutable JSON object with nested execution detail, the same pattern
 * `FormulationVersion` already uses for its `lines`. `TrialDeviation` is
 * the one execution-detail type that IS its own collection (spec §17),
 * because a deviation is cross-referenced by corrective actions and
 * approval readiness independently of any one trial being open.
 *
 * Nothing here invents a measurement. `actualWeight`, `actualTemperature`,
 * `actualPh` and the rest are `decimalString.optional()` — absent means
 * "not entered yet", never zero.
 */
import { z } from "zod";
import { decimalString, formulationLineSchema } from "./formulation";
import { attachmentReferenceSchema, testRequirementSnapshotSchema } from "./testDefinitions";

// ---------------------------------------------------------------------------
// Material execution
// ---------------------------------------------------------------------------

export const trialMaterialUsageSchema = z.object({
  id: z.string().min(1),
  formulaLineId: z.string().min(1),
  materialId: z.string().optional(),
  materialCode: z.string().min(1),
  materialName: z.string().min(1),

  targetPercent: decimalString,
  targetWeight: decimalString,
  /** Absent means not weighed yet — never defaulted to 0 or to the target. */
  actualWeight: decimalString.optional(),
  weightUnit: z.string().default("kg"),

  lotNumber: z.string().optional(),
  supplierLot: z.string().optional(),
  supplier: z.string().optional(),
  /** Same convention as `InventoryRecord` — quarantined and released are
   *  separate facts, not one "release status" flag. */
  coaStatus: z.enum(["received", "pending", "not_required", "missing"]).default("pending"),
  quarantined: z.boolean().default(false),
  released: z.boolean().default(false),
  expiryDate: z.string().optional(),

  weighedBy: z.string().optional(),
  confirmedBy: z.string().optional(),
  timestamp: z.string().optional(),
  notes: z.string().optional(),
});
export type TrialMaterialUsage = z.infer<typeof trialMaterialUsageSchema>;

// ---------------------------------------------------------------------------
// Process execution
// ---------------------------------------------------------------------------

export const TRIAL_PROCESS_STEP_STATUSES = ["planned", "in_progress", "paused", "completed", "skipped"] as const;
export type TrialProcessStepStatus = (typeof TRIAL_PROCESS_STEP_STATUSES)[number];

export const trialProcessStepSchema = z.object({
  id: z.string().min(1),
  stepNumber: z.number().int().positive(),
  phase: z.string().default("A"),
  plannedInstruction: z.string().min(1),
  requiredEquipment: z.array(z.string()).default([]),

  plannedTemperatureMinC: decimalString.optional(),
  plannedTemperatureMaxC: decimalString.optional(),
  plannedMixingSpeedMinRpm: decimalString.optional(),
  plannedMixingSpeedMaxRpm: decimalString.optional(),
  plannedDurationMinutes: decimalString.optional(),
  plannedAdditionOrder: z.number().int().nonnegative().optional(),

  status: z.enum(TRIAL_PROCESS_STEP_STATUSES).default("planned"),
  /** True for a step added during execution that was not in the original
   *  plan — recorded, never merged silently into the planned sequence. */
  unplanned: z.boolean().default(false),
  skipReason: z.string().optional(),

  actualStart: z.string().optional(),
  actualEnd: z.string().optional(),
  actualTemperatureC: decimalString.optional(),
  actualMixingSpeedRpm: decimalString.optional(),
  actualDurationMinutes: decimalString.optional(),
  actualAdditionOrder: z.number().int().nonnegative().optional(),
  actualPh: decimalString.optional(),
  actualViscosity: decimalString.optional(),
  viscosityUnit: z.string().optional(),

  operator: z.string().optional(),
  observation: z.string().optional(),
  /** Free-text pointer note; the authoritative deviation record (if the
   *  observed difference rose to that level) is a `TrialDeviation` with
   *  `processStepId` set to this step's id. */
  deviationNote: z.string().optional(),
  attachments: z.array(attachmentReferenceSchema).default([]),

  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TrialProcessStep = z.infer<typeof trialProcessStepSchema>;

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

export const TRIAL_OBSERVATION_TYPES = [
  "color_change",
  "odor_change",
  "phase_separation",
  "sedimentation",
  "precipitation",
  "foaming_issue",
  "viscosity_issue",
  "poor_dissolution",
  "unexpected_heating",
  "unexpected_gas",
  "packaging_interaction",
  "processability_issue",
  "other",
] as const;
export type TrialObservationType = (typeof TRIAL_OBSERVATION_TYPES)[number];

export const trialObservationSchema = z.object({
  id: z.string().min(1),
  processStepId: z.string().optional(),
  type: z.enum(TRIAL_OBSERVATION_TYPES),
  description: z.string().min(1),
  observedBy: z.string().min(1),
  observedAt: z.string(),
  attachments: z.array(attachmentReferenceSchema).default([]),
});
export type TrialObservation = z.infer<typeof trialObservationSchema>;

// ---------------------------------------------------------------------------
// Trial lifecycle
// ---------------------------------------------------------------------------

export const TRIAL_STATUSES = [
  "planned",
  "materials_prepared",
  "in_progress",
  "awaiting_results",
  "completed",
  "failed",
  "cancelled",
  "archived",
] as const;
export type TrialStatus = (typeof TRIAL_STATUSES)[number];

export const TRIAL_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TrialPriority = (typeof TRIAL_PRIORITIES)[number];

export const TRIAL_SOURCE_TYPES = ["saved_version", "working_draft"] as const;
export type TrialSourceType = (typeof TRIAL_SOURCE_TYPES)[number];

/** A frozen copy of the formula the trial is running — captured once, at
 *  trial creation, and never updated. This is what makes "later formula
 *  changes must not alter the trial record" true regardless of whether the
 *  trial started from a saved version or the working draft. */
export const trialFormulaSnapshotSchema = z.object({
  lines: z.array(formulationLineSchema),
  basisBatchKg: decimalString,
  capturedAt: z.string(),
});
export type TrialFormulaSnapshot = z.infer<typeof trialFormulaSnapshotSchema>;

export const laboratoryTrialSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  code: z.string().min(1),
  /** The `Formulation.id` this trial belongs to — same identifier space as
   *  `OptimizationScenario.projectId`/`SubstitutionRequest.projectId`
   *  elsewhere in this codebase; FormuLab does not have a separate
   *  "project" concept above a formula project. */
  projectId: z.string().min(1),

  sourceType: z.enum(TRIAL_SOURCE_TYPES),
  /** Required when `sourceType === "saved_version"`. */
  sourceFormulaVersionId: z.string().optional(),
  /** Required when `sourceType === "working_draft"` — the draft's own
   *  formulation id (a draft has no id distinct from its formulation). */
  sourceDraftId: z.string().optional(),
  formulaSnapshot: trialFormulaSnapshotSchema,

  productFamilyId: z.string().min(1),
  targetPackagingSkuIds: z.array(z.string()).default([]),
  sourceOptimizationRunCode: z.string().optional(),
  sourceSubstitutionRunCode: z.string().optional(),

  title: z.string().min(1),
  objective: z.string().optional(),
  hypothesis: z.string().optional(),

  batchSize: decimalString,
  batchUnit: z.string().default("kg"),

  status: z.enum(TRIAL_STATUSES).default("planned"),
  priority: z.enum(TRIAL_PRIORITIES).default("normal"),

  plannedDate: z.string().optional(),
  actualStart: z.string().optional(),
  actualCompletion: z.string().optional(),

  operator: z.string().optional(),
  reviewer: z.string().optional(),
  laboratoryLocation: z.string().optional(),
  equipmentIds: z.array(z.string()).default([]),

  materialUsage: z.array(trialMaterialUsageSchema).default([]),
  processSteps: z.array(trialProcessStepSchema).default([]),
  observations: z.array(trialObservationSchema).default([]),

  /** Captured once at creation from the then-applicable `TestDefinition`s —
   *  see docs/TEST_APPLICABILITY.md. Absent on trials created before this
   *  phase; resolution for those falls back to a live (non-snapshotted)
   *  read, same as always. */
  testRequirementSnapshot: testRequirementSnapshotSchema.optional(),

  /** Set once, the moment a `TrialDeviation`/failure blocks acceptance and
   *  is later cleared — kept here for a quick "is this trial currently
   *  blocked" read without re-scanning every deviation. Authoritative state
   *  is still the deviations themselves; see `engine/laboratory.ts`. */
  hasOpenCriticalDeviation: z.boolean().default(false),

  failureReason: z.string().optional(),
  cancellationReason: z.string().optional(),

  createdAt: z.string(),
  createdBy: z.string().default("local"),
  updatedAt: z.string(),
});
export type LaboratoryTrial = z.infer<typeof laboratoryTrialSchema>;

// ---------------------------------------------------------------------------
// Deviations — its own collection (spec §17): cross-referenced by
// corrective actions and approval readiness independently of the trial.
// ---------------------------------------------------------------------------

export const TRIAL_DEVIATION_SEVERITIES = ["minor", "major", "critical"] as const;
export type TrialDeviationSeverity = (typeof TRIAL_DEVIATION_SEVERITIES)[number];

export const TRIAL_DEVIATION_STATUSES = ["open", "under_review", "resolved", "accepted_with_justification", "rejected"] as const;
export type TrialDeviationStatus = (typeof TRIAL_DEVIATION_STATUSES)[number];

export const trialDeviationSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  trialId: z.string().min(1),
  processStepId: z.string().optional(),
  materialUsageId: z.string().optional(),

  severity: z.enum(TRIAL_DEVIATION_SEVERITIES),
  status: z.enum(TRIAL_DEVIATION_STATUSES).default("open"),
  description: z.string().min(1),

  detectedBy: z.string().min(1),
  detectedAt: z.string(),

  /** Only ever set by a named human via `engine/laboratory.ts`'s
   *  `resolveTrialDeviation` — never by an agent/system/import actor. */
  resolution: z.string().optional(),
  resolvedBy: z.string().optional(),
  resolvedAt: z.string().optional(),
  /** Required when `status === "accepted_with_justification"` — accepting a
   *  deviation without fixing it is still a human decision that must state
   *  why, not a silent pass. */
  justification: z.string().optional(),

  correctiveActionIds: z.array(z.string()).default([]),
  /** Additive — absent on a deviation recorded before this phase. */
  attachments: z.array(attachmentReferenceSchema).optional(),

  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TrialDeviation = z.infer<typeof trialDeviationSchema>;

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export const trialComparisonRowSchema = z.object({
  trialId: z.string().min(1),
  trialCode: z.string().min(1),
  formulaVersionId: z.string().optional(),
  lines: z.array(formulationLineSchema),
  materialUsageCount: z.number().int().nonnegative(),
  processDeviationCount: z.number().int().nonnegative(),
  criticalDeviationCount: z.number().int().nonnegative(),
  testResultCount: z.number().int().nonnegative(),
  passCount: z.number().int().nonnegative(),
  failCount: z.number().int().nonnegative(),
  totalRawMaterialCost: decimalString.optional(),
  optimizationRunCode: z.string().optional(),
  substitutionRunCode: z.string().optional(),
  status: z.enum(TRIAL_STATUSES),
});
export type TrialComparisonRow = z.infer<typeof trialComparisonRowSchema>;

export const testResultComparisonSchema = z.object({
  testDefinitionId: z.string().min(1),
  testCode: z.string().min(1),
  values: z.array(z.object({ trialId: z.string(), mean: decimalString.optional(), passFail: z.string().optional() })),
  meanDifference: decimalString.optional(),
  absoluteDifference: decimalString.optional(),
  percentageDifference: decimalString.optional(),
  standardDeviationDifference: decimalString.optional(),
});
export type TestResultComparison = z.infer<typeof testResultComparisonSchema>;

/** A saved comparison of two or more trials — the deterministic `rows`/
 *  `testComparisons` are the source of truth. `aiInterpretation`, if
 *  present, is always labeled and never substitutes for them (spec §9: "the
 *  deterministic comparison data remains the source of truth"). */
export const trialComparisonSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  projectId: z.string().min(1),
  trialIds: z.array(z.string()).min(2),
  rows: z.array(trialComparisonRowSchema),
  testComparisons: z.array(testResultComparisonSchema).default([]),
  /** Always prefixed "AI-assisted interpretation — requires chemist
   *  review" by the caller that sets it; this schema does not enforce the
   *  prefix itself but every writer in this codebase is expected to. */
  aiInterpretation: z.string().optional(),
  generatedAt: z.string(),
  generatedBy: z.string().default("local"),
});
export type TrialComparison = z.infer<typeof trialComparisonSchema>;
