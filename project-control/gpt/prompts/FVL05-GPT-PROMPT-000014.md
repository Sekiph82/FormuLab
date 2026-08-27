# FormuLab FVL-05 — GPT Prompt 000014

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.009 corrective cycle

Do not start FVL-05.010 or any later task.
Do not use Autopilot, subagents, or background agents.
Do not rewrite history, force-push, destructive-reset/clean, or touch unrelated dirty files.
Do not mutate real user/business/laboratory data.

Before editing anything:
1. fetch/pull current branch safely;
2. record git status, branch, local HEAD, remote HEAD, recent commits, staged/unstaged diff;
3. read completely:
   - `.hiveai/PROJECT_DASHBOARD.md`
   - `docs/FORMULAB_V1_TASK_TRACKER.md`
   - `project-control/claude/handoffs/FORMULAB_V1_CURRENT.md`
   - `project-control/gpt/audits/FVL05-GPT-AUDIT-000013.md`
   - this prompt;
4. read the current FVL-05.009 extractor/schema/tests and the FVL-05.007 DOE extractor/tests that established the frozen-snapshot invariants;
5. append corrective evidence to the existing FVL-05 log under `project-control/claude/logs/` rather than creating a duplicate task log.

IMPORTANT OWNERSHIP RULE:
All files under `project-control/gpt/audits/**` and `project-control/gpt/prompts/**` are GPT-owned and READ-ONLY for Claude.
Do not edit, append, reconstruct, reconcile, rename, or overwrite them.

CORRECTIVE FINDING TO CLOSE:

`packages/shared/src/engine/formulaVersionFeatureExtractor.ts` independently re-indexes DOE frozen `factorSnapshot` / `responseSnapshot` to resolve units for FVL-05.009. It already detects duplicate factor codes and duplicate response ids, but it currently does not reject a frozen snapshot child whose persisted `studyId` or `studyRevision` contradicts the owning `DoeDesign`.

The extractor's own error-code union already contains:
- `doe_design_factor_snapshot_conflict`
- `doe_design_response_snapshot_conflict`

Implement those checks rather than inventing a different error model.

Required behavior:
- Before trusting any factor snapshot entry as unit authority, require exact equality:
  - `factor.studyId === design.studyId`
  - `factor.studyRevision === design.studyRevision`
- Otherwise fail closed with `doe_design_factor_snapshot_conflict`.
- Before trusting any response snapshot entry as unit authority, require exact equality:
  - `response.studyId === design.studyId`
  - `response.studyRevision === design.studyRevision`
- Otherwise fail closed with `doe_design_response_snapshot_conflict`.
- Preserve existing duplicate factor-code / duplicate response-id checks.
- Preserve exact persisted run/observation values. Never recompute them.
- Do not use live DOE factor/response pools as fallback.
- This is validation-only unless direct source inspection proves otherwise. Do not bump `FEATURE_SCHEMA_VERSION` or `DATASET_SCHEMA_VERSION` for this finding alone.

Mandatory tests, without weakening or deleting existing tests:
- wrong factor snapshot `studyId` -> `doe_design_factor_snapshot_conflict`;
- wrong factor snapshot `studyRevision` -> same code;
- wrong response snapshot `studyId` -> `doe_design_response_snapshot_conflict`;
- wrong response snapshot `studyRevision` -> same code;
- valid frozen snapshot still normalizes correctly;
- duplicate factor/response ambiguity checks still work;
- exact raw/canonical normalization behavior unchanged;
- non-mutation on each new failure path;
- output/source non-aliasing remains true;
- FEATURE_SCHEMA_VERSION unchanged if no schema shape changes;
- DATASET_SCHEMA_VERSION unchanged.

After the focused fix, independently re-audit the whole FVL-05.009 DOE normalization path against FVL-05.007's frozen-snapshot semantics. Do not stop at making tests green.

Run final validation from the FINAL state, including at minimum:
- focused `formulaVersionFeatureExtractor` tests;
- relevant dataset/feature schema tests;
- FVL-05.007 DOE extractor tests;
- full @formulab/shared suite;
- full desktop regression suite;
- shared typecheck;
- desktop typecheck;
- desktop lint;
- `python scripts/validate_v1_tracker.py`;
- `git diff --check`.

Update only the FVL-05.009 corrective truth in:
- `docs/FORMULAB_V1_TASK_TRACKER.md` if necessary for accurate current status/evidence;
- `project-control/claude/handoffs/FORMULAB_V1_CURRENT.md`;
- the existing FVL-05 log under `project-control/claude/logs/`.

Do not edit GPT audit/prompt files.
Do not alter `.hiveai/PROJECT_DASHBOARD.md` unless a path is actually broken by this corrective task; no dashboard architecture changes are authorized.

Commit and push only task-owned changes. Verify final local HEAD equals `origin/feature/laboratory-stability`.

Then run the repository's existing native desktop build/shortcut acceptance gate from the final pushed HEAD: stale-process check, real Tauri build exit code, fresh `formulab.exe`, `Desktop\FormuLab.lnk` TargetPath, native launch smoke, then stop the smoke-test process.

Do not claim manual UI acceptance unless the user actually performs it.

When complete, report:
FVL-05.009 CORRECTIVE IMPLEMENTATION COMPLETE — PENDING GPT AUDIT

Then state:
FVL-05.010 NOT STARTED
```
