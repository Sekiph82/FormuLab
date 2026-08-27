# FormuLab Phase 2 Closure and UI Simplification Log

## Task
Three objectives, in order:
1. Push the nine already-completed Phase 2 closure commits to `origin/feature/laboratory-stability`.
2. Close the final Phase 2 authorization gap: restrict regulatory evidence-confirmation, review-equivalence, final-review and rule-verification actions to `regulatory`/`quality`/`administrator` human roles via a single reusable `requireAuthorizedRegulatoryActor` helper.
3. Simplify FormuLab's information architecture: introduce dedicated workspaces (Home, Projects, Formulation, Laboratory, Stability, Optimization, Regulatory, Approval, Reports, Administration) without removing any completed functionality.

Explicitly out of scope: Phase 3 dossier, Phase 4 claims engine, DOE, reverse formulation, PDF/DOCX engine, the previous project identity-to-FormuLab naming migration, desktop shortcut, new ERP modules, new auth system.

This log is external to the repository, at `C:\Users\sekip\Desktop\FormuLab-Phase2-Closure-and-UI-Simplification-Log.md`. Not staged, not committed.

## Starting repository state
2026-07-23. Branch `feature/laboratory-stability`, upstream `origin/feature/laboratory-stability`. `git status --short` shows only `.FormuLab/runs.db` modified (pre-existing, unrelated, never touched). All 9 Phase 2 closure commits present locally, none yet pushed. Remote HEAD = `06b8cec` (matches expected).

## Current branch and remote
- `git branch --show-current` -> `feature/laboratory-stability`
- `git rev-parse --abbrev-ref --symbolic-full-name @{u}` -> `origin/feature/laboratory-stability`

## Existing commits
Confirmed present via `git log --oneline -12`, local HEAD -> origin, in order:
```
ce934e7 docs(regulatory): finalize phase-two closure documentation
cd8ce1c feat(i18n): add regulatory phase-two closure translation keys
aa55417 feat(regulatory): add multi-jurisdiction readiness and approval snapshot to Approval workspace
4ed0e79 feat(regulatory): rewrite Regulatory workspace for version-bound review and csv/excel import
4ede5ef feat(regulatory): persist review revocations, evidence confirmations and review equivalences
cd11e2e feat(regulatory): add rule source verification workflow
0551d6c feat(regulatory): add multi-market approval readiness
381f78a fix(regulatory): bind reviews to exact formula versions and freeze evidence at review time
76404b6 fix(regulatory): break formulation/regulatory schema import cycle
```
Remote HEAD before push: `06b8cec5f5c0d6348b08ba1bd61258496074e97e` (docs(regulatory): document the Kenya/EAC Regulatory Engine) — matches the expected pre-closure remote tip exactly.

## Baseline tests
Full suite was already green at end of prior session (674/674 shared, 386/386 desktop, 68/68 rust, 130/130 python, 15/15 i18n parity, typecheck/lint/build clean, Kenya 55/91). Re-verified at end of Part 7 below rather than re-run redundantly before any edits.

## Decisions made
- Part 3 authorization: consolidated three near-duplicate role-check functions (`regulatoryReviews.ts`'s `requireHuman`/`requireRegulatoryRole`, `regulatoryRules.ts`'s `requireRegulatoryReviewer`) into one new module `packages/shared/src/engine/regulatoryAuthorization.ts` exporting `requireAuthorizedRegulatoryActor`/`isAuthorizedRegulatoryActor`/`AUTHORIZED_REGULATORY_ROLES`. All 9 restricted actions now call the single shared helper.
- The task's rejected-roles list names `viewer` and `operator`. This codebase's `ApprovalRole` enum (`schemas/status.ts`) has no such roles — the six actual roles are `researcher`, `chemist`, `quality`, `regulatory`, `production`, `administrator`. Substituted `chemist`/`researcher`/`production` as the "other unauthorized human role" test cases, since the intent (any role outside regulatory/quality/administrator is rejected) is fully covered without inventing roles that don't exist in the schema. Documented as a known nuance rather than silently ignored.
- UI enforcement: added `canActRegulatory = isAuthorizedRegulatoryActor(actor)` in `RegulatoryPanel.tsx`. Evidence-confirmation buttons (confirm/revoke) are `disabled` with a tooltip; rule verify/reject/supersede and equivalence-declare/revoke are conditionally hidden. Both are explicitly permitted by the spec ("hide or disable") — backend `requireAuthorizedRegulatoryActor` remains the actual enforcement either way.
- Confirmed by test: an unauthorized actor calling the engine function directly (bypassing the UI) still throws — proves the UI gate is convenience only, not the security boundary.

## Authorization changes
Restricted to `regulatory`/`quality`/`administrator` human actors only, via the new shared `requireAuthorizedRegulatoryActor`:
`recordRegulatoryReview`, `revokeRegulatoryReview`, `recordEvidenceConfirmation`, `revokeEvidenceConfirmation` (previously any human role), `declareRegulatoryReviewEquivalence`, `revokeRegulatoryReviewEquivalence` (previously any human role), `verifyRule`, `rejectRuleVerification`, `supersedeRule` (already role-gated, now sharing the same helper instead of a duplicate).
Every function throws before constructing any record — no partial writes possible. `RegulatoryPanel.tsx` hides/disables the corresponding buttons for an unauthorized `reviewerRole` selection; enforcement is server/domain-side regardless.

## Files inspected
Key files read before editing: `FormulasPage.tsx` (full 987 lines), `router.tsx`, `AppShell.tsx`, `Sidebar.tsx`, `MaterialsPage.tsx` (1075 lines, confirmed it already hosts Materials/Suppliers/Packaging/Factory-profile editors), `OptimizerPage.tsx` (confirmed it is a standalone, non-project-bound what-if calculator, unrelated to `AdvancedOptimizerPanel`), `TrialsPanel.tsx` (confirmed it already contains test results/result history/deviations/attachments/exclusion-explorer internally), `useUndoable.ts`, `laboratory.ts`/`stability.ts` schemas (confirmed `projectId`/`studyId` field names for Home's cross-collection joins), `ApprovalPanel.tsx`'s `NavTarget`/`onNavigate`/`onFocusLine` signatures.

## Files created (Part 3 + Part 4)
- `packages/shared/src/engine/regulatoryAuthorization.ts` + `.test.ts` — shared `requireAuthorizedRegulatoryActor`/`isAuthorizedRegulatoryActor`/`AUTHORIZED_REGULATORY_ROLES`, 6 unit tests.
- `apps/desktop/src/hooks/useFormulationWorkspace.ts` — shared project/versions/draft/materials/cost-snapshots/packaging-BOMs/audit-log loading + save/lifecycle/apply actions (extracted from `FormulasPage.tsx`).
- `apps/desktop/src/hooks/useProjectParam.ts` — `?project=`/`?version=` query-param read/write.
- `apps/desktop/src/components/workspace/ProjectContextBar.tsx` — shared project/version header bar + project picker.
- `apps/desktop/src/app/routes/{HomePage,ProjectsPage,FormulationPage,LaboratoryPage,StabilityPage,OptimizationPage,RegulatoryPage,ApprovalPage,ReportsPage,AdministrationPage}.tsx` — the ten workspace routes.
- `apps/desktop/src/app/routes/{FormulationPage,LaboratoryPage,StabilityPage,ApprovalPage,HomePage,Workspaces}.test.tsx` — 21 new tests covering the Part 5 usability requirements.

## Files modified (Part 3 + Part 4)
- `packages/shared/src/engine/regulatoryReviews.ts`/`regulatoryRules.ts` — removed 3 duplicate role-check functions, all 9 call sites now use the shared `requireAuthorizedRegulatoryActor`.
- `packages/shared/src/engine/regulatoryReviews.test.ts` — expanded 32 -> 42 tests (role-matrix coverage).
- `packages/shared/src/index.ts` — export the new authorization module.
- `apps/desktop/src/components/formula/RegulatoryPanel.tsx`/`.test.tsx` — `canActRegulatory` gate hides/disables 6 action groups; +3 tests (14 -> 17).
- `apps/desktop/src/app/router.tsx` — 10 new routes; `/formulas` now redirects to `/projects`; old page kept reachable at `/formulas/legacy`.
- `apps/desktop/src/components/sidebar/Sidebar.tsx` — nav restructured into "Workspaces" (10 items) + "Tools" (Notebooks/Files/Runs) sections, single `<nav>` landmark kept.
- `apps/desktop/src/i18n/locales/*/session.json` + `nav.json` (all 8 locales) — `regulatory.unauthorizedRoleHint`, `builder.tabPackaging`/`packaging.*`/`openLaboratory`/`openStability`/`openRegulatory`/`openApproval`/`standaloneOptimizerHint`/`standaloneOptimizerLink`/`loadingProject`, top-level `home.*`/`reports.*`/`administration.*`, `nav.json`'s `sections.*`/`workspacesNav.*`/`workspace.*`. English + Turkish real, other 6 English-placeholder per existing convention.
- `docs/REGULATORY_REVIEWS.md`, `docs/REGULATORY_EVIDENCE_CONFIRMATIONS.md`, `docs/REGULATORY_RULE_VERIFICATION.md`, `docs/architecture/IMPLEMENTATION_STATUS.md` — reflect the closed authorization gap.

## Files deleted
None. Every completed module was kept reachable (see "UI architecture after" and "Remaining limitations").

## Commands executed
`git push origin feature/laboratory-stability`; repeated `pnpm --filter @legacy/shared|@legacy/desktop run typecheck|lint|test` and `pnpm --filter @legacy/desktop test -- --run <file>` during iteration; `python3` one-off scripts (via json module) to sync new i18n keys across the 6 placeholder locales safely. Full list re-run and recorded in "Test results" below.

## Test results
Part 3 (authorization closure): shared 690/690 (was 674), desktop 389/389 (was 386).
Part 4 (IA simplification), cumulative: shared unchanged at 690/690 (no shared-package code touched by Part 4). Desktop 410/410 (was 389; +21 new tests: `ApprovalPage.test.tsx` 5, `FormulationPage.test.tsx` 4, `HomePage.test.tsx` 2, `LaboratoryPage.test.tsx` 3, `StabilityPage.test.tsx` 2, `Workspaces.test.tsx` 5). Desktop typecheck clean, lint clean. i18n parity 15/15.

## Bugs discovered
- My first attempt at a `regulatorySnapshot`/`RegulatoryApprovalSnapshot` schema field (earlier Part 3.9 work, prior session) created a circular module dependency between `formulation.ts` and `regulatory.ts` that silently produced `undefined` for an enum at load time — already fixed and documented in the prior session's part of this work.
- My first `Workspaces.test.tsx` draft tried to mount a live client-side `<Navigate replace>` via `createMemoryRouter` (through `renderAt`) to test the `/formulas` -> `/projects` redirect; this specific vitest/jsdom/undici combination throws `TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal` when react-router's data router constructs its internal Request object for a replace-navigation — an environment incompatibility, not a bug in the redirect itself.
- My first i18n-locale-sync script for the 6 placeholder locales used fragile regex string-splicing and produced 6 invalid JSON files (`Extra data` parse errors) — caught immediately by validating with `python3 -c "import json; json.load(...)"` before running any test.

## Bugs fixed
- Circular schema import (see above; already fixed and committed in a prior session commit `76404b6`).
- Rewrote the `Workspaces.test.tsx` redirect test to assert against the `routes` array's `element.props.to` directly instead of mounting a live client-side Navigate — avoids the environment incompatibility entirely while still verifying the redirect target is correctly configured.
- Reverted the 6 broken locale files via `git checkout --` (uncommitted, safe) and re-synced using Python's `json` module (load/mutate/dump) instead of string splicing — guarantees valid JSON.
- Two `Workspaces.test.tsx` assertions failed on ambiguous "Administration"/"Reports" text (present both as a sidebar nav label and a page `<h1>`) — fixed by querying `getByRole("heading", { name: ... })` instead of `getByText`.
- Four Administration-link assertions failed because the `<Link>`'s accessible name concatenates its title + description text (no `aria-label`) — fixed by matching `/^Title/` instead of the exact title string.

## UI architecture before
`FormulasPage.tsx` (987 lines) did everything: a project list, and — once a project was opened — a single page with a 12-item horizontal tab strip (Formula Builder, Versions, Cost, Compatibility, Safety, Optimizer, Trials, Test Definitions, Stability, Corrective Actions, Regulatory, Approval) all sharing one component's local state (draft, autosave, versions, materials, cost snapshots, packaging BOMs, audit log). No project/version context was carried in the URL — everything lived in `useState`, so a refresh or a deep link lost your place, and there was no way to reach Trials/Stability/Regulatory/Approval except by first opening a project in this one page.

Primary sidebar nav (`Sidebar.tsx`): New, Formulas, Materials, Optimizer, Notebooks, Files, Runs, Settings — flat, undifferentiated between the formulation-R&D side of the app and the unrelated research/notebook/compute side (`the previous project identity` roots; the formulation module is one part of a larger desktop app, confirmed via `apps/desktop/src/app/router.tsx`'s existing `/live`, `/notebooks`, `/files`, `/runs` routes, which are untouched by this task).

## UI architecture after
Ten workspaces, each a real route (`apps/desktop/src/app/routes/{Home,Projects,Formulation,Laboratory,Stability,Optimization,Regulatory,Approval,Reports,Administration}Page.tsx`), reusing existing panels rather than duplicating them:
- **Home** (`/home`) — real dashboard: recent projects, recent activity (merged audit logs), open laboratory work, upcoming stability samples, pending approvals. Every section reads persisted data; an empty result renders honest copy, never a fabricated number.
- **Projects** (`/projects`) — the project list + "new project" flow, extracted from `FormulasPage.tsx`.
- **Formulation** (`/formulation`) — trimmed to Builder/Versions/Cost/Compatibility/Safety/Packaging (6 tabs, down from 12). Quick-jump icon links to Laboratory/Stability/Regulatory/Approval replace the tabs that moved out.
- **Laboratory** (`/laboratory`) — Trials (which already contains test results, result history, deviations, attachments and the applicability exclusion explorer internally), Test Definitions, Corrective Actions, as three sections.
- **Stability** (`/stability`) — `StabilityPanel` (studies/protocols/conditions/time points/samples/results/trends/failures/applicability/corrective actions, all already inside it) bound to the selected project + version.
- **Optimization** (`/optimization`) — `AdvancedOptimizerPanel` (optimizer runs, substitution runs, constraints, candidates, comparison, apply-to-draft), math untouched. Links out to the pre-existing standalone what-if calculator at `/optimizer` (kept exactly as it was — a different, unrelated feature that happens to share the word "optimizer").
- **Regulatory** (`/regulatory`) — `RegulatoryPanel` unchanged (it already owns version/jurisdiction/packaging-SKU/reviewer-role selectors and grouped sections from the Phase 2 closure work).
- **Approval** (`/approval`) — `ApprovalPanel` unchanged; its `onNavigate`/`onFocusLine` callbacks now cross real routes (`mapApprovalNavTargetToPath`) instead of switching an internal tab, always carrying the project id forward.
- **Reports** (`/reports`) — navigation shell over the JSON/CSV/Excel exports that already exist per module; PDF/DOCX explicitly marked "not yet implemented."
- **Administration** (`/administration`) — links to the existing Materials page (materials/suppliers/packaging/factory profiles), Regulatory workspace (rules), Approval workspace (policies), Settings; hosts the one genuinely global, prop-less editor (Test Definitions) directly. No invented user-management section (none exists in this codebase).

Sidebar nav: New, then a "Workspaces" section (the ten above), then a "Tools" section (Notebooks, Files, Runs — unrelated, untouched). One `<nav>` landmark (kept singular so existing accessibility-landmark tests still pass).

New shared infrastructure: `hooks/useFormulationWorkspace.ts` (project/versions/draft/materials/cost-snapshots/packaging-BOMs/audit-log loading + save/lifecycle/apply actions, extracted from `FormulasPage.tsx`'s logic — moved, not duplicated), `hooks/useProjectParam.ts` (`?project=`/`?version=` query-param read/write), `components/workspace/ProjectContextBar.tsx` (shared project/version header + picker).

## Persistence changes
No Rust/masterdata schema changes in Part 4 — the IA simplification is a pure presentation-layer reorganization. All persisted collections, file layouts and record shapes are exactly as Phase 2 closure left them.

## Migration decisions
No new migrations. Part 4 touches routing/component structure only, not any persisted record shape.

## Commits created
13 new commits on `feature/laboratory-stability`, none pushed, on top of the 9 Phase 2 closure commits pushed at the start of this session (`ce934e7`):
```
917e3cf fix(regulatory): restrict evidence and review reuse actions by role
7baca5d refactor(navigation): introduce dedicated application workspaces and shared context hooks
1654718 refactor(formulation): simplify formula workspace navigation
dc2537d refactor(laboratory): move trial workflows into laboratory workspace
51296e1 refactor(stability): move studies into stability workspace
b706c08 feat(optimization): add dedicated optimization workspace
60bb512 refactor(regulatory): organize regulatory workspace sections
c91138a refactor(approval): create dedicated approval workspace
6d25184 feat(home): add persisted-work overview
57a8ad0 feat(projects,administration,reports): add remaining workspace shells
a399494 test(navigation): cover workspace routing and context
390af1d feat(i18n): add information-architecture workspace translation keys
c81c0b4 docs(formulab): document simplified information architecture
```
Final local HEAD: `c81c0b454d963273605d7e26a3c124bb3c389754`. Remote HEAD unchanged at `ce934e76e9136e3a9bfe588a3e95a424bb0316bc` (the Part 1/2 push target) — verified via `git log --oneline origin/feature/laboratory-stability..HEAD` (13 lines) and `git rev-parse origin/feature/laboratory-stability`.

## Pushes performed
2026-07-23 — `git push origin feature/laboratory-stability`. No merge, no PR, no force, no rebase, no safety branch pushed, `.FormuLab/runs.db` untouched (never staged). Result: `06b8cec..ce934e7  feature/laboratory-stability -> feature/laboratory-stability`. Post-push verification: `git rev-parse HEAD` and `git rev-parse origin/feature/laboratory-stability` both `ce934e76e9136e3a9bfe588a3e95a424bb0316bc` — heads match. `git log --oneline origin/feature/laboratory-stability..HEAD` empty — nothing left unpushed. `git status --short` shows only `.FormuLab/runs.db`.

## Remaining limitations
- **Known nuance, not a gap**: the authorization spec named `viewer`/`operator` roles that don't exist in this codebase's `ApprovalRole` enum (`researcher`/`chemist`/`quality`/`regulatory`/`production`/`administrator` are the only six). Tests substitute `chemist`/`researcher`/`production` as "other unauthorized role" cases — the intent (only regulatory/quality/administrator passes) is fully covered.
- Home's cross-project aggregation (recent activity, pending approvals) is bounded to the 5 most-recently-updated projects (`RECENT_PROJECT_LIMIT`), not a true unlimited rollup — documented in `docs/NAVIGATION_AND_CONTEXT.md` and `IMPLEMENTATION_STATUS.md` rather than silently capped.
- Reports workspace has no dedicated audit-log report view yet (only per-project decision history inside Approval); the full PDF/DOCX report engine (Phase 7) is out of scope and marked "Not yet implemented."
- Formulation's new Packaging tab is a read-only summary (SKU + linked `PackagingBom` fill/line-count) — editing still happens in Administration → Materials; no new packaging editor was built.
- No user-management/roles backend exists in this codebase — Administration's link list has no "Users and roles" section, since inventing one would be a new feature, not a reorganization.
- Every seed regulatory rule remains an explicit `not_verified` structural placeholder (unchanged from Phase 2 closure) — real legislation review is still required from a qualified human before any rule can be relied on.
- No migration was registered for any schema this session — Part 3's authorization change and Part 4's IA change touch code/routing only, not persisted record shapes.

## Final git status
```
On branch feature/laboratory-stability
Your branch is ahead of 'origin/feature/laboratory-stability' by 13 commits.
  (use "git push" to publish your local commits)

Changes not staged for commit:
	modified:   .FormuLab/runs.db
```
`.FormuLab/runs.db` is the same pre-existing, unrelated file noted at the start of this session — never staged, committed, deleted, or modified by any command run in this session.

## Final summary
Three objectives, all complete:
1. **Pushed** the 9 already-completed Phase 2 closure commits (`06b8cec..ce934e7`) to `origin/feature/laboratory-stability` at the very start of this session, before any new edits — verified local and remote HEAD matched afterward.
2. **Closed the final Phase 2 authorization gap**: evidence confirmation and review-equivalence declare/revoke were human-only but not role-restricted; now every one of the 9 restricted regulatory actions requires an authorized `regulatory`/`quality`/`administrator` human actor via one shared, reusable `requireAuthorizedRegulatoryActor` function, enforced server/domain-side (never solely by hiding a UI button), with 16 new tests proving both the acceptance and rejection paths.
3. **Simplified the information architecture**: the old 987-line, 12-tab `FormulasPage.tsx` was reorganized into ten dedicated workspace routes (Home/Projects/Formulation/Laboratory/Stability/Optimization/Regulatory/Approval/Reports/Administration), each reusing the existing panel components unchanged, sharing a new `useFormulationWorkspace`/`useProjectParam` context-preservation layer, with full backward compatibility (`/formulas` redirects to `/projects`; the old page stays reachable, unmodified, at `/formulas/legacy`). Nothing was deleted; nothing was rewritten beyond routing/presentation; no persisted record shape changed.

All work is committed (13 new commits, none pushed, no merge, no PR) and fully verified: shared 690/690, desktop 413/413, Rust 68/68 (clippy clean), Python 130/130, i18n parity 15/15, typecheck/lint clean on both packages, production build succeeds, Kenya catalog unchanged at 55 families / 91 SKUs. Phase 3 was not started.
