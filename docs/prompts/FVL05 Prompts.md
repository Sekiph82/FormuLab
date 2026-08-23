# FormuLab FVL-05 — GPT Prompt Ledger

> Every GPT-authored Claude Code prompt for FVL-05 is appended here until FVL-05 is fully complete.

## PROMPT_FVL05_GPT_000001 — Reopen and harden FVL-05.004 after post-AUDIT_000018 audit

```text
Continue FormuLab manually in the EXISTING repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:

feature/laboratory-stability

CURRENT TASK ONLY:

FVL-05.004 — Process plan + actual process observations extractor

DO NOT start FVL-05.005.
DO NOT perform any Autopilot work.
DO NOT create Drive handoff/audit/prompt files.
This is a normal manual Claude Code session.

IMPORTANT: FVL-05.004 is REOPENED by independent GPT audit AUDIT_FVL05_GPT_000001.
The previous `FVL-05.004 — IMPLEMENTATION AND ACCEPTANCE COMPLETE` claim is NOT authoritative.
Repository source contracts and executable tests override tracker/handoff/log prose.

No subagents.
No background agents.
No plan mode.
No force push.
No history rewrite.
No destructive git reset/clean.
Do not touch unrelated dirty files.
Do not mutate real user/business data.

======================================================================
1. RECOVER EXACT CURRENT TRUTH
======================================================================

Before editing anything run:

git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/feature/laboratory-stability
git log --oneline --decorate -20
git diff
git diff --staged

Read directly, not only tracker/log summaries:

- docs/FORMULAB_V1_TASK_TRACKER.md
- docs/handoffs/FORMULAB_V1_CURRENT.md
- docs/audits/FVL05-GPT Audits.md
- docs/prompts/FVL05 Prompts.md
- docs/external-logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md
- packages/shared/src/schemas/dataset.ts
- packages/shared/src/schemas/laboratory.ts
- packages/shared/src/schemas/dataExchange.ts
- packages/shared/src/schemas/formulation.ts
- packages/shared/src/engine/formulaVersionProcessDatasetExtractor.ts
- packages/shared/src/engine/formulaVersionProcessDatasetExtractor.test.ts
- packages/shared/src/engine/dataExchangeRegistry.ts
- the actual Data Exchange commit/storage implementation for `process_parameters`
- apps/desktop/src/components/formula/ProcessParametersPanel.tsx
- apps/desktop/src-tauri/src/masterdata.rs
- packages/shared/src/index.ts

Also inspect the exact FVL-05.001 versioning contract and any migration/version compatibility mechanism that applies to dataset rows.

Do not assume file names from historical prose if repository paths changed. Search the repo and follow actual imports/callers.

======================================================================
2. FIX / RESOLVE DATASET SCHEMA VERSION COMPATIBILITY
======================================================================

Independent GPT audit found that AUDIT_000018 remediation added required field:

plannedProcedure: z.array(processParameterSchema)

to `formulaVersionProcessRowSchema` while `DATASET_SCHEMA_VERSION` remained `"1.0"`.

But `dataset.ts`'s own FVL-05.001 documentation says the dataset schema version must bump when a dataset row field is added/removed/renamed.

Resolve from source contract, not convenience.

You MUST determine whether `DATASET_SCHEMA_VERSION` must now change.

If it must bump:

- make the smallest correct version/migration/compatibility change required by the existing versioning architecture;
- do not invent a parallel migration system;
- add tests proving old/new schema identity is unambiguous;
- inspect every existing FVL-05.003/.004 test or fixture whose literal version must change;
- ensure downstream public exports and parsers remain coherent.

If it legitimately must NOT bump:

- prove that from an explicit repository contract showing the current `1.0` row shape is still pre-release/unfrozen construction and that adding FVL-05.004 fields is intentionally part of the same initial version;
- add a durable comment/test explaining that rule so a future extractor does not make an inconsistent choice.

Do not leave this as an undocumented assumption.

======================================================================
3. ALIGN `process_parameters` IDENTITY WITH THE AUTHORITATIVE SOURCE CONTRACT
======================================================================

The Data Exchange registry explicitly defines:

naturalKey: ["formula_code", "formula_version", "step_number"]
duplicatePolicy: "create_or_update"
updatePolicy: "(formula_code, formula_version, step_number) updates the existing step."

Current FVL-05.004 ambiguity logic instead keys the supplied pool by `ProcessParameter.code`.

This is not proven equivalent.

Trace the REAL source identity end to end:

1. `processParameterSchema`
2. Data Exchange registry template definition
3. validation / preview natural-key logic
4. commit handler / existing-record resolution
5. persisted masterdata collection semantics
6. real reader `ProcessParametersPanel`
7. any code-generation rule for `ProcessParameter.code`

Then make FVL-05.004 use the exact authoritative identity semantics.

At minimum test the adversarial case:

- same `formulaCode`
- same `formulaVersion`
- same `stepNumber`
- DIFFERENT `code`

The extractor must not silently emit two authoritative copies of one natural-key step.

Also determine whether `code` is globally unique by contract. Do not reject unrelated rows globally merely because two `code` values collide unless source truth makes that collision invalid.

Lineage for a `processParameter` must cite a real persisted identity, not a guessed surrogate.

======================================================================
4. RECONCILE COLLISION-SAFE NESTED LINEAGE WITH FVL-05.002 EXACT-ID CONTRACT
======================================================================

Current fix:

encodeNestedLineageId(parentId, recordId) = JSON.stringify([parentId, recordId])

is collision-safe and recoverable, but FVL-05.002 documents `sourceRecordId` as the exact opaque persisted source record id, never reformatted.

Do not regress collision safety.
Do not return to delimiter concatenation.
Do not invent random/surrogate IDs.

Instead inspect the lineage contract and implement the smallest structurally correct representation that can express parent-scoped embedded records while preserving the exact child ID.

Possible direction only if consistent with repository architecture:

- keep `sourceRecordId` = exact `step.id` / `observation.id`;
- add explicit parent scope / nested record address metadata;
- make duplicate detection use the complete addressable identity.

Do not blindly follow that suggestion if a better existing repository primitive exists.

If lineage schema shape changes, re-run the FVL-05.001 dataset-version decision from section 2.

Required tests:

LINEAGE-A: two linked trials reuse same step id and both validate.
LINEAGE-B: two linked trials reuse same observation id and both validate.
LINEAGE-C: delimiter/unicode-rich ids cannot collide.
LINEAGE-D: exact child persisted id remains directly present in lineage.
LINEAGE-E: exact parent identity remains directly present/recoverable.
LINEAGE-F: exact duplicate full nested identity fails closed.
LINEAGE-G: source non-mutation and deterministic ordering remain true.

======================================================================
5. ENFORCE THE SAVED-VERSION TRIAL LINK INVARIANT
======================================================================

`laboratoryTrialSchema` currently comments that `sourceFormulaVersionId` is required when `sourceType === "saved_version"`, but verify whether Zod actually enforces that conditional rule.

If it does not, current extractor behavior can silently ignore malformed source data:

sourceType = "saved_version"
sourceFormulaVersionId = undefined

Do not silently classify that contradiction as an irrelevant trial.

Choose the correct source-of-truth layer:

- if the LaboratoryTrial schema should enforce this invariant globally, fix it there only if doing so is backward-compatible with persisted data and within the frozen task's legitimate correction scope;
- otherwise fail closed inside this extractor with a dedicated structured error.

Inspect existing persisted-data compatibility before tightening a canonical schema.

Add tests for:

TRIALLINK1: saved_version missing sourceFormulaVersionId.
TRIALLINK2: working_draft may legitimately omit sourceFormulaVersionId.
TRIALLINK3: mismatched projectId still fails closed.
TRIALLINK4: unrelated valid saved-version trials stay ignored.

======================================================================
6. VALIDATE `TrialObservation.processStepId` REFERENTIAL INTEGRITY
======================================================================

When `TrialObservation.processStepId` is undefined, the observation may be trial-level and is valid.

When it IS defined, resolve it against the owning trial's process-step identity scope.

Fail closed if:

- the referenced step does not exist;
- the referenced step identity is ambiguous.

Do not fabricate a link and do not silently drop the observation.

Add tests for:

OBSREF1: observation with no processStepId remains valid.
OBSREF2: valid processStepId is preserved.
OBSREF3: dangling processStepId fails closed.
OBSREF4: duplicate step identity inside trial still fails closed before reference resolution.

======================================================================
7. CREATE A FIELD-BY-FIELD SOURCE -> DATASET DISPOSITION AUDIT
======================================================================

Re-audit `TrialProcessStep` against BOTH dataset views:

- processStepPlanSchema
- processStepActualObservationSchema

For EVERY authoritative source field, record one of:

- planned dataset field (exact mapping)
- actual dataset field (exact mapping)
- intentionally excluded, with source-backed reason
- identity/provenance-only

Do not say "parity proven" without this matrix.

Pay special attention to:

- attachments
- createdAt
- updatedAt
- requiredEquipment
- status
- unplanned
- skipReason
- viscosityUnit
- operator
- observation
- deviationNote

`TrialProcessStep.attachments` are currently not present in either dataset view. Decide from the FVL-05.004 contract whether that is correct.

If execution attachments are part of actual process evidence, preserve them and ensure an attachment-only step is not silently omitted.

If intentionally excluded, document why and lock that decision with a test.

Prefer schema composition (`pick`/shared sub-schema) over manual re-modeling where it materially reduces future drift without making the code less clear.

======================================================================
8. HARDEN DETERMINISTIC ORDERING
======================================================================

Audit every sort comparator.

Current code uses `localeCompare` for opaque IDs/codes and lexical comparison for timestamp strings.

Requirements:

- opaque IDs/codes must have locale-independent deterministic ordering across environments;
- do not depend on the machine's ICU/locale for tie-breaking;
- if chronological ordering assumes canonical ISO timestamps, prove that write/schema contracts guarantee lexically sortable canonical timestamps;
- otherwise validate or choose an ordering that does not falsely claim chronology.

Add at least one non-ASCII / delimiter-rich deterministic-order regression test.

======================================================================
9. FIX STRUCTURED ERROR CONTEXT IF SEMANTICALLY WRONG
======================================================================

`FormulaVersionProcessDatasetExtractionError` exposes `formulationVersionId`, but inspect every constructor call.

Do not store a formulation id, trial id, process-parameter code, or unrelated pool identity in a property named `formulationVersionId` merely because the error occurs before a requested version is available.

Use correctly named optional structured context fields or another existing repository error pattern.

Keep messages sanitized: IDs/codes only, no process notes, measurements, or real business text.

Add focused assertions for error code + structured identity context.

======================================================================
10. PROVE FORMULA-CODE UNIQUENESS USED BY PLAN LINKAGE
======================================================================

`process_parameters` links by `formulaCode + formulaVersion + stepNumber`.

FVL-05.004 resolves owning formulations by `Formulation.id`, then uses `Formulation.code` for plan matching.

Find the actual source/storage invariant that makes `Formulation.code` unique.

If uniqueness is enforced, cite the exact source code/test and add a focused extractor assumption test only if useful.

If uniqueness is NOT enforced, add fail-closed ambiguity handling before attributing a `process_parameters` plan to a version.

Never guess which same-code formulation a plan belongs to.

======================================================================
11. CLEAN CURRENT-STATE DOCUMENTATION
======================================================================

Historical chronology may remain in the external log, but current-state docs must not present contradictory active truth.

Fix:

- FVL-05.004 tracker row
- current handoff/pointer block
- external log current-state/closure section

The tracker currently begins with the superseded claim that no persisted independent plan exists and only much later reverses it.

The handoff currently describes the process-parameter natural key incompletely as `(formulaCode, formulaVersion)` even though the registry natural key includes `stepNumber`.

Rewrite current-state summaries so a new engineer can learn the CURRENT architecture without mentally replaying every corrective cycle.

Do not erase historical audit history. Mark superseded conclusions explicitly where needed.

Also append this session's actual outcome to:

- docs/audits/FVL05-GPT Audits.md
- docs/prompts/FVL05 Prompts.md only if you create another Claude prompt during this session

Do not overwrite prior audit entries.

======================================================================
12. REQUIRED TESTS / VERIFICATION
======================================================================

Run fresh from the final source state; do not reuse old counts.

At minimum:

pnpm --filter @formulab/shared exec vitest run src/engine/formulaVersionProcessDatasetExtractor.test.ts
pnpm --filter @formulab/shared exec vitest run src/schemas/dataset.test.ts
pnpm --filter @formulab/shared test
pnpm --filter @formulab/shared exec tsc --noEmit
pnpm --filter @formulab/desktop test
pnpm --filter @formulab/desktop exec tsc --noEmit
pnpm --filter @formulab/desktop lint
python scripts/validate_v1_tracker.py
git diff --check

If canonical Laboratory or Data Exchange source schemas/engines are touched, run every focused suite those files own, not just FVL-05.004 tests.

Run any root `pnpm test` / `pnpm typecheck` commands whose package.json semantics are current and useful, but inspect the scripts first rather than repeating stale assumptions.

No test may be deleted or weakened merely to make the new implementation pass.

======================================================================
13. GIT / DIRTY-WORKTREE SAFETY
======================================================================

Before staging:

git status --short
git diff --name-status
git diff --stat
git diff --check

Stage only files genuinely belonging to this corrective FVL-05.004 cycle.

Do not stage, restore, delete, regenerate, or rewrite unrelated pre-existing dirty files.

Review staged diff:

git diff --staged --check
git diff --staged
git status --short

Commit with a focused FVL-05.004 corrective message.
Push normally to:

origin feature/laboratory-stability

Then prove:

git rev-parse HEAD
git rev-parse origin/feature/laboratory-stability

They must be identical before the native build gate.

======================================================================
14. FRESH NATIVE BUILD / SHORTCUT GATE
======================================================================

Only after final pushed HEAD is verified:

pnpm --filter @formulab/desktop tauri build

Verify fresh executable:

C:\Users\sekip\Desktop\FormuLab\apps\desktop\src-tauri\target\release\formulab.exe

Record:

- size
- modified time
- SHA-256
- final HEAD it was built from

Verify:

C:\Users\sekip\Desktop\FormuLab.lnk

TargetPath must exactly point to the fresh executable.
Verify WorkingDirectory and Arguments.
Launch smoke through the actual shortcut and confirm the expected process path.
Do not claim manual UI acceptance unless the user actually performs it.

======================================================================
15. EXTERNAL LOG / SESSION CHECKPOINT
======================================================================

Before stopping for ANY reason, append truthfully to the current FVL-05 external log.

If incomplete include exactly:

SESSION CHECKPOINT — WORK INCOMPLETE

Record:

- branch
- starting HEAD
- final/current HEAD
- remote HEAD
- exact GPT audit findings addressed
- dataset schema-version decision
- process_parameters authoritative identity/natural-key result
- nested-lineage representation decision
- saved-version trial invariant result
- TrialObservation.processStepId integrity result
- TrialProcessStep field-disposition/parity result
- attachment decision
- deterministic-ordering result
- formula-code uniqueness result
- error-context result
- files changed
- commits
- test commands/counts
- tracker state
- FVL-05.005 NOT STARTED
- build command/result
- executable path/hash
- shortcut verification
- exact remaining work if any

Do not voluntarily stop merely because scope is large. If actual platform/tool/context limitation forces stop, update the log first.

======================================================================
16. STRICT CLOSURE GATE
======================================================================

Do NOT call FVL-05.004 complete unless ALL are true:

[ ] dataset schema-version compatibility resolved from FVL-05.001 contract
[ ] process_parameters authoritative natural key/identity traced end-to-end
[ ] duplicate natural-key process steps fail closed
[ ] ProcessParameter.code semantics proven and not over-assumed
[ ] processParameter lineage cites a real persisted identity
[ ] nested lineage collision-safe
[ ] nested lineage preserves exact child persisted id under FVL-05.002 contract
[ ] nested lineage preserves explicit parent scope
[ ] cross-trial reused nested IDs work
[ ] delimiter/unicode-containing IDs cannot collide
[ ] saved_version => sourceFormulaVersionId invariant enforced/fail-closed
[ ] TrialObservation.processStepId referential integrity enforced when present
[ ] authoritative Laboratory schemas directly inspected
[ ] field-by-field TrialProcessStep disposition matrix completed
[ ] every demonstrated source/dataset mismatch corrected or source-justified
[ ] attachment handling deliberately resolved
[ ] Manufacturing Procedure persistence/linkage question remains proven from actual repository source
[ ] authoritative persisted plan used
[ ] no plan fabricated if no authoritative source exists
[ ] planned and actual values remain structurally separate
[ ] no fabricated actual observations
[ ] exact zero/false/units/optional values preserved
[ ] locale-independent deterministic ordering
[ ] timestamp-order assumption proven or corrected
[ ] exact formula/version/trial linkage
[ ] formula-code uniqueness used by plan linkage proven or ambiguity fails closed
[ ] all ambiguous identities fail closed
[ ] structured error context names match values
[ ] source non-mutation
[ ] no source/output aliasing
[ ] public exports correct
[ ] focused tests green
[ ] full shared tests green
[ ] desktop regression green
[ ] shared/desktop typechecks green
[ ] desktop lint green
[ ] tracker validator green
[ ] git diff --check clean
[ ] tracker/handoff present one unambiguous current truth
[ ] FVL-05.005 untouched
[ ] changes committed
[ ] changes pushed
[ ] local HEAD == remote HEAD
[ ] fresh native build from final pushed HEAD
[ ] Desktop\FormuLab.lnk verified
[ ] external log updated

Only after all are true may you state:

FVL-05.004 — IMPLEMENTATION AND ACCEPTANCE COMPLETE

Then state:

NEXT TASK — FVL-05.005 NOT STARTED

DO NOT start FVL-05.005 in this session.
```
