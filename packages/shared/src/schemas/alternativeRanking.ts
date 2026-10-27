import { z } from "zod";
import { digestSchema } from "./datasetManifest";

export const ALTERNATIVE_RANKING_SCHEMA_VERSION = "1.0" as const;
export const ALTERNATIVE_RANKING_POLICY_VERSION = "1.1" as const;

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
] as const;
export type RankingDimension = (typeof RANKING_DIMENSION_ORDER)[number];

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
});

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
  schemaVersion: z.literal(ALTERNATIVE_RANKING_SCHEMA_VERSION),
  code: z.string().min(1),
  /** Keep parsing immutable v1.0 ranking records after the v1.1 gate-policy update. */
  rankingPolicyVersion: z.enum(["1.0", ALTERNATIVE_RANKING_POLICY_VERSION]),
  sessionId: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
  context: z.object({ batchKg: z.string(), currency: z.string() }),
  dimensionOrder: z.array(z.enum(RANKING_DIMENSION_ORDER)).length(RANKING_DIMENSION_ORDER.length),
  rankings: z.array(rankedAlternativeSchema).min(1),
  artifactChecksum: digestSchema,
});
export type AlternativeRankingRecord = z.infer<typeof alternativeRankingRecordSchema>;
