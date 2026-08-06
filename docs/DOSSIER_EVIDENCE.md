# Dossier evidence (Phase 3)

`packages/shared/src/schemas/dossier.ts`
(`regulatoryDossierEvidenceItemSchema`, `regulatoryRequirementEvidenceLinkSchema`),
`packages/shared/src/engine/regulatoryDossier.ts` (`addDraftEvidence`/
`verifyEvidence`/`rejectEvidence`/`revokeEvidence`/`replaceEvidence`/
`deriveEvidenceStatus`/`resolveEvidenceRevisionChain`/`proposeEvidenceLink`/
`acceptEvidenceLink`/`rejectEvidenceLink`/`revokeEvidenceLink`/
`activeLinksForDossier`/`mapEvidenceToRequirements`),
`packages/shared/src/engine/dossierRecordDiscovery.ts` (automatic suggestion
from other FormuLab records). See [ATTACHMENTS.md](ATTACHMENTS.md) for the
underlying secure-attachment mechanism this reuses unchanged, and
[EVIDENCE_MATRIX.md](EVIDENCE_MATRIX.md) for how a link's acceptance feeds
into requirement satisfaction.

## The evidence item

```ts
RegulatoryDossierEvidenceItem {
  id, schemaVersion: "1.0", dossierId,
  formulationId, formulaVersionId, packagingSkuCode?, jurisdictions,
  evidenceType,       // 21 values: sds/coa/laboratory_report/artwork/...
  documentType?, title, description?,
  status,             // 9-state lifecycle, see below
  sourceType,         // "uploaded" | "formulab_record" | "manual_entry"
  sourceEntityId?,    // set when sourceType === "formulab_record"
  attachmentIds,      // AttachmentReference[] — the existing secure attachment system
  documentNumber?, issuer?, issuedAt?, effectiveAt?, expiresAt?, receivedAt?, language?,
  confidentiality,    // "normal" | "confidential"
  createdBy, createdAt,
  verifiedBy?, verifiedByRole?, verifiedAt?, verificationNotes?,
  rejectedBy?, rejectedAt?, rejectionReason?,
  revokedBy?, revokedAt?, revocationReason?,
  supersedesEvidenceId?, updatedAt,
}
```

`DOSSIER_EVIDENCE_LIFECYCLE_STATUSES` (9): `draft`, `present_unverified`,
`under_review`, `verified`, `rejected`, `expired`, `revoked`, `superseded`,
`not_applicable`.

## Who can do what

`addDraftEvidence` (any human role, via `requireHumanActor`) starts an item
`present_unverified` if it already has an attachment, else `draft` —
uploading is never itself verification. `verifyEvidence`/`rejectEvidence`/
`revokeEvidence` require `requireAuthorizedRegulatoryActor`
(regulatory/quality/administrator) — **an AI/system/import actor can never
verify evidence**, and `verifyEvidence` additionally refuses an item with zero
attachments. A chemist or researcher may upload draft evidence and propose
notes, but cannot perform the formal verification step.

## Replacement, not silent overwrite

`replaceEvidence(current, input, actor)` (any human role) never edits the
current row's file in place. It returns `{ superseded, replacement }`: the
old row is marked `supersedesEvidenceId`-pointed-at by the new one, and the
old row (and its attachment) stays fully openable — `resolveEvidenceRevisionChain`
walks the chain back through every prior version.
`deriveEvidenceStatus(evidence, allEvidenceInScope)` computes `"superseded"`
the same overlay way `deriveDossierStatus` computes it for dossiers: by
checking whether another item's `supersedesEvidenceId` points at this one,
never by trusting a self-reported flag.

There is deliberately no separate "evidence revisions" collection — the
`supersedesEvidenceId` chain on the same mutable collection already gives the
same history a dedicated table would, the same pattern `RegulatoryRule`
already uses for its own revisions.

## Requirement-evidence links

A `RegulatoryRequirementEvidenceLink` is the only thing that connects an
evidence item to a requirement — evidence is never implicitly "for" a
requirement just because both exist in the same dossier.
`DOSSIER_LINK_STATUSES`: `proposed`, `accepted`, `rejected`, `revoked`.
**Linking is not verifying**: only an `accepted` link, whose evidence is
independently `verified` (see [EVIDENCE_MATRIX.md](EVIDENCE_MATRIX.md)),
contributes to a requirement's satisfaction — a `proposed` link never does.
`propose/accept/reject/revokeEvidenceLink` all require `requireHumanActor` —
spec §4.4 says "a human must accept the mapping," not narrowed to the three
authorized regulatory roles the way formal evidence *verification* is.
Rejected and revoked links remain in history; `activeLinksForDossier` takes
the latest row per `(requirementId, evidenceItemId)` pair, excluding revoked.

`mapEvidenceToRequirements(requirements, evidenceItems, ctx)` is a
suggestion-only matcher (by evidence type, accepted document types, formula
version, packaging SKU, and jurisdiction) — it never creates a link itself; a
human still has to propose and then accept one.

## Automatic evidence discovery from other FormuLab records

`discoverDossierEvidenceCandidates` (see
[dossierRecordDiscovery.ts](../packages/shared/src/engine/dossierRecordDiscovery.ts))
suggests candidate evidence from raw-material documents, laboratory
trial/stability results, packaging compatibility snapshots, regulatory
reviews, and Phase 2 evidence confirmations — always as a suggestion a human
must accept via `candidateToDraftEvidenceInput` + `addDraftEvidence`, never
auto-verified, and always referencing the source record's own attachment
(never copying it as a new file). Version/packaging/jurisdiction mismatches
are flagged on the candidate, never hidden. Supplier documents, artwork, and
cost snapshots are not (yet) covered — see that file's header comment for why.

## Status

Implemented, verified by tests (`regulatoryDossier.test.ts`,
`dossierRecordDiscovery.test.ts`, `DossierPanel.test.tsx`). Evidence Library
UI (add/verify/reject/revoke, link/unlink, JSON/CSV/Excel import with
preview) is implemented in `DossierPanel.tsx` — see
[WORKSPACES.md](WORKSPACES.md#dossiers). The automatic-discovery-from-other-
records suggestion UI (surfacing `discoverDossierEvidenceCandidates`
results inline) is not yet wired into the panel — the engine function is
implemented and tested, but a human currently has to know what to look for
rather than being shown a suggestion list.
