# Phase 9 — the previous project identity → FormuLab Naming Migration Log

## Session 0: Naming Migration Assessment

### Objective
Map every remaining user-visible and technical `the previous project identity` identifier
and produce a safe, bounded migration plan to FormuLab. Assessment and
planning only — no renames performed.

### Headline finding
Most user-facing branding is already done: `tauri.conf.json`'s
`productName` ("FormuLab") and `identifier` (`com.formulab.app`) are
already correct, installers already ship FormuLab-branded, the window
title is already "FormuLab", and `%APPDATA%\com.formulab.app` is
already the real in-use app-data directory (19,677+ files of genuine
project history) — nothing to orphan, no app-data migration needed.
What remains is internal/technical: the npm package scope (`@legacy/*`,
118 importing files), the Rust crate/binary name (`legacy-workbench` /
`legacy_workbench_lib`, which the shipped `.exe` is literally built from —
`legacy-workbench.exe` today), 8 persisted `localStorage` keys, and a
documentation cleanup — including `AGENTS.md`, which currently states a
factually **wrong** bundle identifier (`com.legacy.workbench`, when the
real one is `com.formulab.app`) and must be corrected regardless of
migration timing.

173 files match `the previous project identity` case-insensitive outside
`node_modules`/`target`/`dist`/`.git`.

### Method
Ran a background inventory fork in parallel with direct targeted greps
in the main session. The fork ran long (unscoped grep traversal); per
explicit user instruction, stopped waiting on it and completed the
inventory directly via targeted Grep/Bash searches across the 13
requested categories (package.json/workspace, npm imports, Rust crate/
binary, Tauri config, installer names, app-data identifier, env vars,
scripts/CI, docs, UI strings, test fixtures, persisted/schema
identifiers, external integrations). The fork's result notification
arrived after the doc was substantially complete and corroborated the
independent findings; folded in its 3 additional citations
(`CURRENT_STATE_AUDIT.md`'s already-accurate "Identity" note,
`IMPLEMENTATION_STATUS.md:979`'s prior deferred-item note,
`pnpm-lock.yaml`'s single generated `@legacy/shared` entry) rather than
duplicating the search.

### Classification summary (full detail in PHASE9_CURRENT.md)
1. User-visible, must change: LICENSE copyright, AGENTS.md's false
   bundle-identifier claim, Cargo.toml authors, lib.rs comment/panic
   string.
2. Internal, safe to change: 3 package.json names + 118 `@legacy/shared`
   imports, Cargo.toml package/lib names, main.rs call site, CI
   artifact-upload name, 14 Rust test-only temp-dir prefixes,
   README.md example commands.
3. Compatibility-sensitive, needs migration/alias: the Rust binary
   rename (`legacy-workbench.exe` → new name) breaks the existing
   `FormuLab.lnk` shortcut target and any out-of-repo user automation;
   8 `legacy.`-prefixed localStorage keys (theme/sidebar/zoom/locale/
   model-favorites) risk a one-time silent prefs reset for every
   existing user if renamed without a legacy-read fallback — a fallback
   pattern (`LEGACY_THEME_KEY`) already exists as precedent in this
   codebase.
4. Historical, must remain unchanged: all docs/handoffs/*.md, the
   external Phase-log .md files (this one included, append-only),
   TAURI_LIVE_VERIFICATION.md, APPROVAL_MANUAL_SMOKE_TEST.md, dated
   IMPLEMENTATION_STATUS.md closure paragraphs (incl. its own Phase 8
   section's real `legacy-workbench.exe` SHA-256, written this same
   session), CURRENT_STATE_AUDIT.md's currently-accurate Identity note,
   PRD.md/TECHNICAL_DESIGN.md (founding pre-rebrand specs — flagged as
   an open question, not force-rewritten).
5. Generated/external, must not be edited: the real third-party
   `legacy-research/legacy-skills` GitHub dependency (fetch script, env var,
   local dir name, CI step name, and the one UI string that correctly
   names it) — this is someone else's project name, not ours;
   pnpm-lock.yaml (regenerates via `pnpm install`).

### Proposed sessions (6, bounded)
1. Package/import namespace migration (`@legacy/*` → `@formulab/*`,
   118+ files, low risk, full regression not just focused — mechanical
   global rename)
2. Rust/Tauri/product/binary naming (Cargo.toml, main.rs, lib.rs,
   shortcut refresh, CI artifact name — highest risk, needs a real
   release build + relaunch verification)
3. Persisted-identifier (localStorage) migration — decide rename+
   fallback vs leave-as-is for the 8 `legacy.*` keys; no app-data
   directory migration needed (already correct)
4. Scripts, CI, docs, and tests (AGENTS.md fix, LICENSE, README
   examples, REQUIREMENTS.md, INFORMATION_ARCHITECTURE.md closure note;
   explicitly excludes the external legacy-skills dependency and the
   founding-spec docs)
5. Focused verification (full regression + final grep sweep)
6. Closure and release (full regression, release build, shortcut
   verification, closed-state docs)

### Safety rules confirmed satisfiable
No app-data directory orphaned (already `com.formulab.app`). No saved
project at risk (no schema field/id-prefix contains `the previous project identity`, confirmed
by direct inspection). Compatibility alias mechanisms identified for
both risk items (shortcut refresh; localStorage legacy-read fallback
pattern already precedented). Historical logs/hashes explicitly listed
as never-rewrite. `.FormuLab/runs.db` untouched this session.

### Documentation
Created `docs/handoffs/PHASE9_CURRENT.md`. Created this external log.

### Commit
docs(phase9): assess the previous project identity to FormuLab naming migration

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `6ed9835a407c36c604c59e2ea4cc7a9a017bb153`, matches `@{u}`.

### Exact next session
Phase 9 Session 1: Package/Import Namespace Migration.

## Session 1: Package and Import Namespace Migration

### Objective
Migrate only the npm workspace/package namespace from `@legacy/*` to
`@formulab/*`. No Rust, Tauri, executable, installer, or localStorage
changes.

### Renamed
`@legacy/shared` -> `@formulab/shared`, `@legacy/desktop` -> `@formulab/desktop`,
root workspace label `legacy-workbench` -> `formulab`.

### Files changed (125)
packages/shared/package.json, apps/desktop/package.json (name + the
@legacy/shared dependency entry), root package.json (name + 4 --filter
script lines), apps/desktop/tsconfig.json (path alias),
apps/desktop/vite.config.ts (resolve alias),
apps/desktop/src-tauri/tauri.conf.json (beforeDevCommand/
beforeBuildCommand workspace-filter strings only -- identifier/
productName untouched), scripts/windows/verify-formulab-phase1.ps1 (2
--filter example-command lines only -- its legacy-workbench.exe ExePath
default is Session 2 scope, left untouched), 118 first-party source
files under apps/desktop/src (117 .ts/.tsx importers + 1 CSS comment in
index.css). pnpm-lock.yaml regenerated via pnpm install, reverified via
pnpm install --frozen-lockfile -- never hand-edited.

### Verification
Zero first-party @legacy/ matches remain anywhere in the repo (confirmed
by repo-wide grep after the rename). Rust crate/binary names, Tauri
identifier/productName, installer names, localStorage keys, historical
docs, and the external legacy-research/legacy-skills dependency confirmed
untouched.

Shared: 1199/1199 tests, typecheck clean. Desktop: 687/688 tests (1
pre-existing failure, unrelated -- see below), typecheck clean, lint
clean. install --frozen-lockfile succeeded (lockfile consistent with
package.json changes). Rust tests and release build deliberately not
run, per scope.

### Pre-existing unrelated failure (not fixed, out of scope)
src/lib/download.test.ts's "shows an error toast and re-throws when the
save fails..." test fails with "Cannot read properties of undefined
(reading 'indexOf')". Confirmed via git stash (running the identical
test against the pre-Session-1 tree, unmodified) that this failure is
pre-existing and has nothing to do with the naming migration -- neither
download.ts, download.test.ts, the real tauri.ts, nor toast.ts (both
fully mocked in this test) were touched by this session. Left unfixed;
flagged for Session 5 (focused verification) or separate triage.

### Commit
feat(naming): migrate packages to FormuLab namespace

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `c374d5eeb85adbfa8d2048ce964622ddbd455023`, matches `@{u}`.

### Exact next session
Phase 9 Session 2: Rust, Tauri, Product, and Binary Naming.

## Session 2: Rust, Tauri, Product, and Binary Naming

### Objective
Migrate only the first-party Rust crate, binary, product, and
build-artifact names from legacy-workbench/legacy_workbench_lib to FormuLab
naming. Keep Tauri productName "FormuLab" and identifier
com.formulab.app exactly as-is; no app-data change.

### Renamed
Cargo.toml package: legacy-workbench -> formulab. Lib crate:
legacy_workbench_lib -> formulab_lib. authors: "the previous project identity
contributors" -> "FormuLab contributors". main.rs call site,
lib.rs header comment + .expect(...) panic string, tools.rs comment.
.github/workflows/build.yml artifact-upload name: legacy-workbench-${target}
-> formulab-${target}. scripts/windows/verify-formulab-phase1.ps1's
default -ExePath -> formulab.exe.

Confirmed unchanged: tauri.conf.json identifier (com.formulab.app) and
productName (FormuLab) -- no mainBinaryName override was ever needed,
Tauri derives formulab.exe directly from the renamed Cargo package.

### Release artifacts
- formulab.exe -- 21,893,120 B --
  sha256 81b0a236ffb5d16ae817abc5c1960a5d8aec9d2b7c3454105bd43dc5fd0999e9
- FormuLab_0.4.0_x64_en-US.msi -- 36,540,416 B --
  sha256 1486f83bb328f354641f24ed41c442502fcaa1ad22e31bb1a50f6f0f00f08324
- FormuLab_0.4.0_x64-setup.exe (NSIS) -- 24,946,426 B --
  sha256 398d5f00831c33a63c43275d43ec90c12cff8d7d64a0784d8a2e1ae9140bcc95

### Shortcut
C:\Users\sekip\Desktop\FormuLab.lnk backed up to
FormuLab.lnk.bak-phase9session2 BEFORE any change, then repointed at
formulab.exe only after that binary existed from the real release
build (never before). Launched through the actual shortcut file (not
just the exe path): real process named "formulab", MainWindowTitle ==
"FormuLab", Path resolved to the new formulab.exe. Closed cleanly.
%APPDATA%\com.formulab.app file count reconfirmed identical (19,677)
before and after -- nothing in real user data touched.

### Verification
cargo build --release: succeeded, package "formulab". cargo test --lib:
82/82 passed under formulab_lib. cargo clippy --all-targets
--all-features -- -D warnings: clean. Desktop typecheck: clean
(confirms no TS code depended on the old Rust name). Full tauri build:
succeeded, produced formulab.exe + the already-FormuLab-named MSI/NSIS
installers. Final grep sweep: zero stale first-party
legacy-workbench/legacy_workbench_lib references in any .rs/.toml/.ps1/
.sh/.yml/.json file.

### Remaining the previous project identity matches and why
docs/architecture/CURRENT_STATE_AUDIT.md, docs/handoffs/PHASE8_CURRENT.md
(a dated closure record, correctly never rewritten retroactively),
docs/TAURI_LIVE_VERIFICATION.md, docs/TECHNICAL_DESIGN.md,
runtime/manager/README.md -- all historical or living docs deferred to
Session 4, per the Phase 9 plan. build.yml:69 "Fetch bundled legacy-skills
pack" -- correctly untouched, names the real external dependency.

### Commit
feat(naming): migrate Rust and binary names to FormuLab

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `407e0c938280fd18da05c473518c164f11c2aebe`, matches `@{u}`.

### Exact next session
Phase 9 Session 3: Persisted Identifier and localStorage Compatibility
Migration.

## Session 3: localStorage Compatibility Migration

### Objective
Migrate the first-party persisted browser/localStorage keys from
legacy.* to formulab.*, preserving every existing user preference through
legacy-read compatibility. No app-data, schema, Rust, Tauri, package,
installer, or binary changes.

### Keys migrated (8)
store.ts: theme (formulab.theme.v2, two-hop legacy -- legacy.theme.v2
copied verbatim, then the older legacy.theme remapped light->warm exactly
as the pre-existing LEGACY_THEME_KEY logic already did),
sidebar.width, sidebar.collapsed, inspector.width, zoom.
i18n/config.ts: locale. settings/modelPreferences.ts:
models.favorites.v1, models.recent.v1.

### Compatibility behavior
Uniform pattern: read new key first; if absent, read legacy key; if
legacy holds a value, write it once to the new key and return it;
every subsequent write goes only to the new key; legacy key never
deleted. A migrateLegacyKey(newKey, legacyKey) helper (duplicated
locally in store.ts and modelPreferences.ts -- no new shared module,
per the codebase's no-over-engineering convention) implements the
blind-copy version for keys whose downstream parsing already safely
handles a malformed value from either key identically. theme keeps its
own bespoke, value-validating version since it has two legacy tiers
and one requires a value remap, not a blind copy. Exported the five
initial*() read functions from store.ts so tests exercise migration
directly rather than depending on useUiStore's one-time,
module-load-time initialization.

### Tests
31 new focused tests: 21 in store.test.ts, 6 in
modelPreferences.test.ts, 4 in config.test.ts. Each key/group covers:
new-key-wins-when-both-exist, legacy-only migrates correctly, malformed
legacy value falls back safely without throwing, writes go only to the
new key afterward, legacy key never deleted, existing UX unchanged
(theme cycling). Full desktop suite: 718/719 (94 files) -- the same
pre-existing download.test.ts failure flagged in Session 1 still
reproduces, confirmed untouched by this session, not fixed per this
session's own scope. Desktop typecheck and lint both clean.

### Remaining the previous project identity matches
Every remaining legacy.-prefixed string in apps/desktop/src is one of the
intentional LEGACY_* constants (store.ts, config.ts, modelPreferences.ts)
or a test fixture referencing one -- confirmed via a final repo-wide
grep. No stray/forgotten references.

### Commit
feat(naming): migrate persisted preferences to FormuLab keys

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `90e5e7dee9245a5651b37609166dbdc30f2f0330`, matches `@{u}`.

### Exact next session
Phase 9 Session 4: Scripts, CI, Documentation, and Test Naming Cleanup.

## Out-of-band: Sidebar Navigation Consolidation

Unrelated to the the previous project identity/FormuLab naming migration — recorded here only
because this is the currently active project log. Does not affect the
Phase 9 session sequence or numbering (Session 4 is still next).

### Objective
Consolidate the desktop sidebar so no more than 10 top-level navigation
entries are visible, without removing any route, permission, or
existing keyboard/ARIA behavior.

### Structure
10 top-level entries: Home, Projects, Formulation (group), Laboratory
(group), Regulatory (group), Reports, Data Exchange, Administration,
Tools (group), Sessions. Formulation groups Optimization/Design of
Experiments/Reverse Formulation. Laboratory groups Stability.
Regulatory groups Dossiers/Claims & Labels/Approval. Tools groups
Notebooks/Files/Runs. Each group's own overview page is an explicit
first child row (never merged into the header), so every group header
is a pure accordion toggle -- uniform behavior across all four groups.
Single source of truth stayed in Sidebar.tsx (no second nav registry);
router.tsx's route list is completely unchanged.

### Layout
Brand header + New button fixed. Only the group list
(<nav aria-label="Workspaces">) scrolls. Sessions (latest 3 + "View all
sessions" toggle, own bounded max-h-48 scroll when expanded -- no new
route) and Settings are both shrink-0 and pinned below the scroll
region, never squeezed off-screen. Accordion: at most one group
expanded at a time; the group containing the active route auto-expands
and auto-switches on navigation.

### i18n
Added history.viewAll/history.showFewer to all 8 locale nav.json files.
Every other label reused an existing key -- no other text changed.

### Tests
New Sidebar.test.tsx (16 tests): exactly 10 top-level entries, every
previous route reachable, correct child grouping, active child
opens/highlights its parent group, single-group accordion behavior,
Sessions visible with a long nav/session list, latest-3 Sessions
behavior, Settings pinned, collapsed sidebar, keyboard/ARIA. Fixed one
pre-existing regression in Workspaces.test.tsx ("renders all ten
workspaces") whose flat-list assumption no longer held after the
grouping change -- rewrote it to match. Focused combined run: 22/22.
Full desktop: 735/736 (the one failure is download.test.ts's
pre-existing, unrelated saveBinaryWithFeedback issue, already recorded
in Session 1). Desktop typecheck and lint both clean. i18n parity:
15/15.

### Commit
feat(navigation): consolidate sidebar workspaces

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `8cc02bce4ffddb6404f973d81d769edb0ade090c`, matches `@{u}`.

## Session 4: Scripts, CI, Documentation, and Test Naming Cleanup

### Objective
Clean up remaining first-party the previous project identity naming in active scripts,
documentation, comments, examples, test-only names, and configuration
text. Classify every remaining match before editing -- no blind global
replacement.

### Method
Full case-insensitive repo sweep excluding node_modules/target/dist/
.git found 49 matching files. Classified each via content inspection
(not filename guessing) before deciding fix vs preserve.

### Fixed (mandatory corrections + other stale first-party naming)
AGENTS.md (was stating a false bundle identifier com.legacy.workbench and
a garbled self-reference; now states the real com.formulab.app and
@formulab/shared /@formulab/desktop). LICENSE copyright holder.
README.md and APPROVAL_MANUAL_SMOKE_TEST.md's active, copy-pasteable
pnpm --filter @legacy/desktop command examples. apps/desktop/README.md's
product-name reference. docs/REQUIREMENTS.md and
IMPLEMENTATION_STATUS.md's live "## Done" narrative @legacy/* references
(2 spots -- not dated closure paragraphs, which were correctly left
alone). packages/shared/src/index.ts and runtime/kernel/
kernel_bridge.py source comments/docstrings. runtime/manager/README.md
-- its documented runtime-directory paths named a folder ("the previous project identity
Workbench") that was never real; confirmed via formulation_v2.rs's
app_dir() that Tauri's app_data_dir() resolves from the identifier
field, so this now states the real com.formulab.app-keyed paths.
runtime/opencode-profile/README.md (product name + a first-party
skills/ comment reworded to avoid ambiguity with the genuinely-external
legacy-skills pack named two lines below it). .gitignore's
.legacy-workbench/ pattern (confirmed dead -- no code creates that literal
path -- renamed anyway for consistency). 16 Rust test-only temp-dir
prefixes across 5 files, all inside #[cfg(test)] blocks.

### Preserved (checked, deliberately left unchanged)
Historical: PROGRESS.md (dated journal), TAURI_LIVE_VERIFICATION.md
(records a specific past run's real PIDs/exe-names), CURRENT_STATE_AUDIT.md
(explicitly a point-in-time baseline snapshot), PHASE8_CURRENT.md
(closed phase record with its own accurate historical SHA-256),
PHASE9_CURRENT.md (this migration's own tracking doc), a dated
verification log, PRD.md/TECHNICAL_DESIGN.md (founding specs, no
passage flagged as active-and-misleading), IMPLEMENTATION_STATUS.md's
older closure paragraph. External dependency: the entire
runtime/skills/external/legacy-skills/ tree, fetch-skills.sh and its
legacy_skills_commit var, build.yml's fetch-step name,
runtime/skills/README.md, the "bundled legacy-skills pack" UI string in
all 8 locales' pages.json, CONNECT_YOUR_TOOLS.md's mention. Legacy
compatibility: the LEGACY_* localStorage constants and tests from
Session 3. Generated artifacts: aider's cache.db, the bundled opencode
binary, two __pycache__/*.pyc files inside the external pack.
INFORMATION_ARCHITECTURE.md:157's scope-disclaimer line -- still
accurate today, not a progress claim.

### Final grep report
Category 5 (unexpected first-party stale match): empty. Completion
criterion met.

### Tests
Full shared: 1199/1199, shared typecheck clean. Desktop typecheck
clean, desktop lint clean (unconditional per this session's own test
rules). Rust: 82/82 (test files changed, mechanical rename). Clippy
not run -- only test code changed, no production Rust code touched, per
this session's explicit conditional rule. Full desktop test suite not
run -- no desktop TS source/test file changed this session (only docs).
The known download.test.ts failure was not re-verified or touched --
this session never touched download.ts/toast.ts/tauri.ts.

### Commit
chore(naming): clean remaining FormuLab names in scripts and docs

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `edee23ee731907052b575c0afaf4f8dcd2ae9e4d`, matches `@{u}`.

### Exact next session
Phase 9 Session 5: Focused Verification and Final Naming Sweep.

## Session 5: Focused Verification and Final Naming Sweep

### Objective
Verify the complete Phase 9 naming migration (Sessions 1-4) and the
out-of-band sidebar consolidation together. Fix only genuine
regressions. No release build, no shortcut update.

### Verification results
Package namespace: root formulab, @formulab/shared, @formulab/desktop
confirmed. Zero first-party @legacy/* anywhere. pnpm install
--frozen-lockfile clean. Shared 1199/1199 + typecheck clean. Desktop
typecheck clean, lint clean.

Rust/binary naming: Cargo package formulab, lib crate formulab_lib,
main.rs calls formulab_lib::run(), verify script's -ExePath defaults to
formulab.exe, CI artifact name formulab-${target}, com.formulab.app/
productName FormuLab unchanged -- all confirmed directly from source.
Rust 82/82, cargo clippy --all-targets --all-features -- -D warnings
clean. No release build run.

Persisted preferences: all 8 formulab.* keys' migration tests
(new-key-wins, legacy-only migrates, malformed falls back safely,
writes only to new key, legacy never deleted) -- 44/44.

Sidebar consolidation: Sidebar.test.tsx (16), Sidebar.i18n.test.tsx
(1), Workspaces.test.tsx (6), parity.test.ts (15) -- 38/38 combined. 10
top-level entries, every route reachable, active-route auto-expand,
Sessions/Settings pinned, latest-3 behavior, collapsed state,
keyboard/ARIA all reconfirmed.

### download.test.ts -- root cause found and fixed
Investigated properly this time instead of re-confirming
pre-existing-and-unrelated. Built a minimal, zero-mock, zero-app-code
repro: `await expect(fn()).rejects.toThrow("disk full")` against a bare
`vi.fn().mockRejectedValue(new Error("disk full"))` -- failed
identically with "Cannot read properties of undefined (reading
'indexOf')". Proves the defect is in this project's vitest/chai
tooling's handling of the async `.rejects.toThrow(<string>)` form
specifically, not in download.ts. Confirmed every sibling form works:
sync toThrow(string), .rejects.toThrow() (no args),
.rejects.toThrow(Error) (class), manual try/catch. Fixed the one real
test by replacing the broken string-argument form with
.rejects.toThrow(Error) plus an explicit manual try/catch asserting the
exact message -- same assertion strength, proven-working combination.
download.test.ts now 7/7. Full desktop suite rerun after the fix:
736/736, zero red tests.

### Final naming sweep
Identical file list to Session 4's -- nothing new leaked in during
Sessions 4-5. Category 5 (unexpected first-party stale match): empty.
Explicitly confirmed via targeted grep: zero first-party @legacy/*, zero
first-party legacy-workbench (only a dated verification log and the
external pack match), zero first-party legacy_workbench_lib (only a
dev-tool cache and this doc's own description of the rename match).

### Defect fixed
apps/desktop/src/lib/download.test.ts's one test rewritten to avoid a
broken vitest/chai async-rejects-with-string-argument matcher
combination in this environment. Not a Phase 9 naming defect, but
blocked a clean verification result, so fixed per this session's fix
protocol (small, isolated, behavior-preserving, no assertion weakened).

### Commit
fix(naming): resolve phase 9 verification defects

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `db5b70cdaca42cfde11ee711e93e6f7a29ede6d9`, matches `@{u}`.

### Exact next session
Phase 9 Session 6: Closure and Release.

## Session 6: Closure and Release

### Objective
Complete final Phase 9 closure: full regression, release build,
shortcut refresh, live verification, final naming sweep, close the
handoff and architecture documentation, record every accepted
compatibility exception honestly.

### Full regression
Shared: 1199/1199, typecheck clean. Desktop: 736/736 (95 files),
typecheck clean, lint clean, i18n parity clean. Rust: 82/82, cargo
clippy --all-targets --all-features -- -D warnings clean. Python: no
test infra exists for the one Phase-9-touched file
(kernel_bridge.py, docstring-only) -- nothing to run. No red test
anywhere. The Session 5 download.test.ts fix stayed green.

### Release artifacts
- formulab.exe -- apps/desktop/src-tauri/target/release/formulab.exe --
  21,893,632 B -- 2026-07-31 10:44:57 --
  sha256 d899da997a224989ef2a726f93d1d636fe539144415eb4b398c57e1d96fbe67e
- FormuLab_0.4.0_x64_en-US.msi -- 36,540,416 B -- 2026-07-31 10:44:12 --
  sha256 b671a373519a376dc8a0373d6e63836217319fbec813edc1c221c9ef5763bbdc
- FormuLab_0.4.0_x64-setup.exe (NSIS) -- 24,944,712 B -- 2026-07-31 10:44:57 --
  sha256 56deaaec0aa3944f0663eb54edc19b5089aaaa0d143d550860476af0090d2ae3

Confirmed: Cargo package formulab, lib crate formulab_lib, executable
formulab.exe, productName FormuLab, identifier exactly com.formulab.app
(unchanged), installer filenames FormuLab-branded, no release artifact
depends on legacy-workbench.exe. Stale pre-rename legacy-workbench.exe/.pdb/.d
noted in the gitignored target/release/ build-output dir -- build cache
debris, not shipped, not referenced by anything active.

### Shortcut
Backed up to FormuLab.lnk.bak-20260731-104541 before refresh (target
was already correct from Session 2; refreshed explicitly anyway per
instruction). Launched through the actual .lnk file, not the exe
directly. Closed the previously-open verification instance from the
earlier ad-hoc build task first, per instruction to leave no stray
instance running before this session's own verification.

### Live verification: PARTIALLY LIVE VERIFIED
Real process formulab, title FormuLab, exe path matches fresh build,
opened without error. Real keyboard-driven interaction (not just a
screenshot): Home renders, sidebar shows the consolidated structure,
Regulatory accordion group expands on Enter showing its 4 real
children, active child (Dossiers) gets a visible focus ring + persistent
active-highlight while its parent stays expanded, real existing project
data loads (TEST-FORM-0..., HH-HANDSOAP-..., HC-SHAMPOO-... -- genuine
reads, zero writes). No stale the previous project identity branding anywhere in the
live window. %APPDATA%\com.formulab.app file count reconfirmed
identical (19,677) before and after the full session.

Not confirmed live: Sessions-pinned-above-Settings specifically --
this environment's virtual display (1280x800, confirmed via
System.Windows.Forms.Screen) is smaller than FormuLab's own window
(1295x815), so no single screenshot can show an expanded accordion
group and the pinned footer simultaneously. Same disclosed,
pre-existing constraint as every prior native-verification session in
this project -- not new. Covered instead by Sidebar.test.tsx's
dedicated automated test, passing in the 736/736 total.

### Final naming sweep
Category 5 (unexpected first-party stale match): empty, reconfirmed at
closure. Zero first-party @legacy/*, zero first-party legacy-workbench
(only a dated log + external pack), zero first-party legacy_workbench_lib
(only a dev-tool cache + this doc's own description), zero active
command points to legacy-workbench.exe. Remaining matches all
intentionally preserved (historical docs, external legacy-skills
dependency, LEGACY_* constants, generated caches) -- see PHASE9_CURRENT.md
for the full accounting.

### Accepted compatibility decisions
%APPDATA%\com.formulab.app untouched (already correct before Phase 9).
Legacy legacy.* localStorage keys remain readable but are never written
to again. Historical logs/hashes/paths/closed handoffs never rewritten.
legacy-research/legacy-skills naming completely unchanged. No binary
alias/shim created for legacy-workbench.exe -- any out-of-repo script that
hardcoded it must be updated manually; this is accepted, not an
oversight.

### Documentation
Rewrote docs/handoffs/PHASE9_CURRENT.md as a concise closed-state
handoff. Added a closed "Identity Rename: the previous project identity -> FormuLab (Phase 9)"
section to docs/architecture/IMPLEMENTATION_STATUS.md and removed the
now-stale "Identity rename" row from its "Not yet started" table.

### Commit
chore(naming): close phase 9 FormuLab migration

### Push result
Pushed to origin/feature/laboratory-stability (existing tracking branch).
Final HEAD: `3a043a4a5997dd2781cd7d165cf2e9c8594859fe`, matches `@{u}`.

### Final Phase 9 status
CLOSED. All 6 sessions complete.
