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
//   data/master/optimization_profiles.json
//   data/master/optimization_runs.json
//   data/master/optimization_scenarios.json
//   data/master/substitution_runs.json
//   data/master/laboratory_trials.json
//   data/master/test_definitions.json
//   data/master/test_results.json
//   data/master/trial_comparisons.json
//   data/master/trial_deviations.json
//   data/master/corrective_actions.json
//   data/master/stability_studies.json
//   data/master/stability_samples.json
//   data/master/stability_results.json
//   data/master/stability_failures.json
//   data/master/approval_policies.json
//   data/master/regulatory_rules.json
//   data/master/regulatory_rule_revisions.json
//   data/master/regulatory_reviews.json
//   data/master/regulatory_review_revocations.json
//   data/master/regulatory_evidence_confirmations.json
//   data/master/regulatory_evidence_confirmation_revocations.json
//   data/master/regulatory_review_equivalences.json
//   data/master/regulatory_dossiers.json
//   data/master/regulatory_dossier_requirements.json
//   data/master/regulatory_evidence_items.json
//   data/master/regulatory_requirement_evidence_links.json
//   data/master/regulatory_dossier_reviews.json
//   data/master/regulatory_dossier_review_revocations.json
//   data/master/regulatory_dossier_submissions.json
//   data/master/regulatory_dossier_manual_requirement_actions.json
//   data/master/backups/<collection>-<timestamp>.json
//
// `approval_records` and `approval_audit_events` are deliberately NOT master
// collections here: an `ApprovalRecord` already has its own dedicated,
// per-formulation storage and commands (`save_approval_record`/
// `list_approval_records` in formulations.rs, under
// `data/formulations/<id>/approvals/`), and an approval audit event is just
// another line in that same formulation's existing append-only
// `audit.jsonl` — adding either as a second, generic collection here would
// create a competing storage path for the same facts. `attachment_references`
// is likewise not a collection: an attachment is embedded directly on the
// trial observation / deviation / process step / test result / stability
// result / stability failure / corrective action it belongs to, the same
// way it always has been (see docs/ATTACHMENTS.md).
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
const COLLECTIONS: [(&str, bool); 48] = [
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
    // Advanced Optimizer: profiles are editable structural defaults; a run
    // (the exact problem sent to the solver + the result it returned) and a
    // named scenario are both immutable once written — re-solving creates a
    // new run, never edits one in place.
    ("optimization_profiles", false),
    ("optimization_runs", true),
    ("optimization_scenarios", true),
    // Substitution engine: a run (the request + its scored candidates, and
    // which one was applied) is immutable for the same reason.
    ("substitution_runs", true),
    // Laboratory Trials: a trial, its deviations and its corrective actions
    // evolve through their own status lifecycle (planned -> ... -> archived,
    // open -> resolved, ...), so they are editable master data like
    // `materials`/`inventory` — the application layer (engine/laboratory.ts)
    // refuses further edits to a trial's execution data once it reaches a
    // terminal status, rather than the storage layer forcing a new record
    // per status change. A test RESULT is different: recording one is an
    // event, and editing a recorded measurement must never silently
    // overwrite what was actually observed, so results and comparisons are
    // append-only, the same as a cost or compatibility snapshot.
    ("laboratory_trials", false),
    ("test_definitions", false),
    ("test_results", true),
    ("trial_comparisons", true),
    ("trial_deviations", false),
    ("corrective_actions", false),
    // Stability Studies: same split — the study/sample/failure records
    // themselves evolve through a status lifecycle, but a recorded result
    // is append-only for the same reason a test result is.
    ("stability_studies", false),
    ("stability_samples", false),
    ("stability_results", true),
    ("stability_failures", false),
    // Approval policies: a durable, per-organization configuration record —
    // mutable like `materials`, not append-only. Each edit is still visible
    // in the formulation's own audit log via an `approval.policy_changed`
    // event, which is what gives a policy change its own history, not the
    // storage layer.
    ("approval_policies", false),
    // Append-only history behind the mutable `approval_policies` row above
    // — every edit/activate/deactivate/retire/clone/restore appends here
    // rather than overwriting what a policy used to say (spec: "never
    // silently overwrite historical policy revisions").
    ("approval_policy_revisions", true),
    // A declared equivalence between two formula versions for laboratory/
    // stability evidence reuse. Append-only: revoking one never deletes or
    // rewrites the original declaration — it appends a second record whose
    // `revokesEquivalenceId` points at the one being revoked. "Current"
    // status is derived by checking whether any revocation record exists
    // for a given equivalence id, the same overlay pattern
    // `engine/lifecycle.ts`'s `effectiveStatus` already uses for audit
    // events.
    ("formula_version_equivalences", true),
    // Regulatory Engine (Kenya/EAC): a rule is durable, editable structural
    // data like a test definition or safety rule — its own edit/activate/
    // deactivate/deprecate lifecycle is what changes it, and every one of
    // those changes appends to `regulatory_rule_revisions` rather than
    // overwriting what the rule used to require, same split as
    // `approval_policies`/`approval_policy_revisions`. A recorded human
    // regulatory review is an append-only sign-off event — editing one in
    // place would silently rewrite who reviewed what and when.
    ("regulatory_rules", false),
    ("regulatory_rule_revisions", true),
    ("regulatory_reviews", true),
    // Phase 2 closure: a review revocation is its own append-only record
    // pointing at the review it revokes — the review itself is never
    // edited or deleted (spec: "historical reviews are append-only and
    // immutable"). Evidence confirmations are the persisted replacement
    // for what used to be session-local UI checkboxes: also append-only,
    // also revoked only via a separate pointer record. A regulatory
    // review equivalence (reuse across formula versions) follows the
    // exact same declare/revoke-by-new-record shape as
    // `formula_version_equivalences`.
    ("regulatory_review_revocations", true),
    ("regulatory_evidence_confirmations", true),
    ("regulatory_evidence_confirmation_revocations", true),
    ("regulatory_review_equivalences", true),
    // Phase 3 — Regulatory Dossier and Evidence Matrix. A dossier is a
    // mutable header row, same as `approval_policies`/`regulatory_rules` —
    // its own status/revision lifecycle is what changes it, never a
    // silent overwrite of a submitted/superseded/archived one (the
    // application layer refuses that transition, see
    // `engine/regulatoryDossier.ts`'s `isDossierImmutable`). Requirements
    // are frozen per dossier revision and append-only: a manual exclusion
    // appends a new row rather than editing the original. Evidence items
    // are mutable like a rule (verify/reject/revoke change the same row
    // in place), but a real file *replacement* creates a brand-new row
    // linked via `supersedesEvidenceId` — deliberately no separate
    // "evidence revisions" collection, since that chain already gives the
    // same history a dedicated revisions table would. Requirement-
    // evidence links are append-only, same overlay-computed-active
    // pattern as `regulatory_evidence_confirmations`. Reviews and their
    // revocations mirror `regulatory_reviews`/`regulatory_review_revocations`
    // exactly. Submissions are a mutable internal tracking log only —
    // never a real integration with a government/authority portal; its
    // history lives in the audit log, not a second append-only table.
    // Manual requirement add/exclude actions are append-only and always
    // carry a justification.
    ("regulatory_dossiers", false),
    ("regulatory_dossier_requirements", true),
    ("regulatory_evidence_items", false),
    ("regulatory_requirement_evidence_links", true),
    ("regulatory_dossier_reviews", true),
    ("regulatory_dossier_review_revocations", true),
    ("regulatory_dossier_submissions", false),
    ("regulatory_dossier_manual_requirement_actions", true),
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
