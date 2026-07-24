/**
 * Phase 4 — Claims and Label Review. A version/packaging-SKU/jurisdiction/
 * language-specific claims-and-label subsystem: which claims are proposed,
 * which are supported/restricted/prohibited, which evidence supports each
 * one, which exact label and artwork revision was reviewed, whether the
 * label matches the formula/packaging/market/dossier, which required label
 * elements are missing, who reviewed it, which languages/markets are
 * covered, and whether it is ready for approval. Compliance-assistance
 * only — never a claim of legal compliance from a recorded status alone.
 * See docs/PRODUCT_CLAIMS.md and docs/PRODUCT_LABELS.md.
 *
 * Nine persistence collections (`apps/desktop/src-tauri/src/masterdata.rs`),
 * trimmed from the ten the spec suggested — `label_manual_actions` was
 * dropped because the spec's own field list never actually defines what it
 * would record (no fields were specified anywhere in the brief), and an
 * empty, purposeless collection would be exactly the "unnecessary
 * duplication" earlier phases were told to avoid. If a real manual-action
 * need appears later (e.g. an authorized override of a mandatory label
 * requirement — see §19 audit events, which do reference this), it reuses
 * the existing global audit log the same way `RegulatoryDossierSubmission`
 * status changes already do, rather than a dedicated table:
 * - `product_claims` (mutable header, like `RegulatoryDossier`; a text
 *   revision is a NEW row via `supersedesClaimId`, never an edit in place)
 * - `claim_evidence_links` (append-only, identical overlay-computed-active
 *   convention as `RegulatoryRequirementEvidenceLink`)
 * - `claim_reviews` / `claim_review_revocations` (append-only; the spec's
 *   own §9.3 field list omitted `revokesReviewId`, but every other review
 *   type in this codebase — `RegulatoryReview`, `RegulatoryDossierReview`,
 *   and this very spec's own `LabelReview` two sections later — uses the
 *   append-only-review-plus-separate-revocation-record pattern, so adding
 *   it here too is the consistent choice, not a deviation)
 * - `product_labels` (mutable header, like `RegulatoryDossier`/`ProductClaim`)
 * - `label_content_blocks` (append-only per `(labelId, labelRevision,
 *   blockType)` — a content edit appends a new row, latest-wins, exactly
 *   `RegulatoryDossierRequirement`'s own frozen-per-revision pattern)
 * - `label_artworks` (mutable current-state row; a real file replacement
 *   creates a NEW row via `supersedesArtworkId`, same chain
 *   `RegulatoryDossierEvidenceItem` already uses instead of a separate
 *   "artwork revisions" collection)
 * - `label_reviews` / `label_review_revocations` (append-only, mirrors
 *   `RegulatoryDossierReview`/`RegulatoryDossierReviewRevocation` exactly)
 */
import { z } from "zod";
import { REGULATORY_JURISDICTIONS } from "./regulatory";
import { attachmentReferenceSchema } from "./testDefinitions";

// ---------------------------------------------------------------------------
// Shared language vocabulary.
// ---------------------------------------------------------------------------

/** English, Turkish and Swahili are fully supported UI languages for label
 *  content per spec §13; other label languages may still be recorded (a
 *  label can target any market's language), they just don't get dedicated
 *  FormuLab UI chrome translated for them yet. */
export const LABEL_UI_LANGUAGES = ["en", "tr", "sw"] as const;
export type LabelUiLanguage = (typeof LABEL_UI_LANGUAGES)[number];

// ---------------------------------------------------------------------------
// ProductClaim
// ---------------------------------------------------------------------------

export const CLAIM_CATEGORIES = [
  "performance",
  "antibacterial",
  "antimicrobial",
  "disinfectant",
  "germ_kill",
  "medical",
  "therapeutic",
  "dermatological",
  "hypoallergenic",
  "sensitive",
  "baby_safe",
  "child_safe",
  "natural",
  "organic",
  "biodegradable",
  "flushable",
  "vegan",
  "cruelty_free",
  "whitening",
  "brightening",
  "stain_removal",
  "odor_control",
  "long_lasting",
  "concentrated",
  "eco",
  "free_from",
  "ingredient",
  "comparative",
  "professional",
  "other",
] as const;
export type ClaimCategory = (typeof CLAIM_CATEGORIES)[number];

export const CLAIM_STATUSES = [
  "draft",
  "proposed",
  "under_review",
  "supported",
  "supported_with_conditions",
  "restricted",
  "prohibited",
  "rejected",
  "withdrawn",
  "superseded",
  "unknown",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
/** A claim in one of these statuses can never be edited in place — a
 *  revision creates a new row via `supersedesClaimId`, same convention
 *  as `DOSSIER_IMMUTABLE_STATUSES`. */
export const CLAIM_IMMUTABLE_STATUSES = ["supported", "supported_with_conditions", "restricted", "prohibited", "rejected", "withdrawn", "superseded"] as const satisfies readonly ClaimStatus[];

export const CLAIM_RISK_LEVELS = ["low", "medium", "high", "critical", "unknown"] as const;
export type ClaimRiskLevel = (typeof CLAIM_RISK_LEVELS)[number];

export const productClaimSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  claimCode: z.string().min(1),
  claimText: z.string().min(1),
  /** Lowercased, whitespace-collapsed form of `claimText` — see
   *  `engine/claims.ts`'s `normalizeClaimText`. Computed at write time so
   *  two differently-capitalized entries of the same claim are still
   *  recognizably the same text for conflict-finding, never recomputed
   *  silently later (a claim revision recomputes it explicitly). */
  normalizedClaim: z.string().min(1),
  claimCategory: z.enum(CLAIM_CATEGORIES),
  formulationId: z.string().min(1),
  formulaVersionId: z.string().min(1),
  packagingSkuCode: z.string().optional(),
  jurisdictions: z.array(z.enum(REGULATORY_JURISDICTIONS)).min(1),
  languages: z.array(z.string()).min(1),
  status: z.enum(CLAIM_STATUSES).default("draft"),
  riskLevel: z.enum(CLAIM_RISK_LEVELS).default("unknown"),
  proposedBy: z.string().min(1),
  proposedAt: z.string(),
  updatedBy: z.string().optional(),
  updatedAt: z.string(),
  /** Set on the NEW row when a text/category/scope revision supersedes an
   *  older one — the older row's own `status` becomes `"superseded"`
   *  separately, never deleted. */
  supersedesClaimId: z.string().optional(),
});
export type ProductClaim = z.infer<typeof productClaimSchema>;

// ---------------------------------------------------------------------------
// ClaimEvidenceLink
// ---------------------------------------------------------------------------

export const CLAIM_EVIDENCE_LINK_STATUSES = ["proposed", "accepted", "rejected", "revoked"] as const;
export type ClaimEvidenceLinkStatus = (typeof CLAIM_EVIDENCE_LINK_STATUSES)[number];

export const claimEvidenceLinkSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  claimId: z.string().min(1),
  /** References a Phase 3 `RegulatoryDossierEvidenceItem.id` — claims
   *  reuse dossier evidence, they never duplicate it (spec §15). */
  evidenceItemId: z.string().min(1),
  dossierId: z.string().min(1),
  dossierRevision: z.number().int().positive(),
  linkStatus: z.enum(CLAIM_EVIDENCE_LINK_STATUSES).default("proposed"),
  linkedBy: z.string().min(1),
  linkedAt: z.string(),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().optional(),
  notes: z.string().optional(),
  revokesLinkId: z.string().optional(),
});
export type ClaimEvidenceLink = z.infer<typeof claimEvidenceLinkSchema>;

// ---------------------------------------------------------------------------
// ClaimReview
// ---------------------------------------------------------------------------

export const CLAIM_REVIEW_OUTCOMES = ["supported", "supported_with_conditions", "restricted", "prohibited", "rejected", "changes_requested"] as const;
export type ClaimReviewOutcome = (typeof CLAIM_REVIEW_OUTCOMES)[number];

export const claimReviewSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  claimId: z.string().min(1),
  claimRevision: z.number().int().positive(),
  formulationId: z.string().min(1),
  formulaVersionId: z.string().min(1),
  packagingSkuCode: z.string().optional(),
  jurisdiction: z.enum(REGULATORY_JURISDICTIONS),
  language: z.string().min(1),
  reviewedBy: z.string().min(1),
  reviewerRole: z.string().min(1),
  reviewedAt: z.string(),
  outcome: z.enum(CLAIM_REVIEW_OUTCOMES),
  conditions: z.array(z.string()).default([]),
  notes: z.string().min(1),
  /** Frozen at review time — never recomputed from today's evidence/rules. */
  evidenceSnapshot: z.array(claimEvidenceLinkSchema).default([]),
  ruleSnapshot: z.array(z.object({ ruleId: z.string(), ruleCode: z.string(), version: z.union([z.string(), z.number()]) })).default([]),
  /** Added for consistency with every other review type in this codebase
   *  (see the module doc comment) — not in the spec's own §9.3 field list. */
  revokesReviewId: z.string().optional(),
});
export type ClaimReview = z.infer<typeof claimReviewSchema>;

/** Mirrors `regulatoryDossierReviewRevocationSchema` exactly. */
export const claimReviewRevocationSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  revokesReviewId: z.string().min(1),
  revokedBy: z.string().min(1),
  revokedByRole: z.string().min(1),
  revokedAt: z.string(),
  reason: z.string().min(1),
});
export type ClaimReviewRevocation = z.infer<typeof claimReviewRevocationSchema>;

// ---------------------------------------------------------------------------
// ProductLabel
// ---------------------------------------------------------------------------

export const LABEL_STATUSES = [
  "draft",
  "in_preparation",
  "ready_for_review",
  "under_review",
  "changes_requested",
  "review_complete",
  "approved_for_artwork",
  "approved",
  "superseded",
  "archived",
] as const;
export type LabelStatus = (typeof LABEL_STATUSES)[number];
export const LABEL_IMMUTABLE_STATUSES = ["approved", "superseded", "archived"] as const satisfies readonly LabelStatus[];

export const productLabelSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  labelCode: z.string().min(1),
  formulationId: z.string().min(1),
  formulaVersionId: z.string().min(1),
  packagingSkuCode: z.string().optional(),
  jurisdiction: z.enum(REGULATORY_JURISDICTIONS),
  language: z.string().min(1),
  status: z.enum(LABEL_STATUSES).default("draft"),
  revision: z.number().int().positive().default(1),
  createdBy: z.string().min(1),
  createdAt: z.string(),
  updatedBy: z.string().optional(),
  updatedAt: z.string(),
  supersedesLabelId: z.string().optional(),
});
export type ProductLabel = z.infer<typeof productLabelSchema>;

// ---------------------------------------------------------------------------
// LabelContentBlock
// ---------------------------------------------------------------------------

export const LABEL_CONTENT_BLOCK_TYPES = [
  "product_name",
  "product_description",
  "net_quantity",
  "ingredients",
  "inci",
  "directions",
  "warnings",
  "precautions",
  "first_aid",
  "storage",
  "disposal",
  "manufacturer",
  "responsible_party",
  "country_of_origin",
  "batch_code",
  "manufacture_date",
  "expiry_date",
  "best_before",
  "barcode",
  "registration_number",
  "certification_mark",
  "claims",
  "contact_information",
  "website",
  "recycling",
  "other",
] as const;
export type LabelContentBlockType = (typeof LABEL_CONTENT_BLOCK_TYPES)[number];

export const LABEL_CONTENT_BLOCK_STATUSES = ["present", "missing", "invalid", "draft", "human_review_required"] as const;
export type LabelContentBlockStatus = (typeof LABEL_CONTENT_BLOCK_STATUSES)[number];

export const LABEL_TRANSLATION_STATUSES = ["draft", "machine_suggested", "human_review_required", "reviewed", "rejected", "superseded"] as const;
export type LabelTranslationStatus = (typeof LABEL_TRANSLATION_STATUSES)[number];

export const labelContentBlockSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  labelId: z.string().min(1),
  labelRevision: z.number().int().positive(),
  blockType: z.enum(LABEL_CONTENT_BLOCK_TYPES),
  text: z.string(),
  language: z.string().min(1),
  position: z.number().int().nonnegative().default(0),
  mandatory: z.boolean().default(true),
  /** Where this block's text came from — a human, an imported file, or an
   *  AI-suggested (never auto-approved) translation. */
  source: z.enum(["manual", "imported", "ai_suggested", "formulab_record"]).default("manual"),
  sourceEntityId: z.string().optional(),
  /** A block-level translation status — separate from the block's own
   *  content status below, since a block can be "present" (has text) but
   *  still `machine_suggested`/`human_review_required` as a translation. */
  translationStatus: z.enum(LABEL_TRANSLATION_STATUSES).default("draft"),
  status: z.enum(LABEL_CONTENT_BLOCK_STATUSES).default("draft"),
  createdBy: z.string().min(1),
  createdAt: z.string(),
});
export type LabelContentBlock = z.infer<typeof labelContentBlockSchema>;

// ---------------------------------------------------------------------------
// LabelArtwork
// ---------------------------------------------------------------------------

export const LABEL_ARTWORK_STATUSES = ["draft", "uploaded", "under_review", "changes_requested", "approved", "rejected", "superseded"] as const;
export type LabelArtworkStatus = (typeof LABEL_ARTWORK_STATUSES)[number];

export const labelArtworkSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  labelId: z.string().min(1),
  labelRevision: z.number().int().positive(),
  artworkCode: z.string().min(1),
  attachmentIds: z.array(attachmentReferenceSchema).default([]),
  format: z.string().optional(),
  dimensions: z.string().optional(),
  colorMode: z.string().optional(),
  languageSet: z.array(z.string()).default([]),
  createdBy: z.string().min(1),
  createdAt: z.string(),
  status: z.enum(LABEL_ARTWORK_STATUSES).default("draft"),
  supersedesArtworkId: z.string().optional(),
});
export type LabelArtwork = z.infer<typeof labelArtworkSchema>;

// ---------------------------------------------------------------------------
// LabelReview
// ---------------------------------------------------------------------------

export const LABEL_REVIEW_OUTCOMES = ["approved", "approved_with_conditions", "changes_requested", "rejected", "withdrawn"] as const;
export type LabelReviewOutcome = (typeof LABEL_REVIEW_OUTCOMES)[number];

export const labelReviewSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  labelId: z.string().min(1),
  labelRevision: z.number().int().positive(),
  artworkId: z.string().optional(),
  artworkRevision: z.number().int().positive().optional(),
  formulaVersionId: z.string().min(1),
  packagingSkuCode: z.string().optional(),
  jurisdiction: z.enum(REGULATORY_JURISDICTIONS),
  language: z.string().min(1),
  reviewedBy: z.string().min(1),
  reviewerRole: z.string().min(1),
  reviewedAt: z.string(),
  outcome: z.enum(LABEL_REVIEW_OUTCOMES),
  findingsSnapshot: z.array(z.object({ code: z.string(), severity: z.string(), message: z.string() })).default([]),
  contentSnapshot: z.array(labelContentBlockSchema).default([]),
  claimsSnapshot: z.array(z.string()).default([]),
  notes: z.string().min(1),
  revokesReviewId: z.string().optional(),
});
export type LabelReview = z.infer<typeof labelReviewSchema>;

/** Mirrors `regulatoryDossierReviewRevocationSchema` exactly. */
export const labelReviewRevocationSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  revokesReviewId: z.string().min(1),
  revokedBy: z.string().min(1),
  revokedByRole: z.string().min(1),
  revokedAt: z.string(),
  reason: z.string().min(1),
});
export type LabelReviewRevocation = z.infer<typeof labelReviewRevocationSchema>;

// ---------------------------------------------------------------------------
// Computed views (not persisted) — requirement matrix, readiness, drift.
// ---------------------------------------------------------------------------

export const LABEL_REQUIREMENT_STATES = ["present", "missing", "invalid", "inconsistent", "unverified", "expired", "not_applicable", "human_review_required", "unknown"] as const;
export type LabelRequirementState = (typeof LABEL_REQUIREMENT_STATES)[number];

export const CLAIM_FINDING_TYPES = [
  "unsupported",
  "restricted",
  "prohibited",
  "missing_evidence",
  "expired_evidence",
  "wrong_version_evidence",
  "wrong_jurisdiction_evidence",
  "wrong_packaging_evidence",
  "ambiguous",
  "comparative_claim",
  "medical_claim",
  "high_risk_claim",
  "language_issue",
  "human_review_required",
  "unknown",
] as const;
export type ClaimFindingType = (typeof CLAIM_FINDING_TYPES)[number];

export const claimFindingSchema = z.object({
  claimId: z.string(),
  jurisdiction: z.enum(REGULATORY_JURISDICTIONS),
  language: z.string(),
  ruleId: z.string().optional(),
  ruleVersion: z.union([z.string(), z.number()]).optional(),
  findingType: z.enum(CLAIM_FINDING_TYPES),
  severity: z.enum(["blocking", "warning", "info"]),
  status: z.enum(CLAIM_STATUSES),
  message: z.string(),
  requiredEvidence: z.array(z.string()).default([]),
  conditions: z.array(z.string()).default([]),
  humanReviewRequired: z.boolean().default(false),
});
export type ClaimFinding = z.infer<typeof claimFindingSchema>;

export const CLAIMS_READINESS_STATES = ["not_ready", "partially_ready", "ready_for_review", "under_review", "review_complete", "blocked", "unknown"] as const;
export type ClaimsReadinessState = (typeof CLAIMS_READINESS_STATES)[number];

export const claimsReadinessSchema = z.object({
  totalClaims: z.number().int().nonnegative(),
  supportedClaims: z.number().int().nonnegative(),
  unsupportedClaims: z.number().int().nonnegative(),
  prohibitedClaims: z.number().int().nonnegative(),
  restrictedClaims: z.number().int().nonnegative(),
  highRiskUnreviewedClaims: z.number().int().nonnegative(),
  missingEvidenceCount: z.number().int().nonnegative(),
  humanReviewRequiredCount: z.number().int().nonnegative(),
  overallReadiness: z.enum(CLAIMS_READINESS_STATES),
});
export type ClaimsReadiness = z.infer<typeof claimsReadinessSchema>;

export const labelReadinessSchema = z.object({
  labelId: z.string(),
  labelRevision: z.number().int().positive(),
  totalRequirements: z.number().int().nonnegative(),
  presentRequirements: z.number().int().nonnegative(),
  missingRequirements: z.number().int().nonnegative(),
  invalidRequirements: z.number().int().nonnegative(),
  inconsistentRequirements: z.number().int().nonnegative(),
  humanReviewRequiredCount: z.number().int().nonnegative(),
  artworkStatus: z.enum(LABEL_ARTWORK_STATUSES).optional(),
  languagesCovered: z.array(z.string()).default([]),
  languagesMissing: z.array(z.string()).default([]),
  overallReadiness: z.enum(CLAIMS_READINESS_STATES),
});
export type LabelReadiness = z.infer<typeof labelReadinessSchema>;

/** The Claims & Label picture frozen into an `ApprovalRecord` at the moment
 *  of decision — kept here rather than in `schemas/formulation.ts` for the
 *  same import-cycle-avoidance reason `dossierApprovalSnapshotSchema` lives
 *  in `schemas/dossier.ts` instead of `formulation.ts`. */
export const claimsLabelApprovalSnapshotSchema = z.object({
  claimIds: z.array(z.string()).default([]),
  claimRevisions: z.record(z.string(), z.number()).default({}),
  labelIds: z.array(z.string()).default([]),
  labelRevisions: z.record(z.string(), z.number()).default({}),
  artworkIds: z.array(z.string()).default([]),
  labelReviewIds: z.array(z.string()).default([]),
  claimReviewIds: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  jurisdictions: z.array(z.enum(REGULATORY_JURISDICTIONS)).default([]),
  claimsReadinessState: z.enum(CLAIMS_READINESS_STATES),
  labelReadinessState: z.enum(CLAIMS_READINESS_STATES),
  blockers: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});
export type ClaimsLabelApprovalSnapshot = z.infer<typeof claimsLabelApprovalSnapshotSchema>;
