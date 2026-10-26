import {
  newId,
  findSupplierDocumentSupersedesCode,
  isValidSupplierDocumentSupersedesTarget,
  safeSupplierDocumentSourceUrl,
  supplierDocumentAcquisitionSchema,
  type NewSupplierDocumentAcquisition,
  type SupplierDocumentAcquisition,
} from "@formulab/shared";
import { listRecords, nowIso, upsertRecords } from "./masterdata";

/**
 * Append one immutable receipt for an acquired supplier document. This only
 * records source identity and bytes provenance; it never creates or updates a
 * RawMaterial or MaterialDocument record.
 */
export async function recordSupplierDocumentAcquisition(
  input: NewSupplierDocumentAcquisition,
): Promise<SupplierDocumentAcquisition> {
  const timestamp = nowIso();
  const existing = await listRecords("supplier_document_acquisitions");
  if (input.supersedesCode) {
    const target = existing.find((candidate) => candidate.code === input.supersedesCode);
    if (!isValidSupplierDocumentSupersedesTarget(input, target)) {
      throw new Error("Supplier document revision link must target a different hash in the same product/document family.");
    }
  }
  const supersedesCode = input.supersedesCode ?? findSupplierDocumentSupersedesCode(input, existing);
  const record = supplierDocumentAcquisitionSchema.parse({
    ...input,
    supersedesCode,
    sourceUrl: safeSupplierDocumentSourceUrl(input.sourceUrl),
    schemaVersion: "1.0",
    code: newId("supplierdoc"),
    acquiredAt: timestamp,
    createdAt: timestamp,
  });
  await upsertRecords("supplier_document_acquisitions", [record]);
  return record;
}
