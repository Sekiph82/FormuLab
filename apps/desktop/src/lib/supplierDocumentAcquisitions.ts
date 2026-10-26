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
