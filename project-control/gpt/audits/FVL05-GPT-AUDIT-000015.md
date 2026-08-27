# FormuLab FVL-05 — GPT Audit 000015

Date: 2026-08-27
Branch audited: `feature/laboratory-stability`
Implementation commit audited: `d5e7388da710399a3e9f9ea6326918c9392b4d29`
Governing implementation prompt: `project-control/gpt/prompts/FVL05-GPT-PROMPT-000015.md`

## Verdict

**CONTINUE / REOPEN FVL-05.010**

FVL-05.010 is not independently accepted yet. FVL-05.011 remains blocked.

The implementation has strong anti-leakage, unit-normalization, DOE frozen-snapshot, lineage, versioning, non-mutation, and fail-closed work, but independent source inspection found two target-semantics defects that must be corrected before the task can close.

## What was independently inspected

The cycle log was not accepted at face value. The audit inspected the actual implementation commit and current source, including:

- `packages/shared/src/engine/formulaVersionTargetExtractor.ts`
- `packages/shared/src/engine/formulaVersionTargetExtractor.test.ts`
- `packages/shared/src/schemas/dataset.ts`
- `packages/shared/src/schemas/testDefinitions.ts`
- `packages/shared/src/schemas/doe.ts`
- `docs/FORMULAB_V1_TASK_TRACKER.md`
- governing GPT Prompt 000015

## Finding A — HIGH — computed replicate statistics are emitted as ground-truth target observations

`collectMeasuredResultTarget()` emits every numeric replicate and then also emits `stats.mean`, `stats.minimum`, `stats.maximum`, and `stats.standardDeviation` as additional `TargetObservation`s for the same target definition.

This conflicts with the authoritative source semantics in `schemas/testDefinitions.ts`:

- `replicateStatsSchema` is explicitly documented as **computed purely from `replicates`**;
- those statistics are persisted only so reports do not need to recompute them;
- the source comment explicitly states **the replicates remain the source of truth**.

Therefore these stats are not independent measured responses. Emitting them as additional labels duplicates the same physical evidence and turns a derived aggregate into ground-truth target observations.

The governing Prompt 000015 required:

- targets from persisted/measured historical evidence only;
- no silent aggregation unless a current canonical source explicitly defines aggregation;
- preserve repeated measurements/replicates rather than collapse or synthesize them.

Persistence of a computed cache does not make it a separate measured observation. FVL-05.009 may normalize persisted stats as descriptive feature evidence, but FVL-05.010 target labels have a stricter measured-response contract.

### Required correction for Finding A

For `TestResult` and `StabilityResult` numeric/visual-rating targets:

- emit the actual replicate observations only;
- do **not** emit `ReplicateStats.mean/minimum/maximum/standardDeviation` as target observations;
- do not replace replicates with the mean;
- do not create a new aggregate target unless a distinct current source contract explicitly defines that aggregate as the measured outcome, which current inspected source does not.

Add adversarial tests proving a result with two replicates plus populated stats emits only the two replicate labels and that changing/removing cached `stats` cannot change the target-observation set.

## Finding B — HIGH — TestResult target identity discards persisted measurement context

Current `targetDefinitionSchema` defines a `testResult` target as only:

`productFamilyCode + sourceEntity + testDefinitionId`

and explicitly forbids condition/time-point fields for `testResult`.

But the authoritative `testResultSchema` persists measurement-context fields including:

- `sampleId`
- `timePoint`
- `storageCondition`
- `instrument`
- immutable `methodSnapshot`

`testDefinitionSchema` also states that its own `timePoint` / `storageCondition` text does **not** fix where a definition is used; binding happens where a trial or study selects/records the test. There is no schema invariant proving two `TestResult`s with the same `testDefinitionId` must share the same persisted time-point/storage-condition/sample context.

Prompt 000015 explicitly required source recovery for whether time point, condition, sample, method, unit, or status dimensions materially distinguish a target, and required preservation of source revision/trial/sample/run/time-point context whenever it materially distinguishes measurements.

The current implementation simply concluded that only StabilityResult needs contextual identity, without proving the corresponding TestResult fields are non-distinguishing. This can collapse, for example, the same exact `testDefinitionId` measured at two different persisted `timePoint` or `storageCondition` values into one target definition.

### Required correction for Finding B

Re-audit the real TestResult writer/read paths before choosing the final shape.

At minimum resolve, from current source, whether `sampleId`, `timePoint`, `storageCondition`, `instrument`, and immutable `methodSnapshot` can vary for the same `testDefinitionId` in one formula-version history and whether each field changes target identity or is observation context only.

Then implement the narrowest source-supported representation:

- any field proven to change **what target is being predicted** belongs in collision-safe target identity;
- any field that does not change the definition but is necessary to preserve the exact measurement context belongs in an explicit observation-context structure;
- fields proven irrelevant/non-distinguishing may remain excluded, but that exclusion must be backed by a direct source invariant and regression test, not assumption.

At minimum, `timePoint` and `storageCondition` cannot remain structurally impossible for TestResult target identity/context without source proof that they never distinguish two measurements.

Do not use display-name matching, fuzzy identity, or live TestDefinition lookup to repair this. Use persisted historical fields already carried by the extracted TestResult.

## Areas independently found sound

Subject to the two findings above, the following portions are accepted and should not be rewritten gratuitously:

- target sources restricted to `TestResult`, `StabilityResult`, and `DoeObservation`;
- planned/spec/objective fields excluded from labels;
- product-family identity reused from the composition row;
- DOE `missing` / `invalid` / `excluded` observations omitted;
- DOE outlier statuses retained with explicit outlier flag;
- DOE response resolution uses the owning design's frozen response snapshot and repeats the FVL-05.009 fail-closed study/revision checks;
- exact zero/false/missing distinctions;
- revision/retest records are not collapsed to latest;
- target rows are schema-validated before return;
- exact source lineage is preserved;
- input non-mutation / output non-aliasing design;
- `DATASET_SCHEMA_VERSION` remains `1.6`;
- `FEATURE_SCHEMA_VERSION = 1.1` is acceptable for the new feature-family target-row shape and need not change again for validation/semantic corrections unless the corrective implementation changes the serialized target-row schema;
- FVL-05.011 was not started.

## Corrective acceptance requirements

FVL-05.010 may close only after all of the following are true:

1. computed `ReplicateStats` are no longer emitted as independent ground-truth target observations;
2. actual replicates remain preserved independently, including outlier flags and zero values;
3. TestResult persisted context is re-audited from real source/writers;
4. target identity/observation context is revised where needed so materially different TestResult measurements cannot collapse under one indistinguishable definition;
5. no planned/spec/reference values are introduced during the correction;
6. predictor FVL-05.009 semantics are not changed merely to repair target labels;
7. feature schema version is bumped only if the serialized target shape actually changes, with all affected version tests updated consistently;
8. focused adversarial tests cover both findings and non-mutation/fail-closed behavior;
9. full shared/desktop/typecheck/lint/tracker/diff/native gates pass from final pushed HEAD;
10. FVL-05.011 remains untouched.

## Final status

**FVL-05.010 — REOPENED / CORRECTIVE REQUIRED**

**FVL-05.011 — BLOCKED / NOT AUTHORIZED**
