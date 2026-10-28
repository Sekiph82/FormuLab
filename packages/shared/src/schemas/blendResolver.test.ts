import { describe, expect, it } from "vitest";
import { canonicalChemicalSchema } from "./canonicalChemical";
import { blendRepresentationSchema, resolveBlend } from "./blendResolver";
import { supplierSdsProductEvidenceSchema } from "./supplierSdsProductEvidence";

const fact = (id: string, rawValue: string) => ({ id, rawValue, evidenceRefs: [`pdf:${id}`] });
const source = () => supplierSdsProductEvidenceSchema.parse({
  schemaVersion: "1.0",
  id: "sds-blend-1",
  commercialProductId: "commercial-blend-1",
  section1: { sectionNumber: 1, sourceDocumentHash: "a".repeat(64), declaredChemicalName: fact("s1-name", "Example cleaning blend"), chemicalNature: fact("s1-type", "Mixture") },
  section3: {
    sectionNumber: 3,
    sourceDocumentHash: "a".repeat(64),
    substanceOrMixture: fact("s3-type", "Mixture"),
    components: [
      { id: "component-water", componentName: fact("water-name", "Water"), casNumber: fact("water-cas", "7732-18-5"), concentration: fact("water-concentration", "70-80% w/w"), disclosure: "disclosed" },
      { id: "component-ethanol", componentName: fact("ethanol-name", "Ethanol"), casNumber: fact("ethanol-cas", "64-17-5"), concentration: fact("ethanol-concentration", "10% w/w"), disclosure: "disclosed" },
      { id: "component-secret", componentName: fact("secret-name", "Proprietary ingredient"), concentration: fact("secret-concentration", "1-5% w/w"), disclosure: "trade_secret" },
    ],
    undisclosedRemainder: fact("remainder", "Other ingredients not disclosed"),
  },
});
const chemical = (id: string, name: string, cas: string) => canonicalChemicalSchema.parse({
  schemaVersion: "1.0",
  id,
  preferredName: name,
  casIdentifiers: [{ originalValue: cas, normalizedValue: cas }],
  provenance: [{ id: `registry-${id}`, sourceType: "public_registry", sourceReference: `registry:${id}`, recordedAt: "2026-10-26T08:00:00.000Z" }],
});
const productType = {
  productType: "MULTICOMPONENT_BLEND" as const,
  reasonCodes: ["explicit_type_evidence"],
  evidenceRefs: ["pdf:s1-type", "pdf:s3-type"],
  reviewRequired: true as const,
};

describe("multicomponent blend resolver", () => {
  it("keeps every component separate with source concentration and independent identity outcomes", () => {
    const result = resolveBlend({
      source: source(),
      productType,
      canonicalChemicals: [chemical("water", "Water", "7732-18-5"), chemical("ethanol", "Ethanol", "64-17-5")],
    });
    expect(result.status).toBe("represented");
    expect(result.components).toHaveLength(3);
    expect(result.components[0]).toMatchObject({
      sourceComponentId: "component-water",
      canonicalChemicalId: "water",
      identityStatus: "matched_candidate",
      concentration: { originalValue: "70-80% w/w", massPercentLowerBound: 70, massPercentUpperBound: 80, interpretation: "range" },
    });
    expect(result.components[1]).toMatchObject({ canonicalChemicalId: "ethanol", concentration: { interpretation: "exact", massPercentLowerBound: 10, massPercentUpperBound: 10 } });
    expect(result.components[2]).toMatchObject({ disclosure: "trade_secret", identityStatus: "withheld" });
    expect(result.remainder).toMatchObject({ status: "explicitly_undisclosed", originalValue: "Other ingredients not disclosed" });
    expect(result).not.toHaveProperty("canonicalChemicalId");
    expect(result.reviewRequired).toBe(true);
  });

  it("does not fuzzy-resolve names or claim an unreported remainder is absent", () => {
    const record = supplierSdsProductEvidenceSchema.parse({
      ...source(),
      section3: { ...source().section3, undisclosedRemainder: undefined },
    });
    const result = resolveBlend({ source: record, productType, canonicalChemicals: [] });
    expect(result.components.every((component) => component.identityStatus === "unmatched" || component.identityStatus === "withheld")).toBe(true);
    expect(result.remainder.status).toBe("not_reported");
    expect(result).not.toHaveProperty("activeMatterPercent");
  });

  it("requires multiple separate components and cited blend classification", () => {
    const record = source();
    expect(resolveBlend({ source: record, productType: { ...productType, productType: "SOLUTION" }, canonicalChemicals: [] }))
      .toMatchObject({ status: "unresolved", reasonCodes: ["product_not_classified_as_multicomponent_blend"] });
    const oneComponent = supplierSdsProductEvidenceSchema.parse({
      ...record,
      section3: { ...record.section3, components: [record.section3.components[0]] },
    });
    expect(resolveBlend({ source: oneComponent, productType, canonicalChemicals: [] }))
      .toMatchObject({ status: "unresolved", reasonCodes: ["fewer_than_two_disclosed_components"] });
  });

  it("rejects forged concentration interpretations and remainder states", () => {
    const record = resolveBlend({ source: source(), productType, canonicalChemicals: [] });
    expect(() => blendRepresentationSchema.parse({
      ...record,
      components: record.components.map((component, index) => index === 0 ? {
        ...component,
        concentration: { originalValue: "70-80% w/w", massPercentLowerBound: 70, massPercentUpperBound: 80, interpretation: "exact" },
      } : component),
    })).toThrow(/Exact concentration bounds must be equal/);
    expect(() => blendRepresentationSchema.parse({
      ...record,
      components: record.components.map((component, index) => index === 0 ? {
        ...component,
        concentration: { originalValue: "70-80% w/w", massPercentLowerBound: 5, massPercentUpperBound: 10, interpretation: "range" },
      } : component),
    })).toThrow(/Concentration bounds must match the exact source text/);
    expect(() => blendRepresentationSchema.parse({
      ...record,
      components: record.components.map((component, index) => index === 0 ? {
        ...component,
        concentration: { originalValue: "70-80% w/w", interpretation: "unparsed" },
      } : component),
    })).toThrow(/cannot be labeled unparsed/);
    expect(() => blendRepresentationSchema.parse({
      ...record,
      remainder: { status: "explicitly_undisclosed" },
    })).toThrow(/requires its source text and evidence references/);
    expect(() => blendRepresentationSchema.parse({
      ...record,
      remainder: { status: "not_reported", originalValue: "hidden ingredients", evidenceRefs: ["forged"] },
    })).toThrow(/cannot carry undisclosed remainder source data/);
  });
});
