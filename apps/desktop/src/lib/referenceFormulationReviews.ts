import {
  referenceFormulationReviewSchema,
  type ReferenceFormulationReview,
} from "@formulab/shared";
import { appendReferenceFormulationReviewRecord, listRecords, nowIso } from "./masterdata";
import { sha256Identity } from "./supplierAcquisitionIdentity";

export type NewReferenceFormulationReview = Omit<ReferenceFormulationReview,
  "schemaVersion" | "id" | "code" | "reviewedAt"
>;

export async function listReferenceFormulationReviews(recordId: string): Promise<ReferenceFormulationReview[]> {
  const [records, decisions] = await Promise.all([
    listRecords("reference_formulations"),
    listRecords("reference_formulation_reviews"),
  ]);
  if (!records.some((record) => record.id === recordId)) throw new Error("Reference formulation record was not found.");
  return decisions
    .map((decision) => referenceFormulationReviewSchema.parse(decision))
    .filter((decision) => decision.referenceFormulationRecordId === recordId)
    .sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt));
}

/** Append a field-level human decision while preserving the immutable parser snapshot. */
export async function appendReferenceFormulationReview(
  input: NewReferenceFormulationReview,
): Promise<ReferenceFormulationReview> {
  const records = await listRecords("reference_formulations");
  const source = records.find((record) => record.id === input.referenceFormulationRecordId);
  if (!source) throw new Error("Reference formulation record was not found.");
  if (source.sourceDocumentHash.toLowerCase() !== input.sourceDocumentHash.toLowerCase()) {
    throw new Error("Review decision must cite the immutable reference formulation source hash.");
  }
  const reviewedAt = nowIso();
  const normalized = referenceFormulationReviewSchema.parse({
    ...input,
    schemaVersion: "1.0",
    id: "pending-review-id",
    code: "pending-review-id",
    reviewedAt,
  });
  // Derive the append-only row key from the exact decision payload so a retry
  // after a lost native response resolves to the same durable decision.
  const identity = JSON.stringify([
    normalized.referenceFormulationRecordId,
    normalized.sourceDocumentHash,
    normalized.targetType,
    normalized.targetKey,
    normalized.fieldPath,
    normalized.sourceValue,
    normalized.evidenceExcerpt,
    normalized.pageNumber ?? null,
    normalized.blockIndex ?? null,
    normalized.rowIndex ?? null,
    normalized.cellIndex ?? null,
    normalized.decision,
    normalized.reviewedValue ?? null,
    normalized.note ?? null,
    normalized.reviewer.userId,
    normalized.reviewer.displayName,
  ]);
  const id = `rfreview-${await sha256Identity(identity)}`;
  const review = referenceFormulationReviewSchema.parse({ ...normalized, id, code: id, reviewedAt });
  const saved = await appendReferenceFormulationReviewRecord(review);
  return referenceFormulationReviewSchema.parse(saved);
}
