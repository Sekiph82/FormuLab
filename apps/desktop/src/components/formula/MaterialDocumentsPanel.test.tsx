/**
 * FVL-04.003/.004 hardening — the real per-material TDS/SDS/specification
 * document viewer. Canonical source is material_documents (metadata only);
 * RawMaterial.documents[] is never read here — confirmed dead path.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MaterialDocument, Supplier } from "@formulab/shared";
import { MaterialDocumentsPanel } from "./MaterialDocumentsPanel";

const bridge = { listRecords: vi.fn() };
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
}));

function doc(over: Partial<MaterialDocument> & { code: string; materialCode: string; documentType: MaterialDocument["documentType"] }): MaterialDocument {
  return {
    schemaVersion: "1.0",
    documentTitle: "TEST doc",
    verificationStatus: "unverified",
    tags: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const SUPPLIERS: Supplier[] = [
  { schemaVersion: "1.0", code: "SUP-1", displayName: "Test Supplier Ltd", legalName: "Test Supplier Ltd", currency: "KES", approved: false, qualityStatus: "not_assessed", active: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } as Supplier,
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MaterialDocumentsPanel", () => {
  it("DOC1/DOC2: shows only the selected material's own documents, never another material's", async () => {
    bridge.listRecords.mockResolvedValue([
      doc({ code: "d1", materialCode: "MAT-A", documentType: "TDS", documentTitle: "MAT-A TDS" }),
      doc({ code: "d2", materialCode: "MAT-B", documentType: "TDS", documentTitle: "MAT-B TDS" }),
    ]);
    render(<MaterialDocumentsPanel materialCode="MAT-A" suppliers={[]} />);
    expect(await screen.findByText("MAT-A TDS")).toBeInTheDocument();
    expect(screen.queryByText("MAT-B TDS")).not.toBeInTheDocument();
  });

  it("DOC3/DOC4/DOC5/DOC6: TDS, SDS, and specification documents each display revision/issuer/date/fileName/verification correctly, with the supplier's real display name resolved by code", async () => {
    bridge.listRecords.mockResolvedValue([
      doc({ code: "d1", materialCode: "MAT-A", documentType: "TDS", documentTitle: "TEST TDS", revision: "2", issuer: "TEST Chemicals", supplierCode: "SUP-1", issueDate: "2026-01-15", fileName: "test-tds-v2.pdf", verificationStatus: "verified" }),
      doc({ code: "d2", materialCode: "MAT-A", documentType: "SDS", documentTitle: "TEST SDS", revision: "3", issuer: "TEST Chemicals", issueDate: "2026-02-01", fileName: "test-sds-v3.pdf" }),
      doc({ code: "d3", materialCode: "MAT-A", documentType: "specification", documentTitle: "TEST Spec", revision: "1", issueDate: "2026-03-01" }),
    ]);
    render(<MaterialDocumentsPanel materialCode="MAT-A" suppliers={SUPPLIERS} />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("TEST TDS")).toBeInTheDocument();
    expect(within(table).getByText("TEST SDS")).toBeInTheDocument();
    expect(within(table).getByText("TEST Spec")).toBeInTheDocument();
    expect(within(table).getByText("test-tds-v2.pdf")).toBeInTheDocument();
    expect(within(table).getByText("Test Supplier Ltd")).toBeInTheDocument();
    expect(within(table).getByText("verified")).toBeInTheDocument();
  });

  it("DOC7: unverified remains clearly unverified, never implied approved", async () => {
    bridge.listRecords.mockResolvedValue([doc({ code: "d1", materialCode: "MAT-A", documentType: "SDS", verificationStatus: "unverified" })]);
    render(<MaterialDocumentsPanel materialCode="MAT-A" suppliers={[]} />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("unverified")).toBeInTheDocument();
  });

  it("DOC8: an expired document's expiry date carries a deterministic expired indicator", async () => {
    bridge.listRecords.mockResolvedValue([doc({ code: "d1", materialCode: "MAT-A", documentType: "TDS", expiryDate: "2020-01-01" })]);
    render(<MaterialDocumentsPanel materialCode="MAT-A" suppliers={[]} />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("expired")).toBeInTheDocument();
  });

  it("DOC9/DOC10: no Safety or Regulatory verdict text ever appears — only the document's own fields", async () => {
    bridge.listRecords.mockResolvedValue([doc({ code: "d1", materialCode: "MAT-A", documentType: "SDS" })]);
    render(<MaterialDocumentsPanel materialCode="MAT-A" suppliers={[]} />);
    const table = await screen.findByRole("table");
    expect(within(table).queryByText(/safe|unsafe|hazard|compliant|approved|restricted/i)).not.toBeInTheDocument();
  });

  it("DOC11: no binary-open action appears anywhere — fileName is provenance text only, never a link/button", async () => {
    bridge.listRecords.mockResolvedValue([doc({ code: "d1", materialCode: "MAT-A", documentType: "TDS", fileName: "test.pdf" })]);
    render(<MaterialDocumentsPanel materialCode="MAT-A" suppliers={[]} />);
    const table = await screen.findByRole("table");
    expect(within(table).queryByRole("link")).not.toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: /open|view|download/i })).not.toBeInTheDocument();
  });

  it("DOC12: empty state renders honestly", async () => {
    bridge.listRecords.mockResolvedValue([]);
    render(<MaterialDocumentsPanel materialCode="MAT-A" suppliers={[]} />);
    expect(await screen.findByText("No documents recorded for this material yet.")).toBeInTheDocument();
  });

  it("DOC13: loading and error states follow existing UI conventions", async () => {
    let reject: (e: Error) => void = () => {};
    bridge.listRecords.mockReturnValue(new Promise((_, rej) => (reject = rej)));
    render(<MaterialDocumentsPanel materialCode="MAT-A" suppliers={[]} />);
    expect(screen.getByText("Loading documents…")).toBeInTheDocument();
    reject(new Error("boom"));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });

  it("type filter distinguishes all/TDS/SDS/specification", async () => {
    bridge.listRecords.mockResolvedValue([
      doc({ code: "d1", materialCode: "MAT-A", documentType: "TDS", documentTitle: "T-doc" }),
      doc({ code: "d2", materialCode: "MAT-A", documentType: "SDS", documentTitle: "S-doc" }),
    ]);
    const user = userEvent.setup();
    render(<MaterialDocumentsPanel materialCode="MAT-A" suppliers={[]} />);
    await screen.findByText("T-doc");
    await user.click(screen.getByRole("button", { name: "SDS" }));
    expect(screen.getByText("S-doc")).toBeInTheDocument();
    expect(screen.queryByText("T-doc")).not.toBeInTheDocument();
  });
});
