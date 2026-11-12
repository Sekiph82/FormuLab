import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { store, listRecordsMock } = vi.hoisted(() => ({
  store: new Map<string, Record<string, unknown>[]>(),
  listRecordsMock: vi.fn(),
}));
vi.mock("@/lib/masterdata", () => ({
  listRecords: (collection: string) => listRecordsMock(collection),
  upsertRecords: (collection: string, records: Record<string, unknown>[]) => {
    const existing = store.get(collection) ?? [];
    const next = [...existing];
    for (const row of records) {
      const id = (row.id ?? row.code) as string;
      const index = next.findIndex((item) => (item.id ?? item.code) === id);
      if (index >= 0) next[index] = row;
      else next.push(row);
    }
    store.set(collection, next);
    return Promise.resolve({ inserted: 0, updated: records.length, total: next.length });
  },
  nowIso: () => "2026-10-27T08:00:00.000Z",
}));

import { SupplierAcquisitionJobsScreen } from "./SupplierAcquisitionJobsScreen";

const timestamp = "2026-10-27T07:00:00.000Z";
const job = {
  schemaVersion: "1.0", id: "acq-job-1", supplierId: "croda", providerId: "croda", surfaceId: "croda-public-product-search-manual",
  requestedBy: "chemist-1", status: "downloading", totalItems: 4, acquiredItems: 1, failedItems: 1,
  createdAt: timestamp, updatedAt: timestamp,
  checkpoint: { strategy: "page_number", sequence: 3, pageNumber: 3, checkpointedAt: timestamp },
};

const items = [
  { schemaVersion: "1.0", id: "product-1", jobId: "acq-job-1", idempotencyKey: `sha256:${"a".repeat(64)}`, kind: "catalog_product", status: "downloading", sourceProductId: "p1", attemptCount: 1, createdAt: timestamp, updatedAt: timestamp },
  { schemaVersion: "1.0", id: "doc-1", jobId: "acq-job-1", idempotencyKey: `sha256:${"b".repeat(64)}`, kind: "supplier_document", status: "acquired", sourceProductId: "p1", documentType: "SDS", acquisitionCode: "receipt-1", attemptCount: 1, createdAt: timestamp, updatedAt: timestamp },
  { schemaVersion: "1.0", id: "doc-2", jobId: "acq-job-1", idempotencyKey: `sha256:${"c".repeat(64)}`, kind: "supplier_document", status: "failed_item", sourceProductTradeName: "Example surfactant", sourceProductGrade: "A", documentType: "TDS", failureCode: "timeout", attemptCount: 2, createdAt: timestamp, updatedAt: timestamp },
  { schemaVersion: "1.0", id: "doc-3", jobId: "acq-job-1", idempotencyKey: `sha256:${"d".repeat(64)}`, kind: "supplier_document", status: "skipped", supplierItemCode: "CDA-38", documentType: "SDS", attemptCount: 1, createdAt: timestamp, updatedAt: timestamp },
];

describe("SupplierAcquisitionJobsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    listRecordsMock.mockImplementation((collection: string) => Promise.resolve(store.get(collection) ?? []));
    store.set("supplier_acquisition_jobs", [job]);
    store.set("supplier_acquisition_job_items", items);
  });

  it("shows saved page/product/document progress and retries a failed item through the existing state transition", async () => {
    const user = userEvent.setup();
    render(<SupplierAcquisitionJobsScreen />);

    expect(await screen.findByText("Last completed page 3")).toBeInTheDocument();
    expect(screen.getByText("1 / 1", { selector: "span" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").find((row) => row.textContent?.includes("Example surfactant"))).toBeInTheDocument();
    expect(screen.getByText("Documents found").parentElement).toHaveTextContent("3");
    expect(screen.getByText("Documents acquired").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Documents skipped").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Documents failed").parentElement).toHaveTextContent("1");

    await user.click(screen.getByRole("button", { name: "Retry item" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Example surfactant was marked for retry");
    await waitFor(() => {
      const row = screen.getAllByRole("listitem").find((candidate) => candidate.textContent?.includes("Marked for resume"));
      expect(row).toHaveTextContent("Attempts 3");
    });
    expect(screen.getByText("Items started: 3 / 4")).toBeInTheDocument();
  });

  it("reports a job-store load failure instead of presenting an empty queue", async () => {
    listRecordsMock.mockRejectedValueOnce(new Error("local store unavailable"));
    render(<SupplierAcquisitionJobsScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load supplier acquisition jobs or items");
    expect(screen.queryByText("No supplier acquisition jobs have been recorded.")).not.toBeInTheDocument();
  });
});
