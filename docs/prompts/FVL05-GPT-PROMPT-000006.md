# FormuLab FVL-05 — GPT Prompt 000006

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.005 — Extractor: LaboratoryTrial + TestResult

Do NOT start FVL-05.006.
Do NOT reopen FVL-05.004.
Do NOT use Autopilot, subagents, or background agents.
Do NOT rewrite history, force-push, destructive-reset/clean, or touch unrelated dirty files.
Do NOT mutate real user/business/laboratory data.

Before editing anything:

1. fetch/pull the latest branch state safely;
2. record branch, git status, local HEAD, remote HEAD, staged/unstaged diff;
3. read:
   - docs/audits/FVL05-GPT-AUDIT-000005.md
   - docs/prompts/FVL05-GPT-PROMPT-000006.md
   - docs/prompts/FVL05-GPT-PROMPT-000005.md
   - current tracker, handoff, and existing FVL-05 external log;
4. inspect the current source of:
   - packages/shared/src/schemas/testDefinitions.ts
   - packages/shared/src/engine/testResults.ts
   - packages/shared/src/engine/formulaVersionTestResultDatasetExtractor.ts
   - its test file
   - any authoritative writer/reader that establishes `revisesResultId` and `retestOf` semantics.

IMPORTANT OWNERSHIP RULE:
All files under docs/audits/FVL05-GPT*.md and docs/prompts/FVL05*.md are GPT-owned and READ-ONLY for Claude.
Do not edit, append, reconstruct, reconcile, rename, or overwrite them.
Record implementation evidence only in the tracker, current handoff, and the existing FVL-05 external log.

======================================================================
REQUIRED CORRECTION
======================================================================

Resolve only AUDIT_FVL05_GPT_000005 Finding 1.

The current extractor preserves `revisesResultId` and `retestOf` but does not validate those TestResult-to-TestResult references.

Recover their exact repository semantics first. Do not invent rules.

Then implement the narrowest fail-closed referential-integrity validation supported by source authority.

At minimum, where the relationship is authoritative:

- referenced TestResult id must resolve exactly once in the supplied pool;
- same-trial requirement must be enforced unless current source explicitly proves cross-trial linkage is legitimate;
- self-reference must fail closed;
- detect cycles only if acyclicity is proven by current repository semantics;
- preserve every valid historical TestResult separately, never collapse revisions/retests;
- add truthful structured error code/context for each new failure class;
- do not weaken any existing FVL-05.005 validation.

If `retestOf` differs semantically from `revisesResultId`, implement and document those differences explicitly.

======================================================================
MANDATORY TESTS
======================================================================

Add adversarial tests for the recovered authoritative semantics, including at least:

- valid `revisesResultId` chain passes and remains fully preserved;
- dangling `revisesResultId` fails closed;
- cross-trial `revisesResultId` behavior is explicitly decided from source and tested;
- self-revising result fails closed;
- valid `retestOf` behavior is explicitly decided from source and tested;
- dangling/cross-trial/self `retestOf` cases according to source semantics;
- cycle case if acyclicity is authoritative;
- source non-mutation on new failure paths;
- input reordering remains deterministic;
- structured error identity fields are truthful.

Then perform a fresh whole-scope FVL-05.005 re-audit after the fix. Do not treat the new tests as automatic proof of completeness.

======================================================================
VALIDATION / CLOSURE
======================================================================

Run from final corrected state:

- focused FVL-05.005 tests;
- relevant dataset/schema tests;
- full `@formulab/shared` test suite;
- full desktop regression suite;
- shared typecheck;
- desktop typecheck;
- desktop lint;
- tracker validator;
- `git diff --check`.

Run Rust/Python checks only if actually required by touched source.

Update only:
- FVL-05.005 tracker current truth;
- current handoff;
- existing FVL-05 external log.

Do not edit GPT-owned audit/prompt files.

Commit and push only task-owned changes. Verify local HEAD == remote branch HEAD.

Then rerun the native Tauri release build, verify the real exit code, fresh executable, Desktop\FormuLab.lnk TargetPath, and native launch smoke from the final pushed HEAD. Stop the smoke-test process afterward.

Do not claim manual UI acceptance unless the user performs it.

Only if the fresh whole-scope audit finds no remaining defect may you state:

FVL-05.005 — IMPLEMENTATION AND ACCEPTANCE COMPLETE

Then state:
NEXT TASK — FVL-05.006 NOT STARTED

Do not start FVL-05.006 in this session.
```
