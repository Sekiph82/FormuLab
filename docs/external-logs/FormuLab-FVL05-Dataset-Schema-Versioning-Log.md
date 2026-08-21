# FormuLab — FVL-05.001 Dataset Schema Version + Feature Schema Version — Cycle Log

## Task

**FVL-05.001 (FVL-05)** — Dataset schema version + feature schema version
tanımla. Define the dataset schema version and the feature schema version
for the future Historical Experiment Dataset Builder (FVL-05), explicit
and incrementable.

## Branch / commit range

- Branch: `feature/laboratory-stability`
- Starting local HEAD: `123b6efec1459d27a55c6ab57bb5d64c07a41e9b`
- Starting remote HEAD (`origin/feature/laboratory-stability`): `123b6efec1459d27a55c6ab57bb5d64c07a41e9b`
- `git diff --check` at start: clean.

## Pre-existing worktree state (not touched)

At session start the worktree already had unrelated changes, all left
untouched by this cycle:
- Modified generated user-guide DOCX/PDF (`docs/generated/`).
- Deleted formula Markdown files and `formulas/index.json`.
- Untracked FVL-03/FVL-04 and Phase 11-14 external logs.

Only files this cycle created/edited are listed below; nothing else was
staged or committed.

## Contract recovered from the tracker

`docs/FORMULAB_V1_TASK_TRACKER.md`, FVL-05.001 row (before this cycle):
"Define dataset schema version + feature schema version (explicit,
incrementable)", depends on FVL-02/FVL-03 (both closed), blocking = YES.
No further acceptance text exists elsewhere in the repo (checked
`FORMULAB_V1_FINAL_SCOPE.md`, `docs/handoffs/FORMULAB_V1_CURRENT.md`) —
the tracker row itself is the full, exact contract.

## Existing versioning convention identified

Every persisted record schema in `packages/shared/src/schemas/*.ts`
already carries `schemaVersion: z.literal("1.0")` (e.g. `schemas/doe.ts`),
and `packages/shared/src/engine/migrations.ts` walks records forward by
`SchemaMigration.fromVersion`/`toVersion` string pairs, per collection.
FVL-05.001 reuses this exact convention rather than inventing a parallel
one: two literal version constants, each independently bumpable.

## Implementation

New file `packages/shared/src/schemas/dataset.ts`:
- `DATASET_SCHEMA_VERSION = "1.0"` + `datasetSchemaVersionSchema` (zod
  literal) + `datasetSchemaVersionedSchema`/`DatasetSchemaVersioned` —
  the version of a future dataset ROW shape (FVL-05.002-.008 extractors).
- `FEATURE_SCHEMA_VERSION = "1.0"` + `featureSchemaVersionSchema` (zod
  literal) + `featureSchemaVersionedSchema`/`FeatureSchemaVersioned` —
  the version of a future derived FEATURE VECTOR shape
  (FVL-05.009-.010 normalization/target-variable definitions).

Deliberately two independent identifiers (not one shared version): a
dataset-row shape change and a feature-vector shape change happen on
independent timelines. No dataset row shape, feature vector shape,
extractor, or normalization logic was implemented — that is explicitly
out of scope for FVL-05.001 per the frozen task instructions.

Exported from `packages/shared/src/index.ts` (`export * from
"./schemas/dataset";`), following the existing barrel-export convention.

## Tests

New `packages/shared/src/schemas/dataset.test.ts` (6 tests):
1. `DATASET_SCHEMA_VERSION` is the literal `"1.0"`; the schema accepts
   only that exact value (rejects other strings, a number, empty string).
2. A record missing `datasetSchemaVersion` is rejected — the version can
   never be silently absent.
3. Same two proofs for `FEATURE_SCHEMA_VERSION`/`featureSchemaVersion`.
4. Independence: a combined schema (dataset + feature merged) proves an
   invalid dataset version never surfaces as a feature-field error and
   vice versa (checked via each zod error's `path`), and a record with
   both valid values parses with both fields intact.
5. Serialization: `JSON.stringify`/`JSON.parse` round-trip is
   deterministic (same string on repeated stringify) and preserves both
   fields distinctly, with no other keys appearing.

## Test / build results

- `pnpm --filter @formulab/shared exec vitest run src/schemas/dataset.test.ts`
  — 6/6 passed.
- `pnpm --filter @formulab/shared test` — **1748/1748 passed across 84
  files** (1742 pre-existing + 6 new; no regression).
- `pnpm --filter @formulab/shared typecheck` — clean.
- `pnpm --filter @formulab/desktop typecheck` — clean (no export-name
  collision from the new barrel export).
- `pnpm --filter @formulab/shared lint` — no lint script configured for
  this package (pre-existing repo state, not introduced by this task).
- No `.rs` file touched — `cargo check` not applicable.
- No `runtime/pipeline` file touched — `python -m pytest runtime/pipeline`
  not applicable.
- `git diff --check` on the touched files — clean.

## Security notes

No new I/O, no new external input parsing, no credentials or secrets
involved. Pure constant/schema definitions and their tests.

## Tracker / handoff update

- `docs/FORMULAB_V1_TASK_TRACKER.md`: FVL-05.001 row marked COMPLETED
  with implementation detail; FVL-05 work-package count updated
  1/14; Total updated 90/171 (52.6%); CURRENT STATE paragraph updated.
  Only this row/summary hunk was touched — all other pre-existing
  content in the file preserved.
- `docs/handoffs/FORMULAB_V1_CURRENT.md`: new dated UPDATE block added
  recording FVL-05.001 completion and pointing the next task at
  FVL-05.002; "Current task" section's stale "FVL-05.001 NOT STARTED"
  line corrected. No other content in the file touched.

## FVL-03/FVL-04 reopened?

No. Nothing in `packages/shared/src/engine/dataExchange*`,
`connector*`, or any FVL-03/FVL-04-owned module was touched. The only
cross-cutting file touched was `packages/shared/src/index.ts`, and only
to add one new export line for the new `schemas/dataset.ts` module.

## Commits

See `git log` on `feature/laboratory-stability` for the exact commit(s)
created this cycle (FVL-05.001-focused messages).

## Desktop build & shortcut

Recorded separately in this same report/session output (native Tauri
release build from final HEAD, `formulab.exe` verification, shortcut
`TargetPath` check) per the Desktop Build & Shortcut Acceptance Gate.

## Result

**COMPLETE** for the FVL-05.001 implementation/tests/tracker scope
described above. See the separate desktop-build/shortcut section of
this session's final report for that gate's own outcome.

Manual UI acceptance from Desktop\FormuLab.lnk is pending user
verification.
