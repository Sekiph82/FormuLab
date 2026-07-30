import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentSourceReference } from "@formulab/shared";

const bridge = { listRecords: vi.fn(), upsertRecords: vi.fn() };
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
  nowIso: () => "2026-02-01T00:00:00.000Z",
}));

import { finalizeExportCancelled, finalizeExportFailed, finalizeExportSucceeded, listExportHistory, sha256Hex, startExportRecord } from "./exportHistory";

const SOURCE: DocumentSourceReference = {
  sourceEntityType: "regulatory_dossier",
  sourceRecordId: "dossier-1",
  sourceCode: "TEST-DOSS-001",
  formulaVersionId: "version-1",
  dossierRevision: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  bridge.upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
});

describe("sha256Hex", () => {
  it("matches the known SHA-256 of an empty input", async () => {
    expect(await sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches the known SHA-256 of a short ASCII payload ('abc')", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("startExportRecord", () => {
  it("creates a valid generating record with no file/error metadata", async () => {
    const record = await startExportRecord({ reportDefinitionCode: "dossier", source: SOURCE, format: "pdf", generatedBy: "u1" });
    expect(record.status).toBe("generating");
    expect(record.source).toEqual(SOURCE);
    expect(record.fileName).toBeUndefined();
    expect(record.errorCode).toBeUndefined();
    expect(bridge.upsertRecords).toHaveBeenCalledWith("generated_document_records", [expect.objectContaining({ status: "generating" })]);
  });
});

describe("finalizeExportSucceeded", () => {
  it("updates the same record id to succeeded with full file metadata", async () => {
    const started = await startExportRecord({ reportDefinitionCode: "dossier", source: SOURCE, format: "pdf", generatedBy: "u1" });
    bridge.upsertRecords.mockClear();
    const finalized = await finalizeExportSucceeded(started, { fileName: "dossier.pdf", mimeType: "application/pdf", byteSize: 1024, checksum: "abc123" });
    expect(finalized.id).toBe(started.id);
    expect(finalized.status).toBe("succeeded");
    expect(finalized.fileName).toBe("dossier.pdf");
    expect(finalized.byteSize).toBe(1024);
    expect(finalized.checksum).toBe("abc123");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("generated_document_records", [expect.objectContaining({ id: started.id, status: "succeeded" })]);
  });

  it("refuses a zero byte size", async () => {
    const started = await startExportRecord({ reportDefinitionCode: "dossier", source: SOURCE, format: "pdf", generatedBy: "u1" });
    await expect(finalizeExportSucceeded(started, { fileName: "d.pdf", mimeType: "application/pdf", byteSize: 0, checksum: "x" })).rejects.toThrow();
  });

  it("refuses an absolute path as fileName", async () => {
    const started = await startExportRecord({ reportDefinitionCode: "dossier", source: SOURCE, format: "pdf", generatedBy: "u1" });
    await expect(finalizeExportSucceeded(started, { fileName: "C:\\Users\\me\\d.pdf", mimeType: "application/pdf", byteSize: 10, checksum: "x" })).rejects.toThrow();
  });
});

describe("finalizeExportFailed", () => {
  it("updates the same record id to failed with error metadata and no success metadata", async () => {
    const started = await startExportRecord({ reportDefinitionCode: "dossier", source: SOURCE, format: "docx", generatedBy: "u1" });
    const finalized = await finalizeExportFailed(started, { errorCode: "RENDER_FAILED", errorMessage: "boom" });
    expect(finalized.id).toBe(started.id);
    expect(finalized.status).toBe("failed");
    expect(finalized.errorCode).toBe("RENDER_FAILED");
    expect(finalized.fileName).toBeUndefined();
    expect(finalized.checksum).toBeUndefined();
  });

  it("a failed record can never be represented as successful — status and success fields are mutually exclusive by schema", async () => {
    const started = await startExportRecord({ reportDefinitionCode: "dossier", source: SOURCE, format: "docx", generatedBy: "u1" });
    const finalized = await finalizeExportFailed(started, { errorCode: "SAVE_FAILED", errorMessage: "disk full" });
    expect(finalized.status).not.toBe("succeeded");
    expect(finalized.byteSize).toBeUndefined();
  });
});

describe("finalizeExportCancelled", () => {
  it("updates the same record id to cancelled with no success or error metadata", async () => {
    const started = await startExportRecord({ reportDefinitionCode: "dossier", source: SOURCE, format: "pdf", generatedBy: "u1" });
    const finalized = await finalizeExportCancelled(started);
    expect(finalized.id).toBe(started.id);
    expect(finalized.status).toBe("cancelled");
    expect(finalized.fileName).toBeUndefined();
    expect(finalized.errorCode).toBeUndefined();
  });
});

describe("listExportHistory", () => {
  it("sorts records newest first", async () => {
    bridge.listRecords.mockResolvedValue([
      { id: "a", generatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "b", generatedAt: "2026-02-01T00:00:00.000Z" },
      { id: "c", generatedAt: "2026-01-15T00:00:00.000Z" },
    ]);
    const history = await listExportHistory();
    expect(history.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
});
