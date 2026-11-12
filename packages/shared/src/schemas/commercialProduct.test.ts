import { describe, expect, it } from "vitest";
import { commercialProductSchema } from "./commercialProduct";

const validProduct = {
  schemaVersion: "1.0" as const,
  id: "commercial-product-1",
  supplierId: "supplier-cht",
  tradeName: "Example Surfactant",
  productCode: "EX-38",
  grade: "38",
  aliases: [
    { value: "Example Surfactant EU", kind: "trade_name" as const, market: "EU", language: "en", sourceDocumentCode: "doc-sds-1" },
    { value: "EX38", kind: "product_code" as const, market: "TR", language: "tr" },
  ],
  market: "EU",
  language: "en",
  sourceDocumentCodes: ["doc-sds-1", "doc-tds-1"],
  sourceFormulationReferences: [{ sourceFormulationId: "formula-17", sourceDocumentCode: "doc-formula-1", sourceLabel: "Example formulation" }],
  lifecycleStatus: "active" as const,
  reviewStatus: "needs_review" as const,
  createdAt: "2026-10-26T08:00:00.000Z",
  updatedAt: "2026-10-26T09:00:00.000Z",
};

describe("commercialProductSchema", () => {
  it("preserves supplier identity, regional aliases and source references independently of chemistry", () => {
    const product = commercialProductSchema.parse(validProduct);
    expect(product.supplierId).toBe("supplier-cht");
    expect(product.aliases[1]).toMatchObject({ value: "EX38", market: "TR", language: "tr" });
    expect(product.sourceDocumentCodes).toEqual(["doc-sds-1", "doc-tds-1"]);
    expect(product.sourceFormulationReferences[0]?.sourceFormulationId).toBe("formula-17");
    expect(product.reviewStatus).toBe("needs_review");
    expect(product.lifecycleStatus).toBe("active");
    expect(product).not.toHaveProperty("canonicalChemicalId");
    expect(product).not.toHaveProperty("rawMaterial");
  });

  it("defaults lifecycle, review and reference collections without inventing an identity match", () => {
    const product = commercialProductSchema.parse({
      schemaVersion: "1.0",
      id: "product-minimal",
      supplierId: "supplier-1",
      tradeName: "Supplier grade X",
    });
    expect(product.lifecycleStatus).toBe("unknown");
    expect(product.reviewStatus).toBe("unreviewed");
    expect(product.aliases).toEqual([]);
    expect(product.sourceDocumentCodes).toEqual([]);
    expect(product.sourceFormulationReferences).toEqual([]);
  });

  it("rejects duplicate document references, reversed timestamps and undeclared chemistry fields", () => {
    expect(() => commercialProductSchema.parse({ ...validProduct, sourceDocumentCodes: ["doc-1", "doc-1"] })).toThrow(/unique/);
    expect(() => commercialProductSchema.parse({ ...validProduct, updatedAt: "2026-10-25T09:00:00.000Z" })).toThrow(/precede created time/);
    expect(() => commercialProductSchema.parse({ ...validProduct, canonicalChemicalId: "cas-123" })).toThrow();
  });

  it("requires a supplier and supplier-facing trade name", () => {
    expect(() => commercialProductSchema.parse({ ...validProduct, supplierId: " " })).toThrow();
    expect(() => commercialProductSchema.parse({ ...validProduct, tradeName: " " })).toThrow();
  });
});
