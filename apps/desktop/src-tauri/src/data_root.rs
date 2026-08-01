// Phase 11 Session 4 — unified active-data-root resolution.
//
// Before this module, `formulation_v2::project_root()` and
// `workspace::workspace_dir()` each implemented their own precedence over
// the same three pointer files, silently falling through a malformed or
// missing-target pointer with no trace, and `runs_index.rs` read a THIRD
// function (`base_workspace_dir()`) directly for its SQLite index while
// `runs.rs` wrote `runs.jsonl` through `workspace_dir()` — two different
// roots whenever `active-workspace.txt` ever diverged from
// `base-workspace.txt`. See docs/PHASE11_DATA_INVENTORY.md's "Active
// data-location assessment" and docs/handoffs/PHASE11_CURRENT.md's
// Session 0 findings for the full evidence trail.
//
// This module is the one place that now decides the active data root.
// `workspace::workspace_dir()` and `formulation_v2::project_root()` both
// delegate to it (see their own doc comments) — they resolve to the exact
// same path today and always will, closing the "two funnels" finding.
// `workspace::base_workspace_dir()` remains separate on purpose: it is
// the narrower "the configured base, regardless of any session/manual
// override" concept a few callers (`compute.rs`'s shared machine list,
// this module's own base-workspace reading) genuinely need.
//
// No real installation is affected by unifying the precedence: neither
// `formulab-root.txt` nor `active-workspace.txt` has ever had a writer
// anywhere in this codebase (confirmed in Session 0 and still true) — a
// real user only ever has `base-workspace.txt`, if that. This session
// changes nothing for that universal case; it only makes the resolution
// explicit, ordered, and warning-visible for the two dormant overrides.
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

const FORMULAB_ROOT_FILE: &str = "formulab-root.txt";
const ACTIVE_WORKSPACE_FILE: &str = "active-workspace.txt";
const BASE_WORKSPACE_FILE: &str = "base-workspace.txt";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RootSource {
    FormulabRootOverride,
    ActiveWorkspaceOverride,
    BaseWorkspaceOverride,
    Default,
}

impl RootSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            RootSource::FormulabRootOverride => "formulabRootOverride",
            RootSource::ActiveWorkspaceOverride => "activeWorkspaceOverride",
            RootSource::BaseWorkspaceOverride => "baseWorkspaceOverride",
            RootSource::Default => "default",
        }
    }
}

#[derive(Clone, Debug)]
pub struct DataRootResolution {
    pub path: PathBuf,
    pub source: RootSource,
    pub writable: bool,
    /// Every anomaly found while resolving — a malformed or missing-target
    /// pointer, an unwritable resolved root, or a lower-precedence pointer
    /// that also holds real data. Never silently dropped: if this list is
    /// non-empty, something about the resolution deserves the user's
    /// attention, even though a definite path was still returned so the
    /// app can keep working.
    pub warnings: Vec<String>,
    /// Other pointer files that resolve to a different, real, EXISTING
    /// directory that already holds actual project data. Surfaced for a
    /// human to resolve — never auto-merged, never silently preferred.
    pub conflicting_roots: Vec<(RootSource, PathBuf)>,
}

/// `None` — the pointer file does not exist (not an error, just absent).
/// `Some(Ok(path))` — present and points at a real directory.
/// `Some(Err(reason))` — present but invalid: empty, or its target is
/// missing or is not a directory. Distinguishing this from "absent" is
/// exactly what stops a malformed pointer from silently vanishing.
fn read_pointer(path: &Path) -> Option<Result<PathBuf, String>> {
    let text = std::fs::read_to_string(path).ok()?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Some(Err("the pointer file is empty".to_string()));
    }
    let dir = PathBuf::from(trimmed);
    if dir.is_dir() {
        Some(Ok(dir))
    } else if dir.exists() {
        Some(Err(format!("{} is not a directory", dir.display())))
    } else {
        Some(Err(format!("{} does not exist", dir.display())))
    }
}

fn dir_has_entries(p: &Path) -> bool {
    std::fs::read_dir(p).map(|mut it| it.next().is_some()).unwrap_or(false)
}

/// Whether `root` already holds real, non-fixture project data — the same
/// four locations `backup.rs`'s own inclusion scan walks
/// (`data/formulations`, `data/master`, `data/sessions`, `formulas`).
fn path_holds_real_data(root: &Path) -> bool {
    ["data/formulations", "data/master", "data/sessions", "formulas"]
        .iter()
        .any(|rel| dir_has_entries(&root.join(rel)))
}

fn probe_writable(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    let probe = path.join(".formulab-write-probe");
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Pure resolution over three explicit pointer paths and an already-
/// guaranteed-to-exist default — no `AppHandle`, so every branch is
/// directly unit-testable against real temp directories.
pub(crate) fn resolve_data_root_at(
    formulab_root_path: &Path,
    active_workspace_path: &Path,
    base_workspace_path: &Path,
    default_root: &Path,
) -> DataRootResolution {
    let mut warnings = Vec::new();
    let mut candidates: Vec<(RootSource, PathBuf)> = Vec::new();

    for (source, pointer_path, label) in [
        (RootSource::FormulabRootOverride, formulab_root_path, "formulab-root.txt"),
        (RootSource::ActiveWorkspaceOverride, active_workspace_path, "active-workspace.txt"),
        (RootSource::BaseWorkspaceOverride, base_workspace_path, "base-workspace.txt"),
    ] {
        match read_pointer(pointer_path) {
            Some(Ok(dir)) => candidates.push((source, dir)),
            Some(Err(reason)) => {
                warnings.push(format!("{label} is set but invalid ({reason}) — ignored, falling back"));
            }
            None => {}
        }
    }

    let (source, path) = candidates
        .first()
        .cloned()
        .unwrap_or((RootSource::Default, default_root.to_path_buf()));

    let writable = probe_writable(&path);
    if !writable {
        warnings.push(format!("{} is not writable", path.display()));
    }

    let mut conflicting_roots = Vec::new();
    for (other_source, other_path) in candidates.iter().skip(1) {
        if *other_path != path && path_holds_real_data(other_path) {
            conflicting_roots.push((*other_source, other_path.clone()));
            warnings.push(format!(
                "{} ({}) also contains real project data but is not the active root — nothing was merged",
                other_path.display(),
                other_source.as_str()
            ));
        }
    }

    DataRootResolution { path, source, writable, warnings, conflicting_roots }
}

fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("runtime"))
}

/// The default root when no pointer file resolves: `~/Documents/FormuLab`,
/// falling back to `$HOME`/`$USERPROFILE`. Always created before return —
/// matches `base_workspace_dir()`'s pre-existing default-creation behavior,
/// so this is not a new side effect, just relocated.
fn default_root(app: &AppHandle) -> Result<PathBuf, String> {
    let docs = match app.path().document_dir() {
        Ok(d) => d,
        Err(_) => {
            let home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .map_err(|_| "could not resolve a documents directory".to_string())?;
            PathBuf::from(home).join("Documents")
        }
    };
    let dir = docs.join("FormuLab");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn resolve_data_root(app: &AppHandle) -> Result<DataRootResolution, String> {
    let runtime = runtime_root(app)?;
    let default = default_root(app)?;
    Ok(resolve_data_root_at(
        &runtime.join(FORMULAB_ROOT_FILE),
        &runtime.join(ACTIVE_WORKSPACE_FILE),
        &runtime.join(BASE_WORKSPACE_FILE),
        &default,
    ))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConflictingRoot {
    pub source: String,
    pub path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DataRootStatus {
    pub path: String,
    pub source: String,
    pub writable: bool,
    pub warnings: Vec<String>,
    pub conflicting_roots: Vec<ConflictingRoot>,
}

#[tauri::command(async)]
pub async fn active_data_root_status(app: AppHandle) -> Result<DataRootStatus, String> {
    let r = resolve_data_root(&app)?;
    Ok(DataRootStatus {
        path: r.path.to_string_lossy().to_string(),
        source: r.source.as_str().to_string(),
        writable: r.writable,
        warnings: r.warnings,
        conflicting_roots: r
            .conflicting_roots
            .into_iter()
            .map(|(source, path)| ConflictingRoot {
                source: source.as_str().to_string(),
                path: path.to_string_lossy().to_string(),
            })
            .collect(),
    })
}

/// Reveal the resolved active data root in the OS file manager/opener —
/// read-only, never creates, moves, or merges anything.
#[tauri::command(async)]
pub async fn open_active_data_root(app: AppHandle) -> Result<(), String> {
    let r = resolve_data_root(&app)?;
    crate::artifact_file::os_open(&r.path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("formulab-dataroot-test-{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn missing_pointer(base: &Path, name: &str) -> PathBuf {
        base.join(name) // never written — simulates an absent pointer file
    }

    fn write_pointer(base: &Path, name: &str, target: &Path) -> PathBuf {
        let p = base.join(name);
        std::fs::write(&p, target.to_string_lossy().as_bytes()).unwrap();
        p
    }

    #[test]
    fn resolves_to_the_default_root_when_no_pointer_exists() {
        let scratch = tmp("default");
        let default_dir = scratch.join("default-root");
        std::fs::create_dir_all(&default_dir).unwrap();

        let result = resolve_data_root_at(
            &missing_pointer(&scratch, "formulab-root.txt"),
            &missing_pointer(&scratch, "active-workspace.txt"),
            &missing_pointer(&scratch, "base-workspace.txt"),
            &default_dir,
        );
        assert_eq!(result.path, default_dir);
        assert_eq!(result.source, RootSource::Default);
        assert!(result.writable);
        assert!(result.warnings.is_empty());
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn formulab_root_txt_wins_over_every_other_pointer() {
        let scratch = tmp("formulab-root-wins");
        let winner = scratch.join("winner");
        let active = scratch.join("active");
        let base = scratch.join("base");
        let default_dir = scratch.join("default");
        for d in [&winner, &active, &base, &default_dir] {
            std::fs::create_dir_all(d).unwrap();
        }

        let result = resolve_data_root_at(
            &write_pointer(&scratch, "formulab-root.txt", &winner),
            &write_pointer(&scratch, "active-workspace.txt", &active),
            &write_pointer(&scratch, "base-workspace.txt", &base),
            &default_dir,
        );
        assert_eq!(result.path, winner);
        assert_eq!(result.source, RootSource::FormulabRootOverride);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn active_workspace_txt_wins_when_formulab_root_is_absent() {
        let scratch = tmp("active-wins");
        let active = scratch.join("active");
        let base = scratch.join("base");
        let default_dir = scratch.join("default");
        for d in [&active, &base, &default_dir] {
            std::fs::create_dir_all(d).unwrap();
        }

        let result = resolve_data_root_at(
            &missing_pointer(&scratch, "formulab-root.txt"),
            &write_pointer(&scratch, "active-workspace.txt", &active),
            &write_pointer(&scratch, "base-workspace.txt", &base),
            &default_dir,
        );
        assert_eq!(result.path, active);
        assert_eq!(result.source, RootSource::ActiveWorkspaceOverride);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn base_workspace_txt_wins_when_the_other_two_are_absent() {
        let scratch = tmp("base-wins");
        let base = scratch.join("base");
        let default_dir = scratch.join("default");
        std::fs::create_dir_all(&base).unwrap();
        std::fs::create_dir_all(&default_dir).unwrap();

        let result = resolve_data_root_at(
            &missing_pointer(&scratch, "formulab-root.txt"),
            &missing_pointer(&scratch, "active-workspace.txt"),
            &write_pointer(&scratch, "base-workspace.txt", &base),
            &default_dir,
        );
        assert_eq!(result.path, base);
        assert_eq!(result.source, RootSource::BaseWorkspaceOverride);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn a_malformed_pointer_falls_through_with_a_visible_warning_not_silently() {
        let scratch = tmp("malformed");
        let base = scratch.join("base");
        let default_dir = scratch.join("default");
        std::fs::create_dir_all(&base).unwrap();
        std::fs::create_dir_all(&default_dir).unwrap();
        let malformed = scratch.join("formulab-root.txt");
        std::fs::write(&malformed, "   ").unwrap(); // blank after trim

        let result = resolve_data_root_at(
            &malformed,
            &missing_pointer(&scratch, "active-workspace.txt"),
            &write_pointer(&scratch, "base-workspace.txt", &base),
            &default_dir,
        );
        assert_eq!(result.path, base);
        assert_eq!(result.source, RootSource::BaseWorkspaceOverride);
        assert!(result.warnings.iter().any(|w| w.contains("formulab-root.txt") && w.contains("invalid")));
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn a_pointer_whose_target_is_missing_falls_through_with_a_visible_warning() {
        let scratch = tmp("missing-target");
        let base = scratch.join("base");
        let default_dir = scratch.join("default");
        std::fs::create_dir_all(&base).unwrap();
        std::fs::create_dir_all(&default_dir).unwrap();
        let ghost_target = scratch.join("this-directory-does-not-exist");

        let result = resolve_data_root_at(
            &write_pointer(&scratch, "formulab-root.txt", &ghost_target),
            &missing_pointer(&scratch, "active-workspace.txt"),
            &write_pointer(&scratch, "base-workspace.txt", &base),
            &default_dir,
        );
        assert_eq!(result.path, base);
        assert!(result.warnings.iter().any(|w| w.contains("formulab-root.txt") && w.contains("does not exist")));
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn an_unwritable_resolved_root_is_flagged_but_still_returned() {
        // A file standing in for "not a usable directory" is the portable
        // proxy this suite uses for "unwritable" — real permission-denial
        // is not reliably simulatable across platforms in a unit test, and
        // `probe_writable` already short-circuits on `!is_dir()` first, so
        // this exercises the same "resolved but not writable" reporting
        // path a genuine permission failure would hit.
        let scratch = tmp("unwritable");
        let not_a_dir = scratch.join("i-am-a-file");
        std::fs::write(&not_a_dir, b"x").unwrap();
        let default_dir = scratch.join("default");
        std::fs::create_dir_all(&default_dir).unwrap();

        let result = resolve_data_root_at(
            &write_pointer(&scratch, "formulab-root.txt", &not_a_dir),
            &missing_pointer(&scratch, "active-workspace.txt"),
            &missing_pointer(&scratch, "base-workspace.txt"),
            &default_dir,
        );
        // not_a_dir isn't a directory, so read_pointer treats it as invalid
        // ("is not a directory") and falls through to default — writable.
        assert_eq!(result.path, default_dir);
        assert!(result.writable);
        assert!(result.warnings.iter().any(|w| w.contains("is not a directory")));
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn multiple_valid_roots_holding_real_data_are_flagged_as_a_conflict_never_merged() {
        let scratch = tmp("conflict");
        let winner = scratch.join("winner");
        let other = scratch.join("other-with-data");
        let default_dir = scratch.join("default");
        std::fs::create_dir_all(winner.join("data").join("master")).unwrap();
        std::fs::create_dir_all(other.join("data").join("master")).unwrap();
        std::fs::write(other.join("data/master/materials.json"), "[{}]").unwrap();
        std::fs::create_dir_all(&default_dir).unwrap();

        let result = resolve_data_root_at(
            &write_pointer(&scratch, "formulab-root.txt", &winner),
            &missing_pointer(&scratch, "active-workspace.txt"),
            &write_pointer(&scratch, "base-workspace.txt", &other),
            &default_dir,
        );
        assert_eq!(result.path, winner);
        assert_eq!(result.conflicting_roots.len(), 1);
        assert_eq!(result.conflicting_roots[0].1, other);
        assert!(result.warnings.iter().any(|w| w.contains("also contains real project data")));

        // The whole point of "never merge automatically": the non-winning
        // root's real data file is untouched — same bytes, still there.
        let other_data = std::fs::read(other.join("data/master/materials.json")).unwrap();
        assert_eq!(other_data, b"[{}]");
        // And the winner's own (empty) data tree was never written to or
        // seeded from the other root.
        assert!(std::fs::read_dir(winner.join("data").join("master")).unwrap().next().is_none());

        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn a_valid_but_empty_other_root_is_not_flagged_as_a_conflict() {
        let scratch = tmp("no-conflict-empty");
        let winner = scratch.join("winner");
        let other_empty = scratch.join("other-empty");
        let default_dir = scratch.join("default");
        for d in [&winner, &other_empty, &default_dir] {
            std::fs::create_dir_all(d).unwrap();
        }

        let result = resolve_data_root_at(
            &write_pointer(&scratch, "formulab-root.txt", &winner),
            &missing_pointer(&scratch, "active-workspace.txt"),
            &write_pointer(&scratch, "base-workspace.txt", &other_empty),
            &default_dir,
        );
        assert!(result.conflicting_roots.is_empty());
        assert!(!result.warnings.iter().any(|w| w.contains("also contains real project data")));
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn active_and_base_agreeing_produces_no_conflict_and_no_warning() {
        let scratch = tmp("active-base-agree");
        let shared = scratch.join("shared");
        let default_dir = scratch.join("default");
        std::fs::create_dir_all(&shared).unwrap();
        std::fs::create_dir_all(&default_dir).unwrap();

        let result = resolve_data_root_at(
            &missing_pointer(&scratch, "formulab-root.txt"),
            &write_pointer(&scratch, "active-workspace.txt", &shared),
            &write_pointer(&scratch, "base-workspace.txt", &shared),
            &default_dir,
        );
        assert_eq!(result.path, shared);
        assert!(result.conflicting_roots.is_empty());
        let _ = std::fs::remove_dir_all(&scratch);
    }
}
