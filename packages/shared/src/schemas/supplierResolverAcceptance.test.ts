import { describe, expect, it } from "vitest";
import { commercialProductSchema } from "./commercialProduct";
import { classifyIdentityConfidence } from "./identityConfidence";
import { classifyCommercialProductType } from "./commercialProductType";

const namedSupplierProducts = [
  { supplierId: "croda", tradeName: "Incromine Oxide C" },
  { supplierId: "croda", tradeName: "ECO Brij L6L" },
  { supplierId: "croda", tradeName: "NatraSense AG-810" },
  { supplierId: "croda", tradeName: "Crodateric CDA 38" },
  { supplierId: "evonik", tradeName: "ABIL ME 45" },
  { supplierId: "evonik", tradeName: "DERMOFEEL PA" },
  { supplierId: "clariant", tradeName: "Aristoflex TAC" },
  { supplierId: "dow", tradeName: "DOWANOL DPM" },
] as const;

describe("supplier resolver acceptance without supplied SDS files", () => {
  it.each(namedSupplierProducts)("preserves $tradeName without deriving unsupported chemistry", ({ supplierId, tradeName }) => {
    const product = commercialProductSchema.parse({
      schemaVersion: "1.0",
      id: `${supplierId}-${tradeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      supplierId,
      tradeName,
      sourceDocumentCodes: [],
      sourceFormulationReferences: [],
      lifecycleStatus: "unknown",
      reviewStatus: "unreviewed",
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

    expect(product).toMatchObject({ supplierId, tradeName, sourceDocumentCodes: [], reviewStatus: "unreviewed" });
    expect(productType).toMatchObject({ productType: "UNKNOWN", reviewRequired: true });
    expect(identity).toMatchObject({ state: "UNKNOWN", candidateCanonicalIds: [], reasonCodes: ["no_identity_evidence"] });
  });
});
