import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  buildReferenceFormulationUnresolvedQueue,
  createReferenceFormulationContribution,
  createReferenceFormulationNormalizationVersion,
  createReferenceFormulationRecord,
  createReferenceFormulationSource,
  extractReferenceFormulationIdentity,
  extractReferenceFormulationIngredientLines,
  extractReferenceFormulationProcedure,
  extractReferenceFormulationTargets,
  matchReferenceFormulationProducts,
  referenceFormulationImportFileSchema,
  referenceFormulationImportJobSchema,
  searchReferenceFormulationLocalIndex,
  supplierDocumentAcquisitionSchema,
  validateReferenceFormulationArithmetic,
} from "@formulab/shared";

const { collections, listRecordsMock, upsertRecordsMock, nowIsoMock, storePdfMock, failUpsertOnce } = vi.hoisted(() => {
  const collections = new Map<string, Record<string, unknown>[]>();
  const failUpsertOnce: { collection: string; matches: (rows: Record<string, unknown>[]) => boolean }[] = [];
  return {
    collections,
    failUpsertOnce,
    listRecordsMock: vi.fn(async (collection: string) => collections.get(collection) ?? []),
    upsertRecordsMock: vi.fn(async (collection: string, rows: Record<string, unknown>[]) => {
      const failureIndex = failUpsertOnce.findIndex((failure) => failure.collection === collection && failure.matches(rows));
      if (failureIndex >= 0) {
        failUpsertOnce.splice(failureIndex, 1);
        throw new Error("simulated transient persistence interruption");
      }
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

import { pagesFromExtraction, resumeReferenceFormulationBulkImport, startReferenceFormulationBulkImport } from "./referenceFormulationBulkImport";
import { SUPPLIER_PDF_TEXT_PARSER_VERSION } from "./supplierPdfTextExtraction";
import { rebuildReferenceFormulationCorpusIndex } from "./referenceFormulationNormalizations";

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

async function validPdf(width = 300, title?: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  if (title) document.setTitle(title);
  document.addPage([width, 300]);
  return document.save();
}

const SCALE_FIXTURE_DATE = "2026-10-26T12:00:00.000Z";

function buildSyntheticScaleFormula(index: number) {
  const ordinal = index.toString().padStart(4, "0");
  const id = `synthetic-scale-${ordinal}`;
  const hash = index.toString(16).padStart(64, "0");
  const acquisition = supplierDocumentAcquisitionSchema.parse({
    schemaVersion: "1.0",
    code: `acquisition-${id}`,
    supplierId: "supplier-synthetic-formula-corpus",
    providerId: "synthetic-structural-fixture",
    surfaceId: "synthetic-scale-acceptance",
    documentType: "FORMULATION",
    acquisitionMethod: "manual_assisted",
    sourceFileSelection: {
      selectionId: `selection-${id}`,
      originalFilename: `${id}.pdf`,
      sourceFileSha256: hash,
      selectedAt: SCALE_FIXTURE_DATE,
      selectedBy: "synthetic-test-fixture",
    },
    sourceProduct: { tradeName: `Synthetic scale formula ${ordinal}` },
    market: "test",
    language: "en",
    originalFilename: `${id}.pdf`,
    mimeType: "application/pdf",
    sha256: hash,
    byteSize: 1024,
    parserStatus: "completed",
    acquiredAt: SCALE_FIXTURE_DATE,
    createdAt: SCALE_FIXTURE_DATE,
  });
  const source = createReferenceFormulationSource({
    id: `source-${id}`,
    acquisition,
    title: `Synthetic scale formula ${ordinal}`,
    parserVersion: "synthetic-structural-fixture-v1",
    rights: { status: "owner_provided", redistribution: "unknown", evidenceRefs: ["synthetic-structural-fixture"] },
    createdAt: SCALE_FIXTURE_DATE,
  });
  const pages = [{ pageNumber: 1, blocks: [
    { type: "heading" as const, blockIndex: 0, text: "Synthetic Fixture Formula" },
    { type: "table" as const, blockIndex: 1, rows: [
      ["Ingredient", "Amount", "Unit", "Basis"],
      [`Synthetic fixture ingredient ${ordinal}`, "1", "%", "w/w"],
    ] },
  ] }];
  const identity = extractReferenceFormulationIdentity({ acquisition, pages });
  const ingredientResult = extractReferenceFormulationIngredientLines({ source, pages });
  const arithmetic = validateReferenceFormulationArithmetic({ source, lines: ingredientResult.lines });
  const procedure = extractReferenceFormulationProcedure({ source, pages });
  const targets = extractReferenceFormulationTargets({ source, pages });
  const matching = matchReferenceFormulationProducts({ source, lines: ingredientResult.lines, products: [] });
  const unresolved = buildReferenceFormulationUnresolvedQueue({ source, lines: ingredientResult.lines, matching, products: [] });
  const record = createReferenceFormulationRecord({
    id: `record-${id}`,
    code: `record-${id}`,
    source,
    identityCandidates: identity.candidates,
    identityMetadataComparisons: identity.metadataComparisons,
    identityWarnings: identity.warnings,
    ingredientLines: ingredientResult.lines,
    arithmetic,
    procedureSteps: procedure.steps,
    procedureWarnings: procedure.warnings,
    targetCandidates: targets.candidates,
    targetWarnings: targets.warnings,
    productMatches: matching.lines,
    productMatchWarnings: matching.warnings,
    unresolvedEntries: unresolved.entries,
    createdAt: SCALE_FIXTURE_DATE,
  });
  const componentContributions = Object.fromEntries(record.ingredientLines.map((line) => [line.id, [
    createReferenceFormulationContribution({ source: record, sourceFormulaLineId: line.id }),
  ]]));
  const normalization = createReferenceFormulationNormalizationVersion({
    id: `normalization-${id}`,
    source: record,
    version: 1,
    componentContributions,
    createdAt: SCALE_FIXTURE_DATE,
  });
  return { record, normalization };
}

describe("reference formulation bulk import", () => {
  beforeEach(() => {
    collections.clear();
    failUpsertOnce.length = 0;
    vi.clearAllMocks();
  });

  it("reconstructs positioned supplier PDF columns and wrapped procedure text as cited review blocks", () => {
    const row = (lineNumber: number, y: number, cells: [string, string, string]) => ({
      lineNumber, text: cells.join(" "), position: { x: 77.4, y },
      fragments: cells.map((text, index) => ({ text, x: [77.4, 288.8, 472.7][index]!, width: 20 })),
    });
    const lines = [
      { lineNumber: 1, text: "Hand Dishwash Detergent Liquid HC/DW/22", position: { x: 79.9, y: 663.6 }, fragments: [
        { text: "Hand Dishwash Detergent Liquid", x: 79.9, width: 189 }, { text: "HC/DW/22", x: 471.9, width: 69 },
      ] },
      { lineNumber: 2, text: "Procedure: Add ingredients in order listed", position: { x: 72, y: 631 }, fragments: [{ text: "Procedure: Add ingredients in order listed", x: 72, width: 280 }] },
      { lineNumber: 3, text: "Use citric acid to adjust pH to ~7", position: { x: 72, y: 618 }, fragments: [{ text: "Use citric acid to adjust pH to ~7", x: 72, width: 250 }] },
      { lineNumber: 4, text: "EBC Crothix Liquid HC MBAL to thicken and stir until clear", position: { x: 72, y: 605 }, fragments: [{ text: "EBC Crothix Liquid HC MBAL to thicken and stir until clear", x: 72, width: 350 }] },
      { lineNumber: 5, text: "Ingredient/INCI Name Functionality % w/w", position: { x: 77.4, y: 579.4 }, fragments: [
        { text: "Ingredient/INCI Name", x: 77.4, width: 108 }, { text: "Functionality", x: 288.8, width: 63 }, { text: "% w/w", x: 472.7, width: 34 },
      ] },
      row(6, 564.4, ["DI Water", "Diluent", "80.7"]),
      row(7, 549.5, ["SLE(3)S (30%, aq.)", "Anionic detergent", "3.0"]),
      row(8, 534.6, ["Incromine Oxide C", "Nonionic detergent", "3.0"]),
      row(9, 519.7, ["ECO Brij L6L", "Nonionic detergent", "4.0"]),
      row(10, 504.8, ["NatraSense AG-810", "Alkylpolyglucoside detergent", "3.0"]),
      row(11, 490, ["Crodateric CDA 38", "Hydrotrope/stabilizer", "3.0"]),
      row(12, 475, ["Citric acid (25%, aq.)", "pH adjuster (to pH 7)", "0.3"]),
      row(13, 460.1, ["EBC Crothix Liquid HC MBAL", "Thickening agent", "3.0"]),
      row(14, 445.2, ["Total", "-", "100.0"]),
      row(15, 430.3, ["Viscosity (cP)", "-", "~375"]),
    ];
    const extraction = {
      status: "extracted" as const,
      documentHash: "a".repeat(64), parserVersion: SUPPLIER_PDF_TEXT_PARSER_VERSION as typeof SUPPLIER_PDF_TEXT_PARSER_VERSION, pageCount: 1, warnings: [],
      pages: [{ pageNumber: 1, lines }],
    };
    const pages = pagesFromExtraction(extraction, []);
    const table = pages[0]?.blocks.find((block) => block.type === "table");
    expect(table).toMatchObject({ type: "table", rows: expect.arrayContaining([
      ["NatraSense AG-810", "Alkylpolyglucoside detergent", "3.0"],
      ["Viscosity (cP)", "-", "~375"],
    ]) });
    const procedureText = pages[0]?.blocks.filter((block) => block.type === "text").map((block) => block.text)
      .find((text) => text.startsWith("Procedure:"));
    expect(procedureText)
      .toContain("Use citric acid to adjust pH to ~7 EBC Crothix Liquid");
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

  it("retries after PDF storage succeeds but acquisition persistence is interrupted", async () => {
    const bytes = await validPdf();
    failUpsertOnce.push({ collection: "supplier_document_acquisitions", matches: () => true });

    const interrupted = await startReferenceFormulationBulkImport([selectedFile("downloaded.pdf", bytes)], metadata);
    expect(interrupted.job).toMatchObject({ status: "completed_with_errors", failedFiles: 1 });
    expect(interrupted.files[0]).toMatchObject({ status: "failed", errorCode: "acquisition_failed", attemptCount: 1 });
    expect(storePdfMock).toHaveBeenCalledTimes(1);
    expect(collections.get("supplier_document_acquisitions") ?? []).toHaveLength(0);

    const resumed = await resumeReferenceFormulationBulkImport(interrupted.job.id, [selectedFile("downloaded.pdf", bytes)]);

    expect(resumed.job).toMatchObject({ status: "completed", reviewRequiredFiles: 1, failedFiles: 0 });
    expect(resumed.files[0]).toMatchObject({ status: "review_required", attemptCount: 2 });
    expect(storePdfMock).toHaveBeenCalledTimes(2);
    expect(storePdfMock.mock.calls[0]?.[1]).toBe(storePdfMock.mock.calls[1]?.[1]);
    expect(collections.get("supplier_document_acquisitions")).toHaveLength(1);
    expect(collections.get("reference_formulations")).toHaveLength(1);
  });

  it("retries parsing from the existing acquisition without duplicating the stored source", async () => {
    const bytes = await validPdf();
    failUpsertOnce.push({ collection: "reference_formulations", matches: () => true });

    const interrupted = await startReferenceFormulationBulkImport([selectedFile("parse-retry.pdf", bytes)], metadata);
    expect(interrupted.files[0]).toMatchObject({ status: "failed", errorCode: "parser_failed", attemptCount: 1 });
    expect(collections.get("supplier_document_acquisitions")).toHaveLength(1);
    expect(collections.get("reference_formulations") ?? []).toHaveLength(0);

    const resumed = await resumeReferenceFormulationBulkImport(interrupted.job.id, [selectedFile("parse-retry.pdf", bytes)]);

    expect(resumed.job).toMatchObject({ status: "completed", reviewRequiredFiles: 1, failedFiles: 0 });
    expect(resumed.files[0]).toMatchObject({ status: "review_required", attemptCount: 2 });
    expect(storePdfMock).toHaveBeenCalledTimes(1);
    expect(collections.get("supplier_document_acquisitions")).toHaveLength(1);
    expect(collections.get("reference_formulations")).toHaveLength(1);
  });

  it("recovers a processing checkpoint and avoids a duplicate formula when completion persistence is interrupted", async () => {
    const bytes = await validPdf();
    failUpsertOnce.push({
      collection: "reference_formulation_import_files",
      matches: (rows) => rows.some((row) => row.status === "review_required"),
    });

    const interrupted = await startReferenceFormulationBulkImport([selectedFile("commit-retry.pdf", bytes)], metadata);
    expect(interrupted.files[0]).toMatchObject({ status: "failed", errorCode: "parser_failed", attemptCount: 1 });
    expect(collections.get("reference_formulations")).toHaveLength(1);

    const persistedRecordId = (collections.get("reference_formulations")![0] as { id: string }).id;
    const currentFile = collections.get("reference_formulation_import_files")![0]!;
    collections.set("reference_formulation_import_files", [{ ...currentFile, status: "processing", errorCode: undefined, errorMessage: undefined }]);
    const resumed = await resumeReferenceFormulationBulkImport(interrupted.job.id, [selectedFile("commit-retry.pdf", bytes)]);

    expect(resumed.job).toMatchObject({ status: "completed", duplicateFiles: 1, reviewRequiredFiles: 0, failedFiles: 0 });
    expect(resumed.files[0]).toMatchObject({ status: "duplicate", attemptCount: 2 });
    expect(resumed.files[0]?.duplicateOfSourceRecordId).toBe(persistedRecordId);
    expect(collections.get("supplier_document_acquisitions")).toHaveLength(1);
    expect(collections.get("reference_formulations")).toHaveLength(1);
    expect(storePdfMock).toHaveBeenCalledTimes(1);
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

  it("ingests a multi-supplier fixture corpus, rebuilds its index, and leaves production master data untouched", async () => {
    const suppliers = ["supplier-croda", "supplier-evonik", "supplier-dow"];
    const supplierBytes = new Map<string, Uint8Array>();
    for (const [index, supplierId] of suppliers.entries()) {
      const bytes = await validPdf(280 + index * 20);
      supplierBytes.set(supplierId, bytes);
      await startReferenceFormulationBulkImport(
        [selectedFile(`${supplierId}-synthetic.pdf`, bytes)],
        { ...metadata, supplierId, rights: { ...metadata.rights, evidenceRefs: [`fixture:${supplierId}`] } },
      );
    }
    const sourceRecords = collections.get("reference_formulations") ?? [];
    expect(sourceRecords).toHaveLength(3);
    expect(new Set(sourceRecords.map((row) => (row.source as { supplierId: string }).supplierId))).toEqual(new Set(suppliers));
    expect(sourceRecords.every((row) => row.reviewStatus === "unreviewed")).toBe(true);
    expect(collections.get("supplier_document_acquisitions")).toHaveLength(3);
    expect(collections.has("materials")).toBe(false);
    expect(collections.has("formulations")).toBe(false);
    expect(collections.has("formula_versions")).toBe(false);

    const firstRebuild = await rebuildReferenceFormulationCorpusIndex();
    const secondRebuild = await rebuildReferenceFormulationCorpusIndex();
    expect(firstRebuild).toEqual(secondRebuild);
    expect(firstRebuild.queryRecords.map((record) => record.supplierId).sort()).toEqual([...suppliers].sort());
    expect(firstRebuild.index.queryRecordIds).toHaveLength(3);

    const persistedCorpus = new Map([
      "reference_formulations", "reference_formulation_normalizations", "supplier_sds_product_evidence",
    ].map((collection) => [collection, structuredClone(collections.get(collection) ?? [])]));
    collections.clear();
    for (const [collection, rows] of persistedCorpus) collections.set(collection, rows);
    const restoredRebuild = await rebuildReferenceFormulationCorpusIndex();
    expect(restoredRebuild).toEqual(firstRebuild);

    const duplicate = await startReferenceFormulationBulkImport(
      [selectedFile("supplier-croda-duplicate.pdf", supplierBytes.get("supplier-croda")!)],
      { ...metadata, supplierId: "supplier-croda" },
    );
    expect(duplicate.job.duplicateFiles).toBe(1);
    expect(collections.get("reference_formulations")).toHaveLength(3);
    expect(collections.has("materials")).toBe(false);
  });

  it("benchmarks 2,000 PDF imports and 2,000 normalized synthetic formulas", async () => {
    const formulaCount = 2_000;
    const productionSentinels = new Map<string, Record<string, unknown>[]>([
      ["materials", [{ id: "owner-material-sentinel", code: "OWNER-MATERIAL", name: "Unchanged owner material" }]],
      ["formulations", [{ id: "owner-formulation-sentinel", code: "OWNER-FORMULA", name: "Unchanged owner formulation" }]],
      ["formula_versions", [{ id: "owner-version-sentinel", code: "OWNER-VERSION", version: 7 }]],
    ]);
    for (const [collection, rows] of productionSentinels) collections.set(collection, structuredClone(rows));
    const productionSnapshot = new Map([...productionSentinels.keys()].map((collection) => [
      collection,
      structuredClone(collections.get(collection)),
    ]));
    const totalStartedAt = performance.now();
    const pdfs: Uint8Array[] = [];
    for (let index = 0; index < formulaCount; index += 1) {
      // Unique valid, empty PDFs exercise the structural bulk path without
      // introducing supplier claims, chemistry, or fabricated formula lines.
      pdfs.push(await validPdf(300, `synthetic-scale-fixture-${index.toString().padStart(4, "0")}`));
    }
    const selected = pdfs.map((bytes, index) => selectedFile(`synthetic-formula-${index.toString().padStart(4, "0")}.pdf`, bytes));
    const ingestionStartedAt = performance.now();
    const imported = await startReferenceFormulationBulkImport(selected, {
      ...metadata,
      supplierId: "supplier-synthetic-scale-fixture",
      rights: { ...metadata.rights, evidenceRefs: ["synthetic-structural-fixture"] },
    });
    const ingestionMs = Math.round(performance.now() - ingestionStartedAt);

    expect(imported.job).toMatchObject({
      status: "completed",
      totalFiles: formulaCount,
      processedFiles: formulaCount,
      reviewRequiredFiles: formulaCount,
      duplicateFiles: 0,
      failedFiles: 0,
    });
    expect(imported.files).toHaveLength(formulaCount);
    expect(imported.files.every((item) => item.status === "review_required")).toBe(true);
    expect(collections.get("reference_formulations")).toHaveLength(formulaCount);
    expect(collections.get("supplier_document_acquisitions")).toHaveLength(formulaCount);
    for (const collection of productionSentinels.keys()) {
      expect(collections.get(collection)).toEqual(productionSnapshot.get(collection));
    }

    // Separately exercise source-line normalization over a 2,000-formula
    // structural corpus. These records use synthetic labels/amounts and have
    // no supplier SDS or canonical chemistry assertions.
    const structuralCorpus = Array.from({ length: formulaCount }, (_, index) => buildSyntheticScaleFormula(index + 1));
    collections.set("reference_formulations", [
      ...(collections.get("reference_formulations") ?? []),
      ...structuralCorpus.map(({ record }) => record),
    ]);
    collections.set("reference_formulation_normalizations", structuralCorpus.map(({ normalization }) => normalization));

    const rebuildStartedAt = performance.now();
    const firstRebuild = await rebuildReferenceFormulationCorpusIndex();
    const rebuildMs = Math.round(performance.now() - rebuildStartedAt);
    expect(firstRebuild.queryRecords).toHaveLength(formulaCount * 2);
    const normalizedFixtures = firstRebuild.queryRecords.filter((record) => record.supplierId === "supplier-synthetic-formula-corpus");
    expect(normalizedFixtures).toHaveLength(formulaCount);
    expect(normalizedFixtures.every((record) => record.lines.length === 1 && record.reviewRequired)).toBe(true);
    expect(normalizedFixtures.every((record) => record.lines[0]?.componentContributions.some((item) => item.status === "unknown" && item.sourceSds.status === "missing"))).toBe(true);
    expect(firstRebuild.index.queryRecordIds).toHaveLength(formulaCount * 2);
    const matchingFormulaIds = searchReferenceFormulationLocalIndex(firstRebuild.index, {
      aliases: ["Synthetic scale formula 1000"],
      supplierIds: ["supplier-synthetic-formula-corpus"],
    });
    expect(matchingFormulaIds).toHaveLength(1);
    expect(matchingFormulaIds[0]).toContain("record-synthetic-scale-1000");
    for (const collection of productionSentinels.keys()) {
      expect(collections.get(collection)).toEqual(productionSnapshot.get(collection));
    }
    expect(await rebuildReferenceFormulationCorpusIndex()).toEqual(firstRebuild);

    console.info(JSON.stringify({
      benchmark: "synthetic-reference-formulation-corpus-v1",
      importedPdfCount: formulaCount,
      normalizedFormulaCount: normalizedFixtures.length,
      indexedQueryRecordCount: firstRebuild.queryRecords.length,
      ingestionMs,
      rebuildMsForIndexedQueryRecordCount: rebuildMs,
      totalMs: Math.round(performance.now() - totalStartedAt),
      fixture: "separate unique empty PDFs and structural formula records; no supplier chemistry or formula claims",
    }));
  }, 180_000);
});
