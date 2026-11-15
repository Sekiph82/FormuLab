import { buildReferenceMaterialCandidates, rawMaterialSchema, referenceMaterialCandidatesCsv } from "@formulab/shared";
import { listRecords } from "./masterdata";
import { listReferenceFormulations } from "./referenceFormulations";

/** Data Exchange raw_materials rows for every material seen in supplier formulas but not yet in Material Master. */
export async function referenceMaterialCandidatesCsvFromLocalRecords(): Promise<{ csv: string; count: number }> {
  const [records, acquisitions, materialRows] = await Promise.all([
    listReferenceFormulations(), listRecords("supplier_document_acquisitions"), listRecords("materials"),
  ]);
  const existingMaterials = materialRows.flatMap((row) => {
    const parsed = rawMaterialSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  const candidates = buildReferenceMaterialCandidates({ records, productDocuments: acquisitions, existingMaterials });
  return { csv: referenceMaterialCandidatesCsv(candidates), count: candidates.length };
}
