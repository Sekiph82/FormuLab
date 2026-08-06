# Multi-jurisdiction approval readiness

`packages/shared/src/engine/regulatoryApproval.ts`
(`resolveRegulatoryJurisdictions`,
`assessMultiJurisdictionRegulatoryReadiness`),
`packages/shared/src/schemas/approvalPolicy.ts` (three new fields),
`apps/desktop/src/components/formula/ApprovalPanel.tsx`. See
[REGULATORY_ENGINE.md](REGULATORY_ENGINE.md) for how this fits into the
wider engine.

## What this closes

The original Phase 2 Approval Readiness integration checked exactly one
jurisdiction — the formulation's primary target market
(`targetMarkets[0]`) — regardless of how many EAC markets a product
actually shipped to. A product sold into Kenya, Uganda, and Tanzania
needed three separate manual passes through the Regulatory tab, with the
Approval tab's automatic gate only ever reflecting the first one. This
closes that gap: the six regulatory gates can now be required across
every jurisdiction a product actually targets, evaluated and reported
per-market, never silently collapsed to "the first one."

## `resolveRegulatoryJurisdictions` precedence

```ts
function resolveRegulatoryJurisdictions(
  policy: RegulatoryApprovalPolicy,
  targetMarkets: string[],
): RegulatoryJurisdiction[]
```

1. **`requiredRegulatoryJurisdictions`** (an explicit, non-empty list on
   the `ApprovalPolicy`) — always wins.
2. **`requireAllTargetMarketsReviewed: true`** — every one of the
   formulation's own `targetMarkets` that is a valid
   `RegulatoryJurisdiction` (falls back to `["KE"]` if none of the
   formulation's target markets happen to be valid jurisdiction codes).
3. **Otherwise** (`allowPrimaryMarketOnly`, or nothing set) — the
   formulation's first target market only, falling back to `"KE"` if it
   isn't a valid jurisdiction. This is the exact behavior every existing
   policy had before multi-jurisdiction support existed — a policy that
   never touches any of the three fields resolves identically to before.

All three fields default to empty/false on `ApprovalPolicy`
(`requiredRegulatoryJurisdictions?: RegulatoryJurisdiction[]`,
`requireAllTargetMarketsReviewed: false`,
`allowPrimaryMarketOnly: false`) — none of them turns a regulatory gate
on by itself; they only decide *which* jurisdiction(s) an already-enabled
gate evaluates against.

## Per-jurisdiction evaluation, never collapsed

`assessMultiJurisdictionRegulatoryReadiness(perJurisdiction:
RegulatoryReadinessInput[])` runs `assessRegulatoryReadiness` once per
resolved jurisdiction and returns:

```ts
{
  ready: boolean;               // true only when every jurisdiction is ready
  blockers: RegulatoryReadinessBlocker[];   // flattened, each still tagged with its own jurisdiction
  jurisdictionsEvaluated: RegulatoryJurisdiction[];
  perJurisdiction: { jurisdiction, ready, blockers }[];
}
```

An empty resolved-jurisdiction list (a resolution bug —
`resolveRegulatoryJurisdictions` is designed to always return at least
one) is itself treated as a blocker (`regulatory_jurisdiction_missing`)
rather than silently `ready: true`.

## Ten blocker codes

Every `RegulatoryReadinessBlocker` carries `{ id, code, message,
jurisdiction }` — a UI can always show exactly which market is blocking,
never a single undifferentiated list:

| Code | Gate |
|---|---|
| `regulatory_classification_missing` | `requireRegulatoryClassificationCompleted` |
| `regulatory_blocking_finding` | `requireNoBlockingRegulatoryFinding` |
| `regulatory_documents_missing` | `requireAllMandatoryDocumentsPresent` |
| `regulatory_evidence_missing` | `requireAllMandatoryEvidencePresent` |
| `regulatory_claims_unreviewed` | `requireAllRequiredClaimsReviewed` |
| `regulatory_human_review_missing` | `requireHumanRegulatoryReviewCompleted`, no review at all / `unknown` |
| `regulatory_review_wrong_version` | same gate, review status `stale_formula_version` |
| `regulatory_review_stale_rules` | same gate, review status `stale_rule_version` |
| `regulatory_review_wrong_packaging` | same gate, review status `wrong_packaging_sku` |
| `regulatory_jurisdiction_missing` | no jurisdiction resolved at all |

The human-review gate's code is chosen from
`HUMAN_REVIEW_BLOCKER_CODE[humanReviewStatus]`, defaulting to
`regulatory_human_review_missing` — a revoked or superseded review still
produces `regulatory_human_review_missing` with a message naming the
specific reason (`"the recorded review was revoked"` /
`"...superseded by a later one that is not current"`), rather than a
dedicated code per status; wrong-version/stale-rules/wrong-packaging get
their own codes because those are the three cases §3.3 explicitly calls
out for name.

## The Approval panel

`ApprovalPanel.tsx` computes `regulatoryJurisdictions =
resolveRegulatoryJurisdictions(regulatoryPolicy, formulation.targetMarkets)`,
derives one `RegulatoryReadinessInput` per jurisdiction via
`deriveRegulatoryReadiness` (passing the panel's real, selected, saved
`selectedVersion.id` — never a draft), and folds
`assessMultiJurisdictionRegulatoryReadiness`'s blockers into the same
`allBlockers` list every other readiness source already feeds. The
regulatory summary card iterates `regulatoryReadinessPerJurisdiction` and
tags each row with its jurisdiction whenever more than one is being
evaluated — a single-jurisdiction policy (the default) renders exactly
as it did before this closure.

## Tests

`regulatoryApproval.test.ts` (35 tests): `resolveRegulatoryJurisdictions`
precedence (explicit list wins, all-target-markets, primary-only
default, invalid-market fallback), `assessMultiJurisdictionRegulatoryReadiness`
(all-ready, one-jurisdiction-blocking, empty-list blocker), every new
blocker code, and version/jurisdiction/packaging-SKU-bound
`deriveRegulatoryReadiness` across confirmed/revoked/stale-review
scenarios. `ApprovalPanel.test.tsx` covers the UI integration
(classification-missing blocker, blocker clearing once a matching review
exists).

## Known limitations

- `resolveRegulatoryJurisdictions`'s target-markets fallback
  (`["KE"]` when none of a formulation's `targetMarkets` are valid
  jurisdiction codes) is a deliberate "never return an empty list"
  safeguard, not a real jurisdiction inference — a formulation with
  genuinely unconfigured target markets should be corrected there rather
  than relying on this fallback.
