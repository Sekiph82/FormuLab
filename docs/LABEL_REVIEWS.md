# Label reviews (Phase 4)

`packages/shared/src/schemas/claimsLabels.ts` (`labelReviewSchema`,
`labelReviewRevocationSchema`), `packages/shared/src/engine/labels.ts`
(`recordLabelReview`/`revokeLabelReview`/`isLabelReviewActive`). Mirrors
[CLAIM_REVIEWS.md](CLAIM_REVIEWS.md) and
[DOSSIER_REVIEWS.md](DOSSIER_REVIEWS.md)'s append-only-review-plus-
revocation pattern exactly.

## A real gap, found and closed during this phase

`recordLabelReview`/`revokeLabelReview`/`isLabelReviewActive` did not exist
at all when the Claims & Labels workspace UI was first wired — the domain
schema (`labelReviewSchema`) was designed correctly from the start, but the
recording functions themselves were missed. Added afterward, mirroring
`recordClaimReview`/`revokeClaimReview`/`isClaimReviewActive` exactly, with
2 dedicated tests added to `labels.test.ts` (23 → 25).

## The record

```ts
LabelReview {
  id, schemaVersion: "1.0", labelId, labelRevision,
  artworkId?, artworkRevision?,
  formulaVersionId, packagingSkuCode?, jurisdiction, language,
  reviewedBy, reviewerRole, reviewedAt,
  outcome,                 // 5 values, see below
  findingsSnapshot, contentSnapshot, claimsSnapshot,   // frozen at review time
  notes,
  revokesReviewId?,
}
```

`outcome` (5): approved, approved_with_conditions, changes_requested,
rejected, withdrawn.

## Authorization

`requireAuthorizedRegulatoryActor` gates both recording and revoking — a
chemist or researcher can draft label content and upload draft artwork, but
only an authorized regulatory actor performs the formal review.

## Exact-revision binding — both label AND artwork

A label review is bound to an exact label revision, and — when artwork is
part of the review — an exact artwork revision too.
`isLabelReviewActive(review, revocations, currentLabelRevision,
currentArtworkRevision)` requires both to match: **a new artwork upload
alone (with no label content change) makes a prior review stale**, exactly
as replacing artwork is documented to do in
[LABEL_ARTWORK.md](LABEL_ARTWORK.md#lifecycle). This is stricter than the
claim-review check (which only tracks claim revision), reflecting that a
label review's scope genuinely includes the artwork it was shown alongside.

## Snapshots are frozen

`findingsSnapshot`/`contentSnapshot`/`claimsSnapshot` are captured at
review time and never recomputed — a later content edit, a new claim, or a
changed consistency finding must never retroactively rewrite what a past
review said was true.

## Revocation is append-only

Same shape as claim reviews: `revokeLabelReview` creates a new
`LabelReviewRevocation` row, never mutates the original.

## Status

**Implemented, verified by tests** (`labels.test.ts` — authorization,
notes/reason required, revocation, the exact-label-AND-artwork-revision
activity check). Workspace UI (`ClaimsLabelsPanel.tsx`'s Reviews section
under a selected label): **implemented, verified by typecheck/lint** and
by the shared `ClaimsLabelsPanel.test.tsx` suite's label-detail coverage.
