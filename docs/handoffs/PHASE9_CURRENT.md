# Phase 9 — `ai4s`/`AI4S` → FormuLab Naming Migration

## Status: CLOSED (2026-07-31)

Every first-party `ai4s`/`AI4S` identifier — npm package scope, Rust
crate/binary, persisted `localStorage` keys, active scripts/docs/
comments — has been migrated to FormuLab naming, with compatibility
preserved throughout (legacy-read fallbacks for storage keys, a
refreshed desktop shortcut for the renamed binary, zero touch to
`%APPDATA%\com.formulab.app`, which was already correctly named before
this phase). Full details of each session's exact scope, files, and
reasoning live in `C:\Users\sekip\Desktop\FormuLab-Phase9-Naming-Migration-Log.md`
(append-only) and in `docs/architecture/IMPLEMENTATION_STATUS.md`'s
"Identity Rename" closed section. This document is the concise
closed-state summary.

## Final migration summary

| Session | Scope | Result |
|---|---|---|
| 0 | Assessment — full naming inventory, 6-session plan | Found `productName`/`identifier` already correct; scoped the rest |
| 1 | npm package/import namespace | `@ai4s/*` → `@formulab/*`, 125 files |
| 2 | Rust crate/binary/product naming | `ai4s-workbench`/`ai4s_workbench_lib` → `formulab`/`formulab_lib`; shortcut refreshed |
| 3 | Persisted `localStorage` keys | 8 keys migrated with one-time legacy-read fallback, zero data loss |
| 4 | Scripts, CI, docs, comments, test naming | 18 files; fixed a false claim in `AGENTS.md` |
| — | *Out-of-band*: sidebar navigation consolidation (unrelated to naming, tracked here for continuity) | 15 flat items → 10 grouped top-level entries |
| 5 | Focused verification + final naming sweep | Root-caused and fixed the `download.test.ts` failure (a vitest/chai tooling bug, not app code); category 5 confirmed empty |
| 6 | Closure and release | This document |

## Full test totals (Session 6 closure regression)
Shared: 1199/1199 tests, typecheck clean. Desktop: 736/736 tests
(95 files — zero red, including the Session 5 fix staying green),
typecheck clean, lint clean, i18n parity clean. Rust: 82/82 tests,
`cargo clippy --all-targets --all-features -- -D warnings` clean.
Python: no test infrastructure exists for the one file Phase 9 touched
(`runtime/kernel/kernel_bridge.py`, a docstring-only change) — nothing
to run.

## Release artifacts
Built via `pnpm --filter @formulab/desktop exec tauri build`.

| Artifact | Path | Size | Last modified | SHA-256 |
|---|---|---|---|---|
| Executable | `apps/desktop/src-tauri/target/release/formulab.exe` | 21,893,632 B | 2026-07-31 10:44:57 | `d899da997a224989ef2a726f93d1d636fe539144415eb4b398c57e1d96fbe67e` |
| MSI installer | `.../bundle/msi/FormuLab_0.4.0_x64_en-US.msi` | 36,540,416 B | 2026-07-31 10:44:12 | `b671a373519a376dc8a0373d6e63836217319fbec813edc1c221c9ef5763bbdc` |
| NSIS installer | `.../bundle/nsis/FormuLab_0.4.0_x64-setup.exe` | 24,944,712 B | 2026-07-31 10:44:57 | `56deaaec0aa3944f0663eb54edc19b5089aaaa0d143d550860476af0090d2ae3` |

Confirmed: Cargo package `formulab`, lib crate `formulab_lib`, shipped
executable `formulab.exe`, `productName: "FormuLab"`, bundle identifier
exactly `com.formulab.app` (unchanged), installer filenames
FormuLab-branded. No release artifact depends on `ai4s-workbench.exe`.
(A stale pre-rename `ai4s-workbench.exe` + `.pdb`/`.d` sit in the
gitignored `target/release/` build-output directory from before Session
2 — build-cache debris, not shipped, not referenced by anything active.)

## Shortcut
`C:\Users\sekip\Desktop\FormuLab.lnk` backed up to
`FormuLab.lnk.bak-20260731-104541` before this session's refresh
(target was already correct from Session 2; refreshed explicitly anyway
per instruction — target/working-directory/icon/no-arguments all
reconfirmed against the fresh build).

## Native verification: PARTIALLY LIVE VERIFIED
Launched the real packaged executable through the actual `.lnk` file.
Confirmed: real process `formulab`, `MainWindowTitle` == `FormuLab`,
executable path matches the fresh release build, app opened without
startup error. Real keyboard-driven interaction (Tab/Enter, not just a
static screenshot) confirmed live: Home page renders, the sidebar shows
the consolidated structure with visible focus rings, the Regulatory
accordion group expands on Enter showing its 4 real children, the
active child (Dossiers) gets both a visible focus ring and persistent
active-highlight styling while its parent group stays expanded,
real existing project data loads successfully (`TEST-FORM-0…`,
`HH-HANDSOAP-…`, `HC-SHAMPOO-…` — genuine reads, zero writes). No stale
`AI4S Workbench` branding appeared anywhere in the live window.
`%APPDATA%\com.formulab.app` file count reconfirmed identical (19,677)
before and after the entire session's launch/interact/close sequence —
nothing was lost, moved, or altered.

Not confirmed live: Sessions-pinned-above-Settings specifically,
because this environment's virtual display is 1280×800 — smaller than
FormuLab's own window (1295×815) — so no single screenshot can show an
expanded accordion group and the pinned Sessions/Settings footer
simultaneously. This is the same disclosed, unavoidable environment
constraint recorded in every prior native-verification session in this
project (`docs/TAURI_LIVE_VERIFICATION.md`, Phase 7/8 closures) — not
new, not a regression. That specific behavior is instead verified by
`Sidebar.test.tsx`'s dedicated automated test ("keeps Sessions and
Settings visible alongside a long navigation and session list"),
passing in the 736/736 total above.

## Final naming sweep
Category 5 (unexpected first-party stale match): **empty**, reconfirmed
at closure. Explicitly verified: zero first-party `@ai4s/*`, zero
first-party `ai4s-workbench` (only a dated verification log and the
external pack match), zero first-party `ai4s_workbench_lib` (only a
dev-tool cache and this document's own description of the rename
match), zero active command points to `ai4s-workbench.exe`. Remaining
matches, all intentionally preserved: 8 historical/founding-doc files
(dated journals, closed handoffs, point-in-time audits, verification
reports describing a specific past build — never rewritten
retroactively), 1 external dependency tree (`ai4s-research/ai4s-skills`
— the fetch script, its `AI4S_SKILLS_COMMIT` env var, and every correct
UI/doc reference to it), the 8 `LEGACY_*` `localStorage` constants and
their tests (intentional, one-way compatibility reads), and a handful
of dev-tool-generated caches/binaries.

## Accepted compatibility decisions
- `%APPDATA%\com.formulab.app` was never touched by this migration —
  it was already correctly named before Phase 9 began. No app-data
  directory was ever orphaned.
- Legacy `ai4s.*` `localStorage` keys remain readable (one-time
  migration source, checked only when the new `formulab.*` key is
  absent) but are no longer primary write targets — every write goes
  only to the new key, and the legacy key is never deleted.
- Historical logs, hashes, paths, and closed handoffs (Phases 0–8, and
  this phase's own Sessions 0–5) remain exactly as originally recorded
  — none were rewritten retroactively during closure.
- The external `ai4s-research/ai4s-skills` dependency's naming is
  completely unchanged — it is a real third-party project this app
  bundles, not this app's own branding.
- No binary alias/shim for `ai4s-workbench.exe` was created — the
  repository never required one internally (every in-repo reference was
  updated directly). Any out-of-repo script, pinned taskbar entry, or
  automation that still hardcodes the old filename must be updated
  manually; this is a disclosed, accepted, un-fixable-from-here
  limitation, not an oversight.

## Remaining limitations
Deep interior click-through beyond what Session 6 exercised (e.g.
Dossiers export flow, Data Exchange import) was not driven live this
session — out of scope for a naming-migration closure, and the
underlying behavior is already covered by Phase 8's own closure
verification, unaffected by this phase's renames (confirmed by the full
green regression above). Stale pre-rename build debris
(`ai4s-workbench.exe`/`.pdb`/`.d`) remains in the gitignored
`target/release/` directory — harmless, not shipped, cleared by a
normal `cargo clean` whenever convenient, not addressed here since it
is generated output, not source.

## Final Phase 9 status
**CLOSED.** All 6 sessions (0–5) plus this closure session complete.
Full regression green across shared/desktop/Rust. Release built and
verified. Shortcut refreshed and live-launch-verified. Zero unexpected
first-party `ai4s`/`AI4S` naming remains.
