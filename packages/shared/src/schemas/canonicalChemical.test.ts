import { describe, expect, it } from "vitest";
import { canonicalChemicalSchema } from "./canonicalChemical";

const validChemical = {
  schemaVersion: "1.0" as const,
  id: "chem-opaque-1",
  preferredName: "Sodium laureth sulfate",
  casIdentifiers: [{ value: "68891-38-3", provenanceId: "source-sds" }],
  ecIdentifiers: [{ value: "500-234-8", provenanceId: "source-registry" }],
  inciName: "Sodium Laureth Sulfate",
  synonyms: [
    { value: "SLES", kind: "abbreviation" as const, provenanceId: "source-sds" },
    { value: "Sodium lauryl ether sulfate", kind: "synonym" as const },
  ],
  chemicalFamily: "ethoxylated sulfate surfactant",
  functionalFamilies: ["anionic surfactant", "detergent"],
  provenance: [
    { id: "source-sds", sourceType: "supplier_sds" as const, sourceReference: "SDS section 3", sourceDocumentCode: "doc-sds-1", pageOrSection: "Section 3", recordedAt: "2026-10-26T08:00:00.000Z" },
    { id: "source-registry", sourceType: "public_registry" as const, sourceReference: "Registry entry 500-234-8", recordedAt: "2026-10-26T08:05:00.000Z" },
  ],
};

describe("canonicalChemicalSchema", () => {
  it("captures stable identity, identifiers, applicable INCI, synonyms, families and source lineage", () => {
    const chemical = canonicalChemicalSchema.parse(validChemical);
    expect(chemical.id).toBe("chem-opaque-1");
    expect(chemical.casIdentifiers[0]?.value).toBe("68891-38-3");
    expect(chemical.inciName).toBe("Sodium Laureth Sulfate");
    expect(chemical.synonyms[0]).toMatchObject({ value: "SLES", kind: "abbreviation" });
    expect(chemical.chemicalFamily).toBe("ethoxylated sulfate surfactant");
    expect(chemical.functionalFamilies).toEqual(["anionic surfactant", "detergent"]);
    expect(chemical.provenance).toHaveLength(2);
    expect(chemical).not.toHaveProperty("rawMaterial");
    expect(chemical).not.toHaveProperty("supplierId");
  });

  it("allows chemistry without INCI and defaults optional collections without inventing identifiers", () => {
    const chemical = canonicalChemicalSchema.parse({
      schemaVersion: "1.0",
      id: "polymer-opaque-1",
      preferredName: "Acrylic copolymer",
      provenance: [{ id: "source-1", sourceType: "literature", sourceReference: "doi:10.example/one", recordedAt: "2026-10-26T08:00:00.000Z" }],
    });
    expect(chemical.inciName).toBeUndefined();
    expect(chemical.casIdentifiers).toEqual([]);
    expect(chemical.ecIdentifiers).toEqual([]);
    expect(chemical.synonyms).toEqual([]);
    expect(chemical.functionalFamilies).toEqual([]);
  });

  it("requires source provenance and valid provenance links", () => {
    expect(() => canonicalChemicalSchema.parse({ ...validChemical, provenance: [] })).toThrow();
    expect(() => canonicalChemicalSchema.parse({
      ...validChemical,
      casIdentifiers: [{ value: "68891-38-3", provenanceId: "missing-source" }],
    })).toThrow(/provenance references must resolve/);
  });

  it("rejects duplicate provenance identifiers and keeps the record closed to unrelated data", () => {
    expect(() => canonicalChemicalSchema.parse({
      ...validChemical,
      provenance: [validChemical.provenance[0], validChemical.provenance[0]],
    })).toThrow(/Provenance IDs must be unique/);
    expect(() => canonicalChemicalSchema.parse({ ...validChemical, commercialProductId: "product-1" })).toThrow();
  });
});
