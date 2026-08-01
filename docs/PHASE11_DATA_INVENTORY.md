# Phase 11 Data Inventory

Session 0. Exact inventory of every location FormuLab currently stores,
reads or generates data, built by tracing real read/write paths in the
source — never by filename pattern alone. Every row below cites the
source file and line that was actually read.

## Method

Commands run to build this inventory (all read-only):

```
git status --short --branch ; git rev-parse HEAD ; git rev-parse '@{u}'
Glob apps/desktop/src-tauri/src/*.rs
Grep "formulab-root|formulab_root|data_root|dataRoot|DataRoot" apps/desktop/src-tauri/src
Read apps/desktop/src-tauri/src/{formulation_v2,workspace,masterdata,formulations,
     materials,formulation,attachments,runs,runs_index,debug_log,provenance,compute}.rs
Grep "project_data_dir|project_root|app_data_dir" apps/desktop/src-tauri/src
Grep "localStorage\.(setItem|getItem)" apps/desktop/src
Read apps/desktop/src/lib/store.ts, apps/desktop/src/lib/formulationV2.ts
Grep "schemaVersion" packages/shared/src/schemas
Read packages/shared/src/engine/migrations.ts, docs/MIGRATIONS.md
Read apps/desktop/src-tauri/Cargo.toml, apps/desktop/src-tauri/tauri.conf.json
git ls-files formulas data .FormuLab | head ; cat .gitignore
```

## Root-resolution layer (read first — everything else sits under one of these)

Three independent, file-backed root pointers exist. All live under
`app_data_dir()` (`%APPDATA%\com.formulab.app` on Windows), which Tauri
resolves from the app identifier `com.formulab.app`
(`apps/desktop/src-tauri/tauri.conf.json:5`).

| Pointer file | Resolved by | Falls back to | Evidence |
|---|---|---|---|
| `runtime/formulab-root.txt` | `formulation_v2::project_root()` | `workspace::base_workspace_dir()` | `formulation_v2.rs:61-72` |
| `runtime/base-workspace.txt` | `workspace::base_workspace_dir()` | `~/Documents/FormuLab` (via `document_dir()`, else `$HOME`/`$USERPROFILE`/Documents) | `workspace.rs:25-67` |
| `runtime/active-workspace.txt` | `workspace::workspace_dir()` | `base_workspace_dir()` | `workspace.rs:20-42` |

`project_root()` is what **all real user data** (formulations, master
data, sessions, literature, formulas, attachments) resolves under —
confirmed by grepping every caller of `project_data_dir`/`project_root`:
`formulations.rs:17`, `masterdata.rs:408`, `materials.rs:30`,
`attachments.rs:49`, `artifact_file.rs:111`. `workspace_dir()` (the
**active** workspace, separate from `project_root()`) is what the kernel,
Jupyter, provenance, artifacts and run logs resolve under:
`kernel.rs:566`, `jupyter.rs:221`, `provenance.rs:618/632/642`,
`artifact_file.rs:196/485`, `runs.rs:390/422/428`.

**No module resolves a storage path independently of these three
functions.** Every `app_data_dir()` call outside `workspace.rs`/
`formulation_v2.rs` (`formulation_advanced.rs:37`, `debug_log.rs:9`,
`formulation.rs:25`, `jupyter.rs:44`, `kernel.rs:96,298`) is for an
app-private code/log cache, not user data — see the cache rows below.

## Inventory

### 1. `data/formulations/<id>/formulation.json`, `versions/<versionId>.json`, `approvals/`, `audit.jsonl`, `attachments/`
- **Resolution**: `project_root()/data/formulations/<safe_id>` — `formulations.rs:16-18,36-38`.
- **Classification**: authoritative user data.
- **Format**: JSON per file; `audit.jsonl` append-only JSON Lines.
- **Schema/version**: each JSON body carries `schemaVersion: "1.0"` (Zod
  literal) — `packages/shared/src/schemas/formulation.ts:153,203,233,355`.
  No manifest-level version over the folder.
- **Writer/reader**: `formulations.rs` Tauri commands (list/save/approve);
  read by the desktop UI via `@tauri-apps/api/core` invoke.
- **Backup**: include. Cannot be regenerated — versions are immutable and
  irreplaceable once created (`formulations.rs:8-11`).
- **Secrets/PII**: may contain project/customer names in briefs; no
  credentials.
- **Locking**: plain files, write-then-no-rewrite for versions (never
  reopened for write); safe to copy while running except for a file mid
  write (see atomicity note below — `save` is not lock-free at the OS
  level, only application-level "never overwrite").
- **Restore ordering**: formulation.json before its versions/ (versions
  reference the parent by directory nesting, not by a written pointer,
  so no strict order is actually required — noted as low-risk).
- **Compatibility risk**: none known; schema has been additive-only per
  `docs/architecture/IMPLEMENTATION_STATUS.md`'s repeated "additive
  fields" pattern.

### 2. `data/master/<collection>.json` — 90 collections
- **Resolution**: `project_root()/data/master/<collection>.json` —
  `masterdata.rs:407-416`. Allow-listed name + mutability flag in the
  `COLLECTIONS` array (`masterdata.rs:122`, length asserted at
  `masterdata.rs:718-722`, 66 mutable / 24 append-only by the dossier/
  claims/DOE/data-exchange/reverse-formulation sub-lists checked in the
  same test module).
- **Classification**: authoritative user data (raw materials, suppliers,
  prices, trials, stability, regulatory, dossiers, claims, labels, DOE,
  substitution, reverse formulation, data-exchange job records, document
  export history — full list in `masterdata.rs:6-86`).
- **Format**: one JSON array per collection.
- **Schema/version**: per-record `schemaVersion` field, `"1.0"` for every
  collection that sets one (24 schema files confirmed via grep); no
  collection-level or global version file.
- **Writer/reader**: `list_master_records`/`upsert_master_records`/
  `delete_master_record` (`masterdata.rs:448-539`) — write-then-rename
  (`write_array`, `masterdata.rs:427-435`), so an interrupted write cannot
  truncate the file.
- **Append-only enforcement**: `upsert_master_records` refuses to
  overwrite an existing row's key in an append-only collection
  (`masterdata.rs:478-489`); `delete_master_record` refuses outright on
  append-only collections (`masterdata.rs:525-531`).
- **Backup**: include, all 90. None can be regenerated except by
  re-entering the data.
- **Secrets/PII**: supplier contacts, customer/claims names possible; no
  credentials.
- **Locking**: none at OS level; app never holds a file open.
- **Restore ordering**: none required — each collection file is
  independent (cross-references are by id string, not filesystem
  linkage).
- **Compatibility risk**: none currently registered (see Migration
  Architecture doc) — every collection has always launched at `"1.0"`.

### 3. `data/master/backups/<collection>-<timestamp>.json` — existing ad hoc safety mechanism
- **Resolution**: `master_dir()/backups/` — `masterdata.rs:551-565`.
- **Classification**: generated (a point-in-time copy), non-authoritative
  once the live collection has moved on, but the only existing "undo" for
  a destructive master-data change today.
- **Writer**: `backup_collection()`, called before `delete_master_record`
  (`masterdata.rs:534`) and by the standalone
  `backup_master_collection` command (`masterdata.rs:542-549`).
- **Backup**: excluded from a full-project backup by default (it is
  itself backup output, not primary data) — see open question in the
  architecture doc about whether to fold this mechanism into Phase 11's
  new backup system rather than run two parallel ones.
- **Compatibility risk**: unbounded growth — nothing prunes this
  directory today; flagged, not fixed, this session.

### 4. `data/sessions/<id>/` — brief.json + generated candidate cards
- **Resolution**: `project_root()/data/sessions/` —
  `formulation_v2.rs:140` (`data_dir(&app, &["data", "sessions"])`).
- **Classification**: authoritative user data (only successful runs are
  kept — `formulation_v2.rs:14-16`).
- **Format**: JSON (brief) + Markdown (candidate cards).
- **Backup**: include; not regenerable (re-running the pipeline produces
  different literature-search/LLM output, not the same session).
- **Secrets/PII**: brief text may name real products/targets; no
  credentials (the API key used to generate it is never written here —
  see the localStorage row).

### 5. `data/literature/` — shared paper/PDF cache
- **Resolution**: `project_root()/data/literature/` —
  `formulation_v2.rs:138`.
- **Classification**: ambiguous by design — `literature_cache.py`
  (`runtime/pipeline/literature_cache.py:323`) is explicitly "cache-first"
  against the network, so it is in principle regenerable, but
  regeneration requires network access and re-fetches may not return
  byte-identical PDFs (source sites change/remove content over time).
  Treated here as **should-back-up-if-present, not required**.
- **Backup**: optional/excluded-by-default candidate — flagged for a
  decision in Session 1, not decided this session (instructions forbid
  deciding data ownership without more evidence than a comment in one
  Python file).
- **Secrets/PII**: none (published literature + metadata).

### 6. `formulas/` — flat library of every generated formula card + `formulas/index.json`
- **Resolution**: `project_root()/formulas/` — `formulation_v2.rs:139`.
- **Classification**: authoritative user data (one Markdown card per
  generated formula version, `index.json` summarizing all of them — read
  directly, `formulas/index.json:1-30`).
- **Format**: Markdown cards + one JSON index array.
- **Git status anomaly (real, evidenced)**: `.gitignore:88` marks
  `/formulas/` "Generated formula library (user output, kept local)" —
  yet `git ls-files formulas` returns real tracked files
  (`formulas/2026-07-18-*.md`, `formulas/index.json`), and
  `git status --short` shows `formulas/index.json` as **modified** at
  session start. `.gitignore` rules never retroactively untrack a file
  already committed — these files were added to git before (or despite)
  the ignore rule, and remain tracked today. This means: on this specific
  machine's checkout, part of the real `formulas/` data rides on git
  history (an accidental safety net), while `data/` (formulations,
  master, sessions, literature) has zero git tracking at all
  (`git ls-files data` returns nothing). This inconsistency is recorded
  as a finding, not corrected — Session 0 does not touch working-tree
  state.
- **Backup**: include; not regenerable.

### 7. `.FormuLab/runs.jsonl` + `.FormuLab/remote-runs.jsonl` — append-only run provenance
- **Resolution**: `workspace_dir()/.FormuLab/runs.jsonl` —
  `runs.rs:13-19,390,422,428` (imports `workspace::workspace_dir`, **not**
  `project_root()` — a genuinely different root function than every
  collection above resolves under).
- **Classification**: authoritative (the durable source of truth the
  `runs.db` index below is rebuilt from — `runs_index.rs:1-7`).
- **Format**: JSON Lines, one record per run (`RunRecord`,
  `runs.rs:35-75`).
- **Backup**: include; cannot be regenerated.
- **Secrets/PII**: `command` field could contain a path with a Windows
  username; `env`/`remote_hardware` fields describe hardware, not
  credentials.

### 8. `.FormuLab/runs.db` — derived SQLite index (**never touch**, per this session's own rules)
- **Resolution**: `base_workspace_dir()/.FormuLab/runs.db` —
  `runs_index.rs:16,378` (imports `workspace::base_workspace_dir`,
  distinct again from both `workspace_dir()` and `project_root()`).
- **Classification**: disposable/regenerable by design — the module
  header states it is "rebuilt lazily from the logs by byte watermark"
  (`runs_index.rs:1-7`); `SCHEMA_VERSION` is an internal rebuild trigger
  (`runs_index.rs:18`), not app-wide.
- **Git status anomaly (real, evidenced)**: despite being explicitly
  designed as disposable/rebuildable, `.FormuLab/runs.db` **is tracked in
  git** (`git ls-files .FormuLab` returns exactly this one file) and is
  the second file shown modified in this session's starting
  `git status`. A derived cache file being committed to a git repository
  is unusual and inconsistent with its own module's stated design intent.
  Recorded as a finding; per this session's explicit instructions this
  file is never opened, moved, or staged.
- **Divergence risk (real, evidenced)**: `runs.jsonl` is written under
  `workspace_dir()` (**active** workspace) while `runs.db` is read/written
  under `base_workspace_dir()` (**base** workspace). These are the same
  directory unless a session has ever set `active-workspace.txt` to
  something other than the base folder. `compute.rs:319-330` shows the
  codebase is already aware base/active can diverge (it explicitly
  materializes `compute.json` into the active workspace when they
  differ) — no equivalent handling exists for `runs.jsonl`/`runs.db`,
  meaning an active-workspace override could silently split "where runs
  are logged" from "what the runs index aggregates." Recorded as a risk
  for the diagnostics session to surface, not fixed here.
- **Backup**: excluded — rebuildable, and this session must not touch it.

### 9. `.FormuLab/provenance.jsonl` — append-only artifact provenance
- **Resolution**: `workspace_dir()/.FormuLab/provenance.jsonl` —
  `provenance.rs:11-14`.
- **Classification**: authoritative (per-artifact version history: which
  tool/session/model produced a workspace file, `provenance.rs:22-40`).
- **Backup**: include; not regenerable.

### 10. `.FormuLab/logs/<hash>.txt` — captured stdout/stderr per run
- **Resolution**: under `workspace_dir()/.FormuLab/logs/` (`LOGS_DIR`,
  `runs.rs:20`), content-addressed by hash, capped at 200,000 bytes
  (`runs.rs:22`).
- **Classification**: authoritative but bounded/lossy by design (a huge
  capture is truncated, not authoritative-complete).
- **Backup**: include (small, content-addressed, deduplicated by hash).
- **Secrets/PII**: real risk — raw stdout/stderr could contain anything a
  run printed, including an accidentally-echoed key or path with a
  Windows username. Flagged for the diagnostics redaction rules.

### 11. `.FormuLab/compute.json` (+ legacy `hpc.json`) — user remote-machine configuration
- **Resolution**: `base_workspace_dir()/.FormuLab/compute.json` —
  `compute.rs:274-280`, migrated once from a legacy `hpc.json` at the same
  root (`compute.rs:297-311`).
- **Classification**: authoritative user configuration (SSH host/user
  entries for remote compute — `compute.rs:282-295`'s probe script implies
  the stored shape is host/user/path, reached over SSH — no password
  field was found in this file's schema in the portion read).
- **Backup**: include; small, human-authored, not regenerable.
- **Secrets/PII**: hostnames and remote usernames, not credentials
  (assumes SSH key-based auth, consistent with `ssh` being invoked
  directly rather than a password prompt).

### 12. `%APPDATA%\com.formulab.app\runtime\{formulab-root.txt, base-workspace.txt, active-workspace.txt}` — root-pointer configuration
- **Classification**: configuration, not user data — but critical:
  losing these on restore silently resets the app to its default root
  (`~/Documents/FormuLab`), which may not be where the user's real data
  is.
- **Format**: plain text, one absolute path per file, no trailing
  metadata.
- **Malformed-file behavior**: `read_to_string` succeeding but
  `PathBuf::from(s.trim()).is_dir()` returning false silently falls
  through to the next fallback (`formulation_v2.rs:64-70`,
  `workspace.rs:33-41,47-54`) — a malformed or stale pointer is never
  surfaced to the user as an error, it is silently ignored.
- **Missing/unwritable target**: same fallback path — `is_dir()` is false
  for a missing target, so it falls back exactly as the malformed case
  does. An unwritable-but-existing target is not checked at all here;
  the first actual write attempt inside that directory would fail with
  whatever OS error `std::fs::create_dir_all`/`write` surfaces, uncaught
  by this resolution layer itself.
- **Backup**: **must** be captured for diagnostics/support (to explain
  "why is my data not showing up"), but restoring it verbatim onto a
  different machine is a real compatibility risk — an absolute path from
  machine A is meaningless on machine B. The backup/restore architecture
  must treat these as machine-specific, never blindly restored.
- **One true source of data-root configuration?**: **no** — three
  independent pointer files exist, read by two different resolution
  functions, and nothing today reconciles them or warns when they
  disagree. `formulab-root.txt` (read only by `project_root()`) is not
  exposed by any Tauri command (`lib.rs:71-75` only registers
  `workspace_path`/`workspace_base`/`set_workspace_base`/
  `open_workspace_base` — no command reads or writes
  `formulab-root.txt`), so **no UI surface today can create, show, or
  clear it** — it is reachable only by a person manually editing the
  file. If present, it silently overrides everything `project_root()`
  resolves (all real user data), while the Settings page
  (`SettingsPage.tsx:100,160-176`) displays only `workspaceBase()` — the
  **base** workspace, not `project_root()`. A manually-placed
  `formulab-root.txt` would therefore make Settings display the *wrong*
  root relative to where formulations/master-data/sessions actually live
  — a genuine, evidenced "silently choose the wrong root" scenario.

### 13. `%APPDATA%\com.formulab.app\debug.log`
- **Resolution**: `app_data_dir()/debug.log` — `debug_log.rs:9-11`.
- **Classification**: diagnostic log, non-authoritative, regenerable,
  append-only text.
- **Backup**: optional (useful for diagnostics bundles, not for a data
  restore).
- **Secrets/PII**: frontend-authored free text
  (`log_debug(message: String)`, `debug_log.rs:7-8`) — anything the
  webview chooses to log lands here verbatim; must be redacted in any
  exported diagnostic bundle.

### 14. `%APPDATA%\com.formulab.app\runtime\{pipeline,formulation,skills}\*` — materialized code cache
- **Resolution**: `app_data_dir()/runtime/pipeline` (`formulation_v2.rs:97-99`),
  `app_data_dir()/runtime/formulation` (`formulation.rs:22-31`),
  `app_data_dir()/runtime/skills/core/formulation-discovery`
  (`formulation_v2.rs:122`).
- **Classification**: pure code cache — every file here is written fresh
  from an `include_str!`-embedded constant on first use
  (`formulation_v2.rs:108-125`, `formulation.rs:33-37`). Not user data.
- **Backup**: exclude entirely; always regenerable, in fact always
  regenerated (rewritten unconditionally on next use).

### 15. `%APPDATA%\com.formulab.app\EBWebView\*` (WebView2 profile, includes `localStorage`)
- **Classification**: runtime/browser cache — already classified this
  way by the prior Phase 10 consolidation
  (`docs/FORMULAB_FILE_CONSOLIDATION_REPORT.md:29`, "Tauri/WebView2
  runtime cache, not user-created content").
- **What actually lives in `localStorage` (evidenced)**: pure UI
  preferences — theme, sidebar width/collapsed, inspector width, zoom,
  locale (`apps/desktop/src/lib/store.ts:9-21,49-106`) — all regenerable
  defaults, plus **one real secret**: a per-provider LLM API key,
  `formulab.v2.key.<provider>`, stored and read in plaintext
  (`apps/desktop/src/lib/formulationV2.ts:114-143`). This directly
  concerns `AGENTS.md`'s "API keys go to the OS keychain / credential
  manager; never into provenance, logs, crash reports, git, or exported
  projects" rule — the key is not in any of those places, but it is in
  browser storage, which a naive file-level backup of `app_data_dir()`
  would sweep up unless `EBWebView` is explicitly excluded.
- **Backup**: **exclude entirely** — both because it is a regenerable
  runtime cache and because excluding it is what keeps the plaintext API
  key out of any backup package. This exclusion must be an explicit,
  tested rule in the backup architecture, not an accidental side effect.

### 16. `OneDrive\Documents\FormuLab\` — alternate real project-data root
- Already inventoried in
  `docs/FORMULAB_FILE_CONSOLIDATION_REPORT.md:32,74-79`: same shape as
  the repo checkout's own `data/`/`formulas/` (real formulation/session/
  master records). **Not currently the active root** on this machine (no
  `formulab-root.txt` pointing at it was found at the time of that
  report). Per this session's explicit rules, not inspected further, not
  touched, and not assumed to be authoritative over any other location —
  recorded as existing, nothing more.

### 17. `%APPDATA%\com.formulab.app` (the real, canonical profile on this machine)
- Already inventoried in
  `docs/FORMULAB_FILE_CONSOLIDATION_REPORT.md:31,72-73`: `debug.log` +
  `runtime/`. Per this session's explicit rules, not touched. Everything
  this document says about `%APPDATA%\com.formulab.app\*` above is
  derived from reading the *source code* that writes there, not from
  inspecting this real directory directly.

### 18. `docs/external-logs/`, `docs/screenshots/`, `docs/PHASE10_SCREENSHOT_MANIFEST.json`
- Repository-tracked archival/documentation material from the Phase 10
  consolidation and screenshot work. Not application data. Out of scope
  for backup/restore (they are already versioned by git).

### 19. `.docs-fixture/` — Phase 10 documentation fixture profile
- Gitignored (`.gitignore:92`), built deterministically by
  `apps/desktop/src/lib/docsFixture/*` + `scripts/dev/seed-docs-fixture.ts`.
  Explicitly never the real app-data profile (`fixtureWriter.ts`'s
  `assertSafeFixtureRoot`, per the Phase 10 handoff). Developer tooling,
  not user data — excluded from backup.

## Active data-location assessment — direct answers

- **How the active data root is selected today**: `project_root()`
  (`formulab-root.txt` override, else `base_workspace_dir()`) for all
  real user data; a *separate* `workspace_dir()` (`active-workspace.txt`
  override, else `base_workspace_dir()`) for the kernel/provenance/
  artifacts/run-logging surface. Both ultimately fall back to
  `~/Documents/FormuLab`.
- **Is `formulab-root.txt` still used?** Yes — read at
  `formulation_v2.rs:63-69` — but has no writer anywhere in the codebase
  and no exposing Tauri command. It is a manual-edit-only override today.
- **Where it lives**: `<app_data_dir>/runtime/formulab-root.txt`.
- **Which layer reads it**: only `formulation_v2::project_root()`.
  `workspace::workspace_dir()`/`base_workspace_dir()` never consult it.
- **Malformed / missing-target / unwritable-target behavior**: malformed
  and missing-target both silently fall through to the next fallback
  (no error surfaced). Unwritable-target is not checked at this layer at
  all — surfaces later as a raw filesystem error from whatever operation
  first tries to write.
- **Does `%APPDATA%\com.formulab.app` contain configuration, user data,
  or both?** Both: root-pointer config + debug log + code cache
  (config/cache) live there directly; it is never itself the *place*
  formulations/master-data/sessions live (those are under whatever
  `project_root()` resolves to, by default `~/Documents/FormuLab`, a
  sibling of `%APPDATA%`, not inside it).
- **How does `OneDrive\Documents\FormuLab` relate to the active root?**
  It doesn't, currently — it is a same-shape alternate root with no
  pointer file selecting it, per the Phase 10 consolidation report.
- **Is repository-local `data`/`formulas`/`.FormuLab` runtime data,
  fixtures, developer data, or mixed?** Mixed and non-representative:
  this specific checkout is the developer's real, live FormuLab project
  (confirmed by the Phase 10 fixture-build doc's own reasoning,
  `docsFixture` session summary), so `data/`/`formulas/`/`.FormuLab/`
  here hold real records, not fixtures — but this is a one-machine
  peculiarity (a repo checkout doubling as a data root), not the shape
  a typical user's install takes.
- **Can multiple roots contain valid data simultaneously?** Yes,
  demonstrably — this repo checkout and `OneDrive\Documents\FormuLab`
  both hold real, non-fixture FormuLab project data right now, with no
  merge or precedence rule between them beyond whichever one
  `formulab-root.txt`/`base-workspace.txt` happens to point at.
- **Can the app silently choose the wrong root?** Yes — see item 12
  above: a manually-placed `formulab-root.txt` silently overrides the
  root Settings displays.
- **How are root conflicts currently handled?** They are not — no
  detection, no warning, no reconciliation exists.
- **Startup behavior when the configured root cannot be opened**: not
  applicable as a distinct failure mode today, because every resolution
  function silently falls back rather than failing — there is currently
  no state in which startup "cannot open" a root; it always produces
  *some* directory, possibly not the one the user expects.
- **Do any modules resolve storage paths independently?** No — verified
  by grep across every `.rs` file in `src-tauri/src`; all real-data
  writers funnel through `project_root()`/`project_data_dir()`, and the
  kernel/provenance/artifact/runs surface funnels through
  `workspace_dir()`/`base_workspace_dir()`. The only structural risk is
  that these are *two* funnels, not one, plus the `runs.db` index reading
  `base_workspace_dir()` while `runs.jsonl` writes under `workspace_dir()`
  (item 8 above).
- **Is there currently one true source of data-root configuration?**
  No — three pointer files, two resolution functions, zero reconciliation.
