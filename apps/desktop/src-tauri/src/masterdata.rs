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
//   data/master/alternative_rankings.json
//   data/master/predictive_models.json
//   data/master/substitution_runs.json
//   data/master/laboratory_trials.json
//   data/master/test_definitions.json
//   data/master/test_results.json
//   data/master/laboratory_standards.json
//   data/master/laboratory_test_methods.json
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
//   data/master/product_claims.json
//   data/master/claim_evidence_links.json
//   data/master/claim_reviews.json
//   data/master/claim_review_revocations.json
//   data/master/product_labels.json
//   data/master/label_content_blocks.json
//   data/master/label_artworks.json
//   data/master/label_reviews.json
//   data/master/label_review_revocations.json
//   data/master/doe_studies.json
//   data/master/doe_factors.json
//   data/master/doe_constraints.json
//   data/master/doe_responses.json
//   data/master/doe_designs.json
//   data/master/doe_runs.json
//   data/master/doe_observations.json
//   data/master/doe_analyses.json
//   data/master/doe_candidates.json
//   data/master/doe_review_actions.json
//   data/master/product_families.json
//   data/master/finished_products.json
//   data/master/finished_product_specifications.json
//   data/master/material_documents.json
//   data/master/supplier_document_acquisitions.json
//   data/master/reference_formulations.json
//   data/master/supplier_acquisition_jobs.json
//   data/master/supplier_acquisition_job_items.json
//   data/master/process_parameters.json
//   data/master/formula_cost_overrides.json
//   data/master/data_exchange_import_jobs.json
//   data/master/data_exchange_import_row_results.json
//   data/master/data_exchange_export_jobs.json
//   data/master/data_exchange_schema_versions.json
//   data/master/reverse_formulation_studies.json
//   data/master/benchmark_products.json
//   data/master/benchmark_evidence_items.json
//   data/master/ingredient_declaration_lines.json
//   data/master/analytical_composition_results.json
//   data/master/target_product_profiles.json
//   data/master/reverse_constraint_sets.json
//   data/master/ingredient_mappings.json
//   data/master/substitution_rules.json
//   data/master/reverse_formula_candidates.json
//   data/master/candidate_score_explanations.json
//   data/master/generated_document_records.json
//   data/master/mapping_profiles.json
//   data/master/external_id_crosswalks.json
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

use crate::authz;

/// Collections the UI may address, and whether history is preserved.
///
/// An explicit allow-list rather than a free-text filename: the collection name
/// arrives from the webview, and joining untrusted text onto a path is how a
/// renderer bug becomes an arbitrary file write.
const COLLECTIONS: [(&str, bool); 101] = [
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
    // A ranking record freezes every decision input, policy version and
    // deterministic ordering for one generated formulation session.
    ("alternative_rankings", true),
    // FVL-07 accepted model artifacts are immutable, checksum-verified
    // inputs to prediction serving; a new model version is a new row.
    ("predictive_models", true),
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
    // Phase 10 Session 1A — configurable per-test laboratory standards and
    // methods. A standard/method row is a mutable header, same reasoning as
    // `regulatory_rules`/`approval_policies`: its own draft/active/
    // superseded lifecycle is what changes it, and the application layer
    // (`engine/laboratoryStandards.ts`) refuses editing an active row or
    // hard-deleting one a historical `test_results` snapshot references,
    // rather than the storage layer forcing a new record per edit. The
    // snapshot itself is not a separate collection — it is embedded
    // directly on the `test_results` row it belongs to (same
    // "attachment_references is not a collection" reasoning above), and
    // `test_results` is already append-only.
    ("laboratory_standards", false),
    ("laboratory_test_methods", false),
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
    // Phase 4 — Claims and Label Review. A claim/label is a mutable header
    // row, same reasoning as `regulatory_dossiers`: its own status/revision
    // lifecycle changes it, never a silent overwrite of an immutable
    // (reviewed/approved/superseded) one — the application layer refuses
    // that transition (`engine/claims.ts`'s `isClaimImmutable`,
    // `engine/labels.ts`'s `isLabelImmutable`). Claim evidence links are
    // append-only, identical overlay-computed-active convention as
    // `regulatory_requirement_evidence_links`. Claim/label reviews and
    // their revocations are append-only, mirroring
    // `regulatory_dossier_reviews`/`regulatory_dossier_review_revocations`
    // exactly. Label content blocks are append-only per (labelId,
    // labelRevision, blockType, language) — an edit appends a new row
    // rather than overwriting frozen content, the same pattern
    // `regulatory_dossier_requirements` already uses. Label artwork is a
    // mutable current-state row; a real file replacement creates a NEW row
    // via `supersedesArtworkId` — no separate "artwork revisions"
    // collection, same reasoning as `regulatory_evidence_items`.
    // `label_manual_actions` from the spec's suggested 10 was dropped: the
    // spec never defines what fields it would hold, and an empty,
    // purposeless collection would be exactly the "unnecessary
    // duplication" earlier phases were told to avoid.
    ("product_claims", false),
    ("claim_evidence_links", true),
    ("claim_reviews", true),
    ("claim_review_revocations", true),
    ("product_labels", false),
    ("label_content_blocks", true),
    ("label_artworks", false),
    ("label_reviews", true),
    ("label_review_revocations", true),
    // Phase 5 — Design of Experiments. A study/factor/constraint/response/
    // design/run is a mutable header-style row, same reasoning as
    // `regulatory_dossiers`/`product_claims`: its own status/revision
    // lifecycle is what changes it (a study's factors/constraints/responses
    // are freely editable pre-generation; once a design is generated its
    // `factorSnapshot`/`constraintSnapshot`/`responseSnapshot` freeze that
    // moment, and a later meaningful change creates a brand-new study
    // revision — `engine/doeDesign.ts`'s `DOE_STUDY_IMMUTABLE_STATUSES` and
    // `reviseDoeStudy`, never a silent overwrite of an analyzed/completed
    // study). A run's `factorSettings` become immutable once execution
    // begins (`DOE_RUN_LOCKED_STATUSES`), enforced at the application layer,
    // same convention as `regulatory_evidence_items`. An observation is
    // also a mutable single row — validate/exclude/restore change its own
    // `status`/`excludedAt`/`exclusionReason` fields in place, same as
    // `regulatory_evidence_items`; the full history of who changed what and
    // when lives in the audit log (`doe.observation_recorded` /
    // `doe.observation_excluded` / `doe.observation_restored`), not in a
    // second copy of the row. A candidate is the same: `status`/
    // `appliedDraftId`/`appliedAt` change in place as it moves
    // proposed -> shortlisted -> selected -> applied_to_draft, again with
    // the audit log as the durable history. An ANALYSIS is different and
    // stays append-only: re-running an analysis is not a status edit, it is
    // a genuinely new fit over (possibly) different included/excluded runs,
    // linked via `supersedesAnalysisId` — the original coefficients/ANOVA a
    // completed study's candidates and lineage depend on must never be
    // silently overwritten. Review actions (observation validation,
    // exclusion confirmation, study-completion approval) are a lightweight
    // append-only sign-off log, identical shape to
    // `regulatory_dossier_manual_requirement_actions`.
    ("doe_studies", false),
    ("doe_factors", false),
    ("doe_constraints", false),
    ("doe_responses", false),
    ("doe_designs", false),
    ("doe_runs", false),
    ("doe_observations", false),
    ("doe_analyses", true),
    ("doe_candidates", false),
    ("doe_review_actions", true),

    // Phase 6 — Data Exchange Center. Five net-new master-data collections
    // the 24 mandated templates need but no earlier phase modeled as a
    // live, mutable collection (`product_families`/`finished_products`
    // deliberately distinct from the static Kenya reference catalog; the
    // other 19 templates target collections that already existed and are
    // reused as-is). `formula_cost_overrides` is append-only, matching
    // `material_prices`'s "a new validity period is a new row" convention.
    // The system's own bookkeeping — import jobs, per-row results, export
    // jobs, schema versions — never stores an uploaded file's contents,
    // only counts/hashes/pointers, so `data_exchange_import_jobs` stays
    // small even after years of use. Row results and export/schema-version
    // records are append-only: a job's history must not be rewritable
    // after the fact.
    ("product_families", false),
    ("finished_products", false),
    // FVL-04.005 hardening — release/QC limits bound to a real finished
    // product SKU and a real TestDefinition, never a copy of either. A new
    // effective_from period is always a new row, same convention as
    // material_prices/exchange_rates — a specification change must never
    // silently rewrite what a batch was actually evaluated against.
    ("finished_product_specifications", true),
    ("material_documents", false),
    // Immutable supplier source evidence. Later parser or human-review
    // outcomes are separate records; the acquired document receipt itself
    // must never be silently rewritten.
    ("supplier_document_acquisitions", true),
    // Supplier formulation extraction snapshots are immutable reference
    // evidence, separate from production Formulation/FormulationVersion.
    ("reference_formulations", true),
    // Human parser decisions are separate append-only review events; they
    // never mutate the source snapshot or promote data into production.
    ("reference_formulation_reviews", true),
    // Supplier discovery/download work is mutable operational state. The
    // immutable acquired-document evidence remains in its separate collection.
    ("supplier_acquisition_jobs", false),
    ("supplier_acquisition_job_items", false),
    ("process_parameters", false),
    ("formula_cost_overrides", true),
    ("data_exchange_import_jobs", false),
    ("data_exchange_import_row_results", true),
    ("data_exchange_export_jobs", true),
    ("data_exchange_schema_versions", true),
    // Phase 7 — Reverse Formulation. Collections for benchmark products,
    // evidence, declarations, mappings, constraints, and candidates. A
    // study/benchmark product/target profile/constraint set is a mutable
    // header row with its own status lifecycle, same reasoning as
    // `regulatory_dossiers`/`optimization_profiles`. Declaration lines,
    // ingredient mappings, and substitution rules each carry their own
    // in-place status field (unmapped/mapped/conflicted/rejected,
    // proposed/confirmed/rejected, proposed/validated/deprecated) — mutable
    // single rows, same as `regulatory_evidence_items`/`doe_observations`.
    // A generated candidate is likewise mutable: its `status` moves
    // generated -> validated/rejected/selected in place, the same
    // proposed -> shortlisted -> selected lifecycle `doe_candidates` uses.
    // Analytical composition results are lab measurements and stay
    // append-only for the same reason as `test_results`/`stability_results`:
    // a recorded reading must never be silently overwritten. Candidate score
    // explanations are a computed snapshot tied to one scoring pass, the
    // same shape as `doe_analyses`/`compatibility_snapshots`/
    // `optimization_runs` — re-scoring must not silently overwrite the
    // rationale behind an earlier decision, so this is append-only too.
    ("reverse_formulation_studies", false),
    ("benchmark_products", false),
    ("benchmark_evidence_items", false),
    ("ingredient_declaration_lines", false),
    ("analytical_composition_results", true),
    ("target_product_profiles", false),
    ("reverse_constraint_sets", false),
    ("ingredient_mappings", false),
    ("substitution_rules", false),
    ("reverse_formula_candidates", false),
    ("candidate_score_explanations", true),
    // Phase 8 — document export history. One record per PDF/DOCX
    // generation attempt (Dossiers workspace), created as "generating"
    // and updated in place to "succeeded"/"failed"/"cancelled" — a
    // mutable single row keyed by `id` (it has no separate `code`), the
    // same "status changes in place, full history lives in the audit
    // log" pattern as `regulatory_evidence_items`/`doe_observations`,
    // not a second append-only history of its own. Schema and every
    // integrity rule (a failed/cancelled record can never carry success
    // file metadata; a succeeded one always carries fileName/mimeType/
    // byteSize/checksum) live in `GeneratedDocumentRecord`
    // (`packages/shared/src/schemas/documentExport.ts`, Session 1).
    ("generated_document_records", false),
    // FVL-04.013-.018 — external source connector foundation.
    //
    // FVL-04.013-.018 hardening (D1/D2, Session 6): `mapping_profiles` was
    // originally registered mutable, relying only on application-layer
    // discipline to keep a profile version immutable — that was proven
    // insufficient (nothing stopped a second `upsert_master_records` call
    // from silently rewriting an existing version's own mappings). Its
    // immutable STORAGE identity is now the composite
    // `code = "${profileId}::v${profileVersion}"` (`mappingProfileCode()`
    // in `engine/mappingProfile.ts`), and the collection is registered
    // append-only here so the storage layer itself rejects any second
    // write attempting to reuse an existing `code` — a changed mapping
    // MUST produce a new `profileVersion` (a new row); the version it
    // replaces is named via `supersedesProfileId` and is never rewritten
    // or removed. `external_id_crosswalks` stays mutable by design: its
    // own `lastSeenAt` genuinely updates in place on re-import (the same
    // source identity resolving to the same canonical identity again);
    // `firstSeenAt`/`canonicalRecordId` never silently change once set —
    // enforced by `engine/crosswalk.ts`'s own conflict-detection
    // discipline (a conflicting write is never persisted at all, active
    // record left untouched), not by this storage layer's mutability
    // alone. Neither collection ever stores a credential, a raw customer
    // payload, or an uploaded file's contents — only configuration and
    // identity mappings.
    ("mapping_profiles", true),
    ("external_id_crosswalks", false),
    // Connector Management frontend — saved connection CONFIGURATION only
    // (name/type/host/path/idField/status/...). `connectionRef` is the
    // ONLY field that may represent authentication, always an opaque
    // reference string — never a raw credential — resolved outside this
    // record, the same boundary `mapping_profiles`/`external_id_crosswalks`
    // already establish. Mutable: unlike a mapping profile's own
    // immutable version chain, editing a saved connection's host/path
    // configuration in place is expected, ordinary maintenance, not a
    // historical fact that needs preserving.
    ("connector_connections", false),
];

/// Every allow-listed collection name and whether it is append-only — the
/// single source of truth `migration.rs`'s plan computation reads from,
/// rather than a second, hand-copied list that could drift from this one.
#[tauri::command]
pub fn list_master_collections() -> Vec<(String, bool)> {
    COLLECTIONS
        .iter()
        .map(|(name, append_only)| (name.to_string(), *append_only))
        .collect()
}

/// Phase 13 Session 4A: this used to be a hand-typed Rust `match` over all
/// 101 collection names (V01-01.009). It is now a thin delegator to
/// `role_policy::masterdata_area_for`, which reads the same generated JSON
/// fixture (`masterdataCollectionAreas.generated.json`) TypeScript's
/// `masterdataPolicyAreas.ts` is parity-tested against — closing the
/// Session 4 finding that this mapping had no TypeScript equivalent to
/// stay in sync with (architecture doc §9.3.6/§9.4.5). `None` (an
/// unmapped/unknown name) is a hard deny, never a fallback allow — the
/// same default-deny discipline `role_policy::can` itself uses.
fn area_for_collection(name: &str) -> Option<&'static str> {
    crate::role_policy::masterdata_area_for(name)
}

/// The capability set `upsert_master_records`/`write_master_collection_raw`
/// share: a single call can insert new rows and update existing ones in the
/// same batch, so `authz::authorize_any` is used with both — a role with
/// either `create` or `edit` on the mapped area may write, matching every
/// area/role pair in `rolePolicy.ts`'s MATRIX where the two are granted
/// together anyway (architecture doc §9.3).
const WRITE_CAPABILITIES: [&str; 2] = ["create", "edit"];

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

/// Phase 13 closure session — the gate-subject-existence check
/// `workflow_gates.rs` uses for `raw_material_verification`/
/// `supplier_document_verification`: does a real row with this `code`/`id`
/// exist in this allow-listed collection? `collection` must already be one
/// of the 100 real names (`collection_spec` rejects anything else, same
/// default-deny discipline as every other collection lookup in this file).
pub(crate) fn collection_has_code(app: &AppHandle, collection: &str, code: &str) -> Result<bool, String> {
    let (name, _) = collection_spec(collection)?;
    let path = collection_path(app, name)?;
    Ok(read_array(&path).iter().any(|row| row_key(row).as_deref() == Some(code)))
}

#[tauri::command(async)]
pub async fn list_master_records(
    app: AppHandle,
    token: String,
    collection: String,
) -> Result<serde_json::Value, String> {
    authz::current_actor_app(&app, &token)?;
    let path = collection_path(&app, &collection)?;
    Ok(serde_json::Value::Array(read_array(&path)))
}

/// Insert or update rows by their stable code.
///
/// Idempotent: importing the same file twice leaves the same data, which is the
/// difference between a re-runnable import and a duplicated material library.
///
/// Phase 13 Session 4: `collection` is untrusted webview input, so it is
/// resolved to a real allow-listed name (`collection_spec`) BEFORE being
/// used to look up a policy area — never authorize against the caller's
/// raw string. An unmapped (but otherwise allow-listed) collection is
/// denied by `area_for_collection` returning `None`, same as an unknown
/// role/area/capability triple in `role_policy::can` itself.
#[tauri::command(async)]
pub async fn upsert_master_records(
    app: AppHandle,
    token: String,
    collection: String,
    records: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let (name, append_only) = collection_spec(&collection)?;
    ensure_generic_collection_write_allowed(name)?;
    let area = area_for_collection(name)
        .ok_or_else(|| format!("{name} has no policy area mapping and cannot be written"))?;
    authz::authorize_any_app(&app, &token, area, &WRITE_CAPABILITIES)?;
    let path = collection_path(&app, name)?;
    let rows = read_array(&path);
    let (rows, inserted, updated) = apply_upsert(rows, records, append_only, name)?;

    write_array(&path, &rows)?;
    Ok(serde_json::json!({
        "inserted": inserted,
        "updated": updated,
        "total": rows.len(),
    }))
}

/// Append a reference-formulation decision using the authenticated actor from
/// the native session. The renderer may propose a review payload, but it may
/// not choose the reviewer identity or attach the decision to a different
/// immutable source snapshot.
#[tauri::command(async)]
pub async fn append_reference_formulation_review(
    app: AppHandle,
    token: String,
    review: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let actor = authz::authorize_any_app(&app, &token, "formulation", &WRITE_CAPABILITIES)?;
    let review = stamp_reference_formulation_review(
        review,
        &actor.user_id,
        &actor.display_name,
        &now_rfc3339_utc(),
    )?;
    let source_path = collection_path(&app, "reference_formulations")?;
    let source_rows = read_array(&source_path);
    let source = source_rows.iter().find(|row| {
        row.get("id").and_then(|value| value.as_str())
            == review["referenceFormulationRecordId"].as_str()
            && row.get("sourceDocumentHash").and_then(|value| value.as_str())
                .zip(review["sourceDocumentHash"].as_str())
                .map_or(false, |(left, right)| left.eq_ignore_ascii_case(right))
    });
    let Some(source) = source else {
        return Err("review must cite an existing immutable reference formulation source".to_string());
    };
    validate_review_evidence(&review, source)?;

    let path = collection_path(&app, "reference_formulation_reviews")?;
    let rows = read_array(&path);
    let (rows, inserted, _) = apply_upsert(
        rows,
        vec![review.clone()],
        true,
        "reference_formulation_reviews",
    )?;
    if inserted != 1 {
        return Err("review decision was not appended".to_string());
    }
    write_array(&path, &rows)?;
    Ok(review)
}

fn stamp_reference_formulation_review(
    mut review: serde_json::Value,
    user_id: &str,
    display_name: &str,
    reviewed_at: &str,
) -> Result<serde_json::Value, String> {
    let object = review
        .as_object_mut()
        .ok_or_else(|| "review payload must be an object".to_string())?;
    for field in [
        "id",
        "code",
        "referenceFormulationRecordId",
        "sourceDocumentHash",
        "targetType",
        "targetKey",
        "fieldPath",
        "sourceValue",
        "evidenceExcerpt",
    ] {
        if object.get(field).and_then(|value| value.as_str()).map_or(true, |value| value.trim().is_empty()) {
            return Err(format!("review field {field} is required"));
        }
    }
    if object.get("schemaVersion").and_then(|value| value.as_str()) != Some("1.0") {
        return Err("review schema version is invalid".to_string());
    }
    if object.get("id").and_then(|value| value.as_str()) != object.get("code").and_then(|value| value.as_str()) {
        return Err("review id and append-only code must match".to_string());
    }
    let hash = object.get("sourceDocumentHash").and_then(|value| value.as_str()).unwrap_or_default();
    if hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("review source document hash must be a SHA-256 hex digest".to_string());
    }
    let target_type = object.get("targetType").and_then(|value| value.as_str()).unwrap_or_default();
    if !["identity", "ingredient", "procedure", "target"].contains(&target_type) {
        return Err("review target type is invalid".to_string());
    }
    let decision = object
        .get("decision")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "review decision is required".to_string())?;
    if !["accepted", "edited", "rejected", "needs_review"].contains(&decision) {
        return Err("review decision is invalid".to_string());
    }
    if decision == "edited"
        && object
            .get("reviewedValue")
            .and_then(|value| value.as_str())
            .map_or(true, |value| value.trim().is_empty())
    {
        return Err("edited decisions require a proposed value".to_string());
    }
    if decision != "edited" && object.contains_key("reviewedValue") {
        return Err("only edited decisions may include a proposed value".to_string());
    }
    object.insert(
        "reviewer".to_string(),
        serde_json::json!({ "userId": user_id, "displayName": display_name }),
    );
    object.insert("reviewedAt".to_string(), serde_json::Value::String(reviewed_at.to_string()));
    Ok(review)
}

fn ensure_generic_collection_write_allowed(name: &str) -> Result<(), String> {
    if name == "reference_formulation_reviews" {
        return Err("reference formulation reviews must use the authenticated append command".to_string());
    }
    Ok(())
}

fn validate_review_evidence(review: &serde_json::Value, source: &serde_json::Value) -> Result<(), String> {
    let target_key = review["targetKey"].as_str().unwrap_or_default();
    let expected = expected_reference_formulation_evidence(target_key, source)
        .ok_or_else(|| "review target does not exist in the immutable source snapshot".to_string())?;
    for field in ["targetType", "targetKey", "fieldPath", "sourceValue", "evidenceExcerpt", "pageNumber", "blockIndex", "rowIndex", "cellIndex"] {
        if review.get(field) != expected.get(field) {
            return Err(format!("review field {field} does not match the immutable source evidence"));
        }
    }
    Ok(())
}

fn expected_reference_formulation_evidence(target_key: &str, source: &serde_json::Value) -> Option<serde_json::Value> {
    for (index, candidate) in source.get("identityCandidates")?.as_array()?.iter().enumerate() {
        let field = candidate.get("field")?.as_str()?;
        let key = format!("identity:{field}:{index}");
        if key == target_key {
            let evidence = candidate.get("evidence")?.as_array()?.first()?;
            let mut expected = serde_json::json!({
                "targetType": "identity", "targetKey": key,
                "fieldPath": format!("identityCandidates[{index}].{field}"),
                "sourceValue": candidate.get("rawValue")?,
                "evidenceExcerpt": evidence.get("excerpt")?,
            });
            merge_evidence_location(&mut expected, evidence);
            return Some(expected);
        }
    }
    let ingredient_fields = ["ingredientName", "supplierProductCode", "inciOrChemicalName", "function", "phase", "amount", "unit", "basis"];
    for line in source.get("ingredientLines")?.as_array()? {
        let line_id = line.get("id")?.as_str()?;
        for field in ingredient_fields {
            let key = format!("ingredient:{line_id}:{field}");
            let Some(value) = line.get(field) else { continue };
            if key == target_key {
                return Some(serde_json::json!({
                    "targetType": "ingredient", "targetKey": key,
                    "fieldPath": format!("ingredientLines[{line_id}].{field}"),
                    "sourceValue": value.get("rawValue")?,
                    "evidenceExcerpt": line.get("rawRow")?.as_array()?.iter().map(|v| v.as_str().unwrap_or_default()).collect::<Vec<_>>().join(" | "),
                    "pageNumber": value.get("evidence")?.get("pageNumber")?,
                    "blockIndex": value.get("evidence")?.get("blockIndex")?,
                    "rowIndex": value.get("evidence")?.get("rowIndex")?,
                    "cellIndex": value.get("evidence")?.get("cellIndex")?,
                }));
            }
        }
    }
    for step in source.get("procedureSteps")?.as_array()? {
        let step_id = step.get("id")?.as_str()?;
        let instruction_key = format!("procedure:{step_id}:instruction");
        if instruction_key == target_key {
            let evidence = step.get("evidence")?;
            let mut expected = serde_json::json!({
                "targetType": "procedure", "targetKey": instruction_key,
                "fieldPath": format!("procedureSteps[{step_id}].rawInstruction"),
                "sourceValue": step.get("rawInstruction")?,
                "evidenceExcerpt": evidence.get("excerpt")?,
            });
            merge_evidence_location(&mut expected, evidence);
            return Some(expected);
        }
        for (index, condition) in step.get("conditions")?.as_array()?.iter().enumerate() {
            let key = format!("procedure:{step_id}:condition:{index}");
            if key == target_key {
                let evidence = condition.get("evidence")?;
                let mut expected = serde_json::json!({
                    "targetType": "procedure", "targetKey": key,
                    "fieldPath": format!("procedureSteps[{step_id}].conditions[{index}]"),
                    "sourceValue": condition.get("rawValue")?,
                    "evidenceExcerpt": evidence.get("excerpt")?,
                });
                merge_evidence_location(&mut expected, evidence);
                return Some(expected);
            }
        }
    }
    for candidate in source.get("targetCandidates")?.as_array()? {
        let id = candidate.get("id")?.as_str()?;
        let key = format!("target:{id}");
        if key == target_key {
            let field = candidate.get("field")?.as_str()?;
            let evidence = candidate.get("evidence")?;
            let mut expected = serde_json::json!({
                "targetType": "target", "targetKey": key,
                "fieldPath": format!("targetCandidates[{id}].{field}"),
                "sourceValue": candidate.get("rawValue")?,
                "evidenceExcerpt": evidence.get("excerpt")?,
            });
            merge_evidence_location(&mut expected, evidence);
            return Some(expected);
        }
    }
    None
}

fn merge_evidence_location(expected: &mut serde_json::Value, evidence: &serde_json::Value) {
    if let Some(object) = expected.as_object_mut() {
        for field in ["pageNumber", "blockIndex", "rowIndex", "cellIndex"] {
            if let Some(value) = evidence.get(field) {
                object.insert(field.to_string(), value.clone());
            }
        }
    }
}

fn now_rfc3339_utc() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let seconds = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    year += if month <= 2 { 1 } else { 0 };
    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// FVL-04.016 hardening (Session 7, Part M) — the real merge/append-only-
/// rejection logic, factored out of the async Tauri command so it can be
/// unit-tested directly against disposable in-memory rows, never a real
/// `data/master` file and never a full Tauri runtime. `upsert_master_records`
/// itself is not directly unit-testable (it requires a real `AppHandle`),
/// but this is the actual decision logic that command delegates to — the
/// deepest pure function that enforces "a mapping_profiles record with an
/// existing `code` is rejected, a genuinely new `code` is accepted."
fn apply_upsert(
    mut rows: Vec<serde_json::Value>,
    records: Vec<serde_json::Value>,
    append_only: bool,
    name: &str,
) -> Result<(Vec<serde_json::Value>, usize, usize), String> {
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

    Ok((rows, inserted, updated))
}

/// Remove a row by code. Refused on append-only collections.
fn ensure_master_delete_allowed(name: &str, append_only: bool) -> Result<(), String> {
    if append_only {
        return Err(format!(
            "{name} is append-only: deleting a historical record would change what a past snapshot was based on. Supersede it with a new record instead."
        ));
    }
    Ok(())
}
///
/// Materials are deactivated rather than deleted in the UI; this command exists
/// for genuinely mistaken rows, and it snapshots the file first.
/// Phase 13 Session 4 finding (architecture doc §9.3/Risks): §6's approved
/// matrix, transcribed literally, grants the `delete` capability to no role
/// in ANY domain content area (`rawMaterials`/`formulation`/`laboratory`/
/// `stability`/`regulatory`/`optimization`/`dataExchange`/`documentControl`
/// all deny `delete` to every one of the 12 roles, `administrator`
/// included) — the only cell anywhere in the whole matrix that grants
/// `delete` at all is `projects`/`administrator`. Gating this destructive,
/// snapshot-first, "genuinely mistaken rows" operation (see its own doc
/// comment below) against `rawMaterials`/`formulation`/etc. `delete` would
/// make it unreachable for every role, including administrator — not a
/// safety improvement, just a broken feature. Using the one real `delete`
/// grant the approved matrix does contain (`projects`, administrator-only)
/// instead is a deliberate, documented Session 4 choice, not a matrix
/// change: it makes master-record deletion an administrative action until
/// the domain review (Risks item 1) decides whether any area should grant
/// `delete` to a working-tier role directly.
#[tauri::command(async)]
pub async fn delete_master_record(
    app: AppHandle,
    token: String,
    collection: String,
    code: String,
) -> Result<serde_json::Value, String> {
    let (name, append_only) = collection_spec(&collection)?;
    authz::authorize_app(&app, &token, "projects", "delete")?;
    ensure_master_delete_allowed(name, append_only)?;
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
    token: String,
    collection: String,
) -> Result<String, String> {
    authz::current_actor_app(&app, &token)?;
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

/// Migration-only: overwrites an entire collection file, including an
/// append-only one, bypassing `upsert_master_records`'s refusal to update
/// an existing key.
///
/// That refusal exists to stop an ordinary edit from quietly rewriting
/// history; a schema migration is a different, deliberately-gated
/// operation — by the time `apps/desktop/src/lib/migrationRunner.ts` calls
/// this, a verified pre-migration backup already exists (created via
/// `backup::try_create_backup` and checked with `verify_backup_report`),
/// so the "no destructive mutation without a recovery point" rule this
/// project follows is satisfied by that backup, not by this function
/// refusing to write. Never exposed to, or intended for, ordinary
/// import/edit flows — those still go through `upsert_master_records`.
#[tauri::command(async)]
pub async fn write_master_collection_raw(
    app: AppHandle,
    token: String,
    collection: String,
    records: Vec<serde_json::Value>,
) -> Result<(), String> {
    let (name, _) = collection_spec(&collection)?;
    ensure_generic_collection_write_allowed(name)?;
    let area = area_for_collection(name)
        .ok_or_else(|| format!("{name} has no policy area mapping and cannot be written"))?;
    authz::authorize_any_app(&app, &token, area, &WRITE_CAPABILITIES)?;
    let path = collection_path(&app, name)?;
    write_array(&path, &records)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOSSIER_COLLECTIONS: [(&str, bool); 8] = [
        ("regulatory_dossiers", false),
        ("regulatory_dossier_requirements", true),
        ("regulatory_evidence_items", false),
        ("regulatory_requirement_evidence_links", true),
        ("regulatory_dossier_reviews", true),
        ("regulatory_dossier_review_revocations", true),
        ("regulatory_dossier_submissions", false),
        ("regulatory_dossier_manual_requirement_actions", true),
    ];

    #[test]
    fn all_eight_dossier_collections_are_allow_listed_with_the_designed_mutability() {
        for (name, append_only) in DOSSIER_COLLECTIONS {
            assert_eq!(
                collection_spec(name),
                Ok((name, append_only)),
                "{name} should be allow-listed as append_only={append_only}"
            );
        }
    }

    const CLAIMS_LABELS_COLLECTIONS: [(&str, bool); 9] = [
        ("product_claims", false),
        ("claim_evidence_links", true),
        ("claim_reviews", true),
        ("claim_review_revocations", true),
        ("product_labels", false),
        ("label_content_blocks", true),
        ("label_artworks", false),
        ("label_reviews", true),
        ("label_review_revocations", true),
    ];

    #[test]
    fn all_nine_claims_and_labels_collections_are_allow_listed_with_the_designed_mutability() {
        for (name, append_only) in CLAIMS_LABELS_COLLECTIONS {
            assert_eq!(
                collection_spec(name),
                Ok((name, append_only)),
                "{name} should be allow-listed as append_only={append_only}"
            );
        }
    }

    const DOE_COLLECTIONS: [(&str, bool); 10] = [
        ("doe_studies", false),
        ("doe_factors", false),
        ("doe_constraints", false),
        ("doe_responses", false),
        ("doe_designs", false),
        ("doe_runs", false),
        ("doe_observations", false),
        ("doe_analyses", true),
        ("doe_candidates", false),
        ("doe_review_actions", true),
    ];

    #[test]
    fn all_ten_doe_collections_are_allow_listed_with_the_designed_mutability() {
        for (name, append_only) in DOE_COLLECTIONS {
            assert_eq!(
                collection_spec(name),
                Ok((name, append_only)),
                "{name} should be allow-listed as append_only={append_only}"
            );
        }
    }

    const DATA_EXCHANGE_COLLECTIONS: [(&str, bool); 9] = [
        ("product_families", false),
        ("finished_products", false),
        ("material_documents", false),
        ("process_parameters", false),
        ("formula_cost_overrides", true),
        ("data_exchange_import_jobs", false),
        ("data_exchange_import_row_results", true),
        ("data_exchange_export_jobs", true),
        ("data_exchange_schema_versions", true),
    ];

    #[test]
    fn all_nine_data_exchange_collections_are_allow_listed_with_the_designed_mutability() {
        for (name, append_only) in DATA_EXCHANGE_COLLECTIONS {
            assert_eq!(
                collection_spec(name),
                Ok((name, append_only)),
                "{name} should be allow-listed as append_only={append_only}"
            );
        }
    }

    // Phase 7 — Reverse Formulation. Studies/benchmark products/target
    // profiles/constraint sets/declaration lines/mappings/substitution
    // rules/candidates are mutable status-lifecycle rows (matching
    // `regulatory_evidence_items`/`doe_observations`/`doe_candidates`).
    // Analytical composition results are lab measurements, append-only like
    // `test_results`/`stability_results`. Candidate score explanations are a
    // computed snapshot of one scoring pass, append-only like
    // `doe_analyses`/`compatibility_snapshots`/`optimization_runs`.
    const REVERSE_FORMULATION_COLLECTIONS: [(&str, bool); 11] = [
        ("reverse_formulation_studies", false),
        ("benchmark_products", false),
        ("benchmark_evidence_items", false),
        ("ingredient_declaration_lines", false),
        ("analytical_composition_results", true),
        ("target_product_profiles", false),
        ("reverse_constraint_sets", false),
        ("ingredient_mappings", false),
        ("substitution_rules", false),
        ("reverse_formula_candidates", false),
        ("candidate_score_explanations", true),
    ];

    #[test]
    fn all_eleven_reverse_formulation_collections_are_allow_listed_with_the_designed_mutability() {
        for (name, append_only) in REVERSE_FORMULATION_COLLECTIONS {
            assert_eq!(
                collection_spec(name),
                Ok((name, append_only)),
                "{name} should be allow-listed as append_only={append_only}"
            );
        }
    }

    #[test]
    fn reverse_formulation_append_only_collections_cannot_be_treated_as_mutable() {
        for (name, append_only) in REVERSE_FORMULATION_COLLECTIONS {
            if append_only {
                let (_, actual) = collection_spec(name).unwrap();
                assert!(actual, "{name} must stay append_only=true, not be treated as mutable");
            }
        }
    }

    #[test]
    fn generated_document_records_is_allow_listed_as_mutable() {
        // Phase 8 — status changes in place (generating -> succeeded/
        // failed/cancelled), keyed by `id` (no separate `code`), same as
        // `regulatory_evidence_items`/`doe_observations`.
        assert_eq!(
            collection_spec("generated_document_records"),
            Ok(("generated_document_records", false)),
        );
    }

    #[test]
    fn apply_upsert_rejects_a_second_write_reusing_an_existing_append_only_code() {
        // FVL-04.016 hardening (Session 7, Part M) — the real merge logic,
        // proven directly against disposable in-memory rows: a
        // mapping_profiles-shaped record with code "P::v1" already present,
        // and a second incoming record reusing that exact code, is
        // rejected outright — real behavior, not merely a metadata
        // assertion about the collection's own append_only flag.
        let existing = vec![serde_json::json!({"code": "P::v1", "profileVersion": 1})];
        let incoming = vec![serde_json::json!({"code": "P::v1", "profileVersion": 1, "fieldMappings": []})];
        let result = apply_upsert(existing, incoming, true, "mapping_profiles");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn apply_upsert_accepts_a_genuinely_new_append_only_code() {
        let existing = vec![serde_json::json!({"code": "P::v1"})];
        let incoming = vec![serde_json::json!({"code": "P::v2"})];
        let (rows, inserted, updated) = apply_upsert(existing, incoming, true, "mapping_profiles").unwrap();
        assert_eq!(inserted, 1);
        assert_eq!(updated, 0);
        assert_eq!(rows.len(), 2);
        // v1's own row is still there, byte-for-byte, never rewritten.
        assert_eq!(rows[0], serde_json::json!({"code": "P::v1"}));
    }

    #[test]
    fn apply_upsert_updates_in_place_for_a_mutable_collection() {
        let existing = vec![serde_json::json!({"code": "X", "lastSeenAt": "2026-01-01"})];
        let incoming = vec![serde_json::json!({"code": "X", "lastSeenAt": "2026-02-01"})];
        let (rows, inserted, updated) = apply_upsert(existing, incoming, false, "external_id_crosswalks").unwrap();
        assert_eq!(inserted, 0);
        assert_eq!(updated, 1);
        assert_eq!(rows[0]["lastSeenAt"], "2026-02-01");
    }

    #[test]
    fn mapping_profiles_is_allow_listed_as_append_only() {
        // FVL-04.013-.018 hardening (D1/D2, Session 6) — a mapping
        // profile's immutable storage identity is the composite
        // `code = "${profileId}::v${profileVersion}"`; append_only=true
        // means `upsert_master_records` rejects any second write reusing
        // an existing version's own `code`, enforced by the storage layer
        // itself (see the same rejection branch every other append-only
        // collection — `material_prices`/`exchange_rates` — already uses).
        assert_eq!(collection_spec("mapping_profiles"), Ok(("mapping_profiles", true)));
    }

    #[test]
    fn external_id_crosswalks_is_allow_listed_as_mutable() {
        // A crosswalk's `lastSeenAt` genuinely updates in place on
        // re-import (same source identity resolving to the same canonical
        // identity again) — `firstSeenAt`/`canonicalRecordId` never
        // silently change once set, enforced by `engine/crosswalk.ts`'s
        // own conflict detection (a conflicting write is never persisted
        // at all), not by append-only storage semantics.
        assert_eq!(collection_spec("external_id_crosswalks"), Ok(("external_id_crosswalks", false)));
    }

    #[test]
    fn collection_count_matches_the_fixed_array_length() {
        // Regression guard for the array-length/entry-count mismatch this
        // session repaired: COLLECTIONS must declare exactly as many slots
        // as it has entries.
        assert_eq!(COLLECTIONS.len(), 101);
    }

    #[test]
    fn supplier_document_acquisitions_are_allow_listed_and_append_only() {
        assert_eq!(
            collection_spec("supplier_document_acquisitions"),
            Ok(("supplier_document_acquisitions", true))
        );
        let first = serde_json::json!({ "code": "supplierdoc-v1", "sha256": "a".repeat(64) });
        let (rows, inserted, updated) = apply_upsert(
            vec![],
            vec![first.clone()],
            true,
            "supplier_document_acquisitions",
        )
        .unwrap();
        assert_eq!((inserted, updated), (1, 0));
        assert!(apply_upsert(
            rows.clone(),
            vec![first],
            true,
            "supplier_document_acquisitions"
        )
        .unwrap_err()
        .contains("already exists"));
        assert!(ensure_master_delete_allowed("supplier_document_acquisitions", true).is_err());
        let (rows, inserted, updated) = apply_upsert(
            rows,
            vec![serde_json::json!({ "code": "supplierdoc-v2", "sha256": "b".repeat(64) })],
            true,
            "supplier_document_acquisitions",
        )
        .unwrap();
        assert_eq!((inserted, updated), (1, 0));
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn reference_formulations_are_allow_listed_and_append_only() {
        assert_eq!(
            collection_spec("reference_formulations"),
            Ok(("reference_formulations", true))
        );
        assert!(ensure_master_delete_allowed("reference_formulations", true).is_err());
        let first = serde_json::json!({ "code": "reference-formula-v1", "sourceDocumentHash": "a".repeat(64) });
        let (rows, inserted, updated) = apply_upsert(
            vec![],
            vec![first.clone()],
            true,
            "reference_formulations",
        )
        .unwrap();
        assert_eq!((inserted, updated), (1, 0));
        assert!(apply_upsert(
            rows.clone(),
            vec![first],
            true,
            "reference_formulations"
        )
        .unwrap_err()
        .contains("already exists"));
        let (rows, inserted, updated) = apply_upsert(
            rows,
            vec![serde_json::json!({ "code": "reference-formula-v2", "sourceDocumentHash": "b".repeat(64) })],
            true,
            "reference_formulations",
        )
        .unwrap();
        assert_eq!((inserted, updated), (1, 0));
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn reference_formulation_reviews_are_only_writable_through_the_dedicated_append_command() {
        assert_eq!(collection_spec("reference_formulation_reviews"), Ok(("reference_formulation_reviews", true)));
        assert!(ensure_generic_collection_write_allowed("reference_formulation_reviews").is_err());
        let review = serde_json::json!({ "id": "review-1", "decision": "accepted" });
        let (rows, inserted, updated) = apply_upsert(vec![], vec![review.clone()], true, "reference_formulation_reviews").unwrap();
        assert_eq!((inserted, updated), (1, 0));
        assert!(apply_upsert(rows, vec![review], true, "reference_formulation_reviews").is_err());
    }

    #[test]
    fn reference_formulation_review_identity_is_stamped_and_edit_decisions_are_validated() {
        let payload = serde_json::json!({
            "schemaVersion": "1.0",
            "id": "review-1",
            "code": "review-1",
            "referenceFormulationRecordId": "reference-1",
            "sourceDocumentHash": "a".repeat(64),
            "targetType": "identity",
            "targetKey": "identity:formulation_code:0",
            "fieldPath": "identityCandidates[0].formulation_code",
            "sourceValue": "HC/DW/22",
            "evidenceExcerpt": "Formulation HC/DW/22",
            "pageNumber": 1,
            "blockIndex": 4,
            "reviewedAt": "2000-01-01T00:00:00Z",
            "decision": "accepted",
            "reviewer": { "userId": "spoofed", "displayName": "Spoofed" }
        });
        let stamped = stamp_reference_formulation_review(payload, "trusted-user", "Trusted Reviewer", "2026-10-26T10:00:00Z").unwrap();
        assert_eq!(stamped["reviewer"]["userId"], "trusted-user");
        assert_eq!(stamped["reviewer"]["displayName"], "Trusted Reviewer");
        assert_eq!(stamped["reviewedAt"], "2026-10-26T10:00:00Z");
        assert!(stamp_reference_formulation_review(
            serde_json::json!({
                "schemaVersion": "1.0", "id": "r", "code": "r",
                "referenceFormulationRecordId": "f", "sourceDocumentHash": "a".repeat(64),
                "targetType": "ingredient", "targetKey": "r1", "fieldPath": "amount",
                "sourceValue": "10%", "evidenceExcerpt": "row", "reviewedAt": "2026-10-26T10:00:00Z",
                "decision": "edited"
            }), "u", "Reviewer", "2026-10-26T10:00:00Z"
        ).unwrap_err().contains("require a proposed value"));
        assert!(stamp_reference_formulation_review(
            serde_json::json!({
                "schemaVersion": "1.0", "id": "r", "code": "r",
                "referenceFormulationRecordId": "f", "sourceDocumentHash": "a".repeat(64),
                "targetType": "ingredient", "targetKey": "r1", "fieldPath": "amount",
                "sourceValue": "10%", "evidenceExcerpt": "row", "reviewedAt": "2026-10-26T10:00:00Z",
                "decision": "accepted", "reviewedValue": "tampered"
            }), "u", "Reviewer", "2026-10-26T10:00:00Z"
        ).unwrap_err().contains("only edited decisions"));
        let source = serde_json::json!({
            "identityCandidates": [{
                "field": "formulation_code", "rawValue": "HC/DW/22",
                "evidence": [{ "excerpt": "Formulation HC/DW/22", "pageNumber": 1, "blockIndex": 4 }]
            }]
        });
        validate_review_evidence(&stamped, &source).unwrap();
        let mut forged = stamped.clone();
        forged["evidenceExcerpt"] = serde_json::json!("invented evidence");
        assert!(validate_review_evidence(&forged, &source).unwrap_err().contains("immutable source evidence"));
        assert!(ensure_generic_collection_write_allowed("reference_formulation_reviews").is_err());
        assert!(ensure_generic_collection_write_allowed("reference_formulations").is_ok());
    }

    #[test]
    fn supplier_acquisition_job_collections_are_allow_listed_and_mutable() {
        assert_eq!(
            collection_spec("supplier_acquisition_jobs"),
            Ok(("supplier_acquisition_jobs", false))
        );
        assert_eq!(
            collection_spec("supplier_acquisition_job_items"),
            Ok(("supplier_acquisition_job_items", false))
        );
        let queued = serde_json::json!({ "id": "job-1", "status": "queued" });
        let (rows, inserted, updated) = apply_upsert(
            vec![],
            vec![queued],
            false,
            "supplier_acquisition_jobs",
        )
        .unwrap();
        assert_eq!((inserted, updated), (1, 0));
        let (rows, inserted, updated) = apply_upsert(
            rows,
            vec![serde_json::json!({ "id": "job-1", "status": "downloading" })],
            false,
            "supplier_acquisition_jobs",
        )
        .unwrap();
        assert_eq!((inserted, updated), (0, 1));
        assert_eq!(rows[0]["status"], "downloading");
    }

    #[test]
    fn alternative_rankings_and_predictive_models_are_allow_listed_append_only() {
        assert_eq!(collection_spec("alternative_rankings"), Ok(("alternative_rankings", true)));
        assert_eq!(collection_spec("predictive_models"), Ok(("predictive_models", true)));
    }

    #[test]
    fn alternative_rankings_first_insert_is_accepted() {
        let (rows, inserted, updated) = apply_upsert(
            vec![], vec![serde_json::json!({"code": "ranking-v1", "version": 1})], true, "alternative_rankings",
        ).unwrap();
        assert_eq!((inserted, updated), (1, 0));
        assert_eq!(rows, vec![serde_json::json!({"code": "ranking-v1", "version": 1})]);
    }

    #[test]
    fn alternative_rankings_reject_same_identity_overwrite() {
        let result = apply_upsert(
            vec![serde_json::json!({"code": "ranking-v1", "version": 1})],
            vec![serde_json::json!({"code": "ranking-v1", "version": 2})],
            true,
            "alternative_rankings",
        );
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn alternative_rankings_accept_a_new_snapshot_identity() {
        let (rows, inserted, updated) = apply_upsert(
            vec![serde_json::json!({"code": "ranking-v1"})],
            vec![serde_json::json!({"code": "ranking-v2"})],
            true,
            "alternative_rankings",
        ).unwrap();
        assert_eq!((inserted, updated), (1, 0));
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], serde_json::json!({"code": "ranking-v1"}));
    }

    #[test]
    fn alternative_rankings_delete_is_refused() {
        assert!(ensure_master_delete_allowed("alternative_rankings", true).is_err());
    }

    #[test]
    fn predictive_models_first_insert_is_accepted() {
        let (rows, inserted, updated) = apply_upsert(
            vec![],
            vec![serde_json::json!({"id": "model-v1", "version": 1})],
            true,
            "predictive_models",
        ).unwrap();
        assert_eq!((inserted, updated), (1, 0));
        assert_eq!(rows, vec![serde_json::json!({"id": "model-v1", "version": 1})]);
    }

    #[test]
    fn predictive_models_reject_same_identity_overwrite() {
        let result = apply_upsert(
            vec![serde_json::json!({"id": "model-v1", "version": 1})],
            vec![serde_json::json!({"id": "model-v1", "version": 2})],
            true,
            "predictive_models",
        );
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn predictive_models_accept_a_new_model_identity() {
        let (rows, inserted, updated) = apply_upsert(
            vec![serde_json::json!({"id": "model-v1", "version": 1})],
            vec![serde_json::json!({"id": "model-v2", "version": 2})],
            true,
            "predictive_models",
        ).unwrap();
        assert_eq!((inserted, updated), (1, 0));
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["version"], 1);
    }

    #[test]
    fn predictive_models_delete_is_refused() {
        let error = ensure_master_delete_allowed("predictive_models", true).unwrap_err();
        assert!(error.contains("append-only"));
    }

    #[test]
    fn list_master_collections_matches_the_real_allow_list_exactly() {
        let listed = list_master_collections();
        assert_eq!(listed.len(), COLLECTIONS.len());
        for (name, append_only) in COLLECTIONS {
            assert!(
                listed.iter().any(|(n, a)| n == name && *a == append_only),
                "{name} missing or mismatched in list_master_collections()"
            );
        }
    }

    #[test]
    fn laboratory_standards_and_methods_are_allow_listed_as_mutable() {
        // Phase 10 Session 1A — status changes in place
        // (draft -> active -> superseded), historical results reference a
        // row via an embedded snapshot rather than a second collection.
        assert_eq!(collection_spec("laboratory_standards"), Ok(("laboratory_standards", false)));
        assert_eq!(collection_spec("laboratory_test_methods"), Ok(("laboratory_test_methods", false)));
    }

    #[test]
    fn no_collection_name_is_registered_twice() {
        let mut names: Vec<&str> = COLLECTIONS.iter().map(|(n, _)| *n).collect();
        let total = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), total, "COLLECTIONS contains a duplicate name");
    }

    #[test]
    fn unknown_collection_name_is_rejected() {
        assert!(collection_spec("regulatory_dossier_typo").is_err());
        assert!(collection_spec("../../etc/passwd").is_err());
        // Reverse Formulation names are snake_case on this side of the
        // boundary; the TypeScript-side camelCase spelling must not be
        // silently accepted as an alias.
        assert!(collection_spec("reverseFormulationStudies").is_err());
        assert!(collection_spec("reverse_formulation_studies_typo").is_err());
    }

    /// `read_array`/`write_array` hold no in-memory state between calls — each
    /// call re-reads/rewrites the file on disk. Dropping the value and reading
    /// it back through a fresh call is exactly what a real app restart does,
    /// so this is a genuine (AppHandle-free) persistence-survives-restart test
    /// for the write-then-rename path the new dossier collections share with
    /// every other master-data collection.
    #[test]
    fn write_then_read_survives_a_simulated_restart() {
        let dir = std::env::temp_dir().join(format!(
            "formulab-masterdata-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("regulatory_dossiers.json");

        let rows = vec![serde_json::json!({
            "id": "dossier-1",
            "dossierCode": "DOS-1",
            "status": "draft",
        })];
        write_array(&path, &rows).unwrap();

        // Simulate restart: nothing in memory carries over, only the file.
        let reloaded = read_array(&path);
        assert_eq!(reloaded, rows);

        // A second write-then-read (as an upsert would do) still round-trips.
        let mut rows2 = reloaded.clone();
        rows2.push(serde_json::json!({
            "id": "dossier-2",
            "dossierCode": "DOS-2",
            "status": "in_preparation",
        }));
        write_array(&path, &rows2).unwrap();
        assert_eq!(read_array(&path), rows2);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_file_reads_as_an_empty_collection_rather_than_erroring() {
        let path = std::env::temp_dir().join("formulab-masterdata-test-does-not-exist.json");
        assert_eq!(read_array(&path), Vec::<serde_json::Value>::new());
    }

    // ------------------------------------------- Session 4: authorization ---

    #[test]
    fn every_allow_listed_collection_has_a_policy_area_mapping() {
        // The generic-CRUD authorization gate is only as strong as this
        // mapping's coverage — a collection present in COLLECTIONS but
        // missing from area_for_collection would deny writes to it (safe),
        // but this test exists to make an unmapped name a loud, intentional
        // finding rather than a silently-discovered support ticket.
        let unmapped: Vec<&str> = COLLECTIONS
            .iter()
            .map(|(name, _)| *name)
            .filter(|name| area_for_collection(name).is_none())
            .collect();
        assert!(unmapped.is_empty(), "collections with no policy area mapping (writes to them are denied to everyone): {unmapped:?}");
    }

    #[test]
    fn an_unknown_collection_name_has_no_policy_area() {
        assert_eq!(area_for_collection("not_a_real_collection"), None);
        assert_eq!(area_for_collection(""), None);
    }

    #[test]
    fn representative_collections_map_to_the_expected_domain_area() {
        assert_eq!(area_for_collection("materials"), Some("rawMaterials"));
        assert_eq!(area_for_collection("stability_studies"), Some("stability"));
        assert_eq!(area_for_collection("test_results"), Some("laboratory"));
        assert_eq!(area_for_collection("regulatory_rules"), Some("regulatory"));
        assert_eq!(area_for_collection("product_claims"), Some("regulatory"));
        assert_eq!(area_for_collection("doe_studies"), Some("optimization"));
        assert_eq!(area_for_collection("data_exchange_import_jobs"), Some("dataExchange"));
        assert_eq!(area_for_collection("generated_document_records"), Some("documentControl"));
    }

    #[test]
    fn write_capability_check_accepts_create_or_edit_and_rejects_view_only() {
        // raw_material has create+edit on rawMaterials; procurement has
        // only create (no edit) on rawMaterials per the approved matrix —
        // both must pass the OR check. regulatory has only view on
        // rawMaterials and must be rejected.
        for role in ["raw_material", "procurement"] {
            assert!(
                WRITE_CAPABILITIES.iter().any(|cap| crate::role_policy::can(role, "rawMaterials", cap)),
                "{role} should be able to write rawMaterials"
            );
        }
        assert!(!WRITE_CAPABILITIES.iter().any(|cap| crate::role_policy::can("regulatory", "rawMaterials", cap)));
    }
}
