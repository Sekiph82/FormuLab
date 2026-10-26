import { describe, expect, it } from "vitest";
import {
  extractReferenceFormulationIdentity,
} from "../engine/referenceFormulationIdentityExtraction";
import { extractReferenceFormulationIngredientLines } from "../engine/referenceFormulationIngredientExtraction";
import { validateReferenceFormulationArithmetic } from "../engine/referenceFormulationArithmetic";
import { extractReferenceFormulationProcedure } from "../engine/referenceFormulationProcedureExtraction";
import { matchReferenceFormulationProducts } from "../engine/referenceFormulationProductMatching";
import { extractReferenceFormulationTargets } from "../engine/referenceFormulationTargetExtraction";
import { buildReferenceFormulationUnresolvedQueue } from "../engine/referenceFormulationUnresolvedQueue";
import { createReferenceFormulationContribution } from "./referenceFormulationContribution";
import { supplierDocumentAcquisitionSchema } from "./supplierDocument";
import { supplierSdsProductEvidenceSchema } from "./supplierSdsProductEvidence";
import { supplierSdsProductEvidenceRecordSchema } from "./supplierSdsProductEvidence";
import type { CommercialProduct } from "./commercialProduct";
import { createReferenceFormulationSource, referenceFormulationSourceSchema } from "./referenceFormulationSource";
import { createReferenceFormulationRecord, referenceFormulationRecordSchema } from "./referenceFormulationRecord";
import { createReferenceFormulationNormalizationVersion } from "./referenceFormulationNormalization";
import { validateReferenceFormulationFunctionNormalizationAgainstSource } from "./referenceFormulationFunction";

const HASH = "a".repeat(64);
const acquisition = () => supplierDocumentAcquisitionSchema.parse({
  schemaVersion: "1.0", code: "supplierdoc-formula-record", supplierId: "supplier-croda", providerId: "croda-public", surfaceId: "formulation-library",
  documentType: "FORMULATION", acquisitionMethod: "manual_assisted",
  sourceFileSelection: { selectionId: "selection-record", originalFilename: "formula.pdf", sourceFileSha256: HASH, selectedAt: "2026-10-26T08:00:00.000Z", selectedBy: "owner-1" },
  sourceProduct: { tradeName: "Example formulation" }, market: "EU", language: "en", originalFilename: "formula.pdf", mimeType: "application/pdf",
  sha256: HASH, byteSize: 2048, parserStatus: "completed", acquiredAt: "2026-10-26T08:00:00.000Z", createdAt: "2026-10-26T08:00:00.000Z",
});
const formulaSource = () => createReferenceFormulationSource({
  id: "reference-source-record-1", acquisition: acquisition(), title: "Example supplier formula", parserVersion: "formulab-reference-formulation-layout-v1",
  rights: { status: "unknown", redistribution: "unknown", evidenceRefs: [] }, createdAt: "2026-10-26T08:01:00.000Z",
});
const pages = [
  { pageNumber: 1, blocks: [
    { type: "heading" as const, blockIndex: 0, text: "Formula Composition", source: "digital" as const },
    { type: "table" as const, blockIndex: 1, source: "digital" as const, rows: [["Ingredient", "Amount", "Unit", "Basis", "Function"], ["Known Product", "4.0", "%", "w/w", "Supplier function wording"]] },
    { type: "heading" as const, blockIndex: 2, text: "Procedure", source: "digital" as const },
    { type: "text" as const, blockIndex: 3, text: "Add the ingredient and mix until clear.", source: "digital" as const },
    { type: "heading" as const, blockIndex: 4, text: "Target Values", source: "digital" as const },
    { type: "text" as const, blockIndex: 5, text: "pH: 5.0–5.5", source: "digital" as const },
  ] },
];

function generatedRecord(products: CommercialProduct[] = []) {
  const source = formulaSource();
  const identity = extractReferenceFormulationIdentity({ acquisition: acquisition(), pages });
  const ingredientResult = extractReferenceFormulationIngredientLines({ source, pages });
  const arithmetic = validateReferenceFormulationArithmetic({ source, lines: ingredientResult.lines });
  const procedure = extractReferenceFormulationProcedure({ source, pages });
  const targets = extractReferenceFormulationTargets({ source, pages });
  const matching = matchReferenceFormulationProducts({ source, lines: ingredientResult.lines, products });
  const unresolved = buildReferenceFormulationUnresolvedQueue({
    source, lines: ingredientResult.lines, matching, products,
  });
  return createReferenceFormulationRecord({
    id: "reference-formula-record-1", code: "reference-formula-record-1", source,
    identityCandidates: identity.candidates, identityMetadataComparisons: identity.metadataComparisons, identityWarnings: identity.warnings,
    ingredientLines: ingredientResult.lines, arithmetic,
    procedureSteps: procedure.steps, procedureWarnings: procedure.warnings,
    targetCandidates: targets.candidates, targetWarnings: targets.warnings,
    productMatches: matching.lines, productMatchWarnings: matching.warnings, unresolvedEntries: unresolved.entries, createdAt: "2026-10-26T08:02:00.000Z",
  });
}

describe("reference formulation record schema", () => {
  it("persists the complete source-backed extraction as an unreviewed reference record", () => {
    const record = generatedRecord();
    expect(record).toMatchObject({
      recordKind: "supplier_reference_formula",
      source: { id: "reference-source-record-1", acquisitionCode: "supplierdoc-formula-record" },
      ingredientLines: [{ ingredientName: { rawValue: "Known Product" }, amount: { rawValue: "4.0" } }],
      productMatches: [{ resolution: "unmatched", autoLinked: false, reviewRequired: true }],
      unresolvedEntries: [{ status: "ready_for_acquisition" }],
      reviewStatus: "unreviewed",
    });
    expect(record).not.toHaveProperty("formulationId");
    expect(record).not.toHaveProperty("approvalStatus");
    expect(referenceFormulationRecordSchema.parse(record)).toEqual(record);
  });

  it("continues to read immutable records produced by the prior product-matcher version", () => {
    const currentRecord = generatedRecord();
    const priorVersionRecord = {
      ...currentRecord,
      parserVersions: {
        ...currentRecord.parserVersions,
        productMatcher: "formulab-reference-formulation-product-matcher-v1",
      },
    };
    expect(referenceFormulationRecordSchema.parse(priorVersionRecord).parserVersions.productMatcher)
      .toBe("formulab-reference-formulation-product-matcher-v1");
  });

  it("stores exact or ranged component contribution with formula/SDS lineage and keeps missing evidence unknown", () => {
    const product: CommercialProduct = {
      schemaVersion: "1.0", id: "commercial-product-1", supplierId: "supplier-croda", tradeName: "Known Product",
      aliases: [], sourceDocumentCodes: [], sourceFormulationReferences: [], lifecycleStatus: "active", reviewStatus: "unreviewed",
    };
    const source = generatedRecord([product]);
    const sds = supplierSdsProductEvidenceSchema.parse({
      schemaVersion: "1.0", id: "sds-evidence-1", commercialProductId: product.id,
      section1: { sectionNumber: 1, sourceDocumentHash: "c".repeat(64), declaredChemicalName: { id: "sds-name", rawValue: "Known Product", evidenceRefs: ["sds:p1:name"] } },
      section3: { sectionNumber: 3, sourceDocumentHash: "c".repeat(64), components: [
        { id: "sds-component-1", concentration: { id: "sds-concentration-1", rawValue: "20-40% w/w", evidenceRefs: ["sds:p3:concentration"] }, disclosure: "disclosed" },
      ] },
    });
    const sdsRecord = supplierSdsProductEvidenceRecordSchema.parse({
      schemaVersion: "1.0", code: sds.id, acquisitionCode: "acquisition-sds-1", evidence: sds,
      extractionStatus: "unreviewed", createdAt: "2026-10-26T10:00:00.000Z",
    });
    const line = source.ingredientLines[0]!;
    const ranged = createReferenceFormulationContribution({
      source, sourceFormulaLineId: line.id, commercialProductId: product.id, sourceSds: sdsRecord,
      sourceComponentId: "sds-component-1", canonicalChemicalCandidateIds: ["component-chemical-candidate"],
    });
    expect(ranged).toMatchObject({
      quantityKind: "component_contribution", status: "range", sourceFormulationRecordId: source.id,
      sourceFormulaDocumentHash: HASH, sourceFormulaLineId: line.id, sourceSds: { evidenceId: sds.id, acquisitionCode: "acquisition-sds-1", sectionNumber: 3, sourceFactId: "sds-concentration-1", fractionRange: { lowerBound: 0.2, upperBound: 0.4 } },
      contributionPercentRange: { lowerBound: 0.8, upperBound: 1.6 }, canonicalChemistry: { status: "proposed", candidateIds: ["component-chemical-candidate"] },
      reviewRequired: true,
    });
    const normalization = createReferenceFormulationNormalizationVersion({
      id: "normalization-contribution-v1", source, version: 1,
      componentContributions: { [line.id]: [ranged] }, supplierSdsEvidenceRecords: [sdsRecord],
      canonicalFunctionCandidates: { [line.id]: ["nonionic_surfactant"] }, createdAt: "2026-10-26T10:00:00.000Z",
    });
    expect(normalization.lines[0]?.componentContributions).toEqual([ranged]);
    expect(normalization.lines[0]?.canonicalChemistry).toMatchObject({ status: "unresolved", candidateIds: [] });
    expect(normalization.lines[0]?.functionNormalization).toMatchObject({
      supplierFunction: { status: "stated", originalValue: "Supplier function wording" },
      canonicalFunction: { status: "proposed", candidateIds: ["nonionic_surfactant"] },
      reviewRequired: true,
    });
    expect(normalization.lines[0]?.functionNormalization?.supplierFunction).not.toHaveProperty("approved");
    const tamperedFunction = structuredClone(normalization.lines[0]!.functionNormalization!);
    tamperedFunction.supplierFunction.originalValue = "Changed wording";
    expect(() => validateReferenceFormulationFunctionNormalizationAgainstSource(
      tamperedFunction, source, line.id,
    )).toThrow(/must match the immutable source/);

    const exactSds = supplierSdsProductEvidenceSchema.parse({
      ...sds,
      id: "sds-evidence-exact",
      section3: { ...sds.section3, components: [
        { id: "sds-component-exact", concentration: { id: "sds-concentration-exact", rawValue: "30% w/w", evidenceRefs: ["sds:p3:exact"] }, disclosure: "disclosed" },
      ] },
    });
    const exactSdsRecord = supplierSdsProductEvidenceRecordSchema.parse({
      schemaVersion: "1.0", code: exactSds.id, acquisitionCode: "acquisition-sds-exact", evidence: exactSds,
      extractionStatus: "unreviewed", createdAt: "2026-10-26T10:00:00.000Z",
    });
    const exact = createReferenceFormulationContribution({
      source, sourceFormulaLineId: line.id, commercialProductId: product.id, sourceSds: exactSdsRecord,
      sourceComponentId: "sds-component-exact",
    });
    expect(exact).toMatchObject({ status: "exact", contributionPercentRange: { lowerBound: 1.2, upperBound: 1.2 }, sourceSds: { interpretation: "exact" } });

    const emptyDisclosureEvidence = supplierSdsProductEvidenceSchema.parse({
      ...sds, id: "sds-evidence-empty-section3", section3: { ...sds.section3, components: [] },
    });
    const emptyDisclosureRecord = supplierSdsProductEvidenceRecordSchema.parse({
      schemaVersion: "1.0", code: emptyDisclosureEvidence.id, acquisitionCode: "acquisition-sds-empty",
      evidence: emptyDisclosureEvidence, extractionStatus: "unreviewed", createdAt: "2026-10-26T10:00:00.000Z",
    });
    const unresolvedComponent = createReferenceFormulationContribution({
      source, sourceFormulaLineId: line.id, commercialProductId: product.id, sourceSds: emptyDisclosureRecord,
    });
    expect(unresolvedComponent).toMatchObject({
      status: "unknown", unknownReasons: ["sds_component_unresolved"], sourceSds: { status: "available", interpretation: "unknown", evidenceRefs: [] },
    });
    expect(unresolvedComponent).not.toHaveProperty("contributionPercentRange");

    const unknown = createReferenceFormulationContribution({ source, sourceFormulaLineId: line.id, commercialProductId: product.id });
    expect(unknown).toMatchObject({ status: "unknown", unknownReasons: ["sds_evidence_missing"], canonicalChemistry: { status: "unresolved", candidateIds: [] } });
    expect(unknown).not.toHaveProperty("contributionPercentRange");
  });

  it("rejects production approval/lifecycle fields and cross-source evidence", () => {
    const record = generatedRecord();
    expect(() => referenceFormulationRecordSchema.parse({ ...record, reviewStatus: "approved" })).toThrow();
    expect(() => referenceFormulationRecordSchema.parse({ ...record, formulationId: "production-formulation-1" })).toThrow();
    expect(() => referenceFormulationRecordSchema.parse({ ...record, unresolvedEntries: [] })).toThrow(/exactly one acquisition\/review queue entry/);
    expect(() => referenceFormulationRecordSchema.parse({ ...record, unresolvedEntries: [...record.unresolvedEntries, record.unresolvedEntries[0]!] })).toThrow(/exactly one acquisition\/review queue entry/);

    const badTarget = {
      ...record,
      targetCandidates: record.targetCandidates.map((candidate, index) => index === 0
        ? { ...candidate, evidence: { ...candidate.evidence, sourceDocumentHash: "b".repeat(64) } }
        : candidate),
    };
    expect(() => referenceFormulationRecordSchema.parse(badTarget)).toThrow(/target\/result fact must reference/);

    const badQueuedLine = {
      ...record,
      unresolvedEntries: record.unresolvedEntries.map((entry) => ({
        ...entry,
        ingredientLine: {
          ...entry.ingredientLine,
          ingredientName: {
            ...entry.ingredientLine.ingredientName!,
            evidence: { ...entry.ingredientLine.ingredientName!.evidence, sourceDocumentHash: "b".repeat(64) },
          },
        },
      })),
    };
    expect(() => referenceFormulationRecordSchema.parse(badQueuedLine)).toThrow(/Queued ingredient field evidence/);

    const badQueueCandidates = {
      ...record,
      unresolvedEntries: record.unresolvedEntries.map((entry) => ({
        ...entry, candidateCommercialProductIds: ["unrelated-product"],
      })),
    };
    expect(() => referenceFormulationRecordSchema.parse(badQueueCandidates)).toThrow(/Queue candidates must exactly match/);
  });

  it("derives acquisition metadata comparisons from the immutable source and cited identity candidates", () => {
    const base = generatedRecord();
    const source = referenceFormulationSourceSchema.parse({ ...base.source, sourceRevision: "Rev 2" });
    const candidate = {
      field: "revision_identifier" as const, rawValue: "Rev 3", extractionMethod: "labeled_field" as const,
      evidence: [{ sourceDocumentHash: HASH, pageNumber: 1, blockIndex: 0, excerpt: "Revision: Rev 3", source: "digital" as const }],
      reviewRequired: true as const,
    };
    const comparison = {
      field: "revision_identifier" as const, acquisitionValue: "Rev 2", extractedValues: ["Rev 3"], result: "differs" as const,
      acquisitionCode: source.acquisitionCode, reviewRequired: true as const,
    };
    const consistentSnapshot = { ...base, source, identityCandidates: [candidate], identityMetadataComparisons: [comparison] };
    expect(referenceFormulationRecordSchema.parse(consistentSnapshot).identityMetadataComparisons).toEqual([comparison]);
    expect(() => referenceFormulationRecordSchema.parse({
      ...consistentSnapshot, identityMetadataComparisons: [{ ...comparison, result: "matches" }],
    })).toThrow(/derivable from the source revision metadata/);
    expect(() => referenceFormulationRecordSchema.parse({
      ...consistentSnapshot, identityMetadataComparisons: [{ ...comparison, acquisitionValue: "Rev 1" }],
    })).toThrow(/derivable from the source revision metadata/);
    expect(() => referenceFormulationRecordSchema.parse({
      ...consistentSnapshot, identityMetadataComparisons: [{ ...comparison, extractedValues: [] }],
    })).toThrow();
  });
});
