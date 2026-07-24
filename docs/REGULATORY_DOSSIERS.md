# Regulatory dossiers (Phase 3)

`packages/shared/src/schemas/dossier.ts` (`regulatoryDossierSchema` and the
five records it groups together), `packages/shared/src/engine/regulatoryDossier.ts`
(`createDossier`/`reviseDossier`/`updateDossierStatus`/`deriveDossierStatus`/
`isDossierImmutable`). See [DOSSIER_REQUIREMENTS.md](DOSSIER_REQUIREMENTS.md),
[DOSSIER_EVIDENCE.md](DOSSIER_EVIDENCE.md), [EVIDENCE_MATRIX.md](EVIDENCE_MATRIX.md),
[DOSSIER_READINESS.md](DOSSIER_READINESS.md), [DOSSIER_REVIEWS.md](DOSSIER_REVIEWS.md),
and [DOSSIER_SUBMISSIONS.md](DOSSIER_SUBMISSIONS.md) for the records this one
owns. Builds on [REGULATORY_ENGINE.md](REGULATORY_ENGINE.md) and
[REGULATORY_EVIDENCE_CONFIRMATIONS.md](REGULATORY_EVIDENCE_CONFIRMATIONS.md)
(Phase 2), which this phase does not replace — a dossier reuses the same
rule/classification/finding engine, it adds the persisted, version-specific
requirement-and-evidence layer Phase 2 explicitly said it was not attempting.

## What this is, and is not

A `RegulatoryDossier` answers one question precisely: for this exact formula
version, this exact packaging SKU (when relevant), and these exact
jurisdictions — which regulatory requirements apply, which are satisfied by
which verified evidence, which are missing or stale, who reviewed the result,
and whether it is ready for a human regulatory review or an external
submission.

**This system never claims a product is legally compliant.** Uploading a
document, linking evidence, or a dossier reaching `ready_for_review` are all
compliance-*assistance* facts, not a legal conclusion. Only a recorded human
`DossierReview` records an outcome, and even that outcome is the reviewer's
own professional judgment, captured verbatim — never generated or inferred by
the system.

## The record

```ts
RegulatoryDossier {
  id, schemaVersion: "1.0", dossierCode, title,
  formulationId, formulaVersionId, packagingSkuCode?,
  jurisdictions,            // at least one RegulatoryJurisdiction
  productFamilyCode, targetMarkets,
  status,                   // 11-state lifecycle, see below
  revision,                 // starts at 1
  createdBy, createdAt, updatedBy?, updatedAt,
  submittedBy?, submittedAt?, reviewedBy?, reviewedAt?, approvedBy?, approvedAt?,
  supersedesDossierId?,     // set on the NEW row when a revision is created
}
```

`DOSSIER_STATUSES` (11): `draft`, `in_preparation`, `ready_for_review`,
`under_review`, `changes_requested`, `review_complete`,
`approved_for_submission`, `submitted`, `withdrawn`, `superseded`,
`archived`. `DOSSIER_IMMUTABLE_STATUSES` = `submitted`, `superseded`,
`archived` — `isDossierImmutable(dossier)` is `true` for these, and
`updateDossierStatus` refuses any further transition once immutable.

## Identity and versioning

A dossier is always bound to one `formulaVersionId` — it is never valid for
"the formula" in general, and there is no mechanism that lets version A's
dossier silently become version B's. When a dossier needs to change after a
formal review (or any edit after `submitted`), `reviseDossier(current, actor)`
does not edit the row in place: it sets the OLD row's `status` to
`"superseded"` and returns a NEW row with `revision: current.revision + 1`,
`supersedesDossierId: current.id`, and its own review/submission/approval
fields cleared. `deriveDossierStatus(dossier, allDossiersInScope)` computes
`"superseded"` by checking whether any other dossier in scope points back at
this one, exactly the way `effectiveStatus` already does for formula versions
— so supersession is derived, not just self-reported, and cannot drift.
`resolveDossierRevisionChain(dossier, all)` walks the chain backward to the
original revision 1.

A dossier's own row is mutable (`createDossier`/`updateDossierStatus` edit it
in place until it is immutable) for the same reason `RegulatoryRule` and
`ApprovalPolicy` rows are mutable — its lifecycle status IS the thing that
changes, and every change is still visible via the formulation's audit log
(`dossier.status_changed`).

## Creating a dossier

`createDossier(input, actor)` requires `requireHumanActor` (any human role —
never an AI/system/import actor) and refuses an empty `formulaVersionId` or
an empty `jurisdictions` array. **A dossier can only be created against a
real, saved formula version — never an unsaved working draft** (the UI
enforces this by only offering `versions`, never the in-progress draft, as a
creation source).

## Authorization

Two gates, matching spec §12 literally:

- `requireAuthorizedRegulatoryActor` (regulatory/quality/administrator only)
  — verify/reject/revoke evidence, add or exclude a mandatory requirement,
  record or revoke a dossier review, record or update a submission.
- `requireHumanActor` (any human role, still never AI/system/import) —
  create/revise a dossier, add or replace draft evidence, propose/accept/
  reject/revoke a requirement-evidence link.

Both are enforced in `packages/shared/src/engine/regulatoryDossier.ts` itself
— the UI additionally hides/disables actions the current actor cannot
perform, but that is a courtesy, not the security boundary. No audit event is
recorded on an authorization failure (the thrown error is the signal).

## Status

Domain model, lifecycle engine and authorization: **implemented, verified by
tests** (`regulatoryDossier.test.ts`). Workspace UI (`/dossiers`,
`DossierPanel.tsx` — list, creation, 8-section detail view, status/revision
lifecycle): **implemented, verified by UI-integration tests**
(`DossierPanel.test.tsx`) and by typecheck/lint — see
[WORKSPACES.md](WORKSPACES.md#dossiers). Not yet independently confirmed via
live native-app click-through; see the Phase 3 execution log for that
verification's status.
