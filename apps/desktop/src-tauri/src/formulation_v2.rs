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
use std::time::{SystemTime, UNIX_EPOCH};

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

/// Everything the user creates lives under ONE visible folder — the workspace
/// base (Settings → Workspace), not a hidden app-data dir: sessions/,
/// literature/ (shared cache) and formulas/ (the flat formula library) sit side
/// by side so the whole project is in a single place the user can browse, back
/// up, or move.
fn data_dir(app: &AppHandle, sub: &[&str]) -> Result<PathBuf, String> {
    let mut dir = crate::runtime::base_workspace_dir(app)?;
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

/// A filesystem-safe slug from the brief's target (for the session dir name).
fn slug(brief: &serde_json::Value) -> String {
    let target = brief
        .get("target")
        .and_then(|t| t.as_str())
        .unwrap_or("product");
    let s: String = target
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let s = s.trim_matches('-').to_string();
    let s: String = s.chars().take(40).collect();
    if s.is_empty() {
        "product".to_string()
    } else {
        s
    }
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

    let library = data_dir(&app, &["literature"])?; // shared cache across sessions
    let formulas = data_dir(&app, &["formulas"])?; // flat library of every card
    let sessions = data_dir(&app, &["sessions"])?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let out_dir = sessions.join(format!("{ts}-{}", slug(&request.brief)));

    let payload = serde_json::json!({
        "brief": request.brief,
        "provider": request.provider,
        "model": request.model,
        "api_key": request.api_key,
        "library_dir": library.to_string_lossy(),
        "formulas_dir": formulas.to_string_lossy(),
        "out_dir": out_dir.to_string_lossy(),
        "n": request.n,
    });
    let input_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;

    let mut cmd = crate::runtime::quiet_command(&python);
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
            let _ = std::fs::remove_dir_all(&out_dir);
            let msg = stderr.trim();
            return Err(if msg.is_empty() {
                format!("pipeline produced no result (exit {:?})", out.status.code())
            } else {
                msg.to_string()
            });
        }
    };

    // Only keep sessions that actually produced cards; drop failed/refused runs.
    let ok = result.get("status").and_then(|s| s.as_str()) == Some("ok");
    if ok {
        let mut enriched = result;
        if let Some(obj) = enriched.as_object_mut() {
            obj.insert(
                "session_dir".into(),
                serde_json::Value::String(out_dir.to_string_lossy().into()),
            );
            obj.insert(
                "session_id".into(),
                serde_json::Value::String(
                    out_dir
                        .file_name()
                        .map(|n| n.to_string_lossy().into())
                        .unwrap_or_default(),
                ),
            );
        }
        Ok(enriched)
    } else {
        let _ = std::fs::remove_dir_all(&out_dir);
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
                    .map(|n| n.starts_with("formulation-card-v") && n.ends_with(".md"))
                    .unwrap_or(false)
            })
            .collect(),
        Err(_) => return Vec::new(),
    };
    files.sort();
    files
        .iter()
        .filter_map(|p| {
            let version = p
                .file_name()
                .and_then(|n| n.to_str())
                .and_then(|n| n.strip_prefix("formulation-card-"))
                .and_then(|n| n.strip_suffix(".md"))
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
    let sessions = data_dir(&app, &["sessions"])?;
    let mut items: Vec<serde_json::Value> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&sessions) {
        for entry in rd.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            // Session id is "<epoch>-<slug>": recover the timestamp for sorting.
            let created = id
                .split('-')
                .next()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(0);
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
        b.get("created")
            .and_then(|v| v.as_u64())
            .cmp(&a.get("created").and_then(|v| v.as_u64()))
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
    let dir = data_dir(&app, &["sessions"])?.join(&id);
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
    let dir = data_dir(&app, &["sessions"])?.join(&id);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
