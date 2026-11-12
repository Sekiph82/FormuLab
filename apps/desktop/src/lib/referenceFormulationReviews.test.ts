import { beforeEach, describe, expect, it, vi } from "vitest";

const { records, reviews, appendReviewMock, listRecordsMock, nowIsoMock } = vi.hoisted(() => ({
  records: [{ id: "reference-1", sourceDocumentHash: "a".repeat(64) }] as Record<string, unknown>[],
  reviews: [] as Record<string, unknown>[],
  appendReviewMock: vi.fn(async (review: Record<string, unknown>) => {
    const existing = reviews.find((candidate) => candidate.id === review.id);
    if (existing) return existing;
    reviews.push(review);
    return review;
  }),
  listRecordsMock: vi.fn(async (collection: string) => collection === "reference_formulations" ? records : reviews),
  nowIsoMock: vi.fn(() => "2026-10-27T08:00:00.000Z"),
}));

vi.mock("./masterdata", () => ({
  appendReferenceFormulationReviewRecord: appendReviewMock,
  listRecords: listRecordsMock,
  nowIso: nowIsoMock,
}));

import { appendReferenceFormulationReview } from "./referenceFormulationReviews";

const reviewInput = {
  referenceFormulationRecordId: "reference-1",
  sourceDocumentHash: "a".repeat(64),
  targetType: "identity" as const,
  targetKey: "identity:formulation_code:0",
  fieldPath: "identityCandidates[0].formulation_code",
  sourceValue: "HC/DW/22",
  evidenceExcerpt: "Formulation HC/DW/22",
  pageNumber: 1,
  blockIndex: 4,
  decision: "accepted" as const,
  reviewer: { userId: "chemist-1", displayName: "Chemist" },
};

describe("reference formulation review retry idempotency", () => {
  beforeEach(() => {
    reviews.length = 0;
    vi.clearAllMocks();
  });

  it("reuses the same append-only review identity when the native response is lost", async () => {
    appendReviewMock.mockImplementationOnce(async (review) => {
      reviews.push(review);
      throw new Error("response lost after native persistence");
    });

    await expect(appendReferenceFormulationReview(reviewInput)).rejects.toThrow("response lost");
    const saved = await appendReferenceFormulationReview(reviewInput);

    expect(appendReviewMock).toHaveBeenCalledTimes(2);
    expect(appendReviewMock.mock.calls[0]?.[0].id).toBe(appendReviewMock.mock.calls[1]?.[0].id);
    expect(saved.id).toMatch(/^rfreview-[a-f0-9]{64}$/);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ decision: "accepted", reviewer: reviewInput.reviewer });
  });

  it("assigns a distinct review identity when the decision changes", async () => {
    const accepted = await appendReferenceFormulationReview(reviewInput);
    const rejected = await appendReferenceFormulationReview({ ...reviewInput, decision: "rejected" });

    expect(rejected.id).not.toBe(accepted.id);
    expect(reviews).toHaveLength(2);
  });

  it("derives the same retry key from schema-normalized whitespace", async () => {
    const first = await appendReferenceFormulationReview({ ...reviewInput, note: "same note", reviewer: { userId: "chemist-1", displayName: "Chemist" } });
    const retry = await appendReferenceFormulationReview({ ...reviewInput, note: "  same note  ", reviewer: { userId: " chemist-1 ", displayName: " Chemist " } });

    expect(retry.id).toBe(first.id);
    expect(reviews).toHaveLength(1);
    expect(retry.note).toBe("same note");
  });
});
