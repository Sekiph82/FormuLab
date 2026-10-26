import { beforeEach, describe, expect, it, vi } from "vitest";

const { listRecordsMock, upsertRecordsMock, nowIsoMock } = vi.hoisted(() => ({
  listRecordsMock: vi.fn(),
  upsertRecordsMock: vi.fn(),
  nowIsoMock: vi.fn(() => "2026-10-26T08:00:00.000Z"),
}));

vi.mock("./masterdata", () => ({
  listRecords: listRecordsMock,
  nowIso: nowIsoMock,
  upsertRecords: upsertRecordsMock,
}));

import { recordSupplierDocumentAcquisition } from "./supplierDocumentAcquisitions";

const acquisition = {
  supplierId: "supplier-example",
  providerId: "example-adapter",
  surfaceId: "public-documents",
  documentType: "SDS" as const,
  sourceUrl: "https://docs.example.com/sds/123?product=ABC&token=private",
  sourceProduct: { supplierItemCode: "ABC-123", tradeName: "Example Product", grade: "70" },
  market: "EU",
  language: "en",
  originalFilename: "sds-123.pdf",
  mimeType: "application/pdf" as const,
  sha256: "A".repeat(64),
  byteSize: 1024,
  parserStatus: "not_started" as const,
};

describe("supplier document acquisition persistence — V01-01.006", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRecordsMock.mockResolvedValue([]);
  });

  it("appends source evidence with redacted URL values and immutable acquisition timestamps", async () => {
    const result = await recordSupplierDocumentAcquisition(acquisition);

    expect(result.code).toMatch(/^supplierdoc-/);
    expect(result.sha256).toBe("a".repeat(64));
    expect(result.acquiredAt).toBe("2026-10-26T08:00:00.000Z");
    expect(result.sourceUrl).toContain("product=%5Bredacted%5D");
    expect(result.sourceUrl).toContain("token=%5Bredacted%5D");
    expect(result.sourceUrl).not.toContain("private");
    expect(upsertRecordsMock).toHaveBeenCalledWith("supplier_document_acquisitions", [result]);
    expect(result).not.toHaveProperty("materialCode");
    expect(result).not.toHaveProperty("extractedFields");
  });

  it("returns the existing immutable receipt on an exact retry without appending an audit row", async () => {
    const first = await recordSupplierDocumentAcquisition(acquisition);
    listRecordsMock.mockResolvedValue([first]);

    const retry = await recordSupplierDocumentAcquisition(acquisition);

    expect(retry).toEqual(first);
    expect(upsertRecordsMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unsafe source URLs before persistence", async () => {
    await expect(recordSupplierDocumentAcquisition({
      ...acquisition,
      sourceUrl: "https://user:password@docs.example.com/sds/123",
    })).rejects.toThrow(/not safe to persist/);
    expect(upsertRecordsMock).not.toHaveBeenCalled();
  });

  it("links a later dated document to the unique latest prior revision", async () => {
    listRecordsMock.mockResolvedValue([{
      ...acquisition,
      schemaVersion: "1.0",
      code: "supplierdoc-prior",
      sha256: "a".repeat(64),
      revisionDate: "2024-03-10",
      acquiredAt: "2024-03-11T00:00:00.000Z",
      createdAt: "2024-03-11T00:00:00.000Z",
    }]);

    const result = await recordSupplierDocumentAcquisition({
      ...acquisition,
      sha256: "b".repeat(64),
      revisionDate: "2025-04-12",
    });

    expect(result.supersedesCode).toBe("supplierdoc-prior");
    expect(upsertRecordsMock).toHaveBeenCalledWith("supplier_document_acquisitions", [result]);
  });

  it("uses only strictly ordered numeric supplier revision labels when dates are unavailable", async () => {
    listRecordsMock.mockResolvedValue([{
      ...acquisition,
      schemaVersion: "1.0",
      code: "supplierdoc-revision-1",
      sha256: "a".repeat(64),
      sourceRevision: "Revision 1.2",
      acquiredAt: "2024-03-11T00:00:00.000Z",
      createdAt: "2024-03-11T00:00:00.000Z",
    }]);

    const result = await recordSupplierDocumentAcquisition({
      ...acquisition,
      sha256: "b".repeat(64),
      sourceRevision: "Rev 2",
    });

    expect(result.supersedesCode).toBe("supplierdoc-revision-1");
  });

  it("keeps identical bytes as separate provenance without calling them a revision", async () => {
    listRecordsMock.mockResolvedValue([{
      ...acquisition,
      schemaVersion: "1.0",
      code: "supplierdoc-same-bytes",
      sourceUrl: "https://docs.example.com/sds/previous-source",
      sha256: "a".repeat(64),
      revisionDate: "2024-03-10",
      acquiredAt: "2024-03-11T00:00:00.000Z",
      createdAt: "2024-03-11T00:00:00.000Z",
    }]);

    const result = await recordSupplierDocumentAcquisition({
      ...acquisition,
      sourceUrl: "https://docs.example.com/sds/alternate-source",
      revisionDate: "2025-04-12",
    });

    expect(result.sha256).toBe("a".repeat(64));
    expect(result.code).not.toBe("supplierdoc-same-bytes");
    expect(result.supersedesCode).toBeUndefined();
  });

  it("leaves ambiguous same-date predecessors unlinked for deliberate review", async () => {
    const prior = {
      ...acquisition,
      schemaVersion: "1.0",
      sha256: "a".repeat(64),
      revisionDate: "2024-03-10",
      acquiredAt: "2024-03-11T00:00:00.000Z",
      createdAt: "2024-03-11T00:00:00.000Z",
    };
    listRecordsMock.mockResolvedValue([
      { ...prior, code: "supplierdoc-prior-a" },
      { ...prior, code: "supplierdoc-prior-b", sha256: "b".repeat(64) },
    ]);

    const result = await recordSupplierDocumentAcquisition({
      ...acquisition,
      sha256: "c".repeat(64),
      revisionDate: "2025-04-12",
    });

    expect(result.supersedesCode).toBeUndefined();
  });

  it("does not compare revision dates with publication dates as if they were the same field", async () => {
    listRecordsMock.mockResolvedValue([{
      ...acquisition,
      schemaVersion: "1.0",
      code: "supplierdoc-publication-only",
      sha256: "a".repeat(64),
      publicationDate: "2024-03-10",
      acquiredAt: "2024-03-11T00:00:00.000Z",
      createdAt: "2024-03-11T00:00:00.000Z",
    }]);

    const result = await recordSupplierDocumentAcquisition({
      ...acquisition,
      sha256: "b".repeat(64),
      revisionDate: "2025-04-12",
    });

    expect(result.supersedesCode).toBeUndefined();
  });

  it("rejects an explicit link to a different product family", async () => {
    listRecordsMock.mockResolvedValue([{
      ...acquisition,
      schemaVersion: "1.0",
      code: "supplierdoc-other-product",
      sourceProduct: { supplierItemCode: "OTHER-9" },
      sha256: "a".repeat(64),
      acquiredAt: "2024-03-11T00:00:00.000Z",
      createdAt: "2024-03-11T00:00:00.000Z",
    }]);

    await expect(recordSupplierDocumentAcquisition({
      ...acquisition,
      sha256: "b".repeat(64),
      supersedesCode: "supplierdoc-other-product",
    })).rejects.toThrow(/same product\/document family/);
    expect(upsertRecordsMock).not.toHaveBeenCalled();
  });
});
