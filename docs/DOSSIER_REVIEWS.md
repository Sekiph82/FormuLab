# Dossier reviews (Phase 3)

`packages/shared/src/schemas/dossier.ts` (`regulatoryDossierReviewSchema`,
`regulatoryDossierReviewRevocationSchema`), `packages/shared/src/engine/regulatoryDossier.ts`
(`recordDossierReview`/`revokeDossierReview`/`isDossierReviewActive`). Mirrors
[REGULATORY_REVIEWS.md](REGULATORY_REVIEWS.md)'s append-only-review-plus-
revocation-record pattern exactly, applied to a dossier instead of a formula
version's classification result.

## The record

```ts
RegulatoryDossierReview {
  id, schemaVersion: "1.0", dossierId, dossierRevision,
  reviewedBy, reviewerRole, reviewedAt,
  outcome,   // approved | approved_with_conditions | changes_requested | rejected | withdrawn
  notes,     // required, non-empty
  requirementSnapshot,   // RegulatoryDossierRequirement[] at review time
  evidenceSnapshot,      // RegulatoryDossierEvidenceItem[] at review time
  blockingIssues, warnings,
}
RegulatoryDossierReviewRevocation {
  id, schemaVersion: "1.0", revokesReviewId, revokedBy, revokedByRole, revokedAt, reason,
}
```

## Append-only, revision-bound

`recordDossierReview` requires `requireAuthorizedRegulatoryActor`
(regulatory/quality/administrator) and non-empty `notes` — a review is never
recorded silently or without a stated rationale. A review is bound to one
specific `dossierRevision`: **revision 1's review does not cover revision
2**. If the dossier is revised after a review, the new revision needs its own
review; the old review stays exactly as recorded, snapshotting the
requirement and evidence state as they stood at that moment so a later rule
or evidence change can never retroactively alter what a past review actually
saw.

Reviews are append-only and immutable — there is no edit path. Revocation is
its own separate, append-only record (`revokeDossierReview`, same authorized
role gate) pointing at the review it revokes; the original review row is
never deleted or rewritten. `isDossierReviewActive(review, revocations,
dossierRevision)` checks both the revision match and the absence of an active
revocation before treating a review as current.

## Status

Implemented, verified by tests (`regulatoryDossier.test.ts` — authorization,
empty-notes refusal, revision binding, revocation, all five outcomes).
Review workflow UI (record/revoke, outcome selector, unauthorized-role
hint) is implemented in `DossierPanel.tsx`'s Reviews section — see
[WORKSPACES.md](WORKSPACES.md#dossiers).
