/**
 * Phase 8 — shared domain model for reports and document exports (Reports
 * workspace, Dossier PDF/DOCX exports). Defines what a document generation
 * request/result looks like; does NOT render anything (see
 * `engine/exports.ts` for the existing version-export metadata/watermark
 * pattern this module composes with, never duplicates).
 *
 * Traceability and safety rules this module enforces structurally, not by
 * convention:
 * - `DocumentSourceReference` always names a real source record — no field
 *   here can synthesize evidence or a version that doesn't exist.
 * - `GeneratedDocumentRecord` cannot carry file metadata (name/mime/size/
 *   checksum) unless `status === "succeeded"`, and cannot carry that
 *   metadata when `status === "failed"` — a failed export can never look
 *   successful by omission.
 * - Nothing here can set an approval or verification field. Approval
 *   status only ever appears as a read-only snapshot
 *   (`DocumentSourceReference.approvalStatusAtGeneration`), the same
 *   FormulaStatus type `exports.ts`'s `draftWatermark()` already switches
 *   on — never a new, parallel approval concept.
 * - Every timestamp is a required, explicit, caller-supplied input (never
 *   a schema-side `Date.now()` default), so generation is reproducible.
 */
import { z } from "zod";
import { FORMULA_STATUSES } from "./formulation";
import { REGULATORY_JURISDICTIONS } from "./regulatory";
import { DOSSIER_READINESS_STATES } from "./dossier";

// ---------------------------------------------------------------------------
// Enums / constants
// ---------------------------------------------------------------------------

/** Output formats Phase 8 actually renders. Do not add HTML/PPTX/ODT here
 *  until a real render engine needs them (see PHASE8_CURRENT.md). */
export const DOCUMENT_FORMATS = ["pdf", "docx"] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

/** The one coherent MIME type per format — the single source of truth a
 *  later render engine and this schema's own validation both read from,
 *  so "format" and "mimeType" can never silently drift apart. */
export const DOCUMENT_FORMAT_MIME_TYPES: Record<DocumentFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Mirrors `ReportsPage.tsx`'s existing row keys verbatim — that page is
 *  already the authoritative list of which reports the product intends to
 *  support; this schema reuses it rather than inventing a parallel one. */
export const REPORT_TYPES = [
  "formula",
  "trial",
  "stability",
  "regulatory",
  "dossier",
  "claimsReview",
  "labelReadiness",
  "formulaLabelConsistency",
  "artworkReview",
  "doeDesignSummary",
  "doeRunSheet",
  "doeResponseMatrix",
  "doeStatisticalAnalysis",
  "doeCandidateRanking",
  "dataExchangeImportHistory",
  "dataExchangeSchemaCatalog",
  "approval",
  "audit",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** What kind of domain record a document can trace back to. Narrower than
 *  `REPORT_TYPES`: several report types share one underlying entity kind
 *  (e.g. `labelReadiness`/`formulaLabelConsistency`/`artworkReview` are all
 *  `claims_label_review`), and `audit` has no linked entity yet in
 *  `ReportsPage.tsx` — a document of that report type simply carries no
 *  `DocumentSourceReference` until that row gets a real source. */
export const DOCUMENT_SOURCE_ENTITY_TYPES = [
  "formulation_version",
  "laboratory_trial",
  "stability_study",
  "regulatory_dossier",
  "claims_label_review",
  "doe_study",
  "data_exchange_job",
  "approval_record",
] as const;
export type DocumentSourceEntityType = (typeof DOCUMENT_SOURCE_ENTITY_TYPES)[number];

/** Same two-value convention `regulatoryDossierEvidenceItemSchema.
 *  confidentiality` already uses — reused rather than inventing a new
 *  classification taxonomy. */
export const DOCUMENT_CLASSIFICATIONS = ["normal", "confidential"] as const;
export type DocumentClassification = (typeof DOCUMENT_CLASSIFICATIONS)[number];

export const EXPORT_STATUSES = ["requested", "generating", "succeeded", "failed", "cancelled"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** What a later render engine must apply, conceptually mirroring
 *  `exports.ts`'s `draftWatermark()` rule ("anything short of
 *  production-approved must not appear as production-approved") but as
 *  data, not rendered text: `"draft"` for an explicitly draft-status
 *  source, `"unapproved"` for any other not-yet-production-approved
 *  source, `"none"` only once the source is truly production-approved. */
export const WATERMARK_STATES = ["draft", "unapproved", "none"] as const;
export type WatermarkState = (typeof WATERMARK_STATES)[number];

// ---------------------------------------------------------------------------
// Shared value helpers
// ---------------------------------------------------------------------------

/** A required, explicit, parseable timestamp — never generated inside this
 *  schema, so two parses of the same input are always identical. */
const isoTimestamp = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), "must be a parseable timestamp");

const ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/;

/** A bare or relative file name — never an absolute machine path (Windows
 *  drive, UNC, or Unix-rooted), so a generated-file record can never leak
 *  where on disk it was written. */
const relativeFileName = z
  .string()
  .min(1)
  .refine((v) => !ABSOLUTE_PATH_PATTERN.test(v), "fileName must not be an absolute path");

// ---------------------------------------------------------------------------
// ReportDefinition — a reusable definition of a report that may be generated.
// ---------------------------------------------------------------------------

export const reportDefinitionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  reportType: z.enum(REPORT_TYPES),
  supportedFormats: z.array(z.enum(DOCUMENT_FORMATS)).min(1),
  description: z.string().optional(),
  /** Absent for a report type with no linked entity yet (e.g. `audit`). */
  sourceEntityType: z.enum(DOCUMENT_SOURCE_ENTITY_TYPES).optional(),
  classification: z.enum(DOCUMENT_CLASSIFICATIONS).default("normal"),
  active: z.boolean().default(true),
});
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

// ---------------------------------------------------------------------------
// DocumentSourceReference — traceability to the exact source of a document.
// ---------------------------------------------------------------------------

export const documentSourceReferenceSchema = z.object({
  sourceEntityType: z.enum(DOCUMENT_SOURCE_ENTITY_TYPES),
  /** The real record this document was generated from. Required — a
   *  source reference with no record id traces nothing. */
  sourceRecordId: z.string().min(1),
  sourceCode: z.string().optional(),
  sourceVersionId: z.string().optional(),
  sourceRevision: z.number().int().nonnegative().optional(),
  /** Set only when `sourceEntityType === "formulation_version"` (or a
   *  document otherwise anchored to one). */
  formulaVersionId: z.string().optional(),
  /** Set only when `sourceEntityType === "regulatory_dossier"`. */
  dossierRevision: z.number().int().nonnegative().optional(),
  jurisdiction: z.enum(REGULATORY_JURISDICTIONS).optional(),
  packagingSkuCode: z.string().optional(),
  /** A read-only snapshot of the source's approval state at generation
   *  time — the same `FormulaStatus` `draftWatermark()` switches on.
   *  Never itself grants or implies approval. */
  approvalStatusAtGeneration: z.enum(FORMULA_STATUSES).optional(),
});
export type DocumentSourceReference = z.infer<typeof documentSourceReferenceSchema>;

// ---------------------------------------------------------------------------
// DocumentExportRequest — a request to generate a document.
// ---------------------------------------------------------------------------

export const documentExportRequestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  reportDefinitionCode: z.string().min(1),
  format: z.enum(DOCUMENT_FORMATS),
  source: documentSourceReferenceSchema,
  requestedBy: z.string().min(1),
  /** Explicit input the render engine must use verbatim — never computed
   *  inside this schema — so identical requests render identical output. */
  generationTimestamp: isoTimestamp,
  locale: z.string().min(1).default("en"),
  title: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(EXPORT_STATUSES).default("requested"),
});
export type DocumentExportRequest = z.infer<typeof documentExportRequestSchema>;

// ---------------------------------------------------------------------------
// GeneratedDocumentRecord — a persisted record of one generation attempt.
// ---------------------------------------------------------------------------

const generatedDocumentRecordBaseSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  requestId: z.string().min(1),
  reportDefinitionCode: z.string().min(1),
  source: documentSourceReferenceSchema,
  format: z.enum(DOCUMENT_FORMATS),
  status: z.enum(EXPORT_STATUSES),
  generatedAt: isoTimestamp,
  generatedBy: z.string().min(1),

  // Success-only metadata — see the cross-field refinement below for when
  // these are required, forbidden, or optional.
  fileName: relativeFileName.optional(),
  mimeType: z.string().min(1).optional(),
  byteSize: z.number().int().nonnegative().optional(),
  checksum: z.string().min(1).optional(),

  watermarkState: z.enum(WATERMARK_STATES).optional(),
  watermarkText: z.string().optional(),

  // Failure-only metadata.
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
});

export const generatedDocumentRecordSchema = generatedDocumentRecordBaseSchema.superRefine((rec, ctx) => {
  const fileFields: Array<[string, unknown]> = [
    ["fileName", rec.fileName],
    ["mimeType", rec.mimeType],
    ["byteSize", rec.byteSize],
    ["checksum", rec.checksum],
  ];
  const hasAnyFileField = fileFields.some(([, v]) => v !== undefined);

  if (rec.status === "succeeded") {
    if (!rec.fileName) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fileName"], message: "a succeeded record requires fileName" });
    if (!rec.mimeType) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mimeType"], message: "a succeeded record requires mimeType" });
    if (rec.byteSize === undefined || rec.byteSize <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["byteSize"], message: "a succeeded record requires a positive byteSize" });
    }
    if (!rec.checksum) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checksum"], message: "a succeeded record requires checksum" });
    if (rec.errorCode || rec.errorMessage) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["errorCode"], message: "a succeeded record must not carry error metadata" });
    }
  } else {
    // requested / generating / failed / cancelled: never allowed to look
    // like a successful export by carrying its file metadata.
    if (hasAnyFileField) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: `a ${rec.status} record must not carry success file metadata` });
    }
  }

  if (rec.status === "failed") {
    if (!rec.errorCode) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["errorCode"], message: "a failed record requires errorCode" });
    if (!rec.errorMessage) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["errorMessage"], message: "a failed record requires errorMessage" });
  } else if (rec.errorCode || rec.errorMessage) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["errorCode"], message: `a ${rec.status} record must not carry error metadata` });
  }

  if (rec.mimeType && rec.mimeType !== DOCUMENT_FORMAT_MIME_TYPES[rec.format]) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mimeType"], message: `mimeType must match the coherent MIME type for format "${rec.format}"` });
  }
});
export type GeneratedDocumentRecord = z.infer<typeof generatedDocumentRecordSchema>;

// ---------------------------------------------------------------------------
// DossierExportSnapshotMeta — metadata for a frozen dossier export snapshot.
// Deliberately does not recreate the requirement/evidence/review/readiness
// models in dossier.ts — it only names which dossier, which revision, and
// which already-computed readiness/review this export snapshot is bound to.
// ---------------------------------------------------------------------------

export const dossierExportSnapshotMetaSchema = z.object({
  schemaVersion: z.literal("1.0"),
  dossierId: z.string().min(1),
  dossierRevision: z.number().int().nonnegative(),
  jurisdictions: z.array(z.enum(REGULATORY_JURISDICTIONS)).min(1),
  packagingSkuCode: z.string().optional(),
  /** The dossier's own computed readiness at snapshot time — a reference
   *  to `DOSSIER_READINESS_STATES`, never a recomputed or fabricated
   *  value. */
  readinessState: z.enum(DOSSIER_READINESS_STATES).optional(),
  /** The `RegulatoryDossierReview.id` this snapshot was frozen alongside,
   *  when one exists — see `regulatoryDossierReviewSchema` in dossier.ts. */
  sourceReviewId: z.string().optional(),
});
export type DossierExportSnapshotMeta = z.infer<typeof dossierExportSnapshotMetaSchema>;
