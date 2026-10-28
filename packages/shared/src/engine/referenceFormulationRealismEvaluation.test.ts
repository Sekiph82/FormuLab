import { describe, expect, it } from "vitest";
import { createReferenceFormulationNormalizationVersion } from "../schemas/referenceFormulationNormalization";
import { createReferenceFormulationQueryRecord } from "../schemas/referenceFormulationQuery";
import { createReferenceFormulationRecord } from "../schemas/referenceFormulationRecord";
import { createReferenceFormulationSource } from "../schemas/referenceFormulationSource";
import { supplierDocumentAcquisitionSchema } from "../schemas/supplierDocument";
import { validateReferenceFormulationArithmetic } from "./referenceFormulationArithmetic";
import { extractReferenceFormulationIdentity } from "./referenceFormulationIdentityExtraction";
import { extractReferenceFormulationIngredientLines } from "./referenceFormulationIngredientExtraction";
import { extractReferenceFormulationProcedure } from "./referenceFormulationProcedureExtraction";
import { matchReferenceFormulationProducts } from "./referenceFormulationProductMatching";
import { extractReferenceFormulationTargets } from "./referenceFormulationTargetExtraction";
import { buildReferenceFormulationUnresolvedQueue } from "./referenceFormulationUnresolvedQueue";
import {
  buildSyntheticReferenceFormulationRealismEvaluation,
  referenceFormulationRealismEvaluationSchema,
} from "./referenceFormulationRealismEvaluation";

const CREATED_AT = "2026-10-26T12:00:00.000Z";

function fixture(index: number) {
  const supplierId = `synthetic-supplier-${String(index).padStart(2, "0")}`;
  const sourceId = `synthetic-reference-source-${index}`;
  const formulaId = `synthetic-reference-formula-${index}`;
  const hash = index.toString(16).repeat(64);
  const code = `synthetic-formula-${index}`;
  const acquisition = supplierDocumentAcquisitionSchema.parse({
    schemaVersion: "1.0", code, supplierId, providerId: "synthetic-fixture-provider", surfaceId: "synthetic-heldout-fixture",
    documentType: "FORMULATION", acquisitionMethod: "automated", sourceUrl: `https://fixtures.invalid/${code}.pdf`,
    sourceProduct: {}, market: "XX", language: "en", originalFilename: `${code}.pdf`, mimeType: "application/pdf",
    sha256: hash, byteSize: 1024, parserStatus: "completed", acquiredAt: CREATED_AT, createdAt: CREATED_AT,
  });
  const source = createReferenceFormulationSource({
    id: sourceId, acquisition, formulationCode: `SYN-${index}`, title: `Synthetic Evaluation Formula ${index}`,
    parserVersion: "synthetic-structural-fixture-v1",
    rights: { status: "unknown", redistribution: "unknown", evidenceRefs: [] }, createdAt: CREATED_AT,
  });
  const pages = [{ pageNumber: 1, blocks: [
    { type: "heading" as const, blockIndex: 0, text: "Formulation Title", source: "digital" as const },
    { type: "text" as const, blockIndex: 1, text: source.title, source: "digital" as const },
    { type: "text" as const, blockIndex: 2, text: `Product family: Synthetic Family ${index}`, source: "digital" as const },
    { type: "heading" as const, blockIndex: 3, text: "Procedure", source: "digital" as const },
    { type: "text" as const, blockIndex: 4, text: "1. Add synthetic input A and mix until homogeneous.", source: "digital" as const },
    { type: "table" as const, blockIndex: 5, source: "digital" as const, rows: [
      ["Ingredient", "Function", "% w/w"],
      ["Synthetic input A", "Fixture input", "50"],
      ["Synthetic input B", "Fixture input", "50"],
      ["Total", "-", "100"],
    ] },
  ] }];
  const identity = extractReferenceFormulationIdentity({ acquisition, pages });
  const extracted = extractReferenceFormulationIngredientLines({ source, pages });
  const arithmetic = validateReferenceFormulationArithmetic({
    source, lines: extracted.lines,
    sourceDeclaredTotal: { rawValue: "100", unit: "% w/w", evidence: {
      sourceDocumentHash: hash, pageNumber: 1, blockIndex: 5, excerpt: "Total | - | 100", source: "digital",
    } },
  });
  const procedure = extractReferenceFormulationProcedure({ source, pages });
  const targets = extractReferenceFormulationTargets({ source, pages });
  const matching = matchReferenceFormulationProducts({ source, lines: extracted.lines, products: [] });
  const unresolved = buildReferenceFormulationUnresolvedQueue({ source, lines: extracted.lines, matching, products: [] });
  const record = createReferenceFormulationRecord({
    id: formulaId, code: formulaId, source, identityCandidates: identity.candidates,
    identityMetadataComparisons: identity.metadataComparisons, identityWarnings: identity.warnings,
    ingredientLines: extracted.lines, arithmetic, procedureSteps: procedure.steps, procedureWarnings: procedure.warnings,
    targetCandidates: targets.candidates, targetWarnings: targets.warnings,
    productMatches: matching.lines, productMatchWarnings: matching.warnings, unresolvedEntries: unresolved.entries,
    createdAt: CREATED_AT,
  });
  const normalization = createReferenceFormulationNormalizationVersion({
    id: `synthetic-normalization-${index}`, source: record, version: 1, createdAt: CREATED_AT,
  });
  return { record, query: createReferenceFormulationQueryRecord({ source: record, normalization }) };
}

describe("synthetic reference formulation realism evaluation", () => {
  it("summarizes held-out source-linked structure without asserting human or lab validation", () => {
    const heldOut = [fixture(1), fixture(2), fixture(3)];
    const report = buildSyntheticReferenceFormulationRealismEvaluation({
      heldOutSourceRecords: heldOut.map(({ record }) => record),
      heldOutQueryRecords: heldOut.map(({ query }) => query),
      trainingSourceRecordIds: [],
    });

    expect(referenceFormulationRealismEvaluationSchema.parse(report)).toEqual(report);
    expect(report).toMatchObject({
      datasetKind: "synthetic_structural_fixtures", heldOutFormulaCount: 3, supplierCount: 3, productFamilyCount: 3,
      formulasReadyForChemistReview: 3, formulasWithEvidenceGaps: 0, humanReviewPerformed: false, labPerformanceEvaluated: false,
    });
    for (const [index, formula] of report.formulas.entries()) {
      expect(formula.sourceReviewStatus).toBe("unreviewed");
      expect(formula.ingredientLines).toHaveLength(2);
      expect(formula.ingredientLines.every((line) => line.sourceEvidenceRefs.length > 0
        && line.amount.evidenceRefs.length > 0 && line.reviewRequired
        && line.canonicalChemistry.status === "unresolved" && line.canonicalChemistry.reviewRequired)).toBe(true);
      expect(formula.productFamily.value).toBe(`Synthetic Family ${index + 1}`);
      expect(formula.productFamily.evidenceRefs.length).toBeGreaterThan(0);
      expect(formula.dosageStructure.arithmeticStatus).toBe("consistent");
      expect(formula.dosageStructure.sourceDeclaredTotal).toMatchObject({
        originalValue: "100", unit: "% w/w", evidenceRefs: [expect.stringContaining(formula.sourceDocumentHash)],
      });
      expect(formula.processEvidence.steps).toHaveLength(1);
      expect(formula.processEvidence.steps[0]?.evidenceRefs.length).toBeGreaterThan(0);
      expect(formula.processEvidence.steps[0]?.reviewRequired).toBe(true);
    }
    expect(report.disclaimer).toContain("no real supplier product");
    expect(report.disclaimer).toContain("human review");
    expect(report.disclaimer).toContain("laboratory performance is asserted");
    expect(buildSyntheticReferenceFormulationRealismEvaluation({
      heldOutSourceRecords: heldOut.map(({ record }) => record),
      heldOutQueryRecords: heldOut.map(({ query }) => query), trainingSourceRecordIds: [],
    })).toEqual(report);
  });

  it("rejects supplier or product-family diversity below the synthetic minimum", () => {
    const heldOut = [fixture(1), fixture(2), fixture(3)];
    const sources = heldOut.map(({ record }, index) => index === 2
      ? { ...record, identityCandidates: record.identityCandidates.map((candidate) => candidate.field === "product_family"
        ? { ...candidate, rawValue: "Synthetic Family 1" } : candidate) }
      : record);
    const queries = heldOut.map(({ query }, index) => index === 2
      ? { ...query, productFamily: { ...query.productFamily, candidates: [{ ...query.productFamily.candidates[0]!, rawValue: "Synthetic Family 1" }] } }
      : query);
    expect(() => buildSyntheticReferenceFormulationRealismEvaluation({
      heldOutSourceRecords: sources, heldOutQueryRecords: queries,
      trainingSourceRecordIds: [],
    })).toThrow(/at least three fixture suppliers and product families/u);
  });

  it("rejects train/held-out leakage and non-fixture supplier identifiers", () => {
    const heldOut = [fixture(1), fixture(2), fixture(3)];
    const sources = heldOut.map(({ record }) => record);
    const queries = heldOut.map(({ query }) => query);
    expect(() => buildSyntheticReferenceFormulationRealismEvaluation({
      heldOutSourceRecords: sources, heldOutQueryRecords: queries,
      trainingSourceRecordIds: [sources[0]!.id],
    })).toThrow(/must not overlap/u);
    const alteredSource = {
      ...sources[0]!, source: { ...sources[0]!.source, supplierId: "supplier-real" },
      productMatches: sources[0]!.productMatches.map((match) => ({ ...match, sourceSupplierId: "supplier-real" as const })),
      unresolvedEntries: sources[0]!.unresolvedEntries.map((entry) => ({ ...entry, sourceSupplierId: "supplier-real" })),
    };
    const alteredQueries = [{ ...queries[0]!, supplierId: "supplier-real" }, ...queries.slice(1)];
    expect(() => buildSyntheticReferenceFormulationRealismEvaluation({
      heldOutSourceRecords: [alteredSource, ...sources.slice(1)], heldOutQueryRecords: alteredQueries,
      trainingSourceRecordIds: [],
    })).toThrow(/fixture suppliers and product families/u);
  });

  it("rejects invented process instructions in an otherwise valid query snapshot", () => {
    const heldOut = [fixture(1), fixture(2), fixture(3)];
    const queries = heldOut.map(({ query }, index) => index === 0
      ? { ...query, processSteps: query.processSteps.map((step) => ({ ...step, originalInstruction: "Invented unreferenced process instruction." })) }
      : query);
    expect(() => buildSyntheticReferenceFormulationRealismEvaluation({
      heldOutSourceRecords: heldOut.map(({ record }) => record), heldOutQueryRecords: queries,
      trainingSourceRecordIds: [],
    })).toThrow(/must match the immutable source procedure snapshot/u);
  });
});
