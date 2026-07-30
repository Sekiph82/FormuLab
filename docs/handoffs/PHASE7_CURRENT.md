# Phase 7 — Reverse Formulation — Current State

## Status
Shared-domain foundation repaired and compiling. Candidate generation and
scoring quality (Session 2) has not started.

## Completed (Session 1: Shared Domain Repair)
- Fixed a broken import in `schemas/reverseFormulation.ts` that referenced
  primitives (`ProductId`, `MaterialId`, `Timestamp`, `Money`, `ConfidenceScore`,
  etc.) that do not exist anywhere in the package — the module could not compile.
- Aligned `AnalyticalCompositionResult.value` to the existing `decimalString`
  primitive convention (matches `formulation.ts` / `materials.ts` / `optimization.ts`);
  the engine already parsed it as a string.
- Fixed undefined-variable bugs: `matchedIngredients` → `mappedIngredients`
  (candidateGenerator.ts), `mats` → `materialsWithCandidates` (candidateGenerator.ts),
  `analScore` → `analogScore` and `extra` → `excess` (scoringModel.ts).
- Fixed an invalid `MaterialFunction` enum value (`'buffer'`, not a member of
  `MATERIAL_FUNCTIONS`) in `analyticalInference.ts`, replaced with `'ph_adjuster'`.
- Added missing `IngredientDeclarationLine` imports in `candidateGenerator.ts`
  and `scoringModel.ts`.
- Removed unused imports (`z`, `ReverseFormulaCandidate`, `CandidateScoreExplanation`)
  and a stray `@ts-ignore` masking a `for...in`/`for...of` bug in `estimateProperties`.
- Resolved an export collision: `scoringModel.ts`'s `scoreCandidate` duplicated an
  existing export name from `engine/substitution.ts`; renamed to
  `scoreReverseFormulaCandidate`.
- Replaced fabricated confidence placeholders in `scoringModel.ts` (`order: 0.8`,
  `performance: 0.7`, `regulatory: 0.9` — including the false claim "No restricted
  substances detected") with honest neutral (`0.5`) scores and explanations stating
  the dimension was not actually evaluated.

## Architectural decisions
- No new schema files or parallel engine modules were created; all fixes were
  in-place repairs to the existing five prototype engine files plus
  `schemas/reverseFormulation.ts`.
- Kept `formulaLines[].percentage` as a plain number (not `decimalString`) since
  the whole candidate-generation arithmetic path is number-based; converting it
  would be a broad redesign, reserved for Session 2.

## Files modified
- `packages/shared/src/schemas/reverseFormulation.ts`
- `packages/shared/src/engine/declarationParser.ts`
- `packages/shared/src/engine/ingredientMapper.ts`
- `packages/shared/src/engine/analyticalInference.ts`
- `packages/shared/src/engine/candidateGenerator.ts`
- `packages/shared/src/engine/scoringModel.ts`
- `AGENTS.md` (added Phase handoffs / Data integrity / Git and testing sections)

## Files added
- `packages/shared/src/engine/declarationParser.test.ts`
- `packages/shared/src/engine/ingredientMapper.test.ts`
- `packages/shared/src/engine/analyticalInference.test.ts`
- `packages/shared/src/engine/candidateGenerator.test.ts`
- `packages/shared/src/engine/scoringModel.test.ts`

## Tests passing
- `pnpm --filter @ai4s/shared exec vitest run <5 focused files>` — 23/23 passing.
- `pnpm --filter @ai4s/shared typecheck` — clean.

## Known issues
- `scoringModel.ts` and `candidateGenerator.ts` each have their own private,
  near-duplicate `computeMatchScore` helper — not deduplicated this session.
- Candidate generation quality is still a simplified prototype (declared-order
  heuristic, fixed baseline percentages, `generateFromAnalytical` currently just
  delegates to the declared-hints path) — unchanged from before, out of scope.
- `scoreReverseFormulaCandidate`'s `availableMaterials: Map<string, any>` param
  is accepted but unused.

## Latest commit and sync status
See commit `fix(reverse-formulation): repair phase 7 shared foundation` on
`feature/laboratory-stability`, pushed to its tracking branch.

## Next session
Phase 7 Session 2: Candidate Generation and Scoring Quality
