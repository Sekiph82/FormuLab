import {
  referenceFormulationReviewSchema,
  type ReferenceFormulationReview,
} from "@formulab/shared";
import { appendReferenceFormulationReviewRecord, listRecords, nowIso } from "./masterdata";

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
  const id = `rfreview-${globalThis.crypto.randomUUID()}`;
  const review = referenceFormulationReviewSchema.parse({
    ...input,
    schemaVersion: "1.0",
    id,
    code: id,
    reviewedAt: nowIso(),
  });
  const saved = await appendReferenceFormulationReviewRecord(review);
  return referenceFormulationReviewSchema.parse(saved);
}
