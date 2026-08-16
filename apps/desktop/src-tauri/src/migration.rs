// Phase 11 Session 3 — schema migration framework.
//
// This module owns three things: the global schema-version marker
// (`data/master/schema_meta.json`), an append-only migration journal
// (`data/master/migration_journal.jsonl`), and a mandatory pre-migration
// backup (reusing `backup::try_create_backup` directly — no second backup
// mechanism). It never transforms a record itself: the actual per-record
// migration logic reuses the existing, tested engine in
// `packages/shared/src/engine/migrations.ts`, matching this project's
// "persistence stays the caller's job" convention for every `engine/`
// module. The one caller is the frontend orchestrator,
// `apps/desktop/src/lib/migrationRunner.ts`.
//
// Per this session's own instruction, no migration is registered against
// any real collection — every one of the 90 master collections has only
// ever shipped `schemaVersion: "1.0"` (confirmed in Session 0/1/2). This
// module and the frontend registry it pairs with are exercised by
// synthetic, test-only migrations, not a real one.
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::backup::{app_private_dir, now_secs, GLOBAL_SCHEMA_VERSION};

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMeta {
    pub global_schema_version: String,
    pub updated_at: u64,
}

fn schema_meta_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::formulation_v2::project_data_dir(app, "data")?
        .join("master")
        .join("schema_meta.json"))
}

/// A fresh/unmigrated project has no `schema_meta.json` at all — that is
/// not an error, it means every collection is still at whatever version
/// it has always shipped at (`"1.0"`, confirmed in Sessions 0-2), so the
/// implicit default IS the current supported version, not "unknown".
fn read_schema_meta_at(path: &Path) -> SchemaMeta {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(SchemaMeta {
            global_schema_version: GLOBAL_SCHEMA_VERSION.to_string(),
            updated_at: 0,
        })
}

fn write_schema_meta_at(path: &Path, version: &str) -> Result<SchemaMeta, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let meta = SchemaMeta {
        global_schema_version: version.to_string(),
        updated_at: now_secs(),
    };
    let tmp = PathBuf::from(format!("{}.tmp", path.to_string_lossy()));
    std::fs::write(&tmp, serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(meta)
}

#[tauri::command(async)]
pub async fn read_schema_meta(app: AppHandle) -> Result<SchemaMeta, String> {
    Ok(read_schema_meta_at(&schema_meta_path(&app)?))
}

#[tauri::command(async)]
pub async fn write_schema_meta(app: AppHandle, version: String) -> Result<SchemaMeta, String> {
    write_schema_meta_at(&schema_meta_path(&app)?, &version)
}

/// Schema versions in this codebase are `major.minor` (e.g. `"1.0"`), not
/// the `major.minor.patch` app-version scheme `backup.rs`'s own comparator
/// handles — a deliberately separate, smaller parser rather than forcing
/// a two-part string through a three-part parser.
fn parse_major_minor(v: &str) -> Option<(u64, u64)> {
    let mut parts = v.split('.').map(|p| p.parse::<u64>().ok());
    Some((parts.next()??, parts.next()??))
}

/// `"current"` / `"upgradable"` / `"futureUnsupported"`. An unparseable
/// declared version is treated as `"futureUnsupported"` — suspicious data
/// is never silently treated as safe-to-ignore.
pub(crate) fn schema_version_status(declared: &str, supported: &str) -> &'static str {
    if declared == supported {
        return "current";
    }
    match (parse_major_minor(declared), parse_major_minor(supported)) {
        (Some(d), Some(s)) if d < s => "upgradable",
        _ => "futureUnsupported",
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SchemaCompatibility {
    pub current_version: String,
    pub supported_version: String,
    pub status: String,
}

#[tauri::command(async)]
pub async fn check_schema_compatibility(app: AppHandle) -> Result<SchemaCompatibility, String> {
    let meta = read_schema_meta(app).await?;
    let status = schema_version_status(&meta.global_schema_version, GLOBAL_SCHEMA_VERSION);
    Ok(SchemaCompatibility {
        current_version: meta.global_schema_version,
        supported_version: GLOBAL_SCHEMA_VERSION.to_string(),
        status: status.to_string(),
    })
}

// ------------------------------------------------------------- journal ---

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MigrationJournalEntry {
    pub run_id: String,
    pub ts: u64,
    /// "run_started" | "collection_started" | "collection_completed" |
    /// "collection_failed" | "run_completed" | "run_failed" |
    /// "rolled_back" | "rejected_future_version".
    pub step: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup_path: Option<String>,
}

fn journal_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::formulation_v2::project_data_dir(app, "data")?
        .join("master")
        .join("migration_journal.jsonl"))
}

fn append_journal_at(path: &Path, entry: &MigrationJournalEntry) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let line = serde_json::to_string(entry).map_err(|e| e.to_string())?;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    writeln!(f, "{line}").map_err(|e| e.to_string())
}

fn read_journal_at(path: &Path) -> Vec<MigrationJournalEntry> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect()
}

#[tauri::command(async)]
pub async fn append_migration_journal(app: AppHandle, entry: MigrationJournalEntry) -> Result<(), String> {
    append_journal_at(&journal_path(&app)?, &entry)
}

#[tauri::command(async)]
pub async fn read_migration_journal(app: AppHandle) -> Result<Vec<MigrationJournalEntry>, String> {
    Ok(read_journal_at(&journal_path(&app)?))
}

/// Whether the journal's last entry for `run_id` is `"run_started"` with no
/// matching `"run_completed"`/`"run_failed"`/`"rolled_back"` after it — an
/// interrupted run (the app quit or crashed mid-migration) that needs
/// recovery before anything else touches master data.
///
/// Not called by any command today — `apps/desktop/src/lib/migrationRunner.ts`'s
/// `findInterruptedRun` is what `checkForInterruptedMigration()` actually
/// uses (the registry it needs only exists in TypeScript). Kept and tested
/// here as the Rust-side equivalent, in case a future Rust-only caller
/// needs it without round-tripping through the frontend.
#[allow(dead_code)]
pub(crate) fn find_interrupted_run(entries: &[MigrationJournalEntry]) -> Option<String> {
    let mut started: Option<&str> = None;
    for e in entries {
        match e.step.as_str() {
            "run_started" => started = Some(&e.run_id),
            "run_completed" | "run_failed" | "rolled_back" => {
                if started == Some(e.run_id.as_str()) {
                    started = None;
                }
            }
            _ => {}
        }
    }
    started.map(|s| s.to_string())
}

// -------------------------------------------------------------- backup ---

/// Creates a `.formulab-backup` in app-private storage (never a path the
/// user picks) and returns it. Reuses `backup::try_create_backup` directly
/// — there is exactly one backup-creation code path in this codebase, used
/// by manual backup, restore's safety backup, and this pre-migration
/// backup alike.
/// Phase 13 Session 4: reached only from `SchemaMigrationCard.tsx` inside
/// the authenticated Settings UI (never at pre-login startup), so — unlike
/// `automatic_backup::run_automatic_backup` — this is a real interactive,
/// user-initiated action, not an unattended background job. Gated
/// `systemAdministration`/`administer`.
#[tauri::command(async)]
pub async fn create_pre_migration_backup(app: AppHandle, token: String) -> Result<String, String> {
    crate::authz::authorize_app(&app, &token, "systemAdministration", "administer")?;
    let dir = app_private_dir(&app, "backups")?;
    let dest = dir.join(format!("pre-migration-{}.formulab-backup", now_secs()));
    let tmp = PathBuf::from(format!("{}.tmp", dest.to_string_lossy()));
    let cancel = Arc::new(AtomicBool::new(false));
    let result = crate::backup::try_create_backup(&app, &dest, &tmp, &cancel, "migration-progress");
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result?;
    Ok(dest.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("formulab-migration-test-{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn schema_meta_defaults_to_the_current_supported_version_when_absent() {
        let dir = tmp_dir("meta-default");
        let meta = read_schema_meta_at(&dir.join("schema_meta.json"));
        assert_eq!(meta.global_schema_version, GLOBAL_SCHEMA_VERSION);
        assert_eq!(meta.updated_at, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn schema_meta_write_then_read_round_trips() {
        let dir = tmp_dir("meta-roundtrip");
        let path = dir.join("schema_meta.json");
        let written = write_schema_meta_at(&path, "1.1").unwrap();
        assert_eq!(written.global_schema_version, "1.1");
        let read = read_schema_meta_at(&path);
        assert_eq!(read.global_schema_version, "1.1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn schema_version_status_distinguishes_current_upgradable_and_future() {
        assert_eq!(schema_version_status("1.0", "1.0"), "current");
        assert_eq!(schema_version_status("1.0", "1.1"), "upgradable");
        assert_eq!(schema_version_status("1.2", "1.1"), "futureUnsupported");
        assert_eq!(schema_version_status("not-a-version", "1.1"), "futureUnsupported");
    }

    #[test]
    fn journal_append_then_read_round_trips_in_order() {
        let dir = tmp_dir("journal-roundtrip");
        let path = dir.join("migration_journal.jsonl");
        let e1 = MigrationJournalEntry {
            run_id: "run-1".into(),
            ts: 1,
            step: "run_started".into(),
            collection: None,
            from_version: None,
            to_version: None,
            message: None,
            backup_path: Some("C:\\backups\\pre-migration-1.formulab-backup".into()),
        };
        let e2 = MigrationJournalEntry {
            run_id: "run-1".into(),
            ts: 2,
            step: "run_completed".into(),
            collection: None,
            from_version: Some("1.0".into()),
            to_version: Some("1.1".into()),
            message: None,
            backup_path: None,
        };
        append_journal_at(&path, &e1).unwrap();
        append_journal_at(&path, &e2).unwrap();
        let entries = read_journal_at(&path);
        assert_eq!(entries, vec![e1, e2]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_journal_at_a_missing_path_is_an_empty_list_not_an_error() {
        let dir = tmp_dir("journal-missing");
        let entries = read_journal_at(&dir.join("does-not-exist.jsonl"));
        assert!(entries.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_interrupted_run_detects_a_started_run_with_no_completion() {
        let started = MigrationJournalEntry {
            run_id: "run-x".into(),
            ts: 1,
            step: "run_started".into(),
            collection: None,
            from_version: None,
            to_version: None,
            message: None,
            backup_path: Some("C:\\backups\\pre-migration-x.formulab-backup".into()),
        };
        assert_eq!(find_interrupted_run(&[started.clone()]), Some("run-x".to_string()));

        let completed = MigrationJournalEntry {
            step: "run_completed".into(),
            ts: 2,
            ..started.clone()
        };
        assert_eq!(find_interrupted_run(&[started.clone(), completed]), None);

        let failed = MigrationJournalEntry {
            step: "run_failed".into(),
            ts: 2,
            ..started.clone()
        };
        assert_eq!(find_interrupted_run(&[started.clone(), failed]), None);

        let rolled_back = MigrationJournalEntry {
            step: "rolled_back".into(),
            ts: 2,
            ..started.clone()
        };
        assert_eq!(find_interrupted_run(&[started, rolled_back]), None);
    }

    #[test]
    fn find_interrupted_run_ignores_a_completed_earlier_run_and_flags_a_later_started_one() {
        let run1_started = MigrationJournalEntry {
            run_id: "run-1".into(),
            ts: 1,
            step: "run_started".into(),
            collection: None,
            from_version: None,
            to_version: None,
            message: None,
            backup_path: None,
        };
        let run1_completed = MigrationJournalEntry {
            step: "run_completed".into(),
            ts: 2,
            ..run1_started.clone()
        };
        let run2_started = MigrationJournalEntry {
            run_id: "run-2".into(),
            ts: 3,
            ..run1_started.clone()
        };
        let entries = vec![run1_started, run1_completed, run2_started];
        assert_eq!(find_interrupted_run(&entries), Some("run-2".to_string()));
    }
}
