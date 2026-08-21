/**
 * Data Exchange Center — persisted record shapes.
 *
 * Two families of schema live here:
 *
 * 1. Net-new master-data domain schemas that the 24 mandated templates need
 *    but that no earlier phase modeled as a live, mutable, importable
 *    collection: material documents (Template 4), product families
 *    (Template 5 — deliberately NOT `product.ts`'s `productFamilySchema`,
 *    which is the static Kenya reference catalog, a different concept),
 *    finished products/SKUs (Template 6), process parameters (Template 10),
 *    and formula cost overrides (Template 12). Everything else the 24
 *    templates target already exists (materials, suppliers, prices,
 *    packaging components/BOM, factory cost profiles, test definitions,
 *    lab/stability results, regulatory rules, dossier requirements/
 *    evidence, claims, label content/artwork, DOE factors/responses/
 *    observations) and is reused as-is, mapped via the registry's column
 *    aliases rather than duplicated here.
 *
 * 2. The Data Exchange system's own bookkeeping: import jobs, per-row
 *    results, export jobs, and schema-version records. An import job never
 *    stores the uploaded file's contents — only counts, a hash, and a
 *    pointer to a downloadable error report — so audit metadata stays small
 *    and no supplier's raw spreadsheet sits in the audit trail forever.
 *
 * Every "verification"/"approval"/"approved by" field below defaults to the
 * unverified/unapproved end of its enum and is never set by the generic
 * import commit path — only the domain's own, already-authorized workflow
 * (`verifyRule`, `recordApprovalDecision`, evidence verification, etc.) may
 * move it. This is enforced again in `engine/dataExchangeCommit.ts`; the
 * schema default is the first line of defense, not the only one.
 */
import { z } from "zod";
import { decimalString } from "./primitives";
import { TEST_VERIFICATION_STATUSES } from "./testDefinitions";

// ------------------------------------------------------- material documents ---

export const MATERIAL_DOCUMENT_TYPES = [
  "SDS",
  "TDS",
  "COA",
  "allergen_statement",
  "vegan_statement",
  "natural_origin_statement",
  "GMO_statement",
  "halal_certificate",
  "kosher_certificate",
  "ISO_certificate",
  "regulatory_declaration",
  "specification",
  "other",
] as const;
export type MaterialDocumentType = (typeof MATERIAL_DOCUMENT_TYPES)[number];

export const MATERIAL_DOCUMENT_VERIFICATION_STATUSES = ["unverified", "verified", "expired", "superseded"] as const;
export type MaterialDocumentVerificationStatus = (typeof MATERIAL_DOCUMENT_VERIFICATION_STATUSES)[number];

export const materialDocumentSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  materialCode: z.string().min(1),
  supplierCode: z.string().optional(),
  documentType: z.enum(MATERIAL_DOCUMENT_TYPES),
  documentNumber: z.string().optional(),
  documentTitle: z.string().min(1),
  revision: z.string().optional(),
  language: z.string().optional(),
  issuer: z.string().optional(),
  issueDate: z.string().optional(),
  expiryDate: z.string().optional(),
  /** Metadata only — importing a row never attaches a file. A human matches
   *  this name to a locally selected file through the normal attachment UI. */
  fileName: z.string().optional(),
  expectedSha256: z.string().optional(),
  /** Only a human verification action (outside the import path) may move
   *  this off "unverified". */
  verificationStatus: z.enum(MATERIAL_DOCUMENT_VERIFICATION_STATUSES).default("unverified"),
  verifiedBy: z.string().optional(),
  verifiedAt: z.string().optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MaterialDocument = z.infer<typeof materialDocumentSchema>;

// --------------------------------------------------- master product families ---

export const masterProductFamilySchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  defaultUnit: z.string().optional(),
  defaultBatchSize: decimalString.optional(),
  targetMarket: z.string().optional(),
  defaultJurisdictions: z.array(z.string()).default([]),
  defaultPackagingType: z.string().optional(),
  active: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MasterProductFamily = z.infer<typeof masterProductFamilySchema>;

// -------------------------------------------------------- finished products ---

export const FINISHED_PRODUCT_STATUSES = ["draft", "active", "discontinued"] as const;
export type FinishedProductStatus = (typeof FINISHED_PRODUCT_STATUSES)[number];

export const finishedProductSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  name: z.string().min(1),
  productFamilyCode: z.string().optional(),
  brand: z.string().optional(),
  formulaCode: z.string().optional(),
  formulaVersion: z.number().int().positive().optional(),
  packagingSkuCode: z.string().optional(),
  netQuantity: decimalString.optional(),
  quantityUnit: z.string().optional(),
  barcode: z.string().optional(),
  targetMarkets: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  status: z.enum(FINISHED_PRODUCT_STATUSES).default("draft"),
  manufactureSite: z.string().optional(),
  shelfLifeMonths: z.number().int().nonnegative().optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FinishedProduct = z.infer<typeof finishedProductSchema>;

// -------------------------------------------------- finished-product specifications ---

/**
 * FVL-04.005 hardening — the missing "what must this finished product
 * measure to be released?" domain. Deliberately narrow: this record owns
 * ONLY which test applies to which SKU and what limit/target that SKU
 * needs for release — never how the test itself works (that stays
 * `TestDefinition`'s job, referenced by `testDefinitionCode`, never
 * copied) and never the measured outcome (that stays `TestResult`'s job).
 * `minimum`/`maximum`/`targetValue` mirror `TestDefinition`'s own field
 * names on purpose — a product-specific override of that test's generic
 * limits, not a competing concept — and deliberately carry no separate
 * `unit`: the referenced `TestDefinition` already owns the unit of
 * measurement: a second unit field here would be a second source of
 * truth for the same fact.
 *
 * Append-only, the same convention `MaterialPrice`/`ExchangeRate` already
 * use: a new `effectiveFrom` period is a new row, so a specification
 * change never silently rewrites what an earlier batch was actually
 * evaluated against. `verificationStatus` reuses `TestDefinition`'s own
 * vocabulary (the closest real match — both are test-limit-shaped
 * content) rather than inventing a new one.
 */
export const finishedProductSpecificationSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  skuCode: z.string().min(1),
  testDefinitionCode: z.string().min(1),
  targetValue: decimalString.optional(),
  minimum: decimalString.optional(),
  maximum: decimalString.optional(),
  /** Whether this measurement must pass for the product to release —
   *  distinct from `TestDefinition.criticalTestFlag`, which is about the
   *  test in general, not this specific product's own release gate. */
  requiredForRelease: z.boolean().default(true),
  /** Blank means it applies to every one of the SKU's own `targetMarkets`
   *  — free text, the same convention `FinishedProduct.targetMarkets`
   *  already uses, not necessarily a `REGULATORY_JURISDICTIONS` code. */
  market: z.string().optional(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().optional(),
  verificationStatus: z.enum(TEST_VERIFICATION_STATUSES).default("not_verified"),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FinishedProductSpecification = z.infer<typeof finishedProductSpecificationSchema>;

// -------------------------------------------------------- process parameters ---

export const processParameterSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  formulaCode: z.string().min(1),
  formulaVersion: z.number().int().positive(),
  stepNumber: z.number().int().positive(),
  stepName: z.string().optional(),
  phase: z.string().optional(),
  equipmentType: z.string().optional(),
  temperatureMin: decimalString.optional(),
  temperatureTarget: decimalString.optional(),
  temperatureMax: decimalString.optional(),
  mixingSpeedMin: decimalString.optional(),
  mixingSpeedTarget: decimalString.optional(),
  mixingSpeedMax: decimalString.optional(),
  mixingTimeMinutes: decimalString.optional(),
  additionRate: z.string().optional(),
  holdTimeMinutes: decimalString.optional(),
  criticalParameter: z.boolean().default(false),
  instruction: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProcessParameter = z.infer<typeof processParameterSchema>;

// ---------------------------------------------------- formula cost overrides ---

export const formulaCostOverrideSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  formulaCode: z.string().min(1),
  formulaVersion: z.number().int().positive(),
  materialCode: z.string().min(1),
  supplierCode: z.string().optional(),
  overridePrice: decimalString,
  currency: z.string().min(1),
  priceUnit: z.string().default("kg"),
  effectiveFrom: z.string(),
  effectiveUntil: z.string().optional(),
  reason: z.string().optional(),
  /** The file's `approved_by` text, kept as a note only — see module doc.
   *  `approved` always defaults false and is never set true by an import. */
  approvedByNote: z.string().optional(),
  approved: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FormulaCostOverride = z.infer<typeof formulaCostOverrideSchema>;

// -------------------------------------------------------------- import jobs ---

export const DATA_EXCHANGE_IMPORT_STATUSES = [
  "uploaded",
  "parsing",
  "preview_ready",
  "validation_failed",
  "awaiting_confirmation",
  "committing",
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
  /** No commit handler exists for this template at all — never reachable
   *  once every template is wired, but the mechanism stays available for
   *  a future template that is registered before its commit handler
   *  ships. Distinct from "completed": zero rows were ever attempted,
   *  and the UI must say so rather than reporting a false success. */
  "unsupported",
] as const;
export type DataExchangeImportStatus = (typeof DATA_EXCHANGE_IMPORT_STATUSES)[number];

export const DATA_EXCHANGE_IMPORT_MODES = ["atomic", "partial"] as const;
export type DataExchangeImportMode = (typeof DATA_EXCHANGE_IMPORT_MODES)[number];

export const dataExchangeImportJobSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  templateCode: z.string().min(1),
  templateSchemaVersion: z.string().min(1),
  fileName: z.string().min(1),
  // "connector" — Session 11 hardening (F1/A) — a DATABASE/REST_API import
  // has no file at all; claiming "csv" for one was an outright lie in the
  // provenance record. fileSize/sha256 are correspondingly optional: they
  // are genuinely inapplicable to a connector-sourced job, never a
  // fabricated 0/extractionRunId standing in for them (see
  // extractionRunId below, its own honestly-named field).
  fileType: z.enum(["csv", "xlsx", "connector"]),
  fileSize: z.number().int().nonnegative().optional(),
  sha256: z.string().min(1).optional(),
  status: z.enum(DATA_EXCHANGE_IMPORT_STATUSES),
  mode: z.enum(DATA_EXCHANGE_IMPORT_MODES).default("atomic"),
  totalRows: z.number().int().nonnegative().default(0),
  validRows: z.number().int().nonnegative().default(0),
  invalidRows: z.number().int().nonnegative().default(0),
  createdRows: z.number().int().nonnegative().default(0),
  updatedRows: z.number().int().nonnegative().default(0),
  unchangedRows: z.number().int().nonnegative().default(0),
  duplicateRows: z.number().int().nonnegative().default(0),
  warningRows: z.number().int().nonnegative().default(0),
  startedBy: z.string().min(1),
  startedAt: z.string(),
  committedBy: z.string().optional(),
  committedAt: z.string().optional(),
  completedAt: z.string().optional(),
  errorReportAttachmentId: z.string().optional(),
  notes: z.string().optional(),
  /** FVL-04.024 hardening — minimal connector provenance for a job
   *  created through the real Connector -> Data Exchange Bridge
   *  (`connectorImportBridge.ts`). All optional/additive: a direct
   *  CSV/XLSX import through `DataExchangeImportDialog.tsx` has no
   *  connector/mapping-profile identity at all and simply never sets
   *  these — never a second import-history model, and never a
   *  duplicate of what `fileName`/`fileType`/`sha256` already record
   *  for the file-upload path. */
  sourceSystemId: z.string().optional(),
  connectorType: z.string().optional(),
  mappingProfileCode: z.string().optional(),
  /** Session 11 hardening (F1/A) — truthful connector provenance,
   *  additive/optional exactly like the three fields above. Populated
   *  only when genuinely available from the connector's own extraction
   *  — never fabricated for a direct file-upload job. */
  connectorVersion: z.string().optional(),
  sourceEntity: z.string().optional(),
  extractionRunId: z.string().optional(),
  sourceSchemaFingerprint: z.string().optional(),
  mappingProfileVersion: z.number().int().positive().optional(),
  /** HIST1-3 hardening — the EXACT saved `ConnectorConnection.code` this
   *  job ran through, when the job was created via the real Connector ->
   *  Data Exchange Bridge (`connectorImportBridge.ts`) with a known saved
   *  connection. `sourceSystemId + connectorType` alone are not a unique
   *  connection identity — two saved connections can legitimately share
   *  both (e.g. two SQLite files pointed at the same source system id) —
   *  so per-connection history (`importRunCountFor()`/
   *  `lastImportTimestampFor()`, `connectorConnections.ts`) must use this
   *  exact identity, never fall back to guessing from the shared fields
   *  alone. Optional/additive: a direct file-upload job, or a connector
   *  job created before this field existed, simply never sets it. */
  connectionCode: z.string().optional(),
  /** RUN4-7 — the source's own real resource identity (a file's filename,
   *  a DB table, a REST path), when the connector genuinely reported one
   *  at prepare time (`PreparedConnectorImport.sourceResourceName`).
   *  Optional/additive, same convention as every other connector
   *  provenance field above — never fabricated when the connector had
   *  none to report. */
  sourceResourceName: z.string().optional(),
});
export type DataExchangeImportJob = z.infer<typeof dataExchangeImportJobSchema>;

export const DATA_EXCHANGE_ROW_STATES = [
  "valid_create",
  "valid_update",
  "unchanged",
  "duplicate",
  "warning",
  "invalid",
  "reference_missing",
  "authorization_required",
  "unsupported",
] as const;
export type DataExchangeRowState = (typeof DATA_EXCHANGE_ROW_STATES)[number];

export const dataExchangeImportRowResultSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  jobId: z.string().min(1),
  rowNumber: z.number().int().positive(),
  naturalKey: z.string().optional(),
  state: z.enum(DATA_EXCHANGE_ROW_STATES),
  messages: z.array(z.string()).default([]),
  targetCollection: z.string().optional(),
  targetRecordId: z.string().optional(),
  /** FVL-04.023 hardening — the four fields a connector-sourced row needs
   *  for deterministic incremental re-import classification
   *  (`engine/dataExchangeIncremental.ts`'s `classifyReimport()`). All
   *  optional/additive: a row committed through the pre-connector,
   *  hand-authored, or direct-CSV Data Exchange path (no external source
   *  record, no mapping profile) simply never sets these — never a
   *  migration, never a second import-history model. */
  sourceRecordId: z.string().optional(),
  rawRecordFingerprint: z.string().optional(),
  mappingProfileCode: z.string().optional(),
  /** A deterministic fingerprint of the CANONICAL candidate this row
   *  produced at commit time — compared against the canonical target's
   *  CURRENT fingerprint on a later re-import to detect "someone edited
   *  this record locally since the last import" (E6/CANONICAL_LOCAL_CONFLICT).
   *  Never the full canonical record itself, never a raw payload. */
  canonicalCandidateFingerprint: z.string().optional(),
});
export type DataExchangeImportRowResult = z.infer<typeof dataExchangeImportRowResultSchema>;

export const dataExchangeExportJobSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  templateCode: z.string().min(1),
  templateSchemaVersion: z.string().min(1),
  exportType: z.enum(["blank", "example", "current_data"]),
  fileType: z.enum(["csv", "xlsx"]),
  rowCount: z.number().int().nonnegative().default(0),
  requestedBy: z.string().min(1),
  requestedAt: z.string(),
});
export type DataExchangeExportJob = z.infer<typeof dataExchangeExportJobSchema>;

export const dataExchangeSchemaVersionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().min(1),
  templateCode: z.string().min(1),
  templateSchemaVersion: z.string().min(1),
  effectiveFrom: z.string(),
  notes: z.string().optional(),
});
export type DataExchangeSchemaVersion = z.infer<typeof dataExchangeSchemaVersionSchema>;
