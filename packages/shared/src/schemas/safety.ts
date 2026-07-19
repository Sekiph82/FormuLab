/**
 * Deterministic chemical-safety classification and hazard checking.
 *
 * Same governing rule as the compatibility engine: a model may explain a
 * safety finding, but it never IS the finding. A hazard record, a product
 * classification and a safety finding all exist because a rule or a stored
 * fact says so, with a verification status attached — never because a prompt
 * asserted it. Nothing here establishes legal/regulatory compliance; that is
 * the separate, not-yet-built Regulatory Engine's job (see
 * docs/architecture/IMPLEMENTATION_STATUS.md).
 */
import { z } from "zod";
import { ruleConditionSchema } from "./ruleConditions";
import { COMPATIBILITY_RULE_TYPES, RULE_SEVERITIES } from "./compatibility";

export const HAZARD_CLASSES = [
  "skin_corrosion",
  "skin_irritation",
  "serious_eye_damage",
  "eye_irritation",
  "skin_sensitization",
  "respiratory_sensitization",
  "acute_toxicity_oral",
  "acute_toxicity_dermal",
  "acute_toxicity_inhalation",
  "specific_target_organ_toxicity",
  "flammable_liquid",
  "oxidizing",
  "corrosive_to_metals",
  "hazardous_to_aquatic_environment",
  "carcinogenic_mutagenic_reprotoxic",
  "other",
] as const;
export type HazardClass = (typeof HAZARD_CLASSES)[number];

export const GHS_PICTOGRAMS = [
  "GHS01_explosive",
  "GHS02_flammable",
  "GHS03_oxidizing",
  "GHS04_compressed_gas",
  "GHS05_corrosive",
  "GHS06_acute_toxicity",
  "GHS07_irritant",
  "GHS08_health_hazard",
  "GHS09_environmental_hazard",
] as const;
export type GhsPictogram = (typeof GHS_PICTOGRAMS)[number];

export const SIGNAL_WORDS = ["danger", "warning", "none"] as const;
export type SignalWord = (typeof SIGNAL_WORDS)[number];

/**
 * How confident the platform is in a piece of hazard data. `imported_unverified`
 * is distinct from `not_verified`: it marks data that arrived through a bulk
 * import specifically, so a reviewer working through an import batch can find
 * everything from that batch in one filter.
 */
export const HAZARD_DATA_VERIFICATION_STATUSES = [
  "verified",
  "not_verified",
  "imported_unverified",
  "human_review_required",
] as const;
export type HazardDataVerificationStatus = (typeof HAZARD_DATA_VERIFICATION_STATUSES)[number];

/**
 * A hazard classification recorded against a material, by CAS number rather
 * than internal code — hazard data belongs to the substance, and the same
 * substance may appear under several internal material codes.
 */
export const materialHazardRecordSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  casNumber: z.string().min(1),
  hazardClass: z.enum(HAZARD_CLASSES),
  category: z.string().optional(),
  /** GHS H-statement code, e.g. "H314", when known. Never invented. */
  statementCode: z.string().optional(),
  statementText: z.string().optional(),
  /** Concentration threshold above which the classification applies, if any. */
  thresholdPercent: z.string().optional(),
  pictograms: z.array(z.enum(GHS_PICTOGRAMS)).default([]),
  signalWord: z.enum(SIGNAL_WORDS).optional(),
  source: z.string().optional(),
  verificationStatus: z.enum(HAZARD_DATA_VERIFICATION_STATUSES).default("not_verified"),
  effectiveFrom: z.string(),
  notes: z.string().optional(),
});
export type MaterialHazardRecord = z.infer<typeof materialHazardRecordSchema>;

/**
 * How a product is classified for safety-review purposes. Deterministic,
 * rule-based classification (family + claims), never a model's guess — see
 * `classifyProductSafety` in `engine/safety.ts`.
 */
export const PRODUCT_SAFETY_CLASSIFICATIONS = [
  "ordinary_consumer_product",
  "industrial_cleaning_product",
  "hazardous_lawful_product",
  "regulated_disinfectant",
  "medical_or_health_related_product",
  "restricted_request",
  "prohibited_request",
  "human_review_required",
] as const;
export type ProductSafetyClassification = (typeof PRODUCT_SAFETY_CLASSIFICATIONS)[number];

export const safetyRuleSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  version: z.string().default("1.0"),
  name: z.string().min(1),
  status: z.enum(["draft", "verified", "deprecated"]).default("draft"),
  severity: z.enum(RULE_SEVERITIES),
  /** Which of the spec's named safety-rule categories this implements —
   *  free text so a rule-management screen can filter by it without a schema
   *  migration every time a new category is needed. */
  category: z.string().min(1),

  ruleType: z.enum(COMPATIBILITY_RULE_TYPES),
  conditions: z.array(ruleConditionSchema).min(1),

  message: z.string().min(1),
  scientificReason: z.string().optional(),
  requiredAction: z.string().optional(),
  requiredPpe: z.array(z.string()).default([]),
  requiredEngineeringControls: z.array(z.string()).default([]),
  sourceReferences: z.array(z.string()).default([]),
  verificationStatus: z.enum(HAZARD_DATA_VERIFICATION_STATUSES).default("not_verified"),
  /** A blocking finding from this rule always needs sign-off; this marks a
   *  rule where even a WARNING finding should route to human review. */
  alwaysRequiresHumanReview: z.boolean().default(false),

  active: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SafetyRule = z.infer<typeof safetyRuleSchema>;

export const safetyFindingSchema = z.object({
  id: z.string().min(1),
  ruleId: z.string().min(1),
  ruleVersion: z.string(),
  severity: z.enum(RULE_SEVERITIES),
  category: z.string(),
  affectedMaterialIds: z.array(z.string()).default([]),
  affectedLineIds: z.array(z.string()).default([]),
  message: z.string().min(1),
  requiredAction: z.string().optional(),
  requiredPpe: z.array(z.string()).default([]),
  requiredEngineeringControls: z.array(z.string()).default([]),
  verificationStatus: z.enum(HAZARD_DATA_VERIFICATION_STATUSES),
  humanReviewRequired: z.boolean().default(false),
  dataIncomplete: z.boolean().default(false),
});
export type SafetyFinding = z.infer<typeof safetyFindingSchema>;

/**
 * A human clearing a safety finding. Required before a blocking finding can
 * stop being a blocker — never dismissible by an actor other than a named
 * person, mirroring the approval-record rule in schemas/formulation.ts.
 */
export const safetyResolutionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  formulationId: z.string().min(1),
  versionId: z.string().min(1),
  findingId: z.string().min(1),
  reviewerName: z.string().min(1),
  reviewerRole: z.string().optional(),
  resolvedAt: z.string(),
  resolutionReason: z.string().min(1),
  /** "accepted_risk" clears a finding without changing the formula; "formula_changed"
   *  records that the offending line was removed/altered instead. */
  resolutionKind: z.enum(["accepted_risk", "formula_changed", "rule_disputed"]),
});
export type SafetyResolution = z.infer<typeof safetyResolutionSchema>;

export const safetySnapshotSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  formulationId: z.string().min(1),
  versionId: z.string().min(1),
  calculatedAt: z.string(),
  productClassification: z.enum(PRODUCT_SAFETY_CLASSIFICATIONS),
  ruleVersionsUsed: z.array(z.object({ ruleId: z.string(), version: z.string() })).default([]),
  findings: z.array(safetyFindingSchema).default([]),
});
export type SafetySnapshot = z.infer<typeof safetySnapshotSchema>;
