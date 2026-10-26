import { describe, expect, it } from "vitest";
import { compositionFractionEvidenceSchema, createCompositionFractionEvidence, validateCompositionFractionEvidenceAgainstSource } from "./compositionFraction";
import { supplierSdsProductEvidenceSchema } from "./supplierSdsProductEvidence";

const source = () => supplierSdsProductEvidenceSchema.parse({
  schemaVersion: "1.0",
  id: "sds-fraction-1",
  commercialProductId: "commercial-product-1",
  section1: { sectionNumber: 1, sourceDocumentHash: "a".repeat(64), declaredChemicalName: { id: "s1-name", rawValue: "Example product", evidenceRefs: ["pdf:s1-name"] } },
  section3: {
    sectionNumber: 3,
    sourceDocumentHash: "a".repeat(64),
    components: [
      { id: "component-range", componentName: { id: "name-1", rawValue: "Surfactant", evidenceRefs: ["pdf:name"] }, concentration: { id: "concentration-1", rawValue: "38-42% w/w", evidenceRefs: ["pdf:section3:row1"] }, disclosure: "disclosed" },
      { id: "component-exact", concentration: { id: "concentration-2", rawValue: "10% w/w", evidenceRefs: ["pdf:section3:row2"] }, disclosure: "trade_secret" },
      { id: "component-unparsed", concentration: { id: "concentration-3", rawValue: "less than 5 percent", evidenceRefs: ["pdf:section3:row3"] }, disclosure: "disclosed" },
      { id: "component-missing", componentName: { id: "name-4", rawValue: "Unknown", evidenceRefs: ["pdf:name4"] }, disclosure: "unknown" },
    ],
  },
});

describe("component fraction evidence", () => {
  it("stores exact and ranged source composition as normalized mass fractions with independent lineage", () => {
    const record = createCompositionFractionEvidence(source(), "component-range");
    expect(record).toMatchObject({
      quantityKind: "component_fraction",
      basis: "mass_fraction_of_commercial_product",
      sourceEvidenceId: "sds-fraction-1",
      sourceDocumentHash: "a".repeat(64),
      sourceComponentId: "component-range",
      sourceFactId: "concentration-1",
      originalValue: "38-42% w/w",
      fraction: { lowerBound: 0.38, upperBound: 0.42, interpretation: "range" },
      evidenceRefs: ["pdf:section3:row1"],
    });
    expect(createCompositionFractionEvidence(source(), "component-exact")?.fraction)
      .toEqual({ lowerBound: 0.1, upperBound: 0.1, interpretation: "exact" });
    expect(createCompositionFractionEvidence(source(), "component-unparsed")?.fraction)
      .toEqual({ interpretation: "unparsed" });
    expect(createCompositionFractionEvidence(source(), "component-missing")).toBeUndefined();
  });

  it("rejects fabricated or cross-kind numeric fractions", () => {
    const record = createCompositionFractionEvidence(source(), "component-range")!;
    expect(() => compositionFractionEvidenceSchema.parse({ ...record, fraction: { ...record.fraction, lowerBound: 0.1 } }))
      .toThrow(/must match the cited source/);
    expect(() => compositionFractionEvidenceSchema.parse({ ...record, basis: "active_matter" }))
      .toThrow();
    expect(() => compositionFractionEvidenceSchema.parse({ ...record, fraction: { lowerBound: 0.38, upperBound: 0.42, interpretation: "exact" } }))
      .toThrow(/Exact component fraction bounds must be equal/);
  });

  it("validates persisted source identity, component fact, hash, raw value and citations", () => {
    const originalSource = source();
    const record = createCompositionFractionEvidence(originalSource, "component-range")!;
    expect(validateCompositionFractionEvidenceAgainstSource(record, originalSource)).toEqual(record);
    expect(() => validateCompositionFractionEvidenceAgainstSource({ ...record, sourceFactId: "other-fact" }, originalSource))
      .toThrow(/lineage does not match/);
    expect(() => validateCompositionFractionEvidenceAgainstSource({ ...record, evidenceRefs: ["forged"] }, originalSource))
      .toThrow(/lineage does not match/);
  });
});
