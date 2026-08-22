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
every contributing record; all seven fail-closed error codes each
asserted by `.code` — `formula_version_not_found` (new),
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
described above.

Manual UI acceptance from Desktop\FormuLab.lnk is pending user
verification.
