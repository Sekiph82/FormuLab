# FormuLab FVL-05 — GPT Audit 000010

## Scope
Independent closure re-audit of FVL-05.007 corrective cycle on branch `feature/laboratory-stability` after Audit 000009 / Prompt 000010.

## Evidence reviewed
- Corrective external-log section for FVL-05.007.
- Current GitHub commit `82f49e08ea83aaa4e5c214e1a2f12082af1336a7`.
- Current `packages/shared/src/engine/formulaVersionDoeDatasetExtractor.ts`.
- Original governing Prompt 000009 and corrective Audit 000009 / Prompt 000010 contract.

## Prior blocking finding
Audit 000009 found that `DoeRun.factorSettings[].factorCode` was preserved but never resolved against the owning design's frozen `factorSnapshot`, while frozen factor/response snapshots themselves were not proven internally unambiguous and study/revision-consistent before being used as interpretive dictionaries.

## Independent closure verification
Current source now contains `buildDesignSnapshotIndex(design)` and fails closed when:
- a frozen factor's `studyId` / `studyRevision` contradicts the owning design;
- a frozen response's `studyId` / `studyRevision` contradicts the owning design;
- the same `factorCode` appears more than once inside one design's `factorSnapshot`;
- the same response id appears more than once inside one design's `responseSnapshot`.

`buildRunsByDesignId` now resolves every persisted `run.factorSettings[].factorCode` against the owning design's proven-unambiguous frozen factor dictionary and fails closed with `doe_run_factor_code_not_found` when absent. Persisted `codedValue` / `actualValue` are preserved, not recomputed.

`buildObservationsByRunId` now resolves `responseId` through the owning design's proven-unambiguous frozen response map rather than an ambiguity-blind `.some(...)` scan.

No live factor/response pool was substituted for frozen design evidence. No dataset schema-version bump was made because this corrective cycle changed validation only, not emitted row shape. That is consistent with the standing versioning rule.

The corrective log records 68/68 focused FVL-05.007 tests, 89 files / 2033 shared tests, 167 files / 1726 desktop tests, both typechecks, lint, tracker validation, diff check, push parity, fresh Tauri build, shortcut verification, and automated launch smoke. The corrective implementation commit exists and matches the described source changes.

## Verdict
**CLOSE / ACCEPT FVL-05.007.**

The HIGH finding from Audit 000009 is closed. No new blocker was found in the corrective source reviewed.

## Next task
FVL-05.008 may now begin. Do not start FVL-05.009 until FVL-05.008 is independently audited and closed.
