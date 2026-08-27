# FormuLab FVL-05 — GPT Prompt 000011

```text
Continue FormuLab manually in the existing repository:

C:\Users\sekip\Desktop\FormuLab

Required branch:
feature/laboratory-stability

CURRENT TASK ONLY:
FVL-05.008 — extractor for the remaining relevant historical-experiment context named by the tracker, including corrective actions when relevant, cost snapshots, packaging/context, and environmental/test conditions.

FVL-05.007 is independently GPT-audit CLOSED by:
docs/audits/FVL05-GPT-AUDIT-000010.md

Do not reopen FVL-05.007 unless direct current-source evidence reveals a concrete regression or contract defect.
Do not start FVL-05.009 or any later task.
Do not use Autopilot, subagents, or background agents.
Do not force-push, rewrite history, destructive-reset/clean, or touch unrelated dirty files.
Do not mutate real user/business/laboratory data.

Before editing anything:
1. fetch/pull safely and record branch/local HEAD/remote HEAD/status/diffs;
2. read current tracker, handoff, and existing FVL-05 external log;
3. read all relevant GPT-owned FVL-05 audits/prompts, especially Audit 000010 and this Prompt 000011;
4. treat every file under docs/audits/FVL05-GPT*.md and docs/prompts/FVL05-GPT*.md as READ-ONLY;
5. recover the exact FVL-05.008 source contract from CURRENT repository source before designing any payload.

SOURCE RECOVERY IS THE MAIN WORK OF THIS TASK.
Do not infer a schema from the tracker title alone.
Search current source for every persisted model and writer/reader path that may represent:
- corrective actions / deviations / CAPA-like records when genuinely tied to an exact formula version, trial, test result, stability result, or DOE evidence;
- historical cost snapshots or other immutable point-in-time cost evidence, as distinct from mutable current prices;
- packaging / SKU / pack-format / market / product-context records that are genuinely historical experiment context rather than current catalog metadata;
- environmental / test-condition / method-condition / sample-condition records required to interpret measured evidence;
- any other source explicitly named by the FVL-05.008 tracker row.

At minimum inspect:
- packages/shared/src/schemas/dataset.ts
- all relevant canonical schemas discovered by search
- all real writer/update/import/export/status-transition paths for those records
- apps/desktop/src-tauri/src/masterdata.rs
- packages/shared/src/index.ts
- all FVL-05.003-.007 extractors/tests for established exact-id, lineage, ordering, validation, schema-version, non-mutation and parity conventions
- docs/FORMULAB_V1_TASK_TRACKER.md
- docs/handoffs/FORMULAB_V1_CURRENT.md
- the existing FVL-05 external log

MANDATORY RULES
- Exact persisted identity only. Never fabricate or ambiguously concatenate ids.
- Use parentRecordId only for genuinely parent-scoped identities.
- Prove how every included record links to the requested exact FormulationVersion. Do not infer from names, display codes, project labels, or mutable current state when an exact source link exists.
- Separate planned/reference/current catalog data from actual historical evidence. Do not present targets/specs/current costs/current packaging as if they were the historical state at experiment time.
- Prefer canonical source-schema reuse. If a whole canonical record is historical evidence, embed that schema directly rather than re-modeling it.
- If only a subset is legitimate historical context, justify every selected field and add semantic-parity protection.
- Fail closed on ambiguous or contradictory required references when current source proves the relation is required.
- Perform identity/reference checks pool-wide where an internally inconsistent supplied pool cannot be trusted.
- Preserve explicit zero, false, empty-but-valid values, timestamps, units, statuses, reasons, and provenance unchanged.
- Deterministic ordering independent of caller array order, using authoritative domain order where proven and locale-independent id tie breakers.
- Validate canonical timestamps before chronological sorting.
- Validate each emitted row with the task-specific Zod schema before returning.
- No input mutation and no output/source mutable aliasing.
- Preserve source lineage for every contributing real record.
- Do not include computed analytics, predictions, current derived dashboards, or convenience UI summaries unless source proves they are persisted historical evidence required by this extractor.
- Current DATASET_SCHEMA_VERSION entering this task is 1.5. If FVL-05.008 introduces a new dataset row shape, apply the standing explicit version-bump rule consistently to all sibling version-rejection tests. Do not bump merely for validation-only changes.

CRITICAL SOURCE-SEMANTICS QUESTIONS TO ANSWER BEFORE IMPLEMENTATION
1. Which corrective-action/deviation entities actually exist, what is their identity scope, and how do they link to exact trials/results/formula versions?
2. Does a true historical cost snapshot exist, or only mutable/current material/pricing data? Include only a source that can honestly represent the historical state.
3. Which packaging/context records are frozen or experiment-specific versus mutable current masterdata?
4. Which environmental/test-condition fields are already carried by TestResult, StabilitySample/Condition/TimePoint, DOE design/run/observation, or LaboratoryTrial records, and therefore must not be duplicated under a second invented source model?
5. Are any FVL-05.008 sources already fully represented by prior FVL-05.003-.007 rows? Avoid duplicate measured evidence. Add only genuinely missing context required by the tracker.
6. For any optional relationship, distinguish 'no historical record exists' from 'reference exists but cannot be resolved'.

TESTS MUST BE ADVERSARIAL
Cover every real-source path discovered, including zero-related-record rows, multiple records, exact-link conflicts, duplicate identities, dangling required references, cross-formula leakage, historical-vs-current-state distinction, explicit zero/false/empty values, deterministic ordering under input reorder, Unicode/delimiter ids, lineage identity scope, non-mutation, non-aliasing, JSON round-trip + schema revalidation, public export, canonical-schema parity, malformed row rejection, and all superseded dataset-version rejection after any required version bump.

After focused tests pass, perform a fresh whole-scope source audit. Do not treat passing test count as proof.

VALIDATION / CLOSURE
Run focused FVL-05.008 tests, all affected FVL-05 dataset/extractor tests, full shared suite, full desktop regression, shared/desktop typechecks, desktop lint, tracker validator and git diff --check. Run Rust/Python checks only if touched or source recovery proves necessary.

Update only FVL-05.008 tracker current truth, current handoff, and the existing FVL-05 external log. Never edit GPT audit/prompt files.

Commit/push only task-owned changes. Verify final local HEAD == remote branch HEAD. Then run the existing native Tauri build/shortcut/launch-smoke acceptance gate from final pushed HEAD.

Only if every required gate passes may you state:
FVL-05.008 — IMPLEMENTATION AND ACCEPTANCE COMPLETE

Then state:
NEXT TASK — FVL-05.009 NOT STARTED

Do not start FVL-05.009 in this session.
```
