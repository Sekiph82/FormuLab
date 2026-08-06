# Design of Experiments (Phase 5)

Design of Experiments (DOE) lets a chemist plan a statistically valid
formulation/process experiment, generate a randomized set of runs, collect
real responses, fit a deterministic statistical model to what was actually
observed, and rank candidate factor settings by desirability — all bound to
one exact saved formula version, never a working draft.

Domain schemas: `packages/shared/src/schemas/doe.ts`. Engines:
`engine/doeDesign.ts` (design generation), `engine/doeAnalysis.ts`
(statistics), `engine/doeCandidates.ts` (desirability/candidate search),
`engine/doeExpression.ts` (safe constraint expressions), `engine/doeMath.ts`
(matrix/OLS primitives), `engine/doeLabIntegration.ts` (Laboratory
integration), `engine/doeExports.ts` (import/export). Workspace:
`apps/desktop/src/components/formula/DoePanel.tsx` at route `/doe`.

## What this is not

- Not a replacement for the deterministic LP-based Optimization engine
  (`engine/optimization.ts`) — DOE's candidate search is a separate, smaller,
  desirability-based search over a *design's own space*; see
  [DOE_OPTIMIZATION_INTEGRATION.md](DOE_OPTIMIZATION_INTEGRATION.md).
- Not an AI-sourced source of truth. Every coefficient, ANOVA row, fit
  metric, and candidate ranking comes from fitting a real statistical model
  to real recorded observations — see
  [DOE_STATISTICAL_ANALYSIS.md](DOE_STATISTICAL_ANALYSIS.md)'s "AI may
  explain, never compute" rule.
- Not a claim of experimental confirmation. A candidate's predicted response
  is a model output, not a measured result, until someone actually runs it
  and records an observation.

## Domain model, one document each

- [DOE_STUDIES.md](DOE_STUDIES.md) — `DoeStudy` lifecycle, revisions,
  immutability.
- [DOE_FACTORS_AND_CONSTRAINTS.md](DOE_FACTORS_AND_CONSTRAINTS.md) —
  `DoeFactor`/`DoeConstraint`, the safe expression parser.
- [DOE_DESIGN_GENERATION.md](DOE_DESIGN_GENERATION.md) — `DoeDesign`, the 9
  implemented generators, diagnostics.
- [DOE_RESPONSES.md](DOE_RESPONSES.md) — `DoeResponse`, objectives,
  desirability shape.
- [DOE_RUNS_AND_LABORATORY.md](DOE_RUNS_AND_LABORATORY.md) — `DoeRun`,
  `DoeObservation`, and the Laboratory trial-generation bridge.
- [DOE_STATISTICAL_ANALYSIS.md](DOE_STATISTICAL_ANALYSIS.md) — `DoeAnalysis`,
  OLS/ANOVA/diagnostics, what is and is not modeled.
- [DOE_CANDIDATES.md](DOE_CANDIDATES.md) — `DoeCandidate`, desirability
  search, applying to a draft.
- [DOE_OPTIMIZATION_INTEGRATION.md](DOE_OPTIMIZATION_INTEGRATION.md) — the
  boundary with the existing Optimization workspace.

## Study lifecycle, at a glance

```
draft -> design_ready -> runs_generated -> in_progress -> data_complete
      -> analysis_ready -> analyzed -> candidate_selected -> completed
                                                            -> archived
(cancelled/superseded reachable from most states; archived is terminal)
```

`deriveDoeStudyStatus` (`engine/doeDesign.ts`) recomputes this from real
counts (runs generated, observations recorded, analyses/candidates present)
— it is never a status a human sets by hand once the study is underway.
Once a study reaches `analyzed`/`candidate_selected`/`completed`/
`superseded`/`archived` (`DOE_STUDY_IMMUTABLE_STATUSES`), a meaningful
change creates a new revision via `reviseDoeStudy`, never a silent edit.

## Implemented vs. not yet implemented

**Implemented, tested, live-verifiable through the desktop app:** full
factorial, two-level factorial, fractional factorial (half-fraction only),
Plackett-Burman (N=8/12 only), central composite, Box-Behnken, Latin
hypercube, mixture simplex-lattice, custom manual design generation;
main-effects/factorial/quadratic-response-surface/mixture OLS fitting;
ANOVA (incl. lack-of-fit when replication allows it); residual diagnostics;
outlier suggestion (never auto-exclusion); Derringer-Suich desirability and
seeded candidate search; JSON/CSV/Excel export for every artifact spec §17
lists; CSV import (with preview/row-level errors) for factors, constraints
and observations; Laboratory trial generation from a run.

**Explicitly not implemented — refused with an honest error, never faked:**
`definitive_screening` and `mixture_simplex_centroid` design types;
fractional-factorial fractions beyond a half-fraction; Plackett-Burman sizes
beyond N=12; re-importing an analysis-results JSON export as a native
analysis (always recomputed from stored observations instead); PDF/DOCX
report generation (same "not yet implemented" convention as every other
FormuLab report, deferred to Phase 7).

## Statistical limitations a human must interpret

- A model's R²/fit metrics describe how well it explains the runs it was
  fit on — they are not a claim of causal truth or of production
  reproducibility.
- Small run counts (a typical screening design) produce wide, sometimes
  statistically unstable confidence intervals; `validateAnalysisEstimability`
  surfaces a low-degrees-of-freedom warning but does not refuse the fit.
- A "candidate" is a predicted point in the design space, not a validated
  formulation. Applying it only updates a working draft — a human still
  reviews and saves a new formula version through the existing workflow.
- Extrapolated predictions (outside the design's own observed factor range)
  are flagged (`isExtrapolated`) but not blocked — the model can still
  compute a number for them, which is exactly why the flag exists.

See [DOE_STATISTICAL_ANALYSIS.md](DOE_STATISTICAL_ANALYSIS.md) for the full
list of what is modeled and what deliberately is not.
