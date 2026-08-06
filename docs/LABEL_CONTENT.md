# Label content blocks (Phase 4)

`packages/shared/src/schemas/claimsLabels.ts` (`labelContentBlockSchema`),
`packages/shared/src/engine/labels.ts` (`setLabelContent`/
`currentContentForRevision`/`evaluateLabelContent`). See
[PRODUCT_LABELS.md](PRODUCT_LABELS.md) for requirement generation this
evaluates against.

## What this is

A `LabelContentBlock` is one piece of label text: a specific block type
(front/back/side-panel field), a specific language, for a specific label
revision. Structured content editing, **never a free-form rich-text
editor** — every block is one of the 26 real, named types below.

## The record

```ts
LabelContentBlock {
  id, schemaVersion: "1.0", labelId, labelRevision, blockType,
  text, language, position, mandatory,
  source,                    // manual | imported | ai_suggested | formulab_record
  sourceEntityId?,
  translationStatus,          // draft | machine_suggested | human_review_required | reviewed | rejected | superseded
  status,                      // present | missing | invalid | human_review_required
  createdBy, createdAt,
}
```

`LABEL_CONTENT_BLOCK_TYPES` (26): product_name, product_description,
net_quantity, ingredients, inci, directions, warnings, precautions,
first_aid, storage, disposal, manufacturer, responsible_party,
country_of_origin, batch_code, manufacture_date, expiry_date, best_before,
barcode, registration_number, certification_mark, claims,
contact_information, website, recycling, other.

The Claims & Labels workspace groups these 26 into 7 coherent editor
sections: Front/Back/Side panel, Ingredients, Directions, Warnings, Claims,
Manufacturer, Codes & identifiers (`CONTENT_GROUPS` in
`ClaimsLabelsPanel.tsx`) — never a full graphic-design editor, one bounded
text field per real block type.

## Append-only overlay

Content blocks are append-only per `(labelId, labelRevision, blockType,
language)` — `setLabelContent` never edits an existing row, it always
inserts a new one. `currentContentForRevision(blocks, labelId,
labelRevision)` takes the latest row per key (by `createdAt`) — the same
overlay convention `RegulatoryDossierRequirement` and `ClaimEvidenceLink`
already use. History is preserved; only the *current* view is a single
row per key.

## Translation status

`translationStatus` distinguishes a human-authored/reviewed block from a
machine-suggested one. **AI translations may assist but are never
considered approved** — `evaluateLabelContent` marks a block `"unverified"`
(not `"present"`) when its `translationStatus` is `machine_suggested` or
`human_review_required`, even if the text field itself is non-empty.

## Requirement evaluation

`evaluateLabelContent(requirements, blocks, language)` joins the frozen
requirement list against the current blocks for one language, returning one
of 9 states per requirement (`LABEL_REQUIREMENT_STATES`: present, missing,
invalid, inconsistent, unverified, expired, not_applicable,
human_review_required, unknown). **Unknown/human-review-required always
blocks readiness where the requirement is mandatory** — see
[CLAIMS_LABEL_READINESS.md](CLAIMS_LABEL_READINESS.md).

## Import/export

JSON/CSV/Excel export and import, scoped to one label's current revision
(content is revision-scoped, unlike claims' list-wide export). Imported
rows go through the same `setLabelContent` path with `source: "imported"`
— never auto-approved, never silently overwriting without going through the
same append-only-per-key overlay every other content write uses. See
[IMPORT_EXPORT.md](IMPORT_EXPORT.md).

## Status

**Implemented, verified by tests** (`labels.test.ts` — missing/present
detection, latest-per-key overlay, machine-suggested-is-unverified).
Workspace UI (`ClaimsLabelsPanel.tsx`'s Content section): **implemented,
verified by UI-integration tests** (`ClaimsLabelsPanel.test.tsx` — content
save, JSON import).
