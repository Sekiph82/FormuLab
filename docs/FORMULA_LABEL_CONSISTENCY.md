# Formula-to-label consistency (Phase 4)

`packages/shared/src/engine/labels.ts` (`evaluateFormulaLabelConsistency`/
`evaluateClaimLabelConsistency`). See [PRODUCT_LABELS.md](PRODUCT_LABELS.md),
[PRODUCT_CLAIMS.md](PRODUCT_CLAIMS.md),
[CLAIMS_LABEL_READINESS.md](CLAIMS_LABEL_READINESS.md).

## What this checks

Whether a label's printed content actually matches the formula version and
claims it is supposed to represent — never inferred, always a direct
comparison against real, saved records.

## Formula-version and packaging-SKU identity

`evaluateFormulaLabelConsistency(ctx, blocks)` first checks that the
label's own `formulaVersionId` matches the formula version it is being
checked against (`wrong_formula_version`, always blocking — a label cannot
silently reference a different formula version, per spec §12), and that its
`packagingSkuCode` (when both are set) matches (`wrong_packaging_sku`,
always blocking). Only if both match does it proceed to content checks.

## Content checks

- **Product name**: warns (does not block) if the label's `product_name`
  block doesn't obviously contain the project's own name.
- **Ingredient declaration**: compares the `ingredients` block's text
  against every real formula line's `displayName` in the exact saved
  formula version (never a working draft) — warns per formula line not
  obviously named.

These are heuristic string-containment checks, not a legal ingredient-list
formatter — they surface an obvious omission for human review, never a
formatted, submission-ready ingredient statement.

## Claim-to-label consistency

`evaluateClaimLabelConsistency(ctx, blocks)` checks the label's `claims`
content block against the actual reviewed claim state:

- A **prohibited** claim mentioned on the label is always a **blocking**
  finding (`label_claim_inconsistent`).
- A **restricted** claim mentioned on the label is a **warning** — verify
  any required conditions are also shown.

A `claims` block that mentions nothing while active supported claims exist
is not flagged here — under-selling a reviewed benefit is not unsafe, only
a missed opportunity, and is left to human judgment.

## Staleness

Formula/claim changes after a label review make that review stale — see
[LABEL_REVIEWS.md](LABEL_REVIEWS.md#exact-revision-binding--both-label-and-artwork).
Consistency findings themselves are always live-computed against current
data, never cached on the label record — a later formula edit is reflected
the next time the check runs, never silently hidden behind an old result.

## Where this runs

The Claims & Labels workspace's Consistency section runs both checks
on-demand ("Run consistency check") and emits `label.consistency_checked`
with a finding count. The same functions feed
[CLAIMS_LABEL_READINESS.md](CLAIMS_LABEL_READINESS.md) and, when the
`requireFormulaLabelConsistency` Approval policy gate is on, Approval
Readiness itself (see [APPROVAL_POLICIES.md](APPROVAL_POLICIES.md)) — one
set of pure functions, three call sites, never three separate
implementations.

## Status

**Implemented, verified by tests** (`labels.test.ts` — wrong-version/
wrong-SKU blocking, ingredient-omission warning, prohibited-claim blocking;
`claimsLabelApproval.test.ts` — the Approval-integration call site).
Workspace UI: **implemented, verified by UI-integration tests**
(`ClaimsLabelsPanel.test.tsx` — "runs the formula/claim/artwork consistency
check and shows findings").
