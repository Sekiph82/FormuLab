# FormuLab FVL-05 — GPT Audit 000002

**Date:** 2026-08-23  
**Branch:** `feature/laboratory-stability`  
**Scope:** FVL-05.004 only  
**Compared against:** current GitHub branch source, current FVL-05 GPT ledgers, and the user-supplied `FormuLab-FVL05-Dataset-Schema-Versioning-Log(2).md` containing the fourth corrective cycle and final build/shortcut evidence.

## Verdict

**CONTINUE / REOPEN FVL-05.004. Do not start FVL-05.005 yet.**

The fourth corrective cycle genuinely fixed most findings from `AUDIT_FVL05_GPT_000001`: process-parameter natural-key ambiguity, exact nested lineage via `parentRecordId`, malformed `saved_version` links, dangling observation step references, attachment-only evidence, formula-code ambiguity, locale-independent ordering, timestamp validation, and truthful error identity fields are all present in current source.

However, two closure requirements remain unresolved. Both are contract-level issues, not cosmetic documentation nits.

---

## 1. HIGH — Dataset schema-version rule is still internally contradictory

Current `packages/shared/src/schemas/dataset.ts` still says, directly above `DATASET_SCHEMA_VERSION`:

> Bump when the shape of a dataset row changes (a field is added, removed, or renamed by one of the FVL-05.003-.008 extractors).

The fourth corrective cycle kept:

```ts
DATASET_SCHEMA_VERSION = "1.0"
```

while adding required row-shape fields such as `plannedProcedure` and also extending the shared lineage reference shape with optional `parentRecordId`.

Claude's resolution argues that no bump is needed because there are no external consumers/persisted rows yet and prior FVL-05 row types were also assembled under `1.0`. That is useful evidence, but it is **an inference from current usage and precedent**, not the explicit pre-release/unfrozen versioning contract that the governing GPT prompt required.

Worse, the file now contains two competing rules:

1. the original FVL-05.001 rule: **bump whenever a dataset-row field is added/removed/renamed**;
2. the new FVL-05.004 narrative: **do not bump until the row family first becomes externally consumed/persisted/exported**.

Both cannot be authoritative at once.

### Required resolution

Re-open the exact FVL-05.001 versioning contract from repository source/tracker/history and establish **one** rule.

- If the original rule is authoritative, apply the correct dataset schema-version bump and compatibility/test implications now.
- If the initial FVL-05 row family is intentionally being assembled under an unfrozen `1.0`, prove that from a pre-existing authoritative contract, then rewrite the conflicting version documentation/tests so there is one explicit rule, not a later self-authored exception that contradicts the original comment.

A repository grep showing no current consumer is not, by itself, proof of the versioning contract.

**Closure status: NOT SATISFIED.**

---

## 2. HIGH/MEDIUM — `PARITY1` does not provide the durable schema-parity guarantee claimed

The previous audit required a durable parity mechanism so a future **source-field addition or constraint/default/optional change** cannot silently drift from the dataset views.

Current `PARITY1` only does this:

```ts
const sourceKeys = Object.keys(trialProcessStepSchema.shape);
const planKeys = new Set(Object.keys(processStepPlanSchema.shape));
const actualKeys = new Set(Object.keys(processStepActualObservationSchema.shape));
```

and checks whether every source **key name** appears in one of the destination schemas or an omission list.

That catches a newly-added field name, but it does **not** catch source constraint drift.

Concrete examples already visible today:

- source `phase` is `z.string().default("A")`, while plan view is `z.string()`;
- source `requiredEquipment` is `z.array(z.string()).default([])`, while plan view is `z.array(z.string())`;
- source `status`, `unplanned`, and `attachments` carry defaults on the canonical source schema, while the manually re-modeled actual-view fields do not preserve those schema wrappers.

Those differences may be acceptable for an extracted-output schema because the extractor emits fully materialized values, but `PARITY1` cannot prove that the differences are intentional, nor would it fail if the canonical source later changed optionality, enum membership, defaults, refinements, or nested constraints while keeping the same field name.

The fourth-cycle resolution says direct `pick()` composition is impractical because a field such as `stepNumber` must appear in both views. That rationale is incorrect: two independent schemas can each `pick()` the same canonical source field set. For example, one plan pick and one actual pick can both include `stepNumber`; `id` can still be deliberately renamed to `processStepId` via `omit/pick + extend`.

### Required resolution

Prefer deriving the plan and actual views from `trialProcessStepSchema` using canonical Zod composition (`pick`/`omit`/`extend`) so field constraints automatically follow the source. If a small subset must remain re-modeled, add contract tests that compare actual parse behavior/optionality/default semantics, not merely property names.

The final mechanism must fail when a selected canonical source field changes semantically without the dataset view being reconsidered.

**Closure status: NOT SATISFIED.**

---

## 3. CONTROL-PLANE NOTE — GPT audit/prompt files are GPT-owned and must be read-only to Claude

The fourth corrective cycle wrote Claude-authored `CLAUDE RESOLUTION` material into `docs/audits/FVL05-GPT Audits.md` and added/reconstructed prompt content in `docs/prompts/FVL05 Prompts.md`.

That happened because the earlier launch prompt incorrectly instructed Claude to update those files. This is a process mistake in the prior GPT instruction, not an implementation defect by Claude.

From this audit onward:

- `docs/audits/FVL05-GPT Audits.md`
- `docs/prompts/FVL05 Prompts.md`
- `docs/audits/FVL05-GPT-AUDIT-*.md`
- `docs/prompts/FVL05-GPT-PROMPT-*.md`

are **GPT-owned/read-only for Claude**.

Claude may read them but must not modify, append, reconstruct, or reconcile them. Claude should record implementation evidence only in the tracker, handoff, and the existing FVL-05 external log.

---

## Confirmed current fixes from the fourth cycle

The following previous findings are confirmed present in current branch source and do not need to be reopened unless a new change regresses them:

- authoritative `process_parameters` natural-key collision check `(formulaCode, formulaVersion, stepNumber)`;
- `sourceRecordId` restored to exact persisted child id with structural `parentRecordId` scope;
- malformed `saved_version` trial without nonblank `sourceFormulaVersionId` fails closed;
- `TrialObservation.processStepId` resolves within the same trial or fails closed;
- process-step attachments are preserved in the actual view and attachment-only evidence is retained;
- duplicate formulation code fails closed for plan-link namespace ambiguity;
- ordinal string comparison replaces `localeCompare` for deterministic ids/codes;
- trial/observation timestamps are validated before chronological lexical ordering;
- structured extraction errors expose correctly named identity fields;
- persisted `process_parameters` is correctly recognized as the canonical version-level Manufacturing Procedure source.

The user-supplied fourth-cycle log reports final local/remote HEAD `bb70dd67d81627af533a93c8875352c18b482b98`, fresh focused/full test passes, fresh native Tauri build, and shortcut verification. Those are treated as prior-run evidence, not independently executed by GPT.

---

## Closure gate for the next Claude cycle

FVL-05.004 may be declared complete only after:

1. the dataset versioning rule is reconciled into one authoritative, non-contradictory contract and implemented/tested accordingly;
2. process-step schema parity is structurally derived from the canonical source or tested at semantic constraint level, not key-name level only;
3. the whole FVL-05.004 scope is re-audited after those changes for regression;
4. focused FVL-05.004 tests, full shared tests, desktop tests, shared/desktop typechecks, desktop lint, tracker validation, and `git diff --check` are green;
5. tracker/handoff/external FVL-05 log are truthful and point to current truth;
6. changes are committed and pushed with local HEAD equal to remote branch HEAD;
7. the required native Tauri release build and `Desktop\FormuLab.lnk` checks are rerun from the final pushed HEAD;
8. FVL-05.005 remains untouched.

**Current status:** `FVL-05.004 — REOPENED / CONTINUE`  
**Next task:** `FVL-05.005 — NOT STARTED`
