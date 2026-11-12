import { describe, expect, it } from "vitest";
import { extractSupplierSdsSection9PhysicalProperties } from "../engine/supplierSdsSection9PhysicalProperties";
import type { SupplierSdsSectionLine } from "../engine/supplierSdsSectionDetection";
import { linkSupplierSdsPhysicalProperty, linkedSupplierPhysicalPropertySchema, validateLinkedSupplierPhysicalPropertyAgainstSource } from "./physicalPropertyEvidence";
import { supplierSdsProductEvidenceSchema } from "./supplierSdsProductEvidence";

const hash = "a".repeat(64);
const source = (sourceHash = hash) => supplierSdsProductEvidenceSchema.parse({
  schemaVersion: "1.0", id: "sds-product-1", commercialProductId: "commercial-1",
  section1: { sectionNumber: 1, sourceDocumentHash: sourceHash, declaredChemicalName: { id: "product-name", rawValue: "Example grade", evidenceRefs: ["sds:s1"] } },
  section3: { sectionNumber: 3, sourceDocumentHash: sourceHash, components: [] },
});
const lines: SupplierSdsSectionLine[] = [
  { pageNumber: 1, lineNumber: 1, text: "9. Physical and chemical properties" },
  { pageNumber: 1, lineNumber: 2, text: "pH: 5.0-5.5 at 20 °C", source: "digital" },
  { pageNumber: 1, lineNumber: 3, text: "10. Stability and reactivity" },
];

describe("linked supplier physical-property evidence", () => {
  it("links Section 9 candidates to the commercial product while retaining conditions and line citations", () => {
    const candidate = extractSupplierSdsSection9PhysicalProperties({ sourceDocumentHash: hash, lines }).candidates[0]!;
    const linked = linkSupplierSdsPhysicalProperty({ source: source(), candidate, parserVersion: "section9-test-v1" });
    expect(linked).toMatchObject({
      commercialProductId: "commercial-1", sourceEvidenceId: "sds-product-1", sourceDocumentHash: hash,
      field: "ph", rawValue: "5.0-5.5 at 20 °C", measurementContext: { temperature: { value: 20, unit: "°C" } },
      evidenceRefs: [`sds:${hash}:section9:p1:l2`], reviewRequired: true,
    });
    expect(linked).not.toHaveProperty("rawMaterialId");
    expect(validateLinkedSupplierPhysicalPropertyAgainstSource(linked, source())).toEqual(linked);
    expect(() => linkedSupplierPhysicalPropertySchema.parse({
      ...linked,
      measurementContext: { ...linked.measurementContext, originalText: "other value", normalizedValue: { ...linked.measurementContext.normalizedValue, text: "mismatch" } },
    })).toThrow(/preserve the candidate field and original value/);
    expect(() => linkedSupplierPhysicalPropertySchema.parse({
      ...linked,
      measurementContext: { ...linked.measurementContext, evidence: [] },
    })).toThrow(/must match exactly/);
    expect(() => validateLinkedSupplierPhysicalPropertyAgainstSource({ ...linked, sourceEvidenceId: "other-sds" }, source()))
      .toThrow(/does not match its immutable SDS/);
  });

  it("rejects a candidate from another SDS document", () => {
    const candidate = extractSupplierSdsSection9PhysicalProperties({ sourceDocumentHash: hash, lines }).candidates[0]!;
    expect(() => linkSupplierSdsPhysicalProperty({ source: source("b".repeat(64)), candidate, parserVersion: "section9-test-v1" }))
      .toThrow(/same immutable SDS/);
  });
});
