# Phase 13 — Enterprise Identity, Authentication, Fixed RBAC & Application Security

**Status: Session 2 (Administrator bootstrap, username/password login/logout, authenticated session lifecycle) complete. No Administration → Users UI, no `rolePolicy.ts`, no application-wide role enforcement yet — those are later Phase 13 sessions. This document is the design they build against.**

**Session 2 summary**: wired `identity.rs`'s Session 1 storage primitives to real Tauri commands (`bootstrap_status`, `bootstrap_create_administrator`, `login`, `logout`, `current_session`) via a new orchestration module, `auth.rs`, that owns the actual lockout/session/timing policy Session 1 deliberately left as caller-supplied parameters. Session tokens are now hashed before storage (§15.5), idle-timeout is implemented (§17.1), and a full Administrator Setup / Login screen pair gates the whole application at startup (§17.2-§17.4). See the Session 2 sections below (§5, §15.5, §16.1, §17.1-§17.5) for what changed; every Session 0/1 design decision not called out as changed is unchanged.

**Session 1 correction, superseding Session 0's role list**: Session 0 shipped a first-draft 6-role model. After reviewing the real FormuLab dossier/evidence/document workflow, the user approved a final, authoritative **12-role** model (§1). Every "6 roles" statement in the original Session 0 text has been rewritten below — nowhere in this document should you find a claim that FormuLab has 6 fixed roles.

**Session 1 closure addendum (this update)**: the user has resolved all four workflow gaps §15.3 originally flagged as open. All four now-approved manager gates (raw-material verification, supplier-document verification, production-engineering→production handoff, production release) are owned by **`production_manager`** — an explicit, user-approved architecture decision, not an open question. See §15.4. This addendum is documentation only: no `FormulaStatus` values or enforcement code exist yet for these four gates (unchanged from Session 1's original finding) — they are recorded as decided *authority*, with implementation still real, unimplemented future work.

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
  **not** automatically get Procurement authority. Completing
  raw-material work does not satisfy the raw-material verification
  gate — that gate is owned by `production_manager` (§15.4).
- **`procurement`** — Procurement / Supplier Management: supplier
  information/documentation, obtaining supplier/manufacturer
  documents, supplier declarations, received SDS/TDS/COA/certificates,
  supplier qualification records, procurement-side document
  completeness. Collecting a document is **not** the same as
  scientifically verifying or approving it — collection, technical
  verification, quality approval, and regulatory approval stay
  separate concepts, never conflated under one role. Collecting supplier
  documentation does not satisfy the supplier-document verification
  gate — that gate is owned by `production_manager` (§15.4).
- **`production_engineering`** — Scale-up/industrialization: production
  readiness engineering, manufacturing process preparation, process
  parameters, routing/process linkage, technical transfer from
  development toward manufacturing, production feasibility, engineering
  changes, manufacturing instructions where supported. Must not bypass
  upstream required approvals — technical accessibility is not
  production approval. Completing scale-up work does not authorize the
  downstream production handoff — that gate is owned by
  `production_manager` (§15.4).
- **`production`** — Production operational role: production execution,
  batch/process records, manufacturing operational entries,
  production-stage data, permitted shop-floor actions. Does not grant
  manager-level production approval unless the role matrix explicitly
  says so. Completing production work does not authorize production
  release — that gate is owned by `production_manager` (§15.4).
- **`production_manager`** — Production managerial authority:
  production-stage review, approval/rejection, release decisions,
  management-level manufacturing signoff, returns production work for
  correction. Where configured as a required gate, downstream work
  stays blocked until it passes. **User-approved this closure**: also
  the sole approval authority for the raw-material verification,
  supplier-document verification, and production-engineering handoff
  gates (§15.4) — not just the production-release gate.
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
| User accounts | **IMPLEMENTED** (Session 2: bootstrap creates the first; ordinary admin-created users are Session 5) | `identity.rs` + `auth.rs` |
| Administrator-created users | **MISSING** (bootstrap creates only the first Administrator) | Administration → Users is Session 5 |
| Username login | **IMPLEMENTED** (Session 2) | `auth::login`, `LoginScreen.tsx` |
| Password authentication | **IMPLEMENTED** (Session 2) | `auth::login_logic` calls `identity::verify_password` |
| Logout | **IMPLEMENTED** (Session 2) | `auth::logout`, session revoked backend-side |
| Password hashing | **IMPLEMENTED** (Session 1) | Argon2id, `identity.rs` |
| Account enable/disable | **PARTIAL** (Session 1: `update_account_status` implemented + tested, incl. session revocation and login refusal, §24; no admin UI yet) | `identity.rs` |
| Administrator password reset | **PARTIAL** (Session 1: `update_password_hash` implemented + tested; no admin UI) | `identity.rs` |
| Brute-force protection / login throttling | **IMPLEMENTED** (Session 2: final policy — 5 attempts, 15-minute lock, §17.1) | `auth.rs` |
| Authenticated session | **IMPLEMENTED** (Session 2: hashed bearer tokens, §15.5) | `auth.rs`, `identity.rs` |
| Session expiration / idle timeout | **IMPLEMENTED** (Session 2: 12h absolute / 60min idle, §17.1) | `identity::validate_session`, `auth.rs` |
| Role storage (trusted) | **IMPLEMENTED** (Session 2: `current_session`/`login`/`bootstrap_create_administrator` are now the trusted source every session-derived role comes from) | `identity.rs` + `auth.rs` |
| Role assignment (by admin) | **MISSING** | No admin UI |
| Role enforcement (domain-level) | **PARTIAL** | `canTransitionTo` (`status.ts`) is real, tested, working enforcement, now re-derived for the 12-role model (§6) |
| Role enforcement (backend/Rust) | **PARTIAL** (Session 4: the priority set from Session 3's inventory is enforced; the rest is classified, not enforced, §9.3.10) | `save_approval_record`, formulation writes, generic masterdata CRUD, attachments, and every System Administration command now resolve role from the authenticated session and call `role_policy::can()` (`authz.rs`, §9.3.3). Commands classified `DEFERRED_WITH_REASON` (§9.3.10) — e.g. `resume_interrupted_data_move`, `materials::import_materials` — remain unchecked, a disclosed gap, not a claim of completeness. |
| UI role selection | **PARTIAL** (Session 3: the 10 current-user *selector* sites are fixed; Session 4 makes the underlying writes authoritative too, for the priority set) | `useTrustedActor()` (§9.2) sources session-backed state at 10 frontend sites; Session 4 (§9.3.4-§9.3.9) makes the Rust commands those actors feed into actually check role server-side for the priority set, closing the "frontend selector fixed, backend still trusts anything" gap `save_approval_record`/masterdata/attachments/formulation writes had. Commands outside that priority set (§9.3.10's DEFERRED_WITH_REASON row) still don't check. |
| Project/resource access | **NOT_APPLICABLE (confirmed out of scope for Phase 13)** | See §12 |
| Audit logging (security events) | **PARTIAL** (Session 2: bootstrap/login-success/login-failure/lockout/logout now call `record_security_audit_event` for real, §23; admin-action events remain Session 5/6) | `auth.rs` |
| SQLite/user database | **IMPLEMENTED** (Session 1) | `identity.db`, app-private, §11 |
| Startup authentication routing | **IMPLEMENTED** (Session 2) | `AuthProvider.tsx` gates `main.tsx`'s `RouterProvider` — no protected content renders before it resolves, §17.4 |

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

## 5. First administrator bootstrap (implemented Session 2)

On a fresh install, `users` is empty. `bootstrap_status` (Tauri command,
`auth.rs`) returns `{ bootstrapRequired: bool }`, keyed off
`identity::any_administrator_exists` (role-based, not row-count-based —
§1). If `true`, the frontend renders `BootstrapScreen` instead of Login.
The installing person enters username, display name, password, and a
password confirmation — no role field anywhere, not even hidden or
disabled: `bootstrap_create_administrator`'s Rust signature has no role
parameter at all, so there is no code path through which a caller could
ask for a different first role (§9.1).

On submit, `identity::bootstrap_administrator` re-checks (inside one
`IMMEDIATE` SQLite transaction, so two concurrent bootstrap attempts
cannot both observe zero administrators and both insert one) that no
administrator exists yet, then inserts the row with `role: Administrator`
and clears `must_change_password` — deliberately, since a bootstrap
administrator chose their own password during setup; there is no
admin-set temporary password to force a change away from (unlike every
Administration-created user in later sessions, which keeps
`must_change_password = true`). A second bootstrap attempt — through the
UI or a direct backend call — is permanently refused from then on with a
plain, safe error (tested: `a_second_bootstrap_attempt_is_permanently_rejected`,
`second_bootstrap_is_rejected_including_a_direct_backend_call`). No
default credentials are ever seeded — `admin/admin` and equivalents are
permanently absent from source, seed data, and documentation (tested:
`no_default_administrator_credentials_ever_work`).

**Chosen post-bootstrap UX (§8 of the Session 2 brief, decided and
documented)**: option A — `bootstrap_create_administrator` immediately
issues an authenticated session and the frontend enters FormuLab
directly, the same as a successful login. Rejected: bouncing the person
who just typed a username/password to a second Login screen for
credentials they entered ten seconds earlier is friction with no
security benefit on a local, offline, single-workstation install.

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
is now **implemented, Session 3**:
`packages/shared/src/engine/rolePolicy.ts` transcribes §6's full
permission matrix (default-deny — a role/area/capability triple with no
explicit `true` entry resolves to refused, not silently allowed) with
two documented discrepancy-resolutions between §6's prose and its own
table (`production_manager` verify authority on
`rawMaterials`/`supplierDocuments` per §15.4; `quality` +
`administrator` verify authority on `regulatory` per
`AUTHORIZED_REGULATORY_ROLES`, §8). `approve`/`reject` capabilities are
derived live from `APPROVAL_AUTHORITY` rather than re-typed, so
approval-gate parity with `status.ts` is structural, not a manually
maintained duplicate that could drift. 32 tests
(`rolePolicy.test.ts`).

The cross-language parity test also shipped Session 3:
`packages/shared/src/engine/roleVocabulary.json` is now the one shared
fixture both `rolePolicy.roleVocabularyParity.test.ts` (TypeScript, 5
tests) and `identity.rs`'s
`role_vocabulary_matches_the_shared_json_fixture` (Rust, 1 test) check
themselves against — neither language's own list is asserted against a
third, independently hand-copied list, so the two can never silently
diverge from a shared source that itself goes stale.

`identity::Role` (Rust) remains the canonical source on the storage
side, now provably in lockstep with `rolePolicy.ts`'s vocabulary via
the fixture above.

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

### 9.1 Session 2: the new auth commands never trust a caller-supplied role

`login`, `bootstrap_create_administrator`, and `current_session` (`auth.rs`)
have no `role` parameter in their signatures at all — not optional, not
ignored-if-present, simply absent from the function they deserialize
their arguments into. There is no code path through which the frontend
could send `"I am administrator"` and have it believed: every returned
`SafeUser.role` comes from the `users` row a validated password check or
session-token lookup resolved to, never from anything the caller sent.
This closes the *storage/session* half of §2's UNSAFE finding — the
*consuming* half (application commands that still don't ask `auth.rs`
who's logged in at all, e.g. `save_approval_record`) is still open and
stays Session 4's job.

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

### 9.2 Session 3: frontend selector wiring, and the privileged-command inventory for Session 4

**Frontend selector wiring (closes the "consuming" half of §9.1's
`useTrustedActor` sourcing — not the backend enforcement)**: a new hook,
`apps/desktop/src/lib/currentActor.ts`'s `useTrustedActor()`, sources
`{role, userId, displayName}` from `AuthProvider`'s trusted
`UserContext` when there is one, returning `null` only when there is no
`AuthProvider` ancestor at all (this codebase's existing test suite
renders components via `renderAt()`, bypassing `main.tsx`'s real
provider — the same reason `useOptionalAuth()` exists, §17.4). Wired
into every site Session 0/2/3 flagged as a current-user role selector a
logged-in user could freely self-report: `ApprovalPanel`,
`ClaimsLabelsPanel`, `DossierPanel`, `RegulatoryPanel`, `DoePanel`,
`TestMethodDrawer`, `DataExchangePage`, `TrialsPanel`, `StabilityPanel`,
`CorrectiveActionsPanel` — 10 sites total. Each falls back to its
pre-Session-3 local `useState` selector only when `useTrustedActor()`
returns `null`, so the existing test suite (none of which mounts a real
`AuthProvider`) keeps passing unchanged, while the real running app —
which always has one — no longer offers any of these panels a way to
construct an `Actor` with an unearned role. `StabilityPanel`'s
`manualInclusionReviewer` free-text field was deliberately **not**
touched — it records who authorized a manual out-of-applicability test
inclusion as a named reviewer/reason pair, not a "which role am I"
selector, so it is out of this session's scope, not an oversight.

This closes the *frontend selector* half of the "current user can claim
any role" gap for the sites wired to it. It does **not** make the
underlying write trusted end-to-end: every Tauri command these actors'
writes eventually reach still performs no server-side role check at
all (§9.1, unchanged) — a raw `invoke()` bypassing the UI entirely is
just as unguarded after this session as before it. That server-side
half is Session 4's job, and it is bigger than `save_approval_record`
alone, per the inventory below.

**Privileged-command inventory (audit only — no command's behavior
changed this session)**: every `#[tauri::command]` registered in
`lib.rs` (110 commands) was reviewed for whether it performs a
role-gated business action and, if so, whether it currently checks role
at all. None do — Session 2 already established that no command outside
`auth.rs` itself resolves a session's role (§9.1); this pass exists to
size and categorize the gap Session 4 inherits, not to re-discover its
existence.

| Category | Representative commands | Should be gated by (once §6 is domain-reviewed, §Risks item 1) | Current server-side role check |
|---|---|---|---|
| Approval gates | `formulations::save_approval_record` | `APPROVAL_AUTHORITY[targetStatus]` | **None** — confirmed Session 0, unchanged (§2, evidence above) |
| Formulation content writes | `formulations::save_formulation`, `save_formulation_version`, `delete_formulation`, `save_formulation_draft`, `discard_formulation_draft` | §6 Formulation area create/edit/delete | **None** — any caller can write/delete any formulation regardless of role |
| Generic masterdata CRUD | `masterdata::upsert_master_records`, `delete_master_record`, `write_master_collection_raw` | §6, per-collection (materials/suppliers/raw-materials/regulatory data all route through the same three commands, keyed only by a `collection: String` the caller supplies) | **None**, and structurally the widest gap found: unlike `save_approval_record`, these commands carry no actor field of any kind to even audit against — no name, no role, nothing |
| Audit trail | `formulations::append_audit_event`, `read_audit_log` | Write should require the same authority as the action being audited | **None** on write — any caller can append an arbitrary audit event, including one misattributed to someone else |
| Attachments | `attachments::copy_attachment_into_project`, `open_attachment` | §6 per-area attachment rights | **None** |
| System administration (backup/restore/migration/data-location) | `backup::restore_backup`, `migration::create_pre_migration_backup`, `data_location_manager::move_data_location`, `automatic_backup::write_automatic_backup_config` | Should plausibly require `administrator` — §6 does not yet name a System-Administration area at all | **None** — not yet even *designed* in §6, a gap in the matrix itself, not just its enforcement |
| Auth commands | `auth::login`, `bootstrap_create_administrator`, `logout`, `current_session` | N/A by design | Correctly role-parameter-free (§9.1) — these are the one category already right |
| Local dev/infra tooling | `workspace::*`, `jupyter::*`, `kernel::*`, `compute::*`, `modal::modal_status`, `preview_server::preview_url`, `tools::detect_tools`, `updates::check_for_update`, `debug_log::log_debug` | Out of scope — local machine configuration, not regulated business data | N/A |

The System-Administration row is the one genuinely new finding this
session adds beyond "Session 2 already knew commands aren't
role-checked": §6's matrix, as drafted, has no Administration/System
area covering backup, restore, data-location moves, or migration at
all — Session 4 cannot enforce a matrix cell that does not exist yet,
so drafting that area is prerequisite work, not just wiring `can()`
into existing rows. Flagged for the domain review in Risks item 1.

### 9.3 Session 4: application-wide server-side enforcement

Everything §9.1/§9.2 flagged as open — "nothing outside `auth.rs` asks
who's logged in," "the consuming half stays Session 4's job" — is now
closed for the priority set the Session 3 inventory named. The
frontend's `can()` (§7) is UX only; every enforcement decision below is
re-made, independently, in Rust from the authenticated session.

#### 9.3.1 One cross-layer policy contract, not two hand-typed matrices

`role_policy.rs` (Rust, new) holds **no permission matrix or workflow-
transition graph of its own**. `packages/shared/scripts/
generate-role-policy-matrix.ts` serializes `rolePolicy.ts`'s fully-
resolved `MATRIX` (via a new `fullMatrixSnapshot()`) to
`rolePolicyMatrix.generated.json`, and `status.ts`'s `ALLOWED_NEXT`
graph to `formulaStatusTransitions.json` — both checked into the repo,
exactly `roleVocabulary.json`'s existing convention (Session 3), not a
new one. `role_policy.rs` reads both via `include_str!` at first use and
implements two generic, data-driven functions:

- `can(role, area, capability) -> bool` — the Rust mirror of
  `rolePolicy.ts`'s `can()`. Default-deny: an unrecognized area, role,
  or capability all fall through to `false` via a `HashMap` lookup —
  there is no "allow unless denied" branch.
- `is_valid_transition(from, to) -> bool` — the Rust mirror of
  `canTransitionTo`'s `ALLOWED_NEXT` check, for `save_approval_record`'s
  workflow-transition validity requirement (§9.3.3).

**Parity is enforced, not promised.** `rolePolicy.matrixParity.test.ts`
(TypeScript, new) asserts the checked-in JSON is byte-for-byte what
`fullMatrixSnapshot()` computes *right now* — a developer who edits
`MATRIX` and forgets to regenerate the fixture fails this test.
`status.transitionParity.test.ts` does the same for `ALLOWED_NEXT`.
`role_policy.rs`'s own `#[cfg(test)]` block spot-checks representative
cells (default-deny, `systemAdministration` administrator-only, both
approval gates' role sets, the two §7 discrepancy-resolutions, several
transition-graph edges) against the same facts `rolePolicy.test.ts`
already asserts at the TypeScript layer — not a coincidence, a
deliberate cross-check that the shared-fixture mechanism is actually
producing the intended data. Neither language holds a matrix the other
doesn't also, provably, agree with.

#### 9.3.2 A new `systemAdministration` policy area

§6's matrix had no area for backup/restore/migration/data-location —
the Session 3 finding (§9.2). Added to `rolePolicy.ts`'s
`POLICY_AREAS`/`MATRIX` (and therefore the generated fixture and
`role_policy.rs`): a single new row, `administrator: ["view",
"administer"]`, every other role `[]`. Per explicit Session 4
instruction — "system-level destructive/configuration mutations should
be Administrator-only unless the current approved architecture proves
otherwise" — and nothing in the approved architecture names any other
role for this authority, so administrator-only is not a placeholder,
it's the considered answer.

#### 9.3.3 The trusted backend guard (`authz.rs`, new)

One reusable authorization path every privileged command calls:

```
session token -> validate_session -> active account -> stored role
-> role_policy::can(role, area, capability) -> allow/deny
```

`authz::current_actor(conn, token)` resolves `TrustedActor {user_id,
role, display_name}` from `identity::validate_session` — no role/area/
capability check, just "is there a currently valid, active,
authenticated user behind this token." `authz::authorize(conn, token,
area, capability)` adds the `role_policy::can()` check on top.
`authorize_any`/`authorize_any_app` accept several capabilities (a
masterdata upsert can insert or update in the same call, so "has
`create` OR `edit`" is the real gate, not an artificial single-
capability split). **There is no role/userId/displayName parameter
anywhere in any of these signatures** — a caller cannot supply an
identity for the guard to trust, structurally, not by convention.
Every denial is recorded to `security_audit_events` using the
*resolved* trusted actor's real id (or `None`/`None` when there wasn't
even a valid session), never anything the caller's payload claimed.
Fails closed at every step: no token, an unknown/expired/idle-timed-
out/revoked token, or a disabled account all deny, matching
`validate_session`'s own Session 2 semantics exactly — this module
never second-guesses or works around them. A role/status change is
live on the very next `authorize()` call for that session, same
guarantee Session 2 already proved for `current_session` (§17.4).

#### 9.3.4 `save_approval_record` — the Session 0 bypass, closed

The confirmed, exploitable gap named in every session since Session 0:
a direct `invoke("save_approval_record", {...})` wrote a permanent
approval record with any name and no role check, because
`canTransitionTo`'s role gate only ever ran in the *frontend*. Now:

1. `requestedStatus` selects the policy area (`pilot_approved` ->
   `approvalPilot`, `production_approved` -> `approvalProduction`) —
   anything else is refused outright, before authorization is even
   attempted.
2. `decision` selects the capability (`approved` -> `approve`,
   anything else -> `reject`).
3. `authz::authorize_app` resolves the trusted actor and checks
   `role_policy::can(role, area, capability)` — the actual gate.
4. For an "approved" decision (the only one that moves real state),
   `role_policy::is_valid_transition(previousStatus, requestedStatus)`
   must hold — **a manager with real `approve` authority still cannot
   approve `concept -> pilot_approved` directly**, proving role
   capability and workflow-transition validity are both required, not
   either alone (this session's explicit brief, §6 of it).
5. `approvedBy`/`approvedByRole`/`reviewerUserId`/`reviewerRole` are
   overwritten with the trusted actor's real identity, unconditionally
   — whatever the caller sent for those fields is discarded, not merely
   ignored for the authorization decision.

`formulations::tests` (new, 7 tests) prove this directly against the
pure `finalize_approval_record`/`approval_area_for`/
`approval_capability_for` functions, split out specifically so this
logic is unit-testable without a Tauri harness: a valid transition
succeeds and every identity field is overwritten; `concept ->
pilot_approved` is denied even for `research_manager`; a rejection
doesn't require transition validity (nothing moves); a record with NO
identity fields at all still ends up correctly attributed. `authz.rs`'s
own tests (§9.3.3) independently prove the role-check half (worker vs.
manager separation) at the guard layer.

#### 9.3.5 Formulation content writes, and the "delete has no grant anywhere" finding

`save_formulation`/`save_formulation_version`/`save_formulation_draft`/
`discard_formulation_draft` require `create` OR `edit` on `formulation`
— per §6's literal matrix, that's `researcher` alone; every other role
(including `administrator`, deliberately view-only on scientific
content, §9) is refused. This is a real, load-bearing consequence of
enforcing §6 as transcribed, not a bug — flagged for the domain review
(Risks item 1) since it may be stricter than intended in practice.

**A second, more structural finding**: no role has the `delete`
capability in *any* domain content area (`rawMaterials`/`formulation`/
`laboratory`/`stability`/`regulatory`/`optimization`/`dataExchange`/
`documentControl` all deny `delete` to all 12 roles). The only cell in
the entire matrix that grants `delete` at all is `projects`/
`administrator`. Gating `delete_formulation`/`delete_master_record`
against their own domain area's `delete` would make deletion
unreachable for everyone — not a safety win, a broken feature. Both
therefore gate against `projects`/`delete` instead (administrator-
only) — a deliberate, documented Session 4 choice using the one real
`delete` grant that exists, not a matrix change. Flagged for the
domain review: should any area grant `delete` to a working-tier role
directly?

#### 9.3.6 Generic masterdata CRUD — the widest gap, closed with a real domain mapping

`upsert_master_records`/`delete_master_record`/
`write_master_collection_raw` previously had no actor concept
whatsoever. Now: `masterdata.rs`'s new `area_for_collection()` maps
every one of the 90 allow-listed collections onto a `PolicyArea`,
built from this file's own Phase-by-Phase domain-grouping doc comments
and, where one already existed, `dataExchangeRegistry.ts`'s
`targetCollection`/per-template `authorization` role lists (real,
pre-existing domain judgment, reused rather than reinvented). **An
unmapped name returns `None`, which is a hard deny** — a collection
added to `COLLECTIONS` without a matching mapping arm is refused, never
implicitly allowed; `masterdata::tests::
every_allow_listed_collection_has_a_policy_area_mapping` asserts
100% coverage as a loud, intentional finding if it ever regresses.
Upsert/raw-write require `create` OR `edit` on the mapped area; delete
uses the `projects`/`delete` grant, same reasoning as §9.3.5. This
grouping is a first-draft judgment call, same as §6 itself — flagged
for the domain review, not presented as final.

#### 9.3.7 Audit-actor spoofing, closed

`append_audit_event`'s `event.actor` previously came straight from the
webview. Now requires a valid session (`authz::current_actor_app`) and,
when `event.actorKind` is absent or `"human"` (the common, default
case — a real person took this action), overwrites `event.actor` with
the trusted session's display name. An explicit non-human `actorKind`
(`"agent"`/`"system"`/`"import"` — already not identity-authoritative
per `status.ts`'s own `Actor` union) is left as the caller set it,
since those values never claimed to be a specific person in the first
place — there is nothing to close there. Internal, genuinely
system-generated audit rows (lockout/login/bootstrap events, §23) were
already written from a dedicated Rust path (`identity::
record_security_audit_event`, called directly by `auth.rs`) before this
session and remain so — they were never reachable from the webview at
all.

#### 9.3.8 Attachments

`copy_attachment_into_project` requires `create` OR `edit` on
`formulation` — every attachment site (trial observations/deviations,
stability results/failures, corrective actions) is reached from a
formulation workspace, so the formulation is the real parent/domain
context, not a placeholder. `open_attachment` requires only a valid
session (reading an already-approved attachment isn't itself a
privileged action).

#### 9.3.9 System Administration commands

Gated `systemAdministration`/`administer` (administrator-only):
`backup::create_backup`, `backup::restore_backup`,
`migration::create_pre_migration_backup`,
`data_location_manager::{move_data_location, use_existing_data_location,
restore_default_data_location, cleanup_old_data_location}`,
`automatic_backup::{write_automatic_backup_config,
apply_pre_migration_retention}`.

**Deliberately NOT gated**: `automatic_backup::run_automatic_backup`.
Per explicit Session 4 instruction — "trusted internal background
functions must not be broken merely because they do not have an
interactive user session" — restricting the scheduled/triggered backup
run itself to administrators would silently stop a non-admin user's own
configured automatic backups from ever running. The *policy* it obeys
(`write_automatic_backup_config`) is gated; the run is not. This is the
one command in the whole session deliberately left unauthenticated by
design, not by oversight — every other command in this section is
either gated or explicitly classified below (§9.3.10).

#### 9.3.10 Privileged-command classification (extends the Session 3 inventory)

| Category | This session | Representative commands |
|---|---|---|
| PRIVILEGED_ENFORCED | 17 commands gated this session | §9.3.4-§9.3.9 above |
| AUTHENTICATED_READ | Valid session required, no capability check | `formulations::{list_formulations, read_formulation, read_formulation_draft, list_approval_records, read_audit_log}`, `masterdata::{list_master_records, backup_master_collection}`, `attachments::open_attachment` |
| TRUSTED_INTERNAL_ONLY | Deliberately unauthenticated — background/system-triggered | `automatic_backup::run_automatic_backup` (§9.3.9); `auth::{bootstrap_status, bootstrap_create_administrator, login, logout, current_session}` (correctly role-parameter-free by design since Session 2, §9.1) |
| READ_ONLY_NO_ROLE_GATE_NEEDED | Local machine config / static data, not regulated business data — unchanged from Session 3's own classification | `masterdata::list_master_collections`; `workspace::*`, `jupyter::*`, `kernel::*`, `compute::*`, `modal::modal_status`, `preview_server::preview_url`, `tools::detect_tools`, `updates::check_for_update`, `debug_log::log_debug`, `artifact_file::*`; `backup::{verify_backup, inspect_backup, pick_backup_destination, cancel_backup, cancel_restore}`; `data_location_manager::{check_interrupted_data_move, cancel_data_move, validate_data_move_destination}`; `automatic_backup::{read_automatic_backup_state, open_automatic_backup_destination}`; `migration::{read_schema_meta, write_schema_meta, check_schema_compatibility, append_migration_journal, read_migration_journal}`; `data_root::*` |
| DEFERRED_WITH_REASON | Privileged-shaped, not reviewed this session — real, disclosed gap, not silently accepted | `data_location_manager::resume_interrupted_data_move` (completes-or-rolls-back an interrupted move — privileged in effect, but outside this session's explicit "4 data-location commands" scope); `materials::{import_materials, cost_formulation}`; `provenance::record_provenance`, `runs::record_run`; `formulation::run_formulation_optimize`, `formulation_advanced::*`, `formulation_v2::*` (compute/generation only — their persisted output goes through the now-gated `save_formulation_draft`/`save_formulation_version`, but the compute commands themselves weren't reviewed) |

No privileged mutation from the Session 3 inventory is silently
unclassified — every row above is a deliberate category, including
"deferred," not an omission. §9.3.10's DEFERRED_WITH_REASON row is this
session's own honest residual-gap disclosure, not a claim that Phase 13
is finished (Risks item 10 continues this).

#### 9.3.11 Frontend: `useTrustedActor()` + `can()` for visibility, backend stays authoritative

`SettingsPage.tsx`'s four System-Administration cards (Active Data
Location, Backup and Recovery, Automatic Backups, Schema Migration) are
now hidden for a non-administrator — `can(trusted.role,
"systemAdministration", "administer")`, same `useTrustedActor()` hook
Session 3 built. This is UX only: every action those cards expose was
already hard-denied server-side before this change; hiding them just
avoids showing a button that always fails. Outside a real
`AuthProvider` (this codebase's test suite), nothing is hidden — the
same fallback convention every other `useTrustedActor()` site already
uses. The 10 role-selector sites Session 3 wired were re-audited this
session: no additional hardcoded-role/`"local"`-actor site was found
needing closure; `StabilityPanel`'s `manualInclusionReviewer` remains
deliberately untouched (legitimate reviewer-name metadata, not a role
selector, §9.2). Project-level visibility restrictions were **not**
implemented — out of scope, confirmed by explicit instruction; every
authenticated user still sees every project.

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
| Raw materials | raw_material | **production_manager** (verification gate, §15.4) | usable in a formulation's dossier | raw_material corrects | production_manager approval *(authority decided, no `FormulaStatus` yet — see §15.4)* |
| Supplier/procurement docs | procurement | **production_manager** (verification gate, §15.4); quality/regulatory retain their own independent checks where the domain separately requires them | usable as dossier evidence | procurement corrects | production_manager approval *(authority decided, no `FormulaStatus` yet — see §15.4)* |
| Quality (QA/QC) | quality | quality_manager | `pilot_approved`/`production_approved` eligibility | returns to quality | quality_manager approval (existing gate, §6.2) |
| Regulatory | regulatory | regulatory (unsplit) | `production_approved` eligibility | `rejected` (existing) | regulatory's own sign-off (existing gate, §6.2) |
| Dossier/evidence | researcher, raw_material, regulatory | regulatory (verify/confirm) | submission-ready dossier | evidence revoked/superseded (existing) | regulatory confirmation (existing, `regulatoryReviews.ts`) |
| Production engineering / scale-up | production_engineering | **production_manager** (handoff gate, §15.4) | production readiness | returns to production_engineering | production_manager approval *(authority decided, no `FormulaStatus` yet — see §15.4)* |
| Production | production | **production_manager** (release gate, §15.4) | batch release eligibility | returns to production | production_manager approval *(authority decided, no `FormulaStatus` yet — see §15.4)* |
| Production approval/release | production, quality | production_manager, quality_manager, regulatory | `production_approved` (existing gate, §6.2) | `rejected` (existing) | manager-tier + regulatory sign-off (existing) |
| Document control/publication | document_control | document_control (self, or per policy) | published/distributed document | document held back | package completeness — *not* a scientific gate |

**Gate *authority* resolved for all four rows above, this closure
update — not silently assumed solved as *implementation***: raw-material
verification, supplier-document verification, production-engineering→
production handoff, and production release are now decided
architecture (§15.4: `production_manager` approves all four). None of
the four has a corresponding `FormulaStatus`/gate in the current domain
model yet — the app still has no representation for "raw material
verified" or "scale-up approved" as a workflow state. Building that
representation and wiring real enforcement is real, unimplemented Phase
13 work (Session 4 or a dedicated workflow session); this update decides
*who* approves once it exists, it does not build the gate itself. Rows
without an "(authority decided, no `FormulaStatus` yet)" note reuse a
gate that already exists and works today.

### 15.4 USER-APPROVED: Production Manager gate resolution (Session 1 closure)

The user has resolved all four gaps left open by §15.3's first draft.
Approval authority for all four is **`production_manager`** — a single,
explicit product decision, not four independent ones:

| # | Gate | Worker role(s) whose completion does **not** satisfy it | Approval authority |
|---|---|---|---|
| 1 | Raw material verification | `raw_material` | `production_manager` |
| 2 | Supplier document verification | `procurement` | `production_manager` |
| 3 | Production Engineering → downstream production handoff | `production_engineering` | `production_manager` |
| 4 | Production completion / production release | `production` | `production_manager` |

**Worker completion ≠ manager approval, restated per-gate**:
- `raw_material` may prepare/complete raw-material records; this does
  not satisfy the raw-material verification gate.
- `procurement` may collect/complete supplier documentation; this does
  not satisfy the supplier-document verification gate.
- `production_engineering` may complete scale-up/manufacturing-
  readiness work; this does not authorize the downstream production
  handoff.
- `production` may complete manufacturing/operational work; this does
  not authorize production release.

None of `raw_material`, `procurement`, `production_engineering`, or
`production` gains any new approval capability from this decision — the
gate stays owned exclusively by `production_manager`. No worker role may
approve its own manager gate. `administrator` retains its existing,
user-approved broad approval/testing authority (§9) and can exercise
all four gates once they're implemented, on the same explicit-exception
basis as every other gate in this document — this decision does not
grant `administrator` anything it didn't already have.

**Does not touch already-approved gate ownership**: Research/Laboratory
work still gates through `research_manager`; Quality work still gates
through `quality_manager`; `regulatory` keeps its own independent,
unsplit authority (§8, §6.2). This decision resolves only the four
gates listed above — it is not a general reassignment of approval
authority to `production_manager`. Where an existing check is genuinely
independent (e.g. a Quality or Regulatory verification the domain
already requires separately from these four gates), that check is
preserved unchanged, not silently folded into `production_manager`.

**Impact on `APPROVAL_AUTHORITY` (§6.2)**: none. `APPROVAL_AUTHORITY` is
keyed by `FormulaStatus` value (`pilot_approved`, `production_approved`,
`retired`, `rejected`), and none of these four gates has a
`FormulaStatus` representation yet — there is nothing in `status.ts` to
add `production_manager` to. This is an intentional non-change, not an
oversight: adding entries for statuses that don't exist would be
inventing enforcement the domain model doesn't support yet, which this
closure explicitly avoids. When Session 4 (or a dedicated workflow
session) adds real `FormulaStatus`/gate representations for these four
stages, `production_manager` is now the pre-decided approval role to
wire in — no further product decision needed at that point.

**Session 4 status (explicit, per this session's brief item 7)**: still
exactly what §15.4 describes above — no `FormulaStatus`, no gate
command, no workflow transition exists for any of the four. Session 4
did not fake enforcement of these gates with a bare permission check
standing in for the missing workflow state; there is no
`verify_raw_material`/`verify_supplier_document`/
`approve_production_handoff`/`release_production` command to gate in
the first place. What Session 4 did secure is the underlying record
mutation boundary these four gates will eventually sit in front of:
`materials`/`material_documents`/`suppliers` (raw-material gate #1) and
the supplier-document collections (gate #2) now route through
`masterdata::upsert_master_records`'s generic-CRUD authorization
(§9.3.6, mapped to the `rawMaterials` policy area, which already
carries `production_manager`'s `verify` capability from Session 3,
§9.2/§7) — so the records a future verification gate would act on are
no longer writable by an unauthorized role, even though the gate action
itself still doesn't exist as a command. Gates #3 and #4 (production
engineering handoff, production release) have no corresponding
masterdata collection either — `productionEngineering`/`production` are
formulation-lifecycle states, not master-data rows — so nothing in this
session touches their storage boundary at all; they remain entirely
unimplemented, exactly as before.

Still explicitly tracked, not implemented, going into Session 5: all
four `FormulaStatus`/gate representations, their exact transition-graph
entries, and the dedicated Tauri commands (or extension of
`save_approval_record`'s shape) that would let `production_manager`
actually grant them.

### 15.5 Session token storage (implemented Session 2)

Session 1's `authenticated_sessions.id` stored a plain `new_id("sess")` —
8 random bytes plus a timestamp — directly, used as both the row's
primary key and, implicitly, the bearer credential a caller would
present. Session 2's brief (§15) asked whether hashing the presented
token before persistence was practical without a schema migration — it
is: `identity::create_session` now generates a fresh, unrelated
256-bit random token (`getrandom`, 32 bytes) and stores only its SHA-256
hash (`sha2`, already a dependency — `backup.rs`'s manifest hashing uses
it) in the existing `id` column. The raw token is returned to the caller
exactly once, at creation, and is never written to the database, a log
line, or an audit `detail` field (tested:
`the_raw_session_token_is_never_stored_only_its_hash_is`,
`no_audit_row_or_login_attempt_row_ever_contains_a_password_hash_or_raw_session_token`).
`identity::validate_session`/`revoke_session` hash whatever token they're
handed and look up by that hash. No schema migration was needed — `id`
already held an opaque string; it now holds a hash of one instead. This
means a leaked/stolen `identity.db` file alone no longer hands out a
reusable active session — the attacker would also need the raw token,
which the database never contains. Not a JWT: an offline local desktop
app has no second party to verify a signed claim against, so a plain
random-token-plus-hash design is the appropriate amount of complexity,
per the brief's explicit instruction not to invent JWT infrastructure
without a concrete need.

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

## 17. Authentication lifecycle (implemented Session 2)

### 17.1 Final lockout and session policy

`identity::update_login_state(conn, user_id, success, threshold,
lock_secs)` (Session 1) is now called with `auth.rs`'s real application
policy, not just test values:

| Policy | Value | Constant |
|---|---|---|
| Failed-attempt lockout threshold | 5 consecutive failures | `auth::LOGIN_LOCKOUT_THRESHOLD` |
| Lockout duration | 15 minutes, always temporary | `auth::LOGIN_LOCKOUT_SECS` |
| Session absolute lifetime | 12 hours | `auth::SESSION_TTL_SECS` |
| Session inactivity timeout | 60 minutes | `auth::SESSION_IDLE_TIMEOUT_SECS` |

A simple, defensible local-desktop baseline — not tuned against real
usability data yet (Risks, below). Lockout is never permanent and never
requires administrator intervention for an ordinary mistyped password; a
lock that has passed its `locked_until` allows login attempts again
automatically (tested: `an_expired_lock_allows_login_attempts_again`),
and lockout state survives a process restart because it's a `users`
row, not in-memory state (tested:
`lockout_state_persists_across_a_database_reopen`). Idle timeout is
`identity::validate_session`'s `idle_timeout_secs` parameter (§15.2's
original `create_session`/`validate_session` design gained this
parameter this session, using the already-existing but previously
unused `last_seen_at` column — no schema change needed); a successful
validation slides `last_seen_at` forward (normal desktop-app idle UX:
activity keeps a session alive, only true idleness expires it).

### 17.2 Login flow and timing/enumeration defense

`auth::login_logic` (called by the `login` Tauri command): normalize
username → look up the user → check account status → check lockout →
verify the Argon2id password → update login state → record the attempt
→ on success, create a session and return `AuthSession`. Every failure
shape — unknown username, malformed username, disabled account, locked
account, wrong password, oversized input — returns the **identical**
public string, `"Invalid username or password."` (tested directly:
`wrong_password_and_unknown_username_return_the_identical_public_error`
asserts the two error values are `===` equal, not just similarly
worded). Internally, `login_attempts`/`security_audit_events` rows *do*
distinguish the real reason (`unknown_username`, `account_disabled`,
`account_locked`, `invalid_password`, `invalid_input`) — safe to record
since those tables are never frontend-visible.

**Timing/enumeration defense**: when there is no real user record to
check a password against (unknown username, disabled account, locked
account), `login_logic` still calls `identity::verify_password` against
`identity::dummy_password_hash()` — a real, validly-hashed Argon2id PHC
string for a fixed, meaningless constant, computed once and cached —
and discards the result. This spends the same Argon2id CPU cost on
every code path that returns the generic error, so response time alone
doesn't distinguish "no such user" from "wrong password" the way a
fast-path early return would. This does **not** claim mathematically
constant timing (network/OS/DB-cache jitter dwarfs anything finer); it
claims the same expensive operation runs on every losing path. A
password longer than 512 characters is rejected before touching Argon2
at all (on any path, including the dummy-hash one) — otherwise an
oversized-password login attempt would be a cheap way to force
disproportionate server-side CPU cost, since Argon2's cost scales with
input size.

### 17.3 Login and Administrator Setup screens

`LoginScreen.tsx` / `BootstrapScreen.tsx` (`apps/desktop/src/components/auth/`):
username + password (Login) or username + display name + password +
confirm password (Setup), a show/hide password toggle, a loading state,
Enter-to-submit (native `<form onSubmit>`), and the one generic error
message for Login. No sign-up, no social/email/SMS login, no
"Forgot password?" email flow anywhere — password recovery is
administrator-mediated (a later session's Administration → Users
"reset password" action); the Login screen's only related text is a
one-line pointer to that ("Forgotten your password? Ask your
administrator to reset it."), never a self-service flow of any kind.
Bootstrap has no role field, hidden or otherwise (tested:
`the_bootstrap_screen_has_no_role_selector_anywhere` and the backend
structural guarantee in §5/§9.1).

### 17.4 Startup authentication routing

`AuthProvider.tsx` wraps `main.tsx`'s `<RouterProvider>` — not
`AppShell`, the whole routed application. On mount it calls
`bootstrap_status`; if bootstrap is required it renders `BootstrapScreen`
directly (no router, no `AppShell`, no sidebar). Otherwise it reads a
persisted session token (see §17.5) and, if present, calls
`current_session` to resolve it; a valid result renders the routed
application, anything else (`null`, or the very first run before an
administrator exists at all) renders `LoginScreen`. Because the router
itself is a child of this gate rather than a sibling, there is no route
a direct URL/history navigation could reach before authentication
resolves — the routes don't exist yet as far as React is concerned.
While the initial `bootstrap_status`/`current_session` calls are
in-flight, a blank themed shell renders (no app chrome, no
protected-content flash).

### 17.5 Authenticated `UserContext` shape

`AuthProvider`'s React context exposes exactly the safe projection
`auth::SafeUser` maps to — `userId`, `username`, `displayName`, `role`,
`accountStatus`, `mustChangePassword` — plus `login`/`logout`/
`completeBootstrap` actions and a `phase`. No mutable `permissions`
array; role-to-capability derivation stays `rolePolicy.ts`'s job
(Session 3, §7/§14). Only the opaque bearer token is persisted to
`localStorage` (`formulab.auth.token`) — never username, role, or any
other user detail — and every restart re-resolves the full user record
from Rust via `current_session` rather than trusting a cached frontend
copy (§22's "never use localStorage as the sole authentication
authority" requirement). A role change made directly against the
database takes effect on the very next `current_session`/session
validation call for that same still-valid token (tested:
`a_role_change_is_reflected_on_the_very_next_session_check`), matching
§19's existing "no stale frontend permission snapshot" guarantee —
Session 2 doesn't add a polling/refresh timer, since nothing yet calls
`current_session` per authorized action outside startup and
login/bootstrap entry; wiring that into every privileged action is
Session 4's job once `rolePolicy.ts` exists to call it from.

**Deliberately not built this session** (§21 of the Session 2 brief):
Administrator bootstrap/Setup UI polish beyond the functional screen
above, Administration → Users UI, arbitrary user creation, role-change
UI, password-reset administration UI, full `rolePolicy.ts` enforcement,
full application-wide RBAC, the full department workflow engine.

---

## 18. Account deactivation (storage primitive Session 1, honored by login/session Session 2; admin UI is Session 5)

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

**Session 2**: `login_logic` refuses a disabled account before checking
the password at all (still via the one generic error, §17.2 —
`disabled_account_cannot_log_in_even_with_the_correct_password`), and
`current_session_logic` (used at startup and by `AuthProvider`) resolves
`identity::validate_session`, which itself refuses any session whose
owning user is no longer `active` — checked fresh on every call, never
cached. There is still no admin UI to disable a user (Session 5); this
session only made sure that once a user *is* disabled (by any means,
including a test/manual DB edit), login and session validation both
honor it correctly.

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

## 23. Audit logging (storage primitive Session 1; wired to real commands Session 2)

`record_security_audit_event(conn, actor_user_id, target_user_id,
action, outcome, detail)` — tested to persist correctly and to never
contain password material (`security_audit_events_persist_without_ever_storing_password_material`
explicitly asserts no stored `detail` field contains the test user's
password hash). **Session 2** calls it from real authentication events,
not just tests: `bootstrap_administrator_created`, `login_success`,
`login_failure` (with a safe, internal-only reason in `detail` —
`unknown_username`/`account_disabled`/`account_locked`/
`invalid_password`/`invalid_input`), `login_lockout_triggered` (a
distinct event the moment a failure count crosses the threshold, not
just another `login_failure`), and `logout`. Verified with a dedicated
regression (`no_audit_row_or_login_attempt_row_ever_contains_a_password_hash_or_raw_session_token`)
that no audit `detail` or `login_attempts.outcome` value ever contains
the stored password hash, the raw bearer session token, or the
plaintext password used in the test. Remaining event classes from
Session 0's design (account lifecycle beyond login/logout, password
reset/change, role change, permission denied, privileged admin actions)
stay Session 5/6, once the commands that would trigger them exist.

---

## 24. Security test matrix

See `docs/PHASE13_SECURITY_TEST_MATRIX.md` — updated this session with
Session 2's real login/bootstrap/lockout/session/audit test results
(§G: `identity.rs`, 38 tests, 28 from Session 1 plus 10 new Session 2
additions for hashed tokens/idle-timeout/lockout/bootstrap; §H:
`auth.rs`, 25 new tests, plus 12 new frontend `AuthProvider` tests).

---

## 25. Proposed Phase 13 sessions (Sessions 1-4 complete; renumbered plan unchanged in shape from Session 0)

1. ~~User database + migrations + password subsystem~~ **DONE.** ~~Production Manager gate authority for the four §15.3 gaps~~ **DECIDED (§15.4), Session 1 closure — implementation still Session 4/dedicated workflow session.**
2. ~~Administrator bootstrap + `login`/`logout` Tauri commands +
   authenticated session lifecycle (creation, persistence across
   restarts, expiration/idle timeout), using the 12-role model.~~
   **DONE, Session 2** (§5, §15.5, §17).
3. ~~`rolePolicy.ts` (canonical `can()` covering all of §6's matrix, not
   just the two approval gates) + wire `UserContext` through the app +
   a Rust/TypeScript role-vocabulary parity test.~~ **DONE, this
   session** (§7, §9.2) — plus a privileged-command inventory (§9.2)
   sizing Session 4's actual scope, not part of the original plan text
   but required to make Session 4 tractable.
4. ~~Application-wide enforcement: every Tauri command performing a
   role-gated action resolves role server-side and calls `can()`; every
   nav/button uses the same `can()`.~~ **DONE, this session, for the
   Session 3 inventory's priority set** (§9.3): `save_approval_record`
   (§9.3.4), formulation writes (§9.3.5), generic masterdata CRUD
   (§9.3.6), audit attribution (§9.3.7), attachments (§9.3.8), and every
   System Administration command (§9.3.9) now resolve role server-side
   via one shared guard (`authz.rs`, §9.3.3) built on a cross-language
   policy contract with no hand-duplicated Rust matrix (§9.3.1). A new
   `systemAdministration` policy area was drafted (§9.3.2) since §6 had
   none. Commands outside the priority set are classified, not left
   silently unreviewed (§9.3.10's 5-category taxonomy). The §15.3 gates
   remain unimplemented by design (§15.4's Session 4 status note) — no
   `FormulaStatus` exists for any of them, so there was nothing to wire
   workflow-gate enforcement into yet.
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

## Risks and open decisions (updated Session 4)

1. **§6's full matrix is Session 1's first draft**, built from current
   navigation/routes and §1.1's role intent, not domain-expert-
   reviewed — now actually enforced (§9.3) for the priority command
   set, which makes this review more urgent, not less: Session 4 found
   enforcing it literally means only `researcher` can write formulation
   content (§9.3.5) and no role can delete anything outside
   `administrator` on `projects` (§9.3.5/§9.3.6) — both real,
   load-bearing consequences now, not abstract gaps. The
   `systemAdministration` area Session 4 drafted (§9.3.2) and the
   masterdata collection->area mapping (§9.3.6) are both first-draft
   judgment calls needing the same review.
2. **§9 — Administrator's retained approval authority** is explicit and
   user-approved for this phase; still worth a final human confirmation
   before Session 4 makes it load-bearing in enforcement.
3. **§12 — project/resource access is confirmed (not just
   recommended) out of scope for Phase 13** — no longer an open
   question, closed in Session 1's closure.
4. **§15.3's four gaps — authority resolved, implementation still
   open.** Raw-material verification, supplier-document verification,
   production-engineering→production handoff, and production release
   are now decided as `production_manager` gates (§15.4, user-approved,
   Session 1 closure). They still have no `FormulaStatus` representation
   in the current domain model — building that and wiring real
   enforcement is real, unimplemented work, unchanged by Session 4
   (§15.4's Session 4 status note explains exactly what was and wasn't
   touched) — still Session 5 or a dedicated workflow session.
5. **§10 — Argon2 parameters are crate defaults**, not hand-tuned
   against real target hardware — revisit only if a genuine performance
   problem surfaces on real desktop specs.
6. ~~§17 — exact lockout threshold/backoff curve~~ **DECIDED this
   session** (§17.1: 5 attempts / 15-minute lock / 12h session / 60min
   idle) — a simple, defensible baseline, not yet validated against real
   usability testing on real desktop hardware. Revisit if it proves too
   strict/loose in practice.
7. **§22 Model B** remains explicitly out of Phase 13's implementation
   scope.
8. ~~`current_session` is not yet called per privileged action~~
   **RESOLVED for the priority set, this session.** Every
   `PRIVILEGED_ENFORCED` command (§9.3.10) now calls
   `validate_session` fresh, via `authz::authorize`, on every single
   invocation — not once at login — so a role/status change is live on
   the very next privileged action for that session
   (`authz::tests::a_role_change_takes_effect_on_the_very_next_
   authorization_check` proves this directly). Commands outside the
   priority set (§9.3.10's other categories) don't call it at all yet —
   narrower than "resolved everywhere," but the mechanism itself is
   proven, not just designed.
9. **No password-complexity policy beyond an 8-512 character length
   bound** (`auth::validate_new_password`) — deliberately not inventing
   uppercase/digit/symbol rules the brief never asked for; revisit only
   if a real compliance requirement demands it.
10. ~~Session 3's privileged-command inventory (§9.2) is audit-only~~
    **Session 4 closed the priority rows** (§9.3.4-§9.3.9); the
    `DEFERRED_WITH_REASON` row (§9.3.10) is what's left — a smaller,
    named, disclosed set (`resume_interrupted_data_move`,
    `materials::{import_materials, cost_formulation}`,
    `provenance::record_provenance`, `runs::record_run`,
    `formulation*::` compute commands), not the whole original gap.
    Phase 13 is **not** fully secure yet — this item tracks exactly
    what remains, so "not yet reviewed" stays distinguishable from
    "reviewed and found safe."
11. **§9.3.5's formulation-write finding may be stricter than
    intended.** Enforcing §6's literal matrix means only `researcher`
    can create/edit formulation content — `research_manager` (view/
    approve/reject only), `administrator` (view-only by explicit
    design, §9), and every other role are all refused. If this proves
    too strict in real use, the fix is a matrix correction (Risks item
    1's domain review), not loosening `authz.rs`'s guard itself.
12. **§9.3.6's masterdata collection->area mapping is Rust-only**, not
    parity-tested against a TypeScript equivalent the way the role
    matrix and transition graph are (§9.3.1) — there is no
    `dataExchangeRegistry.ts`-shaped single source for "which
    `PolicyArea` does collection X belong to" today. A future session
    adding a TypeScript-side consumer of this same mapping (e.g. for
    frontend masterdata-write button visibility) should either import
    a shared mapping or accept the drift risk consciously, not
    silently re-derive a second one.
13. **`run_automatic_backup` stays deliberately unauthenticated**
    (§9.3.9) — correct per this session's explicit instruction, but
    worth re-confirming during the domain review: does *any* backup
    class ever need to be administrator-gated even when
    system-triggered (e.g. a `preMigration` class run outside an
    interactive migration flow)? Not a known issue, just an open
    question this session didn't need to answer.
