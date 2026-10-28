import { describe, expect, it } from "vitest";
import { reconcileSection1WithSection3Component, supplierSdsProductEvidenceRecordSchema, supplierSdsProductEvidenceSchema } from "./supplierSdsProductEvidence";

const fact = (id: string, rawValue: string) => ({ id, rawValue, evidenceRefs: [`pdf-sha:page:${id}`] });
const validEvidence = {
  schemaVersion: "1.0" as const,
  id: "sds-evidence-1",
  commercialProductId: "commercial-product-1",
  section1: {
    sectionNumber: 1 as const,
    sourceDocumentHash: "a".repeat(64),
    declaredChemicalName: fact("s1-name", "Supplier product solution"),
    chemicalNature: fact("s1-nature", "Mixture"),
    casNumber: fact("s1-cas", " 64-17-5 "),
  },
  section3: {
    sectionNumber: 3 as const,
    sourceDocumentHash: "a".repeat(64),
    substanceOrMixture: fact("s3-declaration", "Mixture"),
    components: [{
      id: "component-1",
      componentName: fact("s3-name", "Sodium chloride"),
      casNumber: fact("s3-cas", "7647-14-5"),
      concentration: fact("s3-concentration", "1-5%"),
      disclosure: "disclosed" as const,
    }],
    undisclosedRemainder: fact("s3-remainder", "Remaining ingredients not disclosed"),
  },
  reconciliations: [{
    section1FactId: "s1-cas",
    section3ComponentId: "component-1",
    outcome: "conflict" as const,
    basis: "exact_cas" as const,
    evidenceRefs: ["pdf-sha:page:s1-cas", "pdf-sha:page:s3-cas"],
    rationaleCode: "section_product_cas_differs_from_component_cas",
  }],
};

describe("supplierSdsProductEvidenceSchema", () => {
  it("stores Section 1 product identity apart from Section 3 component composition", () => {
    const parsed = supplierSdsProductEvidenceSchema.parse(validEvidence);
    expect(parsed.section1.sectionNumber).toBe(1);
    expect(parsed.section1.casNumber?.rawValue).toBe(" 64-17-5 ");
    expect(parsed.section3.components[0]?.casNumber?.rawValue).toBe("7647-14-5");
    expect(parsed.reconciliations[0]?.outcome).toBe("conflict");
    expect(parsed).not.toHaveProperty("canonicalChemicalId");
    expect(parsed).not.toHaveProperty("rawMaterial");
  });

  it("requires persisted extraction snapshots to keep evidence identity and acquisition provenance", () => {
    const record = supplierSdsProductEvidenceRecordSchema.parse({
      schemaVersion: "1.0", code: validEvidence.id, acquisitionCode: "supplier-sds-acquisition-1",
      evidence: validEvidence, extractionStatus: "unreviewed", createdAt: "2026-10-26T10:00:00Z",
    });
    expect(record.extractionStatus).toBe("unreviewed");
    expect(() => supplierSdsProductEvidenceRecordSchema.parse({
      ...record, code: "different-evidence-code",
    })).toThrow(/must match its immutable evidence identity/);
    expect(() => supplierSdsProductEvidenceRecordSchema.parse({
      ...record, extractionStatus: "verified",
    })).toThrow();
  });

  it("rejects evidence placed in the wrong SDS section and non-cited claims", () => {
    expect(() => supplierSdsProductEvidenceSchema.parse({
      ...validEvidence,
      section1: { ...validEvidence.section1, sectionNumber: 3 },
    })).toThrow();
    expect(() => supplierSdsProductEvidenceSchema.parse({
      ...validEvidence,
      section1: { ...validEvidence.section1, productDescription: { id: "uncited", rawValue: "A mixture", evidenceRefs: [] } },
    })).toThrow();
  });

  it("requires reconciliation to reference source facts and actual Section 3 components", () => {
    expect(() => supplierSdsProductEvidenceSchema.parse({
      ...validEvidence,
      reconciliations: [{ ...validEvidence.reconciliations[0], section1FactId: "missing-fact" }],
    })).toThrow(/existing Section 1 product fact/);
    expect(() => supplierSdsProductEvidenceSchema.parse({
      ...validEvidence,
      reconciliations: [{ ...validEvidence.reconciliations[0], section3ComponentId: "missing-component" }],
    })).toThrow(/existing Section 3 component/);
    expect(() => supplierSdsProductEvidenceSchema.parse({
      ...validEvidence,
      reconciliations: [{ ...validEvidence.reconciliations[0], outcome: "consistent" }],
    })).toThrow(/outcome must match the validated source identifiers/);
    expect(() => supplierSdsProductEvidenceSchema.parse({
      ...validEvidence,
      reconciliations: [{ ...validEvidence.reconciliations[0], evidenceRefs: ["unrelated-source"] }],
    })).toThrow(/must cite both linked identifier facts/);
  });

  it("preserves a single-document source and unambiguous fact IDs", () => {
    expect(() => supplierSdsProductEvidenceSchema.parse({
      ...validEvidence,
      section3: { ...validEvidence.section3, sourceDocumentHash: "b".repeat(64) },
    })).toThrow(/same SDS document/);
    expect(() => supplierSdsProductEvidenceSchema.parse({
      ...validEvidence,
      section3: {
        ...validEvidence.section3,
        components: [{ ...validEvidence.section3.components[0], componentName: fact("s1-cas", "duplicate id") }],
      },
    })).toThrow(/IDs must be unique/);
  });

  it("reconciles sections only through exact validated CAS/EC identifiers", () => {
    const section1 = {
      sectionNumber: 1 as const,
      sourceDocumentHash: "a".repeat(64),
      declaredChemicalName: fact("name", "Water"),
      casNumber: fact("s1-cas", "7732-18-5"),
      ecNumber: fact("s1-ec", "231-791-2"),
    };
    const sameComponent = { id: "component-same", casNumber: fact("same-cas", "7732-18-5"), ecNumber: fact("same-ec", "231-791-2"), disclosure: "disclosed" as const };
    expect(reconcileSection1WithSection3Component(section1, sameComponent)).toMatchObject({
      outcome: "consistent",
      basis: "exact_cas",
      rationaleCode: "shared_validated_identifier",
    });

    const differentComponent = { id: "component-different", casNumber: fact("different-cas", "64-17-5"), disclosure: "disclosed" as const };
    expect(reconcileSection1WithSection3Component(section1, differentComponent)).toMatchObject({
      outcome: "conflict",
      basis: "exact_cas",
      rationaleCode: "validated_section_identifiers_conflict",
    });

    const invalidComponent = { id: "component-invalid", casNumber: fact("invalid-cas", "7732-18-4"), disclosure: "disclosed" as const };
    expect(reconcileSection1WithSection3Component(section1, invalidComponent)).toMatchObject({
      outcome: "unresolved",
      basis: "insufficient_evidence",
      rationaleCode: "section_identifier_failed_validation",
    });

    const section1NameOnly = {
      sectionNumber: 1 as const,
      sourceDocumentHash: "a".repeat(64),
      declaredChemicalName: fact("name-only", "Water"),
    };
    const componentIdentifierOnly = { id: "component-one-sided", casNumber: fact("component-cas", "7732-18-5"), disclosure: "disclosed" as const };
    const unresolved = reconcileSection1WithSection3Component(section1NameOnly, componentIdentifierOnly);
    expect(unresolved).toMatchObject({ outcome: "unresolved", basis: "insufficient_evidence" });
    expect(unresolved.evidenceRefs).toContain("pdf-sha:page:name-only");
    expect(supplierSdsProductEvidenceSchema.parse({
      schemaVersion: "1.0",
      id: "one-sided-evidence",
      commercialProductId: "product-1",
      section1: section1NameOnly,
      section3: { sectionNumber: 3, sourceDocumentHash: "a".repeat(64), components: [componentIdentifierOnly] },
      reconciliations: [unresolved],
    }).reconciliations).toHaveLength(1);
  });
});
