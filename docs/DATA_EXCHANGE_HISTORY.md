# Data Exchange import/export history

Four collections, all on the Rust allow-list
(`apps/desktop/src-tauri/src/masterdata.rs`):

| Collection | append_only | Purpose |
|---|---|---|
| `data_exchange_import_jobs` | `false` | one row per import attempt, updated in place as it progresses |
| `data_exchange_import_row_results` | `true` | one row per committed source row, written once at commit, never edited |
| `data_exchange_export_jobs` | `true` | one row per export (blank/example/current-data, CSV/Excel) |
| `data_exchange_schema_versions` | `true` | reserved for future schema-version history; today the Schema Versions section reads the live registry directly |

## Why these collections *are* the audit trail

The Data Exchange Center is a project-less workspace, like
Administration — there is no `formulationId` to hang a per-formulation
`AuditEvent` off. Rather than forcing a project-less action into a
mechanism designed around one project's audit log (or inventing a
parallel "global" `AuditEvent` variant), Data Exchange follows the
precedent `TestDefinitionsPanel.tsx` already set (an existing, also
project-less Administration panel with zero `appendAudit` calls): the
job and row-result collections themselves are the durable, queryable
record of what happened, who did it, and when — matching how the spec
itself describes them. A `DataExchangeImportRowResult` records
`rowNumber`/`naturalKey`/`state`/`messages`/`targetCollection`/
`targetRecordId` per row — never the row's full source data, so the
audit trail can't itself become a second copy of a large imported file.

## `DataExchangeImportJob` — the real lifecycle, not just "committed"

```ts
status:
  "uploaded" | "parsing" | "preview_ready" | "validation_failed" |
  "awaiting_confirmation" | "committing" | "completed" |
  "completed_with_warnings" | "failed" | "cancelled"
```

A job row is written the moment a preview finishes, not only when a
commit succeeds:

1. Preview succeeds → job created with `awaiting_confirmation`.
2. Preview fails for a non-authorization reason (bad headers, empty
   file, oversized upload) → job created with `validation_failed`.
3. Preview fails because the role isn't authorized → **no job is
   created at all** — see
   [DATA_EXCHANGE_SECURITY.md](DATA_EXCHANGE_SECURITY.md#no-trace-of-an-unauthorized-attempt).
4. The user commits → the same job row (same `id`) is updated to
   `completed` (no failed rows), `completed_with_warnings` (some rows
   failed but at least one succeeded), or `failed` (nothing succeeded).
5. The user cancels the dialog instead of committing → the same job row
   is updated to `cancelled`.

This means **Import History shows every real attempt** — including ones
the user abandoned or that failed validation before any data was
touched — not only successful commits. `commitDataExchangeRows`'s
grouped/ungrouped outcomes feed the counts
(`createdRows`/`updatedRows`/`unchangedRows`/`duplicateRows`/
`warningRows`/`invalidRows`) stamped onto the final job record.

## `DataExchangeExportJob`

Recorded for every template download — blank, example or current-data,
CSV or Excel — via `DataExchangePage.tsx`'s `recordExport`. Fields:
`templateCode`, `templateSchemaVersion`, `exportType`
(`blank`/`example`/`current_data`), `fileType`, `rowCount`,
`requestedBy`, `requestedAt`. The session-local **Exports** section in
the UI mirrors this; Reports links to the same underlying history.

## Import History UI

`/data-exchange` → **Import History**: date, template, file name, actor,
status, created/updated/error counts, per-row detail via the same
preview UI, and a downloadable error report — reading straight from
`data_exchange_import_jobs`, refreshed on mount and whenever a dialog
closes (committed or cancelled), so a cancelled/failed attempt shows up
immediately, not only a completed one.

## Error reports

Downloadable as CSV (and reusing the same `.xlsx` builder for an Excel
version), with columns `row_number`, `template_code`, `column`,
`provided_value`, `error_code`, `severity`, `message`,
`suggested_action`, `reference_value` — never a secret local file path.
Regenerable at any time from the immutable, persisted row results for a
job, which is why error-report generation itself doesn't need its own
separate audit-log entry — it's a derived view of already-durable data.

## Idempotent re-import

Because every template's natural key and duplicate policy are fixed
(see [DATA_EXCHANGE_TEMPLATE_REGISTRY.md](DATA_EXCHANGE_TEMPLATE_REGISTRY.md)),
re-uploading the exact same file a second time reports every row
`unchanged` (or is refused outright for an `append_only`/
`reject_conflict` template attempting to repeat an existing key) —
never a silent duplicate record.
