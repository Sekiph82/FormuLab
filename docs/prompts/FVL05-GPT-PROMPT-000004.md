# FormuLab FVL-05 — GPT Prompt 000004

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.004

DO NOT start FVL-05.005 yet.
DO NOT use Autopilot or subagents.
DO NOT force-push, rewrite history, reset/clean unrelated work, or touch unrelated dirty files.
DO NOT mutate real user/business data.

First fetch/pull the latest branch state, then read and execute:

- docs/audits/FVL05-GPT-AUDIT-000003.md
- docs/prompts/FVL05-GPT-PROMPT-000004.md

Also inspect the current repository truth directly, especially:

- packages/shared/src/schemas/dataset.ts
- docs/FORMULAB_V1_TASK_TRACKER.md
- docs/handoffs/FORMULAB_V1_CURRENT.md
- the existing FVL-05 external log under docs/external-logs

IMPORTANT OWNERSHIP RULE:
All docs/audits/FVL05-GPT*.md and docs/prompts/FVL05-GPT*.md files are GPT-owned and READ-ONLY for Claude.
Do not edit, append, reconstruct, reconcile, or overwrite them.

This cycle should be documentation/current-truth correction only unless direct repository inspection proves another real defect.

Required corrections from AUDIT 000003:
1. FVL-05.001 tracker text must stop presenting DATASET_SCHEMA_VERSION and FEATURE_SCHEMA_VERSION as both currently 1.0. Current truth is dataset 1.1, feature 1.0; historical initial values may be retained if clearly labeled historical.
2. FVL-05.002 tracker text must reflect optional parentRecordId and duplicate identity `(sourceEntity, parentRecordId, sourceRecordId)` while preserving exact child sourceRecordId semantics.
3. dataset.ts top-level module comment must stop saying the module defines only version constants; it now also contains later FVL-05 lineage/row schemas.

Search for equivalent stale current-truth claims introduced by these same changes in tracker/handoff/current source comments and correct only genuine contradictions. Do not rewrite historical external-log chronology merely because old states existed.

After corrections:
- re-audit FVL-05.004 once more from source truth;
- run focused and full shared tests;
- run shared + desktop typechecks;
- run desktop lint and desktop regression tests;
- run tracker validator;
- run git diff --check;
- update tracker/handoff/existing external FVL-05 log truthfully;
- commit and push;
- verify local HEAD == origin/feature/laboratory-stability;
- run the repository-required native build/shortcut gate from final pushed HEAD.

If and only if no unresolved implementation or current-truth documentation defect remains, close FVL-05.004 and leave FVL-05.005 NOT STARTED in this session.
```
