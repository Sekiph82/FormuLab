# FormuLab FVL-05 — GPT Prompt 000007

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.006 — Extractor: stability studies/results

FVL-05.005 is now independently GPT-audit CLOSED by:
docs/audits/FVL05-GPT-AUDIT-000006.md

Do not reopen FVL-05.005 unless direct current source evidence reveals a concrete regression or contract defect.
Do not start FVL-05.007 or any later task.
Do not use Autopilot, subagents, or background agents.
Do not rewrite history, force-push, destructive-reset/clean, or touch unrelated dirty files.
Do not mutate real user/business/laboratory data.

Before editing anything:

1. fetch/pull current branch state safely;
2. record git status, branch, local HEAD, remote HEAD, recent commits, staged/unstaged diff;
3. read the current tracker and handoff;
4. read all relevant FVL-05 GPT audits/prompts, especially:
   - docs/audits/FVL05-GPT-AUDIT-000006.md
   - docs/prompts/FVL05-GPT-PROMPT-000007.md
   - prior FVL-05.002-.005 audit history where it defines lineage/version/extractor invariants;
5. locate and read the existing FVL-05 external log under docs/external-logs; do not create a duplicate log under a guessed filename.

IMPORTANT OWNERSHIP RULE:
All files under docs/audits/FVL05-GPT*.md and docs/prompts/FVL05*.md are GPT-owned and READ-ONLY for Claude.
Do not edit, append, reconstruct, reconcile, rename, or overwrite them.
Record Claude implementation evidence only in the normal project tracker, handoff, and existing FVL-05 external log.

======================================================================
FVL-05.006 SOURCE-OF-TRUTH RECOVERY
======================================================================

Tracker contract:
FVL-05.006 — Extractor: stability studies/results
Depends on FVL-05.002. Blocking = NO.

Do not infer the payload from the title alone.
Recover the authoritative persisted stability model from current repository source.

Search and read every schema/storage/writer/reader relationship relevant to:

- stability studies
- stability samples/time points/conditions
- stability results / measured observations
- test definitions or method snapshots when actually persisted on results
- formula-version linkage
- trial linkage, only if the real stability model uses it
- sample identity scope
- storage-condition identity
- time-point identity
- attachments/provenance
- timestamps used for ordering
- revision/retest relationships if stability results have them
- source ids and parent-scoped identity

At minimum inspect:

- packages/shared/src/schemas/dataset.ts
- packages/shared/src/schemas/stability.ts
- packages/shared/src/schemas/testDefinitions.ts
- all current stability writers/readers/storage paths
- packages/shared/src/index.ts
- FVL-05.003/.004/.005 extractors and tests for established conventions
- current tracker/handoff/external log

Search the repository rather than assuming historical file paths or relationships still exist.

======================================================================
MANDATORY CONTRACT RULES
======================================================================

1. Preserve exact persisted source identity. Never fabricate, normalize, trim, case-fold, hash, shorten, or ambiguously concatenate source ids.

2. Reuse the current lineage contract exactly:
   sourceEntity + exact sourceRecordId + optional parentRecordId only when the true source identity is parent-scoped.
   Duplicate identity is the full `(sourceEntity, parentRecordId, sourceRecordId)` tuple.

3. Use current DATASET_SCHEMA_VERSION and obey the standing rule: every new dataset-row shape introduced by FVL-05.003-.008 requires an explicit version bump. Determine and apply this consistently for FVL-05.006. Do not silently leave the version unchanged.

4. Prove the exact relationship from formula version to stability study/result from current source. Do not invent a relationship. If multiple paths exist, define precedence and ambiguity handling from evidence.

5. Preserve real stability hierarchy. Do not flatten study, sample, condition, time point, and result identities into an undifferentiated blob if the persisted model distinguishes them.

6. Preserve actual measured/observed values, units, qualitative outcomes, pass/fail state, timestamps, method snapshots, notes, attachments, storage conditions, time points, and other persisted evidence exactly where canonical source records store them.

7. Keep planned/specification metadata separate from measured actuals. Never present target/min/max/reference/spec data as an observed stability result.

8. Fail closed on missing/ambiguous required relationships, duplicate identities, dangling source references, contradictory links, invalid parent scopes, and malformed chronology keys.

9. Audit all nested identity scopes. If sample/result ids are only unique within a study/sample/condition/time point, use parentRecordId rather than synthesizing a child sourceRecordId.

10. Validate every emitted row against its task-specific dataset schema before return.

11. No input mutation and no output/source mutable aliasing.

12. Deterministic output independent of caller array order. Use domain ordering and locale-independent opaque-id tie breakers. Validate timestamp format before chronological sorting.

13. Prefer canonical schema reuse/composition over hand-retyping. If any source schema must be split/re-modeled, create durable semantic parity protection, not field-name-only parity.

14. If stability results contain revision/retest/predecessor references or any other result-to-result relationship, audit their referential integrity explicitly, including dangling, cross-scope, self-reference, and cycles where the current source contract proves acyclicity/scope requirements.

======================================================================
TEST / ADVERSARIAL REQUIREMENTS
======================================================================

Build focused synthetic tests that cover, as applicable to the real recovered model:

- one valid stability study with one result;
- multiple results/time points/conditions/samples;
- multiple studies for one formula version if supported;
- exact values/units/status/timestamp/method/attachment preservation;
- missing optional fields remain absent;
- explicit zero/false/empty-but-valid values survive;
- no fabricated result when none exists;
- records linked to another formula version/study/sample never leak;
- missing required referenced records fail closed;
- duplicate top-level and nested ids fail closed at their true scope;
- parent-scoped id collisions handled with parentRecordId, never synthesized child ids;
- delimiter-rich and Unicode ids remain unambiguous/deterministic;
- duplicate requested formula-version behavior explicitly tested according to the established FVL-05 convention;
- source non-mutation on success and failure;
- returned nested output cannot mutate source fixtures;
- input reordering yields identical normalized output where order is not domain-significant;
- JSON round-trip + schema revalidation;
- public export availability;
- dataset-version rejection of superseded versions after the FVL-05.006 schema addition;
- source-schema referential identity/parity guarantees;
- any revision/retest/history integrity rules actually present in the stability model.

After implementing the named cases, perform a fresh whole-scope adversarial re-audit instead of treating test count as proof of completeness.

======================================================================
VALIDATION / CLOSURE
======================================================================

Run all applicable focused and full validation from the final state, including at minimum:

- focused FVL-05.006 tests;
- relevant dataset/schema tests;
- full @formulab/shared test suite;
- full desktop regression suite;
- shared typecheck;
- desktop typecheck;
- desktop lint;
- tracker validator;
- git diff --check.

Run Rust/Python checks only if those source areas are actually touched or source recovery proves them necessary.

Update only:
- FVL-05.006 tracker current truth;
- current handoff;
- existing FVL-05 external log.

Do not edit GPT audit/prompt files.

Commit and push only task-owned changes. Verify final local HEAD == remote branch HEAD.

Then satisfy the repository's existing native desktop build/shortcut acceptance gate from the final pushed HEAD. Check for a stale running formulab.exe before build, verify the real build exit code, fresh executable, Desktop\FormuLab.lnk TargetPath, and native launch smoke. Stop the smoke-test process afterward.

Do not claim manual UI acceptance unless the user actually performs it.

Only when all required source, tests, documentation, push, build, and shortcut gates are satisfied may you state:

FVL-05.006 — IMPLEMENTATION AND ACCEPTANCE COMPLETE

Then state:
NEXT TASK — FVL-05.007 NOT STARTED

Do not start FVL-05.007 in this session.
```
