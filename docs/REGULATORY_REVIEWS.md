# Regulatory reviews: version binding, staleness, and equivalence reuse

`packages/shared/src/schemas/regulatory.ts` (`regulatoryReviewSchema`,
`regulatoryReviewRevocationSchema`, `regulatoryReviewEquivalenceSchema`),
`packages/shared/src/engine/regulatoryReviews.ts`. See
[REGULATORY_ENGINE.md](REGULATORY_ENGINE.md) for how this fits into the
wider engine.

## What this closes

A `RegulatoryReview` recorded before this phase was matched by
jurisdiction alone — any review for Kenya, however old or against
whatever draft, satisfied the Approval tab's human-review gate for
whichever version happened to be up for approval. This module makes a
review useful for exactly what it was recorded against: the exact saved
formula version, jurisdiction, and (where relevant) packaging SKU — never
a working draft, never a different version, never a different market.

## Exact binding, not "close enough"

`RegulatoryReview.formulaVersionId` is required and must be a real,
saved `FormulationVersion.id` — `recordRegulatoryReview` refuses an
empty one. It is never `"working_draft"`. A review recorded against one
version does not satisfy a different version, including a later edit to
the same working draft that hasn't been saved as a new version yet:
reviewing again after any change requires a new `RegulatoryReview`,
unless an authorized `RegulatoryReviewEquivalence` explicitly permits
reuse (below).

## Frozen evidence

Every snapshot field on `RegulatoryReview` is captured once, at
`reviewedAt`, and never recomputed:

- `classificationSnapshot` — the exact `RegulatoryClassificationResult`
  the reviewer saw.
- `findingSnapshot` — every `RegulatoryFinding` at review time.
- `ruleVersionSnapshot` — each applicable rule's `ruleId`/`ruleCode`/
  `version`/`verificationStatus` at review time.

A later rule edit, a later re-classification, or a later re-evaluation
never changes what these fields say the reviewer actually looked at.
`compareReviewRuleSnapshotToCurrentRules(snapshot, currentRules)`
compares the frozen snapshot against today's rules and reports which
rule ids drifted (including a rule that no longer exists at all) — this
is what powers the `stale_rule_version` status below, and lets a UI show
exactly which rules changed, not just "something did."

## Eight honest statuses, never a silent "current"

`RegulatoryReviewStatus` (`REGULATORY_REVIEW_STATUSES`):

| Status | Meaning |
|---|---|
| `current` | Matches the context exactly and its rule snapshot hasn't drifted. |
| `stale_formula_version` | Recorded for a different `formulaVersionId`. |
| `stale_rule_version` | Matches version/jurisdiction/SKU, but a snapshotted rule has since changed. |
| `wrong_jurisdiction` | Recorded for a different jurisdiction. |
| `wrong_packaging_sku` | Recorded for a different (or no) packaging SKU. |
| `revoked` | A `RegulatoryReviewRevocation` points at this review. |
| `superseded` | A later review exists for the exact same version/jurisdiction/SKU. |
| `unknown` | No review exists at all to evaluate against. |

`deriveRegulatoryReviewStatus(review, ctx, revocations, allReviewsInScope, currentRules)`
checks revoked → superseded → wrong jurisdiction → wrong packaging SKU →
wrong formula version → stale rule version → current, in that order —
every dimension gets its own specific answer, never a generic "not
valid". `isRegulatoryReviewCurrent` is a boolean convenience wrapper.

## `findApplicableRegulatoryReview` vs `explainRegulatoryReviewStatus`

Two different jobs, deliberately not folded into one function:

- **`findApplicableRegulatoryReview(ctx, reviews, revocations,
  reviewEquivalences, currentRules)`** — "does anything actually satisfy
  this context?" Maps every review through `deriveRegulatoryReviewStatus`
  directly against `ctx` (no pre-filtering by jurisdiction/version/SKU —
  an earlier version of this logic filtered first, which meant a
  wrong-version or wrong-jurisdiction review was silently excluded
  before its status could even be computed, collapsing every mismatch
  into an uninformative `unknown`). Returns the first genuinely `current`
  review, or `undefined` if none — callers must never guess.
- **`explainRegulatoryReviewStatus(ctx, reviews, revocations,
  currentRules)`** — "why isn't anything applicable, in the most useful
  possible way?" Used purely for UI/blocker messages. Returns `current`
  if something does apply; otherwise picks the most-recently-reviewed
  record across any version/jurisdiction/SKU and reports its status
  against `ctx`, so a blocker can say "the recorded review used rule
  versions that have since changed" instead of a bland "unknown" when a
  specific reason is knowable. Returns `unknown` only when there is
  truly no review at all.

`deriveRegulatoryReadiness` (`engine/regulatoryApproval.ts`) calls both:
`humanReviewCompleted` from the first, `humanReviewStatus` (the
honest reason) from the second.

## Human-only, role-gated, append-only

`recordRegulatoryReview`/`revokeRegulatoryReview` require a human actor
whose role is `regulatory`, `quality`, or `administrator`
(`requireRegulatoryRole`) — an AI, system, or import actor is always
refused. A review is never edited or deleted; `revokeRegulatoryReview`
appends a separate `RegulatoryReviewRevocation` pointing at the review it
revokes, the same convention `FormulaVersionEquivalence`'s own revocation
records use.

## Review equivalence reuse (spec §3.8)

`RegulatoryReviewEquivalence` is a deliberately **separate** record from
the laboratory/stability `FormulaVersionEquivalence` — regulatory reuse
needs jurisdiction and packaging-SKU scoping dimensions lab/stability
equivalence never had, and folding those in would make a
laboratory-only declaration carry regulatory-shaped fields it never
uses. `declareRegulatoryReviewEquivalence(input, actor)` requires a
human actor (any role — not gated to
regulatory/quality/administrator the way recording a review itself is)
and a non-empty `justification`; refuses declaring a version equivalent
to itself. `findApplicableRegulatoryReview` only follows an *active*
equivalence declared for the exact target version/jurisdiction/SKU, and
only reuses a review that is itself still `current` against the source
version — never a stale or revoked one. Revocation
(`revokeRegulatoryReviewEquivalence`) is a new record with
`revokesEquivalenceId` set; a revocation record cannot itself be
revoked.

## Tests

`regulatoryReviews.test.ts` (32 tests): recording (human-only,
role-gated, empty-formulaVersionId/notes refusals), revocation, all
eight `deriveRegulatoryReviewStatus` branches, `isRegulatoryReviewCurrent`,
`findApplicableRegulatoryReview` (direct match, no match, equivalence
reuse, revoked equivalence not reused), evidence confirmation
record/revoke (human-only), and review equivalence declare/revoke
(self-equivalence refusal, revocation-of-revocation refusal).

## Known limitations

- No UI currently distinguishes "reused via equivalence" from "recorded
  directly" in the Regulatory tab's own review list beyond the
  equivalence section itself — `ApplicableRegulatoryReview.reusedViaEquivalenceId`
  is populated by the engine but the panel's per-review status badges
  read `deriveRegulatoryReviewStatus` directly rather than surfacing that
  id inline on every row.
- Equivalence declaration is human-only but not role-restricted the way
  recording the review itself is — any authenticated human role can
  declare a reuse. This mirrors `declareEquivalence`'s own gating for
  laboratory/stability equivalence.
