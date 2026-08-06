// Advanced Formulation Constraint Optimizer command.
//
// Runs the mixed-integer solver core (runtime/formulation/
// advanced_optimizer.py) on the same interpreter the notebook Run button and
// the simple optimizer (formulation.rs) use, materialized the same way. This
// is a SEPARATE command and script from the simple optimizer — neither its
// input/output shape nor its behavior changes. PuLP provisioning reuses
// formulation.rs's `is_missing_solver`/`install_pulp` — same dependency,
// same install path.
//
// Real cancellation: unlike the simple optimizer, a run here can take
// meaningfully long (a mixed-integer solve), so the spawned child is kept in
// `AdvancedOptimizerState` for the duration of the solve. `cancel_advanced_
// formulation_optimize` kills whatever child is currently stored — CBC
// itself is not asked to checkpoint a partial result, this just ends the
// process, which `run_advanced_formulation_optimize` then reports as a
// `"cancelled"` status rather than propagating the resulting I/O error.
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Manager, State};

const CORE_SRC: &str = include_str!("../../../../runtime/formulation/advanced_optimizer.py");

/// Holds the currently-running solve's child process, if any. One run at a
/// time — starting a new one implicitly cancels a still-running previous one,
/// matching the UI's single Advanced Optimizer workspace per project.
#[derive(Default)]
pub struct AdvancedOptimizerState(pub Mutex<Option<Child>>);

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
    let path = formulation_dir(app)?.join("advanced_optimizer.py");
    std::fs::write(&path, CORE_SRC).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Kill and reap whatever child is currently stored, if any — called before
/// starting a new run and by the explicit cancel command. Best-effort: a
/// kill on an already-exited process is not an error.
fn kill_current(state: &AdvancedOptimizerState) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command(async)]
pub async fn cancel_advanced_formulation_optimize(
    state: State<'_, AdvancedOptimizerState>,
) -> Result<bool, String> {
    let was_running = state.0.lock().map(|g| g.is_some()).unwrap_or(false);
    kill_current(&state);
    Ok(was_running)
}

/// One spawn-write-wait-read cycle. `Ok(Ok(value))` is a clean run whose
/// stdout parsed as JSON; `Ok(Err(_))` distinguishes "cancelled mid-flight"
/// (no output, not necessarily an error) from a genuine process failure,
/// whose stderr is returned for the caller to inspect for a missing-solver
/// message. `Ok(None)` specifically means "the run was cancelled" (the
/// child was taken out of `state` by `cancel_advanced_formulation_optimize`
/// before `wait()` ran).
enum RunOutcome {
    Value(serde_json::Value),
    Cancelled,
    ProcessError(String),
}

fn run_once(
    python: &str,
    script: &PathBuf,
    input_json: &str,
    state: &AdvancedOptimizerState,
) -> Result<RunOutcome, String> {
    let mut cmd = crate::workspace::quiet_command(python);
    cmd.arg(script)
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
        .ok_or("no stdin on optimizer process")?
        .write_all(input_json.as_bytes())
        .map_err(|e| format!("failed to send input to optimizer: {e}"))?;

    // Taken before the child is stored, so wait() below (which needs &mut
    // self, not ownership) can still run while a separate command holds the
    // same child for a possible kill().
    let mut stdout_pipe = child
        .stdout
        .take()
        .ok_or("no stdout on optimizer process")?;
    let mut stderr_pipe = child
        .stderr
        .take()
        .ok_or("no stderr on optimizer process")?;
    let stdout_reader = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buf);
        buf
    });
    let stderr_reader = thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr_pipe.read_to_string(&mut buf);
        buf
    });

    *state
        .0
        .lock()
        .map_err(|_| "optimizer state lock poisoned".to_string())? = Some(child);

    let status = {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "optimizer state lock poisoned".to_string())?;
        match guard.as_mut() {
            Some(child) => child
                .wait()
                .map_err(|e| format!("optimizer process error: {e}"))?,
            None => return Ok(RunOutcome::Cancelled),
        }
    };
    // Clear the slot now that the process has exited, successfully or not.
    if let Ok(mut guard) = state.0.lock() {
        *guard = None;
    }

    let stdout_bytes = stdout_reader.join().unwrap_or_default();
    let stderr_text = stderr_reader.join().unwrap_or_default();
    let stdout = String::from_utf8_lossy(&stdout_bytes);

    if !status.success() && stdout.trim().is_empty() {
        // A killed process exits non-zero with no JSON on stdout — but it
        // could also be a genuine crash before any output; either way there
        // is nothing to parse, so report cancelled only if the state slot
        // truly was cleared by a cancel (checked above) — reaching here with
        // a non-zero, output-less exit and a status we still hold means a
        // real process failure, not a cancel.
        let stderr_trimmed = stderr_text.trim();
        return Ok(RunOutcome::ProcessError(if stderr_trimmed.is_empty() {
            format!("optimizer produced no result (exit {:?})", status.code())
        } else {
            stderr_trimmed.to_string()
        }));
    }

    match serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        Ok(value) => Ok(RunOutcome::Value(value)),
        Err(_) => {
            let stderr_trimmed = stderr_text.trim();
            Ok(RunOutcome::ProcessError(if stderr_trimmed.is_empty() {
                format!(
                    "optimizer produced unparseable output (exit {:?})",
                    status.code()
                )
            } else {
                stderr_trimmed.to_string()
            }))
        }
    }
}

#[tauri::command(async)]
pub async fn run_advanced_formulation_optimize(
    app: AppHandle,
    state: State<'_, AdvancedOptimizerState>,
    input: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let script = materialize_core(&app)?;
    let (python, _source) = crate::kernel::python_bin(&app)?;
    let input_json = serde_json::to_string(&input).map_err(|e| e.to_string())?;

    // A fresh run supersedes any still-running previous one.
    kill_current(&state);

    match run_once(&python, &script, &input_json, &state)? {
        RunOutcome::Cancelled => return Ok(serde_json::json!({ "status": "cancelled" })),
        RunOutcome::Value(value) if !crate::formulation::is_missing_solver(&value) => {
            return Ok(value)
        }
        RunOutcome::Value(_missing) => {
            crate::formulation::install_pulp(&app, &python).await?;
        }
        RunOutcome::ProcessError(stderr) => {
            if stderr.contains("No module named 'pulp'") || stderr.contains("pulp") {
                crate::formulation::install_pulp(&app, &python).await?;
            } else {
                return Err(stderr);
            }
        }
    }

    match run_once(&python, &script, &input_json, &state)? {
        RunOutcome::Value(value) => Ok(value),
        RunOutcome::Cancelled => Ok(serde_json::json!({ "status": "cancelled" })),
        RunOutcome::ProcessError(stderr) => Err(stderr),
    }
}
