// `GATE_TYPES`/`GATE_STATES` are public introspection constants (mirroring
// `role_policy.rs`'s `areas()`/`roles()`) exercised by this module's own
// tests but not yet consumed elsewhere — same module-level
// `#[allow(dead_code)]` convention `identity.rs`/`role_policy.rs` already use
// ahead of a non-test caller.
#![allow(dead_code)]
// Phase 13 Session 4A — the four Production Manager workflow gates
// (architecture doc §9.4.3, §15.4): raw-material verification,
// supplier-document verification, production-engineering handoff,
// production release. Each gate is a small, mutable, auditable record —
// `pending -> submitted -> approved|rejected`, `rejected -> submitted`
// again for the worker to re-submit — stored one JSON file per
// `(gateType, subjectId[, parentId])` under `data/workflow_gates/<gateType>/`,
// the same one-mutable-file-per-record pattern `formulations.rs`'s
// approvals already use, not a new storage mechanism.
//
// "Worker completion != manager approval" is structural, not a convention
// callers are trusted to respect: `submit_workflow_gate` requires the
// worker capability (`edit` in the gate's area); `decide_workflow_gate`
// requires the decide capability (`verify` for the two masterdata-scoped
// gates, `approve`/`reject` for the two production-lifecycle gates) — a
// worker role never holds the decide capability in `role_policy.rs`'s
// MATRIX (raw_material/procurement/production_engineering/production all
// lack it; only production_manager and, per §15.4's Session 4A addition,
// administrator have it), so a worker cannot reach approval regardless of
// what a caller sends. `authz::authorize_app` resolves both from the
// authenticated session, never a caller claim — the same guard every other
// privileged command in this codebase uses.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;

use crate::authz;
use crate::formulations::safe_id;
use crate::identity::now_iso;

/// The four fixed gate types — no other value is a real gate.
pub const GATE_TYPES: [&str; 4] = [
    "raw_material_verification",
    "supplier_document_verification",
    "production_engineering_handoff",
    "production_release",
];

/// The fixed 4-state gate lifecycle. Default-deny: `is_valid_gate_transition`
/// (below) returns `false` for anything not explicitly listed — there is no
/// "allow unless denied" branch, matching every other transition check in
/// this codebase (`role_policy::is_valid_transition`).
pub const GATE_STATES: [&str; 4] = ["pending", "submitted", "approved", "rejected"];

fn is_valid_gate_transition(from: &str, to: &str) -> bool {
    matches!(
        (from, to),
        ("pending", "submitted") | ("submitted", "approved") | ("submitted", "rejected") | ("rejected", "submitted")
    )
}

struct GateSpec {
    /// The `role_policy` area this gate's authorization checks against.
    area: &'static str,
    /// Capability a worker needs to move `pending`/`rejected` -> `submitted`.
    worker_capability: &'static str,
    /// `Some(cap)`: the same capability decides both approve and reject
    /// (rawMaterials/supplierDocuments's `verify` — Session 3 granted one
    /// capability for the whole verification decision, not two). `None`:
    /// `approve`/`reject` are distinct capabilities in this area
    /// (productionEngineering/production) — use the decision itself.
    unified_decide_capability: Option<&'static str>,
    /// This gate cannot even be submitted until the *other* named gate,
    /// for the same subject, is `approved` — the downstream-blocking rule
    /// (§9.4.4): production_release requires production_engineering_handoff.
    requires_gate_approved: Option<&'static str>,
    /// This gate cannot be submitted until the parent formulation version's
    /// `FormulaStatus` equals this value — production_engineering_handoff
    /// requires `production_approved` (the upstream approval gate, §6.2/§9.3.4).
    requires_formula_status: Option<&'static str>,
}

fn gate_spec(gate_type: &str) -> Option<GateSpec> {
    match gate_type {
        "raw_material_verification" => Some(GateSpec {
            area: "rawMaterials",
            worker_capability: "edit",
            unified_decide_capability: Some("verify"),
            requires_gate_approved: None,
            requires_formula_status: None,
        }),
        "supplier_document_verification" => Some(GateSpec {
            area: "supplierDocuments",
            worker_capability: "edit",
            unified_decide_capability: Some("verify"),
            requires_gate_approved: None,
            requires_formula_status: None,
        }),
        "production_engineering_handoff" => Some(GateSpec {
            area: "productionEngineering",
            worker_capability: "edit",
            unified_decide_capability: None,
            requires_gate_approved: None,
            requires_formula_status: Some("production_approved"),
        }),
        "production_release" => Some(GateSpec {
            area: "production",
            worker_capability: "edit",
            unified_decide_capability: None,
            requires_gate_approved: Some("production_engineering_handoff"),
            requires_formula_status: None,
        }),
        _ => None,
    }
}

fn decide_capability(spec: &GateSpec, decision: &str) -> &'static str {
    spec.unified_decide_capability.unwrap_or(if decision == "approved" { "approve" } else { "reject" })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateTransition {
    pub id: String,
    pub from: String,
    pub to: String,
    pub actor_user_id: String,
    pub actor_role: String,
    pub actor_display_name: String,
    pub at: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowGateRecord {
    pub schema_version: String,
    pub id: String,
    pub gate_type: String,
    pub subject_id: String,
    /// Only present for the two production-lifecycle gates — the
    /// formulation id the versioned subject belongs to.
    pub parent_id: Option<String>,
    pub state: String,
    pub submitted_by: Option<String>,
    pub submitted_by_role: Option<String>,
    pub submitted_at: Option<String>,
    pub approved_by: Option<String>,
    pub approved_by_role: Option<String>,
    pub approved_at: Option<String>,
    pub rejected_by: Option<String>,
    pub rejected_by_role: Option<String>,
    pub rejected_at: Option<String>,
    pub reason: Option<String>,
    pub history: Vec<GateTransition>,
    pub created_at: String,
    pub updated_at: String,
}

fn gates_root(app: &AppHandle) -> Result<PathBuf, String> {
    crate::formulation_v2::project_data_dir(app, "data").map(|d| d.join("workflow_gates"))
}

fn gate_key(subject_id: &str, parent_id: Option<&str>) -> Result<String, String> {
    match parent_id {
        Some(p) => Ok(format!("{}__{}", safe_id(p)?, safe_id(subject_id)?)),
        None => Ok(safe_id(subject_id)?.to_string()),
    }
}

fn gate_path(app: &AppHandle, gate_type: &str, subject_id: &str, parent_id: Option<&str>) -> Result<PathBuf, String> {
    let dir = gates_root(app)?.join(safe_id(gate_type)?);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{}.json", gate_key(subject_id, parent_id)?)))
}

fn read_gate(path: &PathBuf) -> Option<WorkflowGateRecord> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_gate(path: &PathBuf, record: &WorkflowGateRecord) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(record).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Reads the parent formulation version's `status` field directly — no
/// second copy of `FormulaStatus`, just the same JSON file
/// `formulations::save_formulation_version` writes.
fn formulation_version_status(app: &AppHandle, formulation_id: &str, version_id: &str) -> Result<String, String> {
    let path = crate::formulations::formulation_dir(app, formulation_id)?
        .join("versions")
        .join(format!("{}.json", safe_id(version_id)?));
    let text = std::fs::read_to_string(&path)
        .map_err(|_| format!("formulation version not found: {formulation_id}/{version_id}"))?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(value.get("status").and_then(|v| v.as_str()).unwrap_or("concept").to_string())
}

/// The pure downstream-blocking check (§9.4.4), split from
/// `check_prerequisite`'s file I/O specifically so it's directly
/// unit-testable without an `AppHandle` (this codebase's established
/// convention — see `automatic_backup.rs`'s own doc comment on why
/// `tauri::test::mock_app()` was rejected). `formula_status`/
/// `upstream_gate_state` are the already-read values; this function only
/// decides whether they satisfy `spec`. Worker-tier role capability is
/// checked separately by the guard; this is the workflow-*state* half of
/// "role capability alone must never substitute for missing upstream
/// workflow approval."
fn prerequisite_satisfied(
    spec: &GateSpec,
    formula_status: Option<&str>,
    upstream_gate_state: Option<&str>,
) -> Result<(), String> {
    if let Some(required_status) = spec.requires_formula_status {
        match formula_status {
            Some(status) if status == required_status => {}
            Some(status) => {
                return Err(format!(
                    "this gate requires the formulation version's status to be \"{required_status}\", not \"{status}\""
                ))
            }
            None => return Err("this gate requires a parent formulation id".to_string()),
        }
    }
    if let Some(required_gate_type) = spec.requires_gate_approved {
        if upstream_gate_state != Some("approved") {
            return Err(format!(
                "this gate requires \"{required_gate_type}\" to be approved first for the same subject"
            ));
        }
    }
    Ok(())
}

/// The AppHandle-reading wrapper: resolves the values `prerequisite_satisfied`
/// needs from disk, then delegates the actual decision to it.
fn check_prerequisite(
    app: &AppHandle,
    spec: &GateSpec,
    subject_id: &str,
    parent_id: Option<&str>,
) -> Result<(), String> {
    let formula_status = if spec.requires_formula_status.is_some() {
        let parent = parent_id.ok_or("this gate requires a parent formulation id")?;
        Some(formulation_version_status(app, parent, subject_id)?)
    } else {
        None
    };
    let upstream_gate_state = if let Some(required_gate_type) = spec.requires_gate_approved {
        let path = gate_path(app, required_gate_type, subject_id, parent_id)?;
        read_gate(&path).map(|g| g.state)
    } else {
        None
    };
    prerequisite_satisfied(spec, formula_status.as_deref(), upstream_gate_state.as_deref())
}

/// The pure half of a submission: given the gate's current record (`None`
/// means never submitted — implicitly `pending`), the trusted actor, and a
/// reason, either returns the updated record or a transition-validity
/// error. No `AppHandle`, directly unit-testable.
fn apply_submit(
    existing: Option<WorkflowGateRecord>,
    gate_type: &str,
    subject_id: &str,
    parent_id: Option<String>,
    actor: &authz::TrustedActor,
    reason: Option<String>,
    now: String,
) -> Result<WorkflowGateRecord, String> {
    let from = existing.as_ref().map(|g| g.state.clone()).unwrap_or_else(|| "pending".to_string());
    if !is_valid_gate_transition(&from, "submitted") {
        return Err(format!("cannot submit a gate currently in state \"{from}\""));
    }

    let mut record = existing.unwrap_or_else(|| WorkflowGateRecord {
        schema_version: "1.0".to_string(),
        id: format!("gate-{}", crate::workspace::random_hex(16)),
        gate_type: gate_type.to_string(),
        subject_id: subject_id.to_string(),
        parent_id: parent_id.clone(),
        state: "pending".to_string(),
        submitted_by: None,
        submitted_by_role: None,
        submitted_at: None,
        approved_by: None,
        approved_by_role: None,
        approved_at: None,
        rejected_by: None,
        rejected_by_role: None,
        rejected_at: None,
        reason: None,
        history: Vec::new(),
        created_at: now.clone(),
        updated_at: now.clone(),
    });

    record.history.push(GateTransition {
        id: format!("gt-{}", crate::workspace::random_hex(8)),
        from,
        to: "submitted".to_string(),
        actor_user_id: actor.user_id.clone(),
        actor_role: actor.role.clone(),
        actor_display_name: actor.display_name.clone(),
        at: now.clone(),
        reason: reason.clone(),
    });
    record.state = "submitted".to_string();
    record.submitted_by = Some(actor.display_name.clone());
    record.submitted_by_role = Some(actor.role.clone());
    record.submitted_at = Some(now.clone());
    // A fresh submission (including a resubmission after rejection) clears
    // any stale approve/reject attribution from a prior cycle — a rejected
    // item becoming actionable again by the worker must not still look
    // approved/rejected from a previous round.
    record.approved_by = None;
    record.approved_by_role = None;
    record.approved_at = None;
    record.rejected_by = None;
    record.rejected_by_role = None;
    record.rejected_at = None;
    record.reason = reason;
    record.updated_at = now;
    Ok(record)
}

/// The pure half of a decision: given the existing record, the decision,
/// and the trusted actor, either returns the updated record or a
/// transition-validity error (e.g. deciding a gate still `pending`, never
/// submitted). No `AppHandle`, directly unit-testable.
fn apply_decision(
    mut record: WorkflowGateRecord,
    decision: &str,
    actor: &authz::TrustedActor,
    reason: Option<String>,
    now: String,
) -> Result<WorkflowGateRecord, String> {
    if !is_valid_gate_transition(&record.state, decision) {
        return Err(format!("cannot move a gate from \"{}\" to \"{decision}\"", record.state));
    }
    record.history.push(GateTransition {
        id: format!("gt-{}", crate::workspace::random_hex(8)),
        from: record.state.clone(),
        to: decision.to_string(),
        actor_user_id: actor.user_id.clone(),
        actor_role: actor.role.clone(),
        actor_display_name: actor.display_name.clone(),
        at: now.clone(),
        reason: reason.clone(),
    });
    record.state = decision.to_string();
    if decision == "approved" {
        record.approved_by = Some(actor.display_name.clone());
        record.approved_by_role = Some(actor.role.clone());
        record.approved_at = Some(now.clone());
    } else {
        record.rejected_by = Some(actor.display_name.clone());
        record.rejected_by_role = Some(actor.role.clone());
        record.rejected_at = Some(now.clone());
    }
    record.reason = reason;
    record.updated_at = now;
    Ok(record)
}

/// Worker submits their completed work for `production_manager`
/// verification/approval. `pending`/`rejected` -> `submitted` only.
#[tauri::command(async)]
pub async fn submit_workflow_gate(
    app: AppHandle,
    token: String,
    gate_type: String,
    subject_id: String,
    parent_id: Option<String>,
    reason: Option<String>,
) -> Result<WorkflowGateRecord, String> {
    let spec = gate_spec(&gate_type).ok_or_else(|| format!("\"{gate_type}\" is not a recognized workflow gate"))?;
    let actor = authz::authorize_app(&app, &token, spec.area, spec.worker_capability)?;
    check_prerequisite(&app, &spec, &subject_id, parent_id.as_deref())?;

    let path = gate_path(&app, &gate_type, &subject_id, parent_id.as_deref())?;
    let existing = read_gate(&path);
    let record = apply_submit(existing, &gate_type, &subject_id, parent_id, &actor, reason, now_iso())?;
    write_gate(&path, &record)?;
    Ok(record)
}

/// `production_manager` (or administrator, §15.4/§9.4.2) decides a
/// `submitted` gate. `decision` must be `"approved"` or `"rejected"`.
#[tauri::command(async)]
pub async fn decide_workflow_gate(
    app: AppHandle,
    token: String,
    gate_type: String,
    subject_id: String,
    parent_id: Option<String>,
    decision: String,
    reason: Option<String>,
) -> Result<WorkflowGateRecord, String> {
    if decision != "approved" && decision != "rejected" {
        return Err("decision must be \"approved\" or \"rejected\"".to_string());
    }
    let spec = gate_spec(&gate_type).ok_or_else(|| format!("\"{gate_type}\" is not a recognized workflow gate"))?;
    let capability = decide_capability(&spec, &decision);
    let actor = authz::authorize_app(&app, &token, spec.area, capability)?;

    let path = gate_path(&app, &gate_type, &subject_id, parent_id.as_deref())?;
    let existing = read_gate(&path).ok_or("no submitted gate found for this subject")?;
    let record = apply_decision(existing, &decision, &actor, reason, now_iso())?;
    write_gate(&path, &record)?;
    Ok(record)
}

/// Reads the current state of one gate, or `None` if it has never been
/// submitted (still implicitly `pending`). AUTHENTICATED_READ — requires a
/// valid session, no specific capability.
#[tauri::command(async)]
pub async fn read_workflow_gate(
    app: AppHandle,
    token: String,
    gate_type: String,
    subject_id: String,
    parent_id: Option<String>,
) -> Result<Option<WorkflowGateRecord>, String> {
    authz::current_actor_app(&app, &token)?;
    gate_spec(&gate_type).ok_or_else(|| format!("\"{gate_type}\" is not a recognized workflow gate"))?;
    let path = gate_path(&app, &gate_type, &subject_id, parent_id.as_deref())?;
    Ok(read_gate(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_valid_gate_transition_matches_the_four_state_lifecycle() {
        assert!(is_valid_gate_transition("pending", "submitted"));
        assert!(is_valid_gate_transition("submitted", "approved"));
        assert!(is_valid_gate_transition("submitted", "rejected"));
        assert!(is_valid_gate_transition("rejected", "submitted"));
        // Worker cannot skip straight to approved/rejected from pending.
        assert!(!is_valid_gate_transition("pending", "approved"));
        assert!(!is_valid_gate_transition("pending", "rejected"));
        // Approved is terminal.
        assert!(!is_valid_gate_transition("approved", "submitted"));
        assert!(!is_valid_gate_transition("approved", "rejected"));
        // Rejected cannot jump straight back to approved.
        assert!(!is_valid_gate_transition("rejected", "approved"));
        assert!(!is_valid_gate_transition("not_a_real_state", "submitted"));
    }

    #[test]
    fn gate_spec_covers_all_four_gate_types_and_denies_unknown() {
        for gt in GATE_TYPES {
            assert!(gate_spec(gt).is_some(), "{gt} should have a spec");
        }
        assert!(gate_spec("not_a_real_gate").is_none());
    }

    #[test]
    fn raw_material_and_supplier_gates_use_unified_verify_for_both_decisions() {
        let raw = gate_spec("raw_material_verification").unwrap();
        assert_eq!(decide_capability(&raw, "approved"), "verify");
        assert_eq!(decide_capability(&raw, "rejected"), "verify");
        let sup = gate_spec("supplier_document_verification").unwrap();
        assert_eq!(decide_capability(&sup, "approved"), "verify");
        assert_eq!(decide_capability(&sup, "rejected"), "verify");
    }

    #[test]
    fn production_gates_use_distinct_approve_and_reject_capabilities() {
        let handoff = gate_spec("production_engineering_handoff").unwrap();
        assert_eq!(decide_capability(&handoff, "approved"), "approve");
        assert_eq!(decide_capability(&handoff, "rejected"), "reject");
        let release = gate_spec("production_release").unwrap();
        assert_eq!(decide_capability(&release, "approved"), "approve");
        assert_eq!(decide_capability(&release, "rejected"), "reject");
    }

    #[test]
    fn production_release_requires_production_engineering_handoff_approved_first() {
        let release = gate_spec("production_release").unwrap();
        assert_eq!(release.requires_gate_approved, Some("production_engineering_handoff"));
    }

    #[test]
    fn production_engineering_handoff_requires_production_approved_formula_status() {
        let handoff = gate_spec("production_engineering_handoff").unwrap();
        assert_eq!(handoff.requires_formula_status, Some("production_approved"));
    }

    #[test]
    fn every_gate_worker_capability_is_edit() {
        // All four worker roles (raw_material/procurement/
        // production_engineering/production) have `edit` in their own
        // area per role_policy.rs's MATRIX — this is the capability that
        // lets a worker submit, never approve/reject.
        for gt in GATE_TYPES {
            assert_eq!(gate_spec(gt).unwrap().worker_capability, "edit");
        }
    }

    #[test]
    fn worker_roles_cannot_decide_their_own_gate_the_capability_does_not_exist_for_them() {
        // Structural proof at the policy layer: none of the four worker
        // roles has the decide capability in their own gate's area.
        assert!(!crate::role_policy::can("raw_material", "rawMaterials", "verify"));
        assert!(!crate::role_policy::can("procurement", "supplierDocuments", "verify"));
        assert!(!crate::role_policy::can("production_engineering", "productionEngineering", "approve"));
        assert!(!crate::role_policy::can("production", "production", "approve"));
    }

    #[test]
    fn production_manager_and_administrator_hold_every_decide_capability() {
        for role in ["production_manager", "administrator"] {
            assert!(crate::role_policy::can(role, "rawMaterials", "verify"), "{role} should verify rawMaterials");
            assert!(crate::role_policy::can(role, "supplierDocuments", "verify"), "{role} should verify supplierDocuments");
            assert!(crate::role_policy::can(role, "productionEngineering", "approve"), "{role} should approve productionEngineering");
            assert!(crate::role_policy::can(role, "productionEngineering", "reject"), "{role} should reject productionEngineering");
            assert!(crate::role_policy::can(role, "production", "approve"), "{role} should approve production");
            assert!(crate::role_policy::can(role, "production", "reject"), "{role} should reject production");
        }
    }

    #[test]
    fn gate_key_is_stable_and_distinguishes_parented_from_unparented_subjects() {
        assert_eq!(gate_key("mat-1", None).unwrap(), "mat-1");
        assert_eq!(gate_key("v1", Some("form-1")).unwrap(), "form-1__v1");
        // Same subject id, different parent, must not collide.
        assert_ne!(gate_key("v1", Some("form-1")).unwrap(), gate_key("v1", Some("form-2")).unwrap());
    }

    // ------------------------------------------ prerequisite_satisfied ---

    #[test]
    fn a_gate_with_no_prerequisite_is_always_satisfied() {
        let raw = gate_spec("raw_material_verification").unwrap();
        assert!(prerequisite_satisfied(&raw, None, None).is_ok());
    }

    #[test]
    fn production_engineering_handoff_is_blocked_until_the_formula_is_production_approved() {
        let handoff = gate_spec("production_engineering_handoff").unwrap();
        assert!(prerequisite_satisfied(&handoff, Some("pilot_approved"), None).is_err());
        assert!(prerequisite_satisfied(&handoff, Some("concept"), None).is_err());
        assert!(prerequisite_satisfied(&handoff, None, None).is_err());
        assert!(prerequisite_satisfied(&handoff, Some("production_approved"), None).is_ok());
    }

    #[test]
    fn production_release_is_blocked_until_production_engineering_handoff_is_approved() {
        let release = gate_spec("production_release").unwrap();
        assert!(prerequisite_satisfied(&release, None, None).is_err(), "no upstream gate at all");
        assert!(prerequisite_satisfied(&release, None, Some("pending")).is_err());
        assert!(prerequisite_satisfied(&release, None, Some("submitted")).is_err());
        assert!(prerequisite_satisfied(&release, None, Some("rejected")).is_err());
        assert!(prerequisite_satisfied(&release, None, Some("approved")).is_ok());
    }

    // -------------------------------------------------- apply_submit ---

    fn actor(role: &str) -> authz::TrustedActor {
        authz::TrustedActor { user_id: "user-1".to_string(), role: role.to_string(), display_name: "A Worker".to_string() }
    }

    #[test]
    fn first_submission_creates_a_pending_to_submitted_record_with_history() {
        let record = apply_submit(None, "raw_material_verification", "mat-1", None, &actor("raw_material"), Some("ready".to_string()), "2026-01-01T00:00:00Z".to_string()).unwrap();
        assert_eq!(record.state, "submitted");
        assert_eq!(record.submitted_by_role.as_deref(), Some("raw_material"));
        assert_eq!(record.history.len(), 1);
        assert_eq!(record.history[0].from, "pending");
        assert_eq!(record.history[0].to, "submitted");
        assert!(record.approved_by.is_none());
        assert!(record.rejected_by.is_none());
    }

    #[test]
    fn submitting_an_already_submitted_gate_is_rejected() {
        let first = apply_submit(None, "raw_material_verification", "mat-1", None, &actor("raw_material"), None, "t0".to_string()).unwrap();
        let err = apply_submit(Some(first), "raw_material_verification", "mat-1", None, &actor("raw_material"), None, "t1".to_string()).unwrap_err();
        assert!(err.contains("submitted"));
    }

    #[test]
    fn a_rejected_gate_becomes_actionable_again_via_resubmission_and_clears_stale_decision_fields() {
        let submitted = apply_submit(None, "production_engineering_handoff", "v1", Some("form-1".to_string()), &actor("production_engineering"), None, "t0".to_string()).unwrap();
        let rejected = apply_decision(submitted, "rejected", &actor("production_manager"), Some("incomplete".to_string()), "t1".to_string()).unwrap();
        assert_eq!(rejected.state, "rejected");
        assert!(rejected.rejected_by.is_some());

        // The worker fixes it and resubmits — this is the "rejected item
        // must become actionable again by the appropriate worker role" proof.
        let resubmitted = apply_submit(Some(rejected), "production_engineering_handoff", "v1", Some("form-1".to_string()), &actor("production_engineering"), None, "t2".to_string()).unwrap();
        assert_eq!(resubmitted.state, "submitted");
        assert!(resubmitted.rejected_by.is_none(), "resubmission must clear the stale rejection attribution");
        assert_eq!(resubmitted.history.len(), 3, "pending->submitted, submitted->rejected, rejected->submitted");
    }

    // ------------------------------------------------ apply_decision ---

    #[test]
    fn deciding_a_gate_that_was_never_submitted_pending_is_rejected() {
        let pending = WorkflowGateRecord {
            schema_version: "1.0".to_string(),
            id: "gate-1".to_string(),
            gate_type: "raw_material_verification".to_string(),
            subject_id: "mat-1".to_string(),
            parent_id: None,
            state: "pending".to_string(),
            submitted_by: None,
            submitted_by_role: None,
            submitted_at: None,
            approved_by: None,
            approved_by_role: None,
            approved_at: None,
            rejected_by: None,
            rejected_by_role: None,
            rejected_at: None,
            reason: None,
            history: Vec::new(),
            created_at: "t0".to_string(),
            updated_at: "t0".to_string(),
        };
        let err = apply_decision(pending, "approved", &actor("production_manager"), None, "t1".to_string()).unwrap_err();
        assert!(err.contains("pending"));
    }

    #[test]
    fn approving_a_submitted_gate_records_the_deciding_actor_and_is_terminal() {
        let submitted = apply_submit(None, "supplier_document_verification", "sup-1", None, &actor("procurement"), None, "t0".to_string()).unwrap();
        let approved = apply_decision(submitted, "approved", &actor("production_manager"), Some("looks good".to_string()), "t1".to_string()).unwrap();
        assert_eq!(approved.state, "approved");
        assert_eq!(approved.approved_by_role.as_deref(), Some("production_manager"));
        assert!(approved.rejected_by.is_none());
        // Approved is terminal — a further decision call must fail.
        let err = apply_decision(approved, "rejected", &actor("production_manager"), None, "t2".to_string()).unwrap_err();
        assert!(err.contains("approved"));
    }

    #[test]
    fn administrator_can_decide_a_gate_exactly_like_production_manager() {
        // §15.4/§9.4.2: administrator exercises all four gates on the same
        // explicit-exception basis as every other gate.
        let submitted = apply_submit(None, "production_release", "v1", Some("form-1".to_string()), &actor("production"), None, "t0".to_string()).unwrap();
        let approved = apply_decision(submitted, "approved", &actor("administrator"), None, "t1".to_string()).unwrap();
        assert_eq!(approved.approved_by_role.as_deref(), Some("administrator"));
    }
}
