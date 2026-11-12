import {
  analyzeReferenceFormulationLayout,
  buildReferenceFormulationUnresolvedQueue,
  createReferenceFormulationRecord,
  createReferenceFormulationSource,
  extractReferenceFormulationIdentity,
  extractReferenceFormulationIngredientLines,
  extractReferenceFormulationProcedure,
  extractReferenceFormulationTargets,
  matchReferenceFormulationProducts,
  referenceFormulationImportFileSchema,
  referenceFormulationImportJobSchema,
  summarizeReferenceFormulationImport,
  validateReferenceFormulationArithmetic,
  REFERENCE_FORMULATION_LAYOUT_PARSER_VERSION,
  type ReferenceFormulationImportFile,
  type ReferenceFormulationImportJob,
  type ReferenceFormulationRights,
} from "@formulab/shared";
import { recordReferenceFormulation } from "./referenceFormulations";
import { runConditionalReferenceFormulationOcr } from "./referenceFormulationOcr";
import { extractSupplierPdfText } from "./supplierPdfTextExtraction";
import { SUPPLIER_PDF_DEFAULT_MAX_BYTES } from "./supplierDocumentAdmission";
import { recordSupplierDocumentAcquisition } from "./supplierDocumentAcquisitions";
import { listRecords, nowIso, storeSupplierDocumentPdf, upsertRecords } from "./masterdata";

const FILE_BATCH_WRITE_SIZE = 100;
const MAX_BULK_FILES = 5_000;
const SAFE_FAILURES = {
  invalid_pdf: "The selected file did not pass PDF admission.",
  file_too_large: "The selected file exceeds the supported PDF size limit.",
  storage_failed: "The admitted PDF could not be stored in the project document store.",
  acquisition_failed: "The supplier document receipt could not be recorded.",
  parser_failed: "The PDF could not be converted into a source-linked formulation record.",
  record_conflict: "An immutable source record with this identity already has different contents.",
  source_unavailable: "The selected file could not be read or did not match its saved source hash.",
} as const;

export interface SelectedReferenceFormulationPdf {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ReferenceFormulationBulkImportMetadata {
  supplierId: string;
  providerId: string;
  surfaceId: string;
  market: string;
  language: string;
  rights: ReferenceFormulationRights;
  requestedBy: string;
}

export interface ReferenceFormulationBulkImportResult {
  job: ReferenceFormulationImportJob;
  files: ReferenceFormulationImportFile[];
}

class ImportFileFailure extends Error {
  constructor(readonly code: keyof typeof SAFE_FAILURES) {
    super(SAFE_FAILURES[code]);
  }
}

class ImportBatchPaused extends Error {}

function sanitizedFilename(input: string): string {
  const parts = input.split(/[\\/]/u);
  const basename = parts[parts.length - 1] ?? "selected-file";
  let value = basename.normalize("NFKC").replace(/[^A-Za-z0-9._ ()-]/gu, "_")
    .replace(/\.{2,}/gu, "_").replace(/^\.+/u, "_").replace(/[. ]+$/u, "").slice(0, 150);
  if (!value || value === "." || value === "..") value = "selected-file";
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu.test(value)) value = `_${value}`;
  return value;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", owned.buffer));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sourceIdempotencyKey(supplierId: string, providerId: string, surfaceId: string, digest: string): Promise<string> {
  const identity = `${supplierId.normalize("NFKC").trim().toLocaleLowerCase("en-US")}\n${providerId.normalize("NFKC").trim().toLocaleLowerCase("en-US")}\n${surfaceId.normalize("NFKC").trim().toLocaleLowerCase("en-US")}\nFORMULATION\n${digest.toLowerCase()}`;
  return `sha256:${await sha256(new TextEncoder().encode(identity))}`;
}

function batchScopedKey(jobId: string, ordinal: number): Promise<string> {
  return sha256(new TextEncoder().encode(`${jobId}\n${ordinal}`)).then((digest) => `sha256:${digest}`);
}

async function persistFiles(files: ReferenceFormulationImportFile[]): Promise<void> {
  for (let offset = 0; offset < files.length; offset += FILE_BATCH_WRITE_SIZE) {
    await upsertRecords("reference_formulation_import_files", files.slice(offset, offset + FILE_BATCH_WRITE_SIZE));
  }
}

function fileFailure(
  file: ReferenceFormulationImportFile,
  code: keyof typeof SAFE_FAILURES,
  updatedAt: string,
): ReferenceFormulationImportFile {
  return referenceFormulationImportFileSchema.parse({
    ...file, status: "failed", errorCode: code, errorMessage: SAFE_FAILURES[code], updatedAt,
  });
}

/** Create a persistent batch manifest before any PDF is parsed. Only file basenames, hashes and progress are stored; local paths and bytes are never persisted in job rows. */
export async function startReferenceFormulationBulkImport(
  selectedFiles: SelectedReferenceFormulationPdf[],
  metadataInput: ReferenceFormulationBulkImportMetadata,
  signal?: AbortSignal,
): Promise<ReferenceFormulationBulkImportResult> {
  if (selectedFiles.length === 0 || selectedFiles.length > MAX_BULK_FILES) {
    throw new RangeError(`Bulk import requires between 1 and ${MAX_BULK_FILES} selected files.`);
  }
  const createdAt = nowIso();
  const jobId = `reference-import-${globalThis.crypto.randomUUID()}`;
  const jobBase = referenceFormulationImportJobSchema.parse({
    schemaVersion: "1.0", id: jobId,
    supplierId: metadataInput.supplierId,
    providerId: metadataInput.providerId,
    surfaceId: metadataInput.surfaceId,
    market: metadataInput.market,
    language: metadataInput.language,
    rights: metadataInput.rights,
    requestedBy: metadataInput.requestedBy,
    status: "running",
    totalFiles: selectedFiles.length,
    processedFiles: 0,
    reviewRequiredFiles: 0,
    duplicateFiles: 0,
    failedFiles: 0,
    createdAt,
    updatedAt: createdAt,
  });

  const files: ReferenceFormulationImportFile[] = [];
  for (const [index, selected] of selectedFiles.entries()) {
    const ordinal = index + 1;
    const filename = sanitizedFilename(selected.name);
    const itemBase = referenceFormulationImportFileSchema.parse({
      schemaVersion: "1.0", id: `${jobId}:file:${ordinal}`, jobId, ordinal,
      idempotencyKey: await batchScopedKey(jobId, ordinal), originalFilename: filename,
      status: "failed", attemptCount: 0, errorCode: "source_unavailable",
      errorMessage: SAFE_FAILURES.source_unavailable, createdAt, updatedAt: createdAt,
    });
    let item: ReferenceFormulationImportFile;
    if (!Number.isSafeInteger(selected.size) || selected.size < 1) {
      item = fileFailure(itemBase, "invalid_pdf", createdAt);
    } else if (selected.size > SUPPLIER_PDF_DEFAULT_MAX_BYTES) {
      item = fileFailure(itemBase, "file_too_large", createdAt);
    } else {
      try {
        const bytes = new Uint8Array(await selected.arrayBuffer());
        const digest = await sha256(bytes);
        item = referenceFormulationImportFileSchema.parse({
          ...itemBase,
          status: "queued", errorCode: undefined, errorMessage: undefined,
          sourceDocumentHash: digest,
          idempotencyKey: await sourceIdempotencyKey(jobBase.supplierId, jobBase.providerId, jobBase.surfaceId, digest),
        });
      } catch {
        item = fileFailure(itemBase, "source_unavailable", nowIso());
      }
    }
    files.push(item);
  }

  const job = summarizeReferenceFormulationImport(jobBase, files, nowIso());
  await upsertRecords("reference_formulation_import_jobs", [job]);
  await persistFiles(files);
  return resumeReferenceFormulationBulkImport(job.id, selectedFiles, signal);
}

export function pagesFromExtraction(
  extraction: Awaited<ReturnType<typeof extractSupplierPdfText>> & { status: "extracted" },
  ocrLines: Array<{ pageNumber: number; text: string; confidence: number; source: "ocr" }>,
) {
  return extraction.pages.map((page) => {
    type TextBlock = {
      type: "text"; blockIndex: number; text: string; source: "digital" | "ocr"; confidence?: number;
      position?: { x: number; y: number };
    };
    type TableBlock = { type: "table"; blockIndex: number; rows: string[][]; source: "digital"; position?: { x: number; y: number } };
    const positioned = [...page.lines].sort((left, right) => (right.position?.y ?? 0) - (left.position?.y ?? 0));
    const headerIndex = positioned.findIndex((line) => line.fragments?.some((fragment) => /ingredient\s*\/\s*inci\s*name/i.test(fragment.text))
      && line.fragments.some((fragment) => /functionality|function/i.test(fragment.text))
      && line.fragments.some((fragment) => /%\s*w\s*\/\s*w|weight\s*percent/i.test(fragment.text)));
    let table: TableBlock | undefined;
    if (headerIndex >= 0) {
      const headerLine = positioned[headerIndex]!;
      const columns = headerLine.fragments!.filter((fragment) => fragment.text.trim()).map((fragment) => ({
        x: fragment.x,
        header: fragment.text.trim(),
      })).sort((left, right) => left.x - right.x);
      if (columns.length >= 3) {
        const rows: string[][] = [columns.map((column) => column.header)];
        let previousY = headerLine.position?.y ?? 0;
        for (const line of positioned.slice(headerIndex + 1)) {
          const y = line.position?.y ?? previousY;
          if (previousY - y > 24) break;
          if (!line.fragments?.length) continue;
          const cells = columns.map(() => "");
          for (const fragment of line.fragments) {
            const columnIndex = columns.reduce((best, column, index) => column.x <= fragment.x ? index : best, 0);
            cells[columnIndex] = [cells[columnIndex], fragment.text.trim()].filter(Boolean).join(" ");
          }
          if (cells.some(Boolean)) rows.push(cells);
          previousY = y;
          if (/^viscosity\b/i.test(cells[0] ?? "")) break;
        }
        if (rows.length > 1) table = {
          type: "table", blockIndex: 0, rows, source: "digital",
          ...(headerLine.position ? { position: headerLine.position } : {}),
        };
      }
    }
    const blocks: Array<TextBlock | TableBlock> = [];
    const consumedProcedureLines = new Set<number>();
    let nextIndex = 0;
    for (let index = 0; index < positioned.length; index += 1) {
      if (index === headerIndex) {
        if (table) { table.blockIndex = nextIndex; blocks.push(table); nextIndex += 1; }
        continue;
      }
      const line = positioned[index]!;
      if (consumedProcedureLines.has(line.lineNumber)) continue;
      let combinedText = line.text;
      if (/^procedure\s*:/i.test(line.text) && line.position) {
        let previousY = line.position.y;
        for (const continuation of positioned.slice(index + 1)) {
          if (continuation === positioned[headerIndex] || !continuation.position || previousY - continuation.position.y > 24) break;
          if (consumedProcedureLines.has(continuation.lineNumber)) continue;
          combinedText += ` ${continuation.text}`;
          consumedProcedureLines.add(continuation.lineNumber);
          previousY = continuation.position.y;
        }
      }
      blocks.push({
        type: "text", blockIndex: nextIndex++, text: combinedText, source: "digital",
        ...(line.position && line.position.x >= 0 && line.position.y >= 0 ? { position: line.position } : {}),
      });
    }
    for (const line of ocrLines.filter((candidate) => candidate.pageNumber === page.pageNumber)) {
      blocks.push({ type: "text", blockIndex: nextIndex++, text: line.text, source: "ocr", confidence: line.confidence });
    }
    return { pageNumber: page.pageNumber, blocks };
  });
}

async function buildAndPersistReferenceRecord(input: {
  job: ReferenceFormulationImportJob;
  item: ReferenceFormulationImportFile;
  acquisition: Awaited<ReturnType<typeof recordSupplierDocumentAcquisition>>;
  bytes: Uint8Array;
  extraction: Awaited<ReturnType<typeof extractSupplierPdfText>>;
  signal?: AbortSignal;
}): Promise<{ recordId: string; acquisitionCode: string }> {
  if (input.extraction.status !== "extracted") throw new ImportFileFailure("invalid_pdf");
  const ocr = await runConditionalReferenceFormulationOcr({
    acquisition: input.acquisition,
    extraction: input.extraction,
    options: { languages: ["eng"], sourcePdfBytes: input.bytes },
  }, input.signal);
  if (ocr.status === "cancelled") throw new ImportBatchPaused();
  const pages = pagesFromExtraction(input.extraction, ocr.lines);
  const layout = analyzeReferenceFormulationLayout({ sourceDocumentHash: input.acquisition.sha256, pages });
  const identity = extractReferenceFormulationIdentity({ acquisition: input.acquisition, pages });
  const sourceTitle = identity.candidates.find((candidate) => candidate.field === "formulation_title")?.rawValue
    ?? input.item.originalFilename.replace(/\.pdf$/iu, "");
  const sourceRevision = identity.candidates.find((candidate) => candidate.field === "revision_identifier")?.rawValue;
  const revisionDate = identity.candidates.find((candidate) => candidate.field === "revision_date")?.rawValue;
  const publicationDate = identity.candidates.find((candidate) => candidate.field === "publication_date")?.rawValue;
  const formulationCode = identity.candidates.find((candidate) => candidate.field === "formulation_code")?.rawValue;
  const source = createReferenceFormulationSource({
    id: `reference-source-${input.acquisition.sha256}-${layout.parserVersion.replace(/[^a-z0-9-]/giu, "-").toLocaleLowerCase("en-US")}`,
    acquisition: input.acquisition,
    ...(publicationDate ? { publicationDate } : {}),
    ...(revisionDate ? { revisionDate } : {}),
    ...(sourceRevision ? { sourceRevision } : {}),
    ...(formulationCode ? { formulationCode } : {}),
    title: sourceTitle,
    parserVersion: layout.parserVersion,
    rights: input.job.rights,
    createdAt: nowIso(),
  });
  const ingredients = extractReferenceFormulationIngredientLines({ source, pages });
  const arithmetic = validateReferenceFormulationArithmetic({ source, lines: ingredients.lines });
  const procedure = extractReferenceFormulationProcedure({ source, pages });
  const targets = extractReferenceFormulationTargets({ source, pages });
  // No product catalog or crosswalk is inferred from a PDF filename. Until a
  // reviewed product mapping exists, each extracted line remains unresolved.
  const products: [] = [];
  const matching = matchReferenceFormulationProducts({ source, lines: ingredients.lines, products });
  const acquisitions = await listRecords("supplier_document_acquisitions");
  const unresolved = buildReferenceFormulationUnresolvedQueue({
    source,
    lines: ingredients.lines,
    matching,
    products,
    supplierDocuments: acquisitions,
  });
  const recordKey = `${input.acquisition.sha256}-${layout.parserVersion.replace(/[^a-z0-9-]/giu, "-").toLocaleLowerCase("en-US")}`;
  const record = createReferenceFormulationRecord({
    id: `reference-formula-${recordKey}`,
    code: `reference-formula-${recordKey}`,
    source,
    identityCandidates: identity.candidates,
    identityMetadataComparisons: identity.metadataComparisons,
    identityWarnings: identity.warnings,
    ingredientLines: ingredients.lines,
    arithmetic,
    procedureSteps: procedure.steps,
    procedureWarnings: procedure.warnings,
    targetCandidates: targets.candidates,
    targetWarnings: targets.warnings,
    productMatches: matching.lines,
    productMatchWarnings: matching.warnings,
    unresolvedEntries: unresolved.entries,
    createdAt: nowIso(),
  });
  const saved = await recordReferenceFormulation(record);
  return { recordId: saved.id, acquisitionCode: input.acquisition.code };
}

async function processOneFile(input: {
  job: ReferenceFormulationImportJob;
  item: ReferenceFormulationImportFile;
  selected: SelectedReferenceFormulationPdf;
  signal?: AbortSignal;
}): Promise<{ status: "review_required" | "duplicate"; acquisitionCode?: string; recordId?: string; duplicateRecordId?: string }> {
  if (input.selected.size > SUPPLIER_PDF_DEFAULT_MAX_BYTES) throw new ImportFileFailure("file_too_large");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await input.selected.arrayBuffer());
  } catch {
    throw new ImportFileFailure("source_unavailable");
  }
  const digest = await sha256(bytes);
  if (input.item.sourceDocumentHash && digest !== input.item.sourceDocumentHash) throw new ImportFileFailure("source_unavailable");
  const extraction = await extractSupplierPdfText({
    bytes,
    filename: input.selected.name,
    declaredMimeType: input.selected.type || "application/octet-stream",
  });
  if (extraction.status !== "extracted") throw new ImportFileFailure("invalid_pdf");
  if (extraction.documentHash !== digest) throw new ImportFileFailure("source_unavailable");

  const existingSources = await listRecords("reference_formulations");
  const duplicate = existingSources.find((source) => source.source.supplierId === input.job.supplierId
    && source.sourceDocumentHash.toLowerCase() === digest
    && source.source.parserVersion === REFERENCE_FORMULATION_LAYOUT_PARSER_VERSION);
  if (duplicate) return { status: "duplicate", duplicateRecordId: duplicate.id };

  const existingAcquisitions = await listRecords("supplier_document_acquisitions");
  let acquisition = existingAcquisitions.find((candidate) => candidate.supplierId === input.job.supplierId
    && candidate.documentType === "FORMULATION" && candidate.sha256.toLowerCase() === digest);
  if (!acquisition) {
    try {
      await storeSupplierDocumentPdf(bytes, digest);
    } catch {
      throw new ImportFileFailure("storage_failed");
    }
    try {
      const selectedAt = input.job.createdAt;
      acquisition = await recordSupplierDocumentAcquisition({
        supplierId: input.job.supplierId,
        providerId: input.job.providerId,
        surfaceId: input.job.surfaceId,
        documentType: "FORMULATION",
        acquisitionMethod: "manual_assisted",
        sourceProduct: {},
        sourceFileSelection: {
          selectionId: `reference-formulation-${digest}`,
          originalFilename: sanitizedFilename(input.selected.name),
          sourceFileSha256: digest,
          selectedAt,
          selectedBy: input.job.requestedBy,
        },
        market: input.job.market,
        language: input.job.language,
        originalFilename: sanitizedFilename(input.selected.name),
        mimeType: "application/pdf",
        sha256: digest,
        byteSize: bytes.byteLength,
        parserStatus: "completed",
      });
    } catch {
      throw new ImportFileFailure("acquisition_failed");
    }
  }

  try {
    const saved = await buildAndPersistReferenceRecord({ job: input.job, item: input.item, acquisition, bytes, extraction, signal: input.signal });
    return { status: "review_required", ...saved };
  } catch (error) {
    if (error instanceof ImportBatchPaused) throw error;
    throw new ImportFileFailure(error instanceof ImportFileFailure ? error.code : "parser_failed");
  }
}

/** Resume by reselecting pending files. Each item's hash and status is durable, and a restart after document/source persistence is safe to retry. */
export async function resumeReferenceFormulationBulkImport(
  jobId: string,
  selectedFiles: SelectedReferenceFormulationPdf[],
  signal?: AbortSignal,
): Promise<ReferenceFormulationBulkImportResult> {
  const [jobRows, itemRows] = await Promise.all([
    listRecords("reference_formulation_import_jobs"),
    listRecords("reference_formulation_import_files"),
  ]);
  const found = jobRows.find((candidate) => candidate.id === jobId);
  if (!found) throw new Error("Reference formulation import job was not found.");
  const previousJob = referenceFormulationImportJobSchema.parse(found);
  if (previousJob.status === "cancelled") throw new Error("Cancelled reference formulation imports cannot be resumed.");
  let job = referenceFormulationImportJobSchema.parse({
    ...previousJob, status: "running", completedAt: undefined, updatedAt: nowIso(),
  });
  let files = itemRows.filter((candidate) => candidate.jobId === jobId)
    .map((candidate) => referenceFormulationImportFileSchema.parse(candidate))
    .sort((left, right) => left.ordinal - right.ordinal);
  if (files.length > job.totalFiles || new Set(files.map((file) => file.ordinal)).size !== files.length
    || files.some((file) => file.ordinal > job.totalFiles)) {
    throw new Error("Reference formulation import file manifest contains duplicate or out-of-range ordinals.");
  }
  if (files.length < job.totalFiles) {
    if (selectedFiles.length !== job.totalFiles) {
      throw new Error("The interrupted import manifest needs the original complete file selection in its original order to resume initialization.");
    }
    for (const file of files) {
      const selected = selectedFiles[file.ordinal - 1]!;
      if (sanitizedFilename(selected.name) !== file.originalFilename) {
        throw new Error("The interrupted import manifest cannot be safely matched to the original ordered files; start a new import with a readable complete selection.");
      }
      if (!file.sourceDocumentHash) {
        if (file.status !== "failed" || !["source_unavailable", "file_too_large", "invalid_pdf"].includes(file.errorCode ?? "")) {
          throw new Error("The interrupted import manifest contains a file without a verifiable source hash.");
        }
        // This already-failed row will not be processed again. Its safe basename
        // anchors the original ordinal; all hash-bearing rows are verified below.
        continue;
      }
      if (selected.size > SUPPLIER_PDF_DEFAULT_MAX_BYTES) {
        throw new Error("The interrupted import manifest cannot be safely matched to the original ordered files; start a new import with a readable complete selection.");
      }
      let selectedDigest: string;
      try {
        selectedDigest = await sha256(new Uint8Array(await selected.arrayBuffer()));
      } catch {
        throw new Error("The interrupted import manifest cannot be verified because an original file could not be read.");
      }
      if (selectedDigest !== file.sourceDocumentHash) {
        throw new Error("The interrupted import manifest does not match the original ordered file selection.");
      }
    }
    const existingOrdinals = new Set(files.map((file) => file.ordinal));
    const missingFiles: ReferenceFormulationImportFile[] = [];
    for (let ordinal = 1; ordinal <= job.totalFiles; ordinal += 1) {
      if (existingOrdinals.has(ordinal)) continue;
      const selected = selectedFiles[ordinal - 1]!;
      const createdAt = nowIso();
      const base = referenceFormulationImportFileSchema.parse({
        schemaVersion: "1.0", id: `${job.id}:file:${ordinal}`, jobId: job.id, ordinal,
        idempotencyKey: await batchScopedKey(job.id, ordinal), originalFilename: sanitizedFilename(selected.name),
        status: "failed", attemptCount: 0, errorCode: "source_unavailable",
        errorMessage: SAFE_FAILURES.source_unavailable, createdAt, updatedAt: createdAt,
      });
      let restored = base;
      if (!Number.isSafeInteger(selected.size) || selected.size < 1) {
        restored = fileFailure(base, "invalid_pdf", createdAt);
      } else if (selected.size > SUPPLIER_PDF_DEFAULT_MAX_BYTES) {
        restored = fileFailure(base, "file_too_large", createdAt);
      } else {
        try {
          const digest = await sha256(new Uint8Array(await selected.arrayBuffer()));
          restored = referenceFormulationImportFileSchema.parse({
            ...base, status: "queued", errorCode: undefined, errorMessage: undefined,
            sourceDocumentHash: digest,
            idempotencyKey: await sourceIdempotencyKey(job.supplierId, job.providerId, job.surfaceId, digest),
          });
        } catch {
          restored = fileFailure(base, "source_unavailable", nowIso());
        }
      }
      missingFiles.push(restored);
    }
    files = [...files, ...missingFiles].sort((left, right) => left.ordinal - right.ordinal);
    await persistFiles(missingFiles);
  }
  if (files.some((file, index) => file.ordinal !== index + 1)) {
    throw new Error("Reference formulation import file manifest does not contain a complete 1-based sequence.");
  }
  files = files.map((file) => file.status === "processing"
    ? referenceFormulationImportFileSchema.parse({ ...file, status: "queued", updatedAt: nowIso() }) : file);
  await upsertRecords("reference_formulation_import_jobs", [job]);
  await persistFiles(files.filter((file) => file.status === "queued"));

  const selectedByHash = new Map<string, SelectedReferenceFormulationPdf[]>();
  const selectedByName = new Map<string, SelectedReferenceFormulationPdf[]>();
  const consumedSelections = new WeakSet<SelectedReferenceFormulationPdf>();
  const selectedHashByRef = new WeakMap<SelectedReferenceFormulationPdf, string>();
  for (const selected of selectedFiles) {
    const name = sanitizedFilename(selected.name);
    const named = selectedByName.get(name) ?? [];
    named.push(selected);
    selectedByName.set(name, named);
    if (selected.size <= SUPPLIER_PDF_DEFAULT_MAX_BYTES && selected.size > 0) {
      try {
        const digest = await sha256(new Uint8Array(await selected.arrayBuffer()));
        selectedHashByRef.set(selected, digest);
        const hashed = selectedByHash.get(digest) ?? [];
        hashed.push(selected);
        selectedByHash.set(digest, hashed);
      } catch {
        // The affected manifest row remains queued and can be reselected later.
      }
    }
  }

  const completedHashes = new Map<string, ReferenceFormulationImportFile>();
  for (const item of files) {
    if (item.sourceDocumentHash && (item.status === "review_required" || item.status === "duplicate")) {
      completedHashes.set(item.sourceDocumentHash, item);
    }
  }
  const takeUnconsumed = (candidates: SelectedReferenceFormulationPdf[] | undefined): SelectedReferenceFormulationPdf | undefined => {
    while (candidates?.length) {
      const candidate = candidates.shift()!;
      if (consumedSelections.has(candidate)) continue;
      consumedSelections.add(candidate);
      return candidate;
    }
    return undefined;
  };
  for (let index = 0; index < files.length; index += 1) {
    if (signal?.aborted) break;
    let item = files[index]!;
    if (item.status !== "queued" && item.status !== "failed") continue;
    if (item.status === "failed" && !item.sourceDocumentHash) continue;
    const selected = item.sourceDocumentHash
      ? takeUnconsumed(selectedByHash.get(item.sourceDocumentHash))
      : takeUnconsumed(selectedByName.get(item.originalFilename));
    if (!selected) continue;
    const timestamp = nowIso();
    const selectedDigest = item.sourceDocumentHash ?? selectedHashByRef.get(selected);
    if (selectedDigest && item.sourceDocumentHash !== selectedDigest) {
      item = referenceFormulationImportFileSchema.parse({
        ...item,
        sourceDocumentHash: selectedDigest,
        idempotencyKey: await sourceIdempotencyKey(job.supplierId, job.providerId, job.surfaceId, selectedDigest),
        updatedAt: timestamp,
      });
      files[index] = item;
      await upsertRecords("reference_formulation_import_files", [item]);
    }
    item = referenceFormulationImportFileSchema.parse({
      ...item, status: "processing", attemptCount: item.attemptCount + 1,
      errorCode: undefined, errorMessage: undefined, updatedAt: timestamp,
    });
    files[index] = item;
    await upsertRecords("reference_formulation_import_files", [item]);
    const duplicateInJob = item.sourceDocumentHash ? completedHashes.get(item.sourceDocumentHash) : undefined;
    if (duplicateInJob) {
      const completed = referenceFormulationImportFileSchema.parse({
        ...item,
        status: "duplicate",
        duplicateOfItemId: duplicateInJob.id,
        ...(duplicateInJob.referenceFormulationRecordId ? { duplicateOfSourceRecordId: duplicateInJob.referenceFormulationRecordId } : {}),
        ...(duplicateInJob.duplicateOfSourceRecordId ? { duplicateOfSourceRecordId: duplicateInJob.duplicateOfSourceRecordId } : {}),
        updatedAt: nowIso(),
      });
      files[index] = completed;
      await upsertRecords("reference_formulation_import_files", [completed]);
      continue;
    }
    try {
      const result = await processOneFile({ job, item, selected, signal });
      const completed = referenceFormulationImportFileSchema.parse({
        ...item,
        status: result.status,
        ...(result.acquisitionCode ? { acquisitionCode: result.acquisitionCode } : {}),
        ...(result.recordId ? { referenceFormulationRecordId: result.recordId } : {}),
        ...(result.duplicateRecordId ? { duplicateOfSourceRecordId: result.duplicateRecordId } : {}),
        updatedAt: nowIso(),
      });
      files[index] = completed;
      await upsertRecords("reference_formulation_import_files", [completed]);
      if (item.sourceDocumentHash) completedHashes.set(item.sourceDocumentHash, completed);
    } catch (error) {
      if (error instanceof ImportBatchPaused || signal?.aborted) {
        const queued = referenceFormulationImportFileSchema.parse({ ...item, status: "queued", updatedAt: nowIso() });
        files[index] = queued;
        await upsertRecords("reference_formulation_import_files", [queued]);
        break;
      }
      const code = error instanceof ImportFileFailure ? error.code : "parser_failed";
      const failed = fileFailure(item, code, nowIso());
      files[index] = failed;
      await upsertRecords("reference_formulation_import_files", [failed]);
    }
    job = referenceFormulationImportJobSchema.parse({ ...job, updatedAt: nowIso() });
    await upsertRecords("reference_formulation_import_jobs", [job]);
  }

  job = summarizeReferenceFormulationImport(job, files, nowIso());
  await upsertRecords("reference_formulation_import_jobs", [job]);
  return { job, files };
}
