import { describe, expect, it } from "vitest";
import type { SupplierSdsMeasurementContextInput } from "./supplierSdsMeasurementContext";
import { createSupplierSdsMeasurementContext } from "./supplierSdsMeasurementContext";

const HASH = "b".repeat(64);
const candidate = (rawValue: string, field: SupplierSdsMeasurementContextInput["field"] = "ph"): SupplierSdsMeasurementContextInput => ({
  field,
  rawValue,
  evidence: [{ sourceDocumentHash: HASH, sectionNumber: 9, pageNumber: 4, lineNumber: 12, excerpt: rawValue, source: "digital" }],
});

describe("supplier SDS physical-property measurement context", () => {
  it("retains original text, extracts explicit conditions and keeps page/source lineage", () => {
    const result = createSupplierSdsMeasurementContext(candidate("5.0–6.0 (10% aqueous solution, 20 °C)"));
    expect(result).toMatchObject({
      sourceDocumentHash: HASH,
      field: "ph",
      originalText: "5.0–6.0 (10% aqueous solution, 20 °C)",
      normalizedValue: { text: "5.0–6.0 (10% aqueous solution, 20 °C)", status: "range_normalized", lowerBound: 5, upperBound: 6 },
      temperature: { value: 20, unit: "°C", originalText: "20 °C" },
      sampleConcentration: { value: 10, basis: "percent", originalText: "10% aqueous solution" },
      deliveredFormBasis: "unspecified",
      claimKind: "unspecified",
      evidenceKind: "unspecified",
      evidence: [{ sourceDocumentHash: HASH, sectionNumber: 9, pageNumber: 4, lineNumber: 12 }],
      reviewRequired: true,
    });
    expect(result.normalizedValue.unit).toBeUndefined();
  });

  it("normalizes a simple scalar and recognized unit while preserving typical/specification wording", () => {
    const result = createSupplierSdsMeasurementContext(candidate("Typically 120 mPa·s at 25 °C; Brookfield method; specified range 100–150 mPa·s", "viscosity"));
    expect(result).toMatchObject({
      originalText: "Typically 120 mPa·s at 25 °C; Brookfield method; specified range 100–150 mPa·s",
      claimKind: "mixed_or_ambiguous",
      evidenceKind: "unspecified",
      temperature: { value: 25, unit: "°C" },
    });
    expect(result.normalizedValue.status).toBe("text_only");
    expect(result.methodOrStandard).toContain("Brookfield method");

    const scalar = createSupplierSdsMeasurementContext(candidate("< 1.02 g/cm³ (20 °C)", "density"));
    expect(scalar.normalizedValue).toMatchObject({ status: "scalar_normalized", qualifier: "less_than", value: 1.02, unit: "g/cm³" });
    expect(createSupplierSdsMeasurementContext(candidate("120 mPa·s", "viscosity")).normalizedValue).toMatchObject({ status: "scalar_normalized", value: 120, unit: "mPa·s" });
    expect(createSupplierSdsMeasurementContext(candidate("2.5 MPa")).normalizedValue).toMatchObject({ status: "scalar_normalized", value: 2.5, unit: "MPa" });
    expect(createSupplierSdsMeasurementContext(candidate("12 kPa")).normalizedValue).toMatchObject({ status: "scalar_normalized", value: 12, unit: "kPa" });
    expect(createSupplierSdsMeasurementContext(candidate("101 Pa")).normalizedValue).toMatchObject({ status: "scalar_normalized", value: 101, unit: "Pa" });
    expect(createSupplierSdsMeasurementContext(candidate("1.2/1.4 g/mL", "density")).normalizedValue).toMatchObject({ text: "1.2/1.4 g/mL", status: "text_only" });
    expect(createSupplierSdsMeasurementContext(candidate("1.20 ± 0.05 g/mL", "density")).normalizedValue).toMatchObject({ text: "1.20 ± 0.05 g/mL", status: "text_only" });
    expect(createSupplierSdsMeasurementContext(candidate("1.20 +/- 0.05 g/mL", "density")).normalizedValue).toMatchObject({ text: "1.20 +/- 0.05 g/mL", status: "text_only" });
  });

  it("classifies only explicit evidence/status and delivered-form basis language", () => {
    const result = createSupplierSdsMeasurementContext(candidate("Measured typical value: 38% active matter, as supplied; determined experimentally by ISO 2271"));
    expect(result).toMatchObject({
      claimKind: "typical",
      evidenceKind: "measured",
      deliveredFormBasis: "as_supplied",
      deliveredFormBasisText: "as supplied",
      methodOrStandard: ["ISO 2271"],
    });
    expect(createSupplierSdsMeasurementContext(candidate("Estimated literature value: about 1.1 g/mL, on a dry basis")).evidenceKind).toBe("mixed_or_ambiguous");
    expect(createSupplierSdsMeasurementContext(candidate("Reported literature value: 1.1 g/mL")).evidenceKind).toBe("literature");
    expect(createSupplierSdsMeasurementContext(candidate("Release specification range: 1.0–1.2 g/mL")).claimKind).toBe("specification");
  });

  it("does not invent numeric normalizations from ambiguous or descriptive source values", () => {
    for (const rawValue of ["clear, pale yellow liquid", "approximately 1,2-1,4%", "data not available"]) {
      const result = createSupplierSdsMeasurementContext(candidate(rawValue));
      expect(result.normalizedValue).toMatchObject({ text: rawValue, status: "text_only" });
      expect(result.temperature).toBeUndefined();
      expect(result.sampleConcentration).toBeUndefined();
      expect(result.deliveredFormBasis).toBe("unspecified");
    }
  });

  it("does not confuse temperature-valued properties with measurement temperature conditions", () => {
    const melting = createSupplierSdsMeasurementContext(candidate("< -20 °C", "melting_point"));
    expect(melting.normalizedValue).toMatchObject({ status: "scalar_normalized", qualifier: "less_than", value: -20, unit: "°C" });
    expect(melting.temperature).toBeUndefined();

    const boiling = createSupplierSdsMeasurementContext(candidate(">100 °C at 101.3 kPa", "boiling_point"));
    expect(boiling.normalizedValue).toMatchObject({ status: "scalar_normalized", qualifier: "greater_than", value: 100, unit: "°C" });
    expect(boiling.temperature).toBeUndefined();

    expect(createSupplierSdsMeasurementContext(candidate("0.99 g/mL at 20 °C", "density")).temperature).toMatchObject({ value: 20, unit: "°C" });
  });

  it("requires document-hash evidence before building a context", () => {
    const invalid = candidate("20 °C");
    invalid.evidence = [];
    expect(() => createSupplierSdsMeasurementContext(invalid)).toThrow(/SHA-256/u);
  });
});
