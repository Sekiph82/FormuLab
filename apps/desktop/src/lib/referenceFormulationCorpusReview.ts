import {
  referenceFormulationRecordSchema,
  referenceFormulationNormalizationVersionSchema,
  supplierDocumentAcquisitionSchema,
  supplierSdsProductEvidenceRecordSchema,
  type ReferenceFormulationRecord,
  type ReferenceFormulationNormalizationVersion,
  type SupplierDocumentAcquisition,
  type SupplierSdsProductEvidenceRecord,
} from "@formulab/shared";
import { listRecords } from "./masterdata";
import { listReferenceFormulationNormalizations } from "./referenceFormulationNormalizations";

export interface ReferenceFormulationCorpusLineTrace {
  sourceLine: ReferenceFormulationRecord["ingredientLines"][number];
  normalizedLine: ReferenceFormulationNormalizationVersion["lines"][number];
  contributions: Array<{
    contribution: ReferenceFormulationNormalizationVersion["lines"][number]["componentContributions"][number];
    sds?: {
      evidence: SupplierSdsProductEvidenceRecord;
      acquisition: SupplierDocumentAcquisition;
      sourceComponent?: SupplierSdsProductEvidenceRecord["evidence"]["section3"]["components"][number];
    };
  }>;
}

export interface ReferenceFormulationCorpusReviewData {
  source: ReferenceFormulationRecord;
  versions: Array<{ version: ReferenceFormulationNormalizationVersion; lines: ReferenceFormulationCorpusLineTrace[] }>;
}

/** Join immutable source, normalized versions, SDS facts and acquisition receipts by exact IDs and hashes. */
export async function getReferenceFormulationCorpusReviewData(recordId: string): Promise<ReferenceFormulationCorpusReviewData> {
  const [sourceRows, versionRows, evidenceRows, acquisitionRows] = await Promise.all([
    listRecords("reference_formulations"),
    listReferenceFormulationNormalizations(recordId),
    listRecords("supplier_sds_product_evidence"),
    listRecords("supplier_document_acquisitions"),
  ]);
  const sources = sourceRows.map((row) => referenceFormulationRecordSchema.parse(row));
  const source = sources.find((row) => row.id === recordId);
  if (!source) throw new Error("Reference formulation record was not found.");
  const versions = versionRows.map((row) => referenceFormulationNormalizationVersionSchema.parse(row));
  const evidenceRecords = evidenceRows.map((row) => supplierSdsProductEvidenceRecordSchema.parse(row));
  const acquisitions = acquisitionRows.map((row) => supplierDocumentAcquisitionSchema.parse(row));
  const evidenceById = uniqueIndex(evidenceRecords, (row) => row.code, "SDS evidence ID");
  const acquisitionsByCode = uniqueIndex(acquisitions, (row) => row.code, "supplier-document acquisition code");
  const sourceLines = uniqueIndex(source.ingredientLines, (line) => line.id, "source formulation line ID");

  return {
    source,
    versions: versions.map((version) => ({
      version,
      lines: version.lines.map((normalizedLine) => {
        const sourceLine = sourceLines.get(normalizedLine.sourceLineId);
        if (!sourceLine) throw new Error("Normalized line must resolve to its immutable source formulation line.");
        return {
          sourceLine,
          normalizedLine,
          contributions: normalizedLine.componentContributions.map((contribution) => {
            if (contribution.sourceFormulaLineId !== sourceLine.id
              || contribution.sourceFormulationRecordId !== source.id
              || contribution.sourceFormulaDocumentHash.toLowerCase() !== source.sourceDocumentHash.toLowerCase()) {
              throw new Error("Component contribution must retain the exact source formulation, line, and document hash.");
            }
            if (contribution.sourceSds.status === "missing") return { contribution };
            const evidence = evidenceById.get(contribution.sourceSds.evidenceId!);
            const acquisition = acquisitionsByCode.get(contribution.sourceSds.acquisitionCode!);
            if (acquisition && acquisition.supplierId !== source.source.supplierId) {
              throw new Error("SDS acquisition supplier must match the source reference formulation supplier.");
            }
            if (!evidence || !acquisition
              || acquisition.documentType !== "SDS"
              || evidence.acquisitionCode !== acquisition.code
              || evidence.evidence.commercialProductId !== contribution.sourceSds.commercialProductId
              || acquisition.sha256.toLowerCase() !== contribution.sourceSds.documentHash?.toLowerCase()
              || evidence.evidence.section3.sourceDocumentHash.toLowerCase() !== contribution.sourceSds.documentHash?.toLowerCase()) {
              throw new Error("SDS contribution must resolve to its immutable evidence record and matching acquired SDS hash.");
            }
            const sourceComponent = contribution.sourceSds.sourceComponentId
              ? evidence.evidence.section3.components.find((component) => component.id === contribution.sourceSds.sourceComponentId)
              : undefined;
            if (contribution.sourceSds.sourceComponentId && !sourceComponent) {
              throw new Error("SDS contribution component must resolve to its cited Section 3 component.");
            }
            if (contribution.sourceSds.sourceFactId && sourceComponent?.concentration?.id !== contribution.sourceSds.sourceFactId) {
              throw new Error("SDS contribution fact must resolve to the exact Section 3 concentration fact.");
            }
            return { contribution, sds: { evidence, acquisition, ...(sourceComponent ? { sourceComponent } : {}) } };
          }),
        };
      }),
    })),
  };
}

function uniqueIndex<T>(rows: T[], keyOf: (row: T) => string, label: string): Map<string, T> {
  const indexed = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (indexed.has(key)) throw new Error(`Duplicate ${label} prevents an unambiguous evidence trace.`);
    indexed.set(key, row);
  }
  return indexed;
}
