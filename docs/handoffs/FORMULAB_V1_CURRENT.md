# FormuLab v1 — Current Execution Pointer

**Do not create a new task outside `docs/FORMULAB_V1_TASK_TRACKER.md`.**
This file only points at the tracker's current state — it is not itself a
scope document. Frozen scope: `docs/FORMULAB_V1_FINAL_SCOPE.md`.

## Frozen scope reference

- Scope: [`docs/FORMULAB_V1_FINAL_SCOPE.md`](../FORMULAB_V1_FINAL_SCOPE.md)
  — frozen 2026-08-17.
- Tracker: [`docs/FORMULAB_V1_TASK_TRACKER.md`](../FORMULAB_V1_TASK_TRACKER.md)
  — 11 work packages (FVL-01..FVL-11), 171 tasks total (FVL-04 grew from
  12 to 26 tasks on 2026-08-18 — see "FVL-04 scope expansion" below).

## Current work package

**FVL-03 — Unified Formulation Pipeline ↔ Existing FormuLab Engines** —
ON PROCESS, 17/18 tasks COMPLETED (FVL-03.001, FVL-03.002, FVL-03.003,
FVL-03.004, FVL-03.005, FVL-03.006, FVL-03.007, FVL-03.008, FVL-03.009,
FVL-03.010, FVL-03.011, FVL-03.013-018). FVL-01 remains CLOSED (21/21);
FVL-02 remains CLOSED (24/24, 2026-08-17).

## Current task

**`FVL-03.012`** — blank, **NOT STARTED**. Not begun yet this session.
FVL-03.011 — end-to-end authoritative provenance integration —
COMPLETED this session (no subagents used, per explicit instruction).

## FVL-04 scope expansion (2026-08-18, documentation/tracker session only)

An explicit human decision approved widening FVL-04 (Data Onboarding
Through Existing Data Exchange) from 12 to 26 tasks: FVL-04.013–.025 add
enterprise external-source connector/mapping/crosswalk onboarding (a
read-only connector layer — file/database/REST API extraction, a
reusable mapping profile, and an external-ID crosswalk — landing in the
SAME existing Data Exchange preview/validation/commit lifecycle, never a
second import platform); FVL-04.026 adds a human-readable, stable
naming convention for downloaded literature/source documents and saved/
exported formulation artifacts. Full detail in
`docs/FORMULAB_V1_TASK_TRACKER.md`'s FVL-04 section and
`docs/FORMULAB_V1_FINAL_SCOPE.md`'s new "FVL-04 scope expansion —
approved 2026-08-18" subsection.

**This session was documentation/tracker scope only — no production code,
schema, or UI was created or modified.** All 14 new tasks are blank, none
started. **FVL-04 IMPLEMENTATION — NOT STARTED.**

**The current implementation pointer does NOT move.** It remains exactly
as recorded above:

**CURRENT IMPLEMENTATION TASK REMAINS: `FVL-03.009` — NOT STARTED.**

## FVL-03.011 resolution (this session)

"End-to-end authoritative provenance — extend `traceability.py`'s
existing model, do not fork it." Full audit (no subagents, per explicit
instruction) confirmed ONE coherent provenance model already exists:
`traceability.py`'s `TraceEvent` owns ONLY role-level ingredient
selection/rejection decisions (`material_code` carried in `source_ids`
since FVL-03.002), by its own explicit, still-valid design — every other
domain (Compatibility/Safety/Regulatory/Cost/Inventory/Substitution/
Optimization) owns its own real IDs on its own real record shape, never
duplicated into Python trace_events. **No `traceability_v2.py` or second
provenance schema created.** Generated→saved lineage (§A13) confirmed
ALREADY satisfied: `promoteGeneratedFormula.ts` already writes a real
back-reference into the existing `FormulationVersion.changeReason`
field ("Promoted from AI-generated session ${session.id}...") — no new
persistence needed.

**Two real, concrete visibility gaps found and closed** (data already
existed, was never rendered): (1) `GeneratedSafetySummary.tsx`/
`GeneratedCompatibilitySummary.tsx` computed each finding's real
`ruleId` all along but used it only as a React `key` — now shown,
alongside affected materials, on every finding row; (2)
`formulationReport.ts` had a Safety section (FVL-03.009) and a
Regulatory section (FVL-03.010) but had NEVER had a Compatibility
section at all since FVL-03.008 — added, reusing the exact same
already-computed `compatibilities` array the UI renders. A third gap:
no ingredient row anywhere in the result UI displayed its own resolved
`material_code` (the `GeneratedIngredient` type didn't even carry the
field) — added (optional, backward-compatible) with an honest subtext
showing the real code or an explicit "Unresolved" disclosure.

Verified: `pnpm --filter @formulab/desktop test` — 1422/1422 across 152
files (6 new). `typecheck`/`lint` — clean. `python -m pytest
runtime/pipeline -q` — 361 passed/5 subtests (unchanged, zero Python
files touched). `python scripts/validate_v1_tracker.py` — OK, 171
tasks, no drift. `git diff --check` — clean (LF/CRLF warnings only). No
FVL-03.012 work started; no new provenance framework anywhere.

## FVL-03.010 resolution (prior session)

"Make the EXISTING Kenya/EAC Regulatory Engine the single authoritative
regulatory verdict for the formulation workflow — retire
`runtime/pipeline/regulatory.py`, no new engine, no Python port." Full
audit confirmed `regulatory.py::evaluate_regulatory()` was a real,
independently-computing second final-verdict authority — and, by direct
comparison, itself STALE against its own source (only 7 of the TS
catalog's real 16 seed rules). **Resolved by full retirement** (same
precedent as safety.py): `regulatory.py`/`test_regulatory.py` (14 tests)
deleted; `pipeline.py`/`validation_plan.py` (whose last remaining
`regulatory_overall` parameter — and VAL-002, the last Safety/Regulatory
advisory entry — is now gone entirely)/`test_pipeline.py`/
`test_traceability.py` updated. `review_claims()`'s structural
claim-vs-composition check (the one distinct Python capability, no TS
equivalent) was deliberately retired with the rest, not selectively
kept, since it computed a real claim verdict — flagged for a possible
future TS catalog addition instead.

**New client-side seam**: `generatedFormulaRegulatory.ts::evaluateGeneratedFormulaRegulatory()`
resolves `brief.market` free text into a real `RegulatoryJurisdiction`
via a small wrapper-local alias table (ported from the retired module's
own `_MARKET_ALIASES`); `formulaState` reuses the engine's own real
`REGULATORY_FINDING_STATUSES`/`NON_BLOCKING_FINDING_STATUSES` — `blocked`
reserved for a real `non_compliant` finding only (never the
`missing_data`/`human_review_required` findings a generated,
unconfirmed session will almost always carry, which surface as
`warning` instead); zero findings is never `compliant`, preserving the
retired module's own "sparse coverage ≠ clean" policy. `category` is
always `"human_review_required"` (the classifier's own honest-
uncertainty value, not an invented fallback) — same scope decision
FVL-03.008/.009 made for Safety. New `useRegulatoryRules()` hook loads
the LIVE `regulatory_rules` collection.

**Downstream wiring**: `pickCheapestValidVersion()`/
`pickMostInventoryFeasibleVersion()` gained an independent 5th
`regulatories` eligibility gate. `FormulationResultPage.tsx`
(RegulatoryTab/SummaryTab/VersionSummaryCard) and `formulationReport.ts`
fully rewired off the legacy `card.regulatory` JSON — closing the same
"Download Report" split-authority risk FVL-03.009 closed for Safety. The
now-fully-dead `statusTone()` helper was removed. **Real new wiring, not
just an audit finding**: `SubstitutionPanel.tsx`'s one-to-one candidate
scoring had never populated `SubstitutionCandidateInput.regulatoryPermitted`
even though `substitution.ts`'s own scoring dimension already existed —
now wired per candidate against the project's own real
`formulation.targetMarkets[0]`, with a locally-tracked `noBlockingOnly`
filter exclusion for a real violation (never persisted, never extending
the shared engine's own output schema). Advanced Optimizer/System
Substitution confirmed to be a genuine, pre-existing, DOCUMENTED "not
yet implemented" boundary (`regulatoryOptimizationPolicySchema.mode`
hard-locked to `"not_available"`) — not a gap this task closes; only its
now-stale doc comment was corrected, zero behavior change.

Verified: `pnpm --filter @formulab/desktop test` — 1416/1416 across 152
files (32 new: 14 `generatedFormulaRegulatory.test.ts`, 8
`GeneratedRegulatorySummary.test.tsx`, 5 `costComparison.test.ts`, 3
`inventoryComparison.test.ts`, 3 `formulationReport.test.ts`, 2
`SubstitutionPanel.test.tsx`; `FormulationResultPage.test.tsx` count
unchanged, 3 tests corrected in place). `typecheck`/`lint` — clean.
`pnpm --filter @formulab/shared test` — 1311/1311 (comment-only doc fix
in `optimization.ts`, unchanged count). `python -m pytest
runtime/pipeline -q` — 361 passed, 5 subtests (down from 376+5 by
exactly the 15 tests removed with `regulatory.py`). `python scripts/
validate_v1_tracker.py` — OK, 171 tasks, no drift. `git diff --check` —
clean (LF/CRLF warnings only). No FVL-03.011+ work started; no new
regulatory engine anywhere; no Python regulatory rule-matching logic
remains.

## FVL-03.009 resolution (prior session)

"Make the EXISTING Safety Engine the single authoritative final safety
verdict for the formulation workflow — retire `runtime/pipeline/
safety.py` as a competing final-verdict authority, no new engine, no
Python port." Full audit (no subagents, per explicit instruction)
confirmed `runtime/pipeline/safety.py::evaluate_safety()` was a real,
independently-computing SECOND final-verdict authority — its own
`_SENSITIZER_CLASS_INGREDIENTS`/`_ALLERGEN_DECLARATION_INGREDIENTS`/
`_CORROSIVE_HANDLING_INGREDIENTS`/`_IRRITANT_POWDER_HANDLING_INGREDIENTS`/
`_SULFATE_KEYS` hazard tables computing its own `overall_status`, never
consuming `packages/shared/src/engine/safety.ts`. **Resolved by full
retirement, not permanent reconciliation** (same Option-A precedent
FVL-03.003 already established): `safety.py` and `test_safety.py` (9
tests) deleted entirely; `pipeline.py` no longer imports `safety`,
builds `safety_result`, emits `card["safety"]`, or appends a
`safety`-sourced `evidence_gaps` entry; `validation_plan.py`'s
`safety_overall` parameter removed, VAL-002 narrowed to its still-live
regulatory-only half (Regulatory consolidation untouched — FVL-03.010's
job); `test_pipeline.py`'s zero-LLM guard now asserts `"safety" not in
card`; `test_traceability.py`'s safety-provenance test (reading the
now-removed `card["safety"]["findings"]`) deleted, its adjacent
regulatory test untouched. The separate, legitimate pre-generation
`classify_target()`/`safety_gate()` AI-request classification gate was
confirmed unrelated and left completely alone. Full detail in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`'s new "Safety Engine
boundary" section.

**Read-only, no promotion needed — same seam pattern as FVL-03.008**:
new pure `apps/desktop/src/lib/generatedFormulaSafety.ts::evaluateGeneratedFormulaSafety(formula, materials, rules, opts)`
reshapes via `linesFromGeneratedFormula()` and hands it, unmodified, to
the real `evaluateSafety()`. Rule set is a REQUIRED caller-supplied
parameter — new `useSafetyRules()` hook loads the LIVE `safety_rules`
masterdata collection, not the bare `SEED_SAFETY_RULES` constant.
`classifyProductSafety()` deliberately NOT wired (a generated session's
free-text `brief.category` has no reliable join to a real
`ProductFamily.hazardClass` record — fabricating that join would violate
the standing no-fabricated-identity rule, the same scope decision
FVL-03.008 made for Compatibility).

**`formulaState`**: `safe`/`warning`/`blocked`/`unknown`. `"blocked"` iff
a real `severity === "blocking"` finding fired (the platform's own
already-confirmed hard-block convention, reused not invented);
`"warning"` iff any non-blocking finding fired; otherwise `"unknown"`
(never `"safe"`) when at least one ingredient never resolved to a
canonical `materialCode`. `unresolvedMaterialCount` always surfaced
honestly alongside real findings.

**Version eligibility, not a combined score**: `pickCheapestValidVersion()`/
`pickMostInventoryFeasibleVersion()` gained an optional 4th `safeties`
parameter, independent of and additive to the existing `compatibilities`
gate — a safety-`blocked` version can never be crowned cheapest-valid or
most-feasible; `warning`/`unknown` never exclude; omitting the parameter
preserves every pre-existing call site's behavior exactly.

**UI/report — fully rewired off the legacy `card.safety` shape**:
`FormulationResultPage.tsx`'s `SafetyTab` rewritten around a new thin
`GeneratedSafetySummary` presenter; a Safety section added to
`SummaryTab` (including its "Readiness" badges block — a third,
easy-to-miss `card.safety.overall_status` reference caught only by this
task's own required closure-time grep audit, not by typecheck/lint/the
first test pass); a Safety row/blocked-banner added to
`VersionSummaryCard`. `formulationReport.ts` rewired to accept a
`safetyByVersion` map (the exact same computed result the UI renders)
instead of reading the retired `card.safety` JSON — closing the one real
split-authority risk in this task (the "Download Report" path), with an
honest "not available" (never a fabricated verdict) when no result was
computed. `formulationV2.ts`'s `SafetyResult` interface kept, not
deleted, but its doc comment now states plainly it is legacy-only —
read by zero current code, kept only so a historical session file still
parses. Historical sessions carrying legacy `card.safety` JSON open
without crashing and never surface as current authority (proven by a
dedicated test against the pre-existing SESSION_V6 fixture).

**Optimizer/substitution/system-substitution reuse — confirmed, not
rewritten**: all three already consume the real Safety Engine correctly
(`blockingExclusionConstraints`, `SubstitutionPanel.tsx`'s
`hasBlockingSafetyFinding`); none needed new code. **Same disclosed,
out-of-scope finding FVL-03.008 already flagged, reconfirmed for
Safety**: those three callers pass the hardcoded `SEED_SAFETY_RULES`
constant rather than the live edited collection — a data-freshness gap,
not a duplicate-authority violation; flagged again for a future
session. Compatibility and Safety confirmed to remain separate domains
throughout — no merged findings, no shared verdict field.

Verified: `pnpm --filter @formulab/desktop test` — 1381/1381 across 150
files (24 new: 9 `generatedFormulaSafety.test.ts`, 7
`GeneratedSafetySummary.test.tsx`, 5 `costComparison.test.ts`, 3
`inventoryComparison.test.ts`, 3 `formulationReport.test.ts`; 4 existing
`FormulationResultPage.test.tsx` tests corrected, not newly added, since
the real Safety and Compatibility engines now legitimately co-fire on
pre-existing fixtures). `typecheck`/`lint` — clean. `python -m pytest
runtime/pipeline -q` — 376 passed, 5 subtests (down from 386+5 by
exactly the 10 tests removed with `safety.py`/its traceability test).
`python scripts/validate_v1_tracker.py` — OK, 171 tasks, no drift.
`git diff --check` — clean (LF/CRLF warnings only). Closure-time
single-authority grep re-audit (`overall_status`/`evaluate_safety`/
`evaluateSafety`/`classifyProductSafety`/`hazard` across
`runtime/pipeline`, `runtime/formulation`, `packages/shared/src`,
`apps/desktop/src`, `apps/desktop/src-tauri/src`) found zero live-code
hits outside the one authoritative TS engine and its confirmed-correct
callers. No FVL-03.010+ work started; no new safety engine anywhere; no
Python safety hazard-scoring logic remains. Regulatory consolidation
(`regulatory.py`/`regulatoryRules.ts`) completely untouched. Zero-LLM
intact; `/live` untouched.

## FVL-03.008 resolution (prior session)

"Wire the EXISTING Compatibility Engine as the authoritative chemical/
material compatibility hard-constraint verdict — no new engine, no
duplicate rules in Python, `rules.py` stays request-constraint-only."
Full audit (no subagents, per explicit instruction) found **zero engine/
schema gap**: `evaluateCompatibility()`
(`packages/shared/src/engine/compatibility.ts`) is already a complete,
deterministic, rule-driven checker — real `RULE_SEVERITIES`
(`info`/`warning`/`error`/`blocking`), real `materialCode` identity via
`materialFor()`, honest `dataIncomplete` downgrade for missing pH/
temperature data. Confirmed by audit that ONLY `severity === "blocking"`
is a real hard block anywhere in this platform
(`blockingExclusionConstraints`/`SubstitutionPanel.tsx`'s own
`hasBlockingCompatibilityFinding`) — reused exactly, not invented.
`runtime/pipeline/rules.py` re-confirmed request-constraint-only (zero
chemistry/ionic/pH/cationic/anionic keyword hits). **Zero engine/schema/
Rust/Python changes made.** Full detail in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`'s new "Compatibility
Engine boundary" section.

**No promotion needed, unlike FVL-03.005/.006/.007**:
`evaluateCompatibility()` is pure, so a generated card is evaluated
read-only with zero persistence step. New pure
`apps/desktop/src/lib/generatedFormulaCompatibility.ts::evaluateGeneratedFormulaCompatibility(formula, materials, rules, opts)`
reshapes via the existing `linesFromGeneratedFormula()`. The rule set is
a REQUIRED caller-supplied parameter, deliberately never hardcoded — the
real authoritative rules live in the LIVE, chemist-editable
`compatibility_rules` masterdata collection (same one
`CompatibilityPanel.tsx` reads), not the bare `SEED_COMPATIBILITY_RULES`
constant. New `useCompatibilityRules()` hook loads that live collection
once, mirroring `useMasterCostData`/`useInventoryData`'s pattern.

**`formulaState`**: `compatible`/`warning`/`blocked`/`unknown`.
`"blocked"` iff a real blocking finding fired; `"warning"` iff any
non-blocking finding fired; otherwise `"unknown"` (never `"compatible"`)
when at least one ingredient never resolved to a canonical `materialCode`
— reporting "compatible" there would be a fabricated claim.
`unresolvedMaterialCount` always surfaced honestly alongside real
findings, neither hides the other.

**A real, pre-existing bug found and fixed by this session's own
testing**: `masterdata.ts::listRecordsSeeded()` threw `"not-desktop"`
outside Tauri (its `upsertRecords` call had no `isTauri` guard, unlike
its sibling `listRecords()`) — never previously exercised since no test
rendered a caller of it. Fixed with a one-line `!isTauri` early return of
`seed`, mirroring `listRecords()`'s own convention; zero behavior change
inside a real Tauri build.

**Version eligibility, not a combined score**: `pickCheapestValidVersion()`/
`pickMostInventoryFeasibleVersion()` gained an optional `compatibilities`
eligibility-gate parameter (same style as their existing
`formula_state.startsWith("invalid")` check) — a `"blocked"` version can
never be crowned cheapest-valid or most-feasible merely because its
price/stock looks good; `"warning"`/`"unknown"` never exclude; omitting
the parameter preserves every pre-existing call site's behavior exactly.

**UI — a thin presenter**: new `GeneratedCompatibilitySummary` renders
the result as-is (no severity math, no rule matching) in the result
page's Summary tab, plus a compatibility row/blocked-banner on
`VersionSummaryCard`. `CompatibilityPanel.tsx` untouched.

**Optimizer/substitution/system-substitution reuse — confirmed, not
rewritten**: `AdvancedOptimizerPanel.tsx`, `SubstitutionPanel.tsx` (both
one-to-one and system mode) already consume the real engine correctly;
none needed a single line of new code. **Disclosed, out-of-scope
finding**: all three pass the hardcoded `SEED_COMPATIBILITY_RULES`
constant rather than the live edited collection this task's own new code
reads — a real data-freshness gap, not a duplicate-authority violation
(same single engine, same call, no second scoring logic) — flagged for a
future session, out of this task's own boundary to retrofit.

Verified: `pnpm --filter @formulab/desktop test` — 1354/1354 across 148
files (26 new: 9 `generatedFormulaCompatibility.test.ts`, 6
`GeneratedCompatibilitySummary.test.tsx`, 4 `costComparison.test.ts`, 3
`inventoryComparison.test.ts`, 4 `FormulationResultPage.test.tsx`).
`typecheck`/`lint` — clean. `packages/shared`, `runtime/formulation`,
`runtime/pipeline`, `apps/desktop/src-tauri/src/formulation*` confirmed
untouched by `git status` diff — no Python/Rust/shared sanity suite
re-run performed. `python scripts/validate_v1_tracker.py` — OK, 157
tasks, no drift. `git diff --check` — clean (LF/CRLF warnings only). No
FVL-03.009+ work started; no new compatibility engine anywhere; no
Python compatibility logic added.

## FVL-03.007 resolution (prior session)

"Wire the EXISTING system substitution engine into the formulation
workflow — no new system engine, no second scoring system, system
(multi-material) substitution only (FVL-03.006 already closed material
substitution)." Full audit (no subagents, per explicit instruction) found
**zero engine/schema/scoring gap** and confirmed system substitution is
already fully implemented, not merely documented:
`packages/shared/src/engine/systemSubstitution.ts`
(`generateSystemCandidates`/`buildSystemSubstitutionProblem`/
`scoreSystemResult`), spec in `docs/SYSTEM_SUBSTITUTION.md`. Confirmed
"system" has no fixed chemistry taxonomy anywhere in this platform — a
system is whichever ≥2 formula lines a HUMAN selects in the existing
`SubstitutionDialog`'s own checklist; membership is never auto-detected.
Candidate generation never uses name similarity; every proposal is routed
through the real Advanced Optimizer (never a proportional-scaling
shortcut); a proposal failing to cover a preserved function is recorded
`rejected`, never silently offered partial. Applying persists BOTH the
`OptimizationRun` and an immutable `SubstitutionRun` before touching
anything, then updates only the working draft — never the saved
`FormulationVersion`, identical lifecycle to FVL-03.006. Full detail in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`'s new "System
Substitution Engine boundary" section. **Zero
engine/schema/scoring/Rust/Python changes made.**

**The one real gap — same shape as FVL-03.005/.006**: a generated AI
session card has no real project, and the existing dialog's
`selectedLineIds` could only ever be seeded with ONE line (the required
`line` prop) — no way to open pre-checked into system mode for 2+
ingredients picked from a generated card. Resolved with a small, additive
change: new optional `initialExtraLineIds?: string[]` prop on
`SubstitutionDialog` seeds additional pre-checked lines on open, filtered
defensively against real `allLines` inside the dialog itself (never
trusting a caller blindly — a stale/bogus id can never fabricate system
membership). Every existing call site that doesn't pass it is unaffected.
The human retains full control after open — every checkbox stays freely
editable.

**UI — smallest addition, reusing rather than cloning**: a "System
substitution" multi-select added only to the existing generated-formula
ingredient table (`FormulaTab` in `FormulationResultPage.tsx`) — a
checkbox per row (click isolated so it never also opens the evidence
panel) plus a small action bar, disabled below 2 selections so a
one-material problem can never reach system mode. Clicking it reuses the
exact FVL-03.005/.006 promotion seam, resolves selected ingredient
indices to the promoted version's own real line ids (same index-alignment
guarantee as FVL-03.006), and navigates to
`/formulation?project=<id>&substituteLine=<anchor>&systemLines=<rest>` —
a new one-shot query-param handoff in `FormulationPage.tsx` mirroring its
own pre-existing `focusLine`/`substituteLine` pattern — opening the
existing, otherwise completely unmodified `SubstitutionDialog` already
pre-seeded into system mode.

**Version scoping — a real bug caught and fixed by this session's own
testing**: `FormulaTab`'s local ingredient-selection state persisted
across a version switch (React reuses the component instance), leaving a
V1 selection wrongly enabled against V2's unrelated ingredient indices. A
new test caught it; fixed with a `useEffect` resetting the selection on
`card.version` change — exactly the class of scoping bug this task's own
Acceptance I exists to catch.

**Read-only w.r.t. the session, by construction**: confirmed by diff
review — only `session.brief`/`session.id`/`card` reads appear anywhere
in the changed files, no `session.*` mutation. Only new `Formulation`/
`FormulationVersion` records are ever created by promotion; the actual
system-substitution apply step still only mutates the working draft. No
compatibility/safety/regulatory logic added (FVL-03.008/.009/.010
untouched); no fabricated ratios/concentrations (the existing engine's
own deterministic optimizer-derived percentages used as-is); zero-LLM.

Verified: `pnpm --filter @formulab/desktop test` — 1328/1328 across 146
files (7 new: 3 in `SubstitutionPanel.test.tsx`'s new
`initialExtraLineIds` describe block, 4 in `FormulationResultPage.test.tsx`'s
new selection/scoping block; `SubstitutionPanel.test.tsx`'s pre-existing
system-substitution tests unmodified and green). `typecheck`/`lint` —
clean. `packages/shared`, `runtime/formulation`, `runtime/pipeline`,
`apps/desktop/src-tauri/src/formulation*` confirmed untouched by `git
status` diff — no Python/Rust/shared sanity suite re-run performed.
`python scripts/validate_v1_tracker.py` — OK, 157 tasks, no drift.
`git diff --check` — clean (LF/CRLF warnings only). No FVL-03.008+ work
started; no new substitution/scoring engine anywhere; no Python
system-substitution logic added.

## FVL-03.006 resolution (prior session)

"Wire the EXISTING material substitution engine for unresolved/
unavailable ingredients — no new substitution engine, no second scoring
system, material substitution only (not FVL-03.007's system
substitution)." Full audit (no subagents, per explicit instruction) found
**zero engine/schema/scoring gap**: the one-to-one Material Substitution
Engine (`packages/shared/src/schemas/substitution.ts` +
`packages/shared/src/engine/substitution.ts`, spec in
`docs/MATERIAL_SUBSTITUTION.md`) already scores 15 real dimensions (never
name similarity), reports `missingData: true` rather than a fabricated
perfect match, uses real `materialCode` identity throughout, and already
has a real, tested UI (`SubstitutionDialog`/`SubstitutionPanel.tsx`,
mounted in both `/live` and `/formulation`) that persists an immutable
`substitution_runs` record before ever touching the working DRAFT (never
the saved `FormulationVersion`). Full detail in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`'s new "Material
Substitution Engine boundary" section.

**New trigger boundary**: pure
`apps/desktop/src/lib/generatedFormulaInventory.ts::shouldOfferSubstitution()`
returns true only for (A) an ingredient with no resolvable `materialCode`
at all, or (B) a resolved ingredient whose FVL-03.004 inventory state is
definitively `insufficient` — false for every other UNKNOWN (no
inventory record, mixed units, unusable batch size), matching the "UNKNOWN
means missing data, never automatic unavailability" rule exactly.

**Generated-vs-saved integration — same seam FVL-03.005 already
established**: `substitutionRequestSchema` requires a real
`projectId`/`formulaVersionId`, so "Find substitute" reuses
`promoteGeneratedFormula.ts::buildPromotedFormulation()` unchanged. The
in-memory promotion cache in `FormulationResultPage.tsx` was widened to
hold the full `{formulation, version}` pair (not just the id) so the
Optimizer and Substitution entry points share one promoted project per
generated version, and so a click can resolve the promoted version's own
line id by array index (guaranteed aligned to the generated formula's own
ingredient order, since both derive from the same
`card.formula.ingredients` array via the same
`linesFromGeneratedFormula()`).

**UI — smallest addition to an existing component, not a new
dashboard**: a "Find substitute" button was added only inside the
existing `InventoryFeasibilitySummary` (FVL-03.004's own per-ingredient
display), shown per line only when `shouldOfferSubstitution()` is true.
It navigates to `/formulation?project=<id>&substituteLine=<lineId>` — a
new one-shot query-param handoff in `FormulationPage.tsx` mirroring its
own pre-existing `focusLine` pattern — which opens the existing,
completely unmodified `SubstitutionDialog` for that line, with a
defensive existence-guard so a stale/malformed line id can never crash
the dialog. `SubstitutionPanel.tsx` itself already handles an unresolved
source material gracefully (`line.materialId ?? line.id` /
`line.materialCode ?? ""`) — pre-existing behavior, reused as-is, not a
new source-identity mechanism.

**Read-only w.r.t. the session, by construction**: confirmed by diff
review — only `session.brief`/`session.id`/`card` reads appear anywhere
in the changed files, no `session.*` mutation. Only new `Formulation`/
`FormulationVersion` records are ever created by promotion; the actual
substitution apply step still only mutates the working draft, exactly as
before. No system substitution pulled forward — `systemSubstitution.ts`/
`generateSystemCandidates`/`buildSystemSubstitutionProblem`/
`scoreSystemResult` are never referenced by any new code (confirmed by
grep); FVL-03.007 remains untouched and NOT started. Zero-LLM.

Verified: `pnpm --filter @formulab/desktop test` — 1321/1321 across 146
files (13 new: 6 in `generatedFormulaInventory.test.ts`'s new
`shouldOfferSubstitution` describe block, 7 in new
`InventoryFeasibilitySummary.test.tsx`; `SubstitutionPanel.test.tsx`/
`FormulationPage.test.tsx` unmodified and green, confirming zero behavior
change to the reused engine/dialog). `typecheck`/`lint` — clean.
`packages/shared`, `runtime/formulation`, `runtime/pipeline`,
`apps/desktop/src-tauri/src/formulation*` confirmed untouched by `git
status` diff — no Python/Rust/shared sanity suite re-run performed.
`python scripts/validate_v1_tracker.py` — OK, 157 tasks, no drift.
`git diff --check` — clean (LF/CRLF warnings only). No FVL-03.007+ work
started; no new substitution/scoring engine anywhere; no Python
substitution logic added.

## FVL-03.005 resolution (prior session)

"Wire the EXISTING Advanced Optimizer as an optional post-generation
refinement of a selected formulation alternative — no new solver, not a
merge into `engine.py`." Full audit (no subagents used, per explicit
instruction) found **zero engine/schema/solver/Rust gap**:
`runtime/formulation/advanced_optimizer.py` (1732-line real MILP/PuLP
solver, confirmed additive and distinct from `formulation_core.py`'s
simple LP), its Rust bridge, `packages/shared/src/schemas/optimization.ts`'s
full schema set, and the existing `AdvancedOptimizerPanel.tsx`/
`OptimizationPage.tsx` UI were already single-authority-correct — real
`materialCode` identity, caller-computed compatibility/safety risk, honest
stock fields, hard-constraint preservation, structured infeasibility
handling. Full detail in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`'s new "Advanced
Optimizer boundary" section.

**The one real gap**: `formulationProblemSchema.projectId`/
`productFamilyId` are non-optional, but a generated AI session card has
no project association. The seemingly-promising `/optimizer` standalone
page was investigated and ruled out — it's the unrelated **simple**
optimizer, no `materialCode`/canonical Material Master connection.
Fabricating placeholder IDs would violate the standing "no fake
persistent IDs" rule.

**Resolved with the user (AskUserQuestion) — "require save-first"**: new
pure `apps/desktop/src/lib/promoteGeneratedFormula.ts::buildPromotedFormulation()`
builds a real `Formulation`/`FormulationVersion` from the card's own
real data, reusing the existing `newFormulation()`/`newVersion()`/
`linesFromGeneratedFormula()` helpers (zero new persistence shape;
`materialCode` carried through unchanged from FVL-03.002/.003).
`productFamilyCode` uses the brief's real `category` when present, else
an honest `"general"` fallback — never a fabricated specific category.
New "Optimize / Refine" quick action on `FormulationResultPage.tsx`
(`SlidersHorizontal` icon; `formulationResult.quickActions.optimize`/
`optimizing` i18n keys added to all 8 locales) calls the existing
`saveFormulation()`/`saveFormulationVersion()` Tauri wrappers once per
version (cached in-memory per visit to avoid duplicate `Formulation`
records on repeat clicks), then navigates into the existing, completely
unmodified `/optimization?project=<id>` route.

**Read-only w.r.t. the session, by construction**: `buildPromotedFormulation()`
is pure (no Tauri/network call, proven by test); no code path writes back
to session storage — confirmed by diff review (only reads of
`session.brief`/`session.id`, no `session.*` mutation anywhere in the
changed files). Only new `Formulation`/`FormulationVersion` records are
ever created; the original generated session card is never mutated.

No new optimizer UI/dashboard (existing panel reused unmodified); `/live`'s
own optimizer path (`FormulasPage.tsx`'s Optimizer tab) untouched; no
substitution/compatibility/safety/regulatory logic touched; zero-LLM.
Acceptance A/B/C/D/E/F/G/H/J inherited as regression from the existing,
unmodified `AdvancedOptimizerPanel`'s own test suite (re-verified green,
not re-proven); this task's own narrow proof burden (promotion
correctness, read-only behavior, honest fallback) covered by new
`promoteGeneratedFormula.test.ts` (5/5 passing).

Verified: `pnpm --filter @formulab/desktop test` — 1308/1308 across 145
files (5 new; `AdvancedOptimizerPanel.test.tsx`/`OptimizationPage.test.tsx`
unmodified and green, confirming zero behavior change to the reused
workflow). `typecheck`/`lint` — clean. `packages/shared`,
`runtime/formulation`, `apps/desktop/src-tauri/src/formulation*`
confirmed untouched by `git status` diff (no Python/Rust/shared sanity
suite re-run needed — nothing in those trees changed). `python scripts/
validate_v1_tracker.py` — OK, 157 tasks, no drift. `git diff --check` —
clean (LF/CRLF line-ending warnings only, no real conflicts). No
FVL-03.006+ work started; no new solver/second optimizer implementation
anywhere; no substitution logic implemented.

## FVL-03.004 resolution (prior session)

"Wire canonical InventoryRecord availability into candidate feasibility,
read-only." Confirmed by audit: `InventoryRecord`
(`packages/shared/src/schemas/materials.ts:221-242`) stores no
usable/available quantity field — always derived — and before this task
three UI call sites each re-implemented `quantity − reservedQuantity`
inline, none applying `quarantined`/`released`/`expiresAt` filtering. New
`packages/shared/src/engine/inventoryAvailability.ts::evaluateMaterialAvailability()`
is now the one canonical derivation (used by new code only — the three
existing call sites untouched, out of scope, no regression risk).

**Same client-side, read-only, version-level architecture as FVL-03.003's
cost wiring — confirmed with the user as the deliberate choice**: Python
is not extended to read inventory; `master_materials_adapter.py`
untouched. New `apps/desktop/src/lib/generatedFormulaInventory.ts::evaluateGeneratedFormulaInventory()`
joins by `material_code` only (proven immune to a same-display-name decoy
material by test), computes required quantity from the SAME numeric
`batchKg` control FVL-03.003 already added to `FormulationResultPage.tsx`
(never the original free-text `estimatedBatchSize` brief field, confirmed
purely decorative — never parsed as a number anywhere in
`runtime/pipeline/`). Rolls per-ingredient AVAILABLE/INSUFFICIENT/UNKNOWN
into one formula-level FEASIBLE/INFEASIBLE/UNKNOWN state.

"Prefer a feasible candidate" (satisfied at the **version** level, not by
mutating `engine.py`'s per-role candidate loop): new
`apps/desktop/src/lib/inventoryComparison.ts::pickMostInventoryFeasibleVersion()`
mirrors `pickCheapestValidVersion` exactly — picks the first already-
generated, hard-rule-valid version whose inventory state is `feasible`,
never recommending an infeasible/unknown version as "best available
anyway." Kept as an entirely separate dimension from cost (task §12) —
proven by a joint test that a real cost total and an independently-
computed `INFEASIBLE` inventory state coexist without either influencing
the other.

**Read-only by construction** — confirmed by grep across every file this
session touched: no `upsertRecords("inventory", ...)` call exists
anywhere. Generation never reserves, decrements, or allocates stock.

Wired into the new result UI only (`FormulationResultPage.tsx`'s Summary
tab + `VersionSummaryCard` badge, plus a per-version cost line in the
version-card grid) — `CostingPanel.tsx` (old `/live` UI) deliberately not
extended, since it has no multi-version/cards context to make a
feasibility comparison meaningful. `runtime/pipeline/materials.py`'s
legacy `stock` field (parsed, stored, read by nothing else) documented
with a one-line comment classifying it non-authoritative — not deleted
(gratuitous churn on an unrelated legacy path, out of scope).

Verified: `pnpm --filter @formulab/shared test` — 1311/1311 (9 new in
`inventoryAvailability.test.ts`). `pnpm --filter @formulab/desktop test`
— 1303/1303 (16 new: `generatedFormulaInventory.test.ts` 9,
`inventoryComparison.test.ts` 4, `InventoryFeasibilitySummary` render
sanity via typecheck; i18n locale-parity suite re-verified green across
all 8 locales after 7 new translation keys added to each). `typecheck`/
`lint` — clean. `python -m pytest runtime/pipeline -q` — 386/386,
unchanged from the FVL-03.003 baseline (Python untouched except one
non-functional doc comment). `cargo check` — clean, unchanged (no Rust
edits this session). `git diff --check` — clean. No FVL-03.005+ work
started; no Python inventory logic added anywhere; no substitution logic
implemented (explicitly deferred to FVL-03.006).

## FVL-03.003 resolution (prior session)

"Wire the existing authoritative Cost Engine into the formulation
pipeline." **Critical architecture finding, confirmed by audit**: Python
cannot call `packages/shared/src/engine/cost.ts` at all —
`run_cli.py` is a one-shot stdin→stdout subprocess (`formulation_v2.rs`'s
`generate_formulation` spawns it, writes one JSON request, reads one JSON
reply, no back-channel to the JS engine). The only architecturally real
bridge is client-side, post-generation costing — new
`apps/desktop/src/lib/generatedFormulaCost.ts::costGeneratedFormula()`, a
thin wrapper calling `buildCostSnapshot()` directly (zero business logic
of its own — proven by test to return the identical result a direct
`buildCostSnapshot()` call would, including a negative proof that a
same-display-name "decoy" material with a price is never matched by text
similarity, only by the exact `material_code`).

`apps/desktop/src/lib/formulations.ts::linesFromGeneratedFormula()` now
carries `material_code` (the field FVL-03.002 added to every generated
ingredient) into `FormulationLine.materialCode` — the one real gap that
had been blocking real costing of a generated card.

Wired into both UIs, consuming one authoritative result: `CostingPanel.tsx`
(old `/live` UI, previously called the legacy Python bridge, now redirected)
and `FormulationResultPage.tsx` (new result UI — three prior hardcoded
"not available" placeholders replaced with real per-version cost). New
shared `apps/desktop/src/components/cost/CostSnapshotSummary.tsx` renders
the money-grid + `missingDataWarnings` for both; `CostPanel.tsx` (the
manual formula builder) was left untouched — already correct, no reason to
risk it. New pure `apps/desktop/src/lib/costComparison.ts::pickCheapestValidVersion()`
picks the lowest-cost alternative among versions that are BOTH not
`invalid_*` (`formula_state`) AND completely costed (zero
`missingDataWarnings` — an incomplete/lower-bound total is never eligible
to be crowned "cheapest"). Surfaced as a badge in `VersionSummaryCard` and
inline per-version cost in the version-card grid.

**Legacy path deleted, not merely bypassed** (confirmed zero remaining
callers before deletion, by grep then by full regression):
`runtime/pipeline/materials.py::cost_formula()`/`render_costing_markdown()`,
`materials_cli.py`'s `"cost"` action, `apps/desktop/src-tauri/src/materials.rs::cost_formulation`
(+ its `lib.rs` registration), `apps/desktop/src/lib/formulationV2.ts::costFormulation()`/
`CostSheet`/`CostLine`. `materials.py`'s own storage/import functions and
`materials.rs::import_materials`/`list_materials` (a separate command
family) are untouched — still back the unrelated Settings → General
CSV-import screen.

Verified: `python -m pytest runtime/pipeline -q` — 386 passed, 5 subtests
(7 obsolete `CostingTests` removed). `cargo check` + `cargo test` — 345/345
passing (full suite, not just targeted — `materials.rs`/`lib.rs` changed).
`pnpm --filter @formulab/shared test` — 1302/1302 (`cost.test.ts`
untouched, re-verified as the sanity gate, no new tests added there per
the "don't duplicate expected-value formulas the authoritative engine can
already prove" instruction). `pnpm --filter @formulab/desktop test` —
1287/1287 (19 new: `generatedFormulaCost.test.ts` 6, `costComparison.test.ts`
5, `formulations.test.ts` 2, `CostSnapshotSummary.test.tsx` 3, plus the
i18n locale-parity suite re-verified green across all 8 locales after
adding 2 new translation keys to each). `typecheck`/`lint` — clean.
`git diff --check` — clean. No desktop rebuild/installer performed (dev-mode
`cargo check` + typecheck covers the changed surface; not required by this
task's own acceptance criteria). No FVL-03.004+ work started; no Python
price-selection/landed-cost/FX logic added anywhere.

## FVL-03.002 resolution (prior session)

"Canonical Material Master / supplier linkage into formulation generation
under the SINGLE-AUTHORITY architecture." New
`runtime/pipeline/master_materials_adapter.py` — a shape-only adapter
reading `data/master/{materials,material_suppliers,suppliers,
material_prices}.json` directly (bare canonical JSON arrays, no new
storage/database). Real identity: `RawMaterial.code` now carried as
`material_code` through `IngredientCandidate` → `SolvedIngredient` →
`traceability.selected_event()`'s `source_ids` → the rendered formula
ingredient dict — in addition to, never instead of, the existing
INCI/name text-matching pool key. Makes `resolve_concentration()`'s Tier 4
(supplier recommended range) live end-to-end for the first time (FVL-03.001
proved it dead code on the legacy path). Adds a new `technical_max_pct`
hard-ceiling clamp, implemented exactly once (`resolve_concentration()`'s
own thin wrapper over the renamed `_resolve_concentration_tiers()`,
`ConcentrationResolution.technical_max_clamped` flag, persisted into trace
event `output_values`).

**Single-authority boundary held, proven by test**: the adapter never
selects a current price the way `cost.ts::priceFor()` does — no `price`/
`currency` key is ever set on an emitted row; `material_price_refs` passes
every matching `MaterialPrice` row through raw/unfiltered instead. Supplier
identity is kept as the full `material_supplier_refs` set; a `supplier`
display string only surfaces when the canonical `MaterialSupplier.preferred`
field already makes it unambiguous (exactly one `preferred: true` link) —
never a new ranking rule. `_selection_score()`'s existing price tie-break
bonus is therefore untouched but receives no signal for canonical-sourced
candidates until FVL-03.003 wires real costing — a disclosed, intentional
behavior change, not a retune.

**Rust**: `formulation_v2.rs`'s `generate_formulation` payload now points
`materials_dir` at `data/master` (was `data`) — confirmed the identical
resolved path to `masterdata.rs::master_dir()`. The new adapter module was
registered in `materialize_pipeline()`'s embedded-file list; verified by
reproducing the exact materialized file set in a disposable temp directory
and importing `pipeline` cleanly — the same class of shipped-binary
`ImportError` bug FVL-02.009 found and fixed for `architecture_portfolio.py`
is proactively avoided here. `runtime/pipeline/materials.py`/
`materials.rs`'s legacy CSV-import commands (Settings → General) untouched,
unrelated, out of scope — a real, disclosed behavior change: materials that
only exist in that legacy store no longer surface as AI-generation
candidates (decided with the user during the architecture-correction
session, shipped without an added migration/warning).

Verified: `python -m pytest runtime/pipeline -q` — 393 passed, 5 subtests
(15 new tests: 11 in `test_master_materials_adapter.py`, 3
`technical_max_pct` clamp tests in `test_engine.py`, 1 new end-to-end Tier-4
test in `test_pipeline.py`; 2 existing tests extended in place). `cargo test
masterdata:: formulation_v2::` — 28/28 passing. `cargo check` — clean.
`python scripts/validate_v1_tracker.py` — OK, 157 tasks, no drift. No
FVL-03.003/.004 work started; no Python price-selection/landed-cost/FX
logic added anywhere.

## Architecture correction (2026-08-18) — SINGLE-AUTHORITY rule adopted

Roadmap/documentation session only, before any FVL-03.002 implementation.
No production code changed. Added the single-authority principle to
`docs/FORMULAB_V1_FINAL_SCOPE.md` (every business domain has exactly one
authoritative engine/source of truth; a pipeline-local adapter transports
and reshapes data only). Full code-traced authoritative domain map and
legacy retirement matrix added to
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`. Key confirmed findings:
`runtime/pipeline/safety.py` and `runtime/pipeline/regulatory.py` are real,
independently-computing duplicate final-verdict engines (targeted by
FVL-03.009/.010 respectively); `runtime/pipeline/rules.py::validate()` is
**not** a duplicate of the Compatibility Engine — confirmed to implement
only generation-request constraints. Hardened FVL-03.002 through
FVL-03.012's wording in the tracker with exact repository names/paths, plus
two flagged-elsewhere rows (`FVL-07.008` reworded for clarity,
`FVL-08.005` wording strengthened, `Blocking` left `NO` — a scope decision
deliberately not made this session). No dependency-graph or status values
changed; no new work package created. Old UI (`/live`) and new UI
(`/formulation-request`+`/formulation-result/:sessionId`) both remain,
sharing one zero-LLM backend (`engine.py`) — `FVL-11.005` still owns the
retirement decision, not moved earlier.

## FVL-03.001 resolution (this session, audit only)

"Audit exact integration seam: Material Master ↔ `engine.
build_candidate_pool()`." Full findings in
`docs/FVL03_PLATFORM_INTEGRATION_ARCHITECTURE.md`. Summary:

- **Canonical Material Master**: `packages/shared/src/schemas/
  materials.ts` (`RawMaterial`/`Supplier`/`MaterialSupplier`/
  `MaterialPrice`/`InventoryRecord`), identity = `RawMaterial.code`.
  Persisted as flat JSON arrays under `<project_root>/data/master/*.json`
  (`apps/desktop/src-tauri/src/masterdata.rs`), read by the real
  Materials screen (`MaterialsPage.tsx` → `listRecords("materials")`).
- **What `build_candidate_pool()` actually consumes today: NOT the
  canonical Material Master.** `runtime/pipeline/materials.py` is a
  second, independent, much simpler representation — a single flat
  `<materials_dir>/materials.json` (different path AND shape from the
  canonical store), populated by a live, reachable, separate CSV-import
  screen (`MaterialsCard.tsx`, Settings → General) — confirmed
  disconnected from `MaterialsPage.tsx`'s own canonical path.
- **Identity mismatch confirmed**: pool candidates key on
  `normalize_ingredient_key(inci or name)` (derived text), never
  `RawMaterial.code`. The legacy row's own `material_id` survives only
  as trailing trace provenance, never as the actual pool key.
- **Real, proven gap**: `resolve_concentration()`'s own Tier 4 (supplier
  recommended range) is dead code on the current path — the legacy CSV
  import can never produce `recommended_min_pct`/`recommended_max_pct`,
  proven end-to-end with the REAL parser
  (`test_material_master_seam.py`, 4 new tests, all passing).
- **Cost Engine boundary documented, not implemented**:
  `packages/shared/src/engine/cost.ts::costFormula()` (keyed on
  `materialCode`, real landed cost/exchange-rate/missing-data handling,
  673-line test suite) is the authoritative engine future FVL-03.003
  must call. It is confirmed NOT called from the generation path today —
  `materials.py::cost_formula()` is a separate, simpler, unrelated
  reimplementation (flat price × kg, no landed cost, no exchange rate).
- **No production code changed.** Audit/seam-definition only, per
  FVL-03.001's own scope — explicitly did not implement supplier wiring
  (FVL-03.002), cost wiring (FVL-03.003), or inventory wiring
  (FVL-03.004).

## FVL-02.009 resolution (this session)

"Below-3-defensible-alternatives behavior: mark result incomplete/
insufficient rather than fabricate." Added `engine.FORMULA_ALTERNATIVES_
SUFFICIENT`/`FORMULA_ALTERNATIVES_INSUFFICIENT` and a new top-level
`formula_alternatives_status` field on `pipeline.run()`'s return —
**independent** of `status` (which stays entirely about research-corpus
completeness): `"sufficient"` when `actual_formula_count >=
MIN_FORMULA_ALTERNATIVES` (3), `"insufficient_formula_alternatives"`
otherwise. The real alternatives already produced are always returned
as-is either way — never discarded, never padded to reach the minimum.
Proven with 8 new tests (`test_formula_alternatives_status.py`), including
both signals held true simultaneously (`ok_partial_research` + `insufficient_
formula_alternatives`) without either overwriting the other. **Real,
disclosed finding**: under the CURRENT strategy library, `actual <
MIN_FORMULA_ALTERNATIVES` is not reachable through genuine strategy
scarcity for any real brief — `balanced` + one of `cost_optimized`/
`premium_sensory` (mutually exclusive but jointly exhaustive over every
`targetCostLevel` value) + the unconditional `max_performance` fallback
together guarantee at least 3 applicable strategies, and the deterministic
engine never fails a slot once a strategy is chosen (no `generation_failed`
path exists in the current engine). The tests prove the SIGNAL is correct
by truncating `strategy.derive_strategies()`'s own real output (never
fabricating a strategy) — a defensive correctness proof for a case that
is not reachable today but could become reachable if the strategy library
is ever narrowed.

**Also found and fixed while preparing the rebuild** (not part of
FVL-02.009 itself, but a real, pre-existing packaging defect uncovered by
it): `apps/desktop/src-tauri/src/formulation_v2.rs`'s `materialize_
pipeline()` embedded-files list was missing `architecture_portfolio.py`
entirely — `pipeline.py` has imported it since an earlier FVL-02 session,
so the SHIPPED desktop binary would have failed with `ImportError` on
every real generation attempt despite every Python-level test passing (the
test suite always runs against the live repo checkout, never the
materialized/embedded copy, so this gap was invisible to `pytest`). Fixed
by adding the missing `include_str!`/materialize-list entry. Verified
directly: reproduced the exact Rust materialization list in a disposable
temp directory, ran `run_cli.py` against it — clean JSON response, no
`ImportError`, reached real pipeline business logic
(`research_corpus_incomplete`, the correct/expected outcome for a sandbox
with no live literature-retrieval network access).

## Exact next task

**`FVL-03.012`** — blank, NOT STARTED (see above). Not begun yet this
session — the final FVL-03 closure/acceptance task.

## Known blockers

None. FVL-01/FVL-02 fully closed; FVL-03.001-.011 fully closed (see
above). Disclosed, out-of-scope, non-blocking findings: (1)/(2) the
existing Optimizer/Substitution compatibility/safety re-run call sites
use the hardcoded `SEED_COMPATIBILITY_RULES`/`SEED_SAFETY_RULES`
constants rather than the live edited collections; (3) Material
Substitution's regulatory wiring cannot currently produce a real
`false`/prohibited result with the actual seed catalog (no
ingredient-based rule has an empty `productCategories` matching the
honest `"human_review_required"` category fallback); (4) the Advanced
Optimizer/System Substitution carry a genuine, pre-existing, documented
"regulatory not yet implemented" boundary — none are duplicate-authority
issues; all flagged for a future session.

## Most recent relevant tests

- `pnpm --filter @formulab/desktop test` — 1422/1422 across 152 files (6
  new: 1 `FormulationResultPage.test.tsx`, 1
  `GeneratedSafetySummary.test.tsx`, 1
  `GeneratedCompatibilitySummary.test.tsx`, 3 `formulationReport.test.ts`).
- `pnpm --filter @formulab/desktop typecheck` / `lint` — clean.
- `python -m pytest runtime/pipeline -q` — 361 passed, 5 subtests
  (unchanged — zero Python files touched this task).
- `packages/shared`, `runtime/formulation`,
  `apps/desktop/src-tauri/src/formulation*` confirmed untouched by `git
  status`/diff this session — no shared/cargo sanity re-run performed.
- `python scripts/validate_v1_tracker.py` — OK, 171 tasks, no drift.
- `git diff --check` — clean (LF/CRLF warnings only).
- No desktop rebuild/installer performed (no Rust/shipped-runtime changes
  this session at all; TS changes covered by `typecheck`/`lint`/vitest,
  matching the standing "full rebuild reserved for closure sessions"
  policy). No live Tauri-app smoke test was performed — verification
  relied on the automated suites above.

## Latest commit SHA

Pending — this session's FVL-03.011 closure commit not yet pushed at
the time this file was last edited. Prior: `fa96142` (pushed to and
matching `origin/feature/laboratory-stability`) — "docs: finalize
FVL-03.010 closure pointer with commit SHA".

## Reminder

- Do not invent a `FVL-12`.
- Do not mark a future task `COMPLETED` on assumption.
- Follow the full protocol in `FORMULAB_V1_TASK_TRACKER.md`'s own
  "Tracker update protocol" section before touching any task status.
