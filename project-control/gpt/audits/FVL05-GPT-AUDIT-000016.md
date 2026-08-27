# FormuLab FVL-05 — GPT Audit 000016

## Scope

Independent re-audit of FVL-05.010 after the corrective cycle governed by:
- `project-control/gpt/audits/FVL05-GPT-AUDIT-000015.md`
- `project-control/gpt/prompts/FVL05-GPT-PROMPT-000016.md`

Implementation commit audited directly:
- `03f92cc12de36eeae2b2be8315bdb9570466c281`

Evidence-only follow-up commit:
- `6d4cdc9dea839ca12baa8d7167fc30e31a69f391`

The audit is based on current repository source, not Claude's cycle-log narrative.

## Verdict

**CLOSE / ACCEPT FVL-05.010**

FVL-05.011 is cleared to start.
FVL-05.012 and later tasks remain out of scope.

## Corrective findings re-checked

### Finding A — derived ReplicateStats were incorrectly emitted as target labels

CLOSED.

Current `formulaVersionTargetExtractor.ts` no longer emits `ReplicateStats.mean`, `minimum`, `maximum`, or `standardDeviation` as independent target observations. Numeric `TestResult` / `StabilityResult` targets are emitted only from actual `replicates[].numericValue` entries. This now matches `replicateStatsSchema`'s canonical source contract that those statistics are computed from the replicates and persisted as reporting cache while the replicates remain source of truth.

No synthetic aggregation was introduced in the correction.

### Finding B — TestResult target identity discarded persisted measurement context

CLOSED.

Current `targetDefinitionSchema` / extractor behavior now distinguishes persisted `TestResult.timePoint` and `TestResult.storageCondition` as target-identity dimensions. The extractor preserves `sampleId`, `instrument`, and `methodSnapshot` as observation-instance context instead of silently discarding them or incorrectly promoting them into target identity.

The schema enforces these fields only where semantically applicable. Stability target identity remains `testDefinitionId + conditionId + timePointId`; DOE target identity remains response-based and unchanged.

## Additional independent checks

- Planned/spec/objective values remain excluded from labels.
- DOE frozen response-snapshot integrity checks remain fail-closed.
- DOE `missing` / `invalid` / `excluded` observations remain non-label evidence.
- Explicit zero / false / empty-valid values remain distinct from missing where the source schema permits them.
- Revision/retest multiplicity remains preserved; no latest-wins collapse was introduced.
- Row-level and per-observation lineage remain exact.
- FVL-05.009 predictor semantics remain separate from target extraction.
- Target-row construction remains Zod validated before return.
- No input mutation or target/source aliasing regression was introduced by the corrective changes.
- `FEATURE_SCHEMA_VERSION` bump `1.1 -> 1.2` is correct because the corrective cycle changed the serialized target-family contract by adding target-definition/context fields. `DATASET_SCHEMA_VERSION` correctly remains `1.6`.
- FVL-05.011 was not started in the audited corrective implementation.

## Validation evidence reviewed

Claude's final cycle evidence records:
- focused FVL-05.010: 52/52
- relevant FVL-05.005/.006/.007 regression: 182/182
- FVL-05.009 feature extractor regression: 46/46
- full shared suite: 92 files / 2182 tests
- desktop suite: 167 files / 1726 tests
- shared + desktop typecheck: clean
- desktop lint: clean
- tracker validator: clean
- `git diff --check`: clean
- native Tauri build exit code 0
- desktop shortcut verification + launch smoke: PASS

These counts are supporting evidence only; closure is based on the direct source re-audit above.

## Task boundary

Canonical tracker next task:

`FVL-05.011 | Dataset hash/fingerprint + reproducible rebuild from source records | FVL-05.009 | YES`

FVL-05.011 may start.
Do not start FVL-05.012 in the same implementation session.

**FVL-05.010 — CLOSED / ACCEPTED**

**NEXT: FVL-05.011 MAY START**
