// The customer's raw materials, and costing a formula against them.
//
// Same shape as formulation_v2: the work is done by the embedded Python, which
// is materialized on first use and driven over stdin/stdout. Costing is
// arithmetic on the customer's own prices — no model is involved, so the number
// on the sheet can be checked by hand.
use std::io::Write;
use std::path::PathBuf;
use std::process::Stdio;

use tauri::AppHandle;

const F_MATERIALS: &str = include_str!("../../../../runtime/pipeline/materials.py");
const F_MATERIALS_CLI: &str = include_str!("../../../../runtime/pipeline/materials_cli.py");

/// Write the materials scripts next to the pipeline package they import from.
fn materialize(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::formulation_v2::pipeline_dir(app)?;
    std::fs::write(dir.join("materials.py"), F_MATERIALS).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("materials_cli.py"), F_MATERIALS_CLI).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Run the materials bridge with `request` on stdin and parse its JSON reply.
fn run(app: &AppHandle, mut request: serde_json::Value) -> Result<serde_json::Value, String> {
    let dir = materialize(app)?;
    let (python, _source) = crate::kernel::python_bin(app)?;

    // Materials live beside the sessions and the literature cache.
    let data_dir = crate::formulation_v2::project_data_dir(app, "data")?;
    if let Some(obj) = request.as_object_mut() {
        obj.insert(
            "data_dir".into(),
            serde_json::Value::String(data_dir.to_string_lossy().into()),
        );
    }

    let mut cmd = crate::workspace::quiet_command(&python);
    cmd.arg(dir.join("materials_cli.py"))
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
        .ok_or("no stdin on materials process")?
        .write_all(request.to_string().as_bytes())
        .map_err(|e| format!("failed to send request: {e}"))?;

    let out = child
        .wait_with_output()
        .map_err(|e| format!("materials process error: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    serde_json::from_str(stdout.trim()).map_err(|_| {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if err.is_empty() {
            format!("materials step produced no result (exit {:?})", out.status.code())
        } else {
            err
        }
    })
}

/// Import a raw-material list (CSV/TSV) the user picked. Replaces the stored
/// list: it is the customer's current price file, not an append-only log.
#[tauri::command(async)]
pub async fn import_materials(app: AppHandle, path: String) -> Result<serde_json::Value, String> {
    run(&app, serde_json::json!({ "action": "import", "path": path }))
}

/// The stored material list (empty until the user imports one).
#[tauri::command(async)]
pub async fn list_materials(app: AppHandle) -> Result<serde_json::Value, String> {
    run(&app, serde_json::json!({ "action": "list" }))
}

/// Cost one formula against the stored materials at a given batch size.
#[tauri::command(async)]
pub async fn cost_formulation(
    app: AppHandle,
    formula: serde_json::Value,
    batch_kg: f64,
) -> Result<serde_json::Value, String> {
    run(&app, serde_json::json!({
        "action": "cost", "formula": formula, "batch_kg": batch_kg,
    }))
}
