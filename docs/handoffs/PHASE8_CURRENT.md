# Phase 8 — Reports, Dossiers, Document Exports, Final Data Exchange Expansion

## Current status
Session 5 complete: Data Exchange registry expanded from 35 to 41
templates, covering all 6 remaining dossier-domain collections. No
export-history persistence, audit, or authorization redesign yet
(Session 6). No Rust changes were needed — `masterdata.ts`/`masterdata.rs`
already had all 6 collections registered from Phase 3.

## Templates added
`dossier_headers` → `regulatory_dossiers`, `dossier_submissions` →
`regulatory_dossier_submissions`, `dossier_evidence_links` →
`regulatory_requirement_evidence_links`, `dossier_review_revocations` →
`regulatory_dossier_review_revocations` — all 4 fully importable with
commit handlers. `dossier_reviews` → `regulatory_dossier_reviews` and
`dossier_manual_requirement_actions` →
`regulatory_dossier_manual_requirement_actions` — export-only
(`enabled: false` + an honest `disabledReason`), no commit handler wired.
Existing `dossier_requirements`/`dossier_evidence` templates untouched.

## Import/export safety decisions
`dossier_headers`: always draft/revision 1, requires an already-saved
formula version (live lookup, never auto-created — deliberately
diverging from `formula_bom`'s own auto-create precedent, since this
session's rule is stricter). `dossier_submissions`: status always
"prepared", an authority's response fields never taken from the file.
`dossier_evidence_links`: linkStatus always "proposed" — accepting/
rejecting/revoking stays a human-only action. `dossier_review_revocations`:
resolves the exact review live via (dossier, revision, reviewed_at) and
refuses if it doesn't exist. `dossier_reviews` excluded from import
because a review's frozen requirement/evidence snapshot cannot be
honestly reconstructed from a flat row (fabricating it empty or
substituting today's live state would both misrepresent what was
actually reviewed). `dossier_manual_requirement_actions` excluded
because the real add/exclude engine functions always pair the audit row
with an atomic requirement-row mutation a standalone import row can't
reproduce. Both still have real export loaders — export/audit visibility
is exactly what they're allowed to do.

## Files changed this session
`packages/shared/src/engine/dataExchangeRegistry.ts` (+6 templates),
`.test.ts` (+11 tests, 2 count assertions updated), `apps/desktop/src/lib/
dataExchangeCommit.ts` (+4 handlers, registered), `.test.ts` (+21 tests
incl. 4 export→import round trips), `apps/desktop/src/lib/
dataExchangeExisting.ts` (+6 loaders), `.test.ts` (+5 tests).
`masterdata.ts`/`masterdata.rs` untouched — already complete.

## Focused tests passing
Shared: `dataExchangeRegistry.test.ts` 42/42, `dataExchangeValidation.test.ts`
41/41 (unchanged, generic engine needed no edits). Desktop:
`dataExchangeCommit.test.ts` 80/80, `dataExchangeExisting.test.ts` 46/46.
Shared typecheck, desktop typecheck, desktop lint — all clean.

## Known limitations
No export-history/generated-document persistence record yet (Session 6).
No new authorization tier beyond the existing `REGULATORY_ROLES` gate
already used by every dossier template. `dossier_evidence_links` can only
propose a link between already-existing requirement/evidence rows — it
cannot bulk-create the evidence itself (use `dossier_evidence` for that,
unchanged).

## Recommended sessions (unchanged plan, see external log for detail)
6. Export history, audit, authorization integration (next)
7. Focused Phase 8 verification
8. Closure: full regression, release, installers, shortcut, native verify

## Exact next session
Phase 8 Session 6: Export History, Audit, Authorization, and Integration.
