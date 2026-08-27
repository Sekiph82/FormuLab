# FormuLab File Consolidation Report

Phase 10 Session 8. Consolidates user-created FormuLab-related files that
had accumulated outside `C:\Users\sekip\Desktop\FormuLab` back into the
repository, with two explicitly approved exceptions.

**Approved Desktop exceptions: FormuLab.lnk and FormuLab-Phase10-User-Guide-In-App-Help-Log.md**

## Method

Searched `C:\Users\sekip\Desktop`, `C:\Users\sekip\Documents`,
`C:\Users\sekip\Downloads`, `C:\Users\sekip` (recursive, depth 3, hidden
items included), and checked for additional drives (`D:\`, `E:\` — not
present on this machine) for any path matching `formulab` (case
insensitive), then individually inspected every match's contents before
deciding move/skip/keep — never classified by filename pattern alone, and
never classified a file as related solely because its content mentions a
generic term like "formula" or "laboratory".

## Inventory and decisions

| Path | Type | Size | Reason considered FormuLab-related | Decision | Destination |
|---|---|---|---|---|---|
| `Desktop\FormuLab` | dir | — | is the repository itself | not moved (destination) | — |
| `Desktop\FormuLab.lnk` | file | 2,432 B | app launch shortcut | **KEEP IN PLACE — approved Desktop exception** | — |
| `Desktop\FormuLab-Phase10-User-Guide-In-App-Help-Log.md` | file | 53,354 B | active external session log for this phase | **KEEP IN PLACE — approved Desktop exception** | — |
| `Desktop\FormuLab Claude Code Logs\*.md` (11 files) | files | 432 KB total | historical per-phase Claude Code session logs (Phase 2–9 closures), superseded/inactive — the current active log is the one listed above | moved | `project-control/claude/logs/` |
| `Desktop\formulab screenshots\*` (5 phase-verification subfolders, 338 files) | dirs+files | 78 MB total | manual verification screenshots captured during Phases 3–6 closures | moved | `docs/screenshots/` (original subfolder names and structure preserved) |
| `AppData\Local\com.formulab.app\EBWebView` | dir | — | Tauri/WebView2 runtime cache, not user-created content | skipped — runtime dependency cache, explicitly excluded by the safety rules | — |
| `AppData\Local\Temp\formulab-runidx-*` (5 sets) | files | small | active run-index temp/lock files, most with today's timestamp | skipped — temporary lock files, explicitly excluded | — |
| `AppData\Roaming\com.formulab.app\` (`debug.log`, `runtime/`) | dir | — | this is the app's real, canonical `%APPDATA%\com.formulab.app` profile — real application data | **technical exception — left in place, not moved** | — |
| `OneDrive\Documents\FormuLab\` (`data/{formulations,literature,master,sessions}`, `formulas/`) | dir | — | an alternate real FormuLab project-data root (real formulation/session/master records, not a fixture) — same shape as the repo checkout's own gitignored `data/`/`formulas/` | **technical exception — left in place, not moved** | — |
| `.claude\projects\C--Users-sekip-Desktop-FormuLab\` | dir | — | Claude Code's own session-transcript storage for this project, not a user-created FormuLab file | skipped — tool infrastructure, out of scope | — |
| `Desktop\fmcg-erp-system`, `Desktop\fmcg-erp-system-main` | dirs | — | inspected (`package.json`/`README.md`/`AGENTS.md` present) — a distinct FMCG ERP project, unrelated domain and codebase | skipped — belongs to another project | — |
| `Desktop\PackLab 3D`, `Desktop\PackLab3D_StageLog.md` | dir+file | — | inspected — a distinct packaging-design project ("PackLab"), unrelated codebase | skipped — belongs to another project | — |
| `Desktop\graphify-erp-maps` | dir | — | unrelated project name, no FormuLab content indicators | skipped — belongs to another project | — |

No duplicate FormuLab git repository was found anywhere outside the main
repository (the recursive scan found no second `.git`-containing folder
matching `formulab`). No stray installers, `.msi`/`.exe`/`.pdf`/`.docx`
release artifacts, or shortcut backups were found outside the repository
beyond what is listed above.

## Moves performed

Both destination folders (`project-control/claude/logs/`, `docs/screenshots/`) did
not exist before this session — every moved file landed at a fresh path,
so no name collisions occurred and no hash-based duplicate resolution was
needed. Original filenames and the screenshot folder structure (one
subfolder per phase-verification batch) were both preserved exactly.

**Verification**: file count and total size were compared before and
after the move for each batch (moves were same-volume renames, not
copies, so this is the meaningful integrity check here):

| Batch | Before | After |
|---|---|---|
| `project-control/claude/logs/` | 11 files, 432 KB | 11 files, 432 KB |
| `docs/screenshots/` | 338 files, 78 MB | 338 files, 78 MB |

The two now-empty source folders (`Desktop\FormuLab Claude Code Logs`,
`Desktop\formulab screenshots`) were left in place as empty shells —
consistent with the "do not delete anything" safety rule, which applies
to directories as well as files.

## Application-data exceptions

Two locations hold **real** FormuLab application/project data and were
deliberately **not** touched by any raw filesystem move, per the
consolidation task's explicit application-data-inspection rule:

1. `C:\Users\sekip\AppData\Roaming\com.formulab.app` — the app's real,
   canonical profile directory (`debug.log`, `runtime/`).
2. `C:\Users\sekip\OneDrive\Documents\FormuLab` — a real, alternate
   FormuLab project-data root (`data/formulations`, `data/literature`,
   `data/master`, `data/sessions`, `formulas/`), not currently the active
   root (no `formulab-root.txt` override was found pointing at it), but
   containing genuine, non-fixture records that must not be moved,
   merged, or overwritten by an ad hoc file operation.

FormuLab has no documented, supported command for relocating either of
these roots in-place (only the existing, already-safe, human/opt-in
`formulab-root.txt` override, which points the app *at* a location — it
is not itself a migration tool). Since no safe, supported relocation
mechanism exists, both are recorded here as **technical
exceptions** and left exactly where they are. Consolidation is not
complete with respect to these two paths, and this report does not claim
otherwise.

## Post-move checks

- Every moved item exists at its documented destination (confirmed by
  the count/size table above).
- No source or documentation path referencing the old external
  locations existed to begin with (neither `docs/USER_GUIDE.md` nor any
  other tracked doc referenced `Desktop\FormuLab Claude Code Logs` or
  `Desktop\formulab screenshots` by path) — nothing to update.
- The repository's own build/test tooling does not reference either new
  folder — `project-control/claude/logs/` and `docs/screenshots/` are inert
  archival content, not consumed by the guide exporters (which read
  `docs/USER_GUIDE.md` and the separate, still-empty Phase 10 screenshot
  manifest sweep — unrelated to this archival material).
- The active Desktop log
  (`Desktop\FormuLab-Phase10-User-Guide-In-App-Help-Log.md`) still exists
  at its original path and remains writable — confirmed by this
  session's own continued edits to it.
- Repository build/test status: see the Session 8 regression results in
  `project-control/claude/handoffs/PHASE10_CURRENT.md` — full desktop suite, typecheck, and
  lint all green after these changes (moving archival, non-code files
  does not affect the build).

## Summary

Consolidated: 11 external log files + 338 screenshot files (349 files,
~78.4 MB total) moved into the repository. Kept in place: the two
approved Desktop exceptions. Left in place, undocumented-migration-path,
recorded as technical exceptions: two real application/project data
roots. Skipped: runtime caches, active temp/lock files, Claude Code's own
tool infrastructure, and every folder belonging to a different, unrelated
project. No files were deleted. No duplicate repositories were found.
