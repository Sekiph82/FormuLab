// Storage for formulations and their versions.
//
// Layout under the project root, beside sessions and the literature cache:
//
//   data/formulations/<formulationId>/formulation.json
//   data/formulations/<formulationId>/versions/<versionId>.json
//
// Versions are immutable: once written, a version file is never rewritten. A
// change produces a new version. That is what makes "which formula did we make
// batch 412 from?" answerable a year later, and it is why the save command
// refuses to overwrite.
use std::path::PathBuf;

use tauri::AppHandle;

fn formulations_root(app: &AppHandle) -> Result<PathBuf, String> {
    crate::formulation_v2::project_data_dir(app, "data").map(|d| d.join("formulations"))
}

/// Reject anything that could escape the formulations directory. Ids come from
/// the webview, so they are untrusted input.
pub(crate) fn safe_id(id: &str) -> Result<&str, String> {
    let ok = !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':' || c == '.')
        && !id.contains("..");
    if ok {
        Ok(id)
    } else {
        Err(format!("invalid id: {id:?}"))
    }
}

fn formulation_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(formulations_root(app)?.join(safe_id(id)?))
}

/// Statuses no automated writer may set. Mirrors `HUMAN_ONLY_STATUSES` in the
/// shared schemas: the rule is enforced again here so that a bug — or a script
/// calling the command directly — cannot write an approved formula that no
/// person signed off.
const HUMAN_ONLY_STATUSES: [&str; 2] = ["pilot_approved", "production_approved"];

#[tauri::command(async)]
pub async fn list_formulations(app: AppHandle) -> Result<serde_json::Value, String> {
    let root = formulations_root(&app)?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&root) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path().join("formulation.json");
            if let Ok(text) = std::fs::read_to_string(&path) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    items.push(v);
                }
            }
        }
    }
    // Newest first, by updatedAt when present.
    items.sort_by(|a, b| {
        b.get("updatedAt")
            .and_then(|v| v.as_str())
            .cmp(&a.get("updatedAt").and_then(|v| v.as_str()))
    });
    Ok(serde_json::Value::Array(items))
}

/// One formulation with every version, newest version first.
#[tauri::command(async)]
pub async fn read_formulation(app: AppHandle, id: String) -> Result<serde_json::Value, String> {
    let dir = formulation_dir(&app, &id)?;
    let text = std::fs::read_to_string(dir.join("formulation.json"))
        .map_err(|_| format!("formulation not found: {id}"))?;
    let formulation: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| e.to_string())?;

    let mut versions = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir.join("versions")) {
        for entry in entries.filter_map(|e| e.ok()) {
            if let Ok(t) = std::fs::read_to_string(entry.path()) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                    versions.push(v);
                }
            }
        }
    }
    versions.sort_by_key(|v| {
        std::cmp::Reverse(v.get("versionNumber").and_then(|n| n.as_i64()).unwrap_or(0))
    });

    Ok(serde_json::json!({ "formulation": formulation, "versions": versions }))
}

/// Create or update a formulation's metadata (name, target SKUs, current
/// version pointer). The versions themselves are written separately.
#[tauri::command(async)]
pub async fn save_formulation(
    app: AppHandle,
    formulation: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let id = formulation
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("formulation.id is required")?;
    let dir = formulation_dir(&app, id)?;
    std::fs::create_dir_all(dir.join("versions")).map_err(|e| e.to_string())?;
    std::fs::write(
        dir.join("formulation.json"),
        serde_json::to_string_pretty(&formulation).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(formulation)
}

/// Append an immutable version.
///
/// Refuses to overwrite an existing version file, and refuses to write an
/// approved status without an approval record to justify it.
#[tauri::command(async)]
pub async fn save_formulation_version(
    app: AppHandle,
    version: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let formulation_id = version
        .get("formulationId")
        .and_then(|v| v.as_str())
        .ok_or("version.formulationId is required")?;
    let version_id = version
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("version.id is required")?;

    let status = version.get("status").and_then(|v| v.as_str()).unwrap_or("concept");
    if HUMAN_ONLY_STATUSES.contains(&status) {
        let approvals = version
            .get("approvalRecordIds")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0);
        if approvals == 0 {
            return Err(format!(
                "\"{status}\" is an approval and needs a signed approval record. \
                 A generated formulation is a candidate, not an approved product."
            ));
        }
    }

    let dir = formulation_dir(&app, formulation_id)?.join("versions");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", safe_id(version_id)?));
    if path.exists() {
        return Err(format!(
            "version {version_id} already exists; versions are immutable — save a new version instead"
        ));
    }
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&version).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(version)
}

// ------------------------------------------------------------------ drafts ---

/// The mutable working copy, one per formulation.
///
/// Autosave writes here. It is deliberately a single file that gets overwritten:
/// a morning of editing should leave one draft, not four hundred versions
/// nobody can navigate.
#[tauri::command(async)]
pub async fn read_formulation_draft(
    app: AppHandle,
    formulation_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let path = formulation_dir(&app, &formulation_id)?.join("draft.json");
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map(Some).map_err(|e| e.to_string()),
        Err(_) => Ok(None),
    }
}

#[tauri::command(async)]
pub async fn save_formulation_draft(
    app: AppHandle,
    draft: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let id = draft
        .get("formulationId")
        .and_then(|v| v.as_str())
        .ok_or("draft.formulationId is required")?;
    let dir = formulation_dir(&app, id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Write-then-rename: a crash mid-write must not leave a truncated draft
    // where a chemist's unsaved work used to be.
    let tmp = dir.join("draft.json.tmp");
    std::fs::write(
        &tmp,
        serde_json::to_string_pretty(&draft).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join("draft.json")).map_err(|e| e.to_string())?;
    Ok(draft)
}

#[tauri::command(async)]
pub async fn discard_formulation_draft(
    app: AppHandle,
    formulation_id: String,
) -> Result<(), String> {
    let path = formulation_dir(&app, &formulation_id)?.join("draft.json");
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ------------------------------------------------------- approvals + audit ---

/// Record a human signing off a version.
///
/// Refuses an approval attributed to anything that is not a person. The webview
/// is untrusted input, so the check that "ai" cannot appear here is repeated
/// even though the TypeScript layer already refuses it.
#[tauri::command(async)]
pub async fn save_approval_record(
    app: AppHandle,
    record: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let formulation_id = record
        .get("formulationId")
        .and_then(|v| v.as_str())
        .ok_or("record.formulationId is required")?;
    let record_id = record
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("record.id is required")?;
    let approver = record
        .get("approvedBy")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();

    if approver.is_empty() {
        return Err("an approval must name the person who signed it".into());
    }
    const NOT_PEOPLE: [&str; 6] = ["ai", "system", "agent", "model", "automation", "import"];
    if NOT_PEOPLE.contains(&approver.as_str()) {
        return Err(format!(
            "\"{approver}\" is not a person. An approval is someone accepting responsibility \
             for the formula, so it must be attributed to a named human."
        ));
    }
    if record
        .get("justification")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().is_empty())
        .unwrap_or(true)
    {
        return Err("an approval must state why the formula was considered fit".into());
    }

    let dir = formulation_dir(&app, formulation_id)?.join("approvals");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", safe_id(record_id)?));
    if path.exists() {
        return Err(format!("approval {record_id} already exists"));
    }
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&record).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(record)
}

#[tauri::command(async)]
pub async fn list_approval_records(
    app: AppHandle,
    formulation_id: String,
) -> Result<serde_json::Value, String> {
    let dir = formulation_dir(&app, &formulation_id)?.join("approvals");
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            if let Ok(t) = std::fs::read_to_string(entry.path()) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                    out.push(v);
                }
            }
        }
    }
    Ok(serde_json::Value::Array(out))
}

/// Append one line to the formulation's audit log. Append-only by construction.
#[tauri::command(async)]
pub async fn append_audit_event(
    app: AppHandle,
    event: serde_json::Value,
) -> Result<(), String> {
    use std::io::Write;
    let formulation_id = event
        .get("formulationId")
        .and_then(|v| v.as_str())
        .ok_or("event.formulationId is required")?;
    let dir = formulation_dir(&app, formulation_id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("audit.jsonl"))
        .map_err(|e| e.to_string())?;
    writeln!(
        file,
        "{}",
        serde_json::to_string(&event).map_err(|e| e.to_string())?
    )
    .map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub async fn read_audit_log(
    app: AppHandle,
    formulation_id: String,
) -> Result<serde_json::Value, String> {
    let path = formulation_dir(&app, &formulation_id)?.join("audit.jsonl");
    let mut out = Vec::new();
    if let Ok(text) = std::fs::read_to_string(&path) {
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                out.push(v);
            }
        }
    }
    Ok(serde_json::Value::Array(out))
}

/// Remove a formulation and all its versions. Destructive; the UI confirms first.
#[tauri::command(async)]
pub async fn delete_formulation(app: AppHandle, id: String) -> Result<(), String> {
    let dir = formulation_dir(&app, &id)?;
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}
