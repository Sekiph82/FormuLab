# FormuLab FVL-05 — GPT Prompt 000005

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.005 — Extractor: LaboratoryTrial + TestResult

FVL-05.004 is now independently GPT-audit CLOSED by:
docs/audits/FVL05-GPT-AUDIT-000004.md

Do not reopen FVL-05.004 unless direct current source evidence reveals a concrete regression or contract defect.
Do not start FVL-05.006 or any later task.
Do not use Autopilot, subagents, or background agents.
Do not rewrite history, force-push, destructive-reset/clean, or touch unrelated dirty files.
Do not mutate real user/business/laboratory data.

Before editing anything:

1. fetch/pull current branch state safely;
2. record git status, branch, local HEAD, remote HEAD, recent commits, staged/unstaged diff;
3. read the current tracker and handoff;
4. read all FVL-05 GPT audits/prompts relevant to current contracts, especially:
   - docs/audits/FVL05-GPT-AUDIT-000004.md
   - docs/prompts/FVL05-GPT-PROMPT-000005.md
   - the prior FVL-05.002/.003/.004 audit history where it defines lineage/version invariants;
5. locate and read the existing FVL-05 external log under docs/external-logs; do not create a duplicate log under a guessed filename.

IMPORTANT OWNERSHIP RULE:
All files under docs/audits/FVL05-GPT*.md and docs/prompts/FVL05*.md are GPT-owned and READ-ONLY for Claude.
Do not edit, append, reconstruct, reconcile, rename, or overwrite them.
Record Claude implementation evidence only in the normal project tracker, handoff, and existing FVL-05 external log.

======================================================================
FVL-05.005 SOURCE-OF-TRUTH RECOVERY
======================================================================

The tracker task is intentionally short:

FVL-05.005 — Extractor: LaboratoryTrial + TestResult
Depends on FVL-05.002. Blocking = YES.

Do not infer the exact dataset payload from the task title alone.
Recover the real repository contracts before designing the extractor.

Search and read every authoritative schema/storage/reader/writer relationship relevant to:

- LaboratoryTrial
- TestResult / test results / result records
- test definitions / methods / units / pass-fail or qualitative outcomes
- formula-version linkage
- trial linkage
- product-family/test context if persisted
- attachments and provenance
- created/observed/tested timestamps
- source ids and identity scope

At minimum inspect:

- packages/shared/src/schemas/dataset.ts
- packages/shared/src/schemas/laboratory.ts
- packages/shared/src/schemas/testDefinitions.ts and/or whichever current files actually define TestResult
- all current writers/readers/storage paths for LaboratoryTrial and TestResult
- packages/shared/src/index.ts
- the FVL-05.003 and FVL-05.004 extractors/tests for established conventions
- current tracker/handoff/external log

Search the repository rather than assuming a historical path still exists.

======================================================================
MANDATORY CONTRACT RULES
======================================================================

1. Preserve exact persisted source identity. Never fabricate, normalize, trim, case-fold, hash, shorten, or ambiguously concatenate source ids.

2. Reuse the current FVL-05 lineage contract exactly:
   sourceEntity + exact sourceRecordId + optional parentRecordId only when true source identity is parent-scoped.
   Duplicate identity is the full `(sourceEntity, parentRecordId, sourceRecordId)` tuple.

3. Use current `DATASET_SCHEMA_VERSION` and obey its standing rule: any dataset-row shape change requires an explicit version bump. Before adding a new FVL-05.005 row/payload shape, determine whether this constitutes a dataset-row shape change under the current contract and apply the version rule consistently. Do not silently leave the version unchanged by precedent or convenience.

4. Do not invent a relationship between LaboratoryTrial and TestResult. Prove exact linkage from current repository source. If multiple relationship paths exist, resolve their precedence/ambiguity explicitly and fail closed where source identity cannot be uniquely established.

5. Do not collapse multiple trials or multiple results into one undifferentiated blob. Preserve the domain's true grouping and source identities.

6. Preserve actual result values, units, qualifiers, statuses, timestamps, method/test identities, notes, attachments, and other persisted evidence exactly where they belong. Do not convert absent fields into zero/false/empty strings or fabricate defaults beyond what canonical source schema parsing itself defines.

7. Distinguish planned/test-definition metadata from actual measured/observed TestResult data. Never present target/specification/reference values as measured actuals.

8. Fail closed on missing/ambiguous required relationships and duplicate identities. Audit all pool-level and nested identity scopes, not only the obvious top-level id.

9. Validate every emitted row against its task-specific dataset schema before return.

10. No mutation of inputs and no output/source mutable aliasing.

11. Deterministic output independent of caller array order. Use explicit domain ordering and locale-independent opaque-id tie breakers. If timestamps are used as chronology keys, prove/validate their sortable format rather than assuming arbitrary strings sort chronologically.

12. Prefer canonical schema reuse/composition over hand-retyping. If any source schema must be split/re-modeled, create a durable parity mechanism that catches BOTH new source fields and semantic constraint drift.

======================================================================
TEST / ADVERSARIAL REQUIREMENTS
======================================================================

Build focused synthetic tests that cover, as applicable to the real recovered source model:

- one valid trial with one valid result;
- multiple results on one trial;
- multiple trials for one formula version, if that relationship is part of the extractor;
- exact result value/unit/qualifier/status/timestamp preservation;
- missing optional fields remain absent;
- explicit zero/false/empty-but-valid values survive;
- no fabricated result when none exists;
- result linked to wrong trial/version never leaks into the row;
- missing referenced trial/result/test definition fails closed when required;
- duplicate top-level ids fail closed;
- parent-scoped nested id collisions handled without synthesized child sourceRecordId;
- delimiter-rich and Unicode ids remain unambiguous/deterministic;
- duplicate requested formula-version behavior explicitly decided from the established FVL-05 contract and tested;
- source non-mutation on success and failure paths;
- returned nested output cannot mutate source fixtures;
- input reordering produces identical normalized output where order is not domain-significant;
- JSON round-trip + schema revalidation;
- public export availability;
- dataset version behavior after the FVL-05.005 schema addition;
- any canonical source-schema parity/composition guarantee.

After implementing the named cases, perform a fresh whole-scope adversarial re-audit instead of treating the checklist as proof of completeness.

======================================================================
VALIDATION / CLOSURE
======================================================================

Run all applicable focused and full validation from the final state, including at minimum:

- focused FVL-05.005 tests;
- relevant dataset/schema tests;
- full @formulab/shared test suite;
- full desktop regression suite;
- shared typecheck;
- desktop typecheck;
- desktop lint;
- tracker validator;
- git diff --check.

Run Rust/Python checks only if those source areas are actually touched or the recovered source contract proves they are needed.

Update only:
- FVL-05.005 tracker current truth;
- current handoff;
- existing FVL-05 external log.

Do not edit GPT audit/prompt files.

Commit and push only task-owned changes. Verify final local HEAD == remote branch HEAD.

Then satisfy the repository's existing native desktop build/shortcut acceptance gate from the final pushed HEAD. If a stale running formulab.exe locks the release binary, diagnose/stop that stale process rather than masking the failure through a piped command. Verify the real command exit code, the fresh executable, Desktop\FormuLab.lnk TargetPath, and native launch smoke. Stop the smoke-test process afterward so it does not lock the next build.

Do not claim manual UI acceptance unless the user actually performs it.

Only when all required source, tests, documentation, push, build, and shortcut gates are satisfied may you state:

FVL-05.005 — IMPLEMENTATION AND ACCEPTANCE COMPLETE

Then state:
NEXT TASK — FVL-05.006 NOT STARTED

Do not start FVL-05.006 in this session.
```