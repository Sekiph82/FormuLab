import { describe, expect, it } from "vitest";
import type { ReferenceFormulationQueryRecord } from "../schemas/referenceFormulationQuery";
import {
  buildReferenceFormulationLocalIndex,
  normalizeReferenceFormulationAlias,
  referenceFormulationLocalIndexSchema,
  searchReferenceFormulationLocalIndex,
} from "./referenceFormulationIndex";

const hash = "a".repeat(64);

function queryRecord(input: {
  id: string;
  supplierId: string;
  tradeName: string;
  family: string;
  commercialProductId: string;
  canonicalChemicalId: string;
  functionId: "anionic_surfactant" | "nonionic_surfactant";
  formulaPercent: number;
}): ReferenceFormulationQueryRecord {
  return {
    schemaVersion: "formulab-reference-formulation-query-v1",
    recordKind: "reference_formulation_query",
    id: input.id,
    sourceRecordId: `source-${input.id}`,
    normalizationId: `normalization-${input.id}`,
    normalizationVersion: 1,
    sourceDocumentHash: hash,
    supplierId: input.supplierId,
    providerId: `${input.supplierId}-provider`,
    surfaceId: "public-formula-library",
    supplierProduct: { tradeName: input.tradeName, supplierItemCode: `CODE-${input.id}` },
    formulationTitle: `${input.family} Hand Dishwash`,
    formulationCode: `FORM-${input.id}`,
    productFamily: { status: "proposed", candidates: [{ rawValue: input.family, evidenceRefs: ["identity:source"] }], reviewRequired: true },
    market: "EU",
    language: "en",
    sourceRevision: { revisionIdentifier: "Rev 1", identityCandidates: [] },
    lines: [{
      sourceLineId: `line-${input.id}`,
      sourceIngredientName: input.tradeName,
      supplierProductCode: `CODE-${input.id}`,
      inciOrChemicalName: "Sodium Example",
      sourceLineEvidenceRefs: ["formula:source-line"],
      commercialProducts: { status: "proposed", candidateIds: [input.commercialProductId], reviewRequired: true },
      canonicalChemistry: { status: "proposed", candidateIds: [input.canonicalChemicalId], reviewRequired: true },
      supplierFunction: { status: "stated", originalValue: "Surfactant", evidenceRefs: ["formula:function"] },
      canonicalFunctions: { status: "proposed", candidateIds: [input.functionId], reviewRequired: true },
      amount: { originalValue: `${input.formulaPercent}`, unit: "%", basis: "w/w", quantitySemantics: "explicit_amount", evidenceRefs: ["formula:amount"] },
      componentContributions: [{
        contributionId: `contribution-${input.id}`,
        status: "exact",
        commercialProductId: input.commercialProductId,
        canonicalChemistry: { status: "unresolved", candidateIds: [], reviewRequired: true },
        formulaAmount: {
          originalValue: `${input.formulaPercent}% w/w`, unit: "%", basis: "w/w", interpretation: "exact",
          percentRange: { lowerBound: input.formulaPercent, upperBound: input.formulaPercent }, evidenceRefs: ["formula:amount"],
        },
        componentContributionPercentRange: { lowerBound: input.formulaPercent * 0.25, upperBound: input.formulaPercent * 0.25 },
        sourceSds: {
          status: "available", evidenceId: `evidence-${input.id}`, acquisitionCode: `acquisition-${input.id}`,
          commercialProductId: input.commercialProductId, documentHash: hash, sectionNumber: 3, sourceComponentId: `component-${input.id}`,
          disclosure: "disclosed", sourceFactId: `fact-${input.id}`, originalValue: "25%", interpretation: "exact",
          fractionRange: { lowerBound: 0.25, upperBound: 0.25 }, evidenceRefs: ["sds:component"],
        },
        unknownReasons: [],
        reviewRequired: true,
      }],
      reviewRequired: true,
    }],
    activeMatterClaims: [],
    processSteps: [],
    targets: [],
    reviewRequired: true,
  } as ReferenceFormulationQueryRecord;
}

describe("reference formulation local indexes", () => {
  const first = queryRecord({
    id: "query-a", supplierId: "supplier-croda", tradeName: "Croda 787", family: "Hand Dishwash",
    commercialProductId: "commercial-1", canonicalChemicalId: "chemical-1", functionId: "anionic_surfactant", formulaPercent: 4,
  });
  const second = queryRecord({
    id: "query-b", supplierId: "supplier-dow", tradeName: "DOW Product", family: "Surface Cleaner",
    commercialProductId: "commercial-2", canonicalChemicalId: "chemical-2", functionId: "nonionic_surfactant", formulaPercent: 12,
  });

  it("builds stable rebuildable postings from validated query projections", () => {
    const forward = buildReferenceFormulationLocalIndex([first, second]);
    const reversed = buildReferenceFormulationLocalIndex([second, first]);
    expect(reversed).toEqual(forward);
    expect(forward.queryRecordIds).toEqual(["query-a", "query-b"]);
    expect(forward.aliases["croda 787"]).toEqual(["query-a"]);
    expect(forward.suppliers["supplier-croda"]).toEqual(["query-a"]);
    expect(forward.productFamilies["hand dishwash"]).toEqual(["query-a"]);
    expect(forward.commercialProducts["commercial-1"]).toEqual(["query-a"]);
    expect(forward.canonicalChemicals["chemical-1"]).toEqual(["query-a"]);
    expect(forward.functions.anionic_surfactant).toEqual(["query-a"]);
    expect(forward.numericRanges).toEqual([{
      queryRecordId: "query-a", sourceLineId: "line-query-a", kind: "component_contribution_percent",
      contributionId: "contribution-query-a", lowerBound: 1, upperBound: 1,
    }, {
      queryRecordId: "query-a", sourceLineId: "line-query-a", kind: "formula_amount_percent", lowerBound: 4, upperBound: 4,
    }, {
      queryRecordId: "query-b", sourceLineId: "line-query-b", kind: "component_contribution_percent",
      contributionId: "contribution-query-b", lowerBound: 3, upperBound: 3,
    }, {
      queryRecordId: "query-b", sourceLineId: "line-query-b", kind: "formula_amount_percent", lowerBound: 12, upperBound: 12,
    }]);
  });

  it("searches exact normalized aliases and intersects deterministic supplier, identity, function and numeric filters", () => {
    const index = buildReferenceFormulationLocalIndex([first, second]);
    expect(normalizeReferenceFormulationAlias("  CRODA   787 ")).toBe("croda 787");
    expect(searchReferenceFormulationLocalIndex(index, {
      aliases: ["  CRODA   787 "], supplierIds: ["supplier-croda"], canonicalChemicalIds: ["chemical-1"],
      functions: ["anionic_surfactant"], numericRange: { kind: "formula_amount_percent", lowerBound: 3, upperBound: 5 },
    })).toEqual(["query-a"]);
    expect(searchReferenceFormulationLocalIndex(index, {
      numericRange: { kind: "formula_amount_percent", lowerBound: 5, upperBound: 9 },
    })).toEqual([]);
    expect(searchReferenceFormulationLocalIndex(index, {
      numericRange: { kind: "component_contribution_percent", lowerBound: 0.9, upperBound: 1.1 },
    })).toEqual(["query-a"]);
    expect(searchReferenceFormulationLocalIndex(index, {})).toEqual(["query-a", "query-b"]);
  });

  it("rejects duplicate records, malformed ranges, and malformed search intervals", () => {
    expect(() => buildReferenceFormulationLocalIndex([first, first])).toThrow(/duplicate query record IDs/);
    const index = buildReferenceFormulationLocalIndex([first]);
    expect(() => referenceFormulationLocalIndexSchema.parse({
      ...index,
      numericRanges: [{ queryRecordId: "query-a", sourceLineId: "line-query-a", kind: "formula_amount_percent", lowerBound: 6, upperBound: 5 }],
    })).toThrow(/ascending/);
    expect(() => searchReferenceFormulationLocalIndex(index, {
      numericRange: { kind: "formula_amount_percent", lowerBound: 9, upperBound: 2 },
    })).toThrow(/ascending/);
    expect(() => referenceFormulationLocalIndexSchema.parse({
      ...index, aliases: { "CRODA 787": ["query-a"] },
    })).toThrow(/normalized alias keys/);
    expect(() => referenceFormulationLocalIndexSchema.parse({
      ...index, aliases: { z: ["query-a"], a: ["query-a"] },
    })).toThrow(/deterministic object-key order/);
    expect(() => referenceFormulationLocalIndexSchema.parse({
      ...index, suppliers: { " supplier-croda ": ["query-a"] },
    })).toThrow(/nonempty and trimmed/);

    const inconsistentFormulaRanges = structuredClone(first);
    const secondContribution = structuredClone(inconsistentFormulaRanges.lines[0]!.componentContributions[0]!);
    secondContribution.contributionId = "contribution-second-component";
    secondContribution.formulaAmount.percentRange = { lowerBound: 5, upperBound: 5 };
    secondContribution.formulaAmount.originalValue = "5% w/w";
    secondContribution.componentContributionPercentRange = { lowerBound: 1.25, upperBound: 1.25 };
    inconsistentFormulaRanges.lines[0]!.componentContributions.push(secondContribution);
    expect(() => buildReferenceFormulationLocalIndex([inconsistentFormulaRanges])).toThrow(/agree on the source formula amount range/);
  });
});
