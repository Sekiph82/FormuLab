# Phase 13 — Enterprise Identity, Authentication, Fixed RBAC & Application Security

**Status: Session 0 (architecture + audit) complete. No authentication system implemented yet — this document is the design this and future sessions build against.**

## 0. Why this phase exists

FormuLab today is a single-user local desktop app: every "who did this"
field in the domain layer (`Actor.userId`) is either hardcoded to the
literal string `"local"`, or a free-text field the user types into a
panel. There is no login, no user database, no password, no session.
Selling FormuLab into labs/QA/regulatory/production departments requires
a real, closed, enterprise-only identity system: administrator-created
accounts, username + password login, and a fixed six-role permission
model — no public sign-up, no email/SMS verification, no mandatory
external identity provider.

---

## 1. Current-state audit

Audited: `packages/shared/src/schemas/status.ts` (Actor/ApprovalRole),
`packages/shared/src/engine/{approvalReadiness,lifecycle,claims,
regulatoryReviews,regulatoryRules,regulatoryDossier,laboratoryStandards,
labels,doeAnalysis,doeCandidates,doeDesign}.ts`, every frontend site that
constructs an `Actor`, `apps/desktop/src-tauri/src/formulations.rs`'s
`save_approval_record`, `apps/desktop/src-tauri/capabilities/default.json`,
`apps/desktop/src/app/routes/AdministrationPage.tsx`, `SECURITY.md`,
rusqlite usage across `src-tauri/src` (grep for every `.rs` file), and
every Rust file for `password`/`login`/`authenticate` tokens.

| Capability | Status | Evidence |
|---|---|---|
| User accounts | **MISSING** | No user table/store anywhere. |
| Administrator-created users | **MISSING** | No creation flow exists. |
| Username login | **MISSING** | No login screen; app opens directly to `HomePage`. |
| Password authentication | **MISSING** | No password field/hash anywhere in the codebase. |
| Logout | **MISSING** | No session to log out of. |
| Password hashing | **MISSING** | No password storage of any kind. |
| Account enable/disable | **MISSING** | No account concept. |
| Administrator password reset | **MISSING** | — |
| Brute-force protection / login throttling | **MISSING** | No login endpoint to throttle. |
| Authenticated session | **MISSING** | No session token/cookie/context anywhere. |
| Session expiration / idle timeout | **MISSING** | — |
| Role storage (trusted) | **MISSING** | `ApprovalRole` is a real, well-designed *type*, but nothing durably stores "this human is a chemist" — see below. |
| Role assignment (by admin) | **MISSING** | No admin UI to assign a role to anyone. |
| Role enforcement (domain-level) | **PARTIAL** | `canTransitionTo` (`status.ts`) is real, tested, working enforcement — see §8 — but it trusts whatever `Actor.role` it's given. |
| Role enforcement (backend/Rust) | **UNSAFE** | `save_approval_record` (Tauri command) validates that an approver name is non-empty and not a machine actor (`"ai"`/`"system"`/etc.), but performs **no role check at all**. A raw `invoke("save_approval_record", {...})` from the WebView devtools console — bypassing the React UI and its `canTransitionTo` call entirely — writes a valid, permanent approval record with any name and no role gate. This is a real, currently-exploitable authorization bypass, not a hypothetical. |
| UI role selection | **UNSAFE** | `reviewerRole`/`actorRole`/`actingRole` are plain `useState<ApprovalRole>` values bound to a `<select>` the user freely changes (`ApprovalPanel.tsx:417,1214`; same pattern in `ClaimsLabelsPanel.tsx`, `DoePanel.tsx`, `DossierPanel.tsx`, `RegulatoryPanel.tsx`, `TestMethodDrawer.tsx`). The paired `userId` is a free-text input defaulting to `"local"`. Nothing authenticates either value. This is exactly the "reviewerRole dropdown" attack the phase brief names. |
| Project/resource access | **NOT_APPLICABLE (today)** | No project-membership concept exists at all — every user, hypothetically, can reach every project. Not unsafe *today* (no users exist to restrict), but a real gap once accounts exist. |
| Audit logging (security events) | **PARTIAL** | `formulations.rs`/`provenance.rs` log domain events (formula saves, approvals, run provenance) with a named `approvedBy`, but there is no login/logout/account-lifecycle/permission-denied audit trail, because none of those events exist yet. |
| SQLite/user database | **NOT_APPLICABLE (today)** | The only `rusqlite` usage in the whole Rust source is `runs_index.rs` — a disposable, rebuildable run-index cache, not a candidate for the identity store. |
| `capabilities/default.json` | **NOT_APPLICABLE (today)** | No identity-related Tauri permission exists because no identity Tauri command exists yet. |
| Administration UI | **PARTIAL** | `AdministrationPage.tsx` exists today with `overview`/`testDefinitions` sections only — a real, working page to extend, not build from scratch, but it has zero user-management content today. |

**Explicitly NOT REQUIRED**, confirmed and carried forward as a hard
constraint for every later session: public registration, email
verification, SMS/phone verification, social login, email-based
password recovery, consumer account creation. None of this exists
today either, which is correct — it must stay that way.

### 1.1 The one piece of real, valuable existing infrastructure: `canTransitionTo`

`packages/shared/src/schemas/status.ts` already encodes the load-bearing
safety rule this phase must not weaken: an approval status
(`pilot_approved`, `production_approved`) can only be reached by a
`{kind: "human"}` actor whose role is in `APPROVAL_AUTHORITY[to]`, and
only with a signed `ApprovalRecord` attached. Agents, imports, and system
processes are refused outright, by type — `Actor.kind !== "human"`. This
is exactly the right shape for the *authorization* half of RBAC; what's
missing is the *authentication* half that would make `actor.role`
trustworthy instead of self-reported.

---

## 2. User entity design

```ts
interface User {
  id: string;                 // immutable internal ID (ULID or uuid v7 — sortable, generated client-independent)
  username: string;            // as typed at creation, display casing preserved
  usernameNormalized: string;  // lowercased, trimmed — the actual uniqueness/lookup key
  displayName: string;
  passwordHash: string;        // Argon2id encoded hash string (algorithm+params+salt+hash, self-describing)
  role: ApprovalRole;          // one of the six fixed roles — reuses the existing shared type, not a new one
  status: "active" | "disabled";
  department?: string;
  employeeId?: string;
  mustChangePassword: boolean;
  createdAt: string;           // ISO 8601
  createdBy: string;           // User.id of the admin who created this account
  updatedAt: string;
  lastLoginAt?: string;
  failedLoginCount: number;
  lockedUntil?: string;        // set by brute-force protection, see §10
}
```

Deliberately **not** in this table: email, phone, avatar, locale
preference (that's already a separate app-settings concern),
per-user permission rows (§6/§9 explain why), password history (not
required by the stated business model; add later only if a concrete
compliance requirement demands it — do not build ahead of the need).

---

## 3. Username rules

- **Uniqueness**: enforced on `usernameNormalized` via a `UNIQUE`
  database constraint (not just an app-level check — the constraint is
  the actual source of truth; the app check is only a friendlier error
  before hitting it).
- **Normalization**: `usernameNormalized = username.trim().toLowerCase()`.
  Unicode is normalized to NFC before lowercasing so visually-identical
  usernames typed with different composed/decomposed accent forms can't
  collide-but-not-collide.
- **Case sensitivity**: login and uniqueness are case-**insensitive**
  (`ahmet.yilmaz` and `Ahmet.Yilmaz` are the same account) — matches
  every enterprise directory convention (AD/LDAP-style) and avoids
  support tickets from employees who don't remember their own casing.
  `username` (original casing) is kept only for display.
- **Allowed characters**: ASCII letters, digits, `.`, `_`, `-`. No spaces
  (rejected, not silently stripped — silent stripping is a source of
  duplicate-looking accounts). No requirement to look like an email
  address — `lab01`, `chemist03`, `quality.manager` are all valid.
- **Length**: 3–64 characters after trimming.
- **Whitespace**: leading/trailing trimmed before validation; internal
  whitespace rejected outright (not collapsed).

---

## 4. First administrator bootstrap

On a fresh install, the `users` table is empty. `apps/desktop/src-tauri`
exposes a single Tauri command, `bootstrap_status`, checked once at
startup: `{ "hasAdministrator": bool }`. If false, the frontend renders
an **Administrator Setup** screen instead of the normal Login screen —
same shell, different content, no separate binary/mode. The installing
person enters: administrator username, password (with the app's own
strength rule, not a copy-pasted generic one — TBD in Session 1/2 against
real threat model, not invented here), and display name. On submit, the
Rust command re-checks `hasAdministrator` is still false (races between
two windows/processes are possible on a machine with multiple app
instances briefly running) and only then inserts the row and marks
bootstrap permanently closed. After that, `bootstrap_status` always
returns `hasAdministrator: true` and the Administrator Setup route
becomes unreachable — not just hidden, the Rust command itself refuses
to insert a second bootstrap administrator once one exists, so a UI bug
can't reopen this hole.

No default credentials are ever seeded. `admin/admin`,
`admin123`, `administrator/password`, `formulab/formulab` are
permanently absent from source, seed data, and documentation.

---

## 5. Administrator creates users

`Administration → Users → Create User`. Fields: username, display name,
initial password, role (one of the fixed six, `<select>` — this is the
*only* role-selection UI in the whole app, and it belongs to the admin
creating the account, never to the user logging in), optional
department, optional employee/reference ID, active/inactive (defaults
active). No permission checkboxes. On save, the account can log in
immediately with username + the initial password (subject to
`mustChangePassword`, §11) — no email, no SMS, no external service, no
verification step of any kind.

---

## 6. Fixed role-permission matrix

Every cell below is **ALLOWED** or **DENIED**, no partial/conditional
states — conditional access (e.g. "chemist can edit only formulas
they created") stays inside existing domain logic (ownership,
lifecycle state) exactly as it already works; RBAC answers "can this
role ever do X", not "can this specific record be edited right now."

Legend: V=view, C=create, E=edit, D=delete, S=submit (advance a
non-approval lifecycle step, e.g. concept → chemist_review),
A=approve (grant `pilot_approved`/`production_approved`), Rj=reject,
Vf=verify (regulatory dossier/claim verification), Sp=supersede,
X=export, Ad=administer.

| Area | Researcher | Chemist | Quality | Regulatory | Production | Administrator |
|---|---|---|---|---|---|---|
| Home | V | V | V | V | V | V |
| Projects | V,C | V,C,E | V | V | V | V,C,E,D |
| Formulation (builder, versions) | V | V,C,E,S | V | V | V | V |
| Laboratory (trials, test methods, corrective actions) | V | V,C,E | V,C | V | V,C | V |
| Stability | V | V,C,E | V,C | V | V | V |
| Optimization (advanced optimizer, substitution) | V | V,C,E | V | V | — | V |
| Regulatory (dossier, claims/labels, DOE as evidence) | V | V | V | V,C,E,Vf | V | V |
| Approval (`pilot_approved`) | — | A,Rj | A,Rj | — | — | A,Rj |
| Approval (`production_approved`) | — | — | A,Rj | A,Rj | A,Rj | A,Rj |
| Reports | V,X | V,X | V,X | V,X | V,X | V,X |
| Administration → Users | — | — | — | — | — | V,C,E,Ad |
| Administration → Security history | — | — | — | — | — | V,Ad |
| Administration → App settings (backup, schema, data location) | — | — | — | — | — | V,E,Ad |
| Data Exchange (import/commit masterdata) | — | V,C | V,C | V,C | — | V,C,Ad |

Directly reuses `APPROVAL_AUTHORITY` from `status.ts` for the two
Approval rows — **not** redefined here, to guarantee there is exactly
one source for who can approve what (§7). Every other row is new
policy this phase introduces; it is a first draft against current
navigation (`AGENTS.md`'s route list, `AdministrationPage.tsx`,
`Sidebar.tsx`) and must be walked past a real domain expert (someone
who actually runs a lab/QA/regulatory workflow) before Session 4 wires
enforcement — recorded here as an explicit open decision (§ Risks).

### 6.1 The Administrator authority decision (explicit, per phase brief §"IMPORTANT ADMINISTRATOR DISTINCTION")

**Administrator does NOT get scientific/quality/regulatory approval
authority by default.** The matrix above deliberately grants
Administrator `A,Rj` on `pilot_approved`/`production_approved` **only**
because `APPROVAL_AUTHORITY` in the *existing, working* `status.ts`
already includes `"administrator"` on both gates today — changing that
would be *weakening* existing enforcement, which §31 of the phase brief
explicitly forbids. Administrator's role here is system administration
(user lifecycle, security history, app settings) — it is not granted
`C`/`E` on Formulation/Laboratory/Stability/Optimization content, and
has only `V` (view) everywhere scientific work happens, mirroring "system
administration and scientific/business approval authority should remain
separate where appropriate." The one deliberate exception (approval
authority) is inherited, not invented, and is flagged here rather than
silently carried over so a human can veto it explicitly before Session 4
if the real business decision is "administrator should never approve."

---

## 7. Canonical authorization source

One module, `packages/shared/src/engine/rolePolicy.ts` (new, Session 3),
owns the entire matrix in §6 as a typed, exhaustive `Record`:

```ts
export type Area =
  | "home" | "projects" | "formulation" | "laboratory" | "stability"
  | "optimization" | "regulatory" | "approvalPilot" | "approvalProduction"
  | "reports" | "adminUsers" | "adminSecurity" | "adminSettings" | "dataExchange";

export type Capability = "view" | "create" | "edit" | "delete" | "submit"
  | "approve" | "reject" | "verify" | "supersede" | "export" | "administer";

export function can(role: ApprovalRole, area: Area, capability: Capability): boolean;
```

`APPROVAL_AUTHORITY` (`status.ts`) stays the literal source for the two
approval areas — `rolePolicy.ts` imports and re-exposes it through `can()`
rather than duplicating the role lists, so there is structurally no way
for the two to drift. Every consumer — `Sidebar.tsx` nav filtering,
button `disabled`/hidden state, Tauri command guards (Rust re-imports
the *same policy*, generated or hand-mirrored with a test asserting
byte-for-byte parity — decided in Session 3, not guessed here), and
every RBAC test — calls `can()`. No second matrix is ever hand-written
in a component, a seed file, or a doc (this document is a *description*
of the matrix, not a second copy of the code — Session 3 must keep it
that way by generating this table from the source, not maintaining it
by hand, once the module exists).

---

## 8. Preserving existing Regulatory authorization

`APPROVAL_AUTHORITY`, `canTransitionTo`, and every regulatory-engine
function that already checks `Actor.role` (`regulatoryReviews.ts`,
`regulatoryRules.ts`, `regulatoryDossier.ts`, `claims.ts`) are **kept
verbatim**. Phase 13 adds a trustworthy source for `Actor.role` (an
authenticated `UserContext`, §14) underneath them — it does not touch
their logic. No secure domain-level check is replaced with a UI-only
one; the fix is the opposite direction: today's UI-only role selection
(§1's UNSAFE finding) gets replaced by the authenticated context, while
the domain checks it feeds stay exactly as strict as they are today.

---

## 9. Frontend is not the security boundary

Confirmed gap, confirmed fix direction: today, hiding a button *is* the
only protection (§1). Phase 13's fix is at the Tauri command layer —
every command that performs a role-gated action takes the caller's
*trusted* `session_id` (never a `role` string passed as a plain
argument), resolves the session to its `User.role` server-side (i.e.
Rust-side; "server" here means the Rust process, not a network
service), and calls the *same* `can()`/`APPROVAL_AUTHORITY` policy
before performing the action — exactly mirroring `save_approval_record`'s
existing "the webview is untrusted input" comment (§1.1's evidence),
generalized from "reject non-human actors" to "reject non-authorized
roles." A forged `role` in `localStorage`, a modified `reviewerRole`
select, a hand-crafted `invoke()` call, a doctored URL/route param — none
of them can influence which role a Tauri command believes it's talking
to, because after this phase the command never accepts a role as
input at all; it only accepts a session id and looks the role up
itself.

---

## 10. Password security

**Argon2id**, via the `argon2` crate (`RustCrypto/argon2`, mature,
already the modern default recommendation over bcrypt/scrypt for new
Rust codebases) — no compatibility evidence in this codebase favors an
alternative (no existing password-hashing dependency to be compatible
*with*; this would be the first). Parameters chosen in Session 1 against
this app's real threat model (offline attacker with a stolen SQLite
file, single-workstation hardware) — not invented here, but Argon2id
itself is decided now because it directly shapes the `users` schema
(`passwordHash` is one self-describing encoded string, not separate
salt/hash/algorithm columns).

Never stored or logged: plaintext password, any recoverable/encrypted
password, the password hash itself in logs, a temporary/reset password
in logs, session tokens/secrets. Administrator can **reset** (write a
new hash) but structurally **cannot view** an existing password — there
is no code path that ever reads `passwordHash` back out as anything
other than an opaque string fed into the Argon2 *verify* function.

---

## 11. First-login password change

`mustChangePassword: boolean` on `User`, set `true` by default whenever
an administrator sets/resets a password (both account creation and
password reset go through the same "set a new initial/temporary
password" code path). **Recommendation: enabled by default**, matching
every real enterprise IT practice this app is being sold into — an
admin-chosen initial password is known to at least one other person
(the admin) and should not remain the employee's permanent password.
On login, if `mustChangePassword` is true, the session is granted just
enough to reach a "choose a new password" screen and nothing else
(not the full app) until a new password is set, then `mustChangePassword`
flips false and normal login proceeds. Still no email/SMS at any point.

---

## 12. Password reset

Employee → contacts company IT → Administrator → `Users` → `Reset
Password` → sets or generates a new temporary password → old hash is
overwritten (never kept, never recoverable) → `mustChangePassword` set
true (§11) → a `security_audit_events` row is written (actor = admin,
target = the reset user, action = `password_reset`, no password
material in the row, §25) → per policy (Session 2 decision, not fixed
here): all of that user's existing sessions are invalidated
immediately, since a reset implies the old password (and anything an
attacker who had it could still do) should stop working the moment IT
acts, not after natural session expiry. No public "forgot password"
email flow exists or is planned.

---

## 13. Login architecture

```
FormuLab starts
  → security subsystem initializes (Session 1's users/sessions tables ready)
  → check for an existing valid session (persisted session_id, see §14)
  → valid → resume directly into the app
  → none/invalid/expired → render Login screen
```

Login screen: FormuLab wordmark, **Username** text field, **Password**
field (masked), **Sign in** button. No role selector. No sign-up link.
No email field. No SMS. No social-login buttons. `Sign in` calls a
single Tauri command, `login(username, password)`, which does the
lookup + Argon2 verify + brute-force check (§17) entirely Rust-side and
returns either a session or a generic failure (§17's "don't reveal
which part was wrong"). On success: the returned session's `role`
resolves through `rolePolicy.ts`'s `can()` for every subsequent
authorization decision; the frontend never independently decides what
the user's role "is."

---

## 14. Authenticated security context

```ts
interface UserContext {
  userId: string;
  username: string;
  displayName: string;
  role: ApprovalRole;
  sessionId: string;
  accountStatus: "active" | "disabled";
}
```

No `permissions: string[]` array is persisted or shipped to the
frontend — permissions are **derived**, on demand, by calling
`can(context.role, area, capability)` against the single canonical
policy (§7). This directly answers phase-brief §14/§15's question:
because the business requirement is "role fully determines access, no
per-user overrides," there is no need for a `permissions` table, a
`role_permissions` join table, or `user_permission_overrides` — that
would be modeling a generic IAM system the product does not want
(phase brief §"CRITICAL RBAC DESIGN DECISION" and §15 are explicit
about this). If a genuine, unavoidable need for a per-user override
surfaces later, it gets its own dedicated design and its own explicit
sign-off — it is **not** part of this architecture, and nothing here
should make adding it look like a natural next step.

---

## 15. Database model

```
users                    (see §2)
authenticated_sessions   (session_id PK, user_id FK, created_at, expires_at, last_seen_at, revoked_at?)
login_attempts           (id PK, username_normalized, at, outcome: success|bad_password|unknown_user|locked, ip/device context N/A for a local desktop app — see note)
security_audit_events    (id PK, at, actor_user_id, target_user_id?, action, outcome, detail?)
```

No `roles` table (the six roles are fixed application policy, not
database rows — phase brief §15 is explicit: "do not create editable
database role definitions unless there is a concrete need"). No
`permissions`/`role_permissions`/`user_permission_overrides` tables
(§14). `project_access` is deliberately **not** in this list — §20
below recommends deferring it to its own session once the fixed-role
system is live, rather than bundling two different access models into
one migration.

This lives in the same on-disk area as the rest of FormuLab's local
data (an app-private SQLite file under `app_data_dir()`, following the
existing precedent of `runs_index.rs`'s own database — a **new**,
dedicated file, e.g. `identity.db`, not reused/shared with `runs.db` or
any `.formulab-backup` content, so identity data has its own backup/
restore lifecycle independent of formulation data). Exact migration
mechanics (versioned schema, `schema_meta` reuse from the existing
`migration.rs` infrastructure) are a Session 1 task, not designed here
beyond confirming the existing migration framework is the right tool
(it is — `migration.rs` already exists and already solves "safe,
versioned schema evolution" for this app).

*Note on `login_attempts`*: a "device/workstation context" column is
included per phase-brief §25's audit-record shape, but on a
standalone desktop app there is no meaningful network-identifiable
device beyond the machine FormuLab is already running on — this column
is reserved for the Model-B (company-local shared identity, §24) case
where a login attempt genuinely originates from a *different*
workstation, and is null/unused under Model A.

---

## 16. SQL injection assessment

Every current database write path in `src-tauri/src` already uses
`rusqlite` (via `runs_index.rs`) or hand-rolled JSON-file writes
(`masterdata.rs`, `formulations.rs`) — **no current code string-concatenates
SQL**, confirmed by reading every `rusqlite` call site in `runs_index.rs`
(all parameterized, `?1`/named-param style). This phase's new
identity tables must hold to the same standard as a hard requirement,
not a preference: every query (`username` lookup, password verify,
account creation, password reset, account status change, role change,
login-attempt insert, session insert/lookup, audit-event insert) uses
`rusqlite`'s parameter binding exclusively. Session 1/6 add dedicated
regression tests feeding hostile-looking strings as pure *data* — quote
characters, SQL-comment sequences (`--`, `/* */`), boolean-injection
shapes (`' OR '1'='1`), Unicode edge cases (RTL override characters,
zero-width joiners, homoglyphs relevant to the username-normalization
rule in §3), excessive lengths (beyond the 64-char username bound, beyond
a generous password-length bound), and unusual whitespace — asserting
each one is rejected by validation *or* safely stored/compared as inert
data, never executed as SQL. No test in this suite ever runs against
real user data (§17/§26 of the phase brief) — all against disposable
temp databases, matching this codebase's existing test convention
(`tmp_dir()` helpers already used throughout `src-tauri`'s test modules).

---

## 17. Login brute-force protection

Design (implemented Session 6, decided now so §2/§15's schema already
supports it): every login attempt, success or failure, is a row in
`login_attempts`. On failure, `User.failedLoginCount` increments; at a
threshold (Session 6 picks the exact number against real usability
testing — a starting point of 5, doubling backoff, is a reasonable
default, not fixed here), `lockedUntil` is set and further attempts are
refused with the same generic message until it elapses. **The login
error is always exactly**: `"Invalid username or password."` — never
different text for "unknown username" vs "wrong password" vs "account
locked" (a distinct locked-account message would itself leak that the
username exists, so it stays generic too, per phase-brief §17's
explicit instruction). Every attempt, whatever the outcome, writes a
`security_audit_events` row.

---

## 18. Account deactivation

Administrator → `Users` → `Disable`. A disabled account: cannot start a
new login (checked first, before password verify, so a disabled
account never even reaches the "is the password right" branch — no
information leak either way), cannot use an existing session (every
session-validating command re-checks `User.status == "active"`, not
just at login time — §12's reset-triggers-invalidation logic reuses
this same check), gets its active `authenticated_sessions` rows revoked
immediately on disable. **Historical action attribution is
never deleted** — `Approval Record.approvedBy`, `provenance.jsonl`
entries, `security_audit_events` rows all keep referencing the
disabled `User.id`/name exactly as they do today for any other
historical record; disabling a user is reversible (`Enable` restores
login) and never triggers a delete of the user row or anything it's
attributed to.

---

## 19. Role change

Administrator → `Users` → change role (e.g. `chemist` → `quality`).
Effective immediately: `User.role` is updated, a `security_audit_events`
row records old→new role + which admin changed it, and — because
`UserContext.role` is looked up fresh (not cached client-side beyond a
session's lifetime) — every *subsequent* authorization check for that
user's existing session immediately uses the new role. Whether an
*already-open* session must be forcibly re-validated mid-use (vs. just
naturally reflecting the new role on its next command) is a Session 2/4
implementation decision; the safe default recommended here is: the
Rust side resolves role fresh from `users` on every privileged command
(not once at login and cached), so there is no window where a
demoted user keeps old-role access simply because their session token
is still valid. Historical attribution (§18) is unaffected by a role
change — a past approval stays attributed to the person and the role
they held *at the time*, recorded in the `ApprovalRecord` itself
(already true today, unrelated to this phase).

---

## 20. Project/resource access — recommendation

**Recommendation: defer to its own session (proposed Session 4, folded
into "application-wide role enforcement"), do not conflate with the
fixed-role model in this document.** Role answers "what kind of
operations"; project membership answers "on which projects." Given
today's app has *zero* existing project-membership concept (confirmed,
§1), and the phase brief explicitly says "Session 0 must determine
whether FormuLab needs [it]" rather than mandating it — the
recommendation is: ship Session 0-3 (fixed roles, authentication, RBAC
enforcement) with **all-authenticated-users-see-all-projects** as the
Phase 13 baseline (matching today's actual behavior, so nothing
regresses), and treat assigned-project/department-scoped access as a
distinct, explicitly-scoped follow-up once real customers report they
need it — building it speculatively now risks exactly the
over-engineering the phase brief repeatedly warns against. This is
flagged as an open decision for the user to confirm or override, not
silently assumed.

---

## 21. Administration → Users UI

List columns: username, display name, role, department, status, last
login. Row actions: Edit, Change Role, Reset Password, Activate/
Disable, View Security History. `Create User` opens the same field set
as Edit (§5) with role as a plain `<select>` of the six fixed roles —
no permission checkbox grid anywhere in this UI. A separate, read-only
**"Role capabilities"** view (linked from the Create/Edit form, e.g. "What
can a Chemist do?") renders §6's matrix straight from `rolePolicy.ts`
(§7) — informational only, no edit controls, so IT can understand a
role without ever being tempted to hand-tune it.

---

## 22. Role capability descriptions (human-readable, for the UI and admin docs)

- **Researcher** — Early-stage/experimental work: browse and start
  projects, view formulation/lab/stability/regulatory content, no
  editing or approval authority.
- **Chemist** — Formulation and laboratory development: create/edit
  formulations, trials, test methods; can grant `pilot_approved`
  (matches `APPROVAL_AUTHORITY` today).
- **Quality** — Quality review and approval: can grant both
  `pilot_approved` and `production_approved`; creates/edits lab and
  stability records for QA purposes.
- **Regulatory** — Regulatory review and verification: owns the
  regulatory dossier/claims/labels workflow; can grant
  `production_approved`.
- **Production** — Production-facing access: view across the
  formulation/lab/regulatory chain, create/edit laboratory records
  relevant to manufacturing handoff, can grant `production_approved`.
- **Administrator** — User and system administration: full user
  lifecycle, security history, application settings; deliberately
  **not** a scientific-content editor (view-only across
  Formulation/Laboratory/Stability/Optimization) — see §6.1 for why it
  still carries approval authority on both gates.

These mirror `APPROVAL_AUTHORITY`/current domain reality where one
already exists (approval gates); everything else is this session's
first proposal, explicitly flagged for domain-expert review (§ Risks).

---

## 23. Offline operation

No requirement in this design touches the network. `bootstrap`,
`login`, password verify/reset, session validation, and every RBAC
check are Rust-side, local-SQLite-backed operations. No FormuLab cloud,
no email provider, no SMS provider, no external OAuth, no public
identity service — none exist today (§1) and none are introduced by
this design. A standalone, air-gapped workstation is a fully supported
deployment, not a degraded one.

---

## 24. Multi-workstation architecture

**Model A — Standalone workstation** (Phase 13's initial target,
Sessions 0-7): each installation's `identity.db` is authoritative for
that machine only. IT creates users locally per workstation. Fits
today's single-machine desktop-app architecture with zero new
infrastructure.

**Model B — Company-local shared identity** (explicitly a *future*
upgrade path, not built in Phase 13): a company-run, on-premise/
local-network identity service multiple FormuLab installations point
at, so IT creates a user once, not per-machine. Must never require a
public cloud service (matches §23). Recommended shape when it's
actually needed: keep `identity.db`'s schema/API-shape stable enough
that a later "remote identity backend" implementation can satisfy the
same `login`/`bootstrap_status`/user-management command surface without
changing anything above the Rust command layer — i.e., design the Tauri
command boundary now so Model B is a swappable *implementation* behind
it later, not a rewrite. Not designed further here — building Model B
without a concrete customer need would be exactly the over-engineering
the phase brief warns against.

---

## 25. Audit logging

`security_audit_events` records: login success, login failure, logout,
account creation, account disable, account enable, password reset,
password change (self-service, post-`mustChangePassword`), role
change, account lock, account unlock, permission denied (a role check
that failed — valuable for spotting probing/misconfiguration), every
privileged administrator action (user create/edit, role change,
reset, enable/disable). Each row: timestamp, actor user id, target
user/resource (nullable), action, outcome, and workstation/device
context where meaningful (§15's note — mostly unused under Model A).
**Never** recorded: plaintext password, password hash, API key,
session secret/token value (the session *id* may be logged for
correlation; the value an attacker could replay never is).

---

## 26. Security test matrix

See `docs/PHASE13_SECURITY_TEST_MATRIX.md` (companion document — full
enumerated test list, one test class per phase-brief §26 category).

---

## 27. Proposed Phase 13 sessions

1. **Session 1** — User database + migrations (`identity.db`, `users`,
   `authenticated_sessions`, `login_attempts`, `security_audit_events`)
   + Argon2id password subsystem + SQL-injection regression tests for
   every new query.
2. **Session 2** — Administrator bootstrap screen + `login`/`logout`
   Tauri commands + authenticated session lifecycle (creation,
   persistence across restarts, expiration/idle timeout).
3. **Session 3** — `rolePolicy.ts` (canonical `can()`) + wire
   `UserContext` through the app (React context/provider) + parity
   test between the TS policy and whatever Rust-side mirror Session 3
   settles on.
4. **Session 4** — Application-wide enforcement: every Tauri command
   that performs a role-gated action resolves role server-side and
   calls `can()`; every nav/button in the frontend uses the same
   `can()` for visibility. Project/resource access decision from §20
   revisited here if a concrete need has surfaced.
5. **Session 5** — `Administration → Users` UI: list, create, edit,
   role change, reset password, activate/disable, security-history
   view, read-only role-capabilities view.
6. **Session 6** — Brute-force/lockout, full audit-event coverage,
   the complete SQL-injection + privilege-escalation regression suite
   (§17/§26).
7. **Session 7** — Native Windows multi-user acceptance testing,
   full security regression pass, Phase 13 closure documentation.

Sessions may be re-scoped if implementation reveals a safer/shorter
path — this order is a recommendation, not a contract.

---

## Risks and open decisions (explicit, not silently resolved)

1. **§6's matrix beyond the Approval rows is this session's first
   draft**, built from current navigation/routes, not signed off by a
   lab/QA/regulatory domain expert. Must be reviewed before Session 4
   wires enforcement against it.
2. **§6.1 — should Administrator really keep approval authority?**
   Inherited from existing `APPROVAL_AUTHORITY` to avoid weakening
   current enforcement; flagged for an explicit human decision rather
   than silently accepted as "obviously right."
3. **§20 — project/resource access deferred.** If real customer
   deployments need per-project restriction sooner than expected, this
   pushes into Session 4's scope earlier than planned.
4. **§10 — exact Argon2id parameters** (memory/iterations/parallelism)
   are a Session 1 decision against real hardware constraints
   (standalone Windows workstations, possibly modest specs), not fixed
   here.
5. **§17 — exact lockout threshold/backoff curve** is a Session 6
   usability/security tradeoff, not fixed here.
6. **§24 Model B** is explicitly out of scope for Phase 13's
   implementation sessions — only its *influence on the command-boundary
   shape* is considered now, so it doesn't require a rewrite later.
