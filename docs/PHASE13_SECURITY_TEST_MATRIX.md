# Phase 13 — Security Test Matrix

Companion to `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md`. Every
test below is written against a disposable temp database (this
codebase's existing `tmp_dir()` convention in `src-tauri`'s test
modules), never real user data. Implemented across Sessions 1-6 per
the architecture doc's session plan, not all in Session 0.

## A. Authentication

| # | Test | Session |
|---|---|---|
| A1 | Valid username + correct password → session issued | 2 |
| A2 | Valid username + wrong password → generic "Invalid username or password.", no session | 2 |
| A3 | Unknown username → identical generic error, identical timing-insensitive-enough response shape as A2 (no username-enumeration signal) | 2 |
| A4 | Disabled account + correct password → refused before password is even checked | 2 |
| A5 | Locked account (brute-force threshold hit) → refused with the same generic message | 6 |
| A6 | Logout invalidates the session; a subsequent privileged call with the old session id fails | 2 |
| A7 | Expired session → refused, user routed back to Login | 2 |
| A8 | Idle timeout → refused after the configured idle window | 2 |
| A9 | Administrator password reset → old password no longer works, new one does | 2 |
| A10 | `mustChangePassword` true → only the change-password action is reachable until it's cleared | 2 |
| A11 | Bootstrap: fresh install has no administrator → Setup screen renders, not Login | 2 |
| A12 | Bootstrap: after the first administrator exists, the bootstrap command refuses to create a second one, even called directly | 2 |

## B. Role enforcement (per built-in role)

For **each** of the six roles (`researcher`, `chemist`, `quality`,
`regulatory`, `production`, `administrator`), generated from
`docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` §6's matrix so the
test suite and the doc cannot silently drift apart:

| # | Test | Session |
|---|---|---|
| B1 | Every `ALLOWED` cell: the corresponding operation succeeds for that role | 4 |
| B2 | Every `DENIED` cell: the corresponding operation fails for that role, with a clear, non-leaky error | 4 |
| B3 | `pilot_approved`/`production_approved` gates specifically re-assert today's `APPROVAL_AUTHORITY` behavior unchanged (regression guard against this phase weakening existing enforcement) | 4 |

## C. Privilege escalation

| # | Test | Session |
|---|---|---|
| C1 | A logged-in user cannot change their own `role` via any exposed command | 4 |
| C2 | A forged `role` value passed directly as a Tauri command argument (bypassing the UI) is ignored — the command resolves role from the session server-side, never from caller-supplied input | 4 |
| C3 | A `role`/`reviewerRole`-shaped value edited directly in `localStorage`/app state has no effect on what a privileged command will do | 4 |
| C4 | Calling a privileged command directly (simulating devtools-console `invoke()`, bypassing every React component) with a valid session but the wrong role fails exactly like the UI path would | 4 |
| C5 | A modified/hand-crafted JSON payload for `save_approval_record` (or its Phase 13 successor) cannot smuggle an unauthorized approval — regression test anchored directly to the real gap found in Session 0's audit | 4 |
| C6 | Changing a route/URL parameter to reference another user's resource does not bypass project/resource access (once §20 is implemented) | 4 (or later, per §20) |

## D. Database security (SQL injection)

Run against `username`, `password`, `displayName`, `department`,
`employeeId` inputs on account creation, login, password reset, role
change:

| # | Input class | Expected result | Session |
|---|---|---|---|
| D1 | Quote characters (`'`, `"`, `` ` ``) | Stored/compared as inert data, or rejected by validation — never breaks the query | 1 |
| D2 | SQL comment sequences (`--`, `/* */`, `#`) | Same | 1 |
| D3 | Boolean-injection shapes (`' OR '1'='1`, `admin'--`) | Same — login with such a "username" simply fails to match any real user | 1 |
| D4 | Unicode edge cases (RTL override, zero-width joiners, homoglyphs, NFC/NFD mismatches relevant to §3's normalization) | Normalization is deterministic and does not enable a collision/bypass | 1 |
| D5 | Excessive length (beyond the 64-char username bound / password bound) | Rejected by validation before reaching the database | 1 |
| D6 | Unusual whitespace (tabs, non-breaking space, leading/trailing runs) | Rejected (internal whitespace) or trimmed (leading/trailing) per §3, never silently ambiguous | 1 |
| D7 | Every new query in `identity.db`'s Rust layer | Code-review-level assertion: 100% parameterized/prepared, zero string concatenation into SQL | 1 |

## E. Administrator security

| # | Test | Session |
|---|---|---|
| E1 | Non-admin cannot reach `Administration → Users` create/edit/reset/role-change commands | 5 |
| E2 | Non-admin cannot change any user's role, including their own | 5 |
| E3 | Non-admin cannot reset another user's password | 5 |
| E4 | A disabled administrator account cannot authenticate, including to perform admin actions | 5 |
| E5 | Every admin action in D1-D4 above, and every action in this section, writes a `security_audit_events` row | 6 |

## F. Audit

| # | Test | Session |
|---|---|---|
| F1 | Every event class in the architecture doc's §25 list produces exactly one audit row per real occurrence | 6 |
| F2 | No audit row ever contains a plaintext password, password hash, API key, or session secret value — a fuzz/property test scans every inserted row's serialized form for password-hash-shaped strings and fails if one appears | 6 |
| F3 | Audit rows survive account disable/enable and role change (historical attribution intact, per architecture doc §18/§19) | 6 |
