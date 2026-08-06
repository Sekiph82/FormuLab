use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::workspace::quiet_command;

/// Serializes every snapshot commit process-wide. The frontend (on
/// `session.idle`) and several Rust record paths can all try to commit the same
/// workspace at once; without this they race on `.git/index.lock` and silently
/// drop snapshots. Workspaces are used one at a time, so a single global lock is
/// enough and each commit is quick.
fn git_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

const AUTHOR_NAME: &str = "FormuLab";
const AUTHOR_EMAIL: &str = "FormuLab@local";

/// Files at or above this size are kept out of snapshots. Git stores every
/// version whole (binaries never delta or compress) and never reclaims the
/// space, and this app commits on *every* run — so the worst case is one large
/// file that changes each run: its history cost is roughly `runs * threshold`.
/// At 20 MB that caps the worst case near 2 GB per 100 runs, while still
/// versioning the outputs users actually want (plots, notebooks, typical CSVs,
/// small models — nearly all < 20 MB). Datasets, checkpoints, and media, which
/// belong in external storage anyway, are excluded. The guard is size-based,
/// not extension-based, so a small `.mp4` is kept and a huge `.csv` is not.
const MAX_BLOB_BYTES: u64 = 20 * 1024 * 1024;

/// The per-file guard above is blind to the other fatal bloat pattern: a dataset
/// of *thousands of small files* (copied-in images, audio clips, per-sample
/// `.json`/`.npy`), each under `MAX_BLOB_BYTES` yet enormous in aggregate. So we
/// also drop any single directory whose freshly-staged contents sum to at least
/// this much. Grouping is by immediate parent directory, so a bulky `data/`
/// never drags down a sibling source tree; a normal code directory (a few MB of
/// text) never trips it, while a copied dataset does. Format-agnostic, and a
/// companion to the media-extension ignores which handle the thin-spread case.
const MAX_DIR_BYTES: u64 = 50 * 1024 * 1024;

/// Default ignore rules planted when WE create a snapshot repo. A `.gitignore`
/// the user already placed in the workspace is left untouched.
///
/// Principle: this is a provenance tool, so we only exclude paths with *no*
/// reproducibility value (OS junk, editor scratch, dependency/env dirs, caches,
/// tooling debug logs) plus secrets that must never be committed. Research
/// outputs — data, figures, notebooks, models, code — are deliberately NOT
/// ignored; anything genuinely too big is caught by the >= 100 MB size guard,
/// which is format-agnostic (a small `.mp4` is kept, a huge `.csv` is not).
const DEFAULT_GITIGNORE: &str = "\
# Managed by FormuLab.
# Excludes paths with no provenance value plus secrets that must never be
# committed. Research outputs, data, notebooks, and code are intentionally kept;
# files >= 100 MB are dropped by the snapshot size guard, not by this list.

# --- Secrets / credentials (API keys live in the OS keychain, never in git) ---
.env
.env.*
!.env.example
!.env.sample
!.env.template
*.pem
*.key
*.p12
*.pfx
id_rsa
id_dsa
id_ecdsa
id_ed25519
.netrc
credentials.json
secrets.json
service-account*.json
.aws/
.gcloud/

# --- macOS ---
.DS_Store
.DS_Store?
._*
.AppleDouble
.LSOverride
.Spotlight-V100
.Trashes

# --- Windows ---
Thumbs.db
ehthumbs.db
ehthumbs_vista.db
Desktop.ini
$RECYCLE.BIN/

# --- Linux ---
.fuse_hidden*
.Trash-*
.nfs*

# --- Editors / IDEs ---
.vscode/
.idea/
*.swp
*.swo
*.swn
.*.swp
*~
*.sublime-workspace

# --- Python ---
__pycache__/
*.py[cod]
*$py.class
.Python
.venv/
venv/
env/
ENV/
.eggs/
*.egg-info/
.pytest_cache/
.mypy_cache/
.dmypy.json
.pyre/
.pytype/
.ruff_cache/
.tox/
.nox/
.coverage
.coverage.*
htmlcov/
.hypothesis/
cython_debug/
.ipynb_checkpoints/

# --- Conda ---
.conda/

# --- R ---
.Rhistory
.RData
.Rproj.user/
.Ruserdata

# --- Node / JS ---
node_modules/
.npm/
.yarn/
.pnpm-store/
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# --- Temp / caches ---
*.tmp
*.temp
*.bak
.cache/
tmp/
.tmp/

# --- Bulk binary media (images / audio / video) ---
# These arrive in the thousands (a copied image or audio dataset) and each file
# is usually well under the 20 MB per-file size guard, so that guard can't stop
# them — thousands of small binaries would bloat history fatally, and git can
# neither delta nor compress them. They are also almost always either raw data
# or a regenerable render, not source. Text/vector figures (.svg) and documents
# (.pdf) are kept — they are small, versionable, and usually authored output.
# Notebook plots are embedded in the versioned .ipynb already. Delete a line
# below if that medium is your primary data and you want it in snapshots.
# Video
*.mp4
*.m4v
*.mov
*.avi
*.mkv
*.webm
*.wmv
*.flv
*.mpg
*.mpeg
*.ogv
*.3gp
# Images (raster)
*.jpg
*.jpeg
*.png
*.gif
*.bmp
*.tif
*.tiff
*.webp
*.heic
*.heif
*.ico
*.psd
*.raw
*.cr2
*.nef
*.arw
*.dng
# Audio
*.wav
*.flac
*.aac
*.m4a
*.mp3
*.ogg
*.oga
*.wma
*.aiff
*.aif
";

fn git(root: &Path) -> std::process::Command {
    let mut cmd = quiet_command("git");
    cmd.current_dir(root)
        .env("GIT_AUTHOR_NAME", AUTHOR_NAME)
        .env("GIT_AUTHOR_EMAIL", AUTHOR_EMAIL)
        .env("GIT_COMMITTER_NAME", AUTHOR_NAME)
        .env("GIT_COMMITTER_EMAIL", AUTHOR_EMAIL);
    cmd
}

pub fn git_available() -> bool {
    quiet_command("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn run(root: &Path, args: &[&str]) -> Result<(), String> {
    let out = git(root)
        .args(args)
        .output()
        .map_err(|e| format!("git {} failed to start: {e}", args.join(" ")))?;
    if out.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    Err(format!(
        "git {} failed{}",
        args.join(" "),
        if stderr.is_empty() {
            String::new()
        } else {
            format!(": {stderr}")
        },
    ))
}

/// Like `run`, but returns captured stdout bytes on success.
fn capture(root: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let out = git(root)
        .args(args)
        .output()
        .map_err(|e| format!("git {} failed to start: {e}", args.join(" ")))?;
    if out.status.success() {
        return Ok(out.stdout);
    }
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    Err(format!(
        "git {} failed{}",
        args.join(" "),
        if stderr.is_empty() {
            String::new()
        } else {
            format!(": {stderr}")
        },
    ))
}

/// After `git add -A`, drop any staged file at/over `MAX_BLOB_BYTES` back out of
/// the index (keeping it on disk) so it never enters git history. `git reset --
/// <path>` reverts the index entry to HEAD, which both removes a brand-new large
/// file and preserves the previously committed version of one that just grew —
/// and it works on an unborn branch (first commit) too.
fn unstage_oversized(root: &Path) -> Result<(), String> {
    let stdout = capture(root, &["diff", "--cached", "--name-only", "-z"])?;
    let mut skipped: Vec<String> = Vec::new();
    for name in stdout.split(|b| *b == 0) {
        if name.is_empty() {
            continue;
        }
        let rel = String::from_utf8_lossy(name).into_owned();
        // A staged deletion has no working-tree file; metadata fails and we skip
        // it, which correctly leaves the deletion staged.
        if let Ok(meta) = std::fs::metadata(root.join(&rel)) {
            if meta.is_file() && meta.len() >= MAX_BLOB_BYTES {
                skipped.push(rel);
            }
        }
    }
    if skipped.is_empty() {
        return Ok(());
    }
    let mut args: Vec<&str> = vec!["reset", "--quiet", "--"];
    args.extend(skipped.iter().map(|s| s.as_str()));
    run(root, &args)?;
    eprintln!(
        "workspace snapshot: skipped {} file(s) >= {} MB: {}",
        skipped.len(),
        MAX_BLOB_BYTES / (1024 * 1024),
        skipped.join(", ")
    );
    Ok(())
}

/// Drop any directory whose freshly-staged files sum to >= `MAX_DIR_BYTES` back
/// out of the index (files stay on disk). Catches bulk data dumps — thousands of
/// small files that individually slip past `unstage_oversized`. Grouped by
/// immediate parent directory so one bulky folder can't take a sibling with it;
/// root-level files (no parent dir) are left alone since we would never reset
/// the whole workspace.
fn unstage_bulk_dirs(root: &Path) -> Result<(), String> {
    use std::collections::BTreeMap;
    let stdout = capture(root, &["diff", "--cached", "--name-only", "-z"])?;
    let mut by_dir: BTreeMap<String, u64> = BTreeMap::new();
    for name in stdout.split(|b| *b == 0) {
        if name.is_empty() {
            continue;
        }
        let rel = String::from_utf8_lossy(name).into_owned();
        // git always emits forward slashes here. No slash => file at repo root.
        let Some(idx) = rel.rfind('/') else { continue };
        let dir = rel[..idx].to_string();
        let size = std::fs::metadata(root.join(&rel))
            .map(|m| if m.is_file() { m.len() } else { 0 })
            .unwrap_or(0);
        *by_dir.entry(dir).or_insert(0) += size;
    }
    let bulky: Vec<(String, u64)> = by_dir
        .into_iter()
        .filter(|(_, bytes)| *bytes >= MAX_DIR_BYTES)
        .collect();
    if bulky.is_empty() {
        return Ok(());
    }
    for (dir, _) in &bulky {
        run(root, &["reset", "--quiet", "--", dir])?;
    }
    let summary = bulky
        .iter()
        .map(|(d, b)| format!("{d}/ ({} MB)", b / (1024 * 1024)))
        .collect::<Vec<_>>()
        .join(", ");
    eprintln!(
        "workspace snapshot: skipped {} bulk director{} (>= {} MB staged): {}",
        bulky.len(),
        if bulky.len() == 1 { "y" } else { "ies" },
        MAX_DIR_BYTES / (1024 * 1024),
        summary
    );
    Ok(())
}

/// Written inside `.git` the first time WE create a snapshot repo. Its presence
/// is how we recognize an app-managed repo that is safe to `add -A`/commit into;
/// we never touch a git repository the user brought into the workspace himself.
fn snapshot_marker(root: &Path) -> PathBuf {
    root.join(".git").join(".FormuLab-snapshots")
}

/// Written under a workspace's `.FormuLab/` to opt it out of app-managed
/// snapshots entirely — used for IMPORTED workspaces (a repo/folder the user
/// brought in) so the app never `git init`s or commits into it, even when the
/// folder isn't a git repo yet.
const NO_SNAPSHOT_MARKER: &str = ".no-snapshots";

fn no_snapshot_marker(root: &Path) -> PathBuf {
    root.join(".FormuLab").join(NO_SNAPSHOT_MARKER)
}

/// Ensure an app-owned snapshot repo exists. Returns `Ok(false)` when the folder
/// already holds a git repo we did not create, or is an imported workspace —
/// the caller must then NOT commit, so the user's own history and staged work
/// are left untouched.
fn ensure_owned_repo(root: &Path) -> Result<bool, String> {
    if !git_available() {
        return Err("git is not available".into());
    }
    // An imported workspace opts out of app-managed snapshots entirely — never
    // `git init` it and never commit, whether or not it is a git repo.
    if no_snapshot_marker(root).exists() {
        return Ok(false);
    }
    if root.join(".git").exists() {
        // A pre-existing repo is only ours if we planted the marker at init.
        return Ok(snapshot_marker(root).exists());
    }
    run(root, &["init"])?;
    std::fs::write(snapshot_marker(root), b"1")
        .map_err(|e| format!("could not mark snapshot repo: {e}"))?;
    // Plant sensible ignores for our fresh repo, but never clobber a
    // .gitignore the workspace already contains.
    let gitignore = root.join(".gitignore");
    if !gitignore.exists() {
        std::fs::write(&gitignore, DEFAULT_GITIGNORE)
            .map_err(|e| format!("could not write .gitignore: {e}"))?;
    }
    Ok(true)
}

pub fn commit(root: &Path, message: &str) -> Result<bool, String> {
    let _lock = git_lock()
        .lock()
        .map_err(|_| "git snapshot lock poisoned".to_string())?;
    if !ensure_owned_repo(root)? {
        // Not an app-managed repo — never commit into the user's own history.
        return Ok(false);
    }
    run(root, &["add", "-A", "--", "."])?;
    unstage_oversized(root)?;
    unstage_bulk_dirs(root)?;
    let status = git(root)
        .args(["diff", "--cached", "--quiet"])
        .status()
        .map_err(|e| format!("git diff failed to start: {e}"))?;
    if status.success() {
        return Ok(false);
    }
    run(root, &["commit", "-m", message])?;
    Ok(true)
}

pub fn commit_best_effort(root: &Path, message: &str) {
    if let Err(e) = commit(root, message) {
        eprintln!("workspace git snapshot skipped: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::{commit, git_available};
    use std::fs;

    #[test]
    fn commit_initializes_repo_and_skips_clean_tree() {
        if !git_available() {
            eprintln!("git unavailable; skipping git snapshot test");
            return;
        }
        let root = std::env::temp_dir().join(format!("os-git-snapshot-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("AGENTS.md"), "rules\n").unwrap();

        assert!(commit(&root, "Initialize workspace").unwrap());
        assert!(root.join(".git").is_dir());
        assert!(!commit(&root, "No changes").unwrap());

        fs::write(root.join("AGENTS.md"), "rules\nmore\n").unwrap();
        assert!(commit(&root, "Update workspace").unwrap());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn commit_skips_oversized_files_but_keeps_them_on_disk() {
        if !git_available() {
            eprintln!("git unavailable; skipping git snapshot test");
            return;
        }
        let root = std::env::temp_dir().join(format!("os-git-big-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("small.txt"), "keep me\n").unwrap();
        fs::write(
            root.join("big.bin"),
            vec![0u8; super::MAX_BLOB_BYTES as usize],
        )
        .unwrap();

        // The small file is committed; the oversized one is not.
        assert!(commit(&root, "Initialize workspace").unwrap());
        let tracked = super::capture(&root, &["ls-files"]).unwrap();
        let tracked = String::from_utf8_lossy(&tracked);
        assert!(tracked.contains("small.txt"));
        assert!(!tracked.contains("big.bin"));
        // But the big file is left untouched on disk.
        assert!(root.join("big.bin").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn commit_skips_bulk_directory_of_small_files() {
        if !git_available() {
            eprintln!("git unavailable; skipping git snapshot test");
            return;
        }
        let root = std::env::temp_dir().join(format!("os-git-bulk-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("dataset")).unwrap();
        // A source file at root that must survive.
        fs::write(root.join("train.py"), "print('hi')\n").unwrap();
        // Four 15 MB files: each is under the 20 MB per-file guard, but together
        // the directory is 60 MB, over the 50 MB directory guard.
        let chunk = vec![0u8; 15 * 1024 * 1024];
        for i in 0..4 {
            fs::write(root.join("dataset").join(format!("sample_{i}.dat")), &chunk).unwrap();
        }

        assert!(commit(&root, "Initialize workspace").unwrap());
        let tracked = super::capture(&root, &["ls-files"]).unwrap();
        let tracked = String::from_utf8_lossy(&tracked);
        assert!(tracked.contains("train.py"));
        assert!(!tracked.contains("dataset/"));
        // Files are only unstaged, never removed from disk.
        assert!(root.join("dataset").join("sample_0.dat").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn commit_writes_default_gitignore_on_fresh_repo() {
        if !git_available() {
            eprintln!("git unavailable; skipping git snapshot test");
            return;
        }
        let root = std::env::temp_dir().join(format!("os-git-ignore-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("AGENTS.md"), "rules\n").unwrap();

        assert!(commit(&root, "Initialize workspace").unwrap());
        let gitignore = fs::read_to_string(root.join(".gitignore")).unwrap();
        assert!(gitignore.contains("node_modules/"));
        assert!(gitignore.contains(".env"));
        assert!(gitignore.contains("*.mp4"));
        assert!(gitignore.contains("*.png"));
        assert!(gitignore.contains("*.wav"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn commit_never_touches_a_repo_the_user_brought() {
        if !git_available() {
            eprintln!("git unavailable; skipping git snapshot test");
            return;
        }
        let root = std::env::temp_dir().join(format!("os-git-foreign-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        // A repo the user brought in: it has a .git but none of our marker.
        super::run(&root, &["init"]).unwrap();
        fs::write(root.join("data.txt"), "user work in progress\n").unwrap();

        // We must decline it, leave the tree/index alone, and plant no marker.
        assert!(!commit(&root, "should be skipped").unwrap());
        assert!(!super::snapshot_marker(&root).exists());
        let _ = fs::remove_dir_all(&root);
    }

    /// `ensure_owned_repo` still honors a `.FormuLab/.no-snapshots` marker on a
    /// plain folder (see `no_snapshot_marker`) — a workspace bearing it is never
    /// `git init`ed or committed into. The writer side of this mechanism
    /// (`mark_imported`, plus a `.git/info/exclude`-writing counterpart for an
    /// already-a-repo workspace) was removed in 09bc5e5 ("Finish removing
    /// OpenCode from the Rust side") along with the whole external-workspace
    /// "import as project" feature it served — grep confirms no `ProjectInfo`,
    /// `import_project`, `create_project` or `list_projects` exists anywhere in
    /// this crate today, so there is nothing left to call a writer with. The
    /// check itself is cheap and harmless to leave in place for when that
    /// feature returns; this test plants the marker directly (what a future
    /// writer would do) to prove the check side still works.
    #[test]
    fn a_workspace_bearing_the_no_snapshot_marker_is_never_initialized_or_committed() {
        if !git_available() {
            eprintln!("git unavailable; skipping git snapshot test");
            return;
        }
        let root = std::env::temp_dir().join(format!("os-git-imported-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("notes.md"), "brought-in work\n").unwrap();

        let marker = super::no_snapshot_marker(&root);
        fs::create_dir_all(marker.parent().unwrap()).unwrap();
        fs::write(&marker, b"imported\n").unwrap();

        // A later commit must NOT `git init` it and must NOT commit.
        assert!(!commit(&root, "should be skipped").unwrap());
        assert!(!root.join(".git").exists());
        let _ = fs::remove_dir_all(&root);
    }
}
