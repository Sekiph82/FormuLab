# DOE candidates (Phase 5)

`packages/shared/src/schemas/doe.ts` (`doeCandidateSchema`),
`packages/shared/src/engine/doeCandidates.ts` (desirability, search,
ranking, application).

## The candidate record

```ts
DoeCandidate {
  id, schemaVersion: "1.0", studyId, studyRevision,
  analysisIds,          // which DoeAnalysis records produced its predictions
  factorSettings,       // DoeFactorSetting[]
  predictedResponses,   // DoePredictedResponse[]: { responseId, predictedValue, isExtrapolated, analysisId }
  desirability,         // overall, in [0,1]
  constraintStatus,     // DoeConstraintStatus[] — every constraint's satisfied/severity/message
  rank,
  status,               // proposed | shortlisted | selected | rejected |
                         // applied_to_draft | experimentally_confirmed | failed_confirmation
  createdBy, createdAt,
  appliedDraftId?, appliedAt?,
}
```

Every predicted response names the exact `analysisId` it came from — a
candidate can never present a number without saying which fitted model
produced it, and never presents a DOE-engine number as if it came from the
Optimization engine or vice versa (see
[DOE_OPTIMIZATION_INTEGRATION.md](DOE_OPTIMIZATION_INTEGRATION.md)).

## Desirability

`calculateResponseDesirability(response, predictedValue)` implements the
standard Derringer-Suich piecewise transforms, one per objective:

- `maximize`/`minimize` — 0 at/below the worse bound, 1 at/above the better
  bound, linear (or concave/convex, per `desirabilityShape`) between.
- `target` — 1 exactly at `targetValue`, 0 outside `[lowerLimit,
  upperLimit]`, a triangle between.
- `within_range` — a hard 0/1 gate: 1 inside `[lowerLimit, upperLimit]`
  inclusive, 0 outside. No tapering.
- `observe_only` — always 1 (never drives the search).

`calculateOverallDesirability` is the weighted geometric mean across every
non-`observe_only` response: `D = (prod d_i^w_i)^(1/sum w_i)`. Any single
response scoring exactly 0 forces the whole candidate's `D` to 0 — the
standard convention, and the reason a hard hard-constraint-violating point
never surfaces as a "pretty good" candidate.

## Seeded candidate search

`searchDoeCandidateSpace` draws random points from the design's own coded
space — uniform on `[-1, 1]` for non-mixture numeric factors, a
Dirichlet-like normalized-exponential draw for mixture components (so
every sample sums to exactly 1), a uniform pick among levels for
categorical factors — using the same seeded PRNG
[DOE_DESIGN_GENERATION.md](DOE_DESIGN_GENERATION.md) documents. The same
seed always returns the same candidate set. A point violating any *hard*
constraint is dropped before scoring; soft/warning violations are recorded
in `constraintStatus` but kept visible. `rankDoeCandidates` sorts
descending by desirability with a stable tie-break, so re-ranking the same
search result is itself deterministic.

## Extrapolation

`predictDoeResponse` flags `isExtrapolated: true` when a candidate's coded
factor settings fall outside the *design's own observed coded range*
(`deriveObservedCodedRanges`), not a fixed `±1` — so a central-composite or
Box-Behnken axial point isn't falsely flagged just for legitimately
exceeding `±1`. A flagged prediction is still shown, with the flag, never
hidden or silently clamped.

## Applying a candidate never overwrites a saved version

`applyDoeCandidateToDraft(candidate, factors, design)` is a pure,
side-effect-free function: it resolves the candidate's factor settings
back to real material quantities (via `sourceType: "formula_material"`)
and process settings, and returns them as structured deltas. The workspace
applies those deltas to the current **working draft** only — a human still
saves a new formula version explicitly through the existing Formulation
workflow when ready. A saved version is never touched by this path.

## Status

Implemented, tested (`doeCandidates.test.ts`, 22 tests covering every
objective's desirability transform and shape, the weighted geometric mean
and its hard-zero rule, seeded reproducibility, hard-constraint dropping,
mixture-sum-to-1, ranking, and the draft-application factor-source
mapping), live-usable through the workspace's Candidates tab: generate,
shortlist, select, apply to draft, export as CSV.
