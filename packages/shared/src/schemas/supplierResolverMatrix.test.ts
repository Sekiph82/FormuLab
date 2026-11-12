import { describe, expect, it } from "vitest";
import { canonicalChemicalSchema } from "./canonicalChemical";
import { canonicalPolymerSchema } from "./canonicalPolymer";
import { resolveBlend } from "./blendResolver";
import { classifyCommercialProductType } from "./commercialProductType";
import { resolvePolymer } from "./polymerResolver";
import { resolveProprietaryDisclosure } from "./proprietaryDisclosureResolver";
import { resolveSingleComponent } from "./singleComponentResolver";
import { resolveSolution } from "./solutionResolver";
import { supplierSdsProductEvidenceSchema, type SupplierSdsProductEvidence } from "./supplierSdsProductEvidence";

// Cross-supplier contract fixtures are deliberately synthetic. Their purpose
// is to exercise resolver type gates and evidence lineage, not assert supplier
// product composition or real SDS values.
const sourceHash = "f".repeat(64);
const fact = (id: string, rawValue: string) => ({ id, rawValue, evidenceRefs: [`synthetic:${id}`] });

function source(productId: string, input: {
  chemicalNature: string;
  components: Array<{
    id: string;
    name?: string;
    cas?: string;
    ec?: string;
    materialNumber?: string;
    concentration?: string;
    disclosure?: "disclosed" | "trade_secret" | "withheld" | "unknown";
  }>;
  remainder?: string;
}) {
  return supplierSdsProductEvidenceSchema.parse({
    schemaVersion: "1.0",
    id: `synthetic-sds-${productId}`,
    commercialProductId: productId,
    section1: {
      sectionNumber: 1,
      sourceDocumentHash: sourceHash,
      chemicalNature: fact(`${productId}-s1-nature`, input.chemicalNature),
      ...(input.components.length === 1 && input.components[0]?.cas ? { casNumber: fact(`${productId}-s1-cas`, input.components[0].cas) } : {}),
      ...(input.components.length === 1 && input.components[0]?.ec ? { ecNumber: fact(`${productId}-s1-ec`, input.components[0].ec) } : {}),
      ...(input.components.length === 1 && input.components[0]?.materialNumber ? { materialNumber: fact(`${productId}-s1-material`, input.components[0].materialNumber) } : {}),
    },
    section3: {
      sectionNumber: 3,
      sourceDocumentHash: sourceHash,
      substanceOrMixture: fact(`${productId}-s3-nature`, input.chemicalNature),
      components: input.components.map((item) => ({
        id: item.id,
        ...(item.name ? { componentName: fact(`${item.id}-name`, item.name) } : {}),
        ...(item.cas ? { casNumber: fact(`${item.id}-cas`, item.cas) } : {}),
        ...(item.ec ? { ecNumber: fact(`${item.id}-ec`, item.ec) } : {}),
        ...(item.materialNumber ? { materialNumber: fact(`${item.id}-material`, item.materialNumber) } : {}),
        ...(item.concentration ? { concentration: fact(`${item.id}-concentration`, item.concentration) } : {}),
        disclosure: item.disclosure ?? "disclosed",
      })),
      ...(input.remainder ? { undisclosedRemainder: fact(`${productId}-remainder`, input.remainder) } : {}),
    },
  });
}

function classify(record: SupplierSdsProductEvidence, productType: string) {
  const ref = record.section3.substanceOrMixture!.evidenceRefs[0]!;
  return classifyCommercialProductType({ observations: [{ kind: "explicit_type", value: productType, evidenceRefs: [ref] }] });
}

const water = canonicalChemicalSchema.parse({
  schemaVersion: "1.0",
  id: "synthetic-water",
  preferredName: "Water",
  casIdentifiers: [{ originalValue: "7732-18-5", normalizedValue: "7732-18-5" }],
  ecIdentifiers: [{ originalValue: "231-791-2", normalizedValue: "231-791-2" }],
  provenance: [{ id: "synthetic-registry-water", sourceType: "public_registry", sourceReference: "synthetic:registry:water", recordedAt: "2026-10-26T08:00:00.000Z" }],
});
const sodiumChloride = canonicalChemicalSchema.parse({
  schemaVersion: "1.0",
  id: "synthetic-sodium-chloride",
  preferredName: "Sodium chloride",
  casIdentifiers: [{ originalValue: "7647-14-5", normalizedValue: "7647-14-5" }],
  provenance: [{ id: "synthetic-registry-salt", sourceType: "public_registry", sourceReference: "synthetic:registry:solute", recordedAt: "2026-10-26T08:00:00.000Z" }],
});
const polymer = canonicalPolymerSchema.parse({
  schemaVersion: "1.0",
  id: "synthetic-polymer",
  preferredName: "Synthetic crosspolymer fixture",
  polymerType: "crosspolymer",
  materialNumbers: [{ originalValue: "MATRIX-POLY-01", normalizedValue: "MATRIX-POLY-01", provenanceId: "synthetic-polymer-registry" }],
  provenance: [{ id: "synthetic-polymer-registry", sourceReference: "synthetic:registry:polymer", recordedAt: "2026-10-26T08:00:00.000Z" }],
});

function expectReviewCandidate(result: Record<string, unknown>, productId: string) {
  expect(result).toMatchObject({ commercialProductId: productId, reviewRequired: true });
  expect(result).toHaveProperty("evidenceRefs");
}

describe("supplier-agnostic resolver acceptance matrix", () => {
  it("routes synthetic pure, solution, and polymer evidence through exact-identity resolvers", () => {
    const pureSource = source("fixture-supplier-a-pure", {
      chemicalNature: "Substance",
      components: [{ id: "pure-water", name: "Water", cas: "7732-18-5", ec: "231-791-2", concentration: "99-100% w/w" }],
    });
    const pure = resolveSingleComponent({
      source: pureSource,
      productType: classify(pureSource, "PURE_OR_NEAR_PURE"),
      concentration: { sourceFactId: "pure-water-concentration", evidenceRefs: ["synthetic:pure-water-concentration"] },
      canonicalChemicals: [water],
    });
    expectReviewCandidate(pure, pureSource.commercialProductId);
    expect(pure).toMatchObject({ status: "resolved_candidate", canonicalChemicalId: water.id });

    const solutionSource = source("fixture-supplier-b-solution", {
      chemicalNature: "Mixture",
      components: [
        { id: "solution-solute", name: "Sodium chloride", cas: "7647-14-5", concentration: "10-20% w/w" },
        { id: "solution-carrier", name: "Water", cas: "7732-18-5", concentration: "80-90% w/w" },
      ],
    });
    const solution = resolveSolution({
      source: solutionSource,
      productType: classify(solutionSource, "SOLUTION"),
      roles: {
        soluteComponentId: "solution-solute",
        carrierComponentId: "solution-carrier",
        soluteEvidenceRef: "synthetic:solution-solute-name",
        carrierEvidenceRef: "synthetic:solution-carrier-name",
        reviewedBy: "synthetic-reviewer",
      },
      canonicalChemicals: [sodiumChloride],
    });
    expectReviewCandidate(solution, solutionSource.commercialProductId);
    expect(solution).toMatchObject({ status: "resolved_candidate", soluteCanonicalChemicalId: sodiumChloride.id, concentration: { interpretation: "range" } });
    expect(solution).not.toHaveProperty("activeMatterPercent");

    const polymerSource = source("fixture-supplier-c-polymer", {
      chemicalNature: "Polymer",
      components: [{ id: "polymer-main", name: "Synthetic crosspolymer fixture", materialNumber: "MATRIX-POLY-01" }],
    });
    const polymerResult = resolvePolymer({
      source: polymerSource,
      productType: classify(polymerSource, "POLYMER"),
      canonicalPolymers: [polymer],
    });
    expectReviewCandidate(polymerResult, polymerSource.commercialProductId);
    expect(polymerResult).toMatchObject({ status: "resolved_candidate", canonicalPolymerId: polymer.id, polymerType: "crosspolymer" });
  });

  it("keeps multicomponent, partially disclosed, and proprietary cases componentized and review-gated", () => {
    const blendSource = source("fixture-supplier-d-blend", {
      chemicalNature: "Mixture",
      components: [
        { id: "blend-first", name: "Synthetic component A", concentration: "10-20% w/w" },
        { id: "blend-second", name: "Synthetic component B", concentration: "1-5% w/w" },
      ],
    });
    const blend = resolveBlend({ source: blendSource, productType: classify(blendSource, "MULTICOMPONENT_BLEND"), canonicalChemicals: [] });
    expectReviewCandidate(blend, blendSource.commercialProductId);
    expect(blend).toMatchObject({ status: "represented", components: [{ identityStatus: "unmatched" }, { identityStatus: "unmatched" }] });
    expect(blend).not.toHaveProperty("canonicalChemicalId");

    const partialSource = source("fixture-supplier-e-partial", {
      chemicalNature: "Mixture",
      components: [{ id: "partial-known", name: "Synthetic disclosed component", concentration: "1-5% w/w" }],
      remainder: "Synthetic fixture: remaining composition not disclosed",
    });
    const partial = resolveProprietaryDisclosure({ source: partialSource, productType: classify(partialSource, "PARTIALLY_DISCLOSED") });
    expectReviewCandidate(partial, partialSource.commercialProductId);
    expect(partial).toMatchObject({ status: "PARTIAL", remainder: { status: "explicitly_undisclosed" } });
    expect(partial).not.toHaveProperty("composition");

    const proprietarySource = source("fixture-supplier-f-proprietary", {
      chemicalNature: "Mixture",
      components: [
        { id: "proprietary-visible", name: "Synthetic disclosed component", concentration: "10-20% w/w" },
        { id: "proprietary-withheld", name: "Synthetic withheld component", disclosure: "trade_secret" },
      ],
      remainder: "Synthetic fixture: additional composition not disclosed",
    });
    const proprietaryType = classify(proprietarySource, "PROPRIETARY_BLEND");
    const proprietary = resolveProprietaryDisclosure({ source: proprietarySource, productType: proprietaryType });
    expectReviewCandidate(proprietary, proprietarySource.commercialProductId);
    expect(proprietary).toMatchObject({ status: "PARTIAL", components: [{ disclosure: "disclosed" }, { disclosure: "trade_secret", identityStatus: "PARTIAL" }] });
    const proprietaryBlend = resolveBlend({ source: proprietarySource, productType: proprietaryType, canonicalChemicals: [] });
    expectReviewCandidate(proprietaryBlend, proprietarySource.commercialProductId);
    expect(proprietaryBlend).toMatchObject({ status: "represented", components: [{ identityStatus: "unmatched" }, { identityStatus: "withheld", disclosure: "trade_secret" }] });
  });
});
