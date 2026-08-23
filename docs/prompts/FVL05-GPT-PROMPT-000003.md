# FormuLab FVL-05 — GPT Prompt 000003

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.004 — Process plan + actual process observations extractor

DO NOT start FVL-05.005.
DO NOT use Autopilot or subagents.
DO NOT rewrite history, force-push, reset/clean unrelated work, or touch unrelated dirty files.
DO NOT mutate real user/business data.

Before doing anything, pull/fetch current repository truth and read these files FIRST:

- docs/audits/FVL05-GPT-AUDIT-000002.md
- docs/prompts/FVL05-GPT-PROMPT-000003.md
- docs/audits/FVL05-GPT Audits.md
- docs/prompts/FVL05 Prompts.md
- docs/FORMULAB_V1_TASK_TRACKER.md
- docs/handoffs/FORMULAB_V1_CURRENT.md
- the existing FVL-05 external log under docs/external-logs (locate the real current filename; do not create a duplicate merely because historical names differ)

IMPORTANT OWNERSHIP RULE:
All GPT audit/prompt files listed above are READ-ONLY for Claude.
Do not edit, append, reconstruct, reconcile, or overwrite them.
Your implementation evidence belongs only in the tracker, handoff, and existing external FVL-05 log.

The governing GPT verdict is:
FVL-05.004 — REOPENED / CONTINUE
FVL-05.005 — NOT STARTED

Repository source contracts override prior COMPLETE claims and log prose.

======================================================================
1. RECOVER EXACT CURRENT TRUTH
======================================================================

Run and record:

git status --short
git branch --show-current
git fetch origin
git rev-parse HEAD
git rev-parse origin/feature/laboratory-stability
git log --oneline --decorate -20
git diff
git diff --staged

If local and remote differ, reconcile safely without losing unrelated dirty work.

Read the relevant source directly, especially:

- packages/shared/src/schemas/dataset.ts
- packages/shared/src/schemas/laboratory.ts
- packages/shared/src/engine/formulaVersionProcessDatasetExtractor.ts
- packages/shared/src/engine/formulaVersionProcessDatasetExtractor.test.ts
- packages/shared/src/engine/dataExchangeRegistry.ts
- packages/shared/src/engine/dataExchangeCommit.ts
- packages/shared/src/schemas/dataExchange.ts
- packages/shared/src/schemas/formulation.ts
- packages/shared/src/index.ts

Also recover the original FVL-05.001 versioning contract from tracker/history/source, not only the latest FVL-05.004 comments.

======================================================================
2. RESOLVE AUDIT 000002 FINDING 1 — DATASET VERSIONING CONTRACT
======================================================================

Current source contains two conflicting rules:

A) the original comment above DATASET_SCHEMA_VERSION says to bump when a dataset-row field is added/removed/renamed by FVL-05.003-.008;

B) later FVL-05.004 prose says version 1.0 stays unchanged until rows become externally consumed/persisted/exported.

Do not accept both.

Determine the authoritative FVL-05.001 rule from pre-existing repository contract/history.

If row-shape changes require a version bump now:
- implement the smallest correct bump/compatibility change;
- update all affected schemas/tests/fixtures consistently;
- use the existing versioning/migration architecture only where actually applicable;
- prove old/new identity cannot be ambiguous.

If FVL-05 1.0 is genuinely an unfrozen initial construction phase:
- prove that from a pre-existing authoritative contract, not merely from zero current consumers or a newly-added comment;
- rewrite the conflicting documentation/tests so ONE rule remains authoritative and future FVL-05 tasks know exactly when 1.0 freezes and when the next bump is required.

Do not close this finding with usage inference alone.

======================================================================
3. RESOLVE AUDIT 000002 FINDING 2 — REAL SCHEMA PARITY, NOT KEY PARITY
======================================================================

Current PARITY1 checks only field names. It does not detect semantic drift in defaults, optionality, enums, refinements, nested constraints, etc.

Examples visible today:
- trialProcessStepSchema.phase = z.string().default("A")
- processStepPlanSchema.phase = z.string()
- trialProcessStepSchema.requiredEquipment = z.array(z.string()).default([])
- processStepPlanSchema.requiredEquipment = z.array(z.string())

Those differences may be intentional for extracted output, but current PARITY1 cannot prove or guard that intent.

Prefer deriving plan/actual schemas from the canonical `trialProcessStepSchema` using Zod composition:

- separate plan and actual `.pick()` calls are allowed to include the same source field such as `stepNumber` in BOTH schemas;
- `id` can be deliberately renamed by omitting/picking it separately and extending with `processStepId`;
- preserve the existing honest plan-vs-actual split;
- preserve attachment handling and all already-fixed behavior.

The prior claim that `pick()` cannot work because `stepNumber` appears in both views is not valid. Two independent picks can each include the same canonical field.

If any selected field truly cannot be composition-derived, add semantic contract tests that fail when the source field's parse behavior/default/optional/enum/refinement changes while the dataset view remains stale.

The final guard must catch BOTH:
- newly added source fields;
- semantic constraint changes to already-selected source fields.

Do not weaken schemas just to make tests pass.

======================================================================
4. REGRESSION RE-AUDIT
======================================================================

After fixing both findings, re-read the whole FVL-05.004 implementation and verify that prior fixes remain intact:

- process_parameters authoritative natural key and ambiguity handling;
- exact sourceRecordId plus structural parentRecordId nested lineage;
- saved_version missing/blank sourceFormulaVersionId fail-closed behavior;
- same-trial TrialObservation.processStepId referential integrity;
- attachment-only actual evidence;
- formula-code ambiguity handling;
- locale-independent deterministic ordering;
- timestamp validation;
- truthful structured error identities;
- no plan/actual conflation;
- no cross-trial/cross-formula leakage;
- source non-mutation and no output/source aliasing;
- public exports remain coherent.

Add focused regression tests for any changed mechanism. Do not remove or weaken existing coverage unless a test is demonstrably asserting a superseded wrong contract; if changed, explain why.

======================================================================
5. DOCUMENTATION
======================================================================

Update ONLY Claude-owned/current implementation evidence locations:

- docs/FORMULAB_V1_TASK_TRACKER.md
- docs/handoffs/FORMULAB_V1_CURRENT.md
- the existing FVL-05 external log

Make current truth easy to read without requiring readers to reverse stale historical claims.

DO NOT edit any GPT audit or GPT prompt file.

======================================================================
6. REQUIRED VERIFICATION
======================================================================

Run fresh from the final implementation state:

pnpm --filter @formulab/shared exec vitest run src/engine/formulaVersionProcessDatasetExtractor.test.ts
pnpm --filter @formulab/shared exec vitest run
pnpm --filter @formulab/shared exec tsc --noEmit
pnpm --filter @formulab/desktop exec tsc --noEmit
pnpm --filter @formulab/desktop lint
pnpm --filter @formulab/desktop exec vitest run
python scripts/validate_v1_tracker.py
git diff --check

Run any additional versioning-focused test(s) required by your chosen resolution.

Then inspect git diff carefully and confirm FVL-05.005 is untouched.

======================================================================
7. COMMIT / PUSH / NATIVE BUILD GATE
======================================================================

Commit only the relevant FVL-05.004 changes and documentation evidence.
Push to:
origin/feature/laboratory-stability

Verify:
git rev-parse HEAD
git rev-parse origin/feature/laboratory-stability

They must match.

Then run the required fresh native Tauri release build from that final pushed HEAD and verify the existing Desktop\FormuLab.lnk still targets the freshly-built formulab.exe correctly. Perform the same native launch smoke gate used by prior FVL-05 cycles if applicable.

Record exact results in the existing external log.

======================================================================
8. STOP CONDITION
======================================================================

Only declare:
FVL-05.004 — IMPLEMENTATION AND ACCEPTANCE COMPLETE

if BOTH Audit 000002 findings are genuinely resolved and every verification/build/push/shortcut gate passes.

Then state:
NEXT TASK — FVL-05.005 NOT STARTED

Do not start FVL-05.005 in this session.
```
