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

## Corrective verification cycle (2026-08-21, same day)

A second cycle independently re-verified this already-pushed commit
rather than trusting the log above at face value.

- Branch: `feature/laboratory-stability`.
- Starting local HEAD = starting remote HEAD = final HEAD = remote HEAD
  (unchanged): `78c686641d091f48cd1a341cacf835fec1805199`.
- `git status --short` at start showed the same pre-existing unrelated
  worktree changes (generated user-guide DOCX/PDF, deleted formula
  files/index, untracked FVL-03/FVL-04/Phase 11-14 external logs) —
  all left untouched again.
- Inspected `packages/shared/src/schemas/dataset.ts`,
  `dataset.test.ts`, and the `index.ts` export line directly: the
  contract (two independent literal `"1.0"` version constants, zod
  literal schemas, composable versioned-record schemas with distinct
  field names `datasetSchemaVersion`/`featureSchemaVersion`, barrel
  export, independence + JSON round-trip tests) matches the FVL-05.001
  requirement exactly. No defect found — **no source or test change
  was made this cycle**.
- Re-ran verification independently (not copied from the prior log):
  - `pnpm --filter @formulab/shared exec vitest run src/schemas/dataset.test.ts` — 6/6 passed.
  - `pnpm --filter @formulab/shared test` — 84 files / 1748 tests passed.
  - `pnpm --filter @formulab/shared typecheck` — clean.
  - `pnpm typecheck` (root, runs `@formulab/desktop` which depends on
    `@formulab/shared`) — clean.
  - `pnpm test` (root) — 167 files / 1726 tests passed (this run
    covers `apps/desktop`; `@formulab/shared`'s 1748 were verified via
    its own `test` script above since root `pnpm test` does not
    recurse into it).
  - `pnpm lint` (root) → `@formulab/desktop lint` (`eslint .`) — no
    errors. `@formulab/shared` has no `lint` script (confirmed via its
    `package.json`) — same pre-existing gap noted previously, not
    introduced by this task.
  - `git diff --check` on the FVL-05.001-owned files — clean.
- Desktop build & shortcut gate:
  - Shortcut `C:\Users\sekip\Desktop\FormuLab.lnk` → TargetPath
    `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`,
    WorkingDirectory matching release dir, no arguments.
  - Pre-existing `formulab.exe` predated this HEAD (mtime 17:14 vs.
    commit time 17:37), so it was rebuilt regardless of the "no source
    change" finding, to satisfy the gate.
  - `pnpm --filter @formulab/desktop exec tauri build` run to
    completion in the foreground (tsc + vite build, then Rust release
    build, then MSI + NSIS bundling) — succeeded, produced
    `FormuLab_0.4.0_x64_en-US.msi` and `FormuLab_0.4.0_x64-setup.exe`.
  - Fresh `formulab.exe`: 24,870,400 bytes, mtime 2026-08-21 18:04,
    SHA-256 `faa96307f5e36bf964fddc97c6d086e1d7282aaca2c10c29bf2848efe995dd5f`.
  - Shortcut TargetPath already pointed at this exact path — no
    shortcut edit needed.
  - Launch smoke test via the actual `.lnk`: `Start-Process` on the
    `.lnk` produced a running `formulab` process (PID 7708) whose Path
    matched the fresh binary; process was then stopped (smoke test
    only, no interactive use).
  - `.lnk` file itself not committed to git (git-ignored/outside repo
    tree; `git status` confirms no `.lnk` entry).

### Corrective result

No concrete defect existed in the FVL-05.001 implementation or tests.
This cycle made **zero commits** — nothing to push beyond the
already-pushed `78c6866`. Local HEAD, remote HEAD, and final HEAD are
identical: `78c686641d091f48cd1a341cacf835fec1805199`. Tracker's
completed count is unchanged (FVL-05.001 already marked COMPLETED by
the prior cycle) since no new work was done.

FVL-03/FVL-04 reopened? No — not touched, not needed.

**Result: COMPLETE** — existing pushed implementation independently
re-verified; no artificial implementation commit created.

Manual UI acceptance from Desktop\FormuLab.lnk is pending user
verification.
