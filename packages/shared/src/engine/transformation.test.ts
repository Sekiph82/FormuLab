/**
 * FVL-04.018 — Transformation / Unit / Enum Mapping acceptance (TR1-TR14).
 * TR15/TR16 (existing Data Exchange validator boundary, no direct commit)
 * are proven in mappingProfile.test.ts and the end-to-end fixture, where a
 * real mapping profile's output is the thing under test.
 */
import { describe, expect, it } from "vitest";
import { applyTransformation, applyTransformationPipeline } from "./transformation";

describe("TR1/TR2/TR3: decimal locale", () => {
  it("TR1: EU-configured decimal parses 1.234,56 -> 1234.56", () => {
    const r = applyTransformation("parse_decimal", "1.234,56", { decimalSeparator: ",", groupSeparator: "." });
    expect(r.value).toBe("1234.56");
  });

  it("TR2: US-configured decimal parses 1,234.56 -> 1234.56", () => {
    const r = applyTransformation("parse_decimal", "1,234.56", { decimalSeparator: ".", groupSeparator: "," });
    expect(r.value).toBe("1234.56");
  });

  it("TR3: an ambiguous decimal with no configured convention is a structured error, never a guess", () => {
    const r = applyTransformation("parse_decimal", "1234,56", undefined);
    expect(r.error).toBe("decimal_convention_not_configured");
    expect(r.value).toBeUndefined();
  });
});

describe("TR4/TR5: date parsing", () => {
  it("TR4: 31/12/2026 configured DD/MM/YYYY -> canonical 2026-12-31", () => {
    const r = applyTransformation("parse_date", "31/12/2026", { format: "DD/MM/YYYY" });
    expect(r.value).toBe("2026-12-31");
  });

  it("TR5: 03/04/2026 with no date-order config is a structured error", () => {
    const r = applyTransformation("parse_date", "03/04/2026", undefined);
    expect(r.error).toBe("date_format_not_configured");
  });
});

describe("TR6: whitespace trimming preserves intended human text", () => {
  it("trims outer whitespace, keeps internal text intact", () => {
    const r = applyTransformation("trim", "  Decyl Glucoside  ", undefined);
    expect(r.value).toBe("Decyl Glucoside");
  });
});

describe("TR7/TR8: explicit enum mapping, no fuzzy match", () => {
  it("TR7: an explicit configured enum mapping resolves", () => {
    const r = applyTransformation("map_enum", "Approved Vendor", { enumMap: { "Approved Vendor": "approved" } });
    expect(r.value).toBe("approved");
  });

  it("TR8: an unknown source enum value does not fuzzy-match — structured error", () => {
    const r = applyTransformation("map_enum", "Sort Of Approved", { enumMap: { "Approved Vendor": "approved" } });
    expect(r.error).toBe("unknown_enum_value");
  });
});

describe("TR9: explicit boolean mapping works", () => {
  it("Y/N maps to true/false only when explicitly configured", () => {
    expect(applyTransformation("map_boolean", "Y", { trueValues: ["Y"], falseValues: ["N"] }).value).toBe("true");
    expect(applyTransformation("map_boolean", "N", { trueValues: ["Y"], falseValues: ["N"] }).value).toBe("false");
  });

  it("an unconfigured token is never assumed truthy/falsy", () => {
    const r = applyTransformation("map_boolean", "Maybe", { trueValues: ["Y"], falseValues: ["N"] });
    expect(r.error).toBe("unknown_boolean_value");
  });
});

describe("TR10/TR11: unit conversion", () => {
  it("TR10: 1000 g -> 1 kg via the real conversion authority", () => {
    const r = applyTransformation("convert_unit", "1000", { from: "g", to: "kg" });
    expect(r.value).toBe("1");
  });

  it("TR11: L -> kg (cross-dimension, no density) is refused, never guessed", () => {
    const r = applyTransformation("convert_unit", "1", { from: "L", to: "kg" });
    expect(r.error).toBe("incompatible_unit_conversion");
  });

  it("dimensionally compatible mg -> g works", () => {
    const r = applyTransformation("convert_unit", "500", { from: "mg", to: "g" });
    expect(r.value).toBe("0.5");
  });
});

describe("TR12/TR13: relationship resolution through crosswalk only", () => {
  it("TR12: an external supplier ID resolves through the Crosswalk Registry", () => {
    const r = applyTransformation(
      "resolve_crosswalk",
      "V-441",
      { sourceEntity: "suppliers", canonicalEntity: "Supplier" },
      { resolveCrosswalk: (entity, id, canonicalEntity) => (entity === "suppliers" && id === "V-441" && canonicalEntity === "Supplier" ? "SUP-0088" : undefined) },
    );
    expect(r.value).toBe("SUP-0088");
  });

  it("TR13: a same-name supplier with no crosswalk entry remains unresolved — never a silent name match", () => {
    const r = applyTransformation("resolve_crosswalk", "V-999", { sourceEntity: "suppliers", canonicalEntity: "Supplier" }, { resolveCrosswalk: () => undefined });
    expect(r.error).toBe("crosswalk_unresolved");
  });

  it("missing canonicalEntity configuration is a structured error, not a silent default", () => {
    const r = applyTransformation("resolve_crosswalk", "V-441", { sourceEntity: "suppliers" }, { resolveCrosswalk: () => "SUP-0088" });
    expect(r.error).toBe("crosswalk_canonical_entity_not_configured");
  });

  it("precedence tier 2: an explicit canonical code on a different field of the same record is used only when the crosswalk itself is unresolved", () => {
    const r = applyTransformation(
      "resolve_crosswalk",
      "V-999",
      { sourceEntity: "suppliers", canonicalEntity: "Supplier", fallbackCanonicalField: "Vendor_Canonical_Code" },
      { resolveCrosswalk: () => undefined, sourceRecordFields: { Vendor_Canonical_Code: "SUP-EXPLICIT-1" } },
    );
    expect(r.value).toBe("SUP-EXPLICIT-1");
  });

  it("precedence tier 3: with no crosswalk and no configured fallback field, resolution stays honestly unresolved", () => {
    const r = applyTransformation(
      "resolve_crosswalk",
      "V-999",
      { sourceEntity: "suppliers", canonicalEntity: "Supplier" },
      { resolveCrosswalk: () => undefined, sourceRecordFields: { Vendor_Name: "Same Name Co" } },
    );
    expect(r.error).toBe("crosswalk_unresolved");
  });
});

describe("TR14: transformation trace contains source field + operations", () => {
  it("applyTransformationPipeline reports every op it ran, in order, up to the failing one", () => {
    const ok = applyTransformationPipeline([{ op: "trim" }, { op: "uppercase" }], "  test  ");
    expect(ok).toMatchObject({ value: "TEST", opsRun: ["trim", "uppercase"] });

    const failing = applyTransformationPipeline([{ op: "trim" }, { op: "parse_decimal" }], "1234,56");
    expect(failing.opsRun).toEqual(["trim", "parse_decimal"]);
    expect(failing.error).toBe("decimal_convention_not_configured");
  });
});

describe("FVL-04.018 hardening F4: calendar-valid date parsing, not just day<=31/month<=12", () => {
  it("31/02/2026 (February never has 31 days) is rejected", () => {
    const r = applyTransformation("parse_date", "31/02/2026", { format: "DD/MM/YYYY" });
    expect(r.error).toBe("ambiguous_or_invalid_date");
  });

  it("29/02/2025 (2025 is not a leap year) is rejected", () => {
    const r = applyTransformation("parse_date", "29/02/2025", { format: "DD/MM/YYYY" });
    expect(r.error).toBe("ambiguous_or_invalid_date");
  });

  it("31/04/2026 (April has 30 days) is rejected", () => {
    const r = applyTransformation("parse_date", "31/04/2026", { format: "DD/MM/YYYY" });
    expect(r.error).toBe("ambiguous_or_invalid_date");
  });

  it("29/02/2024 (2024 IS a leap year) is accepted", () => {
    const r = applyTransformation("parse_date", "29/02/2024", { format: "DD/MM/YYYY" });
    expect(r.value).toBe("2024-02-29");
  });

  it("an ISO date with an impossible day is also rejected, not just slash-format dates", () => {
    const r = applyTransformation("parse_date", "2026-02-30", { format: "YYYY-MM-DD" });
    expect(r.error).toBe("ambiguous_or_invalid_date");
  });

  it("an unsupported format string is a structured configuration error", () => {
    const r = applyTransformation("parse_date", "2026-02-30", { format: "DD-MM-YYYY-nonsense" });
    expect(r.error).toBe("date_format_not_configured");
  });
});

describe("FVL-04.018 hardening F5: stricter decimal validation, no host-locale dependence", () => {
  it("malformed grouping (1,23,4 — groups are not all 3 digits) is rejected, not silently digit-stripped", () => {
    const r = applyTransformation("parse_decimal", "1,23,4", { decimalSeparator: ".", groupSeparator: "," });
    expect(r.error).toBe("ambiguous_or_invalid_decimal");
  });

  it("two decimal separators (1.2.3) is rejected", () => {
    const r = applyTransformation("parse_decimal", "1.2.3", { decimalSeparator: "." });
    expect(r.error).toBe("ambiguous_or_invalid_decimal");
  });

  it("groupSeparator equal to decimalSeparator is refused as an invalid configuration, not applied", () => {
    const r = applyTransformation("parse_decimal", "1,234", { decimalSeparator: ",", groupSeparator: "," });
    expect(r.error).toBe("invalid_decimal_configuration");
  });

  it("a well-formed grouped value with a genuine 3-digit group still parses correctly", () => {
    const r = applyTransformation("parse_decimal", "12,345,678.90", { decimalSeparator: ".", groupSeparator: "," });
    expect(r.value).toBe("12345678.9");
  });
});

describe("null propagation", () => {
  it("a null raw value stays null through the pipeline rather than becoming a fabricated value", () => {
    const r = applyTransformationPipeline([{ op: "trim" }, { op: "uppercase" }], null);
    expect(r.value).toBeNull();
  });
});
