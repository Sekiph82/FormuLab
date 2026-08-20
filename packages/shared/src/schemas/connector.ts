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

/**
 * FVL-04.014 hardening (§8): three distinct identity concepts exist across
 * this pipeline and must never be conflated:
 *
 *   (A) staging row identity   — `sourceRecordId` here, when no explicit
 *       source ID exists: the row's own stable ordinal position. Good
 *       enough to keep one staging run internally consistent; NOT an
 *       authoritative external identifier.
 *   (B) explicit external source ID — `sourceRecordId` here, when
 *       `StageOptions.idField` names a real source column. This is the
 *       ONLY identity a persistent External ID Crosswalk (FVL-04.017) may
 *       be built from.
 *   (C) canonical FormuLab ID — decided entirely by the existing Data
 *       Exchange commit layer, never by this staging layer.
 *
 * `SourceRecordIdentity` cannot distinguish (A) from (B) by itself — see
 * `StagedSourceRecord.identity.idSource` below, and `fileConnector.ts`'s
 * own `requireExplicitId` option for the case where an ordinal fallback
 * must not be silently allowed.
 */
export interface SourceRecordIdentity {
  sourceEntity: string;
  sourceRecordId: string;
  sourceParentId?: string;
  /** Whether `sourceRecordId` came from an explicitly configured source
   *  field ("configured") or is only a staging-row ordinal fallback
   *  ("ordinal") — see the module doc comment above. A crosswalk must
   *  never be built from an "ordinal" identity. */
  idSource: "configured" | "ordinal";
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

/** What kind of resource a connector read from, generalized so FILE,
 *  DATABASE, and REST_API sources can all describe themselves through one
 *  shape without forcing fake file fields onto a database table or a REST
 *  resource. */
export const SOURCE_RESOURCE_KINDS = ["file", "database_table", "rest_resource"] as const;
export type SourceResourceKind = (typeof SOURCE_RESOURCE_KINDS)[number];

/**
 * FVL-04.013/.014 hardening — real source-resource identity, replacing the
 * previous session's unfulfilled claim that `ConnectorResult` already
 * exposed file name/type/size/hash. `resourceName` is the source's own
 * name (a file's own filename, a DB table name, a REST resource path) —
 * NEVER a local absolute filesystem path, which is not portable lineage.
 * `contentFingerprint` is the same non-cryptographic FNV-1a fingerprint
 * `connectorFingerprint.ts` already provides elsewhere — deliberately never
 * called a "hash" or "SHA256" anywhere, since it is not a cryptographic
 * digest and claiming otherwise would overstate the guarantee. `byteSize`
 * and `contentFingerprint` are optional because a DATABASE/REST_API source
 * (not implemented by this session — FVL-04.021/.022 remain out of scope)
 * may not have either concept, while `resourceName`/`kind` still apply.
 * `sourceSchemaVersion` is preserved separately from anything Schema
 * Discovery computes — a source-declared version string, when the source
 * happens to provide one, never conflated with FormuLab's own discovered
 * `SourceSchema.fingerprint`.
 *
 * FVL-04.014 hardening (Session 7, Part A3): `resourceName` is ONLY the
 * resource's own identity (a file's own filename, a DB table name, a REST
 * path) — it must never be overloaded with a sub-resource identity like an
 * XLSX sheet name (a prior session's `"file.xlsx#SheetName"` conflation is
 * corrected). `subResourceName` carries that separately (e.g. the sheet
 * name for XLSX, or a partition/shard name for a future DB/REST source)
 * when one genuinely exists — `byteSize`/`contentFingerprint` describe the
 * FILE/resource as a whole, never one selected sub-resource, so the same
 * file with a different `subResourceName` selected must report the
 * identical `byteSize`/`contentFingerprint`. See also
 * `SourceRecordIdentity`/`StagedSourceRecord.identity` for the separate,
 * lower layers of identity (staging row / explicit external record). */
export interface SourceResourceMetadata {
  kind: SourceResourceKind;
  resourceName: string;
  /** A sub-resource selected within `resourceName` — an XLSX sheet name,
   *  for example. Never folded into `resourceName` itself. */
  subResourceName?: string;
  mediaType?: string;
  byteSize?: number;
  contentFingerprint?: string;
  sourceSchemaVersion?: string;
}

export interface ConnectorResult {
  connector: ConnectorIdentity;
  entity: string;
  records: StagedSourceRecord[];
  warnings: ConnectorError[];
  errors: ConnectorError[];
  cursor?: string;
  stats: ConnectorStats;
  /** Identity of the resource this extraction read from — see
   *  `SourceResourceMetadata`. Optional because a mock/in-memory connector
   *  in a test may have no real resource to describe. */
  sourceResource?: SourceResourceMetadata;
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

/**
 * FVL-04.015 hardening — replaces the previous two-value
 * `EXTERNAL_ID_STATUSES` (`"candidate" | "unresolved"`), which let a merely
 * unique field (including a unique DISPLAY NAME like `MaterialName`)
 * silently read as an authoritative external-ID "candidate". A unique
 * field observed in the sample is now `unique_candidate` — an honest
 * uniqueness OBSERVATION, never authority. Only a field the caller
 * explicitly configured as the source's own record identifier
 * (`StageOptions.idField`) is `configured_external_id`.
 *
 * FVL-04.015 hardening (Session 7, D2): the original four-plus-unresolved
 * model also included `explicit_primary_key`, meant for "the source
 * connector/source schema itself explicitly declares this is the PK" —
 * verified to have NO real input path anywhere in the codebase (nothing
 * ever set it; a dead enum value). Removed rather than kept as an
 * unreachable state. `metadata_primary_key` is retained because it DOES
 * have a real, tested input path today: `DiscoverEntityOptions.metadataPrimaryKeyFields`
 * represents a future DATABASE/REST connector's own declared-PK metadata
 * (FVL-04.021/.022 remain unimplemented, but the evidence model can
 * already represent that channel, exercised by a mock in
 * `schemaDiscovery.test.ts`). The two retained non-configured states are
 * genuinely distinct: `configured_external_id` is a HUMAN/mapping-profile
 * decision about a FILE-shaped source; `metadata_primary_key` is a
 * SOURCE-declared fact a future structured connector could supply.
 */
export const EXTERNAL_ID_EVIDENCE = [
  "configured_external_id",
  "metadata_primary_key",
  "unique_candidate",
  "unresolved",
] as const;
export type ExternalIdEvidence = (typeof EXTERNAL_ID_EVIDENCE)[number];

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
  /** Set only from deterministic structural evidence — either an explicit
   *  `unitColumnPairs` configuration, or the recognized sibling-column
   *  convention (a field paired with a column literally named `UOM`/`Unit`,
   *  or `<field>_UOM`/`<field>_Unit`). Never a guess from the field's own
   *  name alone: a bare `Quantity` column with no such sibling stays
   *  without a `unitColumnHint`. */
  unitColumnHint?: string;
  /** Candidate null tokens observed among this field's own non-null string
   *  values (e.g. `"N/A"`, `"NULL"`, `"-"`) — reported for a human/mapping
   *  profile to configure, never silently treated as null by discovery
   *  itself. A real `0`/`false`/`"0"` value is never included here. */
  observedNullTokens?: string[];
  externalIdStatus?: ExternalIdEvidence;
  /** True only when every value observed for this field, across every
   *  record, was unique and non-null — a SAMPLE observation, not identity
   *  authority. See `externalIdStatus`. */
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
   *  fingerprint, independent of extraction time, record order, or sample
   *  composition (see `schemaDiscovery.ts`'s own fingerprint-input
   *  documentation for exactly what is and is not included). */
  fingerprint: string;
  discoveredAt: string;
  /** A source-DECLARED schema version, when the source happens to provide
   *  one (e.g. from `ConnectorResult.sourceResource.sourceSchemaVersion`) —
   *  kept entirely separate from `fingerprint`, which is FormuLab's own
   *  computed structural signature. Never conflated: a source can bump its
   *  own version string without any structural change FormuLab would
   *  detect, and vice versa. */
  sourceProvidedSchemaVersion?: string;
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

/**
 * Persisted through the existing masterdata architecture — see
 * `mapping_profiles` in `masterdata.rs`. FVL-04.016 hardening (D1/D2):
 * `profileId` alone is the LOGICAL mapping identity across its whole
 * version history, but the IMMUTABLE STORAGE identity — the value
 * `masterdata.rs`'s own `row_key()` reads (`code`/`id`) — is the composite
 * `code = "${profileId}::v${profileVersion}"` (see `mappingProfileCode()`
 * in `engine/mappingProfile.ts`). `mapping_profiles` is registered
 * append-only in `masterdata.rs`, so a second write attempting to reuse an
 * existing `code` is rejected by the storage layer itself, not merely by
 * application-layer discipline — a changed mapping MUST create a new
 * `profileVersion` (a new `code`, a new row).
 *
 * FVL-04.016 hardening (Session 7, Part G) — lifecycle correction: every
 * persisted row is immutable, full stop, INCLUDING its own `status`. A row
 * saved with `status: "active"` is NEVER later rewritten to `"superseded"`
 * — storage itself would refuse that write anyway (a real, structural
 * consequence of append-only, not a rule this schema merely asserts).
 * Whether a given version is CURRENTLY superseded is a DERIVED fact, never
 * a stored one — see `effectiveMappingProfileStatus()` in
 * `engine/mappingProfile.ts`, which reports a version superseded exactly
 * when a newer version in the same `profileId` family exists, without
 * ever touching the earlier row. `supersedesProfileCode` names the EXACT
 * immutable version this one replaces (the prior version's own `code`,
 * e.g. `"cht-lims-materials::v1"`) — never the ambiguous, version-less
 * `profileId` a prior session used, which could not distinguish "replaces
 * v1" from "replaces v2" once three or more versions exist. */
export const mappingProfileSchema = z.object({
  schemaVersion: z.literal("1.0"),
  /** Immutable storage identity — `"${profileId}::v${profileVersion}"`.
   *  See the module doc comment above. */
  code: z.string().min(1),
  profileId: z.string().min(1),
  profileName: z.string().min(1),
  sourceSystemId: z.string().min(1),
  sourceEntity: z.string().min(1),
  /** The `SourceSchema.fingerprint` this profile was authored against —
   *  a materially different source schema must not silently reuse it. */
  sourceSchemaFingerprint: z.string().min(1),
  profileVersion: z.number().int().positive(),
  /** This version's OWN status at the moment it was created — never
   *  rewritten afterward. See the module doc comment: "superseded" is a
   *  DERIVED fact computed by `effectiveMappingProfileStatus()`, not a
   *  value ever stored here for that purpose. */
  status: z.enum(MAPPING_PROFILE_STATUSES).default("draft"),
  fieldMappings: z.array(fieldMappingSchema).default([]),
  constantMappings: z.array(constantMappingSchema).default([]),
  /** The EXACT immutable `code` of the prior version this one replaces
   *  (e.g. `"cht-lims-materials::v1"`) — never merely the logical
   *  `profileId`, which cannot distinguish which specific prior version
   *  was actually superseded once three or more versions exist. */
  supersedesProfileCode: z.string().optional(),
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

/**
 * FVL-04.017 hardening (E1): the previous two-value
 * `["active", "conflict"]` allowed a `status: "conflict"` state that
 * nothing in the codebase ever actually persisted — `upsertCrosswalk()`
 * returns a `CrosswalkConflict` as a separate, unpersisted result object
 * and leaves the existing `active` record completely untouched (see
 * `crosswalk.ts`). A dead enum value with no real persisted semantic is
 * worse than none, so it is removed here: the persisted model now only
 * ever records `"active"`. The chosen, documented conflict behavior is:
 * the canonical active crosswalk is never silently overwritten; an
 * attempted conflicting mapping is never persisted as a replacement; the
 * conflict is surfaced to the caller (ultimately a human-review layer) as
 * a `CrosswalkConflict` value, not a stored row.
 */
export const CROSSWALK_STATUSES = ["active"] as const;
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

// ============================================================ Part F ===
// Connector Management frontend — persisted Connection configuration.
//
// A "Connection" is a reusable, saved CONFIGURATION for one connector
// (FILE/DATABASE/REST_API) — never a credential, and never a live
// connector instance itself. `connectionRef` is the SAME opaque
// credential-resolution reference every real connector deps interface
// (`RestConnectorDeps`, `DatabaseConnectorDeps`) already required —
// this record carries it forward unchanged, never a raw secret. Every
// other field here is real, non-secret CONFIGURATION matching the
// existing connector contracts (`RestConnectorSource`,
// `DatabaseConnectorSource`, `StageOptions`) — no field invents a
// capability those contracts don't already have.

export const CONNECTOR_CONNECTION_STATUSES = ["never_tested", "ready", "error"] as const;
export type ConnectorConnectionStatus = (typeof CONNECTOR_CONNECTION_STATUSES)[number];

export const CONNECTOR_FILE_KINDS = ["csv", "json", "xml", "xlsx"] as const;
export type ConnectorFileKind = (typeof CONNECTOR_FILE_KINDS)[number];

export const CONNECTOR_PAGINATION_KINDS = ["none", "page", "offset", "cursor"] as const;
export type ConnectorPaginationKind = (typeof CONNECTOR_PAGINATION_KINDS)[number];

/**
 * Persisted through the existing masterdata architecture — see
 * `connector_connections` in `masterdata.rs`. `code` is the record's own
 * stable storage identity (a generated id, `newId("connconn")`),
 * mutable (unlike `mapping_profiles`):
 * a saved connection's own configuration may be edited in place —
 * editing connection host/path details is not the kind of historical
 * fact `mapping_profiles`'s immutable version chain protects.
 *
 * Never carries a raw secret: `connectionRef` is the ONLY field that may
 * ever represent authentication, and it is always an opaque reference
 * string, resolved to a real credential entirely outside this record —
 * the same boundary `RestConnectorDeps.fetchPage`/`DatabaseConnectorDeps.adapter`
 * already establish for every real connector call.
 */
export const connectorConnectionSchema = z.object({
  schemaVersion: z.literal("1.0"),
  code: z.string().min(1),
  name: z.string().min(1),
  connectorType: z.enum(CONNECTOR_TYPES),
  sourceSystemId: z.string().min(1),
  /** Opaque credential-resolution reference — NEVER a raw secret. */
  connectionRef: z.string().optional(),

  // FILE
  fileKind: z.enum(CONNECTOR_FILE_KINDS).optional(),
  sourceEntity: z.string().optional(),

  // DATABASE (configuration only — see docs/CONNECTOR_MANAGEMENT_FRONTEND.md
  // for the honest, current no-production-driver disclosure)
  driver: z.string().optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  database: z.string().optional(),
  dbSchema: z.string().optional(),
  table: z.string().optional(),

  // REST API (GET-only — matches RestConnectorSource/HttpFetchAdapterConfig
  // exactly; there is no field anywhere on this record that could express
  // a write method)
  baseUrl: z.string().optional(),
  path: z.string().optional(),
  recordArrayPath: z.string().optional(),
  paginationKind: z.enum(CONNECTOR_PAGINATION_KINDS).optional(),
  pageParam: z.string().optional(),
  pageSizeParam: z.string().optional(),
  pageSizeValue: z.number().int().positive().optional(),
  offsetParam: z.string().optional(),
  limitParam: z.string().optional(),
  limitValue: z.number().int().positive().optional(),
  cursorParam: z.string().optional(),
  nextCursorPath: z.string().optional(),
  maxPages: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),

  // Identity (shared across all connector types)
  idField: z.string().optional(),
  requireExplicitId: z.boolean().optional(),

  status: z.enum(CONNECTOR_CONNECTION_STATUSES).default("never_tested"),
  lastTestedAt: z.string().optional(),
  /** A sanitized, human-readable outcome message ONLY — never raw
   *  response bodies, headers, connection strings, or any value a real
   *  connector error would already redact. */
  lastTestMessage: z.string().optional(),
  mappingProfileCount: z.number().int().nonnegative().default(0),
  notes: z.string().optional(),
  archived: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
});
export type ConnectorConnection = z.infer<typeof connectorConnectionSchema>;
