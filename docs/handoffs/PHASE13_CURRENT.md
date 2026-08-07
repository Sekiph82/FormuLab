# Phase 13 — Enterprise Identity, Authentication, Fixed RBAC & Application Security

## Status: SESSION 2 COMPLETE — Administrator bootstrap, username/password login/logout, and authenticated session lifecycle are implemented, tested, and gate the whole application at startup. No `Administration → Users` UI, no `rolePolicy.ts`, no application-wide role enforcement — those are later sessions. Full design in `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md`, test report in `docs/PHASE13_SECURITY_TEST_MATRIX.md`. Runs in parallel with Phase 12's still-open SignPath thread (`docs/handoffs/PHASE12_CURRENT.md`) — unrelated, does not block or get blocked by it.

## Session 2 summary

**`identity.rs`'s Session 1 storage primitives are now wired to real
Tauri commands.** A new orchestration module, `apps/desktop/src-tauri/src/auth.rs`,
owns the actual login/bootstrap/lockout/session *policy* Session 1
deliberately left as caller-supplied parameters, and exposes five
commands: `bootstrap_status`, `bootstrap_create_administrator`, `login`,
`logout`, `current_session`. None of them accepts a `role` parameter
from the frontend — role is always derived from the stored `users` row
a password check or session-token lookup resolved to (architecture doc
§9.1).

**Session tokens are now hashed before storage.** Session 1's
`authenticated_sessions.id` held a plain random id directly, usable as
its own bearer credential. Session 2 splits these: `create_session`
generates a fresh 256-bit random token, returns it to the caller
exactly once, and persists only its SHA-256 hash — no schema migration
needed, since `id` already held an opaque string. A leaked `identity.db`
alone no longer hands out a reusable session. Architecture doc §15.5.

**Idle timeout is implemented** using the already-existing but
previously-unused `last_seen_at` column — `validate_session` gained an
`idle_timeout_secs` parameter and now slides `last_seen_at` forward on
every successful check. Final policy: 5-attempt lockout threshold,
15-minute lock, 12-hour absolute session lifetime, 60-minute idle
timeout (architecture doc §17.1) — a simple, defensible local-desktop
baseline, not yet validated against real usability data.

**Login has a real timing/enumeration defense.** When there's no real
user to check a password against (unknown username, disabled account,
locked account), `login_logic` still runs a full Argon2id verify against
a fixed dummy hash and discards the result, so every losing path costs
the same CPU time before returning the one identical public error,
`"Invalid username or password."` — tested directly by asserting the
unknown-username and wrong-password error strings are `===` equal, not
just similarly worded (architecture doc §17.2). This does not claim
mathematically constant timing, only that the same expensive operation
runs on every path.

**The whole application is now gated behind authentication.**
`AuthProvider.tsx` wraps `main.tsx`'s `<RouterProvider>` itself, not
just `AppShell` — the routed application doesn't exist as far as React
is concerned until bootstrap/session resolution finishes, so there's no
protected-content flash and no route a direct navigation could reach to
bypass it. Fresh install → `BootstrapScreen` (no role selector anywhere,
enforced structurally — the backend command has no role parameter to
smuggle one through). Configured install with no valid session →
`LoginScreen` (no signup/social/email/SMS, no fake forgot-password
flow — a one-line pointer to administrator-mediated reset instead).
Valid persisted session → straight into the app. Only the opaque
session token is ever persisted to `localStorage`
(`formulab.auth.token`) — never username/role/displayName; every
restart re-resolves the full user record from Rust via
`current_session` rather than trusting a cached frontend copy.

**Existing tests were not broken by the new global auth gate.** The
sidebar's account/logout row uses a non-throwing `useOptionalAuth()`
(returns `null`, not an error, outside an `AuthProvider` ancestor)
specifically because this codebase's large existing test suite renders
routes/`AppShell` directly via `renderAt()`, bypassing `main.tsx`'s real
`AuthProvider` — the throwing `useAuth()` is reserved for components
that must always be inside the gate.

**The i18n parity test (`src/i18n/parity.test.ts`) enforces full key
parity across all 8 shipped locales, not just an English-with-known-gaps
convention** — this was a real, test-caught finding this session
(adding the English-only Login/Bootstrap strings first failed the
`zh-Hans`/`ja`/`es`/`de`/`fr`/`ko`/`tr` parity checks). Fixed by
translating all 21 new keys into all 7 other shipped locales, not by
treating it as an acceptable gap — this differs from Session 1's
narrower role-string wording corrections, which the existing convention
did leave English-only.

## Deliverables (this session)

- `apps/desktop/src-tauri/src/auth.rs` (new) — login/bootstrap/logout/
  session-lifecycle policy and orchestration, plus the 5 Tauri commands.
  25 tests, all passing.
- `apps/desktop/src-tauri/src/identity.rs` — extended: hashed session
  tokens (`generate_session_token`/`hash_session_token`), idle-timeout-
  aware `validate_session`, `revoke_session`, `is_locked`,
  `any_administrator_exists`, `dummy_password_hash`,
  `bootstrap_administrator` (race-safe via an `IMMEDIATE` transaction).
  10 new tests (38 total, up from Session 1's 28).
- `apps/desktop/src-tauri/src/lib.rs` — registers `mod auth;` and the 5
  new commands.
- `apps/desktop/src/lib/auth.ts` (new) — thin Tauri bridge
  (`bootstrapStatus`, `bootstrapCreateAdministrator`, `login`, `logout`,
  `currentSession`).
- `apps/desktop/src/app/providers/AuthProvider.tsx` (new) — the startup
  authentication gate + `UserContext` (`useAuth`/`useOptionalAuth`). 12
  tests, all passing.
- `apps/desktop/src/components/auth/LoginScreen.tsx`,
  `BootstrapScreen.tsx` (new) — the two auth screens.
- `apps/desktop/src/main.tsx` — wraps `<RouterProvider>` in
  `<AuthProvider>`.
- `apps/desktop/src/components/sidebar/Sidebar.tsx` — signed-in-user +
  sign-out row in the footer, using `useOptionalAuth()`.
- `apps/desktop/src/i18n/locales/*/session.json` (all 8 shipped
  locales, including English) — new `auth.login`/`auth.bootstrap`/
  `auth.account` keys, fully translated in every shipped locale (not
  English-only — the parity test requires it).
- `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` — §5 (bootstrap) and
  §17 (login/lockout, now §17.1-§17.5) rewritten from design to
  as-implemented; new §15.5 (session token hashing) and §9.1 (auth
  commands never trust a caller-supplied role); current-state audit
  table (§2) updated; Risks section updated.
- `docs/PHASE13_SECURITY_TEST_MATRIX.md` — §A corrected from plan to
  factual report with a Status column; new §H reporting Session 2's 63
  Rust + 12 frontend tests in full.
- This handoff.
- External log: `C:\Users\sekip\Desktop\FormuLab-Phase13-Identity-Security-Log.md`, Session 2 entry appended (not a new log).

## What Session 2 deliberately did NOT do

- No `Administration → Users` UI, no arbitrary (non-bootstrap) user
  creation, no role-change UI, no password-reset administration UI
  (Session 5).
- No `rolePolicy.ts`/`can()` module, no Rust/TypeScript role-vocabulary
  parity test (Session 3).
- No application-wide enforcement — `save_approval_record`'s missing
  role check is still unfixed, and no privileged command anywhere
  resolves role from a session yet outside `auth.rs` itself (Session 4).
- No full department-workflow-engine implementation.
- No project ACLs/memberships — still confirmed out of scope.
- No forced-password-change enforcement UI (`mustChangePassword` is
  preserved in `UserContext` but nothing yet restricts navigation while
  it's true — Session 5).
- No periodic session re-validation while the app is open — `current_session`
  resolves once at startup and once at login/bootstrap; wiring it into
  every privileged action is Session 4's job.

## Open decisions requiring a human answer before Session 4

1. Is the full §6 role-permission matrix correct for a real lab/QA/
   regulatory/production workflow? Session 1's first draft, not
   domain-expert-reviewed.
2. Final confirmation that Administrator should keep approval authority
   on both gates (currently yes, explicit and user-approved, but worth
   reconfirming before it becomes load-bearing in Session 4's
   enforcement).
3. ~~§15.3's 4 workflow gaps~~ **RESOLVED in Session 1's closure**:
   approval authority for all four is `production_manager` (§15.4).
   They still have no `FormulaStatus` today — real future implementation
   work, sequencing TBD (Session 4 or a dedicated workflow session).
4. Is the final lockout/session policy (5 attempts / 15-minute lock /
   12h session / 60min idle, §17.1) right for real usage, or does it
   need tuning once people are actually using it day to day?

## Exact next session

**Phase 13 Session 3: `rolePolicy.ts` (canonical `can(role, area,
capability)` covering all of §6's full permission matrix, not just the
two existing approval gates) + wire the new `UserContext` through the
app + a Rust/TypeScript role-vocabulary parity test.** This is the
bridge session between "authentication exists" (Sessions 1-2) and
"authorization is actually enforced" (Session 4) — it does not itself
add enforcement to any command, it builds the single canonical policy
module Session 4 will call from every privileged action. Still no
`Administration → Users` UI (Session 5) and no application-wide
enforcement (Session 4).
