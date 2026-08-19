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
  it("SD10: a unique, always-present field is only ever a uniqueness OBSERVATION (unique_candidate), never automatic authority", () => {
    const result = stageCsvFile("SRC", "e", "Chemical_ID,Name\n1,A\n2,B\n3,C", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "Chemical_ID").externalIdStatus).toBe("unique_candidate");
    expect(field(schema, "Chemical_ID").isUniqueNonNull).toBe(true);
  });

  it("SD11: a non-unique display-name field is never accepted as an external ID", () => {
    const result = stageCsvFile("SRC", "e", "Name\nWater\nWater\nGlycerin", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "Name").externalIdStatus).toBe("unresolved");
    expect(field(schema, "Name").isUniqueNonNull).toBe(false);
  });

  it("FVL-04.015 hardening C1: a unique DISPLAY NAME is never treated as identity authority, even though it is unique in the sample", () => {
    const result = stageCsvFile("SRC", "e", "MaterialName\nDecyl Glucoside\nGlycerin\nWater", opts);
    const schema = discoverEntitySchema("e", result.records);
    // Uniquely named per row, structurally identical to a real ID field —
    // but a display name earns only the honest "unique_candidate"
    // observation, never "configured_external_id"/"metadata_primary_key".
    expect(field(schema, "MaterialName").externalIdStatus).toBe("unique_candidate");
  });

  it("FVL-04.015 hardening C2: an explicitly configured id field is recognized as configured_external_id, not re-inferred from its name", () => {
    const result = stageCsvFile("SRC", "e", "Chemical_ID,Name\n1,A\n2,B\n3,C", { ...opts, idField: "Chemical_ID" });
    const schema = discoverEntitySchema("e", result.records, { configuredIdField: "Chemical_ID" });
    expect(field(schema, "Chemical_ID").externalIdStatus).toBe("configured_external_id");
  });

  it("FVL-04.015 hardening C3: mocked DATABASE/REST primary-key metadata can be represented without implementing a DB/REST connector", () => {
    const result = stageCsvFile("SRC", "e", "Chemical_ID,Name\n1,A\n2,B", opts);
    const schema = discoverEntitySchema("e", result.records, { metadataPrimaryKeyFields: ["Chemical_ID"] });
    expect(field(schema, "Chemical_ID").externalIdStatus).toBe("metadata_primary_key");
  });

  it("FVL-04.015 hardening: a source record with no reliable ID evidence at all stays unresolved", () => {
    const result = stageCsvFile("SRC", "e", "Note\nfine\nfine\nfine", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "Note").externalIdStatus).toBe("unresolved");
  });
});

describe("FVL-04.015 hardening C4: dedicated unit-column discovery", () => {
  it("Quantity | UOM — a shared UOM column paired with the single numeric field in the entity", () => {
    const result = stageCsvFile("SRC", "e", "Quantity,UOM\n250,kg\n500,kg", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "Quantity").unitColumnHint).toBe("UOM");
  });

  it("Viscosity | ViscosityUnit — per-field suffix convention, unambiguous even with multiple numeric fields", () => {
    const result = stageCsvFile("SRC", "e", "Viscosity,ViscosityUnit,Quantity\n8500,cP,10", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "Viscosity").unitColumnHint).toBe("ViscosityUnit");
    // Quantity has no such sibling AND there are two numeric fields, so the
    // shared-UOM convention does not apply — stays unresolved, not guessed.
    expect(field(schema, "Quantity").unitColumnHint).toBeUndefined();
  });

  it("two numeric fields sharing one bare UOM column is genuinely ambiguous and is left unresolved", () => {
    const result = stageCsvFile("SRC", "e", "Quantity,Weight,UOM\n250,10,kg", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "Quantity").unitColumnHint).toBeUndefined();
    expect(field(schema, "Weight").unitColumnHint).toBeUndefined();
  });

  it("explicit unitColumnPairs configuration always wins over the recognized conventions", () => {
    const result = stageCsvFile("SRC", "e", "Amount,Measure\n250,kg", opts);
    const schema = discoverEntitySchema("e", result.records, { unitColumnPairs: { Amount: "Measure" } });
    expect(field(schema, "Amount").unitColumnHint).toBe("Measure");
  });
});

describe("FVL-04.015 hardening C5: source-specific null-token profiling", () => {
  it("N/A, NULL, and - are reported as observed candidate null tokens, never silently treated as null", () => {
    const result = stageCsvFile("SRC", "e", "Value\nN/A\nNULL\n-\n42", opts);
    const schema = discoverEntitySchema("e", result.records);
    const f = field(schema, "Value");
    expect(f.observedNullTokens).toEqual(expect.arrayContaining(["N/A", "NULL", "-"]));
    // Still present as real, non-null string samples — never dropped.
    expect(f.sampleCount).toBe(4);
    expect(f.nullCount).toBe(0);
  });

  it("real 0/false/\"0\" values are never reported as null tokens", () => {
    const result = stageCsvFile("SRC", "e", "Flag,Count\nfalse,0\ntrue,5", opts);
    const schema = discoverEntitySchema("e", result.records);
    expect(field(schema, "Flag").observedNullTokens).toBeUndefined();
    expect(field(schema, "Count").observedNullTokens).toBeUndefined();
  });

  it("FVL-04.015 hardening (Session 7, Part F): a customer-specific null token ('NO DATA') is discoverable only when explicitly configured — never recognized by default", () => {
    const result = stageCsvFile("SRC", "e", "Value\nNO DATA\nreal-value", opts);
    const withoutConfig = discoverEntitySchema("e", result.records);
    expect(field(withoutConfig, "Value").observedNullTokens).toBeUndefined();

    const withConfig = discoverEntitySchema("e", result.records, { nullTokenCandidates: ["NO DATA", "NOT RECORDED", "~"] });
    expect(field(withConfig, "Value").observedNullTokens).toEqual(["NO DATA"]);
    // Configured tokens EXTEND the default recognizer, never replace it.
    const both = stageCsvFile("SRC", "e2", "Value\nNO DATA\nN/A\nreal", opts);
    const bothSchema = discoverEntitySchema("e2", both.records, { nullTokenCandidates: ["NO DATA"] });
    expect(field(bothSchema, "Value").observedNullTokens).toEqual(expect.arrayContaining(["NO DATA", "N/A"]));
    // Still never silently converted to an actual null.
    expect(field(withConfig, "Value").nullCount).toBe(0);
  });
});

describe("FVL-04.015 hardening C6/C7: fingerprint stability and source-provided schema version", () => {
  it("the fingerprint does NOT change merely because one batch has a different null ratio or sample values", () => {
    const a = discoverSourceSchema("SRC", [{ entity: "e", records: stageCsvFile("SRC", "e", "Chemical_ID,Name\n1,A\n2,\n3,C", opts).records }]);
    const b = discoverSourceSchema("SRC", [{ entity: "e", records: stageCsvFile("SRC", "e", "Chemical_ID,Name\n9,X\n8,Y\n7,Z", opts).records }]);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("FVL-04.015 hardening (Session 7, Part E): the fingerprint does NOT change when the SAME field's observed VALUE TYPE differs batch to batch — a real gap the prior fingerprint (which included observedTypes) did not catch", () => {
    const batchNumeric = discoverSourceSchema("SRC", [{ entity: "e", records: stageCsvFile("SRC", "e", "Header,Quantity\nX,100", opts).records }]);
    const batchText = discoverSourceSchema("SRC", [{ entity: "e", records: stageCsvFile("SRC", "e", "Header,Quantity\nX,unknown", opts).records }]);
    // Same headers/declared structure — the fingerprint must be identical
    // even though one batch's Quantity column happens to be numeric and
    // the other happens to be text.
    expect(batchNumeric.fingerprint).toBe(batchText.fingerprint);
    // Discovery itself still reports the honest, DIFFERENT observed type
    // profile per batch — fingerprint stability and honest reporting are
    // deliberately separate concerns.
    const numericTypes = batchNumeric.entities[0].fields.find((f) => f.path === "Quantity")!.observedTypes;
    const textTypes = batchText.entities[0].fields.find((f) => f.path === "Quantity")!.observedTypes;
    expect(numericTypes).toEqual(["integer"]);
    expect(textTypes).toEqual(["string"]);
    expect(numericTypes).not.toEqual(textTypes);
  });

  it("the fingerprint DOES change when a unit-column pairing is added — a materially relevant structural change", () => {
    const withoutUnit = discoverSourceSchema("SRC", [{ entity: "e", records: stageCsvFile("SRC", "e", "Quantity\n250", opts).records }]);
    const withUnit = discoverSourceSchema("SRC", [{ entity: "e", records: stageCsvFile("SRC", "e", "Quantity,UOM\n250,kg", opts).records }]);
    expect(withoutUnit.fingerprint).not.toBe(withUnit.fingerprint);
  });

  it("a source-declared schema version is preserved separately from the computed fingerprint", () => {
    const schema = discoverSourceSchema("SRC", [{ entity: "e", records: stageCsvFile("SRC", "e", "Chemical_ID\n1", opts).records }], { sourceProvidedSchemaVersion: "v7" });
    expect(schema.sourceProvidedSchemaVersion).toBe("v7");
    expect(schema.fingerprint).not.toBe("v7");
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
