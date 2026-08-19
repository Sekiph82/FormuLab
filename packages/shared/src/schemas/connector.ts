/**
 * FVL-04.013-.018 — the external-source connector foundation.
 *
 * Frozen architecture (do not deviate):
 *
 *   Customer / External System
 *     -> READ-ONLY Connector/Extractor
 *     -> Source Staging
 *     -> Schema Discovery
 *     -> Reusable Versioned Mapping Profile
 *     -> Transformation / External-ID Crosswalk Resolution
 *     -> Canonical FormuLab import candidate rows
 *     -> EXISTING Data Exchange preview/validation/commit/history
 *
 * This module owns extraction, source identity, source-schema description,
 * source-to-canonical mapping configuration, external-ID resolution, and
 * deterministic transformations. It never owns canonical business rules,
 * Material Master decisions, supplier approval, price selection, cost
 * calculation, inventory availability, compatibility, safety, regulatory
 * verdicts, or Data Exchange commit semantics — those stay exactly where
 * they already are. A mapping profile produces CANDIDATE rows shaped like
 * an existing Data Exchange template's own columns; the existing
 * `previewDataExchangeImport`/commit layer remains the sole write
 * authority (FVL-04.024 owns the formal production bridge — this module
 * only proves its own output already conforms to that boundary).
 */
import { z } from "zod";

// ============================================================ Part A ===
// FVL-04.013 — External Source Connector Contract

export const CONNECTOR_TYPES = ["FILE", "DATABASE", "REST_API"] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

/** Who/what this connector is, never how to authenticate to it — a
 *  credential/config reference is opaque to everything downstream. */
export interface ConnectorIdentity {
  connectorId: string;
  connectorType: ConnectorType;
  connectorVersion: string;
  sourceSystemId: string;
  sourceSystemName: string;
}

export interface SourceRecordIdentity {
  sourceEntity: string;
  sourceRecordId: string;
  sourceParentId?: string;
}

export interface ExtractionMetadata {
  extractedAt: string;
  sourceModifiedAt?: string;
  sourceCreatedAt?: string;
  cursor?: string;
  extractionRunId: string;
}

/** Everything needed to answer "where did this fact come from?" without
 *  re-deriving it — the same "never fabricate provenance" discipline
 *  every other FormuLab provenance record already follows. */
export interface SourceLineage {
  sourceSystemId: string;
  sourceEntity: string;
  sourceRecordId: string;
  extractionRunId: string;
  connectorVersion: string;
  /** Deterministic fingerprint of the raw record content — never a
   *  cryptographic secret, just enough to detect "this exact row
   *  changed" without storing the row twice. */
  rawRecordFingerprint?: string;
}

/** Raw field name -> raw value, in the SOURCE's own vocabulary. Never
 *  renamed to a FormuLab canonical field here — that is the mapping
 *  profile's job (FVL-04.016), a strictly later stage. `null` is a real,
 *  distinct fact ("this field was present and empty/null"), never
 *  conflated with "this field does not exist" (simply absent from the
 *  object). */
export interface StagedSourceRecord {
  identity: SourceRecordIdentity;
  fields: Record<string, string | null>;
  lineage: SourceLineage;
  extraction: ExtractionMetadata;
}

export const CONNECTOR_ERROR_STAGES = [
  "connect",
  "discover",
  "extract",
  "parse",
  "schema",
  "mapping",
  "transformation",
  "crosswalk",
  "validation",
] as const;
export type ConnectorErrorStage = (typeof CONNECTOR_ERROR_STAGES)[number];

/** Structured, never a raw thrown exception leaking to a caller — the
 *  same discipline `DataExchangeRowResult.messages` already uses for
 *  the existing import lifecycle. `detail` is non-secret context only;
 *  a credential or connection string must never appear here. */
export interface ConnectorError {
  code: string;
  stage: ConnectorErrorStage;
  sourceEntity?: string;
  sourceRecordId?: string;
  message: string;
  retryable: boolean;
  detail?: string;
}

export interface ConnectorStats {
  totalRecords: number;
  readRecords: number;
  errorRecords: number;
}

export interface ConnectorResult {
  connector: ConnectorIdentity;
  entity: string;
  records: StagedSourceRecord[];
  warnings: ConnectorError[];
  errors: ConnectorError[];
  cursor?: string;
  stats: ConnectorStats;
}

/**
 * The one common contract every connector implementation (file, database,
 * REST API) satisfies. Deliberately READ-ONLY by omission: no method here
 * writes, updates, deletes, patches, or executes a mutation against the
 * source system. `discoverEntities`/`extract` may be sync or async
 * (a file connector can resolve synchronously; a database/REST connector
 * cannot), so both return `T | Promise<T>`.
 */
export interface SourceConnector {
  readonly identity: ConnectorIdentity;
  discoverEntities(): string[] | Promise<string[]>;
  extract(entity: string, opts?: { cursor?: string }): ConnectorResult | Promise<ConnectorResult>;
}

// ============================================================ Part C ===
// FVL-04.015 — Source Schema Discovery

export const SOURCE_FIELD_TYPES = ["string", "integer", "decimal", "boolean", "date", "datetime", "null", "object", "array", "mixed"] as const;
export type SourceFieldType = (typeof SOURCE_FIELD_TYPES)[number];

export const DECIMAL_CONVENTIONS = ["dot", "comma", "ambiguous", "unknown"] as const;
export type DecimalConvention = (typeof DECIMAL_CONVENTIONS)[number];

export const EXTERNAL_ID_STATUSES = ["candidate", "unresolved"] as const;
export type ExternalIdStatus = (typeof EXTERNAL_ID_STATUSES)[number];

export interface SourceFieldSchema {
  path: string;
  observedTypes: SourceFieldType[];
  nullable: boolean;
  nullCount: number;
  sampleCount: number;
  distinctCount: number;
  /** Only populated when every non-null sample matches one recognized
   *  ISO/explicit format unambiguously — never a guessed order. */
  candidateDateFormat?: string;
  dateAmbiguous?: boolean;
  decimalConvention?: DecimalConvention;
  /** Only ever set from deterministic evidence — a dedicated unit
   *  column/header annotation — never inferred from a bare field name. */
  unitHint?: string;
  externalIdStatus?: ExternalIdStatus;
  /** True only when every value observed for this field, across every
   *  record, was unique and non-null. */
  isUniqueNonNull: boolean;
}

export interface SourceRelationshipHint {
  fieldPath: string;
  /** Free text, e.g. "field name suggests a foreign key" — a hint for a
   *  human/mapping profile author, never a validated relationship. */
  reason: string;
}

export interface SourceEntitySchema {
  entity: string;
  recordCount: number;
  fields: SourceFieldSchema[];
  relationshipHints: SourceRelationshipHint[];
}

export interface SourceSchema {
  sourceSystemId: string;
  entities: SourceEntitySchema[];
  /** Deterministic — same structural metadata always produces the same
   *  fingerprint, independent of extraction time or record order. */
  fingerprint: string;
  discoveredAt: string;
}

// ============================================================ Part D ===
// FVL-04.016 — Mapping Profile Model

export const MAPPING_PROFILE_STATUSES = ["draft", "active", "superseded"] as const;
export type MappingProfileStatus = (typeof MAPPING_PROFILE_STATUSES)[number];

/** One declarative transformation step — configuration, never code. See
 *  `engine/transformation.ts` for the closed set of supported ops. */
export const TRANSFORMATION_OPS = [
  "trim",
  "empty_to_null",
  "lowercase",
  "uppercase",
  "safe_code_case",
  "parse_decimal",
  "parse_date",
  "map_enum",
  "map_boolean",
  "convert_unit",
  "resolve_crosswalk",
  "constant",
  "copy",
  "split",
  "join",
] as const;
export type TransformationOp = (typeof TRANSFORMATION_OPS)[number];

/** Op-specific config, e.g. { decimalSeparator: "," } for parse_decimal,
 *  { enumMap: { "Y": "true" } } for map_enum. Plain JSON data, never a
 *  code string — no `eval`, no scripting language. */
export const transformationStepSchema = z.object({
  op: z.enum(TRANSFORMATION_OPS),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type TransformationStep = z.infer<typeof transformationStepSchema>;

export const fieldMappingSchema = z.object({
  /** Source field/path, from the same vocabulary Source Staging uses. */
  sourceField: z.string().min(1),
  /** Target Data Exchange template code — resolved against the EXISTING
   *  `dataExchangeRegistry`, never a duplicated catalog. */
  targetTemplate: z.string().min(1),
  targetField: z.string().min(1),
  transformations: z.array(transformationStepSchema).optional(),
});
export type FieldMapping = z.infer<typeof fieldMappingSchema>;

/** A field whose value is fixed by the profile itself, not read from the
 *  source row — e.g. a constant currency code every row of this source
 *  always uses. */
export const constantMappingSchema = z.object({
  targetTemplate: z.string().min(1),
  targetField: z.string().min(1),
  value: z.string(),
});
export type ConstantMapping = z.infer<typeof constantMappingSchema>;

/** Persisted through the existing masterdata architecture — see
 *  `mapping_profiles` in `masterdata.rs`. `profileId` is the natural
 *  identity/storage key; a changed mapping creates a NEW profile version
 *  (`supersedesProfileId` pointing at the one it replaces) rather than
 *  rewriting history — the same append-history discipline
 *  `material_prices`/`exchange_rates` already use, applied to
 *  configuration instead of a measured fact. */
export const mappingProfileSchema = z.object({
  schemaVersion: z.literal("1.0"),
  profileId: z.string().min(1),
  profileName: z.string().min(1),
  sourceSystemId: z.string().min(1),
  sourceEntity: z.string().min(1),
  /** The `SourceSchema.fingerprint` this profile was authored against —
   *  a materially different source schema must not silently reuse it. */
  sourceSchemaFingerprint: z.string().min(1),
  profileVersion: z.number().int().positive(),
  status: z.enum(MAPPING_PROFILE_STATUSES).default("draft"),
  fieldMappings: z.array(fieldMappingSchema).default([]),
  constantMappings: z.array(constantMappingSchema).default([]),
  /** The profile version this one supersedes, when status is "active" and
   *  a prior version existed — the earlier version is never rewritten,
   *  only ever superseded (see FVL-04.016's own "profile evolution"
   *  requirement). */
  supersedesProfileId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
});
export type MappingProfile = z.infer<typeof mappingProfileSchema>;

export interface MappingCandidateRow {
  targetTemplate: string;
  /** A real Data Exchange template row: column key -> cell text, exactly
   *  the shape `previewDataExchangeImport` already consumes. */
  row: Record<string, string>;
}

export interface MappingTraceEntry {
  targetTemplate: string;
  targetField: string;
  sourceField?: string;
  rawValue?: string | null;
  operations: TransformationOp[];
  result: string | undefined;
}

export interface MappingResult {
  sourceLineage: SourceLineage;
  profileId: string;
  profileVersion: number;
  candidates: MappingCandidateRow[];
  trace: MappingTraceEntry[];
  unresolved: string[];
  warnings: ConnectorError[];
  errors: ConnectorError[];
}

export interface MappingProfileValidationIssue {
  code: string;
  message: string;
  targetTemplate?: string;
  targetField?: string;
  sourceField?: string;
}

// ============================================================ Part E ===
// FVL-04.017 — External ID Crosswalk Registry

export const CROSSWALK_STATUSES = ["active", "conflict"] as const;
export type CrosswalkStatus = (typeof CROSSWALK_STATUSES)[number];

/** Persisted through the existing masterdata architecture — see
 *  `external_id_crosswalks` in `masterdata.rs`. The tuple
 *  (sourceSystemId, sourceEntity, sourceRecordId, canonicalEntity)
 *  deterministically identifies one relationship; `code` is that tuple's
 *  own join, doubling as the record's real masterdata identity. */
export const externalIdCrosswalkSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  sourceSystemId: z.string().min(1),
  sourceEntity: z.string().min(1),
  sourceRecordId: z.string().min(1),
  canonicalEntity: z.string().min(1),
  canonicalRecordId: z.string().min(1),
  mappingProfileId: z.string().optional(),
  mappingProfileVersion: z.number().int().positive().optional(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  status: z.enum(CROSSWALK_STATUSES).default("active"),
  sourceFingerprint: z.string().optional(),
  notes: z.string().optional(),
});
export type ExternalIdCrosswalk = z.infer<typeof externalIdCrosswalkSchema>;

export interface CrosswalkConflict {
  code: string;
  sourceSystemId: string;
  sourceEntity: string;
  sourceRecordId: string;
  canonicalEntity: string;
  existingCanonicalRecordId: string;
  attemptedCanonicalRecordId: string;
}
