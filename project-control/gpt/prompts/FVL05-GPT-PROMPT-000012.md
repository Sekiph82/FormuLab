# FormuLab FVL-05 — GPT Prompt 000012

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.008 corrective cycle

Do not start FVL-05.009 or any later task.
Do not edit any GPT-owned audit/prompt file.

Before editing:
1. fetch/pull current branch safely;
2. read completely:
   - docs/audits/FVL05-GPT-AUDIT-000011.md
   - docs/prompts/FVL05-GPT-PROMPT-000012.md
   - docs/audits/FVL05-GPT-AUDIT-000010.md
   - docs/prompts/FVL05-GPT-PROMPT-000011.md
3. inspect current source directly, especially:
   - packages/shared/src/engine/formulaVersionCorrectiveCostContextDatasetExtractor.ts
   - its focused test file
   - packages/shared/src/schemas/correctiveActions.ts
   - LaboratoryTrial and StabilityStudy schemas/writers
   - dataset schema/version tests
   - tracker/handoff/external FVL-05 log.

Fix ONLY the blocking FVL-05.008 finding from Audit 000011 unless direct current-source evidence reveals a tightly related defect.

Required behavior:
- `CorrectiveAction.sourceRecordId` is currently resolved against BOTH `LaboratoryTrial.id` and `StabilityStudy.id` namespaces.
- Resolve both candidate lookups before choosing a target.
- neither match -> existing not-found error;
- exactly one match -> current valid behavior;
- both match -> FAIL CLOSED with a dedicated structured ambiguity error. Never silently prefer trial because it was checked first.
- Do not use `sourceType` as a discriminator unless current authoritative writer/domain evidence proves it has that meaning. The prior source recovery concluded it does not.
- Preserve exact source ids and existing lineage semantics.
- Do not change emitted row shape unless absolutely required. If row shape does not change, keep DATASET_SCHEMA_VERSION at 1.6.

Add adversarial tests for the collision case, unique-resolution cases, non-mutation, and input-order independence. Do not weaken existing tests.

Then rerun from final state:
- focused FVL-05.008 tests;
- affected dataset/version tests;
- full @formulab/shared tests;
- full desktop tests;
- shared + desktop typecheck;
- desktop lint;
- tracker validator;
- git diff --check;
- final commit/push with local HEAD == remote HEAD;
- native Tauri release build, shortcut verification, launch smoke.

Update only FVL-05.008 current truth in tracker/handoff/existing external log. GPT files are READ-ONLY.

Only after every gate passes may you state:
FVL-05.008 — IMPLEMENTATION AND ACCEPTANCE COMPLETE
NEXT TASK — FVL-05.009 NOT STARTED

Do not start FVL-05.009 in this session.
```
