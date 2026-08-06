# Label artwork (Phase 4)

`packages/shared/src/schemas/claimsLabels.ts` (`labelArtworkSchema`),
`packages/shared/src/engine/labels.ts` (`uploadArtwork`/`approveArtwork`/
`rejectArtwork`/`replaceArtwork`/`deriveArtworkEffectiveStatus`/
`evaluateArtworkReadiness`). Reuses [ATTACHMENTS.md](ATTACHMENTS.md)'s safe
attachment-copy mechanism for the actual file — never a raw renderer path.

## What this is

A `LabelArtwork` record is one uploaded artwork file (or file set) for one
label revision — a mutable "current state" row until it is replaced by a
NEW row (never edited in place once a replacement exists), the same
`supersedesArtworkId` chain `RegulatoryDossierEvidenceItem` already uses.

## The record

```ts
LabelArtwork {
  id, schemaVersion: "1.0", labelId, labelRevision, artworkCode,
  attachmentIds,           // real, copied-into-project files (see ATTACHMENTS.md)
  format?, dimensions?, colorMode?, languageSet,
  createdBy, createdAt,
  status,                    // 7-state lifecycle
  supersedesArtworkId?,       // set on the replacement row
}
```

`LABEL_ARTWORK_STATUSES` (7): draft, uploaded, under_review,
changes_requested, approved, rejected, superseded.

## Lifecycle

`uploadArtwork` (any human role) starts at `draft` (no attachment yet) or
`uploaded` (attachment present). `approveArtwork`/`rejectArtwork` require
`requireAuthorizedRegulatoryActor` — approval refuses an artwork with no
attachment. `replaceArtwork(current, input, actor)` creates a NEW artwork
row (not an edit): the OLD row's status becomes `superseded`, the new row's
`supersedesArtworkId` points at it.
`deriveArtworkEffectiveStatus(artwork, allArtworkInScope)` computes
`"superseded"` by checking whether any later artwork points back at this
one — derived, never self-reported.

**Replacing artwork makes any prior review of it stale** — a
`LabelReview.artworkId`/`artworkRevision` pointing at a since-superseded
artwork is no longer current; `isLabelReviewActive` (see
[LABEL_REVIEWS.md](LABEL_REVIEWS.md)) checks the artwork revision alongside
the label revision for exactly this reason.

## Readiness

`evaluateArtworkReadiness(artwork)` returns a blocking finding
(`artwork_missing` or `artwork_unapproved`) unless the current artwork
exists and its status is `approved`. Folded into
[CLAIMS_LABEL_READINESS.md](CLAIMS_LABEL_READINESS.md) and, when the
`requireArtworkApproved` Approval policy gate is on, into Approval
Readiness itself (see [APPROVAL_POLICIES.md](APPROVAL_POLICIES.md)).

## Preview

The Claims & Labels workspace's Artwork section shows the current
attachment (reusing the existing `AttachmentField` open-attachment
mechanism) and the full revision chain (previous artwork, replacement
reason is captured via the workflow's required attachment swap) — **never
a full graphic-design editor**, only upload/preview/approve/reject/replace.

## Status

**Implemented, verified by tests** (`labels.test.ts` — upload/approve/
reject authorization, replacement chain, readiness blocking on missing/
unapproved artwork). Workspace UI: **implemented, verified by
UI-integration tests** (`ClaimsLabelsPanel.test.tsx` — "uploads artwork and
only an authorized actor can approve it").
