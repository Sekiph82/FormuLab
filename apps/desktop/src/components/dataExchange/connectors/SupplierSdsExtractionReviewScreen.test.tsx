import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { listRecordsMock, readMock, openMock, extractMock, extractProductMock, appendClaimReviewMock } = vi.hoisted(() => ({ listRecordsMock: vi.fn(), readMock: vi.fn(), openMock: vi.fn(), extractMock: vi.fn(), extractProductMock: vi.fn(), appendClaimReviewMock: vi.fn() }));
vi.mock("@/lib/masterdata", () => ({ listRecords: listRecordsMock, readSupplierDocumentPdf: readMock, openSupplierDocumentPdf: openMock, appendSupplierProductClaimReview: appendClaimReviewMock }));
vi.mock("@/lib/supplierSdsReview", () => ({ extractSupplierSdsReview: extractMock }));
vi.mock("@/lib/supplierProductExtraction", () => ({ extractSupplierProductDocumentEvidence: extractProductMock }));
vi.mock("./SupplierSdsPdfPagePreview", () => ({
  SupplierSdsPdfPagePreview: ({ pageNumber, lineNumber }: { pageNumber: number; lineNumber: number }) => <div>PDF page {pageNumber} · cited line {lineNumber}</div>,
}));

import { SupplierSdsExtractionReviewScreen } from "./SupplierSdsExtractionReviewScreen";

const timestamp = "2026-10-27T08:00:00.000Z";
const acquisition = {
  schemaVersion: "1.0", code: "supplierdoc-sds-1", supplierId: "croda", providerId: "croda", surfaceId: "croda-public", documentType: "SDS", acquisitionMethod: "automated",
  sourceUrl: "https://supplier.example/cda38.pdf", sourceProduct: { supplierItemCode: "CDA-38", tradeName: "Crodateric CDA 38" }, market: "US", language: "en",
  originalFilename: "cda-38-sds.pdf", mimeType: "application/pdf", sha256: "a".repeat(64), byteSize: 4096, parserStatus: "completed", acquiredAt: timestamp, createdAt: timestamp,
};
const extraction = {
  schemaVersion: "1.0", code: "sds-evidence-1", acquisitionCode: "supplierdoc-sds-1", extractionStatus: "unreviewed", createdAt: timestamp,
  evidence: {
    schemaVersion: "1.0", id: "sds-evidence-1", commercialProductId: "commercial-product-1",
    section1: { sectionNumber: 1, sourceDocumentHash: "a".repeat(64), declaredChemicalName: { id: "name", rawValue: "Crodateric CDA 38", evidenceRefs: ["sds:page:p1:l4"] } },
    section3: { sectionNumber: 3, sourceDocumentHash: "a".repeat(64), components: [{ id: "component-1", componentName: { id: "component-name", rawValue: "Amine oxide", evidenceRefs: ["sds:page:p3:l2"] }, concentration: { id: "concentration", rawValue: "30-35%", evidenceRefs: ["sds:page:p3:l3"] }, disclosure: "disclosed" }] },
    reconciliations: [],
  },
};
const productClaim = {
  id: "product-claim-1", fieldCode: "product_identifier", sectionNumber: 1, subject: "product",
  rawValue: "Crodateric CDA 38", qualifier: "specified", basis: "unknown", context: {},
  extraction: { method: "explicit_label", parserVersion: "supplier-product-v1" },
  evidence: [{ documentHash: "a".repeat(64), pageNumber: 1, excerpt: "Crodateric CDA 38", source: "digital" }],
};
const productEvidence = [
  { recordType: "document", schemaVersion: "1.0", id: "product-evidence-1", acquisitionCode: "supplierdoc-sds-1", productCardId: "card-1", documentType: "SDS", documentHash: "a".repeat(64), parserVersion: "supplier-product-v1", claims: [productClaim], reviewStatus: "unreviewed", createdAt: timestamp },
  { recordType: "card_version", schemaVersion: "1.0", id: "card-version-1", productCardId: "card-1", version: 1, supplierName: "Croda", tradeName: "Crodateric CDA 38", market: "US", language: "en", identityStatus: "review_required", evidenceRecordIds: ["product-evidence-1"], claimIds: ["product-claim-1"], conflicts: [], createdAt: timestamp },
];
const reviewResult = {
  status: "extracted", extraction: { warnings: ["no_text_layer"] }, ocr: { warnings: [] },
  sections: { sections: [{ sectionNumber: 1 }, { sectionNumber: 9 }], unobservedSectionNumbers: [2, 3, 4, 5, 6, 7, 8], warnings: [] },
  section1: { candidates: [] }, section2: { candidates: [] }, section3: { declaration: null, components: [] }, section7: { candidates: [] }, section8: { candidates: [] },
  section9: { candidates: [{ field: "ph", rawValue: "5.0–5.5 at 25 °C", reviewRequired: true,
    measurementContext: { normalizedValue: { text: "5.0–5.5 at 25 °C", status: "range_normalized", lowerBound: 5, upperBound: 5.5 }, temperature: { value: 25, unit: "°C", originalText: "25 °C" }, deliveredFormBasis: "as_supplied", claimKind: "typical", evidenceKind: "unspecified" },
    evidence: [{ pageNumber: 9, lineNumber: 2, excerpt: "pH: 5.0–5.5 at 25 °C", source: "ocr", confidence: 0.91 }] }] },
  sections10To15: { candidates: [] },
};

describe("SupplierSdsExtractionReviewScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRecordsMock.mockImplementation((collection: string) => Promise.resolve(collection === "supplier_document_acquisitions" ? [acquisition] : collection === "supplier_product_evidence" ? productEvidence : collection === "supplier_sds_product_evidence" ? [extraction] : []));
    readMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    openMock.mockResolvedValue(undefined);
    extractMock.mockResolvedValue(reviewResult);
    extractProductMock.mockResolvedValue(productEvidence[0]);
    appendClaimReviewMock.mockResolvedValue({ recordType: "claim_review" });
  });

  it("shows persisted Sections 1/3 separately from local section candidates and opens cited source pages", async () => {
    const user = userEvent.setup();
    render(<SupplierSdsExtractionReviewScreen />);
    expect(await screen.findByRole("combobox")).toHaveValue("supplierdoc-sds-1");
    await user.click(screen.getByRole("button", { name: "Extract product facts" }));
    expect(await screen.findByText("Section 1 · Saved source facts")).toBeInTheDocument();
    expect(screen.getByText("Section 3 · Disclosed component evidence")).toBeInTheDocument();
    expect(screen.getByText("Section 3 is a hazard-disclosure list, not a complete commercial formula.")).toBeInTheDocument();
    expect(screen.getAllByText(/5\.0–5\.5 at 25 °C/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/5\.0–5\.5 at 25 °C · 5–5\.5/u).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "View source page 9, line 2" }));
    expect(await screen.findByText("PDF page 9 · cited line 2")).toBeInTheDocument();
    expect(openMock).not.toHaveBeenCalled();
    expect(readMock).toHaveBeenCalledWith("a".repeat(64));
  });

  it("shows extraction store failure without modifying records", async () => {
    readMock.mockRejectedValueOnce(new Error("supplier document exceeds the local review size limit"));
    const user = userEvent.setup();
    render(<SupplierSdsExtractionReviewScreen />);
    await user.click(await screen.findByRole("button", { name: "Extract product facts" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("supplier document exceeds the local review size limit");
  });

  it("records a field-level human acceptance against the exact persisted claim and page citation", async () => {
    const user = userEvent.setup();
    render(<SupplierSdsExtractionReviewScreen />);
    await user.click(await screen.findByRole("button", { name: "Accept claim" }));
    expect(appendClaimReviewMock).toHaveBeenCalledWith(expect.objectContaining({
      recordType: "claim_review",
      productCardId: "card-1",
      sourceEvidenceId: "product-evidence-1",
      claimId: "product-claim-1",
      claimSnapshot: productClaim,
      decision: "accepted",
      evidenceRefs: ["a".repeat(64) + ":p1"],
    }));
  });
});
