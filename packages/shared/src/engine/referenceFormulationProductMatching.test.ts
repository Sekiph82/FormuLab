import { describe, expect, it } from "vitest";
import type { CommercialProduct } from "../schemas/commercialProduct";
import { referenceFormulationSourceSchema } from "../schemas/referenceFormulationSource";
import { referenceFormulationIngredientLineSchema } from "./referenceFormulationIngredientExtraction";
import { crosswalkCode } from "./crosswalk";
import { matchReferenceFormulationProducts } from "./referenceFormulationProductMatching";

const HASH = "b".repeat(64);
const source = () => referenceFormulationSourceSchema.parse({
  schemaVersion: "1.0", id: "formula-source-matching", supplierId: "supplier-croda", providerId: "croda-public", surfaceId: "formulation-library",
  sourceProduct: { tradeName: "Example formulation" }, acquisitionCode: "supplierdoc-formula-match", sourcePdfSha256: HASH,
  acquisitionMethod: "manual_assisted", sourceFileSelection: { selectionId: "selection-match", originalFilename: "formula.pdf", sourceFileSha256: HASH, selectedAt: "2026-10-26T08:00:00.000Z", selectedBy: "owner-1" },
  originalFilename: "formula.pdf", sourceByteSize: 2048, acquiredAt: "2026-10-26T08:00:00.000Z", title: "Example formula", market: "EU", language: "en",
  parserVersion: "formulab-reference-formulation-layout-v1", rights: { status: "unknown", redistribution: "unknown", evidenceRefs: [] }, createdAt: "2026-10-26T08:01:00.000Z",
});
const product = (overrides: Partial<CommercialProduct> & Pick<CommercialProduct, "id" | "tradeName">): CommercialProduct => ({
  schemaVersion: "1.0", supplierId: "supplier-croda", aliases: [], sourceDocumentCodes: [], sourceFormulationReferences: [],
  lifecycleStatus: "active", reviewStatus: "unreviewed", ...overrides,
});
const line = (id: string, tradeName?: string, productCode?: string, hash = HASH) => referenceFormulationIngredientLineSchema.parse({
  id, sourceDocumentHash: hash, orderIndex: 1, pageNumber: 1, tableBlockIndex: 2, rowIndex: 1,
  rawRow: [tradeName ?? "", productCode ?? ""],
  ...(tradeName ? { ingredientName: { rawValue: tradeName, evidence: { sourceDocumentHash: hash, pageNumber: 1, blockIndex: 2, rowIndex: 1, cellIndex: 0, headerRowIndex: 0, header: "Ingredient", excerpt: tradeName, source: "digital" } } } : {}),
  ...(productCode ? { supplierProductCode: { rawValue: productCode, evidence: { sourceDocumentHash: hash, pageNumber: 1, blockIndex: 2, rowIndex: 1, cellIndex: 1, headerRowIndex: 0, header: "Product Code", excerpt: productCode, source: "digital" } } } : {}),
  quantitySemantics: "not_stated", reviewRequired: true,
});

describe("reference formulation commercial-product matching", () => {
  it("prioritizes exact supplier product code and trade-name matches without linking automatically", () => {
    const exact = product({ id: "exact-product", tradeName: "Incromine Oxide C", productCode: "INC-01", sourceDocumentCodes: ["sds-1"] });
    const otherSupplier = product({ id: "other-supplier-product", supplierId: "supplier-evonik", tradeName: "Incromine Oxide C", productCode: "INC-01" });
    const result = matchReferenceFormulationProducts({ source: source(), lines: [line("line-1", "Incromine Oxide C", "INC-01")], products: [exact, otherSupplier] });
    expect(result.lines[0]).toMatchObject({
      resolution: "exact_match_candidate", autoLinked: false, reviewRequired: true,
      candidates: [{ commercialProductId: "exact-product", tier: "exact", matchedOn: ["product_code", "trade_name"], sourceDocumentCodes: ["sds-1"] }],
    });
    expect(result.warnings).toContain("supplier_products_excluded");
  });

  it("uses supplier-scoped controlled aliases before fuzzy matching", () => {
    const aliasProduct = product({ id: "alias-product", tradeName: "ECO Brij L6L", aliases: [{ value: "Brij L6L", kind: "trade_name", sourceDocumentCode: "tds-1" }] });
    const aliasResult = matchReferenceFormulationProducts({ source: source(), lines: [line("line-alias", "Brij L6L")], products: [aliasProduct] });
    expect(aliasResult.lines[0]).toMatchObject({
      resolution: "alias_match_candidate", autoLinked: false,
      candidates: [{ commercialProductId: "alias-product", tier: "controlled_alias", sourceDocumentCodes: ["tds-1"] }],
    });

    const fuzzyProduct = product({ id: "fuzzy-product", tradeName: "Incromine Oxide C" });
    const fuzzyResult = matchReferenceFormulationProducts({ source: source(), lines: [line("line-fuzzy", "Incromine Oxyd C")], products: [fuzzyProduct] });
    expect(fuzzyResult.lines[0]).toMatchObject({ resolution: "fuzzy_proposal", autoLinked: false, reviewRequired: true, candidates: [{ tier: "fuzzy_proposal", similarity: expect.any(Number) }] });
    expect(fuzzyResult.warnings).toContain("fuzzy_matches_are_proposals_only");

    const fuzzyAliasProduct = product({ id: "fuzzy-alias-product", tradeName: "Brij L6L", aliases: [{ value: "ECO Brij L6L", kind: "trade_name", sourceDocumentCode: "tds-fuzzy-alias" }] });
    const fuzzyAlias = matchReferenceFormulationProducts({ source: source(), lines: [line("line-fuzzy-alias", "ECO Brij L6LX")], products: [fuzzyAliasProduct] });
    expect(fuzzyAlias.lines[0]).toMatchObject({
      resolution: "fuzzy_proposal",
      candidates: [{ commercialProductId: "fuzzy-alias-product", matchedOn: ["alias"], sourceDocumentCodes: ["tds-fuzzy-alias"] }],
    });
  });

  it("reports conflicting exact candidates as ambiguous and leaves unsupported lines unmatched", () => {
    const result = matchReferenceFormulationProducts({
      source: source(),
      lines: [line("line-conflict", "Name A", "CODE-A"), line("line-unmatched", "Unlisted Raw Material")],
      products: [product({ id: "code-match", tradeName: "Name X", productCode: "CODE-A" }), product({ id: "name-match", tradeName: "Name A", productCode: "CODE-B" })],
    });
    expect(result.lines.map((item) => item.resolution)).toEqual(["ambiguous", "unmatched"]);
    expect(result.lines[0]?.candidates).toHaveLength(2);
    expect(result.warnings).toEqual(expect.arrayContaining(["ambiguous_product_candidates", "unmatched_ingredient_lines"]));
    expect(result.lines.every((item) => item.autoLinked === false && item.reviewRequired)).toBe(true);
  });

  it("reuses only an exact FVL-04 supplier product crosswalk and keeps its candidate review-only", () => {
    const mapping = {
      schemaVersion: "1.0" as const,
      code: crosswalkCode("croda-public", "supplier_products", "CRODA-42", "CommercialProduct"),
      sourceSystemId: "croda-public",
      sourceEntity: "supplier_products",
      sourceRecordId: "CRODA-42",
      canonicalEntity: "CommercialProduct",
      canonicalRecordId: "mapped-product",
      firstSeenAt: "2026-10-26T08:00:00.000Z",
      lastSeenAt: "2026-10-26T08:00:00.000Z",
      status: "active" as const,
    };
    const mappedProduct = product({ id: "mapped-product", tradeName: "Different display name", productCode: "OTHER-CODE" });
    const result = matchReferenceFormulationProducts({
      source: source(),
      lines: [line("line-crosswalk", "Unmatched display wording", "CRODA-42")],
      products: [mappedProduct],
      crosswalks: [mapping],
    });
    expect(result.lines[0]).toMatchObject({
      resolution: "external_id_crosswalk_candidate",
      autoLinked: false,
      reviewRequired: true,
      candidates: [{
        commercialProductId: "mapped-product",
        tier: "external_id_crosswalk",
        externalIdCrosswalkCode: mapping.code,
      }],
    });

    const wrongProvider = matchReferenceFormulationProducts({
      source: source(), lines: [line("line-provider", undefined, "CRODA-42")], products: [mappedProduct],
      crosswalks: [{ ...mapping, sourceSystemId: "other-provider", code: crosswalkCode("other-provider", "supplier_products", "CRODA-42", "CommercialProduct") }],
    });
    expect(wrongProvider.lines[0]?.resolution).toBe("unmatched");

    const forgedTuple = matchReferenceFormulationProducts({
      source: source(), lines: [line("line-forged", undefined, "CRODA-42")], products: [mappedProduct],
      crosswalks: [{ ...mapping, sourceSystemId: "other-provider" }],
    });
    expect(forgedTuple.lines[0]?.resolution).toBe("unmatched");

    const wrongSupplier = matchReferenceFormulationProducts({
      source: source(), lines: [line("line-supplier", undefined, "CRODA-42")],
      products: [product({ id: "mapped-product", supplierId: "supplier-evonik", tradeName: "Mapped" })], crosswalks: [mapping],
    });
    expect(wrongSupplier.lines[0]?.resolution).toBe("unmatched");
  });

  it("rejects ingredient evidence linked to another source PDF", () => {
    expect(() => matchReferenceFormulationProducts({
      source: source(), lines: [line("foreign-line", "Any Name", undefined, "c".repeat(64))], products: [],
    })).toThrow(/different immutable source PDF/);

    const mismatchedFieldEvidence = line("foreign-field-evidence", "Any Name");
    expect(() => matchReferenceFormulationProducts({
      source: source(),
      lines: [{
        ...mismatchedFieldEvidence,
        ingredientName: {
          ...mismatchedFieldEvidence.ingredientName!,
          evidence: { ...mismatchedFieldEvidence.ingredientName!.evidence, sourceDocumentHash: "c".repeat(64) },
        },
      }],
      products: [product({ id: "foreign-evidence-product", tradeName: "Any Name" })],
    })).toThrow(/matching evidence.*different immutable source PDF/);
  });
});
