import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { getDataExchangeTemplate } from "@formulab/shared";
import { readWorkbookRows, rejectUnsupportedWorkbook } from "./xlsx";
import { buildDataExchangeWorkbook, dataExchangeXlsxFileName } from "./dataExchangeXlsx";

const materials = getDataExchangeTemplate("raw_materials")!;
const suppliers = getDataExchangeTemplate("suppliers")!;

describe("buildDataExchangeWorkbook", () => {
  it("produces a real .xlsx with the four expected sheets, Data first", async () => {
    const buf = await buildDataExchangeWorkbook(materials, []);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(["Data", "Validation Lists", "Field Documentation", "Schema Metadata"]);
  });

  it("writes the header row in the template's stable column order", async () => {
    const buf = await buildDataExchangeWorkbook(materials, []);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const data = wb.getWorksheet("Data")!;
    const headerValues = data.getRow(1).values as unknown[];
    // ExcelJS row.values is 1-indexed with a leading empty slot.
    const headers = headerValues.slice(1) as string[];
    expect(headers).toEqual(materials.columns.filter((c) => c.exportable).map((c) => c.key));
  });

  it("freezes the header row", async () => {
    const buf = await buildDataExchangeWorkbook(materials, []);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const data = wb.getWorksheet("Data")!;
    const view = data.views[0] as { state?: string; ySplit?: number } | undefined;
    expect(view?.state).toBe("frozen");
    expect(view?.ySplit).toBe(1);
  });

  it("writes example rows into the Data sheet", async () => {
    const buf = await buildDataExchangeWorkbook(materials, materials.exampleRows);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const data = wb.getWorksheet("Data")!;
    // rowCount reports the highest row touched, which includes the extra
    // blank rows pre-wired with dropdown validation for a user to keep
    // typing into — so it is always >= the data itself, not exactly equal.
    expect(data.rowCount).toBeGreaterThanOrEqual(1 + materials.exampleRows.length);
    const codeColIndex = materials.columns.filter((c) => c.exportable).findIndex((c) => c.key === "material_code") + 1;
    expect(data.getRow(2).getCell(codeColIndex).text).toBe("TEST-MAT-001");
    expect(data.getRow(1 + materials.exampleRows.length + 1).getCell(codeColIndex).text).toBe("");
  });

  it("documents every column, including non-exportable ones, on the Field Documentation sheet", async () => {
    const buf = await buildDataExchangeWorkbook(materials, []);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const doc = wb.getWorksheet("Field Documentation")!;
    expect(doc.rowCount).toBe(1 + materials.columns.length);
  });

  it("lists enum values on the Validation Lists sheet for every enum column", async () => {
    const buf = await buildDataExchangeWorkbook(materials, []);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const list = wb.getWorksheet("Validation Lists")!;
    const currencyColIndex = materials.columns.filter((c) => c.dataType === "enum" && (c.enumValues?.length ?? 0) > 0).findIndex((c) => c.key === "currency") + 1;
    expect(list.getCell(1, currencyColIndex).value).toBe("currency");
    expect(list.getCell(2, currencyColIndex).value).toBe("KES");
  });

  it("wires a dropdown data validation on the Data sheet for an enum column", async () => {
    const buf = await buildDataExchangeWorkbook(materials, []);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const data = wb.getWorksheet("Data")!;
    const currencyColIndex = materials.columns.filter((c) => c.exportable).findIndex((c) => c.key === "currency") + 1;
    const dv = data.getCell(2, currencyColIndex).dataValidation;
    expect(dv?.type).toBe("list");
    expect(dv?.formulae?.[0]).toContain("Validation Lists");
  });

  it("records schema metadata identifying the template and version", async () => {
    const buf = await buildDataExchangeWorkbook(suppliers, []);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const meta = wb.getWorksheet("Schema Metadata")!;
    const rows = meta.getRows(2, meta.rowCount - 1) ?? [];
    const asPairs = rows.map((r) => [r.getCell(1).text, r.getCell(2).text]);
    expect(asPairs).toContainEqual(["Template code", "suppliers"]);
    expect(asPairs).toContainEqual(["Schema version", "1.0"]);
  });

  it("round-trips through the existing generic .xlsx row reader", async () => {
    const buf = await buildDataExchangeWorkbook(materials, materials.exampleRows);
    const rows = await readWorkbookRows(buf);
    expect(rows[0]).toEqual(materials.columns.filter((c) => c.exportable).map((c) => c.key));
    const codeCol = materials.columns.filter((c) => c.exportable).findIndex((c) => c.key === "material_code");
    expect(rows[1][codeCol]).toBe("TEST-MAT-001");
  });

  it("neutralises formula-injection triggers when writing cell text", async () => {
    const buf = await buildDataExchangeWorkbook(materials, [{ material_code: "TEST-MAT-009", material_name: "=SUM(A1:A9)" }]);
    const rows = await readWorkbookRows(buf);
    const nameCol = materials.columns.filter((c) => c.exportable).findIndex((c) => c.key === "material_name");
    expect(rows[1][nameCol]).toBe("'=SUM(A1:A9)");
  });
});

describe("dataExchangeXlsxFileName", () => {
  it("names files by template code and kind", () => {
    expect(dataExchangeXlsxFileName(materials, "blank")).toBe("raw_materials_blank.xlsx");
    expect(dataExchangeXlsxFileName(materials, "example")).toBe("raw_materials_example.xlsx");
  });
});

describe("malformed workbook rejection (reused from the existing engine)", () => {
  it("rejects legacy/macro-enabled extensions before any parse is attempted", () => {
    expect(rejectUnsupportedWorkbook("materials.xlsm")).toMatch(/xlsm/);
    expect(rejectUnsupportedWorkbook("materials.xls")).toMatch(/xls/);
    expect(rejectUnsupportedWorkbook("materials.xlsx")).toBeNull();
  });
});
