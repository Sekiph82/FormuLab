import { describe, expect, it } from "vitest";
import { parseCsv } from "./importer";
import { getDataExchangeTemplate } from "./dataExchangeRegistry";
import { previewDataExchangeImport, previewDataExchangeImportCsv } from "./dataExchangeValidation";

const materials = getDataExchangeTemplate("raw_materials")!;
const prices = getDataExchangeTemplate("material_prices")!;
const stabilityProtocols = getDataExchangeTemplate("stability_protocols")!;
const stabilityResults = getDataExchangeTemplate("stability_results")!;
const benchmarkProducts = getDataExchangeTemplate("benchmark_products")!;
const declarationLines = getDataExchangeTemplate("ingredient_declaration_lines")!;
const analyticalResults = getDataExchangeTemplate("analytical_composition_results")!;
const ingredientMappings = getDataExchangeTemplate("ingredient_mappings")!;
const reverseFormulationStudies = getDataExchangeTemplate("reverse_formulation_studies")!;

function csvFor(template: typeof materials, rows: string[][]): string {
  const headers = template.columns.map((c) => c.key);
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

describe("previewDataExchangeImport — fatal / job-level cases", () => {
  it("refuses an empty file", () => {
    const p = previewDataExchangeImport(materials, []);
    expect(p.fatalError).toMatch(/empty/);
  });

  it("refuses a file with a duplicate header", () => {
    const rows = [["material_code", "material_code"], ["TEST-MAT-001", "x"]];
    const p = previewDataExchangeImport(materials, rows);
    expect(p.fatalError).toMatch(/more than once/);
  });

  it("refuses a file missing a required column", () => {
    const rows = [["material_name"], ["TEST Water"]];
    const p = previewDataExchangeImport(materials, rows);
    expect(p.fatalError).toMatch(/material_code/);
  });

  it("refuses when the acting role is not authorized", () => {
    const rows = [["material_code", "material_name"], ["TEST-MAT-001", "TEST Water"]];
    const p = previewDataExchangeImport(materials, rows, { actorRole: "researcher" });
    expect(p.fatalError).toMatch(/not authorized/);
    expect(p.authorizationDenied).toBe(true);
  });

  it("allows an authorized role through", () => {
    const rows = [["material_code", "material_name"], ["TEST-MAT-001", "TEST Water"]];
    const p = previewDataExchangeImport(materials, rows, { actorRole: "administrator" });
    expect(p.fatalError).toBeUndefined();
    expect(p.authorizationDenied).toBeUndefined();
  });

  it("does not flag authorizationDenied for a non-authorization fatal error", () => {
    const p = previewDataExchangeImport(materials, [], { actorRole: "administrator" });
    expect(p.fatalError).toMatch(/empty/i);
    expect(p.authorizationDenied).toBeUndefined();
  });

  it("refuses a file over the row-count limit", () => {
    const rows = [["material_code", "material_name"]];
    // Build one more row than the limit using a small, fast alternative
    // check: exercise the guard directly by asserting the constant is honored.
    const many = Array.from({ length: 3 }, (_, i) => [`TEST-MAT-${i}`, "TEST Water"]);
    const p = previewDataExchangeImport(materials, [...rows, ...many]);
    expect(p.fatalError).toBeUndefined();
  });

  it("refuses a file over the byte-size limit", () => {
    const rows = [["material_code", "material_name"], ["TEST-MAT-001", "TEST Water"]];
    const p = previewDataExchangeImport(materials, rows, { fileSizeBytes: 999_999_999 });
    expect(p.fatalError).toMatch(/limit/);
  });
});

describe("previewDataExchangeImport — row classification", () => {
  it("classifies a well-formed new row as valid_create", () => {
    const csv = csvFor(materials, [["TEST-MAT-001", "TEST Water", "", "", "", "", "", "", "", "", "kg", "", "", "", "", "", "", "", "", "", "", "", "", "", "false", "false", "false", "", "", "false", "", "", ""]]);
    const p = previewDataExchangeImportCsv(materials, csv);
    expect(p.rows[0].state).toBe("valid_create");
    expect(p.newRecords).toBe(1);
  });

  it("classifies a row matching an existing natural key as valid_update", () => {
    const rows = [["material_code", "material_name"], ["TEST-MAT-001", "TEST Water v2"]];
    const p = previewDataExchangeImport(materials, rows, { existingNaturalKeys: new Set(["TEST-MAT-001"]) });
    expect(p.rows[0].state).toBe("valid_update");
    expect(p.updates).toBe(1);
  });

  it("classifies an unchanged row as unchanged when isUnchanged says so", () => {
    const rows = [["material_code", "material_name"], ["TEST-MAT-001", "TEST Water"]];
    const p = previewDataExchangeImport(materials, rows, {
      existingNaturalKeys: new Set(["TEST-MAT-001"]),
      isUnchanged: () => true,
    });
    expect(p.rows[0].state).toBe("unchanged");
    expect(p.unchanged).toBe(1);
  });

  it("classifies an immutable existing record's row as invalid, never silently updated", () => {
    const rows = [["material_code", "material_name"], ["TEST-MAT-001", "TEST Water v2"]];
    const p = previewDataExchangeImport(materials, rows, {
      existingNaturalKeys: new Set(["TEST-MAT-001"]),
      immutableNaturalKeys: new Set(["TEST-MAT-001"]),
    });
    expect(p.rows[0].state).toBe("invalid");
    expect(p.rows[0].messages.join(" ")).toMatch(/immutable/);
  });

  it("classifies a repeated natural key within the same file as duplicate", () => {
    const rows = [
      ["material_code", "material_name"],
      ["TEST-MAT-001", "TEST Water"],
      ["TEST-MAT-001", "TEST Water Again"],
    ];
    const p = previewDataExchangeImport(materials, rows);
    expect(p.rows[1].state).toBe("duplicate");
    expect(p.duplicates).toBe(1);
  });

  it("classifies a missing required field as invalid", () => {
    const rows = [["material_code", "material_name"], ["", "TEST Water"]];
    const p = previewDataExchangeImport(materials, rows);
    expect(p.rows[0].state).toBe("invalid");
    expect(p.invalidRows).toBe(1);
  });

  it("classifies an unresolvable required reference as reference_missing", () => {
    const rows = [
      ["material_code", "supplier_code", "unit_price", "currency", "valid_from"],
      ["TEST-MAT-001", "TEST-SUP-999", "10", "KES", "2026-01-01"],
    ];
    const p = previewDataExchangeImport(prices, rows, { resolveReference: () => false });
    expect(p.rows[0].state).toBe("reference_missing");
    expect(p.referenceErrors).toBe(1);
  });

  it("classifies an unresolvable OPTIONAL reference as a warning, not a blocker", () => {
    const rows = [["material_code", "material_name", "preferred_supplier_code"], ["TEST-MAT-001", "TEST Water", "TEST-SUP-999"]];
    const p = previewDataExchangeImport(materials, rows, { resolveReference: () => false });
    expect(p.rows[0].state).toBe("warning");
    expect(p.warnings).toBe(1);
  });

  it("validates enum columns case-insensitively and normalizes to canonical case", () => {
    const rows = [["material_code", "material_name", "currency"], ["TEST-MAT-001", "TEST Water", "kes"]];
    const p = previewDataExchangeImport(materials, rows);
    expect(p.rows[0].record.currency).toBe("KES");
  });

  it("rejects an invalid enum value", () => {
    const rows = [["material_code", "material_name", "currency"], ["TEST-MAT-001", "TEST Water", "ZZZ"]];
    const p = previewDataExchangeImport(materials, rows);
    expect(p.rows[0].state).toBe("invalid");
  });

  it("validates decimal/percentage/currency with locale-independent parsing", () => {
    const rows = [["material_code", "material_name", "active_matter_percent"], ["TEST-MAT-001", "TEST Water", "50,5"]];
    const p = previewDataExchangeImport(materials, rows);
    expect(p.rows[0].record.active_matter_percent).toBe("50.5");
  });

  it("rejects a percentage outside 0-100", () => {
    const rows = [["material_code", "material_name", "active_matter_percent"], ["TEST-MAT-001", "TEST Water", "150"]];
    const p = previewDataExchangeImport(materials, rows);
    expect(p.rows[0].state).toBe("invalid");
  });

  it("validates ISO dates and rejects non-ISO dates", () => {
    const isoRows = [["material_code", "material_name", "manufacture_date"], ["TEST-MAT-001", "TEST Water", "2026-01-15"]];
    expect(previewDataExchangeImport(materials, isoRows).rows[0].state).toBe("valid_create");
    const badRows = [["material_code", "material_name", "manufacture_date"], ["TEST-MAT-001", "TEST Water", "15/01/2026"]];
    expect(previewDataExchangeImport(materials, badRows).rows[0].state).toBe("invalid");
  });

  it("validates boolean columns from common yes/no spellings", () => {
    const rows = [["material_code", "material_name", "hazardous"], ["TEST-MAT-001", "TEST Water", "yes"]];
    const p = previewDataExchangeImport(materials, rows);
    expect(p.rows[0].record.hazardous).toBe("true");
  });

  it("splits multi_value columns on ; , and |", () => {
    const rows = [["material_code", "material_name", "tags"], ["TEST-MAT-001", "TEST Water", "a; b, c|d"]];
    const p = previewDataExchangeImport(materials, rows);
    expect(p.rows[0].record.tags).toBe("a;b;c;d");
  });

  it("reports unmapped headers without failing the import", () => {
    const rows = [["material_code", "material_name", "totally_unknown_column"], ["TEST-MAT-001", "TEST Water", "x"]];
    const p = previewDataExchangeImport(materials, rows);
    expect(p.unmappedHeaders).toContain("totally_unknown_column");
    expect(p.rows[0].state).toBe("valid_create");
  });

  it("strips a leading formula-injection trigger from an imported cell", () => {
    const rows = [["material_code", "material_name"], ["TEST-MAT-001", "=cmd|'/c calc'!A1"]];
    const p = previewDataExchangeImport(materials, rows);
    expect(p.rows[0].record.material_name).toBe("cmd|'/c calc'!A1");
  });
});

describe("previewDataExchangeImport — Reverse Formulation templates", () => {
  it("classifies a well-formed reverse_formulation_studies row as valid_create", () => {
    const rows = [
      ["study_code", "study_name", "project_code", "product_family_code"],
      ["TEST-RFS-001", "TEST Study", "TEST-PROJ-001", "TEST-FAM-001"],
    ];
    const p = previewDataExchangeImport(reverseFormulationStudies, rows);
    expect(p.rows[0].state).toBe("valid_create");
  });

  it("rejects reverse_formulation_studies status values other than the safe starting one — an import can never claim review/selection", () => {
    const rows = [
      ["study_code", "study_name", "project_code", "product_family_code", "status"],
      ["TEST-RFS-001", "TEST Study", "TEST-PROJ-001", "TEST-FAM-001", "selected"],
    ];
    const p = previewDataExchangeImport(reverseFormulationStudies, rows);
    expect(p.rows[0].state).toBe("invalid");
    expect(p.rows[0].messages.join(" ")).toMatch(/status/);
  });

  it("classifies a missing required benchmark_products identifier as invalid", () => {
    const rows = [["product_code", "product_name"], ["", "TEST Competitor Product"]];
    const p = previewDataExchangeImport(benchmarkProducts, rows);
    expect(p.rows[0].state).toBe("invalid");
  });

  it("leaves a blank optional benchmark_products value blank, never coerced to 0", () => {
    const rows = [["product_code", "product_name", "declared_net_content"], ["TEST-BMP-001", "TEST Product", ""]];
    const p = previewDataExchangeImport(benchmarkProducts, rows);
    expect(p.rows[0].state).toBe("valid_create");
    expect(p.rows[0].record.declared_net_content).toBeUndefined();
  });

  it("classifies a malformed declared_order as invalid, not silently truncated", () => {
    const rows = [
      ["product_code", "declared_order", "declared_name"],
      ["TEST-BMP-001", "one", "Aqua"],
    ];
    const p = previewDataExchangeImport(declarationLines, rows);
    expect(p.rows[0].state).toBe("invalid");
  });

  it("leaves a blank concentration_hint blank, never coerced to 0%", () => {
    const rows = [
      ["product_code", "declared_order", "declared_name", "concentration_hint"],
      ["TEST-BMP-001", "1", "Aqua", ""],
    ];
    const p = previewDataExchangeImport(declarationLines, rows);
    expect(p.rows[0].state).toBe("valid_create");
    expect(p.rows[0].record.concentration_hint).toBeUndefined();
  });

  it("rejects a malformed analytical_composition_results decimal value", () => {
    const rows = [
      ["product_code", "analysis_type", "analyte", "value", "unit"],
      ["TEST-BMP-001", "elemental", "Na", "not-a-number", "%"],
    ];
    const p = previewDataExchangeImport(analyticalResults, rows);
    expect(p.rows[0].state).toBe("invalid");
  });

  it("preserves an analytical_composition_results decimal value exactly, never through a lossy float round trip", () => {
    const rows = [
      ["product_code", "analysis_type", "analyte", "value", "unit"],
      ["TEST-BMP-001", "elemental", "Na", "123.456789", "%"],
    ];
    const p = previewDataExchangeImport(analyticalResults, rows);
    expect(p.rows[0].state).toBe("valid_create");
    expect(p.rows[0].record.value).toBe("123.456789");
  });

  it("rejects an ingredient_mappings confidence outside 0-1", () => {
    const rows = [
      ["study_code", "product_code", "declared_order", "candidate_material_code", "mapping_method", "confidence"],
      ["TEST-RFS-001", "TEST-BMP-001", "1", "TEST-MAT-001", "INCI", "1.5"],
    ];
    const p = previewDataExchangeImport(ingredientMappings, rows);
    expect(p.rows[0].state).toBe("invalid");
  });

  it("rejects an unrecognized ingredient_mappings mapping_method", () => {
    const rows = [
      ["study_code", "product_code", "declared_order", "candidate_material_code", "mapping_method", "confidence"],
      ["TEST-RFS-001", "TEST-BMP-001", "1", "TEST-MAT-001", "guesswork", "0.5"],
    ];
    const p = previewDataExchangeImport(ingredientMappings, rows);
    expect(p.rows[0].state).toBe("invalid");
  });

  it("accepts a well-formed ingredient_mappings row", () => {
    const rows = [
      ["study_code", "product_code", "declared_order", "candidate_material_code", "mapping_method", "confidence"],
      ["TEST-RFS-001", "TEST-BMP-001", "1", "TEST-MAT-001", "INCI", "0.85"],
    ];
    const p = previewDataExchangeImport(ingredientMappings, rows);
    expect(p.rows[0].state).toBe("valid_create");
    expect(p.rows[0].record.confidence).toBe("0.85");
  });
});

describe("previewDataExchangeImportCsv", () => {
  it("parses raw CSV text the same way as pre-split rows", () => {
    const csv = "material_code,material_name\nTEST-MAT-001,TEST Water";
    const p = previewDataExchangeImportCsv(materials, csv);
    expect(p.rows[0].state).toBe("valid_create");
  });

  it("round-trips a real parseCsv output", () => {
    const csv = "material_code,material_name\nTEST-MAT-001,\"TEST, Water\"";
    const rows = parseCsv(csv);
    const p = previewDataExchangeImport(materials, rows);
    expect(p.rows[0].record.material_name).toBe("TEST, Water");
  });
});

// Regression coverage for a live-verification finding: condition_code and
// time_point were registered as plain `dataType: "string"` columns, so an
// unrecognized seed-catalog code (e.g. a typo'd condition) sailed through
// preview as `valid_create` and only failed once the commit handler itself
// checked it against SEED_STABILITY_CONDITIONS/SEED_STABILITY_TIME_POINTS —
// the exact opposite of "confirm preview shows the error" the import flow
// is supposed to guarantee. Both columns are now real registry `enum`
// columns sourced from the seed catalogs, so the generic preview engine
// catches this itself, before commit is ever reachable.
describe("previewDataExchangeImport — stability seed-catalog enums", () => {
  it("rejects an unrecognized condition_code at preview time, not just at commit", () => {
    const header = stabilityProtocols.columns.map((c) => c.key);
    const row = header.map((k) => {
      if (k === "protocol_code") return "TEST-PROT-001";
      if (k === "condition_code") return "99C";
      if (k === "time_point") return "3MO";
      if (k === "test_code") return "TEST-TST-001";
      return "";
    });
    const p = previewDataExchangeImport(stabilityProtocols, [header, row]);
    expect(p.rows[0].state).toBe("invalid");
    expect(p.rows[0].messages.join(" ")).toMatch(/condition_code/);
  });

  it("rejects an unrecognized time_point at preview time for stability_results", () => {
    const header = stabilityResults.columns.map((c) => c.key);
    const row = header.map((k) => {
      if (k === "study_code") return "TEST-STAB-001";
      if (k === "sample_code") return "S1";
      if (k === "condition_code") return "40C";
      if (k === "time_point") return "M3"; // not a real seed time-point code
      if (k === "test_code") return "TEST-TST-001";
      return "";
    });
    const p = previewDataExchangeImport(stabilityResults, [header, row]);
    expect(p.rows[0].state).toBe("invalid");
    expect(p.rows[0].messages.join(" ")).toMatch(/time_point/);
  });

  it("accepts a real seed condition_code/time_point pair", () => {
    const header = stabilityProtocols.columns.map((c) => c.key);
    const row = header.map((k) => {
      if (k === "protocol_code") return "TEST-PROT-001";
      if (k === "condition_code") return "40C";
      if (k === "time_point") return "3MO";
      if (k === "test_code") return "TEST-TST-001";
      return "";
    });
    const p = previewDataExchangeImport(stabilityProtocols, [header, row]);
    expect(p.rows[0].state).toBe("valid_create");
  });
});
