import {
  findSupplierDocumentSupersedesCode,
  isValidSupplierDocumentSupersedesTarget,
  safeSupplierDocumentSourceUrl,
  supplierDocumentAcquisitionSchema,
  type NewSupplierDocumentAcquisition,
  type SupplierDocumentAcquisition,
} from "@formulab/shared";
import { listRecords, nowIso, upsertRecords } from "./masterdata";
import { supplierDocumentAcquisitionIdempotencyKey } from "./supplierAcquisitionIdentity";

/**
 * Append one immutable receipt for an acquired supplier document. This only
 * records source identity and bytes provenance; it never creates or updates a
 * RawMaterial or MaterialDocument record.
 */
export async function recordSupplierDocumentAcquisition(
  input: NewSupplierDocumentAcquisition,
): Promise<SupplierDocumentAcquisition> {
  const timestamp = nowIso();
  const sourceUrl = input.sourceUrl ? safeSupplierDocumentSourceUrl(input.sourceUrl) : undefined;
  const normalizedInput = {
    ...input,
    acquisitionMethod: input.acquisitionMethod ?? "automated",
    ...(sourceUrl ? { sourceUrl } : {}),
  };
  const idempotencyKey = await supplierDocumentAcquisitionIdempotencyKey(normalizedInput);
  const existing = await listRecords("supplier_document_acquisitions");
  for (const candidate of existing) {
    const candidateKey = candidate.idempotencyKey
      ?? await supplierDocumentAcquisitionIdempotencyKey(candidate);
    if (candidateKey === idempotencyKey) return candidate;
  }
  if (input.supersedesCode) {
    const target = existing.find((candidate) => candidate.code === input.supersedesCode);
    if (!isValidSupplierDocumentSupersedesTarget(input, target)) {
      throw new Error("Supplier document revision link must target a different hash in the same product/document family.");
    }
  }
  const supersedesCode = input.supersedesCode ?? findSupplierDocumentSupersedesCode(normalizedInput, existing);
  const record = supplierDocumentAcquisitionSchema.parse({
    ...normalizedInput,
    supersedesCode,
    idempotencyKey,
    schemaVersion: "1.0",
    code: `supplierdoc-${idempotencyKey.slice("sha256:".length)}`,
    acquiredAt: timestamp,
    createdAt: timestamp,
  });
  await upsertRecords("supplier_document_acquisitions", [record]);
  return record;
}

/** Append a bounded batch of immutable local-file receipts with one lineage read and one native append. */
export async function recordSupplierDocumentAcquisitionBatch(
  inputs: NewSupplierDocumentAcquisition[],
): Promise<{ records: SupplierDocumentAcquisition[]; duplicateCount: number }> {
  if (inputs.length === 0) return { records: [], duplicateCount: 0 };
  if (inputs.length > 100) throw new RangeError("Supplier document receipt batches are limited to 100 records.");
  const timestamp = nowIso();
  const existing = await listRecords("supplier_document_acquisitions");
  const existingKeys = new Set<string>();
  for (const candidate of existing) {
    existingKeys.add(candidate.idempotencyKey ?? await supplierDocumentAcquisitionIdempotencyKey(candidate));
  }
  const lineage = [...existing];
  const records: SupplierDocumentAcquisition[] = [];
  let duplicateCount = 0;
  for (const input of inputs) {
    const sourceUrl = input.sourceUrl ? safeSupplierDocumentSourceUrl(input.sourceUrl) : undefined;
    const normalizedInput = {
      ...input,
      acquisitionMethod: input.acquisitionMethod ?? "automated",
      ...(sourceUrl ? { sourceUrl } : {}),
    };
    const idempotencyKey = await supplierDocumentAcquisitionIdempotencyKey(normalizedInput);
    if (existingKeys.has(idempotencyKey)) {
      duplicateCount += 1;
      continue;
    }
    if (input.supersedesCode) {
      const target = lineage.find((candidate) => candidate.code === input.supersedesCode);
      if (!isValidSupplierDocumentSupersedesTarget(input, target)) {
        throw new Error("Supplier document revision link must target a different hash in the same product/document family.");
      }
    }
    const supersedesCode = input.supersedesCode ?? findSupplierDocumentSupersedesCode(normalizedInput, lineage);
    const record = supplierDocumentAcquisitionSchema.parse({
      ...normalizedInput,
      supersedesCode,
      idempotencyKey,
      schemaVersion: "1.0",
      code: `supplierdoc-${idempotencyKey.slice("sha256:".length)}`,
      acquiredAt: timestamp,
      createdAt: timestamp,
    });
    records.push(record);
    lineage.push(record);
    existingKeys.add(idempotencyKey);
  }
  if (records.length) await upsertRecords("supplier_document_acquisitions", records);
  return { records, duplicateCount };
}
