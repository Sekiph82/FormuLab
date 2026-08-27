# Phase 10 — Documentation & Help Coverage Matrix

Definitive, source-verified inventory of every real route and major
workflow, for planning the user guide, in-app help, and guided tours.
Built by inspecting `apps/desktop/src/app/router.tsx`,
`components/sidebar/Sidebar.tsx`, every route/test file, the
authorization model (`packages/shared/src/schemas/status.ts`,
`engine/regulatoryAuthorization.ts`), and the existing `docs/*.md`
corpus (`WORKSPACES.md`, `USER_GUIDE.md`, `INFORMATION_ARCHITECTURE.md`,
and ~85 per-feature spec docs). Never invents a role, button, export,
or capability not found in source.

Legend — **Doc status**: `current` (accurate today) / `stale` (exists
but describes an earlier state) / `missing` (no user-facing coverage).
**Help level**: `none` / `panel` (page-level Help panel suffices) /
`panel+fields` (also needs field tooltips) / `panel+fields+tour`
(complex enough to warrant a guided tour).

## Registry coverage (Session 1 — `apps/desktop/src/lib/help/registry.ts`)

Every row below now has an actual `HELP_TOPICS` entry (22 topics total),
resolved from its real route via `topicForRoute()`. Topic id equals the
module's own sidebar/route key wherever one exists.

| Coverage-matrix row | `HELP_TOPICS` id | Route match |
|---|---|---|
| Home | `home` | exact `/home` |
| Projects | `projects` | exact `/projects` |
| Formulation | `formulation` | exact `/formulation` |
| Optimization | `optimization` | exact `/optimization` |
| Design of Experiments | `doe` | exact `/doe` |
| Reverse Formulation | `reverseFormulation` | exact `/reverse-formulation` |
| Laboratory | `laboratory` | exact `/laboratory` |
| Stability | `stability` | exact `/stability` |
| Regulatory | `regulatory` | exact `/regulatory` |
| Dossiers | `dossiers` | exact `/dossiers` |
| Claims & Labels | `claimsLabels` | exact `/claims-labels` |
| Approval | `approval` | exact `/approval` |
| Reports | `reports` | exact `/reports` |
| Data Exchange | `dataExchange` | exact `/data-exchange` |
| Administration | `administration` | exact `/administration` |
| Materials | `materials` (`linkOnly: true`) | exact `/materials` |
| Optimizer | `optimizer` (`linkOnly: true`) | exact `/optimizer` |
| Notebooks | `notebooks` | exact `/notebooks` |
| Files | `files` | exact `/files` |
| Runs | `runs` | exact `/runs` |
| Sessions | `sessions` | prefix `/live`, exact `/example/:sessionId` |
| Settings | `settings` | prefix `/settings` |
| Legacy (`/formulas`, `/formulas/legacy`) | — (`HELP_EXCLUSIONS`) | deliberately excluded, see below |

`/` (redirect), `/formulas` (redirect), `/formulas/legacy` (retained
legacy page), and `*` (404) are documented `HELP_EXCLUSIONS` entries in
`registry.ts`, each with a reason — not a coverage gap. Content itself
(title/summary/sections/etc.) lives in `i18n/locales/<locale>/help.json`;
this session's content is concise but factually grounded per-module, not
yet the full guide prose planned for Session 6.

## Visible help (Session 2 — `components/help/{HelpButton,HelpPanel,HelpCenter}.tsx`)

Every "Help level" cell below now has a real, working `panel` tier: a
"Help" button (bottom-right, every route above with a resolved topic)
opens a route-aware side panel showing that topic's full content —
summary, purpose, prerequisites, quick start, sections, warnings, role
notes, limitations, related topics, and glossary term chips. A global
Help Center (`Ctrl/Cmd+/` or the command palette's "Search help" action)
full-text-searches every topic and glossary term regardless of route,
including link-only topics (Materials, Optimizer).

## Field-level help and disabled-action explanations (Session 3 — `components/help/{InfoTooltip,DisabledActionButton}.tsx`)

The `panel+fields` tier now has real coverage on the rows flagged for it,
via two reusable primitives rather than per-field ad hoc text:
`InfoTooltip` (a hover/focus-opened "i" disclosure, localized title/body,
optional "Learn more" into the page's own help topic) and
`DisabledActionButton` (a real disabled `<button>` plus an always-visible
structured reason — message/required role/prerequisite/resolvable/"Learn
more" — built directly from the module's own existing guard, never a
second permission model).

| Module | InfoTooltip fields | DisabledActionButton actions |
|---|---|---|
| Formulation | Total/q.s., approval state, cost snapshot | Save cost snapshot |
| Laboratory | Primary vs. alternative, standard status, historical snapshots | Make primary (assignment/superseded-acknowledgement) |
| Design of Experiments | Responses, factors and levels | — |
| Stability | Conditions, time points | — |
| Approval | — | Approve (readiness/role/missing-fields) |
| Dossiers | — | Export PDF/DOCX (authorization — now shown disabled+explained, not hidden) |
| Data Exchange | — | Commit import (support/preview/committable-rows/error-rows) |

Guided tours (`panel+fields+tour`) remain Session 4 work — not yet
implemented.

## Guided tours and onboarding (Session 4 — `lib/help/tours.ts`, `components/help/{TourOverlay,OnboardingPrompt}.tsx`)

The `panel+fields+tour` tier now has real coverage for the three modules
this phase ever scoped for a tour. Each step's target is a real,
already-existing element (`data-tour="…"` attribute) — a step is skipped
automatically (never a crash) if its target doesn't render within a short
timeout, which happens routinely for the DoE/Dossiers steps below since
those elements are gated behind "a study/dossier is selected."

| Module | Tour route | Steps (target element) |
|---|---|---|
| Formulation | `/live` (the session composer — not `/formulation`, see handoff) | Target product input, category/market, Generate, V1/V2/V3 candidate tabs, Card/Edit tabs, function totals, warnings |
| Design of Experiments | `/doe` | Factors, levels (both point at the Design tab), Responses, Run generation (Runs tab), Interpretation limits (Analysis tab) |
| Dossiers | `/dossiers` | Requirements, Evidence mapping, Readiness (Overview summary), Review, PDF/DOCX export, "Export is not approval" (informational, no target) |

Restartable from Help: the `formulation`/`doe`/`dossiers` `HELP_TOPICS`
entries each carry a `tourId`; their Help panel view shows a "Start tour"
button. A first-use `OnboardingPrompt` (shown once per local profile,
`formulab.onboarding.dismissed.v1`) offers the same three tours from any
route.

## Module map (confirmed against `router.tsx` + `Sidebar.tsx`)

| # | Top-level entry | Route | Children (accordion group) |
|---|---|---|---|
| 1 | Home | `/home` | — |
| 2 | Projects | `/projects` | — |
| 3 | Formulation (group) | — | Formulation `/formulation`, Optimization `/optimization`, Design of Experiments `/doe`, Reverse Formulation `/reverse-formulation` |
| 4 | Laboratory (group) | — | Laboratory `/laboratory`, Stability `/stability` |
| 5 | Regulatory (group) | — | Regulatory `/regulatory`, Dossiers `/dossiers`, Claims & Labels `/claims-labels`, Approval `/approval` |
| 6 | Reports | `/reports` | — |
| 7 | Data Exchange | `/data-exchange` | — |
| 8 | Administration | `/administration` | — |
| 9 | Tools (group) | — | Notebooks `/notebooks`, Files `/files`, Runs `/runs` |
| 10 | Sessions | `/live`, `/live/:sessionId` (pinned list, not an accordion group) | — |

## Real routes not in the sidebar (must not be invented as new nav — document as reachable via link, not as a nav item)

| Route | Reachable via | Status |
|---|---|---|
| `/materials` | Administration's "Materials, suppliers, packaging & factory profiles" link | Implemented — self-contained page with its own internal tabs (materials, suppliers, packaging components/BOMs, factory profiles) |
| `/optimizer` | Command palette; a link from the Optimization workspace | Implemented — standalone, non-project-bound what-if cost calculator, genuinely distinct from `/optimization` |
| `/settings`, `/settings/:section` | Sidebar footer (always pinned) | Implemented — sections: General, Appearance, Models, Python (runtime), Compute, Privacy |
| `/example/:sessionId` | Deep link only (example/demo session content) | Implemented (`SessionPage.tsx`) |
| `/formulas` | Legacy deep link | Redirects to `/projects` — kept so no old bookmark 404s |
| `/formulas/legacy` | Legacy deep link | Implemented, unmodified — the pre-Phase-6 single-page Formula Builder with every downstream module as a horizontal tab; not deleted, not promoted |
| `*` (catch-all) | Any unknown path | `NotFound.tsx` |

## Coverage matrix

### Home — `/home`
- **Purpose**: real dashboard — recent projects, activity, open lab work, upcoming stability samples, pending approvals, dossier/claims signals, Data Exchange activity.
- **Roles**: all (no gate).
- **Prerequisites**: none.
- **Inputs**: none (read-only aggregation).
- **Outputs**: none (links out to source workspaces).
- **Sections**: Recent projects, Recent activity, Open lab work, Upcoming stability samples, Pending approvals, Dossier signals, Data Exchange activity.
- **Actions**: navigate to a project/workspace.
- **Destructive actions**: none.
- **Approval requirements**: none.
- **States**: honest empty-state text per section when nothing is persisted; bounded to the 5 most-recently-updated projects (disclosed, not a silent cap).
- **Related**: every module (aggregates from all of them).
- **Doc status**: `current` (`WORKSPACES.md#home` matches source).
- **Help level**: `panel`.
- **Screenshot**: yes — empty state + populated state.
- **Tour suitability**: good "Getting Started" first stop.
- **Limitations**: bounded to 5 recent projects (disclosed in source comment and `WORKSPACES.md`).

### Projects — `/projects`
- **Purpose**: every formulation project, independent of workspace.
- **Roles**: all.
- **Prerequisites**: none.
- **Inputs**: New Project dialog (product family, packaging SKUs, name, code, brief, target market, claims, batch size).
- **Outputs**: a new project.
- **Sections**: project list, dossier count badge, Data Exchange shortcut.
- **Actions**: create project, open project (→ `/formulation?project=`).
- **Destructive actions**: none surfaced here.
- **Approval requirements**: none.
- **States**: empty state when no projects exist.
- **Related**: Formulation, Home, Dossiers (badge deep-link).
- **Doc status**: `current`.
- **Help level**: `panel+fields` (New Project dialog fields benefit from tooltips — product family/packaging SKU selection affects the whole downstream template).
- **Screenshot**: yes.
- **Tour suitability**: good — "create your first project" step.
- **Limitations**: none disclosed.

### Formulation — `/formulation`
- **Purpose**: the formula grid, versions, cost, compatibility, safety, packaging — the daily R&D surface.
- **Roles**: all can edit a draft; only `chemist`/`quality`/`administrator` can approve `pilot_approved`; only `quality`/`regulatory`/`production`/`administrator` can approve `production_approved` (`APPROVAL_AUTHORITY`).
- **Prerequisites**: an open project (`?project=`).
- **Inputs**: formula lines (material, phase, %, active-matter %), version save (change reason required).
- **Outputs**: saved versions, cost/validation/compatibility/safety findings, exports (JSON/CSV/Excel/cost-snapshot/packaging-BOM/draft-ERP-CSV).
- **Tabs**: Builder, Versions, Cost, Compatibility, Safety, Packaging (read-only summary; editing lives in Administration).
- **Actions**: add/reorder/delete line, q.s. water toggle, save version, compare versions, export, retire/reject/reopen/variant.
- **Destructive actions**: none truly destructive (versions are immutable; retire/reject are reversible-by-new-draft, not deletion).
- **Approval requirements**: `pilot_approved`/`production_approved` require a named human actor with an authorized role — never an agent/system/import actor (`canTransitionTo`, enforced engine-side regardless of UI).
- **States**: blocking/error/warning/info validation severities shown inline and in a formula-level summary; functional-group totals report `incomplete` rather than a false zero; unsaved-changes indicator.
- **Related**: Laboratory, Stability, Regulatory, Approval (header icon-links, project/version-scoped).
- **Doc status**: `current` for the tab set; `USER_GUIDE.md` §1–4, §13 detailed and accurate.
- **Help level**: `panel+fields+tour`.
- **Screenshot**: yes — grid, validation summary, version compare diff.
- **Tour suitability**: primary guided-tour candidate — "build your first formula."
- **Limitations**: none beyond the documented `AGENTS.md` design principles (no fabricated data).

### Optimization — `/optimization`
- **Purpose**: constraint-solving optimizer bound to a project's current working draft.
- **Roles**: all.
- **Prerequisites**: an open project with a working draft.
- **Inputs**: candidate materials, functional-group constraints (soft/hard), property targets, cost ceiling, objectives (weighted or lexicographic-priority-limited — see limitations).
- **Outputs**: a run result (`optimal`/`feasible_with_penalties`/infeasible-with-explanation), applied to a new working draft.
- **Sections**: Run, Scenarios (save/reload/clone/retire, seeded structural profiles, run comparison).
- **Actions**: run, apply to draft, save/load/compare scenario.
- **Destructive actions**: "replace current selection" from a seeded profile asks for confirmation first (the only confirm-gated action here).
- **Approval requirements**: none directly (applying a result never grants approval).
- **States**: `feasible_with_penalties` distinct from clean `optimal`; infeasible explains why in plain language.
- **Related**: `/optimizer` (standalone, non-project-bound — explicitly different feature), Formulation (apply-to-draft target).
- **Doc status**: `current` (`ADVANCED_OPTIMIZER.md`, `OPTIMIZATION_SCENARIOS.md`).
- **Help level**: `panel+fields`.
- **Screenshot**: yes.
- **Tour suitability**: moderate — worth a short tour once Formulation's tour exists.
- **Limitations**: no builder for composition/ratio/conditional constraints; no lexicographic-priority selector in the UI (disclosed in `USER_GUIDE.md` "Known limitations").

### Design of Experiments — `/doe`
- **Purpose**: statistically valid formulation/process experiment planning and analysis.
- **Roles**: all.
- **Prerequisites**: a real saved formula version as baseline (never the working draft).
- **Inputs**: factors, constraints, responses, design type, generation settings.
- **Outputs**: run sheet, observations, fitted statistical model, candidate list.
- **Sections**: Studies, Design, Runs, Responses, Analysis, Candidates, History, Audit.
- **Actions**: 9-step study wizard, record observation, exclude a run with a reason, generate/link a Laboratory trial, run analysis, generate/apply candidate.
- **Destructive actions**: none (exclusion is reversible, never a delete).
- **Approval requirements**: none directly.
- **States**: diagnostics preview before commit (duplicate/balance/orthogonality/condition-number checks); a suspected outlier is suggested, never auto-excluded.
- **Related**: Laboratory (run→trial link), Optimization (candidate cross-nav), Formulation (apply-to-draft).
- **Doc status**: `current` (`DESIGN_OF_EXPERIMENTS.md` + 8 companion docs).
- **Help level**: `panel+fields+tour` (9-step wizard is the most complex single flow in the app).
- **Screenshot**: yes — wizard steps, Analysis charts.
- **Tour suitability**: strong candidate, second only to Formulation.
- **Limitations**: `definitive_screening`/`mixture_simplex_centroid` designs refused; fractions beyond half-fraction and Plackett-Burman beyond N=12 refused; analysis-results export can't be re-imported as a native analysis (all disclosed in `USER_GUIDE.md`/`DESIGN_OF_EXPERIMENTS.md`).

### Reverse Formulation — `/reverse-formulation`
- **Purpose**: given a competitor/benchmark product (declared ingredients, optional analytical results), proposes evidence-scored candidate formulas — decision support, never an auto-approved formula.
- **Roles**: all (candidate save/conversion has no special role gate beyond the normal human-actor rule for the resulting draft's approval fields).
- **Prerequisites**: a study with a benchmark product and declaration.
- **Inputs**: declared/INCI ingredient list, optional analytical composition results, target + constraints.
- **Outputs**: ranked candidate formulas with a formula-fit score and a separate, honestly-labeled evidence-confidence score.
- **Sections**: Studies, benchmark/declaration/analytical entry, ingredient-mapping review, target/constraint entry, candidate generation/comparison.
- **Actions**: create study, generate candidates, save candidate, convert candidate to a new draft formulation (or a new version on an existing formulation).
- **Destructive actions**: none.
- **Approval requirements**: a converted formulation always starts `concept` with empty approval/regulatory/safety record ids — never inherits approval from a benchmark or an import.
- **States**: honest empty-formula message with rejection reasons when evidence is insufficient; unevaluated scoring dimensions marked "not evaluated," never defaulted to passing; low-evidence-confidence warning distinct from an approval claim.
- **Related**: Formulation (conversion target).
- **Doc status**: **`missing`** — not covered in `USER_GUIDE.md` at all (predates the guide's last major update); referenced in passing in `IMPLEMENTATION_STATUS.md`'s "Done" section but has no user-facing walkthrough. **Highest-priority gap.**
- **Help level**: `panel+fields+tour`.
- **Screenshot**: yes.
- **Tour suitability**: strong candidate — currently the least-discoverable real feature in the app.
- **Limitations**: candidate conversion refuses (visibly, no placeholder) if a candidate's material has left the catalog since generation.

### Laboratory — `/laboratory`
- **Purpose**: trials, test definitions, corrective actions.
- **Roles**: all; only a human can mark a trial `completed`.
- **Prerequisites**: an open project; version selector (falls back to working draft).
- **Sections**: Trials, Test Definitions, Corrective Actions (`?section=` deep-link support).
- **Actions**: create trial, weighing entry, process-step entry, log observation/deviation, enter test result, compare trials, export.
- **Destructive actions**: none (a deviation is resolved/accepted, never deleted).
- **Approval requirements**: a critical open deviation blocks marking a trial complete.
- **States**: "not entered" (never a fabricated zero) for unweighed materials; pass/fail computed from the test's own logic.
- **Related**: Test Definitions (global catalog, also reachable from Administration), Corrective Actions, Stability (shared result-history browser and applicability explorer).
- **Doc status**: `current` (`USER_GUIDE.md` §16–17, §17a, `LABORATORY_TRIALS.md`, `TRIAL_EXECUTION.md`, `TRIAL_COMPARISON.md`, `TEST_DEFINITIONS.md`).
- **Help level**: `panel+fields`.
- **Screenshot**: yes — trial lifecycle, weighing, result-history browser.
- **Tour suitability**: good secondary tour.
- **Limitations**: none beyond the general "never a fabricated value" principle.
- **Session 1A addition**: per-test configurable laboratory standards and methods (`LaboratoryStandard`/`LaboratoryTestMethod`, `TestDefinitionsPanel.tsx`'s per-row Method drawer) — primary/alternative assignment, internal methods, superseded-acknowledgement, immutable historical `TestResult.methodSnapshot`. See `project-control/claude/handoffs/PHASE10_CURRENT.md`'s Session 1A summary and `USER_GUIDE.md` §17a. The `laboratory` help topic (registry coverage table above) was extended in place — no new topic id.

### Stability — `/stability`
- **Purpose**: stability studies, samples, results, trends, failures.
- **Roles**: all.
- **Prerequisites**: an open project; version selector.
- **Actions**: create study, generate samples, record result, view trend, resolve failure, open corrective action.
- **Destructive actions**: none.
- **Approval requirements**: none directly; feeds Approval's readiness gates.
- **States**: an out-of-range result auto-opens a failure (critical if the test is flagged critical); trend projections labelled "experimental estimate — not validated — human review required," never a shelf-life claim.
- **Related**: Laboratory (shared result-history browser, applicability explorer), Corrective Actions.
- **Doc status**: `current` (`USER_GUIDE.md` §18, `STABILITY_STUDIES.md`, `STABILITY_TRENDS.md`).
- **Help level**: `panel+fields`.
- **Screenshot**: yes — trend charts.
- **Tour suitability**: moderate.
- **Limitations**: no automatic shelf-life prediction (deliberate, disclosed).

### Regulatory — `/regulatory`
- **Purpose**: Kenya/EAC regulatory classification, rule evaluation, evidence confirmations, human review.
- **Roles**: rule verification/review/evidence-confirmation-revocation require an authorized regulatory actor (`regulatory`/`quality`/`administrator` — `AUTHORIZED_REGULATORY_ROLES`); every other human role can view and can perform preparation work (draft evidence, propose links).
- **Prerequisites**: a saved formula version, jurisdiction, packaging SKU (where relevant), acting reviewer role.
- **Sections**: classification card, Rules, evidence confirmations, Reviews (+ declare-equivalence).
- **Destructive actions**: none (deprecate/revoke require a reason, kept in history — never deleted).
- **Approval requirements**: a review is a named human sign-off; revocation requires a reason.
- **States**: `not_verified` on every seed rule until confirmed; missing-data findings are explicit, never a false pass.
- **Related**: Dossiers, Claims & Labels, Approval (readiness gates).
- **Doc status**: `current` (`USER_GUIDE.md` §20, `REGULATORY_ENGINE.md` + 7 companion docs).
- **Help level**: `panel+fields`.
- **Screenshot**: yes.
- **Tour suitability**: moderate — role-gated actions make a good "why is this disabled" demo.
- **Limitations**: 17 seed rules ship `not_verified`, disclosed everywhere.

### Dossiers — `/dossiers`
- **Purpose**: per-version, per-jurisdiction regulatory dossier assembly.
- **Roles**: creation/preparation open to any human; formal review/verification/PDF-DOCX-export gated to `regulatory`/`quality`/`administrator` (`isAuthorizedRegulatoryActor`/`requireAuthorizedRegulatoryActor`, checked before any export-history record is created).
- **Prerequisites**: a real saved formula version (never a working draft).
- **Sections**: Overview, Evidence Matrix, Requirements, Evidence Library, Reviews, Submissions, History, Audit.
- **Actions**: create dossier, status change, new revision, evidence import/replace, JSON export, CSV/Excel evidence-matrix export, **real PDF/DOCX export** (Phase 8 — genuinely implemented, watermarked `R&D DRAFT — NOT PRODUCTION APPROVED` when unapproved).
- **Destructive actions**: none (evidence is replaced with a kept revision chain, never edited in place or deleted).
- **Approval requirements**: export/review gated as above; export never approves/verifies/submits/mutates the dossier itself.
- **States**: export-history record per attempt (`generating`/`succeeded`/`failed`/`cancelled`); unauthorized role hides the export buttons entirely, no history row created.
- **Related**: Regulatory, Claims & Labels, Approval, Reports (links here for its dossier row).
- **Doc status**: **`stale`** — `WORKSPACES.md#dossiers` and `USER_GUIDE.md`'s "Known limitations" both still say "does not generate a final formatted PDF/DOCX dossier (Phase 7)," which was true when written but is **no longer true** since Phase 8. This is the single most important documentation correction Phase 10 must make.
- **Help level**: `panel+fields+tour`.
- **Screenshot**: yes — Evidence Matrix, export flow, the real watermark.
- **Tour suitability**: strong candidate, and a natural place to demo "why is this disabled" (unauthorized role).
- **Limitations**: no export-history viewer UI yet (`listExportHistory` exists, unused by any screen); no retention policy for history rows; no UI to export a superseded revision (only current) — all disclosed in `IMPLEMENTATION_STATUS.md`'s Phase 8 closure section.

### Claims & Labels — `/claims-labels`
- **Purpose**: product claims and labels per formula version.
- **Roles**: formal claim/label review gated to authorized regulatory roles; drafting open to any human.
- **Prerequisites**: a real saved formula version.
- **Sections**: Claims (Overview/Evidence/Reviews), Labels (Overview/Content/Artwork/Reviews/Consistency), History, Audit.
- **Actions**: create claim/label, link evidence (by reference to a dossier, never duplicated), record review, upload/approve/reject/replace artwork, run Consistency check, import/export.
- **Destructive actions**: none (artwork is replaced, not deleted).
- **Approval requirements**: only a formal review from an authorized role changes a claim's true status; imported records always start as drafts.
- **States**: Consistency check catches a wrong-version label, incomplete ingredient declaration, or a prohibited claim on a label.
- **Related**: Dossiers (evidence source), Regulatory, Approval (readiness gates).
- **Doc status**: `current` (`USER_GUIDE.md` §21, 9 companion docs).
- **Help level**: `panel+fields`.
- **Screenshot**: yes — Consistency check output.
- **Tour suitability**: moderate.
- **Limitations**: no full graphic-design artwork editor (upload/preview/approve/reject/replace only) — disclosed.

### Approval — `/approval`
- **Purpose**: readiness overview, blockers, approval policies, version equivalence, decision history.
- **Roles**: `pilot_approved` requires `chemist`/`quality`/`administrator`; `production_approved` requires `quality`/`regulatory`/`production`/`administrator`; no automated actor can ever approve, enforced engine-side (`canTransitionTo`).
- **Prerequisites**: an open project/version.
- **Actions**: approve/reject with reason, edit policy, clone/retire policy, declare version equivalence.
- **Destructive actions**: none (policy retire is reversible via revision history).
- **Approval requirements**: this IS the approval gate.
- **States**: every blocker is named, not summarized away; a policy conflict shows deterministic resolution, not a silent pick.
- **Related**: every module with a readiness gate (Formulation, Compatibility, Safety, Regulatory, Dossiers, Claims & Labels, Laboratory, Stability).
- **Doc status**: `current` (`USER_GUIDE.md` §5/§12, `APPROVAL_WORKFLOW.md`, `APPROVAL_READINESS.md`, `APPROVAL_POLICIES.md`).
- **Help level**: `panel+fields+tour`.
- **Screenshot**: yes — blocker list, "why is this disabled."
- **Tour suitability**: strong — the natural home for a "why can't I approve this" tour/explanation pattern.
- **Limitations**: narrow policy-editor gaps disclosed in `APPROVAL_POLICIES.md#known-limitations`.

### Reports — `/reports`
- **Purpose**: navigation shell listing every real export already available in its source module.
- **Roles**: all (read-only navigation).
- **Prerequisites**: none at this page; each linked row inherits its source module's prerequisites.
- **Actions**: 17 "Open" links to source-module exports; 1 row ("Audit reports") has no destination yet.
- **Destructive actions**: none.
- **Approval requirements**: none.
- **States**: "Not yet implemented" badge on the one unimplemented row.
- **Related**: every export-bearing module.
- **Doc status**: **`stale`** — the in-source comment ("the full Phase 7 PDF/DOCX report engine is explicitly out of scope... marked as not yet implemented") predates Phase 8's real Dossier PDF/DOCX export and is now misleading if read literally; the actual rendered page text ("Not yet implemented") correctly applies to the Audit-reports row only, not to PDF/DOCX broadly. Needs a precise correction in both the code comment and the guide.
- **Help level**: `panel`.
- **Screenshot**: yes.
- **Tour suitability**: low (it's a link list).
- **Limitations**: audit reports has no dedicated view.

### Data Exchange — `/data-exchange`
- **Purpose**: bulk CSV/Excel import/export across every module.
- **Roles**: import commit gated by the same `REGULATORY_ROLES`/module-specific authorization each template's target collection already uses; preview is open to any human.
- **Prerequisites**: none to browse; a file to import.
- **Sections**: Template Library, Exports, Imports, Validation, History, Schema Versions, Help.
- **Actions**: download Blank/Example/current-data, upload + preview, commit (partial-import allowed), view import history.
- **Destructive actions**: none (import never overwrites — every collection's own append-only/mutable rules apply; nothing is written until explicit commit).
- **Approval requirements**: import can never mark anything verified/approved — always drafts, matching manual entry.
- **States**: preview shows new/updates/unchanged/duplicates/warnings/errors before commit; 2 templates (Stability Protocols/Results) preview but cannot commit, honestly reported per-row.
- **Related**: every module with an importable/exportable collection.
- **Doc status**: **`stale`** — `USER_GUIDE.md` §23 and `WORKSPACES.md#data-exchange-center` both say "24 templates" / "24 mandated import/export templates." The real count, confirmed via `dataExchangeRegistry.test.ts`, is **41** (grew across Phase 6/8 sessions). Second most important documentation correction Phase 10 must make.
- **Help level**: `panel+fields`.
- **Screenshot**: yes — Template Library, preview screen.
- **Tour suitability**: strong — the preview-before-commit safety pattern is worth a short guided walkthrough.
- **Limitations**: 2 templates registered/previewed but not committable, disclosed per-row.

### Administration — `/administration`
- **Purpose**: navigation hub linking to existing configuration screens; hosts Test Definitions directly (the one genuinely global, prop-less editor).
- **Roles**: all can view; individual linked screens carry their own gates.
- **Prerequisites**: none.
- **Actions**: navigate to Materials, Regulatory, Approval, Data Exchange, Settings; edit test definitions inline.
- **Destructive actions**: none here directly.
- **Approval requirements**: none here directly.
- **States**: explicit "no user-management backend" notice — never implies a Users/Roles section that doesn't exist.
- **Related**: Materials, Regulatory, Approval, Data Exchange, Settings, Laboratory (Test Definitions).
- **Doc status**: `current`.
- **Help level**: `panel`.
- **Screenshot**: yes.
- **Tour suitability**: low (link hub).
- **Limitations**: no user/role management (disclosed, by design).

### Materials — `/materials` (linked from Administration, no sidebar entry)
- **Purpose**: materials, suppliers, packaging components/BOMs, factory cost profiles.
- **Roles**: all.
- **Prerequisites**: none.
- **Actions**: create/edit material, attach supplier, edit price (append-only history), manage inventory, edit packaging BOM/component, edit factory profile, import/export.
- **Destructive actions**: none (prices are append-only; nothing is deleted, only superseded).
- **Approval requirements**: none.
- **States**: unknown fields explicitly `missing`/`unknown`/`not_applicable`/`not_verified`, never blank-as-zero; factory-profile demo figures marked `example_only`/`not_verified`.
- **Related**: Formulation (material source), Administration (entry point).
- **Doc status**: `current` (`USER_GUIDE.md` §6–7, `RAW_MATERIALS.md`).
- **Help level**: `panel+fields`.
- **Screenshot**: yes.
- **Tour suitability**: moderate.
- **Limitations**: none beyond documented data-completeness model.

### Notebooks — `/notebooks` (Tools)
- **Purpose**: runnable Jupyter-style notebook editor.
- **Roles**: all.
- **Prerequisites**: none (desktop-only feature — browser dev mode shows an honest "desktop-only" empty state).
- **Actions**: open notebook, run cell (Cmd/Ctrl/Shift+Enter).
- **Destructive actions**: none surfaced beyond normal file edits.
- **Related**: Files, Runs.
- **Doc status**: `missing` from `USER_GUIDE.md` (out of that guide's declared scope — it's explicitly an "R&D workflow" guide, not covering the agent/notebook/compute tooling side of this dual-purpose app).
- **Help level**: `panel`.
- **Screenshot**: yes.
- **Tour suitability**: low-moderate.
- **Limitations**: desktop-only.

### Files — `/files` (Tools)
- **Purpose**: file browser/previewer across session folders.
- **Roles**: all.
- **Actions**: browse, preview, open notebook, switch to formulas library.
- **Related**: Notebooks, Formulas (legacy).
- **Doc status**: `missing` from `USER_GUIDE.md` (same reason as Notebooks).
- **Help level**: `panel`.
- **Screenshot**: yes.
- **Tour suitability**: low.

### Runs — `/runs` (Tools)
- **Purpose**: history of executed commands/computations with reproduce/log/output access.
- **Roles**: all.
- **Actions**: filter by search/status, expand recipe, reproduce, load captured log, open output file.
- **Related**: Notebooks, Compute settings.
- **Doc status**: `missing` from `USER_GUIDE.md`.
- **Help level**: `panel+fields`.
- **Screenshot**: yes.
- **Tour suitability**: low.

### Sessions (pinned list) — `/live`, `/live/:sessionId`
- **Purpose**: the AI-thread-driven research session list (agent/chat side of this dual-purpose app) — the "New" action's target.
- **Roles**: all.
- **Actions**: create new session, open a session, delete a session.
- **Destructive actions**: delete session (confirmed via a dialog — `confirmDelete` i18n keys confirm this, not a silent delete).
- **States**: latest 8 shown newest-first (as of this session's own sidebar change), "View all sessions"/"Show fewer" toggle, honest empty state.
- **Related**: the whole agent/chat/notebook side of the app — largely outside `USER_GUIDE.md`'s declared R&D-workflow scope.
- **Doc status**: `missing` (sidebar-mechanics-only coverage exists in `NAVIGATION_AND_CONTEXT.md`; no user-facing "what is a session" explanation exists).
- **Help level**: `panel`.
- **Screenshot**: yes.
- **Tour suitability**: moderate — good "Getting Started" companion to Home.

### Settings — `/settings`, `/settings/:section`
- **Purpose**: General, Appearance, Models, Python (runtime), Compute, Privacy.
- **Roles**: all (single-user desktop app, no per-role settings).
- **Actions**: change theme/locale, configure model/provider, manage Python runtime, configure compute targets, privacy toggles.
- **Destructive actions**: none surfaced in the sidebar-visible sections beyond normal config changes.
- **Related**: everything (global app config).
- **Doc status**: `missing` from `USER_GUIDE.md`.
- **Help level**: `panel+fields`.
- **Screenshot**: yes — one per section.
- **Tour suitability**: low-moderate (a single onboarding pass through General/Appearance is reasonable).

### Legacy — `/formulas` (redirect), `/formulas/legacy`
- **Purpose**: backward-compatibility only; the pre-Phase-6 single-page Formula Builder.
- **Doc status**: `current` (explicitly documented as retained-not-primary in `INFORMATION_ARCHITECTURE.md`, `WORKSPACES.md`).
- **Help level**: `none` (deliberately not a primary-path feature — the guide should mention it exists for compatibility, not teach it as the way to work).
- **Screenshot**: no.
- **Tour suitability**: none.

## Cross-cutting findings (apply to the whole app, not one module)

- **Keyboard shortcuts, confirmed exhaustively by source grep** (do not
  invent more): `Cmd/Ctrl+B` (toggle sidebar), `Cmd/Ctrl+K` (command
  palette), `Esc` (close command palette), `Cmd/Ctrl+Shift+Enter` or
  `Cmd/Ctrl+Enter` (run notebook cell), `Cmd/Ctrl+Enter` (generate, in
  the formulation studio composer).
- **Existing help/tooltip infrastructure**: none. Zero dedicated
  Tooltip component, zero onboarding system, zero guided-tour system,
  zero Help Center. The only existing help-adjacent affordance is 121
  native HTML `title={t(...)}` attributes scattered across components
  (browser-native tooltips, ad hoc, no registry).
- **Reusable infrastructure already in the app** (do not duplicate):
  `cmdk` (already powers the Cmd/Ctrl+K command palette — directly
  reusable for Help Center full-text search); `react-markdown` +
  `remark-gfm` + `MarkdownViewer.tsx` (already renders Markdown
  in-app — directly reusable for help content, no new renderer
  needed); the i18n system (8 shipped locales, typed keys, parity-
  tested — the natural home for help-content localization); the
  existing accordion/`NavLink`/`aria-expanded` patterns from the
  Phase 9 sidebar consolidation (directly reusable for a Help Center's
  own topic tree).
- **Documentation drift pattern** (recurring, worth designing against):
  `WORKSPACES.md`, `USER_GUIDE.md`, `INFORMATION_ARCHITECTURE.md`, and
  a source comment in `ReportsPage.tsx` all still describe the Phase-8
  Dossier PDF/DOCX export and the Data-Exchange 41-template count as
  they were *before* those phases shipped. This is the concrete
  evidence for why Phase 10's architecture needs an explicit,
  low-effort staleness-detection mechanism (see the handoff's
  "screenshot/content update detection" section) — it has already
  happened three times independently in this repository's real history.

## Documentation fixture and screenshot manifest (Session 5 — `apps/desktop/src/lib/docsFixture/*`, `docs/PHASE10_SCREENSHOT_MANIFEST.json`)

The staleness-detection mechanism the paragraph above calls for now
exists as real, tested code rather than a plan: `screenshotManifest.ts`'s
`detectStaleOrMissing`/`detectOrphanScreenshots` compare the manifest
against whatever is actually on disk (and, once wired to real commit
data, against which modules changed since a screenshot's
`lastCapturedCommit`) — the exact same "compare declared state to real
HEAD" pattern `registry.test.ts`'s full-route-coverage check and
`masterdata.rs`'s 90-collection allow-list regression guard already use
elsewhere in this codebase, applied to documentation images instead of
code or a route table.

| Piece | What it is | Real-data guarantee |
|---|---|---|
| `build.ts` | Deterministic fixture data (project, version, session, 18 master-data collections) | Every record validated against its real `@formulab/shared` Zod schema; real catalog codes reused (`HC-SHAMPOO-REG`, `raw_materials`); `DEMO-` prefixed throughout |
| `fixtureWriter.ts` | Seed/reset to a real, isolated directory (`.docs-fixture/` by default) | Fails closed on a real-profile-looking path or an unknown non-empty directory; idempotent reset |
| `screenshotManifest.ts` | Types + the naming convention + drift detection | `id` cross-checked against its own component fields; `route`/`helpTopic` cross-checked against the real `topicForRoute()`/`HELP_TOPICS` |
| `docs/PHASE10_SCREENSHOT_MANIFEST.json` | 26 entries, one per required coverage item | `lastCapturedCommit: null` on every entry — no image captured yet |

No screenshot binary exists yet. Every module row's "Screenshot" answer
above (`yes`/`no`/planned) is unaffected by this session — the manifest
records WHICH shot each module needs, not that it has been taken. Session
6 (illustrated guide content) also did not capture any — see below; the
capture sweep remains deferred to a future session with a real
window-automation harness.

## Illustrated user guide and PDF/DOCX generation (Session 6 — `docs/USER_GUIDE.md`, `apps/desktop/src/lib/userGuideExport/*`)

`docs/USER_GUIDE.md` now covers every module in this matrix (31 real
sections, see the handoff's Session 6 summary for the full list) and
embeds a reference to all 17 highest-value screenshots from the manifest
above — but, matching this session's own honest-disclosure discipline,
**zero screenshots were captured**: no reliable, safe automation driver
exists in this environment for the native Tauri window, and every
manifest entry's `lastCapturedCommit` correctly stays `null`. Both the
PDF/DOCX exporters and the in-app guide (`MarkdownViewer`'s new
`MarkdownImage`) render the same real "not yet captured" placeholder
rather than a broken image or a silent omission.

| Output | Real, tested, and where |
|---|---|
| In-app (`/guide`) | `UserGuidePage.tsx`, reachable from the Help Center and command palette; renders the exact `docs/USER_GUIDE.md` bytes via a Vite `?raw` import — no second copy |
| PDF | `docs/generated/FormuLab-User-Guide.pdf` — cover page, real table of contents with real page numbers, page numbers on every page, embedded screenshots (once captured) with captions, callouts, tables; byte-deterministic across regenerations |
| DOCX | `docs/generated/FormuLab-User-Guide.docx` — native Word heading styles + a real, Word-refreshable `TableOfContents` field; structurally deterministic (same known zip-timestamp limitation `dossierDocx.ts` already has) |

One genuine pre-existing defect this session's own tooling found and
fixed: an internal guide cross-reference (`#18-corrective-actions`)
pointed at the wrong section (the real Corrective Actions heading is
§19) — caught by `generate.test.ts`'s anchor-resolution check, not
something Session 6 introduced.

## Full coverage verification (Session 7)

Cross-checked the whole matrix above against real HEAD (not Session 0's
snapshot): router→topic coverage, glossary/related-topic reference
resolution, role notes, screenshot/guide references, and the
"recent high-risk features" list — all confirmed still accurate, no
drift since Sessions 1-6. Two real gaps found and closed:

| Finding | Kind | Fix |
|---|---|---|
| `session.json`'s `reports.links.dataExchangeImportHistory.description` said "24 templates" (real: 41) in all 8 locales | genuine stale content, distinct from Session 6's guide-body fix | corrected in all 8 locale files; permanent regression test added (`parity.test.ts`, scans every locale/namespace/string) |
| `DisabledReason.relatedTopicId` (Approval/Cost/Dossier/TestMethod/DataExchange panels) had no resolution test | coverage gap, not a live defect (all current references already valid) | new `registry.test.ts` filesystem-walk test added |

Also added: an orphan-topic check (every `HelpTopic.routes[]` entry is a
real `router.tsx` path — zero orphans found). Manual/visual verification
of the running native app is **blocked** in this environment (no
Playwright/WebDriver wired for the Tauri WebView2 window) — not claimed
as verified beyond what the automated (jsdom) suites exercise. Full
regression: shared 1248/1248, desktop 1010/1010 (121 files, 6
pre-existing unrelated unhandled-rejection log lines confirmed via
`git stash` to predate this session), Rust 83/83, both typechecks and
lint clean.

## Session 8 navigation correction — collapsed-sidebar restore control

A real, previously-undetected help/navigation interaction gap: on
`/live`, collapsing the sidebar left no UI control to reopen it, which
would also have blocked reaching the Help button/Help Center/command
palette by mouse from that state (all three live inside the sidebar-
adjacent chrome, unaffected in content, but unreachable without a
working restore control). Fixed in `AppShell.tsx` (see the Session 8
summary in the handoff for detail); a new test confirms the Help panel
still opens correctly from `/reports` while the sidebar is collapsed,
using the same restore control.
