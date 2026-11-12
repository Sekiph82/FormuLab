import { describe, expect, it } from "vitest";
import { createCompositionFractionEvidence } from "./compositionFraction";
import { createActiveMatterEvidence, type AuthorizedProductClaimInput } from "./activeMatterEvidence";
import { calculateFormulaContribution, formulaContributionSchema, supplierProductPercentEvidenceSchema } from "./formulaContribution";
import { supplierSdsProductEvidenceSchema } from "./supplierSdsProductEvidence";

const sds = supplierSdsProductEvidenceSchema.parse({
  schemaVersion: "1.0", id: "sds-1", commercialProductId: "product-1",
  section1: { sectionNumber: 1, sourceDocumentHash: "a".repeat(64), declaredChemicalName: { id: "s1-name", rawValue: "Product", evidenceRefs: ["sds:s1"] } },
  section3: { sectionNumber: 3, sourceDocumentHash: "a".repeat(64), components: [
    { id: "component-1", concentration: { id: "s3-range", rawValue: "30-40% w/w", evidenceRefs: ["sds:s3"] }, disclosure: "disclosed" },
  ] },
});
const fraction = createCompositionFractionEvidence(sds, "component-1")!;
const productPercent = supplierProductPercentEvidenceSchema.parse({
  schemaVersion: "1.0", id: "formula-percent-1", commercialProductId: "product-1", supplierFormulationId: "formula-1",
  sourceDocumentHash: "b".repeat(64), sourceFormulaLineId: "formula-line-1", originalValue: "10-20%",
  lowerBoundPercent: 10, upperBoundPercent: 20, interpretation: "range", evidenceRefs: ["formula:line1"],
});

describe("bounded supplier formula contribution", () => {
  it("multiplies conservative product and component bounds and retains both evidence lineages", () => {
    const result = calculateFormulaContribution(productPercent, { kind: "component_fraction", evidence: fraction });
    expect(result).toMatchObject({
      contributionKind: "component_contribution",
      productPercentRange: { lowerBound: 10, upperBound: 20 },
      componentFractionRange: { lowerBound: 0.3, upperBound: 0.4 },
      contributionPercentRange: { lowerBound: 0.03, upperBound: 0.08, interpretation: "range" },
      sourceFormulaLineId: "formula-line-1",
      compositionSourceFactId: "s3-range",
      evidenceRefs: ["formula:line1", "sds:s3"],
      reviewRequired: true,
    });
    expect(() => formulaContributionSchema.parse({
      ...result,
      contributionPercentRange: { lowerBound: 0.04, upperBound: 0.08, interpretation: "range" },
    })).toThrow(/must equal the conservative product-percent/);
  });

  it("calculates explicit active matter separately and rejects unparsed or mismatched evidence", () => {
    const claim: AuthorizedProductClaimInput = {
      schemaVersion: "1.0", id: "active-1", commercialProductId: "product-1", sourceDocumentType: "TDS",
      sourceDocumentHash: "c".repeat(64), sourceEvidenceId: "tds-1", sourceFactId: "active-fact", quantityKind: "active_matter",
      explicitPropertyLabel: "Active matter as supplied", originalValue: "70%", basis: "as_supplied", evidenceRefs: ["tds:p2"],
    };
    const active = createActiveMatterEvidence(claim);
    const result = calculateFormulaContribution(productPercent, { kind: "active_matter", evidence: active });
    expect(result).toMatchObject({ contributionKind: "active_matter_contribution", componentFractionRange: { lowerBound: 0.7, upperBound: 0.7 }, contributionPercentRange: { lowerBound: 0.07, upperBound: 0.14 } });
    expect(() => calculateFormulaContribution(productPercent, {
      kind: "active_matter",
      evidence: createActiveMatterEvidence({ ...claim, quantityKind: "solids_content", explicitPropertyLabel: "Solids content" }),
    })).toThrow(/Only explicit parsed active-matter evidence/);
    expect(() => calculateFormulaContribution(productPercent, {
      kind: "active_matter",
      evidence: createActiveMatterEvidence({ ...claim, basis: "dry_basis" }),
    })).toThrow(/as-supplied basis/);
    const unparsed = createCompositionFractionEvidence(supplierSdsProductEvidenceSchema.parse({
      ...sds,
      section3: { ...sds.section3, components: [{ ...sds.section3.components[0], concentration: { id: "unparsed", rawValue: "proprietary range", evidenceRefs: ["sds:unparsed"] } }] },
    }), "component-1")!;
    expect(() => calculateFormulaContribution(productPercent, { kind: "component_fraction", evidence: unparsed })).toThrow(/unparsed component fraction/);
    expect(() => calculateFormulaContribution({ ...productPercent, commercialProductId: "different-product" }, { kind: "component_fraction", evidence: fraction })).toThrow(/same commercial product/);
  });
});
