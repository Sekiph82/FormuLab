/**
 * The formulation record — the system of record, replacing Markdown.
 *
 * Markdown remains as an export and a human-readable view. It is not
 * application state: nothing decides "the run finished" or "this is a card" by
 * matching a heading or a table. Those decisions read the fields below.
 *
 * Numbers that a factory or an invoice depends on (percentages, quantities,
 * money) are carried as decimal STRINGS, not JS numbers. `0.1 + 0.2` is not
 * 0.3 in binary floating point, and a formula that silently totals 99.9999998%
 * is a defect. Parse with a decimal library at the point of arithmetic.
 */
import { z } from "zod";
import { REGULATORY_JURISDICTIONS, regulatoryClassificationResultSchema, regulatoryFindingSchema, regulatoryRuleVersionSnapshotSchema } from "./regulatory";
import { dossierApprovalSnapshotSchema } from "./dossier";
import { decimalString, MATERIAL_FUNCTIONS, type MaterialFunction } from "./primitives";

export { decimalString, MATERIAL_FUNCTIONS, type MaterialFunction };

/**
 * Where a number came from. This is the difference between "a paper reported
 * 5%" and "the model guessed 5%", and the UI must never render them alike.
 */
export const EVIDENCE_ORIGINS = [
  "reported_exact",
  "reported_range",
  "patent_example",
  "supplier_recommendation",
  "regulatory_limit",
  "industry_reference",
  "model_estimate",
  "chemist_override",
  "laboratory_result",
] as const;
export type EvidenceOrigin = (typeof EVIDENCE_ORIGINS)[number];

/**
 * What a source actually backs up. A paper can establish that an ingredient is
 * used in shampoo without supporting the exact percentage a model proposed;
 * collapsing these into one "citation" is how false precision gets published.
 */
export const SUPPORT_DIMENSIONS = [
  "existence_in_product_class",
  "function",
  "concentration_range",
  "exact_concentration",
  "compatibility",
  "performance_claim",
  "safety_claim",
  "regulatory_status",
] as const;
export type SupportDimension = (typeof SUPPORT_DIMENSIONS)[number];

/**
 * Workflow status. The two approved states are reachable only through an
 * ApprovalRecord created by a human — see `canTransitionTo` in status.ts.
 */
export const FORMULA_STATUSES = [
  "concept",
  "literature_candidate",
  "chemist_review",
  "lab_candidate",
  "stability_testing",
  "pilot_candidate",
  "pilot_approved",
  "production_approved",
  "retired",
  "rejected",
] as const;
export type FormulaStatus = (typeof FORMULA_STATUSES)[number];

/** Statuses no automated process may set. */
export const HUMAN_ONLY_STATUSES: readonly FormulaStatus[] = [
  "pilot_approved",
  "production_approved",
];

export const provenanceSchema = z.object({
  origin: z.enum(EVIDENCE_ORIGINS),
  /** 0..1. Absent when the origin makes confidence meaningless (e.g. an override). */
  confidence: z.number().min(0).max(1).optional(),
  evidenceClaimIds: z.array(z.string()).default([]),
  notes: z.string().optional(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const formulationLineSchema = z.object({
  id: z.string().min(1),
  lineNumber: z.number().int().nonnegative(),
  phase: z.string().default("A"),
  materialId: z.string().optional(),
  /** Stable internal code, mirrored from the material library when linked. */
  materialCode: z.string().optional(),
  /** Free text is allowed: a draft may name a material not yet in the library. */
  displayName: z.string().min(1),
  /** Supplier's commercial name — deliberately separate from the INCI name. */
  tradeName: z.string().optional(),
  inciName: z.string().optional(),
  supplierCode: z.string().optional(),
  functions: z.array(z.enum(MATERIAL_FUNCTIONS)).default([]),
  /** As-supplied percentage of the total formula. */
  percent: decimalString,
  /**
   * True when this line absorbs the remainder ("water q.s. to 100"). Its
   * percent is computed, not authored.
   *
   * This is an explicit property, never inferred from the material name: a
   * formula can contain water that is NOT the q.s. line, and a q.s. line that
   * is not water (a solvent base, a slurry carrier).
   */
  isQsToHundred: z.boolean().default(false),
  /** Active content of the raw material, e.g. "70.00" for a 70% active SLES. */
  activeMatterPercent: decimalString.optional(),
  /** Highest percentage this material may technically be used at, when known. */
  technicalMaxPercent: decimalString.optional(),
  /** Price used for this line's cost, snapshotted so history cannot drift. */
  unitPrice: decimalString.optional(),
  currency: z.string().optional(),
  /** Unit the price is quoted per, e.g. "kg" or "L". */
  priceUnit: z.string().optional(),
  provenance: provenanceSchema,
  notes: z.string().optional(),
});
export type FormulationLine = z.infer<typeof formulationLineSchema>;

/**
 * A snapshot of what the formula totalled when the version was saved.
 *
 * Stored, not recomputed on read: recomputation would silently "fix" a version
 * whose numbers were wrong at the time, which is exactly the history a batch
 * investigation needs to see.
 */
export const formulaTotalsSnapshotSchema = z.object({
  authoredPercent: decimalString,
  qsRemainder: decimalString,
  totalPercent: decimalString,
  totalActiveMatterPercent: decimalString,
  unknownActivePercent: decimalString,
});
export type FormulaTotalsSnapshot = z.infer<typeof formulaTotalsSnapshotSchema>;

export const validationSnapshotSchema = z.object({
  checkedAt: z.string(),
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  blockingCount: z.number().int().nonnegative().default(0),
  codes: z.array(z.string()).default([]),
});
export type ValidationSnapshot = z.infer<typeof validationSnapshotSchema>;

export const formulationVersionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  formulationId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  /** Display label, e.g. "0.3" or "1.0". Never a storage id. */
  versionLabel: z.string().optional(),
  parentVersionId: z.string().optional(),
  branchName: z.string().optional(),
  status: z.enum(FORMULA_STATUSES).default("concept"),
  author: z.string().default("local"),
  createdAt: z.string(),
  changeReason: z.string().optional(),
  changeNotes: z.string().optional(),
  lines: z.array(formulationLineSchema),
  /** Batch the percentages were authored against; scaling is derived. */
  basisBatchKg: decimalString.default("100"),
  /** Totals as they stood at save time. Never recomputed on read. */
  totalsSnapshot: formulaTotalsSnapshotSchema.optional(),
  validationSnapshot: validationSnapshotSchema.optional(),
  /** Project intent captured at save time, so a later brief edit cannot rewrite it. */
  targetMarketsSnapshot: z.array(z.string()).optional(),
  targetClaimsSnapshot: z.array(z.string()).optional(),
  targetSkuCodesSnapshot: z.array(z.string()).optional(),
  /** Pipeline runs that contributed evidence to this version. */
  sourceRunIds: z.array(z.string()).default([]),
  /** Snapshot ids — findings are stored separately and referenced immutably. */
  costSnapshotId: z.string().optional(),
  evidenceSnapshotId: z.string().optional(),
  regulatoryFindingIds: z.array(z.string()).default([]),
  compatibilityFindingIds: z.array(z.string()).default([]),
  safetyFindingIds: z.array(z.string()).default([]),
  approvalRecordIds: z.array(z.string()).default([]),
  /** Set when this version's draft was produced by applying an Advanced
   *  Optimizer run's result (`OptimizationRun.code`) or a substitution run's
   *  selected candidate (`SubstitutionRun.code`) — see
   *  `engine/approvalReadiness.ts` and docs/APPROVAL_READINESS.md. Optional
   *  and additive: a version with neither field was authored directly, which
   *  remains the common case. */
  appliedOptimizationRunCode: z.string().optional(),
  appliedSubstitutionRunCode: z.string().optional(),
  /** Markdown rendering, for humans and export only. Never parsed back. */
  markdown: z.string().optional(),
});
export type FormulationVersion = z.infer<typeof formulationVersionSchema>;

/** Markets the platform models. Regulatory content is NOT implied by either. */
export const TARGET_MARKETS = ["KE", "EAC"] as const;
export type TargetMarket = (typeof TARGET_MARKETS)[number];

export const formulationSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  productFamilyCode: z.string().min(1),
  /** SKUs this formulation is intended to fill; packaging cost lives there. */
  targetSkuCodes: z.array(z.string()).default([]),
  targetMarkets: z.array(z.string()).default(["KE"]),
  /** Free-text product brief the project was started from. */
  brief: z.string().optional(),
  /** Claims the product is meant to support. Aspirational until tested. */
  targetClaims: z.array(z.string()).default([]),
  /** Default batch size the builder scales to, in kg. */
  targetBatchKg: decimalString.default("100"),
  createdAt: z.string(),
  updatedAt: z.string(),
  currentVersionId: z.string().optional(),
  archived: z.boolean().default(false),
});
export type Formulation = z.infer<typeof formulationSchema>;

/**
 * The mutable working copy.
 *
 * Exactly one draft exists per formulation. Autosave writes here and only here,
 * so a morning of editing produces one draft rather than four hundred versions
 * that nobody can navigate. Promoting a draft to a version is a deliberate act
 * that requires a change reason.
 */
export const formulationDraftSchema = z.object({
  schemaVersion: z.literal("1.0"),
  formulationId: z.string().min(1),
  /** The saved version this draft was derived from, if any. */
  baseVersionId: z.string().optional(),
  lines: z.array(formulationLineSchema).default([]),
  basisBatchKg: decimalString.default("100"),
  updatedAt: z.string(),
  /** True once the draft diverges from its base version. */
  dirty: z.boolean().default(false),
});
export type FormulationDraft = z.infer<typeof formulationDraftSchema>;

/** The outcome of one approval attempt. `approved` is the only decision that
 *  ever moves a version's effective status — see `engine/lifecycle.ts`'s
 *  `attemptApprovalTransition`. The other three are recorded for audit but
 *  never change status: a `blocked` attempt is exactly the case where
 *  readiness or role authority refused the transition. */
export const APPROVAL_DECISIONS = ["approved", "rejected", "cancelled", "blocked"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

const approvalBlockerSnapshotSchema = z.object({
  id: z.string(),
  source: z.string(),
  message: z.string(),
  lineId: z.string().optional(),
  code: z.string().optional(),
});

/** A frozen copy of `ApprovalReadiness` (`engine/approvalReadiness.ts`) as it
 *  stood the moment a decision was made — never recomputed on read, same
 *  convention as `totalsSnapshot`/`validationSnapshot` above. A later change
 *  to a trial, a study or a policy must not retroactively alter what this
 *  historical record says was true at decision time. */
export const approvalReadinessSnapshotSchema = z.object({
  ready: z.boolean(),
  blockers: z.array(approvalBlockerSnapshotSchema),
  warnings: z.array(approvalBlockerSnapshotSchema),
});
export type ApprovalReadinessSnapshot = z.infer<typeof approvalReadinessSnapshotSchema>;

export const laboratoryReadinessSnapshotSchema = z.object({
  hasCompletedTrial: z.boolean(),
  allRequiredTestsCompleted: z.boolean(),
  allCriticalTestsPassed: z.boolean(),
  hasUnresolvedCriticalDeviation: z.boolean(),
  hasUnresolvedCriticalCorrectiveAction: z.boolean(),
});
export type LaboratoryReadinessSnapshot = z.infer<typeof laboratoryReadinessSnapshotSchema>;

export const stabilityReadinessSnapshotSchema = z.object({
  hasActiveOrCompletedStudy: z.boolean(),
  initialTestsPassed: z.boolean(),
  completedTimePointCount: z.number().int().nonnegative(),
  hasUnresolvedCriticalFailure: z.boolean(),
  packagingCompatibilityPassed: z.boolean(),
  /** The full five-state read (spec: "unknown must not silently equal
   *  passed") — `packagingCompatibilityPassed` above is the boolean that
   *  actually feeds `assessApprovalReadiness`; this is kept alongside it so
   *  a UI can show why, not just pass/fail. */
  packagingCompatibilityStatus: z.enum(["passed", "failed", "incomplete", "not_required", "unknown"]),
});
export type StabilityReadinessSnapshot = z.infer<typeof stabilityReadinessSnapshotSchema>;

/** Mirrors `RegulatoryReviewStatus` (`engine/regulatoryReviews.ts`) as a
 *  plain string enum here, since a schema module must not import from the
 *  engine layer — kept in sync by hand; the engine's own union is the
 *  source of truth for behavior, this is only for snapshot storage. */
const regulatoryReviewCurrentnessValues = [
  "current",
  "stale_formula_version",
  "stale_rule_version",
  "wrong_jurisdiction",
  "wrong_packaging_sku",
  "revoked",
  "superseded",
  "unknown",
] as const;

/** One resolved jurisdiction's regulatory picture at approval time — frozen,
 *  never recomputed. A later rule edit, a later review, or a later
 *  confirmation revocation must not retroactively alter what this
 *  historical record says was true at decision time. */
export const regulatoryJurisdictionSnapshotSchema = z.object({
  jurisdiction: z.enum(REGULATORY_JURISDICTIONS),
  classificationSnapshot: regulatoryClassificationResultSchema.optional(),
  findingSnapshot: z.array(regulatoryFindingSchema),
  ruleVersionSnapshot: z.array(regulatoryRuleVersionSnapshotSchema),
  /** Active (non-revoked) evidence confirmation ids that satisfied this
   *  jurisdiction's document/evidence/claims gates — ids, not full
   *  records, since the confirmations themselves are already immutable
   *  append-only rows; this just freezes which ones counted. */
  evidenceConfirmationIds: z.array(z.string()),
  /** The applicable review's id, if any was found current or reused via
   *  equivalence at decision time — never a stale/wrong-scope review's id. */
  humanReviewId: z.string().optional(),
  humanReviewCurrentness: z.enum(regulatoryReviewCurrentnessValues),
  ready: z.boolean(),
  blockers: z.array(approvalBlockerSnapshotSchema),
  warnings: z.array(approvalBlockerSnapshotSchema),
});
export type RegulatoryJurisdictionSnapshot = z.infer<typeof regulatoryJurisdictionSnapshotSchema>;

/** The complete multi-jurisdiction regulatory readiness picture frozen at
 *  the moment of an approval decision — spec §3.9. Optional because a
 *  record written before this phase, or for a formulation with no
 *  regulatory gates configured, has none of it. */
export const regulatoryApprovalSnapshotSchema = z.object({
  ready: z.boolean(),
  jurisdictionsEvaluated: z.array(z.enum(REGULATORY_JURISDICTIONS)),
  perJurisdiction: z.array(regulatoryJurisdictionSnapshotSchema),
  packagingSkuCode: z.string().optional(),
});
export type RegulatoryApprovalSnapshot = z.infer<typeof regulatoryApprovalSnapshotSchema>;

/**
 * A signed human decision. An `approved` record is required to reach
 * `pilot_approved` or `production_approved`; see `canTransitionTo` in
 * status.ts, and the mirrored check in the Rust save command. Append-only —
 * a decision is never edited after the fact; a changed mind creates a new
 * record.
 */
export const approvalRecordSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  formulationId: z.string().min(1),
  versionId: z.string().min(1),
  /** The status this record concerns — the one requested (and, for an
   *  `approved` decision, granted). Kept as the pre-existing field name for
   *  backward compatibility with records written before `decision` existed. */
  status: z.enum(FORMULA_STATUSES),
  decision: z.enum(APPROVAL_DECISIONS).default("approved"),
  previousStatus: z.enum(FORMULA_STATUSES).optional(),
  requestedStatus: z.enum(FORMULA_STATUSES).optional(),
  /** Who signed. A person's name — never "system", "ai" or an agent id. */
  approvedBy: z.string().min(1),
  approvedByRole: z.string().optional(),
  approvedAt: z.string(),
  /** Distinct from `approvedBy`'s free-text name: the actor's stable user id
   *  and role, so a record can be traced to an account, not just a label. */
  reviewerUserId: z.string().optional(),
  reviewerRole: z.string().optional(),
  /** Why this formula was considered fit for the status granted (or, for a
   *  `rejected`/`cancelled`/`blocked` decision, why it was not). */
  justification: z.string().min(1),
  notes: z.string().optional(),

  /** Everything below is the readiness picture at the moment of decision —
   *  frozen, never recomputed. Optional because a record written before
   *  this phase has none of it. */
  readinessSnapshot: approvalReadinessSnapshotSchema.optional(),
  laboratoryReadinessSnapshot: laboratoryReadinessSnapshotSchema.optional(),
  stabilityReadinessSnapshot: stabilityReadinessSnapshotSchema.optional(),
  regulatorySnapshot: regulatoryApprovalSnapshotSchema.optional(),
  /** The complete dossier-readiness picture frozen at the moment of
   *  decision (Phase 3 spec §10) — dossier ids/revisions, requirement
   *  counts, missing/expired evidence, review/submission ids, blockers,
   *  warnings, readiness state. A later dossier change must never
   *  rewrite this historical record. Optional because a record written
   *  before Phase 3, or for a formulation with no dossier gates
   *  configured, has none of it. */
  dossierSnapshot: dossierApprovalSnapshotSchema.optional(),
  validationSnapshot: validationSnapshotSchema.optional(),
  appliedOptimizationRunCode: z.string().optional(),
  appliedSubstitutionRunCode: z.string().optional(),
  costSnapshotId: z.string().optional(),
  /** When the approval attempt/dialog was opened — distinct from
   *  `approvedAt`, which is when the decision was actually made. */
  createdAt: z.string().optional(),
});
export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;

/** Anything that changed a formulation, kept append-only for audit. */
export const auditEventSchema = z.object({
  id: z.string().min(1),
  formulationId: z.string().min(1),
  versionId: z.string().optional(),
  at: z.string(),
  actor: z.string(),
  actorKind: z.enum(["human", "ai", "system", "import"]).default("human"),
  action: z.string().min(1),
  detail: z.string().optional(),
  /** Additive, structured payload for events whose facts don't fit one
   *  display string — e.g. `attachment.replaced`'s old/new attachment id,
   *  parent record type/id, and old/new checksum. Absent on every event
   *  recorded before this field existed. */
  metadata: z.record(z.string(), z.string()).optional(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;
