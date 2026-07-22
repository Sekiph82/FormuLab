# Formula versioning

## Draft versus version

Two different objects, and the distinction is the point of the module.

| | Working draft | Saved version |
| --- | --- | --- |
| Count | Exactly one per project | Many |
| Mutable | Yes | **Never** |
| Written by | Autosave, on a debounce | An explicit save with a change reason |
| Stored at | `data/formulations/<id>/draft.json` | `data/formulations/<id>/versions/<versionId>.json` |

Autosave writes the draft and only the draft. A morning of editing leaves one
draft, not four hundred versions nobody can navigate.

A saved version is never edited in place. Editing a saved formula means editing
a **draft derived from it**; saving produces a new version recording the old one
as its parent. That is what makes "which formula did batch 412 come from?"
answerable a year later.

The Rust command refuses to overwrite an existing version file. The rule is
enforced at the storage layer, not only in the UI, because "the button was
hidden" is not a safety property.

## What a version records

Beyond the formula lines:

- Version number and display label, parent version id, branch name
- Author, timestamp, change reason (required), change notes
- **Totals snapshot** — what the formula totalled at save time
- **Validation snapshot** — error, warning and blocking counts, and the codes
- **Intent snapshot** — target markets, claims and SKUs as they stood
- Batch basis, source run ids, approval record ids

Snapshots are stored rather than recomputed on read. Recomputing would silently
"fix" a version whose numbers were wrong at the time — which is exactly the
history a batch investigation needs to see. Editing the project brief afterwards
cannot rewrite what a saved version says the intent was.

## Version labels

Pre-release versions are labelled `0.1`, `0.2`, `0.3`…; a version that reaches
an approved status is labelled `1.0`, `2.0`.

The label is cosmetic. `versionNumber` is the ordering key, and the storage id
is neither. A database row id is never shown as a version number.

## Actions

| Action | Effect |
| --- | --- |
| Save version | Promotes the draft. Requires a change reason. |
| Restore | Loads an old version into a **new** draft. The version is untouched. |
| Clone / variant | Same mechanism; the new draft carries no approval state. |
| Compare | Field-level diff of any two versions. |

A version history where every entry says nothing looks like an audit trail while
answering none of the questions an audit asks, so `createVersion` throws without
a change reason rather than defaulting one in.

Deletion of an approved version is not offered. Prefer `retired` or `rejected`.

## Comparison

`compareVersions` reports, per line: added, removed, changed or unchanged, with
field-level detail for percentage, batch quantity, supplier, unit price,
currency, functions, phase, INCI name, active matter and evidence origin. Plus
totals, active matter, batch size, status, claims and target SKUs.

Note that changing any line also changes the q.s. line, and the diff says so.
Hiding that would be lying about what an operator will weigh out.

Everything reported is a fact about the two records. There is deliberately no
"this will improve foam" narrative — that would be a model's guess wearing the
clothes of a measurement, and this screen is what a change record gets copied
from. Any inferred impact must be labelled `estimated` /
`requires laboratory confirmation` at the point it is produced.

## Approval

The load-bearing rule: **no automated actor can approve a formula.**

`canTransitionTo` (`packages/shared/src/schemas/status.ts`) refuses
`pilot_approved` and `production_approved` to any actor that is not a human,
whatever the model concluded about the formula's quality. Four actor kinds:

- `human` — needs an authorised role **and** a signed `ApprovalRecord`
- `agent` — refused, `APPROVAL_REQUIRES_HUMAN`
- `system` — refused
- `import` — refused. Even when a spreadsheet says "approved", that signature
  was given somewhere FormuLab cannot audit, so it must be granted again here.

Additional guarantees:

- A clone or restore of an approved version starts at `concept`. Approval is
  never inherited.
- The Rust `save_formulation_version` command independently refuses an approved
  status with no approval record — defence in depth against a bug or a script
  calling the command directly.
- `save_approval_record` rejects an approval attributed to "ai", "system",
  "agent", "model", "automation" or "import", and requires a justification.
- Every save, restore and approval appends to `audit.jsonl`, which is
  append-only by construction.

Tests covering each bypass attempt are in
`packages/shared/src/engine/versioning.test.ts`.

A version created from an applied Advanced Optimizer or substitution result
carries `appliedOptimizationRunCode` / `appliedSubstitutionRunCode` —
[APPROVAL_READINESS.md](APPROVAL_READINESS.md) looks up the real, persisted
run by that code and blocks approval if its stored result was not actually
usable, a defensive re-check independent of the solver's/scorer's own
correctness. Neither field grants or implies approval; both are additive,
optional, and absent on every version authored directly.

## Relationship to laboratory trials and stability studies

A [Laboratory Trial](LABORATORY_TRIALS.md) or [Stability Study](STABILITY_STUDIES.md)
records `sourceFormulaVersionId` when it started from a saved version, or
`sourceDraftId` when it started from the (mutable) working draft — but
either way it embeds its own frozen `formulaSnapshot`, captured once at
creation, using the exact same "snapshot rather than recompute on read"
principle this document's version snapshots already follow. A trial or
study is therefore immune to a later formula edit even when it started from
the working draft, which a saved version alone would not be (the working
draft keeps changing after a trial branches off it). Applying a
[corrective action](CORRECTIVE_ACTIONS.md)'s draft reuses `draftFromVersion`
directly — the same function any other "start a variant" action uses — and
never inherits approval, exactly like every other draft described above.

## Known limitations

- Variant comparison covers two versions at a time; there is no whole-tree
  graph view.
- Restore is the only merge path — there is no automatic merge of formula
  percentages across variants, by design (see
  [FORMULA_BUILDER.md](FORMULA_BUILDER.md)).
