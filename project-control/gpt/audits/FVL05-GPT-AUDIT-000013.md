# FormuLab FVL-05 — GPT Audit 000013

Date: 2026-08-27
Branch audited: `feature/laboratory-stability`
Implementation commit audited: `31537998893ec9cddab3b6db3111d604568b2532`
Governing prompt: `project-control/gpt/prompts/FVL05-GPT-PROMPT-000013.md`

## Verdict

**CONTINUE / REOPEN FVL-05.009**

FVL-05.009 is not accepted yet. FVL-05.010 remains blocked.

## Independent source finding

The actual current source in `packages/shared/src/engine/formulaVersionFeatureExtractor.ts` was inspected rather than accepting the Claude cycle log at face value.

The FVL-05.009 extractor correctly re-validates duplicate DOE factor/response identities before resolving units, but it does not fully preserve the frozen-snapshot integrity contract established and closed in FVL-05.007.

`FormulaVersionFeatureExtractionErrorCode` already declares:

- `doe_design_factor_snapshot_conflict`
- `doe_design_response_snapshot_conflict`

However, `buildDoeUnitIndex(design)` currently validates only:

- duplicate `factorSnapshot[].factorCode`
- duplicate `responseSnapshot[].id`

It does **not** validate that each frozen factor/response snapshot child's persisted `studyId` and `studyRevision` agree with the owning `DoeDesign.studyId` / `DoeDesign.studyRevision` before those snapshot entries are trusted as the unit authority for run factor settings and observations.

This matters because FVL-05.009 explicitly accepts caller-supplied `FormulaVersionDoeRow` input and deliberately does not trust that the row necessarily came through the FVL-05.007 extractor. Therefore it must independently re-establish every snapshot invariant required for safe unit resolution, not only duplicate identity.

Without the missing check, a malformed caller-supplied DOE row can contain a factor or response snapshot child belonging to a different study revision while still being used to normalize `DoeRun.factorSettings[].actualValue` or `DoeObservation.value`. That silently crosses frozen historical contexts instead of failing closed.

## Required correction

Correct FVL-05.009 only.

At minimum:

1. In the FVL-05.009 DOE snapshot indexing path, validate every `factorSnapshot` child against the owning design's exact `studyId` and `studyRevision` before inserting it into the factor dictionary.
2. Fail closed with the already-declared `doe_design_factor_snapshot_conflict` code on any contradiction.
3. Validate every `responseSnapshot` child against the owning design's exact `studyId` and `studyRevision` before inserting it into the response dictionary.
4. Fail closed with the already-declared `doe_design_response_snapshot_conflict` code on any contradiction.
5. Preserve the existing duplicate-factor-code and duplicate-response-id checks.
6. Do not weaken FVL-05.007 semantics and do not fall back to live DOE factor/response pools.
7. Do not recompute or alter persisted DOE values. This is a validation-only correction.
8. Do not bump `FEATURE_SCHEMA_VERSION` or `DATASET_SCHEMA_VERSION` unless an actual row/schema shape change is independently proven. This finding does not require one.

## Mandatory focused tests

Add adversarial tests proving at least:

- factor snapshot child with wrong `studyId` fails with `doe_design_factor_snapshot_conflict`;
- factor snapshot child with wrong `studyRevision` fails with `doe_design_factor_snapshot_conflict`;
- response snapshot child with wrong `studyId` fails with `doe_design_response_snapshot_conflict`;
- response snapshot child with wrong `studyRevision` fails with `doe_design_response_snapshot_conflict`;
- valid frozen snapshots continue to normalize correctly;
- duplicate factor/response ambiguity behavior remains unchanged;
- failure paths do not mutate inputs;
- returned output remains non-aliased to input;
- dataset/feature schema versions remain unchanged if the correction is validation-only.

Then rerun the full FVL-05.009 validation gates from the final state.

## Scope boundary

- FVL-05.009: **CORRECTIVE / REOPENED**
- FVL-05.010: **MUST NOT START**

Do not perform target-variable work in this corrective cycle.
