import { describe, expect, it } from "vitest";
import { canonicalPolymerSchema, normalizePolymerMaterialNumber } from "./canonicalPolymer";
import { resolvePolymer } from "./polymerResolver";
import { supplierSdsProductEvidenceSchema } from "./supplierSdsProductEvidence";

const fact = (id: string, rawValue: string) => ({ id, rawValue, evidenceRefs: [`pdf:${id}`] });
const source = () => supplierSdsProductEvidenceSchema.parse({
  schemaVersion: "1.0",
  id: "sds-polymer-1",
  commercialProductId: "product-polymer-1",
  section1: {
    sectionNumber: 1,
    sourceDocumentHash: "a".repeat(64),
    declaredChemicalName: fact("s1-name", "Acrylic polymer"),
    chemicalNature: fact("s1-type", "Polymer"),
    casNumber: fact("s1-cas", "9003-11-6"),
    materialNumber: fact("s1-material", "PX-700"),
  },
  section3: {
    sectionNumber: 3,
    sourceDocumentHash: "a".repeat(64),
    substanceOrMixture: fact("s3-type", "Polymer"),
    components: [{
      id: "polymer-component",
      componentName: fact("s3-name", "Acrylic polymer"),
      casNumber: fact("s3-cas", "9003-11-6"),
      materialNumber: fact("s3-material", "px-700"),
      disclosure: "disclosed",
    }],
  },
});
const polymer = canonicalPolymerSchema.parse({
  schemaVersion: "1.0",
  id: "canonical-polymer-1",
  preferredName: "Acrylic copolymer",
  polymerType: "crosspolymer",
  materialNumbers: [{ originalValue: "PX-700", normalizedValue: "PX-700", provenanceId: "registry" }],
  casIdentifiers: [{ originalValue: "9003-11-6", normalizedValue: "9003-11-6", provenanceId: "registry" }],
  monomerReferences: [{ canonicalChemicalId: "monomer-acrylate", role: "monomer", provenanceId: "registry" }],
  properties: [{ kind: "molecular_weight", originalValue: "approximately 120000", unit: "g/mol", conditions: "supplier typical value", evidenceRefs: ["tds:page:2"], provenanceId: "registry" }],
  provenance: [{ id: "registry", sourceReference: "polymer-register:PX-700", recordedAt: "2026-10-26T08:00:00.000Z" }],
});
const classification = {
  productType: "POLYMER" as const,
  reasonCodes: ["explicit_type_evidence"],
  evidenceRefs: ["pdf:s1-type", "pdf:s3-type"],
  reviewRequired: true as const,
};

describe("polymer identity and resolver", () => {
  it("normalizes material-number case/spacing without losing the original", () => {
    expect(normalizePolymerMaterialNumber(" px-700 ")).toBe("PX-700");
    expect(canonicalPolymerSchema.parse(polymer).materialNumbers[0]?.originalValue).toBe("PX-700");
  });

  it("resolves explicit polymer evidence by shared CAS/material number and preserves polymer-specific properties", () => {
    const record = source();
    expect(resolvePolymer({ source: record, productType: classification, canonicalPolymers: [polymer] })).toMatchObject({
      status: "resolved_candidate",
      canonicalPolymerId: "canonical-polymer-1",
      polymerType: "crosspolymer",
      sourceEvidenceId: "sds-polymer-1",
      reviewRequired: true,
    });
    expect(polymer.properties[0]?.originalValue).toBe("approximately 120000");
    expect(record.section3.components[0]?.casNumber?.rawValue).toBe("9003-11-6");
  });

  it("does not match a polymer by name alone or coerce it through the small-molecule route", () => {
    const record = source();
    const mismatched = supplierSdsProductEvidenceSchema.parse({
      ...record,
      section3: { ...record.section3, components: record.section3.components.map((component) => ({ ...component, casNumber: undefined, materialNumber: undefined })) },
    });
    expect(resolvePolymer({ source: mismatched, productType: classification, canonicalPolymers: [polymer] }))
      .toMatchObject({ status: "unresolved", reasonCodes: ["no_shared_valid_polymer_identifier"] });
    expect(resolvePolymer({ source: record, productType: { ...classification, productType: "PURE_OR_NEAR_PURE" }, canonicalPolymers: [polymer] }).status)
      .toBe("unresolved");
    const conflict = supplierSdsProductEvidenceSchema.parse({
      ...record,
      section3: { ...record.section3, components: record.section3.components.map((component) => ({ ...component, casNumber: fact("different-cas", "64-17-5") })) },
    });
    expect(resolvePolymer({ source: conflict, productType: classification, canonicalPolymers: [polymer] }))
      .toMatchObject({ status: "unresolved", reasonCodes: ["section1_section3_polymer_identifiers_conflict"] });
    const conflictingCanonical = canonicalPolymerSchema.parse({
      ...polymer,
      id: "canonical-polymer-conflict",
      casIdentifiers: [{ originalValue: "64-17-5", normalizedValue: "64-17-5", provenanceId: "registry" }],
    });
    expect(resolvePolymer({ source: record, productType: classification, canonicalPolymers: [conflictingCanonical] }))
      .toMatchObject({ status: "unresolved", reasonCodes: ["no_canonical_polymer_matches_shared_identity"] });
  });
});
