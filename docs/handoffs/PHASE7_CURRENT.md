# Phase 7 — Reverse Formulation — Current State

## Status
Shared-domain foundation and the candidate-generation/scoring engines are
repaired, deterministic, and honest about missing evidence. Rust persistence
(Session 3) has not started.

## Completed (Session 2: Candidate Generation and Scoring Quality)
- Deduplicated the near-identical `computeMatchScore` helpers: one
  `computeTargetMatchScore` now lives in `scoringModel.ts` and is imported by
  `candidateGenerator.ts`. Unified the pH/active-matter formulas (both now
  use the same "1.0 in range, linear falloff outside, 0.5 neutral if
  nothing comparable" rule) and guarded zero-width/inverted target ranges
  against division by zero.
- `candidateGenerator.ts`: candidates are now deterministically deduplicated
  by formula signature (same materials at the same rounded percentages);
  each candidate/rejection carries an honest reason; percentages are
  rounded and residual-normalized to match their declared total exactly
  (`normalizeToTotal`); every percentage is guarded to stay finite and
  non-negative (`roundTo2`); `constraints.excludedMaterials`,
  `minimumPercentages`, `maximumPercentages`, and `requiredMaterials` are
  now actually enforced — a candidate that can't satisfy them is rejected
  (`validateAgainstConstraints`) rather than silently produced.
- `generateFromAnalytical` no longer manufactures a disguised duplicate of
  the declared-hints candidate when there's no analytical data: it declines
  (returns null with a reason) when `analysis.totalAnalytes === 0`.
- `scoringModel.ts`: added `evaluatedDimensions` and `evidenceConfidence` to
  `ScoringModelOutput`, separating "how much of this score is backed by real
  evidence" from the score value itself. The weighted overall score now
  normalizes by the actual valid weight total instead of assuming the
  weights sum to 1. All per-dimension scores and inputs are guarded against
  NaN/Infinity (`clamp01`, `Number.isFinite` checks throughout).

## Architectural decisions
- No optimization engine, DOE solver, or regulatory checker was built —
  constraint handling is a reject-if-impossible gate, not a reflow/solver.
- `evidenceConfidence` is derived mechanically (evaluated dimensions ÷ total
  dimensions), not a separate model — kept intentionally simple.

## Files changed
- `packages/shared/src/engine/candidateGenerator.ts`
- `packages/shared/src/engine/scoringModel.ts`
- `packages/shared/src/engine/candidateGenerator.test.ts`
- `packages/shared/src/engine/scoringModel.test.ts`

## Tests passing
- `pnpm --filter @ai4s/shared exec vitest run <candidateGenerator.test.ts, scoringModel.test.ts>` — 23/23 passing.
- `pnpm --filter @ai4s/shared typecheck` — clean.

## Known limitations
- `generateFromAnalytical` still has no real analyte-to-material
  quantification model; it only ever mirrors the declared-hints candidate
  (deduplicated when identical).
- Constraint enforcement rejects violations; it does not attempt to reflow
  percentages to satisfy them (that would require a real optimizer).
- `scoreReverseFormulaCandidate`'s `availableMaterials: Map<string, any>`
  param remains accepted but unused.

## Latest commit and sync status
See commit `feat(reverse-formulation): improve candidate generation and
scoring` on `feature/laboratory-stability`, pushed to its tracking branch.

## Next session
Phase 7 Session 3: Rust Persistence
