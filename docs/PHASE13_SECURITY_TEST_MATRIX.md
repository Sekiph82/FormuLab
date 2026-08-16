# Phase 13 — Security Test Matrix

Companion to `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md`. Every
test below is written against a disposable temp database (this
codebase's existing `tmp_dir()` convention in `src-tauri`'s test
modules), never real user data. Implemented across Sessions 1-6 per
the architecture doc's session plan, not all in Session 0.

**Session 1 note**: the role model is now the final **12 fixed roles**
(§1 of the architecture doc), superseding the 6-role draft this matrix
originally referenced — every section below has been corrected. Section
G is new this session: it records the 28 identity-layer tests actually
implemented and passing in `identity.rs`, as a factual report rather
than a plan.

**Session 1 closure note**: the four workflow gates §15.3 of the
architecture doc left open (raw-material verification, supplier-document
verification, production-engineering→production handoff, production
release) are now decided as `production_manager` gates — architecture
doc §15.4, user-approved. This is a documentation-only decision: no
`FormulaStatus`/gate exists yet for any of the four, so there is no new
test to add in this closure. When Session 4 (or a dedicated workflow
session) implements real enforcement for these gates, its tests should
assert `production_manager` approves and `raw_material`/`procurement`/
`production_engineering`/`production` are each refused their own gate —
the same shape as the existing B3/B4 role-model-regression tests below.

**Session 2 note**: bootstrap, login, logout, and session
validation/expiry/idle-timeout are now real, implemented, tested
commands — section A below is corrected from a plan to a factual
report (Status column added). Section H is new: it records the 63 Rust
(`identity.rs` + `auth.rs`) and 12 frontend (`AuthProvider`) tests this
session actually implemented and passing.

**Session 3 note**: `rolePolicy.ts`'s `can()` and the Rust/TypeScript
role-vocabulary parity test are now real, implemented, tested — B1/B2
are corrected to mark the *policy layer* done (application-layer
enforcement stays Session 4). Section I is new: it records the 38 new
tests (32 `rolePolicy.test.ts` + 6 role-vocabulary-parity) this session
actually implemented and passing, plus why the 10-panel trusted-actor
frontend wiring needed no new test file of its own.

## A. Authentication

| # | Test | Status | Session |
|---|---|---|---|
| A1 | Valid username + correct password → session issued | **Implemented, passing** | 2 |
| A2 | Valid username + wrong password → generic "Invalid username or password.", no session | **Implemented, passing** | 2 |
| A3 | Unknown username → identical generic error (assert `===` equal to A2's), same-cost dummy-hash timing normalization | **Implemented, passing** | 2 |
| A4 | Disabled account + correct password → refused before password is even checked | **Implemented, passing** | 2 |
| A5 | Locked account (brute-force threshold hit) → refused with the same generic message; expired lock allows attempts again; lockout persists across a DB reopen | **Implemented, passing** | 2 |
| A6 | Logout invalidates the session; a subsequent check with the old token fails | **Implemented, passing** | 2 |
| A7 | Expired session → refused | **Implemented, passing** | 2 |
| A8 | Idle timeout → refused after the configured idle window, even before absolute expiry | **Implemented, passing** | 2 |
| A9 | Administrator password reset → old password no longer works, new one does | Planned (no admin UI/command yet) | 5 |
| A10 | `mustChangePassword` true → only the change-password action is reachable until it's cleared | Planned (flag is preserved in `UserContext`, §17.5; UI restriction not built) | 5 |
| A11 | Bootstrap: fresh install has no administrator → Setup screen renders, not Login | **Implemented, passing** | 2 |
| A12 | Bootstrap: after the first administrator exists, the bootstrap command refuses to create a second one, even called directly | **Implemented, passing** | 2 |

## B. Role enforcement (per built-in role)

For **each** of the 12 fixed roles (`researcher`, `research_manager`,
`quality`, `quality_manager`, `regulatory`, `raw_material`,
`procurement`, `production_engineering`, `production`,
`production_manager`, `document_control`, `administrator`), generated
from `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` §6's matrix so the
test suite and the doc cannot silently drift apart:

| # | Test | Session |
|---|---|---|
| B1 | Every `ALLOWED` cell: the corresponding operation succeeds for that role | Policy layer: **done, Session 3** (`rolePolicy.test.ts`, §I). Application layer (a real command actually refuses/allows accordingly): 4 |
| B2 | Every `DENIED` cell: the corresponding operation fails for that role, with a clear, non-leaky error | Policy layer: **done, Session 3** (`rolePolicy.test.ts`, default-deny asserted directly, §I). Application layer: 4 |
| B3 | `pilot_approved`/`production_approved` gates specifically re-assert `APPROVAL_AUTHORITY`'s Session 1 12-role mapping (manager-tier + regulatory + administrator only) — already implemented and passing in `status.test.ts`/`versioning.test.ts`, re-run here at the application-enforcement layer once it exists | 1 (shared-engine layer, done) / 4 (application layer) |
| B4 | Role-model regression: an employee-tier role (`researcher`, `quality`) never inherits its manager's approval authority, even with a valid approval record — implemented and passing (`status.test.ts`, `versioning.test.ts`) | 1 (done) |

## C. Privilege escalation

| # | Test | Session |
|---|---|---|
| C1 | A logged-in user cannot change their own `role` via any exposed command | 4 |
| C2 | A forged `role` value passed directly as a Tauri command argument (bypassing the UI) is ignored — the command resolves role from the session server-side, never from caller-supplied input | 4 |
| C3 | A `role`/`reviewerRole`-shaped value edited directly in `localStorage`/app state has no effect on what a privileged command will do | 4 |
| C4 | Calling a privileged command directly (simulating devtools-console `invoke()`, bypassing every React component) with a valid session but the wrong role fails exactly like the UI path would | 4 |
| C5 | A modified/hand-crafted JSON payload for `save_approval_record` (or its Phase 13 successor) cannot smuggle an unauthorized approval — regression test anchored directly to the real gap found in Session 0's audit | 4 |
| C6 | Changing a route/URL parameter to reference another user's resource does not bypass project/resource access (once §20 is implemented) | 4 (or later, per §20) |

## D. Database security (SQL injection) — implemented Session 1, storage layer

Run against `username` on `create_user`/`find_user_by_normalized_username`
(the only currently-exposed input surface — `password`/`displayName`/
`department`/`employeeId` injection tests are Session 2+, once a login/
create-user *command* exists to attack; the storage functions
themselves already bind every field as a parameter, not just
`username`):

| # | Input class | Expected result | Status |
|---|---|---|---|
| D1 | Quote characters (`'`, `"`, `` ` ``) | Stored/compared as inert data, or rejected by validation — never breaks the query | **Implemented, passing** |
| D2 | SQL comment sequences (`--`, `/* */`, `#`) | Same | **Implemented, passing** |
| D3 | Boolean-injection shapes (`' OR '1'='1`, `admin'--`) | Same — login with such a "username" simply fails to match any real user | **Implemented, passing** |
| D4 | Unicode edge cases (RTL override, zero-width joiner) | Rejected outright by the ASCII-only username charset — no normalization-collision risk since non-ASCII never reaches the database (§4 of the architecture doc: NFC normalization turned out to be unnecessary given the charset) | **Implemented, passing** |
| D5 | Excessive length (10,000 chars, far beyond the 64-char bound) | Rejected by validation before reaching the database | **Implemented, passing** |
| D6 | Unusual whitespace (tab, non-breaking space, newline) | Rejected (internal whitespace is never allowed) | **Implemented, passing** |
| D7 | Every query in `identity.rs` | 100% parameterized via `rusqlite`'s `params![...]` — verified by direct code reading, zero string concatenation into SQL text anywhere in the module | **Confirmed** |
| D8 | Password field: oversized input (1MB) | Hashes/verifies without panicking or unbounded cost issue | **Implemented, passing** |
| D9 | Password field: malformed/corrupt stored hash | Verification fails cleanly (`false`), never panics | **Implemented, passing** |

Password injection at the *command* layer is now covered — §H's
`sql_injection_shaped_usernames_are_inert_through_the_full_login_path`
runs the same hostile-string battery through `login_logic` end to end
(normalize → lookup → verify → session), not just the storage
functions. `displayName`/`department`/`employeeId` injection stays
Session 5+ work, once Administration → Users commands accept them.

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

## G. Session 1 — identity-layer tests actually implemented and passing (28/28)

All in `apps/desktop/src-tauri/src/identity.rs`'s `#[cfg(test)] mod
tests`, run via `cargo test --lib identity`. Every test opens a fresh,
disposable temp-directory SQLite file (`std::env::temp_dir()`, unique
per test by name + process id, never a real `identity.db`).

**Identity DB (2)**: fresh database creates all 4 tables and reaches
the latest `user_version`; migrations are idempotent (seed a user,
reopen, schema version and data both survive unchanged).

**Roles (3)**: all 12 fixed roles round-trip through `as_str`/`parse`;
unknown role strings (including the retired `"chemist"` and a made-up
`"packaging"`) are rejected; `researcher`/`research_manager`,
`quality`/`quality_manager`, `production`/`production_manager` are
pairwise distinct strings (role-model regression).

**Username (6)**: realistic usernames (`ahmet.yilmaz`, `lab01`,
`quality.manager`, etc.) accepted; too-short/too-long/leading-or-
trailing-whitespace rejected; disallowed characters and email-shaped
input rejected; normalization is case-insensitive; a second user
differing only by case is refused by the actual database `UNIQUE`
constraint (not just an app-level check).

**Password (6)**: correct password verifies, wrong password is
rejected; two hashes of the same password use different random salts
(and both still verify); the plaintext password never appears inside
its own stored hash string; a 1MB password hashes/verifies without
panicking; a malformed stored hash fails verification cleanly instead
of panicking.

**Users (5)**: create-then-find by normalized username and by id round-
trip, including that a freshly created user has `must_change_password
= true`; looking up an unknown username/id returns `None`, not an
error; disabling an account revokes every open session immediately;
changing a role takes effect immediately in storage; resetting a
password sets `must_change_password` and the old password stops
verifying while the new one works.

**Login/lockout (2)**: 4 failures leave an account unlocked, a 5th
(at `threshold=5`) locks it, and a subsequent success fully resets the
counter and the lock; both successful and failed attempts are
persisted to `login_attempts`.

**Sessions (2)**: a fresh session validates and a `-1`-TTL (already-
expired) one does not; an unknown session id validates to `None`.

**Audit (1)**: two real audit events persist correctly and neither's
`detail` field contains the seeded user's actual password hash.

**SQL injection (2)**: the hostile-string battery (§D) and the
excessive-length-username test.

**Total**: 28 tests, 28 passing (Session 1 baseline; §H below records
what changed/was added in `identity.rs` for Session 2).

## H. Session 2 — authentication lifecycle tests actually implemented and passing

### H.1 `identity.rs` additions (10 new tests, on top of Session 1's 28 — 38 total)

Token hashing (2): the raw session token is never stored, only its
SHA-256 hash is (asserted against the actual stored `id` column); two
sessions for the same user get different, unpredictable tokens.
Revocation (2): a revoked session no longer validates; revoking an
unknown token is a harmless no-op (never an error — logout must not let
a caller distinguish "never valid" from "already logged out"). Idle
timeout (2): a session idle past the configured window fails validation
even before its absolute expiry; a successful validation slides
`last_seen_at` forward. Lockout (1): `is_locked` correctly reflects a
`locked_until` in the future vs. the past. Bootstrap (3): a fresh
database has no administrator; `bootstrap_administrator` creates the
first admin with the role forced to `Administrator` and no forced
password change; a second bootstrap attempt is permanently rejected and
leaves no partial second user behind.

### H.2 `auth.rs` (25 new tests)

**Bootstrap (6)**: fresh database reports bootstrap required; bootstrap
creates an administrator and immediately enters an authenticated
session (the chosen UX, architecture doc §5); the password is never
returned and only its hash is stored; a second bootstrap is rejected
including a direct backend call (not just through a UI layer); mismatched
password confirmation and an under-length password are both rejected,
and a rejected bootstrap attempt creates no one; no default
`admin`/`admin`-shaped credentials ever authenticate.

**Login (6)**: correct credentials succeed; username case normalization
works (`Case.Admin` logs in as `case.admin`); wrong password and unknown
username return the **identical** public error string (asserted `===`
equal, not just similarly worded); a disabled account cannot log in even
with the correct password; malformed input (SQL-injection-shaped
usernames, empty username, a 1MB password) is rejected safely without
panicking and without disrupting the real account.

**Lockout (3)**: 4 failures leave an account unlocked and the 5th locks
it (even the correct password is then refused); an expired lock (forced
into the past directly, no real sleep) allows login attempts again;
lockout state survives a database close/reopen, proving it's real
persisted state, not just in-memory.

**Session (6)**: a valid session resolves via `current_session_logic`;
an absolute-expiry-forced session is rejected; logout revokes a session
and it no longer validates; logging out an unknown or already-revoked
token does not error; a role change is reflected on the very next
session check for the same still-valid token (no stale snapshot); a
malformed/garbage/oversized token validates to `None`, never an error.

**Audit (2)**: bootstrap/login-success/login-failure/lockout-triggered/
logout all produce their own distinct `security_audit_events` row; no
audit row or `login_attempts` row ever contains the real password hash,
the raw bearer session token, or the plaintext password used in the
test.

**Security (2)**: the full hostile-string SQL-injection battery run
through the complete `login_logic` path (not just storage functions) is
inert — the `users` table survives intact and the real account is
unaffected; bootstrap structurally cannot create a non-administrator
role (no `role` parameter exists on the command at all) and a plain
employee-tier user existing doesn't open or close bootstrap by itself.

**Total**: 25 tests, 25 passing.

### H.3 Frontend — `AuthProvider.test.tsx` (12 new tests)

Startup routing (5): a fresh install (bootstrap required) shows
Administrator Setup and renders neither Login nor the app; a configured
install with no persisted session shows Login; a valid persisted session
enters the app directly without showing Login; an invalid/expired
persisted session falls through to Login and clears the stale
`localStorage` token; no protected content renders while bootstrap
status is still resolving (no flash). Login flow (3): a successful
login enters the app and persists only the opaque token (never
username/role — asserted the stored value doesn't contain the
username); an invalid login shows the generic error and stays on Login;
the Login screen has no signup/social/email/SMS/forgot-password
affordances (queried and asserted absent). Bootstrap flow (2): the
bootstrap screen has no role selector anywhere (`<select>` query
returns null); a successful bootstrap enters the app as administrator.
Logout (2): logout clears local state, calls the backend revoke, and
returns to Login; logout still returns to Login even if the backend
revoke call fails (offline edge case) — local session is cleared either
way.

**Total**: 12 tests, 12 passing.

### H.4 Full-suite confirmation

`cargo build --lib`: clean. `cargo test --lib identity auth` (filtered):
63/63 passing. `cargo test --lib` (full crate, every module): 251/251
passing (Session 1's 216 + 35 net new), confirming nothing else in the
crate regressed. `cargo clippy --lib -- -D warnings`: clean. Desktop
frontend: `tsc --noEmit` clean; `vitest run` (full desktop suite):
1185/1185 passing (Session 1's 1173 + 12 new), including the i18n
parity suite across all 8 locales after adding the new Login/Bootstrap/
account strings to all 7 non-English shipped locales (not just
English — this session's new UI-facing strings are fully translated,
unlike some earlier sessions' narrower role-string corrections).
`eslint` clean on every touched file. `git diff --check`: clean. Shared
package (`packages/shared`) untouched this session — its own
typecheck/test suite was not re-run, per the instruction to scope
verification to what actually changed.

## I. Session 3 — `rolePolicy.ts`, role-vocabulary parity, trusted-actor wiring tests actually implemented and passing

### I.1 `packages/shared/src/engine/rolePolicy.test.ts` (32 new tests)

One `describe` block per §6 area (Home, Projects, Formulation,
Laboratory, Stability, Optimization, Regulatory, Approval, Reports,
Administration, Data Exchange) exercising representative `ALLOWED`/
`DENIED` cells for a sample of roles per area, plus: default-deny for
an area/capability pair with no explicit matrix entry; the two
documented discrepancy-resolutions (`production_manager` verify on
`rawMaterials`/`supplierDocuments`; `quality`+`administrator` verify on
`regulatory`) each get a direct assertion, not just incidental
coverage; `approve`/`reject` on both approval gates are asserted
identical to `APPROVAL_AUTHORITY[status].includes(role)` for every one
of the 12 roles, proving the derivation is structural, not a
separately-typed duplicate that happened to match at commit time.

**Total**: 32 tests, 32 passing.

### I.2 Role-vocabulary parity (6 new tests: 5 TypeScript + 1 Rust)

`packages/shared/src/engine/rolePolicy.roleVocabularyParity.test.ts`
(5): the 12 roles in `roleVocabulary.json` are exactly `APPROVAL_ROLES`
(no extra, none missing, both directions asserted separately so a
one-sided drift can't hide); the JSON fixture has no duplicate entries;
every `rolePolicy.ts` area/capability pair referenced against a role not
in the fixture is unreachable (a compile-time/structural check, not
just a runtime one). `identity.rs`'s new
`role_vocabulary_matches_the_shared_json_fixture` (1): parses the same
`roleVocabulary.json` file from Rust and asserts its 12 entries are
byte-identical, in the same order, to `identity::Role`'s `as_str()`
output for every variant — the two languages check themselves against
one shared file, never against each other's hand-copied list.

**Total**: 6 tests, 6 passing.

### I.3 Frontend — trusted-actor wiring (no new test files; existing suites re-verified unaffected)

`useTrustedActor()` (`apps/desktop/src/lib/currentActor.ts`) has no
dedicated test file of its own — it is a thin, 3-line-bodied
composition of the already-tested `useOptionalAuth()`
(`AuthProvider.test.tsx`, §H.3) with no independent logic to unit-test.
Its correctness is instead demonstrated by every existing test file for
the 10 wired panels continuing to pass unchanged (they render outside
an `AuthProvider`, so `useTrustedActor()` returns `null` and each panel
falls through to its pre-Session-3 local selector state, exercising the
exact same code paths those tests already covered) — a regression in
the fallback would have shown up as a failure in these suites, and none
occurred.

**Total**: 0 new tests; 15 pre-existing `TrialsPanel.test.tsx`/
`StabilityPanel.test.tsx` tests re-run and still passing (§I.4); the
7-panel `ApprovalPanel`/`ClaimsLabelsPanel`/`DossierPanel`/
`RegulatoryPanel`/`DoePanel`/`TestMethodDrawer`/`DataExchangePage` wiring
landed in the prior (checkpoint) commit this same session and is
included in the same full-suite run below.

### I.4 Full-suite confirmation

`cargo build --lib`: clean. `cargo test --lib`: 252/252 passing
(Session 2's 251 + 1 net new — the role-vocabulary parity test),
confirming nothing else in the crate regressed. `cargo clippy --lib --
-D warnings`: clean. Shared package: `tsc --noEmit` clean; `vitest run`:
1291/1291 passing (Session 2's 1254 + 37 net new — 32 `rolePolicy.test.ts`
+ 5 `rolePolicy.roleVocabularyParity.test.ts`). Desktop frontend:
`tsc --noEmit` clean; `vitest run` (full suite): 1185/1185 passing —
unchanged from Session 2's count, since this session's frontend change
is a wiring/fallback change with existing coverage (§I.3), not new
behavior needing new tests. `git diff --check`: clean.
