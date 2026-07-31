# Phase 9 — `ai4s`/`AI4S` → FormuLab Naming Migration

## Out-of-band: Sidebar Navigation Consolidation (unrelated to the naming
migration — recorded here only because this is the currently active
handoff document; does not affect Phase 9's own session numbering).

Consolidated `apps/desktop/src/components/sidebar/Sidebar.tsx`'s
top-level navigation from 15 flat items down to exactly 10: Home,
Projects, Formulation (group), Laboratory (group), Regulatory (group),
Reports, Data Exchange, Administration, Tools (group), Sessions.
Formulation groups Optimization/Design of Experiments/Reverse
Formulation; Laboratory groups Stability; Regulatory groups
Dossiers/Claims & Labels/Approval; Tools groups Notebooks/Files/Runs —
each group's own overview page is an explicit first child row, never
merged into the header, so every group header is a pure accordion
toggle. Single source of truth for the nav stayed in `Sidebar.tsx`
itself (no second registry) — `router.tsx`'s route list is unchanged
and every previous path still resolves. The group containing the
active route auto-expands (and auto-switches on navigation); at most
one group is expanded at a time. Every nav row is now a `NavLink`
(previously plain `onClick` buttons with no active-state), so
`aria-current="page"` and active highlighting are new, correct
behavior, not a regression. Layout: brand header + New button fixed;
only the group list (`<nav aria-label="Workspaces">`) scrolls; Sessions
(capped at latest 3 + a "View all sessions" toggle with its own bounded
`max-h-48 overflow-y-auto` when expanded — no new route added) and
Settings are both `shrink-0`, pinned below the scroll region, never
squeezed off-screen. Added `history.viewAll`/`history.showFewer` to
all 8 locale `nav.json` files (i18n parity green); every other label
reused an existing key — nothing else changed text-wise. Fixed one
pre-existing test (`Workspaces.test.tsx`'s "renders all ten
workspaces") whose flat-list assumption no longer held, rewriting it to
match the grouped structure. Focused: 22/22
(`Sidebar.test.tsx` 16, `Sidebar.i18n.test.tsx` 1, `Workspaces.test.tsx`
6 — via a combined run). Full desktop: 735/736 — the one failure is
`download.test.ts`'s pre-existing, unrelated (confirmed in Phase 9
Session 1 via `git stash` against a pristine tree) `saveBinaryWithFeedback`
failure; untouched by this change. Typecheck and lint both clean.

## Status: Session 4 (scripts, CI, documentation, test naming) complete.

## Session 4 summary
Cleaned up remaining first-party `ai4s`/`AI4S` naming in active
scripts, docs, comments, and Rust test-only identifiers. Full
case-insensitive repo sweep (excluding `node_modules`/`target`/`dist`/
`.git`) found 49 matching files; classified every one before editing —
no blind global replacement.

**Fixed (mandatory corrections + other stale first-party naming)**:
- `AGENTS.md` — was stating a **false** bundle identifier
  (`com.ai4s.workbench`, garbled "Formerly FormuLab" self-reference)
  and stale unchanged package names; now states the real
  `com.formulab.app` identifier and `@formulab/shared`/
  `@formulab/desktop` package names.
- `LICENSE` — copyright holder "AI4S Workbench contributors" →
  "FormuLab contributors".
- `README.md`, `docs/APPROVAL_MANUAL_SMOKE_TEST.md` — active,
  copy-pasteable `pnpm --filter @ai4s/desktop …` command examples →
  `@formulab/desktop` (the smoke-test doc's own "Correction (this
  phase)" narrative prose, which correctly recounts what an earlier
  investigation found, was left untouched — only its stale runnable
  command was fixed).
- `apps/desktop/README.md` — "the AI4S Workbench shell" →
  "the FormuLab shell".
- `docs/REQUIREMENTS.md`, `docs/architecture/IMPLEMENTATION_STATUS.md`
  (2 spots, both in live "## Done" narrative, not dated closure
  paragraphs) — stale `@ai4s/shared`/`@ai4s/desktop` references →
  `@formulab/*`.
- `packages/shared/src/index.ts`, `runtime/kernel/kernel_bridge.py` —
  first-party source comments/docstrings naming "AI4S Workbench" →
  "FormuLab".
- `runtime/manager/README.md` — the documented runtime-directory paths
  named a folder ("AI4S Workbench") that was never real; Tauri's
  `app_data_dir()` actually resolves from the `identifier` field
  (confirmed against `formulation_v2.rs`'s `app_dir()`), so this now
  states the real `com.formulab.app`-keyed paths for macOS/Windows/
  Linux instead of a fictional display-name folder.
- `runtime/opencode-profile/README.md` — "AI4S Workbench" →
  "FormuLab"; a first-party (not the external pack's) `skills/`
  subdirectory comment reworded from "AI4S scientific skills" to
  "First-party scientific skills" to remove ambiguity with the
  genuinely-external `ai4s-skills` pack described two lines below it.
- `.gitignore` — `.ai4s-workbench/` renamed to `.formulab-workbench/`;
  confirmed via grep that no current Rust code ever creates a literal
  `.ai4s-workbench/` directory (real app data uses Tauri's
  identifier-keyed `app_data_dir()`), so this was already a dead
  pattern — the rename is cosmetic/future-proofing, zero functional
  risk either way.
- 16 Rust test-only `std::env::temp_dir()` prefixes across
  `artifact_file.rs`/`preview_server.rs`/`provenance.rs`/`runs.rs`/
  `runs_index.rs` (e.g. `"ai4s-listdir-"` → `"formulab-listdir-"`) —
  ephemeral, zero production-code impact, all inside `#[cfg(test)]`
  blocks.

**Preserved (checked, deliberately left unchanged)** — see the Final
grep report below for the complete accounting.

## Session 3 summary
Migrated all 8 first-party `ai4s.*` `localStorage` keys to `formulab.*`,
each with a one-time, write-once legacy-read migration that never
deletes the old key:
- `apps/desktop/src/lib/store.ts`: `theme` (`formulab.theme.v2`, with a
  two-hop legacy chain — `ai4s.theme.v2` copied verbatim, then the
  older pre-v2 `ai4s.theme` remapped `"light"`→`"warm"` exactly as the
  existing `LEGACY_THEME_KEY` logic already did), `sidebar.width`,
  `sidebar.collapsed`, `inspector.width`, `zoom`.
- `apps/desktop/src/i18n/config.ts`: `locale`.
- `apps/desktop/src/components/settings/modelPreferences.ts`:
  `models.favorites.v1`, `models.recent.v1`.

Pattern (reused across all keys, generalizing the pre-existing
`LEGACY_THEME_KEY` precedent): read the new key first; if absent, read
the legacy key; if the legacy key holds a value, write it once to the
new key and return it; every subsequent write goes only to the new key;
the legacy key is never deleted. A `migrateLegacyKey(newKey, legacyKey)`
helper implements the blind-copy version (sidebar/inspector/zoom/
locale/favorites/recent — downstream parsing already safely handles a
malformed value from either key identically, so a raw copy is safe);
`theme` keeps its own bespoke, value-validating version since it has
two legacy tiers and one of them requires a value remap, not a blind
copy. Exported the five `initial*()` read functions from `store.ts`
(theme/sidebar-width/sidebar-collapsed/inspector-width/zoom) so tests
can exercise the migration logic directly without depending on
`useUiStore`'s one-time, module-load-time initialization.

Added 31 new focused tests (21 in `store.test.ts`, 6 in
`modelPreferences.test.ts`, 4 in `config.test.ts`) covering, per key or
key group: new-key-wins-when-both-exist, legacy-only migrates
correctly, malformed legacy value falls back safely without throwing,
writes go only to the new key afterward, the legacy key is never
deleted, and (for theme) the exact pre-existing cycling/remap UX is
unchanged. Full desktop suite: 718/719 (94 files) — the same
pre-existing, migration-unrelated `download.test.ts` failure flagged in
Session 1 still reproduces (confirmed untouched by this session's
changes; not fixed, per this session's own explicit instruction not to
fix it unless this session's changes touch that area — they don't).
Desktop typecheck and lint both clean. No app-data, schema, Rust,
Tauri, package, installer, or binary files touched. Final grep sweep:
every remaining `ai4s.`-prefixed string in `apps/desktop/src` is one of
the intentional `LEGACY_*` constants or a test fixture referencing one.

## Session 2 summary
Renamed the Rust package/binary `ai4s-workbench` → `formulab` and the
lib crate `ai4s_workbench_lib` → `formulab_lib` in
`apps/desktop/src-tauri/Cargo.toml` (also `authors`: "AI4S Workbench
contributors" → "FormuLab contributors"). Updated `main.rs`'s
`formulab_lib::run()` call site, `lib.rs`'s header comment and
`.expect("error while building FormuLab")` panic string, and a
first-party comment in `tools.rs`. `tauri.conf.json`'s `identifier`
(`com.formulab.app`) and `productName` (`FormuLab`) confirmed
**unchanged** — no `mainBinaryName` override was ever needed; Tauri
now derives `formulab.exe` directly from the renamed Cargo package.
Updated `.github/workflows/build.yml`'s artifact-upload name
(`ai4s-workbench-${target}` → `formulab-${target}`) and
`scripts/windows/verify-formulab-phase1.ps1`'s default `-ExePath`
(now points at `formulab.exe`).

Built a real release: `cargo build --release`, full Rust test suite
(82/82) against the renamed `formulab_lib`, `cargo clippy --all-targets
--all-features -- -D warnings` (clean), desktop typecheck (clean,
confirms no TS code depended on the old Rust name), then a full
`tauri build` producing `formulab.exe` + the already-correctly-named
`FormuLab_0.4.0_x64_en-US.msi`/`FormuLab_0.4.0_x64-setup.exe`.

Backed up `FormuLab.lnk` to `FormuLab.lnk.bak-phase9session2` before
touching it, then repointed it at the new `formulab.exe` only after
that binary existed. Launched **through the actual shortcut file**
(not just the exe path) and confirmed: real process named `formulab`,
`MainWindowTitle` == `FormuLab`, `Path` resolves to the new
`formulab.exe`. Closed cleanly. Re-verified `%APPDATA%\com.formulab.app`
file count unchanged (19,677 before and after) — nothing in real user
data was read, written, or touched.

Final grep sweep: zero stale first-party `ai4s-workbench`/
`ai4s_workbench_lib` references remain in any `.rs`/`.toml`/`.ps1`/
`.sh`/`.yml`/`.json` file. Remaining matches are all historical/
deferred-to-Session-4 documentation (`docs/architecture/
CURRENT_STATE_AUDIT.md`, `docs/handoffs/PHASE8_CURRENT.md` — a dated
closure record, correctly never rewritten, `docs/TAURI_LIVE_VERIFICATION.md`,
`docs/TECHNICAL_DESIGN.md`, `runtime/manager/README.md`) plus the one
correctly-untouched external-dependency reference in
`build.yml:69` ("Fetch bundled ai4s-skills pack").

## Session 1 summary
Renamed the npm workspace scope `@ai4s/*` → `@formulab/*` and the root
workspace label `ai4s-workbench` → `formulab`. Mechanical, uniform
rename across 125 files: `packages/shared/package.json`,
`apps/desktop/package.json` (name + the `@ai4s/shared` dependency
entry), root `package.json` (name + 4 `--filter` script lines),
`apps/desktop/tsconfig.json`'s path alias, `apps/desktop/vite.config.ts`'s
resolve alias, `apps/desktop/src-tauri/tauri.conf.json`'s
`beforeDevCommand`/`beforeBuildCommand` (workspace-filter strings only —
`identifier`/`productName` untouched, confirmed still
`com.formulab.app`/"FormuLab"), `scripts/windows/verify-formulab-phase1.ps1`'s
two `--filter @ai4s/desktop` example-command lines (its `-ExePath`
default, which names `ai4s-workbench.exe`, is Session 2 scope and was
left untouched), and 118 first-party source files under
`apps/desktop/src` importing `from "@ai4s/shared"` (including one CSS
comment in `index.css`). `pnpm-lock.yaml` regenerated via `pnpm install`
(never hand-edited) and reverified with `pnpm install --frozen-lockfile`.

Zero first-party `@ai4s/` matches remain anywhere in the repo. Rust
crate/binary names, Tauri `identifier`/`productName`, executable/
installer names, `localStorage` keys, historical logs/handoffs, and the
external `ai4s-research/ai4s-skills` dependency were all confirmed
untouched, per scope.

One pre-existing, unrelated test failure
(`src/lib/download.test.ts` — "shows an error toast and re-throws when
the save fails…") was found during the full desktop run. Confirmed via
`git stash` (reverting to the pre-Session-1 tree) that it fails
identically against unmodified code — neither `download.ts`,
`download.test.ts`, `tauri.ts`'s real implementation, nor `toast.ts` (the
test fully mocks both `./tauri` and `./toast`) were touched by this
session's changes. Not fixed — out of Session 1's bounded scope; flagged
for Session 5 (focused verification) or separate triage.

## Key finding: most user-facing branding is already done
`tauri.conf.json`'s `productName` ("FormuLab") and `identifier`
(`com.formulab.app`) are **already correct** — the installers already
ship as `FormuLab_0.4.0_x64_en-US.msi`/`FormuLab_0.4.0_x64-setup.exe`,
the window title is already `FormuLab`, and `%APPDATA%\com.formulab.app`
is already the real, in-use app-data directory holding 19,677+ files of
genuine project history. **No app-data migration is needed** — there is
nothing to orphan. What remains is internal/technical: the npm package
scope, the Rust crate/binary name (which the packaged `.exe` is still
built from), a handful of persisted `localStorage` keys, and a
documentation cleanup — including one file (`AGENTS.md`) that currently
states a **factually wrong** bundle identifier and must be corrected
regardless of migration scope.

173 files match `ai4s`/`AI4S` (case-insensitive) outside
`node_modules`/`target`/`dist`/`.git`; 123 are `.ts`/`.tsx` (the
overwhelming majority are `@ai4s/shared` import statements — mechanical,
uniform, low individual risk).

## Naming inventory by category

### 1. User-visible and must change
- `LICENSE` — "Copyright (c) 2026 **AI4S Workbench contributors**".
- `AGENTS.md:4-5` — says "Bundle identifier stays `com.ai4s.workbench`"
  (**false** — it's already `com.formulab.app`) and "Formerly FormuLab"
  (garbled self-reference). This is a live reference doc every session
  reads first; must be fixed regardless of migration scope/timing.
- `apps/desktop/src-tauri/Cargo.toml:5` — `authors = ["AI4S Workbench
  contributors"]` (shown in installer/exe file properties).
- `apps/desktop/src-tauri/src/lib.rs:1,147` — header comment "AI4S
  Workbench — Tauri 2 entry" and `.expect("error while building AI4S
  Workbench")` (the panic string is user-visible only on a fatal startup
  crash — rare, but real).

### 2. Internal identifier, safe to change
- `packages/shared/package.json` — `"name": "@ai4s/shared"`.
- `apps/desktop/package.json` — `"name": "@ai4s/desktop"`,
  `"@ai4s/shared": "workspace:*"` dependency entry.
- `package.json` (root) — `"name": "ai4s-workbench"` (never published,
  purely a pnpm-workspace-root label), 4 `--filter @ai4s/*` script
  lines.
- 115 files under `apps/desktop/src`/`packages/shared/src` importing
  `from "@ai4s/shared"` — purely mechanical, same rename as the package
  name itself.
- `apps/desktop/src-tauri/Cargo.toml:2` — `name = "ai4s-workbench"`
  (package), `Cargo.toml:9` — `name = "ai4s_workbench_lib"` (lib crate)
  — see risk note below, this drives the shipped `.exe` filename.
- `apps/desktop/src-tauri/src/main.rs:5` —
  `ai4s_workbench_lib::run()` call site, tied 1:1 to the lib rename.
- `.github/workflows/build.yml:126` — `name: ai4s-workbench-${{
  matrix.target }}` (GitHub Actions upload-artifact internal name —
  cosmetic, Actions UI only, no download-URL/consumer depends on it).
- Rust test-only temp-dir name prefixes (`ai4s-listdir-`,
  `ai4s-preview-range-`, `ai4s-runidx-`, etc. — 14 occurrences across
  `artifact_file.rs`/`preview_server.rs`/`provenance.rs`/`runs.rs`/
  `runs_index.rs`) — ephemeral OS temp dirs created/torn down within a
  single test run, zero user visibility, zero compatibility risk.
- `README.md:189-190` — two `pnpm --filter @ai4s/desktop tauri
  {dev,build}` example commands, tied 1:1 to the package rename.

### 3. Compatibility-sensitive, needs migration/alias
- **`apps/desktop/src-tauri/Cargo.toml`'s package name → the shipped
  `.exe` filename.** Tauri derives the binary filename from the Cargo
  package name when no explicit `mainBinaryName` override exists in
  `tauri.conf.json` (there is none today). Renaming it changes
  `ai4s-workbench.exe` to whatever the new name is. This breaks:
  - The **existing** `C:\Users\sekip\Desktop\FormuLab.lnk` shortcut,
    whose current target is literally
    `...\target\release\ai4s-workbench.exe` — must be refreshed in the
    same session as the rename (same backup-then-refresh pattern used
    in every prior closure session).
  - `scripts/windows/verify-formulab-phase1.ps1`'s default `-ExePath`
    parameter (`...\target\debug\ai4s-workbench.exe`).
  - Any pinned taskbar entry, external automation, or muscle-memory
    outside this repo's control that references `ai4s-workbench.exe`
    by name — cannot be fixed from inside the repo; must be disclosed
    honestly as an accepted one-time break in the closure notes.
- **8 `localStorage` keys**, all still `ai4s.`-prefixed, real and
  currently read/written by every existing user's saved browser/WebView
  storage:
  - `apps/desktop/src/lib/store.ts`: `ai4s.theme.v2` (plus
    `ai4s.theme` — already kept as an explicit **legacy read fallback**,
    proving this exact migration pattern is already established in this
    codebase), `ai4s.sidebar.width`, `ai4s.sidebar.collapsed`,
    `ai4s.inspector.width`, `ai4s.zoom`.
  - `apps/desktop/src/components/settings/modelPreferences.ts`:
    `ai4s.models.favorites.v1`, `ai4s.models.recent.v1`.
  - `apps/desktop/src/i18n/config.ts`: `ai4s.locale`.
  - Renaming these without a legacy-read fallback silently resets every
    existing user's theme/layout/locale/model-favorites preferences to
    default on first launch after the update — not data loss, but a
    real one-time UX regression. Session 3 must decide: replicate the
    existing `LEGACY_THEME_KEY` read-fallback pattern for all 8 keys,
    or leave the literal key strings unchanged (they render no user-
    visible text anywhere — purely internal storage identifiers). Both
    are defensible; recommend deciding explicitly rather than defaulting
    silently either way.

### 4. Historical documentation, should remain unchanged
- `docs/handoffs/*.md` (all completed-phase handoffs, e.g.
  `PHASE7_CURRENT.md`'s closed-state text, this file's own future
  Session-1..N entries once dated) — snapshots of what was true at
  closure time; never rewritten retroactively.
- `C:\Users\sekip\Desktop\FormuLab-Phase*-*-Log.md` external logs — the
  task's own explicit append-only rule; old entries (including any past
  reference to `ai4s-workbench.exe`, past SHA-256 hashes computed
  against that filename) stay exactly as recorded.
- `docs/TAURI_LIVE_VERIFICATION.md`, `docs/APPROVAL_MANUAL_SMOKE_TEST.md`
  — dated verification-session narratives; describe what was actually
  run and observed at the time, must not be edited to retroactively
  imply a different binary name was used.
- `docs/architecture/IMPLEMENTATION_STATUS.md`'s dated closure
  paragraphs for Phases 1–8 (e.g. this session's own Phase 8 closure
  text naming `ai4s-workbench.exe` and its real SHA-256) — leave as
  historically accurate; only new/future entries use the new name.
- `docs/architecture/CURRENT_STATE_AUDIT.md:127-128` — a dated
  point-in-time audit snapshot; its "Identity" note ("The crate is
  `ai4s-workbench`, packages are `@ai4s/*`, and the built binary is
  `ai4s-workbench.exe`. Installers are already branded FormuLab.") is
  **currently accurate**, corroborating this session's own findings —
  leave as-is until superseded by a new audit written after the actual
  rename, not edited retroactively now.
- `docs/architecture/IMPLEMENTATION_STATUS.md:979` — an older, already
  historical closure paragraph independently lists "the `ai4s`→
  `FormuLab` naming migration" among deferred items — corroborates this
  plan was already anticipated; leave that dated paragraph as-is (it is
  a past phase's closure record), and record actual closure in a new
  paragraph once Phase 9 finishes, matching the pattern already used for
  Phase 8's closure section in the same file this session.
- `docs/PRD.md`, `docs/TECHNICAL_DESIGN.md` — original founding
  specification documents, titled and framed almost entirely around
  "AI4S Workbench Desktop" throughout (product name, `~/.ai4s-workbench/`
  paths, `AI4S-Workbench-*.dmg`/`.msi` example outputs, `com.ai4s.workbench`
  identifier — all describing the **pre-rebrand** original design, not
  the current app). Recommend treating as historical origin documents
  (category 4) rather than forcing a full rewrite; if the team wants
  these brought current, that is a large, separate documentation
  project outside Phase 9's bounded scope — flag as an open question
  rather than silently deciding.

### 5. Generated artifact or dependency, must not be edited directly
- **`scripts/dev/fetch-skills.sh`** and everything it references —
  `AI4S_SKILLS_COMMIT` env var, `runtime/skills/external/ai4s-skills`
  local directory name, and the URL
  `https://github.com/ai4s-research/ai4s-skills` — this is a **real,
  separate, third-party GitHub project** ("ai4s-research/ai4s-skills")
  that FormuLab bundles, not FormuLab's own branding. Renaming any of
  this would silently break the fetch against a repo that doesn't
  exist under the new name. Must not be touched by this migration.
- `apps/desktop/src/i18n/locales/en/pages.json:94` — "the bundled
  **ai4s-skills** pack" — this UI string correctly names the external
  dependency above; leave unchanged for the same reason.
- `.github/workflows/build.yml:69` — "Fetch bundled **ai4s-skills**
  pack" step name — same external-dependency reasoning; the step name
  documents what it fetches and should stay accurate.
- `pnpm-lock.yaml:23` — `'@ai4s/shared':` entry, plus any
  `target/`/`dist/`/`node_modules/` build output — generated,
  regenerates automatically (`pnpm install`) once Session 1 renames the
  package; never hand-edited.
- `docs/INFORMATION_ARCHITECTURE.md:157` — already lists "The `ai4s` →
  `FormuLab` package/identifier naming migration" as a known, deferred,
  not-yet-done item. Not something to protect from editing, but
  confirms this exact migration was already anticipated; update this
  line to reflect closure once Phase 9 finishes, not before.

## Compatibility risks (ranked)
1. **Highest** — Rust binary rename changes the shipped `.exe` filename
   (`ai4s-workbench.exe` → new name). Breaks the existing desktop
   shortcut (fixable, in-repo) and any out-of-repo user automation
   (not fixable from here — must be disclosed).
2. **Medium** — 8 `localStorage` keys, if renamed without a legacy-read
   fallback, silently reset existing users' theme/layout/locale/
   favorites once. Zero data loss; real one-time UX regression.
   Decision needed in Session 3.
3. **Low** — npm workspace scope `@ai4s/*` (internal-only, never
   published, no external consumer, purely mechanical across 115+
   files, fully caught by typecheck if anything is missed).
4. **None** — Tauri `identifier`/`productName`/app-data directory are
   already `com.formulab.app`/"FormuLab"; nothing to change, nothing to
   orphan, no risk to existing saved projects.
5. **None, but must actively avoid** — the external `ai4s-skills`
   dependency (script, env var, URL, UI string) must never be touched;
   doing so breaks a real external fetch, not a cosmetic rename.

## Proposed sessions

### Session 1 — Package/import namespace migration
**Scope**: rename the npm workspace scope `@ai4s/*` → `@formulab/*`
(exact new scope name TBD — needs a decision at session start, not
assumed here). Update `packages/shared/package.json`,
`apps/desktop/package.json` (name + the `@ai4s/shared` dependency
entry), root `package.json` (`name` field + 4 `--filter` script lines),
every `from "@ai4s/shared"` import (115 files, mechanical
find-and-replace).
**Files allowed to change**: the 3 `package.json` files + every file
under `apps/desktop/src/**` and `packages/shared/src/**` containing a
`@ai4s/shared` import. No Rust files, no docs, no CI in this session.
**Compatibility risks**: low — internal-only scope, never published;
any missed import is caught immediately by typecheck.
**Focused tests**: `pnpm --filter @ai4s/shared typecheck` (fails fast
under the OLD filter name, so must be re-run as
`pnpm --filter @formulab/shared typecheck` after the rename — the
verification command itself changes mid-session, call this out
explicitly when executing), full shared + desktop test suites (mechanical
rename touches every consumer, so full — not focused — regression is
warranted here despite the general "focused tests only" rule, same
exception logic as prior full-regression sessions).
**Commit**: `refactor(naming): migrate @ai4s/* package scope to
@formulab/*`

### Session 2 — Rust/Tauri/product/binary naming
**Scope**: `apps/desktop/src-tauri/Cargo.toml` — package `name`
(`ai4s-workbench` → new name, e.g. `formulab` or `formulab-desktop` —
decide at session start), `[lib] name` (`ai4s_workbench_lib` → matching
new name), `authors` field. `main.rs`'s `ai4s_workbench_lib::run()`
call site. `lib.rs`'s header comment and `.expect(...)` panic string.
Confirm (do not change) `tauri.conf.json`'s `productName`/`identifier`
are already correct. Refresh `C:\Users\sekip\Desktop\FormuLab.lnk`
(backup-then-refresh, same pattern as every prior closure) to point at
the newly-named `.exe`. Update
`scripts/windows/verify-formulab-phase1.ps1`'s default `-ExePath`.
Update `.github/workflows/build.yml:126`'s artifact upload name.
**Files allowed to change**: `Cargo.toml`, `main.rs`, `lib.rs`,
`FormuLab.lnk` (via backup+refresh, not a repo file),
`verify-formulab-phase1.ps1`, `build.yml` (artifact-name line only).
No schema files, no persisted data.
**Compatibility risks**: highest in the whole migration — see above.
Must build a real release and relaunch through the refreshed shortcut
before calling this session done, exactly like every prior closure's
native-verification step.
**Focused tests**: `cargo build --release`, `cargo test --lib`,
`cargo clippy --all-targets -- -D warnings`, a real `tauri build`,
installer artifact confirmation (path/size/hash), shortcut relaunch
verification.
**Commit**: `refactor(naming): rename Rust package/binary from
ai4s-workbench to formulab`

### Session 3 — Persisted-identifier (localStorage) migration
**Scope**: decide and implement the fate of the 8 `ai4s.`-prefixed
`localStorage` keys in `store.ts`/`modelPreferences.ts`/`i18n/config.ts`
— either (a) rename with a legacy-read fallback for each, mirroring the
existing `LEGACY_THEME_KEY` pattern, or (b) explicitly decide to leave
the literal key strings unchanged since they carry zero user-visible
text and a rename buys nothing but risk. **No app-data directory
migration needed** — `com.formulab.app` is already correct and already
in use; this session is narrower than the original "app-data
compatibility migration" framing implied, since there is no directory
to migrate.
**Files allowed to change**: `apps/desktop/src/lib/store.ts`,
`apps/desktop/src/components/settings/modelPreferences.ts`,
`apps/desktop/src/i18n/config.ts`, and their `.test.ts` files.
**Compatibility risks**: medium if renamed without a fallback (one-time
silent prefs reset per user); none if left as-is or migrated with a
fallback.
**Focused tests**: `store.test.ts`, any `modelPreferences` test file,
i18n config tests.
**Commit**: `refactor(naming): migrate persisted localStorage keys`
(if renamed) or `docs(phase9): confirm app-data identifiers already
migrated, no localStorage rename needed` (if the decision is to leave
them as-is — either is a valid session outcome).

### Session 4 — Scripts, CI, docs, and tests
**Scope**: `.github/workflows/build.yml` (already-handled artifact line
excepted — done in Session 2), `README.md`'s two `@ai4s/desktop`
example commands (tied to Session 1's actual chosen scope name),
`AGENTS.md`'s stale/false bundle-identifier claim (fix regardless of
timing — it is wrong today), `LICENSE` copyright holder,
`docs/REQUIREMENTS.md`'s `@ai4s/shared` reference,
`docs/INFORMATION_ARCHITECTURE.md:157` (mark the migration item done).
Explicitly confirm-and-skip: `docs/PRD.md`/`docs/TECHNICAL_DESIGN.md`
(large founding-spec rewrite, out of bounded scope — flag as an open
question for the user rather than silently rewriting or silently
skipping), `docs/CONNECT_YOUR_TOOLS.md:71` and
`apps/desktop/src/i18n/locales/en/pages.json:94` (correctly name the
external `ai4s-skills` dependency — must NOT change), `scripts/dev/
fetch-skills.sh` and its `AI4S_SKILLS_COMMIT` var (external dependency
— must NOT change).
**Files allowed to change**: exactly the list above; nothing under
`docs/handoffs/`, no external log, no PRD/TECHNICAL_DESIGN unless the
user explicitly requests that separate rewrite.
**Compatibility risks**: low — docs/CI text only, one YAML line already
covered in Session 2.
**Focused tests**: none required; sanity-check modified YAML parses.
**Commit**: `docs(naming): update scripts, CI, and docs for FormuLab
naming`

### Session 5 — Focused verification
**Scope**: run what Session 0 deliberately skipped — full shared +
desktop + Rust regression, typecheck, lint, clippy — to catch any
straggler `@ai4s`/`ai4s-workbench` reference the mechanical renames in
Sessions 1–4 missed. Final repo-wide `ai4s`-case-insensitive grep sweep,
confirming every remaining match falls into an accepted category
(external `ai4s-skills` dependency, historical/dated docs, intentionally
unchanged localStorage keys if that was the Session 3 decision).
**Files allowed to change**: only files needed to fix a genuine defect
found during verification — same fix-policy as every prior verification
session (confirm it's migration-caused, fix only that, rerun, rerun
full set once).
**Compatibility risks**: none (verification only).
**Focused tests**: full regression (shared/desktop/Rust), matching
Phase 8 Session 7's pattern.
**Commit**: only if a genuine defect is fixed —
`fix(naming): resolve phase 9 verification defects` — otherwise no
commit.

### Session 6 — Closure and release
**Scope**: full regression, release build, installer artifact
verification (path/size/SHA-256 under the new binary name), shortcut
backup+refresh+relaunch verification (first real end-to-end proof the
renamed executable launches correctly from the user's actual shortcut),
rewrite `IMPLEMENTATION_STATUS.md` and this handoff into closed-state
documents, final external-log closure entry.
**Files allowed to change**: `docs/architecture/IMPLEMENTATION_STATUS.md`,
`docs/handoffs/PHASE9_CURRENT.md`, the external log — plus any
last-mile fix discovered during closure regression.
**Compatibility risks**: none new: this is where the Session 2 binary
rename gets its first full real-user-path verification.
**Commit**: `chore(naming): close phase 9`

## Safety rules applied throughout
- Never touch `.FormuLab/runs.db` or any file under the real
  `%APPDATA%\com.formulab.app` — that directory is already correctly
  named and holds genuine project history; no session in this plan
  proposes touching its contents.
- No app-data directory is being orphaned — `com.formulab.app` is not
  changing.
- No saved project is at risk — nothing in Sessions 1–6 touches
  `packages/shared/src/schemas/*.ts` persisted-record shapes; confirmed
  during Session 0 that no schema field, generated-id prefix, or magic
  string contains `ai4s`.
- Compatibility aliases: Session 2's shortcut refresh is the in-repo
  alias mechanism for the binary rename (out-of-repo user automation is
  an accepted, disclosed risk, not something this repo can fix);
  Session 3 explicitly decides whether `localStorage` keys need a
  legacy-read alias.
- Historical logs and old release hashes (Phase 1–8 handoffs, the
  external Phase-log `.md` files, `TAURI_LIVE_VERIFICATION.md`, dated
  `IMPLEMENTATION_STATUS.md` closure paragraphs) are never rewritten
  retroactively — confirmed as category 4 above, no session in this
  plan touches them.

## Session 4 final grep report
Every remaining `ai4s`/`AI4S` match after this session's fixes,
categorized:

1. **Historical, intentionally preserved**: `PROGRESS.md` (a dated,
   timestamped dev journal — every entry describes what was literally
   true on that date, including the original `com.ai4s.workbench`
   identifier and `@ai4s/*` packages before any of Phase 9's renames);
   `docs/TAURI_LIVE_VERIFICATION.md` (records exact PIDs/exe-names from
   a specific past verification run — editing it would misrepresent
   what was actually observed then); `docs/architecture/
   CURRENT_STATE_AUDIT.md` (explicitly framed as "the repository as it
   exists at the start of the Kenya R&D platform transformation" — a
   point-in-time baseline, not a living doc); `docs/handoffs/
   PHASE8_CURRENT.md` (a closed phase's closure record, including its
   own accurate `ai4s-workbench.exe` SHA-256 from that build);
   `docs/handoffs/PHASE9_CURRENT.md` (this file — inherently discusses
   `ai4s` throughout as the subject of the migration itself);
   `scripts/windows/verification-logs/verify-20260730-145741.log` (a
   dated log file); `docs/PRD.md`/`docs/TECHNICAL_DESIGN.md` (founding
   specs — Session 0 already flagged these as an open question rather
   than force-rewriting; no passage has since been marked active and
   misleading, so left untouched per this session's explicit
   instruction); `docs/architecture/IMPLEMENTATION_STATUS.md`'s line
   ~979 (an older phase's closure paragraph, correctly dated).
2. **External dependency, intentionally preserved**: the entire
   `runtime/skills/external/ai4s-skills/` tree (verbatim upstream
   content from `ai4s-research/ai4s-skills`); `scripts/dev/
   fetch-skills.sh` and its `AI4S_SKILLS_COMMIT` env var;
   `.github/workflows/build.yml`'s "Fetch bundled ai4s-skills pack"
   step name; `runtime/skills/README.md` (entirely about naming/
   documenting that real external pack correctly); `runtime/
   opencode-profile/README.md`'s "the bundled ai4s-skills pack" line;
   `docs/CONNECT_YOUR_TOOLS.md`'s "the `ai4s-skills` pack" line; all 8
   locales' `i18n/pages.json` "bundled ai4s-skills pack" UI string.
3. **Legacy compatibility identifier, intentionally preserved**: the
   `LEGACY_*` `localStorage` key constants and their tests in
   `apps/desktop/src/lib/store.ts`/`.test.ts`,
   `components/settings/modelPreferences.ts`/`.test.ts`,
   `i18n/config.ts`/`.test.ts` (Session 3's migration keys — reading
   `ai4s.*` once, never rewritten).
4. **Generated artifact, ignored**: `.aider.tags.cache.v4/cache.db`
   (a third-party dev-tool cache); `apps/desktop/src-tauri/binaries/
   opencode-x86_64-pc-windows-msvc.exe` (a bundled third-party binary,
   not ours); the two `__pycache__/*.pyc` files inside the external
   `ai4s-skills` tree (compiled bytecode of that external pack).
5. **Unexpected first-party stale match**: none. Empty — completion
   criterion met.
6. `docs/INFORMATION_ARCHITECTURE.md:157` — not force-classified above
   since it needs its own note: "The `ai4s` → `FormuLab` package/
   identifier naming migration" appears in a list of topics this
   particular doc does not cover. That statement is still accurate
   today (the doc still doesn't cover the migration's mechanics) — it
   is a scope disclaimer, not a claim about migration progress, so it
   was left as-is; it will naturally read as historical once Phase 9
   fully closes.

## Exact next session
Phase 9 Session 5: Focused Verification and Final Naming Sweep.
