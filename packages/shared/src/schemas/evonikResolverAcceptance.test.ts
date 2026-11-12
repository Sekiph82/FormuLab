import { describe, expect, it } from "vitest";
import { extractSupplierSdsSection9PhysicalProperties } from "../engine/supplierSdsSection9PhysicalProperties";
import type { SupplierSdsSectionLine } from "../engine/supplierSdsSectionDetection";
import { linkSupplierSdsPhysicalProperty } from "./physicalPropertyEvidence";
import { resolveBlend } from "./blendResolver";
import { classifyCommercialProductType } from "./commercialProductType";
import { resolveSolution } from "./solutionResolver";
import { supplierSdsProductEvidenceSchema } from "./supplierSdsProductEvidence";

// These are synthetic structural fixtures only. The actual Evonik SDS files
// are not present in this repository, so the test deliberately contains no
// supplier composition, CAS number, concentration, or measured property claim.
const hash = "e".repeat(64);
const fact = (id: string, rawValue: string) => ({ id, rawValue, evidenceRefs: [`synthetic-sds:${id}`] });

function productEvidence(productId: string, sections: {
  declaredName: string;
  chemicalNature: string;
  components: Array<{
    id: string;
    name?: string;
    disclosure?: "disclosed" | "trade_secret" | "withheld" | "unknown";
    concentration?: string;
  }>;
  remainder?: string;
}) {
  return supplierSdsProductEvidenceSchema.parse({
    schemaVersion: "1.0",
    id: `synthetic-${productId}-sds-evidence`,
    commercialProductId: productId,
    section1: {
      sectionNumber: 1,
      sourceDocumentHash: hash,
      declaredChemicalName: fact(`${productId}-name`, sections.declaredName),
      chemicalNature: fact(`${productId}-s1-nature`, sections.chemicalNature),
    },
    section3: {
      sectionNumber: 3,
      sourceDocumentHash: hash,
      substanceOrMixture: fact(`${productId}-s3-nature`, sections.chemicalNature),
      components: sections.components.map((component) => ({
        id: component.id,
        ...(component.name ? { componentName: fact(`${component.id}-name`, component.name) } : {}),
        ...(component.concentration ? { concentration: fact(`${component.id}-concentration`, component.concentration) } : {}),
        disclosure: component.disclosure ?? "unknown",
      })),
      ...(sections.remainder ? { undisclosedRemainder: fact(`${productId}-remainder`, sections.remainder) } : {}),
    },
  });
}

describe("Evonik product resolver acceptance shape", () => {
  it("keeps an ABIL ME 45-style proprietary blend componentized and withholds undisclosed identity", () => {
    const source = productEvidence("evonik-abil-me-45", {
      declaredName: "ABIL ME 45 (synthetic fixture label)",
      chemicalNature: "Mixture",
      components: [
        { id: "abil-disclosed-component", name: "Synthetic disclosed component", disclosure: "disclosed" },
        { id: "abil-withheld-component", name: "Synthetic withheld component", disclosure: "trade_secret" },
      ],
      remainder: "Synthetic fixture: additional composition is not disclosed",
    });
    const productType = classifyCommercialProductType({ observations: [
      { kind: "explicit_type", value: "PROPRIETARY_BLEND", evidenceRefs: ["synthetic-sds:evonik-abil-me-45-s3-nature"] },
      { kind: "trade_secret", value: true, evidenceRefs: ["synthetic-sds:abil-withheld-component-name"] },
    ] });

    expect(productType).toMatchObject({ productType: "PROPRIETARY_BLEND", reviewRequired: true });
    const result = resolveBlend({ source, productType, canonicalChemicals: [] });
    expect(result).toMatchObject({
      status: "represented",
      commercialProductId: "evonik-abil-me-45",
      components: [
        { sourceComponentId: "abil-disclosed-component", originalName: "Synthetic disclosed component", identityStatus: "unmatched", disclosure: "disclosed" },
        { sourceComponentId: "abil-withheld-component", originalName: "Synthetic withheld component", identityStatus: "withheld", disclosure: "trade_secret" },
      ],
      remainder: { status: "explicitly_undisclosed", originalValue: "Synthetic fixture: additional composition is not disclosed" },
      reviewRequired: true,
    });
    expect(result).not.toHaveProperty("canonicalChemicalId");
    expect(result).not.toHaveProperty("activeMatterPercent");
  });

  it("keeps a DERMOFEEL PA-style solution unresolved when the SDS-shaped fixture supplies no exact solute identifiers", () => {
    const source = productEvidence("evonik-dermofeel-pa", {
      declaredName: "DERMOFEEL PA (synthetic fixture label)",
      chemicalNature: "Mixture",
      components: [
        { id: "dermofeel-solute", name: "Synthetic solute placeholder", concentration: "synthetic range withheld" },
        { id: "dermofeel-carrier", name: "Synthetic carrier placeholder" },
      ],
    });
    const productType = classifyCommercialProductType({ observations: [
      { kind: "explicit_type", value: "SOLUTION", evidenceRefs: ["synthetic-sds:evonik-dermofeel-pa-s3-nature"] },
    ] });
    const result = resolveSolution({
      source,
      productType,
      roles: {
        soluteComponentId: "dermofeel-solute",
        carrierComponentId: "dermofeel-carrier",
        soluteEvidenceRef: "synthetic-sds:dermofeel-solute-name",
        carrierEvidenceRef: "synthetic-sds:dermofeel-carrier-name",
        reviewedBy: "synthetic-test-reviewer",
      },
      canonicalChemicals: [],
    });

    expect(result).toMatchObject({
      status: "unresolved",
      commercialProductId: "evonik-dermofeel-pa",
      compositionDisclosure: "unknown",
      reasonCodes: ["solute_identity_not_disclosed"],
      reviewRequired: true,
    });
    expect(result).not.toHaveProperty("soluteCanonicalChemicalId");
    expect(result).not.toHaveProperty("concentration");
    expect(result).not.toHaveProperty("activeMatterPercent");
  });

  it("retains Section 9 context and source line provenance for a synthetic product property candidate", () => {
    const source = productEvidence("evonik-dermofeel-pa", {
      declaredName: "DERMOFEEL PA (synthetic fixture label)",
      chemicalNature: "Mixture",
      components: [],
    });
    const lines: SupplierSdsSectionLine[] = [
      { pageNumber: 1, lineNumber: 1, text: "9. Physical and chemical properties" },
      { pageNumber: 1, lineNumber: 2, text: "pH: synthetic test value at 20 °C", source: "digital" },
      { pageNumber: 1, lineNumber: 3, text: "10. Stability and reactivity" },
    ];
    const candidate = extractSupplierSdsSection9PhysicalProperties({ sourceDocumentHash: hash, lines }).candidates[0]!;
    const linked = linkSupplierSdsPhysicalProperty({ source, candidate, parserVersion: "evonik-synthetic-test-v1" });

    expect(linked).toMatchObject({
      commercialProductId: "evonik-dermofeel-pa",
      sourceEvidenceId: source.id,
      sourceDocumentHash: hash,
      rawValue: "synthetic test value at 20 °C",
      measurementContext: { temperature: { value: 20, unit: "°C" } },
      evidenceRefs: [`sds:${hash}:section9:p1:l2`],
      reviewRequired: true,
    });
    expect(linked).not.toHaveProperty("rawMaterialId");
  });
});
