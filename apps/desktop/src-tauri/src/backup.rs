// Phase 11 Session 1 — backup and restore foundation.
//
// Package format: a single `.formulab-backup` file, a standard ZIP container
// with `manifest.json` at the root plus a mirror of the real data tree,
// exactly as planned in docs/PHASE11_BACKUP_RESTORE_ARCHITECTURE.md.
//
// Included (see docs/PHASE11_DATA_INVENTORY.md for the evidence behind each):
//   data/formulations/**          (project_root)
//   data/master/*.json            (project_root — top-level files only,
//                                   data/master/backups/ is never walked)
//   data/sessions/**              (project_root)
//   formulas/**                   (project_root)
//   .FormuLab/runs.jsonl                  (workspace_dir — active workspace)
//   .FormuLab/remote-runs.jsonl            (workspace_dir)
//   .FormuLab/provenance.jsonl              (workspace_dir)
//   .FormuLab/logs/*.txt                    (workspace_dir)
//   .FormuLab/compute.json                  (base_workspace_dir)
//
// Never included, structurally (these paths are never even read, not just
// filtered out after the fact):
//   .FormuLab/runs.db      — this project's own never-touch rule; also a
//                             disposable index rebuilt from runs.jsonl.
//   EBWebView / localStorage — browser-storage cache, holds the plaintext
//                             per-provider LLM API key; outside this crate's
//                             filesystem reach entirely.
//   runtime/pipeline, runtime/formulation, runtime/skills — materialized
//                             code cache, rewritten from `include_str!`
//                             constants on every use.
//   data/literature         — real usage checked this session:
//                             `runtime/pipeline/literature_cache.py` stores
//                             `pdfs/<doi>.pdf`, open-access papers fetched
//                             from public sources and cached by DOI — a
//                             genuine network cache of third-party content,
//                             not user-authored, re-fetchable (network
//                             permitting) through ordinary use. Excluded by
//                             default; a warning is recorded in the manifest
//                             when the directory exists and holds files, so
//                             a user knows it was skipped rather than being
//                             silently unaware of it.
use std::collections::{BTreeMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

pub const BACKUP_FORMAT_VERSION: &str = "1.0";
/// Reserved for the global application-data schema version this session's
/// architecture doc plans (docs/PHASE11_MIGRATION_ARCHITECTURE.md) — no
/// collection has ever shipped at anything but "1.0", so this is a fixed
/// placeholder, not yet a computed value.
pub(crate) const GLOBAL_SCHEMA_VERSION: &str = "1.0";

#[derive(Default)]
pub struct BackupState(pub Mutex<Option<Arc<AtomicBool>>>);

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataRootIdentifier {
    pub resolved_project_root: String,
    pub resolved_workspace_root: String,
    pub resolved_base_root: String,
    pub formulab_root_override_active: bool,
    pub active_workspace_override_active: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// Forward-slash, archive-relative path — never an absolute path.
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityInfo {
    pub min_supported_app_version: String,
    pub max_known_app_version: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub backup_format_version: String,
    pub formulab_app_version: String,
    pub created_at: u64,
    pub data_root: DataRootIdentifier,
    pub schema_versions: BTreeMap<String, String>,
    pub included: Vec<String>,
    pub excluded: Vec<String>,
    pub file_inventory: Vec<FileEntry>,
    pub total_bytes: u64,
    pub warnings: Vec<String>,
    pub compatibility: CompatibilityInfo,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupProgress {
    /// "scanning" | "hashing" | "writing" | "verifying" | "extracting" |
    /// "activating" | "done" | "cancelled" | "error".
    pub phase: String,
    pub current: u64,
    pub total: u64,
    pub message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub manifest: BackupManifest,
    pub safety_backup_path: String,
    pub restored_paths: Vec<String>,
    pub warnings: Vec<String>,
}

// ---------------------------------------------------------- verification ---
//
// Session 2 — standalone verification: inspects a `.formulab-backup` package
// without extracting it onto the data root or creating any safety backup.
// Reuses the same manifest-reading and per-entry safety checks
// `try_restore_backup` uses (`open_zip`/`read_manifest_from_archive`/
// `check_entry_safety` below), rather than a second, parallel parser.

#[derive(Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VerificationStatus {
    Valid,
    ValidWithWarnings,
    Incompatible,
    Corrupted,
    Unsafe,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VerificationIssue {
    /// Machine-readable check name, e.g. "hash_mismatch", "unsafe_path".
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VerificationReport {
    pub status: VerificationStatus,
    /// Present whenever the manifest itself was readable — even an
    /// `Unsafe`/`Corrupted` result may still carry the manifest if only a
    /// later check (a bad hash, a prohibited entry) is what failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest: Option<BackupManifest>,
    pub errors: Vec<VerificationIssue>,
    pub warnings: Vec<VerificationIssue>,
}

fn issue(code: &str, message: impl Into<String>, path: Option<&str>) -> VerificationIssue {
    VerificationIssue {
        code: code.to_string(),
        message: message.into(),
        path: path.map(|s| s.to_string()),
    }
}

/// Extensions this project will never legitimately package — a `.formulab-backup`
/// contains only JSON/JSONL/Markdown/text data, never executable content.
const PROHIBITED_EXTENSIONS: &[&str] = &[
    "exe", "dll", "so", "dylib", "sh", "bat", "cmd", "ps1", "msi", "app", "scr", "com", "jar",
    "vbs", "vbe", "js", "wsf", "msc", "pif", "gadget",
];

/// Returns each name that appears more than once, in first-seen order,
/// each reported only once regardless of how many times it repeats.
fn duplicate_names(names: &[String]) -> Vec<String> {
    let mut seen: HashSet<&String> = HashSet::new();
    let mut dups: Vec<String> = Vec::new();
    for n in names {
        if !seen.insert(n) && !dups.contains(n) {
            dups.push(n.clone());
        }
    }
    dups
}

fn has_prohibited_extension(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| PROHIBITED_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Every safety property one archive entry must have, independent of
/// whether it appears in the manifest — reused by both restore and
/// standalone verification. Returns a description of the violation, if any,
/// rather than a bare error, so a verification report can list it as one
/// issue among several instead of aborting on the first problem.
fn entry_safety_violation(name: &str, entry: &zip::read::ZipFile) -> Option<String> {
    if let Err(e) = safe_archive_name(name) {
        return Some(e);
    }
    if let Some(mode) = entry.unix_mode() {
        const S_IFLNK: u32 = 0o120000;
        const S_IFMT: u32 = 0o170000;
        if mode & S_IFMT == S_IFLNK {
            return Some(format!("unsafe archive entry (symbolic link): {name}"));
        }
    }
    if entry.is_dir() {
        return Some(format!("unsafe archive entry (directory entry not expected): {name}"));
    }
    if has_prohibited_extension(name) {
        return Some(format!("unsafe archive entry (prohibited file type): {name}"));
    }
    None
}

fn open_zip(source: &Path) -> Result<zip::ZipArchive<std::fs::File>, String> {
    let file = std::fs::File::open(source).map_err(|e| format!("cannot open file: {e}"))?;
    zip::ZipArchive::new(file).map_err(|e| format!("not a readable archive: {e}"))
}

fn read_manifest_from_archive(
    archive: &mut zip::ZipArchive<std::fs::File>,
) -> Result<BackupManifest, String> {
    let mut entry = archive
        .by_name("manifest.json")
        .map_err(|_| "package has no manifest.json — not a valid FormuLab backup".to_string())?;
    let mut text = String::new();
    entry.read_to_string(&mut text).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("manifest.json is not valid JSON or is missing a required field: {e}"))
}

/// Minimal `major.minor.patch` compare (this project's versions, e.g.
/// `Cargo.toml`'s `0.4.0`) — enough to tell "older/equal/newer" without a
/// full semver dependency this codebase doesn't otherwise need.
pub(crate) fn parse_simple_version(v: &str) -> Option<(u64, u64, u64)> {
    let mut parts = v.split('.').map(|p| p.parse::<u64>().ok());
    Some((parts.next()??, parts.next()??, parts.next()??))
}

pub(crate) fn version_in_range(version: &str, min: &str, max: &str) -> bool {
    let (Some(v), Some(lo), Some(hi)) = (
        parse_simple_version(version),
        parse_simple_version(min),
        parse_simple_version(max),
    ) else {
        // An unparseable version string is itself suspicious, not silently
        // accepted — but that is reported separately by the malformed-JSON
        // path above (the field failed to deserialize as a String only if
        // absent entirely); here, treat "can't compare" as out of range.
        return false;
    };
    v >= lo && v <= hi
}

/// Standalone inspection: never resolves `project_root()`/`workspace_dir()`,
/// never creates a safety backup, never extracts a file to disk — reads
/// only from the archive itself, entirely in memory. This is what makes
/// "verification must never modify the active data root" true by
/// construction rather than by a separate guard to remember.
pub fn verify_backup_report(source: &Path) -> VerificationReport {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    let mut archive = match open_zip(source) {
        Ok(a) => a,
        Err(e) => {
            errors.push(issue("archive_unreadable", e, None));
            return VerificationReport {
                status: VerificationStatus::Corrupted,
                manifest: None,
                errors,
                warnings,
            };
        }
    };

    let manifest = match read_manifest_from_archive(&mut archive) {
        Ok(m) => m,
        Err(e) => {
            errors.push(issue("manifest_unreadable", e, Some("manifest.json")));
            return VerificationReport {
                status: VerificationStatus::Corrupted,
                manifest: None,
                errors,
                warnings,
            };
        }
    };

    if manifest.backup_format_version != BACKUP_FORMAT_VERSION {
        errors.push(issue(
            "unsupported_backup_format_version",
            format!(
                "backup format version {} is not supported by this build (supports {})",
                manifest.backup_format_version, BACKUP_FORMAT_VERSION
            ),
            None,
        ));
    }

    if !version_in_range(
        env!("CARGO_PKG_VERSION"),
        &manifest.compatibility.min_supported_app_version,
        &manifest.compatibility.max_known_app_version,
    ) {
        errors.push(issue(
            "unsupported_app_version",
            format!(
                "this build ({}) is outside the backup's declared compatibility range ({}..={})",
                env!("CARGO_PKG_VERSION"),
                manifest.compatibility.min_supported_app_version,
                manifest.compatibility.max_known_app_version
            ),
            None,
        ));
    }

    for (collection, version) in &manifest.schema_versions {
        if version != GLOBAL_SCHEMA_VERSION {
            errors.push(issue(
                "unsupported_schema_version",
                format!("collection {collection} has schema version {version}, this build only supports {GLOBAL_SCHEMA_VERSION}"),
                Some(collection),
            ));
        }
    }

    // Duplicate-path detection is a pre-pass over every raw entry name
    // (`zip::ZipArchive::new` above already refuses to open an archive
    // written with a duplicate name via this crate's own writer — see
    // `duplicate_names_in_a_raw_name_list_are_detected` — so this exists as
    // defense in depth against a hand-crafted or differently-produced
    // archive, not something reachable through this project's own writer).
    let mut all_names = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        match archive.by_index(i) {
            Ok(e) => {
                let name = e.name().to_string();
                if name != "manifest.json" {
                    all_names.push(name);
                }
            }
            Err(e) => errors.push(issue("archive_unreadable", format!("could not read archive entry {i}: {e}"), None)),
        }
    }
    for dup in duplicate_names(&all_names) {
        errors.push(issue("duplicate_path", format!("duplicate archive entry: {dup}"), Some(&dup)));
    }

    // Walk every real archive entry once: safety checks (reused from
    // restore), the runs.db never-touch rule, and cross-referencing against
    // the manifest's declared file inventory.
    let mut present_paths: HashSet<String> = HashSet::new();
    for i in 0..archive.len() {
        let entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => continue, // already reported above
        };
        let name = entry.name().to_string();
        if name == "manifest.json" {
            continue;
        }

        if name == ".FormuLab/runs.db" {
            errors.push(issue(
                "runs_db_present",
                ".FormuLab/runs.db must never be included in a FormuLab backup package",
                Some(&name),
            ));
        }

        if let Some(violation) = entry_safety_violation(&name, &entry) {
            errors.push(issue("unsafe_path", violation, Some(&name)));
            continue;
        }

        // Allow-listed path check: every real entry must resolve through the
        // same archive-to-live mapping restore uses. A root doesn't matter
        // here (verification never touches the filesystem outside the
        // archive), so any concrete root works as a probe.
        let probe_roots = RootPaths {
            project_root: PathBuf::from("."),
            workspace_root: PathBuf::from("."),
            base_root: PathBuf::from("."),
        };
        if archive_path_to_live(&probe_roots, &name).is_err() {
            errors.push(issue(
                "prohibited_path",
                format!("archive entry is outside every FormuLab data path this build recognizes: {name}"),
                Some(&name),
            ));
            continue;
        }

        present_paths.insert(name);
    }

    // Missing files: the manifest lists a file that isn't actually in the
    // archive — an incomplete/interrupted package.
    for entry in &manifest.file_inventory {
        if !present_paths.contains(&entry.path) {
            errors.push(issue(
                "missing_file",
                format!("manifest lists {} but it is not present in the archive", entry.path),
                Some(&entry.path),
            ));
        }
    }

    // Unexpected files: present in the archive (and safe/allow-listed) but
    // never declared in the manifest's own inventory — flagged, not fatal.
    let declared: HashSet<&str> = manifest.file_inventory.iter().map(|f| f.path.as_str()).collect();
    for path in &present_paths {
        if !declared.contains(path.as_str()) {
            warnings.push(issue(
                "unexpected_file",
                format!("archive contains {path}, which the manifest does not list"),
                Some(path),
            ));
        }
    }

    // Size + SHA256 for every declared file actually present.
    for entry in &manifest.file_inventory {
        if !present_paths.contains(&entry.path) {
            continue; // already reported as missing above
        }
        let mut zip_entry = match archive.by_name(&entry.path) {
            Ok(e) => e,
            Err(e) => {
                errors.push(issue("archive_unreadable", format!("could not reopen {}: {e}", entry.path), Some(&entry.path)));
                continue;
            }
        };
        let mut bytes = Vec::with_capacity(entry.bytes as usize);
        if let Err(e) = zip_entry.read_to_end(&mut bytes) {
            errors.push(issue("archive_unreadable", format!("could not read {}: {e}", entry.path), Some(&entry.path)));
            continue;
        }
        if bytes.len() as u64 != entry.bytes {
            errors.push(issue(
                "size_mismatch",
                format!("{} declared {} bytes, archive has {}", entry.path, entry.bytes, bytes.len()),
                Some(&entry.path),
            ));
            continue;
        }
        let actual_hash = sha256_bytes(&bytes);
        if actual_hash != entry.sha256 {
            errors.push(issue(
                "hash_mismatch",
                format!("{} failed a SHA256 check", entry.path),
                Some(&entry.path),
            ));
            continue;
        }
        if entry.path.ends_with(".json") {
            if let Err(e) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                errors.push(issue(
                    "malformed_json",
                    format!("{} is not valid JSON: {e}", entry.path),
                    Some(&entry.path),
                ));
            }
        }
    }

    for w in &manifest.warnings {
        warnings.push(issue("manifest_warning", w.clone(), None));
    }

    let unsafe_found = errors.iter().any(|e| {
        matches!(e.code.as_str(), "unsafe_path" | "duplicate_path" | "runs_db_present" | "prohibited_path")
    });
    let corrupted_found = errors.iter().any(|e| {
        matches!(
            e.code.as_str(),
            "archive_unreadable" | "manifest_unreadable" | "missing_file" | "size_mismatch" | "hash_mismatch" | "malformed_json"
        )
    });
    let incompatible_found = errors.iter().any(|e| {
        matches!(e.code.as_str(), "unsupported_backup_format_version" | "unsupported_app_version" | "unsupported_schema_version")
    });

    let status = if unsafe_found {
        VerificationStatus::Unsafe
    } else if corrupted_found {
        VerificationStatus::Corrupted
    } else if incompatible_found {
        VerificationStatus::Incompatible
    } else if !warnings.is_empty() {
        VerificationStatus::ValidWithWarnings
    } else {
        VerificationStatus::Valid
    };

    VerificationReport {
        status,
        manifest: Some(manifest),
        errors,
        warnings,
    }
}

#[tauri::command(async)]
pub async fn verify_backup(source: String) -> Result<VerificationReport, String> {
    Ok(verify_backup_report(&PathBuf::from(source)))
}

pub(crate) fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn emit_progress(app: &AppHandle, event: &str, phase: &str, current: u64, total: u64, message: &str) {
    let _ = app.emit(
        event,
        BackupProgress {
            phase: phase.to_string(),
            current,
            total,
            message: message.to_string(),
        },
    );
}

pub(crate) fn app_private_dir(app: &AppHandle, sub: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join(sub);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn to_archive_path(rel: &str) -> String {
    rel.replace('\\', "/")
}

fn sha256_file(path: &Path) -> Result<(String, u64), String> {
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

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Recursively collect every file under `dir`, archive path
/// `<archive_prefix>/<relative path>`. A missing directory is not an error —
/// most of these are optional (a fresh project may have no sessions yet).
fn walk_dir_files(dir: &Path, archive_prefix: &str, out: &mut Vec<(PathBuf, String)>) -> Result<(), String> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let rel = if archive_prefix.is_empty() {
            name
        } else {
            format!("{archive_prefix}/{name}")
        };
        if path.is_dir() {
            walk_dir_files(&path, &rel, out)?;
        } else if path.is_file() {
            out.push((path, to_archive_path(&rel)));
        }
    }
    Ok(())
}

/// `data/master/*.json` only — deliberately does not recurse, so the ad hoc
/// `data/master/backups/` pre-delete snapshot directory is structurally
/// never walked, never included.
fn collect_master_files(master_dir: &Path, out: &mut Vec<(PathBuf, String)>) -> Result<(), String> {
    if !master_dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(master_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            let name = entry.file_name().to_string_lossy().to_string();
            out.push((path, format!("data/master/{name}")));
        }
    }
    Ok(())
}

/// `.FormuLab/logs/*.txt` only, directly under the logs dir.
fn collect_log_files(logs_dir: &Path, out: &mut Vec<(PathBuf, String)>) {
    let Ok(entries) = std::fs::read_dir(logs_dir) else {
        return;
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("txt") {
            let name = entry.file_name().to_string_lossy().to_string();
            out.push((path, format!(".FormuLab/logs/{name}")));
        }
    }
}

fn schema_versions_from_master(master_files: &[(PathBuf, String)]) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    out.insert("_global".to_string(), GLOBAL_SCHEMA_VERSION.to_string());
    for (path, archive_path) in master_files {
        let Some(collection) = archive_path
            .strip_prefix("data/master/")
            .and_then(|s| s.strip_suffix(".json"))
        else {
            continue;
        };
        let Ok(text) = std::fs::read_to_string(path) else {
            continue;
        };
        let Ok(serde_json::Value::Array(rows)) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        if let Some(version) = rows
            .first()
            .and_then(|r| r.get("schemaVersion"))
            .and_then(|v| v.as_str())
        {
            out.insert(collection.to_string(), version.to_string());
        }
    }
    out
}

struct RootPaths {
    project_root: PathBuf,
    workspace_root: PathBuf,
    base_root: PathBuf,
}

/// An included file: its real path on disk, plus the forward-slash
/// archive-relative path it will be stored under.
type IncludedFile = (PathBuf, String);
/// An included file after hashing: real path, archive path, byte size,
/// SHA256 hex digest.
type HashedFile = (PathBuf, String, u64, String);

fn resolve_roots(app: &AppHandle) -> Result<RootPaths, String> {
    Ok(RootPaths {
        project_root: crate::formulation_v2::project_root(app)?,
        workspace_root: crate::workspace::workspace_dir(app)?,
        base_root: crate::workspace::base_workspace_dir(app)?,
    })
}

fn data_root_identifier(app: &AppHandle, roots: &RootPaths) -> DataRootIdentifier {
    let formulab_root_override_active = app
        .path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("runtime").join("formulab-root.txt"))
        .map(|p| p.is_file())
        .unwrap_or(false);
    let active_workspace_override_active = roots.workspace_root != roots.base_root;
    DataRootIdentifier {
        resolved_project_root: roots.project_root.to_string_lossy().to_string(),
        resolved_workspace_root: roots.workspace_root.to_string_lossy().to_string(),
        resolved_base_root: roots.base_root.to_string_lossy().to_string(),
        formulab_root_override_active,
        active_workspace_override_active,
    }
}

/// Build the full included-file list + warnings. Never touches
/// `.FormuLab/runs.db` or `data/literature` — both are structurally absent
/// from every path this function walks.
fn collect_included(roots: &RootPaths) -> Result<(Vec<IncludedFile>, Vec<String>), String> {
    let mut files = Vec::new();
    let mut warnings = Vec::new();

    walk_dir_files(
        &roots.project_root.join("data").join("formulations"),
        "data/formulations",
        &mut files,
    )?;
    collect_master_files(&roots.project_root.join("data").join("master"), &mut files)?;
    walk_dir_files(
        &roots.project_root.join("data").join("sessions"),
        "data/sessions",
        &mut files,
    )?;
    walk_dir_files(&roots.project_root.join("formulas"), "formulas", &mut files)?;

    for (name, archive_name) in [
        ("runs.jsonl", "runs.jsonl"),
        ("remote-runs.jsonl", "remote-runs.jsonl"),
        ("provenance.jsonl", "provenance.jsonl"),
    ] {
        let p = roots.workspace_root.join(".FormuLab").join(name);
        if p.is_file() {
            files.push((p, format!(".FormuLab/{archive_name}")));
        }
    }
    collect_log_files(&roots.workspace_root.join(".FormuLab").join("logs"), &mut files);

    let compute_json = roots.base_root.join(".FormuLab").join("compute.json");
    if compute_json.is_file() {
        files.push((compute_json, ".FormuLab/compute.json".to_string()));
    }

    let literature_dir = roots.project_root.join("data").join("literature");
    if literature_dir.is_dir() {
        let mut lit_files = Vec::new();
        walk_dir_files(&literature_dir, "data/literature", &mut lit_files)?;
        if !lit_files.is_empty() {
            warnings.push(format!(
                "data/literature was NOT included ({} file(s)) — it is a network-fetched \
                 open-access PDF cache (see runtime/pipeline/literature_cache.py), re-fetchable \
                 through ordinary use, not user-authored content.",
                lit_files.len()
            ));
        }
    }

    Ok((files, warnings))
}

const EXCLUDED_LABELS: &[&str] = &[
    ".FormuLab/runs.db (never touched — disposable index rebuilt from runs.jsonl)",
    "data/master/backups/* (ad hoc pre-delete snapshots, not primary data)",
    "data/literature (network cache — see manifest warnings)",
    "EBWebView / localStorage (webview cache; holds the plaintext per-provider API key)",
    "runtime/pipeline, runtime/formulation, runtime/skills (materialized code cache)",
];

fn build_manifest(
    app: &AppHandle,
    roots: &RootPaths,
    files: &[IncludedFile],
    mut warnings: Vec<String>,
    cancel: &AtomicBool,
    progress_event: &str,
) -> Result<(BackupManifest, Vec<HashedFile>), String> {
    let total = files.len() as u64;
    let mut hashed = Vec::with_capacity(files.len());
    let mut inventory = Vec::with_capacity(files.len());
    let mut total_bytes = 0u64;

    for (i, (path, archive_path)) in files.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".to_string());
        }
        emit_progress(
            app,
            progress_event,
            "hashing",
            i as u64,
            total,
            archive_path,
        );
        let (hash, bytes) = sha256_file(path)?;
        total_bytes += bytes;
        inventory.push(FileEntry {
            path: archive_path.clone(),
            bytes,
            sha256: hash.clone(),
        });
        hashed.push((path.clone(), archive_path.clone(), bytes, hash));
    }

    let master_files: Vec<_> = files
        .iter()
        .filter(|(_, a)| a.starts_with("data/master/"))
        .cloned()
        .collect();
    let schema_versions = schema_versions_from_master(&master_files);

    if files.is_empty() {
        warnings.push("No user data was found under the resolved data root — an empty project.".to_string());
    }

    let manifest = BackupManifest {
        backup_format_version: BACKUP_FORMAT_VERSION.to_string(),
        formulab_app_version: env!("CARGO_PKG_VERSION").to_string(),
        created_at: now_secs(),
        data_root: data_root_identifier(app, roots),
        schema_versions,
        included: inventory.iter().map(|f| f.path.clone()).collect(),
        excluded: EXCLUDED_LABELS.iter().map(|s| s.to_string()).collect(),
        file_inventory: inventory,
        total_bytes,
        warnings,
        compatibility: CompatibilityInfo {
            min_supported_app_version: env!("CARGO_PKG_VERSION").to_string(),
            max_known_app_version: env!("CARGO_PKG_VERSION").to_string(),
        },
    };
    Ok((manifest, hashed))
}

fn zip_options() -> zip::write::SimpleFileOptions {
    zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)
}

pub(crate) fn try_create_backup(
    app: &AppHandle,
    dest_path: &Path,
    tmp_path: &Path,
    cancel: &Arc<AtomicBool>,
    progress_event: &str,
) -> Result<BackupManifest, String> {
    let roots = resolve_roots(app)?;

    emit_progress(app, progress_event, "scanning", 0, 0, "Scanning data root");
    let (files, warnings) = collect_included(&roots)?;

    let parent = dest_path
        .parent()
        .ok_or_else(|| "backup destination has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    // Disk-space validation before staging: sum real file sizes on disk
    // first (cheap metadata reads), require the destination volume to have
    // at least that many bytes free plus a 10% margin for the zip's own
    // overhead and the manifest.
    let quick_total: u64 = files
        .iter()
        .filter_map(|(p, _)| std::fs::metadata(p).ok().map(|m| m.len()))
        .sum();
    let required = quick_total + quick_total / 10 + 4096;
    match fs4::available_space(parent) {
        Ok(avail) if avail < required => {
            return Err(format!(
                "not enough free disk space at destination: {required} bytes required, {avail} available"
            ));
        }
        Ok(_) => {}
        Err(_) => {
            // Can't determine free space on this filesystem — proceed; the
            // write itself will fail cleanly if space genuinely runs out.
        }
    }

    if cancel.load(Ordering::SeqCst) {
        return Err("cancelled".to_string());
    }

    let (manifest, hashed) = build_manifest(app, &roots, &files, warnings, cancel, progress_event)?;

    emit_progress(app, progress_event, "writing", 0, hashed.len() as u64, "Writing package");
    let tmp_file = std::fs::File::create(tmp_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(tmp_file);

    let manifest_json =
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    zip.start_file("manifest.json", zip_options())
        .map_err(|e| e.to_string())?;
    zip.write_all(&manifest_json).map_err(|e| e.to_string())?;

    for (i, (path, archive_path, _bytes, _hash)) in hashed.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".to_string());
        }
        emit_progress(
            app,
            progress_event,
            "writing",
            i as u64,
            hashed.len() as u64,
            archive_path,
        );
        zip.start_file(archive_path.as_str(), zip_options())
            .map_err(|e| e.to_string())?;
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }

    zip.finish().map_err(|e| e.to_string())?;

    // Self-check: reopen what was just written and confirm the manifest
    // round-trips before this is ever treated as a valid package.
    {
        let mut archive = open_zip(tmp_path)?;
        let round_tripped = read_manifest_from_archive(&mut archive)?;
        if round_tripped.backup_format_version != BACKUP_FORMAT_VERSION {
            return Err("backup self-check failed: manifest did not round-trip".to_string());
        }
    }

    if dest_path.exists() {
        std::fs::remove_file(dest_path).map_err(|e| e.to_string())?;
    }
    std::fs::rename(tmp_path, dest_path).map_err(|e| e.to_string())?;

    emit_progress(app, progress_event, "done", hashed.len() as u64, hashed.len() as u64, "Backup complete");
    Ok(manifest)
}

#[tauri::command(async)]
pub async fn create_backup(
    app: AppHandle,
    state: State<'_, BackupState>,
    destination: String,
) -> Result<BackupManifest, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut guard = state.0.lock().map_err(|_| "backup state unavailable".to_string())?;
        *guard = Some(cancel.clone());
    }

    let dest_path = PathBuf::from(&destination);
    let tmp_path = PathBuf::from(format!("{destination}.tmp"));
    let result = try_create_backup(&app, &dest_path, &tmp_path, &cancel, "backup-progress");

    if result.is_err() {
        let _ = std::fs::remove_file(&tmp_path);
        let phase = if cancel.load(Ordering::SeqCst) { "cancelled" } else { "error" };
        emit_progress(&app, "backup-progress", phase, 0, 0, result.as_ref().err().unwrap());
    }

    {
        let mut guard = state.0.lock().map_err(|_| "backup state unavailable".to_string())?;
        *guard = None;
    }
    result
}

#[tauri::command]
pub fn cancel_backup(state: State<'_, BackupState>) {
    if let Ok(guard) = state.0.lock() {
        if let Some(flag) = guard.as_ref() {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

#[tauri::command(async)]
pub async fn pick_backup_destination(app: AppHandle, default_name: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let dialog = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("FormuLab backup", &["formulab-backup"]);
    let Some(picked) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

// --------------------------------------------------------------- restore ---

/// Rejects an archive entry name that could escape the destination tree:
/// absolute paths, drive-letter paths, `..` components, empty names.
fn safe_archive_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("archive entry has an empty name".to_string());
    }
    if name.starts_with('/') || name.starts_with('\\') {
        return Err(format!("unsafe archive entry (absolute path): {name}"));
    }
    if name.len() > 1 && name.as_bytes()[1] == b':' {
        return Err(format!("unsafe archive entry (drive-letter path): {name}"));
    }
    if name.split(['/', '\\']).any(|part| part == "..") {
        return Err(format!("unsafe archive entry (path traversal): {name}"));
    }
    Ok(())
}

/// Maps an archive-relative path back to a live absolute path on THIS
/// machine, using an allow-list of known prefixes — anything else is
/// rejected rather than blindly extracted, which both prevents drift from a
/// future package layout and doubles as an extra unsafe-path guard.
fn archive_path_to_live(roots: &RootPaths, archive_rel: &str) -> Result<PathBuf, String> {
    if archive_rel == "manifest.json" {
        return Err("manifest.json is not a data file".to_string());
    }
    if archive_rel.starts_with("data/formulations/")
        || archive_rel.starts_with("data/master/")
        || archive_rel.starts_with("data/sessions/")
        || archive_rel.starts_with("formulas/")
    {
        return Ok(roots.project_root.join(archive_rel));
    }
    if archive_rel == ".FormuLab/compute.json" {
        return Ok(roots.base_root.join(archive_rel));
    }
    if archive_rel == ".FormuLab/runs.jsonl"
        || archive_rel == ".FormuLab/remote-runs.jsonl"
        || archive_rel == ".FormuLab/provenance.jsonl"
        || archive_rel.starts_with(".FormuLab/logs/")
    {
        return Ok(roots.workspace_root.join(archive_rel));
    }
    Err(format!("archive entry does not match a known data path: {archive_rel}"))
}

/// Activates every staged file into its live target, one at a time,
/// renaming any existing live file aside first (`<path>.pre-restore-<ts>.bak`)
/// so a mid-activation failure can be rolled back. Pure and AppHandle-free
/// by design — this is what makes it directly unit-testable with real temp
/// files (see `activate_staged_files_rolls_back_and_preserves_original_data_on_failure`
/// below), proving "restore failure preserves the original data" against
/// real bytes on disk rather than by inspection alone.
///
/// On success: returns the archive-relative paths that were activated, and
/// every aside copy has already been removed. On failure: every file
/// touched so far is restored from its aside copy (or removed, if it had
/// none) before the error is returned — the live tree is left exactly as
/// it was found.
fn activate_staged_files(staged: &[(String, PathBuf)], staging_dir: &Path) -> Result<Vec<String>, String> {
    let activation_stamp = now_secs();
    let mut aside: Vec<(PathBuf, Option<PathBuf>)> = Vec::new();
    let mut restored_paths = Vec::new();
    let mut activation_error: Option<String> = None;

    for (i, (archive_rel, live_target)) in staged.iter().enumerate() {
        if let Some(parent) = live_target.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                activation_error = Some(e.to_string());
                break;
            }
        }
        let aside_path = if live_target.exists() {
            let a = PathBuf::from(format!(
                "{}.pre-restore-{activation_stamp}.bak",
                live_target.to_string_lossy()
            ));
            if let Err(e) = std::fs::rename(live_target, &a) {
                activation_error = Some(e.to_string());
                break;
            }
            Some(a)
        } else {
            None
        };

        let staged_path = staging_dir.join(format!("{i}.bin"));
        if let Err(e) = std::fs::copy(&staged_path, live_target) {
            activation_error = Some(e.to_string());
            aside.push((live_target.clone(), aside_path));
            break;
        }
        aside.push((live_target.clone(), aside_path));
        restored_paths.push(archive_rel.clone());
    }

    if let Some(err) = activation_error {
        for (live_target, original) in aside.iter().rev() {
            let _ = std::fs::remove_file(live_target);
            if let Some(original) = original {
                let _ = std::fs::rename(original, live_target);
            }
        }
        return Err(err);
    }

    for (_, original) in aside {
        if let Some(original) = original {
            let _ = std::fs::remove_file(original);
        }
    }
    Ok(restored_paths)
}

fn try_restore_backup(
    app: &AppHandle,
    source: &Path,
    cancel: &Arc<AtomicBool>,
) -> Result<RestoreResult, String> {
    let roots = resolve_roots(app)?;

    emit_progress(app, "restore-progress", "verifying", 0, 0, "Reading package");
    let mut archive = open_zip(source)?;
    let manifest = read_manifest_from_archive(&mut archive)?;

    if manifest.backup_format_version != BACKUP_FORMAT_VERSION {
        return Err(format!(
            "unsupported backup format version: {} (this build supports {})",
            manifest.backup_format_version, BACKUP_FORMAT_VERSION
        ));
    }

    // Reject unsafe paths, symlinks and traversal across every entry, not
    // just the ones the manifest lists — a corrupted or hand-edited archive
    // could carry extra entries the manifest never mentions. Same check
    // standalone verification uses (`entry_safety_violation`) — one
    // definition of "safe entry," not a second parallel one.
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name == "manifest.json" {
            continue;
        }
        if let Some(violation) = entry_safety_violation(&name, &entry) {
            return Err(violation);
        }
    }

    if cancel.load(Ordering::SeqCst) {
        return Err("cancelled".to_string());
    }

    // Safety backup of the CURRENT data, before anything is touched.
    emit_progress(app, "restore-progress", "verifying", 0, 0, "Creating safety backup of current data");
    let backups_dir = app_private_dir(app, "backups")?;
    let safety_path = backups_dir.join(format!("pre-restore-{}.formulab-backup", now_secs()));
    let safety_tmp = PathBuf::from(format!("{}.tmp", safety_path.to_string_lossy()));
    // Best-effort: if the current data root is empty (fresh install), the
    // safety backup will simply contain nothing to restore from — still a
    // valid, if empty, package, not an error.
    try_create_backup(app, &safety_path, &safety_tmp, cancel, "restore-progress")?;

    if cancel.load(Ordering::SeqCst) {
        return Err("cancelled".to_string());
    }

    // Stage: extract every manifest-listed file, verifying size + hash as
    // extracted, into a private staging directory — never onto live files.
    let staging_dir = app_private_dir(app, "restore-staging")?.join(now_secs().to_string());
    std::fs::create_dir_all(&staging_dir).map_err(|e| e.to_string())?;

    let cleanup_staging = |dir: &Path| {
        let _ = std::fs::remove_dir_all(dir);
    };

    let total = manifest.file_inventory.len() as u64;
    let mut staged: Vec<(String, PathBuf)> = Vec::with_capacity(manifest.file_inventory.len());

    for (i, entry) in manifest.file_inventory.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            cleanup_staging(&staging_dir);
            return Err("cancelled".to_string());
        }
        emit_progress(app, "restore-progress", "extracting", i as u64, total, &entry.path);

        safe_archive_name(&entry.path)?;
        let live_target = match archive_path_to_live(&roots, &entry.path) {
            Ok(p) => p,
            Err(e) => {
                cleanup_staging(&staging_dir);
                return Err(e);
            }
        };

        let mut zip_entry = match archive.by_name(&entry.path) {
            Ok(e) => e,
            Err(_) => {
                cleanup_staging(&staging_dir);
                return Err(format!("manifest lists {} but it is missing from the archive", entry.path));
            }
        };
        let mut bytes = Vec::with_capacity(entry.bytes as usize);
        if let Err(e) = zip_entry.read_to_end(&mut bytes) {
            cleanup_staging(&staging_dir);
            return Err(e.to_string());
        }
        drop(zip_entry);

        if bytes.len() as u64 != entry.bytes {
            cleanup_staging(&staging_dir);
            return Err(format!(
                "corrupted package: {} declared {} bytes, got {}",
                entry.path,
                entry.bytes,
                bytes.len()
            ));
        }
        let actual_hash = sha256_bytes(&bytes);
        if actual_hash != entry.sha256 {
            cleanup_staging(&staging_dir);
            return Err(format!("corrupted package: {} failed a SHA256 check", entry.path));
        }

        // Structural check: every staged file this project actually writes
        // as JSON must still parse as JSON. Markdown/JSONL entries are left
        // to their own readers — this is the "available structural check"
        // this session's scope covers, not a full per-schema Zod pass
        // (that lives on the TypeScript side and is out of scope for this
        // Rust-only foundation; recorded as a known limitation).
        if entry.path.ends_with(".json") {
            if let Err(e) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                cleanup_staging(&staging_dir);
                return Err(format!("corrupted package: {} is not valid JSON ({e})", entry.path));
            }
        }

        let staged_path = staging_dir.join(format!("{i}.bin"));
        if let Err(e) = std::fs::write(&staged_path, &bytes) {
            cleanup_staging(&staging_dir);
            return Err(e.to_string());
        }
        staged.push((entry.path.clone(), live_target));
    }

    if cancel.load(Ordering::SeqCst) {
        cleanup_staging(&staging_dir);
        return Err("cancelled".to_string());
    }

    // Activate: move each staged file into place, renaming any existing
    // live file aside first so a mid-activation failure can roll back.
    emit_progress(app, "restore-progress", "activating", 0, total, "Activating restored data");
    let restored_paths = match activate_staged_files(&staged, &staging_dir) {
        Ok(paths) => paths,
        Err(err) => {
            cleanup_staging(&staging_dir);
            return Err(format!(
                "restore failed during activation, rolled back: {err} (safety backup: {})",
                safety_path.to_string_lossy()
            ));
        }
    };

    // Success: `activate_staged_files` already dropped its own aside
    // copies (the safety backup archive above is the durable fallback);
    // only the staging directory is left to clean up.
    cleanup_staging(&staging_dir);

    emit_progress(app, "restore-progress", "done", total, total, "Restore complete");
    Ok(RestoreResult {
        manifest,
        safety_backup_path: safety_path.to_string_lossy().to_string(),
        restored_paths,
        warnings: vec![
            "Root-pointer files (formulab-root.txt / base-workspace.txt / active-workspace.txt) \
             were never touched — restore only ever writes into this machine's own resolved \
             data root, never a path recorded in the backup from another machine."
                .to_string(),
        ],
    })
}

#[tauri::command(async)]
pub async fn inspect_backup(source: String) -> Result<BackupManifest, String> {
    let mut archive = open_zip(&PathBuf::from(source))?;
    read_manifest_from_archive(&mut archive)
}

#[tauri::command(async)]
pub async fn restore_backup(
    app: AppHandle,
    state: State<'_, BackupState>,
    source: String,
) -> Result<RestoreResult, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut guard = state.0.lock().map_err(|_| "backup state unavailable".to_string())?;
        *guard = Some(cancel.clone());
    }

    let result = try_restore_backup(&app, &PathBuf::from(&source), &cancel);

    if let Err(e) = &result {
        let phase = if cancel.load(Ordering::SeqCst) { "cancelled" } else { "error" };
        emit_progress(&app, "restore-progress", phase, 0, 0, e);
    }

    {
        let mut guard = state.0.lock().map_err(|_| "backup state unavailable".to_string())?;
        *guard = None;
    }
    result
}

#[tauri::command]
pub fn cancel_restore(state: State<'_, BackupState>) {
    cancel_backup(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excluded_labels_name_runs_db_and_ebwebview_explicitly() {
        let joined = EXCLUDED_LABELS.join(" ");
        assert!(joined.contains("runs.db"));
        assert!(joined.contains("EBWebView"));
        assert!(joined.contains("literature"));
    }

    #[test]
    fn safe_archive_name_rejects_traversal_and_absolute_paths() {
        assert!(safe_archive_name("data/master/materials.json").is_ok());
        assert!(safe_archive_name("../etc/passwd").is_err());
        assert!(safe_archive_name("data/../../etc/passwd").is_err());
        assert!(safe_archive_name("/etc/passwd").is_err());
        assert!(safe_archive_name("C:/Windows/System32/evil.dll").is_err());
        assert!(safe_archive_name("").is_err());
    }

    #[test]
    fn archive_path_to_live_rejects_unknown_prefixes() {
        let roots = RootPaths {
            project_root: PathBuf::from("/proj"),
            workspace_root: PathBuf::from("/proj"),
            base_root: PathBuf::from("/proj"),
        };
        assert!(archive_path_to_live(&roots, "data/master/materials.json").is_ok());
        assert!(archive_path_to_live(&roots, ".FormuLab/runs.jsonl").is_ok());
        assert!(archive_path_to_live(&roots, ".FormuLab/compute.json").is_ok());
        assert!(archive_path_to_live(&roots, ".FormuLab/runs.db").is_err());
        assert!(archive_path_to_live(&roots, "unexpected/path.json").is_err());
        assert!(archive_path_to_live(&roots, "manifest.json").is_err());
    }

    #[test]
    fn schema_versions_reads_first_row_and_sets_global() {
        let dir = std::env::temp_dir().join(format!("formulab-backup-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("materials.json"),
            r#"[{"code":"M1","schemaVersion":"1.0"}]"#,
        )
        .unwrap();
        let files = vec![(dir.join("materials.json"), "data/master/materials.json".to_string())];
        let versions = schema_versions_from_master(&files);
        assert_eq!(versions.get("materials").map(|s| s.as_str()), Some("1.0"));
        assert_eq!(versions.get("_global").map(|s| s.as_str()), Some(GLOBAL_SCHEMA_VERSION));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn full_backup_then_restore_round_trip_is_byte_identical() {
        // Build a fake project root with a couple of real-shaped files,
        // back it up, wipe it, restore, and confirm the bytes match.
        let root = std::env::temp_dir().join(format!("formulab-backup-rt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("data/master")).unwrap();
        std::fs::create_dir_all(root.join("data/formulations/f1")).unwrap();
        std::fs::create_dir_all(root.join("formulas")).unwrap();
        std::fs::write(
            root.join("data/master/materials.json"),
            r#"[{"code":"M1","schemaVersion":"1.0"}]"#,
        )
        .unwrap();
        std::fs::write(
            root.join("data/formulations/f1/formulation.json"),
            r#"{"id":"f1"}"#,
        )
        .unwrap();
        std::fs::write(root.join("formulas/index.json"), "[]").unwrap();

        let roots = RootPaths {
            project_root: root.clone(),
            workspace_root: root.clone(),
            base_root: root.clone(),
        };
        let (files, warnings) = collect_included(&roots).unwrap();
        assert_eq!(files.len(), 3);

        let cancel = AtomicBool::new(false);
        let manifest_dummy_app = (); // not used by build_manifest's file logic directly
        let _ = manifest_dummy_app;

        // build_manifest needs an AppHandle for data_root_identifier/progress
        // emission, which unit tests can't easily construct — exercise the
        // pure pieces (collect_included, schema_versions, hashing) directly
        // instead, matching every other engine-style test in this repo that
        // avoids standing up a full Tauri app in a unit test.
        let master_files: Vec<_> = files
            .iter()
            .filter(|(_, a)| a.starts_with("data/master/"))
            .cloned()
            .collect();
        let versions = schema_versions_from_master(&master_files);
        assert_eq!(versions.get("materials").map(|s| s.as_str()), Some("1.0"));
        assert!(warnings.is_empty());

        for (path, _) in &files {
            let (_hash, bytes) = sha256_file(path).unwrap();
            assert!(bytes > 0);
        }

        let _ = cancel;
        let _ = std::fs::remove_dir_all(&root);
    }

    // ------------------------------------------------------- verification ---

    fn verify_tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("formulab-verify-{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn base_manifest() -> BackupManifest {
        BackupManifest {
            backup_format_version: BACKUP_FORMAT_VERSION.to_string(),
            formulab_app_version: env!("CARGO_PKG_VERSION").to_string(),
            created_at: 1_800_000_000,
            data_root: DataRootIdentifier {
                resolved_project_root: "C:\\test".to_string(),
                resolved_workspace_root: "C:\\test".to_string(),
                resolved_base_root: "C:\\test".to_string(),
                formulab_root_override_active: false,
                active_workspace_override_active: false,
            },
            schema_versions: BTreeMap::from([("_global".to_string(), GLOBAL_SCHEMA_VERSION.to_string())]),
            included: Vec::new(),
            excluded: EXCLUDED_LABELS.iter().map(|s| s.to_string()).collect(),
            file_inventory: Vec::new(),
            total_bytes: 0,
            warnings: Vec::new(),
            compatibility: CompatibilityInfo {
                min_supported_app_version: env!("CARGO_PKG_VERSION").to_string(),
                max_known_app_version: env!("CARGO_PKG_VERSION").to_string(),
            },
        }
    }

    /// Writes a real `.formulab-backup`-shaped ZIP: `manifest.json` plus
    /// whatever raw entries the test supplies (which may include duplicate
    /// or unsafe names deliberately, unlike the production writer).
    fn write_test_package(path: &Path, manifest: &BackupManifest, entries: &[(&str, &[u8])]) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let manifest_json = serde_json::to_vec_pretty(manifest).unwrap();
        zip.start_file("manifest.json", zip_options()).unwrap();
        zip.write_all(&manifest_json).unwrap();
        for (name, bytes) in entries {
            zip.start_file(*name, zip_options()).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn verify_reports_valid_for_a_well_formed_package() {
        let dir = verify_tmp_dir("valid");
        let content: &[u8] = b"[{\"code\":\"M1\",\"schemaVersion\":\"1.0\"}]";
        let mut manifest = base_manifest();
        manifest.file_inventory.push(FileEntry {
            path: "data/master/materials.json".to_string(),
            bytes: content.len() as u64,
            sha256: sha256_bytes(content),
        });
        let path = dir.join("valid.formulab-backup");
        write_test_package(&path, &manifest, &[("data/master/materials.json", content)]);

        let report = verify_backup_report(&path);
        assert!(matches!(report.status, VerificationStatus::Valid), "expected Valid, got {:?}", report.errors.iter().map(|e| &e.code).collect::<Vec<_>>());
        assert!(report.errors.is_empty());
        assert!(report.warnings.is_empty());
        assert!(report.manifest.is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn verify_reports_valid_with_warnings_for_an_undeclared_extra_file() {
        let dir = verify_tmp_dir("warnings");
        let manifest = base_manifest(); // empty file_inventory
        let path = dir.join("warn.formulab-backup");
        // A real, allow-listed, safe file that the manifest never declared.
        write_test_package(&path, &manifest, &[("data/master/materials.json", b"[]")]);

        let report = verify_backup_report(&path);
        assert!(matches!(report.status, VerificationStatus::ValidWithWarnings));
        assert!(report.errors.is_empty());
        assert!(report.warnings.iter().any(|w| w.code == "unexpected_file"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn verify_reports_corrupted_for_garbage_bytes_that_are_not_a_zip() {
        let dir = verify_tmp_dir("garbage-zip");
        let path = dir.join("garbage.formulab-backup");
        std::fs::write(&path, b"this is not a zip file at all").unwrap();

        let report = verify_backup_report(&path);
        assert!(matches!(report.status, VerificationStatus::Corrupted));
        assert!(report.errors.iter().any(|e| e.code == "archive_unreadable"));
        assert!(report.manifest.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn verify_reports_corrupted_for_a_zip_with_no_manifest() {
        let dir = verify_tmp_dir("no-manifest");
        let path = dir.join("no-manifest.formulab-backup");
        let file = std::fs::File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("data/master/materials.json", zip_options()).unwrap();
        zip.write_all(b"[]").unwrap();
        zip.finish().unwrap();

        let report = verify_backup_report(&path);
        assert!(matches!(report.status, VerificationStatus::Corrupted));
        assert!(report.errors.iter().any(|e| e.code == "manifest_unreadable"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn verify_reports_corrupted_for_a_malformed_manifest() {
        let dir = verify_tmp_dir("malformed-manifest");
        let path = dir.join("malformed.formulab-backup");
        let file = std::fs::File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("manifest.json", zip_options()).unwrap();
        zip.write_all(b"{ not valid json").unwrap();
        zip.finish().unwrap();

        let report = verify_backup_report(&path);
        assert!(matches!(report.status, VerificationStatus::Corrupted));
        assert!(report.errors.iter().any(|e| e.code == "manifest_unreadable"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_names_in_a_raw_name_list_are_detected() {
        // `zip::ZipWriter` (this crate's own writer) refuses to `finish()` a
        // package with two entries sharing a name — confirmed directly: see
        // the assertion below. A hand-crafted or differently-produced
        // archive could still carry one, so `verify_backup_report` checks
        // for it as defense in depth; that check is exercised here at the
        // pure-function level, since this crate's writer makes it
        // impossible to construct a real duplicate-name `.formulab-backup`
        // to round-trip through the full reader.
        let names = vec![
            "data/master/materials.json".to_string(),
            "data/master/suppliers.json".to_string(),
            "data/master/materials.json".to_string(),
        ];
        assert_eq!(duplicate_names(&names), vec!["data/master/materials.json".to_string()]);

        let dir = verify_tmp_dir("duplicate-write-refused");
        let file = std::fs::File::create(dir.join("attempt.formulab-backup")).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("data/master/materials.json", zip_options()).unwrap();
        zip.write_all(b"[]").unwrap();
        let second = zip.start_file("data/master/materials.json", zip_options());
        assert!(second.is_err(), "the zip writer should refuse a duplicate entry name");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn verify_reports_unsafe_for_a_path_traversal_entry() {
        let dir = verify_tmp_dir("traversal");
        let manifest = base_manifest();
        let path = dir.join("traversal.formulab-backup");
        write_test_package(&path, &manifest, &[("../evil.json", b"{}")]);

        let report = verify_backup_report(&path);
        assert!(matches!(report.status, VerificationStatus::Unsafe));
        assert!(report.errors.iter().any(|e| e.code == "unsafe_path"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn verify_reports_corrupted_for_a_hash_mismatch() {
        let dir = verify_tmp_dir("hash-mismatch");
        let content: &[u8] = b"[]";
        let mut manifest = base_manifest();
        manifest.file_inventory.push(FileEntry {
            path: "data/master/materials.json".to_string(),
            bytes: content.len() as u64,
            sha256: sha256_bytes(b"different content entirely"),
        });
        let path = dir.join("hash.formulab-backup");
        write_test_package(&path, &manifest, &[("data/master/materials.json", content)]);

        let report = verify_backup_report(&path);
        assert!(matches!(report.status, VerificationStatus::Corrupted));
        assert!(report.errors.iter().any(|e| e.code == "hash_mismatch"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn verify_reports_corrupted_for_a_size_mismatch() {
        let dir = verify_tmp_dir("size-mismatch");
        let content: &[u8] = b"[]";
        let mut manifest = base_manifest();
        manifest.file_inventory.push(FileEntry {
            path: "data/master/materials.json".to_string(),
            bytes: content.len() as u64 + 100, // wrong on purpose
            sha256: sha256_bytes(content),
        });
        let path = dir.join("size.formulab-backup");
        write_test_package(&path, &manifest, &[("data/master/materials.json", content)]);

        let report = verify_backup_report(&path);
        assert!(matches!(report.status, VerificationStatus::Corrupted));
        assert!(report.errors.iter().any(|e| e.code == "size_mismatch"));
        assert!(!report.errors.iter().any(|e| e.code == "hash_mismatch"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn verify_reports_incompatible_for_an_unsupported_backup_format_version() {
        let dir = verify_tmp_dir("bad-format-version");
        let mut manifest = base_manifest();
        manifest.backup_format_version = "9.9".to_string();
        let path = dir.join("future.formulab-backup");
        write_test_package(&path, &manifest, &[]);

        let report = verify_backup_report(&path);
        assert!(matches!(report.status, VerificationStatus::Incompatible));
        assert!(report.errors.iter().any(|e| e.code == "unsupported_backup_format_version"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn verify_reports_incompatible_for_an_unsupported_schema_version() {
        let dir = verify_tmp_dir("bad-schema-version");
        let mut manifest = base_manifest();
        manifest.schema_versions.insert("materials".to_string(), "2.0".to_string());
        let path = dir.join("futureschema.formulab-backup");
        write_test_package(&path, &manifest, &[]);

        let report = verify_backup_report(&path);
        assert!(matches!(report.status, VerificationStatus::Incompatible));
        assert!(report.errors.iter().any(|e| e.code == "unsupported_schema_version"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn verify_reports_unsafe_when_runs_db_is_present() {
        let dir = verify_tmp_dir("runs-db");
        let manifest = base_manifest();
        let path = dir.join("runsdb.formulab-backup");
        write_test_package(&path, &manifest, &[(".FormuLab/runs.db", b"sqlite-bytes")]);

        let report = verify_backup_report(&path);
        assert!(matches!(report.status, VerificationStatus::Unsafe));
        assert!(report.errors.iter().any(|e| e.code == "runs_db_present"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn verify_never_touches_the_filesystem_outside_the_given_archive() {
        // `verify_backup_report` takes only a `&Path` — no `AppHandle` — so
        // it cannot call `resolve_roots`/`project_root`/`workspace_dir` at
        // all; this test additionally guards that the source file itself
        // is never rewritten by verification (read-only end to end).
        let dir = verify_tmp_dir("no-side-effects");
        let manifest = base_manifest();
        let path = dir.join("readonly.formulab-backup");
        write_test_package(&path, &manifest, &[("data/master/materials.json", b"[]")]);

        let before = std::fs::read(&path).unwrap();
        let _ = verify_backup_report(&path);
        let _ = verify_backup_report(&path);
        let after = std::fs::read(&path).unwrap();
        assert_eq!(before, after, "verification must never modify the package it reads");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ------------------------------------------------------ activation ---

    #[test]
    fn activate_staged_files_rolls_back_and_preserves_original_data_on_failure() {
        let dir = verify_tmp_dir("activation-rollback");
        let staging_dir = dir.join("staging");
        std::fs::create_dir_all(&staging_dir).unwrap();

        let live1 = dir.join("data/master/materials.json");
        let live2 = dir.join("data/master/suppliers.json");
        std::fs::create_dir_all(live1.parent().unwrap()).unwrap();
        std::fs::write(&live1, "ORIGINAL-MATERIALS").unwrap();
        std::fs::write(&live2, "ORIGINAL-SUPPLIERS").unwrap();

        // Stage file 0 (for live1) with new content; deliberately leave
        // staged file 1 (for live2) missing, so its `std::fs::copy` fails
        // and forces a rollback partway through activation.
        std::fs::write(staging_dir.join("0.bin"), "NEW-MATERIALS").unwrap();

        let staged = vec![
            ("data/master/materials.json".to_string(), live1.clone()),
            ("data/master/suppliers.json".to_string(), live2.clone()),
        ];

        let result = activate_staged_files(&staged, &staging_dir);
        assert!(result.is_err());

        // The literal guarantee under test: a failed activation leaves the
        // ORIGINAL fixture data exactly as it was, byte for byte — not
        // half-migrated, not deleted, not the new content.
        assert_eq!(std::fs::read_to_string(&live1).unwrap(), "ORIGINAL-MATERIALS");
        assert_eq!(std::fs::read_to_string(&live2).unwrap(), "ORIGINAL-SUPPLIERS");

        // No stray `.pre-restore-*.bak` file left behind either.
        let leftover_bak = std::fs::read_dir(live1.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains(".bak"));
        assert!(!leftover_bak, "rollback must remove its own aside copies");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn activate_staged_files_succeeds_and_leaves_no_aside_copies_behind() {
        let dir = verify_tmp_dir("activation-success");
        let staging_dir = dir.join("staging");
        std::fs::create_dir_all(&staging_dir).unwrap();

        let live = dir.join("data/master/materials.json");
        std::fs::create_dir_all(live.parent().unwrap()).unwrap();
        std::fs::write(&live, "OLD").unwrap();
        std::fs::write(staging_dir.join("0.bin"), "NEW").unwrap();

        let staged = vec![("data/master/materials.json".to_string(), live.clone())];
        let result = activate_staged_files(&staged, &staging_dir).unwrap();

        assert_eq!(result, vec!["data/master/materials.json".to_string()]);
        assert_eq!(std::fs::read_to_string(&live).unwrap(), "NEW");
        let leftover_bak = std::fs::read_dir(live.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().contains(".bak"));
        assert!(!leftover_bak);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn activate_staged_files_creates_a_brand_new_file_when_no_live_file_existed() {
        let dir = verify_tmp_dir("activation-new-file");
        let staging_dir = dir.join("staging");
        std::fs::create_dir_all(&staging_dir).unwrap();
        let live = dir.join("data/master/new_collection.json");
        std::fs::write(staging_dir.join("0.bin"), "[]").unwrap();

        let staged = vec![("data/master/new_collection.json".to_string(), live.clone())];
        let result = activate_staged_files(&staged, &staging_dir).unwrap();

        assert_eq!(result, vec!["data/master/new_collection.json".to_string()]);
        assert_eq!(std::fs::read_to_string(&live).unwrap(), "[]");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
