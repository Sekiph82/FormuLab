# Implementation Status

Honest state of the Kenya R&D platform transformation. "Done" here means
implemented, wired in and covered by a passing test — not scaffolded.

Last updated: end of Phase 1 foundation work.

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

## Not yet started

Everything below is specified and designed but **not implemented**. Listing it
plainly so nothing here reads as available.

| Area | Spec § |
|---|---|
| Formula Builder UI (spreadsheet editor, phases, drag/drop) | 6 |
| Advanced constraint optimizer (functional/ratio/conditional, multi-objective, structured infeasibility) | 1 |
| Raw-material intelligence (suppliers, price history, inventory, lead times) | 5 |
| Evidence origin classification wired into the pipeline | 4 |
| Regulatory engine + rule import | 13 |
| Compatibility engine | 14 |
| Safety engine (structured classification, GHS) | 15 |
| Cost engine (landed, packaging, factory, currency) | 16 |
| Versioning + comparison UI | 7 |
| Manufacturing methods + batch records | 8 |
| Lab trials + stability studies | 9 |
| DOE | 10 |
| Reverse formulation | 11 |
| Substitution engine | 12 |
| Exports (PDF/Word/Excel/ERP) | 20, 21 |
| Persistence migrations | 23 |
| Security threat model docs | 24 |
| CI matrix, SBOM, secret scanning | 26 |
| Identity rename (`ai4s` → `formulab`) | 22 |

## Existing functionality preserved

Nothing was removed. The evidence-driven discovery pipeline, open-access-only
retrieval, full-text reading, citation verification, deterministic rules engine,
region profiles, raw-material import, costing, multi-card output and printing
all continue to work and pass their tests.
