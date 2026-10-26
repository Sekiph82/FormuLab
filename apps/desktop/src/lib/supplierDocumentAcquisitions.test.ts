import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsertRecordsMock, nowIsoMock } = vi.hoisted(() => ({
  upsertRecordsMock: vi.fn(),
  nowIsoMock: vi.fn(() => "2026-10-26T08:00:00.000Z"),
}));

vi.mock("./masterdata", () => ({
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

  it("rejects unsafe source URLs before persistence", async () => {
    await expect(recordSupplierDocumentAcquisition({
      ...acquisition,
      sourceUrl: "https://user:password@docs.example.com/sds/123",
    })).rejects.toThrow(/not safe to persist/);
    expect(upsertRecordsMock).not.toHaveBeenCalled();
  });
});
