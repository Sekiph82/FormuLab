# FormuLab FVL-05 — GPT Audit 000014

Date: 2026-08-27
Branch audited: `feature/laboratory-stability`
Task: `FVL-05.009`
Corrective implementation commit: `7459fc0dffdc4cde134390d1e8235a2c48ddc42b`
Governing corrective prompt: `project-control/gpt/prompts/FVL05-GPT-PROMPT-000014.md`
Prior audit: `project-control/gpt/audits/FVL05-GPT-AUDIT-000013.md`

## Verdict

**CLOSE / ACCEPT FVL-05.009**

The corrective implementation closes the blocking frozen-DOE-snapshot integrity finding from Audit 000013. FVL-05.009 is accepted.

## Independent verification

The Claude cycle log was not accepted at face value. The actual GitHub implementation commit and current source were inspected directly.

Verified in `packages/shared/src/engine/formulaVersionFeatureExtractor.ts`:

1. `buildDoeUnitIndex()` now validates every `DoeFactor` child in `factorSnapshot` against its owning `DoeDesign.studyId` and `DoeDesign.studyRevision` before using that factor as unit authority.
2. Contradiction fails closed with `doe_design_factor_snapshot_conflict`.
3. Duplicate factor-code ambiguity remains independently checked after the ownership/revision check with `duplicate_doe_design_factor_code`.
4. Every `DoeResponse` child in `responseSnapshot` is likewise checked against owning design `studyId`/`studyRevision` before its unit can be trusted.
5. Contradiction fails closed with `doe_design_response_snapshot_conflict`.
6. Duplicate response-id ambiguity remains independently checked with `duplicate_doe_design_response_id`.
7. The corrective implementation also found and closed the same integrity gap one level higher: a nested `DoeDesign` is now cross-checked against the `DoeStudy` wrapper it is contained under before the design is trusted. A mismatch fails closed with `doe_design_study_conflict`.
8. Frozen design snapshots remain the sole DOE unit authority. No live factor/response lookup fallback was introduced.
9. Persisted `factorSettings.actualValue`, coded values, and observation values are not recomputed by the correction.
10. The correction changes validation/relationship semantics only; `FEATURE_SCHEMA_VERSION` remains `1.0` and `DATASET_SCHEMA_VERSION` remains `1.6`, which is correct because no feature-row or dataset-row field shape changed.

## Validation evidence

The corrective cycle records:

- focused FVL-05.009 tests: 46/46;
- FVL-05.007 DOE extractor regression tests: 68/68;
- full shared suite: 91 files / 2129 tests;
- full desktop suite: 167 files / 1726 tests;
- shared typecheck: clean;
- desktop typecheck: clean;
- desktop lint: clean;
- tracker validator: clean, 171 unique tasks;
- `git diff --check`: clean;
- native Tauri build: exit 0;
- desktop shortcut target verification: pass;
- native launch smoke: pass;
- final local HEAD equals remote branch HEAD at `7459fc0dffdc4cde134390d1e8235a2c48ddc42b`.

The current external log correctly ends the corrective session as `PENDING GPT AUDIT` and explicitly states FVL-05.010 was not started.

## Tracker truth

The canonical tracker currently defines the next task as:

`FVL-05.010 | Exact target-variable definitions (per product family / measured response) | FVL-05.009 | YES`

FVL-05.010 may now begin under a new GPT-owned prompt.

## Final status

- **FVL-05.009 — CLOSED / ACCEPTED**
- **FVL-05.010 — AUTHORIZED NEXT / NOT STARTED**
- **FVL-05.011 — MUST NOT START during the FVL-05.010 implementation session**
