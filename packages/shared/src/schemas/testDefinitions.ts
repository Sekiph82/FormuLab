/**
 * Test definitions and results — shared by Laboratory Trials and Stability
 * Studies, the same way a pH or viscosity measurement means the same thing
 * whether it was taken on trial day 1 or a stability sample at 3 months.
 *
 * A `TestDefinition` is a structural template, not a claim of a recognized,
 * validated method: every seed definition ships `not_verified` (see
 * `catalog/testDefinitions.ts`), and nothing here invents a legal limit or a
 * verified method reference. A chemist attaches the real method/limit their
 * lab actually uses.
 */
import { z } from "zod";
import { decimalString } from "./primitives";
import { testMethodSnapshotSchema } from "./laboratoryStandards";

export const TEST_RESULT_TYPES = ["numeric", "text", "boolean", "pass_fail", "categorical", "visual_rating"] as const;
export type TestResultType = (typeof TEST_RESULT_TYPES)[number];

/** Same convention as `RawMaterial.regulatoryStatuses`/hazard records —
 *  `imported_unverified` is distinct from `not_verified` so a bulk-imported
 *  batch of definitions can be filtered and reviewed as a group. */
export const TEST_VERIFICATION_STATUSES = ["verified", "not_verified", "imported_unverified", "human_review_required"] as const;
export type TestVerificationStatus = (typeof TEST_VERIFICATION_STATUSES)[number];

export const PASS_FAIL_RULES = ["within_range", "at_least", "at_most", "equals", "in_set", "manual_judgment"] as const;
export type PassFailRule = (typeof PASS_FAIL_RULES)[number];

export const passFailLogicSchema = z.object({
  rule: z.enum(PASS_FAIL_RULES),
  /** For `in_set` (categorical) or `equals` (text/boolean/categorical). */
  allowedValues: z.array(z.string()).optional(),
});
export type PassFailLogic = z.infer<typeof passFailLogicSchema>;

export const ATTACHMENT_KINDS = ["photo", "document", "chart", "raw_data", "other"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** Allow-listed file categories a picked attachment may belong to — never an
 *  arbitrary extension. The kind above (photo/document/chart/raw_data/other)
 *  is what the record is FOR; this is what the file actually IS. */
export const ATTACHMENT_FILE_CATEGORIES = ["image", "pdf", "spreadsheet", "text_document"] as const;
export type AttachmentFileCategory = (typeof ATTACHMENT_FILE_CATEGORIES)[number];

/** Measurement families are descriptive identities only. The schema does
 *  not assign equations, reference standards, or pass limits to a family. */
export const MEASURED_METRIC_FAMILIES = [
  "absorbance",
  "reflectance",
  "transmittance",
  "colorimetric",
  "soil_removal",
  "whiteness_brightness",
  "comparative_performance",
  "other",
] as const;
export type MeasuredMetricFamily = (typeof MEASURED_METRIC_FAMILIES)[number];

export const testMetricDefinitionSchema = z.object({
  metricCode: z.string().min(1),
  family: z.enum(MEASURED_METRIC_FAMILIES),
  description: z.string().optional(),
  /** Wavelength specified by the method, not a guessed default. */
  wavelengthNm: decimalString.optional(),
  referenceContext: z.string().optional(),
});
export type TestMetricDefinition = z.infer<typeof testMetricDefinitionSchema>;

export const measuredResponseContextSchema = z.object({
  wavelengthNm: decimalString.optional(),
  referenceContext: z.string().optional(),
});
export type MeasuredResponseContext = z.infer<typeof measuredResponseContextSchema>;

/** A normalized value is accepted only with enough explicit metadata to
 *  identify the deterministic rule and its inputs. This records evidence;
 *  it does not invent a rule or recompute a scientific result. */
export const normalizedPerformanceSchema = z.object({
  value: decimalString,
  unit: z.string().optional(),
  ruleId: z.string().min(1),
  ruleVersion: z.string().min(1),
  inputs: z.record(z.string(), z.string().min(1)).refine((inputs) => Object.keys(inputs).length > 0, {
    message: "Normalization inputs must be recorded.",
  }),
});
export type NormalizedPerformance = z.infer<typeof normalizedPerformanceSchema>;

/** Stable source-file identity and row locator, deliberately excluding
 *  machine-specific paths. Raw bytes remain in the existing managed-file
 *  attachment lifecycle when a user attaches them. */
export const measuredResponseSourceProvenanceSchema = z.object({
  fileName: z.string().min(1),
  fileType: z.enum(["csv", "xlsx"]),
  mimeType: z.string().min(1).optional(),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  importJobId: z.string().min(1).optional(),
  connectorId: z.string().min(1).optional(),
  rowNumber: z.number().int().positive().optional(),
  sheetName: z.string().min(1).optional(),
});
export type MeasuredResponseSourceProvenance = z.infer<typeof measuredResponseSourceProvenanceSchema>;

/** A reference, never an embedded blob — files stay in the project folder,
 *  same convention as `RawMaterial.documents`. `location` is always a path
 *  relative to the project's own attachment folder, never an arbitrary
 *  absolute path handed in by the renderer — see
 *  `apps/desktop/src-tauri/src/attachments.rs`. */
export const attachmentReferenceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(ATTACHMENT_KINDS),
  title: z.string().min(1),
  location: z.string().min(1),
  capturedAt: z.string().optional(),
  capturedBy: z.string().optional(),
  notes: z.string().optional(),
  /** Everything below is additive metadata recorded when the file was
   *  copied into the project — absent on attachments predating this phase. */
  fileCategory: z.enum(ATTACHMENT_FILE_CATEGORIES).optional(),
  originalFileName: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  checksumSha256: z.string().optional(),
  addedBy: z.string().optional(),
  addedAt: z.string().optional(),
  description: z.string().optional(),
  /** Set when a finalized result's attachment was replaced rather than
   *  removed outright — the prior reference's id, so the old file's
   *  metadata is never silently lost. See docs/ATTACHMENTS.md. */
  replacesAttachmentId: z.string().optional(),
});
export type AttachmentReference = z.infer<typeof attachmentReferenceSchema>;

/** What a test actually verifies, as a stable category a caller can key
 *  off of — never a display-name text match. `packaging_compatibility` is
 *  the umbrella; `seal_integrity`/`leak_test` are specific enough that a
 *  policy can require just one of them instead of the whole umbrella. Most
 *  tests (viscosity, pH, an odor panel) are `general` — unrelated to
 *  packaging readiness. */
export const TEST_CAPABILITIES = ["packaging_compatibility", "seal_integrity", "leak_test", "general"] as const;
export type TestCapability = (typeof TEST_CAPABILITIES)[number];

/** Which kind of record a test definition may be selected into. Most
 *  definitions apply to both; a few (a stability-only "3-month viscosity
 *  drift" test) are meaningful in one context only. */
export const TEST_APPLICABLE_CONTEXTS = ["trial", "stability"] as const;
export type TestApplicableContext = (typeof TEST_APPLICABLE_CONTEXTS)[number];

export const testDefinitionSchema = z.object({
  schemaVersion: z.enum(["1.0", "1.1"]),
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional(),
  /** Free text — "in-house SOP-014", "ISO 4316" — never invented; absent is
   *  honest when the lab has not recorded a method reference yet. */
  methodReference: z.string().optional(),
  metric: testMetricDefinitionSchema.optional(),
  resultType: z.enum(TEST_RESULT_TYPES),
  unit: z.string().optional(),
  targetValue: decimalString.optional(),
  minimum: decimalString.optional(),
  maximum: decimalString.optional(),
  passFailLogic: passFailLogicSchema.optional(),
  replicatesRequired: z.number().int().positive().default(1),
  /** Free text — "initial", "24h", "1mo" — a definition does not itself fix
   *  which studies/time points use it; that binding happens where a study
   *  or trial selects this definition. */
  timePoint: z.string().optional(),
  storageCondition: z.string().optional(),
  requiredEquipment: z.array(z.string()).default([]),
  requiredAttachment: z.boolean().default(false),
  /** Empty means unrestricted — applies to every product family / SKU /
   *  condition / time point. Enforced by
   *  `engine/testApplicability.ts`'s `isTestDefinitionApplicable`, not just
   *  displayed. */
  applicableProductFamilies: z.array(z.string()).default([]),
  applicableProductSkus: z.array(z.string()).default([]),
  /** New, additive applicability fields. `.optional()` rather than
   *  `.default()` so a `TestDefinition` object literal written before this
   *  phase (with none of these keys) still satisfies the type — every
   *  reader treats an absent array the same as an empty one (unrestricted)
   *  and absent `testCapability` as `"general"`. */
  applicablePackagingSkuCodes: z.array(z.string()).optional(),
  applicableContexts: z.array(z.enum(TEST_APPLICABLE_CONTEXTS)).optional(),
  applicableConditionCodes: z.array(z.string()).optional(),
  applicableTimePointCodes: z.array(z.string()).optional(),
  /** Whether a trial/study that includes this test must actually complete
   *  it to satisfy approval readiness's "all required tests completed"
   *  check — distinct from `criticalTestFlag`, which is about whether it
   *  must also PASS. An optional test can still be run; it just cannot by
   *  itself block "all required tests completed". */
  requiredByDefault: z.boolean().optional(),
  testCapability: z.enum(TEST_CAPABILITIES).optional(),
  criticalTestFlag: z.boolean().default(false),
  verificationStatus: z.enum(TEST_VERIFICATION_STATUSES).default("not_verified"),
  active: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TestDefinition = z.infer<typeof testDefinitionSchema>;

/**
 * An immutable copy of which test definitions applied to a trial or study,
 * and why, captured once at creation — see docs/TEST_APPLICABILITY.md. A
 * later edit to a `TestDefinition` (its applicability, its critical flag,
 * even its existence) must never retroactively change what a trial or
 * study's protocol already required; this snapshot is what "already
 * required" means from that point on.
 */
export const testRequirementSnapshotEntrySchema = z.object({
  testDefinitionId: z.string().min(1),
  testDefinitionCode: z.string().min(1),
  name: z.string().min(1),
  testCapability: z.enum(TEST_CAPABILITIES),
  criticalTestFlag: z.boolean(),
  required: z.boolean(),
  /** Human-readable: "applicable to product family X", "added by chemist
   *  Jane Doe on 2026-01-04" — always populated, never a blank requirement. */
  reason: z.string().min(1),
  /** Set only for a test an authorized human added beyond what applicability
   *  resolution alone selected — never set by automatic resolution. */
  addedManuallyBy: z.string().optional(),
});
export type TestRequirementSnapshotEntry = z.infer<typeof testRequirementSnapshotEntrySchema>;

export const testRequirementSnapshotSchema = z.object({
  capturedAt: z.string(),
  entries: z.array(testRequirementSnapshotEntrySchema),
});
export type TestRequirementSnapshot = z.infer<typeof testRequirementSnapshotSchema>;

export const testReplicateSchema = z.object({
  replicateNumber: z.number().int().positive(),
  numericValue: decimalString.optional(),
  /** Optional deterministic performance normalization; numericValue above
   *  always remains the raw instrument observation. */
  normalizedPerformance: normalizedPerformanceSchema.optional(),
  textValue: z.string().optional(),
  notes: z.string().optional(),
  /** Flagged, never deleted — see `engine/testResults.ts`'s outlier
   *  detection. A flagged replicate still counts in the raw record; it is
   *  the caller's choice whether to exclude it from a recalculated mean. */
  isOutlier: z.boolean().default(false),
  outlierReason: z.string().optional(),
});
export type TestReplicate = z.infer<typeof testReplicateSchema>;

/** Computed purely from `replicates` — see `computeReplicateStats` in
 *  `engine/testResults.ts`. Persisted alongside the raw replicates (the same
 *  "snapshot the computed totals" convention `CostSnapshot`/`OptimizationRun`
 *  already use) so a report does not need to recompute it, but the
 *  replicates remain the source of truth. */
export const replicateStatsSchema = z.object({
  count: z.number().int().nonnegative(),
  mean: decimalString.optional(),
  minimum: decimalString.optional(),
  maximum: decimalString.optional(),
  standardDeviation: decimalString.optional(),
  /** Undefined when the mean is zero (division by zero) or fewer than 2
   *  replicates exist — never a fabricated ratio. */
  coefficientOfVariationPercent: decimalString.optional(),
});
export type ReplicateStats = z.infer<typeof replicateStatsSchema>;

export const testResultOverrideSchema = z.object({
  reviewerId: z.string().min(1),
  reason: z.string().min(1),
  at: z.string(),
  originalEvaluation: z.string(),
  overriddenEvaluation: z.string(),
});
export type TestResultOverride = z.infer<typeof testResultOverrideSchema>;

/** A laboratory trial's own test result. Stability studies use the
 *  structurally similar `StabilityResult` (schemas/stability.ts) — kept
 *  separate because a stability result's identity is
 *  sample × time point, not a trial id, even though both reuse
 *  `testReplicateSchema`/`replicateStatsSchema`/`passFailLogicSchema`. */
export const testResultSchema = z.object({
  schemaVersion: z.enum(["1.0", "1.1"]),
  id: z.string().min(1),
  trialId: z.string().min(1),
  /** Exact immutable version identity captured from the linked trial. */
  formulaVersionId: z.string().min(1).optional(),
  testDefinitionId: z.string().min(1),
  metricSnapshot: testMetricDefinitionSchema.optional(),
  sampleId: z.string().optional(),
  timePoint: z.string().optional(),
  storageCondition: z.string().optional(),

  resultType: z.enum(TEST_RESULT_TYPES),
  replicates: z.array(testReplicateSchema).default([]),
  stats: replicateStatsSchema.optional(),
  textValue: z.string().optional(),
  categoricalValue: z.string().optional(),
  booleanValue: z.boolean().optional(),

  /** The deterministic pass/fail read from `passFailLogic` against the
   *  value(s) above — `undefined` when the definition has no pass/fail
   *  logic (a purely observational/informational test). Never inferred for
   *  `manual_judgment`, which always requires `passFail` to be set by a
   *  human. */
  passFail: z.enum(["pass", "fail", "not_evaluated"]).default("not_evaluated"),

  unit: z.string().optional(),
  measurementContext: measuredResponseContextSchema.optional(),
  /** Instrument/device used, when known — e.g. a customer migration's own
   *  "Instrument" column, or a manually recorded device name. Never
   *  fabricated when absent. */
  instrument: z.string().optional(),
  sourceProvenance: z.array(measuredResponseSourceProvenanceSchema).optional(),
  notes: z.string().optional(),
  attachments: z.array(attachmentReferenceSchema).default([]),

  performedBy: z.string().min(1),
  performedAt: z.string().optional(),
  /** Time this source record entered FormuLab; distinct from performedAt. */
  importedAt: z.string().optional(),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().optional(),

  /** This result's own predecessor, when it is a retest — the earlier
   *  result is never deleted or overwritten. */
  retestOf: z.string().optional(),

  override: testResultOverrideSchema.optional(),

  /** Append-only revision history — see `engine/testResults.ts`'s
   *  `reviseTestResult`. Editing a recorded result never mutates it in
   *  place; a new `TestResult` record with `revisesResultId` set is created
   *  instead, and this array names every prior revision's id. */
  revisesResultId: z.string().optional(),

  /** Immutable snapshot of the standard/method actually used, captured at
   *  creation (see `engine/laboratoryStandards.ts`'s
   *  `buildTestMethodSnapshot`). Optional and additive: a result recorded
   *  before Session 1A, or for a test with no assigned method yet, has none
   *  — never backfilled or inferred after the fact. A later edit to the
   *  standard/method must never change this. */
  methodSnapshot: testMethodSnapshotSchema.optional(),

  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TestResult = z.infer<typeof testResultSchema>;
