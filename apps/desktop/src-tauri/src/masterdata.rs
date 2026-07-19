// Master data: raw materials, suppliers, prices, inventory, packaging,
// exchange rates, factory cost profiles and cost snapshots.
//
// Layout under the project root, beside sessions, literature and formulations:
//
//   data/master/materials.json
//   data/master/suppliers.json
//   data/master/material_prices.json
//   data/master/inventory.json
//   data/master/packaging_components.json
//   data/master/packaging_boms.json
//   data/master/exchange_rates.json
//   data/master/factory_profiles.json
//   data/master/cost_snapshots.json
//   data/master/backups/<collection>-<timestamp>.json
//
// One JSON array per collection rather than a database: the whole point of
// keeping FormuLab's data in the project folder is that a chemist can open it,
// read it, copy it to a colleague and back it up with the rest of the project.
// A binary database would take that away for no benefit at this data volume.
//
// Two invariants the commands enforce:
//
//   * Identity is the stable `code`, so re-importing the same spreadsheet
//     updates rows instead of creating a second copy of the factory's inventory.
//   * Append-only collections (prices, cost snapshots) are never rewritten. A
//     price change must not silently rewrite what a formula cost last March.
use std::path::PathBuf;

use tauri::AppHandle;

/// Collections the UI may address, and whether history is preserved.
///
/// An explicit allow-list rather than a free-text filename: the collection name
/// arrives from the webview, and joining untrusted text onto a path is how a
/// renderer bug becomes an arbitrary file write.
const COLLECTIONS: [(&str, bool); 16] = [
    // (name, append_only)
    ("materials", false),
    ("suppliers", false),
    ("material_prices", true),
    ("inventory", false),
    ("packaging_components", false),
    ("packaging_boms", false),
    ("exchange_rates", true),
    ("factory_profiles", false),
    ("cost_snapshots", true),
    ("material_suppliers", false),
    // Compatibility engine: rules are editable; a snapshot, once calculated
    // against a formula version, is never rewritten.
    ("compatibility_rules", false),
    ("compatibility_snapshots", true),
    // Safety engine: rules and hazard records are editable; a snapshot and a
    // human's resolution of a finding are both append-only audit records.
    ("safety_rules", false),
    ("safety_snapshots", true),
    ("safety_resolutions", true),
    ("material_hazard_records", false),
];

fn collection_spec(name: &str) -> Result<(&'static str, bool), String> {
    COLLECTIONS
        .iter()
        .find(|(n, _)| *n == name)
        .copied()
        .ok_or_else(|| format!("unknown collection: {name:?}"))
}

fn master_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::formulation_v2::project_data_dir(app, "data")?.join("master");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn collection_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let (safe, _) = collection_spec(name)?;
    Ok(master_dir(app)?.join(format!("{safe}.json")))
}

fn read_array(path: &PathBuf) -> Vec<serde_json::Value> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str::<Vec<serde_json::Value>>(&t).ok())
        .unwrap_or_default()
}

/// Write-then-rename, so an interrupted write cannot truncate the file that
/// holds the factory's entire material library.
fn write_array(path: &PathBuf, rows: &[serde_json::Value]) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(
        &tmp,
        serde_json::to_string_pretty(rows).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn row_key(row: &serde_json::Value) -> Option<String> {
    for field in ["code", "id"] {
        if let Some(v) = row.get(field).and_then(|v| v.as_str()) {
            if !v.trim().is_empty() {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

#[tauri::command(async)]
pub async fn list_master_records(
    app: AppHandle,
    collection: String,
) -> Result<serde_json::Value, String> {
    let path = collection_path(&app, &collection)?;
    Ok(serde_json::Value::Array(read_array(&path)))
}

/// Insert or update rows by their stable code.
///
/// Idempotent: importing the same file twice leaves the same data, which is the
/// difference between a re-runnable import and a duplicated material library.
#[tauri::command(async)]
pub async fn upsert_master_records(
    app: AppHandle,
    collection: String,
    records: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let (name, append_only) = collection_spec(&collection)?;
    let path = collection_path(&app, name)?;
    let mut rows = read_array(&path);

    let mut inserted = 0usize;
    let mut updated = 0usize;

    for record in records {
        let key = row_key(&record)
            .ok_or_else(|| format!("a {name} record has no `code` or `id`"))?;

        if append_only {
            // History is the point of these collections. A new price is a new
            // row; the old one stays exactly as it was recorded.
            if rows.iter().any(|r| row_key(r).as_deref() == Some(key.as_str())) {
                return Err(format!(
                    "{name} record {key} already exists. This collection is append-only \
                     so that historical records cannot be rewritten — add a new record instead."
                ));
            }
            rows.push(record);
            inserted += 1;
            continue;
        }

        match rows
            .iter()
            .position(|r| row_key(r).as_deref() == Some(key.as_str()))
        {
            Some(i) => {
                rows[i] = record;
                updated += 1;
            }
            None => {
                rows.push(record);
                inserted += 1;
            }
        }
    }

    write_array(&path, &rows)?;
    Ok(serde_json::json!({
        "inserted": inserted,
        "updated": updated,
        "total": rows.len(),
    }))
}

/// Remove a row by code. Refused on append-only collections.
///
/// Materials are deactivated rather than deleted in the UI; this command exists
/// for genuinely mistaken rows, and it snapshots the file first.
#[tauri::command(async)]
pub async fn delete_master_record(
    app: AppHandle,
    collection: String,
    code: String,
) -> Result<serde_json::Value, String> {
    let (name, append_only) = collection_spec(&collection)?;
    if append_only {
        return Err(format!(
            "{name} is append-only: deleting a historical record would change what a \
             past cost snapshot was based on. Supersede it with a new record instead."
        ));
    }
    let path = collection_path(&app, name)?;
    let mut rows = read_array(&path);
    backup_collection(&app, name)?;
    let before = rows.len();
    rows.retain(|r| row_key(r).as_deref() != Some(code.as_str()));
    write_array(&path, &rows)?;
    Ok(serde_json::json!({ "removed": before - rows.len() }))
}

/// Copy a collection aside before a destructive change.
#[tauri::command(async)]
pub async fn backup_master_collection(
    app: AppHandle,
    collection: String,
) -> Result<String, String> {
    let (name, _) = collection_spec(&collection)?;
    backup_collection(&app, name)
}

fn backup_collection(app: &AppHandle, name: &str) -> Result<String, String> {
    let src = collection_path(app, name)?;
    if !src.exists() {
        return Ok(String::new());
    }
    let dir = master_dir(app)?.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dest = dir.join(format!("{name}-{stamp}.json"));
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}
