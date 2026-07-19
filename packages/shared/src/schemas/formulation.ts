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
  /** Free text is allowed: a draft may name a material not yet in the library. */
  displayName: z.string().min(1),
  inciName: z.string().optional(),
  functions: z.array(z.enum(MATERIAL_FUNCTIONS)).default([]),
  /** As-supplied percentage of the total formula. */
  percent: decimalString,
  /**
   * True when this line absorbs the remainder ("water q.s. to 100"). Its
   * percent is computed, not authored.
   */
  isQsToHundred: z.boolean().default(false),
  /** Active content of the raw material, e.g. "70.00" for a 70% active SLES. */
  activeMatterPercent: decimalString.optional(),
  provenance: provenanceSchema,
  notes: z.string().optional(),
});
export type FormulationLine = z.infer<typeof formulationLineSchema>;

export const formulationVersionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  formulationId: z.string().min(1),
  versionNumber: z.number().int().positive(),
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

export const formulationSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  productFamilyCode: z.string().min(1),
  /** SKUs this formulation is intended to fill; packaging cost lives there. */
  targetSkuCodes: z.array(z.string()).default([]),
  targetMarkets: z.array(z.string()).default(["KE"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  currentVersionId: z.string().optional(),
  archived: z.boolean().default(false),
});
export type Formulation = z.infer<typeof formulationSchema>;
