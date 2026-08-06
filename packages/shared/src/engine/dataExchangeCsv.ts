/**
 * Data Exchange Center — generic CSV generation.
 *
 * One function, driven by a template's column list, produces the blank
 * template, the example-filled template and a current-data export alike —
 * the only difference between the three is which rows are passed in. Reuses
 * `toCsv`'s formula-injection-safe quoting (`importer.ts`) so every export
 * this system produces is exactly as safe to open in Excel as the existing
 * master-data exports.
 */
import { toCsv } from "./importer";
import type { DataExchangeTemplateDefinition } from "./dataExchangeRegistry";

/** UTF-8 BOM so Excel opens the file as UTF-8 instead of guessing a legacy
 *  code page — without it, non-ASCII text (Turkish, accented supplier
 *  names) renders as mojibake the moment a Windows user double-clicks the
 *  file. */
const UTF8_BOM = "﻿";

function exportableHeaders(template: DataExchangeTemplateDefinition): string[] {
  return template.columns.filter((c) => c.exportable).map((c) => c.key);
}

/**
 * Render rows (already keyed by column `key`, as strings) to CSV text for
 * this template's exportable columns, in the template's stable column
 * order — never the order keys happen to appear in a row object.
 */
export function dataExchangeTemplateCsv(
  template: DataExchangeTemplateDefinition,
  rows: Record<string, unknown>[],
): string {
  const headers = exportableHeaders(template);
  return UTF8_BOM + toCsv(headers, rows);
}

/** Header row only — nothing for a user to accidentally ship as "data". */
export function dataExchangeBlankCsv(template: DataExchangeTemplateDefinition): string {
  return dataExchangeTemplateCsv(template, []);
}

/** Header row plus the template's own synthetic example rows. */
export function dataExchangeExampleCsv(template: DataExchangeTemplateDefinition): string {
  return dataExchangeTemplateCsv(template, template.exampleRows);
}

export function dataExchangeCsvFileName(
  template: DataExchangeTemplateDefinition,
  kind: "blank" | "example" | "current-data" | "error-report",
): string {
  return `${template.templateCode}_${kind}.csv`;
}
