import { z } from "zod";
import { referenceFormulationRightsSchema } from "./referenceFormulationSource";

export const REFERENCE_FORMULATION_IMPORT_JOB_STATUSES = [
  "queued", "running", "paused", "completed", "completed_with_errors", "cancelled",
] as const;
export const REFERENCE_FORMULATION_IMPORT_FILE_STATUSES = [
  "queued", "processing", "review_required", "duplicate", "failed",
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase());
const safePdfFilename = z.string().min(1).max(160).refine((value) =>
  value === value.trim()
  && /^[A-Za-z0-9][A-Za-z0-9._ ()-]{0,149}$/u.test(value)
  && !value.startsWith(".") && !value.includes("..")
  && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu.test(value),
"Filename must be a safe basename without path components.");

export const referenceFormulationImportJobSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  supplierId: z.string().trim().min(1),
  providerId: z.string().trim().min(1),
  surfaceId: z.string().trim().min(1),
  market: z.string().trim().min(1),
  language: z.string().trim().min(1),
  rights: referenceFormulationRightsSchema,
  requestedBy: z.string().trim().min(1),
  status: z.enum(REFERENCE_FORMULATION_IMPORT_JOB_STATUSES),
  totalFiles: z.number().int().nonnegative(),
  processedFiles: z.number().int().nonnegative(),
  reviewRequiredFiles: z.number().int().nonnegative(),
  duplicateFiles: z.number().int().nonnegative(),
  failedFiles: z.number().int().nonnegative(),
  checkpointOrdinal: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((job, context) => {
  if (job.processedFiles !== job.reviewRequiredFiles + job.duplicateFiles + job.failedFiles) {
    context.addIssue({ code: "custom", path: ["processedFiles"], message: "Processed count must equal reviewed, duplicate and failed file counts." });
  }
  if (job.processedFiles > job.totalFiles) {
    context.addIssue({ code: "custom", path: ["totalFiles"], message: "Processed files cannot exceed total files." });
  }
  const terminal = job.status === "completed" || job.status === "completed_with_errors" || job.status === "cancelled";
  if (terminal !== (job.completedAt !== undefined)) {
    context.addIssue({ code: "custom", path: ["completedAt"], message: "Only terminal import jobs have a completion timestamp." });
  }
  if (job.status === "completed" && (job.failedFiles > 0 || job.processedFiles !== job.totalFiles)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Completed imports require every file to be processed without errors." });
  }
  if (job.status === "completed_with_errors" && (job.failedFiles === 0 || job.processedFiles !== job.totalFiles)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Completed-with-errors imports require all files to finish and at least one file error." });
  }
  if (job.checkpointOrdinal !== undefined && job.checkpointOrdinal > job.totalFiles) {
    context.addIssue({ code: "custom", path: ["checkpointOrdinal"], message: "Import checkpoint cannot exceed the selected file count." });
  }
});
export type ReferenceFormulationImportJob = z.infer<typeof referenceFormulationImportJobSchema>;

export const referenceFormulationImportFileSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  jobId: z.string().trim().min(1),
  ordinal: z.number().int().positive(),
  idempotencyKey: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  originalFilename: safePdfFilename,
  sourceDocumentHash: sha256Schema.optional(),
  status: z.enum(REFERENCE_FORMULATION_IMPORT_FILE_STATUSES),
  attemptCount: z.number().int().nonnegative(),
  acquisitionCode: z.string().trim().min(1).optional(),
  referenceFormulationRecordId: z.string().trim().min(1).optional(),
  duplicateOfItemId: z.string().trim().min(1).optional(),
  duplicateOfSourceRecordId: z.string().trim().min(1).optional(),
  errorCode: z.enum(["invalid_pdf", "file_too_large", "storage_failed", "acquisition_failed", "parser_failed", "record_conflict", "source_unavailable"]).optional(),
  errorMessage: z.string().trim().min(1).max(240).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((item, context) => {
  if (!item.sourceDocumentHash && (item.status !== "failed" || !["source_unavailable", "file_too_large", "invalid_pdf"].includes(item.errorCode ?? ""))) {
    context.addIssue({ code: "custom", path: ["sourceDocumentHash"], message: "Only unreadable or unadmitted source files may lack a content hash." });
  }
  if (item.status === "review_required" && (!item.acquisitionCode || !item.referenceFormulationRecordId)) {
    context.addIssue({ code: "custom", path: ["referenceFormulationRecordId"], message: "Review-required imports must link an acquisition and immutable reference record." });
  }
  if (item.status === "duplicate" && !item.duplicateOfItemId && !item.duplicateOfSourceRecordId) {
    context.addIssue({ code: "custom", path: ["duplicateOfSourceRecordId"], message: "Duplicate files must identify the original imported file or source record." });
  }
  if ((item.status === "failed") !== (item.errorCode !== undefined && item.errorMessage !== undefined)) {
    context.addIssue({ code: "custom", path: ["errorCode"], message: "Failed files require a bounded error code and message." });
  }
  if (item.status !== "failed" && (item.errorCode !== undefined || item.errorMessage !== undefined)) {
    context.addIssue({ code: "custom", path: ["errorCode"], message: "Only failed files may carry import errors." });
  }
});
export type ReferenceFormulationImportFile = z.infer<typeof referenceFormulationImportFileSchema>;

export function summarizeReferenceFormulationImport(
  jobInput: ReferenceFormulationImportJob,
  fileInputs: ReferenceFormulationImportFile[],
  updatedAt: string,
): ReferenceFormulationImportJob {
  const job = referenceFormulationImportJobSchema.parse(jobInput);
  const files = fileInputs.map((file) => referenceFormulationImportFileSchema.parse(file));
  if (files.some((file) => file.jobId !== job.id) || files.length !== job.totalFiles
    || new Set(files.map((file) => file.ordinal)).size !== files.length) {
    throw new Error("Import job summary requires exactly one file result for every selected ordinal.");
  }
  if (files.some((file, index) => file.ordinal !== index + 1)) {
    throw new Error("Import job file ordinals must form a complete 1-based sequence.");
  }
  const reviewRequiredFiles = files.filter((file) => file.status === "review_required").length;
  const duplicateFiles = files.filter((file) => file.status === "duplicate").length;
  const failedFiles = files.filter((file) => file.status === "failed").length;
  const processedFiles = reviewRequiredFiles + duplicateFiles + failedFiles;
  const hasPending = files.some((file) => file.status === "queued" || file.status === "processing");
  const status = hasPending ? "paused"
    : failedFiles > 0 ? "completed_with_errors" : "completed";
  const lastComplete = files.filter((file) => file.status === "review_required" || file.status === "duplicate" || file.status === "failed")
    .reduce((highest, file) => Math.max(highest, file.ordinal), job.checkpointOrdinal ?? 0);
  return referenceFormulationImportJobSchema.parse({
    ...job,
    status,
    processedFiles,
    reviewRequiredFiles,
    duplicateFiles,
    failedFiles,
    checkpointOrdinal: lastComplete,
    updatedAt,
    ...(status === "completed" || status === "completed_with_errors" ? { completedAt: updatedAt } : { completedAt: undefined }),
  });
}
