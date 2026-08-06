# Product claims (Phase 4)

`packages/shared/src/schemas/claimsLabels.ts` (`productClaimSchema`),
`packages/shared/src/engine/claims.ts` (`createClaim`/`reviseClaim`/
`updateClaimStatus`/`deriveClaimEffectiveStatus`/`classifyClaimCategory`/
`evaluateClaimAgainstRules`/`deriveClaimStatus`/`deriveClaimRisk`/
`findClaimConflicts`/`calculateClaimsReadiness`). See
[CLAIM_EVIDENCE.md](CLAIM_EVIDENCE.md), [CLAIM_REVIEWS.md](CLAIM_REVIEWS.md),
[CLAIMS_LABEL_READINESS.md](CLAIMS_LABEL_READINESS.md). Builds on
[REGULATORY_ENGINE.md](REGULATORY_ENGINE.md) — a claim's rule evaluation
reuses the existing `RegulatoryRule.claimKeywordsAny` field the regulatory
engine already used for formula-level claims; no parallel rule concept was
invented.

## What this is, and is not

A `ProductClaim` answers: for this exact formula version, packaging SKU
(when relevant), jurisdiction(s) and language(s) — what claim text is
proposed, what category does it fall into, what is its status (draft
through supported/restricted/prohibited), and what is its risk level.

**Never a compliance verdict.** `deriveClaimStatus`/`deriveClaimRisk` are
computed, advisory signals only — they never overwrite the persisted
`claim.status`, which only a recorded human `ClaimReview` (see
[CLAIM_REVIEWS.md](CLAIM_REVIEWS.md)) changes. "Unknown" never equals
"supported": any finding with `humanReviewRequired: true` forces the derived
status to `"unknown"` before any other check runs.

## The record

```ts
ProductClaim {
  id, schemaVersion: "1.0", claimCode, claimText, normalizedClaim,
  claimCategory,            // 30 values, see below
  formulationId, formulaVersionId, packagingSkuCode?,
  jurisdictions, languages,  // at least one each
  status,                    // 11-state lifecycle
  riskLevel,                 // low | medium | high | critical | unknown
  proposedBy, proposedAt, updatedBy?, updatedAt,
  supersedesClaimId?,        // set on the NEW row when revised
}
```

`CLAIM_CATEGORIES` (30): performance, antibacterial, antimicrobial,
disinfectant, germ_kill, medical, therapeutic, dermatological,
hypoallergenic, sensitive, baby_safe, child_safe, natural, organic,
biodegradable, flushable, vegan, cruelty_free, whitening, brightening,
stain_removal, odor_control, long_lasting, concentrated, eco, free_from,
ingredient, comparative, professional, other.

`CLAIM_STATUSES` (11): draft, proposed, under_review, supported,
supported_with_conditions, restricted, prohibited, rejected, withdrawn,
superseded, unknown. `CLAIM_IMMUTABLE_STATUSES` blocks further text/field
edits once a claim has been formally reviewed — `reviseClaim` is required
instead, which creates a new revision (`supersedesClaimId` points back at
the original, whose own status becomes `"superseded"`).

## Classification

`classifyClaimCategory(claimText)` is a deterministic keyword match against
`CATEGORY_KEYWORDS` — never a guess beyond what the text literally contains,
returning `"other"` rather than a fabricated best-guess category when
nothing matches. `HIGH_RISK_CATEGORIES` (medical, therapeutic,
antibacterial, antimicrobial, disinfectant, germ_kill) always requires
human review regardless of rule coverage — a real gap (antibacterial was
initially missing) was caught and fixed via a classifier-ambiguity test.

## Identity and versioning

A claim is bound to one `formulaVersionId` — never "the formula" in
general. `reviseClaim(current, updates, actor)` never edits in place: it
sets the OLD row's status to `"superseded"` and returns a NEW row with a
fresh id, `supersedesClaimId: current.id`, `status: "draft"`.
`deriveClaimEffectiveStatus` computes `"superseded"` by checking whether any
other claim in scope points back at this one — derived, never
self-reported.

## Rule evaluation

`evaluateClaimAgainstRules(claim, ctx)` never invents legislation — it only
flags a finding when a real, configured `RegulatoryRule.claimKeywordsAny`
entry matches the claim's normalized text, or when the claim's own category
is inherently high-risk. Seed rules remain `verificationStatus:
"not_verified"`, exactly as Phase 2 established — an unverified rule's
finding still forces `humanReviewRequired: true`.

## Conflicts

`findClaimConflicts(claims)` is purely informational — flags two active
(non-superseded, non-withdrawn/rejected) claims for the same formula
version/jurisdiction with identical normalized text. Never merges or
auto-resolves; a human decides.

## Authorization

`requireHumanActor` (any human role) gates create/revise/status-change.
Formal review recording lives in [CLAIM_REVIEWS.md](CLAIM_REVIEWS.md) and
is gated separately, at a higher authorization tier.

## Status

Domain model, lifecycle engine, classification, rule evaluation, conflict
detection: **implemented, verified by tests** (`claims.test.ts`, 28 tests).
Workspace UI (`/claims-labels`, `ClaimsLabelsPanel.tsx` — list, filters,
creation, Overview/Evidence/Reviews detail sections): **implemented,
verified by UI-integration tests** (`ClaimsLabelsPanel.test.tsx`) and by
typecheck/lint — see [WORKSPACES.md](WORKSPACES.md). JSON/CSV/Excel
import/export: **implemented, verified by tests** — see
[IMPORT_EXPORT.md](IMPORT_EXPORT.md). Not yet independently confirmed via
live native-app click-through outside the combined end-of-session
verification pass; see the Phase 4 execution log for that verification's
status.
