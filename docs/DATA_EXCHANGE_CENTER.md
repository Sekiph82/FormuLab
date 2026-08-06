# Data Exchange Center (Phase 6)

The Data Exchange Center is a first-class, standalone workspace
(`/data-exchange`) for downloading, filling, validating, previewing,
importing and exporting structured data through CSV and real Excel
(`.xlsx`) templates — for every module (materials, suppliers, formulas,
lab, stability, regulatory, dossiers, claims, labels, DOE), not just one.
It is not a reports page with a download button: one shared,
schema-driven template registry drives every template's CSV/Excel
generation, validation and commit behavior, so adding or fixing a
template means changing its column list in one place, not touching 24
separate importers.

Domain schemas: `packages/shared/src/schemas/dataExchange.ts` (bookkeeping
records) plus the five net-new domain schemas the templates needed
(`materialDocumentSchema`, `masterProductFamilySchema`,
`finishedProductSchema`, `processParameterSchema`,
`formulaCostOverrideSchema`). Engines:
`engine/dataExchangeRegistry.ts` (the template/column framework),
`engine/dataExchangeCsv.ts` (CSV), `engine/dataExchangeValidation.ts`
(validation/preview, pure and deterministic). Desktop-only:
`apps/desktop/src/lib/dataExchangeXlsx.ts` (real multi-sheet Excel),
`apps/desktop/src/lib/dataExchangeCommit.ts` (the one place any row
actually gets written), `apps/desktop/src/lib/dataExchangeExisting.ts`
(current-data export / update-vs-create lookups). Workspace:
`apps/desktop/src/app/routes/DataExchangePage.tsx` at route
`/data-exchange`, with the upload/preview/commit dialog in
`apps/desktop/src/components/dataExchange/DataExchangeImportDialog.tsx`.

## What this is not

- Not an LLM-driven importer. Every validation rule, every reference
  resolution, every row classification is a plain, reproducible function
  of the column definition and the cell text — see
  [DATA_EXCHANGE_VALIDATION.md](DATA_EXCHANGE_VALIDATION.md)'s "AI may
  explain, never decide" rule.
- Not an approval or verification mechanism. No import can mark a
  regulatory rule verified, a dossier approved, evidence verified, a
  claim approved, a label/artwork approved, or a costing override
  approved — every one of those fields is forced to its
  unverified/draft value regardless of what the file said. Formal
  approval always happens through the existing, separate authorized
  workflow (Regulatory, Dossiers, Claims & Labels, Approval).
- Not a replacement for `IMPORT_EXPORT.md`'s existing per-collection
  Materials import — that stays the in-workspace path for materials;
  the Data Exchange Center is the dedicated, standalone,
  all-modules-at-once workspace. See
  [IMPORT_EXPORT.md](IMPORT_EXPORT.md).
- Not a data-fabrication tool. A record that needs a real parent (a
  formulation, a DOE study, a regulatory dossier, a product label) is
  only ever attached to an **existing** parent, resolved by its
  human-readable code through a live lookup — a missing parent is a
  reported error, never an invented record. See
  [DATA_EXCHANGE_TEMPLATE_CATALOG.md](DATA_EXCHANGE_TEMPLATE_CATALOG.md).

## Documents, one topic each

- [DATA_EXCHANGE_TEMPLATE_REGISTRY.md](DATA_EXCHANGE_TEMPLATE_REGISTRY.md)
  — the shared `DataExchangeTemplateDefinition`/`DataExchangeColumnDefinition`
  framework driving all 24 templates.
- [DATA_EXCHANGE_IMPORTS.md](DATA_EXCHANGE_IMPORTS.md) — the
  upload → parse → validate → preview → confirm → commit pipeline, row
  states, grouped commits, duplicate/update policy.
- [DATA_EXCHANGE_EXPORTS.md](DATA_EXCHANGE_EXPORTS.md) — blank, example
  and current-data CSV/Excel exports.
- [DATA_EXCHANGE_VALIDATION.md](DATA_EXCHANGE_VALIDATION.md) — the
  deterministic validation engine, cell-level rules, reference
  resolution.
- [DATA_EXCHANGE_SECURITY.md](DATA_EXCHANGE_SECURITY.md) — what this
  system defends against and how.
- [DATA_EXCHANGE_HISTORY.md](DATA_EXCHANGE_HISTORY.md) — import/export
  job persistence, the audit trail, and the status lifecycle.
- [DATA_EXCHANGE_TEMPLATE_CATALOG.md](DATA_EXCHANGE_TEMPLATE_CATALOG.md)
  — every one of the 24 templates, every column, every business rule.

## Implemented vs. not yet implemented

**Implemented, tested, live-verifiable through the desktop app:** all 24
templates registered with a real schema/CSV/Excel/validation pipeline;
22 of the 24 wired to a real commit handler writing through the actual
per-domain collections (`raw_materials`, `suppliers`, `material_prices`,
`material_documents`, `product_families`, `finished_products`,
`packaging_components`, `packaging_bom`, `formula_bom`,
`process_parameters`, `costing_assumptions`, `formula_cost_overrides`,
`test_definitions`, `lab_results`, `regulatory_rules`,
`dossier_requirements`, `dossier_evidence`, `product_claims`,
`label_content`, `artwork_register`, `doe_factors_responses`,
`doe_observations`); grouped-row commits for `formula_bom` and
`lab_results`; a full import job status lifecycle (a job is recorded the
moment a preview succeeds or fails, not only on commit); the
`/data-exchange` workspace with Template Library, Exports, Imports,
Validation, History, Schema Versions and Help sections;
Home/Administration/Reports/Projects integration.

**Explicitly not implemented — refused with an honest error, never
faked:** `stability_protocols` and `stability_results` are fully
registered (schema, CSV, Excel, validation) but have **no commit
handler** — see [DATA_EXCHANGE_TEMPLATE_CATALOG.md](DATA_EXCHANGE_TEMPLATE_CATALOG.md#stability-protocols-and-stability-results-not-wired)
for why. A final formatted PDF/DOCX export sourced from Data Exchange
data, and the spec's eventual 24→32-33 template expansion, are both
deferred to Phase 8.

## Getting there from the sidebar

Sidebar → **Data Exchange** (between Reports and Administration), or
Administration → **Data Exchange Center**, or Reports → the two Data
Exchange rows, or a project row's Data Exchange icon button in Projects.
