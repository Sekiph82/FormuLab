import { z } from "zod";

export const referenceFormulationReviewSchema = z.object({
  schemaVersion: z.literal("1.0"),
  id: z.string().trim().min(1),
  code: z.string().trim().min(1),
  referenceFormulationRecordId: z.string().trim().min(1),
  sourceDocumentHash: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  targetType: z.enum(["identity", "ingredient", "procedure", "target"]),
  targetKey: z.string().trim().min(1),
  fieldPath: z.string().trim().min(1),
  sourceValue: z.string().max(10_000),
  evidenceExcerpt: z.string().max(20_000),
  pageNumber: z.number().int().positive().optional(),
  blockIndex: z.number().int().nonnegative().optional(),
  rowIndex: z.number().int().nonnegative().optional(),
  cellIndex: z.number().int().nonnegative().optional(),
  decision: z.enum(["accepted", "edited", "rejected", "needs_review"]),
  reviewedValue: z.string().max(10_000).optional(),
  note: z.string().trim().max(2_000).optional(),
  reviewer: z.object({
    userId: z.string().trim().min(1).max(160),
    displayName: z.string().trim().min(1).max(160),
  }).strict(),
  reviewedAt: z.string().datetime({ offset: true }),
}).strict().superRefine((record, context) => {
  if (record.decision === "edited" && !record.reviewedValue?.trim()) {
    context.addIssue({ code: "custom", path: ["reviewedValue"], message: "Edited decisions require the reviewer's proposed value." });
  }
  if (record.decision !== "edited" && record.reviewedValue !== undefined) {
    context.addIssue({ code: "custom", path: ["reviewedValue"], message: "Only edited decisions may include a proposed value." });
  }
});

export type ReferenceFormulationReview = z.infer<typeof referenceFormulationReviewSchema>;
