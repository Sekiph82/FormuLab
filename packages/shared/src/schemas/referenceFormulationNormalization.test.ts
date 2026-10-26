import { describe, expect, it } from "vitest";
import type { ReferenceFormulationRecord } from "./referenceFormulationRecord";
import {
  createReferenceFormulationNormalizationVersion,
  referenceFormulationNormalizationVersionSchema,
} from "./referenceFormulationNormalization";

const sourceRecord = () => ({
  id: "croda-formula-1",
  sourceDocumentHash: "a".repeat(64),
  ingredientLines: [
    { id: "line-1", ingredientName: { rawValue: "Original Croda trade name" }, amount: { rawValue: "4.5" }, function: { rawValue: "Supplier wording", evidence: { sourceDocumentHash: "a".repeat(64), pageNumber: 1, blockIndex: 2, rowIndex: 3, cellIndex: 4 } } },
    { id: "line-2", ingredientName: { rawValue: "Unknown blend" }, amount: { rawValue: "q.s." } },
  ],
  productMatches: [
    { ingredientLineId: "line-1", candidates: [{ commercialProductId: "cp-1" }] },
    { ingredientLineId: "line-2", candidates: [] },
  ],
}) as unknown as ReferenceFormulationRecord;

describe("referenceFormulationNormalizationVersionSchema", () => {
  it("keeps normalized links separate from the original lines and never marks candidates as accepted", () => {
    const source = sourceRecord();
    const original = structuredClone(source.ingredientLines);
    const normalized = createReferenceFormulationNormalizationVersion({
      id: "normalization-v1",
      source,
      version: 1,
      canonicalChemicalCandidates: { "line-1": ["chemical-1"] },
      createdAt: "2026-10-26T10:00:00.000Z",
    });

    expect(normalized.lines).toEqual([
      {
        sourceLineId: "line-1",
        commercialProduct: { status: "proposed", candidateIds: ["cp-1"] },
        canonicalChemistry: { status: "proposed", candidateIds: ["chemical-1"] },
        functionNormalization: { supplierFunction: { status: "stated", originalValue: "Supplier wording", evidenceRefs: [`formula:${"a".repeat(64)}:1:2:3:4`] }, canonicalFunction: { status: "unresolved", candidateIds: [] }, reviewRequired: true },
        componentContributions: [],
      },
      {
        sourceLineId: "line-2",
        commercialProduct: { status: "unresolved", candidateIds: [] },
        canonicalChemistry: { status: "unresolved", candidateIds: [] },
        functionNormalization: { supplierFunction: { status: "not_stated", evidenceRefs: [] }, canonicalFunction: { status: "unresolved", candidateIds: [] }, reviewRequired: true },
        componentContributions: [],
      },
    ]);
    expect(JSON.stringify(source.ingredientLines)).toBe(JSON.stringify(original));
    expect(JSON.stringify(normalized)).not.toContain("Original Croda trade name");
    expect(normalized.lines[0]?.functionNormalization?.supplierFunction.originalValue).toBe("Supplier wording");
    expect(normalized.lines[0]?.functionNormalization?.canonicalFunction.candidateIds).toEqual([]);
  });

  it("requires every later normalization version to link its predecessor", () => {
    const source = sourceRecord();
    const v1 = createReferenceFormulationNormalizationVersion({
      id: "normalization-v1", source, version: 1, createdAt: "2026-10-26T10:00:00.000Z",
    });
    const v2 = createReferenceFormulationNormalizationVersion({
      id: "normalization-v2", source, version: 2, supersedesNormalizationId: v1.id,
      canonicalChemicalCandidates: { "line-1": ["chemical-1", "chemical-2"] },
      createdAt: "2026-10-26T11:00:00.000Z",
    });
    expect(v2.supersedesNormalizationId).toBe(v1.id);
    expect(v2.lines[0]?.canonicalChemistry.status).toBe("ambiguous");
    expect(() => referenceFormulationNormalizationVersionSchema.parse({ ...v2, supersedesNormalizationId: undefined })).toThrow(/later versions must name/);
  });

  it("rejects duplicate source lines and candidates for unknown lines", () => {
    const source = sourceRecord();
    expect(() => createReferenceFormulationNormalizationVersion({
      id: "normalization-v1", source, version: 1,
      canonicalChemicalCandidates: { "not-a-source-line": ["chemical-1"] },
      createdAt: "2026-10-26T10:00:00.000Z",
    })).toThrow(/unknown source line/);

    const record = createReferenceFormulationNormalizationVersion({
      id: "normalization-v1", source, version: 1, createdAt: "2026-10-26T10:00:00.000Z",
    });
    expect(() => referenceFormulationNormalizationVersionSchema.parse({ ...record, lines: [record.lines[0], record.lines[0]] })).toThrow(/only once/);
  });

  it("keeps canonical function candidates separate, source-backed, and review-required", () => {
    const source = sourceRecord();
    const normalized = createReferenceFormulationNormalizationVersion({
      id: "normalization-v1", source, version: 1,
      canonicalFunctionCandidates: { "line-1": ["nonionic_surfactant"] },
      createdAt: "2026-10-26T10:00:00.000Z",
    });
    const functionNormalization = normalized.lines[0]!.functionNormalization!;
    expect(functionNormalization).toMatchObject({
      supplierFunction: { status: "stated", originalValue: "Supplier wording", evidenceRefs: [`formula:${"a".repeat(64)}:1:2:3:4`] },
      canonicalFunction: { status: "proposed", candidateIds: ["nonionic_surfactant"] },
      reviewRequired: true,
    });
    expect(() => createReferenceFormulationNormalizationVersion({
      id: "normalization-v1", source, version: 1,
      canonicalFunctionCandidates: { "line-2": ["nonionic_surfactant"] },
      createdAt: "2026-10-26T10:00:00.000Z",
    })).toThrow(/require explicit supplier-function evidence/);
  });

  it("keeps legacy immutable normalization lines readable without function snapshots", () => {
    const source = sourceRecord();
    const current = createReferenceFormulationNormalizationVersion({
      id: "normalization-v1", source, version: 1, createdAt: "2026-10-26T10:00:00.000Z",
    });
    const legacy = {
      ...current,
      lines: current.lines.map(({ functionNormalization: _functionNormalization, ...line }) => line),
    };
    expect(referenceFormulationNormalizationVersionSchema.parse(legacy).lines[0]).not.toHaveProperty("functionNormalization");
  });
});
