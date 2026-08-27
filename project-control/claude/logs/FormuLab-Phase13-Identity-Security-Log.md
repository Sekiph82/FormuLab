# FormuLab Phase 13 — Enterprise Identity, Authentication, Fixed RBAC & Application Security — External Log

Active external log for Phase 13, on the Desktop, outside the git
repository — this project's standing per-phase convention (see Phase
12's own log for the precedent). A new, separate log for Phase 13,
not a reuse or rename of `FormuLab-Phase12-Commercial-Distribution-Log.md`.
Never moved into the repository, never renamed.

---

## Session 0 — Architecture + security/current-state audit (2026-08-07)

### Scope

Session 0 per the phase brief: architecture and evidence gathering
only. No authentication system implemented. Deliverables: current
audit, fixed six-role architecture + permission matrix, canonical
authorization design, user/database schema design, password/session
design, SQL-injection assessment, brute-force design, audit
architecture, Administration UI design, standalone-vs-company-local
identity model recommendation, implementation session plan, risks/open
decisions.

### 1. Current authentication/authorization audit

Inspected: `packages/shared/src/schemas/status.ts` (Actor/ApprovalRole/
APPROVAL_AUTHORITY/canTransitionTo), every regulatory/approval-related
engine file under `packages/shared/src/engine/`, every frontend site
constructing an `Actor` (`FormulasPage.tsx`, `useFormulationWorkspace.ts`,
`ApprovalPanel.tsx`, `ClaimsLabelsPanel.tsx`, `CorrectiveActionsPanel.tsx`,
`DoePanel.tsx`, `DossierPanel.tsx`, `RegulatoryPanel.tsx`,
`StabilityPanel.tsx`, `TrialsPanel.tsx`, `TestMethodDrawer.tsx`),
`apps/desktop/src-tauri/src/formulations.rs`'s `save_approval_record`,
`apps/desktop/src-tauri/capabilities/default.json`,
`apps/desktop/src/app/routes/AdministrationPage.tsx`, `SECURITY.md`,
every `rusqlite` call site in `src-tauri/src` (only `runs_index.rs` —
a disposable run-index cache, not an identity store), and every Rust
file for `password`/`login`/`authenticate` tokens (3 matches, all
confirmed unrelated: SSH host-alias parsing in `compute.rs`, Modal.com
API auth status in `modal.rs`, incidental "login" substring in a
`runs.rs` test string).

**Result: nothing today implements authentication.** Full
capability-by-capability classification table (IMPLEMENTED/PARTIAL/
MISSING/UNSAFE/NOT_APPLICABLE) recorded in
`docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` §1. Headline findings:

- **UNSAFE**: `reviewerRole`/`actorRole`/`actingRole` are plain
  `useState<ApprovalRole>` values bound to a freely-editable `<select>`
  — self-reported, unauthenticated, exactly the "reviewerRole
  dropdown" attack the phase brief names by example. The paired
  `userId`/`reviewerUserId` is free text defaulting to `"local"`.
- **UNSAFE**: `save_approval_record` (Tauri command, Rust) checks only
  that `approvedBy` is non-empty and not a machine-actor name (`"ai"`,
  `"system"`, etc.) — it performs no role check whatsoever. A direct
  `invoke("save_approval_record", {...})` call, bypassing the React
  UI and its `canTransitionTo` call entirely, writes a permanent,
  valid-looking approval record with any name and no role gate. This
  is a real, currently-exploitable bypass, confirmed by reading the
  Rust source directly, not inferred.
- **PARTIAL, valuable, preserved**: `canTransitionTo`/`APPROVAL_AUTHORITY`
  in `status.ts` already correctly refuse any non-human `Actor.kind`
  from reaching `pilot_approved`/`production_approved`, and already
  gate those transitions by role — real, tested, working
  authorization logic. The only gap is that nothing today makes
  `Actor.role` trustworthy. This logic is explicitly preserved
  unchanged by the Phase 13 design — the fix adds a real identity
  layer underneath it, it does not touch or weaken the logic itself.
- **MISSING, confirmed present already as a type**: the six required
  roles (`researcher`, `chemist`, `quality`, `regulatory`,
  `production`, `administrator`) already exist verbatim as
  `APPROVAL_ROLES` in `status.ts` — no schema correction needed, per
  the phase brief's own "preserve unless the audit proves a necessary
  correction" instruction. Nothing proved a correction necessary.
- Explicitly confirmed **NOT REQUIRED** and absent (correctly):
  public registration, email verification, SMS/phone verification,
  social login, email-based password recovery, consumer account
  creation.

### 2. User entity, username rules, roles, matrix, canonical policy design

Full design in `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md`
§§2-9. Summary:

- **User entity**: id, username + normalized username, display name,
  Argon2id password hash, role (reuses `ApprovalRole`, not a new
  type), status, department/employee-id (optional), created/updated/
  last-login timestamps, created-by, must-change-password flag,
  failed-login count, locked-until. No email, no phone required.
- **Username rules**: 3-64 chars, ASCII letters/digits/`.`/`_`/`-`,
  case-insensitive uniqueness on a normalized (NFC-then-lowercased)
  form, no email-format requirement (`lab01`, `chemist03`,
  `quality.manager` all valid), internal whitespace rejected not
  stripped.
- **Bootstrap**: fresh install → no administrator exists →
  Administrator Setup screen (not Login) → creates the first admin →
  bootstrap Tauri command then permanently refuses to create a second
  bootstrap administrator, checked server-side (Rust), not just
  UI-hidden. No default credentials ever seeded — `admin/admin` and
  equivalents are permanently absent.
- **Fixed role-permission matrix**: full table across Home, Projects,
  Formulation, Laboratory, Stability, Optimization, Regulatory,
  Approval (both gates), Reports, Administration (Users/Security/
  Settings), Data Exchange — view/create/edit/delete/submit/approve/
  reject/verify/supersede/export/administer per role. The two Approval
  rows are pulled directly from the existing, working
  `APPROVAL_AUTHORITY` — not redefined — to guarantee they can never
  drift from current enforcement. Everything else is this session's
  first draft against current navigation, explicitly flagged as
  needing a real domain-expert review before Session 4 enforces it.
- **Administrator authority decision (explicit)**: Administrator does
  **not** get create/edit authority over scientific content
  (Formulation/Laboratory/Stability/Optimization — view-only), but
  **does** retain `pilot_approved`/`production_approved` approval
  authority, because that's what `APPROVAL_AUTHORITY` already grants
  today and removing it would be *weakening* existing enforcement —
  forbidden by the phase brief. Flagged as an explicit open decision
  for human sign-off, not silently accepted as obviously correct.
- **Canonical authorization source**: one new module,
  `packages/shared/src/engine/rolePolicy.ts` (Session 3), exposing a
  single `can(role, area, capability)` function that every consumer —
  frontend nav/buttons, Rust command guards, tests — calls. Imports
  `APPROVAL_AUTHORITY` rather than duplicating it, so the approval
  rows structurally cannot drift from `status.ts`.

### 3. Password, session, database design

- **Argon2id** via the `argon2` Rust crate — no existing password-
  hashing dependency in this codebase to be compatible with, so
  Argon2id (the current mature default recommendation) is chosen on
  its own merits, not for compatibility. Exact parameters deferred to
  Session 1 against real hardware constraints.
- **Session context**: `{userId, username, displayName, role,
  sessionId, accountStatus}` — no persisted `permissions` array;
  permissions are derived on demand via `can(role, ...)`, per the
  phase's own "fixed roles, no per-user overrides" requirement. No
  `role_permissions`/`user_permission_overrides` tables — deliberately
  not built, since the business requirement doesn't need them, per
  explicit instruction not to over-engineer.
- **Database**: new, dedicated `identity.db` (not shared with
  `runs.db` or any `.formulab-backup` content), tables: `users`,
  `authenticated_sessions`, `login_attempts`, `security_audit_events`.
  No `roles` table (fixed application policy, not database rows). Uses
  the existing `migration.rs` framework rather than inventing a new
  migration mechanism.

### 4. SQL injection, brute-force, audit design

- Confirmed **zero current SQL string-concatenation** anywhere in
  `src-tauri/src` (the only `rusqlite` usage, `runs_index.rs`, is
  fully parameterized) — the new identity queries must hold the same
  standard as a hard requirement. Full hostile-input test class list
  (quotes, SQL-comment sequences, boolean-injection shapes, Unicode
  edge cases, excessive length, unusual whitespace) recorded in
  `docs/PHASE13_SECURITY_TEST_MATRIX.md` §D — tests run only against
  disposable temp databases, never real user data.
- **Brute-force**: every login attempt recorded; failure count +
  threshold-triggered temporary lock; the login error is always the
  literal, generic `"Invalid username or password."` — never a
  different message for unknown-username vs. wrong-password vs.
  locked, so no username-enumeration or lockout signal leaks.
- **Audit**: `security_audit_events` records every login/logout/
  account-lifecycle/role-change/lock-unlock/permission-denied/
  privileged-admin-action event, with actor, target, action, outcome,
  timestamp — never a plaintext password, hash, API key, or session
  secret value.

### 5. Project/resource access — recommendation

No project-membership concept exists today (confirmed, zero matches
for `projectAccess`/`ProjectMember`/etc. anywhere in the codebase).
Recommendation: defer to a later, dedicated session (folded into
proposed Session 4 if a concrete need surfaces sooner) rather than
build it speculatively now — ship the fixed-role model first with
today's actual behavior (all authenticated users see all projects) as
the Phase 13 baseline, so nothing regresses, and revisit only once a
real customer need is confirmed.

### 6. Administration UI, offline operation, multi-workstation model

- `AdministrationPage.tsx` already exists (currently
  `overview`/`testDefinitions` sections only) — Session 5 extends it
  with a `Users` section (list/create/edit/role-change/reset-password/
  activate-disable/security-history, plus a read-only "role
  capabilities" view rendered straight from `rolePolicy.ts`) rather
  than building a new page from scratch.
- Every part of this design is local-only — no network dependency
  anywhere in login/bootstrap/password-verify/session-validation/RBAC
  checks. Confirmed by design, not just by absence of counter-evidence.
- **Model A (standalone workstation)** is Phase 13's initial target —
  each install's `identity.db` is authoritative for that machine.
  **Model B (company-local shared identity)** is an explicitly
  future, not-built-now upgrade path; only the Tauri command-boundary
  shape is chosen now so Model B can later be a swappable
  implementation behind the same commands, avoiding a rewrite —
  building the actual shared-identity service now would be exactly
  the over-engineering the phase brief warns against.

### Deliverables produced this session

- `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` (new)
- `docs/PHASE13_SECURITY_TEST_MATRIX.md` (new)
- `docs/handoffs/PHASE13_CURRENT.md` (new)
- `docs/architecture/IMPLEMENTATION_STATUS.md` (updated — new Phase 13
  Session 0 section)
- This external log (new)

### Not done this session (by design)

No `users`/`authenticated_sessions`/`security_audit_events` tables, no
login/bootstrap screens, no `argon2` dependency added, no
`Administration → Users` UI, no enforcement wired into any command or
component, no change to `status.ts`/`canTransitionTo`/
`APPROVAL_AUTHORITY`/any regulatory engine file. Confirmed via `git
diff` that no source code changed this session — documentation only.

### Git discipline

Session 0 committed as architecture/audit/documentation only, per
instruction — no application code changed. No force push, no history
rewrite, no tag modification.

### Open decisions requiring human sign-off before Session 4

1. Is the full role-permission matrix (beyond the pre-existing
   Approval rows) correct for a real lab/QA/regulatory workflow? —
   this session's first draft, not domain-expert-reviewed.
2. Should Administrator really retain approval authority on both
   gates? Currently inherited from existing `APPROVAL_AUTHORITY` to
   avoid weakening current enforcement — flagged, not silently
   decided either way.
3. Does project/resource access belong in Phase 13's initial scope?
   Recommendation: no, defer.

### Exact next session

**Phase 13 Session 1: User database + migrations + password
subsystem.** Build `identity.db` and its four tables via the existing
`migration.rs` framework, add the `argon2` crate, implement the
password-hashing subsystem, and write the full SQL-injection
regression suite against every new query before any UI work begins.

---

## Session 1 — User database, identity migrations, password security, final 12-role model, workflow foundation (2026-08-07)

### The role model changed, authoritatively, mid-phase

The user reviewed the real FormuLab dossier/evidence/document workflow
and replaced Session 0's 6-role draft with a final, authoritative
**12-role** model:

R&D/Lab: `researcher`, `research_manager`
Quality: `quality`, `quality_manager`
Regulatory: `regulatory`
Materials/Supply: `raw_material`, `procurement`
Production: `production_engineering`, `production`, `production_manager`
Document Management: `document_control`
System: `administrator`

`chemist` was folded into `researcher`. `quality`/`production` each
split into an employee tier (does the work) and a manager tier (the
only tier that can approve/reject at a required gate). No `packaging`
role — packaging-related work maps onto the existing roles based on
current app behavior. Full role intent (business meaning per role):
architecture doc §1.1.

### Full codebase correction — every "6 roles" reference found and fixed

Before touching the identity database, every place the old 6-role
vocabulary was referenced had to be found and corrected, so
`identity.db` (new, 12 roles) and the TypeScript domain layer (old, 6
roles) would never disagree, even temporarily:

- **`packages/shared/src/schemas/status.ts`** — `APPROVAL_ROLES`
  expanded to the 12 roles; `APPROVAL_AUTHORITY` re-derived (see
  below, not blindly carried forward).
- **`packages/shared/src/engine/laboratoryStandards.ts`** —
  `LABORATORY_METHOD_MANAGER_ROLES` ("gated the same way as
  `pilot_approved`" per its own doc comment): `["chemist", "quality",
  "administrator"]` → `["research_manager", "quality_manager",
  "administrator"]`, including its thrown-error message text.
- **`packages/shared/src/engine/dataExchangeRegistry.ts`** — 5 per-
  template role-list constants (`FORMULATION_ROLES`, `COST_ROLES`,
  `LAB_ROLES`, `DRAFT_CONTENT_ROLES`, `DOE_ROLES`) had `"chemist"`
  replaced with `"researcher"` — a mechanical fix, not an authority
  redesign (these gate day-to-day data-exchange actions, not approval
  gates).
- **13 frontend sites** — every hardcoded `role: "chemist"` actor
  (`FormulasPage.tsx`, `CorrectiveActionsPanel.tsx`,
  `StabilityPanel.tsx`, `TrialsPanel.tsx`,
  `useFormulationWorkspace.ts` ×2) changed to `"researcher"`; every
  `useState<ApprovalRole>("chemist")` default
  (`ApprovalPanel.tsx`'s `reviewerRole`,
  `TestMethodDrawer.tsx`'s `actingRole`) changed to
  `"research_manager"` (the correct default for those approval-
  adjacent contexts). Every `<select>` built by mapping over
  `APPROVAL_ROLES` (`ApprovalPanel`, `ClaimsLabelsPanel`, `DoePanel`,
  `DossierPanel`, `RegulatoryPanel`, `TestMethodDrawer`,
  `DataExchangePage`) needed **no code change at all** — they render
  whatever `APPROVAL_ROLES` contains, so they picked up all 12 roles
  automatically once the constant changed.
- **i18n**: `en/session.json`'s two `disabledReason`/
  `createInternalHiddenReason` strings and `en/help.json`'s three
  stale current-tense role claims (a "roleNotes" line, an
  "approvalRole" glossary definition, and a "limitations" line
  mentioning "a chemist") corrected. Other 7 locales not updated this
  session — flagged as a known gap (same as this project's existing,
  documented i18n-gap convention: an English fallback beats a missing
  key; a stale-but-readable translation in another locale is a real,
  disclosed limitation, not silently claimed as fixed).
- **~18 test files** (`packages/shared` + `apps/desktop`) — roughly 30
  individual role references. Most were mechanical (`"chemist"` →
  `"researcher"` for a generic non-privileged-actor test constant,
  consolidating with an existing `RESEARCHER_ACTOR` constant where one
  already existed in the same file rather than creating a duplicate).
  4 tests were **not** mechanical — they previously asserted `chemist`/
  `quality` *could* grant `pilot_approved`/`production_approved`; these
  were rewritten to assert `research_manager`/`quality_manager` can,
  **and** a new explicit test was added asserting the employee-tier
  role (`researcher`/`quality`) is refused `ROLE_NOT_AUTHORIZED` even
  with a valid approval record — the exact role-model-regression
  coverage the phase brief required, not just an incidental side
  effect of the rename.

Verification after every source/test change: `packages/shared`
typecheck clean, `apps/desktop` typecheck clean, `packages/shared`
test suite 1254/1254 passing (4 failures found and fixed mid-session —
see below), `apps/desktop` test suite 1173/1173 passing (1 failure
found and fixed — see below), `eslint` clean on every touched frontend
file.

**4 real, expected shared-package test failures found and fixed**:
`approvalReadiness.test.ts`, `lifecycle.test.ts` (×2 assertions), and
`versioning.test.ts` all had tests asserting plain `quality` could
grant `production_approved` — correctly failing once
`APPROVAL_AUTHORITY` moved that authority to `quality_manager`. Fixed
by renaming/adding `QUALITY_MANAGER` actors in the first three, and by
adding a **new** test to `versioning.test.ts`
("role-model regression: the employee-tier 'quality' role does not
inherit its manager's production approval") rather than just editing
the existing one, so the exact regression is now explicitly asserted,
not merely no-longer-broken by omission.

**1 real desktop test failure found and fixed**:
`TestMethodDrawer.test.tsx` asserted an old, hardcoded English string
("Only chemist, quality or administrator roles may create an internal
method") that was itself sourced from the i18n key this session
updated — fixed by updating the test's expected string to match the
corrected i18n text, and renaming a test description
("an authorized chemist sees..." → "an authorized research manager
sees...").

### `APPROVAL_AUTHORITY` re-derivation (audited, not blindly carried forward)

Per explicit instruction: `pilot_approved` (old:
`chemist, quality, administrator`) → `research_manager,
quality_manager, administrator` (chemist folded into researcher, but
pilot approval was always a manager-tier decision; plain `quality`
removed — that authority belongs to `quality_manager` only now).
`production_approved` (old: `quality, regulatory, production,
administrator`) → `quality_manager, regulatory, production_manager,
administrator` (regulatory unchanged, kept as one fixed role).
`retired`/`rejected` — same manager-tier substitution.
`administrator` retains authority on every gate, unchanged — the
explicit, user-approved exception so IT can exercise/test every
workflow gate. Full derivation: architecture doc §6.2.

### Identity database — implemented, tested, not yet wired to any command

**Path**: `app_private_dir(app, "identity").join("identity.db")` —
reuses `backup.rs`'s existing `app_private_dir` helper
(`app.path().app_data_dir()/identity/identity.db`). Deliberately not
`.FormuLab/runs.db` (lives inside the relocatable data root — identity
should not move when a user relocates their formulation data), not
any formulation/lab/project/session data, not any `.formulab-backup`
payload.

**Tables**: `users` (id, username, normalized_username UNIQUE,
display_name, password_hash, role, status, department,
employee_reference, must_change_password, failed_login_count,
locked_until, created_at, created_by, updated_at, last_login_at),
`authenticated_sessions`, `login_attempts`, `security_audit_events`.
No `roles` table (fixed application policy, not database rows). No
`permissions`/`role_permissions`/`user_permission_overrides` tables —
confirmed unnecessary given the fixed-role business requirement.

**Migrations**: `migration.rs` (the existing framework) was evaluated
and **not** reused — it tracks data-root JSON-format schema
compatibility, a different concern from SQL DDL evolution inside one
SQLite file. Used SQLite's own native `PRAGMA user_version` instead: a
`MIGRATIONS: &[&str]` array of versioned SQL batches, applied in order,
tracked by the file's own `user_version` pragma — no separate
bookkeeping table, no risk of the tracker and the real schema
disagreeing. Tested idempotent: seed a user, reopen the same database
file, confirm the schema version and the seeded row both survive
unchanged.

**Username policy**: 3-64 chars, ASCII letters/digits/`.`/`_`/`-`
only, no internal whitespace, case-insensitive uniqueness via a real
database `UNIQUE` constraint (not just an app-level check — tested: a
username differing only by case is refused by the constraint itself).
NFC/Unicode normalization, anticipated in the Session 0 design, turned
out to be unnecessary in the actual implementation — the ASCII-only
charset already rejects every input that would need it, so no extra
dependency was added for it.

**Password security**: Argon2id via the `argon2` crate (0.5) +
`rand_core` (0.6, explicit `getrandom` feature enabled — off by
default, required for `OsRng`). PHC-string encoded output (one
self-describing string; no separate salt/algorithm columns).
Crate-default parameters (not hand-tuned against specific hardware
this session). Tested: correct password verifies, wrong password is
rejected; two hashes of the identical password use different random
salts (both still verify); the plaintext password never appears
inside its own stored hash; a 1MB password hashes/verifies without
panicking; a malformed stored hash fails verification cleanly instead
of panicking.

**Repository primitives** (all parameterized via `rusqlite`'s
`params![...]`, never string-concatenated): `create_user`,
`find_user_by_normalized_username`, `find_user_by_id`,
`update_password_hash`, `update_account_status` (disabling revokes
every open session immediately — tested), `update_role` (effective
immediately — tested), `update_login_state` (failure counter +
threshold-triggered lockout — tested with threshold=5: 4 failures
unlocked, 5th locks, success fully resets), `record_login_attempt`,
`create_session`/`validate_session` (expiry + revocation + account-
status checked fresh on every call, never cached), and
`record_security_audit_event` (tested to never contain the seeded
user's actual password hash in its `detail` field).

**SQL injection**: a dedicated hostile-string regression test feeds
`admin'--`, `' OR '1'='1`, `'; DROP TABLE users;--`, a boolean-
injection username matching a real seeded user, mixed quote
characters, an inline SQL comment, a `#` marker, an RTL-override
Unicode string, and a zero-width-joiner Unicode string — asserting
each is either rejected by validation outright or stored as a
completely inert literal, never a query bypass; the real `users` table
and the seeded victim row are confirmed unaffected afterward, and a
classic boolean-injection lookup (`' OR '1'='1`) is confirmed to match
nothing. Separately tested: 10,000-char username rejected, unusual
whitespace (tab/non-breaking-space/newline) rejected. All against
disposable temp databases only.

### Workflow foundation architecture (designed this session, not enforced)

Per explicit instruction, four distinct authorization concepts are now
documented as structurally separate (architecture doc §14):
**visibility** (all authenticated users see all projects — confirmed
out of scope to restrict in Phase 13, no longer just "recommended"),
**role capability** (§6's matrix — what a role may ever do),
**workflow state** (is the record at a stage where the action is
allowed), and **required approval/gate** (have upstream approvals
actually completed). An action is authorized only when all four pass;
"work completed" and "manager approved" are explicitly different
states — a worker's own completion can never satisfy their manager's
required approval, by design, not just by convention.

A proposed canonical workflow matrix (who works / who approves / what
unlocks next / what happens on rejection / what stays blocked) was
produced for every major domain (Formulation, Laboratory, Stability,
Raw materials, Supplier/procurement docs, Quality, Regulatory,
Dossier/evidence, Production engineering, Production, Production
approval/release, Document control) — architecture doc §15.3. **4
gaps explicitly marked, not silently assumed solved**: raw-material
verification, supplier-document verification, production-engineering→
production-manager approval, and production→production-manager
approval have no corresponding `FormulaStatus`/gate in the current
domain model at all — real, unimplemented future work, sequencing
deferred to Session 4 or a dedicated workflow session.

### Administrator authority — reconfirmed, not re-decided

Per explicit user instruction: Administrator does not get create/edit
authority over scientific content (view-only across Formulation/
Laboratory/Stability/Optimization/Regulatory/Production in §6's
matrix) but does retain approval authority on both `pilot_approved`
and `production_approved` — inherited from the existing, working
`APPROVAL_AUTHORITY` (not weakening current enforcement) and now
explicitly named as a deliberate, user-approved exception so IT can
exercise/test every workflow gate, not an accidental carryover.

### Project visibility — confirmed out of scope (not just recommended)

Session 0 recommended deferring project/resource ACLs; this session's
brief explicitly confirmed it: all authenticated users may see all
projects in Phase 13, and no project memberships/ACLs/department ACLs
are built. Visibility does not grant modification authority — every
action stays gated by role + workflow state + required approvals
regardless.

### Verification

`cargo build --lib`: clean. `cargo test --lib identity`: 28/28
passing. `cargo test --lib` (full crate): 216/216 passing (188
pre-existing + 28 new), confirming nothing else regressed. `cargo
clippy --lib -- -D warnings`: clean. `packages/shared`: `tsc --noEmit`
clean, `vitest run` 1254/1254 (61/61 files) after fixing the 4 role-
authority test failures described above. `apps/desktop`: `tsc --noEmit`
clean, `vitest run` 1173/1173 (131/131 files) after fixing the 1
TestMethodDrawer failure, `eslint` clean on every touched file. `git
diff --check`: clean.

### Closure

Files changed: `apps/desktop/src-tauri/src/identity.rs` (new, ~650
lines incl. tests), `Cargo.toml`/`Cargo.lock` (added `argon2`,
`rand_core`), `lib.rs` (module registration),
`packages/shared/src/schemas/status.ts`,
`packages/shared/src/engine/{laboratoryStandards,dataExchangeRegistry}.ts`,
13 frontend files, 2 i18n files, ~18 test files, 4 Phase 13 docs.
37 files total. Committed `d7998ca` on `feature/laboratory-stability`,
pushed to `origin/feature/laboratory-stability` (`c605a3e..d7998ca`,
fast-forward). No main sync (not requested).

---

## Session 1 closure addendum — USER-APPROVED Production Manager workflow-gate decision

Follow-up to the entry above, same session number (Session 1 closure,
not a new session). The user resolved the four workflow gaps Session 1
left open in the architecture doc's §15.3 first-draft workflow matrix.

**Decision**: all four gates are approved by `production_manager` —
one explicit product decision, not four independent ones:

1. Raw material verification — worker `raw_material`, approver
   `production_manager`.
2. Supplier document verification — worker `procurement`, approver
   `production_manager`.
3. Production Engineering → downstream production handoff — worker
   `production_engineering`, approver `production_manager`.
4. Production completion / production release — worker `production`,
   approver `production_manager`.

In every case, worker completion is explicitly **not** equivalent to
the manager gate passing — the same "work completed ≠ manager
approved" rule already governing `research_manager`/`quality_manager`
now applies identically here. No worker role (`raw_material`,
`procurement`, `production_engineering`, `production`) gained any new
approval capability. `administrator` keeps its existing, user-approved
broad testing/approval authority and can exercise all four once
implemented — this decision changes nothing about administrator's
authority, it only assigns the new gates' authority to
`production_manager`.

**Explicitly preserved, not touched by this decision**: Research/
Laboratory work still gates through `research_manager`; Quality work
still gates through `quality_manager`; `regulatory` keeps its own
independent, unsplit authority. This decision resolves only the four
listed gates, not a general handover of approval authority to
`production_manager`.

**Files changed** (documentation only):
`docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` (new §15.4, updated
§15.3 table/gap paragraph, updated §1.1 role-intent bullets for
`raw_material`/`procurement`/`production_engineering`/`production`/
`production_manager`, updated Risks item 4, updated status
header/session-plan line), `docs/PHASE13_SECURITY_TEST_MATRIX.md`
(closure note, future-test shape for when these gates get real
enforcement), `docs/handoffs/PHASE13_CURRENT.md` (closure addendum,
resolved the corresponding open-decision item), and
`docs/architecture/IMPLEMENTATION_STATUS.md` (Phase 13 section updated
with the closure note).

**Whether any code changed**: **No.** No `FormulaStatus`/gate exists
yet for any of the four gates — this decision fixes *who* will approve
once the gate is implemented, it does not implement the gate. Verified:
`APPROVAL_AUTHORITY` in `status.ts` is keyed by `FormulaStatus`, and
none of the four gates has one, so there was nothing to edit there;
`identity::Role`/the 12-role enum in `identity.rs` is unchanged (no new
role, no changed variant); `git diff` for this closure touches only the
4 doc files above.

**Verification performed** (proportional to a documentation-only
change, per explicit instruction not to run unrelated giant suites):
grepped all 4 updated docs for stale "six role(s)" phrasing (none
found — the only `role_permissions`/`user_permission_overrides` hits
are pre-existing "these tables don't exist" statements, not six-role
leftovers); grepped for `packaging` (only the existing "no packaging
role was created" statement, unchanged); confirmed
`identity.rs`'s `Role` enum still has exactly the 12 variants,
`Researcher`/`ResearchManager`, `QualityManager`, `ProductionManager`
distinct and unchanged; confirmed `git status --porcelain` shows only
the 4 intended doc files plus the pre-existing, out-of-scope
`docs/generated/*` and `formulas/*` local changes untouched. No
Rust/TypeScript source changed, so no typecheck/test/clippy/lint run
was required or performed for this closure.

**Final commit SHA**: `cc5b944` on `feature/laboratory-stability`.

**Push result**: succeeded, `d7998ca..cc5b944`, fast-forward, to
`origin/feature/laboratory-stability`. No main sync (not requested).

**Exact next session**: **Phase 13 Session 2: Administrator bootstrap +
username/password login/logout + authenticated session lifecycle**,
using the canonical 12-role identity model and the now-finalized
manager-gated workflow architecture (including the four
`production_manager` gates decided in this closure). Wires
`identity.rs`'s primitives to real Tauri commands (`bootstrap_status`,
a bootstrap-create command, `login`, `logout`), decides the exact
lockout threshold/backoff and session idle-timeout policy, and builds
the Login/Administrator-Setup screens. Still no `Administration →
Users` UI (Session 5) and no application-wide role enforcement
(Session 4).

---

## Session 2 — Administrator bootstrap, username/password login/logout, authenticated session lifecycle

Starting HEAD: `cc5b944` (Session 1 closure), confirmed matching
`origin/feature/laboratory-stability` before any change was made.
Scope, per the session brief: wire `identity.rs`'s Session 1 storage
primitives to real Tauri commands and a real UI, decide the final
lockout/session policy, gate the whole application behind
authentication at startup. Explicitly out of scope this session:
`Administration → Users`, `rolePolicy.ts`, application-wide role
enforcement, the full workflow engine — all confirmed still out after
this session too.

### Rust: `auth.rs` (new) + `identity.rs` extensions

New file `apps/desktop/src-tauri/src/auth.rs` owns the actual
login/bootstrap/lockout/session policy Session 1 deliberately left as
caller-supplied parameters: `LOGIN_LOCKOUT_THRESHOLD = 5`,
`LOGIN_LOCKOUT_SECS = 900` (15 min), `SESSION_TTL_SECS = 43200` (12h),
`SESSION_IDLE_TIMEOUT_SECS = 3600` (60 min), and the one generic public
error string, `"Invalid username or password."`. Every real decision
lives in a plain function taking `&Connection`/`&mut Connection` (never
an `AppHandle`), directly unit-testable against the same disposable
temp-database pattern `identity.rs` already used — no `tauri::test`
harness needed, matching this codebase's existing convention (e.g.
`backup.rs`) of keeping command wrappers thin and testing the logic
underneath directly. Five Tauri commands, registered in `lib.rs`:
`bootstrap_status`, `bootstrap_create_administrator`, `login`, `logout`,
`current_session`. None has a `role` parameter anywhere in its
signature — there is no code path through which the frontend could
claim to be a particular role; every returned role comes from the
stored `users` row a password check or session-token lookup resolved
to.

`identity.rs` gained: `generate_session_token`/`hash_session_token`
(256-bit random token via `getrandom`, SHA-256 via the already-present
`sha2` dependency — same crate `backup.rs`'s manifest hashing uses);
`create_session` now stores only the hash, returning the raw token to
the caller exactly once, never persisted anywhere; `validate_session`
gained an `idle_timeout_secs` parameter using the previously-unused
`last_seen_at` column (no schema migration — the column already
existed from Session 1's migration 1, just unused for idle-timeout
purposes until now) and now slides `last_seen_at` forward on every
successful check; `revoke_session` (explicit single-session revoke, for
logout — the only revoke primitive Session 1 had was
`update_account_status`'s implicit revoke-everything-on-disable);
`is_locked` (single definition of "locked" used by login, tests, and
future admin UI alike); `any_administrator_exists` (role-keyed, not
row-count-keyed — matches the fixed-role model); `dummy_password_hash`
(a real, cached Argon2id hash of a fixed meaningless constant, used for
timing normalization); `bootstrap_administrator` (the only way
`identity.db` ever gets an Administrator without one already existing —
runs the existence check and the insert inside one `IMMEDIATE`
transaction so two concurrent bootstrap attempts can't both observe
zero administrators and both insert one; clears `must_change_password`
since a bootstrap administrator chose their own password, unlike an
admin-set one). `open_at` and `now_iso` were made `pub(crate)` (from
private) so `auth.rs`'s tests could build the same kind of disposable
temp database and construct deterministic past/future timestamps
without a real `sleep`.

**Login flow** (`auth::login_logic`): normalize username → look up user
→ check account status → check lockout → verify Argon2id password →
update login state → record the attempt → on success, create a session
and return a safe `AuthSession`. Every failure shape (unknown username,
malformed username, disabled account, locked account, wrong password,
oversized input) returns the identical public string — verified by a
direct `===` equality assertion between the unknown-username and
wrong-password error values, not just "similarly worded." Internally,
`login_attempts`/`security_audit_events` rows do distinguish the real
reason, since those tables are never frontend-visible.

**Timing/enumeration defense**: whenever there's no real password to
check (unknown username, disabled, locked), `login_logic` still calls
`identity::verify_password` against `dummy_password_hash()` and
discards the result — spending the same Argon2id CPU cost as a real
check on every losing path. Not a claim of mathematically constant
timing (impossible to verify in a unit test, and the brief said not to
claim it) — a claim that the same expensive operation runs regardless
of which failure branch is taken. A password over 512 characters is
rejected before touching Argon2 at all, on every path including the
dummy-hash one, so an oversized-password login attempt can't be used to
force disproportionate server-side CPU cost.

**Bootstrap UX decision**: after `bootstrap_create_administrator`
succeeds, the frontend enters FormuLab directly with an authenticated
session, rather than bouncing to a second Login screen for credentials
just typed. Documented as an explicit, considered choice (architecture
doc §5) — rejected the alternative (route to Login) as pure friction
with no security benefit on a local, offline, single-workstation
install.

### Rust tests

`identity.rs`: 10 new tests (38 total, up from Session 1's 28) —
token-hash-not-the-stored-value, token unpredictability across two
sessions, revoke-then-invalid, revoking an unknown token is a no-op
(never an error — logout must never let a caller distinguish "never
valid" from "already logged out"), idle-timeout-before-absolute-expiry
(simulated by writing a stale `last_seen_at` directly, no real sleep),
successful-validation-slides-last-seen-at (this one *does* use a real
1.1s `std::thread::sleep`, since `now_iso()` is second-granularity and
there's no clean way to fake monotonic forward progress otherwise),
`is_locked` reflecting future-vs-past `locked_until`, fresh-database-
has-no-administrator, bootstrap creates the first admin with role
forced + no forced password change, a second bootstrap attempt is
permanently rejected and leaves no partial second user behind.

`auth.rs`: 25 new tests across bootstrap (6), login (6), lockout (3),
session (6), audit (2), security (2) — see
`docs/PHASE13_SECURITY_TEST_MATRIX.md` §H.2 for the full descriptive
list; not duplicated here. Notably: `lockout_state_persists_across_a_database_reopen`
proves lockout is real persisted `users`-row state, not in-memory;
`an_expired_lock_allows_login_attempts_again` forces `locked_until`
into the past directly to prove expiry works without a real 15-minute
wait; `no_audit_row_or_login_attempt_row_ever_contains_a_password_hash_or_raw_session_token`
scans every `security_audit_events.detail` and `login_attempts.outcome`
value after a full bootstrap→login→failed-login→logout sequence and
asserts none contains the stored password hash, the raw bearer token,
or the plaintext test password.

`cargo build --lib`: clean (2 warnings surfaced during development —
unused imports and a genuinely-unused enum variant — both fixed, not
suppressed). `cargo test --lib -- identity:: auth::`: 63/63 passing
(one real bug caught and fixed here: the first version of the combined
audit-coverage test never called a successful `login_logic`, so it
never produced a `login_success` audit row and the test correctly
failed until a real successful login was added to the test's own
sequence). `cargo test --lib` (full crate): 251/251 passing (Session
1's 216 + 35 net new), confirming nothing else in the crate regressed.
`cargo clippy --lib -- -D warnings`: clean.

### Frontend

New: `apps/desktop/src/lib/auth.ts` (thin Tauri bridge, matching
`lib/tauri.ts`'s existing pattern — `isTauri` fallback for plain-browser
`pnpm dev`); `apps/desktop/src/app/providers/AuthProvider.tsx` (the
startup gate + `UserContext`, exposing `useAuth()` — throws outside the
provider on purpose — and `useOptionalAuth()` — returns `null` instead,
see below for why); `apps/desktop/src/components/auth/LoginScreen.tsx`
and `BootstrapScreen.tsx`.

`main.tsx` now wraps `<RouterProvider>` itself in `<AuthProvider>` —
not `AppShell`. This was a deliberate choice over gating inside
`AppShell`/a protected-route wrapper: with `AuthProvider` outside the
router entirely, the routed application (every route, `AppShell`,
`Sidebar`, everything) simply doesn't exist as a React tree until
authentication resolves, so there's no route a direct URL/history
navigation could reach to bypass the gate, and no protected-content
flash to guard against separately.

**A real regression this session caught before it shipped**: the
sidebar's account/logout row initially used the throwing `useAuth()`.
Running the existing (large, pre-Session-13) test suite immediately
broke — this codebase's `renderAt()` test helper
(`apps/desktop/src/test/render.tsx`) mounts `routes`/`AppShell`/`Sidebar`
directly via `RouterProvider`, bypassing `main.tsx`'s real
`AuthProvider` entirely, since it predates Session 13 and was never
meant to exercise the auth gate. Every test using `renderAt()` for
anything that renders the sidebar — a large fraction of the desktop
suite — threw immediately. Two options were considered: (a) make
`renderAt()` itself wrap children in a real or mocked `AuthProvider`,
touching the shared test harness and by extension every test that uses
it; (b) make the sidebar's auth consumption optional so it degrades
gracefully with no ancestor provider. Chose (b) —
`useOptionalAuth()` returns `null` outside a provider, and the sidebar
simply doesn't render the account/logout row when there's no
authenticated context, which is exactly correct behavior for a
component being rendered in isolation. This kept the blast radius to
one new hook and one component, rather than touching the shared harness
hundreds of existing tests depend on.

**A second real finding, also test-caught**: this project's
`src/i18n/parity.test.ts` enforces *exact* key parity across all 8
shipped locales for every namespace — not the "English fallback beats a
missing key" convention Session 1's narrower role-string wording fixes
relied on (those were corrections to *existing* keys' text, not new
keys). Adding the new `session.json` `auth.*` keys to English only
immediately failed parity for `zh-Hans`/`ja`/`es`/`de`/`fr`/`ko`/`tr`
(21 missing keys each). Fixed by writing real translations for all 21
keys in all 7 locales — not by carrying the gap forward as "known,"
since the test suite itself proved that convention doesn't apply here.

### Frontend tests

`apps/desktop/src/app/providers/AuthProvider.test.tsx` (new, 12 tests):
startup routing (fresh install shows Bootstrap not Login/app; configured
install with no session shows Login; a valid persisted token enters the
app directly; an invalid/expired persisted token falls through to Login
and clears the stale `localStorage` entry; no protected content renders
while `bootstrap_status` is still in flight — asserted against a
never-resolving mock promise), login flow (success enters the app and
persists only the token, asserted to not contain the username string;
failure shows the generic error and stays on Login; the Login screen
has no signup/social/email/SMS/forgot-password affordances — queried
and asserted absent by text and by `input[type=email|tel]`), bootstrap
flow (no `<select>` anywhere on the screen; success enters the app as
administrator), logout (clears state + revokes + returns to Login; still
returns to Login even when the backend revoke call itself rejects — an
offline edge case, local state must clear regardless).

`pnpm exec tsc --noEmit`: clean. Full desktop suite
(`pnpm exec vitest run`): first run caught the real i18n-parity failure
above (7 failing locale-parity tests) — fixed, rerun: 1185/1185 passing
(Session 1's 1173 + 12 new), including the Sidebar test files
(20 tests, confirmed unaffected by the `useOptionalAuth()` change).
`pnpm exec eslint` on every touched file: clean. `packages/shared` was
not touched this session, so its own suite was not rerun (still 1254/
1254 from Session 1's last run) — scoped per the instruction not to run
unrelated giant suites without a reason tied to what actually changed.

### Documentation

Updated `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` (§5 bootstrap
and §17 login/lockout rewritten from design to as-implemented, with new
§17.1-§17.5 subsections for the final policy/flow/screens/routing/
UserContext shape; new §9.1 on auth commands never trusting a
caller-supplied role; new §15.5 on session-token hashing; §2's
current-state audit table updated row by row; Risks section updated,
including two new open items — `current_session` not yet called per
privileged action, and the length-only password policy),
`docs/PHASE13_SECURITY_TEST_MATRIX.md` (§A corrected from a plan to a
factual report with a Status column; §D's note on command-layer SQL-
injection coverage updated; new §H with the full Session 2 test
descriptions), `docs/handoffs/PHASE13_CURRENT.md` (full rewrite for
Session 2 closure), `docs/architecture/IMPLEMENTATION_STATUS.md`
(Phase 13 heading and body updated for Sessions 0-2).

### Closure

Files changed: 2 new Rust files (`auth.rs`), 2 modified Rust files
(`identity.rs`, `lib.rs`), 5 new frontend files (`lib/auth.ts`,
`AuthProvider.tsx`, `AuthProvider.test.tsx`, `LoginScreen.tsx`,
`BootstrapScreen.tsx`), 3 modified frontend files (`main.tsx`,
`Sidebar.tsx`, plus `en/session.json`), 7 modified non-English
`session.json` locale files, 4 modified Phase 13 docs. 25 files total.
Real user data (`data/`, `.FormuLab/runs.db`, backups, generated user
guides, `v0.4.0`) was not touched — confirmed via `git status
--porcelain` showing only the intended 25 files plus the pre-existing,
out-of-scope `docs/generated/*`/`formulas/*` local changes from an
earlier, unrelated session, left untouched.

**Final commit SHA**: `6c81086` on `feature/laboratory-stability`.

**Push result**: succeeded, `cc5b944..6c81086`, fast-forward, to
`origin/feature/laboratory-stability`. No main sync (not requested).

**Exact next session**: **Phase 13 Session 3: `rolePolicy.ts` (canonical
`can(role, area, capability)` covering all of §6's full permission
matrix) + wire the new `UserContext` through the app + a Rust/
TypeScript role-vocabulary parity test.** Bridge session between
"authentication exists" (Sessions 1-2) and "authorization is enforced"
(Session 4) — builds the single canonical policy module Session 4 calls
from every privileged action, without itself adding enforcement
anywhere. Still no `Administration → Users` UI (Session 5) and no
application-wide enforcement (Session 4).

---

## Session 3 — `rolePolicy.ts`, role-vocabulary parity, trusted-actor wiring, privileged-command inventory

Starting HEAD: `6c81086` (Session 2 close), confirmed matching
`origin/feature/laboratory-stability` before any change was made.
Scope, per the session brief: the canonical `can(role, area,
capability)` policy module covering all of §6's matrix (not just the
two approval gates), a Rust/TypeScript role-vocabulary parity test, and
wiring the new `UserContext` through the app. Explicitly out of scope:
any server-side enforcement, any `Administration → Users` UI, the full
workflow engine — all confirmed still out after this session too.

This session ran in two parts: a checkpoint commit (`960ba91`,
mid-session) landing `rolePolicy.ts`, the parity test, and 7 of 10
trusted-actor wiring sites, with docs/inventory explicitly deferred;
and this closure, which finishes the remaining 3 wiring sites, the
privileged-command inventory, and every doc.

### `rolePolicy.ts` — the canonical policy module

`packages/shared/src/engine/rolePolicy.ts` (new): a single `can(role,
area, capability)` function transcribing architecture doc §6's full
matrix across every area (Home, Projects, Formulation, Laboratory,
Stability, Optimization, Regulatory, Approval, Reports, Administration,
Data Exchange), default-deny — any role/area/capability triple absent
from the matrix refuses rather than silently allowing. Two places where
§6's prose and its own table could plausibly disagree were resolved
explicitly, each with its own test, rather than picked silently:
`production_manager` gets verify authority on
`rawMaterials`/`supplierDocuments` (matching §15.4's Session-1-closure
decision), and `quality` + `administrator` get verify authority on
`regulatory` (matching the pre-existing, deliberately untouched
`AUTHORIZED_REGULATORY_ROLES` from `regulatoryAuthorization.ts`, §8 —
re-confirmed, not re-derived). `approve`/`reject` on both approval
gates are computed live from `status.ts`'s `APPROVAL_AUTHORITY` rather
than re-typed as a second literal role list, so the two modules are
structurally incapable of drifting apart — a future change to
`APPROVAL_AUTHORITY` is automatically reflected in `can()`, not a
second edit someone could forget. 32 tests, one `describe` block per
§6 area plus dedicated tests for default-deny and both
discrepancy-resolutions.

### Role-vocabulary parity — one shared fixture, not two hand-copied lists

`packages/shared/src/engine/roleVocabulary.json` (new): the 12 canonical
role strings as a plain JSON array — the one file both languages now
check themselves against, rather than either trusting the other's
source or a third independently-maintained list.
`rolePolicy.roleVocabularyParity.test.ts` (new, 5 tests): the fixture
equals `APPROVAL_ROLES` in both directions (no extra roles in either
list, none missing from either), the fixture has no duplicates, and
every `rolePolicy.ts` matrix entry's role is present in the fixture.
`identity.rs` gained `role_vocabulary_matches_the_shared_json_fixture`
(new, 1 test): parses the same JSON file from Rust at test time and
asserts its 12 entries equal, in order, `identity::Role`'s `as_str()`
output for every variant. Neither language's list is now the
"authoritative" one that the other is checked against — both answer to
the file.

### Frontend — `useTrustedActor()`, wired to all 10 spoofable sites

`apps/desktop/src/lib/currentActor.ts` (new): `useTrustedActor()` calls
the existing `useOptionalAuth()` (Session 2) and, when there's a real
authenticated user, returns `{role, userId, displayName}` sourced from
the session; returns `null` only when there's no `AuthProvider`
ancestor at all, which happens only in this codebase's existing test
suite (`renderAt()` mounts routes/`AppShell` directly, bypassing
`main.tsx`'s real provider — documented at length in Session 2's own
`useOptionalAuth()` rationale, reused here rather than re-litigated).

Checkpoint commit (`960ba91`) wired 7 sites: `ApprovalPanel`,
`ClaimsLabelsPanel`, `DossierPanel`, `RegulatoryPanel`, `DoePanel`,
`TestMethodDrawer`, `DataExchangePage`. Each site's pattern: compute an
`effective*`/`actor` value that prefers `useTrustedActor()`'s result and
falls back to the pre-existing local `useState` selector only when
`null`; when trusted, render a read-only "acting as {name} ({role})"
line (`auth.actingAsTrusted`, added to all 8 shipped locales) instead of
the freely-editable role `<select>`/user-id text input; every downstream
call that previously read the raw `useState` now reads the effective
value instead.

This closure finished the remaining 3 sites flagged in Session 0's
original audit but left for later in the checkpoint: `TrialsPanel.tsx`,
`StabilityPanel.tsx`, `CorrectiveActionsPanel.tsx`. These three differ
from the first 7 in shape — they had no editable role `<select>` at all
(no "spoof a specific role" UI), just a hardcoded module-level
`LOCAL_HUMAN: Actor = {kind: "human", role: "researcher", userId:
"local"}` constant reused across every trial/study/corrective-action
transition, plus a scattered set of bare `"local"` strings recording
who weighed a sample, observed something, detected a deviation,
performed a test, replaced an attachment, or owns a corrective action.
Each file now computes one `actor`/`actorId` pair at the top
(`trusted ? {kind:"human", role: trusted.role, userId: trusted.userId}
: LOCAL_HUMAN`, and `trusted?.userId ?? "local"`) and every call site
that previously referenced `LOCAL_HUMAN` or a literal `"local"`
performer/owner string now reads one of those two instead —
`canTransitionTrial`/`canTransitionStability`,
`resolveTrialDeviation`/`resolveStabilityFailure`,
`acceptDeviationWithJustification`, `createCorrectiveAction`,
`markInProgress`/`markAwaitingVerification`/`verifyEffectiveness`/
`reopenCorrectiveAction`/`cancelCorrectiveAction`, and the
`createdBy`/`weighedBy`/`observedBy`/`detectedBy`/`performedBy`/
`replacedBy`/`owner` record fields. `StabilityPanel`'s
`manualInclusionReviewer` free-text field (records who authorized
including an out-of-applicability test, with a required reason) was
deliberately left as free text — it is not a "which role am I acting
as" selector, so it's outside this session's scope, not a missed site.

### Privileged-command inventory — sizing Session 4's actual scope

All 110 `#[tauri::command]`-registered commands in `lib.rs` were
reviewed for two questions: does this command perform a role-gated
business action, and does it currently check role at all. Confirmed:
none do — Session 2 already established no command outside `auth.rs`
resolves a session's role; this pass exists to categorize and size that
gap, not re-discover it. Categories found (full table: architecture doc
§9.2): approval gates (`save_approval_record`, the known Session 0
finding, unchanged); formulation content writes
(`save_formulation`/`save_formulation_version`/`delete_formulation`/
draft commands); generic masterdata CRUD
(`upsert_master_records`/`delete_master_record`/
`write_master_collection_raw`) — the single widest gap found, since
these three commands route every collection (materials, suppliers,
raw materials, regulatory data, all of it) through one
`collection: String` parameter with no actor field of any kind, not
even an unchecked name string to audit against; the audit-event write
path (`append_audit_event` — any caller can write an audit event
misattributed to anyone); attachments; and system administration
(`restore_backup`, `create_pre_migration_backup`,
`move_data_location`, `write_automatic_backup_config`). The auth
commands themselves (`login`, `bootstrap_create_administrator`,
`logout`, `current_session`) are correctly role-parameter-free by
design (§9.1, unchanged) — the one category already right. Local
dev/infra tooling (`workspace::*`, `jupyter::*`, `kernel::*`,
`compute::*`, `modal::modal_status`, `preview_server::preview_url`,
`tools::detect_tools`, `updates::check_for_update`,
`debug_log::log_debug`) is out of scope — local machine configuration,
not regulated business data.

**One finding goes beyond "these commands aren't checked yet"**:
architecture doc §6's matrix, as drafted, has no System-Administration
area at all. Backup, restore, data-location moves, and schema
migration have no matrix row to enforce against — Session 4 cannot
wire `can()` into a cell that doesn't exist. Drafting that area is now
flagged as prerequisite work for Session 4's domain review (Risks
item 1), not a Session 4 afterthought discovered mid-session.

This inventory is audit-only. No command's behavior changed; `git diff`
for `apps/desktop/src-tauri/src/*.rs` this session is empty except for
the parity-test addition to `identity.rs` (§ above).

### Verification

`cargo build --lib`: clean. `cargo test --lib`: 252/252 passing
(Session 2's 251 + 1 new). `cargo clippy --lib -- -D warnings`: clean.
`packages/shared`: `tsc --noEmit` clean, `vitest run` 1291/1291 (63/63
files) — Session 2's 1254 + 37 new (32 `rolePolicy.test.ts` + 5
`rolePolicy.roleVocabularyParity.test.ts`). `apps/desktop`: `tsc
--noEmit` clean, `vitest run` 1185/1185 (132/132 files) — unchanged
from Session 2's count, confirming the trusted-actor wiring's fallback
path is fully exercised by the existing `TrialsPanel.test.tsx`/
`StabilityPanel.test.tsx` suites (neither mounts a real `AuthProvider`,
so both exercise the `useTrustedActor() === null` fallback branch on
every run) with no new test file needed. `git diff --check`: clean.

### Closure

Files changed this closure (on top of the checkpoint commit's 20):
`apps/desktop/src/components/formula/TrialsPanel.tsx`,
`StabilityPanel.tsx`, `CorrectiveActionsPanel.tsx` (trusted-actor
wiring), 4 Phase 13 docs (`PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md`,
`PHASE13_SECURITY_TEST_MATRIX.md`, `docs/handoffs/PHASE13_CURRENT.md`,
`docs/architecture/IMPLEMENTATION_STATUS.md`), this external log.
Pre-existing, out-of-scope local changes (`docs/generated/*`,
`formulas/*` deletions from an earlier, unrelated session) confirmed
untouched via `git status --porcelain`.

**Exact next session**: **Phase 13 Session 4: application-wide
server-side enforcement.** Every command the privileged-command
inventory (§9.2) flagged resolves role from the authenticated session
(never a caller-supplied value) and calls `rolePolicy.ts`'s `can()`
before acting; every nav/button uses the same `can()`. Fixes the
confirmed `save_approval_record` bypass and the wider masterdata-CRUD
gap. Drafts a System-Administration area in §6 before enforcing
backup/restore/migration/data-location commands against it. Begins real
workflow-gate enforcement per §15 for gates that already have a
`FormulaStatus`; the §15.3 gaps stay their own follow-up. Still no
`Administration → Users` UI (Session 5).

---

## Session 4 — Application-wide server-side authorization enforcement

Starting HEAD: `2eb082f` (Session 3 close), confirmed matching
`origin/feature/laboratory-stability` before any change was made.
Scope, per the session brief: turn the Session 3 policy foundation into
real backend authorization — every privileged action authorized from
the authenticated backend session, never frontend claims. Priority
targets named explicitly: `save_approval_record`'s bypass, formulation
writes, generic masterdata CRUD, audit attribution, attachments, System
Administration. Explicitly NOT this session: Session 5's
`Administration → Users` UI, and full enforcement of literally every
one of the 110 inventoried commands (only the named priority set).

### Cross-layer policy contract — no hand-typed Rust matrix

`role_policy.rs` (new): reads two JSON fixtures via `include_str!` —
`rolePolicyMatrix.generated.json` (the full role/area/capability grid)
and `formulaStatusTransitions.json` (the `ALLOWED_NEXT` workflow-
transition graph) — and implements `can(role, area, capability) ->
bool` / `is_valid_transition(from, to) -> bool` as flat, default-deny
lookups. Both fixtures are generated by a new script,
`packages/shared/scripts/generate-role-policy-matrix.ts`, from
`rolePolicy.ts`'s `fullMatrixSnapshot()` (new export) and `status.ts`'s
now-exported `ALLOWED_NEXT` — the exact mechanism Session 3's
`roleVocabulary.json` already established for the 12-role vocabulary,
extended to the full matrix and the transition graph. Two new
TypeScript tests (`rolePolicy.matrixParity.test.ts`,
`status.transitionParity.test.ts`) assert the checked-in fixture is
byte-for-byte what a fresh computation produces right now — a change to
`MATRIX`/`ALLOWED_NEXT` without regenerating fails these tests loudly.
`role_policy.rs`'s own 10 tests spot-check representative cells
(default-deny, `systemAdministration` administrator-only, both
approval gates' exact role sets, worker/manager separation, the two
Session 3 discrepancy-resolutions, several transition-graph edges)
against the same facts `rolePolicy.test.ts` already asserts — proving
the shared-fixture mechanism actually produces the intended data, not
just that a file exists.

### A new `systemAdministration` policy area

§6's table never had one. Added to `rolePolicy.ts`'s `POLICY_AREAS`/
`MATRIX`: a single row, `administrator: ["view", "administer"]`, every
other role `[]`. Per explicit instruction ("system-level destructive/
configuration mutations should be Administrator-only unless the
current approved architecture proves otherwise") and nothing in the
approved architecture names any other role, so administrator-only is
the considered answer, not a placeholder.

### `authz.rs` — one trusted backend guard

`current_actor(conn, token)` resolves `TrustedActor {user_id, role,
display_name}` from `identity::validate_session` alone — no role/area/
capability check. `authorize(conn, token, area, capability)` adds the
`role_policy::can()` check. `authorize_any`/`authorize_any_app` accept
several capabilities (a masterdata upsert can insert or update in one
call, so "has `create` OR `edit`" is the real gate). **No signature
anywhere in this module has a role/userId/displayName parameter** — a
caller structurally cannot supply an identity for the guard to trust.
Every denial is audited using the *resolved* trusted actor's real id,
never a caller's claim; a denial with no valid session at all audits
`None`/`None`, never fabricates an identity. Fails closed at every
step — no token, expired, revoked, disabled account — matching
`validate_session`'s own Session 2 semantics exactly, this module never
second-guesses them. 8 tests: authorized allow; denied-with-real-
identity-audited; invalid token denied; revoked session denied;
expired session denied; disabled account denied; a role change takes
effect on the very next check for the same still-valid session
(mirrors Session 2's `current_session` proof, one layer up); a
structural test asserting there is no spoofable parameter to test
against in the first place.

### `save_approval_record` — the Session 0 bypass, closed

The confirmed gap named in every session since Session 0. Now:
`requestedStatus` selects the policy area (refusing outright if it
isn't `pilot_approved`/`production_approved`); `decision` selects the
capability (`approved` -> `approve`, else `reject`);
`authz::authorize_app` resolves the trusted actor and checks
`role_policy::can()`; for an "approved" decision (the only one that
moves real state), `role_policy::is_valid_transition(previousStatus,
requestedStatus)` must also hold — a manager with real approve
authority still cannot approve `concept -> pilot_approved` directly,
proving role capability and transition validity are both required, per
this session's explicit brief. `approvedBy`/`approvedByRole`/
`reviewerUserId`/`reviewerRole` are unconditionally overwritten with the
trusted actor's real identity. The command's logic was split into pure,
AppHandle-free functions (`approval_area_for`, `approval_capability_for`,
`finalize_approval_record`) specifically so this could be unit-tested
without a Tauri harness — 7 new tests, including one asserting a record
with NO identity fields at all still ends up correctly attributed
(proving the trusted session is the *only* source, not a fallback used
only when a caller forgot to spoof something).

### Formulation writes, and the "delete has no grant anywhere" finding

`save_formulation`/`save_formulation_version`/`save_formulation_draft`/
`discard_formulation_draft` require `create` OR `edit` on `formulation`
— per §6's literal matrix, that's `researcher` alone; every other role,
`administrator` included (deliberately view-only on scientific content,
§9), is refused. A structural finding surfaced while wiring
`delete_formulation`: **no role has the `delete` capability in any
domain content area at all** — the only cell in the whole matrix
granting `delete` is `projects`/`administrator`. Gating delete against
its own domain area would make deletion unreachable for everyone, not
safer. Both `delete_formulation` and `delete_master_record` therefore
gate against `projects`/`delete` instead — documented as a deliberate
Session 4 choice using the one real grant that exists, flagged for the
domain review, not silently patched into the matrix.

### Generic masterdata CRUD — the widest gap, closed with a real domain mapping

`upsert_master_records`/`delete_master_record`/
`write_master_collection_raw` previously carried no actor concept at
all. `masterdata.rs`'s new `area_for_collection()` maps all 90
allow-listed collections onto a `PolicyArea`, built from this file's
own Phase-by-Phase domain-grouping doc comments and, where one already
existed, `dataExchangeRegistry.ts`'s `targetCollection`/per-template
`authorization` role lists — real, pre-existing domain judgment reused
rather than reinvented from scratch. An unmapped name is a hard deny;
`masterdata::tests::every_allow_listed_collection_has_a_policy_area_mapping`
asserts 100% coverage directly against the real `COLLECTIONS` array,
not a sample. 4 new tests total, including a direct check that
`raw_material`/`procurement` (create-only or create+edit) both pass the
write-capability check while `regulatory` (view-only on `rawMaterials`)
is rejected.

### Audit-actor spoofing, attachments, System Administration

`append_audit_event` now requires a valid session and, when
`actorKind` is absent or `"human"`, overwrites `event.actor` with the
trusted session's display name — an explicit non-human `actorKind`
(agent/system/import) is left untouched, since those were never
identity-authoritative to begin with. `copy_attachment_into_project`
gates against `formulation` create/edit (the formulation is an
attachment's real parent/domain context); `open_attachment` requires
only a valid session. System Administration:
`backup::{create_backup, restore_backup}`,
`migration::create_pre_migration_backup`,
`data_location_manager::{move_data_location, use_existing_data_location,
restore_default_data_location, cleanup_old_data_location}`,
`automatic_backup::{write_automatic_backup_config,
apply_pre_migration_retention}` — all gated `systemAdministration`/
`administer`. `run_automatic_backup` deliberately left unauthenticated:
gating it would silently stop a non-admin user's own scheduled backups
from ever running, exactly the "trusted internal background functions
must not be broken merely because they do not have an interactive user
session" case the brief named.

### Frontend wiring

`apps/desktop/src/lib/sessionToken.ts` (new): `currentSessionToken()`
reads the exact `SESSION_TOKEN_KEY` `AuthProvider.tsx` persists to (now
exported, rather than a second hardcoded string). Every touched command
wrapper's shared `call()` helper (`formulations.ts`, `masterdata.ts`,
`migrationRunner.ts`) now merges `{token: currentSessionToken(), ...
args}` in one place; `tauri.ts`'s 8 direct-`invoke()` call sites (no
shared helper in that file) were each updated individually. This design
choice — one accessor, injected at the helper layer wherever one
exists — meant 26 changed commands needed token-wiring at only ~10 edit
sites, not 26. `SettingsPage.tsx`'s four System Administration cards
(Active Data Location, Backup and Recovery, Automatic Backups, Schema
Migration) are hidden for a non-administrator via `useTrustedActor()` +
`can()` — UX only, since the backend was already authoritative before
this change; hiding just avoids showing a button that always fails.
The 10 Session-3 trusted-actor sites were re-audited: no additional
hardcoded-role site was found; `StabilityPanel`'s
`manualInclusionReviewer` remains deliberately untouched (legitimate
reviewer-name metadata, not a role selector).

### The four §15.3 gates — status, per explicit brief item 7

Unchanged: no `FormulaStatus`, no gate command exists for any of the
four (raw-material verification, supplier-document verification,
production-engineering handoff, production release). Not faked with a
bare permission check standing in for the missing workflow state — there
is no command to gate in the first place. What Session 4 did secure:
the underlying record-mutation boundary gates #1/#2 will eventually sit
in front of — `materials`/`material_documents`/`suppliers` now route
through the now-authorized `upsert_master_records`, mapped to
`rawMaterials`, which already carries `production_manager`'s `verify`
capability from Session 3. Gates #3/#4 have no corresponding masterdata
collection at all (formulation-lifecycle states, not master-data rows),
so nothing in this session touches their storage boundary. All four
remain explicitly tracked for Session 5 or a dedicated workflow
session, per architecture doc §15.4's new Session 4 status note.

### Privileged-command classification (extends Session 3's inventory)

Every command Session 3 inventoried now carries one of five labels —
PRIVILEGED_ENFORCED (17 commands gated this session),
AUTHENTICATED_READ, TRUSTED_INTERNAL_ONLY,
READ_ONLY_NO_ROLE_GATE_NEEDED, or DEFERRED_WITH_REASON. The last
category is this session's own honest residual-gap disclosure, not
silence: `resume_interrupted_data_move` (privileged in effect,
outside this session's explicit "4 data-location commands" scope),
`materials::{import_materials, cost_formulation}`,
`provenance::record_provenance`, `runs::record_run`, and the
`formulation*::` compute/generation commands (their persisted output
goes through the now-gated draft/version commands, but the compute
commands themselves weren't reviewed). Full table: architecture doc
§9.3.10.

### Verification

`cargo build --lib`: clean, zero warnings. `cargo test --lib`: 281/281
passing (Session 3's 252 + 29 new: 10 `role_policy.rs` + 8 `authz.rs` +
4 `masterdata.rs` + 7 `formulations.rs`). `cargo clippy --lib -- -D
warnings`: clean. `packages/shared`: `tsc --noEmit` clean, `vitest run`
1296/1296 (63/63 -> 65/65 files) — Session 3's 1291 + 5 new (3
`rolePolicy.matrixParity.test.ts` + 2 `status.transitionParity.test.ts`).
`apps/desktop`: `tsc --noEmit` clean, `vitest run` (full suite)
1188/1188 (132/132 -> 133/133 files) — Session 3's 1185 + 3 new
(`sessionToken.test.ts`); every pre-existing test exercising a
now-token-carrying command wrapper passed unchanged, confirming the
token-injection refactor is transparent to existing callers. `eslint`
clean on every touched frontend file. `git diff --check`: clean.

### Closure

Files changed: 2 new Rust files (`role_policy.rs`, `authz.rs`), 6
modified Rust files (`formulations.rs`, `masterdata.rs`,
`attachments.rs`, `backup.rs`, `migration.rs`,
`data_location_manager.rs`, `automatic_backup.rs`, `lib.rs` — 8
modified), 1 new frontend file (`sessionToken.ts` + its test), 7
modified frontend files (`formulations.ts`, `masterdata.ts`,
`tauri.ts`, `migrationRunner.ts`, `AuthProvider.tsx`,
`SettingsPage.tsx`), 2 new shared-package data files
(`rolePolicyMatrix.generated.json`, `formulaStatusTransitions.json`) +
1 new generation script + 2 new parity test files, 2 modified
shared-package files (`rolePolicy.ts`, `status.ts`), 4 Phase 13 docs,
this external log. Pre-existing, out-of-scope local changes
(`docs/generated/*`, `formulas/*` deletions) confirmed untouched via
`git status --porcelain`.

**Exact next session**: **Phase 13 Session 5: `Administration → Users`
UI** — list, create, edit, role change, reset password, activate/
disable, security-history view, read-only role-capabilities view
(rendered from `rolePolicy.ts`, never a second hand-maintained
display). Session 4's residual gaps (the DEFERRED_WITH_REASON
commands, the four §15.3 gates, the masterdata mapping's missing
TypeScript parity) remain open follow-up work, not blockers to Session
5 specifically.

---

## Session 4A — Residual authorization + Production Manager workflow gate closure

Starting HEAD: `17ab2b9` (Session 4 close), confirmed matching
`origin/feature/laboratory-stability` before any change was made.
Scope, per the session brief: close the three gaps Session 4 disclosed
rather than fixed — the `DEFERRED_WITH_REASON` command backlog, the
four Production Manager workflow gates' total non-implementation, and
the masterdata collection->PolicyArea mapping's missing TypeScript
parity. Explicitly not this session: Session 5's `Administration →
Users` UI.

### Masterdata collection->area parity, closed first (smallest, most mechanical of the three)

`packages/shared/src/engine/masterdataPolicyAreas.ts` (new): the 90
collection names (`MASTERDATA_COLLECTIONS`, now what
`apps/desktop/src/lib/masterdata.ts`'s `Collection` type derives from
instead of a second hand-typed union) and
`MASTERDATA_COLLECTION_POLICY_AREAS: Record<MasterdataCollection,
PolicyArea>` — the `Record` type itself makes a missing mapping a
TypeScript compile error, not merely a test failure. The generation
script now also emits `masterdataCollectionAreas.generated.json`;
`role_policy.rs`'s new `masterdata_area_for()` reads it via
`include_str!`; `masterdata.rs`'s Session-4 hand-typed `match` is now a
one-line delegator to it. The domain grouping itself is byte-identical
to Session 4's — inspection found no error to correct, only a missing
TypeScript mirror to build. Parity proven both directions: 5 new
TypeScript tests (`masterdataPolicyAreas.parity.test.ts`) and 4 new
Rust tests (`role_policy.rs`) assert against the same checked-in JSON
fixture; `masterdata.rs`'s pre-existing Session 4 tests (unchanged)
now exercise the delegator through to the shared fixture and still
pass — a third, incidental confirmation the refactor changed nothing
observable.

### Deferred-command backlog, closed by inspection, not blanket treatment

Per explicit instruction not to assume uniform treatment, each
`DEFERRED_WITH_REASON` command was inspected individually.
`resume_interrupted_data_move` (`data_location_manager.rs`) completes
or rolls back an interrupted move — the same action `move_data_location`
performs — gated identically (`systemAdministration`/`administer`).
`materials::import_materials` replaces the entire stored material list
wholesale via a separate Python-pipeline-backed store from
`masterdata.rs`'s own `materials` collection — same category of action
as `upsert_master_records`, gated `rawMaterials` create-or-edit.
`materials::{list_materials, cost_formulation}` and seven commands
across `formulation.rs`/`formulation_advanced.rs`/`formulation_v2.rs`
(`run_formulation_optimize`, `run_advanced_formulation_optimize`,
`generate_formulation`, `list_sessions`, `read_session`,
`delete_session`) are compute-only or scoped to the caller's own
scratch session store, not a shared regulated collection — persistence
that matters already routes through the Session-4-gated
`formulations::` commands, so these now require only a valid session
(AUTHENTICATED_READ), not a specific capability.
`cancel_advanced_formulation_optimize` stays ungated — no `AppHandle`
in its signature, and cancelling a run has no exploitable effect beyond
stopping it, the same precedent Session 4 already set for
`cancel_backup`/`cancel_restore`/`cancel_data_move`.

`provenance::record_provenance`/`runs::record_run` were reclassified,
not gated: inspection showed they track file-provenance and code-run
history for this application's separate notebook/AI-agent workspace
subsystem (the same family as `kernel.rs`/`jupyter.rs`/
`artifact_file.rs`) — not FormuLab lab/business records, so no
`rolePolicy` area conceptually applies. Left in the
READ_ONLY_NO_ROLE_GATE_NEEDED-equivalent bucket, not silently ignored.

Every command in Session 3's original inventory now carries a final
disposition — the classification table in architecture doc §9.4.1 is
the complete accounting.

### The four Production Manager workflow gates — real state, not a permission check standing in for one

Per explicit instruction not to force these into `FormulaStatus`: a
new module, `workflow_gates.rs`, and a new storage pattern — one
mutable JSON record per `(gateType, subjectId[, parentId])` under
`data/workflow_gates/<gateType>/`, the same one-file-per-record shape
`formulations.rs`'s approvals already use, not a new mechanism.
Considered and rejected: embedding gate fields directly on
`RawMaterial`/`Supplier`/`FormulationVersion` — versions are immutable
once written (`save_formulation_version` refuses to overwrite), so a
gate needing to progress `pending -> submitted -> approved` over time
cannot live inside one; a separate record referencing its subject by
id is the same pattern `CorrectiveAction`/`TrialDeviation` already use.

**Two commands cover all four gates**: `submit_workflow_gate` (worker
moves `pending`/`rejected` -> `submitted`) and `decide_workflow_gate`
(`production_manager`/administrator moves `submitted` ->
`approved`/`rejected`), plus `read_workflow_gate`. A `GateSpec` lookup
resolves each gate type's `role_policy` area and capability:
raw-material/supplier-document verification use one `verify`
capability for both approve and reject (Session 3 granted a single
capability for the whole verification decision); production-
engineering handoff/production release use distinct `approve`/`reject`
capabilities (both already existed on those areas per §6's matrix).

**Worker/manager separation is structural, not convention**: a worker
role never holds the decide capability in `role_policy.rs`'s real
MATRIX (`raw_material`/`procurement`/`production_engineering`/
`production` all lack it) — `worker_roles_cannot_decide_their_own_
gate_the_capability_does_not_exist_for_them` asserts this directly
against the real policy function, not a mock. Administrator gained the
decide capability on all four gate areas as a third documented
discrepancy-resolution in `rolePolicy.ts` (alongside Session 3's first
two, same doc comment) — §15.4 explicitly requires it.

**Downstream blocking is real**, checked before a worker can even
*submit*, not just before a manager decides: `production_engineering_
handoff` requires the subject `FormulationVersion`'s `status` to
already equal `production_approved`, read directly from the same
version JSON `save_formulation_version` writes — no second copy of
`FormulaStatus`. `production_release` requires
`production_engineering_handoff`, for the same subject, to already be
`approved`.

**The actual state-machine logic is unit-tested, not just its specs** —
following the exact pattern Session 4's `finalize_approval_record`
established: `apply_submit`/`apply_decision`/`prerequisite_satisfied`
are pure functions (no `AppHandle`), split out specifically because
this codebase's own established convention rejects
`tauri::test::mock_app()` as unreliable (`app_data_dir()` resolves
unpredictably under it — `automatic_backup.rs`'s own doc comment
records the precedent). 19 tests total: the 4-state lifecycle's exact
allowed/denied transitions; all four gate specs and their capabilities;
both prerequisite checks against representative status/state values; a
first submission's shape; refusing to resubmit an already-submitted
gate; **a rejected gate becoming actionable again via resubmission,
with the resubmission clearing the previous cycle's stale
approve/reject attribution** — the direct proof of "a rejected/returned
item must become actionable again by the appropriate worker role";
refusing to decide a gate still `pending`; approving being terminal;
administrator deciding exactly like production_manager; and the
storage-key collision-avoidance between different parents sharing a
subject id.

### Verification

`cargo build --lib`: clean, zero warnings. `cargo test --lib`: 304/304
passing (Session 4's 281 + 23 new: 4 `role_policy.rs` + 19
`workflow_gates.rs`). `cargo clippy --lib -- -D warnings`: clean.
`packages/shared`: `tsc --noEmit` clean, `vitest run` 1301/1301 (65/65
-> 66/66 files) — Session 4's 1296 + 5 new
(`masterdataPolicyAreas.parity.test.ts`). `apps/desktop`: `tsc
--noEmit` clean, `vitest run` (full suite) 1188/1188 — unchanged from
Session 4's count, confirming the `Collection` type refactor and the 9
newly-gated commands' token wiring are transparent to every existing
test that already exercises those wrapper functions. `eslint` clean on
every touched frontend file (`masterdata.ts`, `formulationV2.ts`,
`tauri.ts`). `git diff --check`: clean.

### Closure

Files changed: 1 new Rust file (`workflow_gates.rs`), 6 modified Rust
files (`role_policy.rs`, `masterdata.rs`, `data_location_manager.rs`,
`materials.rs`, `formulation.rs`, `formulation_advanced.rs`,
`formulation_v2.rs`, `formulations.rs`, `lib.rs` — 8 modified), 1 new
shared-package source file (`masterdataPolicyAreas.ts`) + 1 new parity
test file + 1 new generated JSON fixture, 2 modified shared-package
files (`rolePolicy.ts`, the generation script), 3 modified frontend
files (`masterdata.ts`, `formulationV2.ts`, `tauri.ts`), 4 Phase 13
docs, this external log. Pre-existing, out-of-scope local changes
(`docs/generated/*`, `formulas/*` deletions) confirmed untouched via
`git status --porcelain`.

**Exact next session**: **Phase 13 Session 5: `Administration → Users`
UI** — list, create, edit, role change, reset password, activate/
disable, security-history view, read-only role-capabilities view. All
three residual groups this session targeted are closed; Session 4A's
own new residual notes (no frontend UI for the four workflow gates,
gate-subject existence unvalidated, §6's matrix now three
discrepancy-resolutions deep and still needing the domain-expert
review every session since Session 1 has flagged) carry forward as
open follow-up work, not blockers to Session 5 specifically.

---

## Session 5 — Administration → Users

Starting HEAD: `1d60e21` (Session 4A close), confirmed matching
`origin/feature/laboratory-stability` before any change was made. This
run also registered Phase 14 (Evidence-Driven Hybrid Literature &
Formulation Intelligence) as a documentation-only reservation — no
Phase 14 code was written; see
`docs/PHASE14_LITERATURE_INTELLIGENCE_ARCHITECTURE.md` and
`docs/handoffs/PHASE14_CURRENT.md`. This entry covers only the real
Phase 13 work: Session 5, `Administration → Users`.

### Backend — `admin.rs`, reusing existing primitives, not reinventing them

Seven commands, every one gated through `authz::authorize` against
`administrationUsers`/`administrationSecurity` — the exact guard
Session 4/4A built, not a second authorization mechanism for this
screen. `role_policy::tests::only_administrator_can_manage_users_or_
view_security_history` (new) proves at the policy layer that no role
other than `administrator` has any capability in either area, for all
12 roles — the structural backing for "only the appropriate
Administrator authority may manage users."

Two new `identity.rs` primitives were genuinely needed:
`list_users` (every account, newest-created first — no pagination,
matching this codebase's existing small-scale admin-list convention)
and `list_security_audit_events` (global or scoped to one
`target_user_id`, both reading the same `security_audit_events` table
Sessions 1-2 already write to). A third, `update_user_profile`
(display name/department/employee reference), deliberately separate
from `update_role`/`update_account_status`/`update_password_hash` —
four dedicated primitives, four dedicated audit action names, never
one combined "update user" call that would blur which specific change
happened in the security-history view.

Everything else reuses Sessions 1-2 unchanged: `auth::
validate_new_password` (widened to `pub(crate)`) is the same 8-512-
character policy bootstrap already enforces — no second password
policy invented for admin-set passwords. `identity::update_password_hash`
already sets `must_change_password` on every call, so an admin-reset
password forces a change on next login for free. `identity::
update_account_status` already revokes every open session on disable
— proven directly again here
(`admin::tests::set_account_status_disabled_revokes_open_sessions`),
not re-implemented.

**Ordinary admin-created/edited users may hold the `administrator`
role** — bootstrap's "only ever the first administrator" restriction
(§5) is bootstrap-specific, not a general rule; `create_administered_user`/
`change_administered_user_role` accept all 12 roles via `Role::parse`,
which rejects anything else (`create_administered_user_rejects_an_
invented_role`, proving `"super_admin"` and similar are refused).

9 new Rust tests total in `admin.rs`: account creation with the
requested role and forced password change; invented-role rejection;
mismatched-confirmation rejection; role change updating the stored
value and auditing both `from` and `to`; disable revoking open
sessions; password reset never storing the plaintext and forcing a
change; weak-password rejection against the existing policy; a direct
scan of every audit row after a password reset confirming none
contains the hash or plaintext; and a list/history round-trip.

### Frontend — extends `AdministrationPage.tsx`, does not replace it

`UsersPanel.tsx` (new) is wired in as a new "Users" tab on the
existing page, next to Overview and Test Definitions — the same
pattern that page already used for Test Definitions, not a second,
disconnected administration surface. Hidden for a non-administrator
(`useTrustedActor()` + `can(role, "administrationUsers", "view")`,
Session 4's exact convention) — UX only, the backend was already
authoritative regardless; the `useEffect` that loads the user list is
now also skipped entirely for a non-administrator role, so the
frontend doesn't even make a call that would just be refused
server-side.

List view: username, display name, an inline role `<select>` (applies
immediately — role changes are supposed to be quick and reversible via
another role change, no confirmation friction), a status badge, and a
"must change password" badge. Disabling an account requires confirming
a real in-app dialog (`ConfirmDialog.tsx`, this codebase's existing
`window.confirm`-avoidance component — WebView `window.confirm` is
unreliable) since it revokes every open session immediately; activating
is a single click, since it's the safe direction. A right-side detail
panel per selected user holds profile editing, password reset (two
fields, a hint that the user must change it next login), and that
user's own security history, loaded on demand. A separate top-level
view swaps in the global security-history list or the role-
capabilities table.

**Role-capabilities view is generated, not hand-written**: it iterates
`ROLES` and, for each, calls `areasFor(role)`/`capabilitiesFor(role,
area)` from `@formulab/shared`'s `rolePolicy.ts` directly — the exact
same functions the canonical policy itself exposes for this purpose
(their own doc comments in `rolePolicy.ts` since Session 3 say
"for a future read-only 'role capabilities' view ... never a second
display-only matrix"). This session is that future view.

8 new frontend tests (`UsersPanel.test.tsx`): a non-administrator role
sees no user-management UI and the backend is never even called; an
administrator sees the real user list; the no-`AuthProvider` test
fallback shows the UI (matching every other `useTrustedActor()` site);
list rendering; creating a user calls the wrapper with exactly the
typed fields, not a caller-invented role; changing a role via the
`<select>` calls the wrapper with the selected value; disabling
requires confirming the dialog first; the capabilities view renders
all 12 canonical roles. `Workspaces.test.tsx`'s stale "no user-
management backend" assertion (predating this session, now false) was
replaced with a real route-level check that the Users tab loads.

### i18n — 46 new keys, one real gap disclosed rather than hidden

`administration.users.*` was added to all 8 shipped locales (the
parity test requires exact key-set parity, not value-level
translation — confirmed by inspecting `parity.test.ts` directly before
choosing this approach). Turkish (`tr`) received real translations,
matching the fact that this exact `administration` section's
pre-existing keys in `tr/session.json` were already fully translated,
unlike the other six locales. `de`/`es`/`fr`/`ja`/`ko`/`zh-Hans`
received the English text verbatim for the new keys — inspection
confirmed this is not a new gap this session introduced: those same
six files already carried the *pre-existing* `administration.heading`/
`overview`/`description` keys in literal English before this session
touched anything. The stale `noUserManagement` key (now false — user
management exists) was removed from all 8 locales, including English.

### Verification

`cargo build --lib`: clean, zero warnings. `cargo test --lib`: 314/314
passing (Session 4A's 304 + 10 new: 1 `role_policy.rs` + 9 `admin.rs`).
`cargo clippy --lib -- -D warnings`: clean. `packages/shared`:
unchanged this session, 1301/1301 (no shared-package file touched).
`apps/desktop`: `tsc --noEmit` clean, `vitest run` (full suite)
1197/1197 (Session 4A's 1188 + 9 new: 8 `UsersPanel.test.tsx` + 1 net
new in `Workspaces.test.tsx`), `eslint` clean on every touched file,
i18n parity (`parity.test.ts`, 23 tests) passing. `git diff --check`:
clean.

### Closure

Files changed: 1 new Rust file (`admin.rs`), 3 modified Rust files
(`identity.rs`, `auth.rs`, `role_policy.rs`, `lib.rs` — 4 modified), 2
new frontend files (`admin.ts`, `UsersPanel.tsx`) + 1 new test file
(`UsersPanel.test.tsx`), 2 modified frontend files
(`AdministrationPage.tsx`, `Workspaces.test.tsx`), 8 modified locale
files (`administration.users.*` added, `noUserManagement` removed),
2 Phase 13 docs (architecture, test matrix) + the handoff, this
external log. Phase 14's registration (2 new docs +
`IMPLEMENTATION_STATUS.md` entry) is separate, documentation-only work
from the same run, not counted as Phase 13 Session 5 work. Pre-
existing, out-of-scope local changes (`docs/generated/*`, `formulas/*`
deletions) confirmed untouched via `git status --porcelain`.

**Exact next session**: **Phase 13 Session 6**: brute-force/lockout
wiring confirmation, full audit-event coverage from every real command
(not just Session 5's own four), the complete SQL-injection +
privilege-escalation regression suite against the now-fully-wired-up
command surface, and — if landed by then — the §6 domain-expert-review
matrix corrections. Session 5's own disclosed gap (no "last
administrator" self-demotion guard) remains open, not a blocker.

## Phase 13 closure session — gate UI, subject validation, matrix domain review, cancel-command justification, last-administrator guard (2026-08-16)

A focused closure session, starting from Session 5's close, resolving
the five residual warnings §9.4.6/Risks disclosed rather than starting
Session 6: no frontend UI for the four workflow gates; gate-subject
existence unvalidated; §6's matrix still first-draft; `cancel_
advanced_formulation_optimize` ungated by precedent alone; no
last-administrator guard. Does not start Session 6. Does not implement
Phase 14. Does not touch unrelated generated docs, formulas, real user
data, release/signing work, or unrelated local changes already present
in the working tree (confirmed via `git status` before and after).

### Four workflow gates — real frontend UI, in the screen each belongs to

A single reusable component, `components/workflow/WorkflowGatePanel.tsx`,
backed by a thin bridge, `lib/workflowGates.ts` (mirrors `lib/admin.ts`'s
`call()` pattern — the token is attached server-side from
`currentSessionToken()`, never a role/identity claim from the caller).
Placed where each gate's subject naturally lives, not a disconnected
generic workflow page: `raw_material_verification` inside
`MaterialEditor.tsx`, shown only once a material is an *existing*,
persisted record (`isExisting`, computed in `MaterialsPage.tsx` from
whether the edited code is already in the loaded list) — a brand-new
draft has no real subject for the gate to validate against yet.
`supplier_document_verification` inside `SupplierEditor.tsx`, the same
`isExisting` pattern. `production_engineering_handoff`/
`production_release` inside `ApprovalPanel.tsx`'s new "Production
Workflow Gates" section, scoped to the selected formulation version —
the same screen that already shows `pilot_approved`/`production_
approved` approval state, so a user sees the whole production lifecycle
in one place.

The panel shows: current gate state (pending/submitted/approved/
rejected, with an icon and a badge); who submitted and when; who
approved/rejected and when; the rejection reason; whether resubmission
is available (rendered as an explicit "Resubmission is available."
line — `rejected -> submitted` is the same `submit` action, not a
second code path or a different button); and, for the two production
gates specifically, the real prerequisite-blocking reason *before* a
worker even tries to submit — `production_engineering_handoff` checks
the parent version's `FormulaStatus` (passed down from `ApprovalPanel`,
which already computes it for its own display) and `production_release`
checks the upstream gate's approval state via its own `readWorkflowGate`
call, so "why can't I submit this" is answered without a failed attempt
first. Submit/Approve/Reject buttons are shown or hidden based on
`can(role, area, capability)` — `@formulab/shared`'s real, canonical
`rolePolicy.ts`, not a hand-typed shadow list — so a worker only ever
sees Submit and a manager only ever sees Approve/Reject. This is UX
only: `authz::authorize_app` on the Rust side is the actual boundary,
completely unaffected by what buttons the frontend chooses to draw.

`gateType` (a technical discriminated-union prop, e.g.
`"raw_material_verification"`) was added to `.eslintrc.cjs`'s
`i18next/no-literal-string` exclude list, the same category as
`variant`/`tone`/`kind` — it selects which backend gate the panel talks
to, never text shown to anyone.

### Gate subject-existence/integrity validation — closed server-side, not trusted from the frontend

`workflow_gates.rs`'s `GateSpec` gained a `subject_kind: SubjectKind`
field — `MasterdataRecord(&'static str)` for the two masterdata gates
(the collection name), `FormulationVersion` for the two production
gates. `validate_subject_exists(app, spec, subject_id, parent_id)` is
new, called in all three commands (`submit_workflow_gate`,
`decide_workflow_gate`, `read_workflow_gate`) immediately *after*
authorization resolves but *before* anything else proceeds —
authorizing first means an unauthorized caller learns nothing about
whether a given subject exists, closing an information-leak the
opposite ordering would have opened.

For a masterdata-record gate: `parent_id` must be absent (these gates
have no parent concept — rejected outright if present, before any
filesystem lookup), and `subject_id` must be a real `code` in the named
collection (`masterdata::collection_has_code`, new — reuses
`collection_path`/`read_array`/`row_key`, the same primitives every
other masterdata read already uses, not a second lookup mechanism).

For a formulation-version gate: `parent_id` is required, and
`subject_id` must be a real file under that *exact* parent's
`versions/` directory. This single check structurally proves both
"doesn't exist" and "wrong parent" at once — a real version id that
actually belongs to a *different* formulation is a plain
file-not-found under the claimed parent's directory, indistinguishable
from (and rejected exactly like) a fully fabricated id. Split into two
pure, directly-testable pieces, matching this codebase's established
AppHandle-free-testing convention (`automatic_backup.rs`'s doc comment:
`app_data_dir()` resolves unpredictably under `tauri::test::
mock_app()`, rejected once already, never revisited): `validate_
subject_shape` (the parent-id presence rule, no filesystem access) and
`formulation_version_exists_at` (takes an already-resolved `Path`, not
an `AppHandle`+parent id, so the wrong-parent case is directly
exercisable by pointing it at a different formulation's real versions
directory in a test).

Malformed ids (path traversal, empty, oversized) were already rejected
structurally by `safe_id`/`gate_path` before this session — confirmed
by re-reading that code, not re-implemented.

9 new tests in `workflow_gates.rs` (24 total in the module, up from
Session 4A's 19): the parent-id shape rule for both `SubjectKind`s (2);
a real version file found under its own formulation, a nonexistent one
not found (1 test, 2 assertions); the identical, genuinely-real version
id specifically checked against a *different* formulation's versions
directory and correctly not found there — the direct wrong-parent proof
(1 test); a malformed id rejected before any filesystem check runs,
twice (1 test, 2 assertions). An early attempt at two of these tests
used a `now_iso()`-derived temp-directory name and was flaky under
parallel `cargo test` execution (a transient Windows "path not found"
on `write()` immediately after `create_dir_all()`, most likely
antivirus/real-time-scan interference on a freshly created directory in
a shared temp root) — fixed by switching to this codebase's own
established convention (`std::env::temp_dir().join(format!("<prefix>-
{}", std::process::id()))`, a unique directory per test *function name*
+ process id, the same pattern already used in `admin.rs`/`auth.rs`/
`authz.rs`/a dozen other test modules) rather than a timestamp, which
had no such per-process uniqueness guarantee. Confirmed fixed by
re-running the full `cargo test --lib` suite (not just the module in
isolation, where the race hadn't reproduced) twice.

### Role-permission matrix — domain-reviewed and finalized, one correction

`rolePolicy.ts`'s full matrix was walked cell-by-cell against real
screens/actions, the four workflow gates, `APPROVAL_AUTHORITY`,
raw-material/procurement/production responsibilities, administrator's
restrictions, and every backend command that actually enforces a cell
(`authz.rs`, `workflow_gates.rs`, `materials.rs`, `masterdata.rs`).

**Findings, confirmed correct, no change**: the three additions already
recorded in `rolePolicy.ts`'s own doc comment (`production_manager`'s
`verify` on `rawMaterials`/`supplierDocuments`; `quality`'s and
`administrator`'s `regulatory` `verify`; `administrator`'s four-gate
decide capabilities) all check out against §15.4 and the code that
actually uses them. §9.3.5's "only `researcher` can write formulation
content" and §9.3.5/§9.3.6's "only `administrator` can `delete`
anything" findings are intended, not gaps — administrator stays
view-only on scientific content by explicit architecture, and no
approved decision names any other role for either capability;
broadening either would be adding authority no decision calls for. The
masterdata collection->area grouping is consistent with the areas it
maps to.

**One real discrepancy found and corrected**: `quality`'s literal §6
cell on Raw material records is `V,Vf` (view + verify) — predating the
`raw_material_verification` workflow gate. Grepping the whole codebase
for `("rawMaterials", "verify")` found exactly one consumer:
`workflow_gates.rs`'s `decide_capability` for that gate. Nothing else
ever checked this capability for anything. That means the untouched,
never-reconsidered cell was quietly giving `quality` a *second*
gate-decide authority — directly contradicting `rolePolicy.ts`'s own
"Addition #1" doc comment, which explicitly says §15.4 makes
`production_manager` (plus `administrator` per Addition #3) the *sole*
approval authority for this gate. This closure session's own role
assignment ("production_manager decides approve/reject" for
`raw_material_verification`) makes the same claim independently — the
two sources agreeing is what made this worth investigating rather than
leaving as a curiosity. `quality`'s `supplierDocuments` cell was
already plain `V` (no `Vf` to begin with), so the equivalent leak never
existed for the sibling gate — confirmed by checking, not assumed by
symmetry.

Corrected: `rolePolicy.ts`'s `quality` cell on `rawMaterials` is now
`V` (verify removed), with a new "Correction #4" doc-comment paragraph
explaining the finding in full. `packages/shared/scripts/generate-
role-policy-matrix.ts` was re-run — `git diff` confirmed a single-cell
change in `rolePolicyMatrix.generated.json` (`quality`'s `["view",
"verify"]` -> `["view"]`), nothing else moved. A regression test was
added on both sides of the parity contract: `rolePolicy.test.ts`
(`quality cannot perform the raw-material Production Manager
verification gate`) and `role_policy.rs`
(`quality_does_not_hold_the_raw_material_gate_decide_capability`) —
both assert `can("quality", "rawMaterials", "verify")` is now `false`
while `view` stays `true`. The markdown architecture doc's own §6
table cell is deliberately left showing the original `V,Vf` — this
doc's own established convention (confirmed by reading its existing
prose around the three prior additions) is that the table is a frozen
historical transcription and every deviation from it lives in prose
nearby, never silently edited into the table cells themselves; the
correction's full reasoning is recorded in §6's new closing note
instead.

§6 is now final for Phase 13 — the "not yet domain-expert-reviewed"
flag, repeated in roughly a dozen places across the architecture doc
(§6 itself, §9.2's inventory-table header, §9.3.5, §9.3.6, §9.4.6's
residual-gap list, and Risks items 1/11/13), is retired everywhere it
was genuinely about this review; item 13 (`run_automatic_backup`'s
unauthenticated design) was reworded to no longer imply it was waiting
on this same review, since it never was — that's a separate, still-
open question about backup authentication policy, not the role matrix.

### `cancel_advanced_formulation_optimize` — re-audited on its own facts, not left on precedent

The instruction was explicit: do not leave this ungated only because
other cancel commands are ungated. Read `formulation_advanced.rs` in
full. `AdvancedOptimizerState` is one global `Mutex<Option<Child>>` for
the whole running app process — "one run at a time," a design choice
unchanged since before Phase 13 (the doc comment on the struct
predates this session). There is no per-user or per-session run
identity anywhere in this module to check cancellation ownership
against; starting a *new* run already implicitly cancels whatever was
running before, from any caller, with no ownership check on that path
either — so a per-user ownership check on *cancel* specifically would
be an inconsistent, half-built safety property, not a real one.
Building one (a new "who started this run" field, tracked separately
from the single global slot) would be inventing a run-ownership system
the actual architecture doesn't have — the session brief explicitly
says not to do that unless required.

Is it required? `cancel_current_logic` only kills a spawned child
process and clears the in-memory slot — it never touches `identity.db`,
persisted formulation data, or any regulated collection. The solve's
*result* only ever reaches whichever frontend call to `run_advanced_
formulation_optimize` is waiting on it directly; nothing about a
cancelled run is shared with, or corrupts state for, a different user,
because the only thing genuinely shared across sessions is "is a solve
currently running" — exactly what this command answers. Worst case of
a cross-session cancel: a wasted, interrupted CPU computation for
whoever started it. That is real (mildly annoying) but not a security
or data-integrity property worth inventing new architecture to prevent.

Decision, closed as final: `TRUSTED_INTERNAL_ONLY` for the cancellation
semantics themselves (no run-ownership system invented) — but no
longer authentication-free. The command now takes `app: AppHandle,
token: String` and calls `crate::authz::current_actor_app(&app,
&token)?` before doing anything else, closing the "any raw `invoke()`
with zero login at all" gap it had before — the same minimum bar every
other Phase 13 command already clears. `lib/tauri.ts`'s
`cancelAdvancedFormulationOptimize()` was updated to send
`currentSessionToken()`, the same pattern every other privileged
wrapper uses. First `#[cfg(test)]` block ever added to this file: one
test proving cancel-with-nothing-running is a safe, idempotent no-op —
the property the whole justification above rests on actually holding.

### Last-administrator protection — transactional, matching the existing `bootstrap_administrator` idiom exactly

Session 5's disclosed gap: `change_administered_user_role`/
`set_administered_user_account_status` would happily demote or disable
the sole existing administrator, leaving the installation with no one
able to reach `administrationUsers`/`administrationSecurity`/
`systemAdministration` at all — bootstrap (§5) only ever prevented a
*second* bootstrap administrator, nothing protected the *first* one
afterward.

Two new `identity.rs` primitives, `update_role_guarded`/
`update_account_status_guarded`, each open a `rusqlite::
TransactionBehavior::Immediate` transaction — the exact isolation
`bootstrap_administrator` already uses for its own
check-then-write race — read the target's current role/status inside
that transaction, and, only when the change would actually remove
administrator authority from a currently-*active* administrator (a
demotion away from `Administrator`, or a disable while still
`Administrator`), count *other* administrators who are both role
`administrator` AND status `active` (`other_active_administrators`, a
single parameterized `COUNT(*)` query). Zero others denies the mutation
outright, inside the still-open transaction, before any `UPDATE`
statement runs — so the check and the write are atomic with respect to
any concurrent second admin session doing the same thing; a stale
pre-check read by one session cannot be raced past by another
committing first.

A *disabled* administrator does not count toward the "other active
administrators" total — demoting or disabling the sole *active*
administrator is refused even if a second, disabled administrator
account technically exists, since that second account cannot actually
act as an administrator right now. Disabling still revokes every open
session for the target, exactly as `update_account_status` (Session 1,
unchanged) already did, once the guard has confirmed the mutation is
allowed. A role change for a role that was never `administrator` in
the first place, or a status change for a non-administrator, never
triggers the "other active administrators" query at all — the guard is
structurally a no-op for every mutation it doesn't need to protect.

`admin.rs`'s `change_user_role_logic`/`set_user_account_status_logic`
now take `conn: &mut Connection` (required for
`transaction_with_behavior`) and call the guarded primitives instead of
the original, still-present, unguarded `update_role`/
`update_account_status` (left untouched — used by call sites elsewhere
that don't route through the admin-management commands, e.g. the
original Session 1 role-storage primitive itself). A denial is audited
before the error is returned —
`admin_user_role_change_denied`/`admin_user_status_change_denied`, with
a `reason=last_active_administrator` detail field and nothing else —
confirmed by a dedicated test that the audit row contains no password,
hash, or token value anywhere in its serialized form.

7 new tests in `admin.rs`: the sole active administrator cannot be
demoted; cannot be disabled; with two active administrators, one may be
demoted (the other remains a valid backup); one may be disabled (same);
a disabled administrator does not count as a backup for a second,
still-active administrator's own check; the denial is audited without
leaking secrets; a role change for a non-administrator account never
even runs the last-admin query. Three pre-existing `admin.rs` tests
were adapted for the `&mut Connection` signature change (mechanical,
no behavior change) and continue to pass; a real bug caught in the
process — a test referenced `updated.accountStatus` (camelCase), but
Rust struct field access always uses the field's own name
(`account_status`) regardless of `#[serde(rename_all = "camelCase")]`,
which only affects JSON serialization — caught by `grep` before running
tests, no test failure occurred.

Frontend: `Administration → Users`' existing generic error display
(`role="alert"` in `UsersPanel.tsx`, unchanged since Session 5) already
surfaces whatever string a failed command rejects with, verbatim — so
the guard's own descriptive denial message ("cannot change this role:
it is the last active administrator") reaches the user with zero new
frontend code. The missing piece was the backend's error string, not
the display mechanism.

### Verification

`cargo build --lib`: clean. `cargo test --lib`: 328/328 passing
(Session 5's 314 + 14 new: 9 `workflow_gates.rs` + 1 `role_policy.rs` +
7 `admin.rs` − 3 adapted, net +14 across the whole crate + 1
`formulation_advanced.rs`). `cargo clippy --lib -- -D warnings`: clean,
re-checked after every batch of changes, not just once at the end.
`packages/shared`: `tsc --noEmit` clean; `vitest run`: 1302/1302
passing (Session 5's 1301 + 1 new), including
`rolePolicy.matrixParity.test.ts` confirming the regenerated JSON
fixture still matches `fullMatrixSnapshot()` exactly. `apps/desktop`:
`tsc --noEmit` clean; `vitest run` (full suite): 1197/1197 passing —
unchanged from Session 5's count, since the new gate panels have
existing indirect coverage through `ApprovalPanel.test.tsx`'s 20 tests
(all still pass with the two new production-gate panels rendered
inside the workspace) and no dedicated new frontend test file was
fabricated just to inflate a count; `ApprovalPanel.test.tsx` itself was
re-run specifically to confirm this. `eslint` clean on every touched
frontend file (`workflowGates.ts`, `WorkflowGatePanel.tsx`,
`MaterialEditor.tsx`, `SupplierEditor.tsx`, `ApprovalPanel.tsx`,
`MaterialsPage.tsx`, `tauri.ts`). i18n parity (`parity.test.ts`, 23
tests): passing — every new key (`workflowGate.*`,
`materials.verification*`, `supplier.verificationGate`,
`approval.workflowGates*`/`handoffGate`/`releaseGate`) was given a real
translation in all 8 shipped locales, not left as an English-only
fallback in the 6 that sometimes carry one for other sections; each
locale file's JSON was also validated with a direct `JSON.parse` pass
before running the test suite, to catch a malformed edit before it
could surface as a confusing test failure. `git diff --check`: clean
(line-ending-normalization warnings only — this repo's CRLF-on-touch
convention on Windows — no actual trailing-whitespace or
merge-conflict-marker errors).

### Closure

Files changed: 5 modified Rust files (`identity.rs`, `admin.rs`,
`formulation_advanced.rs`, `masterdata.rs`, `workflow_gates.rs`,
`role_policy.rs` — 6 modified), 3 modified shared-package files
(`rolePolicy.ts`, `rolePolicy.test.ts`,
`rolePolicyMatrix.generated.json`), 1 modified frontend file
(`tauri.ts`) + 1 new (`workflowGates.ts`), 1 new frontend component
(`WorkflowGatePanel.tsx`), 3 modified frontend components
(`MaterialEditor.tsx`, `SupplierEditor.tsx`, `ApprovalPanel.tsx`), 1
modified route (`MaterialsPage.tsx`), 1 modified lint config
(`.eslintrc.cjs`), 8 modified locale files (new `workflowGate.*`/
`materials.verification*`/`supplier.verificationGate`/
`approval.workflowGates*` keys, real translations), 2 modified Phase 13
docs (architecture §26 + closing notes, test matrix §M) + the handoff,
this external log. Pre-existing, out-of-scope local changes
(`docs/generated/*`, `formulas/*` deletions, the two Phase 11/12
external-log files) confirmed untouched via `git status` before and
after.

**Exact next session**: **Phase 13 Session 6**: brute-force/lockout
wiring confirmation, full audit-event coverage from every real command,
the complete SQL-injection + privilege-escalation regression suite
against the now-fully-wired-up command surface, and native Windows
multi-user acceptance testing. This closure session's own residual, not
closed: no admin UI to inspect/list all workflow gates across subjects
— not one of the five named residual warnings, left open rather than
scope-crept into.

## Phase 13 Session 6 — brute-force/lockout confirmation, full audit coverage, SQL-injection + privilege-escalation regression, native acceptance (2026-08-16)

Starting point: the closure session's close (HEAD `3fb13fb`). Scope per
the closure session's own "exact next session" line and §25's session
plan items 6-7: (1) brute-force/lockout wiring confirmation, (2) full
security-audit coverage across the real authenticated command surface,
(3) complete SQL-injection regression coverage, (4) complete
privilege-escalation/authorization-bypass regression coverage, (5)
native Windows multi-user acceptance testing. Does not start Session 7.
Does not implement Phase 14. Does not revisit already-closed Session
4A/5/closure-session work except where this session's own testing found
a real, provable gap — two did (below); no stylistic changes were made
anywhere else. Does not touch real user/business data,
`.FormuLab/runs.db`, `%APPDATA%\com.formulab.app`, OneDrive FormuLab
data, unrelated generated docs, unrelated `formulas/*` changes,
release/signing work, or unrelated external logs — confirmed via
`git status` before and after.

### 1. Brute-force/lockout — confirmed; one real defense-in-depth gap closed

The real login command path — `auth.rs::login_logic`, not just
`identity.rs`'s storage primitives — was read in full and cross-checked
against every property the session brief listed: 5 failed attempts
trigger the configured lockout
(`four_failures_do_not_lock_a_fifth_does_and_success_resets`); lockout
persists across a database reopen
(`lockout_state_persists_across_a_database_reopen`, opens a fresh
`Connection` against the same on-disk file — a real process-restart
proxy, not just an in-memory check); all four failure shapes (unknown
username, wrong password, disabled account, locked account) return the
byte-identical `GENERIC_LOGIN_ERROR` constant, so leaking account
existence via a distinguishable error string is structurally
impossible, not just avoided by convention; a successful login resets
the failure counter
(same test, first half); an expired lock allows login again
(`an_expired_lock_allows_login_attempts_again`, forces `locked_until`
into the past directly — no real sleep); session expiry, idle timeout,
and revocation are each independently proven
(`an_expired_session_is_rejected_by_current_session_logic`, `identity::
tests::a_session_idle_past_the_timeout_no_longer_validates_even_
before_absolute_expiry`, `logout_revokes_the_session_and_it_no_longer_
validates`); role change takes effect on the very next session check
(`a_role_change_is_reflected_on_the_very_next_session_check`). Every one
of these was already correct — **no policy or behavior change was
made**, per the explicit instruction to fix only proven gaps.

One real coverage gap found: `identity::validate_session` independently
re-checks the account's *live* `status` on every single call (line
830-832 of `identity.rs`, `if user.status != "active" { return Ok(None)
}`) — a genuine second, structurally separate layer from session
revocation (`update_account_status` always revokes on disable *today*,
but `validate_session`'s own status check is what would still close the
door if any future code path ever changed `status` without also
revoking). This layer had never been isolated and directly exercised on
its own — only ever incidentally proven through the revocation side
effect (`update_account_status_disabling_revokes_every_open_session`).
New test, `identity::tests::validate_session_independently_rechecks_
account_status_not_just_revocation`: disables a user's `status` via a
raw `UPDATE users SET status = 'disabled'` — deliberately bypassing
`update_account_status` and its revocation side effect entirely,
confirmed by reading back `revoked_at IS NULL` on the session row
immediately before the real assertion — and proves `validate_session`
still refuses the session. This is additive test coverage, not a
behavior change; the property it proves was already true, just
unproven directly.

### 2. Full security-audit coverage — one real, systemic gap found and closed

Every call site of `identity::record_security_audit_event` across the
whole crate was inventoried (`authz.rs`, `admin.rs`, `auth.rs`,
`identity.rs` — 4 files, matching the closure session's own state),
then cross-referenced against every file that calls
`authz::authorize`/`authorize_app`/`authorize_any`/`authorize_any_app`
(10 files total: `automatic_backup.rs`, `migration.rs`,
`data_location_manager.rs`, `backup.rs`, `workflow_gates.rs`,
`masterdata.rs`, `admin.rs`, `formulations.rs`, `materials.rs`,
`attachments.rs`).

**Finding**: System Administration mutations — `backup::{create_
backup, restore_backup}`, `data_location_manager::{move_data_location,
use_existing_data_location, restore_default_data_location, resume_
interrupted_data_move, cleanup_old_data_location}`, `migration::
create_pre_migration_backup`, `automatic_backup::{write_automatic_
backup_config, apply_pre_migration_retention}` — 11 commands total,
every one already gated `systemAdministration`/`administer` — wrote
**zero** `security_audit_events` rows on success. This includes
`restore_backup`, whose own doc comment in `backup.rs` calls it "the
single highest-risk system-administration command in the Session 3
inventory — restoring overwrites real project data wholesale." An
unauthorized *attempt* at any of these was already caught by `authz::
authorize`'s generic `authorization_denied` audit (the shared guard
every one of these commands already goes through) — but a *successful*
backup restore, data-location move, or schema migration left literally
no trace in the security-history view an administrator would check
after the fact.

**Decision on scope**: formulation saves, masterdata edits, approval
decisions, and the four workflow-gate submissions/decisions were
deliberately **not** given new `security_audit_events` rows. Each
already has its own established, adequate, actor-attributed audit
trail — `formulations::append_audit_event`/`audit.jsonl` per
formulation, `WorkflowGateRecord.history` (actor id/role/display
name/timestamp/reason on every transition, built into the gate record
itself), `ApprovalRecord`'s own history — a settled Session 4/4A/
closure-session architectural boundary this session's brief explicitly
says not to re-litigate absent a proven regression, and duplicating
already-adequately-audited business content into a second audit system
would be exactly the "noisy audit spam without reason" the brief
separately warns against. `materials::import_materials` (gated
`rawMaterials`, business content) was left on the same footing as
`masterdata.rs`'s other write commands for the same reason.

**Closed**: all 11 System Administration commands now open
`identity.db` once via `identity::open_identity_db` and call
`authz::authorize(&conn, ...)` — replacing the `authz::authorize_app`
convenience call that opened and silently discarded its own connection
— so the resolved `actor` is available afterward. Each records a
`success`/`failure` `security_audit_events` row using the actor's real
identity and a non-secret detail (a destination/source path, a boolean,
a count, a run id — never a password/hash/token). Where a natural
single `result` binding already existed before the final return
(`create_backup`, `restore_backup`, `move_data_location`, `use_
existing_data_location`, `resume_interrupted_data_move`, `cleanup_old_
data_location`), both success and failure are audited; the remaining
two (`restore_default_data_location`, `write_automatic_backup_config`,
`create_pre_migration_backup`, `apply_pre_migration_retention`) audit
success unconditionally at their point of completion — a functional
failure on an already-authorized admin action is lower security
signal than an unauthorized *attempt*, which the shared guard already
audits regardless. New action names:
`system_backup_created`/`system_backup_restored`/`data_location_
moved`/`data_location_existing_used`/`data_location_restored_to_
default`/`data_location_move_resumed`/`data_location_old_cleaned_up`/
`pre_migration_backup_created`/`automatic_backup_config_changed`/
`pre_migration_backup_retention_applied`.

**F2 (test matrix), also closed**: a genuine single-pass, full-write-
surface fuzz/property test —
`admin::tests::no_security_audit_or_login_attempt_row_ever_contains_a_
secret_across_the_full_write_surface` — bootstraps an administrator,
exercises login success/failure/lockout, an admin-created user's
initial password, and an admin password reset, threading nine
distinct, deliberately unique secret values through six different
write paths, then scans every `security_audit_events` and
`login_attempts` row the whole run produced against all nine secrets
plus both real stored password hashes and a raw session token. This is
broader than, and does not duplicate, the pre-existing per-action spot
checks (`audit_detail_never_contains_a_password_or_hash`, `auth.rs`'s
own equivalent) — those still cover their specific scenarios; this is
the first test proving the property holds across the *combined* output
of a real multi-action session in one pass, matching F2's own "scans
every inserted row" wording literally rather than approximately.

### 3. SQL-injection regression — confirmed parameterized everywhere; two new command-boundary tests

Every `format!`/string-built SQL statement in the identity/admin/
security surface was found and individually inspected
(`grep`, not inference): `identity.rs` has exactly three, all
interpolating `USER_COLUMNS`, a `const &str` fixed column list —
never a caller-supplied value — confirmed safe by reading the constant
declaration directly, not assumed. No other file in this surface builds
SQL text from a variable at all; every write goes through `rusqlite`'s
`params![...]` binding. This structurally confirms the brief's own
question ("confirm all SQL remains parameterized") for the whole
surface in one pass, not command-by-command.

`username` injection is already exhaustively covered — the storage-
layer hostile-string battery (`identity.rs`) and the full command-path
battery through `login_logic` (`auth.rs`) — deliberately not repeated,
per the explicit instruction against redundant matrices. Two query
boundaries this session found were genuinely new — no existing test
reached them:

`admin::tests::admin_profile_fields_are_inert_against_hostile_input_
never_executed`: `display_name`/`department`/`employee_reference` are
free-text `TEXT` columns with **no charset restriction** at all, unlike
`username` — meaning most of a hostile battery (quotes, `'; DROP TABLE
users;--`, boolean injection, SQL comments, an RTL-override/zero-width
unicode string) actually reaches SQL as literal parameterized data
instead of being pre-filtered by validation before it gets there, a
stronger proof that parameterization itself holds than `username`'s own
battery gives (most of which never reaches SQL, being charset-rejected
first). Run through both the INSERT path (`create_administered_user_
logic`) and the UPDATE path (`update_user_profile_logic`) against a
pre-existing victim account. Every value round-trips byte-for-byte; the
`users` table is never dropped; the victim row and every hostile-value
row created are exactly the expected count, no more, no fewer. A
companion case confirms an oversized `display_name` (which *does* have
its own 200-character policy limit) is cleanly rejected before ever
reaching SQL — the same D5/"excessive length" property re-confirmed at
this specific command boundary, not a new finding; this was caught
mid-development when an early version of the test wrongly expected the
oversized value to succeed like the others and failed loudly with
`"display name is required"` — the test was the one that needed fixing,
not the product.

`admin::tests::admin_commands_treat_a_hostile_or_malformed_user_id_as_
simply_not_found`: the `UPDATE users SET ... WHERE id = ?`/`SELECT ...
WHERE target_user_id = ?` query shape every admin mutation
(`update_user_profile_logic`, `change_user_role_logic`, `reset_user_
password_logic`, `set_user_account_status_logic`) and `list_security_
audit_events`'s scoping share — never exercised by any existing test.
A 6-entry hostile `user_id` battery (boolean injection, `DROP TABLE`, a
*real* account's own id with a trailing SQL-comment suffix appended — a
targeted attempt to make a hostile id resolve to a real row via comment
truncation — an oversized string, an empty string) is run through all
four mutations plus the audit-history query. Every one is refused (or,
for the read-only audit query, simply returns no rows) — the real,
pre-existing account's role, status, and display name are all confirmed
unchanged afterward, proving no hostile id ever accidentally matched or
widened the query's scope.

### 4. Privilege-escalation/authorization-bypass suite — checklist walked item by item

Every item on the session brief's adversarial list was checked against
what Sessions 1-5 and the closure session already proved: role/identity
spoofing (structurally impossible — `authz::current_actor`/`authorize`
have no role/userId/displayName parameter for a caller to supply, at
all, proven by `authz.rs`'s own structural test), researcher attempting
manager approval and worker attempting to decide its own gate (`role_
policy.rs`'s worker/manager-separation tests, `workflow_gates.rs`'s own
structural proofs), non-admin managing users/changing roles/resetting
passwords (§E1-E3, `role_policy::tests::only_administrator_can_manage_
users_or_view_security_history`), unauthorized masterdata/formulation
mutation (`masterdata.rs`/`formulations.rs`'s existing tests),
unauthorized System Administration action (`role_policy::tests::only_
administrator_has_any_capability_on_system_administration`), direct raw
`invoke()` bypassing the frontend (structural — every command
re-authorizes server-side regardless of caller), stale token after
disable/role-change (§1 above plus the pre-existing role-change test),
revoked/expired/idle-timed-out/malformed tokens (`identity.rs`/
`auth.rs`'s own extensive coverage), cross-subject workflow-gate misuse
and invalid-prerequisite bypass (the closure session's `a_version_id_
belonging_to_a_different_formulation_is_not_found` and the four gates'
prerequisite tests), last-active-administrator bypass attempts (the
closure session's 7 tests), and the finalized `quality` correction (this
session's own re-confirmation plus the closure session's original
tests) — all already, genuinely proven. No behavior change was needed
for any of these; re-reading and cross-checking them against the
brief's checklist is itself part of this session's confirmation work,
even where it produced no code change.

Two items had **no direct, standalone test before this session** —
only strong structural inference from other tests:

`role_policy::tests::administrator_never_holds_create_or_edit_on_any_
scientific_content_area` (new): the first *positive-denial* proof, not
merely "no cell happens to grant it," that administrator lacks
`create`/`edit` on all nine scientific/business-content areas
(`formulation`, `laboratory`, `stability`, `optimization`,
`rawMaterials`, `supplierDocuments`, `regulatory`,
`productionEngineering`, `production`) simultaneously, across every one
of the 12 roles' worth of matrix cells this touches, in one assertion —
while confirming `view` is still granted on each, so this isn't
mistaking a missing area for a missing capability.

`formulation_advanced::tests::cancel_is_refused_without_a_valid_
session_no_matter_what_token_shape_is_sent` (new): the closure
session's own `cancelling_when_nothing_is_running_is_a_safe_no_op` test
only ever called `cancel_current_logic` directly — it never proved the
command's own `authz::current_actor` gate in front of it actually runs
and actually refuses a bad caller. Closing this required a small,
low-risk refactor identical in shape to every other Phase 13 command:
extracting `cancel_advanced_formulation_optimize_logic(conn:
&rusqlite::Connection, token: &str, state: &AdvancedOptimizerState)`
from the `#[tauri::command]` wrapper (which now just opens `identity.db`
and delegates) — no behavior change, `cancel_current_logic` itself
completely untouched. An empty string, a plain garbage string, a
SQL-injection-shaped string, and a 10,000-character string are all
refused before reaching `cancel_current_logic` at all. A companion
test, `cancel_succeeds_for_a_caller_with_a_genuinely_valid_session`,
bootstraps a real user with a real session token and confirms the call
*does* succeed (returning `false`, since nothing was actually running)
— proving the gate discriminates correctly rather than simply refusing
everything.

### 5. Native Windows multi-user acceptance testing — honestly scoped, partially executed

Every named acceptance flow's *backend logic* — login/logout across
distinct accounts, role-specific allow/deny for every one of the 12
roles, admin user management, role-change and disable taking immediate
effect on the very next session check, the worker-submit/manager-decide
gate state machine including resubmission, production prerequisite
blocking, last-administrator protection in both single- and
two-administrator scenarios, and the unauthenticated-cancel rejection
— is proven through the real production Rust code paths by this
session's 335-test full suite and every prior session's tests it builds
on, none of it a parallel test-only permission model. `cargo build`
(the full application binary target, not `cargo build --lib`, which
this session had been running throughout for speed) was run once at
the end specifically to confirm the actual shippable Windows binary
still compiles cleanly after every change this session made — it does.

**Interactive native-GUI acceptance testing was not executed.**
Launching the compiled `formulab.exe`, creating multiple real local
FormuLab accounts across the roles the brief listed, switching between
them, and visually confirming role-specific UI visibility/denial
messaging, System Administration screen access, and the worker-submit
→ manager-approve UI flow all require driving and observing a native
Windows GUI window. This session's available tooling (Bash/PowerShell
for the shell; a Chrome-browser-automation toolset that only reaches
web pages loaded inside Chrome) has no capability to launch, click
through, or screenshot a native Tauri application window. Attempting to
launch the raw debug binary without its paired Vite dev server running
was considered and deliberately not attempted: without the frontend
dev server or a built `frontendDist`, the webview would very likely
fail to load content for reasons unrelated to any real application bug
(a missing dev-server URL, not a defect), risking a misleading false
finding for no real diagnostic value. This is recorded here, in the
architecture doc (§27.5), the test matrix (§N.8), and the handoff as a
genuine, disclosed, still-open manual acceptance item — not claimed
complete, and not silently omitted either.

### Verification

`cargo build --lib`: clean. `cargo build` (full binary): clean. `cargo
test --lib`: 335/335 passing (the closure session's 328 + 7 new — §1's
1, §2's 1, §3's 2, §4's 2). `cargo clippy --lib -- -D warnings`: clean,
re-checked after every batch of changes. `packages/shared`: `tsc
--noEmit` clean; `vitest run`: 1302/1302 passing — unchanged, no
shared-package file touched this session. `apps/desktop`: `tsc
--noEmit` clean; `vitest run` (full suite): 1197/1197 passing —
unchanged, no frontend file touched this session; i18n parity
(`parity.test.ts`, 23 tests) re-run anyway and passing, since this was
a cross-cutting security session even though nothing frontend actually
changed. `git diff --check`: clean (line-ending-normalization warnings
only — this repo's CRLF-on-touch convention on Windows — no actual
whitespace or merge-conflict-marker errors).

### Closure

Files changed: 6 modified Rust files carrying new tests
(`identity.rs`, `admin.rs`, `role_policy.rs`, `formulation_advanced.rs`
— 4 files with new tests) plus 4 modified Rust files carrying the new
System Administration audit wiring with no new tests of their own
(`backup.rs`, `data_location_manager.rs`, `migration.rs`,
`automatic_backup.rs`) — 8 Rust files total (`formulation_advanced.rs`
appears in both the new-tests and the wiring-change sets, for its
testability refactor). 1 Phase 13 doc (architecture — new §27, §9.4.1's
stale row corrected, Risks items updated) + the test matrix (F1-F3
corrected, new F4, new §N) + the handoff, this external log.
Pre-existing, out-of-scope local changes (`docs/generated/*`,
`formulas/*` deletions, the untracked Phase 11/12 external-log files)
confirmed untouched via `git status` before and after — no frontend or
shared-package file was touched this session at all, confirmed by the
same `git status` check.

**Exact next session**: **Phase 13 Session 7** — or, if a human
reviewer judges the disclosed native-GUI-acceptance gap (§5 above,
§27.5 of the architecture doc) acceptable to carry forward rather than
block on, Phase 13 may be considered ready for whatever the next phase
of work is; this session does not make that determination itself, only
discloses the gap honestly for a human to decide on.

## Phase 13 closure (2026-08-16)

The human reviewer made the determination Session 6 explicitly left
open: accept the disclosed native Windows GUI multi-user acceptance
gap (§27.5 of the architecture doc, §5 of Session 6's own entry above)
as a **release-preparation manual acceptance item**, not a Phase 13
development blocker.

**Closure actions, documentation only — no code changed:**

- Phase 13 architecture doc: new §28 records the decision verbatim,
  states Phase 13 is CLOSED as implementation-complete, and confirms
  the native-GUI item is not claimed executed anywhere. The gate-
  listing admin UI (§9.4.6 item 5) is recorded as a future UX
  enhancement, explicitly not a blocker — the four gates' own domain-
  local UI already provides real, working coverage; this is a
  convenience improvement for auditing many gates at once, nothing
  about authorization depends on it.
- `docs/RELEASE_MANUAL_ACCEPTANCE_CHECKLIST.md` (new) — the native-GUI
  acceptance item's new home: concrete, checkable steps (bootstrap,
  login/logout/switching, role-specific UI, `Administration → Users`,
  role-change/disable taking immediate effect, last-administrator
  protection, the four workflow gates' submit/approve/reject/resubmit
  flow, production prerequisite blocking, System Administration
  access), a stated prerequisite (a real Windows machine, disposable
  test data only), and an honest "not yet executed" status — not a
  vague "test manually" line with nothing to actually check off. This
  file is a durable home for any future release-blocking manual item
  any phase discloses, not a one-off note that gets lost.
- Phase 13 test matrix: a closure note confirming every test in the
  file reflects real, passing coverage as of Session 6, and that the
  native-GUI item was never claimed passing there — it's tracked
  separately, honestly, not silently folded into a "done" count.
- Phase 13 handoff (`docs/handoffs/PHASE13_CURRENT.md`): rewritten for
  closure — status, what was and wasn't done, the three items carried
  forward (native-GUI acceptance, the gate-listing UI, `run_automatic_
  backup`'s still-open unauthenticated-design question), and "no
  Phase 13 session planned" as the exact next step.
- `docs/architecture/IMPLEMENTATION_STATUS.md`: Phase 13's entry
  updated to reflect closure.

**No Session 7 was opened.** There was nothing left in Phase 13's
automatable scope to re-test — Session 6 already closed every item a
session running in this environment can actually execute. Opening a
Session 7 to repeat that same automated testing would have been
scope-less busywork, not real work; the brief this closure step
executed under said exactly that explicitly.

**Verification**: documentation-only change, no Rust/TypeScript/Python
file touched by this closure step itself (Phase 14's Session 0, a
separate piece of work executed immediately after this closure in the
same run, is recorded in its own external log). `git status` confirmed
before and after: only the closure's own doc edits plus Phase 14's own
new files changed; every pre-existing, out-of-scope local change
(`docs/generated/*`, `formulas/*` deletions, the Phase 11/12 external
logs) remained untouched.

**Phase 13 is closed.** This is the final entry in this external log
for Phase 13's own work. Phase 14 (Evidence-Driven Hybrid Literature &
Formulation Intelligence) begins its own external log separately:
`C:\Users\sekip\Desktop\FormuLab-Phase14-Literature-Formulation-
Intelligence-Log.md`.
