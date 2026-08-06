# Claims & label readiness (Phase 4)

`packages/shared/src/engine/claims.ts` (`calculateClaimsReadiness`),
`packages/shared/src/engine/labels.ts` (`calculateLabelReadiness`),
`packages/shared/src/engine/claimsLabelApproval.ts`
(`deriveClaimsLabelApprovalReadiness`). Mirrors
[DOSSIER_READINESS.md](DOSSIER_READINESS.md) and
[APPROVAL_READINESS.md](APPROVAL_READINESS.md)'s "facts in, blockers out,
unknown is contagious" shape.

## Claims readiness

`calculateClaimsReadiness(claims, findingsByClaimId)` scopes to active
(non-superseded) claims and counts supported/unsupported/prohibited/
restricted/high-risk-unreviewed/missing-evidence/human-review-required,
then derives one `overallReadiness` (7 states: not_ready, partially_ready,
ready_for_review, under_review, review_complete, blocked, unknown).
**Human-review-required is checked first, before anything else** — any
claim with a finding requiring human review forces the whole readiness to
`"unknown"`, regardless of how many other claims are fully supported.
Prohibited claims force `"blocked"`.

## Label readiness

`calculateLabelReadiness(label, rows, languagesExpected, languagesCovered,
artwork)` counts present/missing/invalid/inconsistent/human-review-required
requirement rows (from [LABEL_CONTENT.md](LABEL_CONTENT.md)'s
`evaluateLabelContent`) and folds in artwork status and language coverage.
Same "unknown first" rule: any `human_review_required` row forces
`"unknown"` before checking anything else. A missing required language
keeps readiness from `"ready_for_review"` even if every present language's
content is complete.

## Approval integration (spec §17)

`packages/shared/src/schemas/approvalPolicy.ts` gained 7 opt-in fields, all
`default(false)` — installing Phase 4 never blocks an existing project
that has not opted in:

| Field | Gates |
|---|---|
| `requireAllClaimsReviewed` | every active claim has an active recorded review |
| `requireNoProhibitedClaims` | no active claim is prohibited |
| `requireNoUnsupportedClaims` | every active claim is supported, has accepted evidence, and no high-risk category is left unreviewed |
| `requireLabelReviewComplete` | every required-language label has an active, approved review |
| `requireArtworkApproved` | every required-language label's current artwork is approved |
| `requireFormulaLabelConsistency` | no blocking formula/claim-to-label consistency finding |
| `requireAllRequiredLanguagesReviewed` | every required language has an active, approved label review |

`deriveClaimsLabelApprovalReadiness` (mirrors
`deriveDossierApprovalReadiness`'s one-layer-up pattern) short-circuits to
`{ready: true, blockers: []}` when none of the 7 fields is set.

### 19 structured blocker codes

**Documented here as this session's own coherent design** — the
originating spec named "19 structured blocker codes" without the exact
list surviving into this session's context, so a fresh, internally
consistent set was designed rather than a fabricated verbatim match:

`claims_missing_review`, `claims_review_stale`,
`claims_prohibited_present`, `claims_unsupported_present`,
`claims_high_risk_unreviewed`, `claims_evidence_missing`, `label_missing`,
`label_review_incomplete`, `label_review_stale`, `label_artwork_missing`,
`label_artwork_not_approved`, `label_wrong_formula_version`,
`label_wrong_packaging_sku`, `label_ingredient_declaration_incomplete`,
`label_claim_inconsistent`, `label_language_missing`,
`label_language_review_incomplete`, `label_content_missing`,
`label_human_review_required`.

### Frozen snapshot

`ApprovalRecord.claimsLabelSnapshot` (schema:
`claimsLabelApprovalSnapshotSchema` in `schemas/claimsLabels.ts`) freezes
claim/label/artwork/review ids and revisions, languages, jurisdictions,
readiness states and blocker messages at the moment of an approval
decision — built in `ApprovalPanel.tsx`'s `buildClaimsLabelSnapshot()`,
following the exact same "never retroactively rewritten" convention as
`dossierSnapshot`/`regulatorySnapshot`.

### A real scoping bug, caught and fixed

The engine's claim-scanning loop did not originally filter by
`formulaVersionId` — a prohibited/unsupported claim recorded against a
DIFFERENT formula version would have silently blocked approval of the one
actually being approved. Fixed by filtering the active-claims set to the
exact `formulaVersion.id` before any gate check runs (label lookups are
deliberately NOT filtered the same way, since a label's own wrong
`formulaVersionId` is itself the `label_wrong_formula_version` finding
`requireFormulaLabelConsistency` must catch — filtering it out earlier
would hide that mismatch). A dedicated regression test guards this.

### Required languages, honestly derived

`Formulation` has no persisted "required languages" field. Rather than
inventing one, the Approval integration derives the required-language set
from whichever languages the formula version's own labels actually cover,
unioned with the documented English baseline (spec §13) — never a
fabricated policy input.

## Status

**Implemented, verified by tests** — `claims.test.ts`/`labels.test.ts` for
the two readiness calculators, `claimsLabelApproval.test.ts` (9 tests,
including the version-scoping regression) for the Approval integration.
`ApprovalPanel.tsx` wiring: **implemented, verified by UI-integration
tests** (`ApprovalPanel.test.tsx` — off-by-default / blocks / clears-once-
resolved, mirroring the Phase 3 dossier-gate test triad).
