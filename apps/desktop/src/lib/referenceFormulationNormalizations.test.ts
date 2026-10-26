import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReferenceFormulationContribution,
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
import { appendReferenceFormulationNormalization, listReferenceFormulationNormalizations } from "./referenceFormulationNormalizations";
import { createReferenceFormulationNormalizationVersion } from "@formulab/shared";
import { appendReferenceFormulationNormalizationRecord, listRecords } from "./masterdata";

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

function sourceRecord() {
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
  const productMatches = matchReferenceFormulationProducts({ source, lines: ingredientResult.lines, products: [] });
  const unresolved = buildReferenceFormulationUnresolvedQueue({ source, lines: ingredientResult.lines, matching: productMatches, products: [] });
  return createReferenceFormulationRecord({
    id: "normalization-source-record", code: "normalization-source-record", source,
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
});
