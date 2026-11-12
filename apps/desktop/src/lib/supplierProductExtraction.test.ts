import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./supplierPdfTextExtraction", () => ({ extractSupplierPdfText: vi.fn() }));
vi.mock("./supplierPdfOcr", () => ({ runConditionalSupplierPdfOcr: vi.fn() }));
vi.mock("./supplierSdsReview", () => ({ extractSupplierSdsReview: vi.fn() }));

import { extractSupplierProductDocumentEvidence } from "./supplierProductExtraction";
import { extractSupplierPdfText } from "./supplierPdfTextExtraction";
import { runConditionalSupplierPdfOcr } from "./supplierPdfOcr";

const hash = "a".repeat(64);
const acquisition = {
  code: "tds-acquisition-1",
  documentType: "TDS" as const,
  sha256: hash,
  originalFilename: "supplier-product-tds.pdf",
  mimeType: "application/pdf",
  sourceProduct: { tradeName: "Crodateric CDA 38", supplierItemCode: "CDA-38" },
};

describe("supplier TDS product identity extraction", () => {
  beforeEach(() => {
    vi.mocked(extractSupplierPdfText).mockResolvedValue({
      status: "extracted",
      documentHash: hash,
      parserVersion: "pdf-text-v1",
      pages: [{ pageNumber: 1, lines: [
        { lineNumber: 1, text: "Crodateric CDA 38", position: { x: 0.1, y: 0.1 } },
        { lineNumber: 2, text: "Active matter: 38%" },
      ] }],
    } as never);
    vi.mocked(runConditionalSupplierPdfOcr).mockResolvedValue({ parserVersion: "ocr-none", lines: [] } as never);
  });

  it("uses a page-one title only when it exactly matches the acquired trade name and cites the line", async () => {
    const evidence = await extractSupplierProductDocumentEvidence(acquisition as never, new Uint8Array([1]), "card-1");
    expect(evidence.claims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fieldCode: "product_identifier",
        rawValue: "Crodateric CDA 38",
        evidence: [expect.objectContaining({ documentHash: hash, pageNumber: 1, lineNumber: 1, excerpt: "Crodateric CDA 38" })],
      }),
      expect.objectContaining({ fieldCode: "active_matter", rawValue: "38%" }),
    ]));
  });

  it("does not infer product identity from a title that differs from the acquired trade name", async () => {
    vi.mocked(extractSupplierPdfText).mockResolvedValue({
      status: "extracted", documentHash: hash, parserVersion: "pdf-text-v1",
      pages: [{ pageNumber: 1, lines: [{ lineNumber: 1, text: "Supplier technical data sheet" }] }],
    } as never);
    const evidence = await extractSupplierProductDocumentEvidence(acquisition as never, new Uint8Array([1]), "card-1");
    expect(evidence.claims.some((claim) => claim.fieldCode === "product_identifier")).toBe(false);
  });

  it("extracts an explicitly labeled product name as a cited claim", async () => {
    vi.mocked(extractSupplierPdfText).mockResolvedValue({
      status: "extracted", documentHash: hash, parserVersion: "pdf-text-v1",
      pages: [{ pageNumber: 1, lines: [{ lineNumber: 1, text: "Product name: Crodateric CDA 38" }] }],
    } as never);
    const evidence = await extractSupplierProductDocumentEvidence(acquisition as never, new Uint8Array([1]), "card-1");
    expect(evidence.claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldCode: "product_identifier", rawValue: "Crodateric CDA 38" }),
    ]));
  });
});
