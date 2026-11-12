import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReferenceFormulationContribution,
  supplierSdsProductEvidenceSchema,
  supplierSdsProductEvidenceRecordSchema,
  type CommercialProduct,
  extractReferenceFormulationIdentity,
  extractReferenceFormulationIngredientLines,
  validateReferenceFormulationArithmetic,
  extractReferenceFormulationProcedure,
  matchReferenceFormulationProducts,
  extractReferenceFormulationTargets,
  buildReferenceFormulationUnresolvedQueue,
  validateReferenceFormulationProcessNormalizationAgainstSource,
  validateReferenceFormulationTargetNormalizationAgainstSource,
} from "@formulab/shared";
import { supplierDocumentAcquisitionSchema } from "@formulab/shared";
import { createReferenceFormulationSource } from "@formulab/shared";
import { createReferenceFormulationRecord } from "@formulab/shared";
import { appendReferenceFormulationNormalization, listReferenceFormulationNormalizations, rebuildReferenceFormulationCorpusIndex } from "./referenceFormulationNormalizations";
import { createReferenceFormulationNormalizationVersion } from "@formulab/shared";
import { appendReferenceFormulationNormalizationRecord, listRecords } from "./masterdata";
import { getReferenceFormulationCorpusReviewData } from "./referenceFormulationCorpusReview";

vi.mock("./masterdata", () => ({
  listRecords: vi.fn(),
  appendReferenceFormulationNormalizationRecord: vi.fn(),
  nowIso: () => "2026-10-26T12:00:00.000Z",
}));

const HASH = "a".repeat(64);
const acquisition = () => supplierDocumentAcquisitionSchema.parse({
  schemaVersion: "1.0", code: "normalization-acquisition", supplierId: "supplier-croda", providerId: "croda-public", surfaceId: "manual-import",
  documentType: "FORMULATION", acquisitionMethod: "manual_assisted",
  sourceFileSelection: { selectionId: "selection-1", originalFilename: "formula.pdf", sourceFileSha256: HASH, selectedAt: "2026-10-26T08:00:00.000Z", selectedBy: "owner-1" },
  sourceProduct: { tradeName: "Example formulation" }, market: "EU", language: "en", originalFilename: "formula.pdf", mimeType: "application/pdf",
  sha256: HASH, byteSize: 2048, parserStatus: "completed", acquiredAt: "2026-10-26T08:00:00.000Z", createdAt: "2026-10-26T08:00:00.000Z",
});

const commercialProduct: CommercialProduct = {
  schemaVersion: "1.0", id: "commercial-product-1", supplierId: "supplier-croda", tradeName: "Known Product",
  aliases: [], sourceDocumentCodes: [], sourceFormulationReferences: [], lifecycleStatus: "active", reviewStatus: "unreviewed",
};

function sourceRecord(products: CommercialProduct[] = [], recordId = "normalization-source-record") {
  const source = createReferenceFormulationSource({
    id: "normalization-source", acquisition: acquisition(), title: "Example formula", parserVersion: "formulab-reference-formulation-layout-v1",
    rights: { status: "unknown", redistribution: "unknown", evidenceRefs: [] }, createdAt: "2026-10-26T08:01:00.000Z",
  });
  const pages = [{ pageNumber: 1, blocks: [
    { type: "heading" as const, blockIndex: 0, text: "Formula Composition", source: "digital" as const },
    { type: "table" as const, blockIndex: 1, source: "digital" as const, rows: [["Ingredient", "Amount"], ["Known Product", "4.0"]] },
    { type: "heading" as const, blockIndex: 2, text: "Manufacturing Procedure", source: "digital" as const },
    { type: "table" as const, blockIndex: 3, source: "digital" as const, rows: [["Step", "Phase", "Operation"], ["1", "A", "Add and mix at 70°C for 10 min."]] },
    { type: "heading" as const, blockIndex: 4, text: "Target Values", source: "digital" as const },
    { type: "table" as const, blockIndex: 5, source: "digital" as const, rows: [["Target pH", "Target Viscosity", "Target Density", "Target Appearance"], ["5.0–5.5", "~375 cP at 25°C", "1.02 g/mL", "Clear yellow"]] },
    { type: "heading" as const, blockIndex: 6, text: "Typical Results", source: "digital" as const },
    { type: "table" as const, blockIndex: 7, source: "digital" as const, rows: [["Typical Result"], ["Stable after 24 h"]] },
  ] }];
  const identity = extractReferenceFormulationIdentity({ acquisition: acquisition(), pages });
  const ingredientResult = extractReferenceFormulationIngredientLines({ source, pages });
  const arithmetic = validateReferenceFormulationArithmetic({ source, lines: ingredientResult.lines });
  const procedure = extractReferenceFormulationProcedure({ source, pages });
  const targets = extractReferenceFormulationTargets({ source, pages });
  const productMatches = matchReferenceFormulationProducts({ source, lines: ingredientResult.lines, products });
  const unresolved = buildReferenceFormulationUnresolvedQueue({ source, lines: ingredientResult.lines, matching: productMatches, products });
  return createReferenceFormulationRecord({
    id: recordId, code: recordId, source,
    identityCandidates: identity.candidates, identityMetadataComparisons: identity.metadataComparisons, identityWarnings: identity.warnings,
    ingredientLines: ingredientResult.lines, arithmetic, procedureSteps: procedure.steps, procedureWarnings: procedure.warnings,
    targetCandidates: targets.candidates, targetWarnings: targets.warnings,
    productMatches: productMatches.lines, productMatchWarnings: productMatches.warnings,
    unresolvedEntries: unresolved.entries, createdAt: "2026-10-26T08:02:00.000Z",
  });
}

describe("reference formulation normalization persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("appends separately numbered immutable versions linked to the same source hash", async () => {
    const source = sourceRecord();
    let versions: unknown[] = [];
    vi.mocked(listRecords).mockImplementation(async (collection) => {
      if (collection === "reference_formulations") return [source] as never;
      if (collection === "reference_formulation_normalizations") return versions as never;
      return [] as never;
    });
    vi.mocked(appendReferenceFormulationNormalizationRecord).mockImplementation(async (record) => {
      versions = [...versions, record];
      return record;
    });

    const first = await appendReferenceFormulationNormalization({ referenceFormulationRecordId: source.id });
    const second = await appendReferenceFormulationNormalization({
      referenceFormulationRecordId: source.id,
      canonicalChemicalCandidates: { [source.ingredientLines[0]!.id]: ["chemical-a"] },
    });
    expect(first).toMatchObject({ version: 1, sourceDocumentHash: HASH });
    expect(first.processNormalization).toMatchObject({
      sourceStatus: "available",
      steps: [{
        sequenceOrder: 1,
        originalInstruction: "Add and mix at 70°C for 10 min.",
        actionCandidates: ["addition", "mix"],
        phaseCandidates: { status: "proposed", candidateValues: [{ rawValue: "A" }] },
        conditions: [{ kind: "temperature", rawValue: "70°C" }, { kind: "time", rawValue: "10 min" }],
        reviewRequired: true,
      }],
      reviewRequired: true,
    });
    expect(first.targetNormalization).toMatchObject({
      sourceStatus: "available",
      targets: [
        { property: "ph", originalValue: "5.0–5.5", valueShape: "range", resultSemantics: "target", reviewRequired: true },
        { property: "viscosity", originalValue: "~375 cP at 25°C", valueShape: "approximate", resultSemantics: "target", sourceContext: "Target Viscosity: ~375 cP at 25°C" },
        { property: "density", originalValue: "1.02 g/mL", resultSemantics: "target" },
        { property: "appearance", originalValue: "Clear yellow", resultSemantics: "target" },
        { property: "other", originalValue: "Stable after 24 h", resultSemantics: "typical_result" },
      ],
      reviewRequired: true,
    });
    expect(second).toMatchObject({ version: 2, supersedesNormalizationId: first.id, sourceDocumentHash: HASH });
    expect(await listReferenceFormulationNormalizations(source.id)).toHaveLength(2);
  });

  it("refuses canonical candidates that do not point to a preserved source line", async () => {
    const source = sourceRecord();
    vi.mocked(listRecords).mockImplementation(async (collection) => collection === "reference_formulations" ? [source] as never : [] as never);
    await expect(appendReferenceFormulationNormalization({
      referenceFormulationRecordId: source.id,
      canonicalChemicalCandidates: { "unknown-line": ["chemical-a"] },
    })).rejects.toThrow(/unknown source line/);
    expect(appendReferenceFormulationNormalizationRecord).not.toHaveBeenCalled();
  });

  it("rejects persisted commercial-product candidates that drift from the source match snapshot", async () => {
    const source = sourceRecord();
    const valid = createReferenceFormulationNormalizationVersion({
      id: "normalization-v1", source, version: 1, createdAt: "2026-10-26T10:00:00.000Z",
    });
    const corrupted = {
      ...valid,
      lines: valid.lines.map((line, index) => index === 0 ? {
        ...line,
        commercialProduct: { status: "proposed" as const, candidateIds: ["forged-product"] },
      } : line),
    };
    vi.mocked(listRecords).mockImplementation(async (collection) => collection === "reference_formulations"
      ? [source] as never
      : collection === "reference_formulation_normalizations" ? [corrupted] as never : [] as never);
    await expect(listReferenceFormulationNormalizations(source.id)).rejects.toThrow(/match the immutable source match snapshot/);
  });

  it("validates process candidates against immutable instructions and reads older versions without them", async () => {
    const source = sourceRecord();
    const current = createReferenceFormulationNormalizationVersion({ id: "normalization-v1", source, version: 1, createdAt: "2026-10-26T10:00:00.000Z" });
    const tampered = structuredClone(current.processNormalization!);
    tampered.steps[0]!.conditions[0]!.rawValue = "100°C";
    expect(() => validateReferenceFormulationProcessNormalizationAgainstSource(tampered, source)).toThrow(/must match the immutable source procedure snapshot/);
    const tamperedTarget = structuredClone(current.targetNormalization!);
    tamperedTarget.targets[0]!.originalValue = "7.0";
    expect(() => validateReferenceFormulationTargetNormalizationAgainstSource(tamperedTarget, source)).toThrow(/must match the immutable source target snapshot/);

    const legacy = { ...current, processNormalization: undefined, targetNormalization: undefined };
    vi.mocked(listRecords).mockImplementation(async (collection) => collection === "reference_formulations"
      ? [source] as never
      : collection === "reference_formulation_normalizations" ? [legacy] as never : [] as never);
    await expect(listReferenceFormulationNormalizations(source.id)).resolves.toHaveLength(1);
  });

  it("persists unknown component contributions inside the next immutable normalization version", async () => {
    const source = sourceRecord();
    let versions: unknown[] = [];
    vi.mocked(listRecords).mockImplementation(async (collection) => {
      if (collection === "reference_formulations") return [source] as never;
      if (collection === "reference_formulation_normalizations") return versions as never;
      return [] as never;
    });
    vi.mocked(appendReferenceFormulationNormalizationRecord).mockImplementation(async (record) => {
      versions = [...versions, record];
      return record;
    });
    const sourceLine = source.ingredientLines[0]!;
    const contribution = createReferenceFormulationContribution({ source, sourceFormulaLineId: sourceLine.id });
    const saved = await appendReferenceFormulationNormalization({
      referenceFormulationRecordId: source.id,
      componentContributions: { [sourceLine.id]: [contribution] },
    });
    expect(saved.lines[0]?.componentContributions).toEqual([contribution]);
    expect(appendReferenceFormulationNormalizationRecord).toHaveBeenCalledWith(expect.objectContaining({
      referenceFormulationRecordId: source.id,
      lines: expect.arrayContaining([expect.objectContaining({ componentContributions: [contribution] })]),
    }));
  });

  it("joins normalized formula lines to the exact supplier SDS Section 3 fact and acquisition hash", async () => {
    const source = sourceRecord([commercialProduct]);
    const sdsHash = "c".repeat(64);
    const sds = supplierSdsProductEvidenceRecordSchema.parse({
      schemaVersion: "1.0", code: "sds-evidence-trace", acquisitionCode: "sds-acquisition-trace", extractionStatus: "unreviewed",
      createdAt: "2026-10-26T10:00:00.000Z",
      evidence: supplierSdsProductEvidenceSchema.parse({
        schemaVersion: "1.0", id: "sds-evidence-trace", commercialProductId: commercialProduct.id,
        section1: { sectionNumber: 1, sourceDocumentHash: sdsHash },
        section3: { sectionNumber: 3, sourceDocumentHash: sdsHash, components: [{
          id: "section3-component", componentName: { id: "component-name", rawValue: "Sodium laureth sulfate", evidenceRefs: ["sds:p3:concentration"] },
          concentration: { id: "component-concentration", rawValue: "20-40% w/w", evidenceRefs: ["sds:p3:concentration"] }, disclosure: "disclosed",
        }] },
      }),
    });
    const sdsAcquisition = supplierDocumentAcquisitionSchema.parse({
      schemaVersion: "1.0", code: "sds-acquisition-trace", supplierId: "supplier-croda", providerId: "croda-public", surfaceId: "sds-library",
      documentType: "SDS", acquisitionMethod: "manual_assisted",
      sourceFileSelection: { selectionId: "sds-selection", originalFilename: "product-sds.pdf", sourceFileSha256: sdsHash, selectedAt: "2026-10-26T10:00:00.000Z", selectedBy: "owner-1" },
      sourceProduct: { tradeName: "Known Product" }, market: "EU", language: "en", originalFilename: "product-sds.pdf", mimeType: "application/pdf",
      sha256: sdsHash, byteSize: 1024, parserStatus: "completed", acquiredAt: "2026-10-26T10:00:00.000Z", createdAt: "2026-10-26T10:00:00.000Z",
    });
    const line = source.ingredientLines[0]!;
    const contribution = createReferenceFormulationContribution({
      source, sourceFormulaLineId: line.id, commercialProductId: commercialProduct.id, sourceSds: sds, sourceComponentId: "section3-component",
    });
    const version = createReferenceFormulationNormalizationVersion({
      id: "normalization-trace-v1", source, version: 1, componentContributions: { [line.id]: [contribution] },
      supplierSdsEvidenceRecords: [sds], createdAt: "2026-10-26T10:00:00.000Z",
    });
    vi.mocked(listRecords).mockImplementation(async (collection) => {
      if (collection === "reference_formulations") return [source] as never;
      if (collection === "reference_formulation_normalizations") return [version] as never;
      if (collection === "supplier_sds_product_evidence") return [sds] as never;
      if (collection === "supplier_document_acquisitions") return [sdsAcquisition] as never;
      return [] as never;
    });
    const trace = await getReferenceFormulationCorpusReviewData(source.id);
    expect(trace.versions[0]?.lines[0]).toMatchObject({
      sourceLine: { id: line.id },
      normalizedLine: { sourceLineId: line.id },
      contributions: [{
        contribution: { sourceFormulaLineId: line.id, sourceSds: { evidenceId: sds.code, sourceFactId: "component-concentration" } },
        sds: { evidence: { code: sds.code }, acquisition: { code: sdsAcquisition.code, sha256: sdsHash }, sourceComponent: { id: "section3-component" } },
      }],
    });
    vi.mocked(listRecords).mockImplementation(async (collection) => collection === "reference_formulations"
      ? [source] as never
      : collection === "reference_formulation_normalizations" ? [version] as never
      : collection === "supplier_sds_product_evidence" ? [sds] as never
      : collection === "supplier_document_acquisitions" ? [{ ...sdsAcquisition, supplierId: "supplier-dow" }] as never : [] as never);
    await expect(getReferenceFormulationCorpusReviewData(source.id)).rejects.toThrow(/supplier must match/);
    vi.mocked(listRecords).mockImplementation(async (collection) => collection === "reference_formulations"
      ? [source] as never
      : collection === "reference_formulation_normalizations" ? [version] as never
      : collection === "supplier_sds_product_evidence" ? [sds] as never
      : collection === "supplier_document_acquisitions" ? [{ ...sdsAcquisition, sha256: "d".repeat(64) }] as never : [] as never);
    await expect(getReferenceFormulationCorpusReviewData(source.id)).rejects.toThrow(/matching acquired SDS hash/);
  });

  it("rebuilds query records and postings deterministically from restored immutable records", async () => {
    const first = sourceRecord([], "restored-source-a");
    const second = sourceRecord([], "restored-source-b");
    const sdsEvidence = supplierSdsProductEvidenceRecordSchema.parse({
      schemaVersion: "1.0", code: "restored-sds-evidence", acquisitionCode: "restored-sds-acquisition", extractionStatus: "unreviewed",
      createdAt: "2026-10-26T10:00:00.000Z",
      evidence: supplierSdsProductEvidenceSchema.parse({
        schemaVersion: "1.0", id: "restored-sds-evidence", commercialProductId: "restored-product",
        section1: { sectionNumber: 1, sourceDocumentHash: HASH },
        section3: { sectionNumber: 3, sourceDocumentHash: HASH, components: [] },
      }),
    });
    let sourceRows = [first, second];
    let sdsRows = [sdsEvidence];
    vi.mocked(listRecords).mockImplementation(async (collection) => collection === "reference_formulations"
      ? sourceRows as never : collection === "supplier_sds_product_evidence" ? sdsRows as never : [] as never);
    const rebuilt = await rebuildReferenceFormulationCorpusIndex();
    sourceRows = [second, first];
    const restored = await rebuildReferenceFormulationCorpusIndex();
    expect(rebuilt).toEqual(restored);
    expect(rebuilt.queryRecords.map((record) => record.sourceRecordId)).toEqual(["restored-source-a", "restored-source-b"]);
    expect(rebuilt.index.queryRecordIds).toEqual(rebuilt.queryRecords.map((record) => record.id).sort());
    expect(rebuilt.index.schemaVersion).toBe("formulab-reference-formulation-local-index-v1");
    sdsRows = [sdsEvidence, { ...sdsEvidence, acquisitionCode: "duplicate-sds-acquisition" }];
    await expect(rebuildReferenceFormulationCorpusIndex()).rejects.toThrow(/duplicate immutable SDS evidence IDs/);
  });
});
