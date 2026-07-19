// Chemical formulation cost optimizer command.
//
// Runs the portable PuLP linear-program core (runtime/formulation/
// formulation_core.py) on the SAME interpreter the notebook Run button uses
// (kernel::python_bin) so results match the rest of the workbench. The core
// script is embedded and materialized on first use, exactly like the kernel
// bridges, so it is always present regardless of packaging.
//
// PuLP (with its bundled CBC solver) is the only extra dependency. It ships in
// the scientific env's package set, but if the env predates that change — or a
// user points at a bare interpreter — the command installs `pulp<4` on demand
// via the bundled uv and retries once, streaming progress as `setup-progress`.
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;

use tauri::{AppHandle, Manager};

const CORE_SRC: &str = include_str!("../../../../runtime/formulation/formulation_core.py");

/// App-private dir the core script is materialized into.
fn formulation_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("runtime")
        .join("formulation");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn materialize_core(app: &AppHandle) -> Result<PathBuf, String> {
    let path = formulation_dir(app)?.join("formulation_core.py");
    std::fs::write(&path, CORE_SRC).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Run the core once, feeding `input_json` on stdin and returning parsed stdout.
/// `Ok(Err(stderr))` distinguishes a clean run whose JSON we parsed from a
/// process-level failure (non-zero exit / unparseable output) whose stderr we
/// surface — the caller uses that to decide whether to try installing pulp.
fn run_core(
    python: &str,
    script: &PathBuf,
    input_json: &str,
) -> Result<Result<serde_json::Value, String>, String> {
    let mut cmd = crate::workspace::quiet_command(python);
    cmd.arg(script)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("failed to launch Python: {e}"))?;
    child
        .stdin
        .take()
        .ok_or("no stdin on optimizer process")?
        .write_all(input_json.as_bytes())
        .map_err(|e| format!("failed to send input to optimizer: {e}"))?;

    let out = child
        .wait_with_output()
        .map_err(|e| format!("optimizer process error: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();

    match serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        Ok(v) => Ok(Ok(v)),
        Err(_) => Ok(Err(if stderr.is_empty() {
            format!("optimizer produced no result (exit {:?})", out.status.code())
        } else {
            stderr
        })),
    }
}

/// Does the parsed result signal a missing solver dependency (PuLP)? Shared
/// with `formulation_advanced.rs` — both scripts report the same message on
/// a missing `pulp` import.
pub(crate) fn is_missing_solver(value: &serde_json::Value) -> bool {
    value.get("status").and_then(|s| s.as_str()) == Some("error")
        && value
            .get("message")
            .and_then(|m| m.as_str())
            .map(|m| m.contains("solver dependency missing"))
            .unwrap_or(false)
}

/// Install `pulp<4` into the resolved interpreter via the bundled uv. Pinned
/// below 4.0 so the core's PULP_CBC_CMD / bundled CBC keep working. Shared
/// with `formulation_advanced.rs`.
pub(crate) async fn install_pulp(app: &AppHandle, python: &str) -> Result<(), String> {
    let args = vec![
        "pip".to_string(),
        "install".to_string(),
        "--python".to_string(),
        python.to_string(),
        "pulp<4".to_string(),
    ];
    crate::uv::run_uv(app, "formulation", args, "uv pip install pulp").await
}

/// Solve a formulation problem. `input` is the JSON payload the core expects
/// (`{materials, constraints}`); the resolved result JSON is returned as-is.
#[tauri::command(async)]
pub async fn run_formulation_optimize(
    app: AppHandle,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let script = materialize_core(&app)?;
    let (python, _source) = crate::kernel::python_bin(&app)?;
    let input_json = serde_json::to_string(&input).map_err(|e| e.to_string())?;

    // First attempt.
    match run_core(&python, &script, &input_json)? {
        Ok(value) if !is_missing_solver(&value) => return Ok(value),
        Ok(_missing) => {
            // PuLP absent — provision it, then retry once.
            install_pulp(&app, &python).await?;
        }
        Err(stderr) => {
            // A hard process failure: only worth a pulp install if that's the
            // cause, otherwise surface the error verbatim.
            if stderr.contains("No module named 'pulp'") || stderr.contains("pulp") {
                install_pulp(&app, &python).await?;
            } else {
                return Err(stderr);
            }
        }
    }

    match run_core(&python, &script, &input_json)? {
        Ok(value) => Ok(value),
        Err(stderr) => Err(stderr),
    }
}
