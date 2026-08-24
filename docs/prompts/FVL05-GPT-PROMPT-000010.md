# FormuLab FVL-05 — GPT Prompt 000010

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.007 — corrective cycle

Read completely before editing:
- docs/audits/FVL05-GPT-AUDIT-000009.md
- docs/prompts/FVL05-GPT-PROMPT-000010.md
- docs/prompts/FVL05-GPT-PROMPT-000009.md for the original FVL-05.007 contract

All GPT audit/prompt files are READ-ONLY for Claude.
Do not edit, append, reconstruct, rename, reconcile, or overwrite them.

FVL-05.008 MUST NOT START.

Correct only the FVL-05.007 defects identified by GPT audit 000009, after independently re-reading current source to confirm the contract.

Required focus:
1. Resolve every DoeRun.factorSettings[].factorCode exactly against its owning DoeDesign.factorSnapshot.
2. Fail closed on missing or ambiguous factorCode resolution.
3. Validate frozen factorSnapshot and responseSnapshot child studyId/studyRevision against the owning design.
4. Fail closed on duplicate/ambiguous snapshot identities/codes wherever they make run/observation interpretation ambiguous.
5. Keep observation.responseId resolution exact and unambiguous.
6. Preserve persisted factor codedValue/actualValue exactly; never recompute them.
7. Do not add live doe_factors/doe_responses pools unless current source proves they are required; frozen design snapshots are the historical authority.
8. Audit constraintSnapshot only for source-proven integrity requirements; do not invent checks.
9. Do not bump DATASET_SCHEMA_VERSION unless emitted row shape actually changes.
10. Preserve all portions Audit 000009 lists as independently sound.

Add adversarial tests required by Audit 000009 and rerun the complete FVL-05.007 validation, full shared suite, desktop regression, typechecks, lint, tracker validation and git diff check.

Update only tracker/handoff/existing FVL-05 external log for Claude evidence.
Commit/push task-owned changes, verify local HEAD == remote HEAD, then rerun the existing native build/shortcut/smoke gate from final pushed HEAD.

Do not claim manual UI acceptance unless the user actually performs it.

Only after every corrective gate passes may you state:
FVL-05.007 — IMPLEMENTATION AND ACCEPTANCE COMPLETE

Then state:
NEXT TASK — FVL-05.008 NOT STARTED
```
