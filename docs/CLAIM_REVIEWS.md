# Claim reviews (Phase 4)

`packages/shared/src/schemas/claimsLabels.ts` (`claimReviewSchema`,
`claimReviewRevocationSchema`), `packages/shared/src/engine/claims.ts`
(`recordClaimReview`/`revokeClaimReview`/`isClaimReviewActive`/
`compareClaimRevisionToReviewedSnapshot`). Mirrors
[DOSSIER_REVIEWS.md](DOSSIER_REVIEWS.md)'s append-only-review-plus-
revocation pattern exactly, at the claim level instead of the dossier
level.

## What this is

A `ClaimReview` is the one thing that actually changes a claim's formal
regulatory standing — everything else in [PRODUCT_CLAIMS.md](PRODUCT_CLAIMS.md)
(derived status, derived risk) is advisory only. A review is bound to an
exact claim revision, formula version, packaging SKU (when relevant),
jurisdiction and language — it cannot cross packaging SKUs, and it never
silently covers a claim revision it was not recorded against.

## The record

```ts
ClaimReview {
  id, schemaVersion: "1.0", claimId, claimRevision,
  formulationId, formulaVersionId, packagingSkuCode?,
  jurisdiction, language,
  reviewedBy, reviewerRole, reviewedAt,
  outcome,                 // 6 values, see below
  conditions?, notes,
  evidenceSnapshot,         // frozen ClaimEvidenceLink[] at review time
  ruleSnapshot,             // frozen {ruleId, ruleCode, version}[] at review time
  revokesReviewId?,         // added beyond the spec's own field list, see below
}
```

`outcome` (6): supported, supported_with_conditions, restricted,
prohibited, rejected, changes_requested.

**A field the spec's own list omitted, added for consistency**:
`revokesReviewId` — every other reviewed-entity type in this codebase
(including the spec's own `LabelReview` two sections later) uses the
append-only-review-plus-revocation pattern with a revocation pointer. Added
here for the same reason, documented in the schema file's header comment.

## Authorization

`requireAuthorizedRegulatoryActor` (regulatory/quality/administrator only)
gates both `recordClaimReview` and `revokeClaimReview` — a chemist or
researcher can draft a claim, but only an authorized regulatory actor can
formally review one. No record and no audit event is created after an
authorization failure.

## Snapshots are frozen

`evidenceSnapshot`/`ruleSnapshot` are captured at the moment of review and
never recomputed — a later evidence change or rule edit must never
retroactively rewrite what a past review said was true.
`compareClaimRevisionToReviewedSnapshot(claim, review)` is a read-only
staleness check: `true` when the claim has been updated since the review,
signalling the review no longer covers the current claim (never mutates
either record).

## Revocation is append-only

`revokeClaimReview(reviewId, actor, reason)` never mutates the original
review row — it creates a new `ClaimReviewRevocation` row.
`isClaimReviewActive(review, revocations, currentClaimRevision)` checks both
that the review's `claimRevision` matches the current one AND that no
revocation targets it.

## Status

**Implemented, verified by tests** (`claims.test.ts` — authorization,
revocation, staleness detection, activity checks). Workspace UI
(`ClaimsLabelsPanel.tsx`'s Reviews section — record/revoke, role-gated):
**implemented, verified by UI-integration tests**
(`ClaimsLabelsPanel.test.tsx` — "only an authorized regulatory actor can
record a claim review").
