/**
 * Phase 3 — Regulatory Dossier and Evidence Matrix (spec §"Regulatory
 * Dossier and Evidence Matrix"). Transforms the Phase 2 closure's minimal
 * evidence-confirmation layer into a real, persisted, version/packaging-
 * SKU/jurisdiction-specific dossier: which requirements apply, which
 * evidence satisfies them, what's missing/expired/rejected/revoked/stale,
 * who reviewed it, and whether the dossier is ready for review or
 * approval. This remains compliance-assistance, never a claim of legal
 * compliance — see docs/REGULATORY_DOSSIERS.md.
 *
 * Eight persistence collections (`apps/desktop/src-tauri/src/masterdata.rs`),
 * a deliberately smaller set than the ten the spec suggested:
 * - `regulatory_dossiers` (mutable header, like `Formulation`)
 * - `regulatory_dossier_requirements` (append-only, frozen per revision)
 * - `regulatory_evidence_items` (mutable current-state row; a real file
 *   replacement creates a NEW row via `supersedesEvidenceId` — no separate
 *   "evidence revisions" collection, the chain of self-referential rows
 *   over the same mutable-row-per-lifecycle-change pattern
 *   `RegulatoryRule` already uses is enough, and duplicating it would be
 *   exactly the "unnecessary duplication" the spec warned against)
 * - `regulatory_requirement_evidence_links` (append-only; a revocation is
 *   a new row referencing `revokesLinkId`, same overlay-computed-active
 *   convention as Phase 2's `RegulatoryEvidenceConfirmation`)
 * - `regulatory_dossier_reviews` / `regulatory_dossier_review_revocations`
 *   (append-only, mirrors `RegulatoryReview`/`RegulatoryReviewRevocation`
 *   exactly)
 * - `regulatory_dossier_submissions` (mutable tracking row — an internal
 *   log of what was submitted and when, not a compliance-critical
 *   evidence record; the audit log already covers its history, so no
 *   "one row per status change" collection was added for it)
 * - `regulatory_dossier_manual_requirement_actions` (append-only —
 *   manual-add and manual-exclusion actions, both human-authorized)
 */
import { z } from "zod";
import { REGULATORY_JURISDICTIONS } from "./regulatory";
import { attachmentReferenceSchema } from "./testDefinitions";

// ---------------------------------------------------------------------------
// Dossier — version/packaging-SKU/jurisdiction-bound header.
// ---------------------------------------------------------------------------

export const DOSSIER_STATUSES = [
  "draft",
  "in_preparation",
  "ready_for_review",
  "under_review",
  "changes_requested",
  "review_complete",
  "approved_for_submission",
  "submitted",
  "withdrawn",
  "superseded",
  "archived",
] as const;
export type DossierStatus = (typeof DOSSIER_STATUSES)[number];

/** Once a dossier reaches one of these, it is immutable — no further
 *  requirement regeneration, no in-place header edits, only a new
 *  revision (a new `RegulatoryDossier` row with `supersedesDossierId`
 *  pointing back) or an append-only review/submission record referencing
 *  it. See `engine/regulatoryDossier.ts`'s `isDossierImmutable`. */
export const DOSSIER_IMMUTABLE_STATUSES = ["submitted", "superseded", "archived"] as const satisfies readonly DossierStatus[];

export const regulatoryDossierSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  dossierCode: z.string().min(1),
  title: z.string().min(1),

  formulationId: z.string().min(1),
  /** Always a real, saved `FormulationVersion.id` — never a working draft.
   *  See `engine/regulatoryDossier.ts`'s `createDossier`. */
  formulaVersionId: z.string().min(1),
  packagingSkuCode: z.string().optional(),
  jurisdictions: z.array(z.enum(REGULATORY_JURISDICTIONS)).min(1),
  productFamilyCode: z.string().min(1),
  targetMarkets: z.array(z.string()).default([]),

  status: z.enum(DOSSIER_STATUSES).default("draft"),
  /** Bumped every time the requirement snapshot is regenerated after a
   *  formal review — `DossierRequirement`/`DossierReview` rows carry this
   *  same number so a review is always bound to the exact revision it
   *  assessed. */
  revision: z.number().int().positive().default(1),

  createdBy: z.string().min(1),
  createdAt: z.string(),
  updatedBy: z.string().optional(),
  updatedAt: z.string(),
  submittedBy: z.string().optional(),
  submittedAt: z.string().optional(),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().optional(),
  approvedBy: z.string().optional(),
  approvedAt: z.string().optional(),

  /** Set when this dossier is a new revision superseding an older one —
   *  the older row's own `status` is separately set to `"superseded"`,
   *  never deleted. */
  supersedesDossierId: z.string().optional(),
});
export type RegulatoryDossier = z.infer<typeof regulatoryDossierSchema>;

// ---------------------------------------------------------------------------
// Requirements — frozen per dossier revision.
// ---------------------------------------------------------------------------

export const DOSSIER_REQUIREMENT_TYPES = [
  "document",
  "formula_data",
  "ingredient_data",
  "supplier_data",
  "laboratory_evidence",
  "stability_evidence",
  "packaging_evidence",
  "claim_evidence",
  "artwork",
  "label_content",
  "registration",
  "certificate",
  "external_review",
  "market_specific",
  "other",
] as const;
export type DossierRequirementType = (typeof DOSSIER_REQUIREMENT_TYPES)[number];

export const DOSSIER_APPLICABILITY_STATUSES = ["applicable", "not_applicable", "conditionally_applicable", "human_review_required", "unknown"] as const;
export type DossierApplicabilityStatus = (typeof DOSSIER_APPLICABILITY_STATUSES)[number];

/** Live-computed per-requirement satisfaction — never stored on the
 *  requirement row itself (which is frozen); see
 *  `evaluateRequirementSatisfaction` in `engine/regulatoryDossier.ts`. */
export const DOSSIER_REQUIREMENT_SATISFACTION_STATUSES = [
  "not_started",
  "missing",
  "partially_satisfied",
  "satisfied_unverified",
  "satisfied_verified",
  "rejected",
  "expired",
  "revoked",
  "not_applicable",
  "blocked",
  "unknown",
] as const;
export type DossierRequirementSatisfactionStatus = (typeof DOSSIER_REQUIREMENT_SATISFACTION_STATUSES)[number];

export const DOSSIER_EVIDENCE_TYPES = [
  "sds",
  "coa",
  "ingredient_declaration",
  "supplier_declaration",
  "technical_data_sheet",
  "laboratory_report",
  "stability_report",
  "packaging_compatibility_report",
  "microbiological_report",
  "challenge_test_report",
  "claim_substantiation",
  "artwork",
  "label_copy",
  "regulatory_certificate",
  "registration_certificate",
  "external_legal_opinion",
  "manufacturing_statement",
  "process_description",
  "batch_record",
  "specification",
  "other",
] as const;
export type DossierEvidenceType = (typeof DOSSIER_EVIDENCE_TYPES)[number];

export const regulatoryDossierRequirementSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  dossierId: z.string().min(1),
  /** The exact dossier `revision` this requirement snapshot belongs to —
   *  never mutated after being written; a later revision gets new rows. */
  dossierRevision: z.number().int().positive(),
  jurisdiction: z.enum(REGULATORY_JURISDICTIONS),
  requirementCode: z.string().min(1),
  requirementType: z.enum(DOSSIER_REQUIREMENT_TYPES),
  title: z.string().min(1),
  description: z.string().optional(),

  /** Absent for a human-added manual requirement — see
   *  `regulatoryDossierManualRequirementActionSchema`. */
  sourceRuleId: z.string().optional(),
  sourceRuleVersion: z.number().int().positive().optional(),
  sourceAuthority: z.string().optional(),
  sourceReference: z.string().optional(),
  /** True for a requirement a human added directly rather than one the
   *  active rule set generated — always shown distinctly in the UI. */
  isManual: z.boolean().default(false),

  mandatory: z.boolean().default(true),
  critical: z.boolean().default(false),
  applicabilityStatus: z.enum(DOSSIER_APPLICABILITY_STATUSES),
  applicabilityReason: z.string().min(1),

  evidenceRequirement: z.boolean().default(true),
  documentTypesAccepted: z.array(z.enum(DOSSIER_EVIDENCE_TYPES)).default([]),
  minimumEvidenceCount: z.number().int().nonnegative().default(1),
  /** Free-text note on how long accepted evidence stays valid for this
   *  requirement (e.g. "COA valid 12 months") — advisory only; actual
   *  expiry is tracked per evidence item via `expiresAt`. */
  expiryPolicy: z.string().optional(),

  /** `"active"` unless a human with an authorized role excluded it — see
   *  `regulatoryDossierManualRequirementActionSchema`'s `"exclude"`
   *  action, which is the only way this ever becomes `"excluded"`. */
  status: z.enum(["active", "excluded"]).default("active"),

  createdAt: z.string(),
});
export type RegulatoryDossierRequirement = z.infer<typeof regulatoryDossierRequirementSchema>;

// ---------------------------------------------------------------------------
// Evidence items.
// ---------------------------------------------------------------------------

export const DOSSIER_EVIDENCE_LIFECYCLE_STATUSES = [
  "draft",
  "present_unverified",
  "under_review",
  "verified",
  "rejected",
  "expired",
  "revoked",
  "superseded",
  "not_applicable",
] as const;
export type DossierEvidenceLifecycleStatus = (typeof DOSSIER_EVIDENCE_LIFECYCLE_STATUSES)[number];

/** Where an evidence item's content actually came from — an explicit,
 *  auditable provenance, never silently assumed. `"formulab_record"`
 *  covers automatic-discovery-then-accepted evidence from an existing
 *  trial/study/supplier/etc. record (spec §7); `sourceEntityId` then
 *  names that record. */
export const DOSSIER_EVIDENCE_SOURCE_TYPES = ["uploaded", "formulab_record", "manual_entry"] as const;
export type DossierEvidenceSourceType = (typeof DOSSIER_EVIDENCE_SOURCE_TYPES)[number];

export const regulatoryDossierEvidenceItemSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  dossierId: z.string().min(1),
  formulationId: z.string().min(1),
  formulaVersionId: z.string().min(1),
  packagingSkuCode: z.string().optional(),
  jurisdictions: z.array(z.enum(REGULATORY_JURISDICTIONS)).min(1),

  evidenceType: z.enum(DOSSIER_EVIDENCE_TYPES),
  documentType: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),

  status: z.enum(DOSSIER_EVIDENCE_LIFECYCLE_STATUSES).default("draft"),
  sourceType: z.enum(DOSSIER_EVIDENCE_SOURCE_TYPES).default("uploaded"),
  /** Set when `sourceType === "formulab_record"` — the id of the trial/
   *  study/supplier/etc. record this evidence references. The source
   *  record itself is never rewritten; this is a reference only. */
  sourceEntityId: z.string().optional(),

  attachmentIds: z.array(attachmentReferenceSchema).default([]),
  documentNumber: z.string().optional(),
  issuer: z.string().optional(),
  issuedAt: z.string().optional(),
  effectiveAt: z.string().optional(),
  expiresAt: z.string().optional(),
  receivedAt: z.string().optional(),
  language: z.string().optional(),
  confidentiality: z.enum(["normal", "confidential"]).default("normal"),

  createdBy: z.string().min(1),
  createdAt: z.string(),
  verifiedBy: z.string().optional(),
  verifiedByRole: z.string().optional(),
  verifiedAt: z.string().optional(),
  verificationNotes: z.string().optional(),
  rejectedBy: z.string().optional(),
  rejectedAt: z.string().optional(),
  rejectionReason: z.string().optional(),
  revokedBy: z.string().optional(),
  revokedAt: z.string().optional(),
  revocationReason: z.string().optional(),

  /** Set when this item was uploaded to replace an earlier one — the
   *  earlier row's own `status` becomes `"superseded"` but is never
   *  deleted or edited; `resolveEvidenceRevisionChain` walks this. */
  supersedesEvidenceId: z.string().optional(),

  updatedAt: z.string(),
});
export type RegulatoryDossierEvidenceItem = z.infer<typeof regulatoryDossierEvidenceItemSchema>;

// ---------------------------------------------------------------------------
// Requirement <-> evidence links (explicit many-to-many, human-accepted).
// ---------------------------------------------------------------------------

export const DOSSIER_LINK_STATUSES = ["proposed", "accepted", "rejected", "revoked"] as const;
export type DossierLinkStatus = (typeof DOSSIER_LINK_STATUSES)[number];

export const regulatoryRequirementEvidenceLinkSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  dossierId: z.string().min(1),
  requirementId: z.string().min(1),
  evidenceItemId: z.string().min(1),
  linkStatus: z.enum(DOSSIER_LINK_STATUSES).default("proposed"),
  /** `"system"` for an automatic discovery suggestion (spec §7) — never
   *  itself sufficient to satisfy a requirement; only an `"accepted"`
   *  link, linked by a real human, counts. See
   *  `evaluateEvidenceEligibility`. */
  linkedBy: z.string().min(1),
  linkedAt: z.string(),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().optional(),
  notes: z.string().optional(),
  /** Set when this row itself is a revocation of an earlier accepted
   *  link — the earlier row is never edited, this is a new append-only
   *  row pointing back at it, same convention as
   *  `RegulatoryEvidenceConfirmationRevocation`. */
  revokesLinkId: z.string().optional(),
});
export type RegulatoryRequirementEvidenceLink = z.infer<typeof regulatoryRequirementEvidenceLinkSchema>;

// ---------------------------------------------------------------------------
// Dossier reviews — append-only, bound to an exact dossier revision.
// ---------------------------------------------------------------------------

export const DOSSIER_REVIEW_OUTCOMES = ["approved", "approved_with_conditions", "changes_requested", "rejected", "withdrawn"] as const;
export type DossierReviewOutcome = (typeof DOSSIER_REVIEW_OUTCOMES)[number];

export const regulatoryDossierReviewSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  dossierId: z.string().min(1),
  dossierRevision: z.number().int().positive(),
  reviewedBy: z.string().min(1),
  reviewerRole: z.string().min(1),
  reviewedAt: z.string(),
  outcome: z.enum(DOSSIER_REVIEW_OUTCOMES),
  notes: z.string().min(1),
  /** Frozen at review time — never recomputed on read, same convention
   *  as `RegulatoryReview.classificationSnapshot`/`findingSnapshot`. */
  requirementSnapshot: z.array(regulatoryDossierRequirementSchema),
  evidenceSnapshot: z.array(regulatoryDossierEvidenceItemSchema),
  blockingIssues: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});
export type RegulatoryDossierReview = z.infer<typeof regulatoryDossierReviewSchema>;

export const regulatoryDossierReviewRevocationSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  revokesReviewId: z.string().min(1),
  revokedBy: z.string().min(1),
  revokedByRole: z.string().min(1),
  revokedAt: z.string(),
  reason: z.string().min(1),
});
export type RegulatoryDossierReviewRevocation = z.infer<typeof regulatoryDossierReviewRevocationSchema>;

// ---------------------------------------------------------------------------
// Submissions — an internal tracking log only. Never a real integration
// with a government/authority portal.
// ---------------------------------------------------------------------------

export const DOSSIER_SUBMISSION_STATUSES = [
  "prepared",
  "submitted",
  "acknowledged",
  "under_authority_review",
  "additional_information_requested",
  "accepted",
  "rejected",
  "withdrawn",
  "unknown",
] as const;
export type DossierSubmissionStatus = (typeof DOSSIER_SUBMISSION_STATUSES)[number];

export const regulatoryDossierSubmissionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  dossierId: z.string().min(1),
  dossierRevision: z.number().int().positive(),
  jurisdiction: z.enum(REGULATORY_JURISDICTIONS),
  submissionReference: z.string().optional(),
  submittedBy: z.string().min(1),
  submittedAt: z.string(),
  submissionChannel: z.string().optional(),
  status: z.enum(DOSSIER_SUBMISSION_STATUSES).default("prepared"),
  notes: z.string().optional(),
  attachmentIds: z.array(attachmentReferenceSchema).default([]),
  responseReceivedAt: z.string().optional(),
  responseStatus: z.string().optional(),
  responseNotes: z.string().optional(),
  updatedBy: z.string().optional(),
  updatedAt: z.string(),
});
export type RegulatoryDossierSubmission = z.infer<typeof regulatoryDossierSubmissionSchema>;

// ---------------------------------------------------------------------------
// Manual requirement actions — append-only, human-authorized only.
// ---------------------------------------------------------------------------

export const DOSSIER_MANUAL_REQUIREMENT_ACTIONS = ["add", "exclude"] as const;
export type DossierManualRequirementAction = (typeof DOSSIER_MANUAL_REQUIREMENT_ACTIONS)[number];

export const regulatoryDossierManualRequirementActionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  dossierId: z.string().min(1),
  dossierRevision: z.number().int().positive(),
  action: z.enum(DOSSIER_MANUAL_REQUIREMENT_ACTIONS),
  requirementId: z.string().min(1),
  performedBy: z.string().min(1),
  performedByRole: z.string().min(1),
  performedAt: z.string(),
  /** Mandatory for `"exclude"` — spec: "Manual exclusion of an applicable
   *  mandatory requirement must require an authorized reviewer and an
   *  append-only exclusion record." */
  justification: z.string().min(1),
});
export type RegulatoryDossierManualRequirementAction = z.infer<typeof regulatoryDossierManualRequirementActionSchema>;

// ---------------------------------------------------------------------------
// Readiness — computed, never stored as a mutable flag (except as a frozen
// snapshot at approval time — see schemas/formulation.ts's ApprovalRecord).
// ---------------------------------------------------------------------------

export const DOSSIER_READINESS_STATES = ["not_ready", "partially_ready", "ready_for_review", "under_review", "review_complete", "blocked", "unknown"] as const;
export type DossierReadinessState = (typeof DOSSIER_READINESS_STATES)[number];

export const dossierRequirementRowSchema = z.object({
  requirement: regulatoryDossierRequirementSchema,
  satisfaction: z.enum(DOSSIER_REQUIREMENT_SATISFACTION_STATUSES),
  linkedEvidence: z.array(regulatoryDossierEvidenceItemSchema),
  blockingReason: z.string().optional(),
  lastActivityAt: z.string().optional(),
});
export type DossierRequirementRow = z.infer<typeof dossierRequirementRowSchema>;

export const dossierReadinessSchema = z.object({
  dossierId: z.string().min(1),
  dossierRevision: z.number().int().positive(),
  totalRequirements: z.number().int().nonnegative(),
  applicableRequirements: z.number().int().nonnegative(),
  mandatoryRequirements: z.number().int().nonnegative(),
  satisfiedMandatoryRequirements: z.number().int().nonnegative(),
  missingMandatoryRequirements: z.number().int().nonnegative(),
  expiredEvidenceCount: z.number().int().nonnegative(),
  rejectedEvidenceCount: z.number().int().nonnegative(),
  unverifiedEvidenceCount: z.number().int().nonnegative(),
  staleRequirementCount: z.number().int().nonnegative(),
  humanReviewRequiredCount: z.number().int().nonnegative(),
  blockingRequirementCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()).default([]),
  overallReadiness: z.enum(DOSSIER_READINESS_STATES),
});
export type DossierReadiness = z.infer<typeof dossierReadinessSchema>;

/** Requirement drift — the frozen dossier requirement set (at its current
 *  revision) compared against what the *currently active* rule set would
 *  generate today. Display-only; never mutates the historical dossier. */
export const dossierRequirementDriftSchema = z.object({
  newRequirementCodes: z.array(z.string()).default([]),
  removedRequirementCodes: z.array(z.string()).default([]),
  changedRuleVersionCodes: z.array(z.string()).default([]),
  changedMandatoryStatusCodes: z.array(z.string()).default([]),
  changedAcceptedEvidenceTypesCodes: z.array(z.string()).default([]),
  changedJurisdictionApplicabilityCodes: z.array(z.string()).default([]),
});
export type DossierRequirementDrift = z.infer<typeof dossierRequirementDriftSchema>;

/** The complete dossier-readiness picture frozen into an `ApprovalRecord`
 *  at the moment of decision — see `schemas/formulation.ts`. Kept here so
 *  `dossier.ts` doesn't need to import `formulation.ts` (would recreate
 *  the exact schema-import-cycle risk fixed earlier this session). */
export const dossierApprovalSnapshotSchema = z.object({
  dossierIds: z.array(z.string()),
  dossierRevisionIds: z.array(z.string()),
  jurisdictions: z.array(z.enum(REGULATORY_JURISDICTIONS)),
  requirementCounts: z.record(z.string(), z.number()),
  missingEvidenceCount: z.number().int().nonnegative(),
  expiredEvidenceCount: z.number().int().nonnegative(),
  reviewIds: z.array(z.string()).default([]),
  submissionIds: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  readinessState: z.enum(DOSSIER_READINESS_STATES),
});
export type DossierApprovalSnapshot = z.infer<typeof dossierApprovalSnapshotSchema>;
