import { describe, expect, it } from "vitest";
import { commercialProductSchema } from "./commercialProduct";
import { classifyCommercialProductType } from "./commercialProductType";
import { classifyIdentityConfidence } from "./identityConfidence";
import { resolvePolymer } from "./polymerResolver";
import { supplierSdsProductEvidenceSchema } from "./supplierSdsProductEvidence";

describe("Clariant Aristoflex TAC resolver fallback", () => {
  it("preserves the named product but does not invent SDS identity or polymer evidence when no SDS is supplied", () => {
    // Product name only: no Aristoflex TAC SDS is present in this repository.
    // Do not substitute another Aristoflex grade or synthetic identifiers.
    const product = commercialProductSchema.parse({
      schemaVersion: "1.0",
      id: "clariant-aristoflex-tac",
      supplierId: "clariant",
      tradeName: "Aristoflex TAC",
      sourceDocumentCodes: [],
      sourceFormulationReferences: [],
      lifecycleStatus: "unknown",
      reviewStatus: "unreviewed",
    });
    const source = supplierSdsProductEvidenceSchema.parse({
      schemaVersion: "1.0",
      id: "clariant-aristoflex-tac-no-sds-evidence",
      commercialProductId: product.id,
      section1: { sectionNumber: 1, sourceDocumentHash: "c".repeat(64) },
      section3: { sectionNumber: 3, sourceDocumentHash: "c".repeat(64), components: [] },
    });
    const productType = classifyCommercialProductType({ observations: [] });
    const identity = classifyIdentityConfidence({
      candidateCanonicalIds: [],
      exactIdentifierMatches: [],
      nameAliasMatch: false,
      sectionReconciliation: "not_applicable",
      disclosureStatus: "unknown",
      evidenceRefs: [],
    });
    const polymer = resolvePolymer({ source, productType, canonicalPolymers: [] });

    expect(product).toMatchObject({ tradeName: "Aristoflex TAC", sourceDocumentCodes: [], reviewStatus: "unreviewed" });
    expect(product).not.toHaveProperty("productCode");
    expect(productType).toMatchObject({ productType: "UNKNOWN", reviewRequired: true });
    expect(identity).toMatchObject({ state: "UNKNOWN", reasonCodes: ["no_identity_evidence"] });
    expect(polymer).toMatchObject({
      status: "unresolved",
      commercialProductId: product.id,
      reasonCodes: ["product_not_classified_as_polymer"],
      reviewRequired: true,
    });
    expect(polymer).not.toHaveProperty("canonicalPolymerId");
    expect(polymer).not.toHaveProperty("polymerType");
  });
});
