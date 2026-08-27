# FormuLab FVL-05 — GPT Prompt 000009

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.007 — Extractor: DOE studies/runs/observations

FVL-05.006 is independently GPT-audit CLOSED by:
docs/audits/FVL05-GPT-AUDIT-000008.md

Do not reopen FVL-05.006 unless direct current source evidence reveals a concrete regression or contract defect.
Do not start FVL-05.008 or any later task.
Do not use Autopilot, subagents, or background agents.
Do not rewrite history, force-push, destructive-reset/clean, or touch unrelated dirty files.
Do not mutate real user/business/laboratory data.

Before editing anything:

1. fetch/pull current branch state safely;
2. record git status, branch, local HEAD, remote HEAD, recent commits, staged/unstaged diff;
3. read the current tracker and handoff;
4. read all relevant FVL-05 GPT audits/prompts, especially:
   - docs/audits/FVL05-GPT-AUDIT-000008.md
   - docs/prompts/FVL05-GPT-PROMPT-000009.md
   - prior FVL-05.002-.006 audit history where it defines lineage/version/extractor invariants;
5. locate and read the existing FVL-05 external log under docs/external-logs; do not create a duplicate log under a guessed filename.

IMPORTANT OWNERSHIP RULE:
All files under docs/audits/FVL05-GPT*.md and docs/prompts/FVL05*.md are GPT-owned and READ-ONLY for Claude.
Do not edit, append, reconstruct, reconcile, rename, or overwrite them.
Record Claude implementation evidence only in the normal project tracker, handoff, and existing FVL-05 external log.

======================================================================
FVL-05.007 SOURCE-OF-TRUTH RECOVERY
======================================================================

Tracker contract:
FVL-05.007 — Extractor: DOE studies/runs/observations
Depends on FVL-05.002. Blocking = NO.

Do not infer the payload from the title alone.
Recover the authoritative DOE persisted model from CURRENT repository source.

At minimum inspect:

- packages/shared/src/schemas/dataset.ts
- packages/shared/src/schemas/doe.ts
- packages/shared/src/engine/doeDesign.ts
- every current DOE writer/reader/status-transition/import/export path
- every current path that creates/updates DoeRun and DoeObservation
- every path that links a DOE run to LaboratoryTrial/FormulationVersion
- every path that imports observations from TestResult or records observations manually
- apps/desktop/src-tauri/src/masterdata.rs
- packages/shared/src/schemas/laboratory.ts
- packages/shared/src/schemas/testDefinitions.ts
- packages/shared/src/schemas/formulation.ts
- packages/shared/src/index.ts
- FVL-05.003-.006 extractors/tests for established conventions
- current tracker/handoff/external log

Search the repository rather than assuming historical file names still exist.

Known current-source anchors that MUST be verified again rather than blindly trusted:

- `DoeStudy.baselineFormulaVersionId` is documented as one exact SAVED FormulationVersion id.
- `DoeStudy.revision` identifies the revision; child DOE records carry `studyId` + `studyRevision`.
- `DoeStudy.supersedesStudyId` links study revisions.
- `DoeDesign` contains frozen `factorSnapshot` / `constraintSnapshot` / `responseSnapshot` plus generation settings/seed/diagnostics.
- `DoeRun` carries `studyId`, `studyRevision`, `designId`, run order/replicate/block, frozen factorSettings, status, optional `linkedTrialId`, optional `linkedFormulaVersionId`, and execution timestamps.
- `DoeObservation` carries `studyId`, `studyRevision`, `runId`, `responseId`, actual value/text/status, optional `sourceTrialId`, optional `sourceTestResultId`, measuredAt/recordedAt and exclusion state.
- masterdata currently registers `doe_studies`, `doe_factors`, `doe_constraints`, `doe_responses`, `doe_designs`, `doe_runs`, `doe_observations`, `doe_analyses`, `doe_candidates`, `doe_review_actions` as distinct top-level collections; `doe_analyses` and `doe_review_actions` are append-only while runs/observations are mutable lifecycle rows.

The task title names studies/runs/observations, but do NOT automatically exclude or include factor/response/design records solely from the title. Determine from source which records are necessary to preserve the true meaning of each persisted run/observation and its exact baseline/formula-version lineage. In particular, audit whether response identity and factor-setting meaning can be interpreted safely without embedding or resolving the relevant DOE design/response/factor source records or frozen snapshots.

======================================================================
MANDATORY CONTRACT RULES
======================================================================

1. Preserve exact persisted source identity. Never fabricate, normalize, trim, case-fold, hash, shorten, or ambiguously concatenate source ids.

2. Reuse the current lineage contract exactly:
   sourceEntity + exact sourceRecordId + optional parentRecordId only when the true source identity is parent-scoped.
   Duplicate identity is the full `(sourceEntity, parentRecordId ?? null, sourceRecordId)` tuple.

3. Determine the true identity scope of EVERY DOE entity from storage. Current masterdata evidence suggests study/design/run/observation/factor/constraint/response are top-level collections, but verify before deciding whether `parentRecordId` is absent.

4. Current DATASET_SCHEMA_VERSION entering this task is `1.4`.
   The standing FVL-05 rule still applies: a new dataset-row shape introduced by FVL-05.007 requires an explicit version bump. Apply the resulting new current version consistently to sibling version-rejection tests without reopening prior tasks.

5. Prove the exact relationship from requested FormulationVersion to DoeStudy. Do not infer from `projectId` or names when `baselineFormulaVersionId` exists. Validate owning `formulationId` / project relationships only where current source proves their semantics.

6. Preserve DOE revision semantics. A child whose `studyId`/`studyRevision` contradicts the resolved study revision must not be silently attached. Audit `supersedesStudyId` referential integrity if current source proves its scope/acyclic semantics.

7. Preserve real DOE hierarchy and execution meaning. At minimum audit:
   FormulationVersion -> DoeStudy revision -> DoeDesign -> DoeRun -> DoeObservation,
   plus the response/factor records or frozen snapshots needed to interpret run factor settings and observation response ids.

8. Separate PLAN/DESIGN from ACTUAL evidence.
   - design factor settings / coded values / planned run order are design/execution inputs;
   - DoeObservation value/text/status/sourceTrial/sourceTestResult/measuredAt are actual recorded response evidence.
   Never present predicted candidates, analyses, target/objective/spec fields, design diagnostics, or response target limits as measured observations.

9. Do not silently collapse DOE study revisions, designs, repeated runs, replicates, excluded observations, missing observations, or mutable observation status history into a guessed 'latest good result' view unless source explicitly defines that as the extractor contract.

10. Resolve all required references exactly and fail closed where the real data model requires them, including as applicable:
   - study -> baseline FormulationVersion
   - run -> study/revision
   - run -> design
   - observation -> study/revision
   - observation -> run
   - observation -> response
   - run linkedTrialId -> LaboratoryTrial
   - run linkedFormulaVersionId -> FormulationVersion
   - observation sourceTrialId -> LaboratoryTrial
   - observation sourceTestResultId -> TestResult
   - source TestResult -> trial consistency
   Do not enforce a cross-reference unless current writer/domain source proves it is required or semantically constrained.

11. Audit denormalized/repeated ids for contradiction just as FVL-05.006 did. If the same relationship is stored on more than one record, resolve both sides and fail closed on contradictions rather than arbitrarily choosing one.

12. Preserve exact observation values and statuses. Explicit zero, false-equivalent categorical/text values, empty-but-valid strings where schema allows them, exclusion reasons, measuredAt, recordedAt, source ids and all actual evidence must survive unchanged.

13. Audit missing observations honestly. A run with no observation for a response must remain missing, not fabricate zero/null/result rows that look measured. If a `DoeObservation.status === "missing"` is itself a persisted explicit record, preserve that distinction from 'no record exists'.

14. Preserve run factor settings exactly. Do not recompute engineering-unit values from factor definitions if `DoeRun.factorSettings.actualValue` is already persisted. Never replace persisted factor settings with live factor definitions after a design/run exists.

15. Respect frozen design snapshots. `DoeDesign.factorSnapshot` / `constraintSnapshot` / `responseSnapshot` exist specifically to prevent live record edits from reinterpreting historical designs. Prefer the frozen design evidence where current source establishes it as authoritative for generated runs.

16. Audit linked LaboratoryTrial/TestResult evidence carefully. If an observation was imported from a test result, verify the exact source relationship supported by current writer code and preserve source lineage without duplicating measured evidence or treating planned response metadata as actual.

17. Audit revision/supersession relationships (`DoeStudy.supersedesStudyId`, design/analysis supersession if relevant to this task) for dangling/self/cycle/cross-scope integrity only where current source establishes that these chains are meaningful inputs to this extractor.

18. Deterministic output independent of caller array order. Use authoritative domain order where it exists:
   - study revision / creation semantics only if proven;
   - runNumber / randomizedOrder / standardOrder depending on the real intended experimental sequence;
   - observation ordering by response/design order or recorded chronology only if current source defines it.
   Never guess ordering merely because an array happened to arrive in that order.
   Use locale-independent opaque-id tie breakers and validate timestamp formats before chronological sort keys.

19. Validate every emitted row with the task-specific Zod schema before returning.

20. No input mutation and no returned-output/source mutable aliasing.

21. Prefer canonical schema reuse/composition. When a canonical whole record is actual evidence, reuse its schema directly. When planned vs actual must be separated, split deliberately and provide durable semantic-parity protection rather than hand-copying fields without a guard.

22. Keep computed analytics out unless source proves they are persisted source evidence required by this task. `DoeAnalysis`/candidate predictions/desirability are not automatically part of 'observations'. Do not turn model outputs into measured DOE outcomes.

23. Perform pool-wide identity/reference auditing where ambiguity or dangling references make the supplied dataset internally inconsistent, even if the bad record belongs to a different requested version, following the established FVL-05 fail-closed discipline.

======================================================================
ADVERSARIAL TEST REQUIREMENTS
======================================================================

Build focused synthetic tests covering every applicable real-source case, including:

- requested formula version with zero DOE studies;
- one study / one design / one run / one observation;
- multiple DOE studies or study revisions tied to the same baseline version, if current model supports that;
- multiple runs with deterministic domain ordering independent of input array order;
- replicate/block/center-point fields preserved exactly;
- run `factorSettings` preserved exactly, including codedValue vs actualValue;
- multiple observations on one run for different responses;
- explicit zero numeric observation survives;
- text/categorical/pass-fail representation preserved according to actual DoeObservation schema semantics;
- explicit persisted `status: "missing"` distinguished from no observation record;
- excluded/invalid/outlier observation status and exclusion metadata preserved;
- sourceTrialId/sourceTestResultId preserved and exact referential integrity enforced where current writers prove it;
- no observation from another run/study/revision leaks into a row;
- mismatched `studyId` / `studyRevision` across study/design/run/observation fails closed where structurally contradictory;
- dangling run->study/design, observation->run/response, linkedTrial/sourceResult links fail closed when required by the recovered contract;
- duplicate global identities for every supplied top-level DOE entity fail closed;
- duplicate requested formula-version behavior explicitly tested according to established FVL-05 convention;
- study supersession/revision dangling/self/cycle cases if that relationship is included in extraction semantics;
- delimiter-rich and Unicode ids remain unambiguous;
- true parent-scoped identities, if any are discovered, use parentRecordId rather than synthesized ids;
- planned/objective/target limits never appear as measured observation values;
- frozen design snapshots are not silently replaced by edited live factor/response records;
- input reordering yields identical normalized output where order is not domain-significant;
- source non-mutation on success and failure;
- returned nested output cannot mutate source fixtures;
- JSON round-trip + schema revalidation;
- public shared export availability;
- DATASET_SCHEMA_VERSION rejects all superseded versions after the FVL-05.007 row addition;
- canonical-schema referential identity/parity assertions for every reused source schema;
- row-schema malformed-payload rejection.

After those tests pass, perform a fresh whole-scope adversarial source audit instead of treating test count as proof.

======================================================================
VALIDATION / CLOSURE
======================================================================

Run all applicable focused and full validation from the FINAL state, including at minimum:

- focused FVL-05.007 extractor tests;
- relevant dataset/schema tests;
- all FVL-05 extractor tests affected by the dataset-version bump;
- full @formulab/shared test suite;
- full desktop regression suite;
- shared typecheck;
- desktop typecheck;
- desktop lint;
- tracker validator;
- git diff --check.

Run Rust/Python checks only if those source areas are actually touched or source recovery proves they are necessary.

Update only:
- FVL-05.007 tracker current truth;
- current handoff;
- existing FVL-05 external log.

Do not edit GPT audit/prompt files.

Commit and push only task-owned changes. Verify final local HEAD == remote branch HEAD.

Then satisfy the repository's existing native desktop build/shortcut acceptance gate from the final pushed HEAD. Check for a stale running formulab.exe before build, verify the real build exit code, fresh executable, Desktop\FormuLab.lnk TargetPath, and native launch smoke. Stop the smoke-test process afterward.

Do not claim manual UI acceptance unless the user actually performs it.

Only when all required source, tests, documentation, push, build and shortcut gates are satisfied may you state:

FVL-05.007 — IMPLEMENTATION AND ACCEPTANCE COMPLETE

Then state:
NEXT TASK — FVL-05.008 NOT STARTED

Do not start FVL-05.008 in this session.
```