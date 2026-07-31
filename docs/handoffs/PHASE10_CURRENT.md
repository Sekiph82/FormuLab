# Phase 10 — User Guide and In-App Help

## Status: Session 0 (assessment) complete. Nothing implemented yet.

## Key finding: build on what already exists, don't start from zero
This repository already has (a) a rich, technically accurate but
**text-only, un-illustrated, partly-stale** user guide
(`docs/USER_GUIDE.md`, 618 lines, cross-linked to ~85 companion spec
docs), (b) zero in-app help infrastructure (no Tooltip component, no
onboarding, no tours, no Help Center — confirmed by exhaustive grep),
and (c) three pieces of reusable infrastructure that make most of
Phase 10 cheaper than it looks: `cmdk` (already powers the command
palette — reuse for Help Center search), `react-markdown`+
`MarkdownViewer.tsx` (already renders Markdown in-app — reuse for help
content, no new renderer), and `pdf-lib`/`docx` (already generate real
Dossier PDF/DOCX exports in Phase 8 — reuse the same libraries for the
guide's PDF/DOCX output, no new toolchain).

Full per-route detail lives in
[`docs/PHASE10_COVERAGE_MATRIX.md`](../PHASE10_COVERAGE_MATRIX.md) —
this document summarizes and plans; the matrix is the source of truth
for "does X exist."

## Module inventory (confirmed against `router.tsx` + `Sidebar.tsx`)
The 10 top-level sidebar entries (Home, Projects, Formulation-group,
Laboratory-group, Regulatory-group, Reports, Data Exchange,
Administration, Tools-group, Sessions) plus every child route, exactly
as specified in the session prompt — confirmed to match current source
exactly, nothing added or renamed. Additional real routes reachable but
**not** in the sidebar (must stay link-only in the guide, never
proposed as new nav items): `/materials` (from Administration),
`/optimizer` (standalone what-if calculator, genuinely distinct from
`/optimization`), `/settings`+`/settings/:section`, `/example/:sessionId`,
`/formulas` (redirect to `/projects`), `/formulas/legacy` (retained old
single-page Formula Builder). Full table in the coverage matrix.

## Current help/documentation findings
- **In-app help**: none. Zero Tooltip component, zero onboarding, zero
  tour system, zero Help Center. Only existing affordance: 121 native
  HTML `title={t(...)}` attributes, ad hoc, no registry.
- **`docs/USER_GUIDE.md`**: real, detailed, honest (explicitly disclaims
  every unimplemented capability) — but titled "fourteen workspaces"
  and describing the pre-Phase-9 flat sidebar; missing **Reverse
  Formulation** entirely (a fully implemented, tested module with no
  guide section at all); missing Tools/Notebooks/Files/Runs/Sessions/
  Settings (explicitly out of that guide's declared "R&D workflow"
  scope); and — most importantly — **factually stale in two specific,
  verifiable places**: it says Dossiers "does not generate a final
  formatted PDF/DOCX" (true when written, **false since Phase 8**,
  which built a real PDF/DOCX export), and it says Data Exchange has
  "24 templates" (real count, confirmed via
  `dataExchangeRegistry.test.ts`, is **41**).
- **`docs/WORKSPACES.md`** and a source comment in `ReportsPage.tsx`
  carry the identical two stale claims — this is a **recurring
  pattern**, not a one-off, and is the concrete justification for
  Phase 10's screenshot/content staleness-detection requirement (see
  below), not a hypothetical concern.
- **~85 other `docs/*.md` files** exist, one or more per feature,
  written for developers/spec-readers rather than end users — real,
  accurate (spot-checked), and the correct source material to draw
  from for guide chapters and help-topic content, never to duplicate
  from scratch.
- **Keyboard shortcuts** (exhaustive, confirmed by source grep — do not
  invent more): `Cmd/Ctrl+B` sidebar toggle, `Cmd/Ctrl+K` command
  palette, `Esc` close palette, `Cmd/Ctrl(+Shift)+Enter` run a notebook
  cell / generate in the formulation composer.
- **Authorization model**: `ApprovalRole` = researcher/chemist/quality/
  regulatory/production/administrator. `pilot_approved` needs chemist/
  quality/administrator; `production_approved` needs quality/
  regulatory/production/administrator (`APPROVAL_AUTHORITY`). Dossier/
  Claims formal review/export needs regulatory/quality/administrator
  (`AUTHORIZED_REGULATORY_ROLES`). No automated actor (agent/system/
  import) can ever approve — enforced engine-side, not just hidden in
  the UI. This is the real, only role model — the guide must never
  imply a richer permission system exists.

## Coverage gaps (see matrix for full detail)
1. **Reverse Formulation has zero user-facing documentation.** Highest
   priority content gap.
2. **Two specific stale claims** (Dossier PDF/DOCX "not yet
   implemented"; Data Exchange "24 templates") must be corrected, not
   just supplemented.
3. **Tools (Notebooks/Files/Runs), Sessions, Settings, Administration/
   Materials** have no guide coverage — `USER_GUIDE.md`'s declared
   scope never included them.
4. **No in-app help of any kind** — the entire objective's items 2–6
   start from zero, not from a partial implementation.

## Proposed help architecture (repository-native, no parallel registry)
- **Central help registry**: one typed array (`HELP_TOPICS`), same
  shape as `Sidebar.tsx`'s own `navItems` array — id, the real route(s)
  it covers, i18n keys for title/summary/sections, `relatedTopicIds`,
  optional `roleNote`, `screenshotIds`, a link to its guide chapter.
  Maps onto `router.tsx`'s existing paths; **never defines a new
  route** — a `topicForRoute(pathname)` lookup is the only "registry,"
  matching the single-source-of-truth discipline the Phase 9 sidebar
  work already established.
- **Page Help panel**: a slide-in panel reusing the existing
  `components/inspector/InspectorShell.tsx` pattern (the app already
  has this exact "contextual side panel" affordance for artifacts/
  files/notebooks) — a "?" button in each workspace header opens it,
  content rendered via the existing `MarkdownViewer`.
- **Field tooltips**: one new small `InfoTooltip` component (native
  `title` isn't enough for longer field explanations); keyed to
  `help.json` field-level i18n keys.
- **Glossary**: one more help topic, not a new subsystem — a term list
  rendered the same way as every other topic, cross-linked via plain
  Markdown anchors.
- **Related-topic links**: `relatedTopicIds` on the registry entry,
  rendered as a "See also" list — data-driven, no separate system.
- **Full-text search / Help Center**: a second `cmdk` instance (the
  first already powers the command palette) — proven pattern, zero new
  dependency.
- **Role-aware help / "why is this disabled?"**: reuse the REAL,
  already-computed authorization booleans (`isAuthorizedRegulatoryActor`,
  `canActRegulatory`, etc.) to generate the disabled-reason text —
  never a free-text guess, never a second permission model.
- **Content versioning**: piggybacks on git history (like every other
  i18n string in this app) plus a `schemaVersion` field on the
  `HelpTopic` type, matching the `schemaVersion: "1.0"` convention used
  by every persisted schema in this codebase.
- **Locale support**: a new `help.json` per locale, in the existing
  `apps/desktop/src/i18n/locales/<code>/` directories — automatically
  covered by the existing `parity.test.ts` mechanism, zero new infra.
- **Guided tours**: a minimal hand-built overlay component (spotlight +
  positioned tooltip) — no new heavy dependency, scoped to the 3
  modules the coverage matrix actually flags as tour-worthy
  (Formulation, Design of Experiments, Dossiers), not every module.

## User guide deliverables plan
**Reuse and extend `docs/USER_GUIDE.md`** as the single source-of-truth
Markdown content (never a second, divergent copy). Ship it three ways
from one source: in-app (rendered live via `MarkdownViewer` inside the
Help Center), PDF (via `pdf-lib`, the same library Phase 8 already uses
for Dossier PDFs), DOCX (via `docx`, same as Phase 8's Dossier DOCX
export). The PDF output doubles as the printable version — no fourth
artifact needed.

| Chapter | Source screens | Screenshots | Example workflow | Safety warnings | Role notes | Depends on |
|---|---|---|---|---|---|---|
| Getting Started | Home, Sessions, New Project | Home empty/populated, New Project dialog | Create first project | none | none | — |
| Interface & navigation | Sidebar (all states), Command Palette | Sidebar collapsed/expanded/accordion, palette open | Navigate via keyboard | none | none | Getting Started |
| Roles & permissions | Approval, Dossiers export gate | "why disabled" state | Attempt a gated action as an unauthorized role | none | full — this chapter owns the role model | Getting Started |
| Every module (14 sub-chapters, one per coverage-matrix row incl. Reverse Formulation) | that module's route(s) | per coverage matrix | one real workflow per module, drawn from existing tests' `it()` names | destructive/irreversible actions flagged per matrix | per matrix | Roles & permissions |
| Cross-module workflows | Formulation→Laboratory→Stability→Regulatory→Dossiers→Approval chain | version-carried-via-`?project=` deep link | approve a formula end to end | none | per gate crossed | all module chapters |
| Imports/exports | Data Exchange, per-module export buttons | preview-before-commit screen | import a materials CSV, correct an error row, commit | data never verified/approved by import alone | commit gated by target collection's own role | Every module |
| Approvals & audit rules | Approval, every audit-log-emitting panel | blocker list, audit trail | trace one approval's audit history | approval is irreversible without a new version | full | Roles & permissions |
| Reports & dossiers | Reports, Dossiers | Reports link list, real PDF watermark | export a real Dossier PDF | watermark meaning explained | export role-gated | Every module |
| Troubleshooting | error states across modules | validation/error banners | resolve a blocking validation error | none | none | Every module |
| Common errors | same | same | — | none | none | Troubleshooting |
| Glossary | — | none | — | none | none | — |
| Keyboard shortcuts | — | none | — | none | none | Interface & navigation |
| Data safety & backups | Settings, `.FormuLab/` project storage | none | where data lives, how to back it up | never touch `.FormuLab/runs.db` directly | none | Settings |
| Known limitations | — | none | — | disclose every real gap from the coverage matrix, never soften one | none | all chapters |

## Screenshot strategy
- **Dedicated fixture**: one deterministic demo project (synthetic name,
  `DEMO-`-prefixed — matching Data Exchange's own `TEST-`-prefix
  convention for instantly-recognizable non-real data), seeded through
  real schemas, never hand-crafted JSON that could drift from what the
  app actually persists.
- **Safe environment**: an isolated, documentation-only app-data profile
  — never the real `%APPDATA%\com.formulab.app` (sidesteps the exact
  permission-classifier block hit renaming the real directory in Phase
  8 Session 8, by never attempting to touch the real one at all).
- **Naming convention**: `<module>-<page>-<state>-<theme>-<locale>.png`
  (e.g. `formulation-builder-empty-light-en.png`).
- **Annotation numbering**: sequential numbered circles matching the
  guide's own step numbering.
- **High-DPI**: capture at 2x.
- **Theme**: light for the printed/PDF guide (legibility); dark
  optional/secondary for the in-app Help Center only — not doubling
  every shot.
- **Locale**: English only for v1; guide text is localized via the
  existing i18n mechanism, screenshots carry a "shown in English" note.
  Full-locale screenshot sets are a future-phase item, disclosed
  honestly, not silently skipped.
- **Redaction**: never applicable if the fixture-profile discipline
  holds — real data is never in a captured frame.
- **Update detection**: a manifest (`screenshot id → source route →
  commit SHA last verified against`) checked by a test that fails if
  the referenced route's component file changed since that SHA — the
  same regression-guard pattern already used by
  `masterdata.rs`'s `collection_count_matches_the_fixed_array_length`
  test, applied to documentation instead of code.

## Proposed Phase 10 sessions

### Session 1 — Help content schemas, registry, and route mapping
- **Objective**: define the `HelpTopic` type, build `HELP_TOPICS`
  covering every real route, `topicForRoute()`, new `help.json` per
  locale (English complete, others stubbed to parity-pass). No UI.
- **Files allowed**: a new schema/registry module (exact location
  decided at session start after checking whether `packages/shared` or
  `apps/desktop/src/lib` fits better), `i18n/locales/*/help.json`,
  `i18n/config.ts` namespace registration.
- **Dependencies**: none.
- **Tests**: registry-completeness (every `router.tsx` path has a
  topic), schema validation, i18n parity.
- **Completion criteria**: 100% real-route coverage, zero fabricated
  content, parity green.
- **Out of scope**: any rendering.
- **Commit**: `feat(help): add help content schema, registry, and route mapping`

### Session 2 — Page Help panel and searchable Help Center
- **Objective**: slide-in Help panel (reuses `InspectorShell` pattern),
  full Help Center with `cmdk` search, reachable from a header button
  and the command palette.
- **Files allowed**: new `components/help/{HelpPanel,HelpCenter}.tsx` +
  tests, minimal `AppShell.tsx` wiring for the trigger button.
- **Dependencies**: Session 1.
- **Tests**: correct topic per route, search finds by title/keyword,
  keyboard/ARIA.
- **Completion criteria**: every module's real Help panel opens.
- **Out of scope**: field tooltips, tours.
- **Commit**: `feat(help): add page Help panel and searchable Help Center`

### Session 3 — Field help and disabled-action explanations
- **Objective**: `InfoTooltip` component; wire real "why is this
  disabled" text into the coverage matrix's flagged gated actions
  (Dossiers export, Approval buttons, Regulatory review, Claims
  review) — reusing existing authorization booleans, never new gate
  logic.
- **Files allowed**: new `components/help/InfoTooltip.tsx` + tests;
  targeted, additive edits to `DossierPanel.tsx`/`ApprovalPanel.tsx`/
  `RegulatoryPanel.tsx`/`ClaimsLabelsPanel.tsx` (disabled-reason text
  only, no logic changes).
- **Dependencies**: Sessions 1–2.
- **Tests**: tooltip render/dismiss/keyboard; each flagged disabled
  action shows its real, specific reason.
- **Completion criteria**: every `panel+fields` matrix row has a real
  tooltip; every flagged disabled action explains why.
- **Out of scope**: every field in the app — bounded to matrix-flagged
  rows only.
- **Commit**: `feat(help): add field tooltips and disabled-action explanations`

### Session 4 — Guided tours and onboarding
- **Objective**: minimal hand-built tour overlay; 3 real tours
  (Formulation, Design of Experiments, Dossiers); a first-launch
  onboarding prompt.
- **Files allowed**: new `components/help/{TourOverlay,tours/*}.tsx` +
  tests; one new `localStorage` key for "has seen onboarding" (new key
  only — no legacy migration needed, this is genuinely new state).
- **Dependencies**: Sessions 1–2.
- **Tests**: step advance/skip/dismiss, real stable target selectors,
  onboarding shows once.
- **Completion criteria**: 3 tours function end to end.
- **Out of scope**: tours for every module.
- **Commit**: `feat(help): add guided tours and first-launch onboarding`

### Session 5 — Documentation fixture data and screenshot capture system
- **Objective**: deterministic demo/fixture project + seed data
  (real schemas), an isolated documentation-build app-data profile,
  naming/manifest tooling, a first small validation batch of captures
  to prove the pipeline.
- **Files allowed**: new `scripts/dev/seed-demo-fixture.*`, a
  fixture-data file, `docs/PHASE10_SCREENSHOT_MANIFEST.json` (schema +
  first entries).
- **Dependencies**: informed by Sessions 1–4's topic/screenshot-id
  references, not blocked by them.
- **Tests**: seed script produces schema-valid records; manifest schema
  test.
- **Completion criteria**: documented, repeatable, safe procedure;
  proven zero risk to the real `%APPDATA%\com.formulab.app`.
- **Out of scope**: the full screenshot sweep (continues into Session
  6 as content work, not infrastructure work).
- **Commit**: `feat(docs): add documentation fixture data and screenshot capture system`

### Session 6 — Illustrated user guide content and PDF/DOCX generation
- **Objective**: extend/correct `USER_GUIDE.md` (add Reverse
  Formulation, Tools, Sessions, Settings, Administration/Materials;
  fix the two confirmed stale claims), embed screenshot references,
  build PDF/DOCX generation reusing `pdf-lib`/`docx`.
- **Files allowed**: `docs/USER_GUIDE.md`, new
  `lib/documentExports/{userGuidePdf,userGuideDocx}.ts` + tests, a
  "Download User Guide" entry in the Help Center.
- **Dependencies**: Sessions 1–5.
- **Tests**: PDF/DOCX render without exception, contain every chapter
  heading, content checked against the real coverage matrix (no
  fabricated claim).
- **Completion criteria**: full guide renders in-app and downloads as
  real PDF/DOCX.
- **Out of scope**: translating the full guide body into all 8
  locales — English first, disclosed as a future-phase item.
- **Commit**: `feat(docs): add illustrated user guide content and PDF/DOCX generation`

### Session 7 — Full coverage verification
- **Objective**: verify 100% route→topic coverage, every flagged
  tooltip/tour present, guide content re-checked against real HEAD
  (not just against Session 0's snapshot), full regression.
- **Files allowed**: fixes only for genuine defects found, same
  fix-policy as every other verification session in this project.
- **Dependencies**: Sessions 1–6.
- **Tests**: full regression (shared/desktop/Rust), i18n parity, a new
  automated "help coverage" test.
- **Completion criteria**: zero coverage gaps, zero red tests.
- **Out of scope**: new features.
- **Commit**: `fix(docs): resolve phase 10 verification defects` (only
  if a genuine defect is found; no commit otherwise).

### Session 8 — Closure, release build, and native verification
- **Objective**: full regression, release build, shortcut
  refresh-if-needed, live verification of the Help Center/tours/guide
  download in the real packaged app, close the Phase 10 handoff.
- **Files allowed**: `docs/handoffs/PHASE10_CURRENT.md` (closed-state
  rewrite), `docs/architecture/IMPLEMENTATION_STATUS.md` (new closed
  section, matching the Phase 8/9 closure pattern).
- **Dependencies**: Sessions 1–7.
- **Tests**: full regression, release build, native launch.
- **Completion criteria**: Phase 10 CLOSED.
- **Commit**: `chore(docs): close phase 10 user guide and help system`

## Exact next session
Phase 10 Session 1: Help Content Schemas, Registry, and Route Mapping.
