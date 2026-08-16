# Phase 13 — Enterprise Identity, Authentication, Fixed RBAC & Application Security

## Status: CLOSURE SESSION COMPLETE — the five residual warnings disclosed at Session 5's close are resolved: the four workflow gates have real frontend UI, gate-subject existence is validated server-side, `rolePolicy.ts`'s role-permission matrix is domain-reviewed and finalized (one correction made), `cancel_advanced_formulation_optimize` has an independent, final authorization decision, and a transactional last-administrator guard now protects `Administration → Users`. Full design: `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` §26; test report: `docs/PHASE13_SECURITY_TEST_MATRIX.md`.

## Closure session summary

**Four workflow gates, real UI.** A single reusable `WorkflowGatePanel`
(`components/workflow/WorkflowGatePanel.tsx`, backed by
`lib/workflowGates.ts`) is embedded in the screen each gate belongs to,
not a disconnected generic workflow page: `raw_material_verification`
in `MaterialEditor.tsx` (existing/persisted materials only),
`supplier_document_verification` in `SupplierEditor.tsx` the same way,
`production_engineering_handoff`/`production_release` in
`ApprovalPanel.tsx`'s new "Production Workflow Gates" section. Shows
gate state, who submitted/approved/rejected and when, whether
resubmission is available, and — for the two production gates — the
real prerequisite-blocking reason before a worker tries to submit.
Button visibility is computed from `can()` (UX only; `authz::
authorize_app` remains authoritative).

**Gate subject-existence validation.** `workflow_gates.rs` gained
`SubjectKind`/`validate_subject_exists`, called after authorization but
before any of submit/decide/read proceeds. A masterdata-record gate
rejects a nonexistent `materials`/`suppliers` code and any `parent_id`;
a formulation-version gate requires a `parent_id` and rejects a
`subject_id` that isn't a real file under that exact parent's
`versions/` directory — which structurally proves the cross-subject/
wrong-parent case too (a real version id under the wrong formulation is
a file-not-found, same as a fabricated one). 6 new tests, all on the
Path-taking pure half of the check (this codebase's established
AppHandle-free-testing convention).

**Role-permission matrix domain review.** §6 walked cell-by-cell
against real screens, the four gates, `APPROVAL_AUTHORITY`, and backend
enforcement. One correction: `quality`'s stale, pre-gate `verify` on
`rawMaterials` — quietly a second decide authority for
`raw_material_verification`, contradicting §15.4's "production_manager
is the sole approval authority" — removed from `rolePolicy.ts`,
regenerated fixture, regression test on both languages. Everything else
(the three existing discrepancy-resolution additions, the
formulation-write and `delete` findings, the masterdata grouping)
confirmed correct as already documented. §6 is final for Phase 13.

**`cancel_advanced_formulation_optimize`, independently re-justified.**
`AdvancedOptimizerState` is one global run slot by design — no
per-user/session run identity exists to check against, and building one
would invent an ownership system the architecture doesn't have. Worst
case of cross-session cancellation is a wasted compute; nothing
regulated is touched. Decision: keep `TRUSTED_INTERNAL_ONLY` for
cancellation semantics, but require a valid authenticated session —
closing the "zero login at all" gap, the same bar every other Phase 13
command clears.

**Last-administrator protection.**
`identity::update_role_guarded`/`update_account_status_guarded` run
inside a SQLite `IMMEDIATE` transaction (same isolation as
`bootstrap_administrator`) that blocks demoting or disabling the last
*active* administrator, atomically — a concurrent second admin action
cannot race past a stale pre-check. `admin.rs` calls the guarded
versions and audits a denial without leaking anything beyond the
reason. 7 new tests. `UsersPanel.tsx`'s existing generic error display
already surfaces the guard's descriptive denial message — no new
frontend code needed for this specific gap.

Rust: 328/328 (was 327 after item 2, +1 for the role-matrix correction
test), clippy clean. Shared: 1302/1302 (matrixParity clean). Desktop:
1197/1197, tsc clean, eslint clean on every touched file, i18n parity
clean across all 8 shipped locales (real translations added, not
English-only fallbacks, for every new key this session introduced).

## Deliverables (this session)

- `apps/desktop/src-tauri/src/identity.rs` — `update_role_guarded`,
  `update_account_status_guarded` (new), 7 tests.
- `apps/desktop/src-tauri/src/admin.rs` — calls the guarded versions;
  denial auditing; 3 existing tests adapted, 7 new.
- `apps/desktop/src-tauri/src/formulation_advanced.rs` —
  `cancel_advanced_formulation_optimize` now requires a session token;
  first `#[cfg(test)]` block in this file, 1 test.
- `apps/desktop/src-tauri/src/masterdata.rs` — `collection_has_code`.
- `apps/desktop/src-tauri/src/workflow_gates.rs` — `SubjectKind`,
  `validate_subject_exists`/`validate_subject_shape`/
  `formulation_version_exists_at`, wired into all three commands. 9 new
  tests (24 total in this module).
- `apps/desktop/src-tauri/src/role_policy.rs` — 1 new regression test.
- `packages/shared/src/engine/rolePolicy.ts` — `quality`'s rawMaterials
  cell corrected; doc comment updated ("Correction #4").
- `packages/shared/src/engine/rolePolicyMatrix.generated.json` —
  regenerated (one-cell diff).
- `packages/shared/src/engine/rolePolicy.test.ts` — 1 new regression
  test.
- `apps/desktop/src/lib/tauri.ts` — `cancelAdvancedFormulationOptimize`
  now sends a session token.
- `apps/desktop/src/lib/workflowGates.ts` (new) — thin command bridge.
- `apps/desktop/src/components/workflow/WorkflowGatePanel.tsx` (new).
- `apps/desktop/src/components/formula/MaterialEditor.tsx`,
  `SupplierEditor.tsx`, `ApprovalPanel.tsx` — gate panels wired in.
- `apps/desktop/src/app/routes/MaterialsPage.tsx` — `isExisting` wiring
  for both editors.
- `apps/desktop/.eslintrc.cjs` — `gateType` added to the technical-prop
  exclude list.
- `apps/desktop/src/i18n/locales/*/session.json` (all 8 shipped
  locales) — new `workflowGate.*`, `materials.verification*`,
  `supplier.verificationGate`, `approval.workflowGates*`/`handoffGate`/
  `releaseGate` keys, translated in every locale (not English-only).
- `docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md` — §6 closing note;
  new §26; Risks items 1, 2, 11, 13, 14, 15, 16, 17 updated.
- `docs/PHASE13_SECURITY_TEST_MATRIX.md` — updated for this session's
  tests.
- This handoff.
- External log:
  `C:\Users\sekip\Desktop\FormuLab-Phase13-Identity-Security-Log.md`,
  closure session entry appended.

## What this session deliberately did NOT do

- Did not start Phase 13 Session 6.
- Did not implement Phase 14.
- No admin UI to inspect/list all workflow gates across subjects
  (§9.4.6 item 5, architecture doc) — not one of the five named
  residual warnings, left open.
- No new capability vocabulary, no per-user permissions, no custom
  roles, no permission-checkbox grid — the matrix correction removed an
  accidental grant, it did not restructure the model.
- Did not re-litigate `run_automatic_backup`'s deliberately-
  unauthenticated design (Risks item 13) — out of this session's scope
  (role-matrix review only, not backup authentication policy).
- Did not touch generated docs, formulas, real user data, release/
  signing work, or any other unrelated local changes already present in
  the working tree.

## Open decisions requiring a human answer before Session 6

1. Should a gate-listing admin UI (list every workflow gate across
   subjects, not just one at a time) be built, and if so when?
2. `run_automatic_backup`'s unauthenticated design (Risks item 13) —
   does any backup class ever need administrator-gating even when
   system-triggered?

## Exact next session

**Phase 13 Session 6**: brute-force/lockout wiring confirmation, full
audit-event coverage from every real command, the complete
SQL-injection + privilege-escalation regression suite against the
now-fully-wired-up command surface, and native Windows multi-user
acceptance testing.
