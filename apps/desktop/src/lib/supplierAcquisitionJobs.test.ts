import { beforeEach, describe, expect, it, vi } from "vitest";

const { data, listRecordsMock, upsertRecordsMock, nowIsoMock } = vi.hoisted(() => ({
  data: {
    supplier_acquisition_jobs: [] as unknown[],
    supplier_acquisition_job_items: [] as unknown[],
  },
  listRecordsMock: vi.fn(),
  upsertRecordsMock: vi.fn(),
  nowIsoMock: vi.fn(() => "2026-10-26T08:00:00.000Z"),
}));

vi.mock("./masterdata", () => ({
  listRecords: listRecordsMock,
  nowIso: nowIsoMock,
  upsertRecords: upsertRecordsMock,
}));

import { supplierAcquisitionJobItemSchema, supplierAcquisitionJobSchema } from "@formulab/shared";
import {
  createOrGetSupplierAcquisitionJobItem,
  resumeSupplierAcquisitionJob,
  resumeSupplierAcquisitionJobItem,
  saveSupplierAcquisitionCheckpoint,
} from "./supplierAcquisitionJobs";

const timestamp = "2026-10-26T08:00:00.000Z";
const job = supplierAcquisitionJobSchema.parse({
  schemaVersion: "1.0",
  id: "job-1",
  supplierId: "supplier-1",
  providerId: "provider-1",
  surfaceId: "public-documents",
  requestedBy: "chemist-1",
  status: "downloading",
  totalItems: 1,
  acquiredItems: 0,
  failedItems: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
});

describe("supplier acquisition checkpoint and idempotency persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    data.supplier_acquisition_jobs = [job];
    data.supplier_acquisition_job_items = [];
    listRecordsMock.mockImplementation((collection: keyof typeof data) => Promise.resolve(data[collection]));
    upsertRecordsMock.mockImplementation((collection: keyof typeof data, records: unknown[]) => {
      const first = records[0] as { id: string };
      const current = data[collection] as { id: string }[];
      data[collection] = [...current.filter((row) => row.id !== first.id), first];
      return Promise.resolve({ inserted: 1, updated: 0, total: 1 });
    });
  });

  it("reuses the stable item row when a page is replayed after interruption", async () => {
    const input = {
      kind: "supplier_document" as const,
      supplierItemCode: "ABC-123",
      documentType: "SDS" as const,
    };
    const first = await createOrGetSupplierAcquisitionJobItem("job-1", input);
    data.supplier_acquisition_job_items = [first];
    const replay = await createOrGetSupplierAcquisitionJobItem("job-1", input);

    expect(replay).toEqual(first);
    expect(first.idempotencyKey).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first.id).toMatch(/^supplieritem-/);
    expect(upsertRecordsMock).toHaveBeenCalledTimes(1);
  });

  it("resumes only retryable items and increments their attempt count", async () => {
    const failed = supplierAcquisitionJobItemSchema.parse({
      schemaVersion: "1.0",
      id: "item-1",
      jobId: "job-1",
      idempotencyKey: `sha256:${"a".repeat(64)}`,
      kind: "supplier_document",
      documentType: "SDS",
      status: "failed_item",
      supplierItemCode: "ABC-123",
      failureCode: "timeout",
      attemptCount: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    data.supplier_acquisition_job_items = [failed];

    const resumed = await resumeSupplierAcquisitionJobItem(failed.id);

    expect(resumed.status).toBe("resumed");
    expect(resumed.attemptCount).toBe(3);
    expect(resumed.failureCode).toBeUndefined();
  });

  it("marks an interrupted nonterminal job resumed without creating a second job", async () => {
    const resumed = await resumeSupplierAcquisitionJob("job-1");

    expect(resumed.id).toBe("job-1");
    expect(resumed.status).toBe("resumed");
    expect(data.supplier_acquisition_jobs).toHaveLength(1);
    expect(upsertRecordsMock).toHaveBeenCalledWith("supplier_acquisition_jobs", [resumed]);
  });

  it("stores monotonic checkpoints on the existing job row", async () => {
    const updated = await saveSupplierAcquisitionCheckpoint("job-1", {
      strategy: "page_number",
      sequence: 1,
      pageNumber: 3,
      checkpointedAt: timestamp,
      lastCompletedItemId: "item-1",
    });
    data.supplier_acquisition_jobs = [updated];

    const replay = await saveSupplierAcquisitionCheckpoint("job-1", updated.checkpoint!);

    expect(replay).toEqual(updated);
    expect(upsertRecordsMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(updated)).not.toContain("raw-cursor-token");
  });
});
