# Workspaces reference

One section per workspace: responsibility, route, what it reuses, its
query-param context, and what it explicitly does not do. See
[INFORMATION_ARCHITECTURE.md](INFORMATION_ARCHITECTURE.md) for why this
model replaced the old single-page Formula Builder, and
[NAVIGATION_AND_CONTEXT.md](NAVIGATION_AND_CONTEXT.md) for the
`?project=`/`?version=`/`?tab=`/`?section=`/`?focusLine=` mechanisms
referenced below.

## Home

`/home` — `apps/desktop/src/app/routes/HomePage.tsx` (new page; no
existing panel to reuse — this workspace didn't exist as a concept
before).

A real dashboard, not a mockup: recent projects (`listFormulations()`,
top 5 by `updatedAt`), recent activity (merged, sorted audit-log entries
from those top 5 projects), open laboratory work (every
`laboratory_trials` record not yet in a terminal status, joined to its
project's name), upcoming stability samples (`stability_samples` with
status `planned`/`due`/`overdue` and a `dueDate`, joined through
`stability_studies` to the project name, sorted soonest-first), and
pending approvals (formula versions across the 5 most recent projects
whose `effectiveStatus` is `chemist_review`/`lab_candidate`/
`stability_testing`/`pilot_candidate`).

**Does not**: aggregate across an unbounded number of projects — pending
approvals and recent activity are only computed for the 5 most
recently-updated projects (bounded to keep the per-project
`readAuditLog`+`readFormulation` calls cheap); this is a real bound, not
a silent cap presented as complete. Does not fabricate a metric — every
section has its own honest empty-state string when there is nothing to
show.

## Projects

`/projects` — `apps/desktop/src/app/routes/ProjectsPage.tsx`. Reuses
`NewProjectDialog`. Extracted from `FormulasPage.tsx`'s project-list
view.

Every formulation project, independent of which downstream workspace
it's being worked in. Opening a project navigates to
`/formulation?project=<id>`.

**Does not**: show anything about a project's laboratory/stability/
regulatory/approval state — that's Home's job, or the project's own
workspaces.

## Formulation

`/formulation` — `apps/desktop/src/app/routes/FormulationPage.tsx`.
Reuses `FormulaBuilder.tsx`, `VersionCompare.tsx`, `CostPanel.tsx`,
`CompatibilityPanel.tsx`, `SafetyPanel.tsx`, `SubstitutionDialog`
(`SubstitutionPanel.tsx`), `ExportMenu.tsx`, `SaveVersionDialog.tsx` — all
unchanged.

Six tabs: **Builder** (the editable formula grid), **Versions** (history,
compare, restore, lifecycle, variants, export), **Cost**,
**Compatibility**, **Safety**, and **Packaging** (new — a read-only
summary of the project's target SKUs against the existing `PackagingBom`
collection: fill quantity/unit and component-line count where a BOM
exists, a "no BOM recorded" notice where it doesn't, linking to
Administration to actually edit one). Reads `?tab=` to open a specific
tab (the mechanism an Approval-blocker link uses) and `?focusLine=` to
scroll/select a specific formula line. Header icon-links jump to
Laboratory/Stability/Regulatory/Approval for the same project.

**Does not**: host Trials, Test Definitions, Stability, Corrective
Actions, Regulatory or Approval as tabs anymore — those are their own
workspaces. Packaging is a summary, not an editor — the actual
`PackagingBomEditor`/`PackagingComponentEditor` still live in
Administration → Materials.

## Laboratory

`/laboratory` — `apps/desktop/src/app/routes/LaboratoryPage.tsx`. Reuses
`TrialsPanel.tsx` (unchanged — it already contains test results, result
history, deviations, attachments and the applicability exclusion
explorer internally), `TestDefinitionsPanel.tsx` (unchanged, global,
takes no props), `CorrectiveActionsPanel.tsx` (unchanged).

Three sections — **Trials**, **Test Definitions**, **Corrective
Actions** — selected via an in-page tab strip and the `?section=` query
param (the mechanism an Approval-blocker link uses to land on the right
one). A `ProjectContextBar` at the top shows the current project and a
version selector; Trials/Corrective Actions read the selected version's
frozen lines (falling back to the current working draft's lines when no
saved version is selected).

**Does not**: implement new filtering. `TrialsPanel.tsx`'s own controls
(status, product family, etc.) are unchanged; this workspace only adds
project/version scoping on top via the shared context bar, not a new
filter engine.

## Stability

`/stability` — `apps/desktop/src/app/routes/StabilityPage.tsx`. Reuses
`StabilityPanel.tsx` unchanged — it already contains studies, protocols,
conditions, time points, samples, results, trends, failures,
applicability and corrective actions internally.

A `ProjectContextBar` (project + version selector) above the panel,
which is bound to the selected project's chosen version (or the current
working draft) via the same `useFormulationWorkspace` hook every
project-bound workspace uses.

**Does not**: add any new stability functionality — this is purely
`StabilityPanel.tsx` given its own place instead of a Formula Builder
tab.

## Optimization

`/optimization` — `apps/desktop/src/app/routes/OptimizationPage.tsx`.
Reuses `AdvancedOptimizerPanel.tsx` unchanged — optimizer runs,
substitution runs, constraints, objectives, candidate formulas,
comparison and apply-to-draft, exactly as before.

Bound to the project's current working draft (not a specific saved
version — matching how the old Optimizer tab always worked against the
draft). Applying a result navigates back to `/formulation?project=<id>`
so the applied draft is visible where it can be saved as a new version.
Links to the pre-existing standalone what-if calculator at `/optimizer`
(`OptimizerPage.tsx`) — a genuinely different, non-project-bound feature
that happens to share the word "optimizer"; that page is untouched.

**Does not**: change any optimization mathematics — this task only
reorganized access and presentation, per its own explicit scope.

## Regulatory

`/regulatory` — `apps/desktop/src/app/routes/RegulatoryPage.tsx`. Reuses
`RegulatoryPanel.tsx` unchanged.

`RegulatoryPanel.tsx` already owns its own version/jurisdiction/
packaging-SKU/reviewer-role selectors and grouped sections (market
summary, classification, findings, evidence confirmations, rules, rule
verification, import/export, review equivalence, review history) from
the Phase 2 regulatory closure work — this page just gives it a
first-class route instead of a Formula Builder tab, with a one-line
"change project" header above it.

**Does not**: change anything about how regulatory reviews, evidence
confirmations, rule verification, or review equivalence work — see
[REGULATORY_ENGINE.md](REGULATORY_ENGINE.md) and its companion documents
for that.

## Approval

`/approval` — `apps/desktop/src/app/routes/ApprovalPage.tsx`. Reuses
`ApprovalPanel.tsx` unchanged.

Readiness overview, blockers, warnings, approval policies, policy
revisions, formula-version equivalence, regulatory review reuse,
decision history and approval snapshots — all `ApprovalPanel.tsx`'s
existing behavior. The one real change: `onNavigate`/`onFocusLine`
(triggered by clicking a blocker) now navigate to a real route via the
exported pure function `mapApprovalNavTargetToPath(target, projectId)`
instead of switching an internal tab — see
[NAVIGATION_AND_CONTEXT.md](NAVIGATION_AND_CONTEXT.md) for the full
target→route mapping table.

**Does not**: change approval readiness logic, policy precedence, or
snapshot behavior — see [APPROVAL_WORKFLOW.md](APPROVAL_WORKFLOW.md).

## Reports

`/reports` — `apps/desktop/src/app/routes/ReportsPage.tsx`. New page; no
panel to reuse.

A navigation shell: six rows (Formula, Trial, Stability, Regulatory,
Approval, Audit reports). Five link to the workspace that already
provides a real export (formula-version JSON from Formulation's Versions
tab, trial JSON from Laboratory, study/trend export from Stability,
rule JSON/CSV/Excel from Regulatory, decision history/snapshots from
Approval). The sixth, Audit reports, has no dedicated view yet and is
labeled "Not yet implemented."

**Does not**: generate PDF or DOCX reports. That is the explicitly
out-of-scope Phase 7 report engine — this page states that plainly
rather than implying it exists.

## Administration

`/administration` — `apps/desktop/src/app/routes/AdministrationPage.tsx`.
Links to the pre-existing `/materials` page (`MaterialsPage.tsx` —
already self-contained, with its own internal tabs for materials,
suppliers, packaging components/BOMs, and factory cost profiles),
`/regulatory` (rule library/verification/import-export),
`/approval` (policy editor), and `/settings`. Hosts
`TestDefinitionsPanel.tsx` directly as its own section — the one
genuinely global, prop-less editor, so it's the only panel actually
embedded here rather than linked to.

**Does not**: implement user or role management. This codebase has no
user-management backend — Administration says so explicitly rather than
inventing a "Users and roles" section with nothing behind it. Does not
re-implement the Materials page's editors (materials, suppliers,
packaging, factory profiles) — those stay exactly where they were.
