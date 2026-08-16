# Phase 13 — Enterprise Identity, Authentication, Fixed RBAC & Application Security

## Status: CLOSED — implementation-complete (architecture doc §28). Every automatable scope item across Sessions 0-6 is done and regression-tested. By explicit human decision, the one remaining item — interactive native Windows GUI multi-user acceptance testing — is carried forward as a release-preparation manual acceptance item (`docs/RELEASE_MANUAL_ACCEPTANCE_CHECKLIST.md` §1), not a Phase 13 blocker. No Session 7 was opened. Full design: `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` §28; test report: `docs/PHASE13_SECURITY_TEST_MATRIX.md`.

## Closure summary

Session 6 (`docs/PHASE13_SECURITY_TEST_MATRIX.md` §N) closed every
remaining automatable item in Phase 13's scope: brute-force/lockout
re-confirmed with one real defense-in-depth gap closed; System
Administration's audit-trail gap (11 commands, previously zero
coverage) closed; the F2 full-surface secret-leak fuzz test written;
new SQL-injection coverage at the admin command boundary;
two new direct privilege-escalation proofs. That left exactly one item
open: interactive native Windows GUI acceptance testing, honestly
disclosed as not executed by any session — no tool available to any of
them can drive or observe a native Windows application window.

**Human decision**: accept that item as a release-preparation manual
acceptance item rather than a Phase 13 development blocker. On that
basis, Phase 13 is closed as implementation-complete. The item is not
claimed executed anywhere — it is recorded, with concrete checkable
steps, in `docs/RELEASE_MANUAL_ACCEPTANCE_CHECKLIST.md` §1, to be run
by a human on a real Windows machine with disposable test data before a
build ships.

The gate-listing admin UI (one central Administration screen listing
every workflow gate across every subject, instead of each gate's own
domain-local panel) remains a future UX enhancement, not a Phase 13
blocker — the four gates already have real, working, domain-local UI;
nothing about authorization depends on this convenience improvement.

Final totals as of closure: 335 Rust tests, full application binary
builds cleanly, `@formulab/shared` 1302 tests, `apps/desktop` 1197
tests, i18n parity across all 8 shipped locales, clippy/tsc/eslint
clean.

## What closure deliberately did NOT do

- No code changed to close Phase 13 — this is a documentation-only
  closure recording an already-made human decision.
- Did not execute the native-GUI acceptance test and did not claim it
  executed.
- Did not build the gate-listing admin UI.
- Did not open a Phase 13 Session 7 to re-run automated testing already
  completed in Session 6.
- Did not touch real user/business data, `.FormuLab/runs.db`,
  `%APPDATA%\com.formulab.app` business data, OneDrive FormuLab data,
  unrelated generated docs, unrelated `formulas/*` changes, release/
  signing work, or the Phase 11/12 external logs.

## Open items carried forward (not Phase 13 blockers)

1. Native Windows GUI multi-user acceptance testing —
   `docs/RELEASE_MANUAL_ACCEPTANCE_CHECKLIST.md` §1. Execute before
   shipping a release build.
2. Gate-listing admin UI — future UX enhancement, no scheduled session.
3. `run_automatic_backup`'s unauthenticated design (architecture doc
   Risks item 13) — still an open question, untouched by any session.

## Next Phase 13 session

None planned. Phase 13 is closed. If a future need reopens it (e.g. a
real regression is found, or §6's matrix domain-expert review is
revisited), it resumes as a numbered session continuing from Session 6,
not a fresh Session 0.
