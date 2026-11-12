import { describe, expect, it } from "vitest";
import { resolveProprietaryDisclosure } from "./proprietaryDisclosureResolver";
import { supplierSdsProductEvidenceSchema } from "./supplierSdsProductEvidence";

const fact = (id: string, rawValue: string) => ({ id, rawValue, evidenceRefs: [`pdf:${id}`] });
const source = () => supplierSdsProductEvidenceSchema.parse({
  schemaVersion: "1.0",
  id: "sds-proprietary-1",
  commercialProductId: "product-proprietary-1",
  section1: { sectionNumber: 1, sourceDocumentHash: "a".repeat(64), declaredChemicalName: fact("s1-name", "Proprietary polymer blend"), chemicalNature: fact("s1-nature", "Mixture") },
  section3: {
    sectionNumber: 3,
    sourceDocumentHash: "a".repeat(64),
    substanceOrMixture: fact("s3-declaration", "Mixture"),
    components: [
      { id: "generic", componentName: fact("generic-name", "Alkyl ether sulfate"), concentration: fact("generic-concentration", "10-20% w/w"), disclosure: "disclosed" },
      { id: "secret", componentName: fact("secret-name", "Proprietary component"), casNumber: fact("secret-cas", "64-17-5"), disclosure: "trade_secret" },
    ],
    undisclosedRemainder: fact("remainder", "Remaining composition withheld"),
  },
});
const productType = {
  productType: "PROPRIETARY_BLEND" as const,
  reasonCodes: ["trade_secret_disclosure_evidence"],
  evidenceRefs: ["pdf:s1-nature", "pdf:s3-declaration", "pdf:secret-name", "pdf:remainder"],
  reviewRequired: true as const,
};

describe("proprietary and partial disclosure resolver", () => {
  it("preserves generic family wording, withheld identifiers and unknown remainder as source evidence", () => {
    const record = source();
    const result = resolveProprietaryDisclosure({
      source: record,
      productType,
      genericFamilyEvidence: [{ componentId: "generic", sourceFactId: "generic-name", evidenceRefs: ["pdf:generic-name"] }],
    });
    expect(result.status).toBe("PARTIAL");
    expect(result.components[0]).toMatchObject({ genericFamilyText: "Alkyl ether sulfate", identityStatus: "UNKNOWN" });
    expect(result.components[1]).toMatchObject({ disclosure: "trade_secret", casNumber: "64-17-5", identityStatus: "PARTIAL" });
    expect(result.remainder).toMatchObject({ status: "explicitly_undisclosed", originalValue: "Remaining composition withheld" });
    expect(result).not.toHaveProperty("canonicalChemicalId");
    expect(result).not.toHaveProperty("composition");
    expect(result.reviewRequired).toBe(true);
  });

  it("reports identifier disagreement as ambiguous instead of resolving by generic name", () => {
    const levelsDiffer = supplierSdsProductEvidenceSchema.parse({
      ...source(),
      section1: { ...source().section1, casNumber: fact("s1-product-cas", "7732-18-5") },
      section3: { ...source().section3, components: source().section3.components.map((component) => ({ ...component, casNumber: component.id === "secret" ? fact("secret-component-cas", "64-17-5") : undefined })) },
    });
    expect(resolveProprietaryDisclosure({ source: levelsDiffer, productType }).status).toBe("PARTIAL");

    const record = supplierSdsProductEvidenceSchema.parse({
      ...source(),
      section1: { ...source().section1, casNumber: fact("s1-cas", "7732-18-5") },
      section3: { ...source().section3, components: source().section3.components.map((component) => ({ ...component, casNumber: component.id === "secret" ? fact("secret-cas", "64-17-5") : undefined })) },
      reconciliations: [{
        section1FactId: "s1-cas",
        section3ComponentId: "secret",
        outcome: "conflict",
        basis: "exact_cas",
        evidenceRefs: ["pdf:s1-cas", "pdf:secret-cas"],
        rationaleCode: "explicit_product_component_cas_disagreement",
      }],
    });
    const result = resolveProprietaryDisclosure({ source: record, productType });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.reasonCodes).toContain("section_identity_conflict");
  });

  it("returns UNKNOWN when there is no supported disclosure, and AMBIGUOUS for unlinked evidence", () => {
    const record = supplierSdsProductEvidenceSchema.parse({
      ...source(),
      section3: { ...source().section3, undisclosedRemainder: undefined, components: source().section3.components.map((component) => ({ ...component, disclosure: "disclosed" })) },
    });
    const result = resolveProprietaryDisclosure({
      source: record,
      productType: { productType: "UNKNOWN", reasonCodes: ["insufficient_product_type_evidence"], evidenceRefs: ["pdf:s1-name"], reviewRequired: true },
    });
    expect(result.status).toBe("UNKNOWN");
    const unlinked = resolveProprietaryDisclosure({
      source: record,
      productType: { productType: "PROPRIETARY_BLEND", reasonCodes: ["trade_secret_disclosure_evidence"], evidenceRefs: ["not-in-source"], reviewRequired: true },
    });
    expect(unlinked.status).toBe("AMBIGUOUS");
    expect(unlinked.reasonCodes).toContain("product_type_evidence_unlinked");
    expect(unlinked.reasonCodes).not.toContain("source_disclosure_preserved");
    expect(unlinked.evidenceRefs).not.toContain("not-in-source");
    const invalidFamily = resolveProprietaryDisclosure({
      source: record,
      productType: { productType: "UNKNOWN", reasonCodes: ["insufficient_product_type_evidence"], evidenceRefs: ["pdf:s1-name"], reviewRequired: true },
      genericFamilyEvidence: [{ componentId: "generic", sourceFactId: "missing", evidenceRefs: ["forged"] }],
    });
    expect(invalidFamily.status).toBe("AMBIGUOUS");
    expect(invalidFamily.evidenceRefs).not.toContain("forged");
  });
});
