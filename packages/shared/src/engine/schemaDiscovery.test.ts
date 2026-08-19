/**
 * FVL-04.015 — Source Schema Discovery acceptance (SD1-SD15).
 */
import { describe, expect, it } from "vitest";
import { discoverEntitySchema, discoverSourceSchema } from "./schemaDiscovery";
import { stageCsvFile, stageJsonFile, stageXmlFile } from "./fileConnector";

const opts = { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z" };

function field(schema: ReturnType<typeof discoverEntitySchema>, path: string) {
  return schema.fields.find((f) => f.path === path)!;
}

describe("SD1: mixed data types preserved as ambiguity, never forced to one type", () => {
  it('["1", "2", "N/A"] reports both integer and string, never a guaranteed integer', () => {
    const result = stageCsvFile("SRC", "e", "Qty\n1\n2\nN/A", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "Qty").observedTypes.sort()).toEqual(["integer", "string"]);
  });
});

describe("SD2: null/missing pattern detection", () => {
  it("distinguishes null count from sample count, and reports nullable when a field is sometimes absent", () => {
    const result = stageCsvFile("SRC", "e", "A,B\n1,\n2,x", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "B").nullCount).toBe(1);
    expect(field(schema, "B").nullable).toBe(true);
  });
});

describe("SD3: unambiguous ISO dates", () => {
  it("recognizes YYYY-MM-DD with no ambiguity", () => {
    const result = stageCsvFile("SRC", "e", "D\n2026-01-15\n2026-06-01", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "D")).toMatchObject({ candidateDateFormat: "YYYY-MM-DD", dateAmbiguous: false });
  });
});

describe("SD4: ambiguous DD/MM vs MM/DD stays ambiguous", () => {
  it("03/04/2026 alone, with no disambiguating sample, resolves to no format and dateAmbiguous true", () => {
    const result = stageCsvFile("SRC", "e", "D\n03/04/2026", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "D").candidateDateFormat).toBeUndefined();
    expect(field(schema, "D").dateAmbiguous).toBe(true);
  });

  it("a genuinely disambiguating sample (day > 12) resolves DD/MM/YYYY for the whole field", () => {
    const result = stageCsvFile("SRC", "e", "D\n31/12/2026\n03/04/2026", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "D")).toMatchObject({ candidateDateFormat: "DD/MM/YYYY", dateAmbiguous: false });
  });
});

describe("SD5/SD6/SD7: decimal conventions", () => {
  it("SD5: decimal dot format resolves to dot", () => {
    const result = stageCsvFile("SRC", "e", "P\n1234.56\n99.9", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "P").decimalConvention).toBe("dot");
  });

  it("SD6: decimal comma format resolves to comma", () => {
    const result = stageCsvFile("SRC", "e", 'P\n"1234,56"\n"99,9"', opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "P").decimalConvention).toBe("comma");
  });

  it("SD7: a grouped decimal with a bare 3-digit trailing group is reported ambiguous, never guessed", () => {
    const result = stageCsvFile("SRC", "e", 'P\n"1,234"', opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "P").decimalConvention).toBe("ambiguous");
  });

  it("an unambiguous EU grouped decimal (1.234,56) resolves to comma", () => {
    const result = stageCsvFile("SRC", "e", 'P\n"1.234,56"', opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "P").decimalConvention).toBe("comma");
  });
});

describe("SD8/SD9: unit discovery", () => {
  it("SD8: an explicit unit-annotated header is recognized deterministically", () => {
    const result = stageCsvFile("SRC", "e", "Viscosity_cP\n8500", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "Viscosity_cP").unitHint).toBe("cP");
  });

  it("SD9: a field with no unit annotation stays unresolved — 'Quantity' alone never becomes kg", () => {
    const result = stageCsvFile("SRC", "e", "Quantity\n250", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "Quantity").unitHint).toBeUndefined();
  });
});

describe("SD10/SD11: external ID candidate discovery", () => {
  it("SD10: a unique, always-present configured field is recognized as a candidate external ID", () => {
    const result = stageCsvFile("SRC", "e", "Chemical_ID,Name\n1,A\n2,B\n3,C", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "Chemical_ID").externalIdStatus).toBe("candidate");
    expect(field(schema, "Chemical_ID").isUniqueNonNull).toBe(true);
  });

  it("SD11: a non-unique display-name field is never accepted as an external ID", () => {
    const result = stageCsvFile("SRC", "e", "Name\nWater\nWater\nGlycerin", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "Name").externalIdStatus).toBe("unresolved");
    expect(field(schema, "Name").isUniqueNonNull).toBe(false);
  });
});

describe("SD12: XLSX-style multi-entity structures remain distinct", () => {
  it("two staged entities produce two independent entity schemas, never merged", () => {
    const materials = stageCsvFile("SRC", "materials", "Chemical_ID\n1", opts);
    const suppliers = stageCsvFile("SRC", "suppliers", "Vendor_ID\nV-1", opts);
    const schema = discoverSourceSchema("SRC", [
      { entity: "materials", records: materials.records },
      { entity: "suppliers", records: suppliers.records },
    ]);
    expect(schema.entities.map((e) => e.entity).sort()).toEqual(["materials", "suppliers"]);
  });
});

describe("SD13: nested JSON paths described", () => {
  it("a nested object field is described by its own dotted path", () => {
    const result = stageJsonFile("SRC", "e", JSON.stringify({ items: [{ Supplier: { Vendor_ID: "V-1" } }] }), opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "Supplier.Vendor_ID")).toBeDefined();
  });
});

describe("SD14: XML attributes/elements described", () => {
  it("an attribute path (@id) and an element path (name) are both described distinctly", () => {
    const xml = `<materials><material id="1"><name>Test</name></material><material id="2"><name>Test2</name></material></materials>`;
    const result = stageXmlFile("SRC", "e", xml, opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "@id")).toBeDefined();
    expect(field(schema, "name")).toBeDefined();
  });
});

describe("SD15: schema fingerprint is deterministic", () => {
  it("the same structure produces the identical fingerprint across independent discovery runs", () => {
    const a = stageCsvFile("SRC", "e", "Chemical_ID,Name\n1,A", { extractionRunId: "run-a", extractedAt: "2026-01-01T00:00:00.000Z" });
    const b = stageCsvFile("SRC", "e", "Chemical_ID,Name\n2,B", { extractionRunId: "run-b", extractedAt: "2026-12-31T00:00:00.000Z" });
    const schemaA = discoverSourceSchema("SRC", [{ entity: "e", records: a.records }]);
    const schemaB = discoverSourceSchema("SRC", [{ entity: "e", records: b.records }]);
    expect(schemaA.fingerprint).toBe(schemaB.fingerprint);
  });

  it("a structurally different schema produces a different fingerprint", () => {
    const a = stageCsvFile("SRC", "e", "Chemical_ID,Name\n1,A", opts);
    const b = stageCsvFile("SRC", "e", "Chemical_ID,Name,Extra\n1,A,x", opts);
    const schemaA = discoverSourceSchema("SRC", [{ entity: "e", records: a.records }]);
    const schemaB = discoverSourceSchema("SRC", [{ entity: "e", records: b.records }]);
    expect(schemaA.fingerprint).not.toBe(schemaB.fingerprint);
  });
});
