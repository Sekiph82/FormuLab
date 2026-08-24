# FormuLab FVL-05 — GPT Audit 000008

## Scope

Independent GPT source audit of the FVL-05.006 corrective cycle governed by:

- `docs/audits/FVL05-GPT-AUDIT-000007.md`
- `docs/prompts/FVL05-GPT-PROMPT-000008.md`

Task audited:

`FVL-05.006 — Extractor: stability studies/results`

Branch:

`feature/laboratory-stability`

Corrective implementation commit independently confirmed in GitHub:

`5dbbcb3365dd83eb98fbfb96d3d17535197aa024`

## Verdict

**CLOSE / ACCEPT FVL-05.006**

The HIGH finding from `AUDIT_FVL05_GPT_000007` is closed in current source. No new FVL-05.006 blocker was found in this audit.

FVL-05.007 may begin next. FVL-05.008 must not begin until FVL-05.007 is independently closed.

## Independent source findings

### 1. StabilityCondition / StabilityTimePoint source context is now actually resolved

Current `formulaVersionStabilityDatasetExtractor.ts` requires:

- `stabilityConditions: StabilityCondition[]`
- `stabilityTimePoints: StabilityTimePoint[]`

It constructs exact-id maps and fails closed on duplicate catalog identities.

Every `StabilitySample.conditionId` and `StabilitySample.timePointId` must resolve to those pools. Missing references now fail closed with dedicated structured errors instead of surviving as opaque unverified ids.

### 2. Study-membership enforcement is supported by current writer paths

The corrective cycle did not merely invent a new restriction.

Current production sample generation in `StabilityPanel.tsx` filters `SEED_STABILITY_CONDITIONS` and `SEED_STABILITY_TIME_POINTS` by the selected study's `conditionIds` / `timePointIds` before calling `generateStabilitySamples`.

Current Data Exchange protocol import in `dataExchangeCommit.ts` starts from the existing study arrays and only `Set.add(...)`s recognized canonical condition/time-point ids before writing the updated study. The inspected write path does not remove existing membership.

Therefore the extractor's fail-closed checks:

- `stability_sample_condition_not_in_study`
- `stability_sample_time_point_not_in_study`

are supported by the current repository's real write semantics and are not arbitrary post-hoc assumptions.

### 3. Dataset schema now carries the missing source meaning

`DATASET_SCHEMA_VERSION` is now `1.4`.

`stabilityStudySamplesSchema` now includes:

- `conditions: z.array(stabilityConditionSchema)`
- `timePoints: z.array(stabilityTimePointSchema)`

Both canonical source schemas are reused directly rather than retyped.

The extractor emits only the condition/time-point records actually referenced by that study's samples, deterministically ordered by opaque id. Each sample keeps its exact `conditionId` / `timePointId` join keys.

This preserves actual sample/result context without presenting unrelated study configuration as measured evidence.

### 4. Lineage behavior is correct

The extractor cites:

- `stabilityStudy`
- `stabilitySample`
- `stabilityResult`
- `stabilityCondition`
- `stabilityTimePoint`

with exact persisted/catalog ids.

Condition/time-point citations are deduplicated across the entire formula-version row, which is required because the same global catalog record can legitimately be referenced by multiple linked studies and the lineage schema rejects an exact duplicate source triple.

No `parentRecordId` is fabricated for these entities because their true identities are global, not parent-scoped.

### 5. Existing FVL-05.006 integrity rules remain intact

Current source still independently shows:

- exact formula-version -> stability-study linkage via `sourceType === "saved_version"` + exact `sourceFormulaVersionId`;
- owning-formulation conflict rejection;
- pool-wide duplicate study/sample/result rejection;
- dangling sample -> study and result -> sample rejection;
- result denormalized `studyId` / `conditionId` / `timePointId` cross-validation against the resolved sample;
- canonical timestamp validation before chronological ordering;
- deterministic locale-independent ordering;
- `StabilityResult.revisesResultId` validation for dangling, cross-sample, self-reference and longer cycles;
- row-level `safeParse` against `formulaVersionStabilityRowSchema`;
- no generated lineage ids;
- no output/source mutable aliasing after schema parsing.

### 6. Version bump is warranted

The corrective cycle adds required fields to the FVL-05.006 row shape, so `1.3 -> 1.4` is consistent with the standing FVL-05 dataset version rule. Current schema source exposes `DATASET_SCHEMA_VERSION = "1.4"`.

### 7. Corrective commit exists and matches the audited source

GitHub commit:

`5dbbcb3365dd83eb98fbfb96d3d17535197aa024`

exists and describes the same corrective source changes found in the current branch.

The uploaded cycle log reports fresh validation from that final state:

- focused FVL-05.006: 65/65
- FVL dataset/extractor focused group: 194/194
- full shared: 88 files / 1965 tests
- full desktop: 167 files / 1726 tests
- shared + desktop typecheck: clean
- desktop lint: clean
- tracker validator: clean
- `git diff --check`: clean
- native Tauri build exit 0
- shortcut launch smoke PASS
- manual UI acceptance correctly left pending

This audit does not treat those counts alone as proof; they are consistent with the independently inspected source fixes above.

## No new blocker found

I did not find a remaining FVL-05.006 defect that justifies another corrective cycle.

The prior HIGH finding is closed.

## Closure

**FVL-05.006 — GPT AUDIT CLOSED / ACCEPTED**

**NEXT TASK — FVL-05.007 — Extractor: DOE studies/runs/observations**

**FVL-05.008 — NOT STARTED**

---

Ownership: this file is GPT-authored and **READ-ONLY for Claude**. Claude may read it but must not edit, append, reconcile, rename, reconstruct or overwrite it.