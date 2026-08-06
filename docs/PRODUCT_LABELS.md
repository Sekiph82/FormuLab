# Product labels (Phase 4)

`packages/shared/src/schemas/claimsLabels.ts` (`productLabelSchema`),
`packages/shared/src/engine/labels.ts` (`createLabel`/`reviseLabel`/
`updateLabelStatus`/`deriveLabelEffectiveStatus`/`resolveLabelRequirements`).
See [LABEL_CONTENT.md](LABEL_CONTENT.md), [LABEL_ARTWORK.md](LABEL_ARTWORK.md),
[LABEL_REVIEWS.md](LABEL_REVIEWS.md),
[FORMULA_LABEL_CONSISTENCY.md](FORMULA_LABEL_CONSISTENCY.md),
[CLAIMS_LABEL_READINESS.md](CLAIMS_LABEL_READINESS.md). Mirrors
[REGULATORY_DOSSIERS.md](REGULATORY_DOSSIERS.md)'s requirement-matrix shape:
a frozen, per-revision requirement snapshot, live-computed satisfaction
never stored on the requirement row itself.

## What this is, and is not

A `ProductLabel` is one label for one product: bound to an exact formula
version, packaging SKU (when relevant), a single jurisdiction, and a
single language. A different market or a different language is a
*different* label, never the same row with a translated field swapped in
place.

**Never a compliance verdict.** A label reaching `ready_for_review` (see
[CLAIMS_LABEL_READINESS.md](CLAIMS_LABEL_READINESS.md)) is a compliance-
*assistance* fact, not a legal conclusion — only a recorded human
`LabelReview` (see [LABEL_REVIEWS.md](LABEL_REVIEWS.md)) records an actual
review outcome.

## The record

```ts
ProductLabel {
  id, schemaVersion: "1.0", labelCode,
  formulationId, formulaVersionId, packagingSkuCode?,
  jurisdiction, language,
  status,                 // 10-state lifecycle
  revision,                // starts at 1
  createdBy, createdAt, updatedBy?, updatedAt,
  supersedesLabelId?,       // set on the NEW row when revised
}
```

`LABEL_STATUSES` (10): draft, content_in_progress, under_review,
changes_requested, review_complete, approved_for_artwork,
artwork_in_progress, approved, rejected, superseded.
`LABEL_IMMUTABLE_STATUSES` blocks further edits once a label is formally
approved/reviewed — `reviseLabel` is required instead.

## Identity and versioning

`reviseLabel(current, actor)` never edits in place: it sets the OLD row's
status to `"superseded"` and returns a NEW row with `revision:
current.revision + 1`, `supersedesLabelId: current.id`.
`deriveLabelEffectiveStatus` computes `"superseded"` by checking whether
any other label in scope points back at this one — derived, never
self-reported, same overlay pattern `deriveDossierStatus`/
`deriveClaimEffectiveStatus` already use.

**A label cannot silently reference a different formula version or
packaging SKU than the one it claims to be for** — this is enforced not at
creation time (both are just required fields) but at consistency-check
time: see [FORMULA_LABEL_CONSISTENCY.md](FORMULA_LABEL_CONSISTENCY.md)'s
`wrong_formula_version`/`wrong_packaging_sku` findings, which are always
blocking.

## Requirement generation

`resolveLabelRequirements(ctx)` generates the frozen requirement list from
real, configured data only: a conservative baseline (`product_name`,
`net_quantity`, `ingredients`, `directions`, `warnings`, `manufacturer`,
`batch_code` — always mandatory, never presented as verified legislation),
plus whatever a jurisdiction's active, non-deprecated
`RegulatoryRule.requiredLabelElements`/`requiredWarnings` actually names.
An optional `claims` block becomes required only when the formula
version/jurisdiction scope has at least one active claim.
`compareLabelRequirementsToCurrentRules` is a read-only drift check against
what the rules would generate today — never mutates the historical
snapshot.

## Language support

Minimum English/Turkish/Swahili (`LABEL_UI_LANGUAGES`). See
[NAVIGATION_AND_CONTEXT.md](NAVIGATION_AND_CONTEXT.md) for how language is
preserved through route/query context alongside project/version/
jurisdiction. **AI-suggested translations are never treated as approved** —
see [LABEL_CONTENT.md](LABEL_CONTENT.md)'s translation-status field.

## Authorization

`requireHumanActor` gates create/revise/status-change. Formal review lives
in [LABEL_REVIEWS.md](LABEL_REVIEWS.md), gated at the higher
`requireAuthorizedRegulatoryActor` tier.

## Status

Domain model, lifecycle, requirement generation: **implemented, verified by
tests** (`labels.test.ts`, 25 tests). Workspace UI (`/claims-labels`,
`ClaimsLabelsPanel.tsx`'s Labels list + Overview/Content/Artwork/Reviews/
Consistency detail sections): **implemented, verified by UI-integration
tests** (`ClaimsLabelsPanel.test.tsx`) and typecheck/lint. JSON/CSV/Excel
export and label-readiness-summary export: **implemented, verified by
tests** — see [IMPORT_EXPORT.md](IMPORT_EXPORT.md).
