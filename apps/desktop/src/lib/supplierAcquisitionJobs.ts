import {
  advanceSupplierAcquisitionCheckpoint,
  supplierAcquisitionJobItemSchema,
  transitionSupplierAcquisitionJob,
  transitionSupplierAcquisitionJobItem,
  type SupplierAcquisitionCheckpoint,
  type SupplierAcquisitionJob,
  type SupplierAcquisitionJobItem,
} from "@formulab/shared";
import { listRecords, nowIso, upsertRecords } from "./masterdata";
import { sha256Identity } from "./supplierAcquisitionIdentity";

export type SupplierAcquisitionJobItemInput = Pick<
  SupplierAcquisitionJobItem,
  "kind" | "sourceProductId" | "supplierItemCode" | "sourceProductTradeName" | "sourceProductGrade" | "documentType"
>;

function normalize(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function itemProductIdentity(item: SupplierAcquisitionJobItemInput): string {
  if (item.sourceProductId) return `id:${normalize(item.sourceProductId)}`;
  if (item.supplierItemCode) return `item:${normalize(item.supplierItemCode)}`;
  if (item.sourceProductTradeName && item.sourceProductGrade) {
    return `name-grade:${normalize(item.sourceProductTradeName)}|${normalize(item.sourceProductGrade)}`;
  }
  throw new Error("Supplier acquisition item requires a stable supplier product identity.");
}

/** Create an item once per job/source identity; retried page results reuse the same row and state. */
export async function createOrGetSupplierAcquisitionJobItem(
  jobId: string,
  input: SupplierAcquisitionJobItemInput,
): Promise<SupplierAcquisitionJobItem> {
  const jobs = await listRecords("supplier_acquisition_jobs");
  const job = jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error("Supplier acquisition job was not found.");

  const idempotencyIdentity = JSON.stringify({
    jobId,
    supplierId: normalize(job.supplierId),
    providerId: normalize(job.providerId),
    surfaceId: normalize(job.surfaceId),
    kind: input.kind,
    product: itemProductIdentity(input),
    documentType: input.documentType ?? null,
  });
  const idempotencyKey = `sha256:${await sha256Identity(idempotencyIdentity)}`;
  const items = await listRecords("supplier_acquisition_job_items");
  const existing = items.find((item) => item.jobId === jobId && item.idempotencyKey === idempotencyKey);
  if (existing) return existing;

  const timestamp = nowIso();
  const item = supplierAcquisitionJobItemSchema.parse({
    ...input,
    schemaVersion: "1.0",
    id: `supplieritem-${idempotencyKey.slice("sha256:".length)}`,
    jobId,
    idempotencyKey,
    status: "queued",
    attemptCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await upsertRecords("supplier_acquisition_job_items", [item]);
  return item;
}

export async function resumeSupplierAcquisitionJobItem(itemId: string): Promise<SupplierAcquisitionJobItem> {
  const items = await listRecords("supplier_acquisition_job_items");
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error("Supplier acquisition item was not found.");
  if (item.status === "resumed") return item;
  const resumed = transitionSupplierAcquisitionJobItem(item, "resumed", nowIso());
  await upsertRecords("supplier_acquisition_job_items", [resumed]);
  return resumed;
}

export async function resumeSupplierAcquisitionJob(jobId: string): Promise<SupplierAcquisitionJob> {
  const jobs = await listRecords("supplier_acquisition_jobs");
  const job = jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error("Supplier acquisition job was not found.");
  if (job.status === "resumed") return job;
  const resumed = transitionSupplierAcquisitionJob(job, "resumed", nowIso());
  await upsertRecords("supplier_acquisition_jobs", [resumed]);
  return resumed;
}

/** Save a safe checkpoint in one job-row update after completing a page or batch. */
export async function saveSupplierAcquisitionCheckpoint(
  jobId: string,
  checkpoint: SupplierAcquisitionCheckpoint,
): Promise<SupplierAcquisitionJob> {
  const jobs = await listRecords("supplier_acquisition_jobs");
  const job = jobs.find((candidate) => candidate.id === jobId);
  if (!job) throw new Error("Supplier acquisition job was not found.");
  const updated = advanceSupplierAcquisitionCheckpoint(job, checkpoint, nowIso());
  if (updated !== job) await upsertRecords("supplier_acquisition_jobs", [updated]);
  return updated;
}
