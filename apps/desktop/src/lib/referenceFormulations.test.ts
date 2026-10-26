import { beforeEach, describe, expect, it, vi } from "vitest";

const { listRecordsMock, upsertRecordsMock } = vi.hoisted(() => ({
  listRecordsMock: vi.fn(),
  upsertRecordsMock: vi.fn(),
}));

vi.mock("./masterdata", () => ({
  listRecords: listRecordsMock,
  upsertRecords: upsertRecordsMock,
}));

import {
  REFERENCE_FORMULATION_ARITHMETIC_VERSION,
  REFERENCE_FORMULATION_IDENTITY_PARSER_VERSION,
  REFERENCE_FORMULATION_INGREDIENT_PARSER_VERSION,
  REFERENCE_FORMULATION_PROCEDURE_PARSER_VERSION,
  REFERENCE_FORMULATION_PRODUCT_MATCHER_VERSION,
  REFERENCE_FORMULATION_TARGET_PARSER_VERSION,
  REFERENCE_FORMULATION_UNRESOLVED_QUEUE_VERSION,
  referenceFormulationRecordSchema,
} from "@formulab/shared";
import { recordReferenceFormulation } from "./referenceFormulations";

const record = () => referenceFormulationRecordSchema.parse({
  schemaVersion: "1.0", recordKind: "supplier_reference_formula", id: "reference-formula-1", code: "reference-formula-1",
  source: {
    schemaVersion: "1.0", id: "reference-source-1", supplierId: "supplier-1", providerId: "provider-1", surfaceId: "surface-1",
    sourceProduct: { tradeName: "Example formulation" }, acquisitionCode: "supplierdoc-formula-1", sourcePdfSha256: "a".repeat(64),
    acquisitionMethod: "manual_assisted",
    sourceFileSelection: { selectionId: "selection-1", originalFilename: "formula.pdf", sourceFileSha256: "a".repeat(64), selectedAt: "2026-10-26T08:00:00.000Z", selectedBy: "owner-1" },
    originalFilename: "formula.pdf", sourceByteSize: 2048, acquiredAt: "2026-10-26T08:00:00.000Z", title: "Example formula", market: "EU", language: "en",
    parserVersion: "formulab-reference-formulation-layout-v1", rights: { status: "unknown", redistribution: "unknown", evidenceRefs: [] }, createdAt: "2026-10-26T08:01:00.000Z",
  },
  sourceDocumentHash: "a".repeat(64),
  parserVersions: {
    identity: REFERENCE_FORMULATION_IDENTITY_PARSER_VERSION,
    ingredients: REFERENCE_FORMULATION_INGREDIENT_PARSER_VERSION,
    arithmetic: REFERENCE_FORMULATION_ARITHMETIC_VERSION,
    procedure: REFERENCE_FORMULATION_PROCEDURE_PARSER_VERSION,
    targets: REFERENCE_FORMULATION_TARGET_PARSER_VERSION,
    productMatcher: REFERENCE_FORMULATION_PRODUCT_MATCHER_VERSION,
    unresolvedQueue: REFERENCE_FORMULATION_UNRESOLVED_QUEUE_VERSION,
  },
  identityCandidates: [], identityMetadataComparisons: [], identityWarnings: ["no_identity_candidates"], ingredientLines: [],
  arithmetic: {
    sourceId: "reference-source-1", acquisitionCode: "supplierdoc-formula-1", sourceDocumentHash: "a".repeat(64),
    parserVersion: REFERENCE_FORMULATION_ARITHMETIC_VERSION, arithmeticStatus: "no_ingredient_rows", lineCount: 0,
    duplicateLineGroups: [], warnings: ["no_ingredient_rows"], reviewRequired: true,
  },
  procedureSteps: [], procedureWarnings: ["procedure_section_not_detected", "no_procedure_steps"],
  targetCandidates: [], targetWarnings: ["no_target_result_section", "no_target_result_candidates"],
  productMatches: [], productMatchWarnings: [], unresolvedEntries: [], reviewStatus: "unreviewed", createdAt: "2026-10-26T08:02:00.000Z",
});

describe("reference formulation immutable persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRecordsMock.mockResolvedValue([]);
  });

  it("appends records only to the separate append-only reference collection", async () => {
    const input = record();
    const saved = await recordReferenceFormulation(input);
    expect(saved).toEqual(input);
    expect(upsertRecordsMock).toHaveBeenCalledWith("reference_formulations", [input]);
  });

  it("returns an identical existing snapshot on retry and rejects edits under an existing code", async () => {
    const input = record();
    listRecordsMock.mockResolvedValue([input]);
    expect(await recordReferenceFormulation(input)).toEqual(input);
    expect(upsertRecordsMock).not.toHaveBeenCalled();

    await expect(recordReferenceFormulation({ ...input, createdAt: "2026-10-26T08:03:00.000Z" })).rejects.toThrow(/immutable/);
    expect(upsertRecordsMock).not.toHaveBeenCalled();
  });
});
