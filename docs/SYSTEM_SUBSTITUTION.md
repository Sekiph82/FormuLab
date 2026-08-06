# Multi-material system substitution

`packages/shared/src/engine/systemSubstitution.ts`,
`packages/shared/src/schemas/substitution.ts` (`systemCandidateLimitsSchema`,
`rejectedSystemCandidateSchema`, the `lineIds`/`materialIds`/
`preserveFunctions`/... fields on `substitutionRequestSchema`),
`apps/desktop/src/components/formula/SubstitutionPanel.tsx`'s system-mode
section. Part of the [Substitution Engine](MATERIAL_SUBSTITUTION.md).

## What this closes

One-to-one substitution (score a single replacement material against a
single replaced line) already worked. This adds real one-to-many,
many-to-one and many-to-many substitution: replacing a whole set of formula
lines with a whole set of new materials, routed through the actual Advanced
Optimizer rather than a proportional-scaling guess. These are **structural
workflows**, not approved chemical recommendations — every generated system
still carries the same `requiresChemistReview` honesty convention as the
rest of the platform's structural tooling.

## Selecting the source lines

The Substitution dialog now opens for one line (as before) with a
checklist of every other formula line beneath the one-to-one candidate
list — checking additional lines turns the request into a system
substitution. The dialog's own line can never be unchecked. `preserveFunctions`
defaults to the union of the selected lines' own material functions, and is
editable from there.

## Candidate generation (`generateSystemCandidates`)

**Never by name similarity.** A candidate system is built only from real
fields: material functions (which combination of candidates covers the
functions being preserved), active matter, stock, supplier approval, and
Kenya-local origin. Compatibility findings, safety findings, technical
maximums, regulatory maximums, landed cost, lead time and evidence
confidence are all real inputs to the *optimizer routing and scoring* steps
below — generation itself only needs functions and the three availability
filters to build a shortlist.

Algorithm: filter the pool to materials carrying at least one preserved
function (honoring `requireStock`/`requireApprovedSupplier` as hard filters
and `preferKenyaLocal` as a sort preference), cap at
`maxCandidateMaterials`, then generate combinations of increasing size up to
`maxMaterialsPerSystem`, stopping the moment `maxCandidateSystems` is
reached. **A combination that does not cover every preserved function is
recorded as rejected** (`missing_required_function`, with which function is
missing), not silently offered as a partial match — every candidate
considered is recorded, whether accepted or rejected, per the spec's
"record every candidate system considered."

| Limit | Default | Purpose |
|---|---|---|
| `maxCandidateMaterials` | 30 | Prefilter cap before combinations are even generated. |
| `maxMaterialsPerSystem` | 3 | Largest combination size attempted. |
| `maxCandidateSystems` | 8 | Hard stop on how many proposals are evaluated. |
| `maxSolverTimeSeconds` | 15 | Per-proposal solver timeout. |

All four are user-editable in the dialog before generating.

## Optimizer routing (`buildSystemSubstitutionProblem`)

Every proposal is turned into a real `FormulationProblem` and solved by the
actual Advanced Optimizer (`runtime/formulation/advanced_optimizer.py`) —
never a proportional-scaling shortcut:

1. Every formula line **not** among the selected source lines keeps its
   current percentage, locked (`lockedPercent`).
2. The source lines are removed as candidates entirely — they are being
   replaced, not relaxed.
3. `total_equals_100` (already on every problem) fixes the batch, so the
   solver decides the new system materials' percentages within it.
4. A `min_total` functional constraint is added per preserved function,
   satisfied by the WHOLE remaining candidate pool (a preserved function
   may already be covered by an untouched line elsewhere in the formula,
   not only by the new system).
5. When `preserveActiveContribution` is set (the default) and the replaced
   lines' original combined active-matter contribution is known, a **soft**
   exact-ratio constraint holds the new system's active contribution to
   that original figure — soft, not hard, because forcing an exact match
   would make many otherwise-good systems needlessly infeasible over a
   fraction of a percentage point; the deviation is reported honestly via
   `constraintResults`, never hidden.
6. Technical maximums and stock limits are enforced exactly as any other
   optimizer run (they are already fields on `OptimizationMaterial`).
7. Compatibility/safety hard exclusions are computed by the caller (the UI)
   using the SAME `blockingExclusionConstraints` function the plain
   Optimizer screen uses, scoped to the new system's candidates against the
   rest of the (locked) formula — this module never re-implements that
   logic.
8. Raw-material cost is recalculated by the solver as part of the normal
   solve; a requested `costCeiling` becomes the same soft over-target
   constraint [SOFT_CONSTRAINTS.md](SOFT_CONSTRAINTS.md) already documents.
9. A proposal with no valid solution returns the solver's own structured
   [infeasibility](INFEASIBILITY_ANALYSIS.md) — the same causes and
   suggested actions any other optimizer run produces, never a
   substitution-specific re-derivation of "why."

## Scoring (`scoreSystemResult`)

Read directly from the optimizer result, nothing re-derived: feasibility
(optimal > feasible > feasible_with_penalties > infeasible), soft-constraint
violation count, raw-material cost change against the original batch cost,
and — when the run included them — the `compatibility_risk`/`safety_risk`
graded objectives. A dimension the run did not compute (e.g. no risk
objective was included) is `missingData: true`, contributing nothing to the
score — never assumed to be a perfect or a zero result.

## Applying a result

Selecting a valid (non-infeasible) system and clicking Apply:

- Persists the underlying `OptimizationRun` (`optimization_runs`) — the
  exact problem sent to the solver and the result it returned.
- Persists a `SubstitutionRun` (`substitution_runs`) whose selected
  candidate is `isSystem: true` with `systemMaterialIds`, and whose
  `optimizationRunCode` points at the run above.
- Replaces every selected source line with the system's materials in the
  **working draft** — never the saved formula version the draft was
  derived from.
- The caller (`FormulasPage.tsx`'s `onApplySystemSubstitution`) re-runs
  validation, compatibility and safety naturally on the draft's next tab
  visit, the same as any other line edit — not a special substitution code
  path.
- Never inherits approval: applying a system substitution changes the
  draft, and a draft's approval status only ever comes from a fresh,
  explicit human approval on a NEW saved version (see
  [APPROVAL_READINESS.md](APPROVAL_READINESS.md)).

## Known limitations

- Compatibility/safety risk objectives are only included in a system's
  score when the caller's base problem included them — the current UI does
  not wire `gradedRiskScores` into the system-substitution base problem
  (only the plain Optimizer screen does today), so `compatibility_risk`/
  `safety_risk` usually show as `missingData` for a system result. Real
  blocking exclusions (step 7 above) are always applied regardless.
- `preserveFunctions` covers real material functions only — a
  property-target-based preservation request ("keep pH neutral") is not yet
  wired from the system-substitution UI, even though the underlying
  optimizer supports property targets (see [PROPERTY_TARGETS.md](PROPERTY_TARGETS.md)).
- Evaluation runs proposals sequentially (one solver subprocess at a time),
  not in parallel — `maxCandidateSystems`'s default of 8 keeps this
  reasonable, but a chemist raising the limit substantially will wait
  proportionally longer.
