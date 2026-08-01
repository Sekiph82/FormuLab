# Phase 11 — Backup, Restore and Data Safety

## Status: SESSION 0 (Assessment and Data Safety Planning) COMPLETE. Awaiting Session 1.

## Priority order for Phase 11 (as given, unchanged)

**First stage** (this phase's scope): backup and restore, backup
verification, schema migration system, active data-location
clarification, basic diagnostics and log export.

**Second stage** (deferred, not designed beyond dependency notes):
automatic backups, Data Location Manager, update checker.

**Commercial-distribution stage** (deferred, not designed at all):
signed installers/updates, automatic rollback.

## Session 0 summary

Pure assessment and planning — no application code changed, no real
data touched, no destructive or generative operation run. Full findings
live in four dedicated architecture/inventory documents (below); this
handoff summarizes and points to them, per this repository's existing
"one summary, details in the dedicated doc" convention.

### Key finding: the storage layer is more layered than it first appears
Three independent root-pointer files
(`formulab-root.txt`/`base-workspace.txt`/`active-workspace.txt`, all
under `app_data_dir()/runtime/`) feed two distinct resolution functions
(`formulation_v2::project_root()` for all real user data;
`workspace::workspace_dir()`/`base_workspace_dir()` for the kernel/
provenance/run-log surface). No module resolves a path independently of
these two functions — confirmed by grep across every file in
`apps/desktop/src-tauri/src` — but the two-funnel design itself, plus
`formulab-root.txt` having no writer or exposing UI command anywhere in
the codebase, means Settings can silently display the wrong root
relative to where formulations/master-data actually live. Full detail:
[`docs/PHASE11_DATA_INVENTORY.md`](../PHASE11_DATA_INVENTORY.md).

### Key finding: a real migration mechanism already exists, unused
`packages/shared/src/engine/migrations.ts` (documented in
`docs/MIGRATIONS.md`) is a working, tested, per-collection migration
runner — registered against **zero** collections today, because every
one of the 90 master collections has only ever shipped at
`schemaVersion: "1.0"`. Session 3 extends this mechanism (journal,
pre-migration verified backup requirement, future-version rejection,
global version marker) rather than building a second one. Full detail:
[`docs/PHASE11_MIGRATION_ARCHITECTURE.md`](../PHASE11_MIGRATION_ARCHITECTURE.md).

### Key finding: two real git-tracking anomalies, recorded not fixed
`.gitignore` marks `/data/` and `/formulas/` as "local user output,
deliberately not committed," yet `formulas/*.md` + `formulas/index.json`
and `.FormuLab/runs.db` are all tracked in git (pre-dating or bypassing
that rule — `.gitignore` never retroactively untracks a file). `runs.db`
being tracked is doubly unusual since its own module documents it as a
disposable, rebuildable index. Neither was touched or corrected this
session (out of scope; Session 0 does not modify working-tree state).

### Key finding: one real, evidenced secret-handling risk for backup design
The LLM API key is stored in plaintext `localStorage`
(`formulab.v2.key.<provider>`), which lives inside the WebView2 profile
(`%APPDATA%\com.formulab.app\EBWebView`). A naive file-level backup of
`app_data_dir()` would sweep this up; the backup architecture excludes
`EBWebView` entirely, both because it is a regenerable runtime cache and
specifically to keep this key out of any backup package. Full detail:
[`docs/PHASE11_BACKUP_RESTORE_ARCHITECTURE.md`](../PHASE11_BACKUP_RESTORE_ARCHITECTURE.md).

### Key finding: no crash-dump, no diagnostics command, no build-id today
Confirmed by grep: zero matches for Sentry/crash-report/panic-hook/
ErrorBoundary anywhere in `apps/desktop/src`. The only persistent app
log is `debug.log` (unrotated, uncapped, free-text). Session 5's
diagnostics design is scoped to what can honestly be built on top of
this today, not a crash reporter. Full detail:
[`docs/PHASE11_DIAGNOSTICS_ARCHITECTURE.md`](../PHASE11_DIAGNOSTICS_ARCHITECTURE.md).

### Test plan
[`docs/PHASE11_TEST_MATRIX.md`](../PHASE11_TEST_MATRIX.md) — per-session
focused-test plan for Sessions 1-5, against this repo's real confirmed
test conventions (`vitest run` via `pnpm --filter`, inline `#[cfg(test)]`
Rust modules). No full-suite run happens until a future closure session.

## What was explicitly not done this session

- No backup, restore, migration, diagnostics, automatic-backup, Data
  Location Manager, update-checking, signing, or rollback code was
  written.
- No real data (`.FormuLab/runs.db`, any real user record, anything
  under `%APPDATA%\com.formulab.app`, `OneDrive\Documents\FormuLab`, or
  any other production data root) was moved, copied, merged, deleted,
  repaired, or normalized.
- No full desktop/shared/Rust suite, typecheck, lint, or build was run —
  only lightweight read-only inspection.
- No historical Phase 0-10 handoff or log was modified.

## Deferred items (recorded, not designed beyond noting dependencies)

- **Second stage**: automatic backups (depends on Session 1's backup
  mechanism existing first), Data Location Manager (depends on Session
  4's active-data-location clarification existing first — a manager UI
  needs a single reconciled root-resolution story to manage), update
  checker (independent of the rest, no dependency found).
- **Commercial distribution stage**: signed installers/updates (would
  depend on a release-build/CI pipeline this session did not inspect —
  out of scope), automatic rollback (depends on the restore mechanism
  from Session 1 existing and proving reliable first).

## Inspection commands run this session

See each architecture/inventory doc's own "Method"/"evidenced" citations
for the exact `Read`/`Grep`/`Glob`/`git` commands that informed it —
recorded once per document rather than duplicated here.

## Exact next session

**Phase 11 Session 1: Backup and Restore Foundation.**
