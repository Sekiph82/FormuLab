/**
 * FVL-04.014 — the generic file connector (CSV/XLSX/JSON/XML) into Source
 * Staging. Reuses the existing `parseCsv` (the same parser Data Exchange's
 * own CSV path already uses) rather than writing a second one. Accepts
 * arbitrary customer field names verbatim — no FormuLab canonical column
 * name is ever required or assumed here; that translation is
 * FVL-04.016/.018's job, strictly later.
 *
 * FVL-04.014 hardening (Session 6, Part B): all four formats are exposed
 * through one common `stageFile()` abstraction, which also attaches real
 * source-resource metadata to `ConnectorResult.sourceResource`. XLSX still
 * needs ExcelJS/ArrayBuffer, desktop-only, so `stageFile()` accepts a small
 * injected `readWorkbook` adapter rather than importing ExcelJS into the
 * shared package; `apps/desktop/src/lib/xlsx.ts`'s `readWorkbookAllSheets`
 * is the real adapter used in production. Every format funnels into the
 * exact same `stageRows` staging path underneath — one staging
 * implementation, not four parallel ones.
 *
 * FVL-04.014 hardening (Session 7, Parts A/B/C): three further corrections.
 * (A) `sourceResource` is now genuinely FILE-level, not sheet-level or
 * caller-asserted: `byteSize`/`contentFingerprint` are computed internally
 * from the actual bytes/text — never trusted from a caller-supplied field
 * — and `resourceName` never has a sheet name folded into it (see the new
 * `subResourceName`). (B) `createFileConnector()` is a real
 * `SourceConnector` implementation, not just a standalone `stageFile()`
 * function sitting next to the interface. (C) every parse-failure path
 * returns a stable, sanitized message — never a raw library exception's
 * own text, which could contain a local path, a connection string, or
 * other content that should never appear in a `ConnectorError`.
 */
import { parseCsv } from "./importer";
import { fingerprint, fingerprintBytes } from "./connectorFingerprint";
import { parseXml, detectRepeatedElements, flattenXmlRecord, UnsafeXmlError } from "./xmlParser";
import type { ConnectorError, ConnectorErrorStage, ConnectorIdentity, ConnectorResult, SourceConnector, SourceResourceMetadata, StagedSourceRecord } from "../schemas/connector";

export interface StageOptions {
  /** Which field/column identifies a record. When absent, the row's own
   *  1-based ordinal position is used as a staging-only fallback identity
   *  (see `SourceRecordIdentity`'s own "three identity concepts" doc
   *  comment) — an honest, stable, deterministic fallback, never a
   *  fabricated business identifier, and never eligible to seed a
   *  persistent External ID Crosswalk. */
  idField?: string;
  /** When true AND `idField` is set, a row whose `idField` value is
   *  blank/missing produces a structured `missing_source_id` error instead
   *  of silently falling back to an ordinal identity — for a source where
   *  the caller has explicitly declared that every record MUST carry a
   *  real external ID. */
  requireExplicitId?: boolean;
  extractionRunId: string;
  extractedAt?: string;
}

/** Exported so other connector-type modules (e.g. FVL-04.021's database
 *  connector) can build the SAME `ConnectorIdentity` shape their own
 *  `SourceConnector.identity` needs, never a second hand-rolled shape. */
export function connectorIdentity(sourceSystemId: string, connectorType: ConnectorIdentity["connectorType"]): ConnectorIdentity {
  return { connectorId: `${connectorType.toLowerCase()}-connector`, connectorType, connectorVersion: "1.0", sourceSystemId, sourceSystemName: sourceSystemId };
}

/** FVL-04.014 hardening (Session 7, Part C) — never puts a raw library
 *  exception's own message into a `ConnectorError`. A thrown exception may
 *  legitimately contain a local file path, a connection string, or other
 *  content that should never be surfaced in a structured, potentially
 *  logged/displayed error. `detail` carries only the exception's own
 *  constructor name (`"Error"`, `"RangeError"`, ...) — enough to
 *  distinguish failure shapes during debugging without leaking content. */
function parseFailure(stage: ConnectorErrorStage, code: string, stableMessage: string, cause: unknown): ConnectorError {
  return { code, stage, message: stableMessage, retryable: false, detail: cause instanceof Error ? cause.constructor.name : "UnknownError" };
}

function emptyResult(sourceSystemId: string, entity: string, error: ConnectorError, sourceResource?: SourceResourceMetadata): ConnectorResult {
  return {
    connector: connectorIdentity(sourceSystemId, "FILE"),
    entity,
    records: [],
    warnings: [],
    errors: [error],
    stats: { totalRecords: 0, readRecords: 0, errorRecords: 1 },
    ...(sourceResource ? { sourceResource } : {}),
  };
}

/** `undefined` when the row genuinely has no usable identity under the
 *  configured options (i.e. `requireExplicitId` was set and the field was
 *  blank/missing) — the caller turns that into a structured error instead
 *  of staging the row. */
function resolveRecordId(fields: Record<string, string | null>, ordinal: number, opts: StageOptions): { sourceRecordId: string; idSource: "configured" | "ordinal" } | undefined {
  if (opts.idField) {
    const v = fields[opts.idField];
    if (v !== undefined && v !== null && v !== "") return { sourceRecordId: v, idSource: "configured" };
    if (opts.requireExplicitId) return undefined;
  }
  return { sourceRecordId: String(ordinal), idSource: "ordinal" };
}

function toStaged(
  sourceSystemId: string,
  entity: string,
  ordinal: number,
  fields: Record<string, string | null>,
  opts: StageOptions,
  connectorVersion: string,
): { record?: StagedSourceRecord; error?: ConnectorError } {
  const id = resolveRecordId(fields, ordinal, opts);
  if (!id) {
    return {
      error: {
        code: "missing_source_id",
        stage: "extract",
        sourceEntity: entity,
        message: `Record at position ${ordinal} has no value for the required source ID field "${opts.idField}".`,
        retryable: false,
      },
    };
  }
  const extractedAt = opts.extractedAt ?? new Date().toISOString();
  return {
    record: {
      identity: { sourceEntity: entity, sourceRecordId: id.sourceRecordId, idSource: id.idSource },
      fields,
      lineage: {
        sourceSystemId,
        sourceEntity: entity,
        sourceRecordId: id.sourceRecordId,
        extractionRunId: opts.extractionRunId,
        connectorVersion,
        rawRecordFingerprint: fingerprint(JSON.stringify(fields)),
      },
      extraction: { extractedAt, extractionRunId: opts.extractionRunId },
    },
  };
}

/** Rows (headers first, then one row per record) -> staged records. The
 *  common path CSV and XLSX both feed. */
/**
 * `connectorType` defaults to `"FILE"` — every pre-existing caller
 * (CSV/JSON/XML/XLSX, all through `stageFile()`) is unaffected. A
 * non-file caller (the FVL-04.021 database connector) passes its own
 * real type so `ConnectorResult.connector.connectorType` never
 * misreports its actual source — this is the ONE real row-staging
 * implementation every connector type funnels through, never a second
 * one duplicated per connector type.
 */
export function stageRows(sourceSystemId: string, entity: string, rows: string[][], opts: StageOptions, connectorType: ConnectorIdentity["connectorType"] = "FILE"): ConnectorResult {
  const errors: ConnectorError[] = [];
  const warnings: ConnectorError[] = [];
  if (rows.length === 0) {
    errors.push({ code: "empty_file", stage: "parse", message: "The file has no rows.", retryable: false });
    return { connector: connectorIdentity(sourceSystemId, connectorType), entity, records: [], warnings, errors, stats: { totalRecords: 0, readRecords: 0, errorRecords: 0 } };
  }
  const headers = rows[0];
  const records: StagedSourceRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const fields: Record<string, string | null> = {};
    headers.forEach((h, idx) => {
      const cell = row[idx];
      fields[h] = cell === undefined || cell === "" ? null : cell;
    });
    const staged = toStaged(sourceSystemId, entity, r, fields, opts, "1.0");
    if (staged.error) errors.push(staged.error);
    else records.push(staged.record!);
  }
  return {
    connector: connectorIdentity(sourceSystemId, connectorType),
    entity,
    records,
    warnings,
    errors,
    stats: { totalRecords: rows.length - 1, readRecords: records.length, errorRecords: errors.length },
  };
}

export function stageCsvFile(sourceSystemId: string, entity: string, csvText: string, opts: StageOptions): ConnectorResult {
  let rows: string[][];
  try {
    rows = parseCsv(csvText);
  } catch (e) {
    return emptyResult(sourceSystemId, entity, parseFailure("parse", "malformed_csv", "The CSV file could not be parsed.", e));
  }
  return stageRows(sourceSystemId, entity, rows, opts);
}

/** Flattens a nested JSON value to path->string fields using reversible
 *  dot/bracket notation (`address.city`, `tags[0]`) — structure is
 *  preserved in the path, never destructively merged. */
function flattenJson(value: unknown, prefix = ""): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  if (value === null || value === undefined) {
    if (prefix) fields[prefix] = null;
    return fields;
  }
  if (Array.isArray(value)) {
    if (value.length === 0 && prefix) {
      fields[prefix] = null;
      return fields;
    }
    value.forEach((v, idx) => Object.assign(fields, flattenJson(v, `${prefix}[${idx}]`)));
    return fields;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0 && prefix) {
      fields[prefix] = null;
      return fields;
    }
    for (const [k, v] of entries) Object.assign(fields, flattenJson(v, prefix ? `${prefix}.${k}` : k));
    return fields;
  }
  if (prefix) fields[prefix] = String(value);
  return fields;
}

/** Finds the array of records inside an arbitrary customer JSON payload:
 *  the root itself if it's an array, else the first array-valued
 *  top-level property (the `{ "items": [...] }` shape) — structural
 *  detection only, never a guess from a property's own name. */
function findRecordArray(parsed: unknown): unknown[] | undefined {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    for (const v of Object.values(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) return v;
    }
  }
  return undefined;
}

export function stageJsonFile(sourceSystemId: string, entity: string, jsonText: string, opts: StageOptions): ConnectorResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    return emptyResult(sourceSystemId, entity, parseFailure("parse", "malformed_json", "The JSON file could not be parsed.", e));
  }
  const arr = findRecordArray(parsed);
  if (!arr) {
    return emptyResult(sourceSystemId, entity, { code: "no_record_array", stage: "parse", message: "No array of records found at the root or as a top-level property.", retryable: false });
  }
  const errors: ConnectorError[] = [];
  const records: StagedSourceRecord[] = [];
  arr.forEach((item, idx) => {
    const staged = toStaged(sourceSystemId, entity, idx + 1, flattenJson(item), opts, "1.0");
    if (staged.error) errors.push(staged.error);
    else records.push(staged.record!);
  });
  return {
    connector: connectorIdentity(sourceSystemId, "FILE"),
    entity,
    records,
    warnings: [],
    errors,
    stats: { totalRecords: arr.length, readRecords: records.length, errorRecords: errors.length },
  };
}

export function stageXmlFile(sourceSystemId: string, entity: string, xmlText: string, opts: StageOptions & { recordTag?: string }): ConnectorResult {
  let root;
  try {
    root = parseXml(xmlText);
  } catch (e) {
    const unsafe = e instanceof UnsafeXmlError;
    return emptyResult(
      sourceSystemId,
      entity,
      parseFailure("parse", unsafe ? "unsafe_xml_entities" : "malformed_xml", unsafe ? "The XML file declares a DOCTYPE/ENTITY, which is refused before parsing." : "The XML file could not be parsed.", e),
    );
  }
  const recordElements = opts.recordTag
    ? collectByTag(root, opts.recordTag)
    : detectRepeatedElements(root);
  if (recordElements.length === 0) {
    return emptyResult(sourceSystemId, entity, { code: "no_repeated_record_elements", stage: "parse", message: "No repeated sibling elements found to treat as records — pass recordTag explicitly.", retryable: false });
  }
  const errors: ConnectorError[] = [];
  const records: StagedSourceRecord[] = [];
  recordElements.forEach((el, idx) => {
    const staged = toStaged(sourceSystemId, entity, idx + 1, flattenXmlRecord(el), opts, "1.0");
    if (staged.error) errors.push(staged.error);
    else records.push(staged.record!);
  });
  return {
    connector: connectorIdentity(sourceSystemId, "FILE"),
    entity,
    records,
    warnings: [],
    errors,
    stats: { totalRecords: recordElements.length, readRecords: records.length, errorRecords: errors.length },
  };
}

function collectByTag(root: ReturnType<typeof parseXml>, tag: string) {
  const out: ReturnType<typeof parseXml>[] = [];
  const walk = (el: ReturnType<typeof parseXml>) => {
    if (el.tag === tag) out.push(el);
    el.children.forEach(walk);
  };
  walk(root);
  return out;
}

const MEDIA_TYPES = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json",
  xml: "application/xml",
} as const;
export type FileKind = keyof typeof MEDIA_TYPES;

/**
 * Session 8 hardening (Part 6) — a discriminated union keyed on `fileKind`,
 * replacing the prior single interface where `text`/`bytes` were both
 * optional regardless of kind. That shape let a caller construct (or a
 * refactor silently produce) a `csv` input with no `text`, or an `xlsx`
 * input with no `bytes`, and `stageFile` would fall back to `input.text ??
 * ""` / `input.bytes ?? new ArrayBuffer(0)` — an empty-content default
 * standing in for what should have been a compile-time error. CSV/JSON/XML
 * now REQUIRE `text`; XLSX REQUIRES `bytes`, at the type level, with no
 * silent fallback left in `stageFile` for either.
 */
export interface TextFileConnectorInput {
  fileName: string;
  fileKind: "csv" | "json" | "xml";
  text: string;
}
export interface XlsxFileConnectorInput {
  fileName: string;
  fileKind: "xlsx";
  /** Raw workbook bytes. Read only through the injected `readWorkbook`
   *  adapter, never parsed directly by this shared-package function
   *  (ExcelJS is a desktop-only dependency). `byteSize`/`contentFingerprint`
   *  are always derived from these actual bytes internally — FVL-04.014
   *  hardening (Session 7, Part A2/N) removed the prior caller-supplied
   *  `byteSize` field entirely, since a caller-asserted size could silently
   *  lie about real provenance. */
  bytes: ArrayBuffer;
  /** Which sheet to stage — defaults to the workbook's first sheet. Each
   *  sheet is its own source entity; call `stageFile` once per sheet to
   *  stage a multi-sheet workbook, never auto-merged. */
  sheetName?: string;
}
export type FileConnectorInput = TextFileConnectorInput | XlsxFileConnectorInput;

export interface FileConnectorDeps {
  /** The real adapter is `apps/desktop/src/lib/xlsx.ts`'s
   *  `readWorkbookAllSheets` — injected so this shared-package module never
   *  imports ExcelJS directly. A rejected/thrown promise (a genuinely
   *  corrupt workbook) is caught and reported as a structured, sanitized
   *  `corrupt_xlsx` error, never a raw leaked exception. */
  readWorkbook: (bytes: ArrayBuffer) => Promise<{ sheetName: string; rows: string[][] }[]>;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * FVL-04.014 hardening — the one common abstraction all four generic file
 * formats are staged through, each returning the SAME `ConnectorResult`
 * shape with real, internally-derived `sourceResource` metadata attached
 * (filename, media type, ACTUAL byte size, ACTUAL file-level content
 * fingerprint — never mislabeled as a cryptographic hash, and never
 * trusted from a caller-supplied field). CSV/JSON/XML dispatch directly to
 * the existing `stageCsvFile`/`stageJsonFile`/`stageXmlFile`; XLSX reads
 * through the injected `readWorkbook` adapter and then feeds the exact
 * same `stageRows` path CSV uses underneath — there is exactly one staging
 * implementation, not four.
 *
 * FVL-04.014 hardening (Session 7, Part A1/A3): the XLSX `contentFingerprint`
 * is computed from the RAW WORKBOOK BYTES (`fingerprintBytes(input.bytes)`),
 * not from the selected sheet's parsed rows — selecting a different sheet
 * of the SAME file produces the identical file-level fingerprint.
 * `resourceName` stays the plain filename; the selected sheet's name is
 * carried separately as `sourceResource.subResourceName`, never folded
 * into `resourceName` itself.
 */
export async function stageFile(sourceSystemId: string, entity: string, input: FileConnectorInput, opts: StageOptions, deps?: FileConnectorDeps): Promise<ConnectorResult> {
  if (input.fileKind === "xlsx") {
    const bytes = input.bytes;
    const baseResource: SourceResourceMetadata = { kind: "file", resourceName: input.fileName, mediaType: MEDIA_TYPES.xlsx, byteSize: bytes.byteLength, contentFingerprint: fingerprintBytes(bytes) };
    if (!deps?.readWorkbook) {
      return emptyResult(sourceSystemId, entity, { code: "xlsx_reader_not_configured", stage: "connect", message: "No workbook-reader adapter was provided for an XLSX file.", retryable: false }, baseResource);
    }
    let sheets: { sheetName: string; rows: string[][] }[];
    try {
      sheets = await deps.readWorkbook(bytes);
    } catch (e) {
      return emptyResult(sourceSystemId, entity, parseFailure("parse", "corrupt_xlsx", "The XLSX file could not be read as a valid workbook.", e), baseResource);
    }
    const sheet = input.sheetName ? sheets.find((s) => s.sheetName === input.sheetName) : sheets[0];
    if (!sheet) {
      return emptyResult(sourceSystemId, entity, { code: "sheet_not_found", stage: "parse", message: `Sheet "${input.sheetName ?? "(first)"}" was not found in the workbook.`, retryable: false }, baseResource);
    }
    const result = stageRows(sourceSystemId, entity, sheet.rows, opts);
    return { ...result, sourceResource: { ...baseResource, subResourceName: sheet.sheetName } };
  }

  const text = input.text;
  const resource: SourceResourceMetadata = { kind: "file", resourceName: input.fileName, mediaType: MEDIA_TYPES[input.fileKind], byteSize: utf8ByteLength(text), contentFingerprint: fingerprint(text) };
  const result =
    input.fileKind === "csv" ? stageCsvFile(sourceSystemId, entity, text, opts)
    : input.fileKind === "json" ? stageJsonFile(sourceSystemId, entity, text, opts)
    : stageXmlFile(sourceSystemId, entity, text, opts);
  return { ...result, sourceResource: resource };
}

/** A logical entity name derived from the filename when the caller hasn't
 *  configured one explicitly — deterministic, structural (strip the
 *  extension), never a guess at business meaning. */
function defaultEntityName(fileName: string): string {
  const stripped = fileName.replace(/\.[^./\\]+$/, "");
  return stripped.length > 0 ? stripped : fileName;
}

/** Same discriminated-union discipline as `FileConnectorInput` above — see
 *  its doc comment. `entity` is the logical entity name for CSV/JSON/XML
 *  sources, which have no sheet/table concept of their own — defaults to
 *  the filename with its extension stripped. Ignored for XLSX, where each
 *  sheet name IS its own entity (see `discoverEntities()` below). */
export interface TextFileConnectorSource {
  fileName: string;
  fileKind: "csv" | "json" | "xml";
  text: string;
  entity?: string;
}
export interface XlsxFileConnectorSource {
  fileName: string;
  fileKind: "xlsx";
  bytes: ArrayBuffer;
  entity?: string;
}
export type FileConnectorSource = TextFileConnectorSource | XlsxFileConnectorSource;

/**
 * FVL-04.014 hardening (Session 7, Part B) — a real `SourceConnector`
 * implementation for generic files, so the common connector contract is
 * something a FILE source genuinely implements, not merely an interface
 * sitting unused next to a standalone `stageFile()` function. Internally
 * reuses `stageFile()`/the existing staging functions — no parser or
 * staging logic is duplicated here.
 */
export function createFileConnector(sourceSystemId: string, source: FileConnectorSource, opts: StageOptions, deps?: FileConnectorDeps): SourceConnector {
  const identity = connectorIdentity(sourceSystemId, "FILE");
  const logicalEntity = source.entity ?? defaultEntityName(source.fileName);

  return {
    identity,
    async discoverEntities(): Promise<string[]> {
      if (source.fileKind !== "xlsx") return [logicalEntity];
      if (!deps?.readWorkbook) return [];
      try {
        const sheets = await deps.readWorkbook(source.bytes);
        return sheets.map((s) => s.sheetName);
      } catch {
        return [];
      }
    },
    async extract(entity: string): Promise<ConnectorResult> {
      const input: FileConnectorInput =
        source.fileKind === "xlsx"
          ? { fileName: source.fileName, fileKind: "xlsx", bytes: source.bytes, sheetName: entity }
          : { fileName: source.fileName, fileKind: source.fileKind, text: source.text };
      return stageFile(sourceSystemId, entity, input, opts, deps);
    },
  };
}
