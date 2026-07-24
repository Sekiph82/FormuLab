# Migrations

`packages/shared/src/engine/migrations.ts`.

## What this is

The minimum reliable local migration runner this platform needs today, not
an attempt at the full future migration roadmap. Every persisted record
already carries a `schemaVersion` field (every schema in `schemas/` sets
one — `formulationSchema`, `rawMaterialSchema`, `compatibilityRuleSchema`,
`formulationProblemSchema`, ...), but until now nothing walked an old record
forward when its shape changed. A schema change meant either a manual, ad
hoc conversion script or quietly leaving old records unreadable by newer
code. `migrateRecord`/`migrateCollection` is that walk.

## Shape

```typescript
interface SchemaMigration<T> {
  fromVersion: string;
  toVersion: string;
  migrate: (record: T) => T;   // pure — must not mutate its input
}

type MigrationRegistry = Record<string, SchemaMigration[]>;

function registerMigration<T>(registry, collection: string, migration: SchemaMigration<T>): void;
function migrateRecord<T>(registry, collection: string, record: T): { record: T; applied: string[] };
function migrateCollection<T>(registry, collection: string, rows: T[]): { rows: T[]; anyMigrated: boolean };
```

`registerMigration` is generic per call so a caller's `migrate` function is
type-checked against its own record shape; internally, `MigrationRegistry`
stores everything type-erased (`Record<string, unknown>`), because it is a
runtime structure keyed by dynamic collection-name strings — TypeScript
cannot track a heterogeneous per-key type through that without machinery
this module deliberately does not add.

## How a walk works

`migrateRecord` looks up a step whose `fromVersion` matches the record's
current `schemaVersion`, applies it, and repeats against the *new*
`schemaVersion` — so registration order does not matter, only the
`fromVersion`/`toVersion` chain does. A record already at the current
version, or a collection with nothing registered at all, is returned
unchanged with `applied: []`. Registering two steps for the same
`collection` + `fromVersion` is a programming error (ambiguous which one
should run) and throws immediately at registration time. A migration whose
`migrate` function claims to run but does not actually advance
`schemaVersion` throws at walk time — the alternative would be an infinite
loop.

This module never reads or writes a file itself. Persistence stays the
caller's responsibility, matching every other `engine/` module in this
package — `migrateCollection` reports which rows changed so a caller (the
Rust master-data store, a Python loader) can decide whether and how to
write the upgraded rows back.

## What is registered today

**Nothing is registered against an existing collection.** The four new
optimizer/substitution collections
(`optimization_profiles`/`optimization_runs`/`optimization_scenarios`/
`substitution_runs`, `apps/desktop/src-tauri/src/masterdata.rs`) all launch
at `schemaVersion: "1.0"` — there is no prior version to migrate from yet.
Registering this runner now, with real tests
(`packages/shared/src/engine/migrations.test.ts`) proving the chain-walking,
duplicate-detection and non-advancing-migration behaviors against a
synthetic example, means the infrastructure exists and is exercised before
the first real migration is needed, rather than being built under pressure
at that point.

Existing collections (`materials`, `formulations`, `compatibility_rules`,
`safety_rules`, ...) are **not** wired into this runner. They are unaffected
by its existence; opting one in is a deliberate future change, not
something this module does implicitly.

Phase 3's 8 new dossier collections (`regulatory_dossiers`,
`regulatory_dossier_requirements`, `regulatory_evidence_items`,
`regulatory_requirement_evidence_links`, `regulatory_dossier_reviews`,
`regulatory_dossier_review_revocations`, `regulatory_dossier_submissions`,
`regulatory_dossier_manual_requirement_actions`) launch at
`schemaVersion: "1.0"` for the same reason — no migration entry was needed,
since they are new collections rather than a changed shape of an existing
one. See [REGULATORY_DOSSIERS.md](REGULATORY_DOSSIERS.md) for why 8
collections rather than the 10 originally suggested by the phase spec.

## What this is not

- Not a general schema-registry, ORM migration framework, or an
  auto-migrating store — nothing calls `migrateRecord` on every read
  automatically; a caller chooses to.
- Not a data-backfill tool. A `migrate` function transforms one record's
  shape; it has no access to other records or external state.
- Does not attempt the complete future migration roadmap (the "38 sections"
  scale note in `docs/architecture/IMPLEMENTATION_STATUS.md`) — only what
  the optimizer and substitution collections need to be readable going
  forward, and the generic mechanism any future collection can opt into.
