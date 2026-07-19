// Where the app keeps the user's work, plus the few process helpers the rest of
// the crate needs. This is what survived the OpenCode removal: the sidecar
// lifecycle, its config/auth plumbing and its proxy settings are gone, but the
// workspace folder, the folder picker and the spawn helpers were never about
// OpenCode and are still used by the pipeline, kernel, Jupyter and previews.
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// App-private root for state that is not the user's documents.
fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("runtime"))
}

/// File recording the user's chosen active workspace folder (absolute path).
fn active_workspace_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join("active-workspace.txt"))
}

/// File recording the user's chosen BASE folder (Settings → Workspace).
fn base_workspace_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join("base-workspace.txt"))
}

/// The active workspace folder the kernel / previews / provenance operate in.
/// Defaults to the base folder until the user picks another; the choice
/// persists across restarts.
pub fn workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(f) = active_workspace_file(app) {
        if let Ok(s) = std::fs::read_to_string(&f) {
            let dir = PathBuf::from(s.trim());
            if dir.is_dir() {
                return Ok(dir);
            }
        }
    }
    base_workspace_dir(app)
}

/// The root the user's work is created under. A folder picked in Settings wins;
/// the default is `~/Documents/FormuLab`, falling back to `$HOME/Documents`.
pub fn base_workspace_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(f) = base_workspace_file(app) {
        if let Ok(s) = std::fs::read_to_string(&f) {
            let dir = PathBuf::from(s.trim());
            if dir.is_dir() {
                return Ok(dir);
            }
        }
    }
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

#[tauri::command]
pub fn workspace_path(app: AppHandle) -> Result<String, String> {
    Ok(workspace_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn workspace_base(app: AppHandle) -> Result<String, String> {
    Ok(base_workspace_dir(&app)?.to_string_lossy().to_string())
}

/// Choose the base folder (Settings → Workspace → Change). Creates it if needed
/// and persists the choice.
#[tauri::command]
pub fn set_workspace_base(app: AppHandle, path: String) -> Result<String, String> {
    let dir = PathBuf::from(&path);
    if !dir.is_absolute() {
        return Err("workspace base must be absolute".into());
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create folder: {e}"))?;
    let canon = dir.canonicalize().map_err(|e| e.to_string())?;
    std::fs::write(base_workspace_file(&app)?, canon.to_string_lossy().as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(canon.to_string_lossy().to_string())
}

/// Reveal the base workspace folder in the OS file manager.
#[tauri::command]
pub fn open_workspace_base(app: AppHandle) -> Result<(), String> {
    crate::artifact_file::os_open(&base_workspace_dir(&app)?)
}

/// Native "choose a folder" dialog; returns the absolute path, or None on cancel.
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Native "choose a file" dialog, filtered to `extensions` (e.g. csv/tsv).
/// Returns the absolute path, or None on cancel.
#[tauri::command]
pub async fn pick_file(app: AppHandle, extensions: Vec<String>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file();
    if !extensions.is_empty() {
        let refs: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
        dialog = dialog.add_filter("Supported files", &refs);
    }
    let Some(picked) = dialog.blocking_pick_file() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

// ------------------------------------------------------------ process bits ---

/// A GUI app spawning a console-subsystem child (python.exe, taskkill, git…)
/// otherwise flashes a black window per spawn — every direct spawn in this
/// crate must go through here.
pub(crate) fn quiet_command(bin: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut cmd = std::process::Command::new(bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// An unused localhost port, chosen by binding to port 0 and reading back what
/// the OS assigned. Used to give the Jupyter server a port that cannot collide
/// with whatever else the machine is running.
/// Falls back to a fixed high port only if the OS refuses a bind, which in
/// practice means networking is broken and the server will fail anyway.
pub(crate) fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
        .unwrap_or(8899)
}

/// `bytes` bytes of OS randomness as lowercase hex. Panics only if the OS
/// CSPRNG is unavailable — a machine state where serving anything is unsafe.
pub(crate) fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("OS random source unavailable");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// GUI apps launched from Finder/Dock/a desktop entry get a minimal PATH, so
/// the app would not find the user's Python/conda/Homebrew tools. Prepend the
/// well-known locations that actually exist.
#[cfg(unix)]
pub(crate) fn enriched_path() -> String {
    let base = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();

    #[cfg(target_os = "macos")]
    let extras = [
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        format!("{home}/anaconda3/bin"),
        format!("{home}/miniconda3/bin"),
        "/opt/anaconda3/bin".to_string(),
        "/opt/miniconda3/bin".to_string(),
        format!("{home}/.pyenv/shims"),
        format!("{home}/.local/bin"),
    ];
    #[cfg(target_os = "linux")]
    let extras = [
        format!("{home}/anaconda3/bin"),
        format!("{home}/miniconda3/bin"),
        "/opt/conda/bin".to_string(),
        "/opt/anaconda3/bin".to_string(),
        "/opt/miniconda3/bin".to_string(),
        format!("{home}/.pyenv/shims"),
        "/home/linuxbrew/.linuxbrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        format!("{home}/.local/bin"),
    ];
    #[cfg(all(unix, not(target_os = "macos"), not(target_os = "linux")))]
    let extras = [
        format!("{home}/.pyenv/shims"),
        "/usr/local/bin".to_string(),
        format!("{home}/.local/bin"),
    ];

    let mut parts: Vec<String> = extras
        .into_iter()
        .filter(|p| !base.split(':').any(|b| b == p) && std::path::Path::new(p).is_dir())
        .collect();
    parts.push(base);
    parts.join(":")
}

#[cfg(not(unix))]
pub(crate) fn enriched_path() -> String {
    std::env::var("PATH").unwrap_or_default()
}

/// Extra environment for the bundled uv (managed-Python download + pip install).
/// The proxy and mirror settings this used to read belonged to the removed
/// runtime settings UI; uv inherits the process environment, so a system-wide
/// HTTP(S)_PROXY still applies.
pub(crate) fn uv_network_env(_app: &AppHandle) -> Vec<(&'static str, String)> {
    Vec::new()
}
