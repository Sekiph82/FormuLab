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

---

## PROMPT_FVL05_GPT_000002 — Same reopen, differently-structured variant actually pasted to Claude Code this session

This is the exact prompt text the Claude Code session actually received
to open the corrective cycle that produced this same `AUDIT_FVL05_GPT_000001`
resolution — substantively the same audit/scope as
`PROMPT_FVL05_GPT_000001` above, but organized differently (lettered
`FINDING A`-`FINDING J` instead of numbered sections 2-10; different
required-test names — `VERSION1`/`PLANKEY1`/`PLANKEY2`/`FORMCODE1`/
`LINK1`/`OBSREF1`/`OBSREF2`/`ATTACH1`/`PARITY1`/`ORDER1`/`ERROR1` instead
of `TRIALLINK1-4`/`OBSREF1-4`/`LINEAGE-A..G`). Recorded verbatim, not
reconciled into one canonical version, per this file's own "every
GPT-authored prompt is appended" convention.

```text
Continue FormuLab manually in the EXISTING repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:

feature/laboratory-stability

CURRENT TASK ONLY:

FVL-05.004 — Process plan + actual process observations extractor

DO NOT start FVL-05.005.
DO NOT perform any Autopilot work.
This is a normal manual Claude Code session.

IMPORTANT:
A new independent GPT audit has REOPENED FVL-05.004.
The previous statement:

FVL-05.004 — IMPLEMENTATION AND ACCEPTANCE COMPLETE

must NOT be treated as current truth.

Read this audit FIRST:

docs/audits/FVL05-GPT Audits.md

Read the newest FVL-05 corrective prompt ledger too:

docs/prompts/FVL05 Prompts.md

The current GPT verdict is:

CONTINUE / REOPEN FVL-05.004

Repository truth overrides tracker, handoff, external log, prior completion claims, and prior prompts.

Do not merely patch the listed findings mechanically. Re-audit the whole FVL-05.004 contract after fixing them.

======================================================================
1. RECOVER EXACT CURRENT REPOSITORY TRUTH
======================================================================

Before editing anything run:

git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/feature/laboratory-stability
git log --oneline --decorate -20
git diff
git diff --staged

Read directly:

docs/FORMULAB_V1_TASK_TRACKER.md
docs/handoffs/FORMULAB_V1_CURRENT.md
docs/external-logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md
docs/audits/FVL05-GPT Audits.md
docs/prompts/FVL05 Prompts.md

Inspect all relevant current source contracts, including at minimum:

packages/shared/src/schemas/dataset.ts
packages/shared/src/schemas/laboratory.ts
packages/shared/src/schemas/dataExchange.ts
packages/shared/src/schemas/formulation.ts

packages/shared/src/engine/formulaVersionProcessDatasetExtractor.ts
packages/shared/src/engine/formulaVersionProcessDatasetExtractor.test.ts
packages/shared/src/engine/dataExchangeRegistry.ts
packages/shared/src/engine/dataExchangeCommit.ts
packages/shared/src/engine/dataExchangeExisting.ts
packages/shared/src/index.ts

apps/desktop/src/components/formula/ProcessParametersPanel.tsx
apps/desktop/src/lib/masterdata.ts
apps/desktop/src/lib/formulationV2.ts
apps/desktop/src/lib/promoteGeneratedFormula.ts
apps/desktop/src-tauri/src/masterdata.rs

Also search the repository for every writer/reader of:

process_parameters
ProcessParameter
sourceRecordId
TrialProcessStep
TrialObservation
sourceFormulaVersionId
Formulation.code

Do not trust comments alone. Trace executable contracts.

======================================================================
2. FINDING A — DATASET SCHEMA VERSION COMPATIBILITY
======================================================================

GPT audit found a potentially serious versioning defect.

`plannedProcedure` was added as a new required field to
`formulaVersionProcessRowSchema`, while:

DATASET_SCHEMA_VERSION = "1.0"

still remains unchanged.

`dataset.ts` itself states that adding/removing/renaming dataset-row fields
requires the dataset schema version to change.

You must resolve this from the actual FVL-05.001 contract.

Determine whether:

A) DATASET_SCHEMA_VERSION must be bumped now,

OR

B) version 1.0 is still explicitly pre-publication/unfrozen and the complete
FVL-05.003-.008 row shape is intentionally being assembled before 1.0 freezes.

Do not guess.

If a version bump is required:
- implement it correctly;
- inspect migration/compatibility implications;
- update tests;
- do not silently invalidate persisted rows;
- update docs truthfully.

If a bump is NOT required:
- prove that from repository source/spec contracts;
- record the exact evidence.

A passing schema test is not sufficient evidence.

======================================================================
3. FINDING B — PROCESS_PARAMETERS AUTHORITATIVE IDENTITY
======================================================================

The Data Exchange registry declares the authoritative natural key:

(formula_code, formula_version, step_number)

and says:

"(formula_code, formula_version, step_number) updates the existing step."

Current FVL-05.004 ambiguity handling instead centers on:

ProcessParameter.code

with `buildProcessParametersByCode()` and
`duplicate_process_parameter_code`.

This may not match the real persisted identity contract.

Trace:

schema
→ Data Exchange registry natural key
→ validation
→ commit
→ storage
→ update path
→ reader
→ extractor lineage

You must determine the exact persisted identity semantics.

At minimum test the case:

same formulaCode
same formulaVersion
same stepNumber
different code

The extractor must NOT silently emit two authoritative process steps if the
source contract treats them as the same natural-key record.

Also determine whether `ProcessParameter.code` is globally unique,
derived from the natural key, independently authored, or merely an internal
storage identity.

Do not assume global uniqueness.

Fix the extractor to use the actual repository identity rules.

======================================================================
4. FINDING C — LINEAGE CONTRACT VS COLLISION-SAFE ENCODING
======================================================================

Current nested lineage uses:

JSON.stringify([trial.id, record.id])

This is collision-safe and MUST NOT be replaced with delimiter concatenation.

However FVL-05.002 documents `sourceRecordId` as the exact opaque persisted
record ID, not a reformatted or generated ID.

Current FVL-05.004 therefore may solve collision safety by violating the
shared lineage contract.

Re-read the exact FVL-05.002 schema and tests.

Resolve this architecturally.

Preferred properties:

- child `sourceRecordId` remains the exact persisted child ID;
- trial scope is represented structurally;
- cross-trial reused child IDs remain unambiguous;
- delimiter-containing IDs remain collision-safe;
- lineage remains deterministic and recoverable;
- no fabricated surrogate identity;
- no silent change to FVL-05.003 semantics.

If the shared lineage schema needs an additive parent/nesting field,
make the smallest correct change and handle dataset schema-version impact.

Do not weaken lineage uniqueness merely to make the test pass.

======================================================================
5. FINDING D — SAVED_VERSION TRIAL CONDITIONAL INVARIANT
======================================================================

`laboratoryTrialSchema` currently has:

sourceType
sourceFormulaVersionId?: string

The comment says sourceFormulaVersionId is required when:

sourceType === "saved_version"

but verify whether Zod actually enforces that invariant.

Current extractor can silently ignore:

sourceType = "saved_version"
sourceFormulaVersionId = undefined

because it fails the version match and continues.

That is not acceptable unless repository source explicitly defines such a
record as legitimate.

Resolve from the authoritative LaboratoryTrial contract.

Either:

- strengthen the canonical schema with the conditional refinement,
  if that is the true domain rule and compatible with stored records;

or

- fail closed in the extractor when contradictory source records are present.

Add regression tests.

Do not silently drop malformed saved-version trials.

======================================================================
6. FINDING E — TRIAL OBSERVATION → PROCESS STEP REFERENTIAL INTEGRITY
======================================================================

`TrialObservation.processStepId` is optional.

If absent:
- preserve the observation as a legitimate trial-level observation.

If present:
- verify it resolves to exactly one process step in that same trial.

Fail closed if:
- referenced step does not exist;
- identity is ambiguous.

Do not emit a dangling processStepId as valid process evidence.

Add explicit tests.

======================================================================
7. FINDING F — PROCESS STEP ATTACHMENT DISPOSITION
======================================================================

Authoritative `TrialProcessStep` contains:

attachments

Current process dataset views do not preserve them.

Also `stepHasActualData()` does not appear to treat attachments alone as
execution evidence.

You must explicitly decide this from the task contract.

Create a field-disposition table for EVERY `TrialProcessStep` field:

- dataset plan view
- dataset actual view
- deliberately omitted
- reason/source evidence

If attachments are part of actual process evidence:
- preserve them correctly.

If intentionally excluded:
- cite the governing contract;
- add a regression test documenting intentional omission.

Do not leave this as an accidental drop.

======================================================================
8. FINDING G — DURABLE SOURCE SCHEMA PARITY
======================================================================

AUDIT_000018 already found one manual re-modeling mismatch:

phase

That proves manual schema duplication can drift.

Re-audit field by field:

trialProcessStepSchema
vs
processStepPlanSchema
vs
processStepActualObservationSchema

And:

trialObservationSchema
vs emitted observations

Prefer canonical schema reuse/composition where possible.

If direct `pick()`/composition is not practical, add a durable parity test
or explicit source-field disposition test so future source additions or
constraint changes cannot silently drift.

Do not rely only on prose saying parity was checked.

======================================================================
9. FINDING H — FORMULA CODE UNIQUENESS FOR PLAN LINKAGE
======================================================================

`process_parameters` links by:

formulaCode + formulaVersion

not by FormulationVersion.id.

Current extractor verifies Formulation.id uniqueness but not necessarily
Formulation.code uniqueness.

Trace whether `Formulation.code` is globally unique by authoritative
repository contract.

If uniqueness is enforced:
- prove where.

If not:
- fail closed when the plan key namespace is ambiguous.

Do not allow two different formulations to claim the same process plan
namespace.

======================================================================
10. FINDING I — DETERMINISTIC ORDERING
======================================================================

Audit all sort functions.

Current code uses `localeCompare` for opaque IDs/codes.

Opaque identity ordering should be deterministic across environments,
not dependent on locale/ICU behavior.

Use a locale-independent comparator if appropriate.

Also inspect timestamps:

createdAt
observedAt

They are currently source strings.

Before using lexical ordering as chronological ordering, prove their writer
contract guarantees canonical sortable ISO format, or validate/fail closed.

Add non-ASCII / delimiter-rich deterministic ordering tests where useful.

======================================================================
11. FINDING J — STRUCTURED ERROR CONTEXT
======================================================================

Audit:

FormulaVersionProcessDatasetExtractionError

The property name:

formulationVersionId

must not contain unrelated values such as:

formulationId
trialId
processParameter code

for pool-wide failures occurring before a formula-version context exists.

Make structured error metadata semantically truthful.

Use properly named optional fields or another minimal structured context.

Do not preserve a misleading API merely because tests only inspect `code`.

======================================================================
12. DOCUMENTATION TRUTH CLEANUP
======================================================================

The tracker/handoff/log currently contain historical contradictory claims.

Historical chronology belongs in the external log.

Current control-plane files must expose ONE unambiguous current truth.

Specifically correct:

- stale "no persisted process plan exists" wording;
- incomplete natural-key wording that omits `step_number`;
- any stale COMPLETE claim that is no longer true during this corrective cycle.

Do not delete useful history from the external log.

But do not leave current tracker/handoff prose internally contradictory.

======================================================================
13. REQUIRED NEW REGRESSION TESTS
======================================================================

At minimum add/prove tests for:

VERSION1
Dataset schema version behavior after adding plannedProcedure.

PLANKEY1
Two process_parameters rows with same
(formulaCode, formulaVersion, stepNumber)
but different code cannot silently coexist if source natural key says they
are the same record.

PLANKEY2
Actual process_parameters identity/lineage matches repository storage
semantics.

FORMCODE1
Formula-code ambiguity is either impossible by enforced contract or fails
closed.

LINK1
saved_version trial missing sourceFormulaVersionId fails closed or canonical
schema rejects it.

OBSREF1
Observation with a valid processStepId is accepted.

OBSREF2
Observation with a missing/dangling processStepId fails closed.

ATTACH1
Attachment-only process-step behavior is intentionally and explicitly tested.

PARITY1
Source/dataset process-step field disposition cannot silently drift.

ORDER1
Non-ASCII/delimiter-rich IDs still produce environment-independent
deterministic output.

ERROR1
Structured errors expose correctly named identity context.

Retain and re-run all existing:

LINEAGE1-6
PLAN1
phase parity
viscosityUnit regression
zero/false preservation
non-mutation
non-aliasing
public export
determinism

Do not weaken or delete tests merely to make the suite green.

======================================================================
14. WHOLE-SCOPE ADVERSARIAL RE-AUDIT
======================================================================

After all named findings are fixed, perform a fresh independent review of
FVL-05.004 from scratch.

Do NOT ask:

"Did I fix the GPT list?"

Ask instead:

"If I had never seen the previous audits, what would prevent me from
trusting this extractor as a historical experiment dataset source?"

Inspect for additional issues in:

- identity scope;
- schema compatibility;
- source fidelity;
- hidden fabricated defaults;
- optional-field loss;
- lineage correctness;
- ambiguity handling;
- cross-trial leakage;
- cross-formula leakage;
- plan/actual conflation;
- duplicate natural keys;
- source mutation;
- aliasing;
- deterministic serialization;
- public exports;
- backward compatibility.

Any newly found defect must be fixed before closure.

======================================================================
15. ACCEPTANCE COMMANDS
======================================================================

Run focused tests first.

Then run at minimum:

pnpm --filter @formulab/shared exec vitest run src/engine/formulaVersionProcessDatasetExtractor.test.ts

pnpm --filter @formulab/shared test

pnpm --filter @formulab/shared exec tsc --noEmit

pnpm --filter @formulab/desktop test

pnpm --filter @formulab/desktop exec tsc --noEmit

pnpm --filter @formulab/desktop lint

python scripts/validate_v1_tracker.py

git diff --check

Also inspect:

git status --short
git diff
git diff --staged

before commit.

Do not touch unrelated dirty files.

======================================================================
16. COMMIT / PUSH / FINAL HEAD
======================================================================

Only commit files actually required by this FVL-05.004 corrective cycle.

No amend.
No force push.
No history rewrite.
No destructive reset/clean.

Push to:

origin/feature/laboratory-stability

Then verify:

git rev-parse HEAD
git rev-parse origin/feature/laboratory-stability

They must match.

======================================================================
17. NATIVE BUILD / SHORTCUT GATE
======================================================================

Only after final pushed HEAD:

pnpm --filter @formulab/desktop tauri build

Verify fresh:

apps/desktop/src-tauri/target/release/formulab.exe

Record:

- full path
- size
- modified timestamp
- SHA256

Verify:

C:\Users\sekip\Desktop\FormuLab.lnk

TargetPath must point to that exact executable.

Run the shortcut and perform the strongest safe native smoke available.

Do not claim manual UI verification that was not actually performed.

======================================================================
18. AUDIT / PROMPT LEDGER MAINTENANCE
======================================================================

Update:

docs/audits/FVL05-GPT Audits.md

Do NOT overwrite the GPT audit.

Append a section named something like:

CLAUDE RESOLUTION — AUDIT_FVL05_GPT_000001

For every finding record:

- CONFIRMED / REJECTED / PARTIALLY CONFIRMED
- exact source evidence
- fix if any
- tests
- commit

Also append the exact prompt used in this session to:

docs/prompts/FVL05 Prompts.md

Do not delete earlier prompts.

======================================================================
19. EXTERNAL LOG CHECKPOINT
======================================================================

Before stopping for ANY reason, append truthfully to:

docs/external-logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md

If incomplete include exactly:

SESSION CHECKPOINT — WORK INCOMPLETE

Record:

- branch
- starting HEAD
- final/current HEAD
- remote HEAD
- GPT audit findings addressed
- dataset version conclusion
- process_parameters authoritative identity conclusion
- lineage model conclusion
- LaboratoryTrial conditional-link conclusion
- observation processStepId referential-integrity result
- attachments disposition
- schema parity mechanism
- formula-code uniqueness conclusion
- deterministic ordering conclusion
- structured error-context conclusion
- files changed
- commits
- tests/counts
- build result
- executable hash
- shortcut verification
- tracker/handoff state
- exact remaining work
- FVL-05.005 NOT STARTED

======================================================================
20. STRICT CLOSURE GATE
======================================================================

Do NOT call FVL-05.004 complete unless ALL are true:

[ ] dataset schema version compatibility resolved from FVL-05.001 contract
[ ] process_parameters exact authoritative identity proven
[ ] duplicate process natural keys cannot silently coexist
[ ] process plan lineage cites real source identity correctly
[ ] nested trial lineage remains collision-safe
[ ] exact persisted child identity semantics preserved
[ ] cross-trial reused IDs work
[ ] delimiter-containing IDs cannot collide
[ ] saved_version conditional identity invariant enforced/fail-closed
[ ] observation processStepId referential integrity enforced
[ ] TrialProcessStep attachments disposition explicitly resolved
[ ] authoritative Laboratory schemas directly inspected
[ ] durable dataset/source-schema parity mechanism exists
[ ] Manufacturing Procedure persistence/linkage proven from executable source
[ ] formula-code uniqueness/link ambiguity resolved
[ ] no fabricated plan
[ ] no fabricated actual observation
[ ] planned and actual data remain structurally separate
[ ] exact zero/false/units/optional values preserved
[ ] deterministic ordering is environment-independent
[ ] exact formula/version/trial linkage
[ ] all ambiguous identities fail closed
[ ] structured error metadata is semantically truthful
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
[ ] GPT audit ledger updated
[ ] prompt ledger updated
[ ] FVL-05.005 untouched
[ ] changes committed
[ ] changes pushed
[ ] local HEAD == remote HEAD
[ ] fresh native build from final pushed HEAD
[ ] Desktop\FormuLab.lnk verified
[ ] external log updated
[ ] fresh whole-scope adversarial re-audit found no unresolved defect

Only after every box is genuinely satisfied may you state:

FVL-05.004 — IMPLEMENTATION AND ACCEPTANCE COMPLETE

Then state:

NEXT TASK — FVL-05.005 NOT STARTED

DO NOT start FVL-05.005 in this session.
```

Outcome: see `AUDIT_FVL05_GPT_000001`'s `CLAUDE RESOLUTION` section in
`docs/audits/FVL05-GPT Audits.md`, and this same corrective cycle's
section in `docs/external-logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md`.
