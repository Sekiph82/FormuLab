import { describe, expect, it } from "vitest";
import { canonicalChemicalSchema } from "./canonicalChemical";
import { resolveSingleComponent } from "./singleComponentResolver";
import { supplierSdsProductEvidenceSchema } from "./supplierSdsProductEvidence";

const fact = (id: string, rawValue: string) => ({ id, rawValue, evidenceRefs: [`pdf:${id}`] });
const sourceRecord = (componentCas = "7732-18-5", productCas = "7732-18-5", concentrationValue = "99-100% w/w") => supplierSdsProductEvidenceSchema.parse({
  schemaVersion: "1.0",
  id: "source-evidence-1",
  commercialProductId: "commercial-product-water",
  section1: {
    sectionNumber: 1,
    sourceDocumentHash: "a".repeat(64),
    declaredChemicalName: fact("s1-name", "Water"),
    chemicalNature: fact("s1-nature", "Substance"),
    casNumber: fact("s1-cas", productCas),
    ecNumber: fact("s1-ec", "231-791-2"),
  },
  section3: {
    sectionNumber: 3,
    sourceDocumentHash: "a".repeat(64),
    substanceOrMixture: fact("s3-declaration", "Substance"),
    components: [{
      id: "component-water",
      componentName: fact("s3-name", "Water"),
      casNumber: fact("s3-cas", componentCas),
      ecNumber: fact("s3-ec", "231-791-2"),
      concentration: fact("s3-concentration", concentrationValue),
      disclosure: "disclosed",
    }],
  },
});
const productType = (record: ReturnType<typeof sourceRecord>) => ({
  productType: "PURE_OR_NEAR_PURE" as const,
  reasonCodes: ["explicit_type_evidence"],
  evidenceRefs: ["pdf:s1-nature", "pdf:s3-declaration"],
  reviewRequired: true as const,
});
const water = canonicalChemicalSchema.parse({
  schemaVersion: "1.0",
  id: "chemical-water",
  preferredName: "Water",
  casIdentifiers: [{ originalValue: "7732-18-5", normalizedValue: "7732-18-5" }],
  ecIdentifiers: [{ originalValue: "231-791-2", normalizedValue: "231-791-2" }],
  provenance: [{ id: "registry", sourceType: "public_registry", sourceReference: "registry:water", recordedAt: "2026-10-26T08:00:00.000Z" }],
});

describe("single component resolver", () => {
  it("proposes an exact canonical candidate only when both SDS sections and a mass majority support it", () => {
    const record = sourceRecord();
    expect(resolveSingleComponent({
      source: record,
      productType: productType(record),
      concentration: { sourceFactId: "s3-concentration", evidenceRefs: ["pdf:s3-concentration"] },
      canonicalChemicals: [water],
    })).toMatchObject({ status: "resolved_candidate", canonicalChemicalId: "chemical-water", reviewRequired: true });
  });

  it("does not resolve a product type, concentration or identifier conflict that fails its evidence gate", () => {
    const record = sourceRecord("64-17-5", "7732-18-5");
    expect(resolveSingleComponent({
      source: record,
      productType: productType(record),
      concentration: { sourceFactId: "s3-concentration", evidenceRefs: ["pdf:s3-concentration"] },
      canonicalChemicals: [water],
    })).toMatchObject({ status: "unresolved", reasonCodes: ["section1_section3_identifier_conflict"] });
    expect(resolveSingleComponent({
      source: sourceRecord(),
      productType: { ...productType(record), productType: "SOLUTION" },
      concentration: { sourceFactId: "s3-concentration", evidenceRefs: ["pdf:s3-concentration"] },
      canonicalChemicals: [water],
    })).toMatchObject({ status: "unresolved", reasonCodes: ["product_not_classified_pure_or_near_pure"] });
    const cleanRecord = sourceRecord("7732-18-5", "7732-18-5", "50% w/w");
    expect(resolveSingleComponent({
      source: cleanRecord,
      productType: productType(cleanRecord),
      concentration: { sourceFactId: "s3-concentration", evidenceRefs: ["pdf:s3-concentration"] },
      canonicalChemicals: [water],
    })).toMatchObject({ status: "unresolved", reasonCodes: ["concentration_does_not_prove_mass_majority"] });
  });

  it("reports ambiguity and does not mutate source or canonical records", () => {
    const record = sourceRecord();
    const duplicate = canonicalChemicalSchema.parse({ ...water, id: "chemical-water-alias" });
    const result = resolveSingleComponent({
      source: record,
      productType: productType(record),
      concentration: { sourceFactId: "s3-concentration", evidenceRefs: ["pdf:s3-concentration"] },
      canonicalChemicals: [water, duplicate],
    });
    expect(result).toMatchObject({ status: "ambiguous", reasonCodes: ["multiple_canonical_chemical_matches"], reviewRequired: true });
    expect(record.section3.components[0]?.casNumber?.rawValue).toBe("7732-18-5");
    expect(water.id).toBe("chemical-water");
  });

  it("does not resolve when composition disclosure is incomplete even if an upstream label says pure", () => {
    const complete = sourceRecord();
    const partial = supplierSdsProductEvidenceSchema.parse({
      ...complete,
      section3: { ...complete.section3, undisclosedRemainder: fact("remainder", "Other ingredients withheld") },
    });
    expect(resolveSingleComponent({
      source: partial,
      productType: productType(partial),
      concentration: { sourceFactId: "s3-concentration", evidenceRefs: ["pdf:s3-concentration"] },
      canonicalChemicals: [water],
    })).toMatchObject({ status: "unresolved", reasonCodes: ["composition_is_partially_or_proprietarily_disclosed"] });
  });
});
