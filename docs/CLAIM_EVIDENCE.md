# Claim evidence links (Phase 4)

`packages/shared/src/schemas/claimsLabels.ts` (`claimEvidenceLinkSchema`),
`packages/shared/src/engine/claims.ts` (`proposeClaimEvidenceLink`/
`acceptClaimEvidenceLink`/`rejectClaimEvidenceLink`/
`revokeClaimEvidenceLink`/`activeLinksForClaim`/
`evaluateClaimEvidenceEligibility`/`evaluateClaimEvidence`). Builds directly
on [DOSSIER_EVIDENCE.md](DOSSIER_EVIDENCE.md) (Phase 3) — a claim's evidence
is a Phase 3 dossier evidence item, referenced by id, **never duplicated**.

## What this is

A `ClaimEvidenceLink` records that a specific `RegulatoryDossierEvidenceItem`
is claimed to support a specific `ProductClaim`. The link itself never
proves anything — it is a proposal that a human must accept, and even an
accepted link only counts toward satisfaction if the underlying evidence is
independently eligible and verified.

## The record

```ts
ClaimEvidenceLink {
  id, schemaVersion: "1.0", claimId, evidenceItemId,
  dossierId, dossierRevision,   // which dossier/revision the evidence came from
  linkStatus,                    // proposed | accepted | rejected | revoked
  linkedBy, linkedAt, reviewedBy?, reviewedAt?, notes?,
  revokesLinkId?,                 // set on the revocation row
}
```

## Lifecycle

Any human role may `proposeClaimEvidenceLink`/`acceptClaimEvidenceLink`/
`rejectClaimEvidenceLink` — the same authorization tier as creating a
claim. `revokeClaimEvidenceLink` is append-only: it never mutates the
accepted row, it creates a new row with `linkStatus: "revoked"` and
`revokesLinkId` pointing at the one it revokes. `activeLinksForClaim` takes
the latest row per `(claimId, evidenceItemId)` pair, excluding revoked —
a general-purpose display overlay used by the UI.

## Eligibility and satisfaction

`evaluateClaimEvidenceEligibility(evidence, ctx)` mirrors the dossier
evidence-matrix eligibility check: an evidence item cannot support a claim
just because a link exists — it must actually be eligible for the claim's
exact formula version, packaging SKU and jurisdiction scope, and it must not
be expired/rejected/revoked/superseded.

`evaluateClaimEvidence(claim, links, evidenceItems, ctx)` computes whether a
claim has verified, eligible evidence. **Real bug caught and fixed**: this
function filters to `linkStatus === "accepted"` specifically — a merely
`"proposed"` link never counts, even though `activeLinksForClaim`'s general
"not revoked" filter would otherwise let it through for *display* purposes.
The fix lives inside `evaluateClaimEvidence` itself, not
`activeLinksForClaim`, to avoid narrowing that helper's general-purpose
semantics for other callers.

## Never duplicated

The Claims & Labels workspace's Evidence section lets a human pick from the
formula version's existing dossier evidence items and propose a link — it
never copies a file or creates a second evidence record. This is the same
"reference, never duplicate" principle Phase 4 §15 requires for dossier
integration.

## Status

**Implemented, verified by tests** (`claims.test.ts` — propose/accept/
reject/revoke, eligibility rejection reasons, the accepted-only satisfaction
fix). Workspace UI: **implemented, verified by UI-integration tests**
(`ClaimsLabelsPanel.test.tsx` — "proposes and accepts a claim evidence link
reused from the dossier, never duplicating the record").
