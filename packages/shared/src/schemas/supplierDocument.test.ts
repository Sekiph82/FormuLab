import { describe, expect, it } from "vitest";
import { safeSupplierDocumentSourceUrl, supplierDocumentAcquisitionSchema } from "./supplierDocument";

const validRecord = {
  schemaVersion: "1.0" as const,
  code: "supplierdoc-1",
  supplierId: "supplier-example",
  providerId: "example-adapter",
  surfaceId: "public-documents",
  documentType: "SDS" as const,
  sourceUrl: "https://docs.example.com/sds/123?token=%5Bredacted%5D",
  sourceProduct: { supplierItemCode: "ABC-123" },
  market: "EU",
  language: "en",
  originalFilename: "sds-123.pdf",
  mimeType: "application/pdf" as const,
  sha256: "a".repeat(64),
  byteSize: 1024,
  parserStatus: "not_started" as const,
  acquiredAt: "2026-10-26T08:00:00.000Z",
  createdAt: "2026-10-26T08:00:00.000Z",
};

describe("supplierDocumentAcquisitionSchema — immutable source receipt", () => {
  it("accepts traceable metadata while keeping parser state and chemistry separate", () => {
    const parsed = supplierDocumentAcquisitionSchema.parse(validRecord);
    expect(parsed.documentType).toBe("SDS");
    expect(parsed.sourceProduct.supplierItemCode).toBe("ABC-123");
    expect(parsed.sha256).toBe("a".repeat(64));
    expect(parsed).not.toHaveProperty("rawMaterial");
    expect(parsed).not.toHaveProperty("extractedFields");
  });

  it("rejects source URLs whose query values were not redacted", () => {
    expect(() => supplierDocumentAcquisitionSchema.parse({ ...validRecord, sourceUrl: "https://docs.example.com/sds?token=private" })).toThrow();
  });

  it("requires a source product identity and a safe basename", () => {
    expect(() => supplierDocumentAcquisitionSchema.parse({ ...validRecord, sourceProduct: {} })).toThrow(/supplier product identifier/);
    expect(() => supplierDocumentAcquisitionSchema.parse({ ...validRecord, originalFilename: "../../secrets.pdf" })).toThrow(/safe basename/);
  });

  it("accepts source revision lineage and rejects self-supersession", () => {
    const parsed = supplierDocumentAcquisitionSchema.parse({
      ...validRecord,
      sourceRevision: "Rev. 2",
      revisionDate: "2026-09-30",
      supersedesCode: "supplierdoc-prior",
    });
    expect(parsed.sourceRevision).toBe("Rev. 2");
    expect(parsed.supersedesCode).toBe("supplierdoc-prior");
    expect(() => supplierDocumentAcquisitionSchema.parse({
      ...validRecord,
      supersedesCode: validRecord.code,
    })).toThrow(/cannot supersede itself/);
  });

  it("redacts all query values and rejects credentials or fragments in persisted URLs", () => {
    expect(safeSupplierDocumentSourceUrl("https://docs.example.com/item?id=123&token=secret"))
      .toBe("https://docs.example.com/item?id=%5Bredacted%5D&token=%5Bredacted%5D");
    expect(() => safeSupplierDocumentSourceUrl("https://user:password@docs.example.com/item")).toThrow();
    expect(() => safeSupplierDocumentSourceUrl("https://docs.example.com/item#secret")).toThrow();
  });
});
