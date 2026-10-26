import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractReferenceFormulationIdentity,
  extractReferenceFormulationIngredientLines,
  validateReferenceFormulationArithmetic,
  extractReferenceFormulationProcedure,
  matchReferenceFormulationProducts,
  extractReferenceFormulationTargets,
  buildReferenceFormulationUnresolvedQueue,
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
    vi.mocked(listRecords).mockImplementation(async (collection) => collection === "reference_formulations" ? [source] as never : [corrupted] as never);
    await expect(listReferenceFormulationNormalizations(source.id)).rejects.toThrow(/match the immutable source match snapshot/);
  });
});
