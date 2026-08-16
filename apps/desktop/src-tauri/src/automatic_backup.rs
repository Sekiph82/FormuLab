// Phase 11 Session 7 — automatic backups.
//
// Adds scheduled/triggered backups (daily, weekly, on-exit, pre-migration)
// on top of the EXISTING `.formulab-backup` engine (`backup::try_create_backup`
// / `backup::verify_backup_report`) — no second backup format, no second
// write path. This module owns only: persisted settings + run history
// (`automatic_backup_state.json`, app-private), classification/naming
// (`formulab-auto-<class>-<epoch>.formulab-backup` for daily/weekly;
// `pre-migration-<epoch>.formulab-backup`, unchanged from Session 3, for
// pre-migration), and per-class retention.
//
// The app has no background service and this session was explicitly told
// not to invent one: every automatic backup only ever runs while FormuLab
// is the foreground process — on launch, on a while-open interval, or on
// window close (frontend-driven, see `apps/desktop/src/lib/automaticBackup.ts`).
// A day or week where the app never opens simply has no automatic backup
// for that day/week — documented, not silently implied otherwise.
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::backup::{app_private_dir, now_secs, try_create_backup, verify_backup_report, BackupState, VerificationStatus};

pub const DEFAULT_RETENTION_DAILY: u32 = 7;
pub const DEFAULT_RETENTION_WEEKLY: u32 = 4;
pub const DEFAULT_RETENTION_PRE_MIGRATION: u32 = 2;

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AutomaticBackupConfig {
    pub enabled: bool,
    pub daily_enabled: bool,
    pub weekly_enabled: bool,
    pub backup_on_exit_enabled: bool,
    pub destination_folder: Option<String>,
    pub retention_daily: u32,
    pub retention_weekly: u32,
    pub retention_pre_migration: u32,
}

impl Default for AutomaticBackupConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            daily_enabled: true,
            weekly_enabled: true,
            backup_on_exit_enabled: false,
            destination_folder: None,
            retention_daily: DEFAULT_RETENTION_DAILY,
            retention_weekly: DEFAULT_RETENTION_WEEKLY,
            retention_pre_migration: DEFAULT_RETENTION_PRE_MIGRATION,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AutomaticBackupRunRecord {
    /// "daily" | "weekly" | "preMigration".
    pub class: String,
    pub started_at: u64,
    pub finished_at: u64,
    /// "success" | "failed".
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_status: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AutomaticBackupState {
    pub config: AutomaticBackupConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_daily_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_weekly_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_success: Option<AutomaticBackupRunRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_failure: Option<AutomaticBackupRunRecord>,
}

/// `pub(crate)`: also read/written directly by `data_location_manager.rs`
/// (`remap_destination_after_move`, below) — one persisted-state file, two
/// callers, no second copy of the read/write logic.
pub(crate) fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("automatic_backup_state.json"))
}

pub(crate) fn read_state_at(path: &Path) -> AutomaticBackupState {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

pub(crate) fn write_state_at(path: &Path, state: &AutomaticBackupState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = PathBuf::from(format!("{}.tmp", path.to_string_lossy()));
    std::fs::write(&tmp, serde_json::to_string_pretty(state).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub async fn read_automatic_backup_state(app: AppHandle) -> Result<AutomaticBackupState, String> {
    Ok(read_state_at(&state_path(&app)?))
}

/// Phase 13 Session 4: changing the automatic-backup policy (enabled
/// classes, schedule, destination, retention) is System Administration
/// configuration — gated `systemAdministration`/`administer`. Distinct from
/// `run_automatic_backup` below, which stays unauthenticated on purpose: a
/// non-admin user's own session still needs their scheduled backups to run.
#[tauri::command(async)]
pub async fn write_automatic_backup_config(
    app: AppHandle,
    token: String,
    config: AutomaticBackupConfig,
) -> Result<AutomaticBackupState, String> {
    let conn = crate::identity::open_identity_db(&app)?;
    let actor = crate::authz::authorize(&conn, &token, "systemAdministration", "administer")?;
    let path = state_path(&app)?;
    let mut state = read_state_at(&path);
    state.config = config;
    let result = write_state_at(&path, &state);
    let _ = crate::identity::record_security_audit_event(
        &conn,
        Some(&actor.user_id),
        Some(&actor.user_id),
        "automatic_backup_config_changed",
        if result.is_ok() { "success" } else { "failure" },
        None,
    );
    result?;
    Ok(state)
}

// ------------------------------------------------------- classification ---

fn class_file_prefix(class: &str) -> &'static str {
    match class {
        "daily" => "formulab-auto-daily-",
        "weekly" => "formulab-auto-weekly-",
        "preMigration" => "pre-migration-",
        _ => "formulab-auto-",
    }
}

fn retention_for(class: &str, config: &AutomaticBackupConfig) -> u32 {
    match class {
        "daily" => config.retention_daily,
        "weekly" => config.retention_weekly,
        "preMigration" => config.retention_pre_migration,
        _ => 1,
    }
}

/// The daily/weekly destination is the user-configured folder — validated
/// to actually exist (a moved/deleted folder is reported as "missing
/// destination", not a generic filesystem error). Deliberately takes no
/// `AppHandle`, so it is directly unit-testable (see tests below) without
/// the unsafe mocked-`AppHandle` workaround this phase's Stage 1 closure
/// already rejected once (`app.path().app_data_dir()` resolves
/// unpredictably under `tauri::test::mock_app()`).
fn configured_destination_dir(destination_folder: &Option<String>) -> Result<PathBuf, String> {
    let folder = destination_folder
        .as_ref()
        .ok_or_else(|| "no automatic backup destination folder is configured".to_string())?;
    let path = PathBuf::from(folder);
    if !path.is_dir() {
        return Err(format!("destination folder does not exist: {folder}"));
    }
    Ok(path)
}

fn backup_epoch_from_name(name: &str, prefix: &str) -> Option<u64> {
    let stem = name.strip_prefix(prefix)?.strip_suffix(".formulab-backup")?;
    stem.parse::<u64>().ok()
}

/// Every `<prefix><epoch>.formulab-backup` file in `dir` for this class,
/// oldest first, plus any orphaned `<prefix>...formulab-backup.tmp` file —
/// the leftover of a backup interrupted by a crash between `.tmp` creation
/// and the atomic rename (a clean failure inside the same process already
/// removes its own `.tmp`; this is the "the app died mid-write" case a
/// later run must still clean up).
fn list_class_backups(dir: &Path, prefix: &str) -> (Vec<(u64, PathBuf)>, Vec<PathBuf>) {
    let mut backups = Vec::new();
    let mut orphan_tmp = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return (backups, orphan_tmp);
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(stripped) = name.strip_suffix(".tmp") {
            if stripped.starts_with(prefix) && stripped.ends_with(".formulab-backup") {
                orphan_tmp.push(path);
            }
            continue;
        }
        if let Some(epoch) = backup_epoch_from_name(&name, prefix) {
            backups.push((epoch, path));
        }
    }
    backups.sort_by_key(|(epoch, _)| *epoch);
    (backups, orphan_tmp)
}

/// Removes stray `.tmp` packages for this class, then prunes to `keep`
/// (floor 1 — a configured `0`, or any count, never deletes the last
/// remaining valid backup of a class), oldest first. Returns every path
/// actually deleted, for logging by the caller.
pub(crate) fn apply_retention(dir: &Path, prefix: &str, keep: u32) -> Vec<String> {
    let (mut backups, orphan_tmp) = list_class_backups(dir, prefix);
    let mut deleted = Vec::new();
    for tmp in orphan_tmp {
        if std::fs::remove_file(&tmp).is_ok() {
            deleted.push(tmp.to_string_lossy().to_string());
        }
    }
    let keep = keep.max(1) as usize;
    while backups.len() > keep {
        let (_, path) = backups.remove(0);
        if std::fs::remove_file(&path).is_ok() {
            deleted.push(path.to_string_lossy().to_string());
        }
    }
    deleted
}

fn status_str(status: &VerificationStatus) -> &'static str {
    match status {
        VerificationStatus::Valid => "valid",
        VerificationStatus::ValidWithWarnings => "validWithWarnings",
        VerificationStatus::Incompatible => "incompatible",
        VerificationStatus::Corrupted => "corrupted",
        VerificationStatus::Unsafe => "unsafe",
    }
}

// -------------------------------------------------------------- running ---

fn failed_record(class: &str, started_at: u64, message: String) -> AutomaticBackupRunRecord {
    AutomaticBackupRunRecord {
        class: class.to_string(),
        started_at,
        finished_at: now_secs(),
        status: "failed".to_string(),
        path: None,
        error: Some(message),
        verification_status: None,
    }
}

fn run_automatic_backup_inner(
    app: &AppHandle,
    class: &str,
    config: &AutomaticBackupConfig,
    started_at: u64,
) -> Result<AutomaticBackupRunRecord, Box<AutomaticBackupRunRecord>> {
    let dir = match class {
        "preMigration" => {
            app_private_dir(app, "backups").map_err(|e| Box::new(failed_record(class, started_at, e)))?
        }
        _ => configured_destination_dir(&config.destination_folder)
            .map_err(|e| Box::new(failed_record(class, started_at, e)))?,
    };
    let prefix = class_file_prefix(class);
    let dest = dir.join(format!("{prefix}{started_at}.formulab-backup"));
    let tmp = PathBuf::from(format!("{}.tmp", dest.to_string_lossy()));
    let cancel = Arc::new(AtomicBool::new(false));

    if let Err(e) = try_create_backup(app, &dest, &tmp, &cancel, "automatic-backup-progress") {
        let _ = std::fs::remove_file(&tmp);
        return Err(Box::new(failed_record(class, started_at, e)));
    }

    // "Verify each automatic backup before marking it successful" — reuses
    // the exact standalone verification Session 2 built; a package that
    // isn't at least ValidWithWarnings is deleted immediately rather than
    // left on disk masquerading as a real backup.
    let report = verify_backup_report(&dest);
    if !matches!(report.status, VerificationStatus::Valid | VerificationStatus::ValidWithWarnings) {
        let _ = std::fs::remove_file(&dest);
        return Err(Box::new(AutomaticBackupRunRecord {
            class: class.to_string(),
            started_at,
            finished_at: now_secs(),
            status: "failed".to_string(),
            path: None,
            error: Some(format!(
                "automatic backup failed verification: {}",
                status_str(&report.status)
            )),
            verification_status: Some(status_str(&report.status).to_string()),
        }));
    }

    let keep = retention_for(class, config);
    apply_retention(&dir, prefix, keep);

    Ok(AutomaticBackupRunRecord {
        class: class.to_string(),
        started_at,
        finished_at: now_secs(),
        status: "success".to_string(),
        path: Some(dest.to_string_lossy().to_string()),
        error: None,
        verification_status: Some(status_str(&report.status).to_string()),
    })
}

/// Runs one automatic backup (`class` is `"daily"` | `"weekly"` |
/// `"preMigration"`). Concurrency is enforced by reusing `BackupState` —
/// the same slot manual `create_backup`/`restore_backup` already hold
/// while running — so an automatic backup can never start alongside a
/// manual backup, a restore, or another automatic run; it reports that as
/// a normal failed `AutomaticBackupRunRecord`, not an exception (a
/// scheduling collision is an expected, recoverable condition, not a bug).
// Phase 13 Session 4 — TRUSTED_INTERNAL_ONLY, deliberately NOT gated:
// reliability of a user's own configured automatic backups must not depend
// on that user holding systemAdministration authority — the session brief
// is explicit that "trusted internal background functions must not be
// broken merely because they do not have an interactive user session." The
// *policy* this obeys (write_automatic_backup_config, above) is gated; the
// scheduled/triggered run itself is not.
#[tauri::command(async)]
pub async fn run_automatic_backup(
    app: AppHandle,
    backup_state: State<'_, BackupState>,
    class: String,
) -> Result<AutomaticBackupRunRecord, String> {
    let started_at = now_secs();

    {
        let mut guard: std::sync::MutexGuard<'_, Option<Arc<AtomicBool>>> =
            backup_state.0.lock().map_err(|_| "backup state unavailable".to_string())?;
        if guard.is_some() {
            return Ok(failed_record(
                &class,
                started_at,
                "another backup or restore is already in progress".to_string(),
            ));
        }
        *guard = Some(Arc::new(AtomicBool::new(false)));
    }

    let path = state_path(&app)?;
    let mut persisted = read_state_at(&path);
    let config = persisted.config.clone();

    let result = run_automatic_backup_inner(&app, &class, &config, started_at);

    {
        let mut guard = backup_state.0.lock().map_err(|_| "backup state unavailable".to_string())?;
        *guard = None;
    }

    let record = match result {
        Ok(record) => {
            match class.as_str() {
                "daily" => persisted.last_daily_at = Some(started_at),
                "weekly" => persisted.last_weekly_at = Some(started_at),
                _ => {}
            }
            persisted.last_success = Some(record.clone());
            record
        }
        Err(record) => {
            let record = *record;
            persisted.last_failure = Some(record.clone());
            record
        }
    };
    write_state_at(&path, &persisted)?;
    Ok(record)
}

/// Prunes app-private pre-migration backups (`pre-migration-<epoch>.formulab-backup`,
/// unchanged naming from Session 3's `create_pre_migration_backup`) to
/// `keep`. Called by the frontend migration orchestrator only after a
/// migration run completes successfully — never after a failure, since a
/// failed run's own pre-migration backup is what a user would restore
/// from manually if automatic rollback also failed.
#[tauri::command(async)]
pub async fn apply_pre_migration_retention(app: AppHandle, token: String, keep: u32) -> Result<Vec<String>, String> {
    let conn = crate::identity::open_identity_db(&app)?;
    let actor = crate::authz::authorize(&conn, &token, "systemAdministration", "administer")?;
    let dir = app_private_dir(&app, "backups")?;
    let deleted = apply_retention(&dir, class_file_prefix("preMigration"), keep);
    let _ = crate::identity::record_security_audit_event(
        &conn,
        Some(&actor.user_id),
        Some(&actor.user_id),
        "pre_migration_backup_retention_applied",
        "success",
        Some(&format!("deleted_count={}", deleted.len())),
    );
    Ok(deleted)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DestinationRemapResult {
    pub adjusted: bool,
    pub note: String,
}

/// Pure remap decision: `None` when `folder` is not inside `old_root`
/// (nothing to remap — left unchanged), `Some(new_path)` otherwise, with
/// the exact same relative path preserved under `new_root`. Canonicalizes
/// both sides first so a symlink or `..`-bearing path still compares
/// correctly; falls back to the raw path when canonicalization fails
/// (e.g. the folder no longer exists), matching this codebase's existing
/// `canonicalize().unwrap_or_else(|_| ...)` convention.
pub(crate) fn remap_path(folder: &str, old_root: &Path, new_root: &Path) -> Option<PathBuf> {
    let folder_path = PathBuf::from(folder);
    let old_canon = old_root.canonicalize().unwrap_or_else(|_| old_root.to_path_buf());
    let folder_canon = folder_path.canonicalize().unwrap_or(folder_path);
    let rel = folder_canon.strip_prefix(&old_canon).ok()?;
    Some(new_root.join(rel))
}

/// Phase 11 Session 8 — called by the Data Location Manager after a
/// completed move or "use existing location" switch. If the configured
/// daily/weekly destination folder was inside the OLD data root, remaps
/// it to the equivalent path under the new root (the old path may not
/// exist once the old root is cleaned up). Otherwise leaves it completely
/// untouched — a destination outside the data root (an external drive,
/// say) has nothing to do with where the data itself lives, and this
/// function must never invent a reason to touch it.
pub(crate) fn remap_destination_after_move(
    app: &AppHandle,
    old_root: &Path,
    new_root: &Path,
) -> Result<DestinationRemapResult, String> {
    let path = state_path(app)?;
    let mut state = read_state_at(&path);
    let Some(folder) = state.config.destination_folder.clone() else {
        return Ok(DestinationRemapResult {
            adjusted: false,
            note: "no automatic backup destination folder was configured".to_string(),
        });
    };
    let Some(new_dest) = remap_path(&folder, old_root, new_root) else {
        return Ok(DestinationRemapResult {
            adjusted: false,
            note: "automatic backup destination is outside the moved data location — left unchanged".to_string(),
        });
    };
    let _ = std::fs::create_dir_all(&new_dest);
    state.config.destination_folder = Some(new_dest.to_string_lossy().to_string());
    write_state_at(&path, &state)?;
    Ok(DestinationRemapResult {
        adjusted: true,
        note: format!("automatic backup destination moved to {}", new_dest.to_string_lossy()),
    })
}

/// Reveals the configured automatic-backup destination folder in the OS
/// file manager. Unlike `artifact_file::open_path`/`reveal_path`, this
/// path is deliberately NOT scoped under a resolved data root — it is
/// whatever folder the user picked via the native folder dialog, which by
/// definition sits outside the workspace (same as `diagnostics::open_log_folder`'s
/// own use of `os_open` on an absolute, non-workspace path).
#[tauri::command(async)]
pub async fn open_automatic_backup_destination(path: String) -> Result<(), String> {
    crate::artifact_file::os_open(&PathBuf::from(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("formulab-autobackup-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(path: &Path, contents: &str) {
        std::fs::write(path, contents).unwrap();
    }

    #[test]
    fn default_config_matches_the_recommended_defaults() {
        let config = AutomaticBackupConfig::default();
        assert!(!config.enabled);
        assert!(config.daily_enabled);
        assert!(config.weekly_enabled);
        assert!(!config.backup_on_exit_enabled);
        assert_eq!(config.destination_folder, None);
        assert_eq!(config.retention_daily, 7);
        assert_eq!(config.retention_weekly, 4);
        assert_eq!(config.retention_pre_migration, 2);
    }

    #[test]
    fn state_round_trips_through_json_including_a_fresh_default() {
        let dir = tmp_dir("state-roundtrip");
        let path = dir.join("automatic_backup_state.json");
        let missing = read_state_at(&path);
        assert!(!missing.config.enabled);
        assert!(missing.last_success.is_none());

        let mut state = missing;
        state.config.enabled = true;
        state.config.destination_folder = Some("D:\\backups".to_string());
        state.last_daily_at = Some(1_000);
        write_state_at(&path, &state).unwrap();

        let read = read_state_at(&path);
        assert!(read.config.enabled);
        assert_eq!(read.config.destination_folder.as_deref(), Some("D:\\backups"));
        assert_eq!(read.last_daily_at, Some(1_000));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn configured_destination_dir_reports_missing_and_unset_distinctly() {
        let dir = tmp_dir("dest-dir");
        let real = dir.join("real");
        std::fs::create_dir_all(&real).unwrap();

        assert!(configured_destination_dir(&None).unwrap_err().contains("no automatic backup destination"));
        let missing = dir.join("does-not-exist").to_string_lossy().to_string();
        assert!(configured_destination_dir(&Some(missing)).unwrap_err().contains("does not exist"));
        assert_eq!(configured_destination_dir(&Some(real.to_string_lossy().to_string())).unwrap(), real);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn backup_epoch_from_name_parses_only_the_matching_prefix_and_suffix() {
        assert_eq!(
            backup_epoch_from_name("formulab-auto-daily-1700000000.formulab-backup", "formulab-auto-daily-"),
            Some(1_700_000_000)
        );
        assert_eq!(backup_epoch_from_name("pre-migration-42.formulab-backup", "pre-migration-"), Some(42));
        assert_eq!(backup_epoch_from_name("formulab-auto-weekly-1.formulab-backup", "formulab-auto-daily-"), None);
        assert_eq!(backup_epoch_from_name("formulab-auto-daily-not-a-number.formulab-backup", "formulab-auto-daily-"), None);
    }

    #[test]
    fn retention_for_maps_each_class_to_its_own_configured_count() {
        let config = AutomaticBackupConfig {
            retention_daily: 7,
            retention_weekly: 4,
            retention_pre_migration: 2,
            ..AutomaticBackupConfig::default()
        };
        assert_eq!(retention_for("daily", &config), 7);
        assert_eq!(retention_for("weekly", &config), 4);
        assert_eq!(retention_for("preMigration", &config), 2);
    }

    #[test]
    fn apply_retention_keeps_the_newest_n_and_deletes_the_oldest() {
        let dir = tmp_dir("retention-newest-n");
        let prefix = "formulab-auto-daily-";
        for epoch in [1, 2, 3, 4, 5] {
            touch(&dir.join(format!("{prefix}{epoch}.formulab-backup")), "x");
        }
        let deleted = apply_retention(&dir, prefix, 3);
        assert_eq!(deleted.len(), 2);
        let remaining: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(remaining.len(), 3);
        assert!(!remaining.iter().any(|n| n.contains("-1.formulab-backup") || n.contains("-2.formulab-backup")));
        assert!(remaining.iter().any(|n| n.contains("-5.formulab-backup")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_retention_never_deletes_the_only_valid_backup_even_at_zero_keep() {
        let dir = tmp_dir("retention-floor-one");
        let prefix = "pre-migration-";
        touch(&dir.join(format!("{prefix}100.formulab-backup")), "x");
        let deleted = apply_retention(&dir, prefix, 0);
        assert!(deleted.is_empty());
        assert!(dir.join(format!("{prefix}100.formulab-backup")).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_retention_ignores_other_classes_in_the_same_directory() {
        let dir = tmp_dir("retention-class-isolation");
        touch(&dir.join("formulab-auto-daily-1.formulab-backup"), "x");
        touch(&dir.join("formulab-auto-daily-2.formulab-backup"), "x");
        touch(&dir.join("formulab-auto-weekly-1.formulab-backup"), "x");
        let deleted = apply_retention(&dir, "formulab-auto-daily-", 1);
        assert_eq!(deleted.len(), 1);
        assert!(dir.join("formulab-auto-weekly-1.formulab-backup").exists());
        assert!(dir.join("formulab-auto-daily-2.formulab-backup").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_retention_removes_orphaned_tmp_packages_from_an_interrupted_backup() {
        let dir = tmp_dir("retention-orphan-tmp");
        let prefix = "formulab-auto-daily-";
        touch(&dir.join(format!("{prefix}1.formulab-backup")), "x");
        touch(&dir.join(format!("{prefix}2.formulab-backup.tmp")), "partial");
        touch(&dir.join("unrelated.formulab-backup.tmp"), "not ours");
        let deleted = apply_retention(&dir, prefix, 5);
        assert_eq!(deleted.len(), 1);
        assert!(!dir.join(format!("{prefix}2.formulab-backup.tmp")).exists());
        assert!(dir.join("unrelated.formulab-backup.tmp").exists());
        assert!(dir.join(format!("{prefix}1.formulab-backup")).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_retention_on_a_missing_directory_is_a_no_op_not_an_error() {
        let dir = tmp_dir("retention-missing-dir");
        let missing = dir.join("does-not-exist");
        let deleted = apply_retention(&missing, "formulab-auto-daily-", 3);
        assert!(deleted.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn class_file_prefix_matches_the_documented_naming_convention() {
        assert_eq!(class_file_prefix("daily"), "formulab-auto-daily-");
        assert_eq!(class_file_prefix("weekly"), "formulab-auto-weekly-");
        assert_eq!(class_file_prefix("preMigration"), "pre-migration-");
    }

    #[test]
    fn remap_path_preserves_the_relative_path_under_the_new_root() {
        let dir = tmp_dir("remap-inside");
        let old_root = dir.join("old");
        let sub = old_root.join("auto-backups");
        std::fs::create_dir_all(&sub).unwrap();
        let new_root = dir.join("new");
        let remapped = remap_path(&sub.to_string_lossy(), &old_root, &new_root).unwrap();
        assert_eq!(remapped, new_root.join("auto-backups"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn remap_path_is_none_when_the_folder_is_outside_the_old_root() {
        let dir = tmp_dir("remap-outside");
        let old_root = dir.join("old");
        let elsewhere = dir.join("elsewhere");
        std::fs::create_dir_all(&old_root).unwrap();
        std::fs::create_dir_all(&elsewhere).unwrap();
        let new_root = dir.join("new");
        assert!(remap_path(&elsewhere.to_string_lossy(), &old_root, &new_root).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn status_str_covers_every_verification_status() {
        assert_eq!(status_str(&VerificationStatus::Valid), "valid");
        assert_eq!(status_str(&VerificationStatus::ValidWithWarnings), "validWithWarnings");
        assert_eq!(status_str(&VerificationStatus::Incompatible), "incompatible");
        assert_eq!(status_str(&VerificationStatus::Corrupted), "corrupted");
        assert_eq!(status_str(&VerificationStatus::Unsafe), "unsafe");
    }
}
