# Information architecture — ten workspaces

Why the old Formula Builder became overcrowded, the ten-workspace model
that replaced it, what moved where, what stayed exactly as it was, and
the backward-compatibility approach. See [WORKSPACES.md](WORKSPACES.md)
for a per-workspace reference and
[NAVIGATION_AND_CONTEXT.md](NAVIGATION_AND_CONTEXT.md) for the
context-preservation mechanism.

## The problem: one page carrying twelve modules

`apps/desktop/src/app/routes/FormulasPage.tsx` was, until this task, the
entire formulation R&D side of the app: a project list, and — once a
project was opened — a single page with a twelve-item horizontal tab
strip: Builder, Versions, Cost, Compatibility, Safety, Optimizer, Trials,
Test Definitions, Stability, Corrective Actions, Regulatory, Approval.
Every one of those shared one component's local `useState` — draft,
autosave, versions, materials, cost snapshots, packaging BOMs, audit log
— all loaded and mutated in one 987-line file.

Two concrete problems followed from that:

- **No project or version context in the URL.** Everything lived in
  React state inside one component instance. A refresh, a deep link, or a
  link from another part of the app (e.g. "this Approval blocker names a
  missing stability requirement") had nowhere to land except the project
  list — there was no way to open Trials, Stability, Regulatory or
  Approval directly, or to say which saved version they should be looking
  at.
- **A tab strip that doesn't scale.** Twelve tabs is already past the
  point where a horizontal strip reads as organized navigation rather
  than an overflow problem. Regulatory and Approval in particular had
  grown substantial internal structure of their own (version/
  jurisdiction/packaging-SKU/reviewer-role selectors, grouped sections,
  rule verification, review equivalence) that a single tab label
  couldn't represent.

## The model: ten workspaces, each a real route

Every workspace is its own file under `apps/desktop/src/app/routes/`,
reached via its own URL, and reuses the existing panel components rather
than duplicating their logic:

| Workspace | Route | What moved into it |
|---|---|---|
| Home | `/home` | New — a real dashboard (see below) |
| Projects | `/projects` | The project list + new-project flow, extracted from `FormulasPage.tsx` |
| Formulation | `/formulation` | Builder, Versions, Cost, Compatibility, Safety tabs (kept), plus a new read-only Packaging summary tab |
| Laboratory | `/laboratory` | Trials, Test Definitions, Corrective Actions tabs |
| Stability | `/stability` | The Stability tab |
| Optimization | `/optimization` | The Optimizer tab (project-bound `AdvancedOptimizerPanel`) |
| Regulatory | `/regulatory` | The Regulatory tab |
| Approval | `/approval` | The Approval tab |
| Reports | `/reports` | New — a navigation shell over existing exports |
| Administration | `/administration` | New — links to Materials, Regulatory rules, Approval policies, Settings; hosts Test Definitions directly |

**Reasoning for the split**: Formulation keeps exactly the tabs that
operate on the *current working draft* moment-to-moment (editing lines,
seeing cost/compatibility/safety react to an edit). Laboratory and
Stability are *evidence-gathering* activities that happen against a
*saved* version over days or weeks, not the live draft — they don't need
to share the draft's autosave/undo state, only read a version's frozen
lines. Regulatory and Approval already had grown their own internal
navigation (Phase 2 closure work added version/jurisdiction/packaging-SKU/
reviewer-role selectors and grouped sections directly inside
`RegulatoryPanel.tsx`/`ApprovalPanel.tsx`) — they needed a first-class
place, not a fifth-level tab. Optimization is compute-heavy and
exploratory (solve a scenario, compare runs) — separating it from the
draft-editing surface means leaving it open doesn't block editing
elsewhere. Reports and Administration didn't exist as concepts before;
they're where "configuration" and "read the record" naturally belong once
the daily-work tabs no longer have to also serve those two very different
audiences (a chemist bench-testing vs. someone administering the rule
library).

## What reused existing components unchanged

`RegulatoryPanel.tsx`, `ApprovalPanel.tsx`, `TrialsPanel.tsx`,
`StabilityPanel.tsx`, `TestDefinitionsPanel.tsx`,
`CorrectiveActionsPanel.tsx`, `AdvancedOptimizerPanel.tsx`,
`CompatibilityPanel.tsx`, `SafetyPanel.tsx`, `CostPanel.tsx`,
`FormulaBuilder.tsx` — **none of these were rewritten**. Each new page is
a thin wrapper that resolves which project/version is in scope (via the
new `useFormulationWorkspace` hook and `useProjectParam` hook — see
[NAVIGATION_AND_CONTEXT.md](NAVIGATION_AND_CONTEXT.md)) and passes it the
same props `FormulasPage.tsx` used to. `RegulatoryPanel.tsx` in
particular already owned its own version/jurisdiction/packaging-SKU/
reviewer-role selectors from the Phase 2 regulatory closure work earlier
in this session — `RegulatoryPage.tsx` doesn't re-implement any of that,
it just gives the panel a route.

The one behavioral change: `ApprovalPanel.tsx`'s `onNavigate`/
`onFocusLine` callbacks, which used to switch an internal tab inside
`FormulasPage.tsx`, now navigate to a real route via
`mapApprovalNavTargetToPath` (`ApprovalPage.tsx`) — carrying the project
id forward so the target workspace opens already scoped to the right
project.

## Backward compatibility

`/formulas` now redirects (`<Navigate to="/projects" replace />`) to
`/projects`, the new home for the project list. The old page itself,
`FormulasPage.tsx`, is **unmodified and still fully functional** — it
stays reachable at `/formulas/legacy` so no existing deep link,
bookmark, or persisted reference to the old page breaks; nothing was
deleted. `/materials`, `/optimizer` (the standalone what-if calculator,
unrelated to the new project-bound Optimization workspace), `/notebooks`,
`/files`, `/runs`, `/settings`, and `/live` are all untouched — they
belong to a different, unrelated part of this dual-purpose desktop app
(an AI-thread-driven research/notebook/compute tool) that this task does
not touch.

No persisted record shape, master-data collection, or Rust command
changed. This is a presentation-layer reorganization only.

## Explicitly out of scope

This task is an information-architecture simplification, not a new
feature phase. None of the following were implemented, and nothing in
the new workspaces should be read as implying they were:

- The full Phase 3 regulatory dossier/evidence-matrix system
- The Phase 4 claims engine
- Design of Experiments (DOE)
- Reverse formulation
- The Phase 7 PDF/DOCX report-generation engine (Reports is a navigation
  shell over the JSON/CSV/Excel exports that already exist — see
  [WORKSPACES.md](WORKSPACES.md#reports))
- The `ai4s` → `FormuLab` package/identifier naming migration
- Desktop shortcut installation
- Any new ERP module
- A new authentication/user-management system (Administration links to
  existing screens; it does not add user or role management, because
  none exists in this codebase to build on — see
  [WORKSPACES.md](WORKSPACES.md#administration))

No features were added to fill an otherwise-empty workspace beyond what
is explicitly noted above (Home's dashboard, Reports' shell,
Administration's links, Formulation's read-only Packaging summary) —
everything else is the same panel, doing the same thing, reached from a
clearer place.
