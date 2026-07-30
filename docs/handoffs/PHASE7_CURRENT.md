# Phase 7 — Reverse Formulation — Current State

## Status
Shared domain, candidate generation/scoring, Rust persistence, and Data
Exchange integration for all 11 Reverse Formulation collections are done.
Desktop workspace UI (Session 5) has not started.

## Completed (Session 4: Data Exchange Integration)
- Fixed a broken scaffold: `dataExchangeCommit.ts` already referenced 11
  `commitReverseFormulation*` handlers in `COMMIT_HANDLERS` that were never
  defined (a hard compile error) and zero matching registry templates
  existed. Implemented all 11 registry templates (Templates 25-35, module
  `reverse_formulation`) and all 11 commit handlers.
- Registry: every workflow-status column (study/mapping/rule/candidate) is
  restricted to its safe starting value only (`draft`/`proposed`/`generated`)
  — an import can never claim review, selection, confirmation or validation.
  `analytical_composition_results` and `candidate_score_explanations` are
  `new_revision` (append-only); every parent reference is a real
  `code_reference` column, resolved and refused (never fabricated) if missing.
- Commit handlers: never create a missing parent (study/product/declaration
  line/material); `analytical_composition_results` always writes a new,
  `unverified` record; `reverse_formula_candidates` groups (candidate,
  material) rows like `formula_bom`, always starting `status: "generated"`.

## Persistence-key decision (Session 3 blocker)
Added `id: z.string()` to `CandidateScoreExplanation` — the smallest
coherent fix (every other Reverse Formulation collection already had one;
nothing else in the codebase constructed this type, so zero blast radius).
The commit handler always sets it via `newId(...)`, resolving the `row_key()`
requirement flagged in Session 3.

## Known scope gap
`apps/desktop/src/lib/masterdata.ts`'s `Collection`/`CollectionTypes` union
was NOT extended (out of this session's allowed-modify list). The 11 new
handlers bridge through a narrow, locally-declared
`ReverseFormulationCollection` type + `rfList`/`rfUpsert`/`rfFindByCode`
helpers in `dataExchangeCommit.ts`, cast once at that single boundary. The
Rust allow-list (`collection_spec`, fixed Session 3) is the real safety
boundary and still rejects any unrecognized name — a typo fails loudly at
that layer rather than silently succeeding — but full compile-time safety
needs `masterdata.ts` updated with these 11 collections in a future session.

## Files changed
- `packages/shared/src/schemas/reverseFormulation.ts` (3 enums exported as named consts; `CandidateScoreExplanation.id` added)
- `packages/shared/src/engine/dataExchangeRegistry.ts` (11 templates)
- `apps/desktop/src/lib/dataExchangeCommit.ts` (11 handlers + bridge)
- `packages/shared/src/engine/dataExchangeRegistry.test.ts`
- `packages/shared/src/engine/dataExchangeValidation.test.ts`
- `apps/desktop/src/lib/dataExchangeCommit.test.ts`

## Tests passing
- `pnpm --filter @ai4s/shared exec vitest run <registry, validation>` — 76/76.
- `pnpm --filter @ai4s/desktop exec vitest run <commit, commitShapes>` — 74/74.
- `pnpm --filter @ai4s/shared typecheck` — clean.
- `pnpm --filter @ai4s/desktop typecheck` — 2 pre-existing errors, both in
  Session 2 files (`candidateGenerator.ts`/`scoringModel.ts`, unused
  params under this package's stricter `noUnusedParameters`), unrelated to
  and untouched by this session; no errors in anything this session changed.

## Known limitations
- `masterdata.ts`'s `Collection` union gap above.
- The 2 pre-existing desktop-typecheck errors above (out of this session's scope).

## Latest commit and sync status
See commit `feat(reverse-formulation): add data exchange integration` on
`feature/laboratory-stability`, pushed to its tracking branch.

## Next session
Phase 7 Session 5: Desktop Reverse Formulation Workspace
