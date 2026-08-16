# FormuLab — Release Manual Acceptance Checklist

Items in this file cannot be verified by an automated agent (no native
Windows GUI driving/inspection tool is available to Claude Code sessions
working in this repository) and must be executed by a human, on a real
Windows machine, with disposable test data, before a build is shipped.
Nothing below is a Phase-numbered development blocker — every phase that
disclosed an item here already closed its own automatable scope in full;
this file exists so a real gap is never silently dropped just because no
phase's session happened to be the one positioned to execute it.

## 1. Native Windows multi-user acceptance testing (Phase 13)

**Origin**: Phase 13 (Enterprise Identity, Authentication, Fixed RBAC &
Application Security), disclosed at Session 6's close and carried forward
by explicit human decision as a release-preparation item rather than a
Phase 13 blocker. Every flow below has its *backend logic* already proven
by the real production Rust code paths Phase 13's test suite exercises
(335 Rust tests as of Session 6, `docs/PHASE13_SECURITY_TEST_MATRIX.md`) —
this checklist item is specifically the interactive, visual, native-GUI
half that no available tool can execute automatically.

**Prerequisite**: a Windows machine with the current FormuLab build
installed or launchable (see the desktop shortcut target — `FormuLab.lnk`
on the Desktop — for the currently-built executable), and disposable test
identity/domain data only. Never use real user or business data for this
checklist.

**Steps** (create disposable local accounts for a representative subset of
the 12 fixed roles — at minimum Administrator, one worker role, one
manager role, Production Manager):

- [ ] Bootstrap: fresh install shows the Administrator Setup screen, not
  Login.
- [ ] Login/logout/account switching works for each created account.
- [ ] Role-specific UI: each account sees only the actions/screens its
  role grants (`rolePolicy.ts`'s matrix); a denied action is either
  hidden or clearly explained as unavailable, never silently broken.
- [ ] `Administration → Users`: an administrator can list/create/edit
  users, reset a password, and view security history; a non-administrator
  account cannot reach this screen at all.
- [ ] Role change takes visible, immediate effect: change a logged-in
  test account's role from another (administrator) session and confirm
  the affected account's available actions change on its very next
  action — no stale UI, no requiring a fresh login.
- [ ] Disable takes visible, immediate effect: disable a logged-in test
  account and confirm its session is rejected on the very next action.
- [ ] Last-administrator protection: with only one active administrator,
  confirm the UI explains why demoting/disabling that account is refused
  (not just that the backend call fails silently).
- [ ] Workflow gates: a worker role can submit `raw_material_
  verification`/`supplier_document_verification`/`production_engineering_
  handoff`/`production_release` from the screen each belongs to
  (`MaterialEditor`/`SupplierEditor`/`ApprovalPanel`); Production Manager
  can approve/reject; a rejected gate shows as resubmittable and the
  worker can resubmit successfully.
- [ ] Production prerequisite blocking: attempting `production_
  engineering_handoff` before the formulation version is
  `production_approved`, or `production_release` before the handoff gate
  is approved, shows a clear blocking reason rather than a raw error or a
  silently-disabled button with no explanation.
- [ ] System Administration screens (backup, restore, data location,
  schema migration) are reachable only by an administrator account.

**Status**: not yet executed by any session (automated or manual) as of
this checklist's creation. Carried here from Phase 13; execute before
shipping a release build, or explicitly re-confirm it stays acceptable to
defer if shipping without it.

## 2. (Add future release-blocking manual items here as they're disclosed)

Follow the same pattern: name the origin phase/session, the prerequisite,
concrete checkable steps, and current status — never a vague "test
manually" line with nothing to actually check off.
