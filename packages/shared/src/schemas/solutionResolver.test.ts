import { describe, expect, it } from "vitest";
import { canonicalChemicalSchema } from "./canonicalChemical";
import { resolveSolution } from "./solutionResolver";
import { supplierSdsProductEvidenceSchema } from "./supplierSdsProductEvidence";

const fact = (id: string, rawValue: string) => ({ id, rawValue, evidenceRefs: [`pdf:${id}`] });
const source = () => supplierSdsProductEvidenceSchema.parse({
  schemaVersion: "1.0",
  id: "sds-solution-1",
  commercialProductId: "product-solution-1",
  section1: { sectionNumber: 1, sourceDocumentHash: "a".repeat(64), declaredChemicalName: fact("s1-name", "Sodium chloride solution"), chemicalNature: fact("s1-type", "Mixture") },
  section3: {
    sectionNumber: 3,
    sourceDocumentHash: "a".repeat(64),
    substanceOrMixture: fact("s3-type", "Mixture"),
    components: [
      { id: "solute", componentName: fact("solute-name", "Sodium chloride"), casNumber: fact("solute-cas", "7647-14-5"), concentration: fact("solute-concentration", "10-20% w/w"), disclosure: "disclosed" },
      { id: "carrier", componentName: fact("carrier-name", "Water"), casNumber: fact("carrier-cas", "7732-18-5"), concentration: fact("carrier-concentration", "80-90% w/w"), disclosure: "disclosed" },
    ],
  },
});
const sodiumChloride = canonicalChemicalSchema.parse({
  schemaVersion: "1.0",
  id: "chemical-sodium-chloride",
  preferredName: "Sodium chloride",
  casIdentifiers: [{ originalValue: "7647-14-5", normalizedValue: "7647-14-5" }],
  provenance: [{ id: "registry", sourceType: "public_registry", sourceReference: "registry:sodium-chloride", recordedAt: "2026-10-26T08:00:00.000Z" }],
});
const classification = {
  productType: "SOLUTION" as const,
  reasonCodes: ["explicit_type_evidence"],
  evidenceRefs: ["pdf:s1-type", "pdf:s3-type"],
  reviewRequired: true as const,
};
const roles = {
  soluteComponentId: "solute",
  carrierComponentId: "carrier",
  soluteEvidenceRef: "pdf:solute-name",
  carrierEvidenceRef: "pdf:carrier-name",
  reviewedBy: "chemist-1",
};

describe("solution resolver", () => {
  it("keeps the exact source concentration interval and proposes the reviewed solute separately from carrier", () => {
    const record = source();
    expect(resolveSolution({ source: record, productType: classification, roles, canonicalChemicals: [sodiumChloride] })).toMatchObject({
      status: "resolved_candidate",
      sourceEvidenceId: "sds-solution-1",
      rolesReviewedBy: "chemist-1",
      soluteCanonicalChemicalId: "chemical-sodium-chloride",
      compositionDisclosure: "unknown",
      concentration: { originalValue: "10-20% w/w", lowerBoundPercent: 10, upperBoundPercent: 20, interpretation: "range", basis: "percent_w_w" },
      reviewRequired: true,
    });
    expect(resolveSolution({ source: record, productType: classification, roles, canonicalChemicals: [sodiumChloride] })).not.toHaveProperty("activeMatterPercent");
  });

  it("does not resolve missing role evidence, wrong product type or unreadable concentration", () => {
    const record = source();
    expect(resolveSolution({ source: record, productType: { ...classification, productType: "POLYMER" }, roles, canonicalChemicals: [sodiumChloride] }).status)
      .toBe("unresolved");
    expect(resolveSolution({ source: record, productType: classification, roles: { ...roles, soluteEvidenceRef: "unrelated" }, canonicalChemicals: [sodiumChloride] }).status)
      .toBe("unresolved");
    const unreadable = supplierSdsProductEvidenceSchema.parse({
      ...record,
      section3: { ...record.section3, components: record.section3.components.map((component) => component.id === "solute"
        ? { ...component, concentration: fact("solute-concentration", "about 15 percent") }
        : component) },
    });
    expect(resolveSolution({ source: unreadable, productType: classification, roles, canonicalChemicals: [sodiumChloride] }).status)
      .toBe("unresolved");
  });

  it("keeps a printed exact value exact and reports ambiguous canonical identities", () => {
    const record = source();
    const exact = supplierSdsProductEvidenceSchema.parse({
      ...record,
      section3: { ...record.section3, components: record.section3.components.map((component) => component.id === "solute"
        ? { ...component, concentration: fact("solute-concentration", "15% w/w") }
        : component) },
    });
    expect(resolveSolution({ source: exact, productType: classification, roles, canonicalChemicals: [sodiumChloride] }))
      .toMatchObject({ concentration: { lowerBoundPercent: 15, upperBoundPercent: 15, interpretation: "exact" } });
    const duplicate = canonicalChemicalSchema.parse({ ...sodiumChloride, id: "chemical-sodium-chloride-duplicate" });
    expect(resolveSolution({ source: record, productType: classification, roles, canonicalChemicals: [sodiumChloride, duplicate] }).status)
      .toBe("ambiguous");
  });
});
