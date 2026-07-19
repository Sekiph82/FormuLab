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

/** A decimal number as an exact string, e.g. "12.5000". */
export const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "must be a plain decimal string");

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

/** Functional roles a material can play. Constraints are expressed over these. */
export const MATERIAL_FUNCTIONS = [
  "anionic_surfactant",
  "nonionic_surfactant",
  "amphoteric_surfactant",
  "cationic_surfactant",
  "builder",
  "chelating_agent",
  "preservative",
  "fragrance",
  "colorant",
  "enzyme",
  "bleaching_agent",
  "oxygen_donor",
  "abrasive",
  "humectant",
  "emollient",
  "conditioning_agent",
  "rheology_modifier",
  "ph_adjuster",
  "solvent",
  "disinfectant_active",
  "qac_active",
  "chlorhexidine_active",
  "fluoride_active",
  "antioxidant",
  "anti_redeposition_agent",
  "optical_brightener",
  "foam_controller",
  "opacifier",
  "filler",
  "water",
] as const;
export type MaterialFunction = (typeof MATERIAL_FUNCTIONS)[number];

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

/**
 * A signed human decision. Required to reach `pilot_approved` or
 * `production_approved`; see `canTransitionTo` in status.ts, and the mirrored
 * check in the Rust save command.
 */
export const approvalRecordSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  formulationId: z.string().min(1),
  versionId: z.string().min(1),
  status: z.enum(FORMULA_STATUSES),
  /** Who signed. A person's name — never "system", "ai" or an agent id. */
  approvedBy: z.string().min(1),
  approvedByRole: z.string().optional(),
  approvedAt: z.string(),
  /** Why this formula was considered fit for the status granted. */
  justification: z.string().min(1),
  notes: z.string().optional(),
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
});
export type AuditEvent = z.infer<typeof auditEventSchema>;
