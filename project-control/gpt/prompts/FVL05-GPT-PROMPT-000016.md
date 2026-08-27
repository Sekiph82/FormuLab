# FormuLab FVL-05 — GPT Prompt 000016

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.010 corrective cycle

FVL-05.010 was independently GPT-audit REOPENED by:
project-control/gpt/audits/FVL05-GPT-AUDIT-000015.md

Do not start FVL-05.011 or any later task.
Do not use Autopilot, subagents, or background agents.
Do not rewrite history, force-push, destructive-reset/clean, or touch unrelated dirty files.
Do not mutate real user/business/laboratory data.

Before editing anything:
1. fetch/pull current branch state safely;
2. record git status, branch, local HEAD, remote HEAD, recent commits, staged/unstaged diff;
3. read `.hiveai/PROJECT_DASHBOARD.md`, canonical tracker, current Claude handoff, and the existing combined FVL-05 Claude log;
4. read `project-control/gpt/audits/FVL05-GPT-AUDIT-000015.md` and this prompt completely;
5. read current `formulaVersionTargetExtractor.ts`, its tests, the FVL-05.010 target schemas in `schemas/dataset.ts`, `schemas/testDefinitions.ts`, `schemas/stability.ts`, and all real TestResult writer/read paths needed to resolve persisted context semantics;
6. treat all files under `project-control/gpt/audits/**` and `project-control/gpt/prompts/**` as GPT-owned READ-ONLY in substance.

This is a CORRECTIVE FVL-05.010 cycle only.
Do not broaden into FVL-05.011 fingerprinting, FVL-05.012 partitioning, model training, prediction, UI, or persistence.

BLOCKER A — COMPUTED REPLICATE STATS MUST NOT BE GROUND-TRUTH LABELS

Current code emits `stats.mean`, `stats.minimum`, `stats.maximum`, and `stats.standardDeviation` as additional target observations.

Authoritative source in `schemas/testDefinitions.ts` says `ReplicateStats` are computed purely from `replicates`, persisted as a reporting snapshot, while the replicates remain the source of truth.

Correct this exactly:
- actual numeric/visual-rating replicates remain target observations;
- `ReplicateStats` must NOT produce target observations;
- do not replace replicates with mean/min/max/stddev;
- do not create a new aggregate target unless direct current source proves a distinct aggregate is itself the measured outcome;
- changing/removing a cached `stats` object must not change the target observation set.

Add adversarial tests with two replicates and populated stats proving only two labels are emitted, plus a cache-invariance test proving different stats snapshots over identical replicates produce identical target observations.

BLOCKER B — TESTRESULT CONTEXT / TARGET IDENTITY MUST BE SOURCE-RESOLVED

Current testResult target definition is only:
`productFamilyCode + sourceEntity + testDefinitionId`

But canonical `testResultSchema` persists:
- `sampleId`
- `timePoint`
- `storageCondition`
- `instrument`
- immutable `methodSnapshot`

Do not simply add all fields blindly.

First inspect every real TestResult writer/read path and answer in the Claude log, with exact source evidence:
1. Can two TestResults using the same `testDefinitionId` in one formula-version history legitimately carry different `sampleId` values?
2. Can they carry different `timePoint` values?
3. Can they carry different `storageCondition` values?
4. Can they carry different `instrument` values?
5. Can they carry different immutable `methodSnapshot` identities/versions?
6. For each field above, does the field change WHAT target is being predicted, or is it measurement-instance context only?
7. Which persisted context is required so two materially different measurements cannot become indistinguishable after extraction?

Then implement the narrowest source-supported shape:
- fields that change target meaning belong in collision-safe `targetDefinitionSchema` identity;
- fields that do not change target meaning but are required to preserve exact measurement-instance context belong in an explicit target-observation context object/fields;
- fields proven irrelevant may stay excluded only with direct source proof and regression tests;
- at minimum, `timePoint` and `storageCondition` cannot remain impossible to represent if current source permits them to distinguish measurements.

Do not resolve context from live `TestDefinition` records if the persisted TestResult already contains the historical field. Do not use names, fuzzy matching, nearest timestamps, or latest-record heuristics.

STABILITY / DOE REGRESSION RULES

Do not weaken independently sound behavior:
- StabilityResult target identity keeps exact `conditionId` + `timePointId` distinction.
- DOE target values remain only actual `DoeObservation` evidence.
- DOE `targetValue`, limits, objective, desirability, candidates, analyses remain excluded.
- DOE `missing`/`invalid`/`excluded` remain non-labels.
- DOE outlier statuses remain explicit labels with outlier flag.
- frozen response-snapshot fail-closed integrity checks remain intact.

TARGET OBSERVATION GRAIN

Preserve every actual measured replicate/observation/revision separately.
Do not silently collapse revisions, retests, replicates, samples, time points, trials, or DOE runs.
If additional measurement context is added, it must be exact persisted context and must not invent a synthetic latest/current interpretation.

VERSIONING

Entering versions after FVL-05.010 implementation:
- `DATASET_SCHEMA_VERSION = "1.6"`
- `FEATURE_SCHEMA_VERSION = "1.1"`

Rules:
- DATASET version must remain 1.6 unless a FVL-05.003-.008 dataset row shape actually changes, which this correction should not require.
- If correcting TestResult context changes the serialized `formulaVersionTargetRowSchema` / `targetDefinitionSchema` / `targetObservationSchema` shape, then this is an already-defined feature-family shape change and `FEATURE_SCHEMA_VERSION` must bump according to the standing rule.
- If no serialized shape changes and only extraction semantics/tests change, do not bump FEATURE version.
- If bumped, update every affected current-literal and superseded-literal test consistently; do not invent a new version constant.

MANDATORY ADVERSARIAL TESTS

At minimum add/adjust tests for:
- two numeric replicates + populated ReplicateStats => only two target observations;
- stats-cache mutation/removal over identical replicates => identical target-observation output;
- stability stats likewise never become target observations;
- explicit zero replicate survives;
- outlier replicate survives with `isOutlier: true`;
- same `testDefinitionId` with different source-supported timePoint/storageCondition context remains distinguishable if source recovery proves those fields can vary materially;
- same test definition with context values containing Unicode/delimiters remains collision-safe;
- context missing vs explicit empty-but-valid stays distinct exactly where source schema permits it;
- revision/retest chain remains separate;
- no planned TestDefinition target/minimum/maximum becomes a label;
- DOE anti-leakage remains green;
- DOE frozen-snapshot fail-closed regression remains green;
- predictor FVL-05.009 normalized feature rows remain unchanged by this correction;
- input non-mutation on success and new failure paths;
- output/source deep non-aliasing;
- JSON round-trip + target-row schema revalidation;
- public export remains available;
- feature-version literal behavior if the target schema shape changes.

After focused tests pass, perform a fresh independent source audit of the whole FVL-05.010 path. Do not stop at making tests green.

FINAL VALIDATION FROM FINAL STATE

Run at minimum:
- focused FVL-05.010 target extractor tests;
- relevant dataset/feature schema tests;
- FVL-05.009 feature extractor tests;
- FVL-05.005 TestResult extractor tests;
- FVL-05.006 Stability extractor tests;
- FVL-05.007 DOE extractor tests;
- full `@formulab/shared` suite;
- full desktop regression suite;
- shared typecheck;
- desktop typecheck;
- desktop lint;
- `python scripts/validate_v1_tracker.py`;
- `git diff --check`.

Run Rust/Python checks only if those source areas are actually touched or source recovery proves they are necessary.

CONTROL / DOCS

Update only:
- FVL-05.010 current tracker truth and unavoidable rollup/version notes;
- `project-control/claude/handoffs/FORMULAB_V1_CURRENT.md`;
- the EXISTING `project-control/claude/logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md`.

Do not create a duplicate FVL-05 log.
Do not edit GPT audit/prompt files.
Keep `.hiveai/PROJECT_DASHBOARD.md` pointer-only and untouched unless a declared source path genuinely changes.

COMMIT / PUSH / NATIVE GATE

Commit and push only corrective FVL-05.010-owned changes.
No amend, no force push, no history rewrite.
Verify local HEAD == `origin/feature/laboratory-stability`.
From final pushed HEAD rerun the existing Tauri release-build / Desktop\FormuLab.lnk / launch-smoke gate, including stale-process check, real exit code, fresh executable hash/mtime, shortcut TargetPath/WorkingDirectory/Arguments, launch through actual shortcut, and smoke-process cleanup.
Do not claim manual UI acceptance unless the user actually performs it.

Only when every blocker and gate is satisfied may Claude state:

`FVL-05.010 CORRECTIVE IMPLEMENTATION COMPLETE — PENDING GPT AUDIT`

Then state:

`NEXT TASK — FVL-05.011 NOT STARTED`

Do not self-accept FVL-05.010.
Do not start FVL-05.011.
```