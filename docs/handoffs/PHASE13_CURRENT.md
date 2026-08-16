# Phase 13 — Enterprise Identity, Authentication, Fixed RBAC & Application Security

## Status: SESSION 6 COMPLETE (backend regression scope) — brute-force/lockout re-confirmed with one real defense-in-depth gap closed; System Administration's audit-trail gap (11 commands, previously zero coverage) closed, plus the full-surface F2 secret-leak fuzz test; new SQL-injection coverage at the admin command boundary; two new direct privilege-escalation proofs. Native Windows GUI acceptance testing was **not executed** — no tool available to drive/inspect a native Windows window — and is honestly recorded as a still-open manual item, not claimed complete. Full design: `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` §27; test report: `docs/PHASE13_SECURITY_TEST_MATRIX.md` §N.

## Session 6 summary

**Brute-force/lockout — confirmed, one real gap found and closed.** The
real login command path (`auth.rs::login_logic`) was re-verified end to
end against every property the session brief asked for: 5-attempt
lockout, lockout surviving a database reopen, all four failure shapes
returning the identical generic error, an expired lock allowing login
again, session expiry/idle-timeout/revocation, role-change taking
effect on the next session check. All already correctly proven — no
policy change was made. One real gap: `identity::validate_session`'s
own independent live-status recheck (a defense-in-depth layer separate
from session revocation) had never been directly exercised on its own.
New test closes it.

**Full security-audit coverage — one real, systemic gap found and
closed.** Every `authz::authorize*` call site (10 files) was
cross-referenced against every `record_security_audit_event` call site.
Finding: 11 System Administration commands — backup create/restore,
data-location move/use-existing/restore-default/resume/cleanup,
pre-migration backup create, automatic-backup config write/retention —
were role-gated but wrote **zero** audit rows on success, including
`restore_backup`, this codebase's own "single highest-risk
system-administration command." Closed: all 11 now record a
`success`/`failure` row using the resolved actor's real identity.
Business-content mutations (formulation/masterdata/approval/workflow-
gate) were deliberately left untouched — each already has its own
established, adequate, actor-attributed audit trail; duplicating them
would be the unjustified audit spam the session brief warns against.
Also closed: F2's full-surface fuzz/property test, a single-pass secret
scan across bootstrap/login/every admin mutation.

**SQL-injection — confirmed parameterized everywhere; two new
command-boundary tests.** No raw string-concatenated SQL exists
anywhere in the identity/admin/security surface (confirmed by direct
inspection, not inference). `username` injection is already
exhaustively covered — not repeated. Two genuinely new query
boundaries (`display_name`/`department`/`employee_reference`'s
free-text columns, and the `WHERE id = ?`/`WHERE target_user_id = ?`
shape every admin mutation and audit-history scoping share) got their
first hostile-input tests.

**Privilege-escalation/authorization-bypass — checklist walked item by
item; two real gaps in test coverage (not behavior) closed.** Every
item on the session brief's adversarial list was already covered by
existing tests, except two: a direct positive-denial proof that
administrator lacks `create`/`edit` on every scientific-content area
(previously only inferable from the absence of a grant), and a direct
test of `cancel_advanced_formulation_optimize`'s *own* authentication
check (the closure session's test only ever exercised the pure
cancellation logic behind it). Closing the second required extracting
a `&Connection`-taking logic function from the command wrapper —
identical in shape to every other Phase 13 command, no behavior
change.

**Native Windows multi-user acceptance — honestly scoped.** Every named
flow's backend logic is proven through the real production code paths
this session's 335-test suite (and every prior session's) exercises.
The full application binary (`cargo build`, not just `--lib`) compiles
cleanly. Interactive native-GUI click-through was not attempted — this
session has no tool that can drive or observe a native Windows window.

Rust: 335/335 (closure session's 328 + 7 new), clippy clean, full
binary builds clean. Shared: 1302/1302 (unchanged — no shared-package
file touched). Desktop: 1197/1197 (unchanged — no frontend file
touched), tsc clean, i18n parity clean (re-confirmed anyway).

## Deliverables (this session)

- `apps/desktop/src-tauri/src/identity.rs` — 1 new test
  (`validate_session_independently_rechecks_account_status_not_just_
  revocation`).
- `apps/desktop/src-tauri/src/admin.rs` — 3 new tests (F2 full-surface
  fuzz test; 2 SQL-injection command-boundary tests).
- `apps/desktop/src-tauri/src/role_policy.rs` — 1 new test
  (administrator's view-only boundary, direct denial proof).
- `apps/desktop/src-tauri/src/formulation_advanced.rs` — extracted
  `cancel_advanced_formulation_optimize_logic` (testability refactor,
  no behavior change); 2 new tests.
- `apps/desktop/src-tauri/src/backup.rs` — `create_backup`/
  `restore_backup` now audit success/failure.
- `apps/desktop/src-tauri/src/data_location_manager.rs` — 5 commands
  (`move_data_location`, `use_existing_data_location`,
  `restore_default_data_location`, `resume_interrupted_data_move`,
  `cleanup_old_data_location`) now audit success/failure.
- `apps/desktop/src-tauri/src/migration.rs` —
  `create_pre_migration_backup` now audits success/failure.
- `apps/desktop/src-tauri/src/automatic_backup.rs` —
  `write_automatic_backup_config`/`apply_pre_migration_retention` now
  audit success/failure.
- `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` — §9.4.1's stale
  `cancel_advanced_formulation_optimize` classification row corrected
  (it had drifted since the closure session's own change to that
  command); new §27; Risks items updated; §23's remaining-event-classes
  claim closed.
- `docs/PHASE13_SECURITY_TEST_MATRIX.md` — F1/F2/F3 corrected, new F4;
  new §N.
- This handoff.
- External log:
  `C:\Users\sekip\Desktop\FormuLab-Phase13-Identity-Security-Log.md`,
  Session 6 entry appended.

## What this session deliberately did NOT do

- Did not start Phase 13 Session 7.
- Did not implement Phase 14.
- Did not revisit already-closed Session 4A/5/closure-session work
  except where this session's own testing found a real, provable gap
  (the two above) — no stylistic or preference-driven changes.
- Did not duplicate formulation/masterdata/approval/workflow-gate
  mutations into `security_audit_events` — their existing,
  established, actor-attributed audit trails are adequate; duplicating
  them would be unjustified audit spam.
- Did not build a gate-listing admin UI (still not one of the named
  residual warnings any session has been asked to close).
- Did not attempt native Windows GUI acceptance testing — no tool
  available, honestly disclosed rather than falsely marked passed.
- Did not touch generated docs, formulas, real user/business data,
  `.FormuLab/runs.db`, `%APPDATA%\com.formulab.app`, OneDrive FormuLab
  data, release/signing work, or any other unrelated local changes
  already present in the working tree.

## Open decisions requiring a human answer before Session 7

1. Should native Windows GUI acceptance testing be performed manually
   before Phase 13 is considered fully closed, or is the backend-level
   proof this session (and every prior one) built sufficient to accept
   the phase as-is?
2. Should a gate-listing admin UI (list every workflow gate across
   subjects) be built, and if so when?
3. `run_automatic_backup`'s unauthenticated design (Risks item 13) —
   does any backup class ever need administrator-gating even when
   system-triggered? Still unanswered, out of every session's scope so
   far.

## Exact next session

**Phase 13 Session 7** — or, if the human reviewer judges the disclosed
native-acceptance gap (§27.5) acceptable to carry forward, Phase 13 may
be considered ready for whatever comes next; this session does not make
that call unilaterally.
