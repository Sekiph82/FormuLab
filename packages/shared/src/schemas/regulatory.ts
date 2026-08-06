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
import { attachmentReferenceSchema } from "./testDefinitions";

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
 *  from a hand-entered `not_verified` row. Widened for the rule
 *  source-verification workflow (spec §3.7): `under_review` (a regulatory
 *  reviewer has picked it up but not yet decided), `rejected` (a reviewer
 *  looked and declined to verify it), `expired`/`superseded` (was verified
 *  once, no longer current). A `RegulatoryFinding`'s own
 *  `verificationStatus` is copied straight from the rule that produced it,
 *  so it shares this same widened set. */
export const REGULATORY_VERIFICATION_STATUSES = [
  "verified",
  "not_verified",
  "imported_unverified",
  "human_review_required",
  "under_review",
  "rejected",
  "expired",
  "superseded",
] as const;
export type RegulatoryVerificationStatus = (typeof REGULATORY_VERIFICATION_STATUSES)[number];

/** Statuses a "current, verified rule" policy gate accepts — everything
 *  else (including a merely `under_review` or already-`expired`/
 *  `superseded` rule) does not satisfy "verified". */
export const CURRENT_VERIFIED_RULE_STATUSES: readonly RegulatoryVerificationStatus[] = ["verified"];

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
   *  absent is honest when no source has been recorded yet. `verifyRule`
   *  (engine/regulatoryRules.ts) refuses to mark a rule `verified` unless
   *  both this and `sourceAuthority` are set — spec §3.7. */
  sourceReference: z.string().optional(),
  verificationStatus: z.enum(REGULATORY_VERIFICATION_STATUSES).default("not_verified"),
  humanReviewStatus: z.enum(REGULATORY_HUMAN_REVIEW_STATUSES).default("review_required"),
  active: z.boolean().default(true),

  /** Source-verification workflow (spec §3.7) — where this rule's
   *  requirement actually comes from, and who confirmed it. Every field
   *  optional: a freshly created or seeded rule has none of them yet.
   *  `verifiedBy`/`verifiedAt` are only ever set by `verifyRule` below,
   *  never by import or an AI/system actor. */
  sourceTitle: z.string().optional(),
  sourceAuthority: z.string().optional(),
  sourcePublicationDate: z.string().optional(),
  sourceEffectiveDate: z.string().optional(),
  sourceExpiryDate: z.string().optional(),
  sourceJurisdiction: z.enum(REGULATORY_JURISDICTIONS).optional(),
  /** The actual gazette notice / standard document / legal text, via the
   *  same safe embedded-attachment mechanism as everywhere else in this
   *  codebase (see docs/ATTACHMENTS.md) — never a renderer-supplied path. */
  sourceDocuments: z.array(attachmentReferenceSchema).optional(),
  verifiedBy: z.string().optional(),
  verifiedByRole: z.string().optional(),
  verifiedAt: z.string().optional(),
  verificationNotes: z.string().optional(),

  createdBy: z.string().min(1),
  createdAt: z.string(),
  updatedBy: z.string().optional(),
  updatedAt: z.string(),
});
export type RegulatoryRule = z.infer<typeof regulatoryRuleSchema>;

export const REGULATORY_RULE_CHANGE_TYPES = ["created", "edited", "activated", "deactivated", "deprecated", "verified", "verification_rejected", "superseded"] as const;
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

/** One rule as it stood at the moment a review was recorded — enough to
 *  detect later drift (`compareReviewRuleSnapshotToCurrentRules`) without
 *  needing to re-fetch or trust that a rule with the same id still means
 *  the same thing. */
export const regulatoryRuleVersionSnapshotSchema = z.object({
  ruleId: z.string().min(1),
  ruleCode: z.string().min(1),
  version: z.number().int().positive(),
  verificationStatus: z.enum(REGULATORY_VERIFICATION_STATUSES),
});
export type RegulatoryRuleVersionSnapshot = z.infer<typeof regulatoryRuleVersionSnapshotSchema>;

/**
 * A named human recording that they completed the regulatory review for
 * an EXACT saved formula version, jurisdiction and (where relevant)
 * packaging SKU — spec §3.1/§3.2's version-binding closure. Deliberately
 * minimal beyond that binding (not the full dossier/evidence-tracking
 * system — that is Phase 3's job, see docs/REGULATORY_ENGINE.md's known
 * limitations): this is the append-only record of "a named person looked
 * at exactly this evidence for exactly this version and signed off,"
 * which is what `requireHumanRegulatoryReviewCompleted` actually checks
 * for — see `deriveRegulatoryReviewStatus` for how a review's binding is
 * checked before it can satisfy anything.
 *
 * `formulaVersionId` is required and must be a real, saved
 * `FormulationVersion.id` — never `"working_draft"` or any other
 * placeholder. A review recorded against one version can never silently
 * cover a different one, including a later edited draft: reviewing again
 * after any change requires a new `RegulatoryReview`, unless an
 * authorized `RegulatoryReviewEquivalence` explicitly permits reuse (see
 * below).
 *
 * Every snapshot field below is frozen at `reviewedAt` — a later rule
 * edit, a later re-classification, or a later re-evaluation must never
 * retroactively change what this record says the reviewer actually saw.
 */
export const regulatoryReviewSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  formulationId: z.string().min(1),
  formulaVersionId: z.string().min(1),
  jurisdiction: z.enum(REGULATORY_JURISDICTIONS),
  /** Required only when the reviewed formula's approval is packaging-SKU
   *  scoped; omitted for a review that is not packaging-specific. */
  packagingSkuCode: z.string().optional(),

  /** Frozen at review time — never recomputed from today's rules. */
  classificationSnapshot: regulatoryClassificationResultSchema,
  findingSnapshot: z.array(regulatoryFindingSchema),
  ruleVersionSnapshot: z.array(regulatoryRuleVersionSnapshotSchema),

  reviewedBy: z.string().min(1),
  reviewerRole: z.string().min(1),
  reviewedAt: z.string(),
  outcome: z.enum(["compliant", "non_compliant", "conditionally_compliant"]),
  notes: z.string().min(1),
});
export type RegulatoryReview = z.infer<typeof regulatoryReviewSchema>;

/** Append-only — a review is never edited or deleted once recorded. A
 *  revocation is a separate record pointing at the review it revokes,
 *  the same convention `FormulaVersionEquivalence`'s own revocation
 *  records already use. `isRegulatoryReviewCurrent`/
 *  `deriveRegulatoryReviewStatus` check for a matching revocation before
 *  ever treating a review as satisfying anything. */
export const regulatoryReviewRevocationSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  revokesReviewId: z.string().min(1),
  revokedBy: z.string().min(1),
  revokedByRole: z.string().optional(),
  revokedAt: z.string(),
  reason: z.string().min(1),
});
export type RegulatoryReviewRevocation = z.infer<typeof regulatoryReviewRevocationSchema>;

// ---------------------------------------------------------------------------
// Persisted evidence confirmations — spec §3.4/§3.5. Replaces the
// session-local "confirm this requirement" checkboxes the Regulatory
// workspace used before: a product-level requirement type (label,
// warning, registration, document, testing, packaging, language,
// responsible-party, market-identifier) or a claim-evidence requirement
// has no automatic way to confirm itself, so a named human's
// confirmation is the actual fact `deriveRegulatoryReadiness` reads —
// never a UI checkbox that resets on reload.
// ---------------------------------------------------------------------------

export const REGULATORY_EVIDENCE_CONFIRMATION_STATUSES = ["confirmed", "not_available", "not_applicable", "rejected", "revoked"] as const;
export type RegulatoryEvidenceConfirmationStatus = (typeof REGULATORY_EVIDENCE_CONFIRMATION_STATUSES)[number];

/** What kind of requirement this confirmation is about — mirrors
 *  `RegulatoryRuleType` for a rule-driven requirement, plus a `document`/
 *  `evidence`/`claim` bucket for the coarser document/evidence/claims
 *  gates spec §3.5 asks for. */
export const REGULATORY_REQUIREMENT_TYPES = ["document", "evidence", "claim", ...REGULATORY_RULE_TYPES] as const;
export type RegulatoryRequirementType = (typeof REGULATORY_REQUIREMENT_TYPES)[number];

export const REGULATORY_DOCUMENT_TYPES = [
  "sds",
  "coa",
  "ingredient_declaration",
  "supplier_declaration",
  "laboratory_report",
  "stability_report",
  "packaging_compatibility_report",
  "claim_substantiation",
  "artwork",
  "regulatory_certificate",
  "external_legal_opinion",
] as const;
export type RegulatoryDocumentType = (typeof REGULATORY_DOCUMENT_TYPES)[number];

export const REGULATORY_EVIDENCE_STATES = [
  "present_and_verified",
  "present_unverified",
  "missing",
  "expired",
  "wrong_version",
  "wrong_jurisdiction",
  "wrong_packaging",
  "revoked",
  "not_required",
] as const;
export type RegulatoryEvidenceState = (typeof REGULATORY_EVIDENCE_STATES)[number];

export const REGULATORY_CLAIMS_STATES = [
  "reviewed_supported",
  "reviewed_restricted",
  "reviewed_prohibited",
  "missing_evidence",
  "not_reviewed",
  "not_applicable",
] as const;
export type RegulatoryClaimsState = (typeof REGULATORY_CLAIMS_STATES)[number];

/**
 * A named human's confirmation that a specific requirement — a rule's
 * product-level requirement, a mandatory document, or a claim's
 * evidence — is satisfied for an exact formula version, jurisdiction and
 * (where relevant) packaging SKU. Append-only: never edited, only ever
 * superseded by a fresh confirmation or revoked via
 * `RegulatoryEvidenceConfirmationRevocation`. Human-only — `confirmedBy`
 * is always a real person's name/id, never `"system"`/`"ai"`/an agent id.
 */
export const regulatoryEvidenceConfirmationSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal("1.0"),
  formulationId: z.string().min(1),
  formulaVersionId: z.string().min(1),
  jurisdiction: z.enum(REGULATORY_JURISDICTIONS),
  packagingSkuCode: z.string().optional(),
  /** The rule this confirmation answers, when it is rule-driven. Optional
   *  because a document/evidence/claim confirmation is not always tied to
   *  one specific rule id — some documents are required by policy alone. */
  ruleId: z.string().optional(),
  requirementType: z.enum(REGULATORY_REQUIREMENT_TYPES),
  /** A stable code identifying which specific requirement this is (a
   *  `RegulatoryDocumentType`, an evidence-type string, or a claim's own
   *  keyword) — free text because the requirement space is open-ended,
   *  but always non-empty. */
  requirementCode: z.string().min(1),
  status: z.enum(REGULATORY_EVIDENCE_CONFIRMATION_STATUSES),
  confirmedBy: z.string().min(1),
  reviewerRole: z.string().min(1),
  confirmedAt: z.string(),
  notes: z.string().optional(),
  attachmentIds: z.array(z.string()).default([]),
  /** Set only when this confirmation itself supersedes an earlier one for
   *  the same requirement (a corrected confirmation), distinct from a
   *  revocation record below. */
  revokesConfirmationId: z.string().optional(),
});
export type RegulatoryEvidenceConfirmation = z.infer<typeof regulatoryEvidenceConfirmationSchema>;

/** Append-only revocation of a confirmation — never a delete, never an
 *  in-place edit. A revoked confirmation can never satisfy readiness;
 *  `isEvidenceConfirmationActive` below checks for one before treating a
 *  confirmation as current. */
export const regulatoryEvidenceConfirmationRevocationSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal("1.0"),
  revokesConfirmationId: z.string().min(1),
  revokedBy: z.string().min(1),
  revokedByRole: z.string().optional(),
  revokedAt: z.string(),
  reason: z.string().min(1),
});
export type RegulatoryEvidenceConfirmationRevocation = z.infer<typeof regulatoryEvidenceConfirmationRevocationSchema>;

/** The active (non-revoked) confirmations for an exact version/
 *  jurisdiction/SKU — computed live, never stored, the same "is this
 *  revoked" overlay convention `FormulaVersionEquivalence` already uses. */
export function activeEvidenceConfirmations(
  formulaVersionId: string,
  jurisdiction: RegulatoryJurisdiction,
  packagingSkuCode: string | undefined,
  confirmations: RegulatoryEvidenceConfirmation[],
  revocations: RegulatoryEvidenceConfirmationRevocation[],
): RegulatoryEvidenceConfirmation[] {
  const revokedIds = new Set(revocations.map((r) => r.revokesConfirmationId));
  const supersededIds = new Set(confirmations.filter((c) => c.revokesConfirmationId).map((c) => c.revokesConfirmationId));
  return confirmations.filter(
    (c) =>
      c.formulaVersionId === formulaVersionId &&
      c.jurisdiction === jurisdiction &&
      c.packagingSkuCode === packagingSkuCode &&
      c.status !== "revoked" &&
      !revokedIds.has(c.id) &&
      !supersededIds.has(c.id),
  );
}

// ---------------------------------------------------------------------------
// Regulatory review equivalence reuse — spec §3.8. Kept as its own record
// rather than a new `EvidenceReuseScope` on `FormulaVersionEquivalence`:
// regulatory reuse needs jurisdiction and packaging-SKU scoping dimensions
// laboratory/stability reuse never had, and folding those into the
// general equivalence record would make a laboratory-only declaration
// carry regulatory-shaped fields it never uses. Never assumed
// automatically — declaring a lab/stability equivalence does NOT reuse a
// regulatory review, and vice versa.
// ---------------------------------------------------------------------------

export const regulatoryReviewEquivalenceSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  formulationId: z.string().min(1),
  /** The version this declaration lets the source review count toward. */
  targetVersionId: z.string().min(1),
  /** The version whose recorded `RegulatoryReview` may be reused. */
  sourceVersionId: z.string().min(1),
  jurisdiction: z.enum(REGULATORY_JURISDICTIONS),
  packagingSkuCode: z.string().optional(),
  justification: z.string().min(1),
  declaredBy: z.string().min(1),
  declaredByRole: z.string().min(1),
  declaredAt: z.string(),
  /** Set only on a revocation record. */
  revokesEquivalenceId: z.string().optional(),
  revocationReason: z.string().optional(),
});
export type RegulatoryReviewEquivalence = z.infer<typeof regulatoryReviewEquivalenceSchema>;

/** The currently active (non-revoked) equivalence declarations letting
 *  `targetVersionId` reuse a review recorded for a different source
 *  version — same overlay-by-revocation convention as
 *  `FormulaVersionEquivalence`. */
export function activeReviewEquivalencesFor(targetVersionId: string, all: RegulatoryReviewEquivalence[]): RegulatoryReviewEquivalence[] {
  const revokedIds = new Set(all.filter((e) => e.revokesEquivalenceId).map((e) => e.revokesEquivalenceId));
  return all.filter((e) => e.targetVersionId === targetVersionId && !e.revokesEquivalenceId && !revokedIds.has(e.id));
}
