import { describe, expect, it } from "vitest";
import type { CommercialProduct } from "../schemas/commercialProduct";
import { referenceFormulationSourceSchema } from "../schemas/referenceFormulationSource";
import { supplierDocumentAcquisitionSchema } from "../schemas/supplierDocument";
import { referenceFormulationIngredientLineSchema } from "./referenceFormulationIngredientExtraction";
import { matchReferenceFormulationProducts } from "./referenceFormulationProductMatching";
import { buildReferenceFormulationUnresolvedQueue } from "./referenceFormulationUnresolvedQueue";

const HASH = "d".repeat(64);
const source = () => referenceFormulationSourceSchema.parse({
  schemaVersion: "1.0", id: "formula-source-queue", supplierId: "supplier-croda", providerId: "croda-public", surfaceId: "formulation-library",
  sourceProduct: { tradeName: "Example formulation" }, acquisitionCode: "supplierdoc-formula-queue", sourcePdfSha256: HASH,
  acquisitionMethod: "manual_assisted", sourceFileSelection: { selectionId: "selection-queue", originalFilename: "formula.pdf", sourceFileSha256: HASH, selectedAt: "2026-10-26T08:00:00.000Z", selectedBy: "owner-1" },
  originalFilename: "formula.pdf", sourceByteSize: 2048, acquiredAt: "2026-10-26T08:00:00.000Z", title: "Example formula", market: "EU", language: "en",
  parserVersion: "formulab-reference-formulation-layout-v1", rights: { status: "unknown", redistribution: "unknown", evidenceRefs: [] }, createdAt: "2026-10-26T08:01:00.000Z",
});
const product = (overrides: Partial<CommercialProduct> & Pick<CommercialProduct, "id" | "tradeName">): CommercialProduct => ({
  schemaVersion: "1.0", supplierId: "supplier-croda", aliases: [], sourceDocumentCodes: [], sourceFormulationReferences: [],
  lifecycleStatus: "active", reviewStatus: "unreviewed", ...overrides,
});
const line = (id: string, tradeName: string, amount = "4.5") => referenceFormulationIngredientLineSchema.parse({
  id, sourceDocumentHash: HASH, orderIndex: 1, pageNumber: 2, tableBlockIndex: 3, rowIndex: 1,
  rawRow: [tradeName, amount, "% w/w"],
  ingredientName: { rawValue: tradeName, evidence: { sourceDocumentHash: HASH, pageNumber: 2, blockIndex: 3, rowIndex: 1, cellIndex: 0, headerRowIndex: 0, header: "Ingredient", excerpt: tradeName, source: "digital" } },
  amount: { rawValue: amount, evidence: { sourceDocumentHash: HASH, pageNumber: 2, blockIndex: 3, rowIndex: 1, cellIndex: 1, headerRowIndex: 0, header: "Amount", excerpt: amount, source: "digital" } },
  unit: { rawValue: "% w/w", evidence: { sourceDocumentHash: HASH, pageNumber: 2, blockIndex: 3, rowIndex: 1, cellIndex: 2, headerRowIndex: 0, header: "Unit", excerpt: "% w/w", source: "digital" } },
  quantitySemantics: "explicit_amount", reviewRequired: true,
});
const sds = (code: string) => supplierDocumentAcquisitionSchema.parse({
  schemaVersion: "1.0", code, supplierId: "supplier-croda", providerId: "croda-public", surfaceId: "sds-library", documentType: "SDS",
  acquisitionMethod: "manual_assisted", sourceFileSelection: { selectionId: code + "-selection", originalFilename: "sds.pdf", sourceFileSha256: "e".repeat(64), selectedAt: "2026-10-26T09:00:00.000Z", selectedBy: "owner-1" },
  sourceProduct: { tradeName: "Known product" }, market: "EU", language: "en", originalFilename: "sds.pdf", mimeType: "application/pdf",
  sha256: "e".repeat(64), byteSize: 4096, parserStatus: "not_started", acquiredAt: "2026-10-26T09:00:00.000Z", createdAt: "2026-10-26T09:00:00.000Z",
});

describe("reference formulation unresolved ingredient queue", () => {
  it("preserves unmatched formula lines and prepares identity/document acquisition work", () => {
    const formulaSource = source();
    const sourceLines = [line("line-unknown", "Unlisted surfactant", "7.25")];
    const products: CommercialProduct[] = [];
    const matching = matchReferenceFormulationProducts({ source: formulaSource, lines: sourceLines, products });
    const queue = buildReferenceFormulationUnresolvedQueue({ source: formulaSource, lines: sourceLines, matching, products });

    expect(queue.sourceLines).toEqual(sourceLines);
    expect(queue.entries).toHaveLength(1);
    expect(queue.entries[0]).toMatchObject({
      status: "ready_for_acquisition",
      reasons: ["product_identity_unmatched", "supporting_sds_missing"],
      requestedDocumentKinds: ["SDS", "TDS"],
      nextActions: ["identify_supplier_product", "acquire_supplier_documents"],
      ingredientLine: { id: "line-unknown", rawRow: ["Unlisted surfactant", "7.25", "% w/w"], amount: { rawValue: "7.25" } },
      reviewRequired: true,
    });
  });

  it("keeps exact candidates review-only until a linked supporting SDS exists", () => {
    const formulaSource = source();
    const sourceLines = [line("line-known", "Known product")];
    const products = [product({ id: "product-known", tradeName: "Known product", sourceDocumentCodes: ["sds-known"] })];
    const matching = matchReferenceFormulationProducts({ source: formulaSource, lines: sourceLines, products });
    const withoutSds = buildReferenceFormulationUnresolvedQueue({ source: formulaSource, lines: sourceLines, matching, products });
    expect(withoutSds.entries[0]).toMatchObject({ status: "ready_for_acquisition", candidateCommercialProductIds: ["product-known"], reasons: expect.arrayContaining(["supporting_sds_missing"]) });

    const withSds = buildReferenceFormulationUnresolvedQueue({ source: formulaSource, lines: sourceLines, matching, products, supplierDocuments: [sds("sds-known")] });
    expect(withSds.entries[0]).toMatchObject({
      status: "ready_for_review",
      reasons: ["product_match_requires_human_review"],
      supportingSdsDocumentCodes: ["sds-known"],
      nextActions: ["review_product_candidates"],
      reviewRequired: true,
    });
  });

  it("retains ambiguous and fuzzy lines in review and acquisition queues", () => {
    const formulaSource = source();
    const sourceLines = [line("line-fuzzy", "Known productx")];
    const products = [product({ id: "product-known", tradeName: "Known product" })];
    const matching = matchReferenceFormulationProducts({ source: formulaSource, lines: sourceLines, products });
    const queue = buildReferenceFormulationUnresolvedQueue({ source: formulaSource, lines: sourceLines, matching, products });
    expect(queue.entries[0]).toMatchObject({
      status: "ready_for_acquisition",
      reasons: ["fuzzy_match_requires_review", "supporting_sds_missing"],
      nextActions: ["review_product_candidates", "acquire_supplier_documents"],
      candidateCommercialProductIds: ["product-known"],
    });
    expect(queue.entries[0]?.ingredientLine).toEqual(sourceLines[0]);
  });

  it("rejects incomplete or cross-source matching results", () => {
    const formulaSource = source();
    const sourceLines = [line("line-a", "Unknown A"), line("line-b", "Unknown B")];
    const products: CommercialProduct[] = [];
    const matching = matchReferenceFormulationProducts({ source: formulaSource, lines: sourceLines, products });
    expect(() => buildReferenceFormulationUnresolvedQueue({ source: formulaSource, lines: sourceLines, products, matching: { ...matching, lines: matching.lines.slice(0, 1) } })).toThrow(/exactly one status/);
    expect(() => buildReferenceFormulationUnresolvedQueue({ source: formulaSource, lines: sourceLines, products, matching: { ...matching, sourceId: "other-source" } })).toThrow(/same immutable formulation source/);

    const lineWithForeignFieldEvidence = {
      ...sourceLines[0]!,
      ingredientName: {
        ...sourceLines[0]!.ingredientName!,
        evidence: { ...sourceLines[0]!.ingredientName!.evidence, sourceDocumentHash: "c".repeat(64) },
      },
    };
    expect(() => buildReferenceFormulationUnresolvedQueue({
      source: formulaSource, lines: [lineWithForeignFieldEvidence, sourceLines[1]!], products, matching,
    })).toThrow(/queue evidence.*different immutable source PDF/);
  });
});
