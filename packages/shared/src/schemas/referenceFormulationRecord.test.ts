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
import { supplierDocumentAcquisitionSchema } from "./supplierDocument";
import { createReferenceFormulationSource, referenceFormulationSourceSchema } from "./referenceFormulationSource";
import { createReferenceFormulationRecord, referenceFormulationRecordSchema } from "./referenceFormulationRecord";

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
    { type: "table" as const, blockIndex: 1, source: "digital" as const, rows: [["Ingredient", "Amount", "Unit", "Basis"], ["Known Product", "4.0", "%", "w/w"]] },
    { type: "heading" as const, blockIndex: 2, text: "Procedure", source: "digital" as const },
    { type: "text" as const, blockIndex: 3, text: "Add the ingredient and mix until clear.", source: "digital" as const },
    { type: "heading" as const, blockIndex: 4, text: "Target Values", source: "digital" as const },
    { type: "text" as const, blockIndex: 5, text: "pH: 5.0–5.5", source: "digital" as const },
  ] },
];

function generatedRecord() {
  const source = formulaSource();
  const identity = extractReferenceFormulationIdentity({ acquisition: acquisition(), pages });
  const ingredientResult = extractReferenceFormulationIngredientLines({ source, pages });
  const arithmetic = validateReferenceFormulationArithmetic({ source, lines: ingredientResult.lines });
  const procedure = extractReferenceFormulationProcedure({ source, pages });
  const targets = extractReferenceFormulationTargets({ source, pages });
  const matching = matchReferenceFormulationProducts({ source, lines: ingredientResult.lines, products: [] });
  const unresolved = buildReferenceFormulationUnresolvedQueue({
    source, lines: ingredientResult.lines, matching, products: [],
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
