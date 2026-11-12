import { describe, expect, it } from "vitest";
import { extractSupplierSdsSection9PhysicalProperties } from "../engine/supplierSdsSection9PhysicalProperties";
import { commercialProductSchema } from "./commercialProduct";
import { classifyCommercialProductType } from "./commercialProductType";
import { classifyIdentityConfidence } from "./identityConfidence";
import { resolveSingleComponent } from "./singleComponentResolver";
import { supplierSdsProductEvidenceSchema } from "./supplierSdsProductEvidence";

describe("Dow DOWANOL DPM resolver fallback", () => {
  it("retains the trade name but does not infer SDS identifiers, purity, or properties when the product SDS is absent", () => {
    // No product SDS PDF is present in this repository. Typical properties on
    // public product information are not substituted for this missing SDS.
    const product = commercialProductSchema.parse({
      schemaVersion: "1.0",
      id: "dow-dowanol-dpm",
      supplierId: "dow",
      tradeName: "DOWANOL DPM",
      sourceDocumentCodes: [],
      sourceFormulationReferences: [],
      lifecycleStatus: "unknown",
      reviewStatus: "unreviewed",
    });
    const source = supplierSdsProductEvidenceSchema.parse({
      schemaVersion: "1.0",
      id: "dow-dowanol-dpm-no-sds-evidence",
      commercialProductId: product.id,
      section1: { sectionNumber: 1, sourceDocumentHash: "d".repeat(64) },
      section3: { sectionNumber: 3, sourceDocumentHash: "d".repeat(64), components: [] },
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
    const singleComponent = resolveSingleComponent({
      source,
      productType,
      concentration: { sourceFactId: "missing-concentration", evidenceRefs: ["synthetic:missing-concentration"] },
      canonicalChemicals: [],
    });
    const section9 = extractSupplierSdsSection9PhysicalProperties({
      sourceDocumentHash: "d".repeat(64),
      lines: [],
    });

    expect(product).toMatchObject({ tradeName: "DOWANOL DPM", sourceDocumentCodes: [], reviewStatus: "unreviewed" });
    expect(product).not.toHaveProperty("productCode");
    expect(productType).toMatchObject({ productType: "UNKNOWN", reviewRequired: true });
    expect(identity).toMatchObject({ state: "UNKNOWN", reasonCodes: ["no_identity_evidence"] });
    expect(singleComponent).toMatchObject({
      status: "unresolved",
      commercialProductId: product.id,
      reasonCodes: ["product_not_classified_pure_or_near_pure"],
      reviewRequired: true,
    });
    expect(singleComponent).not.toHaveProperty("canonicalChemicalId");
    expect(section9).toMatchObject({ candidates: [], warnings: ["section_9_not_detected"] });
  });
});
