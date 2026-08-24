# FormuLab FVL-05 — GPT Audit 000007

Date: 2026-08-24
Scope: independent re-audit of FVL-05.006 only
Task: `FVL-05.006 — Extractor: stability studies/results`
Audited implementation commit: `d0ee0e4fcafe0ee82d40567f417ee6a2fb67dd8f`

## Verdict

**FVL-05.006 — CONTINUE / REOPEN**

**FVL-05.007 MUST NOT START.**

The implementation is strong in most areas, but one HIGH source-contract defect remains: the extractor drops the persisted `StabilityCondition` and `StabilityTimePoint` source records that define the real environmental and temporal context of every stability sample/result.

## Finding 1 — HIGH — Persisted StabilityCondition / StabilityTimePoint sources are omitted and their references are not validated

### What the current implementation does

The current extractor accepts pools for:

- `StabilityStudy`
- `StabilitySample`
- `StabilityResult`

It preserves `sample.conditionId` / `sample.timePointId` and cross-checks the denormalized copies on each `StabilityResult` against its resolved sample.

However, it does **not** accept or resolve the actual persisted `StabilityCondition` / `StabilityTimePoint` records, does not fail closed when a sample points to a missing condition/time point, does not cite those source records in lineage, and does not emit the actual condition/time-point evidence into the dataset row.

The result is a historical row containing opaque ids without the persisted records that give those ids their domain meaning.

### Why this violates the governing prompt

`docs/prompts/FVL05-GPT-PROMPT-000007.md` explicitly required source recovery and preservation for:

- stability samples/time points/conditions
- sample identity scope
- storage-condition identity
- time-point identity

Its mandatory rules further require:

- preserving the real hierarchy rather than flattening study/sample/condition/time-point/result identity;
- preserving storage conditions and time points where canonical source records store them;
- failing closed on missing/dangling required source references.

The current extractor cannot satisfy those rules because it has no condition/time-point pools to resolve against.

### Direct source evidence

`packages/shared/src/schemas/stability.ts` defines both as real canonical record schemas:

- `stabilityConditionSchema`
- `stabilityTimePointSchema`

`StabilityStudy` persists `conditionIds` and `timePointIds` specifically as references into the shared `stability_conditions` and `stability_time_points` collections.

Most importantly, the authoritative source comment directly contradicts the implementation/log rationale used to exclude them. The schema says that a condition's own label/tolerance is **fine to read live since it does not retroactively change what was already measured**.

The FVL-05.006 log instead says resolving those catalogs would risk a later edit silently reinterpreting an already-measured historical result. That rationale is not supported by current source and is the inverse of the schema's own documented contract.

`packages/shared/src/engine/stability.ts` supplies additional concrete evidence: `generateStabilitySamples(study, conditions, timePoints)` creates each `StabilitySample` from actual `StabilityCondition` and `StabilityTimePoint` records. It copies `condition.id` and `timePoint.id` into the sample, and computes the sample `dueDate` from `timePoint.daysFromStart`.

Therefore these are causal persisted source records for the sample's environment/schedule, not decorative display catalogs.

### Required correction

Before closing FVL-05.006:

1. Extend the extractor input with the authoritative persisted `StabilityCondition[]` and `StabilityTimePoint[]` pools, using the actual current source/storage contracts.
2. Build exact-id lookups and fail closed on duplicate condition/time-point ids.
3. Resolve every supplied sample's `conditionId` and `timePointId` exactly; fail closed on missing references.
4. Independently determine from current source whether each sample's condition/time point must also belong to its owning study's `conditionIds` / `timePointIds`. If the current writer/lifecycle contract proves that membership is required, fail closed on contradictions and test it. Do not invent the rule if source does not prove it.
5. Preserve the actual referenced condition/time-point records in the dataset payload using canonical schema composition/reuse. A per-study deduplicated representation is acceptable if it preserves the real hierarchy and exact identities; avoid wasteful duplication if the same record is referenced by several samples.
6. Add `stabilityCondition` / `stabilityTimePoint` source-record lineage citations for every contributing record, with exact ids and no fabricated `parentRecordId` if they are true top-level identities.
7. Preserve actual condition evidence such as temperature/tolerance, humidity/tolerance, light condition, orientation, freeze-thaw definition/custom instructions, and actual time-point evidence such as `daysFromStart`, label/code/notes, exactly as canonical source schemas define them. Do not reinterpret these as measured result values.
8. Keep `StabilityCondition` / `StabilityTimePoint` context distinct from `StabilityResult` measured actuals.
9. Because the corrected FVL-05.006 dataset row shape changes, apply the standing dataset-version rule consistently. If the current version entering the correction is `1.3`, the corrected row shape requires the next explicit version bump unless direct current repository evidence proves the standing rule has changed.
10. Update FVL-05.006 tracker/handoff/external-log current truth so the earlier unsupported exclusion rationale is clearly superseded rather than left as current truth.

### Required adversarial tests

At minimum add focused synthetic coverage for:

- valid condition + time-point resolution;
- exact canonical condition fields preserved;
- exact canonical time-point fields preserved;
- missing referenced condition fails closed;
- missing referenced time point fails closed;
- duplicate condition id fails closed;
- duplicate time-point id fails closed;
- two samples referencing the same condition/time point do not create ambiguous or duplicate lineage;
- condition/time-point lineage uses exact source ids;
- delimiter-rich / Unicode ids remain unambiguous;
- input reordering does not change normalized output;
- output/source non-aliasing for embedded condition/time-point objects;
- canonical schema referential-identity/parity proof for any reused schemas;
- dataset-version rejection of every superseded literal after the corrective shape change;
- study-membership contradiction tests if and only if source recovery proves that invariant.

Then re-run the complete FVL-05.006 whole-scope adversarial audit, not only the new tests.

## What was independently re-verified as sound

The following portions of the current FVL-05.006 implementation were not found defective in this audit and should not be casually rewritten:

- exact formula-version -> study linkage via `sourceType === "saved_version"` + exact `sourceFormulaVersionId`;
- owning-formulation conflict handling;
- global identity treatment for study/sample/result based on their top-level persistence model;
- exact sample -> study and result -> sample resolution;
- cross-validation of result `studyId` / `conditionId` / `timePointId` against the resolved sample;
- canonical chronology validation for study/sample/result ordering keys;
- deterministic locale-independent ordering;
- `StabilityResult.revisesResultId` fail-closed checks for dangling, cross-sample, self-reference, and cycles;
- canonical `stabilitySampleSchema` / `stabilityResultSchema` reuse;
- row-level Zod validation;
- non-mutation / non-aliasing strategy;
- exclusion of computed `StabilityTrend` from persisted-source extraction;
- no start of FVL-05.007.

## Closure condition

Do not mark FVL-05.006 audit-closed until current GitHub source independently demonstrates that the persisted condition/time-point references and evidence are preserved and validated according to the authoritative repository contract, all required regression/adversarial checks are green, docs are truthful, changes are pushed, and the native build/shortcut gate is rerun from final pushed HEAD.
