/**
 * FVL-04.014 — Generic File Connector acceptance (FILE1-4, B8).
 * Every fixture uses deliberately NON-FormuLab customer headers.
 */
import { describe, expect, it } from "vitest";
import { stageCsvFile, stageJsonFile, stageXmlFile } from "./fileConnector";

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
