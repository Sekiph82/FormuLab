import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { listRecordsMock, readMock, openMock, extractMock } = vi.hoisted(() => ({ listRecordsMock: vi.fn(), readMock: vi.fn(), openMock: vi.fn(), extractMock: vi.fn() }));
vi.mock("@/lib/masterdata", () => ({ listRecords: listRecordsMock, readSupplierDocumentPdf: readMock, openSupplierDocumentPdf: openMock }));
vi.mock("@/lib/supplierSdsReview", () => ({ extractSupplierSdsReview: extractMock }));
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
const reviewResult = {
  status: "extracted", extraction: { warnings: ["no_text_layer"] }, ocr: { warnings: [] },
  sections: { sections: [{ sectionNumber: 1 }, { sectionNumber: 9 }], unobservedSectionNumbers: [2, 3, 4, 5, 6, 7, 8], warnings: [] },
  section2: { candidates: [] }, section7: { candidates: [] }, section8: { candidates: [] },
  section9: { candidates: [{ field: "ph", rawValue: "5.0–5.5 at 25 °C", reviewRequired: true,
    measurementContext: { normalizedValue: { text: "5.0–5.5 at 25 °C", status: "range_normalized", lowerBound: 5, upperBound: 5.5 }, temperature: { value: 25, unit: "°C", originalText: "25 °C" }, deliveredFormBasis: "as_supplied", claimKind: "typical", evidenceKind: "unspecified" },
    evidence: [{ pageNumber: 9, lineNumber: 2, excerpt: "pH: 5.0–5.5 at 25 °C", source: "ocr", confidence: 0.91 }] }] },
  sections10To15: { candidates: [] },
};

describe("SupplierSdsExtractionReviewScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRecordsMock.mockImplementation((collection: string) => Promise.resolve(collection === "supplier_document_acquisitions" ? [acquisition] : [extraction]));
    readMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    openMock.mockResolvedValue(undefined);
    extractMock.mockResolvedValue(reviewResult);
  });

  it("shows persisted Sections 1/3 separately from local section candidates and opens cited source pages", async () => {
    const user = userEvent.setup();
    render(<SupplierSdsExtractionReviewScreen />);
    expect(await screen.findByRole("combobox")).toHaveValue("supplierdoc-sds-1");
    await user.click(screen.getByRole("button", { name: "Extract locally" }));
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
    await user.click(await screen.findByRole("button", { name: "Extract locally" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("supplier document exceeds the local review size limit");
  });
});
