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

use crate::authz;
use crate::role_policy;

/// `formulation`'s `create`/`edit` capabilities are always granted together
/// in the approved matrix (architecture doc §9.3) — a single write command
/// (save/save-version/save-draft) checks either, matching
/// `masterdata.rs`'s `WRITE_CAPABILITIES` pattern for the same reason.
const FORMULATION_WRITE_CAPABILITIES: [&str; 2] = ["create", "edit"];

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

pub(crate) fn formulation_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(formulations_root(app)?.join(safe_id(id)?))
}

/// Statuses no automated writer may set. Mirrors `HUMAN_ONLY_STATUSES` in the
/// shared schemas: the rule is enforced again here so that a bug — or a script
/// calling the command directly — cannot write an approved formula that no
/// person signed off.
const HUMAN_ONLY_STATUSES: [&str; 2] = ["pilot_approved", "production_approved"];

#[tauri::command(async)]
pub async fn list_formulations(app: AppHandle, token: String) -> Result<serde_json::Value, String> {
    authz::current_actor_app(&app, &token)?;
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
pub async fn read_formulation(app: AppHandle, token: String, id: String) -> Result<serde_json::Value, String> {
    authz::current_actor_app(&app, &token)?;
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
    token: String,
    formulation: serde_json::Value,
) -> Result<serde_json::Value, String> {
    authz::authorize_any_app(&app, &token, "formulation", &FORMULATION_WRITE_CAPABILITIES)?;
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
    token: String,
    version: serde_json::Value,
) -> Result<serde_json::Value, String> {
    authz::authorize_any_app(&app, &token, "formulation", &FORMULATION_WRITE_CAPABILITIES)?;
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
    token: String,
    formulation_id: String,
) -> Result<Option<serde_json::Value>, String> {
    authz::current_actor_app(&app, &token)?;
    let path = formulation_dir(&app, &formulation_id)?.join("draft.json");
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map(Some).map_err(|e| e.to_string()),
        Err(_) => Ok(None),
    }
}

#[tauri::command(async)]
pub async fn save_formulation_draft(
    app: AppHandle,
    token: String,
    draft: serde_json::Value,
) -> Result<serde_json::Value, String> {
    authz::authorize_any_app(&app, &token, "formulation", &FORMULATION_WRITE_CAPABILITIES)?;
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
    token: String,
    formulation_id: String,
) -> Result<(), String> {
    authz::authorize_any_app(&app, &token, "formulation", &FORMULATION_WRITE_CAPABILITIES)?;
    let path = formulation_dir(&app, &formulation_id)?.join("draft.json");
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ------------------------------------------------------- approvals + audit ---

/// Which policy area gates approve/reject on a given target status. Only
/// the two `HUMAN_ONLY_STATUSES` gates exist today — anything else is not
/// an approval action at all and is refused before authorization is even
/// attempted.
fn approval_area_for(target_status: &str) -> Option<&'static str> {
    match target_status {
        "pilot_approved" => Some("approvalPilot"),
        "production_approved" => Some("approvalProduction"),
        _ => None,
    }
}

/// `approve` for a granted approval, `reject` for anything else (rejected
/// or blocked) — both decision shapes record a denial-of-the-requested-
/// status, and the approved matrix grants both capabilities to the same
/// role set for a given area (`role_policy.rs`'s
/// `approval_pilot_approve_matches_the_known_manager_tier_plus_administrator`
/// test documents this), so distinguishing them doesn't change who is
/// authorized — it keeps the recorded capability semantically honest.
fn approval_capability_for(decision: &str) -> &'static str {
    if decision == "approved" {
        "approve"
    } else {
        "reject"
    }
}

/// The pure, AppHandle-free half of `save_approval_record`: validates the
/// attempted transition (only for a granted approval — a rejection/block
/// doesn't move any state) and overwrites the record's identity fields with
/// the trusted actor's, discarding whatever the caller sent for them.
/// Split out so both halves — "is this transition even valid" and "does the
/// trusted actor's identity end up in the record, not the caller's claim" —
/// are directly unit-testable without a Tauri test harness.
fn finalize_approval_record(
    record: serde_json::Value,
    decision: &str,
    previous_status: &str,
    requested_status: &str,
    actor: &authz::TrustedActor,
) -> Result<serde_json::Value, String> {
    if decision == "approved" && !role_policy::is_valid_transition(previous_status, requested_status) {
        return Err(format!("{previous_status} cannot move directly to {requested_status}."));
    }
    if record
        .get("justification")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().is_empty())
        .unwrap_or(true)
    {
        return Err("an approval must state why the formula was considered fit".into());
    }

    let mut record = record;
    if let Some(obj) = record.as_object_mut() {
        obj.insert("approvedBy".into(), serde_json::Value::String(actor.display_name.clone()));
        obj.insert("approvedByRole".into(), serde_json::Value::String(actor.role.clone()));
        obj.insert("reviewerUserId".into(), serde_json::Value::String(actor.user_id.clone()));
        obj.insert("reviewerRole".into(), serde_json::Value::String(actor.role.clone()));
    }
    Ok(record)
}

/// Record a human signing off a version.
///
/// Phase 13 Session 4 (architecture doc §9.3): closes the Session 0/2
/// bypass this command previously had — a direct `invoke("save_approval_record",
/// {...})` could write a permanent, valid-looking approval record with any
/// name and no role check at all, bypassing `canTransitionTo`'s role gate
/// entirely since only the *frontend* called it. Now:
///
///   1. The actor's role/userId/displayName are resolved from the
///      *authenticated session* (`authz::authorize_app`), never trusted
///      from `record.approvedBy`/`approvedByRole`/`reviewerUserId`/
///      `reviewerRole` — those fields are overwritten with the trusted
///      identity below, whatever the caller sent.
///   2. The capability required is `approve` for an "approved" decision,
///      `reject` for anything else (rejected/blocked) — both derived from
///      `requestedStatus` via `approval_area_for`, refusing outright if
///      `requestedStatus` isn't one of the two real approval gates.
///   3. For an "approved" decision, `previousStatus -> requestedStatus`
///      must be a real edge in the shared `ALLOWED_NEXT` graph
///      (`role_policy::is_valid_transition`) — a manager with `approve`
///      capability still cannot approve an invalid transition (e.g.
///      `concept` straight to `pilot_approved`).
///
/// Non-identity validation (justification required) is unchanged.
#[tauri::command(async)]
pub async fn save_approval_record(
    app: AppHandle,
    token: String,
    record: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let formulation_id = record
        .get("formulationId")
        .and_then(|v| v.as_str())
        .ok_or("record.formulationId is required")?
        .to_string();
    let record_id = record
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("record.id is required")?
        .to_string();
    let requested_status = record
        .get("requestedStatus")
        .and_then(|v| v.as_str())
        .ok_or("record.requestedStatus is required")?
        .to_string();
    let previous_status = record
        .get("previousStatus")
        .and_then(|v| v.as_str())
        .ok_or("record.previousStatus is required")?
        .to_string();
    let decision = record
        .get("decision")
        .and_then(|v| v.as_str())
        .ok_or("record.decision is required")?
        .to_string();

    let area = approval_area_for(&requested_status)
        .ok_or_else(|| format!("\"{requested_status}\" is not a recognized approval gate"))?;
    let capability = approval_capability_for(&decision);
    let actor = authz::authorize_app(&app, &token, area, capability)?;
    let record = finalize_approval_record(record, &decision, &previous_status, &requested_status, &actor)?;

    let dir = formulation_dir(&app, &formulation_id)?.join("approvals");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", safe_id(&record_id)?));
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
    token: String,
    formulation_id: String,
) -> Result<serde_json::Value, String> {
    authz::current_actor_app(&app, &token)?;
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
///
/// Phase 13 Session 4 (architecture doc §9.3): closes audit-actor spoofing.
/// `event.actor` previously came straight from the webview — a caller could
/// misattribute an action to a name that isn't who actually performed it.
/// Requires a valid session (`authz::current_actor_app`) and, when
/// `event.actorKind` is absent or `"human"` (the common case — a real
/// person took this action), overwrites `event.actor` with the trusted
/// session's display name. An explicit non-human `actorKind`
/// (`"agent"`/`"system"`/`"import"`, all already-non-identity-authoritative
/// per `status.ts`'s `Actor` union) is left as the caller set it — those
/// values were never claiming to be a specific person in the first place,
/// so there's nothing to spoof-close there.
#[tauri::command(async)]
pub async fn append_audit_event(
    app: AppHandle,
    token: String,
    event: serde_json::Value,
) -> Result<(), String> {
    use std::io::Write;
    let actor = authz::current_actor_app(&app, &token)?;
    let mut event = event;
    let is_human_or_unspecified = event
        .get("actorKind")
        .and_then(|v| v.as_str())
        .map(|k| k == "human")
        .unwrap_or(true);
    if is_human_or_unspecified {
        if let Some(obj) = event.as_object_mut() {
            obj.insert("actor".into(), serde_json::Value::String(actor.display_name.clone()));
        }
    }
    let formulation_id = event
        .get("formulationId")
        .and_then(|v| v.as_str())
        .ok_or("event.formulationId is required")?
        .to_string();
    let dir = formulation_dir(&app, &formulation_id)?;
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
    token: String,
    formulation_id: String,
) -> Result<serde_json::Value, String> {
    authz::current_actor_app(&app, &token)?;
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
///
/// Gated against `projects`/`delete` (administrator-only in the approved
/// matrix), same reasoning as `masterdata::delete_master_record`'s own
/// finding: no domain area grants `delete` to any role, `formulation`
/// included, so this is the one real `delete` grant that exists.
#[tauri::command(async)]
pub async fn delete_formulation(app: AppHandle, token: String, id: String) -> Result<(), String> {
    authz::authorize_app(&app, &token, "projects", "delete")?;
    let dir = formulation_dir(&app, &id)?;
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn actor(role: &str) -> authz::TrustedActor {
        authz::TrustedActor {
            user_id: "user-1".to_string(),
            role: role.to_string(),
            display_name: "Trusted Person".to_string(),
        }
    }

    // ------------------------------------------------- approval_area_for ---

    #[test]
    fn approval_area_for_maps_the_two_real_gates_and_denies_everything_else() {
        assert_eq!(approval_area_for("pilot_approved"), Some("approvalPilot"));
        assert_eq!(approval_area_for("production_approved"), Some("approvalProduction"));
        for not_a_gate in ["concept", "lab_candidate", "retired", "rejected", "not_a_real_status", ""] {
            assert_eq!(approval_area_for(not_a_gate), None, "{not_a_gate} must not be treated as an approval gate");
        }
    }

    #[test]
    fn approval_capability_for_matches_decision() {
        assert_eq!(approval_capability_for("approved"), "approve");
        assert_eq!(approval_capability_for("rejected"), "reject");
        assert_eq!(approval_capability_for("blocked"), "reject");
    }

    // --------------------------------------------- finalize_approval_record ---

    fn base_record() -> serde_json::Value {
        serde_json::json!({
            "id": "approval-1",
            "formulationId": "form-1",
            "justification": "meets spec",
            "approvedBy": "someone the caller typed",
            "approvedByRole": "administrator",
            "reviewerUserId": "spoofed-id",
            "reviewerRole": "administrator",
        })
    }

    #[test]
    fn a_valid_transition_succeeds_and_the_trusted_identity_overwrites_every_caller_supplied_identity_field() {
        let record = finalize_approval_record(
            base_record(),
            "approved",
            "pilot_candidate",
            "pilot_approved",
            &actor("research_manager"),
        )
        .unwrap();
        assert_eq!(record["approvedBy"], "Trusted Person");
        assert_eq!(record["approvedByRole"], "research_manager");
        assert_eq!(record["reviewerUserId"], "user-1");
        assert_eq!(record["reviewerRole"], "research_manager");
    }

    #[test]
    fn an_invalid_transition_is_denied_even_though_the_role_check_already_passed() {
        // concept -> pilot_approved is not an edge in ALLOWED_NEXT, even for
        // a role with real approve authority — proves role capability alone
        // is not sufficient, exactly what Session 4's brief requires.
        let err = finalize_approval_record(
            base_record(),
            "approved",
            "concept",
            "pilot_approved",
            &actor("research_manager"),
        )
        .unwrap_err();
        assert!(err.contains("cannot move directly"));
    }

    #[test]
    fn a_rejected_decision_does_not_require_transition_validity() {
        // Recording a rejection of an invalid target doesn't move any real
        // state, so it isn't held to the same transition-graph check.
        let record = finalize_approval_record(
            base_record(),
            "rejected",
            "concept",
            "pilot_approved",
            &actor("research_manager"),
        )
        .unwrap();
        assert_eq!(record["approvedByRole"], "research_manager");
    }

    #[test]
    fn missing_justification_is_denied() {
        let mut record = base_record();
        record["justification"] = serde_json::Value::String("   ".to_string());
        let err = finalize_approval_record(record, "approved", "pilot_candidate", "pilot_approved", &actor("research_manager"))
            .unwrap_err();
        assert!(err.contains("justification") || err.contains("fit"));
    }

    #[test]
    fn caller_supplied_identity_fields_are_never_trusted_even_when_absent() {
        // A record with NO identity fields at all still ends up correctly
        // attributed — the trusted actor is the only source, not a fallback
        // used only when the caller forgot to spoof something.
        let record = serde_json::json!({
            "id": "approval-2",
            "formulationId": "form-1",
            "justification": "meets spec",
        });
        let out = finalize_approval_record(record, "approved", "pilot_candidate", "pilot_approved", &actor("quality_manager")).unwrap();
        assert_eq!(out["approvedBy"], "Trusted Person");
        assert_eq!(out["reviewerRole"], "quality_manager");
    }
}
