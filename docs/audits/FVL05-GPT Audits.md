# FVL-05 — Independent GPT Audit Ledger

Append-only. Never overwrite a recorded audit — a Claude resolution is
always a NEW section appended below the audit it responds to, never an
edit to the audit's own text.

---

## AUDIT_FVL05_GPT_000001 (2026-08-23) — FVL-05.004 REOPEN

This file was found EMPTY (0 bytes) when the governing session prompt
(`docs/prompts/FVL05 Prompts.md`'s PROMPT 2) directed reading it first.
The findings below are transcribed from that prompt itself — the only
record of this audit that exists in the repository. Verdict as stated in
that prompt: **CONTINUE / REOPEN FVL-05.004** — the prior session's own
"FVL-05.004 — IMPLEMENTATION AND ACCEPTANCE COMPLETE" claim (closing the
AUDIT_000018 cycle, commits `92a89ae`/`0b02cab`) was explicitly overruled
as not current truth.

**FINDING A — Dataset schema version compatibility.** `plannedProcedure`
was added as a new required field to `formulaVersionProcessRowSchema`
while `DATASET_SCHEMA_VERSION` stayed `"1.0"`, despite `dataset.ts`
itself stating that adding/removing/renaming dataset-row fields requires
a version change. Determine from the actual FVL-05.001 contract whether
a bump is required now, or whether 1.0 is still explicitly
pre-publication/unfrozen while the full FVL-05.003-.008 row shape is
assembled. A passing schema test is not sufficient evidence.

**FINDING B — process_parameters authoritative identity.** The Data
Exchange registry's natural key is `(formula_code, formula_version,
step_number)`; FVL-05.004's ambiguity handling instead centers on
`ProcessParameter.code` (`buildProcessParametersByCode()`,
`duplicate_process_parameter_code`), which may not match the real
persisted identity contract. Trace schema -> registry natural key ->
validation -> commit -> storage -> update path -> reader -> extractor
lineage. Test: same formulaCode/formulaVersion/stepNumber, different
code — the extractor must not silently emit two authoritative process
steps if the source contract treats them as one record. Determine
whether `code` is globally unique, derived from the natural key,
independently authored, or merely an internal storage identity — do not
assume global uniqueness.

**FINDING C — Lineage contract vs. collision-safe encoding.** The prior
cycle's nested lineage (`JSON.stringify([trial.id, record.id])`) is
collision-safe but may violate FVL-05.002's own documented contract that
`sourceRecordId` is the exact opaque persisted record id, never
reformatted. Resolve architecturally: child `sourceRecordId` stays the
exact persisted child id; trial scope is represented structurally;
cross-trial reused child ids stay unambiguous; delimiter-containing ids
stay collision-safe; lineage stays deterministic/recoverable; no
fabricated surrogate identity; no silent change to FVL-05.003 semantics.
An additive parent/nesting field on the shared schema is acceptable if
it's the smallest correct change (with its dataset-schema-version impact
handled).

**FINDING D — saved_version trial conditional invariant.**
`laboratoryTrialSchema` documents `sourceFormulaVersionId` as required
when `sourceType === "saved_version"`, but verify whether Zod actually
enforces it. The extractor can currently silently ignore a
`sourceType="saved_version"`/`sourceFormulaVersionId=undefined` record
because it just fails the version match and continues. Either strengthen
the canonical schema (if compatible with stored records) or fail closed
in the extractor.

**FINDING E — TrialObservation -> process step referential integrity.**
`TrialObservation.processStepId` is optional; when present it must
resolve to exactly one process step in the SAME trial. Fail closed on a
missing/ambiguous reference rather than emitting a dangling reference as
valid process evidence.

**FINDING F — Process step attachment disposition.**
`TrialProcessStep.attachments` is not preserved by either dataset view,
and `stepHasActualData()` does not treat attachments alone as execution
evidence. Build a field-disposition table for EVERY `TrialProcessStep`
field (plan view / actual view / deliberately omitted / reason) and make
an explicit, tested decision for attachments rather than an accidental
drop.

**FINDING G — Durable source schema parity.** AUDIT_000018 already found
one manual re-modeling mismatch (`phase`), proving schema duplication can
drift. Re-audit `trialProcessStepSchema` vs. `processStepPlanSchema`/
`processStepActualObservationSchema` field by field; prefer canonical
reuse/composition, and where a direct `pick()` isn't practical, add a
durable parity test so a future source field addition/constraint change
cannot silently drift.

**FINDING H — formula code uniqueness for plan linkage.**
`process_parameters` links by `formulaCode`+`formulaVersion`, not
`FormulationVersion.id`. Trace whether `Formulation.code` is globally
unique by authoritative contract; if not enforced, fail closed when the
plan-key namespace is ambiguous (two different formulations must not be
able to claim the same process-plan namespace).

**FINDING I — Deterministic ordering.** Sort functions use
`localeCompare` for opaque ids/codes, which is locale/ICU-dependent, not
guaranteed environment-independent. Use a locale-independent comparator.
Also: `createdAt`/`observedAt` are source strings used as a chronological
sort key via lexical order — prove the writer contract guarantees a
canonical sortable ISO format, or validate/fail closed.

**FINDING J — Structured error context.**
`FormulaVersionProcessDatasetExtractionError.formulationVersionId` must
not carry unrelated values (a formulationId, a trialId, a
process-parameter code) for pool-wide failures occurring before a
formula-version context exists. Use properly named optional fields (or
another minimal structured context) so the error's own metadata is
semantically truthful.

Required new regression tests: VERSION1, PLANKEY1, PLANKEY2, FORMCODE1,
LINK1, OBSREF1, OBSREF2, ATTACH1, PARITY1, ORDER1, ERROR1 — plus a full
re-run of every pre-existing LINEAGE1-6/PLAN1/phase-parity/viscosityUnit/
zero-false/non-mutation/non-aliasing/public-export/determinism test,
none weakened or deleted.

---

## CLAUDE RESOLUTION — AUDIT_FVL05_GPT_000001 (2026-08-23)

Branch `feature/laboratory-stability`, starting HEAD
`0b02cabc183c6093e960d2fca0d637f528097541` (== remote at session start).
Full independent re-audit performed against current repository source
(not trusted from prior logs) before and after fixing each finding — see
"Whole-scope adversarial re-audit" at the end of this section.

**FINDING A — PARTIALLY CONFIRMED (real question, resolved as "no bump
needed" with direct evidence, not a guess).** Repo-wide grep
(`grep -rln "formulaVersionProcessRowSchema\|formulaVersionCompositionRowSchema\|extractFormulaVersionProcessRows\|extractFormulaVersionDatasetRows"`
across `apps/` and `packages/`, excluding `*.test.ts`) returns exactly
three files: the two engine files that DEFINE these extractors and
`schemas/dataset.ts` itself — zero consumers anywhere (no persistence,
UI, or downstream package reads a row of this family). `SchemaMigration`
(`engine/migrations.ts`) exists specifically to protect PERSISTED records
at an old version from becoming unreadable; with nothing persisted, there
is nothing "old" to protect. Established precedent: FVL-05.002
(`sourceRecords`), FVL-05.003 (the whole composition row type), and
FVL-05.004's own original row type all added shape under the same `"1.0"`
without bumping. Resolution: `DATASET_SCHEMA_VERSION` stays `"1.0"`;
`schemas/dataset.ts`'s FVL-05.004 header comment now states the exact
bump trigger explicitly (first external consumer, or first shape change
after one exists) so the next FVL-05 task that builds a real consumer has
a concrete rule to re-verify against, not just precedent. Test: `VERSION1`.

**FINDING B — CONFIRMED, fixed.** Traced the full chain:
`dataExchangeRegistry.ts`'s `process_parameters` template declares
`naturalKey: ["formula_code", "formula_version", "step_number"]`,
`duplicatePolicy: "create_or_update"`. `dataExchangeCommit.ts`'s
`commitProcessParameters` derives `code` MECHANICALLY from that exact
natural key
(`` `${r.formula_code}-v${r.formula_version}-step${r.step_number}` ``)
and upserts via `findByCode`+`upsertRecords` — so `code` is not an
independently-authored identity; it is a pure function of the natural
key, and two legitimately committed rows can never share a natural key
with different codes through that path. But the extractor accepts an
arbitrary supplied `ProcessParameter[]` pool with no such guarantee typed
into it. Fixed: new `buildProcessParametersByNaturalKey`-equivalent logic
inside `buildProcessParametersByCode`
(`formulaVersionProcessDatasetExtractor.ts`) tracks
`(formulaCode, formulaVersion, stepNumber)` -> `code` and throws a new
`duplicate_process_parameter_natural_key` error on a same-natural-key/
different-code collision, in addition to the pre-existing exact-code
check. Tests: `PLANKEY1` (collision fails closed), `PLANKEY2` (the real
derived-code convention across genuinely different steps never
false-positives).

**FINDING C — CONFIRMED, fixed.** Re-read `sourceRecordReferenceSchema`'s
own FVL-05.002 documentation directly: "the exact id of a record...
opaque and case-sensitive — never trimmed, normalized, or reformatted."
The prior cycle's `JSON.stringify([trial.id, step.id])` violated this —
the emitted `sourceRecordId` was a synthesized compound string, not the
exact persisted child id. Fixed with the smallest correct additive
change: a new OPTIONAL `parentRecordId` field on
`sourceRecordReferenceSchema` (`schemas/dataset.ts`), and the
duplicate-pair rejection in `sourceRecordLineageSchema` now keys on the
full `(sourceEntity, parentRecordId, sourceRecordId)` triple instead of
the pair. `formulaVersionProcessDatasetExtractor.ts`'s
`buildProcessTrial` now cites
`{ sourceEntity: "trialProcessStep", sourceRecordId: step.id, parentRecordId: trial.id }`
— `sourceRecordId` is the exact, unmodified persisted step/observation
id; `parentRecordId` (the trial's own globally-unique id) is what keeps
two different trials' same-id steps/observations distinct. FVL-05.003
never sets `parentRecordId` (stays `undefined`), so its citations and
tests are unaffected — confirmed by the full shared suite staying green.
The now-obsolete `encodeNestedLineageId` function/export was removed
entirely (repo-wide grep confirmed zero external consumers of it beyond
this file's own tests and historical doc/log prose). Tests: LINEAGE1-6
retained and rewritten around the new shape (none weakened — LINEAGE1/2
now assert the FULL `(parentRecordId, sourceRecordId)` tuple is unique
rather than `sourceRecordId` alone, which is the CORRECT invariant now
that `sourceRecordId` is deliberately allowed to repeat across trials).

**FINDING D — CONFIRMED, fixed.** Confirmed via direct grep
(`grep -n "superRefine\|refine" packages/shared/src/schemas/laboratory.ts`
— zero matches) that `laboratoryTrialSchema` has NO conditional
enforcement of `sourceFormulaVersionId` when `sourceType ===
"saved_version"` — it is comment-only. Chose the narrowly-scoped
extractor-side fix over touching the shared, broadly-consumed
`laboratoryTrialSchema` (out of this task's scope/blast radius — that
schema is read/written across FVL-01/02 trial-creation UI and
Rust-persisted records this task must not risk). `buildTrialsById` now
fails closed, pool-wide, with a new `invalid_saved_version_trial_link`
error on a `"saved_version"` trial with a missing or blank
`sourceFormulaVersionId`. Tests: `LINK1` (missing), `LINK1b` (blank), and
a positive control proving a `"working_draft"` trial with no
`sourceFormulaVersionId` at all remains legitimate (the check is scoped
to `sourceType === "saved_version"` only).

**FINDING E — CONFIRMED, fixed.** `buildProcessTrial` now validates, for
every observation in a trial, that a defined `processStepId` resolves
against that SAME trial's own `stepsById` map (already built earlier in
the same function for the duplicate-step-id check) — new
`dangling_observation_process_step_id` error on failure. Deliberately
scoped per-trial, not cross-trial: an observation in trial B naming a
step that only exists in trial A still fails closed (no cross-trial
resolution), proven by `OBSREF2b`. Tests: `OBSREF1` (valid reference
accepted), `OBSREF2` (dangling reference fails closed), `OBSREF2b`
(cross-trial reference fails closed).

**FINDING F — CONFIRMED, fixed.** Built the full field-disposition table
now in `schemas/dataset.ts`'s FVL-05.004 header comment, covering every
`trialProcessStepSchema` field. Decision for `attachments`: actual-view
only (evidence attached during/after execution — the same bucket as
`operator`/`observation`/`deviationNote` on this same merged record,
never a plan-authored field). Added `attachments` to
`processStepActualObservationSchema`; `toProcessStepActualObservation`
now carries it through; `stepHasActualData` now treats a non-empty
`attachments` array as actual-execution evidence on its own (same
principle as the prior cycle's `viscosityUnit`-only fix). Test:
`ATTACH1`.

**FINDING G — CONFIRMED, fixed.** New `PARITY1` test iterates
`Object.keys(trialProcessStepSchema.shape)` and asserts every key is
present in `processStepPlanSchema.shape`, `processStepActualObservationSchema.shape`,
or an explicit `OMITTED_SOURCE_FIELDS` set (`createdAt`/`updatedAt`) —
`id` special-cased to require `processStepId` in both views. This fails
the moment a future field is added to `trialProcessStepSchema` without a
conscious disposition decision, closing exactly the class of drift that
produced the original `phase` mismatch. `trialObservationSchema` is
reused verbatim in `processTrialSchema.observations` (unchanged), so no
equivalent test is needed there — drift is structurally impossible by
construction, not merely tested against.

**FINDING H — CONFIRMED, fixed.** Read `formulations.rs`'s
`save_formulation` directly: storage is keyed by `id`
(`formulation_dir(&app, id)`) only — no check anywhere for a `code`
collision against another formulation. `Formulation.code` is therefore
NOT enforced globally unique by any authoritative repository contract.
Fixed: `buildFormulationsById` now also tracks `code` -> `id` and throws
a new `duplicate_formulation_code` error when two different formulation
ids in the supplied pool share a `code`, since that makes the
`process_parameters` plan-key namespace genuinely ambiguous. Test:
`FORMCODE1`.

**FINDING I — CONFIRMED, fixed (both sub-issues).** (1) Every
`.localeCompare()` call on an opaque id/code (`byStepOrder`,
`byObservedOrder`, `byTrialOrder`, `byProcessParameterOrder`) replaced
with a new `compareOrdinal` helper (`a < b ? -1 : a > b ? 1 : 0` — UTF-16
code-unit order, no ICU/locale involvement). Test `ORDER1` proves the two
genuinely disagree on a real pair (`"a".localeCompare("B") < 0` but
`"a" > "B"` ordinally) and that this extractor produces the ordinal
result. (2) Confirmed `laboratoryTrialSchema.createdAt`/
`trialObservationSchema.observedAt` are bare `z.string()` — no format
constraint. Confirmed the app-wide writer convention IS
`Date.prototype.toISOString()` (`masterdata.ts`'s `nowIso()` is a bare
`toISOString()` call, used throughout `apps/desktop/src/lib/*.ts`) — a
real, strong convention, but not a hard schema guarantee. Chose
validate-or-fail-closed over touching the shared Laboratory schema (same
narrow-scope reasoning as Finding D): new `isCanonicalIsoTimestamp`
(round-trip `new Date(value).toISOString() === value` check) is applied
to every trial's `createdAt` (pool-wide, in `buildTrialsById`) and every
linked trial's observations' `observedAt`
(`buildProcessTrial`), throwing a new `invalid_timestamp_format` error on
a non-conforming value rather than silently lexically mis-ordering
history. Tests: two new fail-closed tests (malformed `createdAt`,
malformed `observedAt`), plus `ORDER1b` (non-ASCII ids stay deterministic
under reordering).

**FINDING J — CONFIRMED, fixed.** The prior error class's single
`formulationVersionId: string` field was populated with a formulation id
(`buildFormulationsById`'s duplicate check), a trial id
(`buildTrialsById`'s), and a process-parameter code
(`buildProcessParametersByCode`'s) — none of which are actually a
formula-version id. Redesigned
`FormulaVersionProcessDatasetExtractionError` to take a `context` object
with correctly-named OPTIONAL fields
(`formulaVersionId`/`formulationId`/`formulaCode`/`trialId`/
`processStepId`/`trialObservationId`/`processParameterCode`) — every
throw site now supplies only the fields that are actually true of that
failure (e.g. `duplicate_formulation_id` sets `formulationId` only,
never `formulaVersionId`; `trial_formula_link_conflict` legitimately sets
BOTH `formulaVersionId` and `trialId`, since both are genuinely known at
that point). Zero external consumers of this error class exist (repo-wide
grep), so this is a safe, non-breaking-in-practice redesign. Test:
`ERROR1` (asserts the exact field truthfulness for four different error
codes, including that `formulaVersionId` stays `undefined` where it
would previously have held an unrelated id).

**Whole-scope adversarial re-audit (per the governing prompt's own
instruction — not "did I fix the list", but "what would prevent me from
trusting this extractor as a historical experiment dataset source, seen
fresh").** Re-read both source files end to end after all ten findings
were fixed. Checked: identity scope (every pool-wide/per-trial identity
now has an explicit fail-closed check); schema compatibility (Finding A);
source fidelity (Finding G's parity test + Finding B's natural-key
enforcement); hidden fabricated defaults (none introduced — every new
field is either copied verbatim from a source record or left
legitimately absent); optional-field loss (`attachments` now flows
through; every other optional field was already verified in the prior
cycle); lineage correctness (Finding C); ambiguity handling (Findings B/D/
E/H); cross-trial leakage (`OBSREF2b` proves none); cross-formula leakage
(Finding H); plan/actual conflation (unchanged, already correctly
separated); duplicate natural keys (Finding B); source mutation (still
zero — every builder reads, never writes, source objects; LINEAGE6/the
"does not mutate its inputs" test both still pass); aliasing (zod's
always-rebuilding `safeParse` still guarantees this); deterministic
serialization (Finding I); public exports (the barrel `export *` line in
`index.ts` is unchanged and still correct — `encodeNestedLineageId`'s
removal from the module's exports is intentional, not a regression,
since it was a genuinely wrong technique being replaced, with zero
external consumers); backward compatibility (the `processParameters?`
input field stays optional; every OTHER extraction-input shape is
unchanged). No further defect found beyond the ten findings above.

**Tests.** `formulaVersionProcessDatasetExtractor.test.ts`: 42 -> 59
tests (+17: PLANKEY1, PLANKEY2, VERSION1, FORMCODE1, LINK1, LINK1b, a
working-draft positive control, OBSREF1, OBSREF2, OBSREF2b, ATTACH1,
PARITY1, ORDER1, ORDER1b, two timestamp-format fail-closed tests, ERROR1;
0 removed; LINEAGE1/2's assertions rewritten to the new
`parentRecordId`-based tuple, not weakened — the new assertion is
strictly the correct invariant for the new, contract-compliant citation
shape). `pnpm --filter @formulab/shared exec vitest run
src/engine/formulaVersionProcessDatasetExtractor.test.ts`: **59/59**.
`pnpm --filter @formulab/shared exec vitest run` (full suite): **86
files / 1848 tests passed** (1831 -> 1848, +17, no regression —
`dataset.test.ts`, `formulaVersionDatasetExtractor.test.ts`, and
`dataExchangeRegistry.consistency.test.ts` all confirmed unaffected by
the additive `parentRecordId` schema field). `pnpm --filter
@formulab/shared exec tsc --noEmit`: clean. `pnpm --filter
@formulab/desktop exec tsc --noEmit`: clean. `pnpm --filter
@formulab/desktop lint`: clean. Full desktop test suite, tracker
validator, `git diff --check`, and native build/shortcut results
recorded in this cycle's own section of
`docs/external-logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md`.

**Files changed:** `packages/shared/src/schemas/dataset.ts`,
`packages/shared/src/engine/formulaVersionProcessDatasetExtractor.ts`,
`packages/shared/src/engine/formulaVersionProcessDatasetExtractor.test.ts`,
`docs/FORMULAB_V1_TASK_TRACKER.md`, `docs/handoffs/FORMULAB_V1_CURRENT.md`,
this file, `docs/prompts/FVL05 Prompts.md`, and the external log.
