# FormuLab FVL-05 — GPT Audit 000003

**Date:** 2026-08-23  
**Branch:** `feature/laboratory-stability`  
**Scope:** FVL-05.004 closure re-audit after AUDIT_FVL05_GPT_000002  
**Implementation reference:** `413431523cf47c9c96335b84cc51f659f47064e6`

## Verdict

**CONTINUE FVL-05.004 for one documentation/current-truth correction cycle only. Do not start FVL-05.005 yet.**

The two substantive findings from `AUDIT_FVL05_GPT_000002` are genuinely fixed in current source:

- `DATASET_SCHEMA_VERSION` is now `"1.1"`, and the superseded `"1.0"` literal is rejected.
- `processStepPlanSchema` and `processStepActualObservationSchema` are now derived from canonical `trialProcessStepSchema` via Zod `.pick()`/`.extend()`, with the renamed `processStepId` reusing the source `id` schema object.
- `PARITY1` remains as the new-field membership guard, and `PARITY2` proves selected-field schema-object identity.

No new FVL-05.004 implementation defect was found in this re-audit.

However, the repository's current control-plane documentation is still internally stale after the version/lineage changes, so the acceptance claim `tracker/handoff present one unambiguous current truth` is not yet fully satisfied.

---

## Finding 1 — Tracker FVL-05.001 still states both dataset and feature schema versions are `1.0`

Current source says:

```ts
DATASET_SCHEMA_VERSION = "1.1"
FEATURE_SCHEMA_VERSION = "1.0"
```

But `docs/FORMULAB_V1_TASK_TRACKER.md` FVL-05.001 still says:

> `DATASET_SCHEMA_VERSION`/`FEATURE_SCHEMA_VERSION` are separate literal `"1.0"` constants

That is no longer current truth after commit `4134315`.

### Required correction

Update the FVL-05.001 tracker status text so it distinguishes the historical initial value from the current values:

- dataset schema: current `1.1` after FVL-05.004 corrective bump;
- feature schema: still `1.0`;
- preserve the fact that FVL-05.001 originally introduced both at `1.0` if historical context is useful, but do not present both as current.

Do not alter the task's completion state.

---

## Finding 2 — Tracker FVL-05.002 still describes the pre-parentRecordId lineage contract

The current shared lineage schema is:

```ts
{
  sourceEntity,
  sourceRecordId,
  parentRecordId?: string
}
```

and exact duplicates are rejected by the triple:

```text
(sourceEntity, parentRecordId, sourceRecordId)
```

But the FVL-05.002 tracker row still says `sourceRecordReferenceSchema` is only `sourceEntity + sourceRecordId` and that duplicate detection is on `(sourceEntity, sourceRecordId)` pairs.

That is stale current-truth documentation after the FVL-05.004 nested-lineage correction.

### Required correction

Update the FVL-05.002 tracker status text to reflect the additive `parentRecordId` contract accurately:

- `sourceRecordId` remains the exact persisted child id;
- `parentRecordId` is optional and used only for parent-scoped embedded records;
- duplicate lineage identity is the exact triple `(sourceEntity, parentRecordId, sourceRecordId)`;
- same child id under different parents is legitimate.

Preserve FVL-05.002's historical purpose and completion state.

---

## Finding 3 — dataset.ts top-level module comment is now stale

The top comment still says:

> This module defines the two versions only — not the dataset row shape ... That is FVL-05.002 onward.

That statement described the file at FVL-05.001 creation time, but the same module now contains FVL-05.002/.003/.004 row and lineage schemas.

This is not a runtime defect, but it is misleading source documentation in the exact file being treated as the authoritative schema contract.

### Required correction

Rewrite only the stale top-level historical sentence so it truthfully explains that the module began with the two version constants in FVL-05.001 and was subsequently extended by later FVL-05 tasks with lineage and row schemas.

Do not change behavior merely to satisfy prose.

---

## Closure decision

Implementation status: **functionally acceptable based on this audit**.

Acceptance/documentation status: **not yet fully closed** because current tracker/source comments still contradict the actual `1.1` and `parentRecordId` contracts.

Required next cycle is documentation-only unless direct repository inspection reveals another real defect while correcting these stale claims.

After correcting the three items above, rerun the normal focused/full validation and final pushed-HEAD/build/shortcut gate required by the repository process. If no new defect appears, FVL-05.004 may then be closed and FVL-05.005 may become the next task.

## Ownership rule

All GPT audit/prompt files are GPT-owned and **READ-ONLY for Claude**. Claude must not edit, append, reconstruct, reconcile, or overwrite them.
