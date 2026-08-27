# FormuLab FVL-05 — GPT Audit 000009

## Scope
Independent source-level re-audit of **FVL-05.007 — Extractor: DOE studies/runs/observations** after Claude's implementation commit `d7fa96f8dd35686a0170e40aa982d0e5577b2774`.

## Verdict
**FVL-05.007 — CONTINUE / REOPEN**

**FVL-05.008 MUST NOT START.**

## Blocking finding

### HIGH — DoeRun.factorSettings and frozen DoeDesign snapshots are not referentially validated

The extractor correctly resolves:
- DoeStudy -> baseline FormulationVersion
- DoeDesign -> DoeStudy/revision
- DoeRun -> DoeDesign/study/revision
- DoeObservation -> DoeRun/study/revision
- DoeObservation.responseId -> owning design.responseSnapshot

However, current source shows `DoeRun.factorSettings[]` carries `factorCode`, while the owning `DoeDesign.factorSnapshot[]` is explicitly the frozen authoritative source for interpreting those settings. The extractor currently preserves `factorSettings` verbatim but does **not** resolve each `factorCode` against the owning design's frozen `factorSnapshot`.

Therefore a persisted run can contain a factor setting whose `factorCode` is absent from the frozen design and the row still validates/emits. That leaves historical run values with no authoritative factor meaning and violates the governing requirement to preserve real DOE hierarchy and fail closed on required source relationships.

A second related integrity gap exists inside the frozen snapshots themselves. `DoeFactor` / `DoeResponse` snapshot records carry `studyId` + `studyRevision`, but the extractor does not currently prove that those snapshot records belong to the owning `DoeDesign`'s own `studyId` / `studyRevision`. Duplicate/ambiguous snapshot identities/codes are likewise not rejected before they are used for interpretation. The current observation check uses `responseSnapshot.some(...)`, which is not sufficient when duplicate response identities are present.

## Required correction

1. Treat each design's frozen `factorSnapshot` and `responseSnapshot` as authoritative referential dictionaries for run/observation interpretation.
2. For each `DoeDesign`, fail closed if any frozen factor/response snapshot record contradicts the design's own `studyId` / `studyRevision`.
3. Fail closed on ambiguous duplicate factor identity/code where ambiguity would make `DoeRun.factorSettings[].factorCode` resolution non-unique.
4. Fail closed on ambiguous duplicate response identity where `DoeObservation.responseId` resolution would be non-unique.
5. Resolve every `DoeRun.factorSettings[].factorCode` exactly against the owning design's frozen `factorSnapshot`; fail closed when missing or ambiguous.
6. Preserve `codedValue` / `actualValue` exactly; do not recompute them.
7. Keep current correct observation-response resolution, but make it exact/unambiguous rather than `some(...)`-only.
8. Do not introduce live `doe_factors` / `doe_responses` pools merely to solve this. The frozen design snapshots remain the historical source of truth unless current source proves otherwise.
9. Update tracker/handoff/external log so the prior FVL-05.007 completion claim is superseded by this corrective cycle.
10. Dataset row shape itself need not change if the correction is validation-only; do **not** bump `DATASET_SCHEMA_VERSION` unless the emitted schema actually changes.

## Required tests

Add focused adversarial tests for at least:
- run factorCode missing from design.factorSnapshot -> fail closed;
- duplicate factorCode in one factorSnapshot -> fail closed;
- factor snapshot child with wrong studyId -> fail closed;
- factor snapshot child with wrong studyRevision -> fail closed;
- response snapshot child with wrong studyId/studyRevision -> fail closed;
- duplicate response id in one responseSnapshot -> fail closed;
- valid exact factorCode resolution preserves codedValue/actualValue unchanged;
- delimiter-rich / Unicode factor codes remain exact and deterministic;
- input non-mutation on every new failure path;
- output remains non-aliased;
- existing FVL-05.007 tests remain green.

Also independently audit whether `constraintSnapshot` contains any referential identity that is necessary to interpret emitted run/observation evidence. Do not add checks merely because fields exist; enforce only what current source proves is semantically required.

## Independently re-verified as sound

The following portions of FVL-05.007 were source-checked and should not be casually rewritten:
- `baselineFormulaVersionId` as the study-to-version link;
- owning `formulationId` check;
- preservation of multiple study revisions;
- preservation of multiple designs per study;
- design/run/observation top-level global identity treatment;
- study/design supersession dangling/self/cycle checks;
- run -> design and observation -> run study/revision contradiction checks;
- observation -> frozen responseSnapshot resolution concept;
- `linkedFormulaVersionId` existence validation;
- preserve-but-do-not-invent validation for currently unwritten optional trial/result links;
- deterministic ordering;
- canonical timestamp validation;
- dataset schema version `1.5` for the FVL-05.007 row shape;
- row-level Zod validation;
- non-mutation / non-aliasing strategy;
- exclusion of DoeAnalysis / DoeCandidate / DoeReviewAction from raw measured evidence scope.

## Next state

**FVL-05.007 remains open.**

**FVL-05.008 is blocked from starting until a new GPT audit closes FVL-05.007.**
