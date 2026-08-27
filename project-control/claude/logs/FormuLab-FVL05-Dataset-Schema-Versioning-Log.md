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

## FVL-05.003 — Extractor: formula version + exact composition +
materials + material properties + product family (2026-08-22)

### Task

**FVL-05.003 (FVL-05)** — extractor turning `Formulation`/
`FormulationVersion` records into one validated dataset row per formula
version, carrying exact composition, exact referenced materials and
their properties, the formula's product-family association, and exact
source-record lineage. Depends on FVL-05.002 (COMPLETED above).

### Branch / commit range

- Branch: `feature/laboratory-stability`.
- Starting local HEAD = starting remote HEAD:
  `f289c9f90fd57d530c52a1c71da68c7d56eadfc0`.

### Pre-existing worktree state (not touched)

`git status --short` at start showed the same category of unrelated
changes as prior FVL-05 cycles (modified generated user-guide DOCX/PDF,
deleted formula Markdown files and `formulas/index.json`, untracked
FVL-03/FVL-04/Phase 11-14 external logs), plus this cycle's own
starting point: two untracked partial-implementation files,
`packages/shared/src/engine/formulaVersionDatasetExtractor.ts` and
`.test.ts`, and already-modified `packages/shared/src/index.ts` /
`packages/shared/src/schemas/dataset.ts` (the barrel export line and
`formulaVersionCompositionRowSchema` respectively). All unrelated
changes left untouched; the partial files were audited and completed,
not discarded.

### Audit of the pre-existing partial implementation

The untracked extractor/test files and the `dataset.ts` schema edit
were substantively correct (materials/family resolved by exact code,
composition preserved verbatim, lineage built in deterministic order,
19 passing tests) but had three real gaps against the frozen task
instructions, closed this cycle:

1. **No "requested formula version not found" failure path.** The
   original API took a `formulationVersions: FormulationVersion[]`
   array and processed every element directly — there was no way to
   *request* a version id that turns out to be missing, so the
   required "Requested formula version not found" fail-closed
   behavior (task §7) was structurally unreachable. Fixed by splitting
   the input into `formulationVersionIds: string[]` (what's requested,
   in the order rows are produced) resolved against a
   `formulationVersions` pool, with `formula_version_not_found` on a
   missing id and `duplicate_formula_version_id` on an ambiguous pool
   (mirrors the existing material/product-family duplicate-code
   pattern).
2. **Product family silently absent instead of failing closed.**
   `resolveProductFamily` returned `undefined` both when no
   `productFamilies` collection was supplied (correct — no resolution
   was requested) *and* when a collection was supplied but contained
   no match for `formulation.productFamilyCode` (wrong — task §5/§7
   require this to fail explicitly: "If a referenced family record is
   required but cannot be resolved, fail explicitly rather than
   silently fabricating or dropping it"). Fixed: a supplied collection
   with zero matches now throws `product_family_not_found`; the
   ambiguous case still throws `duplicate_product_family_code`; only a
   fully-omitted collection stays a legitimate silent absence.
3. **No output-schema validation, and possible output/input
   aliasing.** The extractor built and returned each row without ever
   validating it against `formulaVersionCompositionRowSchema`, so
   "Output failing the task-specific row schema" (task §7) could not
   fail closed. Separately, `composition`/`materials`/`productFamily`
   on the returned row referenced the same nested arrays/objects as
   the source records (e.g. a line's `functions` array), which could
   let a caller mutate a returned row and corrupt the input it was
   built from (task §8). Fixed with one change: each constructed row
   is now `formulaVersionCompositionRowSchema.safeParse()`d before
   being returned, throwing `row_schema_validation_failed` on failure.
   Because zod's object/array parsing always rebuilds nested
   structures rather than reusing input references, this single call
   also eliminates the aliasing — verified directly by a new test that
   mutates a returned row's nested arrays and asserts the source
   fixtures are unchanged.

### Implementation

- `packages/shared/src/schemas/dataset.ts` (pre-existing edit,
  unchanged this cycle): `formulaVersionCompositionRowSchema` =
  `datasetRowBaseSchema.extend({ formulaId, formulaCode,
  formulaVersionId, formulaVersionNumber, composition:
  z.array(formulationLineSchema), materials: z.array(rawMaterialSchema),
  productFamilyCode, productFamily: productFamilySchema.optional() })`
  and its inferred `FormulaVersionCompositionRow` type.
- `packages/shared/src/engine/formulaVersionDatasetExtractor.ts`
  (rewritten this cycle): `extractFormulaVersionDatasetRows(input)`
  where `input` is `{ formulationVersionIds, formulationVersions,
  formulations, materials, productFamilies? }`. For each requested id:
  resolves the version from the pool (`formula_version_not_found` /
  `duplicate_formula_version_id`), resolves its owning `Formulation`
  (`formulation_not_found`), resolves every composition line's
  `materialCode` to an exact `RawMaterial` in first-reference order,
  deduplicated (`material_not_found` / `duplicate_material_code`;
  lines with no `materialCode` — a draft naming an unlinked material —
  contribute nothing and are not an error), resolves the product
  family only when `productFamilies` was supplied
  (`product_family_not_found` / `duplicate_product_family_code`),
  builds deterministic lineage (`formulation` → `formulationVersion` →
  each `rawMaterial` in first-reference order → `productFamily` if
  resolved), and validates the assembled row against
  `formulaVersionCompositionRowSchema` (`row_schema_validation_failed`)
  before returning it. Pure/deterministic: no mutation of any input,
  no I/O, no clock/random/locale dependence.
- `packages/shared/src/index.ts`: `export * from
  "./engine/formulaVersionDatasetExtractor";` (pre-existing edit,
  unchanged this cycle) — smallest necessary export-path addition.

### Tests

`packages/shared/src/engine/formulaVersionDatasetExtractor.test.ts`
rewritten to match the corrected API and to close the gaps above — 26
tests (up from 19), all synthetic fixtures:

One schema-valid row per version; exact formula-version identity
retained; two versions of one formula produce isolated, non-equal
rows; composition order/duplicate-material-line/casing/whitespace
preserved exactly; missing optional composition data
(`materialCode`/`quantity`/`quantityUnit`/`tradeName`) stays
`undefined`, never defaulted (new); every referenced material resolved
once regardless of repeat citation; material properties round-trip
exactly and stay attached to the correct material across several
resolved materials; materials resolved by exact code only (never by
matching display name); missing optional material properties stay
missing; product family copied exactly when resolved, honestly absent
when no collection supplied; exact deduplicated ordered lineage citing
every contributing record; all eight fail-closed error codes then in
existence each asserted by `.code` (a ninth, `duplicate_formulation_id`,
was added in the 2026-08-22 corrective cycle below — see that section)
— `formula_version_not_found` (new),
`duplicate_formula_version_id` (new), `material_not_found`,
`duplicate_material_code`, `product_family_not_found` (new, replaces
the old test that wrongly expected silent absence),
`duplicate_product_family_code`, `formulation_not_found`,
`row_schema_validation_failed` (new); malformed-row-shape rejection at
the schema level; non-mutation of inputs on both success and failure
paths; non-aliasing of returned nested output — mutating a returned
row's `composition[].functions`, `materials[].functions`, and
`productFamily.intendedUsers` arrays, and a `displayName` string, then
asserting the source fixtures are unchanged (new); determinism; JSON
round-trip; and availability of both the extractor and the schema from
the shared package's public export path (`../index`, new).

No existing test was weakened or deleted; the one pre-existing test
whose *expectation* was wrong (silent absence on an unresolved-but-
requested product family) was corrected to assert the fail-closed
behavior the frozen task instructions require, not removed.

### Test / build results

- `pnpm --filter @formulab/shared test -- formulaVersionDatasetExtractor`
  — **26/26 passed**.
- `pnpm --filter @formulab/shared test -- dataset` — **44/44 passed**
  (18 in `dataset.test.ts` + 26 in
  `formulaVersionDatasetExtractor.test.ts`, both files matched by the
  `dataset` pattern).
- `pnpm test` (root) — **167 files / 1726 tests passed**, no
  regression (covers `apps/desktop`, which depends on
  `@formulab/shared`; `@formulab/shared`'s own suite verified
  separately above since root `pnpm test` does not recurse into it).
- `pnpm typecheck` (root, runs `@formulab/desktop tsc --noEmit`,
  transitively type-checking against the new/edited `@formulab/shared`
  exports) — clean.
- `pnpm lint` (root) → `@formulab/desktop lint` (`eslint .`) — clean.
- No `.rs` file touched — `cargo check` not applicable.
- No `runtime/pipeline` file touched — `python -m pytest
  runtime/pipeline` not applicable.
- `git diff --check` on the four touched/added files — clean.

### Security notes

Pure in-memory transformation over already-typed records; no new I/O,
no persistence, no external input parsing, no credentials/secrets. Error
messages cite only `sourceEntity`/record id/path/message fragments —
no raw material, formula, or family record content is embedded in a
thrown error.

### Tracker update

`docs/FORMULAB_V1_TASK_TRACKER.md`: only the FVL-05.003 row edited,
marked COMPLETED with the implementation/test evidence above. The
"CURRENT STATE" summary paragraph and FVL-05 work-package count were
left untouched this cycle, consistent with the FVL-05.002 corrective
cycle's precedent of reserving cross-row count updates for a dedicated
tracker-summary pass — no other roadmap row's completion state or
narrative was touched.

### FVL-03/FVL-04 reopened?

No. Only `packages/shared/src/engine/formulaVersionDatasetExtractor.ts`,
its test file, the tracker row, and this log file were touched this
cycle (`packages/shared/src/index.ts` and `schemas/dataset.ts` had
already been edited by the pre-existing partial work and needed no
further change). No FVL-03/FVL-04-owned module (`dataExchange*`,
`connector*`, etc.) was touched, and none was needed.

### Files changed

- `packages/shared/src/engine/formulaVersionDatasetExtractor.ts`
  (rewritten from the pre-existing partial implementation).
- `packages/shared/src/engine/formulaVersionDatasetExtractor.test.ts`
  (rewritten from the pre-existing partial implementation).
- `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-05.003 row only).
- This log file (new section).

Not touched this cycle (already correct from the pre-existing partial
work, audited and left as-is): `packages/shared/src/schemas/dataset.ts`,
`packages/shared/src/index.ts`.

### Commits

See `git log` on `feature/laboratory-stability` for the exact commit(s)
created this cycle (FVL-05.003-focused messages).

### Desktop build & shortcut

Recorded in the same session's final report per the Desktop Build &
Shortcut Acceptance Gate (native Tauri release build from final HEAD,
`formulab.exe` verification, shortcut `TargetPath` check).

### Result

**COMPLETE** for the FVL-05.003 implementation/tests/tracker scope
described above (superseded by the corrective cycle below, which
audited this result rather than accepting it on narrative alone).

Manual UI acceptance from Desktop\FormuLab.lnk is pending user
verification.

## FVL-05.003 — Corrective cycle: duplicate-formulation-id ambiguity
fix, error-count documentation correction (2026-08-22)

### Task

Corrective completion cycle for FVL-05.003 only. Instructed not to
accept the prior "COMPLETE" claim above without independently auditing
the committed source and tests.

### Branch / commit range

- Branch: `feature/laboratory-stability`.
- Starting local HEAD = starting remote HEAD:
  `3684d1fe84ff21012bf8c4d701dfc04aae5cfadb`.

### Audit finding

Read the committed
`packages/shared/src/engine/formulaVersionDatasetExtractor.ts` line by
line against the frozen task contract. The formula-version lookup
(`buildVersionsById`), material lookup (`buildMaterialsByCode`), and
product-family lookup (`resolveProductFamily`) each already detected an
ambiguous exact-identity pool and threw a dedicated structured error
code. The owning-formulation lookup did not:

```ts
const formulationsById = new Map(input.formulations.map((formulation) => [formulation.id, formulation]));
```

A `Map` built this way silently keeps the *last* entry when two
supplied `Formulation` records share an `id` — exactly the
last-write-wins defect the task instructions named. This is a real
defect against the extractor's own stated fail-closed exact-resolution
contract (task §8: "Fails closed on missing or ambiguous required
source relationships"), confirmed by reading the code rather than
trusting the prior cycle's completion narrative.

No other exact-identity lookup in the file had an equivalent gap —
`buildVersionsById`, `buildMaterialsByCode`, and `resolveProductFamily`
were already correct on inspection, so no further fix was needed there.

### Fix

- Added `buildFormulationsById(formulations)` to
  `formulaVersionDatasetExtractor.ts`, mirroring the existing
  `buildVersionsById`/`buildMaterialsByCode` pattern: builds the exact-id
  map entry by entry, throwing a new
  `FormulaVersionDatasetExtractionError` with code
  `duplicate_formulation_id` the moment a second `Formulation` with an
  already-seen `id` is encountered, before any entry is overwritten.
- Added `duplicate_formulation_id` to the
  `FormulaVersionDatasetExtractionErrorCode` union (now nine codes).
- Replaced the inline `new Map(...)` construction in
  `extractFormulaVersionDatasetRows` with a call to
  `buildFormulationsById(input.formulations)`.

### Duplicate-requested-version-id question (task-required audit)

The frozen task instructions also required auditing whether a duplicate
entry in the *requested* `formulationVersionIds` list should be treated
as an invalid duplicate-row request. Re-read task contract point 1:
"Emits one validated row for each requested exact formula-version
identity, in requested order." This describes a per-requested-occurrence
emission, not a per-distinct-identity emission — nothing in the frozen
contract calls a repeated request an ambiguity (unlike a duplicate
*pool* entry, which genuinely leaves two conflicting records for one
id). The existing implementation already resolves each requested id
independently via `.map`, so a repeated request id naturally produces
two equal, correctly-ordered rows rather than an error. Retained this
behavior (no code change) and added a focused test
(`"emits one row per requested identity, including a
duplicate-requested version id twice in order"`) asserting exactly that
— two rows, both `formulaVersionId: "VER-0001"`, deeply equal, in
order.

### Tests

`formulaVersionDatasetExtractor.test.ts` — 3 new tests added, none
removed or weakened (26 → 29 total in file):

1. `"fails closed when duplicate/ambiguous exact owning-formulation
   identities are supplied"` — two `Formulation` records sharing an
   `id`; asserts `FormulaVersionDatasetExtractionError` with
   `.code === "duplicate_formulation_id"`.
2. `"does not mutate inputs on the duplicate-formulation-id failure
   path"` — frozen input arrays/objects, `JSON.stringify` snapshot
   before vs. after a call that throws on this new path; asserts no
   change.
3. `"emits one row per requested identity, including a
   duplicate-requested version id twice in order"` — see prior section.

### Test / build results (run fresh this cycle; prior cycle's counts
not reused)

- `pnpm --filter @formulab/shared test -- formulaVersionDatasetExtractor`
  — **29/29 passed**.
- `pnpm --filter @formulab/shared test -- dataset` — **47/47 passed**
  (18 `dataset.test.ts` + 29 `formulaVersionDatasetExtractor.test.ts`).
- `pnpm test` (root) — **167 files / 1726 tests passed**, no
  regression (root suite does not recurse into `@formulab/shared`, same
  as the prior cycle's evidence — count is unchanged because this
  cycle's only test additions are in `@formulab/shared`).
- `pnpm typecheck` (root → `@formulab/desktop tsc --noEmit`,
  transitively type-checks against the edited `@formulab/shared`
  exports) — clean.
- `pnpm lint` (root → `@formulab/desktop eslint .`) — clean.
- No `.rs` file touched — `cargo check` not applicable.
- No `runtime/pipeline` file touched — `python -m pytest
  runtime/pipeline` not applicable.
- `git diff --check` — clean (CRLF-on-next-touch warnings only, no
  whitespace errors).

### Documentation correction

The prior FVL-05.003 log section above said "all seven fail-closed
error codes" while enumerating eight — corrected in place to "all eight
fail-closed error codes then in existence," with a forward pointer to
this section for the ninth (`duplicate_formulation_id`). The
`docs/FORMULAB_V1_TASK_TRACKER.md` FVL-05.003 row was rewritten to
describe the corrected lookup, the nine-code union, the
duplicate-request-id audit finding, and this cycle's fresh test counts
— no other tracker row, roadmap summary, or narrative was touched.

### Security notes

Same as the original cycle: pure in-memory transformation, no new I/O,
no persistence, no external input parsing, no credentials/secrets. The
new error path's message cites only the ambiguous `Formulation.id`
value, consistent with the existing error messages' practice of citing
identifiers/codes, never full record content.

### Tracker update

`docs/FORMULAB_V1_TASK_TRACKER.md`: only the FVL-05.003 row edited.

### FVL-03/FVL-04 reopened?

No. Only
`packages/shared/src/engine/formulaVersionDatasetExtractor.ts`, its
test file, the tracker row, and this log file were touched this cycle.

### Files changed this cycle

- `packages/shared/src/engine/formulaVersionDatasetExtractor.ts`
  (`buildFormulationsById` added, `duplicate_formulation_id` error code
  added, inline `Map` construction replaced).
- `packages/shared/src/engine/formulaVersionDatasetExtractor.test.ts`
  (3 new tests).
- `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-05.003 row only).
- This log file (corrected wording in the original section + this new
  corrective subsection).

### Commits

See `git log` on `feature/laboratory-stability` for the exact
corrective commit created this cycle.

### Desktop build & shortcut

Recorded in the same session's final report per the Desktop Build &
Shortcut Acceptance Gate (native Tauri release build from final HEAD,
`formulab.exe` verification, shortcut `TargetPath` check).

### Result

**COMPLETE** for the FVL-05.003 corrective scope described above:
the duplicate-formulation-id ambiguity defect is fixed, all required
verification passes with freshly run evidence, documentation is
corrected and accurate, and the push/build/shortcut gate below was run
from the final HEAD.

Manual UI acceptance from Desktop\FormuLab.lnk is pending user
verification.

## FVL-05.003 — Corrective cycle: independent source audit,
root-test-scope documentation correction (2026-08-22)

### Task

Second corrective/audit cycle for FVL-05.003 only. Instructed to
independently re-verify the committed implementation against the
frozen task contract rather than trust the prior cycle's `COMPLETED`
narrative, and specifically to check whether root `pnpm test` still
excludes `@formulab/shared` before repeating that claim.

### Branch / commit range

- Branch: `feature/laboratory-stability`.
- Starting local HEAD = starting remote HEAD:
  `cbaffe4f62b30e7f04373f8e4a3449141015b0ef`.

### Audit method

Read line by line: `formulaVersionDatasetExtractor.ts`,
`formulaVersionDatasetExtractor.test.ts`, `schemas/dataset.ts`, the
relevant slices of `schemas/formulation.ts` (`formulationLineSchema`),
`schemas/materials.ts` (`rawMaterialSchema`), `schemas/product.ts`
(`productFamilySchema`), `packages/shared/src/index.ts`, the
FVL-05.003 tracker row, and both existing FVL-05.003 log sections
above. Also read `package.json` (root), `packages/shared/package.json`,
and `apps/desktop/package.json` to check the documented test/typecheck/
lint commands against what they actually run.

### Audit finding: implementation

Verified against the twelve frozen contract points: exact-id resolution
with fail-closed ambiguity handling exists for all four identity kinds
(formula version, owning formulation, material code, product family
code — `buildVersionsById`, `buildFormulationsById`,
`buildMaterialsByCode`, `resolveProductFamily`); composition
(`version.lines`) and materials/family are copied verbatim with no
normalization; `resolveReferencedMaterials` dedupes by first-reference
order while leaving composition lines themselves untouched; a
`productFamilies` collection is treated as an explicit resolution
request (fails closed on zero or >1 matches; honestly absent only when
the collection itself is omitted); `buildLineage` emits deterministic,
non-duplicated `sourceRecords` in formulation → version → materials →
family order; every row is `safeParse`d against
`formulaVersionCompositionRowSchema` before being returned, which both
fails closed on a malformed row and eliminates output/input aliasing
(the zod parse always rebuilds nested structures); a repeated requested
version id produces one equal row per requested occurrence, matching
contract point 12's per-occurrence (not per-distinct-identity) reading;
no mutation, I/O, clock, random, or generated identity appears anywhere
in the module. Cross-checked the schema files directly:
`formulationLineSchema`/`rawMaterialSchema`/`productFamilySchema` are
reused verbatim in `dataset.ts` via `datasetRowBaseSchema.extend()`
rather than re-modeled, so the row schema cannot silently drift from
the canonical record shapes. Checked `index.ts`'s `export *` lines for
`./schemas/dataset` and `./engine/formulaVersionDatasetExtractor` —
present, and (confirmed by the pre-existing "available from the shared
package's public export path" test still passing) no export-name
collision.

**No implementation defect found.** The prior corrective cycle's
`duplicate_formulation_id` fix was independently re-verified as present
and correctly ordered (checked before either material or product-family
resolution runs for a given version), and remains the only defect ever
found in this module across both corrective cycles.

### Audit finding: documentation (the one real defect this cycle)

Both existing FVL-05.003 log sections above, and the tracker row before
this edit, stated that root `pnpm test` "does not recurse into
`@formulab/shared`." Reading `package.json` at the repository root
directly shows:

```json
"test": "pnpm --filter @formulab/shared test && pnpm --filter @formulab/desktop test"
```

That statement was true when FVL-05.001 was written but is no longer
true of this repository — root `pnpm test` runs the full
`@formulab/shared` suite (via `vitest run`, per
`packages/shared/package.json`) before the `@formulab/desktop` suite,
sequentially, and fails the whole command if either half fails. This is
exactly the stale claim the task instructions for this cycle warned
against repeating. This is a documentation defect only — the extractor
and its tests were unaffected either way, since `@formulab/shared test`
was always run and asserted directly in every prior cycle regardless of
what root `pnpm test` did or didn't cover.

### Fix

Documentation-only. No production or test source was changed this
cycle (the implementation audit above found nothing to fix). Corrected:

- `docs/FORMULAB_V1_TASK_TRACKER.md` FVL-05.003 row: replaced the
  stale "`pnpm test` (root, does not recurse into `@formulab/shared`):
  167 files / 1726 tests passed" claim with the fresh, dual-package
  result below, and noted explicitly that this cycle's audit found the
  implementation already correct.
- This log file: this new subsection.

### Test / build results (run fresh this cycle; prior cycles' counts
not reused)

- `pnpm --filter @formulab/shared exec vitest run
  src/engine/formulaVersionDatasetExtractor.test.ts` — **29/29
  passed**.
- `pnpm --filter @formulab/shared exec vitest run
  src/schemas/dataset.test.ts` — **18/18 passed**.
- `pnpm --filter @formulab/shared test` (full shared suite) —
  **85 files / 1789 tests passed**.
- `pnpm test` (root) — **exit 0**; this now runs
  `@formulab/shared test` (85 files / 1789 tests, as above) followed by
  `@formulab/desktop test` (167 files / 1726 tests passed, captured
  directly from this run's own output) — **252 files / 3515 tests
  passed combined, no regression**.
- `pnpm --filter @formulab/shared exec tsc --noEmit` — clean.
- `pnpm typecheck` (root → `@formulab/desktop tsc --noEmit`,
  transitively type-checks against `@formulab/shared`'s exports) —
  clean.
- `pnpm lint` (root → `@formulab/desktop eslint .`; confirmed
  `packages/shared/package.json` still defines no `lint` script) —
  clean.
- No `.rs` file touched — `cargo check` not applicable.
- No `runtime/pipeline` file touched — `python -m pytest
  runtime/pipeline` not applicable.
- `git diff --check` — clean.
- `git diff --stat` / `--name-status` at the start of this cycle showed
  only the pre-existing unrelated worktree state (generated user-guide
  DOCX/PDF, deleted `formulas/*.md` + `formulas/index.json`, untracked
  FVL-03/FVL-04/Phase 11-14 external logs) — all left untouched;
  `git diff --cached` was empty until this cycle's own two documentation
  files were staged.

### Security notes

No source code changed this cycle — nothing new to assess. The
extractor module itself (unchanged) remains pure in-memory
transformation with no I/O, persistence, or credential handling.

### Tracker update

`docs/FORMULAB_V1_TASK_TRACKER.md`: only the FVL-05.003 row edited,
correcting the root-test-scope claim and recording this cycle's fresh
counts. No other roadmap row touched.

### FVL-03/FVL-04 reopened?

No. No FVL-03/FVL-04-owned module was read for editing purposes or
touched; `dataExchange*`/`connector*` files were not part of this
cycle's diff.

### Files changed this cycle

- `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-05.003 row only).
- This log file (this new corrective subsection).

No `packages/shared/src/**` file was changed this cycle — the audit
found the existing implementation and its tests already correct.

### Commits

See `git log` on `feature/laboratory-stability` for the exact
documentation-only commit created this cycle.

### Desktop build & shortcut

Recorded in the same session's final report per the Desktop Build &
Shortcut Acceptance Gate (native Tauri release build from final HEAD,
`formulab.exe` verification, shortcut `TargetPath` check).

### Result

**COMPLETE** for this cycle's audit scope: independently re-verified
the FVL-05.003 implementation against the frozen contract (no defect
found), corrected the one real defect found — stale root-test-scope
documentation — with fresh evidence, and ran the full acceptance
command set from the final HEAD.

Manual UI acceptance from Desktop\FormuLab.lnk is pending user
verification.

## FVL-05.004 — Extractor: process plan + actual process observations
(2026-08-22)

### Task

**FVL-05.004 (FVL-05)** — extractor reading (1) the persisted planned
manufacturing procedure/process plan associated with a formula version
and (2) the persisted actual process observations associated with
genuine trial/execution records for that formula version, integrated
with the FVL-05.002/.003 dataset contracts. Depends on FVL-05.002
(COMPLETED above).

### Branch / commit range

- Branch: `feature/laboratory-stability`.
- Starting local HEAD = starting remote HEAD:
  `87d7bca61fff8ad9cdf774fefbd118606a52ecc0`.

### Pre-existing worktree state (not touched)

`git status --short` at start showed the same category of unrelated
changes as every prior FVL-05 cycle: modified generated user-guide
DOCX/PDF (`docs/generated/`), deleted formula Markdown files and
`formulas/index.json`, and untracked FVL-03/FVL-04/Phase 11-14 external
logs. All left untouched by this cycle.

### Source-model investigation (the real work of this task)

Before writing anything, searched for a persisted "manufacturing
procedure"/"process plan" record independent of a trial. Found none:

- `packages/shared/src/schemas/formulation.ts`'s `formulationVersionSchema`
  carries no process/procedure field of any kind — confirmed by reading
  the schema directly.
- A `ManufacturingPlan`/`ProcessStep` shape does exist
  (`apps/desktop/src/lib/formulationV2.ts`, generated by
  `runtime/pipeline/manufacturing.py`, rendered by
  `ManufacturingProcedureTab` in `FormulationResultPage.tsx`), but it
  lives entirely in desktop session/card JSON — outside
  `packages/shared`, outside every existing FVL-05 extractor's package
  boundary, and not a `FormulationVersion`-scoped persisted record at
  all (it is one generation run's output, keyed to a session, not a
  saved formula version in the sense the other FVL-05 extractors read).
  Pulling from it would mean crossing into desktop/session code no
  FVL-05.001-.003 extractor touches, which the frozen task instructions
  explicitly gate behind proven necessity. Not used.
- The only structured, shared-package-visible process data is
  `LaboratoryTrial.processSteps`/`.observations`
  (`packages/shared/src/schemas/laboratory.ts`). Each
  `TrialProcessStep` co-locates PLANNED fields (`plannedInstruction`,
  `plannedTemperatureMinC`/`MaxC`, `plannedMixingSpeedMinRpm`/`MaxRpm`,
  `plannedDurationMinutes`, `plannedAdditionOrder`, `requiredEquipment`,
  `phase`, `stepNumber`) and ACTUAL execution fields (`actualStart`/
  `actualEnd`, `actualTemperatureC`, `actualMixingSpeedRpm`,
  `actualDurationMinutes`, `actualAdditionOrder`, `actualPh`,
  `actualViscosity`/`viscosityUnit`, `operator`, `observation`,
  `deviationNote`, `status`, `unplanned`, `skipReason`) on the SAME
  record — this is the actual persisted source for both halves of this
  task. `LaboratoryTrial.observations` (`TrialObservation[]`) is a
  second, discrete "real process observation" record type
  (`color_change`/`phase_separation`/`foaming_issue`/etc., with
  `observedBy`/`observedAt`).
- Confirmed the trial-to-formula-version link: `LaboratoryTrial.sourceType
  === "saved_version"` plus `sourceFormulaVersionId` (schema comment:
  "Required when `sourceType === 'saved_version'`"); `projectId` is the
  trial's owning `Formulation.id`.

This is the tracker row's "(from Manufacturing Procedure / real trial
records)" parenthetical read literally against what actually exists in
`packages/shared`: the "Manufacturing Procedure" half and the "real
trial records" half are, in the persisted data model, the same
`TrialProcessStep` record viewed through two different, honestly-scoped
lenses — never a second invented source model.

### Implementation

`packages/shared/src/schemas/dataset.ts` (edited) adds, after the
FVL-05.003 `formulaVersionCompositionRowSchema`:

- `processStepPlanSchema` — PLANNED-only fields copied from
  `TrialProcessStep`, keyed by `processStepId` (the step's own `id`).
  No actual field exists on this schema at all — a planned target
  structurally cannot appear as an actual observation.
- `processStepActualObservationSchema` — ACTUAL-only fields (execution
  facts, actual process parameters, deviation note, operator/observation
  notes), also keyed by `processStepId`, plus `status`/`unplanned`/
  `skipReason` (execution-state facts, not planned targets).
- `processTrialSchema` — `{ trialId, trialCode, plannedSteps:
  processStepPlanSchema[], actualStepObservations:
  processStepActualObservationSchema[], observations:
  trialObservationSchema[] }` (the last reused verbatim from
  `schemas/laboratory.ts`, not re-modeled).
- `formulaVersionProcessRowSchema` = `datasetRowBaseSchema.extend({
  formulaId, formulaCode, formulaVersionId, formulaVersionNumber,
  trials: processTrialSchema[] })` — one row per `FormulationVersion`,
  same convention as FVL-05.003; `trials: []` when no trial is linked
  (never a fabricated plan).

`packages/shared/src/engine/formulaVersionProcessDatasetExtractor.ts`
(new) — `extractFormulaVersionProcessRows(input)` where `input` is
`{ formulationVersionIds, formulationVersions, formulations, trials }`:

- Resolves each requested version against the pool
  (`formula_version_not_found`/`duplicate_formula_version_id`), its
  owning formulation (`formulation_not_found`/`duplicate_formulation_id`),
  and builds an exact-id trial lookup over the WHOLE supplied trial pool
  (`duplicate_trial_id`, checked regardless of which trials turn out to
  be relevant — same "ambiguous identity must never be resolved by
  guessing" posture as every other exact-id lookup in this extractor
  family).
- A trial is "linked" to a version only when `sourceType ===
  "saved_version"` AND `sourceFormulaVersionId` exactly matches the
  requested version id. A linked trial whose `projectId` does not equal
  the version's owning `Formulation.id` is a **conflicting** link, not a
  usable one — fails closed with the new `trial_formula_link_conflict`
  code rather than being silently attributed or silently dropped. This
  is what makes an orphaned/mismatched trial structurally unable to leak
  into a row (acceptance point 11).
- Within each linked trial: builds an exact-id lookup over that trial's
  own `processSteps` (`duplicate_process_step_id`) and `observations`
  (`duplicate_trial_observation_id`). A step with `unplanned: true`
  (added mid-execution, never in the original plan) is excluded from
  `plannedSteps` but still counts toward `actualStepObservations` if it
  carries real data — `unplanned: true` is itself an actual-execution
  fact even before any other field is filled in. A step is included in
  `actualStepObservations` only when `stepHasActualData()` is true —
  `status !== "planned"`, `unplanned`, or any actual/operator/
  observation/deviation/skip field `!== undefined` — deliberately never
  a truthiness check, so an explicit `0`/`""`/`false` is not confused
  with "not entered."
- Ordering, independent of the caller's input array order: trials by
  `createdAt` then `id`; planned/actual steps by the domain's own
  authoritative `stepNumber` then `id`; discrete observations by
  `observedAt` then `id`.
- Lineage: `formulation` → `formulationVersion` → per linked trial (in
  trial order): `laboratoryTrial` → each distinct `trialProcessStep`
  once (deduplicated across the planned/actual views of the same
  step — never two citations of one physical record) → each
  `trialObservation`.
- Every constructed row is `formulaVersionProcessRowSchema.safeParse()`d
  before being returned (`row_schema_validation_failed` on failure),
  which also guarantees no shared mutable reference with source records
  via zod's rebuild-on-parse, mirroring FVL-05.003's proven pattern.

`packages/shared/src/index.ts`: one new line, `export * from
"./engine/formulaVersionProcessDatasetExtractor";`, added directly
under the existing FVL-05.003 export line.

### Tests

`packages/shared/src/engine/formulaVersionProcessDatasetExtractor.test.ts`
(new) — 27 tests, all synthetic fixtures (`FORM-0001`, `VER-0001`,
`TRIAL-0001`, etc.):

Zero-trial row emits `trials: []`; multi-step planned procedure emitted
in `stepNumber` order regardless of source array order; a planned-only
step's temperature/mixing targets never appear on any
`actualStepObservations` entry (checked both by array length and by a
direct `"actualTemperatureC" in plannedStep` presence check); multiple
actual step observations plus discrete observations extracted with
exact values/units (`viscosityUnit`)/ordering/trial identity
(`trialId`/`trialCode`)/source lineage; two trials for one formula
version stay distinct with identical output regardless of which order
they're supplied in; a trial linked to a different formula version
(`sourceFormulaVersionId: "VER-OTHER"`) never leaks in; a plan-only
trial (no actual data entered) emits zero fabricated actual
observations; a trial with an empty `observations` array stays empty;
missing optional fields stay absent (verified via
`JSON.parse(JSON.stringify(...))` key-presence check, not just
`undefined`); explicit `0`/`false` (`plannedAdditionOrder: 0`,
`actualAdditionOrder: 0`, `unplanned: false`) survive extraction
unchanged; an `unplanned: true` step is excluded from `plannedSteps` but
present in `actualStepObservations`; all nine fail-closed error codes
asserted by `.code` (`formula_version_not_found`,
`duplicate_formula_version_id`, `duplicate_formulation_id`,
`formulation_not_found`, `duplicate_trial_id`,
`duplicate_process_step_id`, `duplicate_trial_observation_id`,
`trial_formula_link_conflict`, `row_schema_validation_failed`);
reordering steps/observations/trials in the input produces an identical
result to the canonical order; non-mutation of inputs on both success
and failure paths (frozen fixtures, JSON-snapshot comparison); mutating
a returned row's nested `plannedSteps[].requiredEquipment` array and a
string field does not affect the source `TrialProcessStep` fixture;
determinism (two extractions of identical input are deeply equal); JSON
round-trip re-validated against the schema; schema-level rejection of a
payload missing `formulaVersionId` and of a non-row payload; and
availability from the shared package's public export path (`../index`).

### Test / build results

- `pnpm --filter @formulab/shared exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/shared test --
  formulaVersionProcessDatasetExtractor` — **27/27 passed**.
- `pnpm --filter @formulab/shared test -- dataset` — **74/74 passed**
  (18 `dataset.test.ts` + 29 `formulaVersionDatasetExtractor.test.ts` +
  27 `formulaVersionProcessDatasetExtractor.test.ts`).
- `pnpm test` (root) — **exit 0**: `@formulab/shared` **86 files / 1816
  tests passed**, `@formulab/desktop` **167 files / 1726 tests passed**
  — **253 files / 3542 tests passed combined, no regression**.
- `pnpm typecheck` (root → `@formulab/desktop tsc --noEmit`,
  transitively type-checks against the new `@formulab/shared` exports)
  — clean.
- `pnpm lint` (root → `@formulab/desktop eslint .`) — clean.
- No `.rs` file touched — `cargo check` not applicable.
- No `runtime/pipeline` file touched — `python -m pytest
  runtime/pipeline` not applicable.
- `git diff --check` — clean.
- `python scripts/validate_v1_tracker.py` — `OK: 171 unique tasks
  across 11 work packages, no drift found.`

### Security notes

Pure in-memory transformation over already-typed records; no new I/O,
no persistence, no external input parsing, no credentials/secrets.
Error messages cite only `sourceEntity`/record id/trial id/path/message
fragments, consistent with the FVL-05.003 extractor's practice — never
full record content (no material/process-step free-text field value is
embedded in a thrown error).

### Tracker update

`docs/FORMULAB_V1_TASK_TRACKER.md`: only the FVL-05.004 row edited,
marked COMPLETED with the implementation/test evidence above. No other
roadmap row, work-package count, or "CURRENT STATE" summary paragraph
touched this cycle, consistent with the FVL-05.002/.003 cycles'
precedent of reserving cross-row count updates for a dedicated
tracker-summary pass.

### FVL-03/FVL-04 reopened?

No. No FVL-03/FVL-04-owned module (`dataExchange*`, `connector*`, etc.)
was read for editing purposes or touched. The desktop
`ManufacturingPlan`/`ProcessStep`/`ManufacturingProcedureTab` code
identified during the source-model investigation above was read only,
never edited — using it would have required expanding into desktop/
session code outside this task's frozen scope, so it was deliberately
not used as a source.

### Files changed this cycle

- `packages/shared/src/schemas/dataset.ts` (edited: new
  `processStepPlanSchema`/`processStepActualObservationSchema`/
  `processTrialSchema`/`formulaVersionProcessRowSchema` + their inferred
  types, plus the `decimalString`/`TRIAL_PROCESS_STEP_STATUSES`/
  `trialObservationSchema` imports they need).
- `packages/shared/src/engine/formulaVersionProcessDatasetExtractor.ts`
  (new).
- `packages/shared/src/engine/formulaVersionProcessDatasetExtractor.test.ts`
  (new).
- `packages/shared/src/index.ts` (one new export line).
- `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-05.004 row only).
- This log file (new section).

### Commits

See `git log` on `feature/laboratory-stability` for the exact commit(s)
created this cycle (FVL-05.004-focused messages).

### Desktop build & shortcut

Recorded in the same session's final report per the Desktop Build &
Shortcut Acceptance Gate (native Tauri release build from final HEAD,
`formulab.exe` verification, shortcut `TargetPath` check).

### Result

**COMPLETE** for the FVL-05.004 implementation/tests/tracker scope
described above.

Manual UI acceptance from Desktop\FormuLab.lnk is pending user
verification.

## FVL-05.004 — corrective verification cycle (2026-08-22)

Independent re-audit of the FVL-05.004 implementation committed and
pushed at `f6076fdd8e9643d4ea4ae29f1d5c1bc8cc16493c` on
`feature/laboratory-stability`. Scope: FVL-05.004 only.

### Starting state

- Branch: `feature/laboratory-stability`.
- Starting local HEAD and starting remote HEAD (`origin/feature/laboratory-stability`):
  both `f6076fdd8e9643d4ea4ae29f1d5c1bc8cc16493c` (already in sync).
- Pre-existing dirty worktree at cycle start: modified
  `docs/generated/FormuLab-User-Guide.docx`/`.pdf`; deleted
  `formulas/2026-07-18-*.md` (10 files) and `formulas/index.json`;
  untracked `docs/external-logs/FormuLab-FVL03-Integration-Log.md`,
  `FormuLab-FVL04-DataExchange-Integration-Log.md`,
  `FormuLab-Phase11-Backup-Restore-Data-Safety-Log.md`,
  `FormuLab-Phase12-Commercial-Distribution-Log.md`,
  `FormuLab-Phase13-Identity-Security-Log.md`,
  `FormuLab-Phase14-Literature-Formulation-Intelligence-Log.md`.
  Verified via `git status --short` before and after this cycle's
  edits — every one of these paths is unchanged; none was staged,
  restored, deleted, or regenerated by this cycle.

### Source-model investigation

Re-read `packages/shared/src/schemas/formulation.ts`,
`packages/shared/src/schemas/laboratory.ts`, and
`packages/shared/src/schemas/dataset.ts` directly rather than trusting
the existing header comments and tracker row. Confirmed independently:

- `FormulationVersion` carries no process-plan field of any kind — no
  manufacturing procedure, no step list, nothing process-related.
- `LaboratoryTrial` (`schemas/laboratory.ts`) is the only
  shared-package, persisted record with structured process data:
  `processSteps: TrialProcessStep[]` and `observations:
  TrialObservation[]`, both embedded arrays on the trial itself (not a
  separate collection).
- Each `TrialProcessStep` co-locates its planned target fields
  (`plannedInstruction`, `plannedTemperatureMinC/MaxC`,
  `plannedMixingSpeedMinRpm/MaxRpm`, `plannedDurationMinutes`,
  `plannedAdditionOrder`) and its actual execution fields
  (`actualStart`/`actualEnd`, `actualTemperatureC`,
  `actualMixingSpeedRpm`, `actualDurationMinutes`,
  `actualAdditionOrder`, `actualPh`, `actualViscosity`,
  `viscosityUnit`, `operator`, `observation`, `deviationNote`) on one
  record — there is no separate authoritative "actual" record to join
  against.
- A trial links to a saved formula version via `sourceType ===
  "saved_version"` + `sourceFormulaVersionId`, and to its owning
  formula via `projectId` (`Formulation.id`) — both exact-id fields,
  confirmed directly in the schema, not assumed from the extractor's
  own comments.
- Conclusion re-verified as correct: no persisted process-plan record
  independent of a trial exists in `packages/shared`; desktop/session
  `ManufacturingPlan`/`ProcessStep` code
  (`apps/desktop/src/lib/formulationV2.ts`) is out of this task's
  package boundary and was not touched or used as a source, matching
  the original cycle's decision — no defect in the source-model
  conclusion.

### Extractor/schema audit and defect found

Read `formulaVersionProcessDatasetExtractor.ts` end to end against the
audit checklist (exact-id resolution, fail-closed ambiguity, planned
vs. actual separation, honest absence of untouched defaults, explicit
zero/false preservation, ordering determinism, duplicate-identity
handling, lineage exactness, non-mutation, error content).

One real defect found: `stepHasActualData` (the predicate that decides
whether a `TrialProcessStep` counts as having real actual-execution
evidence, and therefore appears in `actualStepObservations` at all)
checked every actual-execution field **except** `viscosityUnit`. A
step recorded with only `viscosityUnit` set — no `actualViscosity`,
`status` still the default `"planned"`, nothing else entered — would
fail every branch of the predicate and be silently excluded from
`actualStepObservations` entirely, permanently dropping that real
recorded field from the dataset row. This is exactly the "unit-only
actual fields" edge case this cycle's brief calls out by name.
`viscosityUnit` has no schema default (unlike `weightUnit`'s
`.default("kg")` on `trialMaterialUsageSchema`), so this is a live gap,
not a false alarm foreclosed by the schema.

Fix: added `step.viscosityUnit !== undefined` to the
`stepHasActualData` condition in
`packages/shared/src/engine/formulaVersionProcessDatasetExtractor.ts`.
No other field, ordering rule, lineage rule, or fail-closed check was
found to be wrong — the duplicate-identity handling, trial-link
conflict check, planned/actual split, citation deduplication, and
non-mutation guarantees (via the existing `safeParse`-rebuilds-nested-
data mechanism) were all independently re-verified against the schema
and found correct as implemented.

Also audited for a coverage gap against the sibling FVL-05.003
extractor (`formulaVersionDatasetExtractor.test.ts`), which has an
explicit test for a duplicate-requested `formulationVersionIds` entry.
The FVL-05.004 extractor's test file had no equivalent test — the
underlying behavior (two equal, in-order rows) was already correct by
inspection of `extractFormulaVersionProcessRows`'s
`input.formulationVersionIds.map(...)` implementation, but it was
untested, leaving it "accidental" rather than "explicit, tested
behavior" per this cycle's brief. Added the missing test to close the
gap, mirroring the sibling extractor's test exactly.

### Tests added

`packages/shared/src/engine/formulaVersionProcessDatasetExtractor.test.ts`
(27 → 29 tests, +2):

- `"emits one row per requested identity, including a
  duplicate-requested version id twice in order"` — locks in the
  previously-untested duplicate-requested-id behavior.
- `"counts a step with only viscosityUnit set (no actualViscosity) as
  real actual-execution evidence, not silently dropped"` — regression
  test for the `stepHasActualData` fix; asserts the step now appears
  in `actualStepObservations` with `viscosityUnit: "cP"` and
  `actualViscosity` still honestly `undefined`.

No schema was weakened and no existing test was modified or deleted.

### Fresh test/typecheck/lint/diff/tracker-validation evidence

All commands run fresh from the final corrected state on
`feature/laboratory-stability`:

- `pnpm --filter @formulab/shared exec vitest run
  src/engine/formulaVersionProcessDatasetExtractor.test.ts
  src/engine/formulaVersionDatasetExtractor.test.ts` — **58/58 passed**
  (29 process extractor + 29 composition extractor).
- `pnpm test` (root) — **exit 0**: `@formulab/desktop` **167 files /
  1726 tests passed**; `@formulab/shared` (see next line) 86/1818 —
  **253 files / 3544 tests passed combined, no regression**.
- `pnpm --filter @formulab/shared exec vitest run` — **86 files / 1818
  tests passed** (1816 → 1818, +2 from the new tests above).
- `pnpm --filter @formulab/shared exec vitest run -- dataset` —
  **86 files / 1818 tests passed** (same full-suite run; the `dataset`
  filter argument did not narrow this vitest invocation, so this is
  reported as the full count actually observed rather than a stale
  narrower figure).
- `pnpm typecheck` (root → `@formulab/desktop tsc --noEmit`) — clean.
- `pnpm lint` (root → `@formulab/desktop eslint .`) — clean.
- `git diff --check` — clean (only pre-existing CRLF-normalization
  warnings on the two touched files, exit 0).
- `python scripts/validate_v1_tracker.py` — `OK: 171 unique tasks
  across 11 work packages, no drift found.`
- No `.rs` file touched — `cargo check` not applicable.
- No `runtime/pipeline` file touched — `python -m pytest
  runtime/pipeline` not applicable.

### Security / real-data-safety notes

No behavior change affects error content: error messages still cite
only `sourceEntity`/record id/trial id/message fragments, never full
process notes, observations, or measurements. The
`stepHasActualData` fix only changes which already-typed, already-
present field values are included in the output — it does not add
new I/O, persistence, or external input parsing, and does not touch
any real laboratory/customer/production data path. All fixtures in
the added tests are synthetic (`step()`/`trial()`/`version()` test
builders already used throughout the existing suite).

### Files changed this cycle

- `packages/shared/src/engine/formulaVersionProcessDatasetExtractor.ts`
  (one-line fix: `viscosityUnit` added to `stepHasActualData`).
- `packages/shared/src/engine/formulaVersionProcessDatasetExtractor.test.ts`
  (2 new tests).
- `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-05.004 row only — appended
  corrective-cycle evidence, did not remove or alter the prior
  cycle's evidence).
- This log file (new corrective-cycle section, appended).

All other pre-existing worktree modifications/deletions/untracked
files listed under "Starting state" above were left untouched.

### Commits

See `git log` on `feature/laboratory-stability` for the exact
corrective-cycle commit created after this section was written — a
new commit, not an amend of `f6076fdd8e9643d4ea4ae29f1d5c1bc8cc16493c`.

### Desktop build & shortcut

Recorded in the same session's final report per the Desktop Build &
Shortcut Acceptance Gate (native Tauri release build from the final
corrective-cycle HEAD, `formulab.exe` verification, shortcut
`TargetPath` check).

### Remaining work

None identified for FVL-05.004 within this task's frozen scope.

### Result

**COMPLETE** for this corrective verification cycle.

Manual UI acceptance from Desktop\FormuLab.lnk is pending user
verification.

## FVL-05.004 — second corrective verification cycle (2026-08-22)

Independent re-audit of the FVL-05.004 implementation committed and
pushed at `6c3a06cc135598fffa50bfd875b93c684b2dad78` on
`feature/laboratory-stability` (the prior corrective cycle's
`viscosityUnit` fix). Scope: FVL-05.004 only.

### Starting state

- Branch: `feature/laboratory-stability`.
- Starting local HEAD and starting remote HEAD (`origin/feature/laboratory-stability`):
  both `6c3a06cc135598fffa50bfd875b93c684b2dad78` (already in sync, no
  divergence).
- Pre-existing dirty worktree at cycle start: modified
  `docs/generated/FormuLab-User-Guide.docx`/`.pdf`; deleted
  `formulas/2026-07-18-*.md` (10 files) and `formulas/index.json`;
  untracked `docs/external-logs/FormuLab-FVL03-Integration-Log.md`,
  `FormuLab-FVL04-DataExchange-Integration-Log.md`,
  `FormuLab-Phase11-Backup-Restore-Data-Safety-Log.md`,
  `FormuLab-Phase12-Commercial-Distribution-Log.md`,
  `FormuLab-Phase13-Identity-Security-Log.md`,
  `FormuLab-Phase14-Literature-Formulation-Intelligence-Log.md`.
  Verified via `git status --short` before and after this cycle's
  edits — every one of these paths is unchanged; none was staged,
  restored, deleted, or regenerated by this cycle.

### Source-model investigation

Re-read `packages/shared/src/schemas/formulation.ts` (the full
`formulationVersionSchema` object, not just a comment reference) and
`packages/shared/src/schemas/laboratory.ts` directly, independent of
trusting the two prior cycles' write-ups. Confirmed again:
`FormulationVersion` carries no process/procedure field of any kind;
`LaboratoryTrial.processSteps`/`.observations` (embedded arrays) remain
the only structured, shared-package-visible process data; the
trial-to-version link is exact-id (`sourceType === "saved_version"` +
`sourceFormulaVersionId`, `projectId` for the owning formulation). No
change to this conclusion.

### Extractor/schema audit and defect found

Read `formulaVersionProcessDatasetExtractor.ts` end to end again
against the full audit checklist, with particular attention to the
brief's explicit instruction to audit "identity scope across multiple
linked trials as well as within one trial" and to check for
"parent-scoped embedded IDs."

`TrialProcessStep.id` and `TrialObservation.id` are declared
`z.string().min(1)` with no cross-trial uniqueness guarantee, and both
live in embedded arrays on `LaboratoryTrial`
(`schemas/laboratory.ts`'s own header comment: "Material usage, process
steps and observations are embedded ARRAYS on the trial record, not
separate master-data collections") — i.e. their true addressable scope
is per-trial, not global. The extractor's lineage-citation code
(`buildProcessTrial`) cited them as bare `sourceEntity: "trialProcessStep"`
/ `"trialObservation"` with `sourceRecordId: step.id` / `observation.id`,
with no trial-scoping in the citation itself.

Wrote a standalone repro (two trials, `TRIAL-A` and `TRIAL-B`, both
legitimately linked to the same requested formula version, each with
its own process step and observation independently using the id `"s1"`
/ `"obs-1"`) and ran it directly against the pre-fix extractor:
`extractFormulaVersionProcessRows` **threw**
`FormulaVersionProcessDatasetExtractionError` with code
`row_schema_validation_failed` and message `sourceRecords.5: duplicate
source record reference: sourceEntity="trialProcessStep"
sourceRecordId="s1"` — `sourceRecordLineageSchema` (FVL-05.002, reused
unmodified) correctly rejects an exact duplicate `(sourceEntity,
sourceRecordId)` pair, but the extractor was feeding it two citations
for two DIFFERENT physical records that only look identical because
their (trial-scoped) ids collided. This is a real defect: an entirely
legitimate two-trial row was failing closed on a false-positive
ambiguity, not an actual one — violating acceptance point 5 ("Multiple
trials must remain distinguishable") and point 6 ("Constructed rows
must be validated against the public dataset schema before return" —
they must also actually be *able* to validate when the data is
genuinely fine).

Fix, scoped entirely to `formulaVersionProcessDatasetExtractor.ts`'s
own citation-building logic in `buildProcessTrial` — no change to the
shared FVL-05.002 `sourceRecordLineageSchema`/`sourceRecordReferenceSchema`
in `schemas/dataset.ts`, and no change to any FVL-05.003 code:
`trialProcessStep`/`trialObservation` lineage citations now use
`sourceRecordId: `${trial.id}:${record.id}`` — a deterministic join of
two real, already-verified-unique persisted ids (the owning trial's
globally-unique `id`, itself already deduplicated via
`duplicate_trial_id`, plus the step/observation's own trial-scoped
`id`), never a fabricated or randomly generated replacement id. The
row's own emitted data is untouched: `ProcessStepPlan.processStepId`,
`ProcessStepActualObservation.processStepId`, and
`TrialObservation.id` all still carry the exact, unprefixed persisted
value — only the auxiliary lineage citation (provenance metadata, not
row data) changed shape. Re-ran the repro after the fix: it now
succeeds, producing two distinct citations
(`trialProcessStep:"TRIAL-A:s1"` and `trialProcessStep:"TRIAL-B:s1"`,
similarly for the observations) and a schema-valid row.

No other field, ordering rule, fail-closed check, non-mutation
guarantee, or public export was found to be wrong on this pass — the
`stepHasActualData` fix from the prior cycle, the duplicate-requested-id
behavior, the trial-link-conflict check, and the planned/actual split
were all re-inspected and remain correct as implemented.

### Tests added

`packages/shared/src/engine/formulaVersionProcessDatasetExtractor.test.ts`
(29 → 30 tests, +1; 3 existing assertions updated in place, none
weakened or deleted):

- Updated the 3 literal `sourceRecordId` assertions in the existing
  "extracts multiple actual step observations..." test from bare
  `"s1"`/`"s2"`/`"obs-1"`/`"obs-2"` to the new prefixed
  `"TRIAL-0001:s1"` etc., matching the corrected citation format for
  that test's single-trial fixture.
- New test, `"does not collapse two different trials' process steps or
  observations into one lineage citation when their (trial-scoped, not
  global) ids happen to collide"` — the exact repro above, promoted to
  a permanent regression test: two trials, each with a step and an
  observation sharing an id with the other trial's, asserting the row
  still validates against `formulaVersionProcessRowSchema`, both
  `plannedSteps[0].processStepId` values stay the honest unprefixed
  `"s1"`, and all four expected prefixed citations
  (`TRIAL-A:s1`/`TRIAL-B:s1`/`TRIAL-A:obs-1`/`TRIAL-B:obs-1`) are
  present and distinct.

No schema was weakened and no existing assertion was removed — the 3
updated assertions were corrected to match the new (necessary) citation
format, not loosened.

### Fresh test/typecheck/lint/diff/tracker-validation evidence

All commands run fresh from the final corrected state on
`feature/laboratory-stability`:

- `pnpm --filter @formulab/shared exec vitest run
  src/engine/formulaVersionProcessDatasetExtractor.test.ts` — **30/30
  passed**.
- `pnpm --filter @formulab/shared exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/shared exec vitest run` — **86 files / 1819
  tests passed** (1818 → 1819, +1 from the new regression test).
- `pnpm test` (root) — **exit 0**: `@formulab/desktop` **167 files /
  1726 tests passed**; `@formulab/shared` **86 files / 1819 tests
  passed** — **253 files / 3545 tests passed combined, no
  regression**.
- `pnpm typecheck` (root → `@formulab/desktop tsc --noEmit`) — clean.
- `pnpm lint` (root → `@formulab/desktop eslint .`) — clean.
- `git diff --check` — clean (only pre-existing CRLF-normalization
  warnings on the two touched files, exit 0).
- `python scripts/validate_v1_tracker.py` — `OK: 171 unique tasks
  across 11 work packages, no drift found.`
- No `.rs` file touched — `cargo check` not applicable.
- No `runtime/pipeline` file touched — `python -m pytest
  runtime/pipeline` not applicable.

### Security / real-data-safety notes

No behavior change affects error content beyond the citation format
itself, which cites only ids (never process notes, measurements, or
free text) — consistent with every prior FVL-05.004 cycle's practice.
The fix does not add new I/O, persistence, or external input parsing,
and does not touch any real laboratory/customer/production data path.
The repro used to prove the defect and the added regression test are
both entirely synthetic fixtures built from the existing
`step()`/`observation()`/`trial()`/`version()`/`formulation()` test
builders already used throughout the suite; the standalone repro file
used to prove the defect before implementing the fix was deleted
before this cycle's commit (never part of the tracked test suite).

### Files changed this cycle

- `packages/shared/src/engine/formulaVersionProcessDatasetExtractor.ts`
  (citation-building fix in `buildProcessTrial`: `trialProcessStep`/
  `trialObservation` lineage citations now `${trial.id}:${record.id}`;
  header doc comment updated to explain why).
- `packages/shared/src/engine/formulaVersionProcessDatasetExtractor.test.ts`
  (3 existing assertions updated to the new citation format; 1 new
  regression test).
- `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-05.004 row only — appended
  this cycle's evidence, did not remove or alter either prior cycle's
  evidence).
- This log file (new corrective-cycle section, appended).

All other pre-existing worktree modifications/deletions/untracked
files listed under "Starting state" above were left untouched.

### Commits

See `git log` on `feature/laboratory-stability` for the exact
corrective-cycle commit created after this section was written — a
new commit, not an amend of
`6c3a06cc135598fffa50bfd875b93c684b2dad78`.

### Desktop build & shortcut

Recorded in the same session's final report per the Desktop Build &
Shortcut Acceptance Gate (native Tauri release build from the final
corrective-cycle HEAD, `formulab.exe` verification, shortcut
`TargetPath` check).

### Remaining work

None identified for FVL-05.004 within this task's frozen scope.

### Result

**COMPLETE** for this corrective verification cycle.

Manual UI acceptance from Desktop\FormuLab.lnk is pending user
verification.

## FVL-05.004 — third corrective verification cycle (AUDIT_000018 re-resolution, 2026-08-23)

Independent GPT audit `AUDIT_000018`, verdict **CONTINUE**, supplied two
concrete remaining findings plus an instruction to re-verify the
Manufacturing Procedure source question from repository contracts
(not tracker/log prose). Scope: FVL-05.004 only, manual session (no
subagents, no Autopilot).

### Starting state

- Branch: `feature/laboratory-stability`.
- Starting local HEAD and starting remote HEAD (`origin/feature/laboratory-stability`):
  both `939accebbc2b59c3424a86ffde2b4773c764dcce` (in sync).
- Pre-existing dirty worktree at cycle start (unrelated, left untouched):
  modified `docs/generated/FormuLab-User-Guide.docx`/`.pdf`; deleted
  `formulas/2026-07-18-*.md` (10 files) and `formulas/index.json`;
  untracked `docs/external-logs/FormuLab-FVL03-Integration-Log.md`,
  `FormuLab-FVL04-DataExchange-Integration-Log.md`,
  `FormuLab-Phase11-Backup-Restore-Data-Safety-Log.md`,
  `FormuLab-Phase12-Commercial-Distribution-Log.md`,
  `FormuLab-Phase13-Identity-Security-Log.md`,
  `FormuLab-Phase14-Literature-Formulation-Intelligence-Log.md`. Verified
  unchanged via `git status --short` before commit — none staged.

### Finding 1 — lineage collision safety (fixed)

The second corrective cycle's `sourceRecordId: `${trial.id}:${record.id}``
join is not injective over the unrestricted nonblank-string id domain:
`trial.id="A:B"` + `record.id="C"` and `trial.id="A"` + `record.id="B:C"`
both encode to `"A:B:C"`. Fixed in
`formulaVersionProcessDatasetExtractor.ts` with a new
`encodeNestedLineageId(parentId, recordId) = JSON.stringify([parentId, recordId])`,
applied to both `trialProcessStep` and `trialObservation` citations. JSON
array/string serialization escapes/quotes rather than using a fixed
delimiter, so it is injective for any two nonblank strings regardless of
content, and the exact original pair is recoverable via `JSON.parse`. The
row's own emitted `processStepId`/observation `id` fields are untouched —
only the lineage citation's `sourceRecordId` changed shape. Regression
tests LINEAGE1-LINEAGE6 added (cross-trial step/observation id reuse,
delimiter-containing ids proven distinct via the exact `"A:B"`+`"C"` vs
`"A"`+`"B:C"` example, recoverability, reordering determinism,
non-mutation); the 3 pre-existing lineage-citation assertions (from the
second corrective cycle) were updated in place to the new encoding, not
weakened.

### Finding 2 — source-schema parity (direct audit performed, one real mismatch fixed)

Read `trialProcessStepSchema`, `trialObservationSchema`, and
`laboratoryTrialSchema` directly from `packages/shared/src/schemas/laboratory.ts`
(not summarized from prior logs) and compared every field the extractor
relies on against `processStepPlanSchema`/`processStepActualObservationSchema`/
`processTrialSchema` in `schemas/dataset.ts`. `decimalString`,
`TRIAL_PROCESS_STEP_STATUSES`, and `trialObservationSchema` are imported
and reused verbatim (no re-modeling, no drift possible). One real
mismatch found: `processStepPlanSchema.phase` used `nonBlankString`,
over-tightening against the source's own permissive
`phase: z.string().default("A")`, which allows an explicit empty string.
Fixed to `phase: z.string()`. All other fields checked
(required/optional, defaults, nullable behavior, timestamp fields inside
the extracted values, numeric/decimal constraints, boolean semantics
including explicit `false`, `viscosityUnit`/equipment optionality,
status enum) matched exactly — no further mismatch found. New regression
test proves an explicit empty-string `phase` on a source step survives
extraction and the row still validates.

### Manufacturing Procedure source question — re-resolved from direct repository evidence (original conclusion was WRONG)

Both the original FVL-05.004 implementation and both prior corrective
cycles asserted "no persisted process-plan record exists independent of
a trial." This session re-investigated directly per the audit's explicit
instruction, inspecting `apps/desktop/src/lib/formulationV2.ts`,
`runtime/pipeline/manufacturing.py`, and repo-wide occurrences of
`ManufacturingPlan`/`ProcessStep`/`process_parameters`/
`manufacturingProcedure`, rather than trusting the prior conclusion.

Found: `process_parameters` is a real, independently persisted,
Data-Exchange-importable masterdata collection —
`processParameterSchema` (`packages/shared/src/schemas/dataExchange.ts`),
registry entry `templateCode: "process_parameters"` /
`targetCollection: "process_parameters"`
(`packages/shared/src/engine/dataExchangeRegistry.ts`), registered as a
real mutable Rust collection persisted to
`data/master/process_parameters.json`
(`apps/desktop/src-tauri/src/masterdata.rs`), with a real read consumer
(`apps/desktop/src/components/formula/ProcessParametersPanel.tsx`, whose
own header comment names it "the real Manufacturing Procedure consumer
for canonical/imported `process_parameters`" and explicitly distinguishes
it from the generated-session `ManufacturingProcedureTab` proposal, which
never reads this collection). It is deterministically linked to an exact
formula version by its own natural key
`(formula_code, formula_version, step_number)` against
`Formulation.code`/`FormulationVersion.versionNumber` — never a fuzzy or
guessed match.

Confirmed (unchanged conclusion): the generated-session
`ManufacturingPlan`/`ProcessStep` shape (`formulationV2.ts`, driven by
`runtime/pipeline/manufacturing.py`) has no persisted, formula-version-linkable
identity of its own — read `apps/desktop/src/lib/promoteGeneratedFormula.ts`
in full (the one seam from a generated card to a real, saved
`FormulationVersion`, via `newVersion()`): it never reads or carries a
card's `manufacturing` field onto the persisted version. This shape stays
out of scope, correctly.

**Conclusion: A = yes (process_parameters), B = yes (exact natural-key
link), C = PLAN1 applies** — the extractor must extract the persisted
`process_parameters` plan even when no `LaboratoryTrial` exists.
PLAN1-EVIDENCE (the fallback for "no source exists") does not apply; the
prior "no source exists" conclusion is corrected here, in code and in
this log, not silently left standing.

### PLAN1 implementation

`schemas/dataset.ts`: new `plannedProcedure: z.array(processParameterSchema)`
field on `formulaVersionProcessRowSchema` — the literal source schema
reused verbatim (same "reuse the canonical source schema directly"
principle FVL-05.003 already established for `formulationLineSchema`/
`rawMaterialSchema`), so this dataset can never silently drift from
`process_parameters`' own contract. Deliberately kept as a separate
top-level array from `trials[].plannedSteps` — a trial's own recorded
plan describes what THAT trial planned (may legitimately vary run to
run); `plannedProcedure` is the version-level canonical procedure.
Conflating them would misattribute one provenance as the other.

`formulaVersionProcessDatasetExtractor.ts`: new optional
`processParameters?: ProcessParameter[]` extraction input (defaults to
`[]`, fully backward compatible — every existing caller keeps working
unchanged). `buildProcessParametersByCode()` fails closed on a duplicate
`code` (new error code `duplicate_process_parameter_code`, same
pool-wide fail-closed-on-ambiguous-identity convention as every other
pool in this extractor). `resolvePlannedProcedure()` matches rows whose
`(formulaCode, formulaVersion)` exactly equals the resolved
`Formulation.code`/`FormulationVersion.versionNumber`, sorted by
`stepNumber` then `code`, independent of input order. Matched rows are
cited in lineage as `sourceEntity: "processParameter"`,
`sourceRecordId: code` (a real, globally-unique masterdata code — no
collision-safety concern the way trial-embedded ids have, since
`process_parameters` is a flat collection, not a nested array).
`plannedProcedure` and `trials` resolve fully independently: a version
may have a persisted plan with zero trials (PLAN1: plan emitted, zero
fabricated actual observations — proven by test), trials with no
persisted plan, both, or neither.

### Tests

`formulaVersionProcessDatasetExtractor.test.ts`: 30 → 42 tests (+12, 0
removed/weakened). New: PLAN1 (persisted plan + zero linked trials, zero
fabricated actual observations, schema-valid, lineage cites both
`processParameter` rows), empty-`plannedProcedure`-on-no-natural-key-match,
plan/trial mutual independence, `duplicate_process_parameter_code`
fail-closed, plannedProcedure non-mutation of source /
non-aliasing of output, explicit-empty-string-`phase` preservation,
LINEAGE1 (two linked trials reuse the same nested step id, no collision),
LINEAGE2 (same for observation id), LINEAGE3 (`trial.id="A:B"`+`step.id="C"`
vs `trial.id="A"`+`step.id="B:C"` proven to encode distinctly), LINEAGE4
(exact original ids recoverable via `JSON.parse` on the citation),
LINEAGE5 (reordered trial/step/observation input still deterministic),
LINEAGE6 (no source object mutated while building citations).

### Fresh test/typecheck/lint/diff/tracker-validation evidence

All commands run fresh from the final corrected state on
`feature/laboratory-stability`:

- `pnpm --filter @formulab/shared exec vitest run
  src/engine/formulaVersionProcessDatasetExtractor.test.ts` — **42/42
  passed**.
- `pnpm --filter @formulab/shared exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/shared test` (full suite) — **86 files / 1831
  tests passed** (1819 → 1831, +12, no regression).
- `pnpm --filter @formulab/desktop test` (full suite) — **167 files /
  1726 tests passed, no regression** (unchanged from before this cycle —
  no desktop source file touched).
- `pnpm --filter @formulab/desktop exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop lint` (eslint) — clean.
- `git diff --check` — clean (pre-existing CRLF-normalization warnings
  only, exit 0).
- `python scripts/validate_v1_tracker.py` — `OK: 171 unique tasks across
  11 work packages, no drift found.`
- No `.rs` file touched — `cargo check` not applicable.
- No `runtime/pipeline` file touched — `python -m pytest
  runtime/pipeline` not applicable.

### Security / real-data-safety notes

No new I/O, persistence, or external input parsing added — the extractor
remains pure (no Tauri call, no mutation of inputs). Lineage citations
still carry only ids (never free text/measurements). All new tests use
entirely synthetic fixtures built from the existing
`step()`/`observation()`/`trial()`/`version()`/`formulation()` builders
plus a new `processParameter()` builder of the same kind — no real
laboratory/customer/production data touched.

### Files changed this cycle

- `packages/shared/src/schemas/dataset.ts` (`plannedProcedure` field
  added to `formulaVersionProcessRowSchema`; `processStepPlanSchema.phase`
  constraint corrected; header comment rewritten to record the corrected
  Manufacturing Procedure conclusion).
- `packages/shared/src/engine/formulaVersionProcessDatasetExtractor.ts`
  (`encodeNestedLineageId` collision-safe citation encoding;
  `processParameters` extraction input, `buildProcessParametersByCode`,
  `resolvePlannedProcedure`, `byProcessParameterOrder`; header comment
  rewritten).
- `packages/shared/src/engine/formulaVersionProcessDatasetExtractor.test.ts`
  (12 new tests; 3 existing lineage-citation assertions updated to the
  new encoding via the exported `encodeNestedLineageId` helper; new
  `processParameter()` fixture builder).
- `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-05.004 row — appended this
  cycle's evidence; did not remove or alter any prior cycle's evidence).
- This log file (new corrective-cycle section, appended).

All other pre-existing worktree modifications/deletions/untracked files
listed under "Starting state" above were left untouched.

### Commits

See `git log` on `feature/laboratory-stability` for the exact
corrective-cycle commit(s) created after this section was written — new
commits, not amends of `939accebbc2b59c3424a86ffde2b4773c764dcce`.

### Desktop build & shortcut

Recorded below per the Desktop Build & Shortcut Acceptance Gate (native
Tauri release build from the final corrective-cycle HEAD, `formulab.exe`
verification, shortcut `TargetPath` check).

### Remaining work

None identified for FVL-05.004 within this task's frozen scope. All
closure-gate line items from the governing brief are satisfied (see the
final report for the itemized checklist).

### Result

**COMPLETE** for this corrective verification cycle.

Manual UI acceptance from Desktop\FormuLab.lnk is pending user
verification.

## FVL-05.004 — third corrective cycle: final build/shortcut evidence (2026-08-23)

- Final HEAD (local == remote `origin/feature/laboratory-stability`):
  `92a89ae21dbab39a5d991b3e14b62180edd36c18`.
- Build command: `pnpm --filter @formulab/desktop tauri build` — exit 0.
  Vite frontend build succeeded (46.59s); Rust release compile succeeded
  (`Finished \`release\` profile [optimized] target(s) in 2m 38s`); MSI
  and NSIS bundles produced.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  — size 24,870,400 bytes, modified 2026-08-23 18:06 local time,
  SHA256 `a1feb1467ed2b5906b6041decfda63f3022ba6be24508144cd6ed81be3b9c394`
  (distinct from the pre-session build's hash
  `46f83d41d21411bccb79cd4826434910e14060286212ec0d3c4fffc6fcb66ce`,
  confirming this is a fresh build from this cycle's HEAD, not a stale
  artifact).
- `C:\Users\sekip\Desktop\FormuLab.lnk` verified via `WScript.Shell`:
  `TargetPath` = `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  (exact match to the just-built executable), `Arguments` = (none),
  `WorkingDirectory` = `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release`.
  No duplicate shortcut created; `.lnk` not committed.
- Native launch smoke: launched via the real Desktop shortcut
  (`Start-Process -FilePath 'C:\Users\sekip\Desktop\FormuLab.lnk'`); process
  `formulab.exe` (PID 19236) confirmed running and `Responding: True`
  several seconds after launch. **Automated launch smoke: PASS.**
  **Manual UI acceptance (New Request click-through, etc.) from
  Desktop\FormuLab.lnk is still pending USER verification** — not
  claimed here.

### Closure-gate checklist (all satisfied)

collision-safe lineage implemented; cross-trial reused nested IDs work
(LINEAGE1/2); delimiter-containing IDs cannot collide (LINEAGE3);
authoritative Laboratory schemas directly inspected; dataset/source-schema
parity proven (`phase` mismatch found and corrected); Manufacturing
Procedure persistence/linkage question resolved from direct repository
source (`process_parameters`, real and linkable) and the authoritative
persisted plan is now used (`plannedProcedure`, PLAN1); no plan fabricated
when none exists (empty-match test); planned/actual stay structurally
separate; no fabricated actual observations; exact zero/false/units/
optional values preserved (pre-existing + new tests); deterministic
ordering; exact formula/version/trial linkage preserved; fail-closed on
every ambiguous identity including the new `process_parameters` pool;
source non-mutation; no source/output aliasing; public exports correct
(barrel export unchanged, already covers the module); focused tests green
(42/42); full shared tests green (86/86 files, 1831/1831); desktop
regression green (167/167 files, 1726/1726, no regression); both
typechecks clean; desktop lint clean; tracker validator green; `git diff
--check` clean; tracker/handoff updated truthfully; FVL-05.005 untouched;
changes committed (`92a89ae`); pushed; local HEAD == remote HEAD; fresh
native build from final pushed HEAD; `Desktop\FormuLab.lnk` verified;
this external log updated.

**FVL-05.004 — IMPLEMENTATION AND ACCEPTANCE COMPLETE.**

**NEXT TASK — FVL-05.005 NOT STARTED** (per this session's explicit
instruction not to begin it).

## FVL-05.004 — fourth corrective cycle: independent GPT reopen (AUDIT_FVL05_GPT_000001, 2026-08-23)

A new independent GPT audit REOPENED FVL-05.004 after the third
corrective cycle's own "FVL-05.004 — IMPLEMENTATION AND ACCEPTANCE
COMPLETE" claim (commits `92a89ae`/`0b02cab`). Governing prompt directed
reading `docs/audits/FVL05-GPT Audits.md` and
`docs/prompts/FVL05 Prompts.md` first — both were found EMPTY (0 bytes);
the ten findings (A-J) exist only in the governing prompt itself, now
transcribed verbatim into `docs/audits/FVL05-GPT Audits.md`'s
`AUDIT_FVL05_GPT_000001` section. Scope: FVL-05.004 only, manual session
(no subagents, no Autopilot, no plan mode).

### Starting state

- Branch: `feature/laboratory-stability`.
- Starting local HEAD and starting remote HEAD (`origin/feature/laboratory-stability`):
  both `0b02cabc183c6093e960d2fca0d637f528097541` (in sync).
- Pre-existing dirty worktree at cycle start (unrelated, left untouched):
  modified `docs/generated/FormuLab-User-Guide.docx`/`.pdf`; deleted
  `formulas/2026-07-18-*.md` (10 files) and `formulas/index.json`;
  untracked `docs/external-logs/FormuLab-Build-Shortcut-Log.md`,
  `FormuLab-Connector-Management-Frontend-Log.md`,
  `FormuLab-FVL03-Integration-Log.md`,
  `FormuLab-FVL04-DataExchange-Integration-Log.md`,
  `FormuLab-New-Request-Runtime-Regression-Log.md`,
  `FormuLab-Phase11-Backup-Restore-Data-Safety-Log.md`,
  `FormuLab-Phase12-Commercial-Distribution-Log.md`,
  `FormuLab-Phase13-Identity-Security-Log.md`,
  `FormuLab-Phase14-Literature-Formulation-Intelligence-Log.md`. Verified
  unchanged via `git status --short` before commit — none staged.

### Findings and resolutions (summary — full evidence in `docs/audits/FVL05-GPT Audits.md`'s `CLAUDE RESOLUTION` section)

- **A (dataset schema version compatibility)** — investigated, NOT a
  defect: repo-wide grep (`grep -rln
  "formulaVersionProcessRowSchema\|formulaVersionCompositionRowSchema\|extractFormulaVersionProcessRows\|extractFormulaVersionDatasetRows"
  apps/ packages/` excluding `*.test.ts`) returns exactly the two engine
  files and `schemas/dataset.ts` itself — zero consumers exist anywhere,
  so there is no persisted "old" row a version bump would protect.
  Established precedent: FVL-05.002/.003/.004's own original row type all
  added shape under `"1.0"` without bumping. `DATASET_SCHEMA_VERSION`
  stays `"1.0"`; the exact future bump trigger is now documented
  explicitly in `schemas/dataset.ts`.
- **B (process_parameters authoritative identity)** — CONFIRMED. Traced
  registry (`naturalKey: ["formula_code","formula_version","step_number"]`)
  through the real commit path (`dataExchangeCommit.ts`'s
  `commitProcessParameters`: `code` is mechanically derived from that
  exact natural key). Fixed: extractor now also fails closed
  (`duplicate_process_parameter_natural_key`) on a same-natural-key/
  different-code collision in the supplied pool.
- **C (lineage contract vs. collision-safe encoding)** — CONFIRMED. The
  third cycle's `JSON.stringify([trial.id, record.id])` violated
  FVL-05.002's own "exact opaque persisted record id, never reformatted"
  contract. Fixed with the smallest correct additive change: new optional
  `parentRecordId` on `sourceRecordReferenceSchema`; `sourceRecordId`
  stays the exact unmodified child id; the duplicate-pair check now keys
  on the full `(sourceEntity, parentRecordId, sourceRecordId)` triple.
  `encodeNestedLineageId` removed (zero external consumers, confirmed via
  grep).
- **D (saved_version conditional invariant)** — CONFIRMED not enforced
  (direct grep of `laboratory.ts` for `superRefine`/`refine`: zero
  matches). Fixed extractor-side (narrow scope, not touching the shared
  schema): new `invalid_saved_version_trial_link` fail-closed check.
- **E (observation → process step referential integrity)** — CONFIRMED
  gap. Fixed: `TrialObservation.processStepId`, when present, must
  resolve within the SAME trial or the extractor fails closed
  (`dangling_observation_process_step_id`); proven not to resolve
  cross-trial.
- **F (attachments disposition)** — CONFIRMED silent drop. Built a full
  field-disposition table (now in `schemas/dataset.ts`'s FVL-05.004
  header); `attachments` now flows into the actual-observation view;
  `stepHasActualData` treats a non-empty array as evidence on its own.
- **G (durable schema parity)** — CONFIRMED gap (prose-only claim). New
  `PARITY1` test asserts every `trialProcessStepSchema` field is
  accounted for in the plan view, actual view, or an explicit omission
  set — fails automatically on a future undispositioned field.
- **H (formula-code uniqueness)** — CONFIRMED not enforced (direct read
  of `formulations.rs`'s `save_formulation`: storage keyed by `id` only).
  Fixed: extractor fails closed (`duplicate_formulation_code`) on two
  different formulation ids sharing a code.
- **I (deterministic ordering)** — CONFIRMED both sub-issues. Replaced
  every `.localeCompare()` on an opaque id/code with a locale-independent
  ordinal comparator; `createdAt`/`observedAt` are now validated as
  canonical `toISOString()` format before being used as a chronological
  sort key, failing closed (`invalid_timestamp_format`) otherwise.
- **J (structured error context)** — CONFIRMED. Redesigned
  `FormulaVersionProcessDatasetExtractionError` from one overloaded
  `formulationVersionId: string` to a `context` object with
  correctly-named optional fields; every throw site now sets only fields
  genuinely true of that failure.

A full whole-scope adversarial re-audit after all ten findings were fixed
(identity scope, schema compatibility, source fidelity, hidden defaults,
optional-field loss, lineage, ambiguity, cross-trial/cross-formula
leakage, plan/actual conflation, duplicate natural keys, source mutation,
aliasing, deterministic serialization, public exports, backward
compatibility) found no further defect.

### Tests

`formulaVersionProcessDatasetExtractor.test.ts`: 42 → 59 tests (+17, 0
removed). New: `VERSION1`, `PLANKEY1`, `PLANKEY2`, `FORMCODE1`, `LINK1`,
`LINK1b`, a working-draft positive control, `OBSREF1`, `OBSREF2`,
`OBSREF2b`, `ATTACH1`, `PARITY1`, `ORDER1`, `ORDER1b`, two new
timestamp-format fail-closed tests, `ERROR1`. LINEAGE1/2's assertions
rewritten to check the full `(parentRecordId, sourceRecordId)` tuple
instead of `sourceRecordId` alone — the correct invariant for the new
citation shape (`sourceRecordId` is now deliberately allowed to repeat
across trials), not a weakening. LINEAGE3/4 rewritten around the new
`parentRecordId` field (no more `encodeNestedLineageId`/`JSON.parse`
decoding — the two identities are just two separate fields now).

### Fresh test/typecheck/lint/diff/tracker-validation evidence

All commands run fresh from the final corrected state on
`feature/laboratory-stability`:

- `pnpm --filter @formulab/shared exec vitest run
  src/engine/formulaVersionProcessDatasetExtractor.test.ts` — **59/59
  passed**.
- `pnpm --filter @formulab/shared exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/shared exec vitest run` (full suite) — **86
  files / 1848 tests passed** (1831 → 1848, +17, no regression —
  `dataset.test.ts`, `formulaVersionDatasetExtractor.test.ts`, and
  `dataExchangeRegistry.consistency.test.ts` all confirmed unaffected by
  the additive `parentRecordId` schema field).
- `pnpm --filter @formulab/desktop exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop lint` (eslint) — clean.
- `pnpm --filter @formulab/desktop exec vitest run` (full suite) — **167
  files / 1726 tests passed, no regression** (unchanged from before this
  cycle — no desktop source file touched).
- `git diff --check` — clean (pre-existing CRLF-normalization warnings
  only, exit 0).
- `python scripts/validate_v1_tracker.py` — `OK: 171 unique tasks across
  11 work packages, no drift found.`
- No `.rs` file touched — `cargo check` not applicable.
- No `runtime/pipeline` file touched — `python -m pytest
  runtime/pipeline` not applicable.

### Security / real-data-safety notes

No new I/O, persistence, or external input parsing added — the extractor
remains pure. Lineage citations still carry only ids (never free
text/measurements). All new tests use entirely synthetic fixtures built
from the existing `step()`/`observation()`/`trial()`/`version()`/
`formulation()`/`processParameter()` builders — no real laboratory/
customer/production data touched. No authoritative Laboratory schema
(`laboratoryTrialSchema`/`trialProcessStepSchema`/`trialObservationSchema`)
was modified — Findings D and I's checks were both deliberately kept
extractor-side per their own narrow-scope reasoning, avoiding blast
radius into FVL-01/02 trial-creation code and any already-persisted
trial records.

### Files changed this cycle

- `packages/shared/src/schemas/dataset.ts` (`parentRecordId` additive
  field on `sourceRecordReferenceSchema`; duplicate-pair key widened;
  `attachments` added to `processStepActualObservationSchema`; FVL-05.004
  header comment rewritten with the full field-disposition table and all
  ten findings' resolutions).
- `packages/shared/src/engine/formulaVersionProcessDatasetExtractor.ts`
  (rewritten: `compareOrdinal`/`isCanonicalIsoTimestamp` helpers;
  `encodeNestedLineageId` removed; `encodeProcessParameterNaturalKey`/
  natural-key duplicate check; `duplicate_formulation_code`/
  `invalid_saved_version_trial_link`/`dangling_observation_process_step_id`/
  `invalid_timestamp_format` checks; error class redesigned to a
  `context`-object shape).
- `packages/shared/src/engine/formulaVersionProcessDatasetExtractor.test.ts`
  (17 new tests; LINEAGE1-4 rewritten for the new citation shape; new
  `processParameter()` builder already present from the third cycle,
  reused).
- `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-05.004 row — appended this
  cycle's evidence; did not remove or alter any prior cycle's evidence).
- `docs/handoffs/FORMULAB_V1_CURRENT.md` (new pointer block for this
  cycle, prepended above the third cycle's block, which is left intact
  as history).
- `docs/audits/FVL05-GPT Audits.md` (populated for the first time — was
  empty; now records `AUDIT_FVL05_GPT_000001` verbatim plus this
  session's `CLAUDE RESOLUTION` section).
- `docs/prompts/FVL05 Prompts.md` (populated for the first time — was
  empty; now records PROMPT 1 — reconstructed verbatim from this same
  conversation's history, since it was never previously saved anywhere —
  and PROMPT 2, this cycle's own governing prompt).
- This log file (new corrective-cycle section, appended).

All other pre-existing worktree modifications/deletions/untracked files
listed under "Starting state" above were left untouched.

### Commits

See `git log` on `feature/laboratory-stability` for the exact
corrective-cycle commit(s) created after this section was written — new
commits, not amends of `0b02cabc183c6093e960d2fca0d637f528097541`.

### Desktop build & shortcut

Recorded below per the Desktop Build & Shortcut Acceptance Gate (native
Tauri release build from the final corrective-cycle HEAD, `formulab.exe`
verification, shortcut `TargetPath` check, native launch smoke).

### Remaining work

None identified for FVL-05.004 within this task's frozen scope.

### Result

**COMPLETE** for this corrective verification cycle.

Manual UI acceptance from Desktop\FormuLab.lnk is pending user
verification.

## FVL-05.004 — fourth corrective cycle: reconciliation with remote GPT ledger + final build/shortcut evidence (2026-08-23)

### Remote reconciliation

`git push` after the first fourth-cycle commit (`80c74b6`) was rejected:
the remote had gained two commits (`b2715a3` "docs(FVL-05): add GPT audit
ledger", `7889da4` "docs(FVL-05): add GPT prompt ledger") pushed by the
user directly while this session worked — containing the REAL, full
`AUDIT_FVL05_GPT_000001` audit (411 lines) and `PROMPT_FVL05_GPT_000001`
prompt (530 lines). This session's own `docs/audits/FVL05-GPT Audits.md`/
`docs/prompts/FVL05 Prompts.md` had been found empty (0 bytes) at session
start and were populated with a transcription reconstructed from this
session's own governing prompt — now superseded by the real content.

Resolved via `git merge origin/feature/laboratory-stability` (not a
rebase — the pre-existing unrelated dirty worktree files blocked a clean
rebase and stashing was denied by the permission classifier; a merge
does not require a clean tree for unrelated paths). Both ledger files
conflicted (add/add). Resolved by keeping the real, user-authored
content as the base and re-appending this session's own resolution
sections on top — not reconciled into one voice, not deleted:

- `docs/audits/FVL05-GPT Audits.md`: real `AUDIT_FVL05_GPT_000001`
  (findings A1-A4/B1-B5/C1-C5/D1-D3/E/F/G) kept verbatim; this session's
  `CLAUDE RESOLUTION` section REWRITTEN to reference the real finding
  IDs (previously used an improvised A-J lettering, since the session
  had no real audit to reference against at the time) and to explicitly
  address D1/D2/D3 (documentation-truth findings this session's first
  pass had not covered).
- `docs/prompts/FVL05 Prompts.md`: real `PROMPT_FVL05_GPT_000001` kept
  verbatim; this session's own actually-received governing prompt
  appended as `PROMPT_FVL05_GPT_000002` (recorded as a distinct variant,
  not merged into the first — the two differ in section
  numbering/lettering and required-test names for the same substantive
  scope).

### D1 (tracker/handoff contradictory truth) — actually fixed this pass

The real audit's D1 finding was not addressed by the first fourth-cycle
commit. Fixed in the reconciliation commit:

- `docs/FORMULAB_V1_TASK_TRACKER.md`'s FVL-05.004 row: inserted an
  explicit "CURRENT TRUTH is the FOURTH CORRECTIVE CYCLE paragraph at
  the very end of this cell — read that first" marker immediately after
  the row's `COMPLETED` date, before the superseded opening sentence
  ("no persisted process-plan record exists independent of a trial"),
  which is now clearly flagged as historical narrative rather than left
  to silently contradict the corrected conclusion.
- `docs/handoffs/FORMULAB_V1_CURRENT.md`'s THIRD CORRECTIVE CYCLE block
  (now correctly positioned below the new FOURTH CORRECTIVE CYCLE block
  per the file's existing newest-first convention): annotated the
  `(formulaCode, formulaVersion)` phrase in place to point at the block
  above for the exact 3-part authoritative natural key.
- `packages/shared/src/schemas/dataset.ts` (2 occurrences) and
  `packages/shared/src/engine/formulaVersionProcessDatasetExtractor.ts`
  (2 occurrences): the same imprecise `(formulaCode, formulaVersion)`
  phrasing, used to describe the row-level grouping/match criterion,
  now explicitly distinguished from the per-record authoritative natural
  key `(formulaCode, formulaVersion, stepNumber)` in every occurrence.

### Fresh re-verification after reconciliation

- `pnpm --filter @formulab/shared exec vitest run
  src/engine/formulaVersionProcessDatasetExtractor.test.ts
  src/schemas/dataset.test.ts` — **77/77 passed**.
- `pnpm --filter @formulab/shared exec vitest run` (full suite) — **86
  files / 1848 tests passed**, unchanged from before reconciliation (only
  comments/docs changed in the reconciliation commit itself).
- `pnpm --filter @formulab/shared exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop lint` — clean.
- `python scripts/validate_v1_tracker.py` — `OK: 171 unique tasks across
  11 work packages, no drift found.`
- `git diff --staged --check` — 3 warnings, all pre-existing trailing
  double-space markdown line-breaks in the verbatim-preserved real audit
  header (the user's own original content, not introduced by this
  session); otherwise clean.
- Desktop full test suite not re-run after the reconciliation commit
  (doc/comment-only changes, no desktop source touched) — last real run
  (167 files / 1726 tests passed) remains valid evidence for this HEAD.

### Commits

- `80c74b6` — first fourth-cycle commit (all ten code-level findings
  B1-C5 fixed; rejected on push, remote had moved).
- `bb70dd6` — merge/reconciliation commit (real ledger content kept,
  D1 actually fixed, CLAUDE RESOLUTION remapped to real finding IDs).

Final HEAD: `bb70dd67d81627af533a93c8875352c18b482b98`. Verified
`git rev-parse HEAD` equals `git rev-parse origin/feature/laboratory-stability`
after push — both `bb70dd67d81627af533a93c8875352c18b482b98`.

### Desktop build & shortcut (final pushed HEAD)

- Build command: `pnpm --filter @formulab/desktop tauri build` — exit 0.
  Vite build succeeded (17.69s); Rust release compile succeeded
  (Finished release profile [optimized] target(s) in 1m 11s); MSI
  and NSIS bundles produced.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  — size 24,870,400 bytes, modified 2026-08-23 20:13 local time,
  SHA256 `2925c4ce2c1a6307cb9e7378421def00e466bca09709b2daf662e15715217915`
  (distinct from the pre-cycle build's hash
  `a1feb1467ed2b5906b6041decfda63f3022ba6be24508144cd6ed81be3b9c39`,
  confirming a fresh build from this cycle's final HEAD).
- `C:\Users\sekip\Desktop\FormuLab.lnk` verified via WScript.Shell:
  TargetPath equals the exact just-built executable path (byte-identical
  match), Arguments empty, WorkingDirectory is
  `...\apps\desktop\src-tauri\target\release`. No duplicate shortcut
  created; `.lnk` not committed.
- Native launch smoke: prior stale `formulab.exe` process (from an
  earlier session's smoke test) stopped first; launched fresh via
  Start-Process against the shortcut; resulting process (PID 5128)
  confirmed running from the exact fresh exe path and Responding=True 5
  seconds after launch. Automated launch smoke: PASS. Manual UI
  acceptance (New Request click-through, etc.) from Desktop\FormuLab.lnk
  is still pending USER verification — not claimed here.

### Closure-gate checklist (all satisfied)

dataset schema-version compatibility resolved from the FVL-05.001
contract (B1, no bump needed, zero-consumer evidence); process_parameters
authoritative natural key traced end-to-end and enforced (B2); duplicate
natural-key process steps fail closed; processParameter lineage cites the
real persisted code; nested lineage collision-safe AND preserves the
exact child persisted id under the FVL-05.002 contract (B3, via the
additive parentRecordId field) AND preserves explicit parent scope;
cross-trial reused nested IDs work; delimiter/unicode-containing IDs
cannot collide; saved_version-implies-sourceFormulaVersionId invariant
enforced/fail-closed (B4); TrialObservation.processStepId referential
integrity enforced when present (B5); authoritative Laboratory schemas
directly inspected; field-by-field TrialProcessStep disposition matrix
completed (C1/C2); every demonstrated source/dataset mismatch corrected
or source-justified; attachment handling deliberately resolved (C1);
Manufacturing Procedure persistence/linkage re-proven from executable
source; authoritative persisted plan used; no plan fabricated; planned
and actual data remain structurally separate; no fabricated actual
observations; exact zero/false/units/optional values preserved; ordering
locale-independent (C3); timestamp-order assumption validated/fail-closed
(C3); exact formula/version/trial linkage; formula-code uniqueness used
by plan linkage proven-not-enforced and fails closed on ambiguity (C5);
all ambiguous identities fail closed; structured error context names
match values (C4); source non-mutation; no source/output aliasing; public
exports correct; focused tests green (77/77); full shared tests green
(86/86 files, 1848/1848); desktop regression green (167/167 files,
1726/1726, last real run, unaffected by doc-only reconciliation);
shared/desktop typechecks green; desktop lint green; tracker validator
green; git diff --check clean (pre-existing warnings only); tracker/
handoff present one unambiguous current truth (D1, actually fixed this
pass); GPT audit ledger updated (real content preserved, resolution
appended); prompt ledger updated (real content preserved, this session's
actual prompt appended); FVL-05.005 untouched; changes committed and
pushed; local HEAD == remote HEAD; fresh native build from final pushed
HEAD; Desktop\FormuLab.lnk verified; this external log updated; fresh
whole-scope adversarial re-audit found no unresolved defect.

**FVL-05.004 — IMPLEMENTATION AND ACCEPTANCE COMPLETE.**

**NEXT TASK — FVL-05.005 NOT STARTED** (per this session's explicit
instruction not to begin it).

## FVL-05.004 — fifth corrective cycle: second independent GPT re-audit (AUDIT_FVL05_GPT_000002, 2026-08-23)

A second independent GPT re-audit reopened FVL-05.004 after the fourth
cycle's own completion claim. Governing prompt:
`docs/prompts/FVL05-GPT-PROMPT-000003.md`. Audit:
`docs/audits/FVL05-GPT-AUDIT-000002.md`. Both files, plus the existing
`docs/audits/FVL05-GPT Audits.md`/`docs/prompts/FVL05 Prompts.md`, are
now explicitly GPT-owned/READ-ONLY for Claude per this audit's own new
control-plane rule — this session read them but did not write to any of
them. Implementation evidence recorded only here, in the tracker, and in
the handoff, per that rule. Scope: FVL-05.004 only, manual session (no
subagents, no Autopilot).

### Starting state

- Branch: `feature/laboratory-stability`.
- Starting local HEAD: `a98df8b8d5e0bfe29fc7aecac689bfcfc8c3678b`.
- `git fetch` found remote at `ac85179a9d0386fce6fece5200d0c5d0ae880211`
  (two new commits: `7616177` adding `docs/audits/FVL05-GPT-AUDIT-000002.md`,
  `ac85179` adding `docs/prompts/FVL05-GPT-PROMPT-000003.md`) —
  fast-forwarded cleanly (`git merge --ff-only`), no conflict this time.
- Pre-existing dirty worktree (unrelated, left untouched): modified
  `docs/generated/FormuLab-User-Guide.docx`/`.pdf`; deleted
  `formulas/2026-07-18-*.md` (10 files) and `formulas/index.json`;
  untracked `docs/external-logs/FormuLab-Build-Shortcut-Log.md`,
  `FormuLab-Connector-Management-Frontend-Log.md`,
  `FormuLab-FVL03-Integration-Log.md`,
  `FormuLab-FVL04-DataExchange-Integration-Log.md`,
  `FormuLab-New-Request-Runtime-Regression-Log.md`,
  `FormuLab-Phase11-Backup-Restore-Data-Safety-Log.md`,
  `FormuLab-Phase12-Commercial-Distribution-Log.md`,
  `FormuLab-Phase13-Identity-Security-Log.md`,
  `FormuLab-Phase14-Literature-Formulation-Intelligence-Log.md`. Verified
  unchanged via `git status --short` before commit.

### Finding 1 — dataset schema-version contract was internally contradictory (fixed)

The fourth cycle left `DATASET_SCHEMA_VERSION` at `"1.0"` after adding
`plannedProcedure`/`parentRecordId`, reasoning from usage evidence (zero
consumers exist). That directly contradicted the ORIGINAL rule stated on
`DATASET_SCHEMA_VERSION` itself: "bump when the shape of a dataset row
changes (a field is added, removed, or renamed...)". Verified via
`git log --follow -p -- packages/shared/src/schemas/dataset.ts` that
this exact comment has been present, unchanged, since the very first
FVL-05.001 commit (`78c6866`) — it is the real, pre-existing,
authoritative contract; the "unfrozen 1.0" exception was self-authored
in a later corrective cycle, never actually written into that contract.
Resolved in favor of the original rule (option A, not option B):
`DATASET_SCHEMA_VERSION` bumped `"1.0"` → `"1.1"` in one step, covering
every row-shape change accumulated since `"1.0"` was first defined and
never bumped (FVL-05.002's `sourceRecords`, FVL-05.003's whole row type,
FVL-05.004's original row type, `plannedProcedure`, `parentRecordId`).
Every future shape change bumps again — no further exception. The prior
cycle's contradictory "FINDING A: stays 1.0" comment block in
`schemas/dataset.ts` rewritten to state this bump and its reasoning.
Compatibility: repo-wide grep re-confirmed zero persisted rows of this
family exist anywhere, so no `SchemaMigration` entry was registered
(none applicable) — but the version constant still bumps per the rule
regardless. `datasetSchemaVersionSchema` being a `z.literal` means a row
still carrying `"1.0"` is now structurally rejected — proven by a new
`dataset.test.ts` test and `VERSION1`'s rewritten assertion.

### Finding 2 — PARITY1 proved key-name parity only, not semantic-constraint parity (fixed)

`processStepPlanSchema`/`processStepActualObservationSchema` were
hand-modeled independently of `trialProcessStepSchema`, so `PARITY1`
(checking only that every source field NAME appears in one of the two
views or an omission list) could never catch a source field's
default/optional/enum/refinement changing while the dataset view stayed
stale — exactly the class of bug the original `phase` mismatch was.
Fixed by deriving both views via zod `.pick()` directly from
`trialProcessStepSchema`, `.extend()`ed with
`processStepId: trialProcessStepSchema.shape.id` (the exact same
constraint object as source `id`, renamed) — each picked field (`phase`,
`requiredEquipment`, `status`, `unplanned`, `attachments`, etc.) is now
the LITERAL SAME zod schema object as the source, not an independent
re-typed copy, so a future semantic change to an already-selected field
is felt automatically with zero `dataset.ts` edit required. The audit's
own claim that `stepNumber` needing to appear in both views makes
`.pick()` impractical was confirmed incorrect: two independent `.pick()`
calls both including `stepNumber` compose without conflict — verified
directly. `PARITY1` (key-membership) is KEPT unchanged — composition
alone doesn't automatically surface a brand-new source field, so the two
mechanisms are complementary, not redundant, matching the audit's own
"must catch BOTH" requirement. New `PARITY2` proves referential identity
(`processStepPlanSchema.shape.phase === trialProcessStepSchema.shape.phase`,
etc., for every picked field in both views). New `PARITY3` proves this
end-to-end through the real extractor: a source-schema-valid
whitespace-only `requiredEquipment` entry round-trips unchanged, since
the plan view's array-of-string constraint is now literally the source's
own schema object. Removed now-unused `decimalString`/
`attachmentReferenceSchema` imports from `schemas/dataset.ts` (both
fields now arrive via composition, never hand-typed there directly).

### Regression re-audit (per prompt section 4)

Re-read the whole FVL-05.004 implementation after both fixes. Confirmed
intact, unchanged: `process_parameters` authoritative natural-key
ambiguity handling; exact `sourceRecordId` + structural `parentRecordId`
nested lineage; `saved_version` missing/blank `sourceFormulaVersionId`
fail-closed behavior; same-trial `TrialObservation.processStepId`
referential integrity; attachment-only actual evidence; formula-code
ambiguity handling; locale-independent deterministic ordering; timestamp
validation; truthful structured error identities; no plan/actual
conflation; no cross-trial/cross-formula leakage; source non-mutation
and no output/source aliasing (still guaranteed by zod's
always-rebuilding `safeParse`, now composition-derived schemas included);
public exports remain coherent (barrel export line unchanged;
`formulaVersionProcessDatasetExtractor.ts` itself needed NO code change
this cycle — the fix was entirely schema-composition in `dataset.ts` plus
the version-literal bump, both upstream of the extractor's own logic).

### Tests

`formulaVersionProcessDatasetExtractor.test.ts`: 59 → 61 tests (+2:
`PARITY2`, `PARITY3`; `VERSION1` rewritten in place — literal updated
`"1.0"` → `"1.1"`, plus a new assertion that the superseded `"1.0"`
literal is now rejected by the row schema — not weakened, strengthened).
`dataset.test.ts`: 18 → 19 tests (+1: explicit rejection of the
superseded `"1.0"` version literal; the "is an explicit literal" test's
expected value updated to `"1.1"`; two fixtures in the
dataset-vs-feature-version independence test switched from a hardcoded
`"1.0"` literal to the symbolic `DATASET_SCHEMA_VERSION`/
`FEATURE_SCHEMA_VERSION` constants so they can never again silently drift
out of sync with a future bump).

### Fresh test/typecheck/lint/diff/tracker-validation evidence

All commands run fresh from the final corrected state on
`feature/laboratory-stability`:

- `pnpm --filter @formulab/shared exec vitest run
  src/engine/formulaVersionProcessDatasetExtractor.test.ts
  src/schemas/dataset.test.ts` — **80/80 passed**.
- `pnpm --filter @formulab/shared exec vitest run` (full suite) — **86
  files / 1851 tests passed** (1848 → 1851, +3 net, no regression).
- `pnpm --filter @formulab/shared exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop lint` (eslint) — clean.
- `pnpm --filter @formulab/desktop exec vitest run` (full suite) — **167
  files / 1726 tests passed, no regression** (unchanged — no desktop
  source file touched; `dataset.ts`'s consumers are entirely within
  `packages/shared`, confirmed by both a repo-wide grep and this green
  desktop run).
- `python scripts/validate_v1_tracker.py` — `OK: 171 unique tasks across
  11 work packages, no drift found.`
- `git diff --check` — clean (pre-existing CRLF-normalization warnings
  only, exit 0).
- No `.rs` file touched — `cargo check` not applicable.
- No `runtime/pipeline` file touched — `python -m pytest
  runtime/pipeline` not applicable.

### Security / real-data-safety notes

No new I/O, persistence, or external input parsing added — the extractor
remains pure; this cycle's changes are entirely schema-definition
(`dataset.ts`) and test files. No real laboratory/customer/production
data touched — all fixtures synthetic, reused from the existing test
builders.

### Files changed this cycle

- `packages/shared/src/schemas/dataset.ts` (`DATASET_SCHEMA_VERSION`
  bumped `"1.0"` → `"1.1"`; `processStepPlanSchema`/
  `processStepActualObservationSchema` rewritten as zod `.pick()`/
  `.extend()` compositions of `trialProcessStepSchema`; unused
  `decimalString`/`attachmentReferenceSchema` imports removed; FVL-05.004
  header comment's contradictory version narrative rewritten).
- `packages/shared/src/schemas/dataset.test.ts` (version-literal
  assertions updated; 1 new test; 2 fixtures switched to symbolic
  constants).
- `packages/shared/src/engine/formulaVersionProcessDatasetExtractor.test.ts`
  (`VERSION1` rewritten; 2 new tests — `PARITY2`, `PARITY3`).
- `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-05.004 row — appended this
  cycle's evidence under a new "FIFTH CORRECTIVE CYCLE" heading, "read
  this first" pointer updated to point at it; did not remove or alter
  any prior cycle's evidence).
- `docs/handoffs/FORMULAB_V1_CURRENT.md` (new pointer block for this
  cycle, prepended above the fourth cycle's block, which is left intact
  as history).
- This log file (new corrective-cycle section, appended).

GPT-owned files explicitly NOT touched this cycle (per the new
read-only rule): `docs/audits/FVL05-GPT Audits.md`,
`docs/audits/FVL05-GPT-AUDIT-000002.md`, `docs/prompts/FVL05 Prompts.md`,
`docs/prompts/FVL05-GPT-PROMPT-000003.md`.

All other pre-existing worktree modifications/deletions/untracked files
listed under "Starting state" above were left untouched.

### Commits

- `4134315` — this cycle's single commit (both findings fixed; no
  amend, no force push, no history rewrite).

Final HEAD: `413431523cf47c9c96335b84cc51f659f47064e6`. Verified
`git rev-parse HEAD` equals
`git rev-parse origin/feature/laboratory-stability` after push — both
`413431523cf47c9c96335b84cc51f659f47064e6`.

### Desktop build & shortcut (final pushed HEAD)

- Build command: `pnpm --filter @formulab/desktop tauri build` — exit 0.
  Rust release compile succeeded (`Finished \`release\` profile
  [optimized] target(s) in 1m 17s`); MSI and NSIS bundles produced.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  — size 24,870,912 bytes, modified 2026-08-23 21:05 local time,
  SHA256 `7100413eabfbe4398f4f40bc97f8031d0d2e8c2fcbefa8a2018f4cf513562e70`
  (distinct from the pre-cycle build's hash
  `2925c4ce2c1a6307cb9e7378421def00e466bca09709b2daf662e15715217915`,
  confirming a fresh build from this cycle's final HEAD).
- `C:\Users\sekip\Desktop\FormuLab.lnk` verified via WScript.Shell:
  TargetPath matches the exact just-built executable path, Arguments
  empty, WorkingDirectory correct. No duplicate shortcut created; `.lnk`
  not committed.
- Native launch smoke: prior `formulab.exe` process stopped first;
  launched fresh via the real shortcut; resulting process (PID 8784)
  confirmed running from the exact fresh exe path and `Responding: True`
  5 seconds after launch. **Automated launch smoke: PASS.** **Manual UI
  acceptance from Desktop\FormuLab.lnk is still pending USER
  verification** — not claimed here.

### Closure-gate checklist (all satisfied)

Dataset schema-version rule reconciled into ONE authoritative,
non-contradictory contract and implemented/tested; process-step schema
parity structurally derived from the canonical source (composition), not
merely key-name tested; the whole FVL-05.004 scope re-audited after both
changes with no regression found; focused FVL-05.004 tests green (80/80),
full shared tests green (86/86 files, 1851/1851), desktop tests green
(167/167 files, 1726/1726), shared/desktop typechecks green, desktop
lint green, tracker validation green, `git diff --check` clean;
tracker/handoff/external log truthful and pointing to current truth;
changes committed and pushed with local HEAD == remote HEAD; native
Tauri release build and `Desktop\FormuLab.lnk` checks rerun from the
final pushed HEAD; FVL-05.005 remains untouched; GPT audit/prompt files
untouched (read-only, respected).

**FVL-05.004 — IMPLEMENTATION AND ACCEPTANCE COMPLETE.**

**NEXT TASK — FVL-05.005 NOT STARTED** (per this session's explicit
instruction not to begin it).

## FVL-05.004 — sixth corrective cycle: third independent GPT re-audit, documentation-only (AUDIT_FVL05_GPT_000003, 2026-08-23)

A third independent GPT re-audit re-reviewed FVL-05.004 after the fifth
corrective cycle. Governing prompt:
`docs/prompts/FVL05-GPT-PROMPT-000004.md`. Audit:
`docs/audits/FVL05-GPT-AUDIT-000003.md`. Both read-only per the
now-standing control-plane rule (established by `AUDIT_FVL05_GPT_000002`)
— read, not written to, this cycle, along with the existing
`docs/audits/FVL05-GPT Audits.md`/`docs/prompts/FVL05 Prompts.md`. Scope:
FVL-05.004 only, documentation-only correction cycle unless direct
inspection proved a new implementation defect (none was found). Manual
session, no subagents, no Autopilot.

### Starting state

- Branch: `feature/laboratory-stability`.
- Starting local HEAD: `ebc26a40188b61b7c700b46e0d24bbde7f2e575c`.
- `git fetch` found remote at `de26365a2b396e2de659f258746a99e04d9f5217`
  (two new commits: `ac91aad` adding `docs/audits/FVL05-GPT-AUDIT-000003.md`,
  `de26365` adding `docs/prompts/FVL05-GPT-PROMPT-000004.md`) —
  fast-forwarded cleanly (`git merge --ff-only`), no conflict.
- Pre-existing dirty worktree (unrelated, left untouched): same set as
  prior cycles — modified `docs/generated/FormuLab-User-Guide.docx`/
  `.pdf`; deleted `formulas/2026-07-18-*.md` (10 files) and
  `formulas/index.json`; the same 9 untracked external-log files under
  `docs/external-logs/`. Verified unchanged via `git status --short`
  before commit.

### Verdict on prior findings

The audit confirmed BOTH `AUDIT_FVL05_GPT_000002` findings genuinely
fixed in current source (`DATASET_SCHEMA_VERSION` is `"1.1"` with the
superseded `"1.0"` rejected; `processStepPlanSchema`/
`processStepActualObservationSchema` composition-derived via `.pick()`)
and found **no new FVL-05.004 implementation defect**. The only
remaining gap was documentation: three stale current-truth claims left
behind by the version/lineage changes those earlier cycles made.

### Finding 1 — FVL-05.001 tracker row still claimed both versions "1.0" (fixed)

`docs/FORMULAB_V1_TASK_TRACKER.md`'s FVL-05.001 row stated
`DATASET_SCHEMA_VERSION`/`FEATURE_SCHEMA_VERSION` "are separate literal
`\"1.0\"` constants" as a blanket present-tense claim — no longer true
for the dataset version after the fifth cycle's bump. Corrected in place
with an explicit "CURRENT VALUES" note distinguishing the two
(`DATASET_SCHEMA_VERSION` now `"1.1"`, `FEATURE_SCHEMA_VERSION`
unchanged at `"1.0"`), while preserving the original sentence as the
accurate historical record of what FVL-05.001 originally shipped —
FVL-05.001's own COMPLETED status/date untouched.

### Finding 2 — FVL-05.002 tracker row still described the pre-parentRecordId contract (fixed)

The FVL-05.002 row described `sourceRecordReferenceSchema` as only
`sourceEntity` + `sourceRecordId`, with duplicate detection on the pair
— stale since the fourth corrective cycle added the additive, optional
`parentRecordId` field and widened duplicate detection to the triple
`(sourceEntity, parentRecordId, sourceRecordId)`. Corrected in place with
a "CURRENT CONTRACT" note stating the exact current shape, that
`sourceRecordId`'s original exact-child-id semantics are UNCHANGED, that
the same child id under two different parents (or parent present vs.
absent) is legitimate, and pointing at `AUDIT_FVL05_GPT_000001` finding
B3/C for why the change was made — FVL-05.002's own COMPLETED status/date
untouched.

### Finding 3 — dataset.ts top-level module comment was stale (fixed)

`packages/shared/src/schemas/dataset.ts`'s own top-of-file comment still
said "This module defines the two versions only... That is FVL-05.002
onward" — accurate only at FVL-05.001 completion; the same file has
since been extended in place by FVL-05.002 (lineage), FVL-05.003
(composition row), and FVL-05.004 (process row) schemas. Rewritten to
state plainly that the file has been extended in place by each later
task, pointing at each section's own header comment below for its exact
contract, rather than leaving the reader to discover this by scrolling.

### Search for further equivalent stale claims

Per the prompt's explicit instruction, searched for other instances of
the same two patterns ("both versions 1.0", "pair-based duplicate
detection") across `docs/handoffs/FORMULAB_V1_CURRENT.md`,
`packages/shared/src/schemas/dataset.test.ts`, and the FVL-05 engine
files. None found beyond the three the audit named. One test title in
`dataset.test.ts` ("rejects an exact duplicate (sourceEntity,
sourceRecordId) pair") still uses pair language — left unchanged: it
remains literally accurate for that specific test case (both references
have no `parentRecordId` set, so the pair IS the relevant identity for
that scenario), not a current-truth contradiction. The pre-existing,
long-stale "FVL-05 = 1/14, only FVL-05.001 work done" summary near the
top of the tracker file was deliberately NOT touched — it predates and
is unrelated to the version/lineage changes this audit's three findings
are specifically about, out of this narrowly-scoped documentation cycle
(matching the prompt's "correct only genuine contradictions [from these
same changes]" instruction).

### Fresh test/typecheck/lint/diff/tracker-validation evidence

All commands run fresh from the final corrected state on
`feature/laboratory-stability`:

- `pnpm --filter @formulab/shared exec vitest run
  src/engine/formulaVersionProcessDatasetExtractor.test.ts
  src/schemas/dataset.test.ts` — **80/80 passed** (unchanged — doc/
  comment-only cycle, no test logic touched).
- `pnpm --filter @formulab/shared exec vitest run` (full suite) — **86
  files / 1851 tests passed** (unchanged).
- `pnpm --filter @formulab/shared exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop lint` (eslint) — clean.
- `pnpm --filter @formulab/desktop exec vitest run` (full suite) — **167
  files / 1726 tests passed, no regression** (unchanged).
- `python scripts/validate_v1_tracker.py` — `OK: 171 unique tasks across
  11 work packages, no drift found.`
- `git diff --check` (on staged changes) — clean, no whitespace warnings
  at all this cycle (no verbatim GPT-authored content touched).
- No `.rs` file touched — `cargo check` not applicable.
- No `runtime/pipeline` file touched — `python -m pytest
  runtime/pipeline` not applicable.

### Files changed this cycle

- `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-05.001 row, FVL-05.002 row,
  and the FVL-05.004 cell's own "read this first" pointer + new SIXTH
  CORRECTIVE CYCLE paragraph — comment/prose only, no task status
  changed).
- `docs/handoffs/FORMULAB_V1_CURRENT.md` (new pointer block for this
  cycle, prepended above the fifth cycle's block, left intact as
  history).
- `packages/shared/src/schemas/dataset.ts` (top-of-file module comment
  rewritten — no schema/type/logic change).
- This log file (new corrective-cycle section, appended).

GPT-owned files explicitly NOT touched this cycle (read-only rule
respected): `docs/audits/FVL05-GPT Audits.md`,
`docs/audits/FVL05-GPT-AUDIT-000002.md`,
`docs/audits/FVL05-GPT-AUDIT-000003.md`, `docs/prompts/FVL05 Prompts.md`,
`docs/prompts/FVL05-GPT-PROMPT-000003.md`,
`docs/prompts/FVL05-GPT-PROMPT-000004.md`.

All other pre-existing worktree modifications/deletions/untracked files
listed under "Starting state" above were left untouched.

### Commits

- `6839772` — this cycle's single commit (all three findings fixed; no
  amend, no force push, no history rewrite).

Final HEAD: `68397722a68e950b6197e5eca269633e025d9c2b`. Verified
`git rev-parse HEAD` equals
`git rev-parse origin/feature/laboratory-stability` after push — both
`68397722a68e950b6197e5eca269633e025d9c2b`.

### Desktop build & shortcut (final pushed HEAD)

- First build attempt FAILED (real failure, not a false alarm — the
  wrapper command's own exit code was misleadingly reported as 0 because
  output was piped through `tail`, which masked the underlying `pnpm`
  failure): `error: failed to remove file
  ...\target\release\formulab.exe — Caused by: Access is denied. (os
  error 5)`. Root cause: the native launch smoke test's own
  `formulab.exe` process from the fifth corrective cycle was still
  running and held the file locked. Fixed by stopping the stale process
  (`Stop-Process -Force`) and rebuilding. **Lesson applied**: after this
  cycle's own native launch smoke test below, the process was
  deliberately stopped again immediately after verification, specifically
  to avoid locking the executable for whatever build runs next.
- Second (real) build: `pnpm --filter @formulab/desktop tauri build`,
  exit code confirmed explicitly via `echo "EXIT_CODE=$?"` this time
  (not inferred from a piped command) — **`EXIT_CODE=0`**. Vite build
  succeeded (17.85s); Rust release compile succeeded (`Finished
  \`release\` profile [optimized] target(s) in 1m 03s`); MSI and NSIS
  bundles produced.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  — size 24,870,912 bytes, modified 2026-08-23 23:07 local time,
  SHA256 `fb2fed061885d51e80fc736e2de02360dd20e3aad143730299f0e949563c00ab`
  (distinct from the pre-cycle build's hash
  `7100413eabfbe4398f4f40bc97f8031d0d2e8c2fcbefa8a2018f4cf513562e70`,
  confirming a fresh build from this cycle's final HEAD — even though no
  schema/logic changed this cycle, the doc-comment edit to `dataset.ts`
  still triggers a real frontend rebuild through the workspace-linked
  `@formulab/shared` dependency, and Cargo re-links the binary).
- `C:\Users\sekip\Desktop\FormuLab.lnk` verified via WScript.Shell:
  TargetPath matches the exact just-built executable path, Arguments
  empty, WorkingDirectory correct. No duplicate shortcut created; `.lnk`
  not committed.
- Native launch smoke: launched fresh via the real shortcut; resulting
  process (PID 2304) confirmed running from the exact fresh exe path and
  `Responding: True` 5 seconds after launch. **Automated launch smoke:
  PASS.** Process then deliberately stopped (see "lesson applied" above)
  rather than left running. **Manual UI acceptance from
  Desktop\FormuLab.lnk is still pending USER verification** — not
  claimed here.

### Closure-gate checklist (all satisfied)

Both `AUDIT_FVL05_GPT_000002` findings re-confirmed genuinely fixed, no
new implementation defect found; all three `AUDIT_FVL05_GPT_000003`
documentation findings corrected in place with historical state
preserved; focused FVL-05.004 tests green (80/80, unchanged); full
shared tests green (86/86 files, 1851/1851, unchanged); desktop
regression green (167/167 files, 1726/1726, unchanged); shared/desktop
typechecks green; desktop lint green; tracker validator green; `git diff
--check` clean; tracker/handoff/external log truthful and pointing to
current truth; changes committed and pushed with local HEAD == remote
HEAD; native Tauri release build (after resolving a real, diagnosed
build-lock failure) and `Desktop\FormuLab.lnk` checks rerun from the
final pushed HEAD; FVL-05.005 remains untouched; GPT audit/prompt files
untouched (read-only, respected).

**FVL-05.004 — IMPLEMENTATION AND ACCEPTANCE COMPLETE.**

**NEXT TASK — FVL-05.005 NOT STARTED** (per this session's explicit
instruction not to begin it).

## FVL-05.005 — Extractor: LaboratoryTrial + TestResult (2026-08-24)

New task. FVL-05.004 was independently GPT-audit CLOSED
(`AUDIT_FVL05_GPT_000004`, `docs/audits/FVL05-GPT-AUDIT-000004.md`)
before this task began; per that audit's own verdict and this session's
own governing prompt, FVL-05.004 was not reopened. Governing prompt:
`docs/prompts/FVL05-GPT-PROMPT-000005.md`. Both files, plus every prior
`docs/audits/FVL05-GPT*.md`/`docs/prompts/FVL05-GPT*.md` file, are
GPT-owned/READ-ONLY for Claude — read this session, not written to.
Manual session, no subagents, no Autopilot.

### Starting state

- Branch: `feature/laboratory-stability`.
- Starting local HEAD: `e36b4f88b5c6ecea61e614e6d137f2a725a41424`.
- `git fetch` found remote at `e5e6a895e2e53fde9232fdf83bf2199680e9cfc1`
  (three new commits: `6839772` — already known, `e02daf2` "docs(FVL-05):
  close FVL-05.004 after sixth corrective cycle" adding
  `docs/audits/FVL05-GPT-AUDIT-000004.md`, `e5e6a89` "docs(FVL-05): add
  GPT prompt for FVL-05.005" adding
  `docs/prompts/FVL05-GPT-PROMPT-000005.md`) — fast-forwarded cleanly
  (`git merge --ff-only`), no conflict.
- Pre-existing dirty worktree (unrelated, left untouched): same set as
  every prior cycle — modified `docs/generated/FormuLab-User-Guide.docx`/
  `.pdf`; deleted `formulas/2026-07-18-*.md` (10 files) and
  `formulas/index.json`; the same 9 untracked external-log files under
  `docs/external-logs/`. Verified unchanged via `git status --short`
  before commit.

### Source-of-truth recovery

The tracker task text is intentionally short ("Extractor: LaboratoryTrial
+ TestResult"). Recovered the exact contract directly from repository
source rather than inferring it from the title, per the governing
prompt's explicit instruction:

- `packages/shared/src/schemas/testDefinitions.ts`'s `testResultSchema`:
  `trialId: z.string().min(1)` is the ONE, direct, exact field linking a
  `TestResult` to its owning `LaboratoryTrial.id` — the only relationship
  between the two entities that exists anywhere in source. No composite
  key, no fuzzy match, nothing invented.
- `TestResult` is NOT embedded on `LaboratoryTrial` the way
  `TrialProcessStep`/`TrialObservation` are (FVL-05.004) — it is its own
  real, top-level masterdata collection, confirmed via
  `apps/desktop/src-tauri/src/masterdata.rs`: `("test_results", true)`
  (append-only) vs. `("laboratory_trials", false)` (mutable). Confirmed
  via `packages/shared/src/engine/testResults.ts`'s `reviseTestResult`:
  editing a result never mutates it in place, it creates a NEW record
  with `revisesResultId` pointing at the one being revised — a revision
  chain is multiple real, separately-identified, separately-persisted
  records.
- Because `TestResult` has its own top-level collection, `TestResult.id`
  is a genuinely GLOBAL identity — unlike `TrialProcessStep.id`/
  `TrialObservation.id`, which are embedded-array-scoped to one trial and
  required FVL-05.004's `parentRecordId` fix. This extractor's `testResult`
  lineage citations correctly never set `parentRecordId`, per the current
  FVL-05 lineage contract's own "only when true source identity is
  parent-scoped" rule.
- `TestDefinition` (method/unit/spec-limit template,
  `testDefinitionSchema`) was deliberately NOT embedded in the row: the
  task title names exactly two entities; `TestResult` already carries
  everything needed to interpret a recorded value on its own
  (`resultType`, `unit`, `instrument`, `methodSnapshot` — an immutable
  snapshot of the method actually used, captured at creation);
  `TestDefinition.targetValue`/`.minimum`/`.maximum` are PLANNED
  spec/reference values, never a measured actual, and embedding them here
  would risk the exact planned-vs-actual conflation FVL-05.004 was
  deliberate about avoiding.

### Implementation

`packages/shared/src/schemas/dataset.ts`: new `trialTestResultsSchema`
(`{ trialId, trialCode, testResults: z.array(testResultSchema) }` —
`testResultSchema` reused 100% VERBATIM, no re-modeling at all, so this
row can never silently drift from the canonical source — zero parity
risk by construction, no `PARITY`-style test needed the way FVL-05.004
needed one for its hand-split plan/actual views) and
`formulaVersionTestResultRowSchema`
(`datasetRowBaseSchema.extend({..., trials: trialTestResultsSchema[]})`)
— one row per `FormulationVersion`, same convention as FVL-05.003/.004.

**Dataset schema version bump.** Introducing this brand-new row type is a
dataset-row shape change under the standing FVL-05.001 rule ("bump when
the shape of a dataset row changes... by one of the FVL-05.003-.008
extractors"). Direct precedent: the fifth FVL-05.004 corrective cycle's
own bump (`1.0` → `1.1`) explicitly counted FVL-05.003's brand-new row
type as a shape change requiring a bump — the identical situation here.
`DATASET_SCHEMA_VERSION` bumped `"1.1"` → `"1.2"`; both superseded
literals (`"1.0"`, `"1.1"`) are now structurally rejected by every row
schema in the family. Repo-wide grep re-confirmed zero persisted rows of
any FVL-05 row family exist anywhere, so no `SchemaMigration` entry is
registered (still not applicable).

New `packages/shared/src/engine/formulaVersionTestResultDatasetExtractor.ts`
(`extractFormulaVersionTestResultRows`): resolves requested
`formulationVersionIds` against a pool
(`formula_version_not_found`/`duplicate_formula_version_id`), each
version's owning `Formulation`
(`formulation_not_found`/`duplicate_formulation_id`), every trial in the
supplied pool by exact id with the same `saved_version`-invariant and
canonical-`createdAt`-timestamp checks FVL-05.004 established
(`duplicate_trial_id`/`invalid_saved_version_trial_link`/
`invalid_timestamp_format`), and every test result in the supplied pool
pool-wide by exact id, dangling-trial-reference, and canonical
`performedAt` timestamp (`duplicate_test_result_id`/
`test_result_trial_not_found`/`invalid_timestamp_format`) —
`test_result_trial_not_found` mirrors the same "audit the whole pool up
front" discipline `formulation_not_found` already applies to
`FormulationVersion.formulationId` elsewhere in this file. A trial is
"linked" via the identical rule FVL-05.004 established
(`sourceType === "saved_version"` + exact `sourceFormulaVersionId` match,
`trial_formula_link_conflict` on a `projectId` mismatch). A result linked
to a trial that IS in the supplied pool but not linked to the REQUESTED
version is legitimately excluded, never an error — proven by a dedicated
test. Ordering: trials by `createdAt` then `id`; test results within a
trial by `performedAt` then `id` — both use a locale-independent ordinal
comparator (never `localeCompare`), matching FVL-05.004's own
`compareOrdinal` helper (duplicated here rather than factored into a
shared module, to avoid touching FVL-05.004's just-closed file at all).
Structured errors (`FormulaVersionTestResultDatasetExtractionError`) use
a truthful, correctly-named `context` object
(`formulaVersionId`/`formulationId`/`trialId`/`testResultId`) from day
one — built on FVL-05.004's own corrected error-class shape rather than
repeating its original (fixed) defect. Every constructed row is
`safeParse`d against `formulaVersionTestResultRowSchema` before being
returned. Exported via new
`export * from "./engine/formulaVersionTestResultDatasetExtractor"` line
in `packages/shared/src/index.ts`.

### Tests

`formulaVersionTestResultDatasetExtractor.test.ts` — 37 tests: zero-trial
row; one trial/one result; multiple results on one trial ordered by
`performedAt`/`id` regardless of input order; multiple trials each with
distinct results ordered by `createdAt`/`id`; exact value/unit/
instrument/passFail/timestamp/replicate/notes preservation; missing
optional fields staying absent; explicit zero/false/empty-but-valid
values surviving; a full `revisesResultId` chain preserved as two
distinct, separately-cited records (never collapsed to latest-only);
attachments preserved verbatim; no fabricated result for a trial with
zero results; a trial linked to another formula version never leaking
in; a result whose trial is linked to a DIFFERENT formula version never
leaking in; duplicate-requested version id producing two equal in-order
rows; all eleven fail-closed error codes (asserted by `code`); source
non-mutation on both success and failure paths; non-aliasing of returned
nested output; determinism; JSON round-trip with schema re-validation;
schema-level rejection of a payload missing `formulaVersionId` and of a
non-row payload; availability from the shared package's public export
path; global test-result identity proven (`parentRecordId` absent on
every `testResult` citation; two different trials' results never
collide since ids are genuinely global); delimiter-containing/Unicode
ids remaining unambiguous and deterministic under reordering;
ordinal-not-locale ordering proven on a real disagreeing pair (`"a"` vs.
`"B"`); dataset-version rejection of both superseded literals (`"1.0"`,
`"1.1"`); a referential-identity proof that the embedded `testResults`
element schema is the literal same `testResultSchema` object as the
canonical source (`trialTestResultsSchema.shape.testResults.element ===
testResultSchema`).

**Minimal, unavoidable FVL-05.004-file touches** (not a reopening of that
task's scope — required by the version bump alone):
`formulaVersionProcessDatasetExtractor.test.ts`'s `VERSION1` test had a
hardcoded `expect(DATASET_SCHEMA_VERSION).toBe("1.1")` — updated to
`.not.toBe("1.0")`/`.not.toBe("1.1")` (future-proof, symbolic, will never
need updating again on a future bump). `dataset.test.ts`'s
version-literal tests updated the same way (`"1.2"` current;
`"1.0"`/`"1.1"` both explicitly rejected).

### Fresh test/typecheck/lint/diff/tracker-validation evidence

All commands run fresh from the final corrected state on
`feature/laboratory-stability`:

- `pnpm --filter @formulab/shared exec vitest run
  src/engine/formulaVersionTestResultDatasetExtractor.test.ts` —
  **37/37 passed**.
- `pnpm --filter @formulab/shared exec vitest run` (full suite) — **87
  files / 1888 tests passed** (86 → 87 files, 1851 → 1888 tests, +37 new,
  no regression).
- `pnpm --filter @formulab/shared exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop lint` (eslint) — clean.
- `pnpm --filter @formulab/desktop exec vitest run` (full suite) — **167
  files / 1726 tests passed, no regression** (unchanged — no desktop
  source file touched).
- `python scripts/validate_v1_tracker.py` — `OK: 171 unique tasks across
  11 work packages, no drift found.` (re-run after the tracker rollup
  correction too — still clean).
- `git diff --check` (staged) — clean, no whitespace warnings.
- No `.rs` file touched — `cargo check` not applicable.
- No `runtime/pipeline` file touched — `python -m pytest
  runtime/pipeline` not applicable.

### Security / real-data-safety notes

No new I/O, persistence, or external input parsing added — the extractor
remains pure (no Tauri call, no mutation of inputs). Lineage citations
carry only ids. All tests use entirely synthetic fixtures built from new
`formulation()`/`version()`/`trial()`/`testResult()` builders modeled on
FVL-05.004's own fixture style — no real laboratory/customer/production
data touched.

### Files changed this cycle

- `packages/shared/src/schemas/dataset.ts` (`DATASET_SCHEMA_VERSION`
  bumped `"1.1"` → `"1.2"`; new `trialTestResultsSchema`/
  `formulaVersionTestResultRowSchema`; top-of-file module comment and the
  version-bump history comment both extended, not rewritten).
- `packages/shared/src/schemas/dataset.test.ts` (version-literal
  assertions updated to the new bump, made symbolic/future-proof where
  practical).
- `packages/shared/src/engine/formulaVersionTestResultDatasetExtractor.ts`
  (new file).
- `packages/shared/src/engine/formulaVersionTestResultDatasetExtractor.test.ts`
  (new file, 37 tests).
- `packages/shared/src/engine/formulaVersionProcessDatasetExtractor.test.ts`
  (one line — the `VERSION1` test's hardcoded prior-version literal made
  symbolic; minimal, unavoidable consequence of the shared version
  constant bumping again).
- `packages/shared/src/index.ts` (new barrel export line).
- `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-05.005 row — full evidence;
  also corrected the top-of-file "FVL-05 = 1/14" rollup, stale since
  FVL-05.002, to the true `5/14` — each task's own row had stayed
  current throughout, only that one summary block had drifted; did not
  touch any other work package's rollup).
- `docs/handoffs/FORMULAB_V1_CURRENT.md` (new pointer block, prepended
  above the sixth FVL-05.004 cycle's block, left intact as history).
- This log file (new task section, appended).

GPT-owned files explicitly NOT touched this cycle (read-only rule
respected): `docs/audits/FVL05-GPT Audits.md`,
`docs/audits/FVL05-GPT-AUDIT-000002.md`,
`docs/audits/FVL05-GPT-AUDIT-000003.md`,
`docs/audits/FVL05-GPT-AUDIT-000004.md`, `docs/prompts/FVL05 Prompts.md`,
`docs/prompts/FVL05-GPT-PROMPT-000003.md`,
`docs/prompts/FVL05-GPT-PROMPT-000004.md`,
`docs/prompts/FVL05-GPT-PROMPT-000005.md`.

All other pre-existing worktree modifications/deletions/untracked files
listed under "Starting state" above were left untouched.

### Commits

- `a9d271a` — this task's single commit (no amend, no force push, no
  history rewrite).

Final HEAD: `a9d271ab0c27e5078952857c6c2792d4e39d2ec9`. Verified
`git rev-parse HEAD` equals
`git rev-parse origin/feature/laboratory-stability` after push — both
`a9d271ab0c27e5078952857c6c2792d4e39d2ec9`.

### Desktop build & shortcut (final pushed HEAD)

- Checked for a stale locked `formulab.exe` process BEFORE building this
  time (lesson from the sixth FVL-05.004 cycle's own build failure) —
  none running.
- Build command: `pnpm --filter @formulab/desktop tauri build`, exit
  code confirmed explicitly via `echo "EXIT_CODE=$?"` — **`EXIT_CODE=0`**.
  MSI and NSIS bundles produced.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  — size 24,870,400 bytes, modified 2026-08-24 00:24 local time,
  SHA256 `765dd0658259f0132c3f64a18cdc07d926c365646769e5e5d62be5ec03adebb6`
  (distinct from the pre-task build's hash
  `fb2fed061885d51e80fc736e2de02360dd20e3aad143730299f0e949563c00ab`,
  confirming a fresh build from this task's final HEAD).
- `C:\Users\sekip\Desktop\FormuLab.lnk` verified via WScript.Shell:
  TargetPath matches the exact just-built executable path, Arguments
  empty, WorkingDirectory correct. No duplicate shortcut created; `.lnk`
  not committed.
- Native launch smoke: launched fresh via the real shortcut; resulting
  process (PID 20780) confirmed running from the exact fresh exe path
  and `Responding: True` 5 seconds after launch. **Automated launch
  smoke: PASS.** Process then deliberately stopped afterward so it does
  not lock the next build. **Manual UI acceptance from
  Desktop\FormuLab.lnk is still pending USER verification** — not
  claimed here.

### Closure-gate checklist (all satisfied)

Exact `LaboratoryTrial`↔`TestResult` linkage proven from source, not
invented; global vs. parent-scoped identity correctly distinguished
(no `parentRecordId` fabricated where not needed); dataset-row shape
change correctly triggered the standing version-bump rule; canonical
`testResultSchema` reused verbatim (zero parity risk); revision chains
preserved, never collapsed; planned (`TestDefinition`) vs. actual
(`TestResult`) kept separate by deliberate scope exclusion; all
pool-level and nested identity scopes fail closed; deterministic,
locale-independent ordering; source non-mutation and no output/source
aliasing; public exports correct; focused tests green (37/37); full
shared tests green (87/87 files, 1888/1888); desktop regression green
(167/167 files, 1726/1726); shared/desktop typechecks green; desktop
lint green; tracker validator green; `git diff --check` clean;
tracker/handoff/external log truthful; changes committed and pushed
with local HEAD == remote HEAD; native Tauri release build and
`Desktop\FormuLab.lnk` checks rerun from the final pushed HEAD with the
real exit code verified explicitly; FVL-05.006 remains untouched; GPT
audit/prompt files untouched (read-only, respected).

**FVL-05.005 — IMPLEMENTATION AND ACCEPTANCE COMPLETE.**

**NEXT TASK — FVL-05.006 NOT STARTED** (per this session's explicit
instruction not to begin it).

## FVL-05.005 — corrective cycle: independent GPT re-audit (AUDIT_FVL05_GPT_000005, 2026-08-24)

A second independent GPT re-audit reopened FVL-05.005. Governing
prompts: `docs/prompts/FVL05-GPT-PROMPT-000006.md` (this cycle) plus
`docs/prompts/FVL05-GPT-PROMPT-000005.md` (original task, re-read for
context). Audit: `docs/audits/FVL05-GPT-AUDIT-000005.md`. All GPT-owned/
READ-ONLY — read this session, not written to. Manual session, no
subagents, no Autopilot.

### Starting state

- Branch: `feature/laboratory-stability`.
- Starting local HEAD: `5fefe0991691327a6904a245e6b6766c3172b249`.
- `git fetch` found remote at `0eb13f89f879b8a456dedd1421f29c558c8e5a19`
  (two new commits: `a77cd0f` "docs(FVL-05): add GPT audit 000005 for
  FVL-05.005" adding `docs/audits/FVL05-GPT-AUDIT-000005.md`, `0eb13f8`
  "docs(FVL-05): add corrective prompt for FVL-05.005" adding
  `docs/prompts/FVL05-GPT-PROMPT-000006.md`) — fast-forwarded cleanly
  (`git merge --ff-only`), no conflict.
- Pre-existing dirty worktree (unrelated, left untouched): same set as
  every prior cycle. Verified unchanged via `git status --short` before
  commit.

### Finding 1 (HIGH) — referential integrity for revisesResultId/retestOf

**What was wrong.** The original extractor preserved
`TestResult.revisesResultId`/`.retestOf` verbatim (correct — these are
real predecessor/retest identity references, not free text, confirmed
via `engine/testResults.ts`'s `reviseTestResult`, which sets
`revisesResultId` to the exact predecessor `id`), but never validated
that either reference actually resolves. Zod only checked the field was
a string; a dangling, cross-trial, self-referencing, or cyclic reference
would silently pass through into a schema-valid dataset row.

**Source-of-truth recovery (per the audit's explicit "do not invent
rules" instruction).** Found `packages/shared/src/engine/resultHistory.ts`
— an EXISTING, production-used (via
`apps/desktop/src/components/formula/ResultHistoryBrowser.tsx`) engine
module that already walks these exact two relationships:

- `buildResultRevisionChain`'s own doc comment: "`results` may be any
  pool of results (e.g. every result for one test definition on ONE
  TRIAL)" — establishes the CONVENTIONAL scope of a revision chain as
  trial-scoped.
- Its cycle-detection code ("Circular revision reference detected...
  stopped walking further back") proves a cyclic `revisesResultId`
  reference is a real, anticipated malformed state in this domain — not
  a hypothetical this session invented.
- `groupRetestLineage`'s own doc comment: "An orphan retest (`retestOf`
  points at an id absent from `results`) becomes its own single-result
  lineage, with a warning rather than being silently dropped" — proves a
  dangling `retestOf` is a real, anticipated case too.
- Neither function enforces or discusses trial-scoping as a hard rule —
  they are GENERIC utilities, agnostic to trial boundaries. Agnosticism
  is not the same as endorsement: no source evidence anywhere proves
  cross-trial `revisesResultId`/`retestOf` linkage is a legitimate,
  intended relationship.

**The key judgment call.** `resultHistory.ts` resolves every one of
these anomalies with a WARNING, never a thrown exception — because its
job is graceful DISPLAY of imperfect real-world data to a human who can
see and dismiss a warning. This session did NOT copy that behavior
verbatim into the dataset extractor: a historical dataset, unlike an
interactive UI, has no mechanism to hand a downstream ML/analysis
consumer "here's a warning, judge for yourself" — an internally
inconsistent lineage reference silently baked into extracted output
would poison that consumer instead. Per the audit's own explicit
instruction ("same-trial requirement must be enforced UNLESS current
source explicitly proves cross-trial linkage is legitimate" / "detect
cycles only if acyclicity is proven"), and having found no evidence
proving either exception, the extractor now:

- requires `revisesResultId`/`retestOf` to resolve to exactly one
  `TestResult` in the supplied pool (fails closed if dangling);
- requires the referenced result to belong to the SAME `trialId`
  (fails closed if cross-trial — enforced for both fields identically,
  since no evidence was found justifying a different rule for either);
- fails closed on a direct self-reference;
- fails closed on any longer (length ≥2) reference cycle.

**Implementation.** `validateResultReference()` checks each reference's
immediate neighbor in order — self (checked FIRST: a self-reference
would otherwise trivially "resolve", since the target IS the result
itself, and would silently pass both the dangling and cross-trial
checks, masking the real problem), then dangling, then cross-trial.
`findFirstReferenceCycle()` separately walks every result's chain per
field (once every individual edge is already known to resolve, from the
prior pass) to catch longer cycles. Both run pool-wide over the ENTIRE
supplied `testResults`, matching the "audit the whole pool up front"
convention every other identity check in this extractor already
follows. Six new error codes, each carrying truthful `testResultId`/
`trialId` context (not an overloaded field):
`test_result_revision_cycle_detected`,
`dangling_test_result_revision_reference`,
`cross_trial_test_result_revision_reference`,
`test_result_retest_cycle_detected`,
`dangling_test_result_retest_reference`,
`cross_trial_test_result_retest_reference`.

Also fixed, in the same pass: a leftover orphaned doc comment from the
edit (the original "Builds the trial-id -> test-results index..."
comment ended up floating above unrelated new type declarations instead
of the function it described, after the new helpers were inserted
between them) — removed the duplicate; the function itself already has
an accurate, updated version of that same comment directly above it.

### Whole-scope regression re-audit (per the prompt's own instruction — not treating the new tests as automatic proof)

Re-read the entire extractor file end to end after the fix. Confirmed
unchanged and correct: exact `TestResult.trialId` ↔ `LaboratoryTrial.id`
linkage; `TestResult.id`'s genuinely global identity (no `parentRecordId`
fabricated); `DATASET_SCHEMA_VERSION` `"1.2"` behavior; `TestDefinition`
still deliberately not embedded (no planned-vs-actual conflation);
revision/retest history still preserved in full (never collapsed —
proven by the pre-existing "valid chain still passes" tests, re-run
green); deterministic, locale-independent ordering unchanged; no
cross-trial/cross-version leakage (pre-existing tests for this, re-run
green); every prior error path/test still passes (37/37 pre-existing
tests, now 49/49 with the 12 new ones, 0 removed or weakened).

### Tests

`formulaVersionTestResultDatasetExtractor.test.ts`: 37 → 49 tests (+12,
0 removed/weakened): valid same-trial `revisesResultId` chain still
passes and both records preserved; dangling `revisesResultId` fails
closed; cross-trial `revisesResultId` fails closed; self-revising fails
closed; a length-2 `revisesResultId` cycle fails closed; valid same-trial
`retestOf` accepted and preserved; dangling `retestOf` fails closed;
cross-trial `retestOf` fails closed; self-retesting fails closed; a
length-2 `retestOf` cycle fails closed; non-mutation of inputs on the new
failure paths; reordering the `testResults` input does not change
whether a cycle is detected.

### Fresh test/typecheck/lint/diff/tracker-validation evidence

All commands run fresh from the final corrected state on
`feature/laboratory-stability`:

- `pnpm --filter @formulab/shared exec vitest run
  src/engine/formulaVersionTestResultDatasetExtractor.test.ts` —
  **49/49 passed**.
- `pnpm --filter @formulab/shared exec vitest run` (full suite) — **87
  files / 1900 tests passed** (1888 → 1900, +12, no regression).
- `pnpm --filter @formulab/shared exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop lint` (eslint) — clean.
- `pnpm --filter @formulab/desktop exec vitest run` (full suite) — **167
  files / 1726 tests passed, no regression** (unchanged — no desktop
  source file touched).
- `python scripts/validate_v1_tracker.py` — `OK: 171 unique tasks across
  11 work packages, no drift found.`
- `git diff --check` (staged) — clean, no whitespace warnings.
- No `.rs` file touched — `cargo check` not applicable.
- No `runtime/pipeline` file touched — `python -m pytest
  runtime/pipeline` not applicable.

### Security / real-data-safety notes

No new I/O, persistence, or external input parsing added — the extractor
remains pure. All new tests use entirely synthetic fixtures built from
the existing `formulation()`/`version()`/`trial()`/`testResult()`
builders — no real laboratory/customer/production data touched.

### Files changed this cycle

- `packages/shared/src/engine/formulaVersionTestResultDatasetExtractor.ts`
  (six new error codes; `validateResultReference`/
  `findFirstReferenceCycle`/`REFERENCE_FIELD_ERROR_CODES`;
  `buildTestResultsByTrialId` restructured into three passes; header
  comment extended with the full recovered-semantics rationale; orphaned
  duplicate comment removed).
- `packages/shared/src/engine/formulaVersionTestResultDatasetExtractor.test.ts`
  (12 new tests).
- `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-05.005 row — appended this
  cycle's evidence under a "CORRECTIVE CYCLE" heading; did not remove or
  alter the original implementation's evidence).
- `docs/handoffs/FORMULAB_V1_CURRENT.md` (new pointer block, prepended
  above the original FVL-05.005 block, left intact as history).
- This log file (new corrective-cycle section, appended).

GPT-owned files explicitly NOT touched this cycle (read-only rule
respected): every `docs/audits/FVL05-GPT*.md`/`docs/prompts/FVL05*.md`
file, including the two new ones this cycle read.

All other pre-existing worktree modifications/deletions/untracked files
listed under "Starting state" above were left untouched.

### Commits

- `f983e02` — this cycle's single commit (no amend, no force push, no
  history rewrite).

Final HEAD: `f983e025328bb4f5ee615ca14c064ab049e05641`. Verified
`git rev-parse HEAD` equals
`git rev-parse origin/feature/laboratory-stability` after push — both
`f983e025328bb4f5ee615ca14c064ab049e05641`.

### Desktop build & shortcut (final pushed HEAD)

- Checked for a stale locked `formulab.exe` process BEFORE building
  (standing lesson from an earlier cycle's own build failure) — none
  running.
- Build command: `pnpm --filter @formulab/desktop tauri build`, exit
  code confirmed explicitly via `echo "EXIT_CODE=$?"` — **`EXIT_CODE=0`**.
  MSI and NSIS bundles produced.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  — size 24,870,400 bytes, modified 2026-08-24 01:54 local time,
  SHA256 `3ff8b525d3dbcdeff328dfacb4f2cf702f4d43c5b6b387f5c57074c8ff6e1993`
  (distinct from the pre-cycle build's hash
  `765dd0658259f0132c3f64a18cdc07d926c365646769e5e5d62be5ec03adebb6`,
  confirming a fresh build from this cycle's final HEAD).
- `C:\Users\sekip\Desktop\FormuLab.lnk` verified via WScript.Shell:
  TargetPath matches the exact just-built executable path, Arguments
  empty, WorkingDirectory correct. No duplicate shortcut created; `.lnk`
  not committed.
- Native launch smoke: launched fresh via the real shortcut; resulting
  process (PID 11968) confirmed running from the exact fresh exe path
  and `Responding: True` 5 seconds after launch. **Automated launch
  smoke: PASS.** Process then deliberately stopped afterward so it does
  not lock the next build. **Manual UI acceptance from
  Desktop\FormuLab.lnk is still pending USER verification** — not
  claimed here.

### Closure-gate checklist (all satisfied)

Finding 1 resolved from authoritative source semantics (not invented);
focused FVL-05.005 tests green (49/49); full shared suite green (87/87
files, 1900/1900); full desktop suite green (167/167 files, 1726/1726);
shared and desktop typechecks green; desktop lint green; tracker
validator green; `git diff --check` clean; tracker/handoff/external log
accurately describe the correction; task-owned changes committed and
pushed; local HEAD equals remote branch HEAD; native Tauri release
build + shortcut + launch smoke rerun from final pushed HEAD with the
real exit code verified explicitly; FVL-05.006 remains untouched;
whole-scope re-audit found no further defect.

**FVL-05.005 — IMPLEMENTATION AND ACCEPTANCE COMPLETE.**

**NEXT TASK — FVL-05.006 NOT STARTED** (per this session's explicit
instruction not to begin it).

## FVL-05.006 — Extractor: stability studies/results (2026-08-24)

New task. FVL-05.005 was independently GPT-audit CLOSED
(`AUDIT_FVL05_GPT_000006`, `docs/audits/FVL05-GPT-AUDIT-000006.md`)
before this task began; per that audit's own verdict and this session's
own governing prompt, FVL-05.005 was not reopened. Governing prompt:
`docs/prompts/FVL05-GPT-PROMPT-000007.md`. Both files, plus every prior
`docs/audits/FVL05-GPT*.md`/`docs/prompts/FVL05-GPT*.md` file, are
GPT-owned/READ-ONLY for Claude — read this session, not written to.
Manual session, no subagents, no Autopilot.

### Starting state

- Branch: `feature/laboratory-stability`.
- Starting local HEAD: `2b423a41011e625f2a4ec0d05fbe8563bda18275`.
- `git fetch` confirmed remote at the same
  `2b423a41011e625f2a4ec0d05fbe8563bda18275` — no new commits to
  fast-forward.
- Pre-existing dirty worktree (unrelated, left untouched): same
  recurring set as every prior cycle — modified
  `docs/generated/FormuLab-User-Guide.docx`/`.pdf`; deleted
  `formulas/2026-07-18-*.md` (10 files) and `formulas/index.json`;
  untracked external-log files under `docs/external-logs/` from other
  phases/work packages. Verified unchanged via `git status --short`
  before staging.

### Source-of-truth recovery

The tracker task text is intentionally short ("Extractor: stability
studies/results"). Recovered the exact contract directly from
`packages/shared/src/schemas/stability.ts` and
`apps/desktop/src-tauri/src/masterdata.rs`, not from the title:

- `StabilityStudy.sourceType: z.enum(["saved_version","working_draft"])`
  + `StabilityStudy.sourceFormulaVersionId?: string` — the SAME
  linkage pattern `LaboratoryTrial` uses to a formula version
  (FVL-05.004/.005), confirmed by direct field-by-field comparison. No
  other field on `StabilityStudy` references a formula version.
- `masterdata.rs` grep confirmed three independent, real, top-level
  masterdata collections: `("stability_studies", false)`,
  `("stability_samples", false)`, `("stability_results", true)`
  (append-only) — mirroring exactly how FVL-05.005 confirmed
  `("test_results", true)` was its own top-level collection distinct
  from `("laboratory_trials", false)`. No `stability_trends` entry
  exists anywhere in the file (confirmed via a dedicated grep) —
  `StabilityTrend` is purely computed by `engine/stability.ts`'s
  `computeStabilityTrend`, never persisted, so it is out of scope by
  the same "no persisted source, nothing to extract" logic that
  excluded `TestDefinition` targets in FVL-05.005. `StabilityFailure`
  is a separate incident-tracking collection (its own `studyId`/
  `sampleId`/`conditionId`/`timePointId`/`testResultId` fields point
  INTO the stability model rather than being part of it) — excluded,
  mirroring `TrialDeviation`'s exclusion from FVL-05.004's scope.
- Because all three (`StabilityStudy`/`StabilitySample`/
  `StabilityResult`) are genuinely independent top-level collections,
  every one of their ids is a GLOBAL identity — none is parent-scoped,
  so no lineage citation for any of them ever sets `parentRecordId`,
  per the current FVL-05 lineage contract's "only when true source
  identity is parent-scoped" rule (the same conclusion FVL-05.005
  reached for `TestResult.id`).
- Hierarchy confirmed by direct field inspection: `StabilitySample.
  studyId: z.string().min(1)` links a sample to its study;
  `StabilityResult.sampleId: z.string().min(1)` links a result to its
  sample. `StabilityResult` ALSO denormalizes `studyId`/`conditionId`/
  `timePointId` directly on itself (fields the sample already carries)
  — a genuine redundancy in the source schema with no precedent in
  FVL-05.004/.005's models, so this extractor treats the sample's own
  fields as authoritative and cross-validates the result's copies
  against them, failing closed on any mismatch rather than silently
  trusting one side or the other.
- Embedding-depth decision: `StabilitySample` and `StabilityResult` are
  embedded 100% VERBATIM (their fields are measurement/physical-unit
  context — storage location, packaging, replicate number, due date,
  disposal, or the actual measured value/unit/pass-fail/timestamp —
  never administrative metadata). `StabilityStudy` itself contributes
  only `studyId`/`studyCode` into the row, the identical
  administrative-metadata-only treatment `LaboratoryTrial` received in
  FVL-05.004/.005 (its `title`/`owner`/`protocol`/packaging-BOM
  snapshot etc. are study-administration fields, not measurement
  data). `StabilityCondition`/`StabilityTimePoint` reference catalogs
  are deliberately not resolved or embedded — `StabilitySample`/
  `StabilityResult` already carry their own `conditionId`/`timePointId`
  references, and resolving the catalog's own `label`/`temperatureC`
  live would risk a condition's later edit silently reinterpreting an
  already-measured historical result, the same live-vs-frozen-snapshot
  discipline this codebase already applies elsewhere (e.g.
  `formulaSnapshot`/`packagingSnapshot` capture-once fields).
- `revisesResultId` referential integrity: `StabilityResult` has an
  optional `revisesResultId: z.string()` field but, confirmed by direct
  schema inspection, NO `retestOf` field at all (unlike `TestResult`,
  which has both). The authoritative domain semantics were not
  reinvented — `engine/resultHistory.ts`'s own header comment states it
  is "shared by laboratory `TestResult` and `StabilityResult`", so the
  exact fail-closed philosophy FVL-05.005's corrective cycle
  established (recovered from that same module) applies here too. The
  natural scope analog to `TestResult`'s "same trial" is SAME SAMPLE —
  recovered from `StabilitySample`'s own schema-file comment ("one
  pull-point physical unit... tested once then disposed"), which
  establishes a sample as the terminal, non-reusable unit a stability
  result's revision history is naturally scoped to.

### Implementation

`packages/shared/src/schemas/dataset.ts`: `DATASET_SCHEMA_VERSION`
bumped `"1.2"` → `"1.3"` (brand-new row type, standing FVL-05.001 rule,
exact precedent FVL-05.005 itself set for this identical situation);
new `stabilitySampleResultsSchema` (`{ sample: stabilitySampleSchema,
results: z.array(stabilityResultSchema) }` — both reused 100%
VERBATIM, zero re-modeling, zero parity risk by construction, the same
discipline FVL-05.005 established for `testResultSchema`),
`stabilityStudySamplesSchema` (`{ studyId, studyCode, samples:
stabilitySampleResultsSchema[] }`), and `formulaVersionStabilityRowSchema`
(`datasetRowBaseSchema.extend({..., studies:
stabilityStudySamplesSchema[]})`) — one row per `FormulationVersion`,
`studies: []` when nothing is linked.

New `packages/shared/src/engine/formulaVersionStabilityDatasetExtractor.ts`
(`extractFormulaVersionStabilityRows`): resolves requested
`formulationVersionIds` against a pool
(`formula_version_not_found`/`duplicate_formula_version_id`), each
version's owning `Formulation`
(`formulation_not_found`/`duplicate_formulation_id`), every study in
the supplied pool pool-wide by exact id with the same
`saved_version`-invariant and canonical-`createdAt`-timestamp checks
FVL-05.004/.005 established (`duplicate_stability_study_id`/
`invalid_saved_version_study_link`/`invalid_timestamp_format`), every
sample pool-wide by exact id, dangling-study-reference, and canonical
`createdAt` (`duplicate_stability_sample_id`/
`stability_sample_study_not_found`/`invalid_timestamp_format`), and
every result pool-wide by exact id, dangling-sample-reference,
denormalized-field agreement with its resolved sample, and canonical
`performedAt` (`duplicate_stability_result_id`/
`stability_result_sample_not_found`/`stability_result_sample_conflict`/
`invalid_timestamp_format`). A study is "linked" via the identical rule
FVL-05.004/.005 established (`sourceType === "saved_version"` + exact
`sourceFormulaVersionId` match, `study_formula_link_conflict` on a
`projectId` mismatch). A sample/result belonging to a study that IS in
the supplied pool but not linked to the REQUESTED version is
legitimately excluded, never an error — proven by a dedicated test.
Ordering: studies by `createdAt` then `id`; samples within a study by
`createdAt` then `id`; results within a sample by `performedAt` then
`id` — all three use a locale-independent ordinal comparator (never
`localeCompare`), matching FVL-05.004/.005's own `compareOrdinal`
helper (duplicated locally rather than factored into a shared module,
to avoid touching FVL-05.005's just-closed file at all, matching the
FVL-05.005 cycle's own stated rationale for the identical choice).
`revisesResultId` validated via `validateResultRevisionReference()`
(self-check first — a self-reference would trivially "resolve" and
mask itself otherwise — then dangling, then same-sample-scope
mismatch: `stability_result_revision_cycle_detected`/
`dangling_stability_result_revision_reference`/
`cross_sample_stability_result_revision_reference`) plus
`findFirstResultRevisionCycle()` for any longer (length ≥2) cycle,
directly adapted from FVL-05.005's own
`validateResultReference()`/`findFirstReferenceCycle()` pair.
Structured errors (`FormulaVersionStabilityDatasetExtractionError`)
use a truthful, correctly-named `context` object (`formulaVersionId`/
`formulationId`/`studyId`/`sampleId`/`resultId`) from day one, built on
FVL-05.004/.005's own corrected error-class shape. Every constructed
row is `safeParse`d against `formulaVersionStabilityRowSchema` before
being returned. Exported via new `export * from
"./engine/formulaVersionStabilityDatasetExtractor"` line in
`packages/shared/src/index.ts`.

### Tests

`formulaVersionStabilityDatasetExtractor.test.ts` — 51 tests: zero-study
row; one study/one sample/one result; multiple results on one sample
ordered by `performedAt`/`id` regardless of input order; multiple
samples on one study ordered by `createdAt`/`id`; multiple studies for
one version ordered by `createdAt`/`id`; exact value/unit/status/
timestamp/method-field preservation; full sample-context field
preservation (storage location, due date, disposal status); missing
optional fields staying absent; explicit zero/false/empty-but-valid
values surviving; attachments preserved verbatim; no fabricated result
for a sample with zero results; a study linked to another formula
version never leaking in; a sample/result belonging to a study linked
to a DIFFERENT formula version never leaking in; duplicate-requested
version id producing two equal in-order rows; all fourteen fail-closed
error codes (asserted by `code`, including the three independent
`stability_result_sample_conflict` checks — studyId, conditionId,
timePointId — and a `working_draft`-with-no-link positive control);
source non-mutation on both success and failure paths; non-aliasing of
returned nested output; determinism; JSON round-trip with schema
re-validation; schema-level rejection of a payload missing
`formulaVersionId` and of a non-row payload; availability from the
shared package's public export path; global sample/result identity
proven (`parentRecordId` absent on every `stabilitySample` citation;
two different studies' samples never collide since ids are genuinely
global); delimiter-containing/Unicode ids remaining unambiguous and
deterministic under reordering; ordinal-not-locale ordering proven on a
real disagreeing pair (`"a"` vs. `"B"`); dataset-version rejection of
all three superseded literals (`"1.0"`, `"1.1"`, `"1.2"`); a
referential-identity proof that the embedded `sample`/`results` element
schemas are the literal same `stabilitySampleSchema`/
`stabilityResultSchema` objects as the canonical source; and the full
`revisesResultId` referential-integrity battery (valid same-sample
chain, dangling, cross-sample, self-reference, length-2 cycle,
non-mutation on failure, reordering-invariant cycle detection).

**Minimal, unavoidable sibling-file touches** (not a reopening of
FVL-05.004/.005's own scope — required by the version bump alone, the
same mechanical consequence FVL-05.005 itself caused for
FVL-05.004's test file): `dataset.test.ts`'s version-literal test
extended to also assert `"1.2"` is now rejected (alongside the
already-rejected `"1.0"`/`"1.1"`), and its "current" assertion updated
to `"1.3"`. `formulaVersionTestResultDatasetExtractor.test.ts`'s own
`VERSION` test extended in place to also assert `"1.2"` is rejected.

### Fresh test/typecheck/lint/diff/tracker-validation evidence

All commands run fresh from the final state on
`feature/laboratory-stability`:

- `pnpm --filter @formulab/shared exec vitest run
  src/engine/formulaVersionStabilityDatasetExtractor.test.ts` —
  **51/51 passed**.
- `pnpm --filter @formulab/shared exec vitest run
  src/engine/formulaVersionStabilityDatasetExtractor.test.ts
  src/schemas/dataset.test.ts
  src/engine/formulaVersionTestResultDatasetExtractor.test.ts
  src/engine/formulaVersionProcessDatasetExtractor.test.ts` — **180/180
  passed** (all FVL-05 dataset/extractor test files together).
- `pnpm --filter @formulab/shared exec vitest run` (full suite) — **88
  files / 1951 tests passed** (87 → 88 files, 1900 → 1951 tests, +51
  new, no regression).
- `pnpm --filter @formulab/shared exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop lint` (eslint) — clean.
- `pnpm --filter @formulab/desktop exec vitest run` (full suite) —
  **167 files / 1726 tests passed, no regression** (unchanged — no
  desktop source file touched this cycle).
- `python scripts/validate_v1_tracker.py` — `OK: 171 unique tasks
  across 11 work packages, no drift found.` (re-run after the tracker
  rollup correction too — still clean).
- `git diff --check` (staged) — clean, no whitespace warnings (only
  the same pre-existing CRLF-on-next-touch informational warnings seen
  in every prior cycle).
- No `.rs` file touched — `cargo check` not applicable.
- No `runtime/pipeline` file touched — `python -m pytest
  runtime/pipeline` not applicable.

### Security / real-data-safety notes

No new I/O, persistence, or external input parsing added — the
extractor remains pure (no Tauri call, no mutation of inputs). Lineage
citations carry only ids. All tests use entirely synthetic fixtures
built from new `formulation()`/`version()`/`study()`/`sample()`/
`result()` builders modeled on FVL-05.005's own fixture style — no real
laboratory/customer/production data touched.

### Files changed this cycle

- `packages/shared/src/schemas/dataset.ts` (`DATASET_SCHEMA_VERSION`
  bumped `"1.2"` → `"1.3"`; new `stabilitySampleResultsSchema`/
  `stabilityStudySamplesSchema`/`formulaVersionStabilityRowSchema`;
  top-of-file module comment and the version-bump history comment
  both extended, not rewritten).
- `packages/shared/src/schemas/dataset.test.ts` (version-literal
  assertions updated to the new bump).
- `packages/shared/src/engine/formulaVersionStabilityDatasetExtractor.ts`
  (new file).
- `packages/shared/src/engine/formulaVersionStabilityDatasetExtractor.test.ts`
  (new file, 51 tests).
- `packages/shared/src/engine/formulaVersionTestResultDatasetExtractor.test.ts`
  (one line — the `VERSION` test's hardcoded prior-version literal
  extended to reject `"1.2"` too; minimal, unavoidable consequence of
  the shared version constant bumping again).
- `packages/shared/src/index.ts` (new barrel export line).
- `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-05.006 row — full evidence;
  also updated the top-of-file "FVL-05 = 5/14" rollup and Total-row
  count to the true `6/14`/`95/171`).
- `docs/handoffs/FORMULAB_V1_CURRENT.md` (new pointer block, prepended
  above the FVL-05.005 corrective-cycle block, left intact as history).
- This log file (new task section, appended).

GPT-owned files explicitly NOT touched this cycle (read-only rule
respected): every prior `docs/audits/FVL05-GPT*.md`/
`docs/prompts/FVL05-GPT*.md` file, including
`docs/audits/FVL05-GPT-AUDIT-000006.md` and
`docs/prompts/FVL05-GPT-PROMPT-000007.md` (both read, neither
modified).

All other pre-existing worktree modifications/deletions/untracked files
listed under "Starting state" above were left untouched.

### Commits

- `d0ee0e4` — this task's single commit (no amend, no force push, no
  history rewrite).

Final HEAD: `d0ee0e4fcafe0ee82d40567f417ee6a2fb67dd8f`. Verified
`git rev-parse HEAD` equals
`git rev-parse origin/feature/laboratory-stability` after push — both
`d0ee0e4fcafe0ee82d40567f417ee6a2fb67dd8f`.

### Desktop build & shortcut (final pushed HEAD)

- Checked for a stale locked `formulab.exe` process BEFORE building —
  none running (`(Get-Process formulab -ErrorAction SilentlyContinue).Count`
  = 0).
- Build command: `pnpm --filter @formulab/desktop tauri build`, exit
  code confirmed explicitly — **`EXIT_CODE=0`**. MSI and NSIS bundles
  produced.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  — size 24,870,912 bytes, modified 2026-08-24 07:33:50 local time,
  SHA256 `13BC00A94512BC934F2A54C3E79EF37D1FD934BE6934482F6999168299315546`
  (distinct from the pre-task build's hash
  `3FF8B525D3DBCDEFF328DFACB4F2CF702F4D43C5B6B387F5C57074C8FF6E1993`,
  confirming a fresh build from this task's final HEAD).
- `C:\Users\sekip\Desktop\FormuLab.lnk` verified via WScript.Shell:
  TargetPath matches the exact just-built executable path, Arguments
  empty, WorkingDirectory correct. No duplicate shortcut created; `.lnk`
  not committed.
- Native launch smoke: launched fresh via the real shortcut; resulting
  process (PID 6980) confirmed running from the exact fresh exe path
  and `Responding: True` 5 seconds after launch. **Automated launch
  smoke: PASS.** Process then deliberately stopped afterward so it does
  not lock the next build. **Manual UI acceptance from
  Desktop\FormuLab.lnk is still pending USER verification** — not
  claimed here.

### Closure-gate checklist (all satisfied)

Exact `StabilityStudy`↔`StabilitySample`↔`StabilityResult` hierarchy
and formula-version linkage proven from source, not invented; global
vs. parent-scoped identity correctly distinguished (no `parentRecordId`
fabricated where not needed); denormalized result fields
cross-validated against the resolved sample; dataset-row shape change
correctly triggered the standing version-bump rule; canonical
`stabilitySampleSchema`/`stabilityResultSchema` reused verbatim (zero
parity risk); `revisesResultId` referential integrity recovered from
authoritative source (`resultHistory.ts`), not invented, scoped to
same-sample and fail-closed on dangling/cross-sample/self/cycle;
`StabilityTrend`/`StabilityFailure` correctly excluded with source
evidence; all pool-level and nested identity scopes fail closed;
deterministic, locale-independent ordering; source non-mutation and no
output/source aliasing; public exports correct; focused tests green
(51/51); full shared tests green (88/88 files, 1951/1951); desktop
regression green (167/167 files, 1726/1726); shared/desktop typechecks
green; desktop lint green; tracker validator green; `git diff --check`
clean; tracker/handoff/external log accurately describe the
implementation; task-owned changes committed and pushed with local
HEAD equal to remote HEAD; native Tauri release build,
`Desktop\FormuLab.lnk` check, and launch smoke rerun from the final
pushed HEAD with the real exit code verified explicitly; FVL-05.007
remains untouched; GPT audit/prompt files untouched (read-only,
respected).

**FVL-05.006 — IMPLEMENTATION AND ACCEPTANCE COMPLETE.**

**NEXT TASK — FVL-05.007 NOT STARTED** (per this session's explicit
instruction not to begin it).

## FVL-05.006 — corrective cycle: independent GPT re-audit (AUDIT_FVL05_GPT_000007, 2026-08-24)

A third independent GPT re-audit reopened FVL-05.006. Governing
prompts: `docs/prompts/FVL05-GPT-PROMPT-000008.md` (this cycle) plus
`docs/prompts/FVL05-GPT-PROMPT-000007.md` (original task, re-read for
context). Audit: `docs/audits/FVL05-GPT-AUDIT-000007.md`. All GPT-owned/
READ-ONLY — read this session, not written to. Manual session, no
subagents, no Autopilot.

### Starting state

- Branch: `feature/laboratory-stability`.
- Starting local HEAD: `ff37922b171058b65492856b0ae09d4cbabaea5d`.
- `git fetch` found remote at `ca95373fda48297edca0e63614394dedfbdb3774`
  (two new commits: `2cc2336` "docs(FVL-05): add GPT audit 000007 for
  FVL-05.006" adding `docs/audits/FVL05-GPT-AUDIT-000007.md`, `ca95373`
  "docs(FVL-05): add corrective prompt for FVL-05.006" adding
  `docs/prompts/FVL05-GPT-PROMPT-000008.md`) — fast-forwarded cleanly
  (`git merge --ff-only`), no conflict.
- Pre-existing dirty worktree (unrelated, left untouched): same
  recurring set as every prior cycle. Verified unchanged via
  `git status --short` before staging.

### Finding 1 (HIGH) — persisted StabilityCondition/StabilityTimePoint sources omitted

**What was wrong.** The original FVL-05.006 implementation accepted
pools for `StabilityStudy`/`StabilitySample`/`StabilityResult` only. It
preserved `sample.conditionId`/`.timePointId` as opaque strings but
never resolved or embedded the actual `StabilityCondition`/
`StabilityTimePoint` records those ids point at, never failed closed on
a dangling reference, and never cited them in lineage. The row's own
implementation/log rationale for excluding them ("reference/template
data, not part of the measurement hierarchy, same as `TestDefinition`")
was independently re-checked against current source and found to be
DIRECTLY CONTRADICTED by `stabilityConditionSchema`'s own comment in
`schemas/stability.ts`, which states a condition's `label`/tolerance
fields are "fine to read live since it does not retroactively change
what was already measured" — the opposite of a frozen, capture-once
snapshot field the original rationale implied.

**Source-of-truth recovery (per the audit's explicit "do not blindly
implement the audit wording if current source proves a materially
different contract" instruction — re-verified independently rather than
taken on faith).**

- `packages/shared/src/engine/stability.ts`'s `generateStabilitySamples(
  study, conditions, timePoints)` is the ONLY function anywhere in the
  codebase that constructs a `StabilitySample` — confirmed via a
  repo-wide grep for `newId("stabsample")`, which returned exactly one
  file/call site. It takes real `StabilityCondition[]`/
  `StabilityTimePoint[]` records as direct parameters and copies
  `condition.id`/`timePoint.id` onto the sample it creates — these are
  causal source records a sample is generated FROM, not decorative
  display-only lookups.
- Its ONLY production caller, `apps/desktop/src/components/formula/
  StabilityPanel.tsx` (line ~249-251), resolves those arrays from
  `SEED_STABILITY_CONDITIONS`/`SEED_STABILITY_TIME_POINTS`
  (`packages/shared/src/catalog/stabilityConditions.ts`).
- `apps/desktop/src-tauri/src/masterdata.rs` was grepped again and
  confirmed to register NO `stability_conditions`/`stability_time_points`
  collection anywhere — unlike `StabilityStudy`/`StabilitySample`/
  `StabilityResult`, conditions/time points are NOT their own mutable
  masterdata collection.
- `apps/desktop/src/lib/dataExchangeCommit.ts`'s `commitStabilityProtocols`
  import handler resolves an imported `condition_code`/`time_point`
  against this EXACT SAME `SEED_STABILITY_CONDITIONS`/
  `SEED_STABILITY_TIME_POINTS` catalog (rejecting anything not found in
  it) — direct, independent confirmation that this seed catalog is the
  one, single, canonical source of every condition/time-point identity
  in the system, not an arbitrary caller-suppliable pool the way
  `stabilityStudies`/`stabilitySamples`/`stabilityResults` legitimately
  are.

**Study-membership invariant — proven, not invented, per the audit's
explicit "if not proven, do not invent it" instruction.**

- `StabilityPanel.tsx`'s sample-generation call site filters
  `SEED_STABILITY_CONDITIONS`/`SEED_STABILITY_TIME_POINTS` by
  `study.conditionIds`/`study.timePointIds` BEFORE calling
  `generateStabilitySamples` — every real sample's `conditionId`/
  `timePointId` is drawn exclusively from that pre-filtered set, since
  `generateStabilitySamples` is the only sample constructor anywhere.
- `study.conditionIds`/`.timePointIds` is proven MONOTONICALLY GROWING,
  never shrinking: a repo-wide grep for every write site to these two
  fields (`grep -rn "conditionIds\s*[:=]\|timePointIds\s*[:=]"` across
  `apps/desktop/src`/`packages/shared/src`) found exactly two —
  `StabilityPanel.tsx`'s study-creation flow (sets the initial array
  once, at creation) and `dataExchangeCommit.ts`'s
  `commitStabilityProtocols` handler (`Set`-based union-only
  `conditionIds.add(...)`/`timePointIds.add(...)`, never a deletion
  anywhere). No removal code path exists.
- Therefore a condition/time-point membership true at a sample's
  generation time remains true forever after, and this extractor can
  safely fail closed on any supplied sample whose `conditionId`/
  `timePointId` is not currently a member of its own study's
  `conditionIds`/`timePointIds`.

### Corrective implementation

`packages/shared/src/schemas/dataset.ts`:

- `DATASET_SCHEMA_VERSION` bumped `"1.3"` → `"1.4"` — a "FOURTH BUMP"
  doc-comment paragraph added after the "THIRD BUMP" paragraph, under
  the same standing rule (adding required fields to an existing row
  type is the rule's own "field is added" case, no different in kind
  from a brand-new row type). Superseded `"1.3"`/`"1.2"`/`"1.1"`/`"1.0"`
  literals are now all structurally rejected.
- `stabilityStudySamplesSchema` gains `conditions:
  z.array(stabilityConditionSchema)` and `timePoints:
  z.array(stabilityTimePointSchema)` — both canonical schemas reused
  100% VERBATIM (zero re-modeling, zero parity risk, same discipline as
  `stabilitySampleSchema`/`stabilityResultSchema`). Per-study,
  deduplicated: only the condition/time-point records actually
  referenced by at least one of that study's samples, sorted by id
  (ordinal), avoiding wasteful duplication when several samples in the
  same study (the normal case — one sample per condition x time point x
  replicate) share a condition/time point. Each sample's own
  `conditionId`/`timePointId` remains the join key into these arrays.
- The header comment on `stabilitySampleResultsSchema` (the section
  documenting `StabilityCondition`/`StabilityTimePoint` exclusion) was
  corrected in place with a "CORRECTIVE CYCLE" paragraph documenting the
  contradiction and the new evidence, preserving the original (now
  superseded) rationale as clearly-marked historical narrative, not
  silently overwritten.

`packages/shared/src/engine/formulaVersionStabilityDatasetExtractor.ts`:

- New required inputs `stabilityConditions: StabilityCondition[]`/
  `stabilityTimePoints: StabilityTimePoint[]` — required pools, same
  calling convention as the other three pools. Deliberately NOT
  importing `catalog/stabilityConditions.ts` directly into the
  extractor, keeping it free of any application/UI-layer import and
  fully testable with synthetic fixtures; a production caller passes
  `SEED_STABILITY_CONDITIONS`/`SEED_STABILITY_TIME_POINTS` exactly as
  `StabilityPanel.tsx` does.
- `buildConditionsById`/`buildTimePointsById` — fail closed on a
  duplicate id (`duplicate_stability_condition_id`/
  `duplicate_stability_time_point_id`).
- `buildSamplesByStudyId` extended: every sample's `conditionId`/
  `timePointId` is resolved against the pool
  (`stability_sample_condition_not_found`/
  `stability_sample_time_point_not_found`) and cross-checked against
  its own study's `conditionIds`/`timePointIds`
  (`stability_sample_condition_not_in_study`/
  `stability_sample_time_point_not_in_study`) — the proven
  study-membership invariant above.
- `buildStudySamples` extended: computes each study's deduplicated
  `conditions`/`timePoints` arrays from the condition/time-point ids
  actually used by that study's samples, and adds `stabilityCondition`/
  `stabilityTimePoint` lineage citations. Citations are deduplicated at
  the ROW level (via `citedConditionIds`/`citedTimePointIds` `Set`s
  shared across every linked study in `extractOne`), NOT per-study —
  proven necessary because the same catalog id can legitimately be
  referenced by samples in more than one study within a single row, and
  `sourceRecordLineageSchema` structurally rejects an exact duplicate
  `(sourceEntity, sourceRecordId)` pair. Neither entity ever sets
  `parentRecordId`, since both are drawn from one single global catalog,
  not a parent-scoped collection.
- Error context gained `conditionId?`/`timePointId?` fields (truthful,
  correctly-named, same discipline as every other context field in this
  file).

### Tests

`formulaVersionStabilityDatasetExtractor.test.ts` 51 → 65 (+14, 0
removed/weakened): exact `StabilityCondition` field preservation
(temperature/tolerance, humidity/tolerance, light condition,
orientation, freeze-thaw definition, custom instructions, verification
status, active); exact `StabilityTimePoint` field preservation (code,
label, daysFromStart, custom, notes); missing condition reference fails
closed; missing time-point reference fails closed; duplicate condition
id fails closed; duplicate time-point id fails closed; a sample's
condition resolving in the pool but absent from its own study's
`conditionIds` fails closed (study-membership invariant); the same for
time points; multiple samples in one study sharing a condition/time
point remain deduplicated with no ambiguous lineage; two different
studies referencing the same condition/time point cite it exactly once
at the row level while each study's own array still lists it;
delimiter-containing/Unicode condition/time-point ids remain
unambiguous; condition/time-point pool reordering produces identical
normalized output; mutating a returned condition object never mutates
the source fixture; non-mutation of `stabilityConditions`/
`stabilityTimePoints` inputs on the new failure paths; `VERSION`
assertion extended to also reject `"1.3"`; `PARITY` assertion extended
to prove `stabilityStudySamplesSchema.shape.conditions.element ===
stabilityConditionSchema` and the time-point equivalent. Existing
`study()`/`sample()` test builders updated (`study()`'s
`conditionIds`/`timePointIds` now default to `["COND-0001"]`/
`["TP-0001"]`, matching `sample()`'s existing default `conditionId`/
`timePointId`) so every pre-existing test continues to exercise a
source-faithful fixture rather than the previously-permitted (and now
correctly rejected) empty-membership shape.

**Minimal, unavoidable sibling-file touch** (not a reopening of
FVL-05.005's own scope — required by the version bump alone):
`formulaVersionTestResultDatasetExtractor.test.ts`'s own `VERSION` test
extended in place to also assert `"1.3"` is rejected (49/49 unchanged).
`dataset.test.ts`'s version-literal test extended to assert `"1.3"` is
rejected and its "current" assertion updated to `"1.4"` (19/19
unchanged).

### Fresh test/typecheck/lint/diff/tracker-validation evidence

All commands run fresh from the final corrected state on
`feature/laboratory-stability`:

- `pnpm --filter @formulab/shared exec vitest run
  src/engine/formulaVersionStabilityDatasetExtractor.test.ts` —
  **65/65 passed**.
- `pnpm --filter @formulab/shared exec vitest run
  src/engine/formulaVersionStabilityDatasetExtractor.test.ts
  src/schemas/dataset.test.ts
  src/engine/formulaVersionTestResultDatasetExtractor.test.ts
  src/engine/formulaVersionProcessDatasetExtractor.test.ts` —
  **194/194 passed**.
- `pnpm --filter @formulab/shared exec vitest run` (full suite) — **88
  files / 1965 tests passed** (88 → 88 files, 1951 → 1965 tests, +14
  new, no regression).
- `pnpm --filter @formulab/shared exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop exec tsc --noEmit` — clean.
- `pnpm --filter @formulab/desktop lint` (eslint) — clean.
- `pnpm --filter @formulab/desktop exec vitest run` (full suite) —
  **167 files / 1726 tests passed, no regression** (unchanged — no
  desktop source file touched this cycle).
- `python scripts/validate_v1_tracker.py` — `OK: 171 unique tasks
  across 11 work packages, no drift found.` (re-run after the tracker
  row edit too — still clean).
- `git diff --check` (staged) — clean, no whitespace warnings (only
  the same pre-existing CRLF-on-next-touch informational warnings seen
  in every prior cycle).
- No `.rs` file touched — `cargo check` not applicable.
- No `runtime/pipeline` file touched — `python -m pytest
  runtime/pipeline` not applicable.

### What was independently re-verified as sound (not touched this cycle)

Per the audit's own "What was independently re-verified as sound"
section: exact formula-version → study linkage; owning-formulation
conflict handling; global identity treatment for study/sample/result;
exact sample → study and result → sample resolution; cross-validation
of result `studyId`/`conditionId`/`timePointId` against the resolved
sample; canonical chronology validation and deterministic ordering;
`StabilityResult.revisesResultId` fail-closed checks; canonical
`stabilitySampleSchema`/`stabilityResultSchema` reuse; row-level Zod
validation; non-mutation/non-aliasing strategy; `StabilityTrend`
exclusion as computed-only. None of this logic was rewritten — only the
condition/time-point resolution described above was added around it.

### Security / real-data-safety notes

No new I/O, persistence, or external input parsing added — the
extractor remains pure. All tests use entirely synthetic fixtures — no
real laboratory/customer/production data touched.

### Files changed this cycle

- `packages/shared/src/schemas/dataset.ts` (`DATASET_SCHEMA_VERSION`
  bumped `"1.3"` → `"1.4"`; `stabilityStudySamplesSchema` gains
  `conditions`/`timePoints`; corrective-cycle doc-comment corrections).
- `packages/shared/src/schemas/dataset.test.ts` (version-literal
  assertions updated to the new bump).
- `packages/shared/src/engine/formulaVersionStabilityDatasetExtractor.ts`
  (new required inputs, new resolution/validation logic, new lineage
  dedup logic, new error codes/context fields).
- `packages/shared/src/engine/formulaVersionStabilityDatasetExtractor.test.ts`
  (51 → 65 tests; `study()`/`sample()` builders and `buildInput()`
  updated for the new required pools).
- `packages/shared/src/engine/formulaVersionTestResultDatasetExtractor.test.ts`
  (one line — the `VERSION` test's hardcoded prior-version literal
  extended to reject `"1.3"` too).
- `docs/FORMULAB_V1_TASK_TRACKER.md` (FVL-05.006 row — corrective-cycle
  paragraph appended).
- `docs/handoffs/FORMULAB_V1_CURRENT.md` (new pointer block, prepended
  above the FVL-05.006 initial-completion block, left intact as
  history).
- This log file (new corrective-cycle section, appended).

GPT-owned files explicitly NOT touched this cycle (read-only rule
respected): every prior `docs/audits/FVL05-GPT*.md`/
`docs/prompts/FVL05-GPT*.md` file, including
`docs/audits/FVL05-GPT-AUDIT-000007.md` and
`docs/prompts/FVL05-GPT-PROMPT-000008.md` (both read, neither
modified).

All other pre-existing worktree modifications/deletions/untracked files
were left untouched.

### Commits

- `5dbbcb3` — this corrective cycle's single implementation commit (no
  amend, no force push, no history rewrite).

Final HEAD: `5dbbcb3365dd83eb98fbfb96d3d17535197aa024`. Verified
`git rev-parse HEAD` equals
`git rev-parse origin/feature/laboratory-stability` after push — both
`5dbbcb3365dd83eb98fbfb96d3d17535197aa024`.

### Desktop build & shortcut (final pushed HEAD)

- Checked for a stale locked `formulab.exe` process BEFORE building —
  none running.
- Build command: `pnpm --filter @formulab/desktop tauri build`, exit
  code confirmed explicitly — **`EXIT_CODE=0`**. MSI and NSIS bundles
  produced.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  — size 24,870,912 bytes, modified 2026-08-24 08:25:26 local time,
  SHA256 `CFD5AF789BC7A6756CF3F9F9C5D6C2EABF4B5F62B2D00DE868C5DC78DAEE7825`
  (distinct from the pre-cycle build's hash
  `13BC00A94512BC934F2A54C3E79EF37D1FD934BE6934482F6999168299315546`,
  confirming a fresh build from this cycle's final HEAD).
- `C:\Users\sekip\Desktop\FormuLab.lnk` verified via WScript.Shell:
  TargetPath matches the exact just-built executable path, Arguments
  empty, WorkingDirectory correct. No duplicate shortcut created; `.lnk`
  not committed.
- Native launch smoke: launched fresh via the real shortcut; resulting
  process (PID 22148) confirmed running from the exact fresh exe path
  and `Responding: True` 5 seconds after launch. **Automated launch
  smoke: PASS.** Process then deliberately stopped afterward so it does
  not lock the next build. **Manual UI acceptance from
  Desktop\FormuLab.lnk is still pending USER verification** — not
  claimed here.

### Closure-gate checklist (all satisfied)

Finding 1 resolved from authoritative source semantics (not invented —
`generateStabilitySamples`'s single call site, `SEED_STABILITY_
CONDITIONS`/`SEED_STABILITY_TIME_POINTS`, `dataExchangeCommit.ts`'s
import-path corroboration, and the proven monotonically-growing
`study.conditionIds`/`.timePointIds` invariant); persisted
`StabilityCondition`/`StabilityTimePoint` records now resolved,
embedded (deduplicated per study), and cited in lineage (deduplicated
at the row level); study-membership invariant enforced and fails
closed; canonical `stabilityConditionSchema`/`stabilityTimePointSchema`
reused verbatim (zero parity risk); dataset-row shape change correctly
triggered the standing version-bump rule (`1.3` → `1.4`); every
pool-level and nested identity scope fails closed; deterministic,
locale-independent ordering preserved; source non-mutation and no
output/source aliasing preserved; public exports correct; all
previously-sound FVL-05.006 logic (study/formula-version linkage,
sample/result resolution, `revisesResultId` integrity, canonical
sample/result reuse) left untouched and still green; focused tests
green (65/65); full shared tests green (88/88 files, 1965/1965);
desktop regression green (167/167 files, 1726/1726); shared/desktop
typechecks green; desktop lint green; tracker validator green;
`git diff --check` clean; tracker/handoff/external log truthfully
supersede the earlier unsupported exclusion rationale; task-owned
changes committed and pushed with local HEAD equal to remote HEAD;
native Tauri release build, `Desktop\FormuLab.lnk` check, and launch
smoke rerun from the final pushed HEAD with the real exit code verified
explicitly; FVL-05.007 remains untouched; GPT audit/prompt files
untouched (read-only, respected).

**FVL-05.006 — IMPLEMENTATION AND ACCEPTANCE COMPLETE.**

**NEXT TASK — FVL-05.007 NOT STARTED** (per this session's explicit
instruction not to begin it).

---

# FVL-05.007 — Extractor: DOE studies/runs/observations — Cycle Log

Continuing the SAME single FVL-05 external log file (appended, not a new
file — per this session's own explicit instruction to log both governing
documents together in one file).

## Task

**FVL-05.007** — Extractor: DOE studies/runs/observations. Depends on
FVL-05.002 (row/entity lineage model, closed). Blocking = NO.

Governing documents (both GPT-owned, READ-ONLY, read completely before
any edit, neither modified):
- `docs/audits/FVL05-GPT-AUDIT-000008.md` — independent re-audit that
  closed FVL-05.006 (`CLOSE / ACCEPT`) and cleared FVL-05.007 to begin.
- `docs/prompts/FVL05-GPT-PROMPT-000009.md` — the start prompt for this
  task.

## Branch / commit range

- Branch: `feature/laboratory-stability`.
- Starting local HEAD (before fetch/pull): `55c9e7c37e7fc154c46f9b35204d5e54b5e507a5`.
- Remote HEAD at fetch: `6f5e94a...` (2 commits ahead — the audit-000008
  and prompt-000009 doc commits). Local branch fast-forwarded via
  `git pull --ff-only`; local HEAD then equaled remote HEAD exactly.
- `git diff --check` at start: clean (pre-existing CRLF warnings only,
  same as prior cycles).

## Pre-existing worktree state (not touched)

At session start the worktree already had unrelated changes, all left
untouched by this cycle (same set carried forward from FVL-05.006's own
log entry above):
- Modified generated user-guide DOCX/PDF (`docs/generated/`).
- Deleted formula Markdown files and `formulas/index.json`.
- Untracked FVL-03/FVL-04/Build-Shortcut/Connector-Management/New-Request-
  Runtime/Phase 11-14 external logs.

Only files this cycle created/edited are listed in "Files changed" below;
nothing else was staged or committed.

## Source-of-truth recovery (before any edit)

Read, in full, before writing any code:
- `packages/shared/src/schemas/doe.ts` — full `DoeStudy`/`DoeFactor`/
  `DoeConstraint`/`DoeResponse`/`DoeDesign`/`DoeRun`/`DoeObservation`/
  `DoeAnalysis`/`DoeCandidate`/`DoeReviewAction` schemas.
- `packages/shared/src/engine/doeDesign.ts` — `createDoeStudy`,
  `reviseDoeStudy`, `generateDoeDesign` (confirmed `standardOrder =
  runNumber = standardIndex + 1`, always).
- `apps/desktop/src-tauri/src/masterdata.rs` — confirmed
  `doe_studies`/`doe_factors`/`doe_constraints`/`doe_responses`/
  `doe_designs`/`doe_runs`/`doe_observations`/`doe_candidates` are all
  `append_only: false` (mutable); `doe_analyses`/`doe_review_actions` are
  `append_only: true`.
- `apps/desktop/src/components/formula/DoePanel.tsx` — the ONE real
  production writer for every DOE record: `handleCreateStudy` (study +
  factors + constraints + responses + design + runs, all in one atomic
  wizard submission, `projectId`/`formulationId` both set to
  `formulation.id`), `recordObservation` (the only `DoeObservation`
  writer — confirmed it never sets `sourceTrialId`/`sourceTestResultId`),
  `generateTrialForRun` (sets `linkedTrialId`/`linkedFormulaVersionId`
  together), `onRevise` (calls `reviseDoeStudy` with an EMPTY changes
  object, confirming a revised study keeps its predecessor's baseline
  version), and the `studyDesign` selector (proves more than one
  `DoeDesign` can legitimately exist for one `(studyId, studyRevision)`,
  picking the most recent by `generatedAt` for DISPLAY only).
- `packages/shared/src/engine/doeExports.ts` — confirmed `status:
  obs?.status ?? "missing"` is an EXPORT/CSV display fallback, not a
  persisted-record writer.
- `docs/DOE_RESPONSES.md` and a repo-wide grep for
  `importDoeObservationsFromResults` — confirmed named in exactly two
  places (that doc and `doeResponseSchema`'s own comment) and
  implemented NOWHERE.
- `packages/shared/src/schemas/dataset.ts` (full file, including every
  prior FVL-05.002-.006 header comment) and
  `formulaVersionStabilityDatasetExtractor.ts`/`.test.ts` for the
  established fail-closed/ordering/lineage conventions this task reuses.
- `docs/FORMULAB_V1_TASK_TRACKER.md` and
  `docs/handoffs/FORMULAB_V1_CURRENT.md` current truth.

Full recovered-contract reasoning is written once, durably, in
`schemas/dataset.ts`'s own header comment on `formulaVersionDoeRowSchema`
and in the FVL-05.007 tracker row — not duplicated here.

## Design decisions (with source justification)

1. **Link to formula version**: `DoeStudy.baselineFormulaVersionId`
   directly, not the `sourceType`/`sourceFormulaVersionId` pattern —
   because DOE has no `sourceType` field at all; `baselineFormulaVersionId`
   is always required and enforced by `createDoeStudy`.
2. **Owning formulation**: `DoeStudy.formulationId`, not `projectId` —
   because `formulationId` is the more specifically-named field and the
   one real writer always sets both to the same value anyway.
3. **No separate `doe_factors`/`doe_constraints`/`doe_responses` pools**:
   `DoeDesign`'s frozen snapshots are already authoritative and are
   embedded verbatim; a second live pool would be a second,
   independently-driftable source of the same facts with no current
   writer requiring it.
4. **`DoeAnalysis`/`DoeCandidate`/`DoeReviewAction` excluded**: computed
   outputs / administrative sign-off log, not raw measurement evidence —
   directly named as out-of-scope by the governing prompt itself.
5. **Multiple study revisions linked, not just the latest**: proven from
   `reviseDoeStudy` + `DoePanel.tsx`'s empty-changes revise call.
6. **Multiple designs per study embedded, not "latest wins"**: the UI's
   own latest-by-`generatedAt` tie-break is a DISPLAY convenience, not a
   dataset-extraction contract — collapsing to it here would silently
   drop a superseded design's own real, physically-executed runs.
7. **`linkedTrialId`/`sourceTrialId`/`sourceTestResultId` preserved but
   not referentially enforced**: zero current-writer evidence any of the
   three is ever set, so enforcing them would be an invented rule, not a
   recovered one (the governing prompt's own explicit rule).
8. **`linkedFormulaVersionId` IS validated**: real joint-writer evidence,
   and the `formulationVersions` pool is already required for the row's
   own top-level resolution, so validating it costs nothing extra.
9. **Ordering**: studies by `createdAt`/`id`; designs by `generatedAt`/
   `id`; runs by `standardOrder`/`id` (the design algorithm's own
   systematic sequence, confirmed identical to `runNumber` by
   construction); observations by `recordedAt`/`id` (always present,
   unlike optional `measuredAt`).

## Files changed

- `packages/shared/src/schemas/dataset.ts` — `DATASET_SCHEMA_VERSION`
  `"1.4"` → `"1.5"`; new `doeRunObservationsSchema`/`doeDesignRunsSchema`/
  `doeStudyRunsSchema`/`formulaVersionDoeRowSchema`; new version-history
  comment entry (fifth bump).
- `packages/shared/src/schemas/dataset.test.ts` — `DATASET_SCHEMA_VERSION`
  assertion updated to `"1.5"`; superseded-version list extended with
  `"1.4"`.
- `packages/shared/src/engine/formulaVersionDoeDatasetExtractor.ts` (new)
  — `extractFormulaVersionDoeRows`.
- `packages/shared/src/engine/formulaVersionDoeDatasetExtractor.test.ts`
  (new) — 57 focused tests.
- `packages/shared/src/engine/formulaVersionTestResultDatasetExtractor.test.ts`
  and `formulaVersionStabilityDatasetExtractor.test.ts` — each `VERSION`
  test extended in place to also assert `"1.4"` is rejected (mechanical
  consequence of the version bump, same pattern every prior cycle used;
  counts unchanged: 49/49 and 65/65).
- `packages/shared/src/index.ts` — new
  `export * from "./engine/formulaVersionDoeDatasetExtractor"` line.
- `docs/FORMULAB_V1_TASK_TRACKER.md` — FVL-05.007 row marked COMPLETED;
  completion-percentage table (`FVL-05` 6→7, Total 95→96) and CURRENT
  STATE prose updated.
- `docs/handoffs/FORMULAB_V1_CURRENT.md` — new UPDATE block prepended.
- `docs/external-logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md` —
  this section.

No GPT audit/prompt file touched (ownership rule respected): every prior
`docs/audits/FVL05-GPT*.md`/`docs/prompts/FVL05-GPT*.md` file, including
`docs/audits/FVL05-GPT-AUDIT-000008.md` and
`docs/prompts/FVL05-GPT-PROMPT-000009.md` (both read, neither modified).

All other pre-existing worktree modifications/deletions/untracked files
were left untouched.

## Validation (from the final local state, before commit)

- `pnpm --filter @formulab/shared exec vitest run src/engine/formulaVersionDoeDatasetExtractor.test.ts`: **57/57**.
- Focused FVL-05 dataset/extractor group (`dataset.test.ts` +
  `formulaVersionDatasetExtractor.test.ts` +
  `formulaVersionProcessDatasetExtractor.test.ts` +
  `formulaVersionTestResultDatasetExtractor.test.ts` +
  `formulaVersionStabilityDatasetExtractor.test.ts` +
  `formulaVersionDoeDatasetExtractor.test.ts`): **280/280** (19+29+61+49+65+57).
- `pnpm --filter @formulab/shared exec vitest run` (full suite): **89
  files / 2022 tests** passed (88→89 files, 1965→2022 tests, +57 new, no
  regression).
- `pnpm --filter @formulab/shared exec tsc --noEmit`: clean.
- `pnpm --filter @formulab/desktop exec tsc --noEmit`: clean.
- `pnpm --filter @formulab/desktop lint`: clean.
- `pnpm --filter @formulab/desktop exec vitest run` (full suite): **167
  files / 1726 tests** passed, unchanged from FVL-05.006's own evidence
  (no desktop app code touched this cycle).
- `python scripts/validate_v1_tracker.py`: OK, 171 unique tasks, no drift.
- `git diff --check`: clean (pre-existing CRLF warnings only).

### Commits

- `d7fa96f` — this cycle's single implementation commit (no amend, no
  force push, no history rewrite).

Final HEAD: `d7fa96f8dd35686a0170e40aa982d0e5577b2774`. Verified
`git rev-parse HEAD` equals
`git rev-parse origin/feature/laboratory-stability` after push — both
`d7fa96f8dd35686a0170e40aa982d0e5577b2774`.

### Desktop build & shortcut (final pushed HEAD)

- Checked for a stale locked `formulab.exe` process BEFORE building —
  none running.
- Build command: `pnpm --filter @formulab/desktop tauri build`, exit
  code confirmed explicitly — **`EXIT_CODE=0`**. MSI and NSIS bundles
  produced.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  — size 24,871,424 bytes, modified 2026-08-24 10:00:31 local time,
  SHA256 `EC05CE8978DFA3427D2258CFD807A7347A2210EB59FDBFBF63E55F5292E7B0A7`
  (distinct from the pre-cycle build's hash
  `CFD5AF789BC7A6756CF3F9F9C5D6C2EABF4B5F62B2D00DE868C5DC78DAEE7825`,
  confirming a fresh build from this cycle's final HEAD).
- `C:\Users\sekip\Desktop\FormuLab.lnk` verified via WScript.Shell:
  TargetPath matches the exact just-built executable path, Arguments
  empty, WorkingDirectory correct. No duplicate shortcut created; `.lnk`
  not committed.
- Native launch smoke: launched fresh via the real shortcut; resulting
  process (PID 18988) confirmed running from the exact fresh exe path
  and `Responding: True` 5 seconds after launch. **Automated launch
  smoke: PASS.** Process then deliberately stopped afterward so it does
  not lock the next build. **Manual UI acceptance from
  Desktop\FormuLab.lnk is still pending USER verification** — not
  claimed here.

### Closure-gate checklist (all satisfied)

Source contract recovered directly from `schemas/doe.ts`/
`engine/doeDesign.ts`/`DoePanel.tsx` (not the title); `baselineFormulaVersionId`/
`formulationId` link proven, not the `sourceType` pattern; all four DOE
collections resolved and cross-validated pool-wide; frozen design
snapshot correctly used as the sole interpretive source for factor/
response meaning (no invented second live pool); `DoeAnalysis`/
`DoeCandidate`/`DoeReviewAction` correctly excluded; multiple study
revisions and multiple designs per study both fully preserved (never
collapsed to "latest wins"); `supersedesStudyId`/`supersedesDesignId`
fail-closed dangling/self/cycle checks pool-wide; `linkedFormulaVersionId`
validated against the already-required version pool while
`linkedTrialId`/`sourceTrialId`/`sourceTestResultId` are honestly
preserved-not-enforced per zero writer evidence; dataset-row shape change
correctly triggered the standing version-bump rule (`1.4` → `1.5`); every
pool-level and nested identity scope fails closed; deterministic,
locale-independent ordering; source non-mutation and no output/source
aliasing; public exports correct; focused tests green (57/57); focused
FVL-05 dataset/extractor group green (280/280); full shared tests green
(89/89 files, 2022/2022); desktop regression green (167/167 files,
1726/1726, unchanged); shared/desktop typechecks green; desktop lint
green; tracker validator green; `git diff --check` clean;
tracker/handoff/external log all truthfully current; task-owned changes
committed and pushed with local HEAD equal to remote HEAD; native Tauri
release build, `Desktop\FormuLab.lnk` check, and launch smoke rerun from
the final pushed HEAD with the real exit code verified explicitly;
FVL-05.008 remains untouched; GPT audit/prompt files untouched
(read-only, respected).

**FVL-05.007 — IMPLEMENTATION AND ACCEPTANCE COMPLETE.**

**NEXT TASK — FVL-05.008 NOT STARTED** (per this session's explicit
instruction not to begin it).

---

# FVL-05.007 corrective cycle — Cycle Log

Continuing the SAME single FVL-05 external log file (appended, not a new
file, per this session's own combined-log instruction carried forward
from the original FVL-05.007 cycle above).

## Task

**FVL-05.007 corrective cycle**, governed by:
- `docs/audits/FVL05-GPT-AUDIT-000009.md` — independent re-audit
  (`CONTINUE / REOPEN`) of implementation commit `d7fa96f`.
- `docs/prompts/FVL05-GPT-PROMPT-000010.md` — the corrective prompt.

Both GPT-owned, READ-ONLY, read completely before any edit, neither
modified. `docs/prompts/FVL05-GPT-PROMPT-000009.md` (the original
FVL-05.007 contract) also re-read per this cycle's own instruction.

## Branch / commit range

- Branch: `feature/laboratory-stability`.
- Starting local HEAD: `8032bb1f2f6d47c37dd76be60c44ad15fa124ab2`.
- Remote HEAD at fetch: `431644c...` (2 commits ahead — the
  audit-000009 and prompt-000010 doc commits). Fast-forwarded via
  `git pull --ff-only`; local HEAD then equaled remote HEAD.
- `git diff --check` at start: clean (pre-existing CRLF warnings only).

## Blocking finding (from Audit 000009)

HIGH — `DoeRun.factorSettings[].factorCode` was preserved verbatim but
never resolved against the owning `DoeDesign.factorSnapshot`; a run
could carry a `factorCode` absent from its own design and the row still
validated/emitted. The frozen `factorSnapshot`/`responseSnapshot`
themselves were never proven internally unambiguous/uncontradictory
(no check that a snapshot child's own `studyId`/`studyRevision` matched
the owning design; no duplicate-identity rejection) before being used
as an interpretive dictionary — the existing
`design.responseSnapshot.some(...)` observation check could not
distinguish "found" from "found exactly once."

## Correction applied

Independently re-read `packages/shared/src/schemas/doe.ts` and the
current `formulaVersionDoeDatasetExtractor.ts` before editing, per this
cycle's own instruction, and confirmed the finding against current
source (not blindly trusted).

- New `buildDesignSnapshotIndex(design)`: builds `factorsByCode`/
  `responsesById` for one design, failing closed if any
  `factorSnapshot`/`responseSnapshot` child's own `studyId`/
  `studyRevision` contradicts the OWNING design's
  (`doe_design_factor_snapshot_conflict`/
  `doe_design_response_snapshot_conflict`) or on a duplicate
  `factorCode`/response `id` WITHIN one design's own snapshot array
  (`duplicate_doe_design_factor_code`/`duplicate_doe_design_response_id`)
  — rejected BEFORE either dictionary is ever used to resolve anything.
- `buildDesignsByStudyId` now also returns `snapshotIndexByDesignId`,
  computed alongside the existing per-design checks.
- `buildRunsByDesignId` now resolves every `run.factorSettings[].
  factorCode` exactly against the owning design's `factorsByCode`,
  failing closed on a miss (`doe_run_factor_code_not_found`).
  `codedValue`/`actualValue` are never recomputed — only the
  `factorCode` KEY is resolved.
- `buildObservationsByRunId`'s `responseId` check now uses an exact
  `responsesById.has(...)` map lookup instead of the original
  `.some(...)` scan.
- Independently audited `DoeConstraint.appliesTo` (a `factorCode[]`
  informational list): NOT semantically required to interpret any
  emitted run/observation value — constraints gate design GENERATION
  only, never persisted run/observation interpretation. No check added,
  per the audit's own explicit "do not add checks merely because
  fields exist" instruction.
- No live `doe_factors`/`doe_responses`/`doe_constraints` pool
  introduced — frozen design snapshots remain the sole historical
  authority, per the audit's explicit instruction.
- `DATASET_SCHEMA_VERSION` NOT bumped (stays `"1.5"`): this correction
  is validation-only — no field was added/removed/renamed on the
  emitted row shape (`DoeDesign`/`DoeRun`/`DoeObservation` are still
  embedded 100% verbatim, unchanged) — per the audit's own explicit
  instruction not to bump unless the emitted schema actually changes.

## Latent test-fixture defect found and fixed (not the extractor)

Re-running the pre-existing 57 tests against the corrected
implementation surfaced ONE failure: "no observation from another
run/study/revision leaks into a row" overrode `design.studyId` to
`"STUDY-A"`/`"STUDY-B"` without also overriding the default
`factorSnapshot`/`responseSnapshot` fixtures' hardcoded `studyId:
"STUDY-0001"` — a genuine latent fixture inconsistency the new stricter
check correctly caught (exactly the class of defect this corrective
cycle exists to catch). Fixed by giving each overridden-`studyId`
design its own matching `factorSnapshot`/`responseSnapshot` fixtures —
the check itself was not loosened or removed.

## Files changed

- `packages/shared/src/engine/formulaVersionDoeDatasetExtractor.ts` —
  `buildDesignSnapshotIndex` (new), `buildDesignsByStudyId` (returns
  `snapshotIndexByDesignId`), `buildRunsByDesignId` (factorCode
  resolution), `buildObservationsByRunId` (exact responseId lookup),
  five new error codes + `factorCode` error-context field, updated
  header doc comment (corrective-cycle note).
- `packages/shared/src/engine/formulaVersionDoeDatasetExtractor.test.ts`
  — one pre-existing fixture fixed (see above); 11 new focused
  adversarial tests (57 → 68).
- `docs/FORMULAB_V1_TASK_TRACKER.md` — FVL-05.007 row's own
  "CORRECTIVE CYCLE" paragraph appended.
- `docs/handoffs/FORMULAB_V1_CURRENT.md` — new UPDATE block prepended.
- `docs/external-logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md`
  — this section.

No GPT audit/prompt file touched (ownership rule respected). All other
pre-existing worktree modifications/deletions/untracked files left
untouched.

## Validation (from the final local state, before commit)

- `pnpm --filter @formulab/shared exec vitest run src/engine/formulaVersionDoeDatasetExtractor.test.ts`: **68/68**.
- `pnpm --filter @formulab/shared exec vitest run` (full suite): **89
  files / 2033 tests** passed (2022 → 2033 tests, +11 new, no
  regression).
- `pnpm --filter @formulab/shared exec tsc --noEmit`: clean.
- `pnpm --filter @formulab/desktop exec tsc --noEmit`: clean.
- `pnpm --filter @formulab/desktop lint`: clean.
- `pnpm --filter @formulab/desktop exec vitest run` (full suite): **167
  files / 1726 tests** passed, unchanged (no desktop app code touched
  this cycle).
- `python scripts/validate_v1_tracker.py`: OK, 171 unique tasks, no
  drift.
- `git diff --check`: clean (pre-existing CRLF warnings only).

### Commits

- `82f49e0` — this corrective cycle's single implementation commit (no
  amend, no force push, no history rewrite).

Final HEAD: `82f49e08ea83aaa4e5c214e1a2f12082af1336a7`. Verified
`git rev-parse HEAD` equals
`git rev-parse origin/feature/laboratory-stability` after push — both
`82f49e08ea83aaa4e5c214e1a2f12082af1336a7`.

### Desktop build & shortcut (final pushed HEAD)

- Checked for a stale locked `formulab.exe` process BEFORE building —
  none running.
- Build command: `pnpm --filter @formulab/desktop tauri build`, exit
  code confirmed explicitly — **`EXIT_CODE=0`**. MSI and NSIS bundles
  produced.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  — size 24,871,424 bytes, modified 2026-08-24 10:31:02 local time,
  SHA256 `140B8B6B01730A5C5A93E37192F2708BC07A6EA01155639CB95043FB38032038`
  (distinct from the pre-cycle build's hash
  `EC05CE8978DFA3427D2258CFD807A7347A2210EB59FDBFBF63E55F5292E7B0A7`,
  confirming a fresh build from this cycle's final HEAD).
- `C:\Users\sekip\Desktop\FormuLab.lnk` verified via WScript.Shell:
  TargetPath matches the exact just-built executable path, Arguments
  empty, WorkingDirectory correct. No duplicate shortcut created; `.lnk`
  not committed.
- Native launch smoke: launched fresh via the real shortcut; resulting
  process (PID 19056) confirmed running from the exact fresh exe path
  and `Responding: True` 5 seconds after launch. **Automated launch
  smoke: PASS.** Process then deliberately stopped afterward so it does
  not lock the next build. **Manual UI acceptance from
  Desktop\FormuLab.lnk is still pending USER verification** — not
  claimed here.

### Closure-gate checklist (all satisfied)

Blocking finding resolved from authoritative source semantics (not
invented): frozen `factorSnapshot`/`responseSnapshot` proven internally
unambiguous/uncontradictory before use (`buildDesignSnapshotIndex`);
every `run.factorSettings[].factorCode` resolved exactly against the
owning design; observation `responseId` resolution switched to an exact
map lookup; `codedValue`/`actualValue` never recomputed;
`DoeConstraint.appliesTo` independently audited and correctly left
unchecked (not semantically required); no live `doe_factors`/
`doe_responses`/`doe_constraints` pool introduced; validation-only
correction correctly left `DATASET_SCHEMA_VERSION` at `"1.5"` (no row
shape change); one latent test-fixture defect found and fixed, not
papered over; every portion Audit 000009 listed as independently sound
left untouched and still green; focused tests green (68/68); full
shared tests green (89/89 files, 2033/2033); desktop regression green
(167/167 files, 1726/1726, unchanged); shared/desktop typechecks green;
desktop lint green; tracker validator green; `git diff --check` clean;
tracker/handoff/external log truthfully supersede the prior completion
claim; task-owned changes committed and pushed with local HEAD equal to
remote HEAD; native Tauri release build, `Desktop\FormuLab.lnk` check,
and launch smoke rerun from the final pushed HEAD with the real exit
code verified explicitly; FVL-05.008 remains untouched; GPT audit/
prompt files untouched (read-only, respected).

**FVL-05.007 — IMPLEMENTATION AND ACCEPTANCE COMPLETE.**

**NEXT TASK — FVL-05.008 NOT STARTED** (per this session's explicit
instruction not to begin it).

---

# FVL-05.008 — Extractor: corrective actions + cost snapshots +
packaging/context — Cycle Log

Continuing the SAME single FVL-05 external log file (appended, not a new
file, per this session's own combined-log instruction carried forward).

## Task

**FVL-05.008** — Extractor: corrective actions when relevant, cost
snapshots, packaging/context, environmental/test conditions. Depends on
FVL-05.002 (row/entity lineage model, closed). Blocking = NO.

Governing documents (both GPT-owned, READ-ONLY, read completely before
any edit, neither modified):
- `docs/audits/FVL05-GPT-AUDIT-000010.md` — independent closure re-audit
  that closed FVL-05.007 (`CLOSE / ACCEPT`) and cleared FVL-05.008 to
  begin.
- `docs/prompts/FVL05-GPT-PROMPT-000011.md` — the start prompt for this
  task, explicit that "SOURCE RECOVERY IS THE MAIN WORK OF THIS TASK."

## Branch / commit range

- Branch: `feature/laboratory-stability`.
- Starting local HEAD: `e151b634284759a5ac043e2a9dda11a2d395d005`.
- Remote HEAD at fetch: `a516ed4...` (2 commits ahead — the
  audit-000010 and prompt-000011 doc commits). Fast-forwarded via
  `git pull --ff-only`; local HEAD then equaled remote HEAD.
- `git diff --check` at start: clean (pre-existing CRLF warnings only).

## Source recovery (before any code was written)

Read, in full:
- `packages/shared/src/schemas/dataset.ts` (all six prior FVL-05.002-.007
  sections, for established conventions).
- `packages/shared/src/schemas/correctiveActions.ts` — found
  `correctiveActionSchema`, a real top-level mutable collection whose
  own comment defines `sourceRecordId` as "the trial or stability study
  id this action belongs to," unconditional on `sourceType`.
- `packages/shared/src/schemas/costing.ts` — found `costSnapshotSchema`
  (immutable, direct `formulationId`/`versionId` link, `code`-keyed, no
  `id`) alongside `PackagingComponent`/`PackagingBom`/
  `FactoryCostProfile`/`ExchangeRate` (all confirmed CURRENT mutable
  catalog/reference data, not historical snapshots).
- `packages/shared/src/engine/correctiveActions.ts` — `createCorrectiveAction`
  and the full lifecycle (`markInProgress`/`markAwaitingVerification`/
  `verifyEffectiveness`/`reopenCorrectiveAction`/`cancelCorrectiveAction`).
- `apps/desktop/src-tauri/src/masterdata.rs` — confirmed
  `corrective_actions` (`append_only: false`), `cost_snapshots`
  (`append_only: true`), `packaging_components`/`packaging_boms`
  (`append_only: false`, current catalog), `exchange_rates`
  (`append_only: true`, but a general FX table, not itself
  experiment-specific evidence).
- `apps/desktop/src/components/formula/TrialsPanel.tsx` — the ONE real
  writer for `sourceType: "trial_deviation"`, confirmed
  `sourceRecordId: selectedTrial.id`, `projectId: formulation.id`.
- `apps/desktop/src/components/formula/StabilityPanel.tsx` — the ONE
  real writer for `sourceType: "stability_failure"`, confirmed
  `sourceRecordId: selectedStudy.id`, `projectId: formulation.id`.
- A repo-wide grep for `sourceType: "trial_failure"` and
  `sourceType: "manual"` inside `createCorrectiveAction(` call
  arguments — ZERO matches. Neither has any current writer evidence.
- `packages/shared/src/schemas/laboratory.ts` — confirmed
  `LaboratoryTrial.projectId` is documented as `Formulation.id`, and
  `targetPackagingSkuIds` is a mutable id array, not a frozen snapshot.
- `packages/shared/src/schemas/stability.ts` — confirmed
  `StabilityStudy.packagingSnapshot` (`packagingSystemSnapshotSchema`)
  is the one frozen, capture-once packaging record in the repository,
  and that FVL-05.006 deliberately did not embed it (id/code-only
  treatment of `StabilityStudy`).
- `packages/shared/src/schemas/doe.ts` — confirmed `DoeStudy` carries no
  packaging field at all.
- `docs/FORMULAB_V1_TASK_TRACKER.md` and
  `docs/handoffs/FORMULAB_V1_CURRENT.md` current truth.

## Critical source-semantics answers (per the governing prompt's own
required questions)

1. Corrective-action identity scope: `CorrectiveAction.id` is genuinely
   global (own top-level collection). It links to a `LaboratoryTrial`
   or `StabilityStudy` via `sourceRecordId`, unconditional on
   `sourceType`; only two of the four enum values have real writer
   evidence, so the SAME resolution rule was applied uniformly rather
   than inventing a different one per label.
2. A true historical cost snapshot exists: `CostSnapshot`
   (`append_only: true`), distinct from mutable
   `PackagingComponent`/`PackagingBom`/`FactoryCostProfile`/
   `ExchangeRate`, which are current/mutable and were NOT embedded.
3. Packaging/context: only `StabilityStudy.packagingSnapshot` is frozen
   experiment-specific context; `packaging_components`/`packaging_boms`
   are current catalog and excluded.
4. Environmental/test-condition fields: already fully carried by
   `TestResult` (FVL-05.005), `StabilityCondition`/`StabilityTimePoint`
   (FVL-05.006), and `DoeDesign.factorSnapshot`/`.responseSnapshot`
   (FVL-05.007) — confirmed nothing genuinely missing, so nothing new
   was added under this heading.
5. No duplicate measured evidence: packaging context is the ONLY new
   contribution under a category FVL-05.006 already partially covers,
   and it is exactly the ONE field FVL-05.006 explicitly did not embed
   — verified by reading `stabilityStudySamplesSchema`'s own field list.
6. Optional-relationship honesty: a corrective action's `sourceRecordId`
   either resolves (attached to the row when its trial/study links to
   the requested version) or fails closed pool-wide as unresolvable
   (`corrective_action_source_record_not_found`) — never silently
   treated as "no record."

## Design decisions

- `CorrectiveAction`/`CostSnapshot` embedded 100% verbatim (the whole
  record IS the historical evidence); `LaboratoryTrial`/`StabilityStudy`
  supplied only as resolution pools, never embedded (out of title
  scope), but still cited in lineage when they resolve an included
  action.
- `deviationOrFailureId` preserved verbatim, not referentially
  validated — `TrialDeviation`/`StabilityFailure` are out of scope for
  this whole FVL-05 family (established by FVL-05.004/.006), and
  pooling either just to validate one optional field would be scope
  creep, mirroring FVL-05.007's `sourceTrialId`/`sourceTestResultId`
  precedent.
- `DATASET_SCHEMA_VERSION` bumped `"1.5"` → `"1.6"` (brand-new row type,
  sixth consecutive bump under the standing rule).

## Bug found and fixed during test authoring (not a documentation gap)

Writing the adversarial tests for "multiple corrective actions resolving
the same trial" and "a study contributing both a corrective action AND
packaging context" immediately surfaced a real defect: the initial
implementation pushed a `laboratoryTrial`/`stabilityStudy` lineage
citation on EVERY resolved action and EVERY packaging-context entry
independently, producing an exact-duplicate `(sourceEntity,
sourceRecordId)` pair whenever the same trial/study was referenced more
than once — `sourceRecordLineageSchema` correctly rejected it
(`row_schema_validation_failed`). Fixed with a `citedTrialIds`/
`citedStudyIds` `Set` shared across the whole row, the same dedup
discipline FVL-05.006 established for shared condition/time-point
citations — each trial/study is now cited exactly once per row
regardless of how many actions/packaging entries reference it.

## Files changed

- `packages/shared/src/schemas/dataset.ts` — `DATASET_SCHEMA_VERSION`
  `"1.5"` → `"1.6"`; new `stabilityStudyPackagingContextSchema`/
  `formulaVersionCorrectiveCostContextRowSchema`; new version-history
  comment entry (sixth bump).
- `packages/shared/src/schemas/dataset.test.ts` — `DATASET_SCHEMA_VERSION`
  assertion updated to `"1.6"`; superseded-version list extended with
  `"1.5"`.
- `packages/shared/src/engine/formulaVersionCorrectiveCostContextDatasetExtractor.ts`
  (new) — `extractFormulaVersionCorrectiveCostContextRows`.
- `packages/shared/src/engine/formulaVersionCorrectiveCostContextDatasetExtractor.test.ts`
  (new) — 44 focused tests.
- `packages/shared/src/engine/formulaVersionStabilityDatasetExtractor.test.ts`
  and `formulaVersionDoeDatasetExtractor.test.ts` — each `VERSION` test
  extended in place to also assert `"1.5"` is rejected (mechanical
  consequence of the version bump; counts unchanged: 65/65 and 68/68).
- `packages/shared/src/index.ts` — new
  `export * from "./engine/formulaVersionCorrectiveCostContextDatasetExtractor"`
  line.
- `docs/FORMULAB_V1_TASK_TRACKER.md` — FVL-05.008 row marked COMPLETED;
  completion-percentage table (`FVL-05` 7→8, Total 96→97) and CURRENT
  STATE prose updated.
- `docs/handoffs/FORMULAB_V1_CURRENT.md` — new UPDATE block prepended.
- `docs/external-logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md`
  — this section.

No GPT audit/prompt file touched (ownership rule respected). All other
pre-existing worktree modifications/deletions/untracked files left
untouched.

## Validation (from the final local state, before commit)

- `pnpm --filter @formulab/shared exec vitest run src/engine/formulaVersionCorrectiveCostContextDatasetExtractor.test.ts`: **44/44**.
- `pnpm --filter @formulab/shared exec vitest run` (full suite): **90
  files / 2077 tests** passed (2033 → 2077 tests, +44 new, no
  regression).
- `pnpm --filter @formulab/shared exec tsc --noEmit`: clean.
- `pnpm --filter @formulab/desktop exec tsc --noEmit`: clean.
- `pnpm --filter @formulab/desktop lint`: clean.
- `pnpm --filter @formulab/desktop exec vitest run` (full suite): **167
  files / 1726 tests** passed, unchanged (no desktop app code touched
  this cycle).
- `python scripts/validate_v1_tracker.py`: OK, 171 unique tasks, no
  drift.
- `git diff --check`: clean (pre-existing CRLF warnings only).

### Commits

- `b1c52ba` — this task's single implementation commit (no amend, no
  force push, no history rewrite).

Final HEAD: `b1c52ba692bb91d171c1640e5471c41294826561`. Verified
`git rev-parse HEAD` equals
`git rev-parse origin/feature/laboratory-stability` after push — both
`b1c52ba692bb91d171c1640e5471c41294826561`.

### Desktop build & shortcut (final pushed HEAD)

- Checked for a stale locked `formulab.exe` process BEFORE building —
  none running.
- Build command: `pnpm --filter @formulab/desktop tauri build`, exit
  code confirmed explicitly — **`EXIT_CODE=0`**. MSI and NSIS bundles
  produced.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  — size 24,871,424 bytes, modified 2026-08-24 10:56:28 local time,
  SHA256 `EF5B2C9D696A2EEA50E9F98CBA44748166E1F296B4EF12A4C05F1CF9E9C90328`
  (distinct from the pre-cycle build's hash
  `140B8B6B01730A5C5A93E37192F2708BC07A6EA01155639CB95043FB38032038`,
  confirming a fresh build from this cycle's final HEAD).
- `C:\Users\sekip\Desktop\FormuLab.lnk` verified via WScript.Shell:
  TargetPath matches the exact just-built executable path, Arguments
  empty, WorkingDirectory correct. No duplicate shortcut created; `.lnk`
  not committed.
- Native launch smoke: launched fresh via the real shortcut; resulting
  process (PID 20060) confirmed running from the exact fresh exe path
  and `Responding: True` 5 seconds after launch. **Automated launch
  smoke: PASS.** Process then deliberately stopped afterward so it does
  not lock the next build. **Manual UI acceptance from
  Desktop\FormuLab.lnk is still pending USER verification** — not
  claimed here.

### Closure-gate checklist (all satisfied)

Source recovery genuinely drove the payload (not the tracker title):
`CorrectiveAction`'s two-hop trial/study resolution proven from its own
schema comment and the two real writers; `CostSnapshot`'s direct
`formulationId`/`versionId` link and `code`-only identity confirmed;
`StabilityStudy.packagingSnapshot` confirmed the ONE genuinely
historical packaging record and correctly not duplicated from
FVL-05.006; environmental/test conditions correctly left untouched
(already fully represented); `TrialDeviation`/`StabilityFailure`/
current mutable packaging catalog correctly excluded; lineage
deduplication bug found during test authoring and fixed, not papered
over; dataset-row shape change correctly triggered the standing
version-bump rule (`1.5` → `1.6`); every pool-level and per-version
identity/reference check fails closed; deterministic, locale-independent
ordering; source non-mutation and no output/source aliasing; public
exports correct; focused tests green (44/44); full shared tests green
(90/90 files, 2077/2077); desktop regression green (167/167 files,
1726/1726, unchanged); shared/desktop typechecks green; desktop lint
green; tracker validator green; `git diff --check` clean;
tracker/handoff/external log all truthfully current; task-owned changes
committed and pushed with local HEAD equal to remote HEAD; native Tauri
release build, `Desktop\FormuLab.lnk` check, and launch smoke rerun from
the final pushed HEAD with the real exit code verified explicitly;
FVL-05.009 remains untouched; GPT audit/prompt files untouched
(read-only, respected).

**FVL-05.008 — IMPLEMENTATION AND ACCEPTANCE COMPLETE.**

**NEXT TASK — FVL-05.009 NOT STARTED** (per this session's explicit
instruction not to begin it).

---

# FVL-05.008 corrective cycle — Cycle Log

Continuing the SAME single FVL-05 external log file (appended, not a new
file, per this session's own combined-log instruction carried forward).

## Task

**FVL-05.008 corrective cycle**, governed by:
- `docs/audits/FVL05-GPT-AUDIT-000011.md` — independent re-audit
  (`CONTINUE / REOPEN`) of implementation commit `b1c52ba`.
- `docs/prompts/FVL05-GPT-PROMPT-000012.md` — the corrective prompt.

Both GPT-owned, READ-ONLY, read completely before any edit, neither
modified. `docs/audits/FVL05-GPT-AUDIT-000010.md` and
`docs/prompts/FVL05-GPT-PROMPT-000011.md` also re-read per this cycle's
own instruction.

## Branch / commit range

- Branch: `feature/laboratory-stability`.
- Starting local HEAD: `daf357bbfed3ad91121bdca8fa85d4a70dd499fb`.
- Remote HEAD at fetch: `437f4e9...` (2 commits ahead — the
  audit-000011 and prompt-000012 doc commits). Fast-forwarded via
  `git pull --ff-only`; local HEAD then equaled remote HEAD.
- `git diff --check` at start: clean (pre-existing CRLF warnings only).

## Blocking finding (from Audit 000011)

HIGH — `buildActionResolutions()` resolved `CorrectiveAction.
sourceRecordId` by checking `laboratoryTrials` first and immediately
accepting a match, only checking `stabilityStudies` if no trial matched.
`LaboratoryTrial.id`/`StabilityStudy.id` are opaque global identifiers
in two separate top-level collections with no cross-collection
uniqueness guarantee anywhere in the FVL-05 contract — a supplied
dataset could legitimately contain a trial and a study sharing the exact
same id, and the original code would silently prefer the trial branch
purely because it was checked first — order-of-lookup precedence, not
an exact, unambiguous resolution.

## Correction applied

Independently re-read `packages/shared/src/schemas/correctiveActions.ts`
and the current `formulaVersionCorrectiveCostContextDatasetExtractor.ts`
before editing, per this cycle's own instruction, and confirmed the
finding against current source.

- `buildActionResolutions()` now looks up BOTH `trialsById`/`studiesById`
  for every action's `sourceRecordId` BEFORE choosing a target.
- If both resolve: fails closed with a new
  `corrective_action_source_record_ambiguous` error, truthful
  `actionId` context.
- If exactly one resolves: unchanged behavior.
- If neither resolves: unchanged `corrective_action_source_record_not_found`
  behavior.
- `sourceType` deliberately NOT introduced as a tie-breaker: the
  original FVL-05.008 source recovery already concluded
  `sourceRecordId` resolution is unconditional on `sourceType` (no
  writer evidence ties a specific `sourceType` value to exactly one
  target namespace); this cycle found no new evidence disproving that,
  and using it to silently pick a branch on a real collision would be
  exactly the "paper over the ambiguity" the governing audit forbade.
- `DATASET_SCHEMA_VERSION` NOT bumped (stays `"1.6"`): validation/
  relationship logic only — no field was added/removed/renamed on the
  emitted row shape — per the audit's own explicit instruction.

## Files changed

- `packages/shared/src/engine/formulaVersionCorrectiveCostContextDatasetExtractor.ts`
  — `buildActionResolutions` (both-pools check before choosing,
  ambiguity fail-closed), new `corrective_action_source_record_ambiguous`
  error code, updated header + function doc comments (corrective-cycle
  notes).
- `packages/shared/src/engine/formulaVersionCorrectiveCostContextDatasetExtractor.test.ts`
  — 6 new focused adversarial tests (44 → 50); no existing test
  weakened or removed.
- `docs/FORMULAB_V1_TASK_TRACKER.md` — FVL-05.008 row's own "CORRECTIVE
  CYCLE" paragraph appended.
- `docs/handoffs/FORMULAB_V1_CURRENT.md` — new UPDATE block prepended.
- `docs/external-logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md`
  — this section.

No GPT audit/prompt file touched (ownership rule respected). All other
pre-existing worktree modifications/deletions/untracked files left
untouched.

## Validation (from the final local state, before commit)

- `pnpm --filter @formulab/shared exec vitest run src/engine/formulaVersionCorrectiveCostContextDatasetExtractor.test.ts`: **50/50**.
- `pnpm --filter @formulab/shared exec vitest run` (full suite): **90
  files / 2083 tests** passed (2077 → 2083 tests, +6 new, no
  regression).
- `pnpm --filter @formulab/shared exec tsc --noEmit`: clean.
- `pnpm --filter @formulab/desktop exec tsc --noEmit`: clean.
- `pnpm --filter @formulab/desktop lint`: clean.
- `pnpm --filter @formulab/desktop exec vitest run` (full suite): **167
  files / 1726 tests** passed, unchanged (no desktop app code touched
  this cycle).
- `python scripts/validate_v1_tracker.py`: OK, 171 unique tasks, no
  drift.
- `git diff --check`: clean (pre-existing CRLF warnings only).

### Commits

- `1941d9c` — this corrective cycle's single implementation commit (no
  amend, no force push, no history rewrite).

Final HEAD: `1941d9cf8dde70db7ad2d988d0013116785ad444`. Verified
`git rev-parse HEAD` equals
`git rev-parse origin/feature/laboratory-stability` after push — both
`1941d9cf8dde70db7ad2d988d0013116785ad444`.

### Desktop build & shortcut (final pushed HEAD)

- Checked for a stale locked `formulab.exe` process BEFORE building —
  none running.
- Build command: `pnpm --filter @formulab/desktop tauri build`, exit
  code confirmed explicitly — **`EXIT_CODE=0`**. MSI and NSIS bundles
  produced.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  — size 24,871,424 bytes, modified 2026-08-24 11:17:13 local time,
  SHA256 `AEAFCD5678BE0ED1948A540A16AEA9FEB53852ED6BCF5B783EF132E0429FCF20`
  (distinct from the pre-cycle build's hash
  `EF5B2C9D696A2EEA50E9F98CBA44748166E1F296B4EF12A4C05F1CF9E9C90328`,
  confirming a fresh build from this cycle's final HEAD).
- `C:\Users\sekip\Desktop\FormuLab.lnk` verified via WScript.Shell:
  TargetPath matches the exact just-built executable path, Arguments
  empty, WorkingDirectory correct. No duplicate shortcut created; `.lnk`
  not committed.
- Native launch smoke: launched fresh via the real shortcut; resulting
  process (PID 10368) confirmed running from the exact fresh exe path
  and `Responding: True` 5 seconds after launch. **Automated launch
  smoke: PASS.** Process then deliberately stopped afterward so it does
  not lock the next build. **Manual UI acceptance from
  Desktop\FormuLab.lnk is still pending USER verification** — not
  claimed here.

### Closure-gate checklist (all satisfied)

Blocking finding resolved from authoritative source semantics (not
invented): `LaboratoryTrial.id`/`StabilityStudy.id` proven to have no
cross-collection uniqueness guarantee; both pools now checked before
choosing a resolution target; a genuine collision fails closed
(`corrective_action_source_record_ambiguous`) rather than silently
preferring the trial branch; `sourceType` correctly NOT introduced as a
tie-breaker (no writer evidence supports it); validation-only correction
correctly left `DATASET_SCHEMA_VERSION` at `"1.6"` (no row shape
change); every portion Audit 000011 listed as independently sound left
untouched and still green; focused tests green (50/50); full shared
tests green (90/90 files, 2083/2083); desktop regression green
(167/167 files, 1726/1726, unchanged); shared/desktop typechecks green;
desktop lint green; tracker validator green; `git diff --check` clean;
tracker/handoff/external log truthfully supersede the prior completion
claim; task-owned changes committed and pushed with local HEAD equal to
remote HEAD; native Tauri release build, `Desktop\FormuLab.lnk` check,
and launch smoke rerun from the final pushed HEAD with the real exit
code verified explicitly; FVL-05.009 remains untouched; GPT audit/
prompt files untouched (read-only, respected).

**FVL-05.008 — IMPLEMENTATION AND ACCEPTANCE COMPLETE.**

**NEXT TASK — FVL-05.009 NOT STARTED** (per this session's explicit
instruction not to begin it).

---

# FVL-05.009 — Extractor: normalization (units, categorical, numeric) —
Task Log

Continuing the SAME single FVL-05 external log file (appended, not a new
file, per the standing combined-log instruction carried forward from
every prior FVL-05 task).

## Task

**FVL-05.009** — Normalization: units, categorical, numeric — missing
values stay missing, no missing-to-zero unless mathematically/
domain-explicitly valid. Depends on FVL-05.003-008 (all closed). Blocking
= YES.

Governing documents (both GPT-owned, READ-ONLY, read completely before
any edit, neither modified):
- `docs/audits/FVL05-GPT-AUDIT-000012.md` — independent re-audit that
  closed FVL-05.008 (`CLOSE / ACCEPT`) and cleared FVL-05.009 to begin.
- `docs/prompts/FVL05-GPT-PROMPT-000013.md` — the start prompt for this
  task, explicit that "SOURCE RECOVERY IS THE MAIN WORK OF THIS TASK."

## Branch / commit range

- Branch: `feature/laboratory-stability`.
- Starting local HEAD: `961c3151d1f30715bbe786cbae1983bfee2250c6`.
- Remote HEAD at fetch: same — already up to date (`git pull --ff-only`
  reported "Already up to date").
- `git diff --check` at start: clean (pre-existing CRLF warnings only;
  unrelated pre-existing dirty worktree state — formula file deletions,
  generated doc regeneration, several new external-log files from other
  work — left untouched throughout this task, per the governing prompt's
  own "do not touch unrelated dirty files" instruction).

## Source recovery (before any code was written)

Read, in full: `packages/shared/src/schemas/dataset.ts` (all six prior
FVL-05.002-.008 sections), `engine/decimal.ts`, `engine/unitConversion.ts`
(the one existing generic mass/volume conversion authority —
`convertUnit`/`unitDimension`, reused verbatim, not reimplemented),
`schemas/formulation.ts`, `schemas/materials.ts`, `schemas/primitives.ts`,
`schemas/testDefinitions.ts`, `schemas/laboratory.ts`, `schemas/stability.ts`,
`schemas/doe.ts`, `schemas/costing.ts`, `schemas/dataExchange.ts`,
`schemas/product.ts`, and the `formulaVersionDoeDatasetExtractor.ts`
extractor (for its `buildDesignSnapshotIndex` pattern, reused
independently since it is not exported). Also read the current
`docs/FORMULAB_V1_TASK_TRACKER.md` FVL-05.009/.010/.011 rows and
`docs/FORMULAB_V1_FINAL_SCOPE.md`'s FVL-05/FVL-07 entries — the latter
confirmed FVL-07 ("Predictive Performance Engine") consumes FVL-05's
output as predictors against FVL-06's performance results, which is the
concrete evidence behind this task's own target-leakage exclusions below.

## Critical source-semantics answers (per the governing prompt's own
mandatory questions)

1. Tracker wording/boundary: "Normalization: units, categorical, numeric
   — missing values stay missing, no missing-to-zero unless
   mathematically/domain-explicitly valid." `Depends on` names ALL SIX
   prior extractors — this normalizes across the full existing dataset-row
   surface, not one hand-picked family.
2. Output grain: one `FormulaVersionFeatureRow` per `FormulationVersion`,
   the same convention every FVL-05.003-.008 row already uses.
3. Row-family inputs: all six (`compositionRows` required per version — a
   version always has one; the other five each independently optional,
   matching the established "empty when none" convention). None excluded
   at the family level; specific WITHIN-family fields are excluded — see
   Q6/Q10 below.
4. Field disposition: a repository-wide, field-by-field audit of all six
   row families found exactly ONE recurring ambiguity worth normalizing —
   a decimal value paired with a free-text unit string. Every other field
   (categorical enums, identifiers, provenance, administrative metadata)
   already flows through the six existing rows unchanged; this task adds
   nothing that duplicates or forks any of their field lists.
5. Existing deterministic unit conversions: exactly one,
   `engine/unitConversion.ts`'s `convertUnit`/`unitDimension` (mass
   mg/g/kg, volume mL/L). No rate-conversion authority exists anywhere
   (see Q6).
6. Missing/excluded/invalid/outlier/textual/zero/boolean/repeated
   representation: `normalizeQuantity(undefined, ...)` returns `undefined`
   — no entry is ever emitted for an absent source value (missing stays
   missing). An explicit `"0"` is a real, `normalized: true` entry (proven
   by a dedicated test) — never conflated with absence. An unrecognized or
   absent unit is preserved raw (`normalized: false`) rather than guessed.
   Repeated replicate values are each their own entry, disambiguated by
   `detail` (the replicate number) since they share one `TestResult`/
   `StabilityResult` citation.
7. Scaling: NOT part of this task's contract. A repository-wide check for
   a persisted, fitted-statistic contract (a stored min/max or mean/stddev
   meant to be replayed against future data) found none anywhere in this
   package. Inventing one with no source authority, no persistence model,
   and no leakage/reproducibility design proven anywhere would be exactly
   the unproven normalization the governing rule forbids.
8. `FEATURE_SCHEMA_VERSION` change: NOT bumped, stays `"1.0"` — this is
   the FIRST feature-vector shape ever defined. Direct precedent:
   `DATASET_SCHEMA_VERSION` was NOT bumped when FVL-05.002 defined the
   first dataset row shape either; only a LATER change to an
   ALREADY-SHIPPED shape (FVL-05.004's fifth corrective cycle) ever
   bumped it.
9. Provenance: every `normalizedQuantitySchema` entry carries its own
   `sourceRecords` citation (record-level, `detail` sub-disambiguating
   where a citation legitimately repeats); the feature row's own
   `sourceRecords` is the deduplicated union of every contributing input
   row's own lineage.
10. Target-leakage prevention: every normalized `path` resolves to a
    genuinely REALIZED/measured field. `DoeFactor.lowValue`/`.centerValue`/
    `.highValue` and `DoeResponse.targetValue`/`.lowerLimit`/`.upperLimit`
    (planned/spec/objective values) are deliberately excluded — a
    dedicated test proves it. This task also does not designate ANY
    normalized value as "the" target variable for anything — that stays
    FVL-05.010's own explicit job.

## Deliberately excluded value+unit-shaped fields (found, not overlooked)

- `FormulationLine.unitPrice`/`.priceUnit` (and every `*PerUnit` cost
  field in `costing.ts`): a price-per-unit is a RATE, not a simple
  quantity — canonicalizing it needs a DIVIDE where a plain quantity
  conversion MULTIPLIES. `convertUnit` has no rate-safe inverse and none
  is invented here. Left raw, unconverted.
- `DoeFactor.lowValue`/`.centerValue`/`.highValue`,
  `DoeResponse.targetValue`/`.lowerLimit`/`.upperLimit`,
  `TestDefinition.targetValue`/`.minimum`/`.maximum`: planned/spec/
  objective values — see Q10 above.
- `DataExchange.processParameterSchema` (`plannedProcedure`): every
  temperature/mixing-speed/duration field is fixed-unit-by-name with no
  companion unit field — nothing to resolve.
- `RawMaterial.viscosityMin`/`.viscosityMax`/`.phMin`/`.phMax`/`.hlb`,
  `TrialProcessStep.actualPh`, every `*Percent` field: unitless or
  already-percentage by domain convention, no companion unit field.
- `StabilitySample.fillQuantity`: no companion unit anywhere in its own
  row family; resolving one would require a brand-new resolution pool
  outside this task's "normalize what FVL-05.003-.008 already extracted"
  scope.
- `TrialMaterialUsage.actualWeight`/`.weightUnit`: not embedded by ANY
  existing FVL-05.003-.008 row — FVL-05.004's own header comment already
  established material usage was never in scope.

## Design decisions

`normalizeQuantity()` is the one new deterministic primitive this task
adds — pure, reused everywhere a value+unit pair was found, never
duplicated per family. It reuses `convertUnit`'s existing float-based
conversion characteristics as-is (an inherited constraint of the reused
authority, not a new risk this task introduces) and formats the result
through `engine/decimal.ts`'s existing `PRECISION.quantity` (4 dp) — no
second, parallel rounding rule invented. The DOE factor/response unit
resolution independently re-derives `formulaVersionDoeDatasetExtractor.ts`'s
own `buildDesignSnapshotIndex` duplicate-safety check (that function is
not exported, and this extractor's own contract cannot blindly trust a
caller-supplied `doeRow` that need not have come through that extractor).
`formulaVersionFeatureRowSchema` deliberately does NOT re-embed any of the
six input rows' own fields (avoiding the "copy a field list into a
parallel schema" risk six times over) — a feature consumer joins this
row's `normalizedQuantities` with the six existing dataset rows by
`formulaVersionId` for full categorical/raw-field context.

## Files changed

- `packages/shared/src/schemas/dataset.ts` — new FVL-05.009 section:
  `NORMALIZED_QUANTITY_SOURCE_PATHS`, `NORMALIZED_QUANTITY_CANONICAL_UNITS`,
  `normalizedQuantitySchema`, `featureRowBaseSchema`,
  `formulaVersionFeatureRowSchema`; added `decimalString` import from
  `./primitives` (previously unused in this file).
- `packages/shared/src/engine/formulaVersionFeatureExtractor.ts` — new:
  `normalizeQuantity`, `extractFormulaVersionFeatureRows`,
  `FormulaVersionFeatureExtractionError`.
- `packages/shared/src/engine/formulaVersionFeatureExtractor.test.ts` —
  new: 39 focused adversarial tests.
- `packages/shared/src/index.ts` — added
  `export * from "./engine/formulaVersionFeatureExtractor"`.
- `docs/FORMULAB_V1_TASK_TRACKER.md` — FVL-05.009 row completed; the
  top-of-file rollup table/prose counts corrected `8/14`→`9/14`,
  `97/171`→`98/171` (same "each task's own row stayed current, only the
  rollup lagged" pattern the FVL-05.005 session already documented for an
  earlier instance of this same drift).
- `docs/handoffs/FORMULAB_V1_CURRENT.md` — new UPDATE block prepended.
- `docs/external-logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md` —
  this section.

No GPT audit/prompt file touched (ownership rule respected). All other
pre-existing worktree modifications/deletions/untracked files left
untouched.

## Validation (from the final local state, before commit)

- `pnpm --filter @formulab/shared exec vitest run src/engine/formulaVersionFeatureExtractor.test.ts`: **39/39**.
- `pnpm --filter @formulab/shared exec vitest run` (full suite): **91
  files / 2122 tests** passed (90→91 files, 2083→2122 tests, +39 new, no
  regression).
- `pnpm --filter @formulab/shared exec tsc --noEmit`: clean.
- `pnpm --filter @formulab/desktop exec tsc --noEmit`: clean.
- `pnpm --filter @formulab/desktop lint`: clean.
- `pnpm --filter @formulab/desktop exec vitest run` (full suite): **167
  files / 1726 tests** passed, unchanged (no desktop app code touched
  this task).
- `python scripts/validate_v1_tracker.py`: OK, 171 unique tasks, no
  drift.
- `git diff --check`: clean (pre-existing CRLF warnings only).

### Commits

- `3153799` — this task's single implementation commit (no amend, no
  force push, no history rewrite).

Final HEAD: `31537998893ec9cddab3b6db3111d604568b2532`. Verified
`git rev-parse HEAD` equals
`git rev-parse origin/feature/laboratory-stability` after push — both
`31537998893ec9cddab3b6db3111d604568b2532`.

### Desktop build & shortcut (final pushed HEAD)

- Checked for a stale locked `formulab.exe` process BEFORE building —
  none running.
- Build command: `pnpm --filter @formulab/desktop tauri build`, exit
  code confirmed explicitly — **`EXIT_CODE=0`**. MSI and NSIS bundles
  produced.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  — size 24,871,424 bytes, modified 2026-08-27 10:00:30 local time,
  SHA256 `5E601B5662E7EED61E608D9F931497D7866E189F18B5C171DB5B8C58AFD89FA6`
  (distinct from the prior FVL-05.008 cycle's build hash
  `AEAFCD5678BE0ED1948A540A16AEA9FEB53852ED6BCF5B783EF132E0429FCF20`,
  confirming a fresh build from this cycle's final HEAD).
- `C:\Users\sekip\Desktop\FormuLab.lnk` verified via WScript.Shell:
  TargetPath matches the exact just-built executable path, Arguments
  empty, WorkingDirectory correct. No duplicate shortcut created; `.lnk`
  not committed.
- Native launch smoke: launched fresh via the real shortcut; resulting
  process (PID 8356) confirmed running from the exact fresh exe path and
  `Responding: True` 5 seconds after launch. **Automated launch smoke:
  PASS.** Process then deliberately stopped afterward so it does not lock
  the next build. **Manual UI acceptance from Desktop\FormuLab.lnk is
  still pending USER verification** — not claimed here.

### Closure-gate checklist (all satisfied)

Source recovery genuinely drove the payload (not the tracker title): the
tracker's own `Depends on` column proves this normalizes across all six
FVL-05.003-.008 families, not one hand-picked one; exactly one recurring
normalizable ambiguity (value+unit pairs) was found via a field-by-field
audit and reused the one existing conversion authority
(`convertUnit`/`unitDimension`) rather than inventing a new one; every
excluded field has a concrete, source-grounded disqualifying reason
(rate fields, planned/spec/objective fields, fixed-unit-by-name fields,
unresolvable fields); target-variable leakage is structurally prevented,
not merely asserted, and proven by a dedicated test; missing-stays-missing
and zero-vs-missing are both proven by dedicated tests;
`FEATURE_SCHEMA_VERSION`/`DATASET_SCHEMA_VERSION` both correctly left
unbumped, each with direct precedent cited; DOE factor/response unit
resolution independently fails closed on ambiguity rather than trusting
a caller-supplied row; row-level lineage dedup and per-value lineage
citation both proven; input non-mutation and no output/source aliasing
proven; public export proven; focused tests green (39/39); full shared
tests green (91/91 files, 2122/2122); desktop regression green (167/167
files, 1726/1726, unchanged); shared/desktop typechecks green; desktop
lint green; tracker validator green (rollup counts corrected); `git diff
--check` clean; tracker/handoff/external log all truthfully current;
task-owned changes committed and pushed with local HEAD equal to remote
HEAD; native Tauri release build, `Desktop\FormuLab.lnk` check, and
launch smoke run from the final pushed HEAD with the real exit code
verified explicitly; FVL-05.010 remains untouched; GPT audit/prompt files
untouched (read-only, respected).

**FVL-05.009 — IMPLEMENTATION AND ACCEPTANCE COMPLETE.**

**NEXT TASK — FVL-05.010 NOT STARTED** (per this session's explicit
instruction not to begin it).

---

# FVL-05.009 corrective cycle — Cycle Log

Continuing the SAME single FVL-05 external log file (appended, not a new
file, per the standing combined-log instruction carried forward from
every prior FVL-05 task).

## Task

**FVL-05.009 corrective cycle**, governed by:
- `project-control/gpt/audits/FVL05-GPT-AUDIT-000013.md` — independent
  re-audit (`CONTINUE / REOPEN`) of implementation commit `3153799`
  (folded into the migration-renumbered commit range; original hash
  `31537998893ec9cddab3b6db3111d604568b2532`).
- `project-control/gpt/prompts/FVL05-GPT-PROMPT-000014.md` — the
  corrective prompt.

Both GPT-owned, READ-ONLY, read completely before any edit, neither
modified.

## Branch / commit range

- Branch: `feature/laboratory-stability`.
- Starting local HEAD: `bb402347b198640e5a0e5fc87728456fc652d440`.
- Remote HEAD at fetch: same — already up to date (`git pull --ff-only`
  reported a fast-forward with only the audit-000013/prompt-000014 doc
  commits, `fb01779..bb40234`, landing before this cycle started work).
- `git diff --check` at start: clean (pre-existing CRLF warnings only;
  unrelated pre-existing dirty worktree state — formula file deletions,
  generated doc regeneration — left untouched throughout, per this
  session's own standing instruction).

## Blocking finding (from Audit 000013)

`buildDoeUnitIndex()` in `formulaVersionFeatureExtractor.ts` validated
only duplicate `factorSnapshot[].factorCode`/`responseSnapshot[].id`. It
never verified a frozen snapshot child's own `studyId`/`studyRevision`
agreed with the OWNING `DoeDesign`'s before trusting it as unit authority
for normalizing `DoeRun.factorSettings[].actualValue`/
`DoeObservation.value`. Because FVL-05.009 explicitly accepts a
caller-supplied `FormulaVersionDoeRow` and does not assume it came
through the FVL-05.007 extractor, a malformed input could smuggle a
factor/response belonging to a DIFFERENT study revision into unit
resolution, silently crossing frozen historical contexts instead of
failing closed. The two codes this needed
(`doe_design_factor_snapshot_conflict`/
`doe_design_response_snapshot_conflict`) were already declared in
`FormulaVersionFeatureExtractionErrorCode` but never thrown anywhere —
confirmed by direct source inspection before writing any fix (`grep` for
both codes returned only their declaration lines).

## Correction applied

Independently re-read `formulaVersionDoeDatasetExtractor.ts`'s
`buildDesignSnapshotIndex` (the FVL-05.007 precedent this cycle must
match) before editing, per the governing prompt's own instruction.

- `buildDoeUnitIndex()`: for every `factorSnapshot` child, `factor.
  studyId`/`factor.studyRevision` are now checked against `design.
  studyId`/`design.studyRevision` BEFORE the duplicate-`factorCode`
  check — failing closed with `doe_design_factor_snapshot_conflict` on a
  mismatch. The identical treatment applies to `responseSnapshot`
  children against `duplicate_doe_design_response_id`, failing closed
  with `doe_design_response_snapshot_conflict`. Ordering (contradiction
  check first, duplicate check second) exactly matches
  `buildDesignSnapshotIndex`'s own ordering — not an independently
  invented sequence.
- `codedValue`/`actualValue`/`DoeObservation.value` are never recomputed
  — only the snapshot children's identity fields are validated before
  their `unit` is read; the persisted run/observation values pass
  through exactly as before.
- No live DOE factor/response pool was introduced as a fallback — the
  frozen `factorSnapshot`/`responseSnapshot` remain the sole authority,
  per the audit's own explicit instruction not to weaken FVL-05.007
  semantics.
- `FEATURE_SCHEMA_VERSION`/`DATASET_SCHEMA_VERSION` NOT bumped (stay
  `"1.0"`/`"1.6"`): validation-only, no row/feature-vector shape field
  was added/removed/renamed — per the audit's own explicit instruction.

## Independent re-audit finding (beyond Audit 000013's own named scope)

Per the governing prompt's own "independently re-audit the whole
FVL-05.009 DOE normalization path against FVL-05.007's frozen-snapshot
semantics. Do not stop at making tests green" instruction — not a
literal restatement of Audit 000013's own finding, but the identical
class of defect, found by applying the same scrutiny one level up:
`collectDoeEntries()` called `buildDoeUnitIndex(designEntry.design)`
using the design's OWN claimed `studyId`/`studyRevision` as the trust
anchor, but never cross-checked that against the STUDY WRAPPER
(`doeStudyRunsSchema`) the design is nested under in the row itself.
`formulaVersionDoeDatasetExtractor.ts`'s own `buildDesignsByStudyId`
already enforces this exact check (`doe_design_study_conflict`) when it
resolves a design against a live `doeStudies`/`doeDesigns` pool — this
extractor needed the equivalent check against the row's own nested
structure, since it resolves no pools itself. Fixed with a new
`doe_design_study_conflict` error code (added to
`FormulaVersionFeatureExtractionErrorCode`, plus a new `studyId` context
field on the error class/context interface, following the same "truthful,
correctly-named structured context" discipline every field there already
uses) and a check in `collectDoeEntries()` run BEFORE `buildDoeUnitIndex()`
is ever called for that design. Disclosed here explicitly, separate from
Audit 000013's own words, so the corrective-cycle boundary between
"what GPT found" and "what this session additionally found during its
own required re-audit" stays honest and traceable.

## Files changed

- `packages/shared/src/engine/formulaVersionFeatureExtractor.ts` —
  `buildDoeUnitIndex` (studyId/studyRevision cross-checks before the
  duplicate checks, both directions), `collectDoeEntries` (new
  design-vs-study-wrapper cross-check), new `doe_design_study_conflict`
  error code + `studyId` error-context field, updated header/function doc
  comments (corrective-cycle notes).
- `packages/shared/src/engine/formulaVersionFeatureExtractor.test.ts` —
  7 new focused adversarial tests (39 → 46); no existing test weakened or
  removed.
- `docs/FORMULAB_V1_TASK_TRACKER.md` — FVL-05.009 row's own "CORRECTIVE
  CYCLE" paragraph appended.
- `project-control/claude/handoffs/FORMULAB_V1_CURRENT.md` — new UPDATE
  block prepended.
- `project-control/claude/logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md`
  — this section.

No GPT audit/prompt file touched (ownership rule respected). `.hiveai/
PROJECT_DASHBOARD.md` not touched — no path it declares was broken by
this corrective task. All other pre-existing worktree
modifications/deletions/untracked files left untouched.

## Validation (from the final local state, before commit)

- `pnpm --filter @formulab/shared exec vitest run src/engine/formulaVersionFeatureExtractor.test.ts`: **46/46**.
- `pnpm --filter @formulab/shared exec vitest run src/engine/formulaVersionDoeDatasetExtractor.test.ts`: **68/68**, unchanged (FVL-05.007 extractor itself untouched).
- `pnpm --filter @formulab/shared exec vitest run` (full suite): **91
  files / 2129 tests** passed (2122 → 2129 tests, +7 new, no regression).
- `pnpm --filter @formulab/shared exec tsc --noEmit`: clean.
- `pnpm --filter @formulab/desktop exec tsc --noEmit`: clean.
- `pnpm --filter @formulab/desktop lint`: clean.
- `pnpm --filter @formulab/desktop exec vitest run` (full suite): **167
  files / 1726 tests** passed, unchanged (no desktop app code touched
  this cycle).
- `python scripts/validate_v1_tracker.py`: OK, 171 unique tasks, no
  drift.
- `git diff --check`: clean (pre-existing CRLF warnings only).

### Commits

- `7459fc0` — this corrective cycle's single implementation commit (no
  amend, no force push, no history rewrite).

Final HEAD: `7459fc0dffdc4cde134390d1e8235a2c48ddc42b`. Verified
`git rev-parse HEAD` equals
`git rev-parse origin/feature/laboratory-stability` after push — both
`7459fc0dffdc4cde134390d1e8235a2c48ddc42b`.

### Desktop build & shortcut (final pushed HEAD)

- Checked for a stale locked `formulab.exe` process BEFORE building —
  none running.
- Build command: `pnpm --filter @formulab/desktop tauri build`, exit
  code confirmed explicitly — **`EXIT_CODE=0`**. MSI and NSIS bundles
  produced.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  — size 24,871,424 bytes, modified 2026-08-27 14:44:28 local time,
  SHA256 `AF535794FEF84ACF39AF5853AB87A61760A5ECDC943D97582CAEF8DF00AC3ED9`
  (distinct from the pre-cycle build's hash
  `5E601B5662E7EED61E608D9F931497D7866E189F18B5C171DB5B8C58AFD89FA6`,
  confirming a fresh build from this cycle's final HEAD).
- `C:\Users\sekip\Desktop\FormuLab.lnk` verified via WScript.Shell:
  TargetPath matches the exact just-built executable path, Arguments
  empty, WorkingDirectory correct. No duplicate shortcut created; `.lnk`
  not committed.
- Native launch smoke: launched fresh via the real shortcut; resulting
  process (PID 14660) confirmed running from the exact fresh exe path and
  `Responding: True` 5 seconds after launch. **Automated launch smoke:
  PASS.** Process then deliberately stopped afterward so it does not lock
  the next build. **Manual UI acceptance from Desktop\FormuLab.lnk is
  still pending USER verification** — not claimed here.

### Closure-gate checklist (all satisfied)

Blocking finding resolved from direct source inspection (not the cycle
log): `buildDoeUnitIndex()` proven to have skipped the studyId/
studyRevision cross-check both prior corrective cycles in this repository
(FVL-05.006, FVL-05.007) already established as mandatory for a frozen
snapshot dictionary; both already-declared error codes now genuinely
thrown, in the same order as the FVL-05.007 precedent; an independently
found second instance of the identical gap (design vs. its own study
wrapper) was also closed rather than merely disclosed; validation-only
correction correctly left `FEATURE_SCHEMA_VERSION`/`DATASET_SCHEMA_
VERSION` unchanged; no live DOE pool introduced as fallback; persisted
run/observation values never recomputed; every portion Audit 000013
listed as independently sound left untouched and still green; focused
tests green (46/46); FVL-05.007 DOE extractor tests green (68/68,
unchanged); full shared tests green (91/91 files, 2129/2129); desktop
regression green (167/167 files, 1726/1726, unchanged); shared/desktop
typechecks green; desktop lint green; tracker validator green; `git diff
--check` clean; tracker/handoff/external log truthfully supersede the
prior completion claim; `.hiveai/PROJECT_DASHBOARD.md` correctly left
untouched (no path it declares was broken by this corrective task);
task-owned changes committed and pushed with local HEAD equal to remote
HEAD; native Tauri release build, `Desktop\FormuLab.lnk` check, and
launch smoke rerun from the final pushed HEAD with the real exit code
verified explicitly; FVL-05.010 remains untouched; GPT audit/prompt files
untouched (read-only, respected).

**FVL-05.009 CORRECTIVE IMPLEMENTATION COMPLETE — PENDING GPT AUDIT.**

**NEXT TASK — FVL-05.010 NOT STARTED** (per this session's explicit
instruction not to begin it).

---

# FVL-05.010 — Extractor: exact target-variable definitions (per product
family / measured response) — Task Log

Continuing the SAME single FVL-05 external log file (appended, not a new
file, per the standing combined-log instruction carried forward).

## Task

**FVL-05.010** — Exact target-variable definitions (per product family /
measured response). Depends on FVL-05.009 (closed). Blocking = YES.

Governing documents (both GPT-owned, READ-ONLY, read completely before
any edit, neither modified):
- `project-control/gpt/audits/FVL05-GPT-AUDIT-000014.md` — independent
  re-audit that closed FVL-05.009 (`CLOSE / ACCEPT`) and cleared
  FVL-05.010 to begin.
- `project-control/gpt/prompts/FVL05-GPT-PROMPT-000015.md` — the start
  prompt for this task, explicit that "SOURCE RECOVERY IS THE MAIN WORK
  OF THIS TASK."

## Branch / commit range

- Branch: `feature/laboratory-stability`.
- Starting local HEAD: `f665ad2f556714a1de184103d9cf7826bb42d116`.
- Remote HEAD at fetch: same — already up to date (`git pull --ff-only`
  reported a fast-forward landing only the audit-000014/prompt-000015
  doc commits before this session began work).
- `git diff --check` at start: clean (pre-existing CRLF warnings only;
  unrelated pre-existing dirty worktree state left untouched throughout).

## Source recovery (before any code was written)

Read, in full: `packages/shared/src/schemas/dataset.ts` (all prior
FVL-05.002-.009 sections), `engine/formulaVersionFeatureExtractor.ts`
and its tests, `schemas/testDefinitions.ts`, `schemas/laboratory.ts`,
`schemas/stability.ts`, `schemas/doe.ts`, `schemas/formulation.ts`,
`schemas/product.ts`, `docs/FORMULAB_V1_FINAL_SCOPE.md`'s FVL-05/FVL-06/
FVL-07 entries, and `apps/desktop/src/lib/formulations.ts`/a repo-wide
search for every `productFamilyCode` mutation call site.

## Mandatory source questions (answered, per the governing prompt's own
requirement, before any schema/extractor code was written)

1. Canonical product-family source: `Formulation.productFamilyCode` — no
   competing candidate exists; `LaboratoryTrial`/`StabilityStudy` carry a
   DIFFERENT field (`productFamilyId`), not a copy of this one.
2. Mutability: a repo-wide search found exactly one writer,
   `newFormulation()` (`apps/desktop/src/lib/formulations.ts`), setting
   it once at creation; no edit/update call site was found anywhere.
   FVL-05.003 already relies on this same conclusion (`FormulaVersionCompositionRow.
   productFamilyCode` is "always present on a Formulation," copied
   verbatim) — this task reuses THAT already-extracted, already-trusted
   value rather than re-resolving `Formulation` a second time.
3. Measured-response source families: exactly three —
   `TestResult`/`StabilityResult`/`DoeObservation`. `CorrectiveAction`/
   `CostSnapshot` independently checked and found to carry no
   measured-response-shaped field (a problem/resolution narrative and a
   computed financial figure, respectively — not product-performance
   measurements).
4. `TestResult` usable evidence: `resultType` is the domain's own
   authority for which OTHER field holds the value — `"numeric"`/
   `"visual_rating"` -> `replicates[].numericValue`/`stats.*`; `"text"`
   -> `textValue`; `"categorical"` -> `categoricalValue`; `"boolean"` ->
   `booleanValue`; `"pass_fail"` -> `passFail`, ONLY `"pass"`/`"fail"`
   (never `"not_evaluated"`, the absence of a judgment). No dedicated
   `"visual_rating"` field exists anywhere in the codebase (confirmed by
   grep) — `numericValue` is structurally the only field capable of
   holding it, not an assumption about its meaning.
5. `StabilityResult` usable evidence: identical `resultType`/field
   disposition to `TestResult` (same enum, same field set). Condition/
   time-point ARE part of target IDENTITY (a measurement at 40°C/3mo is a
   different target than 25°C/1mo), never a predictor dimension —
   `StabilityResult` carries `conditionId`/`timePointId` directly, no
   join needed.
6. DOE target source: `DoeObservation.value`/`.textValue` only.
   `DoeResponse.targetValue`/`.lowerLimit`/`.upperLimit`/`.objective`/
   `.desirabilityShape`, `DoeAnalysis`, `DoeCandidate` are all planned/
   computed, never measured actuals — confirmed excluded by a dedicated
   test asserting the string `"999"` (an injected `targetValue`) never
   appears anywhere in an extracted row's JSON.
7. Multiplicity: YES, deliberately preserved — every replicate, every
   stats field, every DOE observation, every entry in a `TestResult`/
   `StabilityResult` revision chain produces its own observation; no
   aggregation invented.
8. Target identity tuple: `productFamilyCode` + `sourceEntity` + EITHER
   `testDefinitionId` OR `responseId` +, for `stabilityResult` only,
   `conditionId`/`timePointId`. `unit` deliberately excluded from
   identity — the same `testDefinitionId` is the same measured concept
   regardless of which unit a given record happened to be entered in.
9. Unit normalization: FVL-05.009's `normalizeQuantity()` reused
   verbatim (imported, not reimplemented) for every numeric target value.
10. Missing/zero/false/textual/excluded representation: `normalizeQuantity(undefined,
    ...)` returns `undefined` (no fabricated observation); an explicit
    `"0"` or `false` is a real, distinct, preserved observation (proven
    by dedicated tests); a `DoeObservation` with status `"missing"`/
    `"invalid"`/`"excluded"` produces NO observation at all (proven by a
    parametrized test over all three statuses); `"outlier_flagged"`/
    `"outlier_confirmed"` observations ARE kept, flagged via `isOutlier`
    (proven by a parametrized test).
11. Revision/retest chains: every entry produces its own SEPARATE
    observation, per FVL-05.005's own already-established "never collapse
    to latest" precedent, applied here unchanged (proven by a dedicated
    test walking a two-entry `revisesResultId` chain).
12. Definition + observation, both: `targetDefinitionSchema` (identity)
    is embedded inline on every `targetObservationSchema` (the actual
    measured instance) — no separate catalog/collection built (would be
    scope creep toward FVL-05.011's own fingerprinting/dedup job).
13. Feature-schema-version impact: recovered from `FEATURE_SCHEMA_VERSION`'s
    OWN pre-existing header comment ("normalization + target-variable
    definitions, FVL-05.009-.010") — direct proof this row family was
    always intended under the EXISTING feature version, never a third
    version constant.
14. Lineage: every `targetObservationSchema` carries its own
    `sourceRecords` citing the exact source record; the row's own
    `sourceRecords` is the deduplicated union of every contributing
    input row's lineage — the identical two-tier convention FVL-05.009
    established.
15. Determinism: no re-sorting is performed anywhere — every input array
    (trials, testResults, samples, results, replicates, runs,
    observations) is already deterministically ordered by its own
    originating FVL-05.005/.006/.007 extractor; this task only reads that
    order.

## Versioning decision

`FEATURE_SCHEMA_VERSION` bumped `"1.0"` -> `"1.1"`. Reasoning: FVL-05.009's
`formulaVersionFeatureRowSchema` was the FIRST feature-family shape ever
defined — the same "nothing existed before, nothing changed" case
`DATASET_SCHEMA_VERSION` itself was in at FVL-05.002 completion, and
correctly did not bump. `formulaVersionTargetRowSchema` is a SECOND,
brand-new feature-family row type — the exact situation
`DATASET_SCHEMA_VERSION`'s own SECOND BUMP (FVL-05.005) already resolved
with a direct, explicit, no-exception rule: "a new row type is a shape
change and must bump, with no exception for being additive/new rather
than a field edit to an existing type." Applied here without inventing a
new exception. `formulaVersionFeatureRowSchema`'s own field shape is
UNCHANGED but now requires the bumped literal too, since both row types
share ONE `featureSchemaVersion` literal — the same way every unrelated
DATASET row already requires the current `DATASET_SCHEMA_VERSION`
regardless of whether its own shape changed in a given bump. Updated
consistently: two previously-hardcoded `"1.0"` assertions
(`dataset.test.ts`, `formulaVersionFeatureExtractor.test.ts`) now assert
`"1.1"`; a new test proves `"1.0"` is structurally rejected
(`featureSchemaVersionSchema.safeParse("1.0").success === false`).
Compatibility: repo-wide grep for `formulaVersionFeatureRowSchema`/
`extractFormulaVersionFeatureRows` outside this package's own engine/
schema/test files returns zero matches — no persisted feature row exists
anywhere, so no `SchemaMigration` entry is applicable.
`DATASET_SCHEMA_VERSION` untouched (stays `"1.6"`) — no FVL-05.003-.008
row shape changed.

## Design decisions

`normalizedQuantitySchema` was refactored (behavior-preserving, no
validation change) to extract a reusable `normalizedQuantityValueSchema`/
`requireNormalizedPairing` — the target row's own numeric value
(`targetObservationValueSchema`'s `"numeric"` branch) composes this via
`.merge()` rather than copying the raw/canonical field list into a
parallel shape. DOE response-unit resolution
(`buildDoeResponseUnitIndex`) independently re-derives the SAME
frozen-snapshot integrity checks the FVL-05.009 corrective cycle just
established (`doe_design_study_conflict`/
`doe_design_response_snapshot_conflict`/`duplicate_doe_design_response_id`)
— duplicated rather than imported, matching this codebase's own
established convention for a small extractor-local helper
(`compareOrdinal`/`isCanonicalIsoTimestamp` across FVL-05.004-.007), and
because each FVL-05 extractor's error class is intentionally its own,
never shared across sibling files. `collectMeasuredResultTarget` is
shared between the `TestResult` and `StabilityResult` walkers (both use
the structurally identical `resultType`-driven disposition) — a single
function taking a narrow duck-typed interface, not a re-modeled zod
schema, so there is no parity-drift risk to guard against (nothing here
independently re-validates a field zod already validated on the source
row).

## Files changed

- `packages/shared/src/schemas/dataset.ts` — `FEATURE_SCHEMA_VERSION`
  bumped + header comment; `normalizedQuantitySchema` refactored
  (extracted `normalizedQuantityValueSchema`/`requireNormalizedPairing`);
  new FVL-05.010 section: `TARGET_SOURCE_ENTITIES`,
  `targetDefinitionSchema`, `targetObservationValueSchema`,
  `targetObservationSchema`, `formulaVersionTargetRowSchema`.
- `packages/shared/src/engine/formulaVersionTargetExtractor.ts` — new:
  `extractFormulaVersionTargetRows`, `FormulaVersionTargetExtractionError`.
- `packages/shared/src/engine/formulaVersionTargetExtractor.test.ts` —
  new: 42 focused adversarial tests.
- `packages/shared/src/schemas/dataset.test.ts` — two hardcoded
  `FEATURE_SCHEMA_VERSION` literals updated `"1.0"`→`"1.1"`; one new
  superseded-literal-rejection test.
- `packages/shared/src/engine/formulaVersionFeatureExtractor.test.ts` —
  one hardcoded `FEATURE_SCHEMA_VERSION` literal updated.
- `packages/shared/src/index.ts` — added
  `export * from "./engine/formulaVersionTargetExtractor"`.
- `docs/FORMULAB_V1_TASK_TRACKER.md` — FVL-05.010 row completed; rollup
  counts corrected `9/14`→`10/14`, `98/171`→`99/171`.
- `project-control/claude/handoffs/FORMULAB_V1_CURRENT.md` — new UPDATE
  block prepended.
- `project-control/claude/logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md`
  — this section.

No GPT audit/prompt file touched (ownership rule respected). `.hiveai/
PROJECT_DASHBOARD.md` not touched — no path it declares was broken by
this task. All other pre-existing worktree modifications/deletions/
untracked files left untouched.

## Validation (from the final local state, before commit)

- `pnpm --filter @formulab/shared exec vitest run src/engine/formulaVersionTargetExtractor.test.ts`: **42/42**.
- `pnpm --filter @formulab/shared exec vitest run src/engine/formulaVersionTestResultDatasetExtractor.test.ts src/engine/formulaVersionStabilityDatasetExtractor.test.ts src/engine/formulaVersionDoeDatasetExtractor.test.ts`: **182/182**, unchanged (FVL-05.005/.006/.007 extractors themselves untouched).
- `pnpm --filter @formulab/shared exec vitest run` (full suite): **92
  files / 2172 tests** passed (91 → 92 files, 2129 → 2172 tests, +43 new,
  no regression).
- `pnpm --filter @formulab/shared exec tsc --noEmit`: clean.
- `pnpm --filter @formulab/desktop exec tsc --noEmit`: clean.
- `pnpm --filter @formulab/desktop lint`: clean.
- `pnpm --filter @formulab/desktop exec vitest run` (full suite): **167
  files / 1726 tests** passed, unchanged (no desktop app code touched
  this task).
- `python scripts/validate_v1_tracker.py`: OK, 171 unique tasks, no
  drift.
- `git diff --check`: clean (pre-existing CRLF warnings only).

### Commits

- `d5e7388` — this task's single implementation commit (no amend, no
  force push, no history rewrite).

Final HEAD: `d5e7388da710399a3e9f9ea6326918c9392b4d29`. Verified
`git rev-parse HEAD` equals
`git rev-parse origin/feature/laboratory-stability` after push — both
`d5e7388da710399a3e9f9ea6326918c9392b4d29`.

### Desktop build & shortcut (final pushed HEAD)

- Checked for a stale locked `formulab.exe` process BEFORE building —
  none running.
- Build command: `pnpm --filter @formulab/desktop tauri build`, exit
  code confirmed explicitly — **`EXIT_CODE=0`**. MSI and NSIS bundles
  produced.
- Executable: `C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe`
  — size 24,872,960 bytes, modified 2026-08-27 15:47:01 local time,
  SHA256 `6867CDC52D69E687D8FF69C4C1A820B957C9364C24C2BFE34C28818F77EC8867`
  (distinct from the pre-task build's hash
  `AF535794FEF84ACF39AF5853AB87A61760A5ECDC943D97582CAEF8DF00AC3ED9`,
  confirming a fresh build from this task's final HEAD).
- `C:\Users\sekip\Desktop\FormuLab.lnk` verified via WScript.Shell:
  TargetPath matches the exact just-built executable path, Arguments
  empty, WorkingDirectory correct. No duplicate shortcut created; `.lnk`
  not committed.
- Native launch smoke: launched fresh via the real shortcut; resulting
  process (PID 25384) confirmed running from the exact fresh exe path and
  `Responding: True` 5 seconds after launch. **Automated launch smoke:
  PASS.** Process then deliberately stopped afterward so it does not lock
  the next build. **Manual UI acceptance from Desktop\FormuLab.lnk is
  still pending USER verification** — not claimed here.

### Closure-gate checklist (all satisfied)

Source recovery genuinely drove the payload (not the tracker title): all
15 mandatory source questions answered from direct source inspection
before any code was written; exactly three measured-response families
identified and confirmed exhaustive (CorrectiveAction/CostSnapshot
independently checked and found to carry none); product-family identity
correctly reused from FVL-05.003's own already-authoritative value
rather than re-resolved; every planned/spec/objective field identified
and excluded with a dedicated anti-leakage test; target identity tuple
enforced structurally via `targetDefinitionSchema`'s own `superRefine`,
not left to convention; DOE response-unit resolution independently
re-derives the exact frozen-snapshot checks the FVL-05.009 corrective
cycle established; multiplicity (replicates, stats, revision chains)
preserved with no invented aggregation; missing/zero/false/excluded/
outlier all distinguished per dedicated tests;
`FEATURE_SCHEMA_VERSION`/`DATASET_SCHEMA_VERSION` bump decision reasoned
from direct precedent, not intuition, with every affected literal/test
updated consistently; focused tests green (42/42); FVL-05.005/.006/.007
regression green (182/182, unchanged); full shared tests green (92/92
files, 2172/2172); desktop regression green (167/167 files, 1726/1726,
unchanged); shared/desktop typechecks green; desktop lint green; tracker
validator green (rollup counts corrected); `git diff --check` clean;
tracker/handoff/external log all truthfully current; task-owned changes
committed and pushed with local HEAD equal to remote HEAD; native Tauri
release build, `Desktop\FormuLab.lnk` check, and launch smoke run from
the final pushed HEAD with the real exit code verified explicitly;
FVL-05.011 remains untouched; GPT audit/prompt files untouched
(read-only, respected).

**FVL-05.010 — IMPLEMENTATION COMPLETE — PENDING GPT AUDIT.**

**NEXT TASK — FVL-05.011 NOT STARTED** (per this session's explicit
instruction not to begin it).
