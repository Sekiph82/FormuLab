import { describe, expect, it } from "vitest";
import {
  documentExportRequestSchema,
  documentSourceReferenceSchema,
  generatedDocumentRecordSchema,
  reportDefinitionSchema,
  DOCUMENT_FORMAT_MIME_TYPES,
} from "./documentExport";

const SOURCE = {
  sourceEntityType: "formulation_version" as const,
  sourceRecordId: "formulation-1",
  sourceVersionId: "version-1",
  sourceRevision: 3,
  approvalStatusAtGeneration: "concept" as const,
};

function baseRequest(overrides: Partial<Parameters<typeof documentExportRequestSchema.parse>[0]> = {}) {
  return {
    schemaVersion: "1.0" as const,
    id: "req-1",
    reportDefinitionCode: "TEST-REPORT-001",
    format: "pdf" as const,
    source: SOURCE,
    requestedBy: "u1",
    generationTimestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseRecord(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1.0" as const,
    id: "doc-1",
    requestId: "req-1",
    reportDefinitionCode: "TEST-REPORT-001",
    source: SOURCE,
    format: "pdf" as const,
    status: "succeeded" as const,
    generatedAt: "2026-01-01T00:00:01.000Z",
    generatedBy: "u1",
    fileName: "test-report.pdf",
    mimeType: DOCUMENT_FORMAT_MIME_TYPES.pdf,
    byteSize: 1024,
    checksum: "sha256:abc123",
    ...overrides,
  };
}

describe("reportDefinitionSchema", () => {
  it("parses a valid report definition", () => {
    const parsed = reportDefinitionSchema.parse({
      schemaVersion: "1.0",
      id: "def-1",
      code: "TEST-REPORT-001",
      name: "Formula Report",
      reportType: "formula",
      supportedFormats: ["pdf", "docx"],
      sourceEntityType: "formulation_version",
    });
    expect(parsed.active).toBe(true);
    expect(parsed.classification).toBe("normal");
  });
});

describe("documentExportRequestSchema", () => {
  it("parses a valid PDF export request", () => {
    const parsed = documentExportRequestSchema.parse(baseRequest({ format: "pdf" }));
    expect(parsed.format).toBe("pdf");
    expect(parsed.status).toBe("requested");
  });

  it("parses a valid DOCX export request", () => {
    const parsed = documentExportRequestSchema.parse(baseRequest({ format: "docx" }));
    expect(parsed.format).toBe("docx");
  });

  it("requires an explicit generation timestamp", () => {
    const { generationTimestamp, ...withoutTimestamp } = baseRequest();
    expect(() => documentExportRequestSchema.parse(withoutTimestamp)).toThrow();
  });

  it("rejects a non-parseable timestamp", () => {
    expect(() => documentExportRequestSchema.parse(baseRequest({ generationTimestamp: "not-a-date" }))).toThrow();
  });

  it("parses identical input deterministically", () => {
    const input = baseRequest();
    const a = documentExportRequestSchema.parse(input);
    const b = documentExportRequestSchema.parse(input);
    expect(a).toEqual(b);
  });
});

describe("generatedDocumentRecordSchema — success/failure integrity", () => {
  it("parses a valid succeeded record", () => {
    const parsed = generatedDocumentRecordSchema.parse(baseRecord());
    expect(parsed.status).toBe("succeeded");
    expect(parsed.errorCode).toBeUndefined();
  });

  it("parses a valid failed record with failure metadata", () => {
    const parsed = generatedDocumentRecordSchema.parse(
      baseRecord({
        status: "failed",
        fileName: undefined,
        mimeType: undefined,
        byteSize: undefined,
        checksum: undefined,
        errorCode: "RENDER_TIMEOUT",
        errorMessage: "PDF render exceeded the configured timeout.",
      }),
    );
    expect(parsed.status).toBe("failed");
    expect(parsed.errorCode).toBe("RENDER_TIMEOUT");
  });

  it("refuses a failed record that also carries success file metadata", () => {
    expect(() =>
      generatedDocumentRecordSchema.parse(
        baseRecord({ status: "failed", errorCode: "RENDER_TIMEOUT", errorMessage: "timed out" }),
      ),
    ).toThrow();
  });

  it("refuses a succeeded record missing required file metadata", () => {
    expect(() =>
      generatedDocumentRecordSchema.parse(baseRecord({ fileName: undefined })),
    ).toThrow();
  });

  it("refuses a negative byte size", () => {
    expect(() => generatedDocumentRecordSchema.parse(baseRecord({ byteSize: -1 }))).toThrow();
  });

  it("refuses a zero byte size on a succeeded record", () => {
    expect(() => generatedDocumentRecordSchema.parse(baseRecord({ byteSize: 0 }))).toThrow();
  });

  it("refuses an absolute Windows path as fileName", () => {
    expect(() => generatedDocumentRecordSchema.parse(baseRecord({ fileName: "C:\\Users\\me\\report.pdf" }))).toThrow();
  });

  it("refuses an absolute Unix path as fileName", () => {
    expect(() => generatedDocumentRecordSchema.parse(baseRecord({ fileName: "/home/me/report.pdf" }))).toThrow();
  });

  it("accepts a relative fileName", () => {
    expect(() => generatedDocumentRecordSchema.parse(baseRecord({ fileName: "exports/report.pdf" }))).not.toThrow();
  });

  it("keeps PDF and DOCX MIME types coherent with format", () => {
    expect(() =>
      generatedDocumentRecordSchema.parse(
        baseRecord({ format: "docx", mimeType: DOCUMENT_FORMAT_MIME_TYPES.docx, fileName: "test.docx" }),
      ),
    ).not.toThrow();
    expect(() =>
      generatedDocumentRecordSchema.parse(baseRecord({ format: "docx", mimeType: DOCUMENT_FORMAT_MIME_TYPES.pdf })),
    ).toThrow();
  });
});

describe("documentSourceReferenceSchema", () => {
  it("preserves source-version traceability fields", () => {
    const parsed = documentSourceReferenceSchema.parse(SOURCE);
    expect(parsed.sourceVersionId).toBe("version-1");
    expect(parsed.sourceRevision).toBe(3);
  });

  it("leaves unsupplied optional fields blank rather than defaulted", () => {
    const parsed = documentSourceReferenceSchema.parse({
      sourceEntityType: "laboratory_trial",
      sourceRecordId: "trial-1",
    });
    expect(parsed.sourceCode).toBeUndefined();
    expect(parsed.dossierRevision).toBeUndefined();
    expect(parsed.jurisdiction).toBeUndefined();
  });

  it("carries approval status only as read-only source metadata", () => {
    const parsed = documentSourceReferenceSchema.parse(SOURCE);
    expect(parsed.approvalStatusAtGeneration).toBe("concept");
    // No field on this schema can express "approved" beyond echoing the
    // source's own FormulaStatus — there is no separate grant/verify flag.
    expect(Object.keys(documentSourceReferenceSchema.shape)).not.toContain("approved");
  });
});
