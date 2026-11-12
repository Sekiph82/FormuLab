import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { listRecordsMock, openMock } = vi.hoisted(() => ({ listRecordsMock: vi.fn(), openMock: vi.fn() }));
vi.mock("@/lib/masterdata", () => ({ listRecords: listRecordsMock, openSupplierDocumentPdf: openMock }));

import { SupplierAcquiredDocumentsScreen } from "./SupplierAcquiredDocumentsScreen";

const document = {
  schemaVersion: "1.0", code: "supplierdoc-current", supplierId: "croda", providerId: "croda", surfaceId: "croda-public",
  documentType: "SDS", acquisitionMethod: "automated", sourceUrl: "https://supplier.example/sds/123",
  sourceProduct: { supplierItemCode: "CDA-38", tradeName: "Crodateric CDA 38", grade: "38" }, market: "US", language: "en",
  sourceRevision: "3", revisionDate: "2026-09-01", supersedesCode: "supplierdoc-previous", originalFilename: "cda-38-sds.pdf",
  mimeType: "application/pdf", sha256: "a".repeat(64), byteSize: 4096, parserStatus: "completed",
  acquiredAt: "2026-10-26T08:00:00.000Z", createdAt: "2026-10-26T08:00:00.000Z",
};
const previous = { ...document, code: "supplierdoc-previous", sourceRevision: "2", revisionDate: "2025-01-01", supersedesCode: undefined, sha256: "b".repeat(64), acquiredAt: "2025-01-01T08:00:00.000Z", createdAt: "2025-01-01T08:00:00.000Z" };
const evidence = {
  schemaVersion: "1.0", code: "sds-evidence-1", acquisitionCode: "supplierdoc-current", extractionStatus: "unreviewed", createdAt: "2026-10-26T08:00:00.000Z",
  evidence: {
    schemaVersion: "1.0", id: "sds-evidence-1", commercialProductId: "commercial-product-1",
    section1: { sectionNumber: 1, sourceDocumentHash: "a".repeat(64), declaredChemicalName: { id: "name", rawValue: "Crodateric CDA 38", evidenceRefs: ["page:1"] } },
    section3: { sectionNumber: 3, sourceDocumentHash: "a".repeat(64), substanceOrMixture: { id: "nature", rawValue: "Mixture", evidenceRefs: ["page:3"] }, components: [] },
    reconciliations: [],
  },
};

describe("SupplierAcquiredDocumentsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRecordsMock.mockImplementation((collection: string) => Promise.resolve(collection === "supplier_document_acquisitions" ? [previous, document] : collection === "supplier_sds_product_evidence" ? [evidence] : []));
    openMock.mockResolvedValue(undefined);
  });

  it("shows source identity, immutable hash, provider, source URL, revision lineage and parser state", async () => {
    render(<SupplierAcquiredDocumentsScreen />);
    expect((await screen.findAllByText("Crodateric CDA 38 · SDS · 38")).length).toBe(2);
    expect(screen.getAllByText("croda · croda · croda-public · US / en")).toHaveLength(2);
    expect(screen.getByText("a".repeat(64))).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "https://supplier.example/sds/123" })).toHaveLength(2);
    expect(screen.getByText("supplierdoc-previous · 2")).toBeInTheDocument();
    expect(screen.getByText("Extraction record: unreviewed")).toBeInTheDocument();
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
  });

  it("opens only by the stored source hash and distinguishes store errors from an empty collection", async () => {
    const user = userEvent.setup();
    const view = render(<SupplierAcquiredDocumentsScreen />);
    await user.click((await screen.findAllByRole("button", { name: "Open PDF" }))[0]);
    expect(openMock).toHaveBeenCalledWith("a".repeat(64));
    openMock.mockRejectedValueOnce(new Error("blob missing"));
    await user.click(screen.getAllByRole("button", { name: "Open PDF" })[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not open document supplierdoc-current");
    view.unmount();
    listRecordsMock.mockRejectedValueOnce(new Error("store unavailable"));
    render(<SupplierAcquiredDocumentsScreen />);
    expect(await screen.findAllByRole("alert")).toHaveLength(1);
  });
});
