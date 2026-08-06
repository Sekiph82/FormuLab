# Data Exchange exports

Every one of the 24 templates offers six downloads from its Template
Library card, in both CSV and Excel where noted:

| Kind | Content | Formats |
|---|---|---|
| Blank | header row only | CSV, Excel |
| Example | 1-3 synthetic `TEST-`-prefixed rows using valid enum values | CSV, Excel |
| Current data | every real, exportable record currently in the target collection | CSV, Excel |

`dataExchangeBlankCsv`/`dataExchangeExampleCsv`/`dataExchangeTemplateCsv`
(`packages/shared/src/engine/dataExchangeCsv.ts`) and
`buildDataExchangeWorkbookBlob` (`apps/desktop/src/lib/dataExchangeXlsx.ts`)
share the same column-ordering and formatting logic as import — a file
downloaded from Export and re-uploaded unchanged always reports every
row `unchanged`, never accidentally reclassified as an update.

## CSV format

- UTF-8 with a leading BOM, for Excel locale compatibility.
- RFC 4180 quoting — embedded commas, quotes and newlines all round-trip.
- Stable column order (exportable columns, in registry-definition order).
- ISO dates (`YYYY-MM-DD`), locale-independent decimal strings.
- A cell beginning `=`, `+`, `-` or `@` is neutralized on export the same
  way the existing Materials importer already neutralizes it — see
  [DATA_EXCHANGE_SECURITY.md](DATA_EXCHANGE_SECURITY.md#formula-injection).

## Excel format

A real multi-sheet `.xlsx` built with ExcelJS
(`apps/desktop/src/lib/dataExchangeXlsx.ts`) — never a CSV renamed with
an `.xlsx` extension:

- **Data** (always sheet 1) — frozen header row, autofilter, a required
  column's header shaded, per-column number/date/percent formatting, and
  a dropdown data-validation on every `enum` column sourced from the
  Validation Lists sheet. Because this is sheet 1, the existing generic
  `apps/desktop/src/lib/xlsx.ts`'s `readWorkbookRows` (which always reads
  `wb.worksheets[0]`) parses a Data Exchange workbook exactly the same
  way it parses any other `.xlsx` import in the app.
- **Validation Lists** — one column per enum field, listing its valid
  values; built before the Data sheet's dropdowns so the column letters
  already exist when the dropdown references them.
- **Field Documentation** — every column (including non-exportable
  ones), its data type, whether it's required, and its description.
- **Schema Metadata** — template code, title, module, schema version,
  natural key, duplicate policy, update policy, and the export's
  generation timestamp.

Dropdown validation is padded to at least 200 rows past the current data
so a user filling in a blank template keeps getting the dropdown as they
type new rows, not just on the rows that were present at export time.

## Current-data export

`apps/desktop/src/lib/dataExchangeExisting.ts`'s per-template loaders
flatten the real persisted collection back into the template's row
shape — stable column order, exportable fields only, IDs/codes preserved
so a re-import matches the same natural key, no secrets. `formula_bom`'s
loader is separate (`loadExistingFormulaBom`) since formulas live in the
session-based `formulations.ts` store, not the generic masterdata
mechanism. A template without a dedicated loader here returns an empty
lookup — the export still runs, honestly returning zero current rows,
rather than fabricating data.

## Export history

Every export (blank, example or current-data; CSV or Excel) records a
`DataExchangeExportJob` — see
[DATA_EXCHANGE_HISTORY.md](DATA_EXCHANGE_HISTORY.md#export-jobs). The
Data Exchange Center's **Exports** section shows the session's export
log; Reports links to the same history.
