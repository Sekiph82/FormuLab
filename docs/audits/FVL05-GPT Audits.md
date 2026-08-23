# FormuLab FVL-05 — GPT Audit Ledger

> Maintained for the full FVL-05 work package. Repository source contracts outrank tracker, handoff, Claude logs, prior completion claims, and prior GPT prompts.

## AUDIT_FVL05_GPT_000001 — FVL-05.004 post-AUDIT_000018 re-audit

**Date:** 2026-08-23  
**Branch audited:** `feature/laboratory-stability`  
**Implementation reference:** commit `92a89ae21dbab39a5d991b3e14b62180edd36c18` and current branch files  
**Compared evidence:**

- current repository implementation and source contracts;
- `FormuLab-FVL05-Dataset-Schema-Versioning-Log(1).md` supplied by the user;
- the prior GPT prompt beginning `Continue FormuLab manually in the EXISTING repository...` and its FVL-05.004 closure gate.

### Verdict

**CONTINUE / REOPEN FVL-05.004. Do not start FVL-05.005 yet.**

AUDIT_000018's two named defects were addressed in code, but this independent comparison found additional contract mismatches and closure risks. The current `FVL-05.004 — IMPLEMENTATION AND ACCEPTANCE COMPLETE` claim is therefore premature.

---

## A. Confirmed fixes that are genuinely present

### A1. Collision-safe nested lineage implementation exists

`formulaVersionProcessDatasetExtractor.ts` now uses:

```ts
encodeNestedLineageId(parentId, recordId) = JSON.stringify([parentId, recordId])
```

for `trialProcessStep` and `trialObservation` lineage citations. This fixes the earlier delimiter collision (`A:B + C` vs `A + B:C`) and the tests include cross-trial reused IDs and delimiter-containing IDs.

**Status:** implementation fix confirmed.

### A2. The `phase` schema mismatch from AUDIT_000018 is corrected

Authoritative source:

```ts
trialProcessStepSchema.phase = z.string().default("A")
```

Current dataset plan view:

```ts
processStepPlanSchema.phase = z.string()
```

The previous over-tightened nonblank constraint has been removed.

**Status:** confirmed.

### A3. `viscosityUnit` is now treated as real actual-step evidence

`stepHasActualData()` includes `step.viscosityUnit !== undefined`.

**Status:** confirmed.

### A4. A real persisted Manufacturing Procedure source exists

The original FVL-05.004 conclusion that no persisted process plan exists independently of a trial was wrong.

Direct repository evidence now confirms:

- `packages/shared/src/schemas/dataExchange.ts` defines `processParameterSchema`;
- `packages/shared/src/engine/dataExchangeRegistry.ts` registers the `process_parameters` template;
- the registry targets the persisted `process_parameters` collection;
- `apps/desktop/src-tauri/src/masterdata.rs` lists `data/master/process_parameters.json` and registers the collection;
- `ProcessParametersPanel.tsx` reads `listRecords("process_parameters")` and filters by formula code / version.

`plannedProcedure: z.array(processParameterSchema)` is therefore directionally correct and reuses the canonical plan-row schema rather than re-modeling it.

**Status:** source existence confirmed. Identity/linkage handling still has defects below.

---

# B. HIGH-SEVERITY FINDINGS

## B1. Dataset schema version contract is violated by adding `plannedProcedure` without a version change

`dataset.ts` still declares:

```ts
DATASET_SCHEMA_VERSION = "1.0"
```

and its own documentation explicitly says the dataset schema version must be bumped when a dataset row field is added, removed, or renamed by FVL-05.003-.008 extractors.

AUDIT_000018 remediation added a new **required** field:

```ts
plannedProcedure: z.array(processParameterSchema)
```

to `formulaVersionProcessRowSchema`, while leaving `datasetSchemaVersion` at `"1.0"`.

This means two materially different row shapes can both claim dataset schema version `1.0`. Older serialized FVL-05.004 rows without `plannedProcedure` will now fail the current schema while still carrying the same version identifier.

### Why this matters

This defeats the purpose of FVL-05.001's explicit/incrementable dataset versioning and creates silent compatibility ambiguity for downstream dataset persistence, migrations, exports, and future feature generation.

### Required correction

Re-open the versioning decision from the actual FVL-05.001 contract. Either:

1. bump `DATASET_SCHEMA_VERSION` and provide the required compatibility/migration handling and tests; or
2. prove from an explicit repository contract that FVL-05 is still in a pre-versioned initial-shape construction phase where `1.0` is not yet considered published/frozen.

Do not simply leave `1.0` unchanged because tests currently pass.

**Severity:** HIGH.

---

## B2. `process_parameters` identity handling does not match its authoritative natural key

The Data Exchange registry is explicit:

```ts
naturalKey: ["formula_code", "formula_version", "step_number"]
duplicatePolicy: "create_or_update"
updatePolicy: "(formula_code, formula_version, step_number) updates the existing step."
```

But the FVL-05.004 extractor builds ambiguity around `ProcessParameter.code`:

```ts
buildProcessParametersByCode(...)
```

and throws `duplicate_process_parameter_code` only when two supplied rows share `code`.

`resolvePlannedProcedure()` then matches only `formulaCode` + `formulaVersion` and accepts every matching row, including two rows with the same authoritative `stepNumber` natural-key component as long as their `code` differs.

### Concrete failure mode

These two rows are ambiguous according to the registry but are accepted by the extractor:

- `(FORM-A, version 1, step 3, code PP-X)`
- `(FORM-A, version 1, step 3, code PP-Y)`

The registry says they represent the same natural-key step; FVL-05.004 would emit both.

The opposite mismatch is also possible: if `code` is not globally unique by source contract, two otherwise legitimate natural-key rows sharing a code would be rejected globally even when unrelated to the requested formula.

### Required correction

Trace the real Data Exchange commit/storage identity for `process_parameters` and make FVL-05.004 use that exact identity contract. At minimum:

- fail closed on duplicate `(formulaCode, formulaVersion, stepNumber)` identities;
- prove what `ProcessParameter.code` means and how it is generated/persisted;
- do not treat `code` as the authoritative identity unless repository source proves it is globally unique and canonically equivalent to the registry natural key;
- make lineage cite an identity that actually corresponds to the persisted source contract.

**Severity:** HIGH.

---

## B3. Current nested-lineage fix is collision-safe but conflicts with FVL-05.002's "exact sourceRecordId" contract

FVL-05.002 defines `sourceRecordId` as the exact, opaque source record ID and explicitly documents that it is never reformatted.

Current FVL-05.004 lineage instead stores:

```ts
sourceRecordId = JSON.stringify([trial.id, step.id])
```

or the equivalent for an observation.

This is collision-safe, but it is **not the persisted `TrialProcessStep.id` or `TrialObservation.id`**. It is a derived composite address placed in a field whose contract says it is the exact record ID.

### Why this matters

The fix solves one correctness problem by weakening another shared contract. A downstream lineage consumer that expects `sourceRecordId` to be directly queryable against the source record's `id` cannot do so without knowing an FVL-05.004-specific encoding convention.

### Required correction

Model parent scope structurally rather than overloading the child ID. Inspect the existing lineage contract before choosing the smallest compatible design, for example an optional parent/nested-address field while preserving the exact child `sourceRecordId`. If that changes dataset lineage shape, apply the FVL-05.001 versioning rule.

Do not revert to delimiter concatenation and do not fabricate surrogate IDs.

**Severity:** HIGH architectural contract risk.

---

## B4. A malformed `saved_version` trial with no `sourceFormulaVersionId` is silently ignored instead of failing closed

`laboratoryTrialSchema` contains only a comment saying `sourceFormulaVersionId` is required when `sourceType === "saved_version"`; the Zod object itself keeps the field optional and does not enforce the conditional relationship.

FVL-05.004 does:

```ts
if (trial.sourceType !== "saved_version" || trial.sourceFormulaVersionId !== version.id) continue;
```

Therefore a trial with:

```ts
sourceType: "saved_version"
sourceFormulaVersionId: undefined
```

is silently classified as irrelevant rather than malformed source data.

### Required correction

Either make the authoritative LaboratoryTrial schema enforce the conditional requirement at source, or make this extractor fail closed when it encounters a `saved_version` trial missing its required formula-version identity. Do not silently drop structurally contradictory source records.

**Severity:** HIGH data-lineage integrity risk.

---

## B5. `TrialObservation.processStepId`, when present, is not validated against the owning trial's process steps

`trialObservationSchema.processStepId` is optional. Optional is legitimate for trial-level observations, but when a value **is present**, FVL-05.004 copies the observation verbatim without verifying that the referenced step exists exactly once in the same trial.

A dangling observation can therefore be emitted as valid process evidence even though its claimed step relationship cannot be resolved.

### Required correction

For every observation with `processStepId !== undefined`:

- resolve it against that trial's process-step identity scope;
- fail closed if missing;
- fail closed if ambiguous;
- preserve observations with no `processStepId` as legitimate trial-level observations.

Add explicit regression tests.

**Severity:** HIGH/MEDIUM depending on intended laboratory domain invariant.

---

# C. MEDIUM-SEVERITY FINDINGS / DESIGN RISKS

## C1. Trial step attachments are dropped from the actual process dataset

`TrialProcessStep` contains:

```ts
attachments: z.array(attachmentReferenceSchema).default([])
```

but `processStepActualObservationSchema` does not expose `attachments`, and `stepHasActualData()` does not treat attachment presence as actual evidence.

A step with an execution attachment but otherwise default status/fields can disappear from `actualStepObservations`, and even when the step is included, its attachment provenance is lost.

This is especially notable because the authoritative storage documentation explicitly says attachment references are embedded on trial observations / deviations / process steps.

### Required action

Make a field-by-field source-to-dataset disposition table. If process-step attachments are part of "actual process observations", preserve them. If intentionally out of scope, document the exact governing task/source clause that excludes them and add a regression test so the omission is deliberate rather than accidental.

**Severity:** MEDIUM.

---

## C2. Source-schema parity was audited once, but no durable parity guard exists

`processStepPlanSchema` and `processStepActualObservationSchema` manually re-model selected fields from `trialProcessStepSchema`.

The `phase` defect proves this can drift. `trialObservationSchema` and `processParameterSchema` are safely reused verbatim, but the two process-step views remain hand-maintained.

### Required action

Prefer canonical schema composition (`pick`/equivalent) where possible, or add a focused parity contract test covering every selected field's type/optional/default semantics plus an explicit list of intentionally omitted fields.

**Severity:** MEDIUM maintainability risk.

---

## C3. Deterministic ordering uses `localeCompare` on unrestricted strings

The extractor sorts several tie-breakers with `localeCompare`.

IDs are only constrained as nonblank strings and can contain Unicode. `localeCompare` can depend on runtime ICU/locale behavior, so byte-for-byte ordering is not guaranteed across all environments.

Similarly, `createdAt` / `observedAt` are only `z.string()`, not an ISO-datetime schema, yet are sorted lexically as if chronological ordering were guaranteed.

### Required action

Use a locale-independent code-unit comparator for opaque IDs. Either prove timestamps are canonical sortable ISO strings at their write boundary or validate/fail closed before treating lexical order as chronological.

**Severity:** MEDIUM.

---

## C4. Error metadata field `formulationVersionId` is populated with unrelated identities on some global ambiguity failures

`FormulaVersionProcessDatasetExtractionError` always exposes `formulationVersionId`, but pool-build failures can populate that property with a formulation ID, trial ID, or process-parameter code because no actual requested formula version is yet in context.

This makes structured error metadata semantically unreliable even when the human-readable message is correct.

### Required action

Use a structured error context with correctly named optional fields (`formulationVersionId`, `formulationId`, `trialId`, `processParameterIdentity`, etc.) or otherwise guarantee the property name matches its value.

**Severity:** MEDIUM diagnostics/API risk.

---

## C5. Formula-code uniqueness required by plan linkage is assumed, not proven in FVL-05.004

`plannedProcedure` links plan rows via `Formulation.code + versionNumber`, because the source `process_parameters` table itself uses formula code/version rather than `FormulationVersion.id`.

FVL-05.004 currently verifies formulation **ID** uniqueness, but does not prove that `Formulation.code` is globally unique across the supplied/source collection before using it as a plan-link identity.

### Required action

Trace the source contract that guarantees formula-code uniqueness. If no such storage/domain invariant exists, fail closed when more than one formulation can claim the same plan-key namespace.

**Severity:** MEDIUM/HIGH until uniqueness is proven.

---

# D. DOCUMENTATION / CLOSURE-GATE FINDINGS

## D1. Tracker and handoff retain contradictory current truth

The tracker FVL-05.004 row still begins with the now-false narrative that no persisted process-plan record exists independently of a trial, then appends later corrective prose saying the opposite.

The handoff likewise claims the `process_parameters` natural key is `(formulaCode, formulaVersion)`, while the actual Data Exchange registry defines:

```text
(formula_code, formula_version, step_number)
```

Historical chronology can remain in the external log, but the current tracker/handoff should not require a reader to mentally reverse several superseded conclusions to discover current truth.

**Closure-gate impact:** `tracker/handoff truthful` is not fully satisfied.

**Severity:** HIGH documentation/control-plane risk.

---

## D2. Repeated premature `COMPLETE` claims reduce the log's evidentiary value

The Claude log marks FVL-05.004 COMPLETE in earlier cycles and later records newly discovered real defects. It eventually records AUDIT_000018 and a new COMPLETE claim.

Therefore a narrative `COMPLETE` line is not evidence of semantic closure by itself. Future audits must continue to derive truth from source contracts and executable tests, not from prior status prose.

**Required action:** keep the history, but clearly label superseded completion claims and maintain one concise current-state section.

---

## D3. Test/build counts in the log were not independently executed by this GPT audit

This audit inspected the connected GitHub branch, source code, tests, commit diff/metadata, tracker/handoff, and supplied Claude log. It did **not** execute the local Windows build, test suite, shortcut, or native binary.

The logged 42/42, 1831/1831, 1726/1726 and native build/hash claims may be true, but this GPT audit treats them as prior-run evidence rather than independently reproduced proof.

Before final closure, rerun all required commands from the final pushed HEAD.

---

# E. GAPS IN THE PREVIOUS GPT PROMPT

The previous prompt was materially better than earlier closure attempts: it forced repository truth, collision-safe lineage, schema parity, Manufacturing Procedure re-investigation, focused/full tests, dirty-worktree safety, push/build/shortcut verification, and explicitly prohibited FVL-05.005.

However, it missed several requirements that allowed the remaining issues above:

1. **No dataset-version compatibility gate.** It never required checking whether a row-shape change must bump `DATASET_SCHEMA_VERSION`.
2. **No authoritative natural-key audit for `process_parameters`.** It asked whether a persisted plan exists, but not whether the extractor uses the registry's exact natural key / duplicate policy / update policy.
3. **No lineage-contract audit against FVL-05.002 semantics.** It required collision safety, but not preservation of `sourceRecordId` as the literal source ID.
4. **No conditional LaboratoryTrial-link invariant check.** It did not require proving `saved_version => sourceFormulaVersionId present` is actually enforced.
5. **No referential-integrity check for `TrialObservation.processStepId`.**
6. **No field-disposition matrix for manually re-modeled process-step schemas.** A one-off parity audit can miss dropped fields such as attachments.
7. **No durable source-parity regression mechanism.** It did not require schema composition or parity tests that detect future source changes.
8. **No cross-environment determinism audit.** `localeCompare` and free-form timestamp strings were not challenged.
9. **No exact error-context audit.** Structured errors can carry misleading identity fields.
10. **Manufacturing Procedure proof was too existence-focused.** It should have traced schema -> registry natural key -> commit/storage identity -> read consumer -> formula/version relationship, not merely found a persisted collection.
11. **Tracker/handoff truthfulness was treated as append-only narrative.** It did not require removing or explicitly superseding stale current-state contradictions.
12. **The prompt was highly anchored to the two known AUDIT_000018 findings.** Future corrective prompts should require a fresh whole-scope adversarial pass after named defects are fixed, to reduce confirmation bias.

---

# F. Missing regression tests that should be added before closure

At minimum add tests for:

1. duplicate `process_parameters` authoritative natural key with different `code` values;
2. exact Data Exchange identity semantics for `process_parameters` lineage;
3. formula-code ambiguity / uniqueness behavior used for plan linkage;
4. `saved_version` trial missing `sourceFormulaVersionId`;
5. `TrialObservation.processStepId` pointing to no step;
6. attachment-only process-step evidence, or an explicit contract test proving attachments are intentionally excluded;
7. source-schema parity/disposition for all `TrialProcessStep` fields;
8. dataset schema-version compatibility after adding `plannedProcedure`;
9. locale-independent deterministic ordering for non-ASCII / delimiter-rich IDs;
10. structured extraction-error identity fields.

---

# G. Current closure decision

The following prior closure statement must **not** be treated as current truth yet:

`FVL-05.004 — IMPLEMENTATION AND ACCEPTANCE COMPLETE`

Current GPT audit status:

**FVL-05.004 — REOPENED / CONTINUE**

**FVL-05.005 — NOT STARTED**

Closure may be reconsidered only after every HIGH finding is resolved from direct repository contracts, MEDIUM findings are either fixed or explicitly justified by source evidence, all new regression tests pass, full acceptance gates pass from final HEAD, and tracker/handoff are rewritten to present one unambiguous current truth.
