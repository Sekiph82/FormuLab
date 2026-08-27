# FormuLab FVL-05 — GPT Prompt 000008

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.006 — Extractor: stability studies/results — CORRECTIVE CYCLE

FVL-05.006 was independently reopened by:
docs/audits/FVL05-GPT-AUDIT-000007.md

Read and execute that audit completely before editing.
Do not start FVL-05.007 or any later task.
Do not use Autopilot, subagents, or background agents.
Do not rewrite history, force-push, destructive-reset/clean, or touch unrelated dirty files.
Do not mutate real user/business/laboratory data.

IMPORTANT OWNERSHIP RULE:
All files under docs/audits/FVL05-GPT*.md and docs/prompts/FVL05*.md are GPT-owned and READ-ONLY for Claude.
Do not edit, append, reconstruct, reconcile, rename, or overwrite them.
Record Claude implementation evidence only in the normal tracker, current handoff, and the existing FVL-05 external log.

======================================================================
MANDATORY CORRECTIVE SCOPE
======================================================================

The current FVL-05.006 implementation omits the persisted StabilityCondition and StabilityTimePoint records that give StabilitySample.conditionId / timePointId their real domain meaning.

This is not optional cleanup. It is the blocking finding in AUDIT_FVL05_GPT_000007.

Before changing code, independently re-read current source and verify the audit against:

- packages/shared/src/schemas/stability.ts
- packages/shared/src/engine/stability.ts
- apps/desktop/src-tauri/src/masterdata.rs
- all current stability create/update/read/write call paths that establish how study.conditionIds, study.timePointIds, sample.conditionId, and sample.timePointId are used
- packages/shared/src/schemas/dataset.ts
- packages/shared/src/engine/formulaVersionStabilityDatasetExtractor.ts
- its tests
- tracker/handoff/external log

Do not blindly implement the audit wording if current source proves a materially different contract. If current source contradicts any audit sub-point, document the exact evidence and preserve source truth. However, the existing log's claim that reading a condition live would retroactively reinterpret measured history is already contradicted by the current stability.ts source comment and must not remain current truth unless the source itself has changed.

======================================================================
REQUIRED SOURCE-CONTRACT CORRECTION
======================================================================

1. Add the real persisted StabilityCondition and StabilityTimePoint pools to the extractor input if current source confirms they are separate persisted collections, as expected from the current schema/storage model.

2. Resolve every StabilitySample.conditionId and StabilitySample.timePointId by exact identity.

3. Fail closed on:
   - duplicate StabilityCondition ids;
   - duplicate StabilityTimePoint ids;
   - missing condition referenced by a supplied sample;
   - missing time point referenced by a supplied sample;
   - any other proven contradictory reference discovered during source recovery.

4. Study membership must be evidence-based:
   StabilityStudy persists conditionIds/timePointIds, while sample generation consumes StabilityCondition[]/StabilityTimePoint[] and writes their ids into samples.
   Determine from the actual current writer/lifecycle paths whether a sample condition/time point is REQUIRED to appear in its owning study's conditionIds/timePointIds.
   - If proven: enforce it and fail closed on mismatch.
   - If not proven: do not invent the invariant; document why not.

5. Preserve the actual referenced condition/time-point source records in the FVL-05.006 dataset payload using canonical schema reuse/composition, not hand-remodeling.

6. Preserve the real hierarchy without unnecessary duplication. A good design may keep each study's referenced conditions/time points once and samples/results nested separately, as long as:
   - every sample's exact condition/time-point identity remains clear;
   - canonical source records remain available in the row;
   - deterministic ordering is defined;
   - no contributing source identity is lost.

7. Add exact lineage citations for every contributing StabilityCondition and StabilityTimePoint source record.
   Use exact sourceRecordId.
   Do not set parentRecordId unless current source proves those identities are parent-scoped.

8. Preserve canonical StabilityCondition evidence exactly, including fields actually present in source such as:
   - code / label
   - temperatureC / temperatureToleranceC
   - humidityPercent / humidityTolerancePercent
   - lightCondition
   - orientation
   - freezeThawCycleDefinition
   - customInstructions
   - verificationStatus / active

9. Preserve canonical StabilityTimePoint evidence exactly, including:
   - code / label
   - daysFromStart
   - custom
   - notes

10. Keep condition/time-point context structurally separate from StabilityResult measured actuals. Never turn planned/configuration/reference fields into measured result values.

11. Preserve the already-correct FVL-05.006 behavior unless the fresh whole-scope audit proves another real defect:
   - study/formula-version linkage
   - formulation conflict handling
   - sample->study and result->sample resolution
   - result/sample redundant-field cross-validation
   - revision-chain integrity
   - timestamp validation and deterministic ordering
   - global source identity where currently proven
   - canonical StabilitySample/StabilityResult reuse
   - non-mutation / non-aliasing
   - row validation
   - StabilityTrend exclusion as computed-only

12. DATASET VERSION:
   The corrective payload adds missing source-record shape to the FVL-05.006 row.
   Re-read the standing version rule in dataset.ts/current tracker.
   If it remains the existing rule, bump DATASET_SCHEMA_VERSION from the current 1.3 to the next explicit version and update all directly affected symbolic/version tests consistently.
   Do not rewrite historical version evidence.

======================================================================
REQUIRED TESTS
======================================================================

Add focused synthetic tests for at least:

- one valid study/sample/result with resolved condition and time point;
- exact StabilityCondition field preservation;
- exact StabilityTimePoint field preservation;
- missing condition reference fails closed;
- missing time-point reference fails closed;
- duplicate condition id fails closed;
- duplicate time-point id fails closed;
- multiple samples sharing the same condition/time point remain deterministic without duplicate/ambiguous lineage;
- exact condition/time-point source lineage;
- Unicode/delimiter-rich ids;
- condition/time-point input reordering does not change normalized output;
- returned condition/time-point nested objects do not alias source objects;
- input non-mutation on success and new failure paths;
- JSON round-trip + row-schema revalidation;
- public export remains valid;
- canonical schema referential-identity/parity guarantee for condition/time-point schemas;
- rejection of every superseded dataset version after the corrective bump;
- study-membership mismatch tests only if source recovery proves that invariant.

Then perform a fresh whole-scope adversarial audit of FVL-05.006. Do not treat the new tests or old 51/51 count as automatic proof.

======================================================================
VALIDATION / CLOSURE
======================================================================

Run fresh from the final corrected state:

- focused FVL-05.006 tests;
- all relevant FVL-05 dataset/extractor tests;
- full @formulab/shared suite;
- full desktop suite;
- shared typecheck;
- desktop typecheck;
- desktop lint;
- python scripts/validate_v1_tracker.py;
- git diff --check.

Run Rust/Python runtime checks only if corresponding source areas are actually changed or source recovery proves they are needed.

Update only FVL-05.006 current truth in:
- docs/FORMULAB_V1_TASK_TRACKER.md
- docs/handoffs/FORMULAB_V1_CURRENT.md
- existing FVL-05 external log

Make the earlier unsupported condition/time-point exclusion rationale clearly historical/superseded. Do not silently leave conflicting 'current truth' prose.

Do not edit any GPT audit/prompt file.

Commit and push only task-owned changes. Verify final local HEAD == remote branch HEAD.

Then rerun the repository's native desktop build/shortcut gate from final pushed HEAD:
- ensure no stale formulab.exe lock;
- verify real tauri build exit code;
- verify fresh executable;
- verify Desktop\FormuLab.lnk TargetPath/WorkingDirectory/arguments;
- launch-smoke through the real shortcut;
- stop the smoke process afterward.

Do not claim manual UI acceptance unless the user actually performs it.

Only when the corrective finding is genuinely resolved and all gates pass may you state:

FVL-05.006 — IMPLEMENTATION AND ACCEPTANCE COMPLETE

Then state:
NEXT TASK — FVL-05.007 NOT STARTED

Do not start FVL-05.007 in this session.
```
