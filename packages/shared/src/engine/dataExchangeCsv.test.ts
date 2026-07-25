import { describe, expect, it } from "vitest";
import { parseCsv } from "./importer";
import { getDataExchangeTemplate } from "./dataExchangeRegistry";
import { dataExchangeBlankCsv, dataExchangeCsvFileName, dataExchangeExampleCsv, dataExchangeTemplateCsv } from "./dataExchangeCsv";

const materials = getDataExchangeTemplate("raw_materials")!;

describe("dataExchangeBlankCsv", () => {
  it("has only a header row, in the template's stable column order", () => {
    const csv = dataExchangeBlankCsv(materials);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(materials.columns.filter((c) => c.exportable).map((c) => c.key));
  });

  it("carries a UTF-8 BOM so Excel opens non-ASCII text correctly", () => {
    expect(dataExchangeBlankCsv(materials).charCodeAt(0)).toBe(0xfeff);
  });
});

describe("dataExchangeExampleCsv", () => {
  it("includes the template's synthetic example rows", () => {
    const csv = dataExchangeExampleCsv(materials);
    const rows = parseCsv(csv);
    expect(rows.length).toBe(1 + materials.exampleRows.length);
    const codeCol = materials.columns.findIndex((c) => c.key === "material_code");
    expect(rows[1][codeCol]).toBe("TEST-MAT-001");
  });
});

describe("dataExchangeTemplateCsv", () => {
  it("round-trips embedded commas, quotes and newlines", () => {
    const row = {
      material_code: "TEST-MAT-002",
      material_name: 'A "quoted", tricky\nname',
      notes: "line one\nline two",
    };
    const csv = dataExchangeTemplateCsv(materials, [row]);
    const parsed = parseCsv(csv);
    const nameCol = materials.columns.findIndex((c) => c.key === "material_name");
    const notesCol = materials.columns.findIndex((c) => c.key === "notes");
    expect(parsed[1][nameCol]).toBe('A "quoted", tricky\nname');
    expect(parsed[1][notesCol]).toBe("line one\nline two");
  });

  it("neutralises formula-injection triggers on export", () => {
    const csv = dataExchangeTemplateCsv(materials, [{ material_code: "TEST-MAT-003", material_name: "=HYPERLINK(\"http://evil\",\"click\")" }]);
    expect(csv).toContain("'=HYPERLINK");
  });
});

describe("dataExchangeCsvFileName", () => {
  it("names files by template code and kind", () => {
    expect(dataExchangeCsvFileName(materials, "blank")).toBe("raw_materials_blank.csv");
    expect(dataExchangeCsvFileName(materials, "example")).toBe("raw_materials_example.csv");
    expect(dataExchangeCsvFileName(materials, "current-data")).toBe("raw_materials_current-data.csv");
    expect(dataExchangeCsvFileName(materials, "error-report")).toBe("raw_materials_error-report.csv");
  });
});
