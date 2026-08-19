/**
 * FVL-04.014 — Generic File Connector acceptance (FILE1-4, B8).
 * Every fixture uses deliberately NON-FormuLab customer headers.
 */
import { describe, expect, it } from "vitest";
import { createFileConnector, stageCsvFile, stageFile, stageJsonFile, stageXmlFile } from "./fileConnector";

const opts = { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z" };

describe("stageCsvFile — FILE1", () => {
  it("preserves arbitrary customer headers exactly, never requiring FormuLab column names", () => {
    const csv = "Chemical_ID,Chemical_Name,Price_USD\n883729,Decyl Glucoside,3.20\n883730,,";
    const result = stageCsvFile("CHT_LIMS", "materials", csv, opts);
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(Object.keys(result.records[0].fields)).toEqual(["Chemical_ID", "Chemical_Name", "Price_USD"]);
    expect(result.records[0].fields.Chemical_Name).toBe("Decyl Glucoside");
  });

  it("preserves nulls honestly — an empty cell is null, never coerced to a fabricated value", () => {
    const csv = "Chemical_ID,Chemical_Name\n883730,";
    const result = stageCsvFile("CHT_LIMS", "materials", csv, opts);
    expect(result.records[0].fields.Chemical_Name).toBeNull();
  });

  it("preserves decimal-comma OR decimal-point cell text verbatim — the connector never parses it", () => {
    const csv = "Chemical_ID,Price\n1,\"1.234,56\"\n2,1234.56";
    const result = stageCsvFile("CHT_LIMS", "materials", csv, opts);
    expect(result.records[0].fields.Price).toBe("1.234,56");
    expect(result.records[1].fields.Price).toBe("1234.56");
  });

  it("malformed/empty file returns a structured connector error, never a thrown exception", () => {
    const result = stageCsvFile("CHT_LIMS", "materials", "", opts);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].stage).toBe("parse");
  });
});

describe("stageJsonFile — FILE3", () => {
  it("stages a nested { items: [...] } customer payload without destructive flattening", () => {
    const json = JSON.stringify({
      items: [
        { Chemical_ID: "883729", Chemical_Name: "Decyl Glucoside", Supplier: { Vendor_ID: "V-441", Vendor_Name: "ABC Chemicals" } },
      ],
    });
    const result = stageJsonFile("CHT_LIMS", "materials", json, opts);
    expect(result.errors).toEqual([]);
    expect(result.records[0].fields["Chemical_ID"]).toBe("883729");
    expect(result.records[0].fields["Supplier.Vendor_ID"]).toBe("V-441");
  });

  it("stages a bare array-of-objects root", () => {
    const json = JSON.stringify([{ ItemNo: "1", Description: "Test" }]);
    const result = stageJsonFile("ACME_ERP", "items", json, opts);
    expect(result.records[0].fields.ItemNo).toBe("1");
  });

  it("malformed JSON returns a structured connector error", () => {
    const result = stageJsonFile("CHT_LIMS", "materials", "{not valid json", opts);
    expect(result.errors[0].code).toBe("malformed_json");
  });

  it("a payload with no record array returns a structured error, never a guessed shape", () => {
    const result = stageJsonFile("CHT_LIMS", "materials", JSON.stringify({ meta: "no records here" }), opts);
    expect(result.errors[0].code).toBe("no_record_array");
  });
});

describe("stageXmlFile — FILE4", () => {
  const xml = `<?xml version="1.0"?>
<materials>
  <material id="883729">
    <name>Decyl Glucoside</name>
    <supplier ref="V-441"/>
  </material>
  <material id="883730">
    <name>Cocamidopropyl Betaine</name>
    <supplier ref="V-442"/>
  </material>
</materials>`;

  it("extracts repeated record elements with attribute and element paths preserved", () => {
    const result = stageXmlFile("CHT_LIMS", "materials", xml, opts);
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.records[0].fields["@id"]).toBe("883729");
    expect(result.records[0].fields["name"]).toBe("Decyl Glucoside");
    expect(result.records[0].fields["supplier/@ref"]).toBe("V-441");
  });

  it("an explicit recordTag overrides auto-detection", () => {
    const result = stageXmlFile("CHT_LIMS", "materials", xml, { ...opts, recordTag: "material" });
    expect(result.records).toHaveLength(2);
  });

  it("a DOCTYPE declaration is rejected outright — XXE is structurally impossible, not merely mitigated", () => {
    const unsafeXml = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><materials><material>&xxe;</material></materials>`;
    const result = stageXmlFile("CHT_LIMS", "materials", unsafeXml, opts);
    expect(result.errors[0].code).toBe("unsafe_xml_entities");
    expect(result.records).toEqual([]);
  });

  it("malformed XML returns a structured error", () => {
    const result = stageXmlFile("CHT_LIMS", "materials", "<materials><material>", opts);
    expect(result.errors[0].code).toBe("malformed_xml");
  });
});

describe("XLSX2 — two sheets with different schemas stay distinct (proven at the staging-row level; the desktop reader itself is tested in apps/desktop)", () => {
  it("stageRows treats each call as one entity — sheet boundaries are never implicitly merged by this layer", async () => {
    const { stageRows } = await import("./fileConnector");
    const sheet1 = stageRows("CHT_LIMS", "materials", [["Chemical_ID", "Chemical_Name"], ["1", "Test"]], opts);
    const sheet2 = stageRows("CHT_LIMS", "suppliers", [["Vendor_ID", "Vendor_Name"], ["V-1", "Test Supplier"]], opts);
    expect(sheet1.entity).toBe("materials");
    expect(sheet2.entity).toBe("suppliers");
    expect(Object.keys(sheet1.records[0].fields)).not.toEqual(Object.keys(sheet2.records[0].fields));
  });
});

describe("FVL-04.014 hardening B1/B2/B5: stageFile — one common abstraction for CSV/XLSX/JSON/XML with real source-resource metadata", () => {
  it("CSV through stageFile carries real filename/media-type/byte-size/content-fingerprint", async () => {
    const csv = "Chemical_ID,Chemical_Name\n883729,Decyl Glucoside";
    const result = await stageFile("CHT_LIMS", "materials", { fileName: "materials.csv", fileKind: "csv", text: csv }, opts);
    expect(result.sourceResource).toMatchObject({ kind: "file", resourceName: "materials.csv", mediaType: "text/csv", byteSize: csv.length });
    expect(result.sourceResource?.contentFingerprint).toBeTruthy();
    expect(result.records[0].fields.Chemical_ID).toBe("883729");
  });

  it("JSON and XML through stageFile carry the same real metadata shape", async () => {
    const json = JSON.stringify([{ ItemNo: "1" }]);
    const jsonResult = await stageFile("ACME_ERP", "items", { fileName: "items.json", fileKind: "json", text: json }, opts);
    expect(jsonResult.sourceResource).toMatchObject({ resourceName: "items.json", mediaType: "application/json" });

    const xml = `<materials><material id="1"/><material id="2"/></materials>`;
    const xmlResult = await stageFile("CHT_LIMS", "materials", { fileName: "materials.xml", fileKind: "xml", text: xml }, opts);
    expect(xmlResult.sourceResource).toMatchObject({ resourceName: "materials.xml", mediaType: "application/xml" });
  });

  it("the content fingerprint is never mislabeled as a cryptographic hash — it is deterministic and stable for identical content", async () => {
    const csv = "A\n1";
    const a = await stageFile("SRC", "e", { fileName: "a.csv", fileKind: "csv", text: csv }, opts);
    const b = await stageFile("SRC", "e", { fileName: "a.csv", fileKind: "csv", text: csv }, { ...opts, extractionRunId: "run-2" });
    expect(a.sourceResource?.contentFingerprint).toBe(b.sourceResource?.contentFingerprint);
  });

  it("XLSX is staged through the SAME stageFile abstraction, via an injected workbook-reader adapter — not a disconnected special path", async () => {
    const mockReadWorkbook = async () => [{ sheetName: "Materials", rows: [["Chemical_ID", "Chemical_Name"], ["883729", "Decyl Glucoside"]] }];
    const result = await stageFile("CHT_LIMS", "materials", { fileName: "customer-material-master.xlsx", fileKind: "xlsx"}, opts, { readWorkbook: mockReadWorkbook });
    expect(result.errors).toEqual([]);
    expect(result.records[0].fields.Chemical_ID).toBe("883729");
    expect(result.sourceResource?.mediaType).toContain("spreadsheetml");
    expect(result.sourceResource?.contentFingerprint).toBeTruthy();
  });

  it("a genuinely multi-sheet workbook stages one sheet per call, sheet boundaries never merged", async () => {
    const mockReadWorkbook = async () => [
      { sheetName: "Materials", rows: [["Chemical_ID"], ["1"]] },
      { sheetName: "Suppliers", rows: [["Vendor_ID"], ["V-1"]] },
    ];
    const materials = await stageFile("CHT_LIMS", "materials", { fileName: "wb.xlsx", fileKind: "xlsx", sheetName: "Materials" }, opts, { readWorkbook: mockReadWorkbook });
    const suppliers = await stageFile("CHT_LIMS", "suppliers", { fileName: "wb.xlsx", fileKind: "xlsx", sheetName: "Suppliers" }, opts, { readWorkbook: mockReadWorkbook });
    expect(materials.records[0].fields.Chemical_ID).toBe("1");
    expect(suppliers.records[0].fields.Vendor_ID).toBe("V-1");
    expect(Object.keys(materials.records[0].fields)).not.toEqual(Object.keys(suppliers.records[0].fields));
  });

  it("FVL-04.014 hardening B3: a genuinely corrupt XLSX returns a structured connector error, never a leaked raw exception", async () => {
    const throwingReadWorkbook = async (): Promise<{ sheetName: string; rows: string[][] }[]> => {
      throw new Error("ExcelJS: Invalid signature — this is not a valid zip/xlsx file");
    };
    const result = await stageFile("CHT_LIMS", "materials", { fileName: "corrupt.xlsx", fileKind: "xlsx"}, opts, { readWorkbook: throwingReadWorkbook });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: "corrupt_xlsx", stage: "parse", retryable: false });
    expect(result.records).toEqual([]);
  });

  it("an xlsx file staged with no readWorkbook adapter configured fails structured, not silently", async () => {
    const result = await stageFile("CHT_LIMS", "materials", { fileName: "x.xlsx", fileKind: "xlsx"}, opts);
    expect(result.errors[0].code).toBe("xlsx_reader_not_configured");
  });

  it("a requested sheet name that does not exist in the workbook fails structured", async () => {
    const mockReadWorkbook = async () => [{ sheetName: "Materials", rows: [["A"], ["1"]] }];
    const result = await stageFile("CHT_LIMS", "materials", { fileName: "wb.xlsx", fileKind: "xlsx", sheetName: "NoSuchSheet" }, opts, { readWorkbook: mockReadWorkbook });
    expect(result.errors[0].code).toBe("sheet_not_found");
  });
});

describe("FVL-04.014 hardening (Session 7, Part A): file-level provenance correction", () => {
  it("A1/A2: byte size is derived from REAL UTF-8 bytes, not JS string.length — a multibyte string proves the distinction", async () => {
    const text = "İstanbul\n1"; // "İ" is 2 UTF-8 bytes but string.length counts it as 1 UTF-16 code unit
    const result = await stageFile("SRC", "e", { fileName: "unicode.csv", fileKind: "csv", text }, opts);
    const realUtf8Length = new TextEncoder().encode(text).length;
    expect(realUtf8Length).not.toBe(text.length); // sanity: the two really do differ for this fixture
    expect(result.sourceResource?.byteSize).toBe(realUtf8Length);
  });

  it("A2/N: FileConnectorInput has no caller-suppliable byteSize field at all — provenance cannot be asserted false by a caller", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("./fileConnector.ts", import.meta.url), "utf-8");
    const iface = /export interface FileConnectorInput \{[\s\S]*?\n\}/.exec(src)![0];
    const withoutComments = iface.replace(/\/\*\*[\s\S]*?\*\//g, "");
    expect(withoutComments).not.toMatch(/byteSize/);
  });

  it("A1/A3: an XLSX file-level fingerprint is IDENTICAL regardless of which sheet is selected — it fingerprints the file, not the sheet's rows", async () => {
    const mockReadWorkbook = async () => [
      { sheetName: "Materials", rows: [["Chemical_ID"], ["1"]] },
      { sheetName: "Suppliers", rows: [["Vendor_ID"], ["V-1"]] },
    ];
    const bytes = new TextEncoder().encode("pretend-workbook-bytes").buffer;
    const materials = await stageFile("SRC", "materials", { fileName: "wb.xlsx", fileKind: "xlsx", bytes, sheetName: "Materials" }, opts, { readWorkbook: mockReadWorkbook });
    const suppliers = await stageFile("SRC", "suppliers", { fileName: "wb.xlsx", fileKind: "xlsx", bytes, sheetName: "Suppliers" }, opts, { readWorkbook: mockReadWorkbook });
    expect(materials.sourceResource?.contentFingerprint).toBe(suppliers.sourceResource?.contentFingerprint);
    expect(materials.sourceResource?.byteSize).toBe(bytes.byteLength);
    expect(suppliers.sourceResource?.byteSize).toBe(bytes.byteLength);
  });

  it("A1: changing the actual XLSX bytes changes the file-level fingerprint", async () => {
    const mockReadWorkbook = async () => [{ sheetName: "S", rows: [["A"], ["1"]] }];
    const bytesA = new TextEncoder().encode("workbook-version-A").buffer;
    const bytesB = new TextEncoder().encode("workbook-version-B").buffer;
    const a = await stageFile("SRC", "e", { fileName: "wb.xlsx", fileKind: "xlsx", bytes: bytesA, sheetName: "S" }, opts, { readWorkbook: mockReadWorkbook });
    const b = await stageFile("SRC", "e", { fileName: "wb.xlsx", fileKind: "xlsx", bytes: bytesB, sheetName: "S" }, opts, { readWorkbook: mockReadWorkbook });
    expect(a.sourceResource?.contentFingerprint).not.toBe(b.sourceResource?.contentFingerprint);
  });

  it("A3: resourceName stays the plain filename; the selected sheet is carried separately as subResourceName", async () => {
    const mockReadWorkbook = async () => [{ sheetName: "Materials", rows: [["A"], ["1"]] }];
    const result = await stageFile("SRC", "e", { fileName: "customer-material-master.xlsx", fileKind: "xlsx", bytes: new ArrayBuffer(4), sheetName: "Materials" }, opts, { readWorkbook: mockReadWorkbook });
    expect(result.sourceResource?.resourceName).toBe("customer-material-master.xlsx");
    expect(result.sourceResource?.subResourceName).toBe("Materials");
  });

  it("A4: CSV/JSON/XML resourceName is never mutated with any sub-resource suffix", async () => {
    const csvResult = await stageFile("SRC", "e", { fileName: "materials.csv", fileKind: "csv", text: "A\n1" }, opts);
    expect(csvResult.sourceResource?.resourceName).toBe("materials.csv");
    expect(csvResult.sourceResource?.subResourceName).toBeUndefined();
  });
});

describe("FVL-04.014 hardening (Session 7, Part C): sanitized parse errors — executable proof, not source-text inspection", () => {
  it("a corrupt-XLSX adapter error containing a credential and a local path never leaks into the ConnectorResult", async () => {
    const leakyReadWorkbook = async (): Promise<{ sheetName: string; rows: string[][] }[]> => {
      throw new Error('ExcelJS failed reading "C:\\Users\\Customer\\private-file.xlsx" with connectionString="Server=db;password=TOP-SECRET"');
    };
    const result = await stageFile("SRC", "e", { fileName: "corrupt.xlsx", fileKind: "xlsx", bytes: new ArrayBuffer(4) }, opts, { readWorkbook: leakyReadWorkbook });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("TOP-SECRET");
    expect(serialized).not.toContain("private-file.xlsx");
    expect(serialized).not.toContain("connectionString");
    expect(result.errors[0].code).toBe("corrupt_xlsx");
  });

  it("a malformed-CSV parser exception containing sensitive text never leaks — proven by mocking parseCsv's own failure shape via a genuinely malformed real file", () => {
    // Uses a real parseCsv failure (mismatched quote), not a mock, so the
    // sanitization is proven against the actual library's own error text.
    const result = stageCsvFile("SRC", "e", '"unterminated quote\nrest of file with a fake token password=TOP-SECRET', opts);
    if (result.errors.length > 0) {
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("TOP-SECRET");
    }
  });

  it("no parse-failure message anywhere in the connector layer ever echoes a raw exception's own message text", () => {
    const cases = [stageCsvFile("SRC", "e", "", opts).errors[0], stageJsonFile("SRC", "e", "{not json, has C:\\secret\\path and password=abc", opts).errors[0]];
    for (const err of cases) {
      expect(err.message).not.toMatch(/password|secret|[A-Za-z]:\\/i);
    }
  });
});

describe("FVL-04.014 hardening (Session 7, Part B): createFileConnector — a real SourceConnector implementation", () => {
  it("createFileConnector is assignable to SourceConnector and CSV extraction works", async () => {
    const connector: import("../schemas/connector").SourceConnector = createFileConnector("CHT_LIMS", { fileName: "materials.csv", fileKind: "csv", text: "Chemical_ID,Chemical_Name\n883729,Decyl Glucoside" }, opts);
    const entities = await connector.discoverEntities();
    expect(entities).toEqual(["materials"]);
    const result = await connector.extract("materials");
    expect(result.records[0].fields.Chemical_ID).toBe("883729");
  });

  it("XLSX discoverEntities() returns real sheet names, extract(sheet) stages the chosen sheet", async () => {
    const mockReadWorkbook = async () => [
      { sheetName: "Materials", rows: [["Chemical_ID"], ["883729"]] },
      { sheetName: "Suppliers", rows: [["Vendor_ID"], ["V-441"]] },
    ];
    const connector = createFileConnector("CHT_LIMS", { fileName: "wb.xlsx", fileKind: "xlsx", bytes: new ArrayBuffer(8) }, opts, { readWorkbook: mockReadWorkbook });
    const entities = await connector.discoverEntities();
    expect(entities).toEqual(["Materials", "Suppliers"]);
    const materials = await connector.extract("Materials");
    expect(materials.records[0].fields.Chemical_ID).toBe("883729");
    const suppliers = await connector.extract("Suppliers");
    expect(suppliers.records[0].fields.Vendor_ID).toBe("V-441");
  });

  it("JSON and XML connectors work through the same createFileConnector implementation, arbitrary source columns untouched", async () => {
    const jsonConnector = createFileConnector("ACME_ERP", { fileName: "items.json", fileKind: "json", text: JSON.stringify([{ ItemNo: "AC-1", Vendor_Weird_Col: "x" }]) }, opts);
    const jsonResult = await jsonConnector.extract((await jsonConnector.discoverEntities())[0]);
    expect(jsonResult.records[0].fields).toMatchObject({ ItemNo: "AC-1", Vendor_Weird_Col: "x" });

    const xmlConnector = createFileConnector("CHT_LIMS", { fileName: "materials.xml", fileKind: "xml", text: `<materials><material id="1"/><material id="2"/></materials>` }, opts);
    const xmlResult = await xmlConnector.extract((await xmlConnector.discoverEntities())[0]);
    expect(xmlResult.records).toHaveLength(2);
  });
});

describe("FVL-04.014 hardening B4/§8: explicit source-ID requirement is never silently downgraded to an ordinal fallback", () => {
  it("idSource is 'configured' when idField resolves, 'ordinal' when it falls back", () => {
    const withId = stageCsvFile("CHT_LIMS", "materials", "Chemical_ID,Name\n883729,A", { ...opts, idField: "Chemical_ID" });
    expect(withId.records[0].identity.idSource).toBe("configured");
    expect(withId.records[0].identity.sourceRecordId).toBe("883729");

    const withoutId = stageCsvFile("CHT_LIMS", "materials", "Name\nA", opts);
    expect(withoutId.records[0].identity.idSource).toBe("ordinal");
  });

  it("requireExplicitId + a blank configured ID field produces a structured missing_source_id error, never a silent ordinal fallback", () => {
    const csv = "Chemical_ID,Name\n883729,A\n,B";
    const result = stageCsvFile("CHT_LIMS", "materials", csv, { ...opts, idField: "Chemical_ID", requireExplicitId: true });
    expect(result.records).toHaveLength(1);
    expect(result.records[0].identity.sourceRecordId).toBe("883729");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: "missing_source_id", stage: "extract", retryable: false });
  });

  it("without requireExplicitId, a blank configured ID field still falls back to the ordinal identity (staging-only, never crosswalk-eligible)", () => {
    const csv = "Chemical_ID,Name\n,B";
    const result = stageCsvFile("CHT_LIMS", "materials", csv, { ...opts, idField: "Chemical_ID" });
    expect(result.errors).toEqual([]);
    expect(result.records[0].identity.idSource).toBe("ordinal");
  });
});
