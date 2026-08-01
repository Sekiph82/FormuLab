# Phase 11 Diagnostics and Log Export Architecture

Session 0 (assessment and planning only).

## Current logging/error-handling state (evidenced)

- **`debug.log`** (`app_data_dir()/debug.log`, `debug_log.rs:7-19`) — the
  only persistent app log found. Appended to via one command,
  `log_debug(message: String)`, called by the frontend with arbitrary
  free-text messages. No rotation, no size cap, no structured fields
  (just `<epoch-ms> <message>` per line).
- **`.FormuLab/logs/<hash>.txt`** (`runs.rs`) — per-run captured
  stdout/stderr, capped at 200,000 bytes per capture (`runs.rs:22`),
  content-addressed so identical output across runs is stored once.
  Scoped to run provenance, not general app diagnostics.
- **No crash-dump mechanism**: grepped for `Sentry`, `crash_report`,
  `panic::set_hook`, `ErrorBoundary` across `apps/desktop/src` — zero
  matches. No Rust panic hook, no frontend error boundary, no external
  crash-reporting SDK.
- **No existing "diagnostics" or "support bundle" command** of any kind
  in `src-tauri/src` or `apps/desktop/src`.
- **App/build version**: `tauri.conf.json:4-5` — `"version": "0.4.0"`,
  `"identifier": "com.formulab.app"`. No separate build-identifier field
  (e.g. a commit SHA baked in at build time) was found — if one is
  wanted, it does not exist yet and must be added as new build tooling,
  not assumed present.
- **Existing "root/health" signal the UI already surfaces**: the
  Settings page's workspace section (`SettingsPage.tsx:160-176`) shows
  `workspaceBase()` — the only existing "where is my data" surface, and
  it does not show `formulab-root.txt`'s effect (see the Data Inventory
  doc's root-resolution findings) or free disk space.

## What "basic diagnostics" must assemble (per the session's own list)

Each item below states whether the underlying fact is already available
via an existing function, or is new plumbing Session 5 must add.

| Item | Source | Status |
|---|---|---|
| Application version | `tauri.conf.json` (`app.getVersion()` at runtime via the Tauri API) | available today |
| Build identifier | none found | **new** — needs a build-time-injected value if wanted; may ship as "not tracked yet" honestly instead |
| Operating system / CPU architecture | Tauri's `os`/`arch` APIs (already a dependency surface, not newly added) | available today |
| Active data path | `workspace_path`/`workspace_base` commands exist; `project_root()` itself is **not** exposed as a command today | partially available — exposing `project_root()`'s resolved path is new plumbing |
| Root-resolution source (which pointer file won) | none — `project_root()`/`workspace_dir()` return only a path, not *why* | **new** — needs each resolver to also report which pointer file (or default) was used |
| Writable status | none checked today | **new** — a real write-probe (temp file create+delete) against the resolved root |
| Free disk space | none found in `src-tauri` | **new** — no existing disk-space query in this codebase |
| Current schema version | per-record only, see Migration Architecture doc | **new** at the global level; per-collection already exists |
| Pending migration status | n/a — no migration has ever run | **new**, and honestly "none pending" until Session 3 lands |
| Last backup status / last verified backup | n/a — no backup system exists yet | **new**, depends on Session 1/2 |
| Recent application errors | only `debug.log`'s free-text lines | partially available — needs a defined "error" vs. general-message convention, which `debug.log` doesn't have today |
| Log directory | `.FormuLab/logs/` (run captures) + `app_data_dir()` (`debug.log`) — **two different directories**, under two different root functions | available, but must document both, not just one |
| Storage health | none | **new** |
| Database/file health | none beyond `masterdata.rs`'s read failing silently to an empty array on bad JSON (`read_array`, `masterdata.rs:418-423` — a parse failure is indistinguishable from "collection doesn't exist yet") | **new** — this silent-empty-on-parse-failure behavior is itself a real gap a health check should surface, since today a corrupted collection file looks identical to an empty one |
| Export sanitized diagnostic bundle | none | **new**, all of Session 5 |

## Design

### Diagnostics summary (in-app, on demand)

A single new Tauri command (e.g. `diagnostics_summary`) assembling:
```jsonc
{
  "appVersion": "0.4.0",
  "buildId": null,               // honestly null until build tooling adds one
  "os": "windows", "arch": "x86_64",
  "activeDataPath": "C:\\Users\\...\\Documents\\FormuLab",
  "rootResolutionSource": "base-workspace.txt",  // or "formulab-root.txt override" / "default"
  "writable": true,
  "freeDiskSpaceBytes": 123456789012,
  "globalSchemaVersion": "1.0",           // once Migration Architecture lands
  "pendingMigrations": [],
  "lastBackup": { "at": null, "status": "none" },
  "lastVerifiedBackup": { "at": null, "status": "none" },
  "recentErrors": [],
  "logDirectories": ["<app_data_dir>", "<workspace_dir>/.FormuLab/logs"],
  "storageHealth": "ok",
  "collectionHealth": [ { "name": "materials", "readable": true, "rowCount": 42 } ]
}
```
This reuses existing resolvers (`project_root`, `workspace_dir`,
`base_workspace_dir`) rather than adding a third path-resolution layer —
consistent with the Data Inventory finding that no module should resolve
storage paths independently.

### Support bundle (exportable file)

A single archive (reusing the same zip mechanism the backup system
adds — no second archive library) containing:
- The diagnostics summary above, as JSON.
- Bounded recent logs: last N KB of `debug.log` plus the most recent
  handful of `.FormuLab/logs/<hash>.txt` entries (by mtime), never the
  full unbounded history.
- App/build version.
- Schema-version summary (global + per-collection, once Migration
  Architecture lands).
- Storage-health result.
- Active-root metadata (paths + which pointer file resolved them) —
  **redacted** per the rules below before being written into the bundle,
  since a raw absolute path very likely embeds the Windows username
  (`C:\Users\<name>\...`).
- Migration status.
- Backup **metadata only** (timestamps, sizes, hashes) — never the
  backup's actual file contents, per this session's explicit instruction
  that a support bundle must not include backup contents.
- Configuration summary with secrets removed (see redaction rules).

### Redaction rules

| Category | Rule | Rationale / evidence |
|---|---|---|
| Windows usernames | Replace `C:\Users\<name>\` (and `%USERPROFILE%`-derived equivalents) with `C:\Users\<redacted>\` wherever a path is emitted into the bundle | every real root path found this session embeds the username (`C:\Users\sekip\...`) |
| Absolute paths in general | Truncate to a path *relative to* the known root (`project_root()`/`app_data_dir()`) rather than emitting the full string, except where the diagnostics summary's own "active data path" field is the explicit, intentional exception | limits incidental leakage through log lines, error messages, etc. |
| Access tokens / API keys | Never read `localStorage` at all for the bundle — the plaintext LLM API key (`formulab.v2.key.<provider>`, `formulationV2.ts:117,142`) lives in browser storage the Rust side never touches; the bundle generator must not gain a new code path that reads it | confirmed real secret location this session found |
| Credentials / environment secrets | Never include process environment variables in the bundle | no evidence any are currently needed for diagnostics; explicit exclusion |
| Formula contents / project names / customer names | Never include `data/formulations/*`, `data/master/*`, `formulas/*` file contents — only counts/health status, never row content | these are exactly the authoritative-user-data collections the inventory doc lists |
| File contents / user documents | Never include attachment file bytes (`data/formulations/<id>/attachments/`) | matches "backup metadata, but not backup contents" instruction |
| PII in general | Same treatment as project/customer names — counts and health only | no dedicated PII field exists in these schemas beyond names already covered above |

### What this session deliberately does not claim

- No crash-dump support is claimed or planned as guaranteed — none
  exists today, and Session 5's scope (per the phase's own instructions)
  is "smallest useful first implementation," not a full crash reporter.
  If a future session adds one, it should be scoped and named
  separately, not folded silently into "basic diagnostics."
- No build-identifier value is claimed to exist — the honest state is
  "not tracked," and the summary schema above reflects that with a
  `null`, not a fabricated placeholder.
