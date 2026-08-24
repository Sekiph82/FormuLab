# FormuLab FVL-05 — GPT Prompt 000013

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.009

FVL-05.008 is independently GPT-audit CLOSED by:
docs/audits/FVL05-GPT-AUDIT-000012.md

Do not reopen FVL-05.008 unless direct current source evidence reveals a concrete regression or contract defect.
Do not start FVL-05.010 or any later task.
Do not use Autopilot, subagents, or background agents.
Do not rewrite history, force-push, destructive-reset/clean, or touch unrelated dirty files.
Do not mutate real user/business/laboratory data.

Before editing anything:
1. fetch/pull current branch state safely;
2. record git status, branch, local HEAD, remote HEAD, recent commits, staged/unstaged diff;
3. read the current tracker and handoff;
4. read docs/audits/FVL05-GPT-AUDIT-000012.md and this prompt completely;
5. read the prior FVL-05.001-.008 audit/prompt history where it defines dataset/feature version, lineage, exact-source, deterministic-order, fail-closed, schema-parity, and non-mutation invariants;
6. locate and read the existing FVL-05 external log under docs/external-logs; append to that same file rather than creating a duplicate log.

IMPORTANT OWNERSHIP RULE:
All files under docs/audits/FVL05-GPT*.md and docs/prompts/FVL05*.md are GPT-owned and READ-ONLY for Claude.
Do not edit, append, reconstruct, reconcile, rename, or overwrite them.
Record Claude implementation evidence only in the tracker, handoff, and existing FVL-05 external log.

SOURCE RECOVERY IS THE MAIN WORK OF THIS TASK.

Do not infer FVL-05.009's exact contract from historical memory or from this launcher. Read the CURRENT tracker row and all current source that defines the intended normalization / derived-feature behavior before writing code.

At minimum inspect:
- docs/FORMULAB_V1_TASK_TRACKER.md exact FVL-05.009 row;
- packages/shared/src/schemas/dataset.ts;
- all FVL-05.003-.008 extractor row schemas and extractors;
- any existing feature, normalization, ML-dataset, statistics, units, decimal, or target-variable modules in packages/shared;
- package public exports and tests;
- tracker/handoff/external log current truth.
Search the repository rather than assuming historical file names still exist.

Core invariants that MUST survive source recovery:
- `DATASET_SCHEMA_VERSION` and `FEATURE_SCHEMA_VERSION` are independent. FVL-05.009 must change FEATURE_SCHEMA_VERSION only if it actually changes a feature-vector schema; do not bump DATASET_SCHEMA_VERSION unless a dataset row shape truly changes.
- Preserve source lineage/provenance into derived features. Do not produce an untraceable numeric matrix.
- Never normalize/convert a field unless the rule is deterministic, explicit, source-supported, unit-safe, and testable. If a value cannot be normalized safely, preserve/flag it according to recovered source contract rather than guessing.
- Never turn planned targets, specs, DOE objectives, predictions, analyses, candidate desirability, mutable current catalog values, or missing observations into measured actual features.
- Explicit zero/false/empty-but-valid values must remain distinguishable from missing data.
- Do not silently impute missing values unless the CURRENT FVL-05.009 contract explicitly requires a documented deterministic imputation rule.
- Do not collapse historical revisions, replicates, excluded/outlier/missing statuses, study revisions, runs, samples, or repeated measurements into a guessed latest/best value unless current source explicitly defines that aggregation.
- Do not use locale-dependent parsing or ordering. Decimal/unit conversion must be deterministic and exact within the source domain's established numeric conventions.
- Reuse canonical schemas and existing conversion/normalization utilities where real ones exist. Do not copy field lists into a parallel schema without parity protection.
- Validate every emitted feature record/vector against its task-specific schema before returning.
- No input mutation and no returned-output/source mutable aliasing.
- Fail closed on ambiguous exact source identities or contradictory references needed to compute a feature.
- Keep FVL-05.010 target-variable work out of FVL-05.009 unless the CURRENT tracker/source proves a field is part of normalization itself. Do not smuggle target labels into predictors.

Mandatory source questions to answer in the external log before coding:
1. What exactly is FVL-05.009's tracker wording and acceptance boundary?
2. What is the unit of output: one feature vector per formula version, per experiment observation, per row family, or another source-proven grain?
3. Which FVL-05.003-.008 row families are inputs now, and which are intentionally excluded?
4. Which fields are categorical passthrough, numeric raw, normalized numeric, identifiers/provenance-only, or non-feature metadata?
5. Which deterministic unit conversions/normalizations already exist in source? Which do not?
6. How are missing, excluded, invalid, outlier, textual, zero, boolean, and repeated observations represented without information loss?
7. Is scaling (min-max/z-score/etc.) actually part of FVL-05.009 source contract? If yes, what persisted/fitted statistics define it and how are leakage/reproducibility prevented? If no, do not invent it.
8. What exact change, if any, requires a FEATURE_SCHEMA_VERSION bump from its current value?
9. How will every derived feature preserve provenance to its exact dataset/source records?
10. What prevents target leakage into FVL-05.009 features before FVL-05.010 defines target variables?

Adversarial tests must cover every applicable recovered rule, including at minimum:
- empty/minimal valid inputs;
- deterministic output under caller input reordering;
- exact zero vs missing distinction;
- unit-equivalent inputs where a canonical conversion is source-supported;
- unsupported/incompatible units fail closed or remain raw exactly as contract requires, never guessed;
- Unicode/delimiter-rich opaque ids;
- repeated measurements/replicates preserved or aggregated only by a proven rule;
- excluded/invalid/outlier/missing statuses do not silently become valid numeric evidence;
- planned/spec/target/predicted values do not leak into actual feature values;
- target-variable fields from FVL-05.010 are not introduced early;
- source lineage/provenance is exact and deterministic;
- duplicate/ambiguous source identities fail closed where resolution is required;
- input non-mutation on success and failure;
- returned nested output cannot mutate source fixtures;
- JSON round-trip + schema revalidation;
- public shared export availability;
- FEATURE_SCHEMA_VERSION accepts only the new current literal if bumped and rejects superseded literals;
- DATASET_SCHEMA_VERSION remains unchanged unless an actual dataset-row shape change is proven;
- canonical schema / helper referential identity or durable parity assertions where source schemas/utilities are reused.

After focused tests pass, perform a fresh whole-scope source audit rather than treating test count as proof.

Run final validation from the FINAL state, including at minimum:
- focused FVL-05.009 tests;
- relevant dataset/feature schema tests;
- all affected FVL-05 extractor tests;
- full @formulab/shared suite;
- full desktop regression suite;
- shared typecheck;
- desktop typecheck;
- desktop lint;
- tracker validator;
- git diff --check.
Run Rust/Python checks only if those source areas are actually touched or source recovery proves they are necessary.

Update only FVL-05.009 tracker current truth, current handoff, and the existing FVL-05 external log. Do not edit GPT audit/prompt files.

Commit and push only task-owned changes. Verify final local HEAD == remote branch HEAD.

Then satisfy the repository's existing native desktop build/shortcut acceptance gate from the final pushed HEAD. Check for a stale running formulab.exe before build, verify the real build exit code, fresh executable, Desktop\FormuLab.lnk TargetPath, and native launch smoke. Stop the smoke-test process afterward.

Do not claim manual UI acceptance unless the user actually performs it.

Only when all required source, tests, documentation, push, build and shortcut gates are satisfied may you state:
FVL-05.009 — IMPLEMENTATION AND ACCEPTANCE COMPLETE

Then state:
NEXT TASK — FVL-05.010 NOT STARTED

Do not start FVL-05.010 in this session.
```
