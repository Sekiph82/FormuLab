# FormuLab FVL-05 — GPT Prompt 000015

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.010 — Exact target-variable definitions (per product family / measured response)

FVL-05.009 is independently GPT-audit CLOSED by:
project-control/gpt/audits/FVL05-GPT-AUDIT-000014.md

Do not reopen FVL-05.009 unless direct current-source evidence reveals a concrete regression or contract defect.
Do not start FVL-05.011 or any later task.
Do not use Autopilot, subagents, or background agents.
Do not rewrite history, force-push, destructive-reset/clean, or touch unrelated dirty files.
Do not mutate real user/business/laboratory data.

Before editing anything:
1. fetch/pull current branch state safely;
2. record git status, branch, local HEAD, remote HEAD, recent commits, staged/unstaged diff;
3. read `.hiveai/PROJECT_DASHBOARD.md`, the current canonical tracker, current handoff, and the existing FVL-05 external log under `project-control/claude/logs/`;
4. read `project-control/gpt/audits/FVL05-GPT-AUDIT-000014.md` and this prompt completely;
5. read the prior FVL-05.001-.009 audit/prompt history where it defines dataset/feature versioning, lineage, exact-source, measured-vs-planned evidence, deterministic ordering, fail-closed semantics, frozen DOE snapshots, normalization, non-mutation, and anti-target-leakage invariants;
6. inspect the CURRENT repository source that defines product-family identity and measured response semantics before designing any target schema.

IMPORTANT OWNERSHIP RULE:
All files under `project-control/gpt/audits/**` and `project-control/gpt/prompts/**` are GPT-owned and READ-ONLY for Claude.
Do not edit, append, reconstruct, reconcile, rename, or overwrite them.
Record Claude implementation evidence only in the canonical tracker, current Claude handoff, and the existing FVL-05 Claude external log.

SOURCE RECOVERY IS THE MAIN WORK OF THIS TASK.

Do not infer FVL-05.010's exact contract merely from the title. The canonical tracker wording is intentionally concise:

`Exact target-variable definitions (per product family / measured response)`

Recover the exact implementable meaning from current source.

At minimum inspect and cross-reference:
- `docs/FORMULAB_V1_TASK_TRACKER.md` exact FVL-05.010 row and dependencies;
- `docs/FORMULAB_V1_FINAL_SCOPE.md` for ML/dataset scope boundaries;
- `packages/shared/src/schemas/dataset.ts` including the FVL-05.009 feature-row contract;
- `packages/shared/src/engine/formulaVersionFeatureExtractor.ts` and its tests;
- canonical formulation/product/product-family/category schemas and their real writer/read paths;
- `packages/shared/src/schemas/laboratory.ts` and every canonical TestDefinition/TestResult schema actually used by FVL-05.005;
- `packages/shared/src/schemas/stability.ts` for measured stability responses and statuses;
- `packages/shared/src/schemas/doe.ts` for DoeResponse/DoeObservation, especially the separation of planned response objective metadata from actual observations;
- corrective-action/costing schemas only if current source proves one of their measured outcomes is genuinely a trainable target under the tracker contract;
- all current modules mentioning target variables, labels, outcomes, measured response, product family, formulation category/type, ML dataset, feature vectors, training dataset, model input/output, fingerprints, or prediction;
- package public exports and relevant tests;
- tracker/handoff/external log current truth.

MANDATORY SOURCE QUESTIONS — answer explicitly in the external log BEFORE coding:

1. What exact source entity defines a "product family" today? Is it a persisted identifier, category/type field, taxonomy, or another exact source-backed identity? If more than one candidate exists, which one is canonical and why?
2. Is product-family identity immutable/historical enough for dataset labeling, or is it mutable current masterdata? If mutable, what exact persisted historical field may safely be used instead? Do not guess.
3. Which source records constitute a "measured response" today? Enumerate them by source schema and exact field, distinguishing actual numeric/text/categorical measurement from planned target/spec/objective/reference values.
4. For `TestResult`, which statuses/fields represent usable measured evidence versus pending, invalid, excluded, superseded, revised, retest, or textual-only results?
5. For `StabilityResult`, which statuses/fields represent usable measured evidence, and what contextual dimensions such as condition/time point are part of target identity rather than predictor leakage?
6. For DOE, is the target source `DoeObservation` actual values only? Confirm that `DoeResponse.targetValue`, lower/upper limits, objective, desirability, candidates, analyses, and design intent are not mistaken for measured targets.
7. Does one formula version legitimately have multiple target observations for the same target definition because of replicate, time-point, trial, sample, DOE run, method, or revision? If yes, what is the correct grain? Preserve multiplicity unless source explicitly defines deterministic aggregation.
8. What exact identity tuple makes a target definition stable and collision-safe? Examples to investigate, not assume: productFamily + sourceEntity + testDefinitionId/responseId + condition/timePoint/method/unit/status dimensions.
9. Is unit normalization of target values already safely handled by FVL-05.009 utilities, or must FVL-05.010 preserve raw+unit plus a normalized representation? Reuse proven normalization only where dimension/unit authority is exact.
10. How are missing, zero, false, empty-but-valid, textual, categorical, below-detection, excluded, invalid, outlier, and not-performed outcomes represented without collapsing them?
11. Are revision/retest chains expected to produce separate historical target observations, or is there a canonical current result? Follow source semantics; do not invent "latest wins".
12. Does the task require target DEFINITION records, target OBSERVATION/label records, or both? Recover this from downstream FVL-05.011+ expectations and current code. Do not prematurely implement fingerprint/model logic.
13. What exactly would constitute a feature-schema shape change? If FVL-05.010 adds target-specific schemas separate from predictor feature rows, determine whether `FEATURE_SCHEMA_VERSION` should change under the standing version rule rather than assuming either answer.
14. How will every target observation cite exact source lineage so it can be traced back to the original measured record without fuzzy/name-based resolution?
15. How will target extraction remain deterministic under input-pool reordering and locale differences?

CORE INVARIANTS:

- Targets must come from persisted/measured historical evidence only.
- Never turn planned targets, specs, reference ranges, DOE objectives, desired values, predictions, candidate desirability, mutable current catalog values, or missing observations into ground-truth labels.
- Never use display names, labels, fuzzy matching, case-folded matching, nearest-date matching, or "latest" heuristics to resolve target identity.
- Exact opaque IDs stay opaque and case-sensitive unless the canonical source explicitly says otherwise.
- If a target requires resolving a reference, fail closed on dangling, duplicate, ambiguous, contradictory, or cross-scope references.
- Preserve source revision/trial/sample/run/time-point context whenever it materially distinguishes measurements.
- Do not silently aggregate repeated measurements or replicates. Aggregate only if a CURRENT canonical source contract explicitly defines the aggregation and prove it with tests.
- Missing remains missing. Explicit numeric zero remains zero. Empty-but-valid text/false remain distinct from absence where the canonical schema permits them.
- Do not silently impute.
- Do not leak target values back into predictor `normalizedQuantities` or predictor feature fields.
- Do not mutate FVL-05.009 feature rows or redefine their existing predictor semantics merely to attach labels.
- Reuse canonical schemas by referential composition wherever possible. Do not copy source field lists into parallel schemas without durable parity protection.
- Every emitted target definition/observation row must be Zod-validated before return.
- No input mutation on success or failure and no returned-output/source mutable aliasing.
- Deterministic ordering must use explicit, locale-independent comparisons and validated canonical timestamps when chronology is part of ordering.
- Preserve exact lineage/provenance at both row level and per-target observation where needed.
- Do not implement FVL-05.011 fingerprinting, partitioning, train/test split, model training, prediction, UI dashboards, or analytics in this session.

VERSIONING:

Current entering versions:
- `DATASET_SCHEMA_VERSION = "1.6"`
- `FEATURE_SCHEMA_VERSION = "1.0"`

Apply the standing rule, not intuition:
- bump DATASET schema only if an existing dataset-row shape truly changes;
- bump FEATURE schema only if an already-defined feature-family shape/contract truly changes;
- if FVL-05.010 introduces a separate target-definition/target-observation schema without changing existing predictor feature rows, recover from current versioning conventions whether it belongs under the existing feature version or requires a new independent versioned target schema. Do not invent a third version constant unless direct architecture evidence proves it is needed.
- if a version changes, update every affected literal/parity test consistently and reject superseded literals where the standing family contract requires it.

ADVERSARIAL TESTS:

Cover every applicable recovered rule, including at minimum:
- no measured targets / empty target set;
- one exact measured numeric response;
- explicit zero vs missing;
- textual/categorical measured response if canonical source supports it;
- excluded/invalid/pending/non-measured statuses never silently become labels;
- planned TestDefinition targets/spec limits never become labels;
- DOE `targetValue`/limits/objective never become labels;
- DOE actual observation does become a label when source-valid;
- stability measurement at different time points/conditions remains distinguishable where required;
- repeated measurements/replicates preserved unless source-proven aggregation exists;
- revision/retest relationships handled exactly per canonical semantics;
- exact product-family identity and cross-family isolation;
- dangling/duplicate/ambiguous/cross-scope identities fail closed wherever resolution is required;
- same opaque id in two unrelated namespaces must not collide through string concatenation or lookup precedence;
- Unicode/delimiter-rich ids;
- deterministic output under caller input reordering;
- ordinal-not-locale ordering where opaque ids tie-break;
- unit normalization only where source-supported, with incompatible/unknown unit never guessed;
- source lineage exactness;
- input non-mutation on success and each failure path;
- output/source deep non-aliasing;
- JSON round-trip + schema revalidation;
- public shared export availability;
- predictor feature rows remain unchanged by target attachment/extraction;
- target values do not appear in predictor normalized feature paths;
- version-literal behavior if any schema version changes;
- referential identity/parity assertions for every reused canonical source schema.

After focused tests pass, perform a fresh source audit of the whole FVL-05.010 path. Do not treat test count as proof.

FINAL VALIDATION FROM FINAL STATE:
- focused FVL-05.010 tests;
- relevant FVL-05.009 feature extractor/schema tests;
- affected FVL-05.005/.006/.007 extractor tests where target sources are reused;
- relevant dataset schema/version tests;
- full `@formulab/shared` suite;
- full desktop regression suite;
- shared typecheck;
- desktop typecheck;
- desktop lint;
- `python scripts/validate_v1_tracker.py`;
- `git diff --check`.
Run Rust/Python checks only if those source areas are actually touched or direct source recovery proves they are necessary.

DOCUMENTATION / CONTROL PLANE:
- update only the FVL-05.010 tracker truth and any unavoidable rollup counts;
- update `project-control/claude/handoffs/FORMULAB_V1_CURRENT.md`;
- append to the EXISTING `project-control/claude/logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md`;
- do not create a duplicate FVL-05 log;
- do not modify GPT audit/prompt files;
- keep `.hiveai/PROJECT_DASHBOARD.md` pointer-only and unchanged unless this task genuinely breaks one of its declared source paths.

COMMIT / PUSH / NATIVE GATE:
- commit and push only task-owned changes;
- no amend, force push, or history rewrite;
- verify final local HEAD equals `origin/feature/laboratory-stability`;
- from the final pushed HEAD, satisfy the existing Tauri release-build / Desktop\FormuLab.lnk / launch-smoke gate;
- check stale `formulab.exe` before build;
- verify real build exit code and fresh executable hash/mtime;
- verify shortcut TargetPath/WorkingDirectory/Arguments;
- launch through the actual shortcut and stop the smoke-test process afterward;
- do not claim manual UI acceptance unless the user actually performs it.

Only when the implementation, source audit, tests, docs, push, and native gate are complete may you state:

`FVL-05.010 — IMPLEMENTATION COMPLETE — PENDING GPT AUDIT`

Then state:

`NEXT TASK — FVL-05.011 NOT STARTED`

Do not self-accept FVL-05.010. GPT performs the independent acceptance audit.
Do not start FVL-05.011 in this session.
```
