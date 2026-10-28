import { describe, expect, it } from "vitest";
import {
  canTransitionSupplierAcquisitionJob,
  canTransitionSupplierAcquisitionItem,
  advanceSupplierAcquisitionCheckpoint,
  supplierAcquisitionJobItemSchema,
  supplierAcquisitionJobSchema,
  supplierAcquisitionCheckpointSchema,
  summarizeSupplierAcquisitionJobStatus,
  transitionSupplierAcquisitionJob,
  transitionSupplierAcquisitionJobItem,
} from "./supplierAcquisition";

const now = "2026-10-26T08:00:00.000Z";

const job = supplierAcquisitionJobSchema.parse({
  schemaVersion: "1.0",
  id: "acq-job-1",
  supplierId: "supplier-example",
  providerId: "example-adapter",
  surfaceId: "public-documents",
  requestedBy: "chemist-1",
  status: "queued",
  totalItems: 2,
  acquiredItems: 0,
  failedItems: 0,
  createdAt: now,
  updatedAt: now,
});

const item = supplierAcquisitionJobItemSchema.parse({
  schemaVersion: "1.0",
  id: "acq-item-1",
  jobId: "acq-job-1",
  idempotencyKey: `sha256:${"a".repeat(64)}`,
  kind: "supplier_document",
  documentType: "SDS",
  status: "queued",
  supplierItemCode: "ABC-123",
  attemptCount: 0,
  createdAt: now,
  updatedAt: now,
});

describe("supplier acquisition job state machine", () => {
  it("allows only declared job lifecycle transitions and stamps terminal completion", () => {
    expect(canTransitionSupplierAcquisitionJob("queued", "discovery")).toBe(true);
    expect(canTransitionSupplierAcquisitionJob("completed", "resumed")).toBe(false);
    expect(transitionSupplierAcquisitionJob(job, "discovery", now).completedAt).toBeUndefined();
    expect(transitionSupplierAcquisitionJob({ ...job, status: "review_ready" }, "completed", now).completedAt).toBe(now);
    expect(() => transitionSupplierAcquisitionJob(job, "completed", now)).toThrow(/Invalid supplier acquisition job transition/);
    expect(() => supplierAcquisitionJobSchema.parse({ ...job, totalItems: 1, acquiredItems: 1, failedItems: 1 }))
      .toThrow(/cannot exceed total items/);
  });

  it("keeps item failures isolated and records bounded diagnostics", () => {
    expect(canTransitionSupplierAcquisitionItem("downloading", "failed_item")).toBe(true);
    expect(() => supplierAcquisitionJobItemSchema.parse({ ...item, status: "failed_item" })).toThrow(/require a bounded failure code/);
    const failed = transitionSupplierAcquisitionJobItem({ ...item, status: "downloading" }, "failed_item", now, "timeout");
    expect(failed.failureCode).toBe("timeout");
    const resumed = transitionSupplierAcquisitionJobItem(failed, "resumed", now);
    expect(resumed.attemptCount).toBe(1);
    expect(resumed.failureCode).toBeUndefined();
  });

  it("reports active work while another item has failed, then completes with gaps", () => {
    expect(summarizeSupplierAcquisitionJobStatus(["failed_item", "downloading"])).toBe("downloading");
    expect(summarizeSupplierAcquisitionJobStatus(["acquired", "failed_item"])).toBe("completed_with_gaps");
    expect(summarizeSupplierAcquisitionJobStatus(["acquired", "acquired"])).toBe("completed");
    expect(summarizeSupplierAcquisitionJobStatus(["cancelled", "cancelled"])).toBe("cancelled");
  });

  it("advances safe scan checkpoints monotonically and accepts only opaque credential references", () => {
    const firstCheckpoint = supplierAcquisitionCheckpointSchema.parse({
      strategy: "page_number",
      sequence: 1,
      pageNumber: 1,
      checkpointedAt: now,
    });
    const first = advanceSupplierAcquisitionCheckpoint(job, firstCheckpoint, now);
    const secondCheckpoint = supplierAcquisitionCheckpointSchema.parse({
      strategy: "page_number",
      sequence: 2,
      pageNumber: 2,
      checkpointedAt: now,
      lastCompletedItemId: "acq-item-1",
    });
    const second = advanceSupplierAcquisitionCheckpoint(first, secondCheckpoint, now);

    expect(second.checkpoint?.pageNumber).toBe(2);
    expect(advanceSupplierAcquisitionCheckpoint(second, secondCheckpoint, now)).toBe(second);
    expect(() => advanceSupplierAcquisitionCheckpoint(second, { ...firstCheckpoint, sequence: 1 }, now))
      .toThrow(/cannot move backwards/);
    expect(() => advanceSupplierAcquisitionCheckpoint(second, { ...secondCheckpoint, sequence: 3, pageNumber: 1 }, now))
      .toThrow(/page checkpoint cannot move backwards/);
    expect(() => supplierAcquisitionCheckpointSchema.parse({
      strategy: "secure_continuation_ref",
      sequence: 1,
      continuationRef: "supplier-secret-cursor",
      checkpointedAt: now,
    })).toThrow();
    expect(supplierAcquisitionCheckpointSchema.parse({
      strategy: "secure_continuation_ref",
      sequence: 1,
      continuationRef: `formulab-credential:v1:${"b".repeat(32)}`,
      checkpointedAt: now,
    }).continuationRef).toContain("formulab-credential:v1:");
  });
});
