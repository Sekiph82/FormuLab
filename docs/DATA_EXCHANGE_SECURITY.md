# Data Exchange security properties

What the Data Exchange Center defends against, and how — reusing the
codebase's existing defenses rather than inventing parallel ones.

## Spreadsheet formula injection

A cell beginning `=`, `+`, `-`, `@`, tab or carriage return is executable
in Excel/LibreOffice/Google Sheets. Every CSV and Excel export neutralizes
it on write (the same `sanitizeCell` convention
`packages/shared/src/engine/importer.ts` already established for the
Materials importer); every import strips the neutralization back off on
read (`desanitizeCell`) so the *stored* value is the real text, only the
*exported* file is defused. Verified by
`dataExchangeCsv.test.ts` and `dataExchangeXlsx.test.ts`'s
formula-injection round-trip tests.

## Path traversal / arbitrary file access

Nothing in the Data Exchange Center ever writes an uploaded file to disk
under a renderer-controlled path. An uploaded file is read entirely
in-memory (`file.arrayBuffer()`), parsed into rows, and every value that
reaches persistence goes through the normal Tauri
`upsertRecords`/allow-listed-collection path — never a raw filesystem
write driven by user input. Downloaded filenames
(`dataExchangeCsvFileName`/`dataExchangeXlsxFileName`) are generated from
the template's own `templateCode` and a fixed suffix, never from
user-supplied text.

## Oversized files and excessive rows

`DATA_EXCHANGE_MAX_FILE_BYTES` (25 MB) and `DATA_EXCHANGE_MAX_ROWS`
(20,000 data rows) are real, enforced job-level fatal checks in
`previewDataExchangeImport` — a file exceeding either is refused before
a single row is parsed, not merely slow.

## Malformed / unsupported workbooks

`.xlsx` uploads go through the same `rejectUnsupportedWorkbook` check
every other Excel import in the app uses: macro-enabled (`.xlsm`) and
legacy binary (`.xls`) workbooks are refused by extension before
ExcelJS ever attempts to parse them. A workbook that fails to parse
(corrupt ZIP container, unreadable XML) is caught and reported as
`fileUnreadable`, never left half-processed.

## Duplicate / hidden columns

A duplicate header (after case/whitespace/punctuation-insensitive
normalization) is a job-level fatal error — an ambiguous column mapping
is refused rather than silently picking one occurrence. A header that
doesn't map to any known column is collected as `unmappedHeaders` and
surfaced to the user, never silently ignored or silently written
somewhere unexpected.

## Dangerous hyperlinks

The Data Exchange Center's own generated `.xlsx` workbooks never embed a
hyperlink at all — no `HYPERLINK()` formula, no cell-level link object —
so there is no dangerous-hyperlink surface to defend on export. On
import, a hyperlink formula in an uploaded cell is read as its
underlying text value (ExcelJS's normal cell-value read), never
followed or executed.

## Formula-like cell prefixes on import

The same `=`/`+`/`-`/`@` prefix check that neutralizes exports also
governs what an import accepts: `desanitizeCell` strips a defensive
prefix the app itself added on a prior export, but a cell that arrives
already looking like a formula is treated as plain text data — this
system never evaluates spreadsheet formulas, so there is no execution
risk either way.

## Integrity: SHA-256 of every uploaded file

`sha256Hex` (`DataExchangeImportDialog.tsx`, Web Crypto
`crypto.subtle.digest`) hashes every uploaded file and stores it on the
`DataExchangeImportJob` record (`sha256`), so an import's exact source
file is verifiable after the fact. A hash failure (Web Crypto unavailable
in some runtime) is caught and stored as an empty string rather than
blocking the import — a missing hash is an honest gap, not a reason to
refuse a legitimate import.

## Persistence: the existing Rust allow-list, never direct JSON editing

Every Data Exchange collection
(`data_exchange_import_jobs`/`_import_row_results`/`_export_jobs`/
`_schema_versions`, plus the five new domain collections) is an explicit
entry in `apps/desktop/src-tauri/src/masterdata.rs`'s `COLLECTIONS`
allow-list, each with its own `append_only` flag — an unknown collection
name is rejected outright
(`unknown_collection_name_is_rejected`). All nine new collections'
names and mutability are asserted by a dedicated Rust test
(`all_nine_data_exchange_collections_are_allow_listed_with_the_designed_mutability`).
Every write goes through the existing write-then-rename atomic-write
path with a backup taken before a destructive change — the same
mechanism every other master-data collection in this app already uses;
Data Exchange introduces no new persistence code path.

## No auto-verification / auto-approval

The deepest security property here is not a file-format defense: no
import can ever mark a regulatory rule verified, a dossier requirement/
evidence item approved or verified, a claim approved, a label or artwork
approved, a formal review complete, or a costing override approved.
Every commit handler hardcodes these fields to their unverified/draft
value — see
[DATA_EXCHANGE_TEMPLATE_CATALOG.md](DATA_EXCHANGE_TEMPLATE_CATALOG.md)
for the per-template detail, and
`dataExchangeRegistry.test.ts`'s dedicated guard test.

## No trace of an unauthorized attempt

An unauthorized import attempt writes **nothing** — no job record, no
row-result record, no export-job record. This is a deliberate choice
(the spec's explicit rule) to avoid an audit log itself becoming a
side-channel that confirms which templates exist and who is allowed to
touch them.
