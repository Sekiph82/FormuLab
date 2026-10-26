import { describe, expect, it } from "vitest";
import {
  referenceFormulationImportFileSchema,
  referenceFormulationImportJobSchema,
  summarizeReferenceFormulationImport,
} from "./referenceFormulationBulkImport";

const timestamp = "2026-10-26T12:00:00.000Z";
const baseJob = () => referenceFormulationImportJobSchema.parse({
  schemaVersion: "1.0", id: "reference-import-1", supplierId: "supplier-croda", providerId: "croda-manual",
  surfaceId: "local-formulation-files", market: "EU", language: "en",
  rights: { status: "owner_provided", redistribution: "unknown", evidenceRefs: ["owner-upload"] },
  requestedBy: "chemist-1", status: "running", totalFiles: 2, processedFiles: 0,
  reviewRequiredFiles: 0, duplicateFiles: 0, failedFiles: 0, createdAt: timestamp, updatedAt: timestamp,
});
const baseFile = (ordinal: number) => referenceFormulationImportFileSchema.parse({
  schemaVersion: "1.0", id: `reference-import-file-${ordinal}`, jobId: "reference-import-1", ordinal,
  idempotencyKey: `sha256:${String(ordinal).padStart(64, "0")}`,
  originalFilename: `supplier-${ordinal}.pdf`, sourceDocumentHash: String(ordinal).padStart(64, "0"),
  status: "queued", attemptCount: 0, createdAt: timestamp, updatedAt: timestamp,
});

describe("reference formulation bulk import state", () => {
  it("summarizes per-file review, duplicate and error outcomes for resumable jobs", () => {
    const job = baseJob();
    const first = referenceFormulationImportFileSchema.parse({
      ...baseFile(1), status: "review_required", attemptCount: 1,
      acquisitionCode: "supplierdoc-1", referenceFormulationRecordId: "formula-record-1",
    });
    const second = referenceFormulationImportFileSchema.parse({
      ...baseFile(2), status: "failed", attemptCount: 1, errorCode: "parser_failed", errorMessage: "Source layout needs manual review.",
    });
    const summary = summarizeReferenceFormulationImport(job, [first, second], timestamp);
    expect(summary).toMatchObject({
      status: "completed_with_errors", processedFiles: 2, reviewRequiredFiles: 1, duplicateFiles: 0, failedFiles: 1,
      checkpointOrdinal: 2, completedAt: timestamp,
    });
  });

  it("leaves queued files resumable and validates duplicate provenance", () => {
    const job = baseJob();
    const done = referenceFormulationImportFileSchema.parse({
      ...baseFile(1), status: "duplicate", attemptCount: 1, duplicateOfSourceRecordId: "formula-record-existing",
    });
    const summary = summarizeReferenceFormulationImport(job, [done, baseFile(2)], timestamp);
    expect(summary).toMatchObject({ status: "paused", processedFiles: 1, duplicateFiles: 1, checkpointOrdinal: 1 });
    expect(() => referenceFormulationImportFileSchema.parse({ ...done, duplicateOfSourceRecordId: undefined })).toThrow(/identify the original/);
  });

  it("rejects unsafe filenames and invalid job totals", () => {
    expect(() => referenceFormulationImportFileSchema.parse({ ...baseFile(1), originalFilename: "..\\secret.pdf" })).toThrow(/safe basename/);
    expect(() => referenceFormulationImportJobSchema.parse({ ...baseJob(), processedFiles: 1 })).toThrow(/Processed count/);
  });

  it("rejects file manifests with gaps or out-of-order ordinals", () => {
    const job = baseJob();
    expect(() => summarizeReferenceFormulationImport(job, [baseFile(1), baseFile(3)], timestamp)).toThrow(/1-based sequence/);
  });
});
