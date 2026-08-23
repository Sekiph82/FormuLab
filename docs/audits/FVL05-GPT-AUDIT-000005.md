# FormuLab FVL-05 — GPT Audit 000005

## Scope

Independent re-audit of **FVL-05.005 — Extractor: LaboratoryTrial + TestResult** on branch `feature/laboratory-stability`, against the governing prompt `docs/prompts/FVL05-GPT-PROMPT-000005.md`, the current repository source, tests, tracker/handoff, and the latest external cycle log.

## Verdict

**CONTINUE / REOPEN FVL-05.005. Do not start FVL-05.006 yet.**

The core implementation is coherent and most of the prior acceptance evidence is real, but one source-relationship integrity gap remains. FVL-05.005 must not be closed until that gap is resolved and re-audited.

## What was independently verified as correct

- `TestResult.trialId` is the exact persisted relationship to `LaboratoryTrial.id`.
- `TestResult` is a top-level append-only persisted record, so its own `id` is globally scoped and its lineage citation correctly does **not** fabricate `parentRecordId`.
- `trialTestResultsSchema` embeds canonical `testResultSchema` directly instead of retyping it.
- `DATASET_SCHEMA_VERSION` was bumped to `1.2` for the new dataset-row shape.
- Formula-version, formulation, trial, and TestResult pool identities fail closed on duplicate top-level ids.
- `saved_version` link integrity, trial/formula conflict handling, canonical chronology keys, deterministic ordinal tie-breaking, schema validation, non-mutation, non-aliasing, public export, and the reported test/build gates are all present in source/tests.
- The implementation preserves all TestResult records in a revision chain rather than collapsing to latest-only.

## FINDING 1 — HIGH: `revisesResultId` / `retestOf` relationships are emitted without referential-integrity validation

### Evidence

Canonical `testResultSchema` contains two persisted TestResult-to-TestResult relationship fields:

- `revisesResultId`: the predecessor record that this append-only revision revises.
- `retestOf`: the earlier result that this record retests.

`engine/testResults.ts::reviseTestResult` explicitly creates a new TestResult whose `revisesResultId` points to the prior record's exact `id`. Therefore this is not decorative free text; it is a real source-record identity relationship.

Current `formulaVersionTestResultDatasetExtractor.ts::buildTestResultsByTrialId` validates only:

- duplicate `TestResult.id`,
- `TestResult.trialId` resolving to a supplied trial,
- canonical `performedAt`.

It does **not** validate either `revisesResultId` or `retestOf`.

Current tests prove a valid `R2.revisesResultId = "R1"` chain is preserved, but there is no failure test for:

- referenced result id missing from the supplied TestResult pool;
- reference resolving to a result owned by a different trial;
- self-reference;
- revision/retest cycles, if the recovered domain contract forbids them.

### Why this is a contract defect

The governing FVL-05.005 prompt requires:

- exact persisted source identity;
- failure on missing/ambiguous required relationships;
- audit of all pool-level **and nested** identity scopes;
- missing referenced result failure where required;
- multiple results/trials preserved without cross-trial leakage.

The current extractor can emit a schema-valid dataset row containing a dangling or cross-trial TestResult relationship because Zod validates only that `revisesResultId`/`retestOf` are strings, not that those ids resolve correctly.

That makes the resulting historical dataset internally inconsistent even though every top-level TestResult itself exists.

### Required correction

Recover the precise semantics of both fields from current writers/readers/tests before changing behavior. Then implement the narrowest correct fail-closed validation.

At minimum, for each non-empty persisted relationship field that is authoritative in the current domain model:

1. The referenced TestResult id must resolve to exactly one TestResult in the supplied pool.
2. The referenced result must belong to the same `trialId` unless current repository authority explicitly proves cross-trial retest/revision is legitimate.
3. Self-reference must fail closed.
4. If repository authority establishes that revision/retest chains must be acyclic, detect cycles and fail closed. Do not invent an acyclicity rule without source support; prove it first.
5. Add truthful structured error codes/context, preferably distinguishing missing-reference vs. cross-trial/self/cycle cases enough for diagnosis.
6. Preserve every valid referenced record separately; do not collapse history.

If `retestOf` has materially different semantics from `revisesResultId`, document and test that distinction instead of forcing one generic rule onto both.

## Required adversarial tests

Add focused synthetic tests for all source-supported cases, including at least:

- valid `revisesResultId` chain still passes and preserves both records;
- dangling `revisesResultId` fails closed;
- cross-trial `revisesResultId` fails closed unless source authority proves it legitimate;
- self-revising result fails closed;
- valid `retestOf` case according to recovered repository semantics;
- dangling/cross-trial/self `retestOf` cases according to recovered semantics;
- cycle case if acyclicity is an authoritative invariant;
- non-mutation on each new failure path;
- input reordering does not change the outcome;
- structured error context names the actual `testResultId` identities truthfully.

## Whole-scope regression requirement

After fixing this finding, re-audit all FVL-05.005 behavior again, especially:

- exact Trial ↔ TestResult linkage;
- global TestResult lineage identity;
- version `1.2` behavior;
- no TestDefinition planned-vs-actual conflation;
- revision/retest history preservation;
- deterministic ordering;
- no cross-trial/cross-version leakage;
- all prior error paths and tests.

## Control-plane rule

All `docs/audits/FVL05-GPT*.md` and `docs/prompts/FVL05*.md` files remain GPT-owned and **READ-ONLY for Claude**. Claude may read them but must not edit, append, reconcile, reconstruct, rename, or overwrite them.

Implementation evidence belongs only in the normal tracker, current handoff, and existing FVL-05 external log.

## Closure gate

FVL-05.005 may be closed only after:

- Finding 1 is resolved from authoritative source semantics;
- focused FVL-05.005 tests pass;
- full shared suite passes;
- full desktop suite passes;
- shared and desktop typechecks pass;
- desktop lint passes;
- tracker validator passes;
- `git diff --check` passes;
- tracker/handoff/external log accurately describe the correction;
- task-owned changes are committed and pushed;
- local HEAD equals remote branch HEAD;
- native Tauri release build + shortcut + launch smoke are rerun from final pushed HEAD;
- FVL-05.006 remains untouched.
