// FormuLab v2 — direct formulation pipeline (no OpenCode agent loop).
//
// One request/response: the frontend sends a brief + provider/model/key, this
// command runs the bundled Python pipeline (real open-access literature + ONE
// LLM call) on the SAME interpreter the notebook uses (kernel::python_bin), and
// returns v1..vN formulation cards as JSON.
//
// The pipeline package (pure stdlib) is embedded and materialized on first use,
// exactly like formulation.rs, so it is always present regardless of packaging.
// literature_cache.py imports discover.py via a path two levels up, so that file
// is materialized into the sibling skills/core/formulation-discovery/ location it
// expects.
//
// Sessions: only runs that SUCCESSFULLY produce cards are kept. A failed or
// refused run has its (partial) session directory removed so the sessions/ list
// only ever contains real results.
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

// Embedded pipeline package + its one external dependency (discover.py).
const F_PIPELINE: &str = include_str!("../../../../runtime/pipeline/pipeline.py");
const F_LLM: &str = include_str!("../../../../runtime/pipeline/llm.py");
const F_CACHE: &str = include_str!("../../../../runtime/pipeline/literature_cache.py");
const F_RULES: &str = include_str!("../../../../runtime/pipeline/rules.py");
const F_REGION: &str = include_str!("../../../../runtime/pipeline/region_profiles.py");
const F_CLI: &str = include_str!("../../../../runtime/pipeline/run_cli.py");
const F_DISCOVER: &str =
    include_str!("../../../../runtime/skills/core/formulation-discovery/discover.py");

/// Request from the frontend. `brief` is the free-form formulation brief object
/// (target/category/audience/market/…); the rest select the model + key.
#[derive(Deserialize)]
pub struct GenerateRequest {
    pub brief: serde_json::Value,
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_n")]
    pub n: u32,
}

fn default_n() -> u32 {
    3
}

/// The project folder everything the user creates lives under:
///
///   <root>/formulas/            the flat library of every formula ever made
///   <root>/data/sessions/       one folder per successful run
///   <root>/data/literature/     the shared paper + PDF cache
///
/// Kept independent of OpenCode's workspace base (which re-roots per run and is
/// going away) so the layout survives that removal. A pointer file overrides it;
/// otherwise it falls back to the workspace base.
pub(crate) fn project_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(p) = app.path().app_data_dir() {
        let pointer = p.join("runtime").join("formulab-root.txt");
        if let Ok(s) = std::fs::read_to_string(&pointer) {
            let dir = PathBuf::from(s.trim());
            if dir.is_dir() {
                return Ok(dir);
            }
        }
    }
    crate::workspace::base_workspace_dir(app)
}

fn data_dir(app: &AppHandle, sub: &[&str]) -> Result<PathBuf, String> {
    let mut dir = project_root(app)?;
    for s in sub {
        dir = dir.join(s);
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// App-private scratch (the materialized Python package) — code, not user data,
/// so it stays out of the user's folder.
fn app_dir(app: &AppHandle, sub: &[&str]) -> Result<PathBuf, String> {
    let mut dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    for s in sub {
        dir = dir.join(s);
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Materialize the pipeline package + discover.py into app-private storage and
/// return the directory holding run_cli.py.
fn materialize_pipeline(app: &AppHandle) -> Result<PathBuf, String> {
    let pipe = app_dir(app, &["runtime", "pipeline"])?;
    for (name, src) in [
        ("pipeline.py", F_PIPELINE),
        ("llm.py", F_LLM),
        ("literature_cache.py", F_CACHE),
        ("rules.py", F_RULES),
        ("region_profiles.py", F_REGION),
        ("run_cli.py", F_CLI),
    ] {
        std::fs::write(pipe.join(name), src).map_err(|e| e.to_string())?;
    }
    // literature_cache.py expects discover.py at ../skills/core/formulation-discovery/.
    let disc = app_dir(app, &["runtime", "skills", "core", "formulation-discovery"])?;
    std::fs::write(disc.join("discover.py"), F_DISCOVER).map_err(|e| e.to_string())?;
    Ok(pipe)
}

/// Run the pipeline: materialize, invoke run_cli.py with the request on stdin,
/// return the parsed result JSON. Keeps the session only on `status == "ok"`.
#[tauri::command(async)]
pub async fn generate_formulation(
    app: AppHandle,
    request: GenerateRequest,
) -> Result<serde_json::Value, String> {
    let pipe = materialize_pipeline(&app)?;
    let cli = pipe.join("run_cli.py");
    let (python, _source) = crate::kernel::python_bin(&app)?;

    let library = data_dir(&app, &["data", "literature"])?; // shared cache + pdfs
    let formulas = data_dir(&app, &["formulas"])?; // flat library of every card
    let sessions = data_dir(&app, &["data", "sessions"])?;

    // Python names the session folder (it has date formatting) as
    // YYYY-MM-DD-HHMM-<slug> and reports the path back.
    let payload = serde_json::json!({
        "brief": request.brief,
        "provider": request.provider,
        "model": request.model,
        "api_key": request.api_key,
        "library_dir": library.to_string_lossy(),
        "formulas_dir": formulas.to_string_lossy(),
        "sessions_dir": sessions.to_string_lossy(),
        "n": request.n,
    });
    let input_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;

    let mut cmd = crate::workspace::quiet_command(&python);
    cmd.arg(&cli)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to launch Python: {e}"))?;
    child
        .stdin
        .take()
        .ok_or("no stdin on pipeline process")?
        .write_all(input_json.as_bytes())
        .map_err(|e| format!("failed to send request: {e}"))?;

    let out = child
        .wait_with_output()
        .map_err(|e| format!("pipeline process error: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);

    let result: serde_json::Value = match serde_json::from_str(stdout.trim()) {
        Ok(v) => v,
        Err(_) => {
            let msg = stderr.trim();
            return Err(if msg.is_empty() {
                format!("pipeline produced no result (exit {:?})", out.status.code())
            } else {
                msg.to_string()
            });
        }
    };

    // The session folder is named and reported by Python; a failed or refused
    // run has it removed so only real results are ever listed.
    let session_dir = result
        .get("session_dir")
        .and_then(|s| s.as_str())
        .map(PathBuf::from);
    let ok = result.get("status").and_then(|s| s.as_str()) == Some("ok");
    if ok {
        Ok(result)
    } else {
        if let Some(dir) = session_dir {
            if dir.starts_with(&sessions) {
                let _ = std::fs::remove_dir_all(&dir);
            }
        }
        Ok(result) // status: "refused" | "error" — surfaced to the UI, no session kept
    }
}

/// Read the saved cards of one session directory (sorted v1..vN). Returns the
/// markdown only — NO model call, ever. Opening a past session is read-only.
fn read_cards(dir: &std::path::Path) -> Vec<serde_json::Value> {
    let mut files: Vec<PathBuf> = match std::fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| {
                        n.ends_with(".md")
                            // current: Formulation_Card_<session>_v1.md
                            && (n.starts_with("Formulation_Card_")
                                // sessions written before the rename
                                || n.starts_with("formulation-card-v"))
                    })
                    .unwrap_or(false)
            })
            .collect(),
        Err(_) => return Vec::new(),
    };
    files.sort();
    files
        .iter()
        .filter_map(|p| {
            let stem = p.file_name().and_then(|n| n.to_str())?.trim_end_matches(".md");
            // The version is the trailing "v<N>" segment under either scheme.
            let version = stem
                .rsplit(['_', '-'])
                .next()
                .filter(|s| {
                    s.starts_with('v') && s.len() > 1 && s[1..].chars().all(|c| c.is_ascii_digit())
                })
                .unwrap_or("v?")
                .to_string();
            let md = std::fs::read_to_string(p).ok()?;
            Some(serde_json::json!({ "version": version, "markdown": md }))
        })
        .collect()
}

/// List saved sessions (successful runs only — failed ones were never kept),
/// newest first. Each entry carries enough for the sidebar without re-running.
#[tauri::command(async)]
pub async fn list_sessions(app: AppHandle) -> Result<serde_json::Value, String> {
    let sessions = data_dir(&app, &["data", "sessions"])?;
    let mut items: Vec<serde_json::Value> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&sessions) {
        for entry in rd.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            // Ids start with "YYYY-MM-DD-HHMM", which sorts chronologically as
            // text — so the name itself is the sort key, newest first.
            let created: String = id.chars().take(15).collect();
            let brief = std::fs::read_to_string(path.join("brief.json"))
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v.get("brief").cloned())
                .unwrap_or(serde_json::Value::Null);
            let card_count = read_cards(&path).len();
            if card_count == 0 {
                continue; // not a real result — skip
            }
            items.push(serde_json::json!({
                "id": id,
                "created": created,
                "brief": brief,
                "card_count": card_count,
            }));
        }
    }
    items.sort_by(|a, b| {
        b.get("id")
            .and_then(|v| v.as_str())
            .cmp(&a.get("id").and_then(|v| v.as_str()))
    });
    Ok(serde_json::Value::Array(items))
}

/// Open one session read-only: return its brief + saved cards. No LLM call.
#[tauri::command(async)]
pub async fn read_session(
    app: AppHandle,
    id: String,
) -> Result<serde_json::Value, String> {
    // Guard against path traversal: the id must be a single path component.
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("invalid session id".into());
    }
    let dir = data_dir(&app, &["data", "sessions"])?.join(&id);
    if !dir.is_dir() {
        return Err(format!("session not found: {id}"));
    }
    let brief = std::fs::read_to_string(dir.join("brief.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .unwrap_or(serde_json::Value::Null);
    Ok(serde_json::json!({
        "status": "ok",
        "id": id,
        "brief": brief,
        "cards": read_cards(&dir),
        "read_only": true,
    }))
}

/// Delete one saved session.
#[tauri::command(async)]
pub async fn delete_session(app: AppHandle, id: String) -> Result<(), String> {
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("invalid session id".into());
    }
    let dir = data_dir(&app, &["data", "sessions"])?.join(&id);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
