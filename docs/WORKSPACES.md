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
`stability_studies` to the project name, sorted soonest-first), pending
approvals (formula versions across the 5 most recent projects whose
`effectiveStatus` is `chemist_review`/`lab_candidate`/
`stability_testing`/`pilot_candidate`), and — Phase 3 — regulatory
dossiers scoped to the same 5 recent projects: counts of dossiers in
preparation/ready-for-review/blocked (each `calculateDossierReadiness`,
never a placeholder), dossier evidence expiring within 30 days, and
dossiers whose readiness is `ready_for_review` with no active recorded
review yet. As of Phase 6, a Data Exchange card too — imports awaiting
confirmation/failed/completed-with-warnings and a count of exports in
the last 7 days, computed from the real `data_exchange_import_jobs`/
`data_exchange_export_jobs` collections, deliberately not scoped to the
5 recent projects since Data Exchange is project-less.

**Does not**: aggregate across an unbounded number of projects — pending
approvals, recent activity and the dossier signals above are all only
computed for the 5 most recently-updated projects (bounded to keep the
per-project `readAuditLog`+`readFormulation` calls, and the dossier
readiness computation, cheap); this is a real bound, not a silent cap
presented as complete. Does not fabricate a metric — every section has
its own honest empty-state string when there is nothing to show.

## Projects

`/projects` — `apps/desktop/src/app/routes/ProjectsPage.tsx`. Reuses
`NewProjectDialog`. Extracted from `FormulasPage.tsx`'s project-list
view.

Every formulation project, independent of which downstream workspace
it's being worked in. Opening a project navigates to
`/formulation?project=<id>`. Each row also carries a compact dossier
count badge (non-superseded/archived dossiers for that project) that
deep-links to `/dossiers?project=<id>` — a count and a link only, never a
computed readiness state (that lives in the Dossiers workspace itself).
As of Phase 6, a Data Exchange icon button too, linking to
`/data-exchange` — Data Exchange is project-less, so this is a plain
navigation shortcut, not a project-scoped filter.

**Does not**: show anything about a project's laboratory/stability/
regulatory/approval/dossier-readiness state beyond that count — that's
Home's job, or the project's own workspaces.

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

## Design of Experiments

`/doe` — `apps/desktop/src/app/routes/DoePage.tsx`, backed by
`DoePanel.tsx`. Sidebar entry near Laboratory/Stability/Optimization — a
first-class workspace, never a Formula Builder tab (see
[DESIGN_OF_EXPERIMENTS.md](DESIGN_OF_EXPERIMENTS.md)).

Top-level sections: Studies, Design, Runs, Responses, Analysis, Candidates,
History, Audit. A 9-step study-creation wizard (baseline saved version,
objective, factors, constraints, responses, design type, generation
settings, diagnostics preview, generate) is gated on a real saved formula
version — never the current working draft. The Analysis tab renders real
inline-SVG charts computed from a study's own fitted model: main-effects/
Pareto bars, predicted-vs-observed and residual-vs-predicted scatter,
normal-probability plot, and a response-surface heatmap for a 2-factor
quadratic model. Export buttons throughout (study JSON, design matrix/run
sheet/observations CSV, analysis-results JSON, coefficients/ANOVA CSV,
candidate-list CSV); factor/constraint/observation CSV import with the same
preview-before-commit behavior every other import in this app uses. Runs
tab: manual observation entry per (run, response), run-status transitions,
exclusion with reason, and generating (or linking) a real Laboratory trial
from a run. Candidates tab: generate/shortlist/select/apply-to-draft, plus
lightweight cross-navigation links to Optimization and Stability.

**Does not**: generate a final formatted PDF/DOCX report (Phase 7), display
a specific DOE candidate inside the Optimization workspace, or re-import an
analysis-results export as a native analysis — see
[DESIGN_OF_EXPERIMENTS.md](DESIGN_OF_EXPERIMENTS.md) and
[DOE_OPTIMIZATION_INTEGRATION.md](DOE_OPTIMIZATION_INTEGRATION.md).

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

## Dossiers

`/dossiers` — `apps/desktop/src/app/routes/DossiersPage.tsx`, backed by
`DossierPanel.tsx`. Sidebar entry between Regulatory and Approval — a
first-class workspace, never a Formula Builder tab (see
[REGULATORY_DOSSIERS.md](REGULATORY_DOSSIERS.md)).

Dossier list with status/jurisdiction filters and a create flow gated to
real saved formula versions (never the current working draft); a detail
view with eight sub-sections (Overview, Evidence Matrix, Requirements,
Evidence Library, Reviews, Submissions, History, Audit); status-change and
new-revision actions; JSON dossier export, CSV/Excel evidence-matrix
export, and JSON/CSV/Excel evidence-metadata import with a preview step.
Optional `version`/`jurisdiction`/`sku`/`dossier` query params let the
Regulatory workspace deep-link into a prefilled create flow or an existing
dossier's detail view; Home and Projects deep-link the same way for
dossiers surfaced on their own dashboards.

**Does not**: generate a final formatted PDF/DOCX dossier (Phase 7),
integrate with any real government/regulatory-authority submission portal
(submissions are an internal tracking record only), or claim legal
compliance from an uploaded document or accepted link — see
[REGULATORY_DOSSIERS.md](REGULATORY_DOSSIERS.md) and
[DOSSIER_SUBMISSIONS.md](DOSSIER_SUBMISSIONS.md).

## Claims & Labels

`/claims-labels` — `apps/desktop/src/app/routes/ClaimsLabelsPage.tsx`,
backed by `ClaimsLabelsPanel.tsx`. Sidebar entry between Dossiers and
Approval — a first-class workspace, never a Formula Builder tab or a
Dossiers sub-section (see [PRODUCT_CLAIMS.md](PRODUCT_CLAIMS.md)/
[PRODUCT_LABELS.md](PRODUCT_LABELS.md)).

Top-level sections: Claims, Labels, History, Audit. A claim's detail view
has three sub-sections (Overview, Evidence, Reviews); a label's detail
view has five (Overview, Content, Artwork, Reviews, Consistency). Claim
evidence is reused from a Phase 3 dossier by reference, never duplicated
— see [CLAIM_EVIDENCE.md](CLAIM_EVIDENCE.md). JSON/CSV/Excel export for
claims and (per-label) label content, a claim-review-summary export, a
label-readiness-summary export, and JSON/CSV/Excel import for both, with a
preview step before commit — see [IMPORT_EXPORT.md](IMPORT_EXPORT.md).
Optional `version`/`jurisdiction`/`sku`/`claim`/`label` query params let
Dossiers, Regulatory, Home and Projects deep-link into a prefilled view.

**Does not**: generate a final formatted PDF/DOCX label or claims report
(Phase 7), implement a full graphic-design artwork editor (upload/preview/
approve/reject/replace only), or claim legal compliance from a supported
claim status, a satisfied label requirement, or an approved artwork — see
[CLAIMS_LABEL_READINESS.md](CLAIMS_LABEL_READINESS.md).

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

A navigation shell of rows, each linking to the workspace that already
provides a real export (formula-version JSON from Formulation's Versions
tab, trial JSON from Laboratory, study/trend export from Stability, rule
JSON/CSV/Excel from Regulatory, dossier JSON + evidence-matrix CSV/Excel
from Dossiers, claims/label readiness from Claims & Labels, DOE exports
from the DOE workspace, decision history/snapshots from Approval, and —
as of Phase 6 — two Data Exchange rows linking to `/data-exchange`'s
import history and template/schema catalog). Audit reports has no
dedicated view yet and is labeled "Not yet implemented" — same as the
Dossier row's own final PDF/DOCX export.

**Does not**: generate PDF or DOCX reports. That is the explicitly
out-of-scope Phase 8 report engine — this page states that plainly
rather than implying it exists.

## Administration

`/administration` — `apps/desktop/src/app/routes/AdministrationPage.tsx`.
Links to the pre-existing `/materials` page (`MaterialsPage.tsx` —
already self-contained, with its own internal tabs for materials,
suppliers, packaging components/BOMs, and factory cost profiles),
`/regulatory` (rule library/verification/import-export),
`/approval` (policy editor), `/data-exchange` (Data Exchange Center, as
of Phase 6) and `/settings`. Hosts `TestDefinitionsPanel.tsx` directly as
its own section — the one genuinely global, prop-less editor, so it's
the only panel actually embedded here rather than linked to.

**Does not**: implement user or role management. This codebase has no
user-management backend — Administration says so explicitly rather than
inventing a "Users and roles" section with nothing behind it. Does not
re-implement the Materials page's editors (materials, suppliers,
packaging, factory profiles) — those stay exactly where they were.

## Data Exchange Center

`/data-exchange` — `apps/desktop/src/app/routes/DataExchangePage.tsx`.
New page; no panel to reuse. A standalone, project-less workspace like
Administration — reached from the sidebar (between Reports and
Administration), from Administration's own link, from two Reports rows,
or from a compact per-project link on the Projects list. Seven sections
(Template Library, Exports, Imports, Validation, History, Schema
Versions, Help) covering all 24 mandated import/export templates. See
[DATA_EXCHANGE_CENTER.md](DATA_EXCHANGE_CENTER.md) for the full detail —
this page is deliberately not summarized further here to avoid the two
documents drifting out of sync.

**Does not**: verify or approve anything from imported data (see
[DATA_EXCHANGE_SECURITY.md](DATA_EXCHANGE_SECURITY.md)); commit
`stability_protocols`/`stability_results` imports (registered, previewed,
but no commit handler — see
[DATA_EXCHANGE_TEMPLATE_CATALOG.md](DATA_EXCHANGE_TEMPLATE_CATALOG.md#stability-protocols-and-stability-results-not-wired));
generate a formatted PDF/DOCX report (Phase 8).
