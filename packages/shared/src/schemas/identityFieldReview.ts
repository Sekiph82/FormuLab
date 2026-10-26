import { z } from "zod";
import type { Actor } from "./status";
import { can } from "../engine/rolePolicy";

export const IDENTITY_REVIEW_FIELDS = [
  "product_type",
  "canonical_identity",
  "component",
  "component_concentration",
  "active_matter",
  "solids_content",
  "assay",
  "alias",
] as const;
export const IDENTITY_REVIEW_DECISIONS = ["accepted", "edited", "rejected", "needs_review"] as const;

const jsonSnapshotSchema = z.string().min(1).refine((value) => {
  try { JSON.parse(value); return true; } catch { return false; }
}, "Review snapshots must contain valid JSON.");

/** Append-only field-level decision; it does not approve or mutate a RawMaterial. */
export const identityFieldReviewSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  commercialProductId: z.string().trim().min(1),
  sourceEvidenceId: z.string().trim().min(1),
  targetRecordId: z.string().trim().min(1),
  field: z.enum(IDENTITY_REVIEW_FIELDS),
  decision: z.enum(IDENTITY_REVIEW_DECISIONS),
  proposedValueSnapshot: jsonSnapshotSchema,
  reviewedValueSnapshot: jsonSnapshotSchema.optional(),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  decisionNote: z.string().trim().min(1).optional(),
  reviewedBy: z.string().trim().min(1),
  reviewerRole: z.string().trim().min(1),
  reviewedAt: z.string().datetime({ offset: true }),
  supersedesReviewId: z.string().trim().min(1).optional(),
}).strict().superRefine((review, context) => {
  if ((review.decision === "edited") !== Boolean(review.reviewedValueSnapshot)) {
    context.addIssue({ code: "custom", path: ["reviewedValueSnapshot"], message: "Only edited decisions require a reviewed value snapshot." });
  }
  if (["edited", "rejected", "needs_review"].includes(review.decision) && !review.decisionNote) {
    context.addIssue({ code: "custom", path: ["decisionNote"], message: "Edited, rejected and needs-review decisions require a note." });
  }
});

export type IdentityFieldReview = z.infer<typeof identityFieldReviewSchema>;
export type RecordIdentityFieldReviewInput = Omit<IdentityFieldReview, "schemaVersion" | "reviewedBy" | "reviewerRole" | "reviewedAt"> & { reviewedAt?: string };

function requireIdentityReviewer(actor: Actor): asserts actor is Extract<Actor, { kind: "human" }> {
  if (actor.kind !== "human"
    || (!can(actor.role, "rawMaterials", "edit") && !can(actor.role, "supplierDocuments", "edit"))) {
    throw new Error("Only a human with raw-material or supplier-document edit access may review commercial-product identity fields.");
  }
  if (!actor.userId.trim()) throw new Error("Identity review requires a named human reviewer.");
}

/** Record a named human's field-level decision while preserving the proposal and evidence snapshots. */
export function recordIdentityFieldReview(input: RecordIdentityFieldReviewInput, actor: Actor): IdentityFieldReview {
  requireIdentityReviewer(actor);
  return identityFieldReviewSchema.parse({
    ...input,
    schemaVersion: "1.0",
    reviewedBy: actor.userId,
    reviewerRole: actor.role,
    reviewedAt: input.reviewedAt ?? new Date().toISOString(),
  });
}

/** Append a decision without rewriting prior audit evidence. */
export function appendIdentityFieldReview(history: IdentityFieldReview[], review: IdentityFieldReview): IdentityFieldReview[] {
  const parsedHistory = history.map((item) => identityFieldReviewSchema.parse(item));
  const parsedReview = identityFieldReviewSchema.parse(review);
  if (parsedHistory.some((item) => item.id === parsedReview.id)) throw new Error("Identity review IDs must be unique within the history.");
  if (parsedReview.supersedesReviewId) {
    const prior = parsedHistory.find((item) => item.id === parsedReview.supersedesReviewId);
    if (!prior) throw new Error("A superseded identity review must already exist in the history.");
    if (prior.commercialProductId !== parsedReview.commercialProductId
      || prior.targetRecordId !== parsedReview.targetRecordId
      || prior.field !== parsedReview.field) {
      throw new Error("A review can supersede only a prior decision for the same product, target record and field.");
    }
  }
  return [...parsedHistory, parsedReview];
}
