import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { stageFile } from "@formulab/shared";
import { buildXlsxBuffer, readWorkbookAllSheets, readWorkbookRows, rejectUnsupportedWorkbook, workbookSheets } from "./xlsx";

async function toBytes(build: (wb: ExcelJS.Workbook) => void): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

describe("workbookSheets", () => {
  it("renders every sheet to an HTML table, keeping merged cells as spans", async () => {
    const bytes = await toBytes((wb) => {
      const ws = wb.addWorksheet("Data");
      ws.getCell("A1").value = "Report title";
      ws.mergeCells("A1:B1");
      ws.getCell("A2").value = "name";
      ws.getCell("B2").value = "value";
      ws.getCell("A3").value = "moon";
      ws.getCell("B3").value = 42;
      wb.addWorksheet("Notes").getCell("A1").value = "only one cell";
    });
    const sheets = await workbookSheets(bytes);

    expect(sheets.map((s) => s.name)).toEqual(["Data", "Notes"]);
    expect(sheets[0].html).toContain("<table");
    expect(sheets[0].html).toContain("Report title");
    expect(sheets[0].html).toMatch(/colspan="2"/);
    expect(sheets[0].truncated).toBe(false);
    expect(sheets[1].html).toContain("only one cell");
  });

  it("preserves cell fill, font color/size, and bold as inline styles", async () => {
    const bytes = await toBytes((wb) => {
      const ws = wb.addWorksheet("S");
      const cell = ws.getCell("A1");
      cell.value = "Header";
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC45038" } };
      cell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    });
    const html = (await workbookSheets(bytes))[0].html;
    expect(html).toContain("background:#C45038");
    expect(html).toContain("color:#FFFFFF");
    expect(html).toMatch(/font-size:18(\.\d+)?px/); // 14pt → px
    expect(html).toContain("font-weight:600");
  });

  it("escapes HTML in cell values", async () => {
    const bytes = await toBytes((wb) => {
      wb.addWorksheet("S").getCell("A1").value = "<img src=x>";
    });
    expect((await workbookSheets(bytes))[0].html).not.toContain("<img");
  });
});

describe("readWorkbookRows", () => {
  it("reads the first worksheet as string rows, numbers included", async () => {
    const bytes = await toBytes((wb) => {
      const ws = wb.addWorksheet("Materials");
      ws.addRow(["code", "displayName", "activeMatterPercent"]);
      ws.addRow(["M-1", "SLES 70", 70]);
    });
    const rows = await readWorkbookRows(bytes);
    expect(rows).toEqual([
      ["code", "displayName", "activeMatterPercent"],
      ["M-1", "SLES 70", "70"],
    ]);
  });

  it("skips fully blank rows", async () => {
    const bytes = await toBytes((wb) => {
      const ws = wb.addWorksheet("S");
      ws.addRow(["a", "b"]);
      ws.addRow([]);
      ws.addRow(["c", "d"]);
    });
    expect(await readWorkbookRows(bytes)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("returns nothing for a workbook with no sheets", async () => {
    const bytes = await toBytes(() => {});
    expect(await readWorkbookRows(bytes)).toEqual([]);
  });
});

describe("readWorkbookAllSheets — FVL-04.014", () => {
  it("XLSX2: two sheets with genuinely different schemas stay distinct, never implicitly merged", async () => {
    const bytes = await toBytes((wb) => {
      const materials = wb.addWorksheet("Materials");
      materials.addRow(["Chemical_ID", "Chemical_Name"]);
      materials.addRow(["883729", "Decyl Glucoside"]);
      const suppliers = wb.addWorksheet("Suppliers");
      suppliers.addRow(["Vendor_ID", "Vendor_Name", "Currency"]);
      suppliers.addRow(["V-441", "ABC Chemicals", "USD"]);
    });
    const sheets = await readWorkbookAllSheets(bytes);
    expect(sheets).toHaveLength(2);
    expect(sheets[0]).toEqual({ sheetName: "Materials", rows: [["Chemical_ID", "Chemical_Name"], ["883729", "Decyl Glucoside"]] });
    expect(sheets[1]).toEqual({ sheetName: "Suppliers", rows: [["Vendor_ID", "Vendor_Name", "Currency"], ["V-441", "ABC Chemicals", "USD"]] });
  });
});

describe("FVL-04.014 hardening B2/B3/B5: the REAL readWorkbookAllSheets wired as stageFile's workbook-reader adapter", () => {
  const opts = { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z" };

  it("a genuine .xlsx buffer stages through the shared package's common stageFile() abstraction end-to-end, not just through a mocked adapter", async () => {
    const bytes = await toBytes((wb) => {
      const ws = wb.addWorksheet("Materials");
      ws.addRow(["Chemical_ID", "Chemical_Name"]);
      ws.addRow(["883729", "Decyl Glucoside"]);
    });
    const result = await stageFile(
      "CHT_LIMS",
      "materials",
      { fileName: "customer-material-master.xlsx", fileKind: "xlsx", byteSize: bytes.byteLength, bytes, sheetName: "Materials" },
      opts,
      { readWorkbook: readWorkbookAllSheets },
    );
    expect(result.errors).toEqual([]);
    expect(result.records[0].fields.Chemical_ID).toBe("883729");
    expect(result.sourceResource).toMatchObject({ resourceName: "customer-material-master.xlsx#Materials", byteSize: bytes.byteLength });
  });

  it("a genuinely corrupt/non-xlsx byte buffer produces a structured corrupt_xlsx connector error through the REAL ExcelJS reader, never a leaked raw exception", async () => {
    const garbage = new TextEncoder().encode("this is not a zip file, it is just plain text pretending to be xlsx").buffer;
    const result = await stageFile("CHT_LIMS", "materials", { fileName: "corrupt.xlsx", fileKind: "xlsx", byteSize: garbage.byteLength, bytes: garbage }, opts, { readWorkbook: readWorkbookAllSheets });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: "corrupt_xlsx", stage: "parse", retryable: false });
    expect(result.records).toEqual([]);
  });
});

describe("buildXlsxBuffer", () => {
  // ExcelJS write+load is real zip/XML work; under a fully parallel test run
  // the default 5s budget is tight, so these get a longer one explicitly.
  it(
    "round-trips headers and rows through readWorkbookRows",
    async () => {
      const buf = await buildXlsxBuffer(["code", "displayName"], [{ code: "M-1", displayName: "SLES 70" }]);
      const rows = await readWorkbookRows(buf);
      expect(rows).toEqual([
        ["code", "displayName"],
        ["M-1", "SLES 70"],
      ]);
    },
    20000,
  );

  it(
    "neutralises a formula-injection cell the same way the CSV export does",
    async () => {
      const buf = await buildXlsxBuffer(["code", "displayName"], [{ code: "M-1", displayName: "=cmd|'/c calc'" }]);
      const rows = await readWorkbookRows(buf);
      expect(rows[1][1]).toBe("'=cmd|'/c calc'");
    },
    20000,
  );
});

describe("rejectUnsupportedWorkbook", () => {
  it("accepts a plain .xlsx filename", () => {
    expect(rejectUnsupportedWorkbook("materials.xlsx")).toBeNull();
  });

  it.each([".xlsm", ".xltm", ".xlam", ".xlsb", ".xls"])("rejects %s", (ext) => {
    expect(rejectUnsupportedWorkbook(`materials${ext}`)).toMatch(/not accepted/);
  });
});
