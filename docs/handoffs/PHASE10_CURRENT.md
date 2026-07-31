# Phase 10 — User Guide and In-App Help

## Status: Session 5 (documentation fixture data and screenshot capture system) complete.

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

## Session 1 summary — help schemas, registry, and route mapping (complete)
- **Files**: `apps/desktop/src/lib/help/{types,glossary,registry}.ts` +
  `registry.test.ts`; `i18n/locales/*/help.json` (8 locales);
  `i18n/index.ts` (namespace wiring); `i18n/index.test.ts` (namespace
  count assertion updated).
- **Architecture built as planned**: one central `HELP_TOPICS: HelpTopic[]`
  registry, no second route registry — `topicForRoute(pathname)` uses
  react-router's own `matchPath` in two passes (exact-mode first, then
  `mode: "prefix"` as parent-topic fallback for `/settings/:section` and
  `/live/:sessionId`). `HELP_SCHEMA_VERSION = "1.0"`.
- **Topic count**: 22 topics, covering every sidebar module/child route
  plus the two real link-only routes (`optimizer`, `materials`,
  `linkOnly: true`). `sessions` topic covers both `/live` (prefix) and
  `/example/:sessionId` (exact).
- **Route coverage**: every real `router.tsx` leaf route resolves to a
  topic or a documented `HELP_EXCLUSIONS` entry (`/` redirect, `/formulas`
  redirect, `/formulas/legacy` retained-legacy page, `*` 404 catch-all) —
  verified by `registry.test.ts` walking the actual `routes` export, not
  a hand-copied list.
- **Glossary**: 18 terms (`GLOSSARY_TERMS`), referenced from topics via
  `glossaryTermIds`, definitions in `help.json`'s `glossary` key.
- **Locale strategy**: full genuine translation for all 8 shipped locales
  (en/zh-Hans/ja/es/de/fr/ko/tr) — no English-fallback markers used (none
  found as an existing convention in this codebase). `keywords` is the one
  field kept English-only/non-i18n by design (search-aid tags, not
  user-facing prose) — documented in `types.ts`.
- **Tests**: `registry.test.ts` — 35 tests (schema version validity, no
  duplicate topic ids, no duplicate exact-route bindings, related/glossary
  reference resolution, screenshot naming convention, per-route
  resolution incl. prefix/parent fallback, full `router.tsx` coverage
  cross-check, exclusion-list sanity). Plus existing `parity.test.ts`
  (i18n key parity, now covering the `help` namespace across all 8
  locales) and `index.test.ts` (namespace count = 9). Full desktop suite
  re-run (i18n/index.ts is shared infra): 96 files / 773 tests, all green.
- **Exclusions**: 4 routes (`/`, `/formulas`, `/formulas/legacy`, `*`),
  each with a documented reason in `HELP_EXCLUSIONS`.
- **Out of scope this session (unchanged from plan)**: Help panel, Help
  Center, tooltips, tours, screenshots, guide exports — all deferred.

## Session 1A summary — configurable laboratory test standards and methods (complete)

Inserted scope-expansion session — does not renumber or replace the
completed Session 1 (help registry) above.

- **Before-state finding**: standards were free text only. A
  `TestDefinition.methodReference` (schemas/testDefinitions.ts) accepts an
  arbitrary string ("in-house SOP-014", "ISO 4316") with no edition,
  revision, active/superseded status, or per-test primary/alternative
  concept — and the seed catalog (`catalog/testDefinitions.ts`, 27
  templates) sets it on **zero** of them (`grep -c methodReference` = 0).
  No structured standard/method entity, no historical method snapshot on
  `TestResult`, existed before this session.
- **New domain model**: `LaboratoryStandard` + `LaboratoryTestMethod`
  (`packages/shared/src/schemas/laboratoryStandards.ts`), row-keyed by
  `id` with a separate `standardCode`/human field — the same
  `dossierCode`-not-`code` convention `RegulatoryDossier` already uses, so
  multiple editions of one standard code can coexist as distinct rows. An
  "internal method" is simply a method linked to a standard with
  `status: "internal"` — no second entity. Two new master-data
  collections (`laboratory_standards`, `laboratory_test_methods`,
  `apps/desktop/src-tauri/src/masterdata.rs`, allow-list now 90 entries).
- **Per-test assignment**: `engine/laboratoryStandards.ts`'s
  `assignMethodToTest` only ever touches rows sharing the target's own
  `testDefinitionCode`; promoting one to primary demotes that same test's
  previous primary, other tests are provably untouched (object-identity
  asserted in tests). `assertNoDuplicateAssignment` blocks a duplicate
  (test, standard) pair. `assertSupersededAcknowledged` blocks selecting a
  superseded standard without explicit acknowledgement.
- **Historical traceability**: `TestResult.methodSnapshot` (new, optional,
  additive field on the existing append-only `test_results` collection) —
  built once via `buildTestMethodSnapshot`, never recomputed; a later edit
  to the standard/method cannot change an already-recorded result.
- **Authorization**: reuses the existing `Actor`/`ApprovalRole` model —
  `LABORATORY_METHOD_MANAGER_ROLES` (chemist/quality/administrator) gate
  assigning/activating/superseding, mirroring `pilot_approved`'s own
  authority set; any human may view and may create/edit a `draft` method
  (`requireHumanActor`, reused from `regulatoryAuthorization.ts`) — no
  second role system.
- **UI**: `TestDefinitionsPanel.tsx` gained a per-row **Method** button
  opening `TestMethodDrawer.tsx` — a scoped side drawer (not a new route,
  not a second inspector) showing primary/alternative badges, edition/
  revision, active/superseded/internal status, a superseded-acknowledgement
  checkbox, an internal-method creation form, and the full 18-section
  method surface (structured fields, honest "not yet documented" empty
  states) plus a persistent copyright/licensing notice.
- **Migration**: `findLegacyMethodReferences` reports every non-empty
  `methodReference` as an unresolved legacy reference — **never**
  auto-converted into a `LaboratoryStandard` (no edition/org guessing).
  Idempotent; a human resolves each entry manually.
- **Help integration**: extended the existing `laboratory` help topic
  (Session 1's registry) — a new quick-start step, a new "Test Standards
  and Methods" section, a warning, a known limitation — plus one new
  glossary term (`testMethodSnapshot`). No second help system; full
  8-locale parity maintained.
- **Tests**: `engine/laboratoryStandards.test.ts` (25),
  `schemas/laboratoryStandards.test.ts` (12),
  `catalog/laboratoryStandards.test.ts` (4),
  `components/laboratory/TestMethodDrawer.test.tsx` (11),
  `components/formula/TestDefinitionsPanel.test.tsx` (2) — all new, all
  passing. Rust `masterdata.rs`: 90-collection regression guard +
  dedicated allow-list test, 13/13 passing. Full shared suite 1240/1240;
  full desktop suite 786/786 (98 files); i18n parity unaffected (no
  namespace change, `help`/`session` namespace content extended in
  place). Desktop typecheck/lint clean.
- **Limitations**: no bulk/import path for standards/methods yet (manual
  entry and the small internal demo fixtures only); no dedicated
  standalone route (drawer only, deliberately, per scope); the Method
  drawer's "acting role" control is a manual role-select, matching every
  other approval-style panel in this app (no login/session-identity
  system exists to infer it automatically).

## Session 2 summary — page Help panel and searchable Help Center (complete)

- **Files**: `apps/desktop/src/lib/help/store.ts` (new, ephemeral zustand
  store); `components/help/{HelpButton,HelpPanel,HelpCenter}.tsx` (new) +
  their `.test.tsx`; `components/command-palette/CommandPalette.tsx`
  (added a "Search help" action, reusing the existing palette rather than
  a second entry point); `app/layout/AppShell.tsx` (mounts the three new
  components globally, same placement as `CommandPalette`/`Toaster`);
  `i18n/resources.d.ts` (fixed — Session 1 added the `help` namespace to
  `NAMESPACES` but never added it to the strict i18next `CustomTypeOptions`
  resource map, so `useTranslation("help")` failed to typecheck; this
  session's `HelpPanel`/`HelpCenter` are the first components to call it
  directly, which is what surfaced the gap); `i18n/locales/*/{help,nav}.json`
  (8 locales — new `help:ui.*` UI strings, `nav:commandPalette.actions.searchHelp`).
- **Architecture**: `topicForRoute()`/`HELP_TOPICS`/`GLOSSARY_TERMS` reused
  unmodified — no second route registry, no hardcoded page-name switch.
  `HelpButton` renders nothing on a route with no resolved topic (an
  `HELP_EXCLUSIONS` entry or a genuine gap) rather than a dead link.
  `HelpPanel` handles both a topic view and a glossary-term view in one
  state model (`useHelpStore`'s `target: {kind:"topic"|"glossary", id}`)
  instead of a second panel, satisfying "one coordinated shell" — this
  app has no competing page-level inspector outside the `/live` session
  workspace's own `InspectorShell`, which `HelpPanel` never touches or
  stacks with (it is a modal overlay drawer, not a persistent pane).
- **Help Center**: reuses `cmdk` exactly as `CommandPalette.tsx` already
  does (`Command`/`Command.Input`/`Command.List`/`Command.Item`/
  `Command.Empty`) — no second search framework. Searches localized
  title/summary/module/keywords/quick-start text (topics) and localized
  term/definition (glossary), grouped into two `Command.Group`s.
  Selecting a result opens `HelpPanel` in place — reading help never
  requires leaving the current route. Reachable via `Ctrl/Cmd+/` (checked
  against every existing shortcut — `Ctrl/Cmd+B`, `Ctrl/Cmd+K`, `Esc`,
  `Ctrl/Cmd(+Shift)+Enter` — no conflict) and via a new "Search help"
  command-palette action.
- **Focus discipline**: a real bug was caught and fixed during this
  session — capturing `document.activeElement` in a `useEffect` keyed on
  `centerOpen` recorded cmdk's own auto-focused search input, not the
  real opener, because `autoFocus` fires during commit, before any effect
  runs. Fixed by capturing the opener synchronously at the trigger site
  (`useHelpStore`'s `openCenter()`/`toggleCenter()`), not in a post-render
  effect. A dedicated regression test (`HelpCenter.test.tsx`'s "restores
  focus to the previously focused element on close") guards this.
- **Laboratory integration**: `HelpPanel`'s topic content renders the
  `laboratory` topic's Session-1A-extended sections (including "Test
  Standards and Methods") automatically — no duplicate content, no
  second registry entry; verified by a dedicated test opening Help from
  `/laboratory`.
- **State**: one small dedicated `useHelpStore` (zustand, same pattern as
  `useUiStore`/`useUpdateStore` — not a shared mega-store). Nothing
  persisted; search text and open/active state are ephemeral by design.
- **Tests**: `HelpPanel.test.tsx` (9: route coverage, exact/nested-fallback
  resolution, Laboratory integration, close/Escape/focus-restore,
  related-topic and glossary navigation) + `HelpCenter.test.tsx` (12:
  open/close/shortcut-non-conflict, title/keyword/glossary search,
  link-only-topic searchability, empty/no-results/clear states, result
  selection without navigation, focus restoration) — 21 new tests, all
  passing. Existing `registry.test.ts` (35), `parity.test.ts` (15),
  `CommandPalette.test.tsx`, `Sidebar.test.tsx` all re-verified green.
  Full desktop suite: 807/807 across 100 files (run in full — global
  shell infrastructure). Desktop typecheck/lint clean. Shared and Rust
  suites unaffected (no files in `packages/shared`/`src-tauri` changed
  this session) — not re-run.
- **Out of scope this session (unchanged from plan)**: field-level
  tooltips, guided tours — deferred to Session 3.

## Out-of-band corrective fix — candidate version isolation and function totals

Not a Phase 10 session — an unrelated production bug fix, done between
Session 2 and Session 3, in `apps/desktop/src/components/thread/
FormulationWorkspaceV2.tsx` and `packages/shared/src/engine/formula.ts`.
Does not touch the help/registry/Laboratory-standards work above; recorded
here per instruction, without renumbering any Phase 10 session.

- **Defect 1 root cause**: `CardsView` (inside `FormulationWorkspaceV2.tsx`)
  held ONE shared `draft`/`batchKg` state for every generated candidate,
  seeded only once (`draft.length === 0`) the first time any "Edit
  formula" tab was opened. Selecting a different V1/V2/V3 tab never
  reseeded it, so the Edit view kept showing whichever candidate was
  edited first, regardless of the active tab.
- **Fix**: `draftsByVersion`/`batchKgByVersion`, both `Record<string,
  ...>` keyed by the candidate's own stable `version` id ("v1"/"v2"/
  "v3"), seeded on first presence-check (`draftsByVersion[card.version]
  === undefined`) per candidate. `linesFromGeneratedFormula` already
  built fresh objects per call and never mutated its input, so keying
  correctly was the entire fix — no change to how a draft is built.
  Version tabs are now a real ARIA `tablist`/`tab` pattern (`aria-
  selected`, roving `tabIndex`, arrow-key navigation) with a per-tab
  unsaved-edit indicator (reusing the existing amber-violation-dot
  convention, a second accent-colored dot).
- **Defect 2 root cause**: `functionalSummary()` (`packages/shared/src/
  engine/formula.ts`) already computed `rawPercent` (the correct,
  formula-percentage-based group total) correctly — the bug was that
  `FormulaBuilder.tsx`'s badge rendered `activePercent` (active-matter-
  derived, always 0 when no member declares active matter) as the
  primary figure instead. "Incomplete" was genuinely about missing
  active-matter data, but read as "this number is wrong."
- **Fix**: the badge now shows `rawPercent` as the primary figure, with
  `activePercent` appended only when non-zero ("(active X%)"), and the
  incomplete-active-matter warning's wording corrected so it can no
  longer be read as applying to the formula percentage. Added
  `unclassifiedFormulaPercent()` (a separate, non-invented figure for
  lines with no function assigned) and a `malformedPercentLineIds` field
  on `FunctionalGroupSummary`.
- **A more severe latent defect found while testing defect 2**: a
  malformed (non-empty, unparseable) `percent` string didn't just make
  the function summary wrong — `computeTotals()`/`resolvedPercent()`
  called `dec()` directly and unguarded, so a single bad cell crashed
  the ENTIRE `FormulaBuilder` render (an uncaught `DecimalError`), not
  just its function-summary badges. Fixed by having `computeTotals`,
  `resolvedPercent`, and `validateFormula`'s negative-percent check use
  `tryDec(...) ?? new Decimal(0)` instead of throwing `dec(...)` — a
  malformed cell now contributes 0 to every aggregate and is reported in
  `malformedPercentLineIds`, rather than taking the page down. An empty
  string is still treated as 0 (matching `dec()`'s existing convention,
  distinct from "malformed").
- **q.s. handling**: unchanged and re-verified by test — `resolvedPercent`
  already resolved a q.s. line's percentage exactly once (the remainder
  to 100%, split evenly across multiple q.s. lines) before this fix, and
  both `computeTotals` and `functionalSummary` still read that same
  resolved value once.
- **Tests**: `FormulationWorkspaceV2.test.tsx` (9, new) — candidate
  fixture isolation, per-tab loading, cross-candidate edit isolation,
  survive-tab-switch, Card/Edit switch preserves version, no mutation of
  the original `card.formula`, keyboard tab navigation, unsaved
  indicator. `formula.test.ts` (12 new, in the existing "functional
  groups" area) — rawPercent-is-primary, incomplete-without-zero,
  multi-material summing, unclassified reporting, malformed-percent
  exclusion-not-crash, empty-vs-malformed distinction, q.s.-resolved-once.
  `FormulaBuilder.test.tsx` (9, new) — screenshot-value regression,
  incomplete wording, unclassified chip, active-contribution display,
  recalculation after percent/function edits and after switching to a
  different candidate's lines, malformed-percent non-crash, q.s. no-
  double-count. Full shared suite 1248/1248; full desktop suite
  825/825 across 102 files; desktop typecheck/lint clean; i18n parity
  15/15 (new `builder.*` keys added across all 8 locales — group-badge
  wording, unclassified/malformed labels, candidate-tab labels). Rust
  untouched, not re-run.
- **Limitations**: no "save this candidate as a project version" action
  exists in this exact workspace view (confirmed pre-existing — `onSave`
  was already never passed to `FormulaBuilder` here), so "saving one
  version does not save another" is satisfied by construction (isolated
  drafts) rather than by a dedicated save-path test; not invented, since
  it was not part of either reported defect. `validateFormula`'s other
  checks were not individually audited for the same malformed-percent
  class of bug beyond the negative-percent check that was actually
  reached by the crash test.

## Session 3 summary — contextual field help and disabled-action explanations (complete)

- **New reusable components**: `components/help/InfoTooltip.tsx` (a
  small "i" trigger — hover/focus open, Escape close, localized
  title/body, optional "Learn more" into an existing `HELP_TOPICS`
  entry) and `components/help/DisabledActionButton.tsx` (a real
  `<button disabled>` plus an always-visible structured explanation:
  message, required role, prerequisite, resolvable/not, "Learn more").
  `lib/help/disabledReason.ts` defines the shared `DisabledReason` shape
  (`code`/`messageKey`/`messageValues`/`requiredRole`/`prerequisite`/
  `relatedTopicId`/`resolvable`) every module builds directly from its
  own existing guard — no new permission engine, no invented reasons.
- **InfoTooltip built on `@radix-ui/react-popover`** (already a repo
  dependency, already used by `FigureBlock.tsx`), not
  `@radix-ui/react-tooltip`: a true ARIA tooltip must not contain
  interactive content, and the optional "Learn more" button is
  interactive.
- **Two real bugs caught and fixed while testing `InfoTooltip`**: (1)
  an `onClick={() => setOpen((o) => !o)}` toggle handler fought with
  Radix's own composed click-to-toggle on `Popover.Trigger`, and with
  hover-then-click's synthesized sequence in tests — removed in favor
  of Radix's own default click behavior. (2) Radix's
  `Popover.Content` returns focus to the trigger on close by default;
  since the trigger opens `onFocus`, that created an infinite
  close-then-reopen loop (every close refocused the trigger, which
  reopened it) — fixed with `onCloseAutoFocus={(e) => e.preventDefault()}`.
  Both would have made the tooltip effectively un-closeable in the real
  app, not just in tests.
- **A third real bug caught while wiring `ApprovalPanel`**: an early
  `approveDisabledReason` reused `allBlockers[0]?.message` verbatim as
  `prerequisite`, duplicating the exact same blocker text already shown
  in the readiness summary above the button — removed; the explanation
  states the blocker *count* only, since the full list is already
  visible.
- **Coverage — InfoTooltip** (contextual field help): Formulation
  (Total/q.s. badge, approval-state heading, cost-snapshot heading),
  Laboratory (`TestMethodDrawer`: primary-vs-alternative, standard
  status, historical snapshots), Design of Experiments (responses
  heading, factors-and-levels wizard step), Stability (conditions,
  time points).
- **Coverage — DisabledActionButton** (disabled-action explanations,
  each built from the exact pre-existing guard the plain `disabled`
  prop already used): Laboratory method assignment/promotion
  (`isAuthorizedLaboratoryMethodActor` + `assertSupersededAcknowledged`),
  Approval's Approve button (`effectiveReady`/`canApprove`/
  `APPROVAL_AUTHORITY`), Dossier PDF/DOCX export
  (`canActRegulatory`/`AUTHORIZED_REGULATORY_ROLES` — changed from
  hide-when-unauthorized to shown-disabled-and-explained, a deliberate,
  documented behavior change consistent with this session's whole
  purpose), Data Exchange import commit (`canCommit`'s own
  supported/preview/committable/error-row conditions), Formulation's
  cost-snapshot save (`saving`/`versionId`).
- **Accessibility**: `DisabledActionButton` wires `aria-describedby`
  from the button to its own explanation (`role="note"`), and the
  native `disabled` attribute — not a styled-to-look-disabled enabled
  control — blocks click/keyboard/programmatic activation with no
  residual `onClick` path when a reason is present.
- **i18n**: new `help:ui.*` keys (learnMore/requiredRole/
  prerequisiteLabel/resolvableYes/resolvableNo) plus module-specific
  `*.reasons.*`/`*.InfoTitle`/`*.InfoBody` keys across
  `approval`/`dossier`/`dataExchange`/`cost`/`doe`/`stability`/
  `tests.method` sections of `session.json`, full genuine translation
  across all 8 locales. A real gap was caught here too:
  `DisabledActionButton`'s fixed UI chrome strings (`ui.requiredRole`
  etc.) always live in the `help` namespace, but `useTranslation` with
  an array of namespaces only searches the *first* one for an
  unprefixed key — it does not fall back through the array. Fixed with
  an explicit `help:` prefix (`tHelp`) for those four/five fixed
  strings, independent of whichever `ns` a caller passes for its own
  `reason.messageKey`.
- **Tests**: `InfoTooltip.test.tsx` (10), `DisabledActionButton.test.tsx`
  (9) — both new. Plus one new targeted test each in
  `ApprovalPanel.test.tsx`, `DossierPanel.test.tsx`,
  `DataExchangeImportDialog.test.tsx` (a new "validation blocker"
  describe block), and three new tests in `TestMethodDrawer.test.tsx`
  covering the InfoTooltips. Two pre-existing `DossierPanel.test.tsx`/
  `TestMethodDrawer.test.tsx` tests were updated (not deleted) to match
  the deliberate hide-to-disabled-and-explained behavior change.
  Full desktop suite re-run (shared UI components, multiple workflows
  changed): 850/850 across 104 files. Desktop typecheck/lint clean.
  i18n parity 18/18. Shared and Rust untouched this session — not
  re-run.
- **Out of scope this session (unchanged from plan)**: guided tours —
  deferred to Session 4. Regulatory-panel-specific disabled-action
  coverage was not added as a separate item beyond what Approval's own
  readiness reason and Dossier's export reason already surface (both
  already fold in `regulatoryAssessment`/`AUTHORIZED_REGULATORY_ROLES`).

## Session 4 summary — guided tours and onboarding (complete)

- **New files**: `lib/help/tours.ts` (the `TOURS` registry — metadata only,
  same discipline as `HELP_TOPICS`), `lib/help/tourStore.ts` (ephemeral
  zustand store: `activeTourId`/`stepIndex`/`openerElement`,
  `startTour`/`next`/`back`/`skip`/`finish`/`goToStep`),
  `lib/help/onboardingStore.ts` (persisted `formulab.onboarding.dismissed.v1`
  flag), `components/help/TourOverlay.tsx` (the single global spotlight
  overlay), `components/help/OnboardingPrompt.tsx` (the first-use card) —
  each with a `.test.ts`/`.test.tsx` file.
- **No new dependency**: a hand-built spotlight overlay (a
  `box-shadow: 0 0 0 9999px` cutout around the target's
  `getBoundingClientRect()`), exactly as the Session 1 architecture plan
  proposed — Radix's own popover/dialog primitives don't fit a
  "highlight a rect anywhere on the page" pattern, and no dedicated tour
  library was already a dependency.
- **Three tours, real targets only**: every step's `target` is a
  `data-tour="<id>"` attribute added to a real, already-existing element —
  never an invented selector. `TourOverlay` resolves it via
  `document.querySelector`, polling on a short interval and auto-advancing
  if it never appears within `TARGET_WAIT_TIMEOUT_MS` (800ms) — this isn't
  a hypothetical: `DoePanel`'s "design"/"responses"/"runs"/"analysis"
  sections and `DossierPanel`'s per-dossier detail sections both only
  render once a study/dossier is selected, and `FormulationWorkspaceV2`'s
  candidate-tabs/Card-Edit-tabs targets don't exist until a generation
  produces cards — real, everyday "not rendered yet" cases, not contrived
  ones. `TOURS.dossiers`' final step (`notApproval`) deliberately has no
  `target` at all — an informational step, never a fallback for a target
  that should exist but doesn't.
- **Formulation tour lives on `/live`, not `/formulation`**: the described
  tour content (target product, category/market, Generate, V1/V2/V3,
  Card/Edit, function totals, warnings) is the session/thread composer
  (`FormulationStudio` + `FormulationWorkspaceV2`'s `CardsView`) at `/live`
  — the version-management workspace at `/formulation` doesn't contain any
  of it. `Tour.route` records this; `TourOverlay`'s own effect navigates
  there if "Start tour" was triggered from elsewhere (Help on `/formulation`,
  or the onboarding prompt from any route). Documented in `registry.ts`
  next to the `formulation` topic's `tourId`.
- **DoE/Dossiers tours target the real, always-rendered tab bars**
  (`doe.tab.<section>` / `dossiers.tab.<section>`) rather than deep wizard-
  modal fields — those tab buttons exist unconditionally the moment the
  panel mounts, regardless of whether a study/dossier is selected yet, so
  the tour never depends on the overlay driving multi-step form
  interactions on the user's behalf (out of scope — a tour explains, it
  doesn't operate the app for you).
- **Onboarding**: `OnboardingPrompt` — a small dismissible, non-modal card
  (mounted globally in `AppShell`, same placement as `HelpButton`),
  offering one button per real tour plus "Maybe later"/close. Shows once
  per local profile via `formulab.onboarding.dismissed.v1` (new key only —
  genuinely new state, nothing to migrate, per the Session 1 plan). Picking
  a tour or dismissing both count as "seen."
- **Restart from Help**: `HELP_TOPICS`' pre-existing (Session 1) `tourId?`
  field is now populated on the `formulation`/`doe`/`dossiers` topics;
  `HelpPanel`'s topic view renders a "Start tour" button whenever it's set,
  calling the same `useTourStore.startTour` the onboarding prompt uses —
  one entry point, not two.
- **Accessibility**: the tour card is `role="dialog"` with `aria-label`
  (the step title) and `aria-describedby` (the step body); Next/Back/
  Skip/Finish are real `<button>`s; Escape closes (calls the same `skip`
  the Skip button does) and returns focus to whatever was focused when the
  tour started (`openerElement`, captured synchronously at the `startTour`
  call site — the same discipline `useHelpStore.openCenter` already
  established, for the same reason: capturing focus inside a `useEffect`
  risks recording focus the overlay itself already moved).
- **Never touches project data**: `TourOverlay`/`OnboardingPrompt` read
  only the DOM (`querySelector`, `getBoundingClientRect`) and their own
  ephemeral/localStorage state — neither imports `lib/masterdata` at all;
  guarded by a dedicated test asserting zero calls across a full tour walk.
- **Test-environment fix (not a regression)**: `OnboardingPrompt` being
  globally mounted meant a genuinely first-use profile would render a
  second `role="dialog"` on every `renderAt()`-based test across the whole
  suite, colliding with unrelated `role="dialog"` queries. Fixed by
  defaulting `formulab.onboarding.dismissed.v1` to `"1"` in
  `src/test/setup.ts` (the two files that specifically test onboarding
  clear `localStorage` themselves first, so the real first-use case is
  still genuinely exercised).
- **New, harmless unhandled-rejection artifact**: `TourOverlay`'s
  navigate-to-the-tour's-route effect, when exercised through a real
  `RouterProvider`/`createMemoryRouter` test (`HelpPanel.test.tsx`'s
  "Start tour" tests), trips a pre-existing Node/jsdom/undici
  cross-realm `AbortSignal` incompatibility inside React Router's own
  data-router internals (`TypeError: RequestInit: Expected signal ... to
  be an instance of AbortSignal`) — confirmed test-environment-only (a
  real single-realm browser/webview never hits this), does not fail any
  assertion, and joins the same pre-existing "not-desktop" class of
  logged-but-harmless async noise this suite already carries (was 4
  instances, is now 5 files' worth including this one). Not chased further
  — out of scope for this session and orthogonal to tour/onboarding logic.
- **Tests**: `tours.test.ts` (9), `tourStore.test.ts` (7),
  `onboardingStore.test.ts` (4), `TourOverlay.test.tsx` (13),
  `OnboardingPrompt.test.tsx` (6), plus 2 new tests in `HelpPanel.test.tsx`
  ("Start tour" launches the right tour; a topic with no tour offers no
  button) and target-resolution tests added to `DoePanel.test.tsx` (1),
  `DossierPanel.test.tsx` (1), `FormulationWorkspaceV2.test.tsx` (3), and
  a new `FormulationStudio.test.tsx` (2) — 48 new tests total. Full desktop
  suite: 898/898 across 110 files. Desktop typecheck/lint clean. i18n
  parity 18/18 (new `help:ui.tour*`/`help:ui.onboarding.*`/`help:tours.*`
  keys, full genuine translation across all 8 locales). Shared and Rust
  untouched this session — not re-run.
- **Out of scope this session (unchanged from plan)**: tours for any
  module beyond Formulation/DoE/Dossiers — deferred indefinitely, not
  planned for a future session per the original Session 1 scoping.

## Session 5 summary — documentation fixture data and screenshot capture system (complete)

- **New files**: `apps/desktop/src/lib/docsFixture/{build,fixtureWriter,
  screenshotManifest}.ts` + a `.test.ts` per file; `scripts/dev/
  seed-docs-fixture.ts` (CLI entry point, run via `pnpm docs:fixture:seed` /
  `pnpm docs:fixture:reset`); `docs/PHASE10_SCREENSHOT_MANIFEST.json` (26
  entries). No final guide chapters written this session, per the objective.
- **Fixture architecture**: `build.ts` is a pure, deterministic function
  (`buildDocsFixturePlan()`) — no `Date.now()`, no `Math.random()`, a single
  fixed `2026-01-01T00:00:00.000Z` timestamp throughout — that returns a
  flat `relative path -> content` map mirroring exactly what
  `masterdata.rs`/`formulation_v2.rs` already read: one JSON array per
  `data/master/<collection>.json`, one `data/formulations/<id>/` folder
  (formulation.json/versions/approvals/audit.jsonl), one
  `data/sessions/<id>/` folder (brief.json + 3 candidate markdown cards).
  Every record is built as a literal and validated with `.parse()` against
  the REAL Zod schema from `@formulab/shared` — a schema mismatch fails the
  build immediately, not silently. Real catalog values are reused, never
  invented (`HC-SHAMPOO-REG` from `catalog/kenya.ts`, `raw_materials` from
  `dataExchangeRegistry.ts`'s real template list). Every id/code/name this
  fixture mints carries a `DEMO-` prefix — the same synthetic-data
  discipline Data Exchange's own `TEST-`-prefixed fixture rows already use.
- **Why not copy the dev checkout's own `data/`/`formulas/`**: this repo
  checkout IS the developer's real, live FormuLab project (confirmed:
  `data/`/`formulas/` are gitignored "generated workspace data", and
  `.FormuLab/runs.db` is real, tracked, never-touch state) — the fixture is
  built from scratch against the real schemas, never derived from or
  copying that real data.
- **Fixture writer + safety guards** (`fixtureWriter.ts`): `assertSafeFixtureRoot`
  fails closed on a relative path, a path containing `com.formulab.app` or
  `Documents/FormuLab` (the real profile locations), or a folder whose own
  name doesn't contain `docs-fixture` — a typo'd path can never silently
  target something real. A marker file
  (`.formulab-docs-fixture-profile`) is written into the root once seeded;
  `seedDocsFixture`/`resetDocsFixture` both refuse an existing, non-empty
  directory that lacks it — "fail closed if the isolated profile is not
  active" is enforced structurally, not just documented. `resetDocsFixture`
  requires the marker to already exist (never adopts an arbitrary folder),
  fully wipes the directory, then reseeds — idempotent by construction
  since `buildDocsFixturePlan()` is deterministic.
- **Default location**: `.docs-fixture/` at the repo root (new `.gitignore`
  entry) — sibling to, never inside, the real `data`/`formulas`/`.FormuLab`.
  Never depends on or touches `%APPDATA%\com.formulab.app`; pointing the
  real app's `formulab-root.txt` override at it (to actually browse it in
  the app) is a manual, human, opt-in step this tooling never performs
  itself.
- **Screenshot manifest** (`screenshotManifest.ts` + `docs/
  PHASE10_SCREENSHOT_MANIFEST.json`): 26 entries covering every module the
  session objective listed (Home, Projects, Formulation
  generation/candidate-tabs/edit-formula/function-totals-warning,
  Laboratory test methods, Stability, Regulatory, Dossiers, Claims &
  Labels, Approval, Reports, Data Exchange, Administration, Notebooks,
  Files, Runs, Sessions, Settings, Help panel/Center/InfoTooltip/
  disabled-action/guided-tour/onboarding). Filename convention
  `<module>-<page>-<state>-<theme>-<locale>.png` is never hand-typed twice:
  each entry's `id` is asserted equal to `screenshotIdFor(entry)`,
  reconstructed purely from its own `module`/`page`/`state`/`theme`/
  `locale` fields — drift between the id and its components is a test
  failure, not a manual-review concern. Every `route` is cross-checked
  against the real `topicForRoute()`; every non-null `helpTopic` against
  the real `HELP_TOPICS` registry — never a second, hand-copied list. The
  Formulation tour's manifest entry deliberately sets `helpTopic:
  "formulation"` while `route: "/live"` — the same intentional route/topic
  split `lib/help/tours.ts` documents for that tour. Every entry ships
  `lastCapturedCommit: null` — no image has actually been captured yet;
  that sweep is Session 6+ content work, not this session's.
- **Capture workflow (documented, not executed this session)**: light
  theme, English locale, 1440x900 at 2x DPR, uniformly, for every v1 entry
  — enforced by a manifest-shape test, not just written down. High-DPI +
  deterministic window size + numbered-callout overlays are the stated
  requirements for Session 6's actual capture pass; this session ships the
  manifest schema and naming convention those captures must follow, plus
  `detectStaleOrMissing`/`detectOrphanScreenshots` (pure functions, tested
  against a synthetic file list — no real captured PNGs exist yet to test
  against) so a later capture run can tell "missing" from "stale" from
  "orphaned" automatically once real files exist.
- **Tests**: `build.test.ts` (9 — determinism, content shape, DEMO- prefix,
  no forbidden real-data substrings), `fixtureWriter.test.ts` (13 — guard
  rejects real-looking paths, fail-closed on an unknown non-empty
  directory, idempotent reset, never touches anything outside its own
  root), `screenshotManifest.test.ts` (17 — id uniqueness, filename
  convention, id/component reconstruction, route/help-topic cross-checks
  against the real app, required-module coverage, dimension/theme/locale
  validity, stale/missing/orphan detection). 39 new tests total. Full
  desktop suite re-run (new module, cross-checks against real
  `lib/help/registry.ts`): 937/937 across 113 files. Desktop typecheck/lint
  clean. Shared and Rust untouched this session (the fixture builder
  IMPORTS `@formulab/shared`'s existing schemas but adds nothing to that
  package) — not re-run.
- **New devDependency**: `tsx` (root `devDependencies`) — the only way to
  run a real `.ts` script against `@formulab/shared`'s TypeScript source
  without a build step, since neither `ts-node` nor a compiled `dist/`
  existed in this repo before this session.
- **Out of scope this session (unchanged from plan)**: the actual
  screenshot capture sweep (Session 6+), final `USER_GUIDE.md` chapter
  content, richer fixture rows beyond one-or-two per collection (enough to
  render each required screen non-empty, not an exhaustive dataset),
  non-English locale screenshots (v1 is English-only by design), dark-theme
  captures (light is primary per plan; dark is optional/secondary future
  work for the in-app Help Center only).

## Exact next session
Phase 10 Session 6: Illustrated User Guide Content and PDF/DOCX Generation.
