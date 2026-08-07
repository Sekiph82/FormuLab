# Phase 13 — Enterprise Identity, Authentication, Fixed RBAC & Application Security

## Status: SESSION 0 (architecture + audit) COMPLETE. No authentication system implemented — this is architecture/documentation only, per the phase brief's explicit instruction. Full design in `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md`, test plan in `docs/PHASE13_SECURITY_TEST_MATRIX.md`. Runs in parallel with Phase 12's still-open SignPath thread (`docs/handoffs/PHASE12_CURRENT.md`) — unrelated, does not block or get blocked by it.

## Session 0 summary

**Audit finding (the core result of this session):** FormuLab today has
no authentication of any kind — every "who did this" field is either
hardcoded `userId: "local"` or a free-text/dropdown value the user
sets themselves (`ApprovalPanel.tsx`'s `reviewerRole` `<select>` and
`reviewerUserId` text input, mirrored in `ClaimsLabelsPanel.tsx`,
`DoePanel.tsx`, `DossierPanel.tsx`, `RegulatoryPanel.tsx`,
`TestMethodDrawer.tsx`). The domain-level approval-authority check
(`APPROVAL_AUTHORITY`/`canTransitionTo` in
`packages/shared/src/schemas/status.ts`) is real, well-designed, and
already refuses non-human actors — but it trusts whatever role it's
handed, and the Rust-side `save_approval_record` command performs no
role check at all, only a "the approver isn't a machine" check. A raw
`invoke("save_approval_record", ...)` call bypassing the UI entirely
can write a valid approval record with any name and no role gate —
a real, currently-exploitable authorization bypass. Full capability-
by-capability audit table in the architecture doc §1.

The six roles the phase brief specifies
(researcher/chemist/quality/regulatory/production/administrator)
**already exist** as `APPROVAL_ROLES` in `status.ts` — no schema
correction needed, confirmed by direct inspection, not assumed.

## Deliverables (this session)

- `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` — full design:
  current-state audit, User entity, username rules, bootstrap,
  fixed role-permission matrix (with the Administrator-authority
  decision made explicit, not silently assumed), canonical
  authorization module design, password/session/database design,
  SQL-injection assessment, brute-force design, audit-log design,
  Administration UI design, standalone vs. company-local identity
  models, implementation session plan, and an explicit risks/open-
  decisions list.
- `docs/PHASE13_SECURITY_TEST_MATRIX.md` — full enumerated test plan
  (authentication, per-role enforcement, privilege escalation, SQL
  injection, administrator security, audit), each test tagged with
  the implementation session it belongs to.
- This handoff.
- External log: `C:\Users\sekip\Desktop\FormuLab-Phase13-Identity-Security-Log.md` (new, per the project's per-phase external-log convention — not a reuse/rename of the Phase 12 log).

## What Session 0 deliberately did NOT do

- No `users`/`authenticated_sessions`/`security_audit_events` tables
  created.
- No login screen, no bootstrap screen, no Argon2id dependency added.
- No `Administration → Users` UI.
- No enforcement wired into any existing command or component.
- No change to `status.ts`, `canTransitionTo`, `APPROVAL_AUTHORITY`, or
  any regulatory engine file — existing enforcement preserved exactly
  as-is, confirmed by not touching it.

All of the above are Session 1+ work, per the architecture doc's §27
plan.

## Open decisions requiring a human answer before Session 4

1. Is the §6 role-permission matrix (beyond the pre-existing Approval
   rows) actually correct for a real lab/QA/regulatory workflow? It's
   this session's first draft from current navigation, not domain-
   expert-reviewed.
2. Should Administrator really retain `pilot_approved`/
   `production_approved` authority? Currently inherited from existing
   `APPROVAL_AUTHORITY` (so as not to weaken current enforcement) —
   flagged, not silently decided.
3. Is project/resource access (§20) needed in Phase 13's initial scope,
   or can it wait for a dedicated later session? Recommendation: wait.

## Exact next session

**Phase 13 Session 1: User database + migrations + password subsystem.**
Build `identity.db` (`users`, `authenticated_sessions`,
`login_attempts`, `security_audit_events`), wire it through the
existing `migration.rs` framework, add the `argon2` crate, and write
the full SQL-injection regression suite (test matrix §D) against every
new query before any UI work begins.
