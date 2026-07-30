# Phase 7 — Reverse Formulation — Current State

## Status
All Phase 7 subsystems complete: shared domain, candidate generation/
scoring, Rust persistence, Data Exchange integration, the desktop
workspace, and candidate-to-formula integration. Ready for closure.

## Completed (Session 6: Candidate-to-Formula Integration)
- Added an explicit, two-step conversion flow to `CandidateComparisonPanel`:
  once a candidate is both saved (persisted to `reverse_formula_candidates`)
  and explicitly selected, a "Create formulation draft" / "Create new
  version" action appears. Both paths reuse the existing formulation engine
  (`newFormulation`/`newVersion`/`saveFormulation`/`saveFormulationVersion`
  from `@/lib/formulations` — the same functions `dataExchangeCommit.ts`'s
  `commitFormulaBom` already uses) — no second persistence path created.
- "New draft" (no target formulation) always available; "new version" on an
  explicitly chosen existing formulation requires picking one from a select
  populated by `listFormulations()`. Never decided silently.
- Validates before writing: refuses an empty-formula candidate, and refuses
  (with a visible error, no placeholder material) if any line's material
  code has left the catalog — checked again at conversion time, not just at
  generation time.
- Low `evidenceConfidence` (< 0.5) shows a visible warning; a permanent
  "decision support, not approval" notice sits beside every conversion
  action. Traceability (study code + candidate code) is recorded in the new
  version's `changeReason` and an `appendAudit` event's structured
  `metadata` — no schema change needed.
- The action disappears after one success (button replaced by a success
  message), preventing accidental duplicate creation from repeated clicks.

## Versioning and approval safeguards
- Every created `FormulationVersion` starts at `status: "concept"` with
  empty `approvalRecordIds`/`regulatoryFindingIds`/`safetyFindingIds` —
  never inherited from anywhere, since nothing here reads an approval
  record at all. `saveFormulationVersion` only ever appends a new,
  freshly-`newId()`'d version; an existing version is never targeted for
  overwrite. Formula lines preserve exact order (declared-line index →
  `lineNumber`), exact `materialId`/`percentage`, and leave unsupplied
  fields (e.g. `inciName`) `undefined` rather than fabricated.

## Cleanup
Removed the Session 4 `dataExchangeCommit.ts` collection-bridge
(`ReverseFormulationCollection` type + `rfList`/`rfUpsert`/`rfFindByCode`) —
now redundant since `masterdata.ts`'s real `Collection` union (added
Session 5) already covers all 11 collections; every handler now calls
`listRecords`/`upsertRecords`/`findByCode` directly.

## Files changed
- `apps/desktop/src/app/routes/ReverseFormulationPage.tsx`
- `apps/desktop/src/components/reverseFormulation/CandidateComparisonPanel.tsx`
- `apps/desktop/src/app/routes/ReverseFormulationPage.test.tsx`
- `apps/desktop/src/lib/dataExchangeCommit.ts` (bridge removal only)
- `apps/desktop/src/i18n/locales/*/session.json` (12 new `conversion.*` keys, all 8 locales)

## Tests passing
- `pnpm --filter @ai4s/desktop exec vitest run ReverseFormulationPage.test.tsx dataExchangeCommit.test.ts parity.test.ts` — 99/99.
- `pnpm --filter @ai4s/desktop typecheck` — clean. No shared code touched this session.

## Remaining limitations
- Conversion forms are minimal (target-formulation select + one button),
  matching the rest of the workspace's intentionally lean entry forms.
- No cost/regulatory/laboratory pre-check before conversion — out of scope
  by design (decision support only, not a gate).

## Latest commit and sync status
See commit `feat(reverse-formulation): integrate candidates with
formulations` on `feature/laboratory-stability`, pushed to its tracking
branch.

## Next session
Phase 7 Closure: Full Verification and Release
