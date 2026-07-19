# Compatibility and safety rule import/export

`apps/desktop/src/components/formula/RuleManager.tsx`, shared by both the
compatibility and safety tabs — the two rule shapes are structurally close
enough (id/name/status/severity/conditions/verificationStatus/active) to use
one screen rather than build two.

## Export

- **JSON** — the current rule set (whichever collection the tab is scoped
  to: `compatibility_rules` or `safety_rules`) as a formatted JSON array,
  downloaded as `{kind}-rules.json`.
- **Excel (`.xlsx`)** — a flattened summary sheet (`id`, `name`, `status`,
  `severity`, `ruleType`, `verificationStatus`, `active`, `message`) built
  with `buildXlsxBlob` (`apps/desktop/src/lib/xlsx.ts`), downloaded as
  `{kind}-rules.xlsx`. This is a read-oriented export for review outside the
  app — the conditions structure and safety-specific fields (PPE,
  engineering controls) are not represented in the flattened sheet, so it is
  not a full round-trip format.

## Import

**JSON only.** The import dialog accepts a pasted JSON array (or a single
object) of rules "exported from this screen, or edited by hand." Before
anything is written:

1. The pasted text must parse as JSON (`invalidJson` otherwise).
2. Every entry must be an object with at minimum `id`, `name` and
   `conditions` present (`invalidShape` otherwise). This is a shape check,
   not full schema validation against `compatibilityRuleSchema` /
   `safetyRuleSchema` — malformed field values inside an otherwise
   well-shaped rule are not rejected at this layer.
3. Rows are sent to `upsertRecords(collection, rows)`, which calls the Rust
   `upsert_master_records` command. Both `compatibility_rules` and
   `safety_rules` are registered as **editable** (not append-only)
   collections (`apps/desktop/src-tauri/src/masterdata.rs`), matched and
   updated **by `id`** — importing the same file twice leaves the same data
   rather than duplicating rules.

## Verification status is not upgraded by import

Nothing in the import path sets or changes `verificationStatus`. A rule
imported with `verificationStatus: "not_verified"` (or omitted, which the
schema defaults to `not_verified`) stays exactly that after import — an
import can never silently make a rule appear `verified`. Promoting a rule to
`verified` is a deliberate, separate edit made from the rule editor after a
person has actually checked it; nothing about the bulk-import path implies
that check happened. The same applies to hazard-data records: a bulk import
lands as `imported_unverified`, a status that exists specifically so a
reviewer can filter to "everything from this import batch" as a distinct
worklist from the general `not_verified` backlog.

## This does not let anyone bypass safety

- Importing rules cannot approve a formula. `upsert_master_records` writes
  to the rule collections only; it has no path to
  `pilot_approved`/`production_approved`, which remain gated by
  `canTransitionTo` and [APPROVAL_READINESS.md](APPROVAL_READINESS.md)
  regardless of what rules exist.
- Importing a rule that happens to match nothing in a formula does not
  clear any existing finding — findings come from evaluating the *current*
  rule set against the *current* formula, not from the import event itself.
- A rule set with fewer or weaker rules after an import does not retroactively
  soften a past `CompatibilitySnapshot` or `SafetySnapshot` — snapshots pin
  the rule versions they used and are immutable (see
  [COMPATIBILITY_ENGINE.md](COMPATIBILITY_ENGINE.md) and
  [SAFETY_ENGINE.md](SAFETY_ENGINE.md)).
- There is no import path for `SafetyResolution` records — a blocking
  finding's resolution always requires a reviewer name, a reason and a
  resolution kind entered through the resolution dialog, never a bulk
  upload.

## Known limitations

- No `.xlsx` **import** for rules, only JSON — the Excel export exists for
  review/reporting, not as a round-trip authoring format.
- No column-mapping or per-row error/warning preview for rule import, unlike
  the raw-material/supplier/packaging import path (see
  [IMPORT_EXPORT.md](IMPORT_EXPORT.md)); a malformed row fails the whole
  paste rather than being reported individually.
- No import history/undo beyond the general collection backup taken before
  destructive changes.
