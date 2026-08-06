# Data Exchange imports

Upload → detect format → parse → detect template → validate headers →
validate schema version → validate rows → resolve references →
classify → preview → confirm → persist atomically → import history.
**No import commits before an explicit preview and confirmation** — the
upload dialog (`DataExchangeImportDialog.tsx`) never calls the commit
layer until "Commit import" is clicked, and the underlying
`previewDataExchangeImport` function never writes anything at all — see
[DATA_EXCHANGE_VALIDATION.md](DATA_EXCHANGE_VALIDATION.md).

## The dialog flow

1. Choose a `.csv` or `.xlsx` file. `.xlsx` is rejected up front by the
   same `rejectUnsupportedWorkbook` check used everywhere else
   (macro-enabled/legacy binary workbooks refused before parsing).
2. The file is parsed (`parseCsv` / `readWorkbookRows`, both existing,
   shared code) and handed to `previewDataExchangeImport` along with the
   acting role and the target collection's current natural keys (via
   `apps/desktop/src/lib/dataExchangeExisting.ts`, so create-vs-update
   is a real check against real data, not guessed).
3. **A job row is recorded the moment the preview finishes** — status
   `awaiting_confirmation` on success, `validation_failed` on a
   non-authorization fatal error, or nothing at all if authorization was
   refused. See [DATA_EXCHANGE_HISTORY.md](DATA_EXCHANGE_HISTORY.md).
4. The preview shows summary pills (create / update / unchanged /
   duplicate / warning / invalid / reference-missing), the row-issue
   list with a downloadable error report, and a table of every
   committable row.
5. **Commit import** writes only the committable rows
   (`valid_create`/`valid_update`/`unchanged`/`warning`) through
   `commitDataExchangeRows`, updates the same job record to
   `completed`/`completed_with_warnings`/`failed`, and writes one
   `DataExchangeImportRowResult` per row.
6. **Cancel** (closing the dialog without committing) updates the same
   draft job record to `cancelled` instead of leaving it stranded at
   `awaiting_confirmation` forever.

## Row states

Nine states, defined in `packages/shared/src/schemas/dataExchange.ts`
(`DATA_EXCHANGE_ROW_STATES`) and produced by
`previewDataExchangeImport` — see
[DATA_EXCHANGE_VALIDATION.md](DATA_EXCHANGE_VALIDATION.md#row-classification)
for the exact classification order.

| State | Meaning | Committable? |
|---|---|---|
| `valid_create` | new natural key, no problems | yes |
| `valid_update` | existing natural key, mutable fields changed | yes |
| `unchanged` | existing natural key, deep-equal to what's stored | yes (no-op) |
| `duplicate` | natural key repeated within the same file | no |
| `warning` | an optional reference didn't resolve, or a similar soft issue | yes |
| `invalid` | a required field/type error, or an immutable-field conflict | no |
| `reference_missing` | a required `code_reference` column didn't resolve | no |
| `authorization_required` | reserved for future per-row authorization; today authorization is a whole-job refusal, never per-row | no |
| `unsupported` | the template is disabled, or (post-preview, at commit) no commit handler is wired for it | no |

## Grouped commits

Two templates group several CSV rows into one saved record, because
that record is written whole or not at all:

- **`formula_bom`** — every row sharing `(formula_code, formula_version)`
  becomes one formula version's `lines[]`. A `formula_version` that
  already exists is refused outright ("already exists and is immutable")
  — leave it blank to append the next version number instead.
- **`lab_results`** — every row sharing
  `(trial_code, sample_code, test_code)` becomes one test result's
  `replicates[]`.

`apps/desktop/src/lib/dataExchangeCommit.ts`'s `GROUPED_TEMPLATES` (the
group-key function) and `GROUPED_LINE_BUILDERS` (the per-group
line-flattening function) implement this; every row in a group receives
the same commit outcome.

## Duplicate / update policy, worked examples

See [DATA_EXCHANGE_TEMPLATE_REGISTRY.md](DATA_EXCHANGE_TEMPLATE_REGISTRY.md#datadataexchangeduplicatepolicy--5-values)
for the five policies. Concrete examples:

- A **material** (`create_or_update`) importing an existing
  `material_code` updates its mutable fields (name, physical form,
  storage) in place.
- A **saved formula version** (`reject_conflict` in practice — the
  commit handler throws) is never overwritten; re-importing the same
  `(formula_code, formula_version)` is refused.
- A **reviewed dossier requirement** (`new_revision`, target collection
  is append-only) can never be silently rewritten by an import.
- A **material-supplier price** (`append_history`) with a new
  `valid_from` is appended as a new validity period, not merged into the
  old row.
- A **lab result** (`new_revision`, target collection `test_results` is
  append-only) requires a genuinely new result, never an in-place edit.
- A **regulatory rule** import (`create_or_update`, but always
  re-stamped `verificationStatus: "not_verified"`) creates or updates an
  unverified rule — never a verified one, whatever the file claims.
- A **product claim** text change (commit handler always creates a new
  claim record, `status: "draft"`) never overwrites the prior claim's
  text.
- An **artwork** replacement (`artwork_register`'s commit handler throws
  if the `artwork_code` already exists) requires a new code plus
  `supersedes_artwork_code` — a fresh revision, never an overwrite.

## Authorization

Every template's `authorization: readonly ApprovalRole[]` is checked in
`previewDataExchangeImport` **before a single row is parsed** — a whole-
job refusal, not a per-row one. On refusal:

- The preview returns `authorizationDenied: true` and a `fatalError`
  message naming the required role(s).
- **No job record, and no other persistence or audit trace of any
  kind, is written.** This is the one case in the whole pipeline where
  nothing is recorded — matching the spec's explicit rule that an
  unauthorized attempt leaves no trace.
- Domain enforcement is the real gate: hiding a disabled button in the
  UI is a convenience only. The same `previewDataExchangeImport`
  authorization check runs regardless of what the UI shows, and the
  commit layer is only ever reached from a preview that already passed
  it.

An import can never verify a regulatory rule, approve a dossier, verify
evidence, approve a claim, approve a label or artwork, complete a formal
review, or approve a costing override — those fields are hardcoded to
their unverified/draft value in every commit handler regardless of what
the acting role was authorized to import. See
[DATA_EXCHANGE_TEMPLATE_CATALOG.md](DATA_EXCHANGE_TEMPLATE_CATALOG.md)
for the per-template detail.
