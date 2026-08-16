# Phase 13 — Enterprise Identity, Authentication, Fixed RBAC & Application Security

## Status: SESSION 5 COMPLETE — `Administration → Users` is implemented: list, create, edit profile, change role (exactly one of the 12 fixed roles), activate/disable, reset password, security-history view, and a read-only role-capabilities view generated directly from `rolePolicy.ts`. Extends the existing `AdministrationPage.tsx` rather than a second administration surface. Every mutation is authorized server-side through the exact Session 4/4A `authz::authorize` mechanism — no new authorization path. Full design: `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` §13; test report: `docs/PHASE13_SECURITY_TEST_MATRIX.md` §L.

## Session 5 summary

**Backend — `admin.rs` (new), 7 commands**, all gated through
`authz::authorize` against `administrationUsers`/`administrationSecurity`
(administrator-only per §6's matrix, proven directly at the policy
layer): `list_administered_users`, `create_administered_user`,
`update_administered_user_profile`, `change_administered_user_role`,
`set_administered_user_account_status`, `reset_administered_user_password`,
`read_security_audit_history`. No caller-supplied role/identity is ever
trusted — the acting administrator is resolved from the session, same
as every other Phase 13 privileged command.

**Reuses, doesn't reinvent, existing primitives**: password policy
(`auth::validate_new_password`), password-reset-forces-change-on-
next-login (`identity::update_password_hash`), disable-revokes-every-
open-session (`identity::update_account_status`, unchanged since
Session 1). Two new `identity.rs` primitives were needed:
`list_users` (all accounts) and `list_security_audit_events`
(global or per-user). `Role::parse` (unchanged) rejects any non-
canonical role string — no custom roles, no per-user permissions, no
permission grid anywhere in this session's work.

**Every important mutation is individually audited**: `admin_user_created`,
`admin_user_role_changed` (recording both `from` and `to`),
`admin_user_activated`/`admin_user_disabled`, `admin_user_password_reset`
— never a combined generic "user updated" row, so the security-history
view can distinguish exactly what happened. Tested directly that no
audit row ever contains a password or its hash.

**Frontend — `UsersPanel.tsx` (new)**, wired into the existing
`AdministrationPage.tsx` as a new "Users" tab. Hidden (UX only, backend
already authoritative) for a non-administrator, same
`useTrustedActor()`/`can()` convention `SettingsPage.tsx`'s System
Administration cards already use since Session 4. Role-capabilities
view renders straight from `@formulab/shared`'s `areasFor`/
`capabilitiesFor` — no second, hand-maintained capability description.

Rust: 314/314 (Session 4A's 304 + 10 new), clippy clean. Shared:
1301/1301 (unchanged — no shared-package file touched). Desktop:
1197/1197 (1188 + 9 new), tsc clean, eslint clean, i18n parity clean
across all 8 shipped locales.

## Deliverables (this session)

- `apps/desktop/src-tauri/src/admin.rs` (new) — the 7 commands. 9 tests.
- `apps/desktop/src-tauri/src/identity.rs` — `list_users`,
  `list_security_audit_events`, `update_user_profile`,
  `SecurityAuditEvent` (new).
- `apps/desktop/src-tauri/src/auth.rs` — `validate_new_password`,
  `MAX_DISPLAY_NAME_LEN` widened to `pub(crate)` for reuse.
- `apps/desktop/src-tauri/src/role_policy.rs` — new
  administrationUsers/administrationSecurity admin-only test.
- `apps/desktop/src-tauri/src/lib.rs` — registers `mod admin;` + its 7
  commands.
- `apps/desktop/src/lib/admin.ts` (new) — thin command bridge.
- `apps/desktop/src/components/administration/UsersPanel.tsx` (new) +
  its test file (8 tests).
- `apps/desktop/src/app/routes/AdministrationPage.tsx` — new Users tab.
- `apps/desktop/src/app/routes/Workspaces.test.tsx` — stale
  "no user-management backend" assertion replaced with a real one.
- `apps/desktop/src/i18n/locales/*/session.json` (all 8 shipped
  locales) — new `administration.users.*` keys (46 keys); `tr` fully
  translated, the other 6 non-English locales carry the English text
  as a disclosed gap, matching this exact section's own pre-existing
  precedent in those files.
- `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` — §13 implemented;
  §2's user-management rows updated; §25/Risks updated.
- `docs/PHASE13_SECURITY_TEST_MATRIX.md` — E1-E5 corrected; new §L.
- This handoff.
- External log:
  `C:\Users\sekip\Desktop\FormuLab-Phase13-Identity-Security-Log.md`,
  Session 5 entry appended.

## What Session 5 deliberately did NOT do

- No custom roles, per-user permissions, permission checkboxes,
  `role_permissions`/`user_permission_overrides` tables.
- No public signup, email/SMS verification, social login, email-based
  password recovery, project ACLs.
- No "last administrator" self-demotion guard — `change_administered_
  user_role` will demote the sole administrator if asked to. Not in
  Session 5's brief; a real, disclosed gap (Risks item 17).
- No project-wide audit-log fuzz/property scan (F2/E5's full-coverage
  form) — only Session 5's own four mutations are directly tested for
  secret-free audit rows; Session 6's job for the rest of the codebase.
- Did not touch the four Session 4A workflow gates' (still) nonexistent
  frontend UI, or Session 4A's other residual notes (gate-subject
  existence validation, the still-first-draft §6 matrix) — carried
  forward unchanged, not blockers to Session 5.

## Open decisions requiring a human answer before Session 6

1. Should a "last administrator" guard be added to
   `change_administered_user_role`/`set_administered_user_account_status`
   (Risks item 17)?
2. §6's role-permission matrix domain-expert review — still open,
   unchanged by this session, now covering `administrationUsers`'s
   real production use too.
3. Should the 6 English-fallback locales' `administration.users.*`
   strings get real translations before Phase 13 closure, or stay a
   disclosed gap indefinitely (matching this section's pre-existing
   convention)?

## Exact next session

**Phase 13 Session 6**: brute-force/lockout wiring confirmation, full
audit-event coverage from every real command (not just Session 5's
own), the complete SQL-injection + privilege-escalation regression
suite against the now-fully-wired-up command surface (not just the
storage layer, which Session 1 already covers), and — if the domain
review from Risks item 1 has landed by then — the §6 matrix
corrections it produces.
