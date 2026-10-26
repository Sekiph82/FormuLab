import { z } from "zod";

export const SUPPLIER_ACQUISITION_JOB_STATUSES = [
  "queued",
  "discovery",
  "downloading",
  "parsing",
  "review_ready",
  "completed",
  "completed_with_gaps",
  "failed",
  "cancelled",
  "resumed",
] as const;
export type SupplierAcquisitionJobStatus = (typeof SUPPLIER_ACQUISITION_JOB_STATUSES)[number];

export const SUPPLIER_ACQUISITION_ITEM_STATUSES = [
  "queued",
  "discovery",
  "downloading",
  "parsing",
  "review_ready",
  "acquired",
  "skipped",
  "failed_item",
  "cancelled",
  "resumed",
] as const;
export type SupplierAcquisitionItemStatus = (typeof SUPPLIER_ACQUISITION_ITEM_STATUSES)[number];

export const SUPPLIER_ACQUISITION_ITEM_KINDS = ["catalog_product", "supplier_document"] as const;

/** Mutable operational state only; document facts live in immutable acquisition receipts. */
export const supplierAcquisitionJobSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  supplierId: z.string().trim().min(1),
  providerId: z.string().trim().min(1),
  surfaceId: z.string().trim().min(1),
  requestedBy: z.string().trim().min(1),
  status: z.enum(SUPPLIER_ACQUISITION_JOB_STATUSES),
  totalItems: z.number().int().nonnegative().default(0),
  acquiredItems: z.number().int().nonnegative().default(0),
  failedItems: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((job, context) => {
  if (job.acquiredItems + job.failedItems > job.totalItems) {
    context.addIssue({ code: "custom", path: ["totalItems"], message: "Acquisition result counts cannot exceed total items." });
  }
  if (TERMINAL_JOB_STATUSES.includes(job.status) !== (job.completedAt !== undefined)) {
    context.addIssue({ code: "custom", path: ["completedAt"], message: "Only terminal acquisition jobs have a completion timestamp." });
  }
});
export type SupplierAcquisitionJob = z.infer<typeof supplierAcquisitionJobSchema>;

/** Per-product/document state lets one failed supplier item coexist with active work. */
export const supplierAcquisitionJobItemSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  jobId: z.string().trim().min(1),
  kind: z.enum(SUPPLIER_ACQUISITION_ITEM_KINDS),
  status: z.enum(SUPPLIER_ACQUISITION_ITEM_STATUSES),
  sourceProductId: z.string().trim().min(1).optional(),
  supplierItemCode: z.string().trim().min(1).optional(),
  documentType: z.enum(["SDS", "TDS", "COA", "CERTIFICATE", "OTHER"]).optional(),
  acquisitionCode: z.string().trim().min(1).optional(),
  /** Closed diagnostic vocabulary; never store raw server responses or URLs here. */
  failureCode: z.enum([
    "authorization_required",
    "not_found",
    "unsupported_document",
    "invalid_document",
    "network_rejected",
    "timeout",
    "storage_failed",
    "parser_failed",
    "unknown_failure",
  ]).optional(),
  attemptCount: z.number().int().nonnegative().default(0),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((item, context) => {
  if (item.kind === "supplier_document" && !item.documentType) {
    context.addIssue({ code: "custom", path: ["documentType"], message: "Supplier document items require a document type." });
  }
  if (item.status === "failed_item" && !item.failureCode) {
    context.addIssue({ code: "custom", path: ["failureCode"], message: "Failed items require a bounded failure code." });
  }
  if (item.status !== "failed_item" && item.failureCode) {
    context.addIssue({ code: "custom", path: ["failureCode"], message: "Failure codes are only valid for failed items." });
  }
});
export type SupplierAcquisitionJobItem = z.infer<typeof supplierAcquisitionJobItemSchema>;

const JOB_TRANSITIONS: Record<SupplierAcquisitionJobStatus, readonly SupplierAcquisitionJobStatus[]> = {
  queued: ["discovery", "cancelled", "failed"],
  discovery: ["downloading", "review_ready", "completed_with_gaps", "cancelled", "failed"],
  downloading: ["parsing", "review_ready", "completed_with_gaps", "cancelled", "failed"],
  parsing: ["review_ready", "completed", "completed_with_gaps", "cancelled", "failed"],
  review_ready: ["completed", "completed_with_gaps", "cancelled", "failed"],
  completed: [],
  completed_with_gaps: ["resumed"],
  failed: ["resumed"],
  cancelled: ["resumed"],
  resumed: ["discovery", "downloading", "parsing", "review_ready", "cancelled", "failed"],
};

const ITEM_TRANSITIONS: Record<SupplierAcquisitionItemStatus, readonly SupplierAcquisitionItemStatus[]> = {
  queued: ["discovery", "downloading", "skipped", "cancelled"],
  discovery: ["downloading", "review_ready", "skipped", "failed_item", "cancelled"],
  downloading: ["parsing", "failed_item", "cancelled"],
  parsing: ["review_ready", "acquired", "failed_item", "cancelled"],
  review_ready: ["acquired", "failed_item", "cancelled"],
  acquired: [],
  skipped: ["resumed"],
  failed_item: ["resumed"],
  cancelled: ["resumed"],
  resumed: ["discovery", "downloading", "parsing", "review_ready", "acquired", "failed_item", "cancelled"],
};

const TERMINAL_JOB_STATUSES: readonly SupplierAcquisitionJobStatus[] = ["completed", "completed_with_gaps", "failed", "cancelled"];

export function canTransitionSupplierAcquisitionJob(from: SupplierAcquisitionJobStatus, to: SupplierAcquisitionJobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

export function transitionSupplierAcquisitionJob(
  job: SupplierAcquisitionJob,
  status: SupplierAcquisitionJobStatus,
  updatedAt: string,
): SupplierAcquisitionJob {
  if (!canTransitionSupplierAcquisitionJob(job.status, status)) {
    throw new Error(`Invalid supplier acquisition job transition: ${job.status} -> ${status}`);
  }
  return supplierAcquisitionJobSchema.parse({
    ...job,
    status,
    updatedAt,
    completedAt: TERMINAL_JOB_STATUSES.includes(status) ? updatedAt : undefined,
  });
}

export function canTransitionSupplierAcquisitionItem(from: SupplierAcquisitionItemStatus, to: SupplierAcquisitionItemStatus): boolean {
  return ITEM_TRANSITIONS[from].includes(to);
}

export function transitionSupplierAcquisitionJobItem(
  item: SupplierAcquisitionJobItem,
  status: SupplierAcquisitionItemStatus,
  updatedAt: string,
  failureCode?: SupplierAcquisitionJobItem["failureCode"],
): SupplierAcquisitionJobItem {
  if (!canTransitionSupplierAcquisitionItem(item.status, status)) {
    throw new Error(`Invalid supplier acquisition item transition: ${item.status} -> ${status}`);
  }
  return supplierAcquisitionJobItemSchema.parse({
    ...item,
    status,
    attemptCount: status === "resumed" ? item.attemptCount + 1 : item.attemptCount,
    failureCode: status === "failed_item" ? failureCode ?? "unknown_failure" : undefined,
    updatedAt,
  });
}

/** A failed/skipped item yields a job-level gap while unrelated active items continue. */
export function summarizeSupplierAcquisitionJobStatus(
  itemStatuses: SupplierAcquisitionItemStatus[],
  emptyStatus: SupplierAcquisitionJobStatus = "queued",
): SupplierAcquisitionJobStatus {
  if (itemStatuses.length === 0) return emptyStatus;
  if (itemStatuses.includes("resumed")) return "resumed";
  for (const status of ["discovery", "downloading", "parsing", "review_ready", "queued"] as const) {
    if (itemStatuses.includes(status)) return status;
  }
  if (itemStatuses.every((status) => status === "cancelled")) return "cancelled";
  if (itemStatuses.every((status) => status === "acquired")) return "completed";
  return "completed_with_gaps";
}
