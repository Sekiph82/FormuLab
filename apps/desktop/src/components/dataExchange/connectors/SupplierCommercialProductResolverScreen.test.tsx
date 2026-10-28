import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { listRecordsMock, readMock, appendReviewMock } = vi.hoisted(() => ({ listRecordsMock: vi.fn(), readMock: vi.fn(), appendReviewMock: vi.fn() }));
vi.mock("@/lib/masterdata", () => ({ listRecords: listRecordsMock, readSupplierDocumentPdf: readMock, appendIdentityFieldReviewRecord: appendReviewMock }));
vi.mock("./SupplierSdsPdfPagePreview", () => ({
  SupplierSdsPdfPagePreview: ({ pageNumber, lineNumber }: { pageNumber: number; lineNumber: number }) => <div>PDF page {pageNumber} · cited line {lineNumber}</div>,
}));
vi.mock("../DataExchangeImportDialog", () => ({
  DataExchangeImportDialog: ({ initialFile, proposalLineage }: { initialFile: File; proposalLineage: { applicationProposalId: string; acceptedReviewId: string; sourceEvidenceId: string; sourceEvidenceRefs: string[] } }) => (
    <div role="dialog" aria-label="Data Exchange proposal preview" data-filename={initialFile.name} data-proposal={proposalLineage.applicationProposalId} data-review={proposalLineage.acceptedReviewId} data-evidence={proposalLineage.sourceEvidenceId} data-evidence-ref={proposalLineage.sourceEvidenceRefs[0]} />
  ),
}));

import { SupplierCommercialProductResolverScreen } from "./SupplierCommercialProductResolverScreen";
import type { RawMaterial } from "@formulab/shared";

const timestamp = "2026-10-27T08:00:00.000Z";
const acquisition = {
  schemaVersion: "1.0", code: "supplierdoc-sds-1", supplierId: "croda", providerId: "croda", surfaceId: "croda-public", documentType: "SDS", acquisitionMethod: "automated",
  sourceUrl: "https://supplier.example/cda38.pdf", sourceProduct: { supplierItemCode: "CDA-38", tradeName: "Crodateric CDA 38", grade: "38" }, market: "US", language: "en",
  originalFilename: "cda-38-sds.pdf", mimeType: "application/pdf", sha256: "a".repeat(64), byteSize: 4096, parserStatus: "completed", acquiredAt: timestamp, createdAt: timestamp,
};
const evidence = {
  schemaVersion: "1.0", code: "sds-evidence-1", acquisitionCode: "supplierdoc-sds-1", extractionStatus: "unreviewed", createdAt: timestamp,
  evidence: {
    schemaVersion: "1.0", id: "sds-evidence-1", commercialProductId: "commercial-product-1",
    section1: { sectionNumber: 1, sourceDocumentHash: "a".repeat(64), declaredChemicalName: { id: "name", rawValue: "Crodateric CDA 38", evidenceRefs: ["sds:page:p1:l4"] }, casNumber: { id: "section1-cas", rawValue: "1643-20-5", evidenceRefs: ["sds:page:p1:l8"] }, ecNumber: { id: "section1-ec", rawValue: "216-700-6", evidenceRefs: ["sds:page:p1:l9"] } },
    section3: {
      sectionNumber: 3, sourceDocumentHash: "a".repeat(64),
      substanceOrMixture: { id: "nature", rawValue: "Mixture", evidenceRefs: ["sds:page:p3:l1"] },
      components: [{ id: "component-1", componentName: { id: "component-name", rawValue: "Amine oxide", evidenceRefs: ["sds:page:p3:l2"] }, casNumber: { id: "cas", rawValue: "1643-20-5", evidenceRefs: ["sds:page:p3:l3"] }, concentration: { id: "concentration", rawValue: "30-35%", evidenceRefs: ["sds:page:p3:l4"] }, disclosure: "disclosed" }],
      undisclosedRemainder: { id: "remainder", rawValue: "Remaining percentage is proprietary", evidenceRefs: ["sds:page:p3:l5"] },
    },
    reconciliations: [],
  },
};
const material = { schemaVersion: "1.0", code: "RM-1", displayName: "Amine Oxide", casNumbers: [], ecNumbers: [], functions: [], activeMatterState: "missing", documents: [], regulatoryStatuses: [], hazardClassifications: [], allergens: [], incompatibilities: [], substituteCodes: [], active: true, createdAt: timestamp, updatedAt: timestamp } as RawMaterial;
const screenProps = { actorUserId: "reviewer-1", actorRole: "raw_material" as const };

describe("SupplierCommercialProductResolverScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRecordsMock.mockImplementation((collection: string) => Promise.resolve(collection === "supplier_document_acquisitions" ? [acquisition] : collection === "supplier_sds_product_evidence" ? [evidence] : collection === "materials" ? [material] : []));
    readMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    appendReviewMock.mockImplementation(async (review) => ({ ...review, reviewedBy: "reviewer-1", reviewerRole: "raw_material", reviewedAt: timestamp }));
  });

  it("shows supplier identity, cited type/components, unresolved disclosure and honest catalog availability", async () => {
    const user = userEvent.setup();
    render(<SupplierCommercialProductResolverScreen {...screenProps} />);
    expect(await screen.findByText("Crodateric CDA 38")).toBeInTheDocument();
    expect(screen.getByText("commercial-product-1")).toBeInTheDocument();
    expect(screen.getByText("PARTIALLY_DISCLOSED")).toBeInTheDocument();
    expect(screen.getByText("Amine oxide")).toBeInTheDocument();
    expect(screen.getAllByText("1643-20-5")).toHaveLength(2);
    expect(screen.getByText("Remaining percentage is proprietary")).toBeInTheDocument();
    expect(screen.getAllByText(/no persisted canonical-chemical catalogue/u)).toHaveLength(1);
    await user.click(screen.getAllByRole("button", { name: "View source page 3, line 2" })[0]!);
    expect(await screen.findByText("PDF page 3 · cited line 2")).toBeInTheDocument();
    expect(readMock).toHaveBeenCalledWith("a".repeat(64));
    expect(listRecordsMock).toHaveBeenCalledTimes(5);
    expect(listRecordsMock.mock.calls.map(([collection]) => collection)).toEqual(["supplier_document_acquisitions", "supplier_sds_product_evidence", "supplier_product_evidence", "materials", "identity_field_reviews"]);
  });

  it("keeps missing SDS evidence unresolved and distinguishes a load failure", async () => {
    listRecordsMock.mockImplementation((collection: string) => Promise.resolve(collection === "supplier_document_acquisitions" ? [acquisition] : []));
    const view = render(<SupplierCommercialProductResolverScreen {...screenProps} />);
    expect(await screen.findByText(/No saved Section 1\/3 evidence/u)).toBeInTheDocument();
    view.unmount();
    listRecordsMock.mockRejectedValueOnce(new Error("store unavailable"));
    render(<SupplierCommercialProductResolverScreen {...screenProps} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Product records could not be loaded.");
  });

  it("hides classifications and citations when the linked evidence hash differs from the selected PDF", async () => {
    listRecordsMock.mockImplementation((collection: string) => Promise.resolve(collection === "supplier_document_acquisitions" ? [acquisition] : collection === "supplier_sds_product_evidence" ? [{
      ...evidence,
      evidence: {
        ...evidence.evidence,
        section1: { ...evidence.evidence.section1, sourceDocumentHash: "b".repeat(64) },
        section3: { ...evidence.evidence.section3, sourceDocumentHash: "b".repeat(64) },
      },
    }] : collection === "materials" ? [material] : []));
    render(<SupplierCommercialProductResolverScreen {...screenProps} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("source hash does not match this PDF");
    expect(screen.queryByText("PARTIALLY_DISCLOSED")).not.toBeInTheDocument();
    expect(screen.queryByText("Amine oxide")).not.toBeInTheDocument();
    expect(screen.queryByText(/No saved Section 1\/3 evidence/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View source page/u })).not.toBeInTheDocument();
    expect(readMock).not.toHaveBeenCalled();
  });

  it("discards a delayed PDF read after the selected document changes", async () => {
    const secondDocument = {
      ...acquisition,
      code: "supplierdoc-sds-2",
      sourceProduct: { supplierItemCode: "OTHER", tradeName: "Other product", grade: "A" },
      sha256: "c".repeat(64),
    };
    listRecordsMock.mockImplementation((collection: string) => Promise.resolve(collection === "supplier_document_acquisitions" ? [acquisition, secondDocument] : collection === "supplier_sds_product_evidence" ? [evidence] : collection === "materials" ? [material] : []));
    let resolvePdf!: (bytes: Uint8Array) => void;
    readMock.mockImplementationOnce(() => new Promise<Uint8Array>((resolve) => { resolvePdf = resolve; }));
    const user = userEvent.setup();
    render(<SupplierCommercialProductResolverScreen {...screenProps} />);
    await screen.findByText("Crodateric CDA 38");
    await user.click(screen.getAllByRole("button", { name: "View source page 3, line 2" })[0]!);
    expect(readMock).toHaveBeenCalledWith("a".repeat(64));
    await user.selectOptions(screen.getByRole("combobox", { name: "Acquired SDS" }), "supplierdoc-sds-2");
    resolvePdf(new Uint8Array([9, 9, 9]));
    await waitFor(() => expect(screen.queryByText("PDF page 3 · cited line 2")).not.toBeInTheDocument());
    expect(screen.getByText("Other product")).toBeInTheDocument();
  });

  it("compares Section 1 identifiers to a selected RawMaterial and records an explicit field decision", async () => {
    const user = userEvent.setup();
    render(<SupplierCommercialProductResolverScreen {...screenProps} />);
    expect(await screen.findByText("SDS Section 1 CAS")).toBeInTheDocument();
    expect(screen.getAllByText("No value recorded")).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "Review and accept this field" })[0]!);
    await waitFor(() => expect(appendReviewMock).toHaveBeenCalledTimes(1));
    expect(appendReviewMock.mock.calls[0]![0]).toMatchObject({
      commercialProductId: "commercial-product-1",
      sourceEvidenceId: "sds-evidence-1",
      targetRecordId: "RM-1",
      field: "canonical_identity",
      decision: "accepted",
      proposedValueSnapshot: JSON.stringify({ casNumbers: ["1643-20-5"] }),
      evidenceRefs: ["sds:page:p1:l8"],
    });
    expect(await screen.findByText("Accepted; proposal ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download proposal CSV for Data Exchange" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review and apply in Data Exchange" }));
    const proposalDialog = await screen.findByRole("dialog", { name: "Data Exchange proposal preview" });
    expect(proposalDialog).toHaveAttribute("data-proposal", expect.stringMatching(/^raw-material-application:identity-review:/u));
    expect(proposalDialog).toHaveAttribute("data-evidence", "sds-evidence-1");
    expect(proposalDialog).toHaveAttribute("data-evidence-ref", "sds:page:p1:l8");
    expect(screen.getByText(/This screen does not write RawMaterial/u)).toBeInTheDocument();
  });

  it("compares persisted product-card claims with exact product and disclosed-component candidates without writing RawMaterial", async () => {
    const tdsAcquisition = { ...acquisition, code: "supplierdoc-tds-1", documentType: "TDS", originalFilename: "cda-38-tds.pdf", sha256: "b".repeat(64) };
    const sdsProductEvidence = {
      recordType: "document", schemaVersion: "1.0", id: "product-evidence-1", acquisitionCode: "supplierdoc-sds-1",
      productCardId: "supplier-product-cda38", documentType: "SDS", documentHash: "a".repeat(64), parserVersion: "sds-parser-v1",
      claims: [
        { id: "claim-product-cas", fieldCode: "product_cas", sectionNumber: 1, subject: "product", rawValue: "1643-20-5", extraction: { method: "explicit_label", parserVersion: "sds-parser-v1" }, evidence: [{ documentHash: "a".repeat(64), pageNumber: 1, lineNumber: 8, excerpt: "CAS 1643-20-5", source: "digital" }] },
        { id: "claim-component-cas", fieldCode: "disclosed_component_cas", sectionNumber: 3, subject: "disclosed_component", rawValue: "1643-20-5", extraction: { method: "explicit_label", parserVersion: "sds-parser-v1" }, evidence: [{ documentHash: "a".repeat(64), pageNumber: 3, lineNumber: 2, excerpt: "Component CAS 1643-20-5", source: "digital" }] },
      ], reviewStatus: "unreviewed", createdAt: timestamp,
    };
    const tdsProductEvidence = {
      recordType: "document", schemaVersion: "1.0", id: "product-evidence-2", acquisitionCode: "supplierdoc-tds-1",
      productCardId: "supplier-product-cda38", documentType: "TDS", documentHash: "b".repeat(64), parserVersion: "tds-parser-v1",
      claims: [{ id: "claim-active", fieldCode: "active_matter", subject: "product", rawValue: "30-35% as supplied", originalUnit: "%", basis: "as_supplied", qualifier: "range", extraction: { method: "explicit_label", parserVersion: "tds-parser-v1" }, evidence: [{ documentHash: "b".repeat(64), pageNumber: 5, lineNumber: 4, excerpt: "Active matter 30-35% as supplied", source: "digital" }] }],
      reviewStatus: "unreviewed", createdAt: timestamp,
    };
    const cardVersion = {
      recordType: "card_version", schemaVersion: "1.0", id: "product-card-version-1", productCardId: "supplier-product-cda38", version: 1,
      supplierId: "croda", supplierName: "Croda", supplierItemCode: "CDA-38", tradeName: "Crodateric CDA 38", grade: "38", market: "US", language: "en",
      identityStatus: "provisional", evidenceRecordIds: ["product-evidence-1", "product-evidence-2"], claimIds: ["claim-product-cas", "claim-component-cas", "claim-active"], conflicts: [], createdAt: timestamp,
    };
    const matchingMaterial = { ...material, casNumbers: ["1643-20-5"], activeMatterPercent: "32" } as RawMaterial;
    listRecordsMock.mockImplementation((collection: string) => Promise.resolve(
      collection === "supplier_document_acquisitions" ? [acquisition, tdsAcquisition]
        : collection === "supplier_sds_product_evidence" ? [evidence]
          : collection === "supplier_product_evidence" ? [sdsProductEvidence, tdsProductEvidence, cardVersion]
            : collection === "materials" ? [matchingMaterial] : [],
    ));
    const user = userEvent.setup();
    render(<SupplierCommercialProductResolverScreen {...screenProps} />);
    expect(await screen.findByText("Supplier product card and RawMaterial comparison")).toBeInTheDocument();
    expect(screen.getByText("Exact Section 1 CAS")).toBeInTheDocument();
    expect(screen.getByText(/Exact Section 3 CAS · disclosed component only/u)).toBeInTheDocument();
    expect(screen.getByText("30-35% as supplied · range · as_supplied")).toBeInTheDocument();
    expect(screen.getByText("32")).toBeInTheDocument();
    expect(screen.getByText(/No RawMaterial is created, changed, approved or verified here/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View source page 5, line 4" }));
    expect(await screen.findByText("PDF page 5 · cited line 4")).toBeInTheDocument();
    expect(readMock).toHaveBeenCalledWith("b".repeat(64));
    expect(appendReviewMock).not.toHaveBeenCalled();
  });
});
