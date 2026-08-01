// Phase 11 Session 5 — basic diagnostics and sanitized log export.
//
// `diagnostics_summary` is for on-screen display in Settings: it shows the
// real, unredacted active data path, because a user reading their OWN
// diagnostics needs the real path to actually find their files.
// `export_support_bundle` builds a SEPARATE, sanitized structure for
// sharing with someone else — usernames stripped from paths, token/key-
// like strings redacted out of log lines, and never anything from
// `localStorage` (which this Rust process cannot read at all — the
// per-provider LLM API key lives there, per docs/PHASE11_DATA_INVENTORY.md,
// and is structurally unreachable from here, not merely skipped by
// convention).
//
// No claim of crash-dump support anywhere in this module: none exists.
// "Recent errors" is a bounded, heuristic scan of `debug.log` for lines
// containing "error"/"fail" (case-insensitive) — not a structured error
// log, since `debug_log::log_debug` never recorded a severity level.
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::migration::MigrationJournalEntry;

const RECENT_ERRORS_LIMIT: usize = 20;
const BUNDLE_LOG_LINES_LIMIT: usize = 200;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CollectionHealth {
    pub name: String,
    /// `false` only when the file exists but failed to parse as a JSON
    /// array — a missing file is healthy (nothing created yet). This is
    /// the check `masterdata.rs`'s own `read_array` does NOT make (it
    /// silently treats a parse failure the same as "empty"); diagnostics
    /// adds visibility without changing that function's behavior.
    pub readable: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StorageHealth {
    pub healthy_count: usize,
    pub unhealthy: Vec<CollectionHealth>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LastBackupInfo {
    /// Filename only, never a full path — self-redacting by construction
    /// (no username, no drive letter).
    pub filename: String,
    pub kind: String, // "preMigration" | "preRestore"
    pub created_at: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LastMigrationInfo {
    pub status: String, // "completed" | "failed" | "rejectedFutureVersion"
    pub at: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSummary {
    pub app_version: String,
    /// Honestly `None` — no build-time identifier (commit SHA, CI build
    /// number) is baked into this build today.
    pub build_id: Option<String>,
    pub os: String,
    pub arch: String,
    pub active_data_path: String,
    pub root_resolution_source: String,
    pub writable: bool,
    pub free_disk_space_bytes: Option<u64>,
    pub root_warnings: Vec<String>,
    pub global_schema_version: String,
    pub schema_status: String,
    pub last_migration: Option<LastMigrationInfo>,
    pub last_backup: Option<LastBackupInfo>,
    pub storage_health: StorageHealth,
    pub log_directories: Vec<String>,
    pub recent_errors: Vec<String>,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Every real, non-empty `data/master/*.json` file is parsed as JSON; a
/// present-but-unparseable file is the only "unhealthy" case.
fn scan_storage_health(project_root: &Path) -> StorageHealth {
    let master_dir = project_root.join("data").join("master");
    let mut healthy_count = 0usize;
    let mut unhealthy = Vec::new();
    let Ok(entries) = std::fs::read_dir(&master_dir) else {
        return StorageHealth { healthy_count: 0, unhealthy: Vec::new() };
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let name = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        match std::fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
                Ok(serde_json::Value::Array(_)) => healthy_count += 1,
                _ => unhealthy.push(CollectionHealth { name, readable: false }),
            },
            Err(_) => unhealthy.push(CollectionHealth { name, readable: false }),
        }
    }
    StorageHealth { healthy_count, unhealthy }
}

fn find_last_backup(app: &AppHandle) -> Option<LastBackupInfo> {
    let dir = crate::backup::app_private_dir(app, "backups").ok()?;
    let mut best: Option<(u64, String, String)> = None; // (epoch, filename, kind)
    for entry in std::fs::read_dir(&dir).ok()?.filter_map(|e| e.ok()) {
        let name = entry.file_name().to_string_lossy().to_string();
        let (kind, rest) = if let Some(r) = name.strip_prefix("pre-migration-") {
            ("preMigration", r)
        } else if let Some(r) = name.strip_prefix("pre-restore-") {
            ("preRestore", r)
        } else {
            continue;
        };
        let Some(epoch_str) = rest.strip_suffix(".formulab-backup") else { continue };
        let Ok(epoch) = epoch_str.parse::<u64>() else { continue };
        if best.as_ref().map(|(e, ..)| epoch > *e).unwrap_or(true) {
            best = Some((epoch, name, kind.to_string()));
        }
    }
    best.map(|(epoch, filename, kind)| LastBackupInfo { filename, kind, created_at: epoch })
}

fn last_migration_status(entries: &[MigrationJournalEntry]) -> Option<LastMigrationInfo> {
    entries
        .iter()
        .rev()
        .find_map(|e| match e.step.as_str() {
            "run_completed" => Some(LastMigrationInfo { status: "completed".to_string(), at: e.ts }),
            "run_failed" => Some(LastMigrationInfo { status: "failed".to_string(), at: e.ts }),
            "rejected_future_version" => {
                Some(LastMigrationInfo { status: "rejectedFutureVersion".to_string(), at: e.ts })
            }
            _ => None,
        })
}

fn debug_log_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("debug.log"))
}

/// Bounded tail read: the file is capped at `debug_log::MAX_DEBUG_LOG_BYTES`
/// by rotation, so reading it whole is itself already bounded — this just
/// avoids holding more than the last `max_lines` in memory afterward.
fn tail_lines(path: &Path, max_lines: usize) -> Vec<String> {
    let Ok(mut file) = std::fs::File::open(path) else { return Vec::new() };
    let mut buf = String::new();
    if file.read_to_string(&mut buf).is_err() {
        return Vec::new();
    }
    let all: Vec<&str> = buf.lines().collect();
    all.iter().rev().take(max_lines).rev().map(|s| s.to_string()).collect()
}

fn recent_error_lines(app: &AppHandle) -> Vec<String> {
    let Some(path) = debug_log_path(app) else { return Vec::new() };
    let matched: Vec<String> = tail_lines(&path, 2000)
        .into_iter()
        .filter(|l| {
            let lower = l.to_lowercase();
            lower.contains("error") || lower.contains("fail")
        })
        .collect();
    let start = matched.len().saturating_sub(RECENT_ERRORS_LIMIT);
    matched[start..].to_vec()
}

#[tauri::command(async)]
pub async fn diagnostics_summary(app: AppHandle) -> Result<DiagnosticsSummary, String> {
    let root = crate::data_root::resolve_data_root(&app)?;
    let schema_meta = crate::migration::read_schema_meta(app.clone()).await?;
    let compat = crate::migration::check_schema_compatibility(app.clone()).await?;
    let journal = crate::migration::read_migration_journal(app.clone()).await?;
    let workspace_root = crate::workspace::workspace_dir(&app)?;

    let free_disk_space_bytes = fs4::available_space(&root.path).ok();
    let storage_health = scan_storage_health(&root.path);
    let last_backup = find_last_backup(&app);
    let last_migration = last_migration_status(&journal);

    let log_dirs = {
        let mut dirs = vec![workspace_root.join(".FormuLab").join("logs").to_string_lossy().to_string()];
        if let Some(p) = debug_log_path(&app) {
            if let Some(parent) = p.parent() {
                dirs.push(parent.to_string_lossy().to_string());
            }
        }
        dirs
    };

    Ok(DiagnosticsSummary {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        build_id: None,
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        active_data_path: root.path.to_string_lossy().to_string(),
        root_resolution_source: root.source.as_str().to_string(),
        writable: root.writable,
        free_disk_space_bytes,
        root_warnings: root.warnings,
        global_schema_version: schema_meta.global_schema_version,
        schema_status: compat.status,
        last_migration,
        last_backup,
        storage_health,
        log_directories: log_dirs,
        recent_errors: recent_error_lines(&app),
    })
}

// --------------------------------------------------------------- redaction ---

fn path_redaction_patterns() -> Vec<(Regex, &'static str)> {
    vec![
        (Regex::new(r"(?i)(C:\\Users\\)[^\\\r\n]+").unwrap(), "${1}<redacted>"),
        (Regex::new(r"(?i)(/home/)[^/\r\n]+").unwrap(), "${1}<redacted>"),
        (Regex::new(r"(?i)(/Users/)[^/\r\n]+").unwrap(), "${1}<redacted>"),
    ]
}

/// A long run of alphanumeric/-/_ characters — token/key-like. The Rust
/// `regex` crate has no look-around, so "contains a digit AND a letter"
/// (the part that keeps a plain long English phrase from being redacted)
/// is checked in the replacement closure below rather than the pattern
/// itself.
fn token_pattern() -> Regex {
    Regex::new(r"\b[A-Za-z0-9_\-]{24,}\b").unwrap()
}

pub(crate) fn redact_text(text: &str) -> String {
    let mut out = text.to_string();
    for (re, replacement) in path_redaction_patterns() {
        out = re.replace_all(&out, replacement).to_string();
    }
    out = token_pattern()
        .replace_all(&out, |caps: &regex::Captures| {
            let m = &caps[0];
            let has_digit = m.bytes().any(|b| b.is_ascii_digit());
            let has_alpha = m.bytes().any(|b| b.is_ascii_alphabetic());
            if has_digit && has_alpha {
                "[REDACTED]".to_string()
            } else {
                m.to_string()
            }
        })
        .to_string();
    out
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SupportBundle {
    pub generated_at: u64,
    pub app_version: String,
    pub build_id: Option<String>,
    pub os: String,
    pub arch: String,
    pub root_resolution_source: String,
    pub writable: bool,
    pub free_disk_space_bytes: Option<u64>,
    pub root_warnings: Vec<String>,
    pub global_schema_version: String,
    pub schema_status: String,
    pub last_migration: Option<LastMigrationInfo>,
    /// Metadata only — filename/kind/timestamp. Never the backup's own
    /// file inventory or contents.
    pub last_backup: Option<LastBackupInfo>,
    pub storage_health: StorageHealth,
    pub log_directories: Vec<String>,
    pub recent_logs: Vec<String>,
}

/// Builds the sanitized structure this session's bundle exports. Every
/// path-bearing field is redacted; log lines are redacted and bounded.
/// Never touches `localStorage` (impossible from Rust) and never includes
/// a single row of formula/master-data content — only counts and health.
fn build_support_bundle(app: &AppHandle, summary: &DiagnosticsSummary) -> Result<SupportBundle, String> {
    let path = debug_log_path(app);
    let recent_logs = path
        .as_deref()
        .map(|p| tail_lines(p, BUNDLE_LOG_LINES_LIMIT))
        .unwrap_or_default()
        .into_iter()
        .map(|l| redact_text(&l))
        .collect();

    Ok(SupportBundle {
        generated_at: now_secs(),
        app_version: summary.app_version.clone(),
        build_id: summary.build_id.clone(),
        os: summary.os.clone(),
        arch: summary.arch.clone(),
        root_resolution_source: summary.root_resolution_source.clone(),
        writable: summary.writable,
        free_disk_space_bytes: summary.free_disk_space_bytes,
        root_warnings: summary.root_warnings.iter().map(|w| redact_text(w)).collect(),
        global_schema_version: summary.global_schema_version.clone(),
        schema_status: summary.schema_status.clone(),
        last_migration: summary.last_migration.clone(),
        last_backup: summary.last_backup.clone(),
        storage_health: summary.storage_health.clone(),
        log_directories: summary.log_directories.iter().map(|d| redact_text(d)).collect(),
        recent_logs,
    })
}

#[tauri::command(async)]
pub async fn export_support_bundle(app: AppHandle, destination: String) -> Result<(), String> {
    let summary = diagnostics_summary(app.clone()).await?;
    let bundle = build_support_bundle(&app, &summary)?;
    let json = serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())?;
    std::fs::write(&destination, json).map_err(|e| e.to_string())
}

/// Reveal the folder holding `debug.log` (and its rotated siblings) — the
/// app-data directory, not the per-run `.FormuLab/logs` (that one is
/// already reachable via Active Data Location's Open Folder, since it
/// lives under the resolved data root).
#[tauri::command(async)]
pub async fn open_log_folder(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    crate::artifact_file::os_open(&dir)
}

#[tauri::command(async)]
pub async fn pick_support_bundle_destination(app: AppHandle, default_name: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let dialog = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("FormuLab support bundle", &["json"]);
    let Some(picked) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("formulab-diagnostics-test-{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn redact_text_strips_a_windows_username_from_a_path() {
        let redacted = redact_text(r"C:\Users\sekip\Documents\FormuLab\data\master\materials.json");
        assert!(!redacted.contains("sekip"));
        assert!(redacted.contains(r"C:\Users\<redacted>\"));
        assert!(redacted.contains("materials.json"));
    }

    #[test]
    fn redact_text_strips_a_unix_home_username() {
        assert!(!redact_text("/home/alice/project/data").contains("alice"));
        assert!(!redact_text("/Users/alice/project/data").contains("alice"));
    }

    #[test]
    fn redact_text_masks_a_long_token_like_string_but_leaves_short_normal_words() {
        let redacted = redact_text("api_key tok9x7Qw2eR5tY8uI1oP4aS6dF3gH0j was used");
        assert!(!redacted.contains("tok9x7Qw2eR5tY8uI1oP4aS6dF3gH0j"));
        assert!(redacted.contains("[REDACTED]"));
        assert!(redacted.contains("api_key"));
        assert!(redacted.contains("was used"));
    }

    #[test]
    fn redact_text_does_not_touch_ordinary_short_words_or_sentences() {
        let text = "connection attempt to sidecar succeeded on port 4096";
        assert_eq!(redact_text(text), text);
    }

    #[test]
    fn scan_storage_health_reports_missing_files_as_healthy_not_unhealthy() {
        let dir = tmp("health-missing");
        std::fs::create_dir_all(dir.join("data").join("master")).unwrap();
        let health = scan_storage_health(&dir);
        assert_eq!(health.healthy_count, 0);
        assert!(health.unhealthy.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_storage_health_flags_a_present_but_unparseable_collection_file() {
        let dir = tmp("health-corrupt");
        let master = dir.join("data").join("master");
        std::fs::create_dir_all(&master).unwrap();
        std::fs::write(master.join("materials.json"), "[{\"code\":\"M1\"}]").unwrap();
        std::fs::write(master.join("suppliers.json"), "{ not valid json at all").unwrap();

        let health = scan_storage_health(&dir);
        assert_eq!(health.healthy_count, 1);
        assert_eq!(health.unhealthy.len(), 1);
        assert_eq!(health.unhealthy[0].name, "suppliers");
        assert!(!health.unhealthy[0].readable);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn last_migration_status_picks_the_most_recent_terminal_entry() {
        let entries = vec![
            MigrationJournalEntry {
                run_id: "r1".into(),
                ts: 1,
                step: "run_started".into(),
                collection: None,
                from_version: None,
                to_version: None,
                message: None,
                backup_path: None,
            },
            MigrationJournalEntry {
                run_id: "r1".into(),
                ts: 2,
                step: "run_completed".into(),
                collection: None,
                from_version: None,
                to_version: None,
                message: None,
                backup_path: None,
            },
            MigrationJournalEntry {
                run_id: "r2".into(),
                ts: 3,
                step: "run_failed".into(),
                collection: None,
                from_version: None,
                to_version: None,
                message: None,
                backup_path: None,
            },
        ];
        let last = last_migration_status(&entries).unwrap();
        assert_eq!(last.status, "failed");
        assert_eq!(last.at, 3);
    }

    #[test]
    fn last_migration_status_is_none_when_the_journal_is_empty() {
        assert!(last_migration_status(&[]).is_none());
    }

    #[test]
    fn tail_lines_bounds_to_the_requested_count_and_keeps_order() {
        let dir = tmp("tail-lines");
        let path = dir.join("debug.log");
        let content: String = (0..50).map(|i| format!("line{i}\n")).collect();
        std::fs::write(&path, content).unwrap();

        let tail = tail_lines(&path, 5);
        assert_eq!(tail, vec!["line45", "line46", "line47", "line48", "line49"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tail_lines_on_a_missing_file_is_an_empty_list_not_an_error() {
        let dir = tmp("tail-missing");
        assert!(tail_lines(&dir.join("nope.log"), 10).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
