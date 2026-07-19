/**
 * The Raw-Material Substitution Engine's domain model.
 *
 * A substitution candidate is never ranked by name similarity — every score
 * dimension in `substitutionScoreSchema` traces back to a real field on the
 * candidate `OptimizationMaterial` (schemas/optimization.ts) or a real
 * compatibility/safety finding, and a dimension the platform has no data for
 * is reported `missing`, not defaulted to a perfect match. See
 * `engine/substitution.ts` for the scoring implementation and
 * `docs/MATERIAL_SUBSTITUTION.md` for the weight table and worked examples.
 */
import { z } from "zod";
import { decimalString } from "./formulation";

export const SUBSTITUTION_REASONS = [
  "out_of_stock",
  "too_expensive",
  "supplier_risk",
  "long_lead_time",
  "regulatory_restriction",
  "compatibility_issue",
  "safety_issue",
  "performance_issue",
  "customer_requirement",
  "localization",
  "manual",
] as const;
export type SubstitutionReason = (typeof SUBSTITUTION_REASONS)[number];

export const substitutionRequestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  projectId: z.string().min(1),
  formulaVersionId: z.string().min(1),
  lineId: z.string().min(1),
  materialId: z.string().min(1),

  reason: z.enum(SUBSTITUTION_REASONS),
  reasonNotes: z.string().optional(),

  targetMarketIds: z.array(z.string()).default([]),
  allowedMaterialIds: z.array(z.string()).optional(),
  excludedMaterialIds: z.array(z.string()).optional(),
  preserveActiveContribution: z.boolean().default(true),
  preserveFunction: z.boolean().default(true),
  preserveCostCeiling: z.boolean().optional(),

  requestedAt: z.string(),
  requestedBy: z.string().default("local"),
});
export type SubstitutionRequest = z.infer<typeof substitutionRequestSchema>;

/** One scored dimension of a candidate. `missingData: true` means the
 *  platform has no real figure for this dimension on this candidate — the
 *  dimension is then excluded from (or penalized in, per
 *  `SubstitutionWeights.missingDataPenalty`) the total, never treated as a
 *  perfect match by defaulting its score to 1. */
export const substitutionScoreDimensionSchema = z.object({
  dimension: z.string().min(1),
  rawValue: z.string().optional(),
  normalizedScore: z.number().min(0).max(1).optional(),
  weight: z.number().min(0).max(1),
  contribution: z.number().optional(),
  missingData: z.boolean().default(false),
  explanation: z.string().min(1),
});
export type SubstitutionScoreDimension = z.infer<typeof substitutionScoreDimensionSchema>;

/** A required formula change one candidate implies beyond a straight
 *  percentage swap — e.g. "reduce SLES to 9.2%", "add 0.3% neutralizer". */
export const requiredFormulaChangeSchema = z.object({
  materialId: z.string().optional(),
  materialCode: z.string().optional(),
  description: z.string().min(1),
});
export type RequiredFormulaChange = z.infer<typeof requiredFormulaChangeSchema>;

export const substitutionCandidateSchema = z.object({
  id: z.string().min(1),
  /** Present for a one-to-one candidate; absent for a system substitution,
   *  which instead names its members in `systemMaterialIds`. */
  materialId: z.string().optional(),
  materialCode: z.string().optional(),
  name: z.string().min(1),
  isSystem: z.boolean().default(false),
  systemMaterialIds: z.array(z.string()).default([]),

  suggestedPercent: decimalString.optional(),
  activeEquivalentPercent: decimalString.optional(),

  totalScore: z.number().min(0).max(1),
  scoreDimensions: z.array(substitutionScoreDimensionSchema).default([]),

  compatibilityFindingIds: z.array(z.string()).default([]),
  safetyFindingIds: z.array(z.string()).default([]),
  hasBlockingCompatibilityFinding: z.boolean().default(false),
  hasBlockingSafetyFinding: z.boolean().default(false),

  costImpact: decimalString.optional(),
  landedCostImpact: decimalString.optional(),
  stockAvailable: z.boolean().optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
  regulatoryUncertain: z.boolean().default(false),
  evidenceConfidenceScore: z.number().min(0).max(1).optional(),

  rankingReason: z.string().min(1),
  requiredFormulaChanges: z.array(requiredFormulaChangeSchema).default([]),
  /** True when a candidate needs the Advanced Optimizer to actually place
   *  (a system substitution, or a one-to-one swap that also needs a
   *  neutralizer/co-ingredient rebalance) — the UI routes "Apply" for these
   *  through an optimizer run seeded from this candidate rather than a
   *  direct line edit. */
  requiresOptimization: z.boolean().default(false),
});
export type SubstitutionCandidate = z.infer<typeof substitutionCandidateSchema>;

export const SUBSTITUTION_RESULT_STATUSES = [
  "candidates_found",
  "no_valid_candidate",
  "optimization_required",
  "error",
] as const;
export type SubstitutionResultStatus = (typeof SUBSTITUTION_RESULT_STATUSES)[number];

export const substitutionWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});
export type SubstitutionWarning = z.infer<typeof substitutionWarningSchema>;

export const substitutionResultSchema = z.object({
  schemaVersion: z.literal("1.0"),
  requestCode: z.string().min(1),
  status: z.enum(SUBSTITUTION_RESULT_STATUSES),
  candidates: z.array(substitutionCandidateSchema).default([]),
  recommendedCandidateId: z.string().optional(),
  warnings: z.array(substitutionWarningSchema).default([]),
  computedAt: z.string(),
});
export type SubstitutionResult = z.infer<typeof substitutionResultSchema>;

/** Persisted, immutable record of a substitution request + the result it
 *  produced, mirroring `OptimizationRun`. */
export const substitutionRunSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  projectId: z.string().min(1),
  request: substitutionRequestSchema,
  result: substitutionResultSchema,
  selectedCandidateId: z.string().optional(),
  appliedAt: z.string().optional(),
  appliedToDraftBy: z.string().optional(),
  /** Set when applying the selected candidate required an optimizer run
   *  (system substitution, or `requiresOptimization: true`). */
  optimizationRunCode: z.string().optional(),
  createdAt: z.string(),
});
export type SubstitutionRun = z.infer<typeof substitutionRunSchema>;

/** Configurable weights for each scored dimension (spec §5.2's 22
 *  dimensions). Every weight defaults to a documented value in
 *  `engine/substitution.ts`'s `DEFAULT_SUBSTITUTION_WEIGHTS`; this schema
 *  exists so a chemist can override them per call without editing code. */
export const substitutionWeightsSchema = z.object({
  weights: z.record(z.string(), z.number().min(0).max(1)),
  /** Score contribution assumed for a dimension with `missingData: true`.
   *  Defaults to 0 (a missing dimension helps a candidate's score exactly as
   *  much as a confirmed bad one would) rather than 1, so absence of data is
   *  never rewarded like a perfect match. */
  missingDataPenalty: z.number().min(0).max(1).default(0),
});
export type SubstitutionWeights = z.infer<typeof substitutionWeightsSchema>;
