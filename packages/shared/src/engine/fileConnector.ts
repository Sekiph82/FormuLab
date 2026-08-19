/**
 * FVL-04.014 — the generic file connector (CSV/XLSX/JSON/XML) into Source
 * Staging. Reuses the existing `parseCsv` (the same parser Data Exchange's
 * own CSV path already uses) rather than writing a second one. Accepts
 * arbitrary customer field names verbatim — no FormuLab canonical column
 * name is ever required or assumed here; that translation is
 * FVL-04.016/.018's job, strictly later.
 *
 * XLSX staging lives in `apps/desktop/src/lib/xlsx.ts`
 * (`readWorkbookAllSheets`) since it needs ExcelJS/ArrayBuffer, desktop-only
 * — its rows are fed through `stageRows` below, the exact same row-shaped
 * path CSV uses, so both share one staging implementation.
 */
import { parseCsv } from "./importer";
import { fingerprint } from "./connectorFingerprint";
import { parseXml, detectRepeatedElements, flattenXmlRecord, UnsafeXmlError } from "./xmlParser";
import type { ConnectorError, ConnectorIdentity, ConnectorResult, StagedSourceRecord } from "../schemas/connector";

export interface StageOptions {
  /** Which field/column identifies a record; when absent, the row's own
   *  1-based ordinal position is used — an honest, stable, deterministic
   *  fallback, never a fabricated business identifier. */
  idField?: string;
  extractionRunId: string;
  extractedAt?: string;
}

function connectorIdentity(sourceSystemId: string, connectorType: ConnectorIdentity["connectorType"]): ConnectorIdentity {
  return { connectorId: `file-connector`, connectorType, connectorVersion: "1.0", sourceSystemId, sourceSystemName: sourceSystemId };
}

function toStaged(
  sourceSystemId: string,
  entity: string,
  ordinal: number,
  fields: Record<string, string | null>,
  opts: StageOptions,
  connectorVersion: string,
): StagedSourceRecord {
  const sourceRecordId = opts.idField && fields[opts.idField] ? fields[opts.idField]! : String(ordinal);
  const extractedAt = opts.extractedAt ?? new Date().toISOString();
  return {
    identity: { sourceEntity: entity, sourceRecordId },
    fields,
    lineage: {
      sourceSystemId,
      sourceEntity: entity,
      sourceRecordId,
      extractionRunId: opts.extractionRunId,
      connectorVersion,
      rawRecordFingerprint: fingerprint(JSON.stringify(fields)),
    },
    extraction: { extractedAt, extractionRunId: opts.extractionRunId },
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
    records.push(toStaged(sourceSystemId, entity, r, fields, opts, "1.0"));
  }
  return {
    connector: connectorIdentity(sourceSystemId, "FILE"),
    entity,
    records,
    warnings,
    errors,
    stats: { totalRecords: rows.length - 1, readRecords: records.length, errorRecords: 0 },
  };
}

export function stageCsvFile(sourceSystemId: string, entity: string, csvText: string, opts: StageOptions): ConnectorResult {
  let rows: string[][];
  try {
    rows = parseCsv(csvText);
  } catch (e) {
    return {
      connector: connectorIdentity(sourceSystemId, "FILE"),
      entity,
      records: [],
      warnings: [],
      errors: [{ code: "malformed_csv", stage: "parse", message: String(e instanceof Error ? e.message : e), retryable: false }],
      stats: { totalRecords: 0, readRecords: 0, errorRecords: 1 },
    };
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
    return {
      connector: connectorIdentity(sourceSystemId, "FILE"),
      entity,
      records: [],
      warnings: [],
      errors: [{ code: "malformed_json", stage: "parse", message: String(e instanceof Error ? e.message : e), retryable: false }],
      stats: { totalRecords: 0, readRecords: 0, errorRecords: 1 },
    };
  }
  const arr = findRecordArray(parsed);
  if (!arr) {
    return {
      connector: connectorIdentity(sourceSystemId, "FILE"),
      entity,
      records: [],
      warnings: [],
      errors: [{ code: "no_record_array", stage: "parse", message: "No array of records found at the root or as a top-level property.", retryable: false }],
      stats: { totalRecords: 0, readRecords: 0, errorRecords: 1 },
    };
  }
  const records = arr.map((item, idx) => toStaged(sourceSystemId, entity, idx + 1, flattenJson(item), opts, "1.0"));
  return {
    connector: connectorIdentity(sourceSystemId, "FILE"),
    entity,
    records,
    warnings: [],
    errors: [],
    stats: { totalRecords: arr.length, readRecords: records.length, errorRecords: 0 },
  };
}

export function stageXmlFile(sourceSystemId: string, entity: string, xmlText: string, opts: StageOptions & { recordTag?: string }): ConnectorResult {
  let root;
  try {
    root = parseXml(xmlText);
  } catch (e) {
    const unsafe = e instanceof UnsafeXmlError;
    return {
      connector: connectorIdentity(sourceSystemId, "FILE"),
      entity,
      records: [],
      warnings: [],
      errors: [{ code: unsafe ? "unsafe_xml_entities" : "malformed_xml", stage: "parse", message: String(e instanceof Error ? e.message : e), retryable: false }],
      stats: { totalRecords: 0, readRecords: 0, errorRecords: 1 },
    };
  }
  const recordElements = opts.recordTag
    ? collectByTag(root, opts.recordTag)
    : detectRepeatedElements(root);
  if (recordElements.length === 0) {
    return {
      connector: connectorIdentity(sourceSystemId, "FILE"),
      entity,
      records: [],
      warnings: [],
      errors: [{ code: "no_repeated_record_elements", stage: "parse", message: "No repeated sibling elements found to treat as records — pass recordTag explicitly.", retryable: false }],
      stats: { totalRecords: 0, readRecords: 0, errorRecords: 1 },
    };
  }
  const records = recordElements.map((el, idx) => toStaged(sourceSystemId, entity, idx + 1, flattenXmlRecord(el), opts, "1.0"));
  return {
    connector: connectorIdentity(sourceSystemId, "FILE"),
    entity,
    records,
    warnings: [],
    errors: [],
    stats: { totalRecords: recordElements.length, readRecords: records.length, errorRecords: 0 },
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
