# Persisted regulatory evidence confirmations

`packages/shared/src/schemas/regulatory.ts`
(`regulatoryEvidenceConfirmationSchema`,
`regulatoryEvidenceConfirmationRevocationSchema`,
`activeEvidenceConfirmations`),
`packages/shared/src/engine/regulatoryReviews.ts`
(`recordEvidenceConfirmation`/`revokeEvidenceConfirmation`). See
[REGULATORY_ENGINE.md](REGULATORY_ENGINE.md) for how this fits into the
wider engine.

## What this closes

Before this phase, confirming a product-level requirement (a label
element, a required document, a claim's evidence) in the Regulatory tab
was a session-local checkbox — it reset on reload and was never a real,
attributable record. `deriveRegulatoryReadiness`'s document/evidence/
claims gates now read a real, persisted, human-only
`RegulatoryEvidenceConfirmation` instead of a transient UI boolean.

**This is explicitly not the full Phase 3 dossier.** There is no
document-upload-and-attachment matrix keyed to every
`RegulatoryDocumentType`, no automatic expiry tracking beyond the
`RegulatoryEvidenceState` enum's existence, and no cross-formulation
evidence library. This is a minimal but real requirement/evidence layer,
scoped to exactly what Phase 2 closure needs: an actual persisted fact a
gate can read, instead of a UI checkbox.

## The record

```ts
RegulatoryEvidenceConfirmation {
  id, schemaVersion: "1.0",
  formulationId, formulaVersionId, jurisdiction, packagingSkuCode?,
  ruleId?,                 // the rule this confirmation answers, when rule-driven
  requirementType,         // "document" | "evidence" | "claim" | any RegulatoryRuleType
  requirementCode,         // e.g. a RegulatoryDocumentType, an evidence-type string, a claim keyword
  status,                  // "confirmed" | "not_available" | "not_applicable" | "rejected" | "revoked"
  confirmedBy, reviewerRole, confirmedAt,
  notes?, attachmentIds,
  revokesConfirmationId?,  // set when this confirmation corrects an earlier one
}
```

Five statuses (`REGULATORY_EVIDENCE_CONFIRMATION_STATUSES`) — only
`confirmed` and `not_applicable` satisfy a gate; `not_available`,
`rejected`, and `revoked` never do. `requirementType`
(`REGULATORY_REQUIREMENT_TYPES`) is `document`/`evidence`/`claim` for
the three coarse gates spec §3.5 asks for, or any `RegulatoryRuleType`
for a rule-driven confirmation. `REGULATORY_DOCUMENT_TYPES` enumerates
eleven document kinds (SDS, COA, ingredient declaration, supplier
declaration, laboratory report, stability report, packaging
compatibility report, claim substantiation, artwork, regulatory
certificate, external legal opinion) for when `requirementType ===
"document"`. `REGULATORY_EVIDENCE_STATES` (nine states) and
`REGULATORY_CLAIMS_STATES` (six states) exist for a UI to describe
*why* a document/claim isn't satisfied in more detail than the
confirmation's own five-status field — neither is itself stored on the
confirmation record; they are display vocabularies.

## Human-only, append-only, exactly scoped

`recordEvidenceConfirmation(input, actor)` requires a human actor (any
role — not gated to regulatory/quality/administrator) and a non-empty
`formulaVersionId`/`requirementCode`. A confirmation is never edited in
place: correcting one means recording a fresh confirmation with
`revokesConfirmationId` set to the one it supersedes, or calling
`revokeEvidenceConfirmation(confirmationId, actor, reason)` which appends
a separate `RegulatoryEvidenceConfirmationRevocation` — never a delete,
never an in-place edit.

`activeEvidenceConfirmations(formulaVersionId, jurisdiction,
packagingSkuCode, confirmations, revocations)` computes the live-active
set: filters to the exact version + jurisdiction + packaging SKU, excludes
anything with `status: "revoked"`, anything pointed at by a
`RegulatoryEvidenceConfirmationRevocation`, and anything superseded by a
later confirmation's own `revokesConfirmationId` — the same
compute-live-from-an-overlay convention `FormulaVersionEquivalence`
already uses, never stored as a separate "current" flag.

Absent or unknown is never treated as confirmed: a `document_requirement`
finding with no matching confirmation at all blocks exactly like one with
an explicit `not_available` confirmation.

## How readiness gates read this

`deriveRegulatoryReadiness` (`engine/regulatoryApproval.ts`) derives
`allMandatoryDocumentsPresent`/`allMandatoryEvidencePresent`/
`allRequiredClaimsReviewed` by:

1. Finding every `RegulatoryFinding` whose rule is of type
   `document_requirement`/`claim_evidence_requirement`/`claim_restriction`
   respectively (`findingsForRuleType`).
2. For each, checking `activeEvidenceConfirmations` for a
   confirmation matching that finding's `ruleId`, taking the
   most-recently-confirmed one if more than one exists.
3. Requiring `status === "confirmed"` or `status === "not_applicable"` —
   anything else, or no match at all, fails that gate.

## Tests

Confirmation record/revoke behavior is covered in
`regulatoryReviews.test.ts` (human-only gating, revocation requiring a
reason). Gate derivation from confirmations is covered in
`regulatoryApproval.test.ts` (35 tests total), including: a confirmed
document/evidence/claim finding satisfying its gate, a revoked
confirmation no longer satisfying it, and an absent confirmation never
silently passing.

## Known limitations

- No attachment-matrix UI beyond `attachmentIds` on the confirmation
  record itself (the array exists; there is no dedicated
  upload-per-document-type screen).
- No automatic expiry: a `confirmed` status does not itself track a
  validity window — an expired document must be manually revoked and
  reconfirmed. `REGULATORY_EVIDENCE_STATES` includes an `expired` value
  for display purposes, but nothing computes it automatically today.
- Confirmations do not aggregate across formulations — there is no
  shared evidence library where confirming a document once for one
  product counts toward another.
