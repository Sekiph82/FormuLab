# Phase 7 — Reverse Formulation — Current State

## Status
Shared domain, candidate generation/scoring, Rust persistence, Data
Exchange integration, and a real desktop workspace are all done. No
candidate-to-formula integration yet (Session 6).

## Completed (Session 5: Desktop Reverse Formulation Workspace)
- New workspace at `/reverse-formulation`: studies (list/create/select),
  benchmark products (attach existing/create new), ingredient declarations,
  analytical evidence, ingredient mappings (propose/confirm/reject), target
  profile + reverse constraints (link existing/create new), and candidate
  generation/comparison — all through `@/lib/masterdata`'s typed
  `listRecords`/`upsertRecords` against the 11 Reverse Formulation
  collections. No candidate is ever written to `formulations`.
- Candidate generation/scoring reuses the real shared engine
  (`generateCandidates`/`scoreReverseFormulaCandidate` from
  `packages/shared/src/engine/`) directly — the new
  `CandidateComparisonPanel` component only assembles inputs from loaded
  records and renders the engine's own output; nothing is reimplemented.
  Each candidate card shows overall score and evidence confidence as two
  distinct numbers, a per-dimension breakdown explicitly labeled Evaluated/
  Not evaluated (from `ScoringModelOutput.evaluatedDimensions`), and the
  engine's own notes (assumptions/rejection reasons). A "Save as candidate
  record" action persists to `reverse_formula_candidates` +
  `candidate_score_explanations` only.

## Desktop typing repairs
- Extended `apps/desktop/src/lib/masterdata.ts`'s `Collection`/
  `CollectionTypes` with the 11 Reverse Formulation collections (the
  Session 4 known gap) — the `dataExchangeCommit.ts` cast-bridge from that
  session is now redundant but was left in place, since that file is
  outside this session's allowed-modify scope.
- Fixed both known desktop-typecheck errors (`noUnusedParameters`) in
  `candidateGenerator.ts`/`scoringModel.ts` by prefixing the two
  intentionally-unused, API-compatibility parameters with `_`, the
  repository's existing convention (`argsIgnorePattern: "^_"`) — no engine
  redesign, no call sites changed.
- `pnpm --filter @ai4s/desktop typecheck` is now fully clean.

## Files changed
- `apps/desktop/src/lib/masterdata.ts`
- `packages/shared/src/engine/candidateGenerator.ts`, `scoringModel.ts` (param rename only)
- `apps/desktop/src/app/router.tsx`, `src/components/sidebar/Sidebar.tsx`
- `apps/desktop/src/app/routes/ReverseFormulationPage.tsx` (new)
- `apps/desktop/src/components/reverseFormulation/CandidateComparisonPanel.tsx` (new)
- `apps/desktop/src/app/routes/ReverseFormulationPage.test.tsx` (new)
- `apps/desktop/src/i18n/locales/*/nav.json`, `*/session.json` (all 8 locales)

## Tests passing
- `pnpm --filter @ai4s/desktop exec vitest run ReverseFormulationPage.test.tsx parity.test.ts Sidebar.i18n.test.tsx Workspaces.test.tsx Pages.i18n.test.tsx` — 36/36.
- `pnpm --filter @ai4s/desktop typecheck` and `pnpm --filter @ai4s/shared typecheck` — both clean.

## Known limitations
- `apps/desktop/src/lib/dataExchangeCommit.ts` still bridges through its own
  local `ReverseFormulationCollection` type instead of the now-real
  `Collection` union — harmless (same 11 names) but a small follow-up.
- No candidate-to-formula creation (by design — Session 6).
- Declarations/analytical/mappings forms are intentionally minimal (basic
  non-empty + decimal-shape guards only), not the full Data Exchange
  validation engine.

## Latest commit and sync status
See commit `feat(reverse-formulation): add desktop workspace` on
`feature/laboratory-stability`, pushed to its tracking branch.

## Next session
Phase 7 Session 6: Candidate-to-Formula Integration
