/**
 * Data Exchange Center — generic multi-sheet .xlsx generation.
 *
 * One function, driven by a template's column list, builds every workbook
 * this system produces (blank, example-filled, current-data export) — real
 * ExcelJS workbooks, never a renamed CSV. Every workbook carries the same
 * four sheets: "Data" (the importable content — frozen header row,
 * autofilter, required columns highlighted, dropdown validation for enum
 * columns, date/number formatting), "Field Documentation" (every column's
 * type/required/description/example), "Validation Lists" (the enum value
 * lists the Data sheet's dropdowns point at) and "Schema Metadata" (which
 * template, which schema version, when it was generated).
 *
 * "Data" is always the first sheet, so `readWorkbookRows` (`./xlsx.ts`,
 * which reads `wb.worksheets[0]`) parses a Data Exchange workbook exactly
 * like any other `.xlsx` import — one reader, not two.
 */
import ExcelJS from "exceljs";
import { sanitizeCell, type DataExchangeTemplateDefinition } from "@ai4s/shared";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
const REQUIRED_HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFB91C1C" } };

function numberFormatFor(dataType: DataExchangeTemplateDefinition["columns"][number]["dataType"]): string | undefined {
  switch (dataType) {
    case "date":
      return "yyyy-mm-dd";
    case "datetime":
      return "yyyy-mm-dd hh:mm";
    case "integer":
      return "0";
    case "decimal":
    case "currency":
      return "0.00";
    case "percentage":
      return "0.00\"%\"";
    default:
      return undefined;
  }
}

/** Build the real, multi-sheet .xlsx workbook for a template: the "Data"
 *  sheet holding `rows` (already keyed by column `key`, as plain strings —
 *  the same shape the CSV engine takes), plus documentation/validation/
 *  metadata sheets generated purely from the column definitions. */
export async function buildDataExchangeWorkbook(
  template: DataExchangeTemplateDefinition,
  rows: Record<string, unknown>[],
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FormuLab";
  wb.created = new Date();

  const exportableCols = template.columns.filter((c) => c.exportable);

  // ------------------------------------------------------------ Data sheet ---
  const dataSheet = wb.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1 }] });
  dataSheet.columns = exportableCols.map((c) => ({
    header: c.header,
    key: c.key,
    width: Math.max(14, Math.min(42, c.key.length + 6)),
  }));
  for (const row of rows) {
    dataSheet.addRow(Object.fromEntries(exportableCols.map((c) => [c.key, sanitizeCell(row[c.key])])));
  }
  const headerRow = dataSheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = HEADER_FILL;
  dataSheet.autoFilter = exportableCols.length > 0 ? { from: { row: 1, column: 1 }, to: { row: 1, column: exportableCols.length } } : undefined;

  const enumColumns = exportableCols.filter((c) => c.dataType === "enum" && (c.enumValues?.length ?? 0) > 0);

  exportableCols.forEach((c, i) => {
    const colNum = i + 1;
    if (c.required) headerRow.getCell(colNum).font = REQUIRED_HEADER_FONT;
    const fmt = numberFormatFor(c.dataType);
    if (fmt) dataSheet.getColumn(colNum).numFmt = fmt;
  });

  // -------------------------------------------------- Validation Lists sheet ---
  // Built before wiring dropdowns on the Data sheet so the column letters exist.
  let listSheet: ExcelJS.Worksheet | undefined;
  const listColumnLetter = new Map<string, string>();
  if (enumColumns.length > 0) {
    listSheet = wb.addWorksheet("Validation Lists");
    enumColumns.forEach((c, i) => {
      const colNum = i + 1;
      const headerCell = listSheet!.getCell(1, colNum);
      headerCell.value = c.key;
      headerCell.font = { bold: true };
      (c.enumValues ?? []).forEach((v, j) => {
        listSheet!.getCell(j + 2, colNum).value = v;
      });
      listColumnLetter.set(c.key, listSheet!.getColumn(colNum).letter);
    });
  }

  if (listSheet) {
    exportableCols.forEach((c, i) => {
      if (c.dataType !== "enum" || !c.enumValues?.length) return;
      const letter = listColumnLetter.get(c.key);
      if (!letter) return;
      const formula = `'Validation Lists'!$${letter}$2:$${letter}$${c.enumValues.length + 1}`;
      const lastRow = Math.max(rows.length, 200) + 1; // leave room to type more rows in Excel
      for (let r = 2; r <= lastRow; r++) {
        dataSheet.getCell(r, i + 1).dataValidation = {
          type: "list",
          allowBlank: !c.required,
          formulae: [formula],
          showErrorMessage: true,
          errorTitle: "Invalid value",
          error: `Must be one of: ${c.enumValues.join(", ")}`,
        };
      }
    });
  }

  // ------------------------------------------------ Field Documentation sheet ---
  const docSheet = wb.addWorksheet("Field Documentation");
  docSheet.columns = [
    { header: "Column", key: "key", width: 28 },
    { header: "Required", key: "required", width: 10 },
    { header: "Data Type", key: "dataType", width: 14 },
    { header: "Description", key: "description", width: 64 },
    { header: "Example", key: "example", width: 26 },
    { header: "Allowed Values", key: "enum", width: 40 },
  ];
  docSheet.getRow(1).font = { bold: true };
  docSheet.getRow(1).fill = HEADER_FILL;
  for (const c of template.columns) {
    docSheet.addRow({
      key: c.key,
      required: c.required ? "Yes" : "No",
      dataType: c.dataType,
      description: c.description,
      example: c.example ?? "",
      enum: c.enumValues ? c.enumValues.join(", ") : "",
    });
  }

  // ------------------------------------------------------ Schema Metadata sheet ---
  const metaSheet = wb.addWorksheet("Schema Metadata");
  metaSheet.columns = [
    { header: "Field", key: "field", width: 22 },
    { header: "Value", key: "value", width: 60 },
  ];
  metaSheet.getRow(1).font = { bold: true };
  metaSheet.getRow(1).fill = HEADER_FILL;
  metaSheet.addRows([
    { field: "Template code", value: template.templateCode },
    { field: "Title", value: template.title },
    { field: "Module", value: template.module },
    { field: "Schema version", value: template.schemaVersion },
    { field: "Natural key", value: template.naturalKey.join(", ") },
    { field: "Duplicate policy", value: template.duplicatePolicy },
    { field: "Update policy", value: template.updatePolicy },
    { field: "Generated at", value: new Date().toISOString() },
  ]);

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function buildDataExchangeWorkbookBlob(
  template: DataExchangeTemplateDefinition,
  rows: Record<string, unknown>[],
): Promise<Blob> {
  const buf = await buildDataExchangeWorkbook(template, rows);
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function dataExchangeXlsxFileName(
  template: DataExchangeTemplateDefinition,
  kind: "blank" | "example" | "current-data" | "error-report",
): string {
  return `${template.templateCode}_${kind}.xlsx`;
}
