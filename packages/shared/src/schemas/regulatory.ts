/**
 * The Regulatory Engine: deterministic, versioned rules for Kenya and
 * configurable East African Community markets.
 *
 * Same governing rule as compatibility/safety: a model may explain a
 * regulatory finding, but it never IS the finding — a rule with a stated
 * verification status is. This module assists compliance work; it never
 * claims automatic legal compliance, and nothing it seeds is presented as
 * verified legislation (see catalog/regulatoryRules.ts — every seed rule
 * ships `not_verified`/`requires_regulatory_review`, structural
 * placeholders only).
 */
import { z } from "zod";
import { ruleConditionSchema } from "./ruleConditions";
import { RULE_SEVERITIES } from "./compatibility";

export const REGULATORY_JURISDICTIONS = ["KE", "UG", "TZ", "RW", "BI", "SS", "EAC"] as const;
export type RegulatoryJurisdiction = (typeof REGULATORY_JURISDICTIONS)[number];

/** EAC is a regional bloc profile, not a country — a rule scoped to it
 *  applies alongside, not instead of, a member state's own rules; nothing
 *  here resolves that overlap automatically (see
 *  docs/EAC_MARKET_PROFILES.md). */
export const EAC_MEMBER_STATES: readonly RegulatoryJurisdiction[] = ["KE", "UG", "TZ", "RW", "BI", "SS"];

export const REGULATORY_RULE_TYPES = [
  "ingredient_restriction",
  "ingredient_prohibition",
  "concentration_limit",
  "claim_restriction",
  "claim_evidence_requirement",
  "label_requirement",
  "warning_requirement",
  "registration_requirement",
  "notification_requirement",
  "testing_requirement",
  "document_requirement",
  "packaging_requirement",
  "language_requirement",
  "responsible_party_requirement",
  "market_specific_identifier",
] as const;
export type RegulatoryRuleType = (typeof REGULATORY_RULE_TYPES)[number];

/** Ingredient-based rule types match a formula via `conditions` (the same
 *  material-matching shape compatibility/safety rules already use).
 *  Everything else matches by product category (and, for claim types,
 *  claim keywords) rather than by material. */
export const INGREDIENT_BASED_RULE_TYPES: readonly RegulatoryRuleType[] = [
  "ingredient_restriction",
  "ingredient_prohibition",
  "concentration_limit",
];
export const CLAIM_BASED_RULE_TYPES: readonly RegulatoryRuleType[] = ["claim_restriction", "claim_evidence_requirement"];

export const REGULATORY_PRODUCT_CATEGORIES = [
  "household_cleaning_product",
  "laundry_detergent",
  "dishwashing_product",
  "disinfectant",
  "biocidal_product",
  "cosmetic",
  "personal_care_cleanser",
  "hair_care_product",
  "oral_care_product",
  "toothpaste",
  "wet_wipe",
  "baby_wipe",
  "medical_or_health_related_product",
  "industrial_chemical_product",
  "institutional_cleaning_product",
  "human_review_required",
] as const;
export type RegulatoryProductCategory = (typeof REGULATORY_PRODUCT_CATEGORIES)[number];

/** Same convention as `TestVerificationStatus`/`HazardDataVerificationStatus`
 *  — `imported_unverified` marks an entire bulk-import batch distinctly
 *  from a hand-entered `not_verified` row. */
export const REGULATORY_VERIFICATION_STATUSES = ["verified", "not_verified", "imported_unverified", "human_review_required"] as const;
export type RegulatoryVerificationStatus = (typeof REGULATORY_VERIFICATION_STATUSES)[number];

export const REGULATORY_HUMAN_REVIEW_STATUSES = ["not_reviewed", "review_required", "reviewed_compliant", "reviewed_non_compliant"] as const;
export type RegulatoryHumanReviewStatus = (typeof REGULATORY_HUMAN_REVIEW_STATUSES)[number];

/**
 * A single regulatory requirement. The mutable "current state" row —
 * `RegulatoryRuleRevision` (below) is the append-only history alongside
 * it, same split as `ApprovalPolicy`/`ApprovalPolicyRevision`.
 *
 * `conditions` (ingredient-based types) and `claimKeywordsAny` (claim-based
 * types) are how a rule matches a formula; every other rule type matches
 * by `productCategories` alone (empty = every category) since it concerns
 * the product as a whole (a label, a registration, a language), not a
 * specific ingredient or claim.
 */
export const regulatoryRuleSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  jurisdiction: z.enum(REGULATORY_JURISDICTIONS),
  /** Free text, e.g. "Kenya Bureau of Standards (KEBS)" — never asserted as
   *  verified; see `verificationStatus`. */
  authority: z.string().min(1),
  ruleType: z.enum(REGULATORY_RULE_TYPES),
  /** Empty means "applies to every category" — same unrestricted-when-empty
   *  convention `TestDefinition.applicableProductFamilies` uses. */
  productCategories: z.array(z.enum(REGULATORY_PRODUCT_CATEGORIES)).default([]),
  /** Free-text description of what the rule actually requires — the
   *  human-readable "Requirement" spec asks for. */
  requirement: z.string().min(1),
  severity: z.enum(RULE_SEVERITIES).default("warning"),
  status: z.enum(["draft", "verified", "deprecated"]).default("draft"),

  conditions: z.array(ruleConditionSchema).default([]),
  claimKeywordsAny: z.array(z.string()).default([]),

  requiredEvidenceTypes: z.array(z.string()).default([]),
  requiredLabelElements: z.array(z.string()).default([]),
  requiredWarnings: z.array(z.string()).default([]),
  requiredDocumentTypes: z.array(z.string()).default([]),
  requiredTestTypes: z.array(z.string()).default([]),
  requiredPackagingElements: z.array(z.string()).default([]),
  requiredLanguages: z.array(z.string()).default([]),
  requiresRegistration: z.boolean().default(false),
  requiresNotification: z.boolean().default(false),
  requiresResponsiblePartyInMarket: z.boolean().default(false),
  requiresMarketSpecificIdentifier: z.boolean().default(false),

  /** Bumped by every edit — see `engine/regulatoryRules.ts`'s `editRule`. */
  version: z.number().int().positive().default(1),
  effectiveDate: z.string().optional(),
  expiryDate: z.string().optional(),
  /** Free text — a gazette notice, a standard number. Never invented;
   *  absent is honest when no source has been recorded yet. */
  sourceReference: z.string().optional(),
  verificationStatus: z.enum(REGULATORY_VERIFICATION_STATUSES).default("not_verified"),
  humanReviewStatus: z.enum(REGULATORY_HUMAN_REVIEW_STATUSES).default("review_required"),
  active: z.boolean().default(true),

  createdBy: z.string().min(1),
  createdAt: z.string(),
  updatedBy: z.string().optional(),
  updatedAt: z.string(),
});
export type RegulatoryRule = z.infer<typeof regulatoryRuleSchema>;

export const REGULATORY_RULE_CHANGE_TYPES = ["created", "edited", "activated", "deactivated", "deprecated"] as const;
export type RegulatoryRuleChangeType = (typeof REGULATORY_RULE_CHANGE_TYPES)[number];

/** Append-only — a rule's history is never rewritten. Mirrors
 *  `ApprovalPolicyRevision` exactly. */
export const regulatoryRuleRevisionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  ruleId: z.string().min(1),
  version: z.number().int().positive(),
  snapshot: regulatoryRuleSchema,
  changeType: z.enum(REGULATORY_RULE_CHANGE_TYPES),
  changeReason: z.string().min(1),
  changedBy: z.string().min(1),
  changedAt: z.string(),
});
export type RegulatoryRuleRevision = z.infer<typeof regulatoryRuleRevisionSchema>;

/**
 * Spec §2.4's six-state finding. `unknown` never silently equals
 * `compliant_with_rule` — a caller that cannot determine an answer must
 * return `unknown`/`missing_data`, not guess compliant.
 */
export const REGULATORY_FINDING_STATUSES = [
  "compliant_with_rule",
  "non_compliant",
  "missing_data",
  "human_review_required",
  "not_applicable",
  "unknown",
] as const;
export type RegulatoryFindingStatus = (typeof REGULATORY_FINDING_STATUSES)[number];

/** Only these two statuses are non-blocking for approval-readiness
 *  purposes — every other status (including `unknown`) blocks by default
 *  when the "no blocking regulatory finding" gate is enabled. */
export const NON_BLOCKING_FINDING_STATUSES: readonly RegulatoryFindingStatus[] = ["compliant_with_rule", "not_applicable"];

export const regulatoryFindingSchema = z.object({
  id: z.string().min(1),
  ruleId: z.string().min(1),
  ruleCode: z.string().min(1),
  ruleVersion: z.number().int().positive(),
  jurisdiction: z.enum(REGULATORY_JURISDICTIONS),
  status: z.enum(REGULATORY_FINDING_STATUSES),
  severity: z.enum(RULE_SEVERITIES),
  affectedMaterialCodes: z.array(z.string()).default([]),
  affectedLineIds: z.array(z.string()).default([]),
  /** Set when the finding concerns a claim rather than an ingredient. */
  affectedClaim: z.string().optional(),
  reason: z.string().min(1),
  requiredAction: z.string().optional(),
  evidenceRequired: z.array(z.string()).default([]),
  source: z.string().optional(),
  verificationStatus: z.enum(REGULATORY_VERIFICATION_STATUSES),
});
export type RegulatoryFinding = z.infer<typeof regulatoryFindingSchema>;

/** Deterministic product classification for regulatory purposes — spec
 *  §2.2. Distinct from `ProductSafetyClassification`
 *  (`schemas/safety.ts`): the two answer different questions (hazard
 *  handling vs. which regulatory category a product falls into) and are
 *  allowed to disagree. */
export const regulatoryClassificationResultSchema = z.object({
  category: z.enum(REGULATORY_PRODUCT_CATEGORIES),
  /** 0..1 — never fabricated precision; `classifyProductRegulatory` always
   *  explains why the score is what it is via `reasoning`. */
  confidence: z.number().min(0).max(1),
  reasoning: z.array(z.string()).min(1),
  /** True whenever the classifier could not confidently narrow to one
   *  category and fell back to `human_review_required`, OR when it landed
   *  on a specific category but flags real ambiguity worth a second look. */
  uncertain: z.boolean(),
});
export type RegulatoryClassificationResult = z.infer<typeof regulatoryClassificationResultSchema>;

/** A named human recording that they completed the regulatory review for
 *  a formula version — spec §2.5/§2.6's "human-review workflow". Deliberately
 *  minimal (not the full dossier/evidence-tracking system — that is
 *  Phase 3's job, see docs/REGULATORY_ENGINE.md's known limitations):
 *  this is just the append-only record of "a named person looked at the
 *  findings for this version and signed off," which is what
 *  `requireHumanRegulatoryReviewCompleted` actually checks for. */
export const regulatoryReviewSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  formulationId: z.string().min(1),
  versionId: z.string().min(1),
  jurisdiction: z.enum(REGULATORY_JURISDICTIONS),
  reviewedBy: z.string().min(1),
  reviewedByRole: z.string().optional(),
  reviewedAt: z.string(),
  outcome: z.enum(["compliant", "non_compliant", "conditionally_compliant"]),
  notes: z.string().min(1),
});
export type RegulatoryReview = z.infer<typeof regulatoryReviewSchema>;
