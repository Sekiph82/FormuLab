import {
  newId,
  safeSupplierDocumentSourceUrl,
  supplierDocumentAcquisitionSchema,
  type NewSupplierDocumentAcquisition,
  type SupplierDocumentAcquisition,
} from "@formulab/shared";
import { nowIso, upsertRecords } from "./masterdata";

/**
 * Append one immutable receipt for an acquired supplier document. This only
 * records source identity and bytes provenance; it never creates or updates a
 * RawMaterial or MaterialDocument record.
 */
export async function recordSupplierDocumentAcquisition(
  input: NewSupplierDocumentAcquisition,
): Promise<SupplierDocumentAcquisition> {
  const timestamp = nowIso();
  const record = supplierDocumentAcquisitionSchema.parse({
    ...input,
    sourceUrl: safeSupplierDocumentSourceUrl(input.sourceUrl),
    schemaVersion: "1.0",
    code: newId("supplierdoc"),
    acquiredAt: timestamp,
    createdAt: timestamp,
  });
  await upsertRecords("supplier_document_acquisitions", [record]);
  return record;
}
