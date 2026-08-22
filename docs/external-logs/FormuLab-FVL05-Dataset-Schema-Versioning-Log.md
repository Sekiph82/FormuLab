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

## FVL-05.002 — Row/entity lineage model (2026-08-22)

### Task

**FVL-05.002 (FVL-05)** — Row/entity lineage model: every dataset row
cites its exact source record IDs. Depends on FVL-05.001 (COMPLETED
above).

### Branch / commit range

- Branch: `feature/laboratory-stability`.
- Starting local HEAD: `66e5316cd77fdea7f993a7122961ce54035109c4`.
- Starting remote HEAD (`origin/feature/laboratory-stability`):
  `66e5316cd77fdea7f993a7122961ce54035109c4`.

### Pre-existing worktree state (not touched)

`git status --short` at start showed the same category of unrelated
changes as prior FVL-05 cycles, all left untouched by this cycle:
modified generated user-guide DOCX/PDF (`docs/generated/`), deleted
formula Markdown files and `formulas/index.json`, and untracked
FVL-03/FVL-04/Phase 11-14 external logs.

### Implementation

`packages/shared/src/schemas/dataset.ts` (edited, not replaced) adds:

- `sourceEntitySchema` / `sourceRecordIdSchema` — both a non-blank
  string refinement (`value.trim().length > 0`) that rejects missing,
  empty, whitespace-only, or non-string input while leaving the
  accepted value byte-for-byte as given (no trim/case-fold applied to
  the stored value itself). `sourceEntity` is deliberately an open
  string, not a frozen enum — FVL-05.003-.008 extractors will cite
  entity kinds (`formulation`, `labResult`, `correctiveAction`, …) this
  task must not freeze in advance.
- `sourceRecordReferenceSchema` — `{ sourceEntity, sourceRecordId }`,
  one exact citation of a source record.
- `sourceRecordLineageSchema` — `z.array(sourceRecordReferenceSchema)
  .min(1)` plus a `superRefine` that rejects exact duplicate
  `(sourceEntity, sourceRecordId)` pairs (keyed by
  `JSON.stringify([sourceEntity, sourceRecordId])`, so no ambiguous
  string-concatenation collision) while allowing the same record id
  under two different entities.
- `datasetRowBaseSchema` — `datasetSchemaVersionedSchema.extend({
  sourceRecords: sourceRecordLineageSchema })`. Reuses the FVL-05.001
  `datasetSchemaVersion` field rather than introducing a second version
  constant, and stays a plain `ZodObject` so a later FVL-05.003-.008
  payload schema can `.extend()` it without weakening the mandatory
  lineage contract.

No extractor, dataset/feature payload, record-existence check,
persistence, migration, UI, export, normalization, or Rust/Python code
was added — all explicitly out of scope. Already exported via the
existing `export * from "./schemas/dataset";` barrel line in
`packages/shared/src/index.ts` (FVL-05.001 added that line; no new
export-path entry was needed).

### Tests

`packages/shared/src/schemas/dataset.test.ts` — 12 new tests appended
(18 total in the file):

1. One exact reference accepted.
2. Multiple references accepted, exact values/order preserved.
3. Missing lineage rejected.
4. Empty lineage array rejected.
5. Missing/blank/whitespace-only/non-string `sourceEntity` each
   rejected (4 assertions).
6. Missing/blank/whitespace-only/non-string `sourceRecordId` each
   rejected (4 assertions).
7. Case-sensitivity/no-trim: a padded/mixed-case id round-trips
   unchanged; the same id differing only by case is a distinct,
   independently valid reference.
8. Same record id valid under two different `sourceEntity` values.
9. Exact duplicate `(sourceEntity, sourceRecordId)` pair rejected.
10. `datasetSchemaVersion` remains mandatory and independently
    validated on the row base (missing and wrong-value cases).
11. JSON round-trip preserves exact source identities, including
    leading whitespace inside an id.
12. A synthetic `.extend()`'d payload schema still requires lineage —
    proves the base composes without weakening the contract.

All fixtures are synthetic (`FORM-0001`, `LAB-9982`, `CA-004`, etc.),
no real lab/customer data.

### Test / build results

- `pnpm --filter @formulab/shared test -- dataset` — 18/18 tests in
  `dataset.test.ts` passed (12 new FVL-05.002 tests + 6 pre-existing
  FVL-05.001 tests = 18 total in the file).
- `pnpm typecheck` (root, `@formulab/desktop` depends on
  `@formulab/shared`) — clean.
- `pnpm lint` (root, `@formulab/desktop` → `eslint .`) — clean.
- `pnpm test` (root) — 167 files / 1726 tests passed (covers
  `apps/desktop`; `@formulab/shared`'s own `dataset.test.ts` 18/18 was
  verified separately above since root `pnpm test` does not recurse
  into `@formulab/shared`).
- `git diff --check` on the two touched source files — clean.

### Security notes

Pure schema/validation code, no new I/O, no external input parsing
beyond what zod already validates in-memory, no credentials/secrets.

### Tracker update

`docs/FORMULAB_V1_TASK_TRACKER.md`: only the FVL-05.002 row edited,
marked COMPLETED with the implementation/test evidence above. No other
roadmap row, work-package count, or "CURRENT STATE" summary paragraph
touched this cycle (left for a dedicated tracker-summary pass).

### FVL-03/FVL-04 reopened?

No. Only `packages/shared/src/schemas/dataset.ts` and
`dataset.test.ts` were edited; no FVL-03/FVL-04-owned module
(`dataExchange*`, `connector*`, etc.) was touched, and none was needed
— the existing `sourceRecordLineageSchema` composition needed no
FVL-03/FVL-04 primitive.

### Files changed

- `packages/shared/src/schemas/dataset.ts` (edited).
- `packages/shared/src/schemas/dataset.test.ts` (edited).
- `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-05.002 row only).
- This log file (new section).

### Commits

See `git log` on `feature/laboratory-stability` for the exact commit(s)
created this cycle (FVL-05.002-focused messages).

### Desktop build & shortcut

Recorded in the same session's final report per the Desktop Build &
Shortcut Acceptance Gate (native Tauri release build from final HEAD,
`formulab.exe` verification, shortcut `TargetPath` check).

### Result

**COMPLETE** for the FVL-05.002 implementation/tests/tracker scope
described above.

Manual UI acceptance from Desktop\FormuLab.lnk is pending user
verification.

### Corrective verification cycle (2026-08-22, same day)

A second cycle independently re-verified this already-committed and
already-pushed implementation rather than trusting the section above
at face value, and closed the one stale placeholder it left behind.

- Branch: `feature/laboratory-stability`.
- Starting local HEAD = starting remote HEAD:
  `e28b235ac2eaab4884e3d1a971551941cd6afa7c`.
- `git status --short` at start showed the same pre-existing unrelated
  worktree changes as prior FVL-05 cycles (modified generated
  user-guide DOCX/PDF, deleted formula Markdown files and
  `formulas/index.json`, untracked FVL-03/FVL-04/Phase 11-14 external
  logs) — all left untouched again.
- Re-read `packages/shared/src/schemas/dataset.ts`,
  `dataset.test.ts`, and the `index.ts` barrel line directly: the
  lineage contract (required non-blank `sourceEntity`/`sourceRecordId`,
  opaque/untrimmed identifiers, non-empty deduplicated lineage array,
  exact-duplicate-pair rejection while allowing the same id under a
  different entity, composition onto `datasetSchemaVersionedSchema`
  instead of a second version field) matches every FVL-05.002
  acceptance criterion. **No implementation or test defect found —
  no source or test change was made this cycle.**
- The only defect found was in this log file itself: the FVL-05.002
  section's "Test / build results" line still read
  `PENDING_ROOT_TEST_RESULT` instead of an actual `pnpm test` (root)
  result. Corrected with the real command output below.
- Re-ran verification independently:
  - `pnpm --filter @formulab/shared test -- dataset` — **18/18 passed**
    in `src/schemas/dataset.test.ts` (confirms the tracker/log's
    "18 total in file" claim; there is no 24-total or 18-newly-added
    claim anywhere in this file to correct).
  - `pnpm typecheck` (root, runs `@formulab/desktop` which depends on
    `@formulab/shared`) — clean.
  - `pnpm lint` (root) → `@formulab/desktop lint` (`eslint .`) — clean.
  - `pnpm test` (root) — **167 files / 1726 tests passed** (covers
    `apps/desktop`; does not recurse into `@formulab/shared`, whose
    `dataset.test.ts` was verified separately above).
  - `git diff --check` on the FVL-05.002-owned files
    (`dataset.ts`, `dataset.test.ts`) plus the tracker/log files edited
    this cycle — clean (one pre-existing LF→CRLF line-ending advisory
    on this log file, not a `diff --check` error).
- Tracker (`docs/FORMULAB_V1_TASK_TRACKER.md`): FVL-05.002 row already
  read COMPLETED with accurate "18/18 in file (12 new)" evidence
  matching the fresh test run above — no correction needed, left as
  is. No other row, work-package count, or summary paragraph touched.

#### FVL-03/FVL-04 reopened?

No — not touched, not needed. Only this log file and (if the desktop
build gate below required it) the shortcut were touched by this
corrective cycle.

#### Corrective result

No concrete defect existed in the FVL-05.002 implementation or tests.
This cycle's only source-of-truth change is this log file's
placeholder correction and this subsection.

Manual UI acceptance from Desktop\FormuLab.lnk is pending user
verification.
