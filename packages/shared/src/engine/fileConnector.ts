/**
 * FVL-04.014 — the generic file connector (CSV/XLSX/JSON/XML) into Source
 * Staging. Reuses the existing `parseCsv` (the same parser Data Exchange's
 * own CSV path already uses) rather than writing a second one. Accepts
 * arbitrary customer field names verbatim — no FormuLab canonical column
 * name is ever required or assumed here; that translation is
 * FVL-04.016/.018's job, strictly later.
 *
 * FVL-04.014 hardening (Part B): all four formats are now exposed through
 * one common `stageFile()` abstraction (B2), which also attaches real
 * source-resource metadata — filename, media type, byte size, and a
 * deterministic content fingerprint (B1) — to `ConnectorResult.sourceResource`.
 * XLSX still needs ExcelJS/ArrayBuffer, desktop-only, so `stageFile()`
 * accepts a small injected `readWorkbook` adapter rather than importing
 * ExcelJS into the shared package; `apps/desktop/src/lib/xlsx.ts`'s
 * `readWorkbookAllSheets` is the real adapter used in production and in
 * `connectorEndToEnd.test.ts`. Every format still funnels into the exact
 * same `stageRows`/staging path underneath (B5) — there is exactly one
 * staging implementation, not four parallel ones.
 */
import { parseCsv } from "./importer";
import { fingerprint } from "./connectorFingerprint";
import { parseXml, detectRepeatedElements, flattenXmlRecord, UnsafeXmlError } from "./xmlParser";
import type { ConnectorError, ConnectorIdentity, ConnectorResult, SourceResourceMetadata, StagedSourceRecord } from "../schemas/connector";

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
   *  of silently falling back to an ordinal identity (FVL-04.014
   *  hardening, §8/B4) — for a source where the caller has explicitly
   *  declared that every record MUST carry a real external ID. */
  requireExplicitId?: boolean;
  extractionRunId: string;
  extractedAt?: string;
}

function connectorIdentity(sourceSystemId: string, connectorType: ConnectorIdentity["connectorType"]): ConnectorIdentity {
  return { connectorId: `file-connector`, connectorType, connectorVersion: "1.0", sourceSystemId, sourceSystemName: sourceSystemId };
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
export function stageRows(sourceSystemId: string, entity: string, rows: string[][], opts: StageOptions): ConnectorResult {
  const errors: ConnectorError[] = [];
  const warnings: ConnectorError[] = [];
  if (rows.length === 0) {
    errors.push({ code: "empty_file", stage: "parse", message: "The file has no rows.", retryable: false });
    return { connector: connectorIdentity(sourceSystemId, "FILE"), entity, records: [], warnings, errors, stats: { totalRecords: 0, readRecords: 0, errorRecords: 0 } };
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
    connector: connectorIdentity(sourceSystemId, "FILE"),
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
    return emptyResult(sourceSystemId, entity, { code: "malformed_csv", stage: "parse", message: String(e instanceof Error ? e.message : e), retryable: false });
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
    return emptyResult(sourceSystemId, entity, { code: "malformed_json", stage: "parse", message: String(e instanceof Error ? e.message : e), retryable: false });
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
    return emptyResult(sourceSystemId, entity, { code: unsafe ? "unsafe_xml_entities" : "malformed_xml", stage: "parse", message: String(e instanceof Error ? e.message : e), retryable: false });
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

export interface FileConnectorInput {
  fileName: string;
  fileKind: FileKind;
  byteSize: number;
  /** Raw text content — required for csv/json/xml, ignored for xlsx. */
  text?: string;
  /** Raw workbook bytes — required for xlsx, ignored otherwise. Read only
   *  through the injected `readWorkbook` adapter, never parsed directly by
   *  this shared-package function (ExcelJS is a desktop-only dependency). */
  bytes?: ArrayBuffer;
  /** Which sheet to stage, for xlsx — defaults to the workbook's first
   *  sheet. Each sheet is its own source entity; call `stageFile` once per
   *  sheet to stage a multi-sheet workbook, never auto-merged. */
  sheetName?: string;
}

export interface FileConnectorDeps {
  /** The real adapter is `apps/desktop/src/lib/xlsx.ts`'s
   *  `readWorkbookAllSheets` — injected so this shared-package module never
   *  imports ExcelJS directly. A rejected/thrown promise (a genuinely
   *  corrupt workbook) is caught and reported as a structured
   *  `corrupt_xlsx` error, never a raw leaked exception (FVL-04.014
   *  hardening, B3). */
  readWorkbook: (bytes: ArrayBuffer) => Promise<{ sheetName: string; rows: string[][] }[]>;
}

/**
 * FVL-04.014 hardening (B1/B2/B5) — the one common abstraction all four
 * generic file formats are staged through, each returning the SAME
 * `ConnectorResult` shape with real `sourceResource` metadata attached
 * (filename, media type, byte size, deterministic content fingerprint —
 * never mislabeled as a cryptographic hash). CSV/JSON/XML dispatch
 * directly to the existing `stageCsvFile`/`stageJsonFile`/`stageXmlFile`;
 * XLSX reads through the injected `readWorkbook` adapter and then feeds
 * the exact same `stageRows` path CSV uses underneath — there is exactly
 * one staging implementation, not four.
 */
export async function stageFile(sourceSystemId: string, entity: string, input: FileConnectorInput, opts: StageOptions, deps?: FileConnectorDeps): Promise<ConnectorResult> {
  const baseResource: SourceResourceMetadata = { kind: "file", resourceName: input.fileName, mediaType: MEDIA_TYPES[input.fileKind], byteSize: input.byteSize };

  if (input.fileKind === "xlsx") {
    if (!deps?.readWorkbook) {
      return emptyResult(sourceSystemId, entity, { code: "xlsx_reader_not_configured", stage: "connect", message: "No workbook-reader adapter was provided for an XLSX file.", retryable: false }, baseResource);
    }
    let sheets: { sheetName: string; rows: string[][] }[];
    try {
      sheets = await deps.readWorkbook(input.bytes ?? new ArrayBuffer(0));
    } catch (e) {
      return emptyResult(sourceSystemId, entity, { code: "corrupt_xlsx", stage: "parse", message: String(e instanceof Error ? e.message : e), retryable: false }, baseResource);
    }
    const sheet = input.sheetName ? sheets.find((s) => s.sheetName === input.sheetName) : sheets[0];
    if (!sheet) {
      return emptyResult(sourceSystemId, entity, { code: "sheet_not_found", stage: "parse", message: `Sheet "${input.sheetName ?? "(first)"}" was not found in the workbook.`, retryable: false }, baseResource);
    }
    const result = stageRows(sourceSystemId, entity, sheet.rows, opts);
    return { ...result, sourceResource: { ...baseResource, resourceName: `${input.fileName}#${sheet.sheetName}`, contentFingerprint: fingerprint(JSON.stringify(sheet.rows)) } };
  }

  const text = input.text ?? "";
  const contentFingerprint = fingerprint(text);
  const resource: SourceResourceMetadata = { ...baseResource, contentFingerprint };
  const result =
    input.fileKind === "csv" ? stageCsvFile(sourceSystemId, entity, text, opts)
    : input.fileKind === "json" ? stageJsonFile(sourceSystemId, entity, text, opts)
    : stageXmlFile(sourceSystemId, entity, text, opts);
  return { ...result, sourceResource: resource };
}
