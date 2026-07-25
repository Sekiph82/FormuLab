/**
 * Data Exchange Center — deterministic validation, reference resolution and
 * row classification.
 *
 * This is the one place row state is decided for every template. It never
 * calls an LLM: every rule here is a plain, reproducible function of the
 * column definition and the cell text, so the same file always classifies
 * the same way. An AI may explain a validation error to a user elsewhere in
 * the product; it never produces the error itself.
 *
 * Deliberately generic over `Record<string, string>` rows keyed by column
 * `key` — this file knows nothing about `materials`, `formulations` or any
 * other persisted collection shape. The desktop-side commit layer
 * (`apps/desktop/src/lib/dataExchangeCommit.ts`) is what turns a
 * `valid_create`/`valid_update` row into an actual write, using its own
 * per-template field mapping. That separation is what keeps this file a
 * single shared pipeline instead of 24 bespoke ones.
 */
import { parseCsv, desanitizeCell } from "./importer";
import { parseHumanDecimal } from "./decimal";
import type { ApprovalRole } from "../schemas/status";
import type { DataExchangeRowState } from "../schemas/dataExchange";
import type { DataExchangeColumnDefinition, DataExchangeTemplateDefinition } from "./dataExchangeRegistry";

export const DATA_EXCHANGE_MAX_ROWS = 20_000;
export const DATA_EXCHANGE_MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface DataExchangeRowResult {
  rowNumber: number;
  naturalKey: string;
  state: DataExchangeRowState;
  messages: string[];
  /** Values coerced to their column data type, keyed by column key. Decimal/
   *  currency/percentage/integer values are normalized decimal strings so a
   *  commit handler never re-parses human-formatted text. */
  record: Record<string, string>;
}

export interface DataExchangePreview {
  templateCode: string;
  templateSchemaVersion: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  newRecords: number;
  updates: number;
  unchanged: number;
  duplicates: number;
  warnings: number;
  referenceErrors: number;
  requiresReview: number;
  headers: string[];
  unmappedHeaders: string[];
  missingRequiredHeaders: string[];
  rows: DataExchangeRowResult[];
  /** Set when the whole job could not proceed (authorization, empty file,
   *  duplicate/oversized headers, oversized row count) — every row is
   *  reported `unsupported`/`authorization_required` and nothing may be
   *  committed. */
  fatalError?: string;
  /** True only when `fatalError` is an authorization refusal. Callers must
   *  never persist an import-job record (or any other audit trace) for this
   *  case — an unauthorized attempt leaves no trace, by design. Any other
   *  `fatalError` (empty file, bad headers, oversized upload) is a normal,
   *  recordable `validation_failed` outcome. */
  authorizationDenied?: boolean;
}

export interface DataExchangeValidationOptions {
  /** Natural keys already present in the target collection, so a row can be
   *  classified create vs. update. */
  existingNaturalKeys?: ReadonlySet<string>;
  /** Natural keys whose existing record must not be edited in place (a
   *  saved formula version, a frozen dossier requirement, ...). An update
   *  to one of these is reported `invalid`, never silently applied. */
  immutableNaturalKeys?: ReadonlySet<string>;
  /** Given a referenced template's code and the natural-key string a
   *  `code_reference` column points at, report whether it resolves. Absent
   *  entirely, reference columns are only checked for non-emptiness. */
  resolveReference?: (referenceTemplate: string, key: string) => boolean;
  /** Deep-compares a proposed row's mapped record against the existing
   *  one for the same natural key, to tell `unchanged` apart from
   *  `valid_update`. Optional — without it, every match against
   *  `existingNaturalKeys` is reported as an update. */
  isUnchanged?: (naturalKey: string, record: Record<string, string>) => boolean;
  /** The acting human's role. If the template does not authorize it, the
   *  whole job is refused before a single row is parsed. */
  actorRole?: ApprovalRole;
  fileSizeBytes?: number;
}

const BOOLEAN_TRUE = /^(y|yes|true|1|evet|ja|oui)$/i;
const BOOLEAN_FALSE = /^(n|no|false|0|hayir|hayır|nein|non)$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const URL_LIKE = /^https?:\/\/\S+$/i;

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_\-.]+/g, "");

function splitMultiValue(cell: string): string[] {
  return cell
    .split(/[;,|]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Validate one cell against its column definition. Returns the normalized
 * value to store, or an error message. Never throws — a malformed cell is
 * data to report, not a program error.
 */
function validateCell(column: DataExchangeColumnDefinition, raw: string): { value: string } | { error: string } {
  const cell = raw.trim();
  switch (column.dataType) {
    case "string":
    case "file_name":
      return { value: cell };
    case "url":
      if (!URL_LIKE.test(cell)) return { error: `"${cell}" is not a valid http(s) URL.` };
      return { value: cell };
    case "sha256":
      if (!SHA256.test(cell)) return { error: `"${cell}" is not a 64-character SHA-256 hex hash.` };
      return { value: cell.toLowerCase() };
    case "json":
      try {
        JSON.parse(cell);
        return { value: cell };
      } catch {
        return { error: `"${cell}" is not valid JSON.` };
      }
    case "integer": {
      if (!/^-?\d+$/.test(cell)) return { error: `"${cell}" is not a whole number.` };
      const n = Number.parseInt(cell, 10);
      if (column.minimum !== undefined && n < column.minimum) return { error: `${n} is below the minimum of ${column.minimum}.` };
      if (column.maximum !== undefined && n > column.maximum) return { error: `${n} is above the maximum of ${column.maximum}.` };
      return { value: String(n) };
    }
    case "decimal":
    case "currency":
    case "percentage": {
      const d = parseHumanDecimal(cell);
      if (!d) return { error: `"${cell}" is not a number.` };
      const n = d.toNumber();
      if (column.minimum !== undefined && n < column.minimum) return { error: `${n} is below the minimum of ${column.minimum}.` };
      if (column.maximum !== undefined && n > column.maximum) return { error: `${n} is above the maximum of ${column.maximum}.` };
      if (column.dataType === "percentage" && (n < 0 || n > 100)) return { error: `"${cell}" is not a valid percentage (0-100).` };
      return { value: d.toString() };
    }
    case "boolean":
      if (BOOLEAN_TRUE.test(cell)) return { value: "true" };
      if (BOOLEAN_FALSE.test(cell)) return { value: "false" };
      return { error: `"${cell}" is not a recognized yes/no value.` };
    case "date":
      if (!ISO_DATE.test(cell) || Number.isNaN(Date.parse(cell))) return { error: `"${cell}" is not an ISO date (YYYY-MM-DD).` };
      return { value: cell };
    case "datetime":
      if (!ISO_DATETIME.test(cell) || Number.isNaN(Date.parse(cell))) return { error: `"${cell}" is not an ISO datetime.` };
      return { value: cell };
    case "enum": {
      const values = column.enumValues ?? [];
      const match = values.find((v) => v.toLowerCase() === cell.toLowerCase());
      if (!match) return { error: `"${cell}" is not one of: ${values.join(", ")}.` };
      return { value: match };
    }
    case "multi_value":
      return { value: splitMultiValue(cell).join(";") };
    case "code_reference":
      return { value: cell };
    default:
      return { value: cell };
  }
}

function naturalKeyOf(template: DataExchangeTemplateDefinition, record: Record<string, string>): string {
  return template.naturalKey.map((k) => record[k] ?? "").join("::");
}

/**
 * Parse, validate, resolve references and classify every row of an already
 * split spreadsheet (`string[][]`, from `parseCsv` or a `.xlsx` reader —
 * both feed this identically). Never writes anything; that is the whole
 * point of a preview.
 */
export function previewDataExchangeImport(
  template: DataExchangeTemplateDefinition,
  rawRows: string[][],
  opts: DataExchangeValidationOptions = {},
): DataExchangePreview {
  const empty = (): DataExchangePreview => ({
    templateCode: template.templateCode,
    templateSchemaVersion: template.schemaVersion,
    totalRows: 0,
    validRows: 0,
    invalidRows: 0,
    newRecords: 0,
    updates: 0,
    unchanged: 0,
    duplicates: 0,
    warnings: 0,
    referenceErrors: 0,
    requiresReview: 0,
    headers: [],
    unmappedHeaders: [],
    missingRequiredHeaders: [],
    rows: [],
  });

  if (!template.enabled) {
    return { ...empty(), fatalError: template.disabledReason ?? `Template "${template.templateCode}" is disabled.` };
  }
  if (opts.actorRole && !template.authorization.includes(opts.actorRole)) {
    return { ...empty(), fatalError: `Role "${opts.actorRole}" is not authorized to import "${template.title}".`, authorizationDenied: true };
  }
  if (opts.fileSizeBytes !== undefined && opts.fileSizeBytes > DATA_EXCHANGE_MAX_FILE_BYTES) {
    return { ...empty(), fatalError: `File is larger than the ${Math.round(DATA_EXCHANGE_MAX_FILE_BYTES / (1024 * 1024))} MB limit.` };
  }
  if (rawRows.length === 0) {
    return { ...empty(), fatalError: "The file is empty." };
  }
  if (rawRows.length - 1 > DATA_EXCHANGE_MAX_ROWS) {
    return { ...empty(), fatalError: `The file has ${rawRows.length - 1} data rows, more than the ${DATA_EXCHANGE_MAX_ROWS} limit.` };
  }

  const headers = rawRows[0].map((h) => desanitizeCell(h).trim());
  const normalizedHeaders = headers.map(norm);
  const dupHeader = normalizedHeaders.find((h, i) => h && normalizedHeaders.indexOf(h) !== i);
  if (dupHeader) {
    return { ...empty(), headers, fatalError: `Column "${headers[normalizedHeaders.indexOf(dupHeader)]}" appears more than once in the header row.` };
  }

  const indexByColumnKey = new Map<string, number>();
  const unmappedHeaders: string[] = [];
  headers.forEach((h, i) => {
    const c = template.columns.find((col) => norm(col.key) === norm(h) || norm(col.header) === norm(h));
    if (c) indexByColumnKey.set(c.key, i);
    else if (h) unmappedHeaders.push(h);
  });

  const missingRequiredHeaders = template.columns
    .filter((c) => c.required && !indexByColumnKey.has(c.key))
    .map((c) => c.key);
  if (missingRequiredHeaders.length > 0) {
    return {
      ...empty(),
      headers,
      unmappedHeaders,
      missingRequiredHeaders,
      fatalError: `Required column(s) missing: ${missingRequiredHeaders.join(", ")}.`,
    };
  }

  const seenInFile = new Set<string>();
  const rows: DataExchangeRowResult[] = [];

  for (let r = 1; r < rawRows.length; r++) {
    const rowNumber = r + 1; // 1-based, header counted as row 1
    const record: Record<string, string> = {};
    const messages: string[] = [];
    let hasError = false;
    let hasReferenceError = false;
    let hasWarning = false;

    for (const column of template.columns) {
      const idx = indexByColumnKey.get(column.key);
      const rawCell = idx !== undefined ? desanitizeCell(rawRows[r][idx] ?? "").trim() : "";
      if (rawCell === "") {
        if (column.required) {
          messages.push(`"${column.key}" is required and is empty.`);
          hasError = true;
        } else if (column.defaultValue !== undefined) {
          record[column.key] = column.defaultValue;
        }
        continue;
      }
      const result = validateCell(column, rawCell);
      if ("error" in result) {
        messages.push(`"${column.key}": ${result.error}`);
        hasError = true;
        continue;
      }
      record[column.key] = result.value;

      if (column.dataType === "code_reference" && column.referenceTemplate && opts.resolveReference) {
        const referenced = column.referenceTemplate === template.templateCode ? true : opts.resolveReference(column.referenceTemplate, result.value);
        if (!referenced) {
          const msg = `"${column.key}" references "${result.value}", which does not exist in ${column.referenceTemplate}.`;
          if (column.required) {
            messages.push(msg);
            hasReferenceError = true;
          } else {
            // An optional reference that does not resolve yet is a soft
            // warning, not a blocker — the row can still be committed and
            // the reference filled in later.
            messages.push(`${msg} (optional — the row can still be imported.)`);
            hasWarning = true;
          }
        }
      }
    }

    const naturalKey = naturalKeyOf(template, record);
    if (!naturalKey.replace(/:/g, "")) {
      messages.push("Natural key is empty — this row cannot be matched safely.");
      hasError = true;
    } else if (seenInFile.has(naturalKey)) {
      rows.push({ rowNumber, naturalKey, state: "duplicate", messages: [...messages, `Natural key "${naturalKey}" appears more than once in this file.`], record });
      continue;
    }
    seenInFile.add(naturalKey);

    if (hasError) {
      rows.push({ rowNumber, naturalKey, state: "invalid", messages, record });
      continue;
    }
    if (hasReferenceError) {
      rows.push({ rowNumber, naturalKey, state: "reference_missing", messages, record });
      continue;
    }

    const exists = opts.existingNaturalKeys?.has(naturalKey) ?? false;
    if (exists && opts.immutableNaturalKeys?.has(naturalKey)) {
      rows.push({
        rowNumber,
        naturalKey,
        state: "invalid",
        messages: [...messages, `"${naturalKey}" already exists and is immutable under this template's update policy (${template.updatePolicy}).`],
        record,
      });
      continue;
    }
    if (exists && opts.isUnchanged?.(naturalKey, record)) {
      rows.push({ rowNumber, naturalKey, state: "unchanged", messages, record });
      continue;
    }
    if (hasWarning || messages.length > 0) {
      rows.push({ rowNumber, naturalKey, state: "warning", messages, record });
      continue;
    }
    rows.push({ rowNumber, naturalKey, state: exists ? "valid_update" : "valid_create", messages, record });
  }

  const count = (s: DataExchangeRowState) => rows.filter((r) => r.state === s).length;
  const validStates: DataExchangeRowState[] = ["valid_create", "valid_update", "unchanged", "warning"];

  return {
    templateCode: template.templateCode,
    templateSchemaVersion: template.schemaVersion,
    totalRows: rows.length,
    validRows: rows.filter((r) => validStates.includes(r.state)).length,
    invalidRows: count("invalid"),
    newRecords: count("valid_create"),
    updates: count("valid_update"),
    unchanged: count("unchanged"),
    duplicates: count("duplicate"),
    warnings: count("warning"),
    referenceErrors: count("reference_missing"),
    requiresReview: count("authorization_required"),
    headers,
    unmappedHeaders,
    missingRequiredHeaders: [],
    rows,
  };
}

/** Also accepts raw CSV text, for callers that have not already split it. */
export function previewDataExchangeImportCsv(
  template: DataExchangeTemplateDefinition,
  text: string,
  opts: DataExchangeValidationOptions = {},
): DataExchangePreview {
  return previewDataExchangeImport(template, parseCsv(text), opts);
}
