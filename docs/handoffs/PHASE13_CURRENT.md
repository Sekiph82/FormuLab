# Phase 13 — Enterprise Identity, Authentication, Fixed RBAC & Application Security

## Status: SESSION 1 CLOSED — identity database, password subsystem, final 12-role model, and the Production Manager workflow-gate decision are all committed. No login/bootstrap UI, no Administration → Users UI, no application-wide enforcement — those are later sessions. Full design in `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md`, test report in `docs/PHASE13_SECURITY_TEST_MATRIX.md`. Runs in parallel with Phase 12's still-open SignPath thread (`docs/handoffs/PHASE12_CURRENT.md`) — unrelated, does not block or get blocked by it.

## Session 1 closure addendum: Production Manager gate decision

The user resolved all four workflow gaps Session 1 originally left open
(architecture doc §15.3). All four are now **`production_manager`**
gates — one explicit product decision, not four:

| Gate | Worker(s) whose completion doesn't satisfy it | Approver |
|---|---|---|
| Raw material verification | `raw_material` | `production_manager` |
| Supplier document verification | `procurement` | `production_manager` |
| Production Engineering → production handoff | `production_engineering` | `production_manager` |
| Production completion → release | `production` | `production_manager` |

Documentation-only change: no `FormulaStatus`/gate exists yet for any
of the four (unchanged fact from Session 1), so no source code or tests
changed for this closure — see architecture doc §15.4 for full
reasoning, including why `APPROVAL_AUTHORITY` (§6.2) itself needed no
edit (it's keyed by `FormulaStatus`, and none of these four have one
yet). Existing Research Manager / Quality Manager / Regulatory gate
ownership is unchanged.

## Session 1 summary

**The role model changed, authoritatively, mid-phase.** After reviewing
the real FormuLab dossier/evidence/document workflow, the user replaced
Session 0's 6-role draft with a final **12-role** model:
`researcher`, `research_manager`, `quality`, `quality_manager`,
`regulatory`, `raw_material`, `procurement`, `production_engineering`,
`production`, `production_manager`, `document_control`,
`administrator`. `chemist` was folded into `researcher`;
`quality`/`production` each split into an employee tier and a manager
tier that alone holds approval authority. No `packaging` role was
created — packaging-related work maps onto the existing roles above.
Full role intent: architecture doc §1.1.

**Every "6 roles" reference in the codebase and docs was found and
corrected this session** — `packages/shared/src/schemas/status.ts`'s
`APPROVAL_ROLES`/`APPROVAL_AUTHORITY`, `laboratoryStandards.ts`'s
manager-role gate, `dataExchangeRegistry.ts`'s per-template role lists,
every frontend hardcoded `role: "chemist"` actor (13 sites), every
`APPROVAL_ROLES`-driven `<select>` (automatically correct — they map
over the constant), 2 i18n strings (`session.json`), 2 stale-claim i18n
strings (`help.json`), and roughly 30 test-file role references across
18 test files (renamed, not just mechanically substituted — 4 tests
that used to assert `chemist`/`quality` *could* grant an approval were
rewritten to assert the correct manager-tier role can and the
employee-tier role cannot, adding the explicit role-model-regression
tests the phase brief required).

**`APPROVAL_AUTHORITY` was re-derived, not blindly carried forward** —
audited per explicit instruction. `pilot_approved` and
`production_approved` moved from employee-tier-inclusive lists to
manager-tier + regulatory + administrator only. Full derivation and
the exact old→new mapping: architecture doc §6.2.

**Session 0's core audit finding is unchanged and still real**: no
authentication exists; `reviewerRole` etc. are still freely-editable,
unauthenticated `<select>`s; `save_approval_record` (Rust) still
performs no role check at all. Session 1 did not fix this — it built
the identity-storage foundation the fix (Session 4) will sit on, and
made sure that foundation already speaks the correct, final role
vocabulary.

## Deliverables (this session)

- `apps/desktop/src-tauri/src/identity.rs` (new) — the identity/
  authentication database foundation: `identity.db` (app-private,
  never the relocatable data root), 4 tables (`users`,
  `authenticated_sessions`, `login_attempts`,
  `security_audit_events`), a versioned/idempotent migration runner
  (`PRAGMA user_version`-based), Argon2id password hashing
  (`hash_password`/`verify_password`), username validation/
  normalization, and narrow repository primitives (create/find/update
  user, session create/validate, login-attempt/audit persistence). 28
  tests, all passing. No Tauri command exposes any of this yet.
- `apps/desktop/src-tauri/Cargo.toml` — added `argon2` (0.5) and
  `rand_core` (0.6, `getrandom` feature).
- `packages/shared/src/schemas/status.ts` — 12-role `APPROVAL_ROLES`,
  re-derived `APPROVAL_AUTHORITY`.
- `packages/shared/src/engine/laboratoryStandards.ts`,
  `dataExchangeRegistry.ts` — role-list corrections.
- 13 frontend files (hardcoded actors + `useState` defaults) — see
  the external log for the exact list.
- 2 i18n locale files (`en/session.json`, `en/help.json`) — stale
  role-name/claim strings corrected (English only this session; other
  7 locales not updated — flagged as a known gap, same as this
  project's established i18n-gap convention).
- ~18 test files across `packages/shared` and `apps/desktop` —
  updated for the new role vocabulary, including new role-model-
  regression assertions.
- `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` — substantially
  revised: 12-role model, four-concept authorization layering
  (visibility/role-capability/workflow-state/required-approval),
  workflow foundation vocabulary, a proposed canonical workflow matrix
  (with 4 explicitly-marked implementation gaps), updated
  `APPROVAL_AUTHORITY` derivation, `identity.db` design-as-implemented.
- `docs/PHASE13_SECURITY_TEST_MATRIX.md` — 12-role corrections, new
  §G reporting the 28 real Session 1 tests.
- This handoff.
- External log: `C:\Users\sekip\Desktop\FormuLab-Phase13-Identity-Security-Log.md`, Session 1 entry appended (not a new log).

## What Session 1 deliberately did NOT do

- No login/bootstrap Tauri commands or UI.
- No `Administration → Users` UI.
- No `rolePolicy.ts`/`can()` module (Session 3).
- No application-wide enforcement — `save_approval_record`'s missing
  role check is still unfixed (Session 4).
- No workflow-engine implementation — §15.3's matrix and its 4 marked
  gaps are a design proposal, not new `FormulaStatus` values or gate
  logic.
- No project/resource access — confirmed out of scope for Phase 13
  (no longer just "recommended," now decided).
- No other-locale (non-English) i18n updates for the corrected role
  strings.

## Open decisions requiring a human answer before Session 4

1. Is the full §6 role-permission matrix correct for a real lab/QA/
   regulatory/production workflow? Session 1's first draft, not
   domain-expert-reviewed.
2. Final confirmation that Administrator should keep approval authority
   on both gates (currently yes, explicit and user-approved, but worth
   reconfirming before it becomes load-bearing in Session 4's
   enforcement).
3. ~~§15.3's 4 workflow gaps~~ **RESOLVED this closure**: approval
   authority for all four is `production_manager` (§15.4). They still
   have no `FormulaStatus` today — real future implementation work,
   sequencing TBD (Session 4 or a dedicated workflow session), but the
   *who approves* question is no longer open.

## Exact next session

**Phase 13 Session 2: Administrator bootstrap + username/password
login/logout + authenticated session lifecycle, using the new
canonical 12-role identity model.** Wire `identity.rs`'s primitives to
real Tauri commands (`bootstrap_status`, a bootstrap-create command,
`login`, `logout`), decide the exact lockout threshold/backoff and
session idle-timeout policy, and build the Login/Administrator-Setup
screens. Still no `Administration → Users` UI and no application-wide
role enforcement — those stay Session 5/4 respectively.
