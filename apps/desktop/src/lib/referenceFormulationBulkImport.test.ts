import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { referenceFormulationImportFileSchema, referenceFormulationImportJobSchema } from "@formulab/shared";

const { collections, listRecordsMock, upsertRecordsMock, nowIsoMock, storePdfMock } = vi.hoisted(() => {
  const collections = new Map<string, Record<string, unknown>[]>();
  return {
    collections,
    listRecordsMock: vi.fn(async (collection: string) => collections.get(collection) ?? []),
    upsertRecordsMock: vi.fn(async (collection: string, rows: Record<string, unknown>[]) => {
      const existing = collections.get(collection) ?? [];
      for (const row of rows) {
        const key = String(row.code ?? row.id);
        const index = existing.findIndex((candidate) => String(candidate.code ?? candidate.id) === key);
        if (index < 0) existing.push(row);
        else existing[index] = row;
      }
      collections.set(collection, existing);
      return { inserted: rows.length, updated: 0, total: existing.length };
    }),
    nowIsoMock: vi.fn(() => "2026-10-26T12:00:00.000Z"),
    storePdfMock: vi.fn(async (bytes: Uint8Array, expectedSha256: string) => ({
      sha256: expectedSha256, byte_size: bytes.byteLength, relative_path: `supplier-documents/sha256/${expectedSha256}.pdf`, deduplicated: false,
    })),
  };
});

vi.mock("./masterdata", () => ({
  listRecords: listRecordsMock,
  upsertRecords: upsertRecordsMock,
  nowIso: nowIsoMock,
  storeSupplierDocumentPdf: storePdfMock,
}));
vi.mock("./referenceFormulationOcr", () => ({
  runConditionalReferenceFormulationOcr: vi.fn(async (input: { extraction: { documentHash: string; parserVersion: string } }) => ({
    status: "not_needed", sourceDocumentHash: input.extraction.documentHash,
    textExtractionParserVersion: input.extraction.parserVersion, ocrParserVersion: "formulab-reference-formulation-ocr-v1",
    lines: [], pagesAttempted: [], warnings: [],
  })),
}));

import { resumeReferenceFormulationBulkImport, startReferenceFormulationBulkImport } from "./referenceFormulationBulkImport";

const metadata = {
  supplierId: "supplier-croda",
  providerId: "croda-manual",
  surfaceId: "local-formulation-pdfs",
  market: "EU",
  language: "en",
  rights: { status: "owner_provided" as const, redistribution: "unknown" as const, evidenceRefs: ["owner-selected-file"] },
  requestedBy: "owner-1",
};

function selectedFile(name: string, bytes: Uint8Array, type = "application/pdf") {
  return {
    name, type, size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.slice().buffer;
    },
  };
}

async function validPdf(width = 300): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([width, 300]);
  return document.save();
}

describe("reference formulation bulk import", () => {
  beforeEach(() => {
    collections.clear();
    vi.clearAllMocks();
  });

  it("processes files independently, persists source-backed review records, and deduplicates repeated bytes", async () => {
    const bytes = await validPdf();
    const result = await startReferenceFormulationBulkImport([
      selectedFile("formula-one.pdf", bytes), selectedFile("formula-copy.pdf", bytes),
    ], metadata);
    expect(result.job).toMatchObject({ status: "completed", totalFiles: 2, processedFiles: 2, reviewRequiredFiles: 1, duplicateFiles: 1, failedFiles: 0 });
    expect(result.files.map((item) => item.status)).toEqual(["review_required", "duplicate"]);
    expect(result.files[0]).toMatchObject({ sourceDocumentHash: expect.stringMatching(/^[a-f0-9]{64}$/), referenceFormulationRecordId: expect.any(String) });
    expect(collections.get("supplier_document_acquisitions")).toHaveLength(1);
    expect(collections.get("reference_formulations")).toHaveLength(1);
    expect(storePdfMock).toHaveBeenCalledTimes(1);
  });

  it("records one file failure and continues processing later PDFs", async () => {
    const bytes = await validPdf();
    const result = await startReferenceFormulationBulkImport([
      selectedFile("invalid.pdf", new TextEncoder().encode("not a PDF")), selectedFile("valid.pdf", bytes),
    ], metadata);

    expect(result.job).toMatchObject({ status: "completed_with_errors", totalFiles: 2, reviewRequiredFiles: 1, failedFiles: 1 });
    expect(result.files[0]).toMatchObject({ status: "failed", errorCode: "invalid_pdf" });
    expect(result.files[1]?.status).toBe("review_required");
  });

  it("records an empty selected file as a per-file PDF error", async () => {
    const bytes = await validPdf();
    const result = await startReferenceFormulationBulkImport([
      selectedFile("empty.pdf", new Uint8Array()), selectedFile("valid.pdf", bytes),
    ], metadata);

    expect(result.job).toMatchObject({ status: "completed_with_errors", totalFiles: 2, failedFiles: 1, reviewRequiredFiles: 1 });
    expect(result.files[0]).toMatchObject({ status: "failed", errorCode: "invalid_pdf" });
  });

  it("resumes a paused job only when reselected bytes match the saved hash", async () => {
    const bytes = await validPdf();
    const firstRun = await startReferenceFormulationBulkImport([selectedFile("resume.pdf", bytes)], metadata, new AbortController().signal);
    expect(firstRun.job.status).toBe("completed");

    const interrupted = await startReferenceFormulationBulkImport(
      [selectedFile("pending.pdf", bytes)], metadata,
      (() => { const controller = new AbortController(); controller.abort(); return controller; })().signal,
    );
    expect(interrupted.job.status).toBe("paused");
    expect(interrupted.files[0]?.status).toBe("queued");

    const wrongBytes = new TextEncoder().encode("different source");
    const wrongResume = await resumeReferenceFormulationBulkImport(interrupted.job.id, [selectedFile("pending.pdf", wrongBytes)]);
    expect(wrongResume.job.status).toBe("paused");
    expect(wrongResume.files[0]?.status).toBe("queued");

    const resumed = await resumeReferenceFormulationBulkImport(interrupted.job.id, [selectedFile("renamed.pdf", bytes)]);
    expect(resumed.job.status).toBe("completed");
    expect(resumed.files[0]?.status).toBe("duplicate");
    expect(collections.get("reference_formulations")).toHaveLength(1);
  });

  it("repairs an interrupted partial file manifest when the original selection is restored", async () => {
    const bytes = await validPdf();
    const selected = [selectedFile("first.pdf", bytes), selectedFile("second.pdf", bytes)];
    const controller = new AbortController();
    controller.abort();
    const paused = await startReferenceFormulationBulkImport(selected, metadata, controller.signal);
    const rows = collections.get("reference_formulation_import_files") ?? [];
    collections.set("reference_formulation_import_files", rows.filter((row) => row.ordinal !== 2));

    const resumed = await resumeReferenceFormulationBulkImport(paused.job.id, selected);
    expect(resumed.job).toMatchObject({ status: "completed", processedFiles: 2, reviewRequiredFiles: 1, duplicateFiles: 1 });
    expect(resumed.files.map((file) => file.ordinal)).toEqual([1, 2]);
    expect(resumed.files.map((file) => file.status)).toEqual(["review_required", "duplicate"]);
  });

  it("rejects partial-manifest repair when the original files are reordered", async () => {
    const first = await validPdf(300);
    const second = await validPdf(400);
    const selected = [selectedFile("first.pdf", first), selectedFile("second.pdf", second)];
    const controller = new AbortController();
    controller.abort();
    const paused = await startReferenceFormulationBulkImport(selected, metadata, controller.signal);
    const rows = collections.get("reference_formulation_import_files") ?? [];
    collections.set("reference_formulation_import_files", rows.filter((row) => row.ordinal !== 2));

    await expect(resumeReferenceFormulationBulkImport(paused.job.id, [selected[1]!, selected[0]!]))
      .rejects.toThrow(/cannot be safely matched|does not match the original ordered file selection/);
  });

  it("keeps a hashless failed ordinal terminal during partial recovery", async () => {
    const replacement = await validPdf(420);
    const second = await validPdf(300);
    const job = referenceFormulationImportJobSchema.parse({
      schemaVersion: "1.0", id: "reference-import-hashless-repair", ...metadata, status: "paused",
      totalFiles: 2, processedFiles: 1, reviewRequiredFiles: 0, duplicateFiles: 0, failedFiles: 1,
      createdAt: nowIsoMock(), updatedAt: nowIsoMock(),
    });
    const hashlessFailed = referenceFormulationImportFileSchema.parse({
      schemaVersion: "1.0", id: `${job.id}:file:1`, jobId: job.id, ordinal: 1,
      idempotencyKey: `sha256:${"3".repeat(64)}`, originalFilename: "same.pdf",
      status: "failed", attemptCount: 0, errorCode: "source_unavailable",
      errorMessage: "The selected file could not be read or did not match its saved source hash.",
      createdAt: nowIsoMock(), updatedAt: nowIsoMock(),
    });
    collections.set("reference_formulation_import_jobs", [job]);
    collections.set("reference_formulation_import_files", [hashlessFailed]);

    const result = await resumeReferenceFormulationBulkImport(job.id, [
      selectedFile("same.pdf", replacement), selectedFile("next.pdf", second),
    ]);
    expect(result.files[0]).toMatchObject({ status: "failed", errorCode: "source_unavailable" });
    expect(result.files[0]?.sourceDocumentHash).toBeUndefined();
    expect(result.files[1]?.status).toBe("review_required");
    expect(collections.get("reference_formulations")).toHaveLength(1);
  });

  it("treats a later job for an already imported supplier/hash as a duplicate", async () => {
    const bytes = await validPdf();
    await startReferenceFormulationBulkImport([selectedFile("formula.pdf", bytes)], metadata);
    const duplicate = await startReferenceFormulationBulkImport([selectedFile("formula-reselected.pdf", bytes)], metadata);

    expect(duplicate.job).toMatchObject({ status: "completed", duplicateFiles: 1, reviewRequiredFiles: 0 });
    expect(duplicate.files[0]?.status).toBe("duplicate");
    expect(storePdfMock).toHaveBeenCalledTimes(1);
    expect(collections.get("reference_formulations")).toHaveLength(1);
  });
});
