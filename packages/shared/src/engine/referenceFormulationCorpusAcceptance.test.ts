import { describe, expect, it } from "vitest";
import {
  buildReferenceFormulationLocalIndex,
  buildReferenceFormulationUnresolvedQueue,
  createReferenceFormulationContribution,
  createReferenceFormulationNormalizationVersion,
  createReferenceFormulationQueryRecord,
  createReferenceFormulationRecord,
  createReferenceFormulationSource,
  extractReferenceFormulationIdentity,
  extractReferenceFormulationIngredientLines,
  extractReferenceFormulationProcedure,
  extractReferenceFormulationTargets,
  matchReferenceFormulationProducts,
  supplierDocumentAcquisitionSchema,
  validateReferenceFormulationArithmetic,
  type ReferenceFormulationQueryRecord,
} from "..";

const AS_OF = "2026-10-26T12:00:00.000Z";
const fixtureCorpus = [
  { supplierId: "supplier-croda", supplierName: "Croda", hash: "a".repeat(64), tradeName: "Synthetic Croda Formula", rows: [["Ingredient", "Amount", "Unit", "Basis"], ["Croda surfactant blend", "10", "%", "w/w"]] },
  { supplierId: "supplier-evonik", supplierName: "Evonik", hash: "b".repeat(64), tradeName: "Synthetic Evonik Formula", rows: [["Raw Material", "Concentration", "Unit", "Weight Basis"], ["Evonik polymer blend", "5-8", "%", "w/w"]] },
  { supplierId: "supplier-dow", supplierName: "Dow", hash: "c".repeat(64), tradeName: "Synthetic Dow Formula", rows: [["Trade Name", "Material Code", "Stage", "Dosage", "Purpose"], ["Dow additive blend", "DOW-UNKNOWN", "Phase A", "q.s.", "Supplier wording only"]] },
];

function buildFixtureQuery(fixture: typeof fixtureCorpus[number]): ReferenceFormulationQueryRecord {
  const acquisition = supplierDocumentAcquisitionSchema.parse({
    schemaVersion: "1.0", code: `acquisition-${fixture.supplierId}`, supplierId: fixture.supplierId,
    providerId: "manual-fixture", surfaceId: "corpus-acceptance-fixture", documentType: "FORMULATION", acquisitionMethod: "manual_assisted",
    sourceFileSelection: {
      selectionId: `selection-${fixture.supplierId}`, originalFilename: `${fixture.supplierName}-synthetic-fixture.pdf`,
      sourceFileSha256: fixture.hash, selectedAt: AS_OF, selectedBy: "test-owner",
    },
    sourceProduct: { tradeName: fixture.tradeName }, market: "test", language: "en",
    originalFilename: `${fixture.supplierName}-synthetic-fixture.pdf`, mimeType: "application/pdf", sha256: fixture.hash,
    byteSize: 1024, parserStatus: "completed", acquiredAt: AS_OF, createdAt: AS_OF,
  });
  const source = createReferenceFormulationSource({
    id: `source-${fixture.supplierId}`, acquisition, title: fixture.tradeName, parserVersion: "formulab-reference-formulation-layout-v1",
    rights: { status: "owner_provided", redistribution: "unknown", evidenceRefs: ["synthetic-fixture"] }, createdAt: AS_OF,
  });
  const pages = [{ pageNumber: 1, blocks: [
    { type: "heading" as const, blockIndex: 0, text: fixture.supplierId === "supplier-dow" ? "Application" : "Formula Composition", source: "digital" as const },
    { type: "table" as const, blockIndex: 1, source: "digital" as const, rows: fixture.rows },
  ] }];
  const identity = extractReferenceFormulationIdentity({ acquisition, pages });
  const ingredientResult = extractReferenceFormulationIngredientLines({ source, pages });
  const arithmetic = validateReferenceFormulationArithmetic({ source, lines: ingredientResult.lines });
  const procedure = extractReferenceFormulationProcedure({ source, pages });
  const targets = extractReferenceFormulationTargets({ source, pages });
  const matching = matchReferenceFormulationProducts({ source, lines: ingredientResult.lines, products: [] });
  const unresolved = buildReferenceFormulationUnresolvedQueue({ source, lines: ingredientResult.lines, matching, products: [] });
  const record = createReferenceFormulationRecord({
    id: `record-${fixture.supplierId}`, code: `record-${fixture.supplierId}`, source,
    identityCandidates: identity.candidates, identityMetadataComparisons: identity.metadataComparisons, identityWarnings: identity.warnings,
    ingredientLines: ingredientResult.lines, arithmetic, procedureSteps: procedure.steps, procedureWarnings: procedure.warnings,
    targetCandidates: targets.candidates, targetWarnings: targets.warnings,
    productMatches: matching.lines, productMatchWarnings: matching.warnings, unresolvedEntries: unresolved.entries, createdAt: AS_OF,
  });
  const contributions = Object.fromEntries(record.ingredientLines.map((line) => [line.id, [
    createReferenceFormulationContribution({ source: record, sourceFormulaLineId: line.id }),
  ]]));
  const normalization = createReferenceFormulationNormalizationVersion({
    id: `normalization-${fixture.supplierId}`, source: record, version: 1, componentContributions: contributions, createdAt: AS_OF,
  });
  return createReferenceFormulationQueryRecord({ source: record, normalization });
}

describe("multi-supplier reference formulation corpus acceptance", () => {
  it("normalizes synthetic supplier layouts deterministically, retains unresolved facts, and builds a rebuildable index", () => {
    const queryRecords = fixtureCorpus.map(buildFixtureQuery);
    expect(new Set(queryRecords.map((record) => record.supplierId))).toEqual(new Set(["supplier-croda", "supplier-evonik", "supplier-dow"]));
    expect(queryRecords.every((record) => record.lines.every((line) => line.reviewRequired))).toBe(true);
    expect(queryRecords.every((record) => record.lines.every((line) => line.componentContributions.some((item) => item.status === "unknown" && item.sourceSds.status === "missing")))).toBe(true);
    expect(queryRecords.every((record) => record.lines.every((line) => line.commercialProducts.status === "unresolved"))).toBe(true);
    expect(queryRecords.flatMap((record) => record.lines).some((line) => line.componentContributions.some((item) => item.unknownReasons.includes("formula_amount_qs")))).toBe(true);
    expect(queryRecords).toHaveLength(fixtureCorpus.length);
    expect(queryRecords.map((record) => buildFixtureQuery(fixtureCorpus.find((item) => item.supplierId === record.supplierId)!))).toEqual(queryRecords);

    const index = buildReferenceFormulationLocalIndex(queryRecords);
    expect(index.suppliers).toMatchObject({
      "supplier-croda": [queryRecords[0]!.id],
      "supplier-evonik": [queryRecords[1]!.id],
      "supplier-dow": [queryRecords[2]!.id],
    });
    expect(buildReferenceFormulationLocalIndex([...queryRecords].reverse())).toEqual(index);
    expect(() => buildReferenceFormulationLocalIndex([...queryRecords, queryRecords[0]!])).toThrow(/duplicate query record IDs/);
    for (const record of queryRecords) {
      expect(record).not.toHaveProperty("rawMaterial");
      expect(record).not.toHaveProperty("productionFormulaId");
    }
  });
});
