/**
 * Phase 8 — persists one `GeneratedDocumentRecord` (the Session 1 schema,
 * `@formulab/shared`) per PDF/DOCX generation attempt, in the
 * `generated_document_records` masterdata collection. Never a second,
 * parallel record shape — every field this file writes goes straight
 * through `generatedDocumentRecordSchema.parse()`, so the exact same
 * integrity rules Session 1 defined (a failed/cancelled record can never
 * carry success file metadata; a succeeded one always carries fileName/
 * mimeType/byteSize/checksum; mimeType must match format) are enforced
 * here too, not re-implemented.
 *
 * Three functions, one per terminal transition
 * (`generating` -> `succeeded`/`failed`/`cancelled`) plus the initial
 * `generating` row — the caller (`DossierPanel.tsx`) is responsible for
 * calling exactly one of the three finalizers for every record it creates.
 */
import {
  generatedDocumentRecordSchema,
  newId,
  type DocumentFormat,
  type DocumentSourceReference,
  type GeneratedDocumentRecord,
  type WatermarkState,
} from "@formulab/shared";
import { listRecords, upsertRecords, nowIso } from "@/lib/masterdata";

/** SHA-256 of the exact rendered bytes, hex-encoded — computed client-side
 *  via the standard Web Crypto API (no new dependency, works in the
 *  Tauri webview, a real browser, and Node's vitest/jsdom environment). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface StartExportInput {
  reportDefinitionCode: string;
  source: DocumentSourceReference;
  format: DocumentFormat;
  generatedBy: string;
}

/** Creates the `generating` row. Call this only once a valid snapshot
 *  exists (so `source` reflects the real record being exported) — never
 *  before, and never more than once per attempt. */
export async function startExportRecord(input: StartExportInput): Promise<GeneratedDocumentRecord> {
  const record = generatedDocumentRecordSchema.parse({
    schemaVersion: "1.0",
    id: newId("docexport"),
    requestId: newId("docexportreq"),
    reportDefinitionCode: input.reportDefinitionCode,
    source: input.source,
    format: input.format,
    status: "generating",
    generatedAt: nowIso(),
    generatedBy: input.generatedBy,
  });
  await upsertRecords("generated_document_records", [record]);
  return record;
}

export interface FinalizeSuccessInput {
  fileName: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
  watermarkState?: WatermarkState;
  watermarkText?: string;
}

/** Updates the record in place to `succeeded` — never a second row (the
 *  Rust side keys this mutable collection by `id`, see `masterdata.rs`). */
export async function finalizeExportSucceeded(record: GeneratedDocumentRecord, result: FinalizeSuccessInput): Promise<GeneratedDocumentRecord> {
  const updated = generatedDocumentRecordSchema.parse({
    ...record,
    status: "succeeded",
    fileName: result.fileName,
    mimeType: result.mimeType,
    byteSize: result.byteSize,
    checksum: result.checksum,
    watermarkState: result.watermarkState,
    watermarkText: result.watermarkText,
    errorCode: undefined,
    errorMessage: undefined,
  });
  await upsertRecords("generated_document_records", [updated]);
  return updated;
}

export interface FinalizeFailureInput {
  errorCode: string;
  errorMessage: string;
}

/** Updates the record in place to `failed` — the schema itself refuses to
 *  let this carry any success file metadata. */
export async function finalizeExportFailed(record: GeneratedDocumentRecord, error: FinalizeFailureInput): Promise<GeneratedDocumentRecord> {
  const updated = generatedDocumentRecordSchema.parse({
    ...record,
    status: "failed",
    fileName: undefined,
    mimeType: undefined,
    byteSize: undefined,
    checksum: undefined,
    errorCode: error.errorCode,
    errorMessage: error.errorMessage,
  });
  await upsertRecords("generated_document_records", [updated]);
  return updated;
}

/** Updates the record in place to `cancelled` — no success metadata, no
 *  error metadata (the user simply closed the save dialog). */
export async function finalizeExportCancelled(record: GeneratedDocumentRecord): Promise<GeneratedDocumentRecord> {
  const updated = generatedDocumentRecordSchema.parse({
    ...record,
    status: "cancelled",
    fileName: undefined,
    mimeType: undefined,
    byteSize: undefined,
    checksum: undefined,
    errorCode: undefined,
    errorMessage: undefined,
  });
  await upsertRecords("generated_document_records", [updated]);
  return updated;
}

/** Every export-history record on file, newest first — for a future
 *  Reports/history view. Not wired into any UI this session. */
export async function listExportHistory(): Promise<GeneratedDocumentRecord[]> {
  const rows = await listRecords("generated_document_records");
  return [...rows].sort((a, b) => (b.generatedAt > a.generatedAt ? 1 : -1));
}
