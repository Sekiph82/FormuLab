# Phase 13 — Enterprise Identity, Authentication, Fixed RBAC & Application Security

**Status: Session 1 (identity database + password subsystem + final 12-role model) complete. No login/bootstrap UI, no Administration → Users UI, no application-wide enforcement yet — those are later Phase 13 sessions. This document is the design they build against.**

**Session 1 correction, superseding Session 0's role list**: Session 0 shipped a first-draft 6-role model. After reviewing the real FormuLab dossier/evidence/document workflow, the user approved a final, authoritative **12-role** model (§1). Every "6 roles" statement in the original Session 0 text has been rewritten below — nowhere in this document should you find a claim that FormuLab has 6 fixed roles.

## 0. Why this phase exists

FormuLab today is a single-user local desktop app: every "who did this"
field in the domain layer (`Actor.userId`) is either hardcoded to the
literal string `"local"`, or a free-text field the user types into a
panel. There is no login, no user database, no password, no session.
Selling FormuLab into labs/QA/regulatory/production departments requires
a real, closed, enterprise-only identity system: administrator-created
accounts, username + password login, and a fixed 12-role permission
model — no public sign-up, no email/SMS verification, no mandatory
external identity provider, no per-user permission customization.

---

## 1. The final 12 fixed roles (authoritative, Session 1)

| Group | Roles |
|---|---|
| R&D / Laboratory | `researcher`, `research_manager` |
| Quality | `quality`, `quality_manager` |
| Regulatory | `regulatory` |
| Materials / Supply | `raw_material`, `procurement` |
| Production | `production_engineering`, `production`, `production_manager` |
| Document Management | `document_control` |
| System | `administrator` |

These are fixed application roles — not user-created, not editable, no
custom permission sets, no `role_permissions`/`user_permission_overrides`
tables, no per-user permission checkboxes. **User gets a role. User does
not get individual permissions.** Implemented Session 1 as
`identity::Role` (a 12-variant Rust enum, `src-tauri/src/identity.rs`)
and mirrored in TypeScript as `packages/shared/src/schemas/status.ts`'s
`APPROVAL_ROLES`/`ApprovalRole` — the exact same 12 strings on both
sides (`researcher`, `research_manager`, `quality`, `quality_manager`,
`regulatory`, `raw_material`, `procurement`, `production_engineering`,
`production`, `production_manager`, `document_control`,
`administrator`).

### 1.1 Role intent (business meaning, drives §5's workflow matrix)

- **`researcher`** — Formulation-development and laboratory work:
  create/edit experimental formulations where allowed, create lab
  trials, enter test results and observations, work with stability/
  laboratory records, prepare work for manager review. Cannot
  self-approve work that requires `research_manager` approval.
- **`research_manager`** — R&D/Laboratory managerial authority: reviews
  researcher work, approves/rejects laboratory-stage completion,
  approves formulation/laboratory readiness for downstream workflow,
  returns work for correction. **Critical rule**: researcher completion
  is not departmental approval — work stays blocked from the next
  controlled stage until `research_manager` approves it.
- **`quality`** — QA/QC working role: quality checks, inspections,
  test/result review, quality evidence, non-conformance working
  records, prepares quality work for `quality_manager` review. Cannot
  self-approve a `quality_manager`-reserved stage.
- **`quality_manager`** — Quality managerial authority: reviews QA/QC
  work, quality-stage approval/rejection, release/hold decisions where
  the role matrix assigns them, returns quality work for correction,
  authorizes leaving a quality-manager-controlled stage. Same
  completion-≠-approval rule as research_manager.
- **`regulatory`** — Regulatory Affairs, kept as **one** fixed role
  (not split into employee/manager tiers) per explicit instruction:
  regulatory review, dossier work, regulatory evidence verification,
  claims/regulatory assessment, jurisdictional review, and whatever
  approval/rejection/verification/supersession operations the role
  matrix defines.
- **`raw_material`** — Raw Material / material-management technical
  role: raw-material records, specifications, SDS/TDS/COA/certificates,
  raw-material technical status, material suitability information,
  material-related records used by formulation/dossier workflows. Does
  **not** automatically get Procurement authority.
- **`procurement`** — Procurement / Supplier Management: supplier
  information/documentation, obtaining supplier/manufacturer
  documents, supplier declarations, received SDS/TDS/COA/certificates,
  supplier qualification records, procurement-side document
  completeness. Collecting a document is **not** the same as
  scientifically verifying or approving it — collection, technical
  verification, quality approval, and regulatory approval stay
  separate concepts, never conflated under one role.
- **`production_engineering`** — Scale-up/industrialization: production
  readiness engineering, manufacturing process preparation, process
  parameters, routing/process linkage, technical transfer from
  development toward manufacturing, production feasibility, engineering
  changes, manufacturing instructions where supported. Must not bypass
  upstream required approvals — technical accessibility is not
  production approval.
- **`production`** — Production operational role: production execution,
  batch/process records, manufacturing operational entries,
  production-stage data, permitted shop-floor actions. Does not grant
  manager-level production approval unless the role matrix explicitly
  says so.
- **`production_manager`** — Production managerial authority:
  production-stage review, approval/rejection, release decisions,
  management-level manufacturing signoff, returns production work for
  correction. Where configured as a required gate, downstream work
  stays blocked until it passes.
- **`document_control`** — Document Control / Technical Documentation —
  **not** a scientific approval role by default: document package
  completeness, revision control, correct released-document version,
  document publication/export, controlled external-system upload,
  recording external publication, obsolete-document prevention,
  document distribution, dossier/package administrative completeness.
  Does **not** automatically gain formulation/laboratory/QA scientific
  approval, or regulatory verification, or production approval, unless
  a specific policy explicitly says otherwise.
- **`administrator`** — System/IT administration: create/disable/enable
  users, reset passwords, assign/change roles, inspect security audit
  history, manage application/system settings. **User-approved
  exception**: administrator also retains scientific approval authority
  (§9), specifically so IT can exercise/test every workflow gate — this
  does not make administrator a scientific-content editor (§9 explains
  the exact boundary).

No `packaging` role exists or was created — packaging-related actions
map onto the roles above (researcher/research_manager for formulation-
side packaging compatibility work, quality/quality_manager for QA
review, regulatory for compliance, production_engineering for
manufacturing-side packaging, document_control for
artwork/packaging-document publication) based on the app's actual
current behavior, per explicit instruction not to invent a new role.

---

## 2. Current-state audit (Session 0, unchanged findings)

Audited: `packages/shared/src/schemas/status.ts` (Actor/ApprovalRole),
every `packages/shared/src/engine/*.ts` file touching approval/
regulatory authorization, every frontend site that constructs an
`Actor`, `apps/desktop/src-tauri/src/formulations.rs`'s
`save_approval_record`, `apps/desktop/src-tauri/capabilities/default.json`,
`apps/desktop/src/app/routes/AdministrationPage.tsx`, `SECURITY.md`,
every `rusqlite` call site, and every Rust file for `password`/`login`/
`authenticate` tokens.

| Capability | Status | Evidence |
|---|---|---|
| User accounts | **MISSING** (Session 1: identity.db now exists, not yet wired to any command) | — |
| Administrator-created users | **MISSING** | No creation flow/UI exists yet |
| Username login | **MISSING** | No login screen; app opens directly to `HomePage` |
| Password authentication | **PARTIAL** (Session 1: `hash_password`/`verify_password` implemented and tested; no login command uses them yet) | `identity.rs` |
| Logout | **MISSING** | No session UI to log out of |
| Password hashing | **IMPLEMENTED** (Session 1) | Argon2id, `identity.rs` |
| Account enable/disable | **PARTIAL** (Session 1: `update_account_status` implemented + tested, incl. session revocation; no admin UI) | `identity.rs` |
| Administrator password reset | **PARTIAL** (Session 1: `update_password_hash` implemented + tested; no admin UI) | `identity.rs` |
| Brute-force protection / login throttling | **PARTIAL** (Session 1: `update_login_state` lockout logic implemented + tested; not wired to a login command yet) | `identity.rs` |
| Authenticated session | **PARTIAL** (Session 1: `create_session`/`validate_session` implemented + tested; no login command issues one yet) | `identity.rs` |
| Session expiration / idle timeout | **PARTIAL** (expiry implemented + tested; idle-timeout policy not yet decided) | `identity.rs` |
| Role storage (trusted) | **PARTIAL** (Session 1: `users.role`, constrained to the 12 fixed roles by `Role::parse`; not yet the source any command trusts) | `identity.rs` |
| Role assignment (by admin) | **MISSING** | No admin UI |
| Role enforcement (domain-level) | **PARTIAL** | `canTransitionTo` (`status.ts`) is real, tested, working enforcement, now re-derived for the 12-role model (§6) |
| Role enforcement (backend/Rust) | **UNSAFE** (unchanged from Session 0) | `save_approval_record` performs no role check at all — see Session 0's original finding, still true, not yet fixed (Session 4) |
| UI role selection | **UNSAFE** (unchanged from Session 0) | `reviewerRole`/`actorRole`/`actingRole` are still plain, freely-editable `useState`s — Session 1 only renamed their default/option values to the new 12 roles, it did not add authentication underneath them |
| Project/resource access | **NOT_APPLICABLE (confirmed out of scope for Phase 13)** | See §12 |
| Audit logging (security events) | **PARTIAL** (Session 1: `record_security_audit_event` implemented + tested; nothing calls it yet outside tests) | `identity.rs` |
| SQLite/user database | **IMPLEMENTED** (Session 1) | `identity.db`, app-private, §11 |

Explicitly **NOT REQUIRED**, confirmed absent and staying that way:
public registration, email verification, SMS/phone verification,
social login, email-based password recovery, consumer account
creation.

### 2.1 The one piece of real, valuable existing infrastructure: `canTransitionTo`

`packages/shared/src/schemas/status.ts` encodes the load-bearing safety
rule this phase must not weaken: an approval status (`pilot_approved`,
`production_approved`) can only be reached by a `{kind: "human"}` actor
whose role is in `APPROVAL_AUTHORITY[to]`, with a signed
`ApprovalRecord`. Agents, imports, and system processes are refused by
type. Session 1 re-derived `APPROVAL_AUTHORITY` for the 12-role model
(§6.2) — the mechanism is unchanged, only the role lists inside it.

---

## 3. User entity design (implemented Session 1, `identity.rs::User`)

```rust
pub struct User {
    pub id: String,                       // "usr_" + timestamp + random hex — immutable
    pub username: String,                 // as typed, display casing preserved
    pub normalized_username: String,      // trimmed + ASCII-lowercased — the real uniqueness key
    pub display_name: String,
    pub password_hash: String,            // Argon2id PHC string; #[serde(skip)] — never serialized out
    pub role: Role,                       // one of the 12 fixed roles
    pub status: String,                   // "active" | "disabled"
    pub department: Option<String>,
    pub employee_reference: Option<String>,
    pub must_change_password: bool,       // true by default on create/reset — see §8
    pub failed_login_count: i64,
    pub locked_until: Option<String>,
    pub created_at: String,
    pub created_by: Option<String>,
    pub updated_at: String,
    pub last_login_at: Option<String>,
}
```

Deliberately absent: email, phone, avatar, per-user permission rows,
password history (no concrete requirement demands it yet).

---

## 4. Username rules (implemented Session 1, `identity::validate_username`/`normalize_username`)

- **Length**: 3–64 characters.
- **Allowed characters**: ASCII letters, digits, `.`, `_`, `-` only. No
  spaces (rejected outright, never silently stripped).
- **Case sensitivity**: login/uniqueness is case-**insensitive**
  (`ahmet.yilmaz` == `Ahmet.Yilmaz`); `username` (original casing) is
  kept only for display.
- **Unicode**: rejected outright by the ASCII-only charset rule — which
  also means NFC/Unicode normalization is unnecessary in practice: any
  input that would need it never reaches the database at all. (This
  simplifies Session 0's original design, which anticipated needing
  Unicode normalization; Session 1's actual implementation found the
  ASCII-only charset makes that moot, and doesn't add an unnecessary
  dependency for it.)
- **No email-format requirement**: `ahmet.yilmaz`, `ayse_demir`,
  `lab01`, `chemist03`, `quality.manager` are all valid.
- **Database uniqueness**: `UNIQUE` constraint on `normalized_username`
  — the actual source of truth, not just an app-level pre-check.
  Tested (`a_second_user_differing_only_by_case_is_refused_by_the_database_constraint`).

---

## 5. First administrator bootstrap (designed, not yet implemented — Session 2)

On a fresh install, `users` is empty. A `bootstrap_status` Tauri command
(Session 2) checks `{ hasAdministrator: bool }`; if false, the frontend
renders an Administrator Setup screen instead of Login. The installing
person enters administrator username/password/display name; on submit,
Rust re-checks `hasAdministrator` is still false (race safety) and only
then inserts the row via `identity::create_user` with
`role: Administrator`, permanently closing bootstrap. No default
credentials are ever seeded — `admin/admin` and equivalents are
permanently absent from source, seed data, and documentation.

---

## 6. Fixed role-permission matrix (Session 1 — the final 12-role matrix)

Legend: V=view, C=create, E=edit, D=delete, S=submit, A=approve,
Rj=reject, Vf=verify, Sp=supersede, X=export, Ad=administer. Employee
tiers can submit/prepare; only the paired manager tier (or regulatory/
administrator, per §6.2) can approve/reject at a required gate.

| Area | researcher | research_manager | quality | quality_manager | regulatory | raw_material | procurement | production_engineering | production | production_manager | document_control | administrator |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Home | V | V | V | V | V | V | V | V | V | V | V | V |
| Projects | V,C | V,C,E | V | V | V | V | V | V | V | V | V | V,C,E,D |
| Formulation | V,C,E,S | V,A,Rj | V | V | V | V | — | V | V | V | V | V |
| Laboratory (trials, methods, corrective actions) | V,C,E,S | V,A,Rj | V,C | V,A,Rj | V | V | — | V | V | V | V | V |
| Stability | V,C,E,S | V,A,Rj | V,C | V,A,Rj | V | — | — | V | — | V | V | V |
| Optimization | V,C,E | V | V | V | V | — | — | V | — | — | — | V |
| Raw material records (SDS/TDS/COA/specs) | V | V | V,Vf | V,A | V | V,C,E | V,C | V | — | — | V | V |
| Supplier/procurement documentation | — | — | V | V | V | V | V,C,E | — | — | — | V | V |
| Regulatory (dossier, claims/labels) | V | V | V | V | V,C,E,Vf,A,Rj | V | V | V | — | — | V | V |
| Approval — `pilot_approved` | S (prepares) | A,Rj | S (prepares) | A,Rj | — | — | — | — | — | — | — | A,Rj |
| Approval — `production_approved` | — | — | S (prepares) | A,Rj | A,Rj | — | — | — | S (prepares) | A,Rj | — | A,Rj |
| Production engineering (scale-up, process prep) | — | — | — | — | — | — | — | V,C,E | V | V,A,Rj | V | V |
| Production (batch/process records) | — | — | — | — | — | — | — | V | V,C,E | V,A,Rj | V | V |
| Document control (publication, revision, export) | — | — | — | — | — | — | — | — | — | — | V,C,E,X,Ad | V |
| Reports | V,X | V,X | V,X | V,X | V,X | V,X | V,X | V,X | V,X | V,X | V,X | V,X |
| Data Exchange (import/commit masterdata) | V,C | V,C | V,C | V,C | V,C | V,C | V,C | — | — | — | — | V,C,Ad |
| Administration → Users | — | — | — | — | — | — | — | — | — | — | — | V,C,E,Ad |
| Administration → Security history | — | — | — | — | — | — | — | — | — | — | — | V,Ad |
| Administration → App settings | — | — | — | — | — | — | — | — | — | — | — | V,E,Ad |

This is Session 1's first full-matrix draft against current navigation
and the role intent in §1.1 — **not yet domain-expert-reviewed**,
flagged again here exactly as in Session 0 (§ Risks). Session 4 must
not wire enforcement against this matrix until a human with real lab/
QA/regulatory/production workflow experience has walked through it.

### 6.2 `APPROVAL_AUTHORITY` — re-derived for the 12-role model (implemented, `status.ts`)

```ts
export const APPROVAL_AUTHORITY: Record<FormulaStatus, readonly ApprovalRole[]> = {
  pilot_approved: ["research_manager", "quality_manager", "administrator"],
  production_approved: ["quality_manager", "regulatory", "production_manager", "administrator"],
  retired: ["research_manager", "quality_manager", "administrator"],
  rejected: ["research_manager", "quality_manager", "regulatory", "administrator"],
  // working states carry no approval authority — unchanged
  concept: [], literature_candidate: [], chemist_review: [], lab_candidate: [],
  stability_testing: [], pilot_candidate: [],
};
```

Derivation, per explicit instruction — audited, not blindly carried
forward:
- `pilot_approved` (old: `chemist, quality, administrator`) → **moved
  to manager tier**: `chemist` folded into `researcher` for working
  purposes, but pilot approval was always a manager-tier decision, so
  it moves to `research_manager`. Plain `quality` (old: could also
  grant this) is removed — that authority now belongs to
  `quality_manager` only, per the explicit "quality must not inherit
  quality_manager approval automatically" rule (this gate's inclusion
  of quality historically was itself an example of exactly the
  self-approval blur this redesign exists to close).
- `production_approved` (old: `quality, regulatory, production,
  administrator`) → `quality`/`production` (employee tiers) removed,
  replaced by `quality_manager`/`production_manager`. `regulatory`
  unchanged (kept as one fixed role, retains its own authority,
  unsplit). `administrator` unchanged.
- `retired`/`rejected` → same manager-tier substitution
  (`chemist`→`research_manager`, `quality`→`quality_manager`);
  `rejected` additionally keeps `regulatory` (a rejection at the
  regulatory gate is regulatory's own call, not a manager-tier
  hand-off).
- `administrator` retains authority on **every** gate, unchanged from
  Session 0/the original 6-role design — the explicit, user-approved
  exception (§9) so IT can exercise/test every workflow gate.

**Tested** (`packages/shared/src/schemas/status.test.ts`,
`packages/shared/src/engine/{approvalReadiness,lifecycle,versioning}.test.ts`):
employee-tier roles (`researcher`, `quality`) are explicitly asserted
to be refused `ROLE_NOT_AUTHORIZED` on both approval gates even with a
valid approval record — the exact regression the phase brief asked
for, not just an implicit side effect of the type change.

`laboratoryStandards.ts`'s `LABORATORY_METHOD_MANAGER_ROLES` (gates
assigning/activating/superseding a lab standard or method — "gated the
same way as `pilot_approved`" per its own doc comment) was re-derived
identically: `["chemist", "quality", "administrator"]` →
`["research_manager", "quality_manager", "administrator"]`.

`dataExchangeRegistry.ts`'s per-template role lists (`FORMULATION_ROLES`,
`COST_ROLES`, `LAB_ROLES`, `DRAFT_CONTENT_ROLES`, `DOE_ROLES`) had
`"chemist"` replaced with `"researcher"` (its direct successor for
working-tier authorization) — a mechanical, non-authority-changing fix
(these lists gate day-to-day data-exchange actions, not approval
gates, so no manager-tier redesign applied here).

---

## 7. Canonical authorization source

`APPROVAL_ROLES`/`APPROVAL_AUTHORITY` in `packages/shared/src/schemas/
status.ts` is the canonical role vocabulary and approval-gate policy —
implemented Session 1. The broader `can(role, area, capability)` module
(`rolePolicy.ts`, covering all of §6's matrix, not just the two
approval gates) remains a Session 3 task, per the original Session 0
plan — Session 1 deliberately stayed inside the identity/database layer
plus the minimum TypeScript-side role-vocabulary correction needed to
avoid ever having identity.db (12 roles) and `status.ts` (was 6 roles)
disagree, even temporarily. `identity::Role` (Rust) is the equivalent
canonical source on the storage side; a cross-language parity test
(asserting the Rust and TypeScript role-string lists are byte-identical
against a shared fixture) is a Session 3 task, once `rolePolicy.ts`
exists to anchor it to.

---

## 8. Preserving existing Regulatory authorization

Unchanged from Session 0: `regulatoryAuthorization.ts`'s
`AUTHORIZED_REGULATORY_ROLES = ["regulatory", "quality", "administrator"]`
was **not** touched — `quality` (not `quality_manager`) still gates
regulatory-evidence-confirmation actions, because that's what the
existing, working code already granted, and Session 1's mandate was
"do not weaken existing enforcement," not "re-derive every role list in
the codebase toward stricter manager-tier gating." Only the two actual
*approval* gates (§6.2) and the lab-method-manager gate (also §6.2,
directly modeled on the approval gates by its own doc comment) were
re-derived. This distinction — approval-authority gates re-derived,
everything else left as the minimum mechanical fix — is deliberate and
should guide Session 4's broader enforcement pass too.

---

## 9. Frontend is not the security boundary / Administrator authority decision

Unchanged finding from Session 0 (§2's UNSAFE row): still true, still
not fixed — `reviewerRole` etc. remain freely-editable `useState`s.
Session 4 fixes this by resolving role from an authenticated session
server-side.

**Administrator authority (explicit, user-approved, §9 of the phase
brief)**: administrator does **not** get create/edit authority over
scientific content (§6's matrix: view-only on Formulation/Laboratory/
Stability/Optimization/Regulatory/Production areas) but **does** retain
approval authority on both `pilot_approved` and `production_approved`
(§6.2) — an explicit, deliberate exception specifically so IT can
exercise/test every workflow gate. System administration and
scientific/business approval authority are otherwise kept separate,
exactly as the phase brief asks — the one exception is named, not
accidental.

---

## 10. Password security (implemented Session 1)

**Argon2id** via the `argon2` crate (v0.5), with `rand_core`'s
`OsRng` (explicit `getrandom` feature) for per-hash salt generation.
`hash_password`/`verify_password` in `identity.rs`:

- Random salt per password (`SaltString::generate(&mut OsRng)`) —
  tested: hashing the same password twice produces two different
  stored strings, both of which still verify correctly.
- PHC-string encoded output (`argon2::password_hash`'s `PasswordHash`)
  — one self-describing string (algorithm + params + salt + hash), no
  separate salt/algorithm columns needed.
- Default Argon2 parameters (crate defaults: Argon2id, 19 MiB memory,
  2 iterations, 1 degree of parallelism, per the `argon2` crate's own
  RFC-9106-informed defaults) — not hand-tuned against specific
  hardware in Session 1; revisit if a real desktop-hardware performance
  problem surfaces.
- No custom crypto anywhere — every cryptographic primitive comes from
  `argon2`/`password-hash`/`rand_core`, none hand-rolled.
- Never logged/stored in plaintext: tested directly
  (`the_plaintext_password_never_appears_inside_its_own_stored_hash`).
- Oversized input (tested with a 1MB password) hashes and verifies
  without panicking — no unbounded-cost or crash risk from a hostile
  input size.
- A malformed/corrupt stored hash fails verification cleanly (returns
  `false`) instead of panicking — tested.

Administrator can **reset** (`update_password_hash` writes a new hash)
but structurally **cannot view** an existing password — no code path
ever reads `password_hash` back out as anything other than an opaque
string fed into `verify_password`.

---

## 11. Identity database (implemented Session 1)

**Path**: `app_private_dir(app, "identity").join("identity.db")` —
reuses `backup.rs`'s existing `app_private_dir` helper
(`app.path().app_data_dir()/identity/identity.db`, e.g.
`%APPDATA%\com.formulab.app\identity\identity.db` on Windows). Not a
developer-machine hardcoded path — resolved through Tauri's own
per-install app-data directory, same mechanism `.FormuLab/runs.db`,
`automatic_backup_state.json`, and every other app-private file already
use. Deliberately **not** `.FormuLab/runs.db` (that lives inside the
*relocatable* data root — identity/security should not move just
because a user relocates their formulation data), not formulation/lab/
project/session data, not any `.formulab-backup` payload.

**Tables** (`CREATE TABLE` DDL in `identity.rs`'s `MIGRATIONS` constant):

```sql
users (id, username, normalized_username UNIQUE, display_name,
       password_hash, role, status, department, employee_reference,
       must_change_password, failed_login_count, locked_until,
       created_at, created_by, updated_at, last_login_at)

authenticated_sessions (id, user_id REFERENCES users, created_at,
       expires_at, last_seen_at, revoked_at)

login_attempts (id, username_normalized, at, outcome, device_context)

security_audit_events (id, at, actor_user_id, target_user_id, action,
       outcome, detail)
```

No `roles` table (fixed application policy, not database rows — §1). No
`permissions`/`role_permissions`/`user_permission_overrides` tables
(§14 confirms this isn't needed given the business requirement).

### 11.1 Migration architecture

`migration.rs` (the existing framework) was evaluated and **not**
reused — it tracks *data-root* JSON-format schema compatibility
(`schema_meta.json` + a migration journal, for formulation data), a
different concern from SQL DDL evolution inside one SQLite file.
Reusing it would mean bending a JSON-schema tool to run SQL migrations.
Instead, `identity.rs` uses SQLite's own native `PRAGMA user_version`
— each entry in a `MIGRATIONS: &[&str]` array is one versioned,
idempotent SQL batch, applied in order inside `run_migrations`, which
compares the current `user_version` against `MIGRATIONS.len()` and
applies only what's missing. Reopening an already-current database is
a verified no-op (tested:
`migrations_are_idempotent_reopening_an_existing_database_does_not_error_or_duplicate`
— seeds a user, reopens, confirms the row and the schema version both
survive unchanged). This is arguably a more direct reuse of "existing
tooling" than adapting `migration.rs` would have been — it uses
SQLite's own built-in versioning primitive rather than building a
parallel bookkeeping table.

---

## 12. Project/resource access — confirmed out of scope for Phase 13

Per explicit instruction: project-level ACL/membership restriction is
**out of scope for Phase 13**. All authenticated users may see all
projects. Visibility does not grant modification authority — every
create/edit/delete/submit/approve/reject/verify/supersede/release/
export/administer action stays controlled by role + workflow state +
required-approval gates + trusted authenticated identity (§14's four
layers). No project memberships, project ACLs, per-project user
assignments, or department ACLs are built at this stage. This
directly matches Session 0's own recommendation, now confirmed rather
than merely proposed.

---

## 13. Administration → Users UI (designed, not yet implemented — Session 5)

Unchanged from Session 0's design: list (username, display name, role,
department, status, last login), actions (Create, Edit, Change Role,
Reset Password, Activate/Disable, View Security History), role
selection as a plain `<select>` of the 12 fixed roles, a read-only
"Role capabilities" view rendered from the canonical policy (once
`rolePolicy.ts` exists, Session 3) — no permission-checkbox grid
anywhere.

---

## 14. Four distinct authorization concepts (Session 1 — required by explicit instruction, informs every later session)

An action is allowed only when **all** of the following pass —
authentication/RBAC alone (Sessions 1-4's identity/role layer) is not
sufficient by itself:

1. **Visibility** — can the user see the project/record at all?
   (Phase 13: yes, for every authenticated user — §12.)
2. **Role capability** — is this role allowed to perform this *type*
   of action at all? (§6's matrix; §7's `can()`, Session 3.)
3. **Workflow state** — is the record currently at a stage where the
   action is allowed? (Existing `ALLOWED_NEXT`/lifecycle logic in
   `status.ts`/`lifecycle.ts`, extended per §15's workflow model.)
4. **Required approval/gate** — have the required upstream approvals
   actually completed? (§15's gate model — "work completed" and
   "manager approved" are different states; a worker's own completion
   can never satisfy their manager's required approval.)

Conceptually:
`authenticated AND account_active AND role_capability_allows(action) AND workflow_state_allows(action) AND required_approvals_satisfied`

These four are deliberately **not** collapsed into one generic
`permission` flag — `rolePolicy.ts` (Session 3) answers only #2; #3/#4
are a separate workflow-policy concern (§15), combined with #2 only at
the point of actually authorizing a specific action (Session 4).

No persisted `permissions: string[]` array, and no
`role_permissions`/`user_permission_overrides` tables — permissions
are derived on demand from role (#2) and combined with live record
state (#3/#4) at authorization time, never pre-computed and stored per
user. This directly answers the phase brief's own question: the fixed-
role requirement makes a generic, editable IAM permission schema
unnecessary.

---

## 15. Workflow foundation architecture (designed Session 1, enforced Session 4+)

### 15.1 Core model

```
WORK → DEPARTMENT WORK → DEPARTMENT REVIEW / REQUIRED APPROVAL → GATE PASSES → NEXT AUTHORIZED STAGE
```

A worker completing their own work never automatically satisfies a
required manager approval. This is not a UI convention — it must be
enforced at the trusted backend/domain layer (Session 4), the same way
`canTransitionTo` already enforces the two existing approval gates
today. A downstream role must never be able to bypass an unmet upstream
gate — not by using their own role's access, not by a direct Tauri
command call, not by changing React state, not by a modified frontend
role value. The authoritative workflow state and approval record are
the only things Session 4's enforcement may trust.

### 15.2 Vocabulary (for the workflow engine a later session builds)

- **Stage** — a named point in a record's lifecycle (reuses
  `FormulaStatus`'s existing values where a stage already exists;
  extends them where §15.3's matrix identifies a gap not yet modeled).
- **Stage owner role(s)** — who does the work at this stage (§6's
  employee-tier "prepares" cells).
- **Required reviewer/approver role(s)** — who must sign off before the
  stage can be left (§6's manager-tier "A,Rj" cells; §6.2 for the two
  gates that already exist).
- **Allowed transitions** — reuses `ALLOWED_NEXT` (`status.ts`) as the
  proven pattern; a real workflow engine (not built in Session 1)
  generalizes this per-area.
- **Rejected/returned state** — an explicit, distinct outcome from
  "not yet reviewed" — `rejected` already exists as a real
  `FormulaStatus`; the pattern generalizes.
- **Approval record** — reuses the existing `ApprovalRecord` concept
  (actor/user attribution, timestamp, reason/justification, immutable
  once written) — not reinvented.
- **Downstream gate rule** — a stage transition that requires a
  specific upstream stage to already be in an approved (not merely
  "worked on") state.
- **Immutable/auditable transition history** — every transition
  (worked, reviewed, approved, rejected, returned) is an audit-log-
  worthy event, mirroring `security_audit_events`' design (§ Session
  0's §25, unchanged) for the workflow domain specifically.

"Work completed" and "manager approved" are explicitly different
states in this vocabulary — never conflated, never inferred from each
other.

### 15.3 Proposed canonical FormuLab workflow matrix (for later implementation)

| Domain/workspace | Who works | Who reviews/approves | What unlocks next | On rejection | Downstream blocked until |
|---|---|---|---|---|---|
| Formulation | researcher | research_manager | `pilot_candidate`→ lab work | returns to researcher, stays `rejected`/`concept` | research_manager approval |
| Laboratory trials | researcher | research_manager | stability testing | returns to researcher | research_manager approval |
| Laboratory test results | researcher, quality | research_manager, quality_manager | pilot readiness | returns to preparer | manager-tier sign-off |
| Stability | researcher, quality | research_manager, quality_manager | pilot_approved eligibility | returns to preparer | manager-tier sign-off |
| Raw materials | raw_material | quality (verify) | usable in a formulation's dossier | raw_material corrects | quality verification *(gap — see below)* |
| Supplier/procurement docs | procurement | quality or regulatory (as applicable) | usable as dossier evidence | procurement corrects | verification *(gap — see below)* |
| Quality (QA/QC) | quality | quality_manager | `pilot_approved`/`production_approved` eligibility | returns to quality | quality_manager approval (existing gate, §6.2) |
| Regulatory | regulatory | regulatory (unsplit) | `production_approved` eligibility | `rejected` (existing) | regulatory's own sign-off (existing gate, §6.2) |
| Dossier/evidence | researcher, raw_material, regulatory | regulatory (verify/confirm) | submission-ready dossier | evidence revoked/superseded (existing) | regulatory confirmation (existing, `regulatoryReviews.ts`) |
| Production engineering / scale-up | production_engineering | production_manager | production readiness | returns to production_engineering | production_manager approval *(gap — see below)* |
| Production | production | production_manager | batch release eligibility | returns to production | production_manager approval *(gap — see below)* |
| Production approval/release | production, quality | production_manager, quality_manager, regulatory | `production_approved` (existing gate, §6.2) | `rejected` (existing) | manager-tier + regulatory sign-off (existing) |
| Document control/publication | document_control | document_control (self, or per policy) | published/distributed document | document held back | package completeness — *not* a scientific gate |

**Gaps explicitly marked, not silently assumed solved**: raw-material
verification, supplier-document verification, production-engineering→
production-manager approval, and production→production-manager
approval do **not** have a corresponding `FormulaStatus`/gate in the
current domain model — the current app has no representation for
"raw material technically verified" or "scale-up approved" as a
workflow state at all. Building these is real, unimplemented Phase 13
work (Session 4 or a dedicated workflow session), not something Session
1 invented a gate for. Rows without a "(gap)" note reuse a gate that
already exists and works today.

---

## 16. SQL injection safety (implemented + tested Session 1)

Confirmed **zero string-concatenated SQL** anywhere in
`identity.rs` — every query uses `rusqlite`'s `params![...]`
placeholder binding. Hostile-input regression test
(`hostile_strings_are_rejected_by_validation_or_stored_inertly_as_data_never_executed`)
feeds: `admin'--`, `' OR '1'='1`, `'; DROP TABLE users;--`, a
boolean-injection username matching a real seeded user, mixed quote
characters, an inline SQL comment, a `#` comment marker, an RTL-override
Unicode string, and a zero-width-joiner Unicode string — asserting in
every case that either validation rejects the input outright (most of
these, since they contain disallowed characters) or it's accepted and
stored as a completely inert, literal value — never a query bypass, a
dropped table, or a false-positive login match. Separately tested:
excessively long input (10,000 chars) is rejected by validation before
ever reaching SQL, and unusual whitespace (tab, non-breaking space,
newline) is rejected. 4 dedicated SQL-injection tests, all passing, run
only against disposable temp databases (`std::env::temp_dir()`-based,
unique per test, cleaned up), never real user data.

---

## 17. Login brute-force protection (implemented Session 1, not yet wired to a login command)

`identity::update_login_state(conn, user_id, success, threshold,
lock_secs)` — increments `failed_login_count` on failure, resets it on
success, sets `locked_until` once `threshold` is reached.
`threshold`/`lock_secs` are caller-supplied, not hardcoded, so Session
2/6 can tune them against real usability testing without touching this
function. Tested with `threshold=5`: 4 failures leave the account
unlocked, the 5th locks it, and a subsequent success fully resets both
the counter and the lock. `record_login_attempt` persists every
attempt (success or failure) to `login_attempts` regardless of outcome.
**Not yet decided** (Session 2): the exact default threshold/backoff
curve, and the generic `"Invalid username or password."` error text is
designed but not yet wired to any command (no login command exists
yet).

---

## 18. Account deactivation (implemented Session 1: storage primitive; UI is Session 5)

`update_account_status(conn, user_id, active)` — setting `active:
false` also revokes every currently-open session for that user
immediately (tested:
`update_account_status_disabling_revokes_every_open_session` — creates
a session, disables the user, confirms `validate_session` now returns
`None`). Historical attribution is untouched by design — disabling a
user only ever changes the `users` row and revokes sessions; nothing
about `security_audit_events`, `login_attempts`, or (once it exists)
`ApprovalRecord`/provenance history referencing that user's id is
deleted or altered.

---

## 19. Role change (implemented Session 1: storage primitive; UI is Session 5)

`update_role(conn, user_id, role)` — takes effect immediately in
storage (tested:
`update_role_changes_effective_role_immediately`). Because
`validate_session`/any future role-resolving command reads `users.role`
fresh on every call rather than caching it in the session, a role
change is visible to the very next privileged action for that session
— no window where a demoted user keeps old-role access because their
session token is still technically valid. Auditing the change itself
(`security_audit_events` row, old role → new role, which admin changed
it) is designed (§ Session 0's §25) but not yet wired to a command,
since no role-change command exists yet.

---

## 20. Role capability descriptions

See §1.1 — merged into the main role list this session rather than
duplicated in a separate section, so there is exactly one place
describing what each role means.

---

## 21. Offline operation

Unchanged from Session 0: confirmed by design, not just absence of
counter-evidence — `identity.rs` performs every operation
(hash/verify/create/find/update, session/audit persistence) against a
local SQLite file with zero network calls anywhere in the module.

---

## 22. Multi-workstation architecture

Unchanged from Session 0: **Model A** (standalone workstation, each
install's `identity.db` authoritative for that machine) is Phase 13's
implemented target. **Model B** (company-local shared identity) stays
an explicitly future, not-built-now upgrade path — Session 1's Tauri-
command-boundary-shape consideration (keep the eventual `login`/
`bootstrap_status`/user-management command surface swappable behind a
different backend later) still applies once those commands exist
(Session 2).

---

## 23. Audit logging (implemented Session 1: storage primitive; not yet called from any command)

`record_security_audit_event(conn, actor_user_id, target_user_id,
action, outcome, detail)` — tested to persist correctly and to never
contain password material (`security_audit_events_persist_without_ever_storing_password_material`
explicitly asserts no stored `detail` field contains the test user's
password hash). The full event-class list (login success/failure,
logout, account lifecycle, password reset/change, role change, lock/
unlock, permission denied, privileged admin actions) from Session 0's
design is unchanged — Session 2+ calls this function at each of those
points as the corresponding commands are built.

---

## 24. Security test matrix

See `docs/PHASE13_SECURITY_TEST_MATRIX.md` — updated this session with
Session 1's actual 28 identity-layer tests (was a plan; now also a
report of what exists and passes).

---

## 25. Proposed Phase 13 sessions (Session 1 complete; renumbered plan unchanged in shape from Session 0)

1. ~~User database + migrations + password subsystem~~ **DONE, this session.**
2. Administrator bootstrap + `login`/`logout` Tauri commands +
   authenticated session lifecycle (creation, persistence across
   restarts, expiration/idle timeout), using the 12-role model.
3. `rolePolicy.ts` (canonical `can()` covering all of §6's matrix, not
   just the two approval gates) + wire `UserContext` through the app +
   a Rust/TypeScript role-vocabulary parity test.
4. Application-wide enforcement: every Tauri command performing a
   role-gated action resolves role server-side and calls `can()`; every
   nav/button uses the same `can()`. Fixes the confirmed
   `save_approval_record` bypass (§2). Begins real workflow-gate
   enforcement per §15 for the gates that already have a
   `FormulaStatus` representation; flags the §15.3 gaps as their own
   follow-up rather than inventing new `FormulaStatus` values
   mid-session.
5. `Administration → Users` UI: list, create, edit, role change, reset
   password, activate/disable, security-history view, read-only role-
   capabilities view.
6. Brute-force/lockout wiring, full audit-event coverage from real
   commands, the complete SQL-injection + privilege-escalation
   regression suite against the wired-up commands (not just the
   storage layer, which Session 1 already covers).
7. Native Windows multi-user acceptance testing, full security
   regression pass, Phase 13 closure documentation.

---

## Risks and open decisions (updated Session 1)

1. **§6's full matrix is Session 1's first draft**, built from current
   navigation/routes and §1.1's role intent, not domain-expert-
   reviewed. Must be reviewed before Session 4 wires enforcement.
2. **§9 — Administrator's retained approval authority** is explicit and
   user-approved for this phase; still worth a final human confirmation
   before Session 4 makes it load-bearing in enforcement.
3. **§12 — project/resource access is confirmed (not just
   recommended) out of scope for Phase 13** — no longer an open
   question, closed this session.
4. **§15.3's four gaps** (raw-material verification, supplier-document
   verification, production-engineering→production-manager approval,
   production→production-manager approval) have no `FormulaStatus`
   representation in the current domain model — real, unimplemented
   work, not a Session 1 oversight.
5. **§10 — Argon2 parameters are crate defaults**, not hand-tuned
   against real target hardware — revisit only if a genuine performance
   problem surfaces on real desktop specs.
6. **§17 — exact lockout threshold/backoff curve** deferred to Session
   2/6, same as Session 0's plan.
7. **§22 Model B** remains explicitly out of Phase 13's implementation
   scope.
