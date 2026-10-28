import { z } from "zod";
import { digestSchema } from "./datasetManifest";

export const ALTERNATIVE_RANKING_SCHEMA_VERSION = "1.1" as const;
export const ALTERNATIVE_RANKING_POLICY_VERSION = "1.2" as const;

export const RANKING_DIMENSION_ORDER = [
  "performance",
  "uncertainty",
  "cost",
  "availability",
  "compatibility",
  "safety",
  "regulatory",
  "manufacturing",
  "evidence",
  "referenceSupport",
] as const;
export type RankingDimension = (typeof RANKING_DIMENSION_ORDER)[number];
export const LEGACY_RANKING_DIMENSION_ORDER = [
  "performance", "uncertainty", "cost", "availability", "compatibility",
  "safety", "regulatory", "manufacturing", "evidence",
] as const;

const sourceSnapshotSchema = z.record(z.string(), z.unknown());

export const rankingPerformanceSchema = z.object({
  status: z.enum(["PREDICTED", "OUT_OF_DOMAIN", "MODEL_NOT_ACCEPTED", "INSUFFICIENT_DATA", "MISSING_FEATURES", "UNAVAILABLE_MODEL", "ENGINE_ERROR", "INVALID_CONTRACT"]),
  numericValue: z.number().finite().optional(),
  categoryValue: z.string().optional(),
  unit: z.string().optional(),
  targetKey: z.string().optional(),
  modelId: z.string().optional(),
  modelVersion: z.number().int().positive().optional(),
  sourceSnapshot: sourceSnapshotSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.status === "PREDICTED" && value.numericValue === undefined && value.categoryValue === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A PREDICTED dimension requires an actual numeric or categorical result." });
  }
  if (value.status !== "PREDICTED" && (value.numericValue !== undefined || value.categoryValue !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A non-predicted status cannot carry a predicted value." });
  }
});

export const rankingUncertaintySchema = z.object({
  status: z.enum(["SUPPORTED", "UNSUPPORTED", "UNKNOWN"]),
  numericValue: z.number().finite().nonnegative().optional(),
  unit: z.string().optional(),
  method: z.string().optional(),
  sourceSnapshot: sourceSnapshotSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.status === "SUPPORTED" && value.numericValue === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Supported uncertainty requires a value." });
  if (value.status !== "SUPPORTED" && value.numericValue !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unsupported or unknown uncertainty cannot carry a value." });
});

export const rankingCostSchema = z.object({
  status: z.enum(["AVAILABLE", "INCOMPLETE", "MISSING", "ERROR"]),
  costPerKg: z.number().finite().nonnegative().optional(),
  currency: z.string().optional(),
  batchKg: z.string().optional(),
  sourceSnapshot: sourceSnapshotSchema.optional(),
});

export const rankingGateDimensionSchema = z.object({
  status: z.enum(["PASS", "WARNING", "FAIL", "UNKNOWN"]),
  sourceSnapshot: sourceSnapshotSchema.optional(),
});

export const rankingAvailabilitySchema = z.object({
  status: z.enum(["FEASIBLE", "INFEASIBLE", "UNKNOWN"]),
  sourceSnapshot: sourceSnapshotSchema.optional(),
});

export const rankingManufacturingSchema = z.object({
  status: z.enum(["READY", "NOT_READY", "UNKNOWN"]),
  sourceSnapshot: sourceSnapshotSchema.optional(),
});

export const rankingEvidenceSchema = z.object({
  status: z.enum(["LINKED", "NO_LINKED_EVIDENCE", "UNKNOWN"]),
  ingredientCount: z.number().int().nonnegative(),
  linkedIngredientCount: z.number().int().nonnegative(),
  bestEvidenceClass: z.enum(["A", "B", "C", "D", "E"]).optional(),
  uniqueSourceCount: z.number().int().nonnegative(),
  sourceSnapshot: sourceSnapshotSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.linkedIngredientCount > value.ingredientCount) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Linked evidence coverage cannot exceed ingredient count." });
  if (value.status === "NO_LINKED_EVIDENCE" && value.linkedIngredientCount > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "No-linked-evidence status cannot carry linked ingredients." });
});

/** Supplier/reference-formulation corpus support is separate from literature
 *  evidence and never stands in for measured performance or validation. */
export const rankingReferenceSupportSchema = z.object({
  status: z.enum(["SUPPORTED", "NO_MATCHING_REFERENCES", "UNKNOWN"]),
  formulaCount: z.number().int().nonnegative(),
  supplierCount: z.number().int().nonnegative(),
  sourceRecordIds: z.array(z.string().min(1)),
  sourceSnapshot: sourceSnapshotSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.status === "SUPPORTED" && (value.formulaCount === 0 || value.supplierCount === 0 || value.sourceRecordIds.length === 0
    || value.sourceRecordIds.length !== value.formulaCount || value.supplierCount > value.formulaCount)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Supported reference data requires formula, supplier, and source-record support." });
  }
  if (value.status === "NO_MATCHING_REFERENCES" && (value.formulaCount !== 0 || value.supplierCount !== 0 || value.sourceRecordIds.length !== 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "No-matching-reference status cannot carry supporting samples." });
  }
  if (value.status === "UNKNOWN" && (value.formulaCount !== 0 || value.supplierCount !== 0 || value.sourceRecordIds.length !== 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unknown reference support cannot carry unverified sample counts." });
  }
  if (new Set(value.sourceRecordIds).size !== value.sourceRecordIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Reference source-record IDs must be unique." });
  }
});

export const alternativeRankingDimensionsSchema = z.object({
  performance: rankingPerformanceSchema,
  uncertainty: rankingUncertaintySchema,
  cost: rankingCostSchema,
  availability: rankingAvailabilitySchema,
  compatibility: rankingGateDimensionSchema,
  safety: rankingGateDimensionSchema,
  regulatory: rankingGateDimensionSchema,
  manufacturing: rankingManufacturingSchema,
  evidence: rankingEvidenceSchema,
  /** Optional only for immutable historical ranking records created before
   *  policy 1.2; all current builders write an explicit status. */
  referenceSupport: rankingReferenceSupportSchema.optional(),
});
export type RankingReferenceSupport = z.infer<typeof rankingReferenceSupportSchema>;

export const alternativeRankingCandidateSchema = z.object({
  candidateId: z.string().min(1),
  sessionId: z.string().min(1),
  alternativeId: z.string().min(1),
  versionLabel: z.string().min(1),
  sourceFormulationVersionId: z.string().min(1).optional(),
  formulaFingerprint: digestSchema.optional(),
  formulaStatus: z.enum(["VALID", "INCOMPLETE", "INVALID", "UNAVAILABLE"]),
  dimensions: alternativeRankingDimensionsSchema,
});
export type AlternativeRankingCandidate = z.infer<typeof alternativeRankingCandidateSchema>;

export const rankedAlternativeSchema = z.object({
  candidate: alternativeRankingCandidateSchema,
  rank: z.number().int().positive(),
  disposition: z.enum(["ELIGIBLE", "REVIEW_REQUIRED", "BLOCKED", "UNAVAILABLE"]),
  gateReasons: z.array(z.string()),
});
export type RankedAlternative = z.infer<typeof rankedAlternativeSchema>;

export const alternativeRankingRecordSchema = z.object({
  schemaVersion: z.enum(["1.0", ALTERNATIVE_RANKING_SCHEMA_VERSION]),
  code: z.string().min(1),
  /** Keep parsing immutable rankings created under policies 1.0 and 1.1. */
  rankingPolicyVersion: z.enum(["1.0", "1.1", ALTERNATIVE_RANKING_POLICY_VERSION]),
  sessionId: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
  context: z.object({ batchKg: z.string(), currency: z.string() }),
  dimensionOrder: z.array(z.enum(RANKING_DIMENSION_ORDER)).refine((order) =>
    (order.length === LEGACY_RANKING_DIMENSION_ORDER.length && order.every((dimension, index) => dimension === LEGACY_RANKING_DIMENSION_ORDER[index]))
      || (order.length === RANKING_DIMENSION_ORDER.length && order.every((dimension, index) => dimension === RANKING_DIMENSION_ORDER[index])),
    "Ranking dimension order must match a supported immutable policy version."),
  rankings: z.array(rankedAlternativeSchema).min(1),
  artifactChecksum: digestSchema,
}).superRefine((record, ctx) => {
  const legacy = record.rankingPolicyVersion === "1.0" || record.rankingPolicyVersion === "1.1";
  if ((record.schemaVersion === "1.0") !== legacy) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rankingPolicyVersion"], message: "Ranking schema and policy versions are incompatible." });
  }
  if (legacy && record.dimensionOrder.length !== 9) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dimensionOrder"], message: "Historical ranking policies require the immutable nine-dimension order." });
  }
  if (!legacy && record.dimensionOrder.length !== RANKING_DIMENSION_ORDER.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dimensionOrder"], message: "Ranking policy 1.2 requires the reference-support dimension." });
  }
  if (!legacy && record.rankings.some(({ candidate }) => candidate.dimensions.referenceSupport === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rankings"], message: "Ranking policy 1.2 requires reference-support status for every candidate." });
  }
});
export type AlternativeRankingRecord = z.infer<typeof alternativeRankingRecordSchema>;
