// Phase 11 Session 8 — Data Location Manager.
//
// Turns Session 4's read-only Active Data Location card into a safe way to
// actually relocate the active data root: validate a candidate destination,
// move data into it (stage -> verify -> activate -> only then flip the
// pointer), or point at an already-existing FormuLab root without copying
// anything. The old root is never deleted automatically — only a separate,
// explicitly-confirmed cleanup action does that, and this session does not
// implement it as a destructive default.
//
// Reuses, never duplicates:
//   - `backup::try_create_backup` / `verify_backup_report` for the
//     mandatory pre-move safety backup (Sessions 1-2's engine, unchanged).
//   - `data_root::resolve_data_root` to confirm a pointer change actually
//     took effect (a higher-precedence override could otherwise make a
//     pointer write silently no-op).
//   - `workspace::base_workspace_file` — the exact pointer
//     `set_workspace_base` already writes for the existing "Change
//     workspace folder" control. This module is a second, safer writer of
//     the SAME file, not a new pointer.
//   - `BackupState` — the same concurrency slot manual backup/restore and
//     automatic backups already hold, so a move can never run alongside
//     any of them.
//
// `.FormuLab/runs.db` is never copied, staged, or activated by a move —
// see `walk_movable_files` below. It is derived, disposable data
// (docs/PHASE11_DATA_INVENTORY.md item 8) that a later launch rebuilds
// from `runs.jsonl` at whichever root ends up active.
use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::automatic_backup::{remap_destination_after_move, DestinationRemapResult};
use crate::backup::{app_private_dir, now_secs, try_create_backup, verify_backup_report, BackupProgress, BackupState, VerificationStatus};
use crate::data_root::{path_holds_real_data, resolve_data_root, to_status, DataRootStatus};

const RUNS_DB_REL: &str = ".FormuLab/runs.db";
const STAGING_PREFIX: &str = ".formulab-move-staging-";

fn emit_progress(app: &AppHandle, phase: &str, current: u64, total: u64, message: &str) {
    let _ = app.emit(
        "data-move-progress",
        BackupProgress {
            phase: phase.to_string(),
            current,
            total,
            message: message.to_string(),
        },
    );
}

// ---------------------------------------------------------- validation ---

#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum DestinationKind {
    Empty,
    ExistingCompatibleRoot,
    Conflicting,
    SameAsCurrent,
    NotADirectory,
    Unwritable,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DestinationValidation {
    pub path: String,
    pub kind: DestinationKind,
    pub writable: bool,
    pub required_bytes: u64,
    pub available_bytes: Option<u64>,
    pub sufficient_space: bool,
    pub can_move: bool,
    pub can_use_existing: bool,
    pub warnings: Vec<String>,
    pub blockers: Vec<String>,
}

/// Every real file under `root`, recursive, excluding `.FormuLab/runs.db`.
/// Returns (absolute source path, forward-slash root-relative path).
/// Deliberately independent of `backup.rs`'s `collect_included` — that
/// function curates a portable disaster-recovery SUBSET (excludes
/// `data/literature`, `data/master/backups/`, etc. for package-size
/// reasons); a move must relocate the WHOLE root byte-for-byte (minus
/// `runs.db`) or real files would be silently left behind.
pub(crate) fn walk_movable_files(root: &Path) -> Result<Vec<(PathBuf, String)>, String> {
    let mut out = Vec::new();
    walk_movable_files_inner(root, root, &mut out)?;
    Ok(out)
}

fn walk_movable_files_inner(root: &Path, dir: &Path, out: &mut Vec<(PathBuf, String)>) -> Result<(), String> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(STAGING_PREFIX) {
                continue; // never re-walk a leftover staging directory
            }
            walk_movable_files_inner(root, &path, out)?;
        } else if path.is_file() {
            let rel = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if rel == RUNS_DB_REL {
                continue;
            }
            out.push((path, rel));
        }
    }
    Ok(())
}

pub(crate) fn total_bytes(files: &[(PathBuf, String)]) -> u64 {
    files.iter().filter_map(|(p, _)| std::fs::metadata(p).ok().map(|m| m.len())).sum()
}

fn canonical_or_self(p: &Path) -> PathBuf {
    p.canonicalize().unwrap_or_else(|_| p.to_path_buf())
}

/// Pure validation (no `AppHandle`) against two real paths on disk —
/// directly unit-testable against real temp directories, matching this
/// phase's established "AppHandle-free where possible" discipline
/// (`backup::verify_backup_report`, `data_root::resolve_data_root_at`).
/// Creates `dest` if it does not exist yet (matching `set_workspace_base`'s
/// existing "create it if needed" behavior) — validation is meant to be
/// safe to call repeatedly while a user is picking a folder.
pub(crate) fn validate_destination_at(current_root: &Path, dest: &Path, required_bytes: u64) -> DestinationValidation {
    let mut warnings = Vec::new();
    let mut blockers = Vec::new();

    if !dest.exists() {
        if let Err(e) = std::fs::create_dir_all(dest) {
            blockers.push(format!("could not create destination folder: {e}"));
            return DestinationValidation {
                path: dest.to_string_lossy().to_string(),
                kind: DestinationKind::Unwritable,
                writable: false,
                required_bytes,
                available_bytes: None,
                sufficient_space: false,
                can_move: false,
                can_use_existing: false,
                warnings,
                blockers,
            };
        }
    }

    if !dest.is_dir() {
        blockers.push("the chosen path is not a directory".to_string());
        return DestinationValidation {
            path: dest.to_string_lossy().to_string(),
            kind: DestinationKind::NotADirectory,
            writable: false,
            required_bytes,
            available_bytes: None,
            sufficient_space: false,
            can_move: false,
            can_use_existing: false,
            warnings,
            blockers,
        };
    }

    let probe = dest.join(".formulab-write-probe");
    let writable = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    if !writable {
        blockers.push("destination is not writable".to_string());
        return DestinationValidation {
            path: dest.to_string_lossy().to_string(),
            kind: DestinationKind::Unwritable,
            writable,
            required_bytes,
            available_bytes: None,
            sufficient_space: false,
            can_move: false,
            can_use_existing: false,
            warnings,
            blockers,
        };
    }

    let dest_canon = canonical_or_self(dest);
    let current_canon = canonical_or_self(current_root);
    if dest_canon == current_canon {
        blockers.push("this is already the active data location".to_string());
        return DestinationValidation {
            path: dest.to_string_lossy().to_string(),
            kind: DestinationKind::SameAsCurrent,
            writable,
            required_bytes,
            available_bytes: None,
            sufficient_space: false,
            can_move: false,
            can_use_existing: false,
            warnings,
            blockers,
        };
    }

    // A destination *inside* the current root looks "Empty" (freshly
    // created, no entries yet) and would otherwise sail through validation
    // — but `walk_movable_files` snapshots the source tree before staging
    // begins, so a move would silently nest the whole source under itself
    // (`data/` -> `data/data/`) rather than fail loudly. `strip_prefix`
    // checks real path components, not a string prefix, so a sibling like
    // `data-archive` next to `data` does not false-positive here.
    if dest_canon.strip_prefix(&current_canon).is_ok() {
        blockers.push("the destination is inside the current data location — choose a folder outside it".to_string());
        return DestinationValidation {
            path: dest.to_string_lossy().to_string(),
            kind: DestinationKind::Conflicting,
            writable,
            required_bytes,
            available_bytes: None,
            sufficient_space: false,
            can_move: false,
            can_use_existing: false,
            warnings,
            blockers,
        };
    }

    // Free space is only ever relevant to a MOVE (a copy) — "use existing"
    // copies nothing, so an existing-compatible-root destination is never
    // blocked by it. Computed here regardless so the UI can always show it.
    let available_bytes = fs4::available_space(dest).ok();
    let margin = required_bytes / 10 + 4096;
    let sufficient_space = match available_bytes {
        Some(avail) => avail >= required_bytes + margin,
        None => true, // filesystem doesn't report free space — don't block; the copy fails cleanly if space genuinely runs out
    };

    let has_entries = std::fs::read_dir(dest).map(|mut it| it.next().is_some()).unwrap_or(false);
    if !has_entries {
        if required_bytes > 0 && !sufficient_space {
            blockers.push(format!(
                "not enough free disk space at destination: {} bytes required, {} available",
                required_bytes + margin,
                available_bytes.unwrap_or(0)
            ));
        }
        let can_move = blockers.is_empty();
        return DestinationValidation {
            path: dest.to_string_lossy().to_string(),
            kind: DestinationKind::Empty,
            writable,
            required_bytes,
            available_bytes,
            sufficient_space,
            can_move,
            can_use_existing: false,
            warnings,
            blockers,
        };
    }

    if path_holds_real_data(dest) {
        warnings.push(
            "this folder already contains FormuLab data — choosing it switches to using it as-is, nothing is copied or merged"
                .to_string(),
        );
        return DestinationValidation {
            path: dest.to_string_lossy().to_string(),
            kind: DestinationKind::ExistingCompatibleRoot,
            writable,
            required_bytes,
            available_bytes,
            sufficient_space,
            can_move: false,
            can_use_existing: true,
            warnings,
            blockers,
        };
    }

    blockers.push("this folder contains other files but no recognizable FormuLab data".to_string());
    DestinationValidation {
        path: dest.to_string_lossy().to_string(),
        kind: DestinationKind::Conflicting,
        writable,
        required_bytes,
        available_bytes,
        sufficient_space,
        can_move: false,
        can_use_existing: false,
        warnings,
        blockers,
    }
}

#[tauri::command(async)]
pub async fn validate_data_move_destination(app: AppHandle, path: String) -> Result<DestinationValidation, String> {
    let source = resolve_data_root(&app)?.path;
    let dest = PathBuf::from(&path);
    let files = walk_movable_files(&source)?;
    let required = total_bytes(&files);
    Ok(validate_destination_at(&source, &dest, required))
}

// -------------------------------------------------------------- journal ---

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataMoveJournalEntry {
    pub run_id: String,
    pub ts: u64,
    /// "move_started" | "safety_backup_created" | "staged" | "verified" |
    /// "activated" | "pointer_updated" | "resolution_confirmed" |
    /// "move_completed" | "move_failed" | "rolled_back".
    pub step: String,
    pub source_root: String,
    pub destination_root: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// App-private, deliberately NOT inside the data root itself — the root is
/// exactly what a move changes, so journaling inside it would make the
/// journal unreadable (or wrongly scoped) the moment resolution flips to
/// a different directory.
fn journal_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("runtime");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("data_move_journal.jsonl"))
}

fn append_journal(app: &AppHandle, entry: &DataMoveJournalEntry) -> Result<(), String> {
    let path = journal_path(app)?;
    let line = serde_json::to_string(entry).map_err(|e| e.to_string())?;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(f, "{line}").map_err(|e| e.to_string())
}

fn read_journal(app: &AppHandle) -> Vec<DataMoveJournalEntry> {
    let Ok(path) = journal_path(app) else { return Vec::new() };
    let Ok(text) = std::fs::read_to_string(&path) else { return Vec::new() };
    text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect()
}

/// The most recent `move_started` with no matching terminal entry
/// (`move_completed`/`move_failed`/`rolled_back`) after it — an
/// interrupted move (the app quit or crashed mid-operation).
pub(crate) fn find_interrupted_move(entries: &[DataMoveJournalEntry]) -> Option<DataMoveJournalEntry> {
    let mut started: Option<DataMoveJournalEntry> = None;
    for e in entries {
        match e.step.as_str() {
            "move_started" => started = Some(e.clone()),
            "move_completed" | "move_failed" | "rolled_back" => {
                if started.as_ref().map(|s| s.run_id.as_str()) == Some(e.run_id.as_str()) {
                    started = None;
                }
            }
            _ => {}
        }
    }
    started
}

#[tauri::command(async)]
pub async fn check_interrupted_data_move(app: AppHandle) -> Result<Option<DataMoveJournalEntry>, String> {
    Ok(find_interrupted_move(&read_journal(&app)))
}

/// Which recovery action a resume should take, decided purely from which
/// journal steps an interrupted run reached — directly unit-testable
/// without an `AppHandle`, isolating the one part of resume that is pure
/// decision-making from the filesystem/pointer side effects around it.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(crate) enum ResumeAction {
    /// Every step up to confirmation was journaled; only the final
    /// `move_completed` marker is missing — nothing to redo.
    AlreadyComplete,
    /// The pointer was written but never confirmed — re-check resolution
    /// now and either finish or roll the pointer back.
    CompleteFromPointerUpdated,
    /// Files were verified and activated at the destination, but the
    /// pointer was never flipped — the source root is still untouched and
    /// active; safe to finish by writing the pointer now.
    CompleteFromActivated,
    /// Nothing was ever activated — the source root was never touched;
    /// only stray staging data (if any) needs discarding.
    RollbackNothingActivated,
}

pub(crate) fn resume_decision(steps: &HashSet<&str>) -> ResumeAction {
    if steps.contains("resolution_confirmed") {
        ResumeAction::AlreadyComplete
    } else if steps.contains("pointer_updated") {
        ResumeAction::CompleteFromPointerUpdated
    } else if steps.contains("activated") {
        ResumeAction::CompleteFromActivated
    } else {
        ResumeAction::RollbackNothingActivated
    }
}

fn hash_and_len(path: &Path) -> Result<(String, u64), String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    let mut total = 0u64;
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        total += n as u64;
    }
    Ok((format!("{:x}", hasher.finalize()), total))
}

// ------------------------------------------------------------ move data ---

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataMoveResult {
    pub run_id: String,
    pub source_root: String,
    pub destination_root: String,
    pub files_moved: u64,
    pub total_bytes: u64,
    pub safety_backup_path: String,
    pub automatic_backup: DestinationRemapResult,
    pub warnings: Vec<String>,
}

fn journal_step(app: &AppHandle, run_id: &str, source: &str, dest: &str, step: &str, message: Option<String>) {
    let _ = append_journal(
        app,
        &DataMoveJournalEntry {
            run_id: run_id.to_string(),
            ts: now_secs(),
            step: step.to_string(),
            source_root: source.to_string(),
            destination_root: dest.to_string(),
            message,
        },
    );
}

fn try_move_data(app: &AppHandle, dest: &Path, cancel: &Arc<AtomicBool>, run_id: &str) -> Result<DataMoveResult, String> {
    let source = resolve_data_root(app)?.path;
    let source_str = source.to_string_lossy().to_string();
    let dest_str = dest.to_string_lossy().to_string();
    let j = |step: &str, message: Option<String>| journal_step(app, run_id, &source_str, &dest_str, step, message);

    j("move_started", None);

    let files = walk_movable_files(&source)?;
    let required = total_bytes(&files);
    let validation = validate_destination_at(&source, dest, required);
    if !validation.can_move {
        let msg = if validation.blockers.is_empty() {
            "destination is not eligible for a move".to_string()
        } else {
            validation.blockers.join("; ")
        };
        j("move_failed", Some(msg.clone()));
        return Err(msg);
    }

    if cancel.load(Ordering::SeqCst) {
        j("move_failed", Some("cancelled".into()));
        return Err("cancelled".into());
    }

    emit_progress(app, "backingUp", 0, 0, "Creating a safety backup before moving data");
    let backups_dir = app_private_dir(app, "backups")?;
    let safety_path = backups_dir.join(format!("pre-move-{}.formulab-backup", now_secs()));
    let safety_tmp = PathBuf::from(format!("{}.tmp", safety_path.to_string_lossy()));
    if let Err(e) = try_create_backup(app, &safety_path, &safety_tmp, cancel, "data-move-progress") {
        let _ = std::fs::remove_file(&safety_tmp);
        j("move_failed", Some(format!("safety backup failed: {e}")));
        return Err(format!("safety backup failed: {e}"));
    }
    let report = verify_backup_report(&safety_path);
    if !matches!(report.status, VerificationStatus::Valid | VerificationStatus::ValidWithWarnings) {
        j("move_failed", Some("safety backup failed verification".into()));
        return Err("safety backup failed verification — move aborted before touching anything".into());
    }
    j("safety_backup_created", Some(safety_path.to_string_lossy().to_string()));

    if cancel.load(Ordering::SeqCst) {
        j("move_failed", Some("cancelled".into()));
        return Err("cancelled".into());
    }

    let staging_dir = dest.join(format!("{STAGING_PREFIX}{}", now_secs()));
    std::fs::create_dir_all(&staging_dir).map_err(|e| e.to_string())?;
    let cleanup_staging = || {
        let _ = std::fs::remove_dir_all(&staging_dir);
    };

    let total = files.len() as u64;
    let mut staged: Vec<(PathBuf, String, u64, String)> = Vec::with_capacity(files.len());
    for (i, (src_path, rel)) in files.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            cleanup_staging();
            j("move_failed", Some("cancelled".into()));
            return Err("cancelled".into());
        }
        emit_progress(app, "staging", i as u64, total, rel);
        let (hash, len) = match hash_and_len(src_path) {
            Ok(v) => v,
            Err(e) => {
                cleanup_staging();
                j("move_failed", Some(e.clone()));
                return Err(e);
            }
        };
        let staged_path = staging_dir.join(format!("{i}.bin"));
        if let Err(e) = std::fs::copy(src_path, &staged_path) {
            cleanup_staging();
            j("move_failed", Some(e.to_string()));
            return Err(e.to_string());
        }
        staged.push((staged_path, rel.clone(), len, hash));
    }

    for (i, (staged_path, rel, len, hash)) in staged.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            cleanup_staging();
            j("move_failed", Some("cancelled".into()));
            return Err("cancelled".into());
        }
        emit_progress(app, "verifying", i as u64, total, rel);
        let (actual_hash, actual_len) = match hash_and_len(staged_path) {
            Ok(v) => v,
            Err(e) => {
                cleanup_staging();
                j("move_failed", Some(e.clone()));
                return Err(e);
            }
        };
        if actual_len != *len || actual_hash != *hash {
            cleanup_staging();
            let msg = format!("staged copy of {rel} failed verification — move aborted, nothing activated");
            j("move_failed", Some(msg.clone()));
            return Err(msg);
        }
    }
    j("staged", Some(format!("{} files", staged.len())));
    j("verified", None);

    emit_progress(app, "activating", 0, total, "Activating the new location");
    let activated = match activate_staged(dest, &staging_dir, &staged) {
        Ok(paths) => paths,
        Err(err) => {
            j("move_failed", Some(format!("activation failed: {err}")));
            return Err(format!(
                "activation failed, rolled back: {err} (source data untouched, safety backup: {})",
                safety_path.to_string_lossy()
            ));
        }
    };
    let _ = activated;
    cleanup_staging();
    j("activated", None);

    match activate_pointer(app, &source, dest, run_id) {
        Ok(resolved_dest) => {
            let automatic_backup = remap_destination_after_move(app, &source, &resolved_dest).unwrap_or(DestinationRemapResult {
                adjusted: false,
                note: "could not check the automatic backup destination".to_string(),
            });
            j("move_completed", None);
            emit_progress(app, "done", total, total, "Move complete");
            Ok(DataMoveResult {
                run_id: run_id.to_string(),
                source_root: source_str,
                destination_root: resolved_dest.to_string_lossy().to_string(),
                files_moved: staged.len() as u64,
                total_bytes: required,
                safety_backup_path: safety_path.to_string_lossy().to_string(),
                automatic_backup,
                warnings: validation.warnings,
            })
        }
        Err(e) => Err(e),
    }
}

/// Renames every staged file into its final path under `dest`. On any
/// failure partway through, removes every file already placed and the
/// staging directory, leaving `dest` exactly as empty as validation found
/// it — the source root is never touched by this function at all.
fn activate_staged(dest: &Path, staging_dir: &Path, staged: &[(PathBuf, String, u64, String)]) -> Result<Vec<PathBuf>, String> {
    let mut activated: Vec<PathBuf> = Vec::with_capacity(staged.len());
    for (staged_path, rel, _len, _hash) in staged {
        let final_path = dest.join(rel);
        if let Some(parent) = final_path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                for p in &activated {
                    let _ = std::fs::remove_file(p);
                }
                let _ = std::fs::remove_dir_all(staging_dir);
                return Err(e.to_string());
            }
        }
        if std::fs::rename(staged_path, &final_path).is_err() {
            // A same-volume rename should not fail, but fall back to
            // copy+remove for the rare case (network share, etc.) where it
            // does — never leave the file only half-moved.
            if let Err(e2) = std::fs::copy(staged_path, &final_path).and_then(|_| std::fs::remove_file(staged_path)) {
                for p in &activated {
                    let _ = std::fs::remove_file(p);
                }
                let _ = std::fs::remove_dir_all(staging_dir);
                return Err(e2.to_string());
            }
        }
        activated.push(final_path);
    }
    Ok(activated)
}

/// Writes the `base-workspace.txt` pointer to `dest`, then re-resolves and
/// confirms the app actually now resolves there — a higher-precedence
/// override (`formulab-root.txt`/`active-workspace.txt`) could otherwise
/// make the write silently have no visible effect. Rolls the pointer file
/// back to its exact previous content (or removes it, if it didn't exist)
/// on any failure. The previous content is also journaled (`prev:...`) so
/// an interrupted-move resume can roll back even after a crash wiped this
/// function's own in-memory copy.
fn activate_pointer(app: &AppHandle, source: &Path, dest: &Path, run_id: &str) -> Result<PathBuf, String> {
    let source_str = source.to_string_lossy().to_string();
    let dest_str = dest.to_string_lossy().to_string();
    let j = |step: &str, message: Option<String>| journal_step(app, run_id, &source_str, &dest_str, step, message);

    let pointer_path = crate::workspace::base_workspace_file(app)?;
    let previous_pointer = std::fs::read_to_string(&pointer_path).ok();
    let dest_canon = canonical_or_self(dest);
    if let Err(e) = std::fs::write(&pointer_path, dest_canon.to_string_lossy().as_bytes()) {
        return Err(format!(
            "data was copied to {} but the active location could not be switched: {e} (your previous location is still active and untouched)",
            dest_canon.to_string_lossy()
        ));
    }
    j(
        "pointer_updated",
        Some(format!("prev:{}", previous_pointer.clone().unwrap_or_else(|| "NONE".to_string()))),
    );

    let resolved = resolve_data_root(app)?;
    if resolved.path != dest_canon {
        restore_pointer(&pointer_path, previous_pointer.as_deref());
        let msg = format!(
            "data was copied to {} and the pointer was updated, but the app still resolves to {} (a higher-priority override is active) — rolled back the pointer change; your previous location is still in use",
            dest_canon.to_string_lossy(),
            resolved.path.to_string_lossy()
        );
        j("move_failed", Some(msg.clone()));
        return Err(msg);
    }
    j("resolution_confirmed", None);
    Ok(dest_canon)
}

fn restore_pointer(pointer_path: &Path, previous: Option<&str>) {
    match previous {
        Some(prev) => {
            let _ = std::fs::write(pointer_path, prev);
        }
        None => {
            let _ = std::fs::remove_file(pointer_path);
        }
    }
}

/// Phase 13 Session 4: data-location changes are System Administration —
/// gated `systemAdministration`/`administer`, administrator-only.
#[tauri::command(async)]
pub async fn move_data_location(app: AppHandle, token: String, state: State<'_, BackupState>, destination: String) -> Result<DataMoveResult, String> {
    crate::authz::authorize_app(&app, &token, "systemAdministration", "administer")?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut guard = state.0.lock().map_err(|_| "backup state unavailable".to_string())?;
        if guard.is_some() {
            return Err("another backup, restore, or move is already in progress".to_string());
        }
        *guard = Some(cancel.clone());
    }
    let run_id = format!("move-{}", now_secs());
    let dest = PathBuf::from(&destination);
    let result = try_move_data(&app, &dest, &cancel, &run_id);
    if let Err(e) = &result {
        let phase = if cancel.load(Ordering::SeqCst) { "cancelled" } else { "error" };
        emit_progress(&app, phase, 0, 0, e);
    }
    {
        let mut guard = state.0.lock().map_err(|_| "backup state unavailable".to_string())?;
        *guard = None;
    }
    result
}

#[tauri::command]
pub fn cancel_data_move(state: State<'_, BackupState>) {
    crate::backup::cancel_backup(state)
}

// ------------------------------------------------------- use existing ---

fn try_use_existing(app: &AppHandle, dest: &Path, cancel: &Arc<AtomicBool>, run_id: &str) -> Result<DataMoveResult, String> {
    let source = resolve_data_root(app)?.path;
    let source_str = source.to_string_lossy().to_string();
    let dest_str = dest.to_string_lossy().to_string();
    let j = |step: &str, message: Option<String>| journal_step(app, run_id, &source_str, &dest_str, step, message);

    j("move_started", Some("use-existing-location".into()));

    let validation = validate_destination_at(&source, dest, 0);
    if !validation.can_use_existing {
        let msg = if validation.blockers.is_empty() {
            "destination is not usable as an existing FormuLab location".to_string()
        } else {
            validation.blockers.join("; ")
        };
        j("move_failed", Some(msg.clone()));
        return Err(msg);
    }
    if cancel.load(Ordering::SeqCst) {
        j("move_failed", Some("cancelled".into()));
        return Err("cancelled".into());
    }

    // A safety backup of the CURRENT root before switching — a pointer
    // change is a real, if reversible, change to what every command in
    // the app operates on.
    let backups_dir = app_private_dir(app, "backups")?;
    let safety_path = backups_dir.join(format!("pre-relocate-{}.formulab-backup", now_secs()));
    let safety_tmp = PathBuf::from(format!("{}.tmp", safety_path.to_string_lossy()));
    if let Err(e) = try_create_backup(app, &safety_path, &safety_tmp, cancel, "data-move-progress") {
        let _ = std::fs::remove_file(&safety_tmp);
        j("move_failed", Some(format!("safety backup failed: {e}")));
        return Err(format!("safety backup failed: {e}"));
    }
    let report = verify_backup_report(&safety_path);
    if !matches!(report.status, VerificationStatus::Valid | VerificationStatus::ValidWithWarnings) {
        j("move_failed", Some("safety backup failed verification".into()));
        return Err("safety backup failed verification — nothing was switched".into());
    }
    j("safety_backup_created", Some(safety_path.to_string_lossy().to_string()));
    j("activated", Some("no files to activate — destination already holds its own data".into()));

    let resolved_dest = activate_pointer(app, &source, dest, run_id)?;

    let automatic_backup = remap_destination_after_move(app, &source, &resolved_dest).unwrap_or(DestinationRemapResult {
        adjusted: false,
        note: "could not check the automatic backup destination".to_string(),
    });
    j("move_completed", None);

    Ok(DataMoveResult {
        run_id: run_id.to_string(),
        source_root: source_str,
        destination_root: resolved_dest.to_string_lossy().to_string(),
        files_moved: 0,
        total_bytes: 0,
        safety_backup_path: safety_path.to_string_lossy().to_string(),
        automatic_backup,
        warnings: validation.warnings,
    })
}

#[tauri::command(async)]
pub async fn use_existing_data_location(app: AppHandle, token: String, state: State<'_, BackupState>, path: String) -> Result<DataMoveResult, String> {
    crate::authz::authorize_app(&app, &token, "systemAdministration", "administer")?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut guard = state.0.lock().map_err(|_| "backup state unavailable".to_string())?;
        if guard.is_some() {
            return Err("another backup, restore, or move is already in progress".to_string());
        }
        *guard = Some(cancel.clone());
    }
    let run_id = format!("use-existing-{}", now_secs());
    let dest = PathBuf::from(&path);
    let result = try_use_existing(&app, &dest, &cancel, &run_id);
    {
        let mut guard = state.0.lock().map_err(|_| "backup state unavailable".to_string())?;
        *guard = None;
    }
    result
}

// -------------------------------------------------------- restore default ---

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RestoreDefaultResult {
    pub status: DataRootStatus,
    pub pointer_removed: bool,
}

/// Removes only the `base-workspace.txt` pointer this module and
/// `set_workspace_base` write — never `formulab-root.txt` or
/// `active-workspace.txt`, which this app has never written and which may
/// be a poweruser's own manual override; if one of those is present it
/// still wins after this call, surfaced as a resolution warning rather
/// than silently deleted.
#[tauri::command(async)]
pub async fn restore_default_data_location(app: AppHandle, token: String) -> Result<RestoreDefaultResult, String> {
    crate::authz::authorize_app(&app, &token, "systemAdministration", "administer")?;
    let pointer_path = crate::workspace::base_workspace_file(&app)?;
    let pointer_removed = pointer_path.exists();
    if pointer_removed {
        std::fs::remove_file(&pointer_path).map_err(|e| e.to_string())?;
    }
    let r = resolve_data_root(&app)?;
    Ok(RestoreDefaultResult {
        status: to_status(r),
        pointer_removed,
    })
}

// -------------------------------------------------------- interrupted move ---

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataMoveRecoveryResult {
    pub run_id: String,
    /// "completed" | "rolledBack".
    pub action: String,
    pub detail: String,
    pub destination_root: String,
}

fn pointer_message_for<'a>(entries: &'a [DataMoveJournalEntry], run_id: &str) -> Option<&'a str> {
    entries
        .iter()
        .find(|e| e.run_id == run_id && e.step == "pointer_updated")
        .and_then(|e| e.message.as_deref())
}

fn resume_inner(app: &AppHandle, started: &DataMoveJournalEntry, entries: &[DataMoveJournalEntry]) -> Result<DataMoveRecoveryResult, String> {
    let run_id = started.run_id.clone();
    let source_str = started.source_root.clone();
    let dest = PathBuf::from(&started.destination_root);
    let dest_str = started.destination_root.clone();
    let steps: HashSet<&str> = entries.iter().filter(|e| e.run_id == run_id).map(|e| e.step.as_str()).collect();
    let j = |step: &str, message: Option<String>| journal_step(app, &run_id, &source_str, &dest_str, step, message);

    match resume_decision(&steps) {
        ResumeAction::AlreadyComplete => {
            j("move_completed", Some("recovered: already fully confirmed".into()));
            let _ = remap_destination_after_move(app, Path::new(&source_str), &dest);
            Ok(DataMoveRecoveryResult {
                run_id,
                action: "completed".to_string(),
                detail: "the move had already finished; only its own completion record was missing".to_string(),
                destination_root: dest_str,
            })
        }
        ResumeAction::CompleteFromPointerUpdated => {
            let resolved = resolve_data_root(app)?;
            let dest_canon = canonical_or_self(&dest);
            if resolved.path == dest_canon {
                j("resolution_confirmed", None);
                j("move_completed", Some("recovered after an interrupted move".into()));
                let _ = remap_destination_after_move(app, Path::new(&source_str), &dest_canon);
                Ok(DataMoveRecoveryResult {
                    run_id,
                    action: "completed".to_string(),
                    detail: "resumed and confirmed the new location".to_string(),
                    destination_root: dest_str,
                })
            } else {
                let pointer_path = crate::workspace::base_workspace_file(app)?;
                let prev = pointer_message_for(entries, &run_id).and_then(|m| m.strip_prefix("prev:"));
                restore_pointer(&pointer_path, prev.filter(|p| *p != "NONE"));
                let detail = format!("the app resolves to {} instead of the destination — rolled back the pointer change", resolved.path.to_string_lossy());
                j("rolled_back", Some(detail.clone()));
                Ok(DataMoveRecoveryResult { run_id, action: "rolledBack".to_string(), detail, destination_root: dest_str })
            }
        }
        ResumeAction::CompleteFromActivated => {
            let pointer_path = crate::workspace::base_workspace_file(app)?;
            let previous_pointer = std::fs::read_to_string(&pointer_path).ok();
            let dest_canon = canonical_or_self(&dest);
            if let Err(e) = std::fs::write(&pointer_path, dest_canon.to_string_lossy().as_bytes()) {
                j("move_failed", Some(format!("recovery could not update the pointer: {e}")));
                return Err(e.to_string());
            }
            j("pointer_updated", Some(format!("prev:{}", previous_pointer.clone().unwrap_or_else(|| "NONE".to_string()))));
            let resolved = resolve_data_root(app)?;
            if resolved.path == dest_canon {
                j("resolution_confirmed", None);
                j("move_completed", Some("recovered after an interrupted move".into()));
                let _ = remap_destination_after_move(app, Path::new(&source_str), &dest_canon);
                Ok(DataMoveRecoveryResult {
                    run_id,
                    action: "completed".to_string(),
                    detail: "resumed activation and confirmed the new location".to_string(),
                    destination_root: dest_str,
                })
            } else {
                restore_pointer(&pointer_path, previous_pointer.as_deref());
                let detail = format!(
                    "the app still resolves to {} — rolled back the pointer, but the already-verified files remain at {} for manual use",
                    resolved.path.to_string_lossy(),
                    dest_canon.to_string_lossy()
                );
                j("rolled_back", Some(detail.clone()));
                Ok(DataMoveRecoveryResult { run_id, action: "rolledBack".to_string(), detail, destination_root: dest_str })
            }
        }
        ResumeAction::RollbackNothingActivated => {
            if let Ok(entries) = std::fs::read_dir(&dest) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with(STAGING_PREFIX) {
                        let _ = std::fs::remove_dir_all(entry.path());
                    }
                }
            }
            let detail = "the move never got far enough to change anything — your data was never touched".to_string();
            j("rolled_back", Some(detail.clone()));
            Ok(DataMoveRecoveryResult { run_id, action: "rolledBack".to_string(), detail, destination_root: dest_str })
        }
    }
}

#[tauri::command(async)]
pub async fn resume_interrupted_data_move(app: AppHandle, state: State<'_, BackupState>) -> Result<DataMoveRecoveryResult, String> {
    let entries = read_journal(&app);
    let Some(started) = find_interrupted_move(&entries) else {
        return Err("no interrupted move found".to_string());
    };
    {
        let mut guard = state.0.lock().map_err(|_| "backup state unavailable".to_string())?;
        if guard.is_some() {
            return Err("another backup, restore, or move is already in progress".to_string());
        }
        *guard = Some(Arc::new(AtomicBool::new(false)));
    }
    let result = resume_inner(&app, &started, &entries);
    {
        let mut guard = state.0.lock().map_err(|_| "backup state unavailable".to_string())?;
        *guard = None;
    }
    result
}

// -------------------------------------------------------------- cleanup ---

/// Phase 11 Session 10 closure — extracted so "cleanup can never target the
/// active root" is a directly unit-tested pure comparison, not just an
/// inline check inside an `AppHandle`-requiring command. Canonicalizes
/// both sides first so a symlink or trailing-slash difference can't slip
/// a same-root request past a naive string comparison.
pub(crate) fn is_cleanup_safe(old_root: &Path, active_root: &Path) -> bool {
    canonical_or_self(old_root) != canonical_or_self(active_root)
}

/// Deletes the OLD root's contents entirely — never called automatically,
/// only from an explicit, separately-confirmed UI action after a
/// successful move. Refuses outright if `old_root` is (or canonicalizes
/// to) the CURRENT active root, so a confused caller can never delete the
/// data that is actually in use right now.
#[tauri::command(async)]
pub async fn cleanup_old_data_location(app: AppHandle, token: String, old_root: String) -> Result<(), String> {
    crate::authz::authorize_app(&app, &token, "systemAdministration", "administer")?;
    let old_path = PathBuf::from(&old_root);
    let active = resolve_data_root(&app)?.path;
    if !is_cleanup_safe(&old_path, &active) {
        return Err("refusing to delete the currently active data location".to_string());
    }
    if !old_path.is_dir() {
        return Err("the old location is not a directory (nothing to clean up)".to_string());
    }
    std::fs::remove_dir_all(&old_path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("formulab-datalocmgr-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ----------------------------------------------------- walk_movable_files ---

    #[test]
    fn walk_movable_files_excludes_runs_db_and_stray_staging_dirs() {
        let root = tmp("walk-excludes");
        std::fs::create_dir_all(root.join("data/master")).unwrap();
        std::fs::create_dir_all(root.join(".FormuLab")).unwrap();
        std::fs::write(root.join("data/master/materials.json"), "[]").unwrap();
        std::fs::write(root.join(".FormuLab/runs.db"), "sqlite-bytes").unwrap();
        std::fs::write(root.join(".FormuLab/runs.jsonl"), "{}").unwrap();
        std::fs::create_dir_all(root.join(".formulab-move-staging-123")).unwrap();
        std::fs::write(root.join(".formulab-move-staging-123/leftover.bin"), "x").unwrap();

        let files = walk_movable_files(&root).unwrap();
        let rels: Vec<&str> = files.iter().map(|(_, r)| r.as_str()).collect();
        assert!(rels.contains(&"data/master/materials.json"));
        assert!(rels.contains(&".FormuLab/runs.jsonl"));
        assert!(!rels.iter().any(|r| r.ends_with("runs.db")));
        assert!(!rels.iter().any(|r| r.contains(".formulab-move-staging-")));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn walk_movable_files_on_a_missing_root_is_empty_not_an_error() {
        let root = tmp("walk-missing").join("does-not-exist");
        let files = walk_movable_files(&root).unwrap();
        assert!(files.is_empty());
    }

    // ---------------------------------------------------- validate_destination ---

    #[test]
    fn validate_reports_empty_for_a_fresh_empty_folder() {
        let scratch = tmp("validate-empty");
        let source = scratch.join("source");
        let dest = scratch.join("dest");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&dest).unwrap();

        let v = validate_destination_at(&source, &dest, 100);
        assert_eq!(v.kind, DestinationKind::Empty);
        assert!(v.can_move);
        assert!(!v.can_use_existing);
        assert!(v.blockers.is_empty());
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn validate_reports_existing_compatible_root_for_a_folder_with_real_formulab_data() {
        let scratch = tmp("validate-existing");
        let source = scratch.join("source");
        let dest = scratch.join("dest");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(dest.join("data/master")).unwrap();
        std::fs::write(dest.join("data/master/materials.json"), "[]").unwrap();

        let v = validate_destination_at(&source, &dest, 0);
        assert_eq!(v.kind, DestinationKind::ExistingCompatibleRoot);
        assert!(!v.can_move);
        assert!(v.can_use_existing);
        assert!(v.warnings.iter().any(|w| w.contains("already contains FormuLab data")));
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn validate_reports_conflicting_for_a_folder_with_unrelated_files() {
        let scratch = tmp("validate-conflict");
        let source = scratch.join("source");
        let dest = scratch.join("dest");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(dest.join("vacation-photos.zip"), "not formulab data").unwrap();

        let v = validate_destination_at(&source, &dest, 0);
        assert_eq!(v.kind, DestinationKind::Conflicting);
        assert!(!v.can_move);
        assert!(!v.can_use_existing);
        assert!(v.blockers.iter().any(|b| b.contains("no recognizable FormuLab data")));
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn validate_blocks_a_move_for_insufficient_free_space_but_does_not_block_use_existing() {
        let scratch = tmp("validate-space");
        let source = scratch.join("source");
        let dest_empty = scratch.join("dest-empty");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&dest_empty).unwrap();

        // An absurdly large requirement guarantees insufficient space on
        // any real filesystem this test runs against.
        let huge = u64::MAX / 2;
        let v = validate_destination_at(&source, &dest_empty, huge);
        assert_eq!(v.kind, DestinationKind::Empty);
        assert!(!v.sufficient_space);
        assert!(!v.can_move);
        assert!(v.blockers.iter().any(|b| b.contains("not enough free disk space")));

        // Same destination, but as an existing-compatible-root case (0
        // bytes required, since nothing is copied) — must not be blocked
        // by disk space at all.
        let dest_existing = scratch.join("dest-existing");
        std::fs::create_dir_all(dest_existing.join("formulas")).unwrap();
        std::fs::write(dest_existing.join("formulas/index.json"), "[]").unwrap();
        let v2 = validate_destination_at(&source, &dest_existing, 0);
        assert_eq!(v2.kind, DestinationKind::ExistingCompatibleRoot);
        assert!(v2.can_use_existing);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn validate_reports_unwritable_for_a_file_standing_in_for_a_directory() {
        let scratch = tmp("validate-unwritable");
        let source = scratch.join("source");
        std::fs::create_dir_all(&source).unwrap();
        let not_a_dir = scratch.join("i-am-a-file");
        std::fs::write(&not_a_dir, b"x").unwrap();

        let v = validate_destination_at(&source, &not_a_dir, 0);
        assert_eq!(v.kind, DestinationKind::NotADirectory);
        assert!(!v.can_move && !v.can_use_existing);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn validate_blocks_choosing_the_current_root_itself() {
        let scratch = tmp("validate-same");
        let source = scratch.join("source");
        std::fs::create_dir_all(&source).unwrap();

        let v = validate_destination_at(&source, &source, 0);
        assert_eq!(v.kind, DestinationKind::SameAsCurrent);
        assert!(!v.can_move && !v.can_use_existing);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// Regression: a live root's own `data/data/` nested duplicate, found
    /// and root-caused in the Phase 12 cleanup follow-up. A destination
    /// *inside* the current root is freshly created and empty, so without
    /// this guard it would validate as `Empty`/`can_move: true` — but
    /// `walk_movable_files` snapshots the source tree before staging
    /// starts, so the move would silently nest the whole root under
    /// itself instead of failing loudly.
    #[test]
    fn validate_blocks_a_destination_nested_inside_the_current_root() {
        let scratch = tmp("validate-nested");
        let source = scratch.join("source");
        std::fs::create_dir_all(source.join("master")).unwrap();
        std::fs::write(source.join("master/materials.json"), "[]").unwrap();
        let nested_dest = source.join("data"); // e.g. picking ...\data\data from inside ...\data

        let v = validate_destination_at(&source, &nested_dest, 0);
        assert_eq!(v.kind, DestinationKind::Conflicting);
        assert!(!v.can_move && !v.can_use_existing);
        assert!(v.blockers.iter().any(|b| b.contains("inside the current data location")));
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// A sibling directory that merely shares a name prefix with the
    /// current root (e.g. `data-archive` next to `data`) must not
    /// false-positive on the nested-destination guard above —
    /// `strip_prefix` checks real path components, not a raw string
    /// prefix.
    #[test]
    fn validate_does_not_false_positive_on_a_sibling_with_a_shared_name_prefix() {
        let scratch = tmp("validate-sibling");
        let source = scratch.join("data");
        let sibling = scratch.join("data-archive");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();

        let v = validate_destination_at(&source, &sibling, 0);
        assert_eq!(v.kind, DestinationKind::Empty);
        assert!(v.can_move);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    // -------------------------------------------------------- activate_staged ---

    #[test]
    fn activate_staged_places_every_file_and_leaves_no_staging_dir_on_success() {
        let scratch = tmp("activate-success");
        let dest = scratch.join("dest");
        std::fs::create_dir_all(&dest).unwrap();
        let staging = dest.join(format!("{STAGING_PREFIX}1"));
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(staging.join("0.bin"), "hello").unwrap();

        let staged = vec![(staging.join("0.bin"), "data/master/materials.json".to_string(), 5u64, "irrelevant".to_string())];
        let activated = activate_staged(&dest, &staging, &staged).unwrap();
        assert_eq!(activated.len(), 1);
        assert_eq!(std::fs::read_to_string(dest.join("data/master/materials.json")).unwrap(), "hello");
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn activate_staged_rolls_back_and_removes_staging_on_failure() {
        let scratch = tmp("activate-failure");
        let dest = scratch.join("dest");
        std::fs::create_dir_all(&dest).unwrap();
        let staging = dest.join(format!("{STAGING_PREFIX}1"));
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(staging.join("0.bin"), "hello").unwrap();
        // Deliberately missing "1.bin" so the second entry's rename fails.

        let staged = vec![
            (staging.join("0.bin"), "data/master/materials.json".to_string(), 5u64, "x".to_string()),
            (staging.join("1.bin"), "data/master/suppliers.json".to_string(), 5u64, "x".to_string()),
        ];
        let result = activate_staged(&dest, &staging, &staged);
        assert!(result.is_err());
        assert!(!dest.join("data/master/materials.json").exists(), "a partially-activated file must be rolled back");
        assert!(!staging.exists(), "the staging directory must be removed on failure");
        let _ = std::fs::remove_dir_all(&scratch);
    }

    // ------------------------------------------------------------- journal ---

    #[test]
    fn find_interrupted_move_detects_a_started_run_with_no_terminal_entry() {
        let e = DataMoveJournalEntry {
            run_id: "move-1".into(),
            ts: 1,
            step: "move_started".into(),
            source_root: "C:\\old".into(),
            destination_root: "D:\\new".into(),
            message: None,
        };
        assert!(find_interrupted_move(&[e.clone()]).is_some());
        let completed = DataMoveJournalEntry { step: "move_completed".into(), ts: 2, ..e.clone() };
        assert!(find_interrupted_move(&[e.clone(), completed]).is_none());
        let failed = DataMoveJournalEntry { step: "move_failed".into(), ts: 2, ..e.clone() };
        assert!(find_interrupted_move(&[e.clone(), failed]).is_none());
        let rolled_back = DataMoveJournalEntry { step: "rolled_back".into(), ts: 2, ..e.clone() };
        assert!(find_interrupted_move(&[e, rolled_back]).is_none());
    }

    #[test]
    fn find_interrupted_move_ignores_a_completed_earlier_run_and_flags_a_later_started_one() {
        let run1_started = DataMoveJournalEntry {
            run_id: "move-1".into(),
            ts: 1,
            step: "move_started".into(),
            source_root: "C:\\old".into(),
            destination_root: "D:\\new1".into(),
            message: None,
        };
        let run1_completed = DataMoveJournalEntry { step: "move_completed".into(), ts: 2, ..run1_started.clone() };
        let run2_started = DataMoveJournalEntry {
            run_id: "move-2".into(),
            ts: 3,
            destination_root: "E:\\new2".into(),
            ..run1_started.clone()
        };
        let found = find_interrupted_move(&[run1_started, run1_completed, run2_started]);
        assert_eq!(found.map(|e| e.run_id), Some("move-2".to_string()));
    }

    #[test]
    fn restore_pointer_writes_back_previous_content_or_removes_a_new_file() {
        let scratch = tmp("restore-pointer");
        let pointer = scratch.join("base-workspace.txt");

        // Previous content existed — restored verbatim.
        std::fs::write(&pointer, "D:\\old-root").unwrap();
        restore_pointer(&pointer, Some("D:\\old-root"));
        assert_eq!(std::fs::read_to_string(&pointer).unwrap(), "D:\\old-root");

        // No previous pointer existed — the file is removed, not left
        // behind with stale content from the failed attempt.
        std::fs::write(&pointer, "D:\\attempted-new-root").unwrap();
        restore_pointer(&pointer, None);
        assert!(!pointer.exists());
        let _ = std::fs::remove_dir_all(&scratch);
    }

    // -------------------------------------------- Phase 11 Session 10 closure ---
    //
    // Two guarantees Stage 2's own verification session singled out as the
    // highest-stakes, previously-inspection-only claims for this module
    // (paralleling Stage 1 Closure's "restore failure preserves original
    // data" gap): a successful move must leave the SOURCE root byte-
    // identical, and cleanup must never be able to target the active root.
    // `try_move_data`/`cleanup_old_data_location` themselves need an
    // `AppHandle` (for `resolve_data_root`/the safety backup) and so
    // remain untested directly — same constraint Stage 1 Closure already
    // investigated and rejected a mocked `AppHandle` for — but the exact
    // pure sequence each guarantee depends on is fully reproducible here
    // without one.

    #[test]
    fn a_full_stage_and_activate_sequence_leaves_the_source_root_byte_identical() {
        // Mirrors exactly what `try_move_data` does between `walk_movable_files`
        // and `activate_staged` (hash each source file, copy into staging,
        // then activate) — using real files, so this proves the source
        // tree's bytes on success, not just that the function signatures
        // never receive a `source` argument.
        let scratch = tmp("move-success-source-untouched");
        let source = scratch.join("source");
        let dest = scratch.join("dest");
        std::fs::create_dir_all(source.join("data/master")).unwrap();
        std::fs::create_dir_all(source.join("formulas")).unwrap();
        std::fs::create_dir_all(&dest).unwrap();
        std::fs::write(source.join("data/master/materials.json"), r#"[{"code":"M1"}]"#).unwrap();
        std::fs::write(source.join("formulas/index.json"), "[]").unwrap();

        let before: Vec<(String, Vec<u8>)> = walk_movable_files(&source)
            .unwrap()
            .iter()
            .map(|(p, rel)| (rel.clone(), std::fs::read(p).unwrap()))
            .collect();

        // Stage: hash + copy each source file into a staging dir under dest,
        // exactly as `try_move_data` does.
        let staging = dest.join(format!("{STAGING_PREFIX}1"));
        std::fs::create_dir_all(&staging).unwrap();
        let files = walk_movable_files(&source).unwrap();
        let mut staged = Vec::new();
        for (i, (src_path, rel)) in files.iter().enumerate() {
            let (hash, len) = hash_and_len(src_path).unwrap();
            let staged_path = staging.join(format!("{i}.bin"));
            std::fs::copy(src_path, &staged_path).unwrap();
            staged.push((staged_path, rel.clone(), len, hash));
        }

        // Activate.
        let activated = activate_staged(&dest, &staging, &staged).unwrap();
        assert_eq!(activated.len(), before.len());

        // The guarantee under test: every source file, read again after a
        // full successful stage+activate, is byte-for-byte what it was
        // before — nothing here ever opened a source path for writing.
        for (rel, original_bytes) in &before {
            let still_at_source = std::fs::read(source.join(rel)).unwrap();
            assert_eq!(&still_at_source, original_bytes, "source file {rel} changed after a successful move");
        }
        // And the destination genuinely received the data (this is a real
        // move, not a no-op check).
        assert_eq!(
            std::fs::read(dest.join("data/master/materials.json")).unwrap(),
            std::fs::read(source.join("data/master/materials.json")).unwrap(),
        );

        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn is_cleanup_safe_refuses_only_when_old_root_is_the_active_root() {
        let scratch = tmp("cleanup-safety");
        let old_root = scratch.join("old");
        let active_root = scratch.join("old"); // same path, different PathBuf instance
        let different_root = scratch.join("different");
        std::fs::create_dir_all(&old_root).unwrap();
        std::fs::create_dir_all(&different_root).unwrap();

        assert!(!is_cleanup_safe(&old_root, &active_root), "cleanup must refuse when old_root IS the active root");
        assert!(is_cleanup_safe(&old_root, &different_root), "cleanup must proceed when old_root is genuinely not the active root");
    }

    #[test]
    fn is_cleanup_safe_compares_canonicalized_paths_not_raw_strings() {
        let scratch = tmp("cleanup-safety-canon");
        let real = scratch.join("real-dir");
        std::fs::create_dir_all(&real).unwrap();
        // Same directory, spelled two different ways (trailing separator) —
        // a naive string compare would treat these as different.
        let spelled_differently = PathBuf::from(format!("{}\\", real.to_string_lossy()));
        assert!(!is_cleanup_safe(&real, &spelled_differently));
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn resume_decision_covers_every_reached_step_combination() {
        let none: HashSet<&str> = HashSet::new();
        assert_eq!(resume_decision(&none), ResumeAction::RollbackNothingActivated);

        let mut staged_only: HashSet<&str> = HashSet::new();
        staged_only.insert("move_started");
        staged_only.insert("safety_backup_created");
        staged_only.insert("staged");
        staged_only.insert("verified");
        assert_eq!(resume_decision(&staged_only), ResumeAction::RollbackNothingActivated);

        let mut activated: HashSet<&str> = staged_only.clone();
        activated.insert("activated");
        assert_eq!(resume_decision(&activated), ResumeAction::CompleteFromActivated);

        let mut pointer_updated: HashSet<&str> = activated.clone();
        pointer_updated.insert("pointer_updated");
        assert_eq!(resume_decision(&pointer_updated), ResumeAction::CompleteFromPointerUpdated);

        let mut confirmed: HashSet<&str> = pointer_updated.clone();
        confirmed.insert("resolution_confirmed");
        assert_eq!(resume_decision(&confirmed), ResumeAction::AlreadyComplete);
    }
}
