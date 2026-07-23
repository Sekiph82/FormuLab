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
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional(),
  /** Free text — "in-house SOP-014", "ISO 4316" — never invented; absent is
   *  honest when the lab has not recorded a method reference yet. */
  methodReference: z.string().optional(),
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
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  trialId: z.string().min(1),
  testDefinitionId: z.string().min(1),
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
  notes: z.string().optional(),
  attachments: z.array(attachmentReferenceSchema).default([]),

  performedBy: z.string().min(1),
  performedAt: z.string(),
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

  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TestResult = z.infer<typeof testResultSchema>;
