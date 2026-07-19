# Implementation Status

Honest state of the Kenya R&D platform transformation. "Done" here means
implemented, wired in and covered by a passing test — not scaffolded.

Last updated: end of Phase 2 (Formula Builder + versioning) and Phase 3
(raw materials + cost engine).

## Scale note

The full specification (38 sections: product catalog, formula builder,
constraint optimizer, evidence model, regulatory engine, compatibility engine,
safety engine, cost engine, manufacturing methods, lab trials, stability
studies, DOE, substitution, reverse formulation, exports, ERP integration, CI,
docs) is a multi-month programme for a team. It is being built in the specified
phase order. This document tracks exactly where that stands.

## Done

### Repository audit
- `CURRENT_STATE_AUDIT.md` — architecture, persistence, schemas, tests,
  security boundaries and the gap list, written from inspection of the tree
- `TARGET_ARCHITECTURE.md` — layering, schema strategy, precision policy,
  evidence model, approval model

### Product catalog (spec §"Official Kenya Factory SKU Catalog")
- **55 product families, 91 packaging SKUs, all 17 supported domains**
- Family / SKU separation: pack size does not fork the chemistry. Shampoo
  Regular is one family filling a 250 ml bottle and an 8 ml sachet
- Stable codes (`HC-SHAMPOO-REG`, `HC-SHAMPOO-REG-250ML-BOTTLE`); identity is
  never derived from a display name
- Deterministic and idempotent — re-seeding produces byte-identical output
- `hazardClass` marks bleach as industrial, chlorhexidine wipes as medical, QAC
  sanitizers as regulated disinfectants, so the safety engine cannot treat them
  as ordinary consumer goods
- "75 gr" normalised to 75 g with the display label preserved
- 9 tests

### Domain schemas (`packages/shared/src/schemas/`)
- `product.ts` — domains, families, packaging SKUs, units, packaging types
- `formulation.ts` — formulation, immutable versions, lines, 30 material
  functions, 9 evidence origins, 8 support dimensions, 10 statuses. Money and
  percentages are decimal **strings**, not JS numbers
- `status.ts` — the transition graph and approval authority
- `events.ts` — 30 typed agent events, connection state machine, sequencer
- All validated with Zod; exported from `@ai4s/shared`

### Approval safety (spec §"AI must never automatically approve")
- `canTransitionTo()` refuses `pilot_approved` / `production_approved` to any
  non-human actor, whatever the model concluded
- Role authority enforced; an approval record is required for the audit trail
- Enforced in the domain layer, not by hiding a button
- 7 tests, including explicit agent-cannot-approve and system-cannot-approve

### Structured completion events (spec §"Remove Markdown-regex matching")
- `formulation_card.completed` carries `formulationId` / `versionId` / `status`
- `EventSequencer` makes handling idempotent so a reconnect cannot double-apply
  a claim or a draft
- Connection states separate cold sidecar start from ordinary reconnect

### Formula Builder (spec §6)
See [FORMULA_BUILDER.md](../FORMULA_BUILDER.md).
- Project creation: family, packaging SKUs, market, brief, claims, batch size;
  persisted under `data/formulations/<id>/`, not in React state
- Editable grid: drag-to-reorder, duplicate, custom phases with phase grouping,
  multi-select functions, seven optional columns, filter, arrow-key cell
  navigation, block paste from Excel, undo/redo with edit coalescing
- Autosave writes the working draft on a debounce, with a visible state
- Deterministic engine for every displayed number; the UI never calculates
- Explicit water q.s. as a line property, with convert-to-fixed and back, and a
  hard guarantee that a negative percentage is never frozen onto a line
- Four-level validation (`info` / `warning` / `error` / `blocking`) with
  per-line, per-field findings that link to the cell
- Functional-group summary that reports `incomplete` rather than treating
  missing active-matter data as zero
- Structural templates for all 55 families (35 distinct product types), with
  required roles, phase order, spec fields and hazard topics — and deliberately
  no percentages
- Draft INCI / generic ingredient declaration, deterministic ordering, missing
  INCI names flagged rather than invented, human override with audit metadata
- Centralised precision policy ([PRECISION_POLICY.md](../PRECISION_POLICY.md))

### Formula versioning and comparison (spec §7)
See [FORMULA_VERSIONING.md](../FORMULA_VERSIONING.md).
- Working draft vs immutable saved version, enforced at the storage layer
- Change reason required; totals, validation and intent snapshotted at save time
  and never recomputed on read
- Version list, restore-into-new-draft, field-level comparison UI with a
  copyable diff
- Approval integration: `import` actor kind added; agent, system and import are
  all refused approval; clone and restore never inherit approval; approval
  records reject non-human approvers and require a justification; append-only
  `audit.jsonl`

### Raw material intelligence (spec §5)
See [RAW_MATERIALS.md](../RAW_MATERIALS.md).
- Material master (identity, physical, use levels, compliance, supply), supplier
  records, append-only price history with landed cost, inventory records,
  exchange rates
- Material list with search, function/status filters, editor dialog
- Explicit `known` / `missing` / `unknown` / `not_applicable` / `not_verified`
  data states; regulatory positions default to `not_verified`
- Deactivate rather than delete
- Generic master-data store with an allow-listed collection set, write-then-
  rename writes, backups before destructive changes, append-only enforcement

### Import / export (spec §5)
See [IMPORT_EXPORT.md](../IMPORT_EXPORT.md).
- Template download, preview-before-commit, row-level errors, warnings kept
  separate, explicit opt-in partial import, idempotent upsert on the stable code
- Both decimal conventions, delimiter sniffing, BOM handling, RFC 4180 quoting,
  English and Turkish header aliases
- Spreadsheet formula injection neutralised on export and stripped on import
- Imports cannot approve anything

### Cost engine (spec §16)
See [COST_ENGINE.md](../COST_ENGINE.md).
- Layers kept separate: raw, landed, labour, utilities, QC, waste, overhead,
  total manufacturing; per kg, per litre, per SKU
- Missing price, missing exchange rate and expired price are three distinct
  reported states; totals are labelled lower bounds, never silently zeroed
- Dated exchange rates with a required source; nothing is ever fetched; no
  triangulation through a third currency
- Landed cost with four allocation bases and loss uplift
- Packaging BOMs with fractional case allocation and waste factors; fill
  converted to mass through density
- Factory cost profiles with `verified` / `not_verified` / `example_only`
- Immutable cost snapshots recording every input; a price change today cannot
  rewrite what a formula cost in March
- Cost comparison attributing a change to formula / price / rate / packaging /
  factory-cost / missing data, reporting several causes rather than inventing a
  split

## Not yet started

Everything below is specified and designed but **not implemented**. Listing it
plainly so nothing here reads as available.

| Area | Spec § |
|---|---|
| Advanced constraint optimizer (functional/ratio/conditional, multi-objective, structured infeasibility) | 1 |
| Evidence origin classification wired into the pipeline | 4 |
| Regulatory engine + rule import | 13 |
| Compatibility engine | 14 |
| Safety engine (structured classification, GHS) | 15 |
| Manufacturing methods + batch records | 8 |
| Lab trials + stability studies | 9 |
| DOE | 10 |
| Reverse formulation | 11 |
| Substitution engine | 12 |
| Exports (PDF/Word/Excel/ERP) | 20, 21 |
| Persistence migrations (schema-version field exists; no migration runner) | 23 |
| Security threat model docs | 24 |
| CI matrix, SBOM, secret scanning | 26 |
| Identity rename (`ai4s` → `formulab`) | 22 |

## Partially done

| Area | State |
|---|---|
| Packaging components + BOMs | Schemas, storage, costing and tests exist. **No editing UI** — populated through the master-data store or import. |
| Factory cost profiles | Same: modelled, costed, tested, selectable in the Cost tab, but no editor screen. |
| Supplier records | Create and import work; there is no supplier detail form. |
| Material-supplier links, substitutes, material functions | Import schemas exist; no UI tab. |
| Localisation of the new screens | ~245 new keys are English in all seven locales. The parity test requires the keys to exist; an unreviewed machine translation of safety-relevant text ("recorded verbatim from the SDS") would be worse than a readable English string. `scripts/i18n-fill-missing.py` fills gaps without overwriting real translations. |
| Excel import | CSV only. No `.xlsx` reader on the import path. |

## Existing functionality preserved

Nothing was removed. The evidence-driven discovery pipeline, open-access-only
retrieval, full-text reading, citation verification, deterministic rules engine,
region profiles, raw-material import, costing, multi-card output and printing
all continue to work and pass their tests.
