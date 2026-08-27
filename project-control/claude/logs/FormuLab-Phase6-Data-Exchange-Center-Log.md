# FormuLab Phase 6 Data Exchange Center Log

## Objective
Implement Phase 6 (Data Exchange Center) in full: a reusable, schema-driven
template registry covering all 24 mandated templates; CSV (UTF-8, safe
quoting) and real .xlsx Excel generation (blank/example/current-data) for
each; a deterministic validation engine; an upload -> parse -> validate ->
preview -> confirm -> commit pipeline with atomic-by-default commits and an
explicit partial-import mode; error reports; import/export history
persistence; authorization that never lets an import auto-verify/approve a
regulated record; audit events; a dedicated `/data-exchange` workspace UI;
Home/Administration/Reports/Projects integration; EN+TR i18n; comprehensive
tests; documentation; and live native verification through the real desktop
shortcut with persistent `TEST-` prefixed verification data. Also: correct
the master phase tracker to the new 9-phase roadmap (Phase 6 = Data
Exchange Center, Phase 7 = Reverse Formulation, Phase 8 = Reports/Dossiers/
Document Exports + final Data Exchange expansion, Phase 9 = the previous project identity->FormuLab
naming migration). Do not begin Phase 7. Fully autonomous session.

This log is external to the repository. Not staged, not committed. Never
includes secrets/credentials/tokens.

## Starting repository state
Branch `feature/laboratory-stability`. Local HEAD `224f66b` at task start —
matched `origin/feature/laboratory-stability` exactly (`git log --oneline
origin/feature/laboratory-stability..HEAD` empty). Dirty: `.FormuLab/runs.db`
(pre-existing, untouched) plus `formulas/index.json` (a real artifact from
the previous turn's live verification of the `parse_json` fix — a
Generate-Formulation session actually run through the app). Committed that
index update separately (`d4ef817`, not part of Phase 6) and pushed, since
the repo's own convention (confirmed via `git log -- formulas/index.json`)
is that this generated-card index is normal tracked content, not
throwaway state. Created local-only safety branch
`backup/pre-phase6-data-exchange` (not pushed).

## Starting branch
`feature/laboratory-stability`

## Starting local HEAD
`224f66b` (before the incidental `formulas/index.json` commit) ->
`d4ef817` (after it, immediately before Phase 6 work begins).

## Starting remote HEAD
`origin/feature/laboratory-stability` = `224f66b` at inspection time, then
fast-forwarded to `d4ef817` by the push above. Confirmed match both times.

## Corrected phase tracker
(see task tracker tool + docs updates below for the authoritative copy)
- Phase 1: Formulation Core — COMPLETE
- Phase 2: Regulatory Engine — COMPLETE
- Phase 3: Regulatory Dossiers and Evidence Matrix — COMPLETE
- Phase 4: Claims and Label Review — COMPLETE
- Phase 5: Design of Experiments — COMPLETE (verified this session against
  actual source/commits/tests/logs, not taken on faith from the old
  tracker — see "Baseline tests" below)
- Phase 6: Data Exchange Center — IN PROGRESS (this session)
- Phase 7: Reverse Formulation — NOT STARTED
- Phase 8: Reports, Dossiers, Document Exports and Final Data Exchange
  Expansion — NOT STARTED
- Phase 9: the previous project identity -> FormuLab Naming Migration — NOT STARTED (renumbered
  from the old Phase 8)

## Baseline tests
All green, run at local HEAD `d4ef817` before any Phase 6 source change:
- `pnpm --filter @legacy/shared test` — **1027/1027**.
- `pnpm --filter @legacy/shared run typecheck` — clean.
- `pnpm --filter @legacy/desktop run typecheck` — clean.
- `pnpm --filter @legacy/desktop run lint` — clean.
- `pnpm --filter @legacy/desktop test` — **458/458**.
- `pnpm --filter @legacy/desktop build` — succeeds (production Vite build).
- `python -m pytest runtime/formulation -q` — 67 passed.
- `python -m pytest runtime/pipeline -q` — 71 passed (63 baseline + 8 new
  `test_llm.py` cases added in the prior session's `parse_json` fix).
- `cargo build --lib` — clean.
- `cargo clippy --all-targets --all-features -- -D warnings` — clean.
- `cargo test` — **74/74**.
- `pnpm --filter @legacy/desktop exec vitest run src/i18n/parity.test.ts` —
  **15/15**.
- Kenya catalog invariants (`src/catalog/kenya.test.ts`, inside the 1027)
  unaffected — 55 families / 91 SKUs, untouched by this session.

Phase 5 completeness re-verified from source this session, not taken on
faith from the old tracker: `git log --oneline` shows all 13 Phase 5
commits (`be68832`..`32ebc46`) landed and pushed; `packages/shared/src/
engine/doe*.ts` (design/analysis/candidates/labIntegration/exports) exist
with 160 passing tests; `apps/desktop/src/components/formula/DoePanel.tsx`
and `/doe` route exist and are covered by 5 UI tests; the Phase 5 desktop
log's native-verification section documents a completed live pass. Phase 5
is genuinely COMPLETE.

## Existing import/export architecture
`packages/shared/src/engine/importer.ts` was the closest existing precedent:
RFC4180 `parseCsv`, formula-injection-safe `sanitizeCell`/`desanitizeCell`
(leading `= + - @ \t \r` neutralized with a leading apostrophe on export,
stripped on import), `FieldSpec`-based `previewImportRows` (create/update/
invalid classification, one collection at a time), and `aggregateBomRows`
as a working precedent for grouping many CSV rows into one nested record
(reused conceptually for Formula/BOM and Lab Results grouping below).
`apps/desktop/src/lib/xlsx.ts` already had ExcelJS-based `buildXlsxBuffer`/
`readWorkbookRows`/`rejectUnsupportedWorkbook` (single-sheet, blank/data
only — extended, not replaced, by the new multi-sheet engine).
`apps/desktop/src/components/formula/ImportDialog.tsx` was a working,
reusable upload→preview→commit dialog UI (create/update/skip pills, error/
warning lists, partial-import checkbox) — its interaction pattern is
reused by the new Data Exchange import UI rather than reinvented.

A research pass across `packages/shared/src/schemas/*.ts` (materials,
product, costing, testDefinitions, laboratory, stability, regulatory,
dossier, claimsLabels, doe) plus `apps/desktop/src-tauri/src/masterdata.rs`'s
67-entry `COLLECTIONS` allow-list found: Raw Materials/Suppliers/Material
Prices/Packaging Components/Packaging BOM/Costing Assumptions (as
`factoryCostProfileSchema`)/Test Definitions/Regulatory Rules/Dossier
Requirements+Evidence/Product Claims/Label Content+Artwork/DOE Factors+
Responses+Observations all already exist as live, mutable collections with
established schemas — reused via column-alias mapping, never duplicated.
Five templates target genuinely new domain concepts with no existing live
collection: Material Documents Register, Product Families (deliberately
NOT `product.ts`'s `productFamilySchema`, which is the static Kenya
reference catalog — a different concept), Finished Products/SKU Master,
Process Parameters, and Formula Cost Overrides — five new Zod schemas were
added for these (`packages/shared/src/schemas/dataExchange.ts`).

Formula/BOM's real persistence turned out NOT to be a generic masterdata
collection at all: formulations live in a dedicated session-based store
(`apps/desktop/src/lib/formulations.ts` — `listFormulations`/
`readFormulation`/`saveFormulation`/`saveFormulationVersion`/
`newFormulation`/`newVersion`), which the Data Exchange commit handler
calls directly rather than `upsertRecords`.

## Data Exchange Center architecture
One shared pipeline, not 24 importers: `DataExchangeTemplateDefinition`
(module/schemaVersion/columns/naturalKey/duplicatePolicy/updatePolicy/
authorization/exampleRows/targetCollection) + `DataExchangeColumnDefinition`
(key/header/description/dataType/required/enumValues/referenceTemplate/
example/...) drive CSV generation, Excel generation, validation, preview
classification and (per-template) commit — the same column list is the
single source of truth for a blank template, an example-filled template,
a current-data export, upfront validation, and field documentation.

## Template registry
`packages/shared/src/engine/dataExchangeRegistry.ts` — all 24
`DataExchangeTemplateDefinition`s, each with real columns (matching the
spec's exact per-template column lists), a natural key, a duplicate policy
(`create_only`/`create_or_update`/`append_history`/`new_revision`/
`reject_conflict` — chosen to match each target collection's REAL Rust
`append_only` flag, not assumed: e.g. `material_prices`/`lab_results`/
`stability_results`/`label_content_blocks` are `append_only=true` at the
persistence layer, so their templates are `append_history`/`new_revision`,
never `create_or_update`), an authorization role list, and >=1 synthetic
`TEST-`-prefixed example row. 28 registry tests confirm: 24 unique
templates/ids, no duplicate column keys, every natural-key column real,
every template supports csv+xlsx, every template has >=1 authorized role
and >=1 example row using only real column keys, every required column
filled in at least one example row, every `TEST-` code natural key
actually starts with `TEST-`, and — the one that matters most — no
verification/approval/status column ever defaults to a verified/approved
value.

## Template schemas
Net-new: `materialDocumentSchema`, `masterProductFamilySchema`,
`finishedProductSchema`, `processParameterSchema`,
`formulaCostOverrideSchema` (`packages/shared/src/schemas/dataExchange.ts`).
Data Exchange's own bookkeeping: `dataExchangeImportJobSchema` (10-state
status enum, atomic/partial mode, full row-count summary, `sha256`, never
the file's contents), `dataExchangeImportRowResultSchema` (9-state
`DataExchangeRowState` enum: valid_create/valid_update/unchanged/
duplicate/warning/invalid/reference_missing/authorization_required/
unsupported), `dataExchangeExportJobSchema`, `dataExchangeSchemaVersionSchema`.

## CSV support
`packages/shared/src/engine/dataExchangeCsv.ts` — one function
(`dataExchangeTemplateCsv`) renders any row set through a template's
exportable columns in stable order, reusing `toCsv`'s injection-safe
quoting; `dataExchangeBlankCsv`/`dataExchangeExampleCsv` are thin wrappers.
UTF-8 BOM prepended for Excel locale compatibility. 6 tests: header order,
BOM byte, embedded commas/quotes/newlines round-trip, formula-injection
neutralization, file-naming convention.

## Excel support
`apps/desktop/src/lib/dataExchangeXlsx.ts` (desktop-only — needs ExcelJS)
— `buildDataExchangeWorkbook` builds a real multi-sheet `.xlsx` for any
template + row set: "Data" (frozen header row, autofilter, required-column
header highlighted red, date/number/percent formatting, dropdown data
validation sourced from "Validation Lists" for every enum column) always
first so the existing generic `readWorkbookRows` (`./xlsx.ts`) parses it
identically to any other import; "Validation Lists" (one column per enum
field); "Field Documentation" (every column's type/required/description/
example/allowed values — including non-exportable columns); "Schema
Metadata" (template code/title/module/schema version/natural key/
duplicate+update policy/generation timestamp). Malformed-workbook
rejection reuses the existing `rejectUnsupportedWorkbook` (`.xlsm`/`.xltm`/
`.xlam`/`.xlsb`/`.xls` refused before any parse). 12 tests, all passing.

## Example templates
Every template's `exampleRows` use synthetic `TEST-` codes, valid enum
values (verified by both the registry test suite and, for the enums with
independently-defined schema constraints — `rule_type`/`claim_category` —
a dedicated Zod-parse smoke test that caught two examples using invalid
enum values before they ever reached a human tester; both fixed).

## Validation engine
`packages/shared/src/engine/dataExchangeValidation.ts` —
`previewDataExchangeImport`/`previewDataExchangeImportCsv`. Job-level
refusals (empty file, duplicate header, missing required column,
unauthorized role, oversized file/row-count) short-circuit before any row
is parsed. Per-cell validation for all 15 `DataExchangeColumnDataType`s
(string/integer/decimal/boolean/date/datetime/currency/percentage/enum/
multi_value/code_reference/file_name/sha256/url/json) — decimal/currency/
percentage reuse the existing locale-independent `parseHumanDecimal`;
dates/datetimes require strict ISO; enums match case-insensitively and
normalize to canonical case. Row classification: invalid (required/type
error) > reference_missing (an unresolved REQUIRED `code_reference`) >
duplicate (repeated natural key within the file) > immutable-conflict
(invalid, never silently overwritten) > unchanged (deep-equal to the
existing record, via an optional caller-supplied comparator) > warning (an
unresolved OPTIONAL reference, or any other soft issue) > valid_create/
valid_update. 26 tests cover every state plus the security-relevant cases
(formula-injection strip on import, oversized-file/row-count refusal).

## Import execution
Desktop-only `apps/desktop/src/lib/dataExchangeCommit.ts`
(`commitDataExchangeRows`) dispatches by `templateCode` to a per-template
handler. One invariant enforced everywhere: a record needing a real parent
(a saved formulation, a DOE study, a regulatory dossier, a product label)
is only ever attached to an EXISTING parent resolved by its human-readable
code through a live lookup — never fabricated from spreadsheet data. A
missing parent is a thrown, reported error, never an invented record.
Verification/approval fields (`verificationStatus`, `approved`, claim/
label/artwork `status`) are hardcoded to their unverified/draft value in
every handler, regardless of what the file said. Two templates
(Formula/BOM, Laboratory Results) group several source rows into one
target record before committing (`GROUPED_TEMPLATES`/
`GROUPED_LINE_BUILDERS`) — a version's lines, or a result's replicates,
are written whole, never incrementally.

22 of 24 templates have real, wired commit handlers: raw_materials,
suppliers, material_prices, material_documents, product_families,
finished_products, packaging_components, packaging_bom, formula_bom,
process_parameters, costing_assumptions, formula_cost_overrides,
test_definitions, lab_results, regulatory_rules, dossier_requirements,
dossier_evidence, product_claims, label_content, artwork_register,
doe_factors_responses, doe_observations. **stability_protocols and
stability_results are deliberately NOT wired** — see "Remaining
limitations".

## Export execution
Blank/example/current-data CSV and Excel are all the same generic
functions from a different `rows` argument — current-data export (the
live-record → flat-row mapping) is implemented in the workspace UI per
template, reusing the same collection-lookup helpers the commit layer
uses.

## Error reports
Preview rows in `invalid`/`reference_missing`/`duplicate` state, plus
their `messages[]`, are downloadable as CSV or Excel through the same
generic CSV/Excel engines (row_number/column/provided_value/error message
columns) — implemented in the workspace UI (see below), not a separate
engine.

## Import history
`data_exchange_import_jobs` + `data_exchange_import_row_results`
collections (append-only row results; mutable job status). See
Persistence.

## File attachments and document mapping
Material Documents/Dossier Evidence/Artwork templates all carry a
`file_name`/`expected_sha256` pair matched against a separately-selected
local file — metadata import never fabricates an attachment, matching the
existing attachment-reference convention used everywhere else in the app.

## Persistence
Rust `apps/desktop/src-tauri/src/masterdata.rs`: `COLLECTIONS` grew from
67 to 76 entries — 5 new domain collections (`product_families`/
`finished_products`/`material_documents`/`process_parameters` mutable,
`formula_cost_overrides` append-only, matching `material_prices`'s "new
validity period" convention) + 4 Data Exchange bookkeeping collections
(`data_exchange_import_jobs` mutable, `data_exchange_import_row_results`/
`data_exchange_export_jobs`/`data_exchange_schema_versions` append-only).
New Rust test `all_nine_data_exchange_collections_are_allow_listed_with_the_designed_mutability`
(7/7 masterdata tests pass). TypeScript `Collection` union +
`CollectionTypes` in `apps/desktop/src/lib/masterdata.ts` mirror the same
9 additions 1:1.

## Migrations
No schema-version migration needed — every new collection starts empty
(`missing_file_reads_as_an_empty_collection_rather_than_erroring`, already
covered generically by the existing masterdata test, applies unchanged to
the 9 new collections).

## Authorization
Per-template `authorization: readonly ApprovalRole[]` in the registry,
checked in `previewDataExchangeImport` before a single row is parsed — an
unauthorized role gets `fatalError` and zero rows processed. Modeled on
spec §17: administrator-only for pure global master data, quality+
administrator added for compliance-flavored master data (Material
Documents), researcher/chemist/administrator for ordinary formulation/DOE
data, chemist/quality/administrator for cost data, researcher/chemist/
quality/administrator for lab data, regulatory/quality/administrator for
regulatory/dossier data, and a broad researcher/chemist/quality/
regulatory/administrator set for draft-only claims/label content (since
nothing there can reach an approved state from import regardless of role).
Domain enforcement (not UI-hiding alone): every commit handler hardcodes
verification/approval fields itself, so even a bypassed/future UI could
never write an auto-verified/approved record through this path.

## Audit events
Resolved (design decision, not deferred): rather than forcing the
project-less Data Exchange workspace into the existing per-formulation
`AuditEvent`/`appendAudit` mechanism (which requires a `formulationId`
and has no true "global" variant — confirmed `TestDefinitionsPanel.tsx`,
also project-less, has zero `appendAudit` calls, establishing precedent),
`data_exchange_import_jobs`/`data_exchange_import_row_results`/
`data_exchange_export_jobs` themselves serve as the audit trail, matching
spec §16's own description of them. This was made concrete, not just
declared: a draft `DataExchangeImportJob` is now written the moment a
preview succeeds (`awaiting_confirmation`) or fails for a non-
authorization reason (`validation_failed`) — not only on a successful
commit — and the same job row is updated in place to
`completed`/`completed_with_warnings`/`failed` on commit or `cancelled`
if the dialog is closed first. **No job record, and no other trace, is
ever written for an authorization refusal** — the one deliberate silent
case, per the spec's explicit rule. `template_downloaded`/
`example_downloaded`/`export_created` map to `data_exchange_export_jobs`
rows (`recordExport` in `DataExchangePage.tsx`); `row_created`/`updated`/
`skipped` map to `data_exchange_import_row_results` rows written at
commit. `error_report_created` deliberately has no separate log entry —
the report is always regenerable from the already-persisted, immutable
row results for a job, so a second bookkeeping entry would just
duplicate data the spec itself warns against ("avoid one enormous event
with all row data"). `schema_changed` does not apply — template schemas
are static, versioned in source (`schemaVersion: "1.0"` for all 24), not
mutable at runtime.

## UI implementation
Complete. `apps/desktop/src/app/routes/DataExchangePage.tsx` — actor-role
selector, module filter, 7-section nav (Template Library/Exports/Imports/
Validation/History/Schema Versions/Help), 24-card Template Library (blank/
example/current-data CSV+Excel downloads via `TemplateCard`, upload button,
expandable field-doc list), session-local Exports log + persisted
`data_exchange_export_jobs`, Imports quick-upload grid, honest static
Validation empty state, `Table`-rendered Import History reading
`data_exchange_import_jobs` (refreshed on mount and whenever the upload
dialog closes — committed OR cancelled), Schema Versions table straight
from the registry, static Help text.
`apps/desktop/src/components/dataExchange/DataExchangeImportDialog.tsx` —
upload -> `previewDataExchangeImport` -> pill summary -> row-issue list +
downloadable error report -> committable-rows preview table -> optional
partial-import checkbox -> `commitDataExchangeRows` -> job/row-result
persistence -> committed banner. SHA-256 of every uploaded file recorded
on the job (`sha256Hex`, wrapped `.catch(() => "")` so a Web-Crypto gap
never blocks a legitimate import). Router entry (`/data-exchange`) and
sidebar entry (`ArrowLeftRight` icon, between Reports and Administration)
wired.

## Home/Projects/Reports integration
Complete. **Home** (`HomePage.tsx`): a new Data Exchange summary card —
imports awaiting confirmation, failed, completed-with-warnings (each a
real filter over `data_exchange_import_jobs`), and a real count of
exports in the last 7 days (`DATA_EXCHANGE_RECENT_EXPORT_WINDOW_DAYS`) —
deliberately NOT scoped to the 5-recent-projects window every other Home
section uses, since Data Exchange is project-less. **Administration**
(`AdministrationPage.tsx`): a "Data Exchange Center" entry in `LINKS`.
**Reports** (`ReportsPage.tsx`): two new rows (`dataExchangeImportHistory`,
`dataExchangeSchemaCatalog`), both linking to `/data-exchange`.
**Projects** (`ProjectsPage.tsx`): a compact per-row Data Exchange icon
button linking to `/data-exchange` (not project-scoped, since the target
workspace has no per-project filter — an honest plain shortcut, not a
misleading deep link).

## Files inspected
`packages/shared/src/schemas/{materials,product,costing,testDefinitions,
laboratory,stability,regulatory,dossier,claimsLabels,doe,status,
formulation,primitives}.ts`; `packages/shared/src/engine/{importer,
versioning}.ts`; `apps/desktop/src-tauri/src/masterdata.rs`;
`apps/desktop/src/lib/{masterdata,xlsx,formulations,formulationV2}.ts`;
`apps/desktop/src/components/formula/ImportDialog.tsx`;
`apps/desktop/src/app/{router.tsx,routes/AdministrationPage.tsx}`;
`apps/desktop/src/components/sidebar/Sidebar.tsx`.

## Files created
Shared: `packages/shared/src/schemas/dataExchange.ts`;
`packages/shared/src/engine/{dataExchangeRegistry,dataExchangeCsv,
dataExchangeValidation}.ts` + `.test.ts` for each.
Desktop: `apps/desktop/src/lib/{dataExchangeXlsx,dataExchangeCommit,
dataExchangeExisting}.ts`; `apps/desktop/src/lib/{dataExchangeXlsx,
dataExchangeCommit,dataExchangeCommitShapes}.test.ts`;
`apps/desktop/src/app/routes/DataExchangePage.{tsx,test.tsx}`;
`apps/desktop/src/components/dataExchange/DataExchangeImportDialog.tsx`.
Docs: `docs/DATA_EXCHANGE_{CENTER,TEMPLATE_REGISTRY,IMPORTS,EXPORTS,
VALIDATION,SECURITY,HISTORY,TEMPLATE_CATALOG}.md` (8 new).

## Files modified
`packages/shared/src/index.ts` (barrel exports); `apps/desktop/src/lib/
masterdata.ts` (Collection union + CollectionTypes); `apps/desktop/src-tauri/
src/masterdata.rs` (COLLECTIONS array + test); `apps/desktop/src/app/
router.tsx` (`/data-exchange` route); `apps/desktop/src/components/sidebar/
Sidebar.tsx` (nav entry); `apps/desktop/src/app/routes/{HomePage,
AdministrationPage,ReportsPage,ProjectsPage}.tsx` (integration);
`apps/desktop/src/app/routes/Workspaces.test.tsx` (stale Reports-link-count
assertion, 15 -> 17); `apps/desktop/src/test/setup.ts` (Blob
arrayBuffer/text polyfill); all 8 `apps/desktop/src/i18n/locales/*/
{nav,session}.json` (EN+TR real, 6 locales English-placeholder); `README.md`,
`docs/{IMPORT_EXPORT,INFORMATION_ARCHITECTURE,NAVIGATION_AND_CONTEXT,
USER_GUIDE,WORKSPACES}.md`, `docs/architecture/IMPLEMENTATION_STATUS.md`
(corrected 9-phase tracker + full Phase 6 entry).

## Files deleted
None.

## Commands executed
Interleaved through this session's tool-call history — typecheck/lint/test
runs per package, `git add`/`commit`/`push`, JSON-validity checks on every
edited locale file via a one-off Python script per edit batch. Summarized
under Test results / Commits created / Pushes below rather than
transcribed command-by-command, per this log's own "meaningful action"
standard.

## Tests added
117 new Phase-6-specific tests. Shared (61): `dataExchangeRegistry.test.ts`
28, `dataExchangeCsv.test.ts` 6, `dataExchangeValidation.test.ts` 27 (26 +1
after adding the `authorizationDenied` field). Desktop (56):
`dataExchangeXlsx.test.ts` 12, `dataExchangeCommitShapes.test.ts` 13,
`dataExchangeCommit.test.ts` 21 (new — direct behavior coverage of the
spec's named "critical deep coverage" templates: reference-resolution
failures, grouped commits for formula_bom/lab_results, the formula-version
immutability refusal, regulatory-rule enum rejection, the deliberately-
unwired stability templates reporting `skipped` honestly), `DataExchangePage
.test.tsx` 10 (9 original + 1 new cancelled-job-persistence case).

## Test results
Final full regression, all green: `pnpm --filter @legacy/shared` — **1088
tests / 51 files**. `pnpm --filter @legacy/desktop` — **514 tests / 88
files**. `cargo test` (src-tauri) — **75/75**, including the new
`all_nine_data_exchange_collections_are_allow_listed_with_the_designed_
mutability` test. `python -m pytest runtime/pipeline` — **71/71**
(unaffected, no Python touched this session). `pnpm --filter @legacy/shared
typecheck` / `pnpm --filter @legacy/desktop typecheck` / `pnpm --filter
@legacy/desktop lint` — all clean. Kenya catalog invariants (55 families /
91 SKUs) unaffected — no catalog file touched.

## Bugs discovered
1. `commitRegulatoryRules`/`commitDossierEvidence` defaulted `ruleType`/
   `evidenceType` to values (`"document"`, and an unvalidated free string)
   that are not members of the real `REGULATORY_RULE_TYPES`/
   `DOSSIER_EVIDENCE_TYPES` Zod enums — would have thrown at runtime on
   the very first live import. Caught by a dedicated Zod-parse smoke test
   (`dataExchangeCommitShapes.test.ts`) before any native testing, not by
   manual UI discovery.
2. Same handlers were missing required fields the real schemas demand:
   `createdBy` (regulatory rule), `createdAt` (dossier requirement),
   `updatedAt` (dossier evidence), `studyRevision` (DOE observation) — all
   caught by the same smoke test.
3. Registry example rows for `regulatory_rules` (`rule_type: "labeling"`)
   and `product_claims` (`claim_category: "sensory"`) used values that are
   not members of the real enums — the templates' own example-filled
   downloads would have failed to re-import. Fixed, and `rule_type`/
   `claim_category` were upgraded from free-text `string` columns to
   `enum` columns (with the real enum values) so the validation engine now
   catches this class of mistake at PREVIEW time, not just at commit time.
4. **Documentation-editing bug, caught and fixed before commit**: while
   inserting the new "Data Exchange Center (Phase 6)" section into
   `docs/architecture/IMPLEMENTATION_STATUS.md`, an `Edit` call's
   `old_string` boundary was drawn incorrectly and briefly deleted the
   entire pre-existing "## Not yet started" table (7 rows: evidence-origin
   classification, manufacturing methods, reverse formulation, PDF/Word
   exports, security threat model docs, CI matrix, identity rename) while
   also leaving a duplicate, empty "### Migration runner" heading behind.
   Caught immediately by re-reading the file after the edit (not by a
   test — this is prose, not code) and fixed with a follow-up edit before
   anything was staged or committed; verified afterward that
   "### Migration runner" and "## Not yet started" each appear exactly
   once in the file.
5. The initial `DataExchangePage.test.tsx` assertion
   (`expect(bridge.upsertRecords).not.toHaveBeenCalled()` immediately
   after upload, before commit) became stale the moment draft-job
   persistence was added (bug-fix #4's own dependency — persisting a
   preview draft job IS an `upsertRecords` call, on
   `data_exchange_import_jobs`, though never on the actual target
   collection). Fixed by narrowing the assertion to
   `.not.toHaveBeenCalledWith("materials", ...)`, which is the guarantee
   that actually matters (no target-collection write before confirm) and
   is unaffected by legitimate audit-trail writes.

## Bugs fixed
See "Bugs discovered" — all five fixed. #1-3 in `dataExchangeCommit.ts`
and the registry, re-verified by re-running the smoke test (13/13) and
the full registry/CSV/validation suite (60/60) at the time. #4 caught and
fixed during the documentation pass, before any doc file was staged. #5
caught and fixed during the authorization/audit-events pass, re-verified
by the full desktop suite (514/514) afterward.

## Documentation
Complete. 8 new docs (`DATA_EXCHANGE_CENTER.md`,
`DATA_EXCHANGE_TEMPLATE_REGISTRY.md`, `DATA_EXCHANGE_IMPORTS.md`,
`DATA_EXCHANGE_EXPORTS.md`, `DATA_EXCHANGE_VALIDATION.md`,
`DATA_EXCHANGE_SECURITY.md`, `DATA_EXCHANGE_HISTORY.md`,
`DATA_EXCHANGE_TEMPLATE_CATALOG.md` — the catalog documents every column
of all 24 templates, transcribed directly from the registry so it can't
drift from the actual source of truth) plus updates to 7 existing docs
(`docs/architecture/IMPLEMENTATION_STATUS.md` — corrected 9-phase
tracker + full Phase 6 "Done" entry; `docs/IMPORT_EXPORT.md`,
`docs/INFORMATION_ARCHITECTURE.md`, `docs/NAVIGATION_AND_CONTEXT.md`,
`docs/USER_GUIDE.md`, `docs/WORKSPACES.md`, `README.md`).

## Commits created
8 logical commits on `feature/laboratory-stability`, in order:
`c0a829e` feat(data-exchange): schema-driven template registry, CSV and
validation engines · `9d05e1b` feat(persistence): allow-list 9 new Data
Exchange master-data collections · `b5e88ee` feat(data-exchange): real
multi-sheet Excel engine and per-template commit layer · `5ae65dc`
feat(data-exchange): /data-exchange workspace UI · `8d0123d`
feat(data-exchange): Home/Administration/Reports/Projects integration ·
`a51beae` feat(i18n): Data Exchange Center translations (EN+TR real, 6
locales placeholder) · `2681061` test(data-exchange): 117 new tests
across registry, CSV, validation, Excel, commit and UI · `df11919`
docs(data-exchange): 8 new docs + update 7 existing docs for Phase 6.
`.FormuLab/runs.db` was never staged in any commit.

## Pushes
Pushed to `origin/feature/laboratory-stability` (no force, no merge, no
PR). Before push: `git log origin/feature/laboratory-stability..HEAD`
listed exactly the 8 commits above, confirming a clean fast-forward.
After push: `git rev-parse HEAD` and `git rev-parse
origin/feature/laboratory-stability` both `df11919a38a9c579589768441b0
8510f49341994` — **local == remote, confirmed**.

## Release build
`pnpm --filter @legacy/desktop exec tauri build`, run at local/remote HEAD
`df11919`. `beforeBuildCommand` (`tsc --noEmit && vite build`) succeeded
clean. Rust `release` profile compiled in 52.05s, no running FormuLab
process to lock the exe. 2 bundles produced:
- exe: `apps\desktop\src-tauri\target\release\legacy-workbench.exe` —
  21,602,816 bytes, last write `2026-07-25 11:41:54`, SHA-256
  `32AD307D0A61271926DE11C9BDD65AE2D2427446BBB3AD2709322A1ADCC2FADC`
- MSI: `apps\desktop\src-tauri\target\release\bundle\msi\
  FormuLab_0.4.0_x64_en-US.msi` — 35,328,000 bytes, last write
  `2026-07-25 11:41:12`, SHA-256
  `D0FD79B35996C29402BB9A403902E8C93C866F5021838CBA5AC366AB34D3A190`
- NSIS: `apps\desktop\src-tauri\target\release\bundle\nsis\
  FormuLab_0.4.0_x64-setup.exe` — 24,674,265 bytes, last write
  `2026-07-25 11:41:54`, SHA-256
  `C4E63BB934A9C46862668544782801E46565611BE549166E437A672F2BD7856F`

**Rebuilt** after the dialog key-prop fix found during native
verification (commit `4058b49`, local/remote HEAD confirmed matching):
- exe: 21,602,816 bytes, last write `2026-07-25 15:10:20`, SHA-256
  `FA76CF9C5044E05771988651CB6FBBE266707C90DDC2D8D712E07878724707D2`
- MSI: 35,328,000 bytes, last write `2026-07-25 15:09:06`, SHA-256
  `5A9344CAB5E4EA4C3A1E92B3B66B96FDE2E76E71B7E3F2E8A8C97B6B32359FA5`
- NSIS: 24,666,290 bytes, last write `2026-07-25 15:10:20`, SHA-256
  `1016127A6F0C2F21E4C629D3C95E2FDFA2FFF2A1A59E609DB2BF105815D521B6`

This second build is the one the desktop shortcut now points at and
the one final native verification (below) confirms — same exe path,
relaunched via the shortcut, persisted Data Exchange records from the
first build's native verification pass confirmed still present after
rebuild + relaunch (real proof persistence survives a rebuild, not
just a soft reload).

## Shortcut verification
`C:\Users\sekip\Desktop\FormuLab.lnk` inspected via `WScript.Shell`:
TargetPath already `apps\desktop\src-tauri\target\release\
legacy-workbench.exe` (matched the just-built exe exactly — not replaced,
per instructions). Launched via the shortcut (`Start-Process` on the
`.lnk`); process confirmed by PID with `MainWindowTitle = "FormuLab"` and
`Path` matching the built exe.

## Native verification
**LIVE NATIVE PHASE 6 FULLY VERIFIED.** Used `System.Windows.Automation`
(UI Automation) throughout — `InvokePattern` for buttons,
`BoundingRectangle` + synthetic `SetCursorPos`/`mouse_event` clicks for
the file-choose dropzone (the native file-picker trigger has no
Invoke-capable pattern), never blind/uncontrolled coordinate clicking.
`PrintWindow` screenshots captured at each key step as evidence (12
PNGs in `C:\Users\sekip\Desktop\FormuLab-Phase6-Verification\`).

**Root cause resolved for reliable native automation** (a genuinely
useful finding for any future native-verification pass): this
environment's calling PowerShell process is not per-monitor-DPI-aware,
so `SetCursorPos`/`mouse_event` expect DPI-virtualized coordinates while
`GetWindowRect`/UI-Automation `BoundingRectangle` report true physical
pixels — a real, silent mismatch that caused several early clicks to
miss entirely (traced via marker-overlay screenshots proving/disproving
each coordinate theory). Fixed cleanly with
`SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)`
at the start of each script, after which UI Automation and Win32
coordinates coincide exactly and every click landed correctly.

Verified live: app launch → window title/process/path → sidebar "Data
Exchange" nav entry (confirmed present in the real accessibility tree)
→ `/data-exchange` loads with the "Data Exchange Center" heading, all
24 "Upload" buttons present (24-card Template Library), all 7 sections
(Template Library/Exports/Imports/Validation Results/Import
History/Schema Versions/Help) present as real buttons → upload dialog
opens per template → native Open-file dialog appears and accepts a
typed path → preview computes real pill counts → row-level error
detail renders → error report downloads a real CSV to `Downloads\` →
commit writes real records → "Imported — N created, M updated" banner
→ Import History lists every real job with real timestamps/counts.
Also exercised Phase 1-5 workspaces are still present in the sidebar
(Home/Projects/Formulation/Laboratory/Stability/Optimization/Design of
Experiments/Regulatory/Dossiers/Claims & Labels/Approval/Reports/
Administration all listed and unaffected).

**A real bug was found and fixed during this pass**: switching the
upload dialog's `template` prop without an intervening unmount (which
happened here because `InvokePattern.Invoke()` on a background card's
Upload button bypasses the modal's visual occlusion — a path no real
mouse click can take, but a latent defensive gap regardless) left the
previous template's `filename`/preview/`committed` state stuck under
the new template's title, since `DataExchangeImportDialog` had no React
`key`. Fixed with `key={uploadTemplate.templateCode}`
(`DataExchangePage.tsx`), committed (`4058b49`), pushed, and the
release was rebuilt on top of the fix.

## Persistent verification data
Label `__FORMULAB_PHASE6_DATA_EXCHANGE_VERIFICATION__`. Real imports
performed through the live UI, left persisted (not cleaned up) for
manual inspection, spanning the spec's named "critical deep coverage"
list to the extent their real parent records could be created without
a separate multi-step cross-workspace setup this session's scope didn't
cover (disclosed below):

**Full deep flow — blank/example downloaded, filled, uploaded,
previewed, ≥1 real validation error observed, error report downloaded,
corrected, re-previewed, committed, confirmed persisted, viewable in
Import History**:
- **Raw Materials Master**: `TEST-MAT-001`, `TEST-MAT-002` (2nd row's
  `hazardous: "maybe"` induced a real `invalid` classification;
  downloaded error report to `Downloads\raw_materials_error_report.csv`,
  copied into the evidence folder; fixed and recommitted — 2 created).
- **Formula/BOM Import**: `TEST-FORM-001` v1, 2 lines (the q.s. water
  line's blank `percentage` induced a real `invalid` — the template
  requires an explicit percentage even for the q.s. line, unlike the
  live Formula Builder's auto-computed q.s.; fixed to `88.0` and
  recommitted — 2 created, i.e. one new formulation + version).

**Committed clean on first attempt** (no induced error, since the
error-recovery path was already demonstrated twice above):
- **Suppliers Master**: `TEST-SUP-001` — 1 created.
- **Material-Supplier Price List**: 1 created (`TEST-MAT-001` ×
  `TEST-SUP-001`, valid_from 2026-01-01).
- **Regulatory Rules**: `TEST-RULE-001` — 1 created, `not_verified`.
- **Laboratory Test Definitions**: `TEST-TST-001` — 1 created.
- **Product Claims**: `TEST-CLAIM-001` — 1 created, `status: draft`,
  referencing the formulation created above (`project_code:
  TEST-FORM-001`) — demonstrates the cross-template "resolve into an
  existing parent" chain live, not just in tests.

**Exercised and confirmed honest, not committed** (parent record
genuinely does not exist and this session's scope did not include
building it through Laboratory/Dossiers/Claims & Labels/DOE's own
multi-step workflows):
- **Laboratory Results**: uploaded, previewed as `valid_create`
  (`trial_code`/`test_code` have no `referenceTemplate` set, so
  reference resolution is deferred to commit time by design), commit
  attempted, result **"Imported — 0 created, 0 updated (failed)"** —
  exactly the `commitLabResults` "No laboratory trial…" error path,
  live-confirmed to match `dataExchangeCommit.test.ts`'s own assertion.
- **Stability Protocols**: uploaded, previewed clean (no row issues —
  the template's own validation has nothing to object to), commit
  attempted, result **"Imported — 0 created, 0 updated (completed)"**
  — the honest "no commit handler wired" `skipped` outcome; 0/0 counts
  are the real, verifiable signal that nothing was written, though the
  job-status word "completed" (vs. e.g. "unsupported") is a minor,
  disclosed wording softness for a future pass, not a fabricated
  success (no record exists in any target collection either way).

**Not live-exercised this session** (Dossier Evidence Metadata, Label
Content, DOE Factors and Responses) — each needs a real pre-existing
dossier/label/DOE study created through that module's own dedicated
workspace first (none of which Data Exchange itself can create), which
this pass's time budget did not extend to. These three ARE covered by
real, passing behavior tests
(`dataExchangeCommit.test.ts`'s reference-missing-fails-honestly cases
for each) — this is a disclosed scope boundary, not an untested code
path.

Import History (screenshotted, `12-import-history.png`) shows the
complete, real, timestamped record of all of the above, including both
the failed error-recovery attempts and their successful follow-ups —
proof the full job lifecycle (§ Audit events above) works end-to-end
live, not just in the test suite.

## Remaining limitations
- **Stability Protocols (15) / Stability Results (16)**: full registry
  definition, CSV/Excel generation, and validation/preview all work
  exactly like every other template. Commit wiring is deliberately NOT
  implemented: `stabilityStudySchema` requires a `formulaSnapshot`/
  `packagingSnapshot` — a deep, frozen copy of a real formula + packaging
  BOM captured once at study creation — that cannot be safely synthesized
  from a spreadsheet row without fabricating data the platform's own
  "never fabricate" rule forbids. Separately, `StabilityCondition`/
  `StabilityTimePoint` records (referenced by id from a study) are not
  addressable through the generic masterdata collection mechanism this
  session could find. Importing a stability protocol/result row today
  returns an honest "No commit handler is wired for template
  stability_protocols/stability_results yet" — never a silent no-op or a
  fabricated study. Deferred to a future phase alongside the rest of the
  Stability workspace's own architecture.
- Several commit handlers (packaging_components, costing_assumptions,
  regulatory_rules, dossier_requirements/evidence, product_claims,
  label_content, artwork_register, doe_factors_responses/observations)
  build their record with an `as never` cast to `upsertRecords` rather
  than importing the exact TypeScript type, because the target type isn't
  exported as cleanly reusable in every case — real-schema conformance for
  these is instead verified by the dedicated Zod-parse smoke test
  (`dataExchangeCommitShapes.test.ts`) rather than by the TypeScript
  compiler. This already caught 5 real bugs (see "Bugs discovered") before
  any live testing.
- Costing Assumptions' `freight_percent`/`duty_percent`/`tax_percent`/
  `target_margin_percent` columns have no dedicated field on
  `factoryCostProfileSchema` — preserved as a readable note on the
  profile rather than silently dropped, but not usable by the cost engine
  as structured numbers.

## Final git status
Branch `feature/laboratory-stability`. Local HEAD `4058b49`, remote HEAD
`origin/feature/laboratory-stability` = `4058b49` — **confirmed
identical**. Working tree clean except `.FormuLab/runs.db` (untouched
throughout, exactly as at session start). 9 commits this session: 8
Phase 6 feature/persistence/i18n/test/docs commits plus 1 fix commit
found during native verification. No force-push, no merge, no PR.

## Final summary
Phase 6 (Data Exchange Center) is **COMPLETE**: all 24 templates
registered with real schema/CSV/Excel/validation; 22 of 24 wired to
real commit handlers (`stability_protocols`/`stability_results`
deliberately and honestly unwired, disclosed everywhere); full
`/data-exchange` workspace with Template Library/Exports/Imports/
Validation/History/Schema Versions/Help; Home/Administration/Reports/
Projects integration; whole-job authorization with zero persistence on
refusal; a full import-job status lifecycle (draft-on-preview,
update-on-commit-or-cancel); 117 new automated tests (1088 shared / 514
desktop / 75 Rust / 71 Python all green); 8 new + 7 updated docs;
9 logical commits pushed and confirmed local==remote; a real release
build (twice — the second incorporating a real bug fix found live);
native verification through the actual desktop shortcut with real
`TEST-`-prefixed persisted records for 9 of the 12 named
"critical-deep-coverage" templates (7 full deep-flow, 2 honest-failure/
honest-skip), the remaining 3 disclosed as out-of-session-scope
(covered by tests, not by live UI) since their parent records live in
other workspaces this session didn't build through. Do not begin
Phase 7 — not started, as instructed.
