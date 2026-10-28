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
use std::{path::PathBuf, sync::Mutex};

use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::authz;

static REFERENCE_FORMULATION_NORMALIZATION_WRITE_LOCK: Mutex<()> = Mutex::new(());
static REFERENCE_FORMULATION_REVIEW_WRITE_LOCK: Mutex<()> = Mutex::new(());
static SUPPLIER_SDS_EVIDENCE_WRITE_LOCK: Mutex<()> = Mutex::new(());
static SUPPLIER_PRODUCT_EVIDENCE_WRITE_LOCK: Mutex<()> = Mutex::new(());
static SUPPLIER_PRODUCT_CLAIM_REVIEW_WRITE_LOCK: Mutex<()> = Mutex::new(());
static IDENTITY_FIELD_REVIEW_WRITE_LOCK: Mutex<()> = Mutex::new(());
static SUPPLIER_DOCUMENT_ACQUISITION_WRITE_LOCK: Mutex<()> = Mutex::new(());
static REFERENCE_FORMULATION_SOURCE_WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Collections the UI may address, and whether history is preserved.
///
/// An explicit allow-list rather than a free-text filename: the collection name
/// arrives from the webview, and joining untrusted text onto a path is how a
/// renderer bug becomes an arbitrary file write.
const COLLECTIONS: [(&str, bool); 107] = [
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
    ("supplier_sds_product_evidence", true),
    ("supplier_product_evidence", true),
    // Named human decisions on supplier evidence are immutable and appended
    // through the dedicated command, never through generic collection writes.
    ("identity_field_reviews", true),
    // Supplier formulation extraction snapshots are immutable reference
    // evidence, separate from production Formulation/FormulationVersion.
    ("reference_formulations", true),
    // Human parser decisions are separate append-only review events; they
    // never mutate the source snapshot or promote data into production.
    ("reference_formulation_reviews", true),
    // Versioned product/chemistry links remain separate from original source lines.
    ("reference_formulation_normalizations", true),
    // Bulk source ingestion progress is mutable operational state; source documents,
    // acquisitions, and extracted formulation snapshots remain in their own records.
    ("reference_formulation_import_jobs", false),
    ("reference_formulation_import_files", false),
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
/// 103 collection names (V01-01.009). It is now a thin delegator to
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
    let path = collection_path(&app, name)?;
    let rows = read_array(&path);
    let actor = authorize_masterdata_records(&app, &token, name, area, &rows, &records)?;
    let records = validate_verified_rule_writes(name, &rows, records, &actor.role)?;
    let records = if name == "safety_resolutions" {
        records
            .into_iter()
            .map(|record| stamp_safety_resolution(record, &actor))
            .collect::<Result<Vec<_>, _>>()?
    } else {
        records
    };
    let (rows, inserted, updated) = apply_upsert(rows, records, append_only, name)?;

    write_array(&path, &rows)?;
    Ok(serde_json::json!({
        "inserted": inserted,
        "updated": updated,
        "total": rows.len(),
    }))
}

/// Append supplier-document receipts only after verifying the content-addressed
/// PDF exists in this project and its bytes match the receipt SHA-256.
#[tauri::command(async)]
pub async fn append_supplier_document_acquisitions(
    app: AppHandle,
    token: String,
    records: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    authz::authorize_any_app(&app, &token, "rawMaterials", &WRITE_CAPABILITIES)?;
    let _guard = SUPPLIER_DOCUMENT_ACQUISITION_WRITE_LOCK.lock()
        .map_err(|_| "supplier document acquisition storage is unavailable".to_string())?;
    let data_root = crate::formulation_v2::project_data_dir(&app, "data")?;
    for record in &records {
        validate_supplier_document_acquisition_record(record)?;
        let hash = record["sha256"].as_str().unwrap_or_default();
        let bytes = crate::supplier_document_store::read_pdf_bytes(&data_root, hash)?;
        if bytes.len() as u64 != record["byteSize"].as_u64().unwrap_or(0) {
            return Err("supplier acquisition byte size does not match its stored PDF".to_string());
        }
    }
    let path = collection_path(&app, "supplier_document_acquisitions")?;
    let existing = read_array(&path);
    let pending = new_immutable_records(&existing, records, "supplier_document_acquisitions")?;
    let (rows, inserted, _) = apply_upsert(existing, pending, true, "supplier_document_acquisitions")?;
    write_array(&path, &rows)?;
    Ok(serde_json::json!({ "inserted": inserted, "updated": 0, "total": rows.len() }))
}

/// Append extracted formulation snapshots only when their source identity
/// exactly matches an already verified FORMULATION acquisition and stored PDF.
#[tauri::command(async)]
pub async fn append_reference_formulations(
    app: AppHandle,
    token: String,
    records: Vec<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    authz::authorize_any_app(&app, &token, "formulation", &WRITE_CAPABILITIES)?;
    let _guard = REFERENCE_FORMULATION_SOURCE_WRITE_LOCK.lock()
        .map_err(|_| "reference formulation storage is unavailable".to_string())?;
    let acquisition_path = collection_path(&app, "supplier_document_acquisitions")?;
    let acquisitions = read_array(&acquisition_path);
    let data_root = crate::formulation_v2::project_data_dir(&app, "data")?;
    for record in &records {
        let acquisition_code = record["source"]["acquisitionCode"].as_str()
            .ok_or_else(|| "reference formulation is missing its source acquisition".to_string())?;
        let acquisition = acquisitions.iter().find(|item| item["code"].as_str() == Some(acquisition_code))
            .ok_or_else(|| "reference formulation must cite a persisted supplier acquisition".to_string())?;
        validate_reference_formulation_source_record(record, acquisition)?;
        let hash = record["sourceDocumentHash"].as_str().unwrap_or_default();
        let bytes = crate::supplier_document_store::read_pdf_bytes(&data_root, hash)?;
        if bytes.len() as u64 != record["source"]["sourceByteSize"].as_u64().unwrap_or(0) {
            return Err("reference formulation byte size does not match its stored source PDF".to_string());
        }
    }
    let path = collection_path(&app, "reference_formulations")?;
    let existing = read_array(&path);
    let pending = new_immutable_records(&existing, records, "reference_formulations")?;
    let (rows, inserted, _) = apply_upsert(existing, pending, true, "reference_formulations")?;
    write_array(&path, &rows)?;
    Ok(serde_json::json!({ "inserted": inserted, "updated": 0, "total": rows.len() }))
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
    let source_acquisition_code = source["source"]["acquisitionCode"].as_str()
        .ok_or_else(|| "review source is missing its supplier acquisition link".to_string())?;
    let acquisitions = read_array(&collection_path(&app, "supplier_document_acquisitions")?);
    let acquisition = acquisitions.iter().find(|item| item["code"].as_str() == Some(source_acquisition_code))
        .ok_or_else(|| "review source must cite a persisted supplier acquisition".to_string())?;
    validate_supplier_document_acquisition_record(acquisition)?;
    validate_reference_formulation_source_record(source, acquisition)?;
    let data_root = crate::formulation_v2::project_data_dir(&app, "data")?;
    let bytes = crate::supplier_document_store::read_pdf_bytes(&data_root, source["sourceDocumentHash"].as_str().unwrap_or_default())?;
    if bytes.len() as u64 != acquisition["byteSize"].as_u64().unwrap_or(0) {
        return Err("review source PDF failed its persisted byte-size check".to_string());
    }
    validate_review_evidence(&review, source)?;
    if review["id"].as_str() != Some(reference_formulation_review_id(&review)?.as_str()) {
        return Err("review id and code must match the deterministic decision idempotency key".to_string());
    }

    let _guard = REFERENCE_FORMULATION_REVIEW_WRITE_LOCK
        .lock()
        .map_err(|_| "reference formulation review storage is unavailable".to_string())?;
    let path = collection_path(&app, "reference_formulation_reviews")?;
    let rows = read_array(&path);
    if let Some(existing) = rows.iter().find(|row| row["id"] == review["id"]) {
        if reference_formulation_review_retry_matches(existing, &review) {
            return Ok(existing.clone());
        }
        return Err("reference formulation review idempotency key conflicts with an existing decision".to_string());
    }
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

/// Append a candidate-only normalization version. Source links and candidate
/// product IDs are checked against the immutable formulation while a native
/// process lock serializes version allocation.
#[tauri::command(async)]
pub async fn append_reference_formulation_normalization(
    app: AppHandle,
    token: String,
    mut normalization: serde_json::Value,
) -> Result<serde_json::Value, String> {
    authz::authorize_any_app(&app, &token, "formulation", &WRITE_CAPABILITIES)?;
    let _guard = REFERENCE_FORMULATION_NORMALIZATION_WRITE_LOCK
        .lock()
        .map_err(|_| "normalization storage is unavailable".to_string())?;

    let source_id = normalization["referenceFormulationRecordId"]
        .as_str()
        .ok_or_else(|| "normalization is missing its source formulation identity".to_string())?;
    let source_path = collection_path(&app, "reference_formulations")?;
    let source_rows = read_array(&source_path);
    let source = source_rows.iter().find(|row| row["id"].as_str() == Some(source_id))
        .ok_or_else(|| "normalization source formulation was not found".to_string())?;
    let sds_evidence_path = collection_path(&app, "supplier_sds_product_evidence")?;
    let sds_evidence_rows = read_array(&sds_evidence_path);
    let acquisition_path = collection_path(&app, "supplier_document_acquisitions")?;
    let acquisition_rows = read_array(&acquisition_path);
    let path = collection_path(&app, "reference_formulation_normalizations")?;
    let rows = read_array(&path);
    let mut history = rows.iter()
        .filter(|row| row["referenceFormulationRecordId"].as_str() == Some(source_id))
        .cloned()
        .collect::<Vec<_>>();
    history.sort_by_key(|row| row["version"].as_u64().unwrap_or(0));
    validate_normalization_version(&normalization, source, &history, &sds_evidence_rows, &acquisition_rows)?;
    if let Some(object) = normalization.as_object_mut() {
        object.insert("createdAt".to_string(), serde_json::Value::String(now_rfc3339_utc()));
    }
    let (next_rows, inserted, _) = apply_upsert(
        rows,
        vec![normalization.clone()],
        true,
        "reference_formulation_normalizations",
    )?;
    if inserted != 1 {
        return Err("normalization version was not appended".to_string());
    }
    write_array(&path, &next_rows)?;
    Ok(normalization)
}

/// Persist extracted SDS facts as an immutable, explicitly unreviewed evidence snapshot.
#[tauri::command(async)]
pub async fn append_supplier_sds_product_evidence(
    app: AppHandle,
    token: String,
    mut evidence: serde_json::Value,
) -> Result<serde_json::Value, String> {
    authz::authorize_any_app(&app, &token, "rawMaterials", &WRITE_CAPABILITIES)?;
    let _guard = SUPPLIER_SDS_EVIDENCE_WRITE_LOCK
        .lock()
        .map_err(|_| "supplier SDS evidence storage is unavailable".to_string())?;
    let acquisition_code = evidence["acquisitionCode"].as_str()
        .ok_or_else(|| "SDS evidence is missing its acquisition identity".to_string())?;
    let acquisition_path = collection_path(&app, "supplier_document_acquisitions")?;
    let acquisition_rows = read_array(&acquisition_path);
    let acquisition = acquisition_rows.iter().find(|row| row["code"].as_str() == Some(acquisition_code))
        .ok_or_else(|| "SDS evidence must reference a persisted supplier document acquisition".to_string())?;
    validate_supplier_document_acquisition_record(acquisition)?;
    if acquisition["documentType"].as_str() != Some("SDS") {
        return Err("SDS evidence must reference an SDS acquisition".to_string());
    }
    let data_root = crate::formulation_v2::project_data_dir(&app, "data")?;
    let bytes = crate::supplier_document_store::read_pdf_bytes(&data_root, acquisition["sha256"].as_str().unwrap_or_default())?;
    if bytes.len() as u64 != acquisition["byteSize"].as_u64().unwrap_or(0) {
        return Err("SDS acquisition failed its persisted byte-size check".to_string());
    }
    let crosswalk_path = collection_path(&app, "external_id_crosswalks")?;
    let crosswalk_rows = read_array(&crosswalk_path);
    validate_supplier_sds_product_evidence_record(&evidence, acquisition, &crosswalk_rows)?;
    if let Some(object) = evidence.as_object_mut() {
        object.insert("createdAt".to_string(), serde_json::Value::String(now_rfc3339_utc()));
    }
    let path = collection_path(&app, "supplier_sds_product_evidence")?;
    let rows = read_array(&path);
    let (next_rows, inserted, _) = apply_upsert(rows, vec![evidence.clone()], true, "supplier_sds_product_evidence")?;
    if inserted != 1 {
        return Err("supplier SDS evidence was not appended".to_string());
    }
    write_array(&path, &next_rows)?;
    Ok(evidence)
}

/// Append citation-backed SDS/TDS claims and product-card versions. Documents
/// and card revisions share one append-only project collection so a card can
/// be rebuilt after restart without relying on renderer memory.
#[tauri::command(async)]
pub async fn append_supplier_product_evidence(
    app: AppHandle,
    token: String,
    mut evidence: serde_json::Value,
    mut card_version: serde_json::Value,
) -> Result<serde_json::Value, String> {
    authz::authorize_any_app(&app, &token, "rawMaterials", &WRITE_CAPABILITIES)?;
    let _guard = SUPPLIER_PRODUCT_EVIDENCE_WRITE_LOCK.lock()
        .map_err(|_| "supplier product evidence storage is unavailable".to_string())?;
    let path = collection_path(&app, "supplier_product_evidence")?;
    let rows = read_array(&path);
    if evidence["recordType"].as_str() != Some("document") || card_version["recordType"].as_str() != Some("card_version") {
        return Err("a product evidence update must include one document snapshot and one product-card version".to_string());
    }
    validate_supplier_product_document_evidence(&app, &evidence)?;
    if card_version["productCardId"] != evidence["productCardId"] {
        return Err("the new product-card version must belong to the extracted product card".to_string());
    }
    if let Some(previous_evidence) = rows.iter().find(|row| row["recordType"].as_str() == Some("document") && row["id"] == evidence["id"]) {
        let without_created_at = |mut value: serde_json::Value| {
            if let Some(object) = value.as_object_mut() { object.remove("createdAt"); }
            value
        };
        if without_created_at(previous_evidence.clone()) != without_created_at(evidence.clone()) {
            return Err("an existing immutable product-evidence identity cannot be reused for different extraction content".to_string());
        }
        let previous_card = rows.iter()
            .filter(|row| row["recordType"].as_str() == Some("card_version")
                && row["productCardId"] == evidence["productCardId"]
                && row["evidenceRecordIds"].as_array().is_some_and(|ids| ids.iter().any(|id| id == &evidence["id"])))
            .max_by_key(|row| row["version"].as_u64().unwrap_or(0))
            .ok_or_else(|| "persisted product evidence is missing its card-version receipt".to_string())?;
        return Ok(serde_json::json!({ "evidence": previous_evidence, "cardVersion": previous_card }));
    }
    if let Some(object) = evidence.as_object_mut() {
        object.insert("createdAt".to_string(), serde_json::Value::String(now_rfc3339_utc()));
    }
    let (rows_with_evidence, inserted_evidence, _) = apply_upsert(rows, vec![evidence.clone()], true, "supplier_product_evidence")?;
    if inserted_evidence != 1 { return Err("supplier product evidence was not appended".to_string()); }
    validate_supplier_product_card_version(&card_version, &rows_with_evidence)?;
    if let Some(object) = card_version.as_object_mut() {
        object.insert("createdAt".to_string(), serde_json::Value::String(now_rfc3339_utc()));
    }
    let (rows_with_card, inserted_card, _) = apply_upsert(rows_with_evidence, vec![card_version.clone()], true, "supplier_product_evidence")?;
    if inserted_card != 1 { return Err("supplier product card version was not appended".to_string()); }
    write_array(&path, &rows_with_card)?;
    Ok(serde_json::json!({ "evidence": evidence, "cardVersion": card_version }))
}

/// Append a named human's decision for one exact persisted product claim.
/// The document extraction and card are immutable; the caller cannot provide
/// reviewer identity or time, and no RawMaterial is created or changed.
#[tauri::command(async)]
pub async fn append_supplier_product_claim_review(
    app: AppHandle,
    token: String,
    mut review: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let actor = authz::authorize_any_app(&app, &token, "supplierDocuments", &WRITE_CAPABILITIES)
        .or_else(|_| authz::authorize_any_app(&app, &token, "rawMaterials", &WRITE_CAPABILITIES))?;
    let _guard = SUPPLIER_PRODUCT_CLAIM_REVIEW_WRITE_LOCK.lock()
        .map_err(|_| "supplier product claim review storage is unavailable".to_string())?;
    ensure_object_keys(&review, &["recordType", "schemaVersion", "id", "productCardId", "sourceEvidenceId", "claimId", "claimSnapshot", "decision", "decisionNote", "evidenceRefs", "reviewedBy", "reviewerRole", "reviewedAt", "supersedesReviewId"], "supplier product claim review")?;
    if review["recordType"].as_str() != Some("claim_review") || review["schemaVersion"].as_str() != Some("1.0")
        || !matches!(review["decision"].as_str(), Some("accepted" | "rejected" | "needs_review"))
        || ["id", "productCardId", "sourceEvidenceId", "claimId"].iter().any(|key| review[*key].as_str().map_or(true, |value| value.trim().is_empty()))
        || (review["decision"] != "accepted" && review["decisionNote"].as_str().map_or(true, |note| note.trim().is_empty()))
    {
        return Err("supplier product claim review is invalid".to_string());
    }
    let path = collection_path(&app, "supplier_product_evidence")?;
    let mut rows = read_array(&path);
    if rows.iter().any(|row| row["id"] == review["id"]) {
        return Err("supplier product claim review ID already exists".to_string());
    }
    let card_id = review["productCardId"].as_str().unwrap();
    let evidence_id = review["sourceEvidenceId"].as_str().unwrap();
    let claim_id = review["claimId"].as_str().unwrap();
    let source = rows.iter().find(|row| row["recordType"].as_str() == Some("document") && row["id"].as_str() == Some(evidence_id)
        && row["productCardId"].as_str() == Some(card_id)).ok_or_else(|| "review must cite the exact persisted product evidence snapshot".to_string())?;
    let claim = source["claims"].as_array().and_then(|claims| claims.iter().find(|claim| claim["id"].as_str() == Some(claim_id)))
        .ok_or_else(|| "review claim does not exist in the cited immutable evidence snapshot".to_string())?;
    if review["claimSnapshot"] != *claim {
        return Err("review snapshot must exactly match the persisted claim".to_string());
    }
    let card_contains_source = rows.iter().any(|row| row["recordType"].as_str() == Some("card_version")
        && row["productCardId"].as_str() == Some(card_id)
        && row["evidenceRecordIds"].as_array().map_or(false, |ids| ids.iter().any(|id| id.as_str() == Some(evidence_id)))
        && row["claimIds"].as_array().map_or(false, |ids| ids.iter().any(|id| id.as_str() == Some(claim_id))));
    if !card_contains_source { return Err("review claim is not linked by a persisted product-card version".to_string()); }
    let citations = claim["evidence"].as_array().ok_or_else(|| "source claim has no citations".to_string())?;
    let refs = review["evidenceRefs"].as_array().ok_or_else(|| "review must preserve source citations".to_string())?;
    let expected_refs = citations.iter().map(|citation| {
        let mut reference = format!("{}:p{}", citation["documentHash"].as_str().unwrap_or_default(), citation["pageNumber"].as_u64().unwrap_or_default());
        if let Some(line) = citation["lineNumber"].as_u64() { reference.push_str(&format!(":l{line}")); }
        reference
    }).collect::<Vec<_>>();
    if !supplier_product_review_citations_match(refs, &expected_refs) {
        return Err("review citations must exactly match the source claim citations".to_string());
    }
    let prior_review_ids = rows.iter().filter(|row| row["recordType"].as_str() == Some("claim_review")
        && row["productCardId"].as_str() == Some(card_id) && row["sourceEvidenceId"].as_str() == Some(evidence_id)
        && row["claimId"].as_str() == Some(claim_id)).filter_map(|row| row["id"].as_str()).collect::<Vec<_>>();
    let supersedes = review["supersedesReviewId"].as_str();
    match (prior_review_ids.last(), supersedes) {
        (None, None) => {},
        (Some(latest), Some(supersedes)) if latest == &supersedes => {},
        _ => return Err("a new decision must explicitly supersede the latest decision for this exact claim".to_string()),
    }
    review["reviewedBy"] = serde_json::Value::String(actor.user_id);
    review["reviewerRole"] = serde_json::Value::String(actor.role);
    review["reviewedAt"] = serde_json::Value::String(now_rfc3339_utc());
    rows.push(review.clone());
    write_array(&path, &rows)?;
    Ok(review)
}

fn supplier_product_review_citations_match(refs: &[serde_json::Value], expected: &[String]) -> bool {
    refs.len() == expected.len()
        && refs.iter().zip(expected).all(|(reference, expected)| reference.as_str() == Some(expected.as_str()))
}

fn validate_supplier_product_document_evidence(app: &AppHandle, record: &serde_json::Value) -> Result<(), String> {
    ensure_object_keys(record, &["recordType", "schemaVersion", "id", "acquisitionCode", "productCardId", "documentType", "documentHash", "parserVersion", "ocrVersion", "claims", "reviewStatus", "createdAt"], "supplier product document evidence")?;
    if record["schemaVersion"].as_str() != Some("1.0")
        || record["id"].as_str().map_or(true, str::is_empty)
        || record["productCardId"].as_str().map_or(true, str::is_empty)
        || record["parserVersion"].as_str().map_or(true, str::is_empty)
        || record["reviewStatus"].as_str() != Some("unreviewed")
        || record["claims"].as_array().is_none()
    {
        return Err("supplier product evidence snapshot is invalid or is not unreviewed".to_string());
    }
    let acquisition_code = record["acquisitionCode"].as_str().ok_or_else(|| "supplier product evidence is missing its document acquisition".to_string())?;
    let acquisition_path = collection_path(app, "supplier_document_acquisitions")?;
    let acquisitions = read_array(&acquisition_path);
    let acquisition = acquisitions.iter().find(|item| item["code"].as_str() == Some(acquisition_code))
        .ok_or_else(|| "supplier product evidence must reference a persisted acquisition".to_string())?;
    validate_supplier_document_acquisition_record(acquisition)?;
    let hash = acquisition["sha256"].as_str().unwrap_or_default();
    if record["documentType"].as_str() != acquisition["documentType"].as_str()
        || !["SDS", "TDS"].contains(&record["documentType"].as_str().unwrap_or_default())
        || record["documentHash"].as_str().map_or(true, |value| !value.eq_ignore_ascii_case(hash))
        || !is_sha256_hex(hash)
    {
        return Err("product evidence type and hash must match the exact acquired SDS or TDS".to_string());
    }
    let claims = record["claims"].as_array().unwrap();
    let mut claim_ids = std::collections::HashSet::new();
    let allowed_sds_fields = [
        "product_identifier", "product_chemical_nature", "product_cas", "product_ec", "supplier_material_number", "product_description", "recommended_use", "use_restrictions", "industry_sector", "emergency_contact",
        "substance_or_mixture", "disclosed_component_name", "disclosed_component_cas", "disclosed_component_ec", "disclosed_component_concentration",
        "component_m_factor", "component_specific_concentration_limit", "component_acute_toxicity_estimate", "composition_disclosure", "undisclosed_remainder",
        "handling", "handling_constraints", "storage", "storage_temperature", "storage_conditions", "storage_stability", "container_material_compatibility", "sds_shelf_life",
        "physical_state", "appearance", "color", "odor", "odor_threshold", "ph", "density", "relative_density", "viscosity", "solubility", "flash_point",
        "boiling_point", "melting_point", "freezing_point", "melting_freezing_point", "vapor_pressure", "vapor_density", "partition_coefficient", "molecular_weight", "other_physical_property",
        "regulatory_status", "chemical_safety_assessment", "other_regulatory_information",
    ];
    let allowed_tds_fields = [
        "active_matter", "total_solids", "nonvolatile_content", "water_content", "density", "relative_density", "ph", "viscosity",
        "ionic_character", "appearance", "color", "odor", "solubility", "recommended_dosage", "application_guidance", "application_area",
        "processing_conditions", "addition_sequence", "compatibility", "stability", "storage_conditions", "shelf_life", "packaging",
        "analytical_method", "cloud_point", "pour_point", "flash_point", "performance_claim", "certification_claim",
    ];
    for claim in claims {
        ensure_object_keys(claim, &["id", "fieldCode", "sectionNumber", "subject", "rawValue", "normalizedValue", "originalUnit", "normalizedUnit", "qualifier", "basis", "context", "extraction", "evidence"], "supplier product claim")?;
        let claim_id = claim["id"].as_str().filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "supplier product claim ID is required".to_string())?;
        if !claim_ids.insert(claim_id.to_string()) { return Err("supplier product claim IDs must be unique".to_string()); }
        let field = claim["fieldCode"].as_str().unwrap_or_default();
        let section = claim["sectionNumber"].as_u64();
        let valid_sds = match field {
            "product_identifier" | "product_chemical_nature" | "product_cas" | "product_ec" | "supplier_material_number" | "product_description" | "recommended_use" | "use_restrictions" | "industry_sector" | "emergency_contact" => section == Some(1),
            "substance_or_mixture" | "disclosed_component_name" | "disclosed_component_cas" | "disclosed_component_ec" | "disclosed_component_concentration" | "component_m_factor" | "component_specific_concentration_limit" | "component_acute_toxicity_estimate" | "composition_disclosure" | "undisclosed_remainder" => section == Some(3),
            "handling" | "handling_constraints" | "storage" | "storage_temperature" | "storage_conditions" | "storage_stability" | "container_material_compatibility" | "sds_shelf_life" => section == Some(7),
            "physical_state" | "appearance" | "color" | "odor" | "odor_threshold" | "ph" | "density" | "relative_density" | "viscosity" | "solubility" | "flash_point" | "boiling_point" | "melting_point" | "freezing_point" | "melting_freezing_point" | "vapor_pressure" | "vapor_density" | "partition_coefficient" | "molecular_weight" | "other_physical_property" => section == Some(9),
            "regulatory_status" | "chemical_safety_assessment" | "other_regulatory_information" => section == Some(15),
            _ => false,
        };
        if record["documentType"].as_str() == Some("SDS") && (!allowed_sds_fields.contains(&field) || !valid_sds) {
            return Err("SDS product claims are limited to Sections 1, 3, 7, 9 and 15 with the matching field".to_string());
        }
        if record["documentType"].as_str() == Some("TDS") && (!allowed_tds_fields.contains(&field) || section.is_some()) {
            return Err("TDS product claim field is unsupported or contains a non-TDS section number".to_string());
        }
        if claim["rawValue"].as_str().map_or(true, |value| value.trim().is_empty())
            || claim["evidence"].as_array().map_or(true, Vec::is_empty)
        {
            return Err("every supplier product claim requires a value and source citation".to_string());
        }
        for cite in claim["evidence"].as_array().unwrap() {
            ensure_object_keys(cite, &["documentHash", "pageNumber", "lineNumber", "excerpt", "source", "confidence", "position"], "supplier product citation")?;
            if cite["documentHash"].as_str().map_or(true, |value| !value.eq_ignore_ascii_case(hash))
                || cite["pageNumber"].as_u64().map_or(true, |page| page == 0)
                || cite["excerpt"].as_str().map_or(true, |value| value.trim().is_empty())
            {
                return Err("supplier product citation must identify a page and excerpt from the exact acquired document".to_string());
            }
        }
    }
    Ok(())
}

fn validate_supplier_product_card_version(record: &serde_json::Value, rows: &[serde_json::Value]) -> Result<(), String> {
    ensure_object_keys(record, &["recordType", "schemaVersion", "id", "productCardId", "version", "supplierId", "supplierName", "supplierItemCode", "tradeName", "grade", "market", "language", "identityStatus", "evidenceRecordIds", "claimIds", "conflicts", "createdAt"], "supplier product card version")?;
    if record["schemaVersion"].as_str() != Some("1.0")
        || record["productCardId"].as_str().map_or(true, |value| value.trim().is_empty())
        || record["version"].as_u64().map_or(true, |version| version == 0)
        || (record["supplierItemCode"].as_str().map_or(true, str::is_empty) && record["tradeName"].as_str().map_or(true, str::is_empty))
        || !["provisional", "review_required", "verified"].contains(&record["identityStatus"].as_str().unwrap_or_default())
    {
        return Err("supplier product card identity or version is invalid".to_string());
    }
    let card_id = record["productCardId"].as_str().unwrap();
    let documents = rows.iter().filter(|row| row["recordType"].as_str() == Some("document") && row["productCardId"].as_str() == Some(card_id)).collect::<Vec<_>>();
    let evidence_ids = record["evidenceRecordIds"].as_array().ok_or_else(|| "product card requires evidence record IDs".to_string())?;
    let claim_ids = record["claimIds"].as_array().ok_or_else(|| "product card requires extracted claim IDs".to_string())?;
    if documents.is_empty() || evidence_ids.iter().any(|id| !documents.iter().any(|document| document["id"] == *id)) {
        return Err("product card must cite persisted supplier product evidence for the same product".to_string());
    }
    let actual_claim_ids = documents.iter().flat_map(|document| document["claims"].as_array().into_iter().flatten())
        .filter_map(|claim| claim["id"].as_str()).collect::<std::collections::HashSet<_>>();
    if claim_ids.iter().any(|id| id.as_str().map_or(true, |value| !actual_claim_ids.contains(value))) {
        return Err("product card claims must point to persisted extracted evidence".to_string());
    }
    let expected_version = rows.iter().filter(|row| row["recordType"].as_str() == Some("card_version") && row["productCardId"].as_str() == Some(card_id))
        .filter_map(|row| row["version"].as_u64()).max().unwrap_or(0) + 1;
    if record["version"].as_u64() != Some(expected_version) {
        return Err("product card updates must append the next sequential version".to_string());
    }
    Ok(())
}

/// Append an authorized human's field-level identity decision against the
/// exact immutable SDS extraction and an existing RawMaterial. The renderer
/// cannot supply reviewer identity or write this append-only collection.
#[tauri::command(async)]
pub async fn append_identity_field_review(
    app: AppHandle,
    token: String,
    mut review: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let actor = authz::authorize_any_app(&app, &token, "rawMaterials", &WRITE_CAPABILITIES)?;
    let _guard = IDENTITY_FIELD_REVIEW_WRITE_LOCK.lock()
        .map_err(|_| "identity review storage is unavailable".to_string())?;
    ensure_object_keys(&review, &["schemaVersion", "id", "commercialProductId", "sourceEvidenceId", "targetRecordId", "field", "decision", "proposedValueSnapshot", "reviewedValueSnapshot", "evidenceRefs", "decisionNote", "reviewedBy", "reviewerRole", "reviewedAt", "supersedesReviewId"], "identity field review")?;
    if review["schemaVersion"].as_str() != Some("1.0")
        || review["field"].as_str() != Some("canonical_identity")
        || !matches!(review["decision"].as_str(), Some("accepted" | "edited" | "rejected" | "needs_review")) {
        return Err("identity review must be a supported canonical-identity decision".to_string());
    }
    if ["id", "commercialProductId", "sourceEvidenceId", "targetRecordId"].iter().any(|key| {
        review[*key].as_str().map_or(true, |value| value.trim().is_empty())
    }) {
        return Err("identity review identifiers must be non-empty".to_string());
    }
    let decision = review["decision"].as_str().unwrap_or_default();
    if (decision == "edited") != review.get("reviewedValueSnapshot").is_some()
        || (["edited", "rejected", "needs_review"].contains(&decision)
            && review["decisionNote"].as_str().map_or(true, |note| note.trim().is_empty()))
        || (decision == "accepted" && review.get("decisionNote").and_then(|note| note.as_str()).map_or(false, |note| note.trim().is_empty())) {
        return Err("identity review decision snapshot or note is invalid".to_string());
    }
    if let Some(snapshot) = review.get("reviewedValueSnapshot").and_then(|value| value.as_str()) {
        serde_json::from_str::<serde_json::Value>(snapshot)
            .map_err(|_| "reviewed identity snapshot must be valid JSON".to_string())?;
    }
    let source_id = review["sourceEvidenceId"].as_str().ok_or_else(|| "identity review is missing source evidence".to_string())?;
    let product_id = review["commercialProductId"].as_str().ok_or_else(|| "identity review is missing commercial product".to_string())?;
    let target_code = review["targetRecordId"].as_str().ok_or_else(|| "identity review is missing its RawMaterial target".to_string())?;
    let evidence_path = collection_path(&app, "supplier_sds_product_evidence")?;
    let evidence_rows = read_array(&evidence_path);
    let source = evidence_rows.iter().find(|row| row["evidence"]["id"].as_str() == Some(source_id)
        && row["evidence"]["commercialProductId"].as_str() == Some(product_id))
        .ok_or_else(|| "identity review must cite persisted SDS evidence for this commercial product".to_string())?;
    let material_path = collection_path(&app, "materials")?;
    if !read_array(&material_path).iter().any(|row| row["code"].as_str() == Some(target_code)) {
        return Err("identity review target RawMaterial does not exist".to_string());
    }
    let refs = review["evidenceRefs"].as_array().ok_or_else(|| "identity review requires source evidence references".to_string())?;
    let source_section = &source["evidence"]["section1"];
    let source_facts = ["declaredChemicalName", "casNumber", "ecNumber"]
        .iter().filter_map(|key| source_section[*key].as_object())
        .collect::<Vec<_>>();
    if refs.is_empty() || refs.iter().any(|reference| {
        let value = reference.as_str().unwrap_or_default();
        !source_facts.iter().any(|fact| fact["evidenceRefs"].as_array()
            .map_or(false, |source_refs| source_refs.iter().any(|source_ref| source_ref.as_str() == Some(value))))
    }) {
        return Err("identity review references must come from Section 1 of the cited SDS evidence".to_string());
    }
    let proposed: serde_json::Value = serde_json::from_str(review["proposedValueSnapshot"].as_str()
        .ok_or_else(|| "identity review proposal must be a JSON snapshot".to_string())?)
        .map_err(|_| "identity review proposal must be valid JSON".to_string())?;
    if !proposed.is_object() || proposed.as_object().map_or(true, |object| object.is_empty())
        || proposed.as_object().map_or(false, |object| object.keys().any(|key| !["casNumbers", "ecNumbers"].contains(&key.as_str()))) {
        return Err("supplier identity proposal may contain only cited CAS or EC identifiers".to_string());
    }
    for (proposal_key, source_key) in [("casNumbers", "casNumber"), ("ecNumbers", "ecNumber")] {
        if let Some(values) = proposed.get(proposal_key) {
            let values = values.as_array().filter(|items| !items.is_empty())
                .ok_or_else(|| "proposed CAS and EC values must be non-empty arrays".to_string())?;
            let source_value = source_section[source_key]["rawValue"].as_str().unwrap_or_default();
            if values.iter().any(|item| item.as_str().map_or(true, |value| value.trim().is_empty() || value != source_value))
                || source_section[source_key].is_null()
                || !refs.iter().any(|reference| source_section[source_key]["evidenceRefs"].as_array()
                    .map_or(false, |source_refs| source_refs.contains(reference))) {
                return Err("each proposed identifier must cite its matching Section 1 source field".to_string());
            }
        }
    }
    if let Some(supersedes) = review.get("supersedesReviewId").and_then(|value| value.as_str()) {
        let prior_path = collection_path(&app, "identity_field_reviews")?;
        let prior_rows = read_array(&prior_path);
        if !prior_rows.iter().any(|prior| prior["id"].as_str() == Some(supersedes)
            && prior["commercialProductId"] == review["commercialProductId"]
            && prior["targetRecordId"] == review["targetRecordId"]
            && prior["field"] == review["field"]) {
            return Err("superseded identity review must match the same product, target and field".to_string());
        }
    }
    review["reviewedBy"] = serde_json::Value::String(actor.user_id.clone());
    review["reviewerRole"] = serde_json::Value::String(actor.role.clone());
    review["reviewedAt"] = serde_json::Value::String(now_rfc3339_utc());
    let path = collection_path(&app, "identity_field_reviews")?;
    let rows = read_array(&path);
    let (next_rows, inserted, _) = apply_upsert(rows, vec![review.clone()], true, "identity_field_reviews")?;
    if inserted != 1 { return Err("identity field review was not appended".to_string()); }
    write_array(&path, &next_rows)?;
    Ok(review)
}

fn validate_supplier_sds_product_evidence_record(
    record: &serde_json::Value,
    acquisition: &serde_json::Value,
    crosswalk_rows: &[serde_json::Value],
) -> Result<(), String> {
    ensure_object_keys(record, &["schemaVersion", "code", "acquisitionCode", "evidence", "extractionStatus", "createdAt"], "supplier SDS evidence record")?;
    let evidence = &record["evidence"];
    ensure_object_keys(evidence, &["schemaVersion", "id", "commercialProductId", "section1", "section3", "reconciliations"], "supplier SDS product evidence")?;
    let section1 = &evidence["section1"];
    ensure_object_keys(section1, &["sectionNumber", "sourceDocumentHash", "declaredChemicalName", "chemicalNature", "casNumber", "ecNumber", "materialNumber", "productDescription"], "supplier SDS Section 1 evidence")?;
    let section3 = &evidence["section3"];
    ensure_object_keys(section3, &["sectionNumber", "sourceDocumentHash", "substanceOrMixture", "components", "undisclosedRemainder"], "supplier SDS Section 3 evidence")?;
    if record["schemaVersion"].as_str() != Some("1.0")
        || record["extractionStatus"].as_str() != Some("unreviewed")
        || record["code"].as_str() != evidence["id"].as_str()
        || evidence["schemaVersion"].as_str() != Some("1.0")
        || evidence["commercialProductId"].as_str().map_or(true, |value| value.trim().is_empty())
        || record["acquisitionCode"].as_str().map_or(true, |value| value.trim().is_empty())
        || acquisition["documentType"].as_str() != Some("SDS")
        || record["acquisitionCode"].as_str() != acquisition["code"].as_str()
        || section1["sectionNumber"].as_u64() != Some(1)
        || section3["sectionNumber"].as_u64() != Some(3)
        || section1["sourceDocumentHash"].as_str().map_or(true, |value| !value.eq_ignore_ascii_case(acquisition["sha256"].as_str().unwrap_or("")))
        || section3["sourceDocumentHash"].as_str().map_or(true, |value| !value.eq_ignore_ascii_case(acquisition["sha256"].as_str().unwrap_or("")))
        || !is_sha256_hex(acquisition["sha256"].as_str().unwrap_or(""))
        || section3["components"].as_array().is_none()
        || evidence["reconciliations"].as_array().is_none()
    {
        return Err("SDS extraction evidence must match the acquired SDS hash and remain unreviewed".to_string());
    }
    let source_product = &acquisition["sourceProduct"];
    let source_product_id = source_product["supplierItemCode"].as_str().or_else(|| source_product["sourceProductId"].as_str())
        .ok_or_else(|| "SDS acquisition must identify a supplier product before composition evidence can be normalized".to_string())?;
    let exact_crosswalks = crosswalk_rows.iter().filter(|crosswalk| {
        crosswalk["sourceSystemId"].as_str() == acquisition["providerId"].as_str()
            && crosswalk["sourceEntity"].as_str() == Some("supplier_products")
            && crosswalk["sourceRecordId"].as_str() == Some(source_product_id)
            && crosswalk["canonicalEntity"].as_str() == Some("CommercialProduct")
    }).collect::<Vec<_>>();
    let expected_crosswalk_code = format!("{}::supplier_products::{}::CommercialProduct", acquisition["providerId"].as_str().unwrap_or(""), source_product_id);
    if exact_crosswalks.len() != 1
        || exact_crosswalks[0]["code"].as_str() != Some(expected_crosswalk_code.as_str())
        || exact_crosswalks[0]["canonicalRecordId"].as_str() != evidence["commercialProductId"].as_str()
        || exact_crosswalks[0]["status"].as_str() != Some("active")
    {
        return Err("SDS evidence product must match an active exact supplier-product crosswalk".to_string());
    }
    for key in ["declaredChemicalName", "chemicalNature", "casNumber", "ecNumber", "materialNumber", "productDescription"] {
        validate_optional_sds_fact(section1, key)?;
    }
    for key in ["substanceOrMixture", "undisclosedRemainder"] {
        validate_optional_sds_fact(section3, key)?;
    }
    let mut all_ids = std::collections::HashSet::new();
    let mut section1_fact_ids = std::collections::HashSet::new();
    for key in ["declaredChemicalName", "chemicalNature", "casNumber", "ecNumber", "materialNumber", "productDescription"] {
        if let Some(id) = section1.get(key).and_then(|fact| fact.get("id")).and_then(|value| value.as_str()) {
            if !all_ids.insert(id.to_string()) { return Err("SDS fact and component identities must be unique".to_string()); }
            section1_fact_ids.insert(id.to_string());
        }
    }
    for key in ["substanceOrMixture", "undisclosedRemainder"] {
        if let Some(id) = section3.get(key).and_then(|fact| fact.get("id")).and_then(|value| value.as_str()) {
            if !all_ids.insert(id.to_string()) { return Err("SDS fact and component identities must be unique".to_string()); }
        }
    }
    let mut section3_component_ids = std::collections::HashSet::new();
    for component in section3["components"].as_array().unwrap() {
        ensure_object_keys(component, &["id", "componentName", "casNumber", "ecNumber", "materialNumber", "concentration", "disclosure"], "supplier SDS component")?;
        if component["id"].as_str().map_or(true, |value| value.trim().is_empty())
            || !["disclosed", "trade_secret", "withheld", "unknown"].contains(&component["disclosure"].as_str().unwrap_or(""))
        {
            return Err("SDS component identity and disclosure are invalid".to_string());
        }
        let component_id = component["id"].as_str().unwrap().to_string();
        if !all_ids.insert(component_id.clone()) { return Err("SDS fact and component identities must be unique".to_string()); }
        section3_component_ids.insert(component_id);
        for key in ["componentName", "casNumber", "ecNumber", "materialNumber", "concentration"] {
            validate_optional_sds_fact(component, key)?;
            if let Some(id) = component.get(key).and_then(|fact| fact.get("id")).and_then(|value| value.as_str()) {
                if !all_ids.insert(id.to_string()) { return Err("SDS fact and component identities must be unique".to_string()); }
            }
        }
    }
    for reconciliation in evidence["reconciliations"].as_array().unwrap() {
        ensure_object_keys(reconciliation, &["section1FactId", "section3ComponentId", "outcome", "basis", "evidenceRefs", "rationaleCode", "reviewedBy"], "supplier SDS reconciliation")?;
        if reconciliation["section1FactId"].as_str().map_or(true, |value| value.trim().is_empty())
            || reconciliation["section3ComponentId"].as_str().map_or(true, |value| value.trim().is_empty())
            || reconciliation["rationaleCode"].as_str().map_or(true, |value| value.trim().is_empty())
            || !["consistent", "conflict", "unresolved"].contains(&reconciliation["outcome"].as_str().unwrap_or(""))
            || !["exact_cas", "exact_ec", "human_review", "insufficient_evidence"].contains(&reconciliation["basis"].as_str().unwrap_or(""))
            || reconciliation["evidenceRefs"].as_array().map_or(true, |refs| refs.is_empty() || refs.iter().any(|item| item.as_str().map_or(true, |value| value.trim().is_empty())))
        {
            return Err("SDS section reconciliation fields and citations are invalid".to_string());
        }
        if !section1_fact_ids.contains(reconciliation["section1FactId"].as_str().unwrap())
            || !section3_component_ids.contains(reconciliation["section3ComponentId"].as_str().unwrap())
        {
            return Err("SDS section reconciliation must reference existing product facts and Section 3 components".to_string());
        }
        if reconciliation["basis"].as_str() == Some("human_review")
            && reconciliation["reviewedBy"].as_str().map_or(true, |value| value.trim().is_empty())
        {
            return Err("human SDS reconciliation requires a named reviewer".to_string());
        }
        if reconciliation["basis"].as_str() == Some("insufficient_evidence")
            && reconciliation["outcome"].as_str() != Some("unresolved")
        {
            return Err("insufficient SDS reconciliation evidence must remain unresolved".to_string());
        }
        validate_sds_reconciliation_evidence(reconciliation, section1, section3)?;
    }
    Ok(())
}

fn validate_optional_sds_fact(value: &serde_json::Value, key: &str) -> Result<(), String> {
    let Some(fact) = value.as_object().and_then(|object| object.get(key)) else { return Ok(()); };
    ensure_object_keys(fact, &["id", "rawValue", "evidenceRefs"], "supplier SDS cited fact")?;
    if fact["id"].as_str().map_or(true, |text| text.trim().is_empty())
        || fact["rawValue"].as_str().map_or(true, |text| text.trim().is_empty())
        || fact["evidenceRefs"].as_array().map_or(true, |refs| refs.is_empty() || refs.iter().any(|item| item.as_str().map_or(true, |text| text.trim().is_empty())))
    {
        return Err("SDS cited fact must retain its identity, original value, and evidence references".to_string());
    }
    Ok(())
}

fn validate_sds_reconciliation_evidence(
    reconciliation: &serde_json::Value,
    section1: &serde_json::Value,
    section3: &serde_json::Value,
) -> Result<(), String> {
    let section1_id = reconciliation["section1FactId"].as_str().unwrap_or("");
    let component_id = reconciliation["section3ComponentId"].as_str().unwrap_or("");
    let component = section3["components"].as_array().into_iter().flatten()
        .find(|candidate| candidate["id"].as_str() == Some(component_id))
        .ok_or_else(|| "SDS reconciliation component does not exist".to_string())?;
    let basis = reconciliation["basis"].as_str().unwrap_or("");
    let reconciliation_refs = reconciliation["evidenceRefs"].as_array().unwrap();
    if basis == "exact_cas" || basis == "exact_ec" {
        let (key, normalizer): (&str, fn(&str) -> Option<String>) = if basis == "exact_cas" {
            ("casNumber", normalize_sds_cas_identifier)
        } else {
            ("ecNumber", normalize_sds_ec_identifier)
        };
        let left = section1.get(key).filter(|fact| fact["id"].as_str() == Some(section1_id))
            .ok_or_else(|| "Exact SDS reconciliation must reference the matching Section 1 identifier fact".to_string())?;
        let right = component.get(key).ok_or_else(|| "Exact SDS reconciliation must reference a matching Section 3 identifier fact".to_string())?;
        let left_value = left["rawValue"].as_str().and_then(normalizer)
            .ok_or_else(|| "Exact SDS reconciliation requires valid source identifiers".to_string())?;
        let right_value = right["rawValue"].as_str().and_then(normalizer)
            .ok_or_else(|| "Exact SDS reconciliation requires valid source identifiers".to_string())?;
        let equal = left_value == right_value;
        if (reconciliation["outcome"].as_str() == Some("consistent")) != equal
            || reconciliation["outcome"].as_str() == Some("unresolved")
        {
            return Err("Exact SDS reconciliation outcome must match its validated identifiers".to_string());
        }
        for fact in [left, right] {
            let refs = fact["evidenceRefs"].as_array().ok_or_else(|| "Exact SDS identifiers must carry evidence references".to_string())?;
            if refs.iter().any(|reference| !reconciliation_refs.contains(reference)) {
                return Err("Exact SDS reconciliation must cite both linked identifier facts".to_string());
            }
        }
    } else if basis == "human_review" || basis == "insufficient_evidence" {
        let section1_fact = ["casNumber", "ecNumber", "materialNumber", "declaredChemicalName", "chemicalNature", "productDescription"]
            .iter().filter_map(|key| section1.get(*key)).find(|fact| fact["id"].as_str() == Some(section1_id))
            .ok_or_else(|| "Manual or unresolved SDS reconciliation must reference an existing Section 1 fact".to_string())?;
        let mut linked_facts: Vec<&serde_json::Value> = vec![section1_fact];
        for key in ["componentName", "casNumber", "ecNumber", "materialNumber"] {
            if let Some(fact) = component.get(key) { linked_facts.push(fact); }
        }
        if basis == "human_review" {
            if let Some(fact) = component.get("concentration") { linked_facts.push(fact); }
        }
        for fact in linked_facts {
            if fact["evidenceRefs"].as_array().map_or(true, |refs| refs.iter().any(|reference| !reconciliation_refs.contains(reference))) {
                return Err("Manual or unresolved SDS reconciliation must cite its linked source facts".to_string());
            }
        }
    }
    Ok(())
}

fn normalize_sds_cas_identifier(value: &str) -> Option<String> {
    let parts = value.trim().split('-').collect::<Vec<_>>();
    if parts.len() != 3 || !(2..=7).contains(&parts[0].len()) || parts[1].len() != 2 || parts[2].len() != 1
        || parts.iter().any(|part| part.bytes().any(|byte| !byte.is_ascii_digit()))
    { return None; }
    let body = format!("{}{}", parts[0], parts[1]);
    let sum = body.bytes().rev().enumerate().map(|(index, byte)| usize::from(byte - b'0') * (index + 1)).sum::<usize>();
    if sum % 10 != parts[2].parse::<usize>().ok()? { return None; }
    Some(format!("{}-{}-{}", parts[0], parts[1], parts[2]))
}

fn normalize_sds_ec_identifier(value: &str) -> Option<String> {
    let parts = value.trim().split('-').collect::<Vec<_>>();
    if parts.len() != 3 || parts[0].len() != 3 || parts[1].len() != 3 || parts[2].len() != 1
        || parts.iter().any(|part| part.bytes().any(|byte| !byte.is_ascii_digit()))
    { return None; }
    let digits = format!("{}{}", parts[0], parts[1]);
    let sum = digits.bytes().enumerate().map(|(index, byte)| usize::from(byte - b'0') * (index + 1)).sum::<usize>();
    if sum % 11 != parts[2].parse::<usize>().ok()? { return None; }
    Some(format!("{}-{}-{}", parts[0], parts[1], parts[2]))
}

fn validate_normalization_version(
    normalization: &serde_json::Value,
    source: &serde_json::Value,
    history: &[serde_json::Value],
    sds_evidence_rows: &[serde_json::Value],
    acquisition_rows: &[serde_json::Value],
) -> Result<(), String> {
    ensure_object_keys(
        normalization,
        &[
            "schemaVersion", "recordKind", "id", "code", "referenceFormulationRecordId",
            "sourceDocumentHash", "normalizerVersion", "version", "supersedesNormalizationId",
            "processNormalization", "targetNormalization", "lines", "createdAt",
        ],
        "normalization",
    )?;
    let id = normalization["id"].as_str().filter(|id| !id.trim().is_empty());
    if normalization["schemaVersion"].as_str() != Some("1.0")
        || normalization["recordKind"].as_str() != Some("reference_formulation_normalization")
        || id.is_none()
        || id != normalization["code"].as_str()
        || normalization["normalizerVersion"].as_str() != Some("formulab-reference-formulation-normalization-v1")
        || normalization["referenceFormulationRecordId"].as_str() != source["id"].as_str()
    {
        return Err("normalization identity or schema version is invalid".to_string());
    }
    let source_hash = source["sourceDocumentHash"].as_str()
        .ok_or_else(|| "source formulation is missing its document hash".to_string())?;
    if normalization["sourceDocumentHash"].as_str()
        .map_or(true, |hash| !hash.eq_ignore_ascii_case(source_hash))
    {
        return Err("normalization must retain the immutable source document hash".to_string());
    }
    let expected_version = history.len() as u64 + 1;
    for (index, prior) in history.iter().enumerate() {
        let expected_prior = if index == 0 { None } else { history[index - 1]["id"].as_str() };
        if prior["version"].as_u64() != Some(index as u64 + 1)
            || prior["supersedesNormalizationId"].as_str() != expected_prior
        {
            return Err("stored normalization history must form one unbroken predecessor chain".to_string());
        }
    }
    if normalization["version"].as_u64() != Some(expected_version) {
        return Err("normalization version must append the next source version".to_string());
    }
    validate_reference_formulation_process_normalization(&normalization["processNormalization"], source)?;
    validate_reference_formulation_target_normalization(&normalization["targetNormalization"], source)?;
    let expected_predecessor = history.last().and_then(|row| row["id"].as_str());
    if normalization["supersedesNormalizationId"].as_str() != expected_predecessor {
        return Err("normalization must link the latest immutable predecessor".to_string());
    }

    let source_lines = source["ingredientLines"].as_array()
        .ok_or_else(|| "source formulation has no ingredient lines".to_string())?;
    let normalized_lines = normalization["lines"].as_array()
        .ok_or_else(|| "normalization has no line references".to_string())?;
    if normalized_lines.len() != source_lines.len() {
        return Err("normalization must retain every source line exactly once".to_string());
    }
    let product_matches = source["productMatches"].as_array()
        .ok_or_else(|| "source product matching snapshot is missing".to_string())?;
    let mut seen_ids = std::collections::HashSet::new();
    let mut seen_contribution_ids = std::collections::HashSet::new();
    for line in normalized_lines {
        ensure_object_keys(line, &["sourceLineId", "commercialProduct", "canonicalChemistry", "functionNormalization", "componentContributions"], "normalization line")?;
        let line_id = line["sourceLineId"].as_str()
            .ok_or_else(|| "normalized line is missing its source line identity".to_string())?;
        if !seen_ids.insert(line_id) {
            return Err("normalization may reference each source line only once".to_string());
        }
        let source_line = source_lines.iter()
            .find(|candidate| candidate["id"].as_str() == Some(line_id))
            .ok_or_else(|| "normalization line does not exist in the immutable source".to_string())?;
        let match_record = product_matches.iter()
            .find(|candidate| candidate["ingredientLineId"].as_str() == Some(line_id))
            .ok_or_else(|| "source product match for a line is missing".to_string())?;
        let source_candidate_ids = match_record["candidates"].as_array()
            .ok_or_else(|| "source product candidates are invalid".to_string())?
            .iter()
            .map(|candidate| candidate["commercialProductId"].as_str()
                .filter(|id| !id.trim().is_empty())
                .map(str::to_string)
                .ok_or_else(|| "source product candidate identity is invalid".to_string()))
            .collect::<Result<Vec<_>, _>>()?;
        if source_candidate_ids.iter().collect::<std::collections::HashSet<_>>().len() != source_candidate_ids.len() {
            return Err("source product candidate IDs must be unique".to_string());
        }
        let normalized_product = &line["commercialProduct"];
        let normalized_product_ids = validate_normalization_candidates(normalized_product, "commercial product")?;
        if source_candidate_ids != normalized_product_ids
        {
            return Err("commercial product candidates must match the immutable source match snapshot".to_string());
        }
        let chemistry = &line["canonicalChemistry"];
        let _canonical_candidate_ids = validate_normalization_candidates(chemistry, "canonical chemistry")?;
        validate_reference_formulation_function_normalization(&line["functionNormalization"], source_line)?;
        let contributions = line["componentContributions"].as_array()
            .ok_or_else(|| "normalization component contributions must be an array".to_string())?;
        for contribution in contributions {
            let contribution_id = contribution["id"].as_str().filter(|id| !id.trim().is_empty())
                .ok_or_else(|| "component contribution identity is invalid".to_string())?;
            if !seen_contribution_ids.insert(contribution_id.to_string()) {
                return Err("component contribution identities must be unique within a normalization version".to_string());
            }
            validate_reference_formulation_component_contribution(
                contribution,
                source,
                line_id,
                &source_candidate_ids,
                sds_evidence_rows,
                acquisition_rows,
            )?;
        }
    }
    Ok(())
}

fn validate_reference_formulation_component_contribution(
    contribution: &serde_json::Value,
    source: &serde_json::Value,
    source_line_id: &str,
    source_product_candidate_ids: &[String],
    sds_evidence_rows: &[serde_json::Value],
    acquisition_rows: &[serde_json::Value],
) -> Result<(), String> {
    ensure_object_keys(
        contribution,
        &[
            "schemaVersion", "id", "quantityKind", "status", "sourceFormulationRecordId",
            "sourceFormulaDocumentHash", "sourceFormulaLineId", "commercialProductId", "formulaAmount",
            "sourceSds", "canonicalChemistry", "contributionPercentRange", "unknownReasons", "evidenceRefs",
            "reviewRequired",
        ],
        "component contribution",
    )?;
    if contribution["schemaVersion"].as_str() != Some("1.0")
        || contribution["quantityKind"].as_str() != Some("component_contribution")
        || contribution["reviewRequired"].as_bool() != Some(true)
        || contribution["sourceFormulationRecordId"].as_str() != source["id"].as_str()
        || contribution["sourceFormulaLineId"].as_str() != Some(source_line_id)
        || contribution["sourceFormulaDocumentHash"].as_str().map_or(true, |hash| !hash.eq_ignore_ascii_case(source["sourceDocumentHash"].as_str().unwrap_or("")))
    {
        return Err("component contribution must remain linked to its source formulation line and document".to_string());
    }
    let source_line = source["ingredientLines"].as_array()
        .and_then(|lines| lines.iter().find(|line| line["id"].as_str() == Some(source_line_id)))
        .ok_or_else(|| "component contribution source line is missing".to_string())?;
    let product_id = optional_json_string(contribution, "commercialProductId", "component contribution commercial product")?;
    if let Some(product_id) = product_id {
        if product_id.trim().is_empty() {
            return Err("component contribution commercial product identity is invalid".to_string());
        }
        if !source_product_candidate_ids.iter().any(|candidate| candidate == product_id) {
            return Err("component contribution product must match an immutable source product candidate".to_string());
        }
    }
    let formula = &contribution["formulaAmount"];
    ensure_object_keys(formula, &["originalValue", "unit", "basis", "interpretation", "percentRange", "evidenceRefs"], "contribution formula amount")?;
    let formula_interpretation = formula["interpretation"].as_str()
        .ok_or_else(|| "contribution formula amount interpretation is required".to_string())?;
    if !matches!(formula_interpretation, "exact" | "range" | "unknown") {
        return Err("contribution formula amount interpretation is invalid".to_string());
    }
    for (contribution_field, source_field) in [("originalValue", "amount"), ("unit", "unit"), ("basis", "basis")] {
        let contribution_value = optional_json_string(formula, contribution_field, "contribution formula amount")?;
        let source_value = optional_nested_raw_string(source_line, source_field)?;
        if contribution_value != source_value {
            return Err("contribution formula amount must preserve its source line value, unit and basis".to_string());
        }
    }
    let mut expected_formula_refs = Vec::new();
    for field_name in ["ingredientName", "supplierProductCode", "inciOrChemicalName", "amount", "unit", "basis"] {
        if let Some(field) = source_line[field_name].as_object() {
            if let Some(evidence) = field.get("evidence") {
                let source_hash = evidence["sourceDocumentHash"].as_str().unwrap_or("");
                let page = evidence["pageNumber"].as_u64().unwrap_or(0);
                let block = evidence["blockIndex"].as_u64().unwrap_or(0);
                let row = evidence["rowIndex"].as_u64().unwrap_or(0);
                let cell = evidence["cellIndex"].as_u64().unwrap_or(0);
                let reference = format!("formula:{source_hash}:{page}:{block}:{row}:{cell}");
                if !expected_formula_refs.contains(&reference) { expected_formula_refs.push(reference); }
            }
        }
    }
    if expected_formula_refs.is_empty() {
        expected_formula_refs.push(format!("formula:{}:{}", source["sourceDocumentHash"].as_str().unwrap_or(""), source_line_id));
    }
    let supplied_formula_refs = formula["evidenceRefs"].as_array()
        .ok_or_else(|| "contribution formula evidence references must be an array".to_string())?;
    if supplied_formula_refs.len() != expected_formula_refs.len()
        || supplied_formula_refs.iter().zip(expected_formula_refs.iter()).any(|(left, right)| left.as_str() != Some(right.as_str()))
    {
        return Err("contribution formula evidence references must match the immutable source line".to_string());
    }
    let formula_range = if formula_interpretation == "unknown" {
        if !formula["percentRange"].is_null() { return Err("unknown formula amount cannot carry normalized bounds".to_string()); }
        None
    } else {
        let bounds = validate_contribution_bounds(&formula["percentRange"], 100.0, "formula amount")?;
        let source_amount = formula["originalValue"].as_str().unwrap_or("");
        if source_amount.trim().is_empty()
            || !formula["evidenceRefs"].as_array().map_or(false, |refs| !refs.is_empty())
        {
            return Err("calculated formula amount requires its value and citations".to_string());
        }
        let parse_input = if source_amount.contains('%') {
            source_amount.to_string()
        } else {
            let unit = formula["unit"].as_str().unwrap_or("").trim().to_ascii_lowercase();
            if ["%", "percent", "percentage", "wt%", "wt.%"].contains(&unit.as_str()) {
                format!("{}% {}", source_amount, formula["basis"].as_str().unwrap_or(""))
            } else {
                String::new()
            }
        };
        let parsed = parse_explicit_w_w_percent_range(&parse_input)
            .ok_or_else(|| "normalized formula amount is not an explicit % w/w source value".to_string())?;
        if !contribution_bounds_equal(bounds, parsed) {
            return Err("normalized formula amount bounds must match the immutable source line".to_string());
        }
        validate_contribution_interpretation(formula_interpretation, bounds, "formula amount")?;
        Some(bounds)
    };
    let sds = &contribution["sourceSds"];
    ensure_object_keys(sds, &["status", "evidenceId", "acquisitionCode", "commercialProductId", "documentHash", "sectionNumber", "sourceComponentId", "disclosure", "sourceFactId", "originalValue", "fractionRange", "interpretation", "evidenceRefs"], "contribution SDS lineage")?;
    let sds_status = sds["status"].as_str().ok_or_else(|| "contribution SDS status is required".to_string())?;
    let sds_interpretation = sds["interpretation"].as_str().ok_or_else(|| "contribution SDS interpretation is required".to_string())?;
    if !matches!(sds_interpretation, "exact" | "range" | "unknown") {
        return Err("contribution SDS interpretation is invalid".to_string());
    }
    let sds_range = if sds_interpretation == "unknown" {
        if !sds["fractionRange"].is_null() { return Err("unknown SDS fraction cannot carry normalized bounds".to_string()); }
        None
    } else {
        let bounds = validate_contribution_bounds(&sds["fractionRange"], 1.0, "SDS fraction")?;
        let parsed = parse_explicit_w_w_percent_range(sds["originalValue"].as_str().unwrap_or(""))
            .ok_or_else(|| "normalized SDS fraction is not an explicit Section 3 % w/w value".to_string())?;
        if !contribution_bounds_equal(bounds, (parsed.0 / 100.0, parsed.1 / 100.0)) {
            return Err("normalized SDS fraction bounds must match the cited Section 3 value".to_string());
        }
        if sds["sourceComponentId"].as_str().map_or(true, |value| value.trim().is_empty())
            || sds["sourceFactId"].as_str().map_or(true, |value| value.trim().is_empty())
            || sds["evidenceRefs"].as_array().map_or(true, |refs| refs.is_empty())
        {
            return Err("calculated SDS fraction requires its component fact and citations".to_string());
        }
        validate_contribution_interpretation(sds_interpretation, bounds, "SDS fraction")?;
        Some(bounds)
    };
    match sds_status {
        "missing" => {
            if sds_interpretation != "unknown"
                || ["evidenceId", "acquisitionCode", "commercialProductId", "documentHash", "sectionNumber", "sourceComponentId", "disclosure", "sourceFactId", "originalValue"]
                    .iter().any(|key| !sds[*key].is_null())
                || !sds["evidenceRefs"].as_array().map_or(false, |refs| refs.is_empty())
            {
                return Err("missing SDS evidence cannot carry component facts".to_string());
            }
        }
        "available" => {
            if sds["evidenceId"].as_str().map_or(true, |value| value.trim().is_empty())
                || sds["commercialProductId"].as_str() != contribution["commercialProductId"].as_str()
                || sds["documentHash"].as_str().map_or(true, |value| !is_sha256_hex(value))
                || sds["sectionNumber"].as_u64() != Some(3)
            {
                return Err("available SDS contribution evidence must identify Section 3".to_string());
            }
            validate_persisted_sds_contribution_evidence(sds, source, sds_evidence_rows, acquisition_rows)?;
            if !sds["sourceComponentId"].is_null()
                && !["disclosed", "trade_secret", "withheld", "unknown"].contains(&sds["disclosure"].as_str().unwrap_or(""))
            {
                return Err("SDS component disclosure status must be retained".to_string());
            }
            if !sds["sourceFactId"].is_null()
                && (sds["sourceComponentId"].as_str().map_or(true, |value| value.trim().is_empty())
                    || sds["originalValue"].as_str().map_or(true, |value| value.trim().is_empty())
                    || !sds["evidenceRefs"].as_array().map_or(false, |refs| !refs.is_empty()))
            {
                return Err("SDS concentration fact must retain its component, value, and citations".to_string());
            }
        }
        _ => return Err("contribution SDS status is invalid".to_string()),
    }
    let chemistry = &contribution["canonicalChemistry"];
    validate_normalization_candidates(chemistry, "contribution canonical chemistry")?;
    let unknown_reasons = contribution["unknownReasons"].as_array()
        .ok_or_else(|| "contribution unknown reasons must be an array".to_string())?;
    let allowed_unknown_reasons = [
        "formula_amount_missing", "formula_amount_qs", "formula_amount_basis_unknown", "formula_amount_unparsed",
        "sds_evidence_missing", "sds_component_unresolved", "sds_concentration_missing", "sds_concentration_unparsed",
    ];
    let mut unique_unknown_reasons = std::collections::HashSet::new();
    if unknown_reasons.iter().any(|reason| reason.as_str().map_or(true, |value| !allowed_unknown_reasons.contains(&value) || !unique_unknown_reasons.insert(value))) {
        return Err("component contribution has an invalid or duplicate unknown reason".to_string());
    }
    let formula_unknown_reason_count = unknown_reasons.iter().filter(|reason| reason.as_str().unwrap_or("").starts_with("formula_amount_")).count();
    let sds_unknown_reason_count = unknown_reasons.iter().filter(|reason| reason.as_str().unwrap_or("").starts_with("sds_")).count();
    if (formula_interpretation == "unknown") != (formula_unknown_reason_count > 0)
        || (sds_interpretation == "unknown") != (sds_unknown_reason_count > 0)
        || (sds_status == "missing" && !unknown_reasons.iter().any(|reason| reason.as_str() == Some("sds_evidence_missing")))
    {
        return Err("unknown contribution reasons must match the missing formula or SDS evidence".to_string());
    }
    let status = contribution["status"].as_str().ok_or_else(|| "contribution status is required".to_string())?;
    let contribution_range = contribution.get("contributionPercentRange");
    if status == "unknown" {
        if contribution_range.map_or(false, |range| !range.is_null()) || unknown_reasons.is_empty() || (formula_range.is_some() && sds_range.is_some()) {
            return Err("unknown contribution requires reasons and cannot carry calculated bounds".to_string());
        }
    } else if matches!(status, "exact" | "range") {
        if !unknown_reasons.is_empty() { return Err("calculated contribution cannot carry unknown reasons".to_string()); }
        let formula_bounds = formula_range.ok_or_else(|| "calculated contribution requires formula bounds".to_string())?;
        let component_bounds = sds_range.ok_or_else(|| "calculated contribution requires SDS component bounds".to_string())?;
        let contribution_value = contribution_range.ok_or_else(|| "calculated contribution bounds are required".to_string())?;
        let contribution_bounds = validate_contribution_bounds(contribution_value, 100.0, "calculated contribution")?;
        let expected_lower = formula_bounds.0 * component_bounds.0;
        let expected_upper = formula_bounds.1 * component_bounds.1;
        if (contribution_bounds.0 - expected_lower).abs() > 1e-9 || (contribution_bounds.1 - expected_upper).abs() > 1e-9 {
            return Err("calculated contribution bounds do not match source formula and SDS values".to_string());
        }
        let exact = (contribution_bounds.0 - contribution_bounds.1).abs() <= 1e-12;
        if (status == "exact") != exact { return Err("exact/range status must match calculated bounds".to_string()); }
    } else {
        return Err("contribution status is invalid".to_string());
    }
    let evidence_refs = contribution["evidenceRefs"].as_array()
        .ok_or_else(|| "contribution evidence references must be an array".to_string())?;
    if evidence_refs.is_empty() { return Err("component contribution requires source evidence references".to_string()); }
    for refs_key in ["evidenceRefs"] {
        for ref_value in formula[refs_key].as_array().into_iter().flatten().chain(sds[refs_key].as_array().into_iter().flatten()) {
            if !evidence_refs.iter().any(|candidate| candidate == ref_value) {
                return Err("component contribution must retain formula and SDS evidence references".to_string());
            }
        }
    }
    Ok(())
}

fn optional_json_string<'a>(value: &'a serde_json::Value, key: &str, label: &str) -> Result<Option<&'a str>, String> {
    match value.as_object().and_then(|object| object.get(key)) {
        None => Ok(None),
        Some(serde_json::Value::String(text)) => Ok(Some(text.as_str())),
        Some(_) => Err(format!("{label} optional field {key} must be a string when present")),
    }
}

fn optional_nested_raw_string<'a>(value: &'a serde_json::Value, key: &str) -> Result<Option<&'a str>, String> {
    match value.as_object().and_then(|object| object.get(key)) {
        None => Ok(None),
        Some(field) => {
            let field_object = field.as_object().ok_or_else(|| format!("source line {key} must be an object when present"))?;
            match field_object.get("rawValue") {
                Some(serde_json::Value::String(text)) => Ok(Some(text.as_str())),
                _ => Err(format!("source line {key} rawValue must be a string")),
            }
        }
    }
}

fn validate_persisted_sds_contribution_evidence(
    lineage: &serde_json::Value,
    source: &serde_json::Value,
    evidence_rows: &[serde_json::Value],
    acquisition_rows: &[serde_json::Value],
) -> Result<(), String> {
    let evidence_id = lineage["evidenceId"].as_str().ok_or_else(|| "SDS evidence identity is required".to_string())?;
    let evidence = evidence_rows.iter().find(|row| row["code"].as_str() == Some(evidence_id))
        .ok_or_else(|| "SDS contribution must reference a persisted extraction evidence record".to_string())?;
    let acquisition_code = lineage["acquisitionCode"].as_str().ok_or_else(|| "SDS acquisition identity is required".to_string())?;
    if evidence["acquisitionCode"].as_str() != Some(acquisition_code)
        || evidence["extractionStatus"].as_str() != Some("unreviewed")
        || evidence["evidence"]["id"].as_str() != Some(evidence_id)
        || evidence["evidence"]["commercialProductId"].as_str() != lineage["commercialProductId"].as_str()
    {
        return Err("SDS contribution must match its persisted unreviewed extraction snapshot".to_string());
    }
    let acquisition = acquisition_rows.iter().find(|row| row["code"].as_str() == Some(acquisition_code))
        .ok_or_else(|| "SDS evidence must reference a persisted supplier document acquisition".to_string())?;
    let source_supplier = source["source"]["supplierId"].as_str();
    if acquisition["documentType"].as_str() != Some("SDS")
        || acquisition["sha256"].as_str().map_or(true, |hash| !hash.eq_ignore_ascii_case(lineage["documentHash"].as_str().unwrap_or("")))
        || source_supplier.is_none()
        || acquisition["supplierId"].as_str() != source_supplier
        || evidence["evidence"]["section1"]["sourceDocumentHash"].as_str().map_or(true, |hash| !hash.eq_ignore_ascii_case(lineage["documentHash"].as_str().unwrap_or("")))
        || evidence["evidence"]["section3"]["sourceDocumentHash"].as_str().map_or(true, |hash| !hash.eq_ignore_ascii_case(lineage["documentHash"].as_str().unwrap_or("")))
    {
        return Err("SDS evidence must match the acquired SDS hash and formulation supplier".to_string());
    }
    let Some(component_id) = lineage["sourceComponentId"].as_str() else {
        if !lineage["sourceFactId"].is_null()
            || !lineage["originalValue"].is_null()
            || !lineage["fractionRange"].is_null()
            || lineage["evidenceRefs"].as_array().map_or(true, |refs| !refs.is_empty())
        {
            return Err("SDS component facts cannot be present without a persisted component identity".to_string());
        }
        return Ok(());
    };
    let component = evidence["evidence"]["section3"]["components"].as_array()
        .and_then(|rows| rows.iter().find(|row| row["id"].as_str() == Some(component_id)))
        .ok_or_else(|| "SDS component must exist in the persisted Section 3 evidence".to_string())?;
    let component_refs = ["componentName", "casNumber", "ecNumber", "materialNumber", "concentration"]
        .iter()
        .filter_map(|key| component.get(*key))
        .flat_map(|fact| fact["evidenceRefs"].as_array().into_iter().flatten())
        .filter_map(|reference| reference.as_str())
        .fold(Vec::<String>::new(), |mut refs, reference| {
            if !refs.iter().any(|existing| existing == reference) { refs.push(reference.to_string()); }
            refs
        });
    let concentration = component.get("concentration");
    let concentration_matches = match concentration {
        Some(fact) => fact["id"].as_str() == lineage["sourceFactId"].as_str()
            && fact["rawValue"].as_str() == lineage["originalValue"].as_str(),
        None => lineage["sourceFactId"].is_null() && lineage["originalValue"].is_null(),
    };
    if !concentration_matches
        || component["disclosure"].as_str() != lineage["disclosure"].as_str()
        || serde_json::json!(component_refs) != lineage["evidenceRefs"]
        || evidence["evidence"]["commercialProductId"].as_str() != lineage["commercialProductId"].as_str()
    {
        return Err("SDS component, concentration, disclosure, and citations must match the persisted evidence".to_string());
    }
    Ok(())
}

fn validate_contribution_bounds(value: &serde_json::Value, maximum: f64, label: &str) -> Result<(f64, f64), String> {
    ensure_object_keys(value, &["lowerBound", "upperBound"], label)?;
    let lower = value["lowerBound"].as_f64().filter(|number| number.is_finite() && *number >= 0.0 && *number <= maximum)
        .ok_or_else(|| format!("{label} lower bound is invalid"))?;
    let upper = value["upperBound"].as_f64().filter(|number| number.is_finite() && *number >= lower && *number <= maximum)
        .ok_or_else(|| format!("{label} upper bound is invalid"))?;
    Ok((lower, upper))
}

fn validate_contribution_interpretation(interpretation: &str, bounds: (f64, f64), label: &str) -> Result<(), String> {
    let exact = (bounds.0 - bounds.1).abs() <= 1e-12;
    if (interpretation == "exact") != exact || !matches!(interpretation, "exact" | "range") {
        return Err(format!("{label} exact/range interpretation does not match its bounds"));
    }
    Ok(())
}

fn contribution_bounds_equal(left: (f64, f64), right: (f64, f64)) -> bool {
    (left.0 - right.0).abs() <= 1e-9 && (left.1 - right.1).abs() <= 1e-9
}

fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn parse_explicit_w_w_percent_range(value: &str) -> Option<(f64, f64)> {
    let (amount, basis) = value.trim().split_once('%')?;
    let normalized_basis = basis.trim().to_ascii_lowercase().replace(' ', "");
    if normalized_basis != "w/w" && normalized_basis != "weight/weight" && normalized_basis != "mass/mass" && normalized_basis != "byweight" {
        return None;
    }
    let amount = amount.trim().replace(',', ".");
    let separator = amount.char_indices().find(|(_, character)| matches!(character, '-' | '–' | '—'));
    let (lower_text, upper_text) = match separator {
        Some((index, character)) => (&amount[..index], Some(&amount[index + character.len_utf8()..])),
        None => (amount.as_str(), None),
    };
    let lower = lower_text.trim().parse::<f64>().ok()?;
    let upper = match upper_text {
        Some(value) => value.trim().parse::<f64>().ok()?,
        None => lower,
    };
    if !lower.is_finite() || !upper.is_finite() || lower < 0.0 || upper < lower || upper > 100.0 { return None; }
    Some((lower, upper))
}

fn ensure_object_keys(value: &serde_json::Value, allowed: &[&str], label: &str) -> Result<(), String> {
    let object = value.as_object().ok_or_else(|| format!("{label} must be an object"))?;
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(format!("{label} contains an unsupported field"));
    }
    Ok(())
}

fn required_nonempty_string(value: &serde_json::Value, field: &str, label: &str) -> Result<String, String> {
    value.get(field).and_then(|item| item.as_str()).filter(|item| !item.trim().is_empty())
        .map(str::to_string).ok_or_else(|| format!("{label} requires {field}"))
}

fn validate_supplier_document_acquisition_record(record: &serde_json::Value) -> Result<(), String> {
    ensure_object_keys(record, &[
        "schemaVersion", "code", "supplierId", "providerId", "surfaceId", "documentType", "acquisitionMethod",
        "sourceUrl", "sourceFileSelection", "sourceProduct", "market", "language", "sourceRevision", "revisionDate",
        "publicationDate", "supersedesCode", "idempotencyKey", "originalFilename", "mimeType", "sha256", "byteSize",
        "parserStatus", "acquiredAt", "createdAt",
    ], "supplier acquisition")?;
    for field in ["code", "supplierId", "providerId", "surfaceId", "documentType", "acquisitionMethod", "market", "language", "originalFilename", "mimeType", "sha256", "parserStatus", "acquiredAt", "createdAt"] {
        required_nonempty_string(record, field, "supplier acquisition")?;
    }
    ensure_object_keys(&record["sourceProduct"], &["sourceProductId", "supplierItemCode", "tradeName", "grade"], "supplier acquisition source product")?;
    for field in ["sourceProductId", "supplierItemCode", "tradeName", "grade"] {
        if record["sourceProduct"].get(field).is_some_and(|value| value.as_str().map_or(true, |text| text.trim().is_empty())) {
            return Err("supplier acquisition source-product identity is invalid".to_string());
        }
    }
    if record["schemaVersion"].as_str() != Some("1.0")
        || !["SDS", "TDS", "FORMULATION", "COA", "CERTIFICATE", "OTHER"].contains(&record["documentType"].as_str().unwrap_or_default())
        || !["automated", "manual_assisted"].contains(&record["acquisitionMethod"].as_str().unwrap_or_default())
        || !["application/pdf", "application/octet-stream"].contains(&record["mimeType"].as_str().unwrap_or_default())
        || !["not_started", "completed", "failed", "unsupported"].contains(&record["parserStatus"].as_str().unwrap_or_default())
        || !is_sha256_hex(record["sha256"].as_str().unwrap_or_default())
        || record["byteSize"].as_u64().map_or(true, |size| size == 0 || size > 100 * 1024 * 1024)
    {
        return Err("supplier acquisition metadata is invalid".to_string());
    }
    let filename = record["originalFilename"].as_str().unwrap_or_default();
    if filename.len() > 160 || filename.trim() != filename || filename.contains("..") || filename.chars().any(|ch| matches!(ch, '/' | '\\' | ':' | '\u{7f}') || ch.is_control()) || filename.ends_with('.') || filename.ends_with(' ') {
        return Err("supplier acquisition filename is unsafe".to_string());
    }
    let product = &record["sourceProduct"];
    if record["documentType"] != "FORMULATION" && ["sourceProductId", "supplierItemCode", "tradeName", "grade"].iter().all(|field| product[*field].as_str().map_or(true, |value| value.trim().is_empty())) {
        return Err("supplier acquisition requires a source-product identity".to_string());
    }
    let method = record["acquisitionMethod"].as_str().unwrap_or_default();
    if method == "automated" {
        let raw = required_nonempty_string(record, "sourceUrl", "automated supplier acquisition")?;
        let url = reqwest::Url::parse(&raw).map_err(|_| "supplier source URL is invalid".to_string())?;
        if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.fragment().is_some()
            || url.query_pairs().any(|(_, value)| value != "[redacted]") {
            return Err("supplier source URL must be sanitized HTTPS provenance".to_string());
        }
        if record.get("sourceFileSelection").is_some() { return Err("automated acquisition cannot claim manual file selection".to_string()); }
    } else {
        let selection = &record["sourceFileSelection"];
        ensure_object_keys(selection, &["selectionId", "originalFilename", "sourceFileSha256", "selectedAt", "selectedBy"], "manual source selection")?;
        for field in ["selectionId", "originalFilename", "sourceFileSha256", "selectedAt", "selectedBy"] { required_nonempty_string(selection, field, "manual source selection")?; }
        if selection["originalFilename"] != record["originalFilename"]
            || !selection["sourceFileSha256"].as_str().unwrap_or_default().eq_ignore_ascii_case(record["sha256"].as_str().unwrap_or_default()) {
            return Err("manual file selection must match the acquired source file".to_string());
        }
    }
    Ok(())
}

fn validate_source_hashes(value: &serde_json::Value, expected_hash: &str) -> Result<(), String> {
    match value {
        serde_json::Value::Object(object) => {
            for (key, child) in object {
                if matches!(key.as_str(), "sourceDocumentHash" | "sourcePdfSha256")
                    && child.as_str().map_or(true, |hash| !hash.eq_ignore_ascii_case(expected_hash)) {
                    return Err("reference formulation contains evidence linked to another source hash".to_string());
                }
                validate_source_hashes(child, expected_hash)?;
            }
        }
        serde_json::Value::Array(items) => for item in items { validate_source_hashes(item, expected_hash)?; },
        _ => {}
    }
    Ok(())
}

fn ensure_schema_object(value: &serde_json::Value, required: &[&str], optional: &[&str], label: &str) -> Result<(), String> {
    ensure_object_keys(value, &required.iter().chain(optional).copied().collect::<Vec<_>>(), label)?;
    if required.iter().any(|key| !value.as_object().is_some_and(|object| object.contains_key(*key))) {
        return Err(format!("{label} is missing a required schema field"));
    }
    Ok(())
}

fn validate_string_array(value: &serde_json::Value, label: &str, minimum: usize) -> Result<(), String> {
    let items = value.as_array().ok_or_else(|| format!("{label} must be an array"))?;
    if items.len() < minimum || items.iter().any(|item| item.as_str().map_or(true, |text| text.trim().is_empty())) {
        return Err(format!("{label} contains an invalid string"));
    }
    Ok(())
}

fn validate_reference_evidence(value: &serde_json::Value, field_evidence: bool, label: &str) -> Result<(), String> {
    let mut required = vec!["sourceDocumentHash", "pageNumber", "blockIndex", "excerpt", "source"];
    if field_evidence { required.extend(["rowIndex", "cellIndex", "headerRowIndex", "header"]); }
    let optional = if field_evidence { vec!["confidence", "position"] } else { vec!["rowIndex", "cellIndex", "confidence", "position"] };
    ensure_schema_object(value, &required, &optional, label)?;
    if !is_sha256_hex(value["sourceDocumentHash"].as_str().unwrap_or_default())
        || value["pageNumber"].as_u64().unwrap_or(0) == 0
        || value["blockIndex"].as_u64().is_none()
        || value["excerpt"].as_str().map_or(true, str::is_empty)
        || !["digital", "ocr", "mixed", "unknown"].contains(&value["source"].as_str().unwrap_or_default())
        || (field_evidence && (value["rowIndex"].as_u64().is_none() || value["cellIndex"].as_u64().is_none()
            || value["headerRowIndex"].as_u64().is_none() || value["header"].as_str().map_or(true, str::is_empty)))
        || value.get("confidence").is_some_and(|v| v.as_f64().map_or(true, |n| !(0.0..=1.0).contains(&n)))
    {
        return Err(format!("{label} does not match the versioned evidence schema"));
    }
    if let Some(position) = value.get("position") {
        ensure_schema_object(position, &["x", "y"], &[], "evidence position")?;
        if position["x"].as_f64().map_or(true, |n| n < 0.0) || position["y"].as_f64().map_or(true, |n| n < 0.0) {
            return Err("evidence position is invalid".to_string());
        }
    }
    Ok(())
}

fn validate_reference_formulation_record_schema(record: &serde_json::Value) -> Result<(), String> {
    ensure_schema_object(record, &[
        "schemaVersion", "recordKind", "id", "code", "source", "sourceDocumentHash", "parserVersions", "identityCandidates",
        "identityMetadataComparisons", "identityWarnings", "ingredientLines", "arithmetic", "procedureSteps", "procedureWarnings",
        "targetCandidates", "targetWarnings", "productMatches", "productMatchWarnings", "unresolvedEntries", "reviewStatus", "createdAt",
    ], &[], "reference formulation")?;
    for field in ["identityCandidates", "identityMetadataComparisons", "identityWarnings", "ingredientLines", "procedureSteps", "procedureWarnings", "targetCandidates", "targetWarnings", "productMatches", "productMatchWarnings", "unresolvedEntries"] {
        if !record[field].is_array() { return Err(format!("reference formulation {field} must be an array")); }
    }
    ensure_schema_object(&record["parserVersions"], &["identity", "ingredients", "arithmetic", "procedure", "targets", "productMatcher", "unresolvedQueue"], &[], "parser versions")?;
    let versions = &record["parserVersions"];
    if versions["identity"] != "formulab-reference-formulation-identity-v1"
        || versions["ingredients"] != "formulab-reference-formulation-ingredients-v1"
        || versions["arithmetic"] != "formulab-reference-formulation-arithmetic-v1"
        || !["formulab-reference-formulation-procedure-v1", "formulab-reference-formulation-procedure-v2"].contains(&versions["procedure"].as_str().unwrap_or_default())
        || versions["targets"] != "formulab-reference-formulation-targets-v1"
        || !["formulab-reference-formulation-product-matcher-v1", "formulab-reference-formulation-product-matcher-v2"].contains(&versions["productMatcher"].as_str().unwrap_or_default())
        || versions["unresolvedQueue"] != "formulab-reference-formulation-unresolved-queue-v1"
    { return Err("reference formulation parser versions are unsupported".to_string()); }

    for candidate in record["identityCandidates"].as_array().unwrap() {
        ensure_schema_object(candidate, &["field", "rawValue", "extractionMethod", "evidence", "reviewRequired"], &[], "identity candidate")?;
        if !["supplier_name", "application", "product_family", "formulation_title", "formulation_code", "revision_identifier", "revision_date", "publication_date", "document_version", "source_identifier"].contains(&candidate["field"].as_str().unwrap_or_default())
            || !["labeled_field", "semantic_heading", "embedded_formulation_code"].contains(&candidate["extractionMethod"].as_str().unwrap_or_default())
            || candidate["reviewRequired"] != true || candidate["rawValue"].as_str().map_or(true, |value| value.trim().is_empty())
            || candidate["evidence"].as_array().map_or(true, |items| items.is_empty())
        { return Err("identity candidate does not match the versioned schema".to_string()); }
        for evidence in candidate["evidence"].as_array().unwrap() { validate_reference_evidence(evidence, false, "identity evidence")?; }
    }

    for comparison in record["identityMetadataComparisons"].as_array().unwrap() {
        ensure_schema_object(comparison, &["field", "acquisitionValue", "extractedValues", "result", "acquisitionCode", "reviewRequired"], &[], "identity metadata comparison")?;
        if !["revision_identifier", "revision_date", "publication_date"].contains(&comparison["field"].as_str().unwrap_or_default())
            || !["matches", "differs", "ambiguous"].contains(&comparison["result"].as_str().unwrap_or_default())
            || comparison["acquisitionValue"].as_str().map_or(true, str::is_empty)
            || comparison["acquisitionCode"].as_str().map_or(true, str::is_empty)
            || comparison["extractedValues"].as_array().map_or(true, |items| items.is_empty() || items.iter().any(|item| item.as_str().map_or(true, str::is_empty)))
            || comparison["reviewRequired"] != true
        { return Err("identity metadata comparison does not match the versioned schema".to_string()); }
    }
    for (field, allowed) in [
        ("identityWarnings", &["no_identity_candidates", "conflicting_identity_candidates", "acquisition_metadata_differs"][..]),
        ("procedureWarnings", &["procedure_section_not_detected", "no_procedure_steps", "ambiguous_procedure_columns", "ocr_process_requires_review"][..]),
        ("targetWarnings", &["no_target_result_section", "no_target_result_candidates", "ambiguous_property_columns", "ocr_target_results_require_review"][..]),
        ("productMatchWarnings", &["ambiguous_product_candidates", "fuzzy_matches_are_proposals_only", "unmatched_ingredient_lines", "supplier_products_excluded"][..]),
    ] {
        if record[field].as_array().unwrap().iter().any(|entry| !allowed.contains(&entry.as_str().unwrap_or_default())) {
            return Err(format!("reference formulation {field} contains an unsupported value"));
        }
    }

    for line in record["ingredientLines"].as_array().unwrap() {
        ensure_schema_object(line, &["id", "sourceDocumentHash", "orderIndex", "pageNumber", "tableBlockIndex", "rowIndex", "rawRow", "quantitySemantics", "reviewRequired"], &["ingredientName", "supplierProductCode", "inciOrChemicalName", "function", "phase", "amount", "unit", "basis"], "ingredient line")?;
        if !is_sha256_hex(line["sourceDocumentHash"].as_str().unwrap_or_default()) || line["orderIndex"].as_u64().unwrap_or(0) == 0
            || line["pageNumber"].as_u64().unwrap_or(0) == 0 || line["tableBlockIndex"].as_u64().is_none() || line["rowIndex"].as_u64().is_none()
            || line["rawRow"].as_array().is_none() || !["explicit_amount", "q_s", "not_stated"].contains(&line["quantitySemantics"].as_str().unwrap_or_default())
            || line["reviewRequired"] != true { return Err("ingredient line does not match the versioned schema".to_string()); }
        validate_string_array(&line["rawRow"], "ingredient source row", 0)?;
        for field in ["ingredientName", "supplierProductCode", "inciOrChemicalName", "function", "phase", "amount", "unit", "basis"] {
            if let Some(cell) = line.get(field) {
                ensure_schema_object(cell, &["rawValue", "evidence"], &[], "ingredient source cell")?;
                if cell["rawValue"].as_str().map_or(true, |value| value.trim().is_empty()) { return Err("ingredient source value is invalid".to_string()); }
                validate_reference_evidence(&cell["evidence"], true, "ingredient field evidence")?;
            }
        }
    }

    for step in record["procedureSteps"].as_array().unwrap() {
        ensure_schema_object(step, &["id", "sequenceOrder", "rawInstruction", "rawContextCells", "actions", "conditions", "extractionMethod", "evidence", "reviewRequired"], &["printedStepNumber", "phase"], "procedure step")?;
        required_nonempty_string(step, "id", "procedure step")?;
        if step["sequenceOrder"].as_u64().unwrap_or(0) == 0 || step["rawInstruction"].as_str().map_or(true, |v| v.is_empty() || v.len() > 4000)
            || step["rawContextCells"].as_array().is_none() || step["actions"].as_array().map_or(true, |items| items.is_empty())
            || step["conditions"].as_array().is_none() || !["procedure_section_text", "procedure_table_column"].contains(&step["extractionMethod"].as_str().unwrap_or_default())
            || step["reviewRequired"] != true { return Err("procedure step does not match the versioned schema".to_string()); }
        validate_string_array(&step["rawContextCells"], "procedure source cells", 0)?;
        if step["actions"].as_array().unwrap().iter().any(|action| !["addition", "dissolve", "mix", "hold", "heat", "cool", "adjust_ph", "thicken", "appearance_check", "finish", "other"].contains(&action.as_str().unwrap_or_default())) {
            return Err("procedure step contains an unsupported action".to_string());
        }
        validate_reference_evidence(&step["evidence"], false, "procedure evidence")?;
        if let Some(phase) = step.get("phase") { ensure_schema_object(phase, &["rawValue", "evidence"], &[], "procedure phase")?; if phase["rawValue"].as_str().map_or(true, str::is_empty) { return Err("procedure phase is invalid".to_string()); } validate_reference_evidence(&phase["evidence"], false, "phase evidence")?; }
        for condition in step["conditions"].as_array().unwrap() {
            ensure_schema_object(condition, &["kind", "rawValue", "evidence"], &[], "procedure condition")?;
            if !["temperature", "time", "speed", "ph", "appearance", "homogeneity"].contains(&condition["kind"].as_str().unwrap_or_default()) { return Err("procedure condition kind is invalid".to_string()); }
            if condition["rawValue"].as_str().map_or(true, str::is_empty) { return Err("procedure condition value is invalid".to_string()); }
            validate_reference_evidence(&condition["evidence"], false, "condition evidence")?;
        }
    }

    for target in record["targetCandidates"].as_array().unwrap() {
        ensure_schema_object(target, &["id", "field", "rawPropertyLabel", "rawValue", "valueShape", "resultSemantics", "evidence", "reviewRequired"], &[], "target candidate")?;
        required_nonempty_string(target, "id", "target candidate")?;
        if !["ph", "viscosity", "density", "appearance", "other"].contains(&target["field"].as_str().unwrap_or_default())
            || !["point_or_exact", "range", "approximate", "approximate_range", "unparsed"].contains(&target["valueShape"].as_str().unwrap_or_default())
            || !["target", "typical_result", "unspecified"].contains(&target["resultSemantics"].as_str().unwrap_or_default()) || target["reviewRequired"] != true
            || target["rawPropertyLabel"].as_str().map_or(true, str::is_empty) || target["rawValue"].as_str().map_or(true, str::is_empty)
        { return Err("target candidate does not match the versioned schema".to_string()); }
        validate_reference_evidence(&target["evidence"], false, "target evidence")?;
    }

    let arithmetic = &record["arithmetic"];
    ensure_schema_object(arithmetic, &["sourceId", "acquisitionCode", "sourceDocumentHash", "parserVersion", "arithmeticStatus", "lineCount", "duplicateLineGroups", "warnings", "reviewRequired"], &["sourceDeclaredTotal", "calculatedTotal"], "arithmetic snapshot")?;
    if !["calculated_only", "incomplete", "source_total_not_comparable", "consistent", "overlap", "inconsistent", "no_ingredient_rows"].contains(&arithmetic["arithmeticStatus"].as_str().unwrap_or_default())
        || arithmetic["parserVersion"] != "formulab-reference-formulation-arithmetic-v1" || arithmetic["lineCount"].as_u64().is_none()
        || arithmetic["duplicateLineGroups"].as_array().is_none() || arithmetic["warnings"].as_array().is_none() || arithmetic["reviewRequired"] != true
    { return Err("arithmetic snapshot does not match the versioned schema".to_string()); }
    if arithmetic["warnings"].as_array().unwrap().iter().any(|warning| !["no_ingredient_rows", "missing_amount", "q_s_prevents_total", "unknown_unit_or_basis", "invalid_amount_format", "percentage_out_of_range", "duplicate_ingredient_rows", "source_total_not_comparable", "source_total_mismatch", "source_total_overlap", "ocr_arithmetic_requires_review"].contains(&warning.as_str().unwrap_or_default())) {
        return Err("arithmetic snapshot contains an unsupported warning".to_string());
    }
    for group in arithmetic["duplicateLineGroups"].as_array().unwrap() { validate_string_array(group, "duplicate ingredient group", 2)?; }
    if let Some(total) = arithmetic.get("sourceDeclaredTotal") {
        ensure_schema_object(total, &["rawValue", "evidence"], &["unit", "basis"], "source declared total")?;
        if total["rawValue"].as_str().map_or(true, str::is_empty)
            || ["unit", "basis"].iter().any(|field| total.get(*field).is_some_and(|value| value.as_str().map_or(true, str::is_empty)))
        { return Err("declared source total is invalid".to_string()); }
        validate_reference_evidence(&total["evidence"], false, "declared total evidence")?;
    }
    if let Some(total) = arithmetic.get("calculatedTotal") {
        ensure_schema_object(total, &["kind", "lowerBound", "upperBound", "unit"], &[], "calculated total")?;
        let lower = total["lowerBound"].as_str().and_then(|value| value.parse::<f64>().ok());
        let upper = total["upperBound"].as_str().and_then(|value| value.parse::<f64>().ok());
        if !["exact", "range"].contains(&total["kind"].as_str().unwrap_or_default()) || total["unit"] != "% w/w"
            || lower.map_or(true, |value| !value.is_finite() || value < 0.0)
            || upper.map_or(true, |value| !value.is_finite() || value < lower.unwrap_or(0.0))
            || (total["kind"] == "exact") != (total["lowerBound"] == total["upperBound"])
        { return Err("calculated total is invalid".to_string()); }
    }

    for matches in record["productMatches"].as_array().unwrap() {
        ensure_schema_object(matches, &["ingredientLineId", "sourceSupplierId", "resolution", "candidates", "autoLinked", "reviewRequired"], &[], "product match")?;
        if !["external_id_crosswalk_candidate", "exact_match_candidate", "alias_match_candidate", "fuzzy_proposal", "ambiguous", "unmatched"].contains(&matches["resolution"].as_str().unwrap_or_default())
            || matches["candidates"].as_array().is_none() || matches["autoLinked"] != false || matches["reviewRequired"] != true
            || matches["ingredientLineId"].as_str().map_or(true, str::is_empty)
            || matches["sourceSupplierId"] != record["source"]["supplierId"]
            || !record["ingredientLines"].as_array().unwrap().iter().any(|line| line["id"] == matches["ingredientLineId"])
        { return Err("product match does not match the versioned schema or source lines".to_string()); }
        for candidate in matches["candidates"].as_array().unwrap() {
            ensure_schema_object(candidate, &["commercialProductId", "tier", "matchedOn", "matchedValues", "sourceDocumentCodes"], &["externalIdCrosswalkCode", "similarity"], "commercial-product match candidate")?;
            if !["external_id_crosswalk", "exact", "controlled_alias", "fuzzy_proposal"].contains(&candidate["tier"].as_str().unwrap_or_default())
                || candidate["matchedOn"].as_array().is_none() || candidate["matchedValues"].as_array().is_none() || candidate["sourceDocumentCodes"].as_array().is_none()
                || (candidate["tier"] == "external_id_crosswalk") != candidate.get("externalIdCrosswalkCode").is_some()
                || candidate["commercialProductId"].as_str().map_or(true, str::is_empty)
                || candidate.get("externalIdCrosswalkCode").is_some_and(|value| value.as_str().map_or(true, str::is_empty))
                || candidate.get("similarity").is_some_and(|value| value.as_f64().map_or(true, |score| !(0.0..=1.0).contains(&score)))
            { return Err("commercial-product match candidate is invalid".to_string()); }
            validate_string_array(&candidate["matchedOn"], "product match fields", 0)?;
            validate_string_array(&candidate["matchedValues"], "product match values", 0)?;
            validate_string_array(&candidate["sourceDocumentCodes"], "product match source documents", 0)?;
            if candidate["matchedOn"].as_array().unwrap().iter().any(|item| !["product_code", "trade_name", "alias"].contains(&item.as_str().unwrap_or_default())) {
                return Err("product match contains an unsupported matching field".to_string());
            }
        }
    }
    for entry in record["unresolvedEntries"].as_array().unwrap() {
        ensure_schema_object(entry, &["id", "sourceId", "sourceDocumentHash", "sourceSupplierId", "ingredientLine", "status", "reasons", "candidateCommercialProductIds", "supportingSdsDocumentCodes", "requestedDocumentKinds", "nextActions", "reviewRequired"], &[], "unresolved entry")?;
        if !["ready_for_acquisition", "ready_for_review"].contains(&entry["status"].as_str().unwrap_or_default())
            || entry["reasons"].as_array().map_or(true, |items| items.is_empty()) || entry["candidateCommercialProductIds"].as_array().is_none()
            || entry["supportingSdsDocumentCodes"].as_array().is_none() || entry["requestedDocumentKinds"].as_array().map_or(true, |items| items.is_empty())
            || entry["nextActions"].as_array().map_or(true, |items| items.is_empty()) || entry["reviewRequired"] != true
        { return Err("unresolved entry does not match the versioned schema".to_string()); }
        if entry["id"].as_str().map_or(true, str::is_empty) || entry["sourceId"] != record["source"]["id"]
            || entry["sourceSupplierId"] != record["source"]["supplierId"]
            || !entry["sourceDocumentHash"].as_str().unwrap_or_default().eq_ignore_ascii_case(record["sourceDocumentHash"].as_str().unwrap_or_default())
            || !record["ingredientLines"].as_array().unwrap().iter().any(|line| line == &entry["ingredientLine"])
            || entry["reasons"].as_array().unwrap().iter().any(|item| !["product_identity_unmatched", "product_identity_ambiguous", "fuzzy_match_requires_review", "product_match_requires_human_review", "supporting_sds_missing"].contains(&item.as_str().unwrap_or_default()))
            || entry["requestedDocumentKinds"].as_array().unwrap().iter().any(|item| !["SDS", "TDS"].contains(&item.as_str().unwrap_or_default()))
            || entry["nextActions"].as_array().unwrap().iter().any(|item| !["identify_supplier_product", "review_product_candidates", "acquire_supplier_documents"].contains(&item.as_str().unwrap_or_default()))
        { return Err("unresolved entry is not a valid source-line review record".to_string()); }
        validate_string_array(&entry["reasons"], "unresolved reasons", 1)?;
        validate_string_array(&entry["candidateCommercialProductIds"], "unresolved product candidates", 0)?;
        validate_string_array(&entry["supportingSdsDocumentCodes"], "unresolved SDS references", 0)?;
        validate_string_array(&entry["requestedDocumentKinds"], "requested document kinds", 1)?;
        validate_string_array(&entry["nextActions"], "unresolved next actions", 1)?;
        validate_source_hashes(&entry["ingredientLine"], record["sourceDocumentHash"].as_str().unwrap_or_default())?;
    }
    let line_ids = record["ingredientLines"].as_array().unwrap().iter().filter_map(|line| line["id"].as_str()).collect::<Vec<_>>();
    let matched_ids = record["productMatches"].as_array().unwrap().iter().filter_map(|row| row["ingredientLineId"].as_str()).collect::<Vec<_>>();
    let unresolved_ids = record["unresolvedEntries"].as_array().unwrap().iter().filter_map(|row| row["ingredientLine"]["id"].as_str()).collect::<Vec<_>>();
    let unique_lines = line_ids.iter().collect::<std::collections::HashSet<_>>();
    if unique_lines.len() != line_ids.len() || matched_ids.len() != line_ids.len() || unresolved_ids.len() != line_ids.len()
        || line_ids.iter().any(|id| matched_ids.iter().filter(|candidate| *candidate == id).count() != 1 || unresolved_ids.iter().filter(|candidate| *candidate == id).count() != 1)
        || record["arithmetic"]["lineCount"].as_u64() != Some(line_ids.len() as u64)
    { return Err("reference-formulation lines, product matches, unresolved entries and arithmetic counts must agree".to_string()); }

    let source = &record["source"];
    let rights = &source["rights"];
    ensure_schema_object(rights, &["status"], &["redistribution", "rightsHolder", "licenseName", "licenseUrl", "permissionReference", "evidenceRefs", "usePermissions", "retentionPolicy"], "source rights")?;
    if !["unknown", "publicly_available", "licensed", "permission_granted", "owner_provided", "restricted"].contains(&rights["status"].as_str().unwrap_or_default())
        || rights.get("redistribution").is_some_and(|v| !["unknown", "allowed", "prohibited"].contains(&v.as_str().unwrap_or_default()))
    { return Err("source rights do not match the versioned schema".to_string()); }
    if rights.get("evidenceRefs").is_some() { validate_string_array(&rights["evidenceRefs"], "source-rights evidence references", 0)?; }
    if (rights["status"] != "unknown" || rights.get("redistribution").is_some_and(|v| v != "unknown"))
        && rights.get("evidenceRefs").and_then(serde_json::Value::as_array).map_or(true, |items| items.is_empty())
    { return Err("asserted source rights require evidence references".to_string()); }
    if rights["status"] == "licensed" && rights.get("licenseName").is_none() && rights.get("licenseUrl").is_none() {
        return Err("licensed source rights require license metadata".to_string());
    }
    if rights["status"] == "permission_granted" && rights.get("permissionReference").is_none() {
        return Err("granted source rights require a permission reference".to_string());
    }
    if let Some(permissions) = rights.get("usePermissions") {
        ensure_object_keys(permissions, &["internalResearch", "sameSupplierPrior", "crossSupplierPrior", "sourceExport", "derivedExport"], "source-use permissions")?;
        for (_, decision) in permissions.as_object().unwrap() {
            ensure_schema_object(decision, &["status"], &["evidenceRefs"], "source-use permission")?;
            if !["unknown", "allowed", "prohibited"].contains(&decision["status"].as_str().unwrap_or_default()) { return Err("source-use permission status is invalid".to_string()); }
            if decision.get("evidenceRefs").is_some() { validate_string_array(&decision["evidenceRefs"], "source-use evidence references", 0)?; }
            if decision["status"] != "unknown" && decision.get("evidenceRefs").and_then(serde_json::Value::as_array).map_or(true, |items| items.is_empty()) {
                return Err("asserted source-use permission requires evidence references".to_string());
            }
        }
    }
    if let Some(retention) = rights.get("retentionPolicy") {
        ensure_schema_object(retention, &["status"], &["expiresAt", "evidenceRefs"], "source retention policy")?;
        if !["unknown", "retain_until_revoked", "retain_until_date", "delete_after_use"].contains(&retention["status"].as_str().unwrap_or_default())
            || (retention["status"] == "retain_until_date") != retention.get("expiresAt").is_some()
        { return Err("source retention policy is invalid".to_string()); }
        if retention.get("evidenceRefs").is_some() { validate_string_array(&retention["evidenceRefs"], "retention evidence references", 0)?; }
        if retention["status"] != "unknown" && retention.get("evidenceRefs").and_then(serde_json::Value::as_array).map_or(true, |items| items.is_empty()) {
            return Err("asserted source retention requires evidence references".to_string());
        }
    }
    Ok(())
}

fn validate_reference_formulation_source_record(record: &serde_json::Value, acquisition: &serde_json::Value) -> Result<(), String> {
    validate_reference_formulation_record_schema(record)?;
    ensure_object_keys(record, &[
        "schemaVersion", "recordKind", "id", "code", "source", "sourceDocumentHash", "parserVersions", "identityCandidates",
        "identityMetadataComparisons", "identityWarnings", "ingredientLines", "arithmetic", "procedureSteps", "procedureWarnings",
        "targetCandidates", "targetWarnings", "productMatches", "productMatchWarnings", "unresolvedEntries", "reviewStatus", "createdAt",
    ], "reference formulation")?;
    let source = &record["source"];
    ensure_object_keys(source, &[
        "schemaVersion", "id", "supplierId", "providerId", "surfaceId", "sourceProduct", "acquisitionCode", "sourcePdfSha256",
        "acquisitionMethod", "sourceUrl", "sourceFileSelection", "originalFilename", "sourceByteSize", "acquiredAt", "publicationDate",
        "revisionDate", "sourceRevision", "formulationCode", "title", "market", "language", "parserVersion", "rights", "supersedesSourceId", "createdAt",
    ], "reference formulation source")?;
    for field in ["id", "code", "createdAt"] { required_nonempty_string(record, field, "reference formulation")?; }
    for field in ["id", "acquisitionCode", "supplierId", "providerId", "surfaceId", "sourcePdfSha256", "acquisitionMethod", "originalFilename", "acquiredAt", "title", "market", "language", "parserVersion", "createdAt"] {
        required_nonempty_string(source, field, "reference formulation source")?;
    }
    let hash = required_nonempty_string(record, "sourceDocumentHash", "reference formulation")?;
    if record["schemaVersion"].as_str() != Some("1.0") || record["recordKind"].as_str() != Some("supplier_reference_formula")
        || record["reviewStatus"].as_str() != Some("unreviewed") || !is_sha256_hex(&hash)
        || acquisition["documentType"].as_str() != Some("FORMULATION")
        || source["schemaVersion"].as_str() != Some("1.0")
        || !source["sourcePdfSha256"].as_str().unwrap_or_default().eq_ignore_ascii_case(&hash)
        || !acquisition["sha256"].as_str().unwrap_or_default().eq_ignore_ascii_case(&hash)
        || source["acquisitionCode"] != acquisition["code"]
        || source["supplierId"] != acquisition["supplierId"] || source["providerId"] != acquisition["providerId"]
        || source["surfaceId"] != acquisition["surfaceId"] || source["sourceProduct"] != acquisition["sourceProduct"]
        || source["acquisitionMethod"] != acquisition["acquisitionMethod"] || source["originalFilename"] != acquisition["originalFilename"]
        || source["sourceByteSize"] != acquisition["byteSize"] || source["market"] != acquisition["market"]
        || source["language"] != acquisition["language"] || source["acquiredAt"] != acquisition["acquiredAt"]
        || source.get("sourceUrl") != acquisition.get("sourceUrl")
        || source.get("sourceFileSelection") != acquisition.get("sourceFileSelection")
        || record["arithmetic"]["sourceId"] != source["id"] || record["arithmetic"]["acquisitionCode"] != acquisition["code"]
        || !record["arithmetic"]["sourceDocumentHash"].as_str().unwrap_or_default().eq_ignore_ascii_case(&hash)
    {
        return Err("reference formulation source must match a verified FORMULATION acquisition".to_string());
    }
    validate_source_hashes(record, &hash)
}

fn validate_normalization_candidates(value: &serde_json::Value, label: &str) -> Result<Vec<String>, String> {
    ensure_object_keys(value, &["status", "candidateIds"], &format!("{label} candidates"))?;
    let ids = value["candidateIds"].as_array()
        .ok_or_else(|| format!("{label} candidate IDs must be an array"))?
        .iter()
        .map(|candidate| candidate.as_str()
            .filter(|id| !id.trim().is_empty() && *id == id.trim())
            .map(str::to_string)
            .ok_or_else(|| format!("{label} candidate identity is invalid")))
        .collect::<Result<Vec<_>, _>>()?;
    let unique_ids = ids.iter().collect::<std::collections::HashSet<_>>();
    if unique_ids.len() != ids.len() {
        return Err(format!("{label} candidate IDs must be unique"));
    }
    if !normalization_candidate_status_matches(value["status"].as_str(), ids.len()) {
        return Err(format!("{label} candidate status does not match its candidate count"));
    }
    Ok(ids)
}

fn validate_reference_formulation_function_normalization(
    normalization: &serde_json::Value,
    source_line: &serde_json::Value,
) -> Result<(), String> {
    ensure_object_keys(normalization, &["supplierFunction", "canonicalFunction", "reviewRequired"], "function normalization")?;
    if normalization["reviewRequired"].as_bool() != Some(true) {
        return Err("canonical function candidates must remain review-required".to_string());
    }
    let supplier_function = &normalization["supplierFunction"];
    ensure_object_keys(supplier_function, &["status", "originalValue", "evidenceRefs"], "supplier function evidence")?;
    let refs = supplier_function["evidenceRefs"].as_array()
        .ok_or_else(|| "supplier function evidence references must be an array".to_string())?;
    let source_function = source_line.get("function");
    match source_function {
        None => {
            if supplier_function["status"].as_str() != Some("not_stated")
                || supplier_function.get("originalValue").is_some()
                || !refs.is_empty()
            {
                return Err("unstated supplier function cannot carry inferred wording or evidence".to_string());
            }
        }
        Some(field) => {
            let source_value = field["rawValue"].as_str()
                .ok_or_else(|| "source supplier function must retain its raw value".to_string())?;
            let evidence = &field["evidence"];
            let expected_ref = format!("formula:{}:{}:{}:{}:{}", evidence["sourceDocumentHash"].as_str().unwrap_or(""),
                evidence["pageNumber"].as_u64().unwrap_or(0), evidence["blockIndex"].as_u64().unwrap_or(0),
                evidence["rowIndex"].as_u64().unwrap_or(0), evidence["cellIndex"].as_u64().unwrap_or(0));
            if supplier_function["status"].as_str() != Some("stated")
                || supplier_function["originalValue"].as_str() != Some(source_value)
                || refs.len() != 1
                || refs[0].as_str() != Some(expected_ref.as_str())
            {
                return Err("supplier function wording and citation must match the immutable source line".to_string());
            }
        }
    }
    let canonical_function = &normalization["canonicalFunction"];
    let candidates = validate_normalization_candidates(canonical_function, "canonical function")?;
    const MATERIAL_FUNCTIONS: &[&str] = &[
        "anionic_surfactant", "nonionic_surfactant", "amphoteric_surfactant", "cationic_surfactant", "builder",
        "chelating_agent", "preservative", "fragrance", "colorant", "enzyme", "bleaching_agent", "oxygen_donor",
        "abrasive", "humectant", "emollient", "conditioning_agent", "rheology_modifier", "ph_adjuster", "solvent",
        "disinfectant_active", "qac_active", "chlorhexidine_active", "fluoride_active", "antioxidant",
        "anti_redeposition_agent", "optical_brightener", "foam_controller", "opacifier", "filler", "water",
    ];
    if candidates.iter().any(|candidate| !MATERIAL_FUNCTIONS.contains(&candidate.as_str())) {
        return Err("canonical function candidate is outside the shared MaterialFunction vocabulary".to_string());
    }
    if source_function.is_none() && !candidates.is_empty() {
        return Err("canonical function candidates require explicit supplier-function evidence".to_string());
    }
    Ok(())
}

fn process_evidence_ref(evidence: &serde_json::Value) -> Result<String, String> {
    let hash = evidence["sourceDocumentHash"].as_str()
        .ok_or_else(|| "process evidence is missing its source hash".to_string())?;
    let page = evidence["pageNumber"].as_u64()
        .ok_or_else(|| "process evidence page is invalid".to_string())?;
    let block = evidence["blockIndex"].as_u64()
        .ok_or_else(|| "process evidence block is invalid".to_string())?;
    let row = evidence.get("rowIndex").and_then(|value| value.as_u64()).map(|value| value.to_string()).unwrap_or_else(|| "text".to_string());
    let cell = evidence.get("cellIndex").and_then(|value| value.as_u64()).map(|value| value.to_string()).unwrap_or_else(|| "text".to_string());
    Ok(format!("formula:{hash}:{page}:{block}:{row}:{cell}"))
}

fn explicit_phase_values(instruction: &str, explicit_phase: Option<&serde_json::Value>, step_evidence_ref: &str) -> Result<Vec<(String, Vec<String>)>, String> {
    let lower = instruction.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut values: Vec<(String, Vec<String>)> = Vec::new();
    if let Some(phase) = explicit_phase {
        ensure_object_keys(phase, &["rawValue", "evidence"], "source process phase")?;
        let raw_value = phase["rawValue"].as_str().filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "source process phase value is invalid".to_string())?;
        values.push((raw_value.to_string(), vec![process_evidence_ref(&phase["evidence"])?]));
    }
    let mut cursor = 0;
    while cursor + 6 <= bytes.len() {
        let Some(relative) = lower[cursor..].find("phase ") else { break; };
        let start = cursor + relative + 6;
        let end = bytes[start..].iter().position(|byte| !byte.is_ascii_alphanumeric() && *byte != b'_' && *byte != b'-')
            .map(|offset| start + offset).unwrap_or(bytes.len());
        if end > start {
            let value = instruction[start..end].to_string();
            if let Some((_, refs)) = values.iter_mut().find(|(existing, _)| existing.eq_ignore_ascii_case(&value)) {
                if !refs.contains(&step_evidence_ref.to_string()) { refs.push(step_evidence_ref.to_string()); }
            } else {
                values.push((value, vec![step_evidence_ref.to_string()]));
            }
        }
        cursor = end.max(start + 1);
    }
    Ok(values)
}

fn validate_reference_formulation_process_normalization(
    normalization: &serde_json::Value,
    source: &serde_json::Value,
) -> Result<(), String> {
    ensure_object_keys(normalization, &["normalizerVersion", "sourceStatus", "steps", "sourceWarnings", "reviewRequired"], "process normalization")?;
    if normalization["normalizerVersion"].as_str() != Some("formulab-reference-formulation-process-normalization-v1")
        || normalization["reviewRequired"].as_bool() != Some(true)
    {
        return Err("process normalization version or review state is invalid".to_string());
    }
    let source_steps = source["procedureSteps"].as_array()
        .ok_or_else(|| "immutable formulation procedure steps are missing".to_string())?;
    let steps = normalization["steps"].as_array()
        .ok_or_else(|| "normalized process steps must be an array".to_string())?;
    if steps.len() != source_steps.len()
        || normalization["sourceWarnings"] != source["procedureWarnings"]
        || normalization["sourceStatus"].as_str() != Some(if source_steps.is_empty() { "no_steps_extracted" } else { "available" })
    {
        return Err("normalized process coverage and warnings must match the immutable source procedure snapshot".to_string());
    }
    for (index, (normalized, source_step)) in steps.iter().zip(source_steps).enumerate() {
        ensure_object_keys(normalized, &["sourceProcedureStepId", "sequenceOrder", "printedStepNumber", "originalInstruction", "actionCandidates", "phaseCandidates", "conditions", "evidenceRefs", "reviewRequired"], "normalized process step")?;
        let step_id = source_step["id"].as_str().ok_or_else(|| "source process step identity is invalid".to_string())?;
        let raw_instruction = source_step["rawInstruction"].as_str().ok_or_else(|| "source process instruction is invalid".to_string())?;
        let source_hash = source["sourceDocumentHash"].as_str().ok_or_else(|| "source formulation hash is invalid".to_string())?;
        for evidence in std::iter::once(&source_step["evidence"])
            .chain(source_step.get("phase").map(|phase| &phase["evidence"]))
            .chain(source_step["conditions"].as_array().into_iter().flatten().map(|condition| &condition["evidence"]))
        {
            if evidence["sourceDocumentHash"].as_str().map_or(true, |hash| !hash.eq_ignore_ascii_case(source_hash)) {
                return Err("source process fact evidence must cite the immutable formulation document".to_string());
            }
        }
        let step_evidence = process_evidence_ref(&source_step["evidence"])?;
        let expected_refs = serde_json::json!([step_evidence]);
        let expected_phases = explicit_phase_values(raw_instruction, source_step.get("phase"), &step_evidence)?;
        let expected_phase_status = match expected_phases.len() { 0 => "unresolved", 1 => "proposed", _ => "ambiguous" };
        let phase = &normalized["phaseCandidates"];
        ensure_object_keys(phase, &["status", "candidateValues"], "process phase candidates")?;
        let phase_values = phase["candidateValues"].as_array()
            .ok_or_else(|| "process phase candidates must be an array".to_string())?;
        if phase["status"].as_str() != Some(expected_phase_status)
            || phase_values.len() != expected_phases.len()
        {
            return Err("process phase candidates must match explicit source wording".to_string());
        }
        for (candidate, (expected_value, expected_phase_refs)) in phase_values.iter().zip(&expected_phases) {
            ensure_object_keys(candidate, &["rawValue", "evidenceRefs"], "process phase candidate")?;
            if candidate["rawValue"].as_str() != Some(expected_value)
                || candidate["evidenceRefs"] != serde_json::json!(expected_phase_refs)
            {
                return Err("process phase candidates must retain explicit wording and source evidence".to_string());
            }
        }
        let source_actions = source_step["actions"].as_array()
            .ok_or_else(|| "source process actions are invalid".to_string())?;
        let source_conditions = source_step["conditions"].as_array()
            .ok_or_else(|| "source process conditions are invalid".to_string())?;
        let normalized_conditions = normalized["conditions"].as_array()
            .ok_or_else(|| "normalized process conditions must be an array".to_string())?;
        if normalized["sourceProcedureStepId"].as_str() != Some(step_id)
            || normalized["sequenceOrder"].as_u64() != Some(index as u64 + 1)
            || normalized["sequenceOrder"] != source_step["sequenceOrder"]
            || normalized["originalInstruction"].as_str() != Some(raw_instruction)
            || normalized["actionCandidates"].as_array() != Some(source_actions)
            || normalized["evidenceRefs"] != expected_refs
            || normalized["reviewRequired"].as_bool() != Some(true)
            || normalized_conditions.len() != source_conditions.len()
            || normalized.get("printedStepNumber") != source_step.get("printedStepNumber")
        {
            return Err("normalized process step must match its immutable source instruction and sequence".to_string());
        }
        for (condition, source_condition) in normalized_conditions.iter().zip(source_conditions) {
            ensure_object_keys(condition, &["kind", "rawValue", "evidenceRefs", "reviewRequired"], "normalized process condition")?;
            if condition["kind"] != source_condition["kind"]
                || condition["rawValue"] != source_condition["rawValue"]
                || condition["evidenceRefs"] != serde_json::json!([process_evidence_ref(&source_condition["evidence"])?])
                || condition["reviewRequired"].as_bool() != Some(true)
            {
                return Err("normalized process conditions and citations must match immutable source facts".to_string());
            }
        }
    }
    Ok(())
}

fn validate_reference_formulation_target_normalization(
    normalization: &serde_json::Value,
    source: &serde_json::Value,
) -> Result<(), String> {
    ensure_object_keys(normalization, &["normalizerVersion", "sourceStatus", "targets", "sourceWarnings", "reviewRequired"], "target normalization")?;
    if normalization["normalizerVersion"].as_str() != Some("formulab-reference-formulation-target-normalization-v1")
        || normalization["reviewRequired"].as_bool() != Some(true)
    {
        return Err("target normalization version or review state is invalid".to_string());
    }
    let source_targets = source["targetCandidates"].as_array()
        .ok_or_else(|| "immutable formulation target candidates are missing".to_string())?;
    let targets = normalization["targets"].as_array()
        .ok_or_else(|| "normalized target candidates must be an array".to_string())?;
    if targets.len() != source_targets.len()
        || normalization["sourceWarnings"] != source["targetWarnings"]
        || normalization["sourceStatus"].as_str() != Some(if source_targets.is_empty() { "no_candidates" } else { "available" })
    {
        return Err("normalized target coverage and warnings must match the immutable source snapshot".to_string());
    }
    let source_hash = source["sourceDocumentHash"].as_str()
        .ok_or_else(|| "source formulation hash is invalid".to_string())?;
    let mut seen_ids = std::collections::HashSet::new();
    for (target, source_target) in targets.iter().zip(source_targets) {
        ensure_object_keys(target, &["sourceTargetId", "property", "originalLabel", "originalValue", "valueShape", "resultSemantics", "sourceContext", "evidenceRefs", "reviewRequired"], "normalized target")?;
        let source_id = source_target["id"].as_str().filter(|id| !id.trim().is_empty())
            .ok_or_else(|| "source target identity is invalid".to_string())?;
        if !seen_ids.insert(source_id.to_string()) {
            return Err("source target identities must be unique".to_string());
        }
        let evidence = &source_target["evidence"];
        if evidence["sourceDocumentHash"].as_str().map_or(true, |hash| !hash.eq_ignore_ascii_case(source_hash)) {
            return Err("source target evidence must cite the immutable formulation document".to_string());
        }
        let evidence_ref = format!("formula:{}:{}:{}:{}:{}",
            evidence["sourceDocumentHash"].as_str().unwrap_or(""),
            evidence["pageNumber"].as_u64().unwrap_or(0), evidence["blockIndex"].as_u64().unwrap_or(0),
            evidence.get("rowIndex").and_then(|value| value.as_u64()).map(|value| value.to_string()).unwrap_or_else(|| "text".to_string()),
            evidence.get("cellIndex").and_then(|value| value.as_u64()).map(|value| value.to_string()).unwrap_or_else(|| "text".to_string()));
        if target["sourceTargetId"].as_str() != Some(source_id)
            || target["property"] != source_target["field"]
            || target["originalLabel"] != source_target["rawPropertyLabel"]
            || target["originalValue"] != source_target["rawValue"]
            || target["valueShape"] != source_target["valueShape"]
            || target["resultSemantics"] != source_target["resultSemantics"]
            || target["sourceContext"] != evidence["excerpt"]
            || target["evidenceRefs"] != serde_json::json!([evidence_ref])
            || target["reviewRequired"].as_bool() != Some(true)
        {
            return Err("normalized target values, context and citations must match the immutable source candidate".to_string());
        }
    }
    Ok(())
}

fn normalization_candidate_status_matches(status: Option<&str>, count: usize) -> bool {
    matches!((status, count), (Some("unresolved"), 0) | (Some("proposed"), 1) | (Some("ambiguous"), 2..))
}

fn reference_formulation_review_retry_matches(
    existing: &serde_json::Value,
    candidate: &serde_json::Value,
) -> bool {
    let mut existing = existing.clone();
    let mut candidate = candidate.clone();
    if let Some(object) = existing.as_object_mut() {
        object.remove("reviewedAt");
    }
    if let Some(object) = candidate.as_object_mut() {
        object.remove("reviewedAt");
    }
    existing == candidate
}

fn reference_formulation_review_id(review: &serde_json::Value) -> Result<String, String> {
    let required = |field: &str| {
        review.get(field)
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| format!("review field {field} is required"))
    };
    let reviewer_id = review.get("reviewer").and_then(|value| value.get("userId"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "review reviewer identity is required".to_string())?;
    let reviewer_name = review.get("reviewer").and_then(|value| value.get("displayName"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "review reviewer identity is required".to_string())?;
    let optional = |field: &str| review.get(field).cloned().unwrap_or(serde_json::Value::Null);
    let identity = serde_json::json!([
        required("referenceFormulationRecordId")?,
        required("sourceDocumentHash")?.to_ascii_lowercase(),
        required("targetType")?,
        required("targetKey")?,
        required("fieldPath")?,
        required("sourceValue")?,
        required("evidenceExcerpt")?,
        optional("pageNumber"),
        optional("blockIndex"),
        optional("rowIndex"),
        optional("cellIndex"),
        required("decision")?,
        optional("reviewedValue"),
        optional("note"),
        reviewer_id,
        reviewer_name,
    ]);
    let serialized = serde_json::to_vec(&identity).map_err(|error| error.to_string())?;
    let digest = Sha256::digest(serialized);
    Ok(format!("rfreview-{digest:x}"))
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
    if matches!(name, "supplier_document_acquisitions" | "reference_formulations" | "reference_formulation_reviews" | "reference_formulation_normalizations" | "supplier_sds_product_evidence" | "supplier_product_evidence" | "identity_field_reviews") {
        return Err("immutable supplier evidence must use its dedicated validated append command".to_string());
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
        let phase_key = format!("procedure:{step_id}:phase");
        if phase_key == target_key {
            let phase = step.get("phase")?;
            let evidence = phase.get("evidence")?;
            let mut expected = serde_json::json!({
                "targetType": "procedure", "targetKey": phase_key,
                "fieldPath": format!("procedureSteps[{step_id}].phase"),
                "sourceValue": phase.get("rawValue")?,
                "evidenceExcerpt": evidence.get("excerpt")?,
            });
            merge_evidence_location(&mut expected, evidence);
            return Some(expected);
        }
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

/// Permit only byte-for-byte-equivalent retries for the immutable supplier
/// evidence endpoints; callers cannot rewrite an existing source identity.
fn new_immutable_records(
    existing: &[serde_json::Value],
    records: Vec<serde_json::Value>,
    collection: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let mut pending = Vec::with_capacity(records.len());
    for record in records {
        let key = row_key(&record).ok_or_else(|| format!("a {collection} record has no `code` or `id`"))?;
        if let Some(prior) = existing.iter().find(|row| row_key(row).as_deref() == Some(key.as_str())) {
            if prior != &record {
                return Err(format!("{collection} record {key} already exists and cannot be rewritten"));
            }
        } else if pending.iter().any(|row: &serde_json::Value| row_key(row).as_deref() == Some(key.as_str())) {
            return Err(format!("{collection} request contains a duplicate source identity"));
        } else {
            pending.push(record);
        }
    }
    Ok(pending)
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
/// all deny `delete` to every fixed role, `administrator` and `owner`
/// included — the only cell anywhere in the whole matrix that grants
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
    let actor = authz::authorize_any_app(&app, &token, area, &WRITE_CAPABILITIES)?;
    let path = collection_path(&app, name)?;
    let existing = read_array(&path);
    validate_raw_sensitive_write(name, &existing, &records, &actor.role)?;
    write_array(&path, &records)
}

fn validate_verified_rule_writes(
    collection: &str,
    existing: &[serde_json::Value],
    records: Vec<serde_json::Value>,
    role: &str,
) -> Result<Vec<serde_json::Value>, String> {
    if !matches!(collection, "safety_rules" | "compatibility_rules") {
        return Ok(records);
    }
    let can_verify = crate::role_policy::can(role, "rawMaterials", "verify");
    let can_edit = crate::role_policy::can(role, "rawMaterials", "edit");
    let existing_by_id = existing
        .iter()
        .filter_map(|row| row_key(row).map(|id| (id, row)))
        .collect::<std::collections::HashMap<_, _>>();
    for record in &records {
        let prior = row_key(record).and_then(|id| existing_by_id.get(&id).copied());
        let was_verified = prior.map_or(false, |row| {
            row["status"] == "verified" || row["verificationStatus"] == "verified"
        });
        let is_verified = record["status"] == "verified" || record["verificationStatus"] == "verified";
        if (was_verified || is_verified) && !can_verify {
            return Err("not authorized to verify or modify a verified safety or compatibility rule".to_string());
        }
        if (was_verified || is_verified) && !can_edit {
            let Some(prior) = prior else {
                return Err("a verifier may verify only an existing safety or compatibility rule".to_string());
            };
            if was_verified || record["status"] != "verified" || record["verificationStatus"] != "verified" {
                return Err("verification-only access may promote a draft rule once; it cannot edit or re-verify a rule".to_string());
            }
            let mut old_content = prior.clone();
            let mut new_content = record.clone();
            for value in [&mut old_content, &mut new_content] {
                if let Some(object) = value.as_object_mut() {
                    object.remove("status");
                    object.remove("verificationStatus");
                    object.remove("updatedAt");
                }
            }
            if old_content != new_content {
                return Err("verification-only access may change only rule verification state".to_string());
            }
        }
    }
    Ok(records)
}

fn rule_write_requires_verify(
    collection: &str,
    existing: &[serde_json::Value],
    record: &serde_json::Value,
) -> bool {
    if !matches!(collection, "safety_rules" | "compatibility_rules") {
        return false;
    }
    let existing_verified = row_key(record)
        .and_then(|id| {
            existing
                .iter()
                .find(|row| row_key(row).as_deref() == Some(id.as_str()))
        })
        .map_or(false, |row| {
            row["status"] == "verified" || row["verificationStatus"] == "verified"
        });
    existing_verified || record["status"] == "verified" || record["verificationStatus"] == "verified"
}

fn authorize_masterdata_records(
    app: &AppHandle,
    token: &str,
    collection: &str,
    area: &str,
    existing: &[serde_json::Value],
    records: &[serde_json::Value],
) -> Result<authz::TrustedActor, String> {
    if !matches!(collection, "safety_rules" | "compatibility_rules") {
        return authz::authorize_any_app(app, token, area, &WRITE_CAPABILITIES);
    }
    let actor = match authz::current_actor_app(app, token) {
        Ok(actor) => actor,
        Err(_) => return authz::authorize_any_app(app, token, area, &WRITE_CAPABILITIES),
    };
    if records.is_empty() {
        authz::authorize_any_app(app, token, area, &WRITE_CAPABILITIES)?;
        return Ok(actor);
    }
    for record in records {
        if rule_write_requires_verify(collection, existing, record) {
            authz::authorize_app(app, token, area, "verify")?;
        } else {
            authz::authorize_any_app(app, token, area, &WRITE_CAPABILITIES)?;
        }
    }
    Ok(actor)
}

fn stamp_safety_resolution(
    mut record: serde_json::Value,
    actor: &authz::TrustedActor,
) -> Result<serde_json::Value, String> {
    ensure_object_keys(
        &record,
        &[
            "schemaVersion", "id", "formulationId", "versionId", "findingId",
            "reviewerName", "reviewerRole", "resolvedAt", "resolutionReason", "resolutionKind",
        ],
        "safety resolution",
    )?;
    for key in ["schemaVersion", "id", "formulationId", "versionId", "findingId", "resolvedAt", "resolutionReason", "resolutionKind"] {
        if record[key].as_str().map_or(true, |value| value.trim().is_empty()) {
            return Err(format!("safety resolution requires {key}"));
        }
    }
    if record["schemaVersion"] != "1.0"
        || !matches!(record["resolutionKind"].as_str(), Some("accepted_risk" | "formula_changed" | "rule_disputed")) {
        return Err("safety resolution has an unsupported schema or resolution kind".to_string());
    }
    record["reviewerName"] = serde_json::Value::String(actor.user_id.clone());
    record["reviewerRole"] = serde_json::Value::String(actor.role.clone());
    Ok(record)
}

fn validate_raw_sensitive_write(
    collection: &str,
    existing: &[serde_json::Value],
    incoming: &[serde_json::Value],
    _role: &str,
) -> Result<(), String> {
    if collection == "safety_resolutions" {
        let existing_by_id = existing.iter().filter_map(|row| row["id"].as_str().map(|id| (id, row))).collect::<std::collections::HashMap<_, _>>();
        let mut seen = std::collections::HashSet::new();
        let same_rows = incoming.len() == existing.len() && incoming.iter().all(|row| {
            let Some(id) = row["id"].as_str() else { return false; };
            seen.insert(id.to_string()) && existing_by_id.get(id).map_or(false, |old| *old == row)
        });
        if !same_rows || seen.len() != existing_by_id.len() {
            return Err("raw migration cannot create safety decisions or change their reviewer attribution".to_string());
        }
    }
    if matches!(collection, "safety_rules" | "compatibility_rules") {
        let old_by_id = existing.iter().filter_map(|row| row_key(row).map(|id| (id, row))).collect::<std::collections::HashMap<_, _>>();
        let mut preserved_verified_ids = std::collections::HashSet::new();
        for old in existing.iter().filter(|row| row["status"] == "verified" || row["verificationStatus"] == "verified") {
            let id = row_key(old).ok_or_else(|| "verified rule has no stable identity".to_string())?;
            let matches = incoming.iter().filter(|new| row_key(new).as_deref() == Some(id.as_str()) && *new == old).count();
            if matches != 1 || !preserved_verified_ids.insert(id) {
                return Err("raw migration cannot remove or change a verified rule; use the review workflow".to_string());
            }
        }
        for new in incoming {
            let claims_verified = new["status"] == "verified" || new["verificationStatus"] == "verified";
            if !claims_verified { continue; }
            let preserved = row_key(new).and_then(|id| old_by_id.get(&id)).map_or(false, |old| {
                (old["status"] == "verified" || old["verificationStatus"] == "verified") && *old == new
            });
            if !preserved || row_key(new).map_or(true, |id| !preserved_verified_ids.contains(&id)) {
                return Err("raw migration cannot create or change a verified rule; use the review workflow".to_string());
            }
        }
    }
    Ok(())
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
        assert_eq!(COLLECTIONS.len(), 107);
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
    fn immutable_supplier_endpoints_require_verified_source_lineage_and_reject_conflicting_retries() {
        let hash = "a".repeat(64);
        let acquisition = serde_json::json!({
            "schemaVersion":"1.0", "code":"supplierdoc-one", "supplierId":"supplier-one", "providerId":"provider-one",
            "surfaceId":"surface-one", "documentType":"FORMULATION", "acquisitionMethod":"manual_assisted",
            "sourceFileSelection":{"selectionId":"selection-one","originalFilename":"formula.pdf","sourceFileSha256":hash,"selectedAt":"2026-10-27T10:00:00Z","selectedBy":"owner"},
            "sourceProduct":{}, "market":"US", "language":"en", "originalFilename":"formula.pdf",
            "mimeType":"application/pdf", "sha256":hash, "byteSize":128, "parserStatus":"not_started",
            "acquiredAt":"2026-10-27T10:00:00Z", "createdAt":"2026-10-27T10:00:00Z"
        });
        validate_supplier_document_acquisition_record(&acquisition).unwrap();
        let mut invalid_acquisition = acquisition.clone();
        invalid_acquisition["sha256"] = serde_json::json!("not-a-hash");
        assert!(validate_supplier_document_acquisition_record(&invalid_acquisition).is_err());

        let source = serde_json::json!({
            "schemaVersion":"1.0", "id":"source-one", "supplierId":"supplier-one", "providerId":"provider-one",
            "surfaceId":"surface-one", "sourceProduct":{}, "acquisitionCode":"supplierdoc-one", "sourcePdfSha256":hash,
            "acquisitionMethod":"manual_assisted", "sourceFileSelection":acquisition["sourceFileSelection"],
            "originalFilename":"formula.pdf", "sourceByteSize":128, "acquiredAt":"2026-10-27T10:00:00Z",
            "title":"Synthetic fixture", "market":"US", "language":"en", "parserVersion":"fixture-v1",
            "rights":{}, "createdAt":"2026-10-27T10:00:00Z"
        });
        let record = serde_json::json!({
            "schemaVersion":"1.0", "recordKind":"supplier_reference_formula", "id":"record-one", "code":"record-one",
            "source":source, "sourceDocumentHash":hash, "arithmetic":{"sourceId":"source-one","acquisitionCode":"supplierdoc-one","sourceDocumentHash":hash},
            "reviewStatus":"unreviewed", "createdAt":"2026-10-27T10:00:00Z"
        });
        // A well-linked PDF is not sufficient: native persistence rejects a
        // source that omits required schema sections or rights fields.
        assert!(validate_reference_formulation_source_record(&record, &acquisition).is_err());
        let mut unrelated_source = record.clone();
        unrelated_source["source"]["supplierId"] = serde_json::json!("other-supplier");
        assert!(validate_reference_formulation_source_record(&unrelated_source, &acquisition).is_err());

        let rows = vec![acquisition.clone()];
        assert!(new_immutable_records(&rows, vec![acquisition.clone()], "supplier_document_acquisitions").unwrap().is_empty());
        let mut conflicting = acquisition;
        conflicting["providerId"] = serde_json::json!("provider-tampered");
        assert!(new_immutable_records(&rows, vec![conflicting], "supplier_document_acquisitions").is_err());
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
        assert_eq!(collection_spec("identity_field_reviews"), Ok(("identity_field_reviews", true)));
        assert!(ensure_generic_collection_write_allowed("identity_field_reviews").is_err());
        let review = serde_json::json!({ "id": "review-1", "decision": "accepted" });
        let (rows, inserted, updated) = apply_upsert(vec![], vec![review.clone()], true, "reference_formulation_reviews").unwrap();
        assert_eq!((inserted, updated), (1, 0));
        assert!(apply_upsert(rows, vec![review], true, "reference_formulation_reviews").is_err());
        assert_eq!(collection_spec("reference_formulation_normalizations"), Ok(("reference_formulation_normalizations", true)));
        assert!(ensure_generic_collection_write_allowed("reference_formulation_normalizations").is_err());
        assert!(ensure_generic_collection_write_allowed("reference_formulations").is_err());
        assert!(ensure_generic_collection_write_allowed("supplier_document_acquisitions").is_err());
        assert_eq!(collection_spec("supplier_sds_product_evidence"), Ok(("supplier_sds_product_evidence", true)));
        assert!(ensure_generic_collection_write_allowed("supplier_sds_product_evidence").is_err());
    }

    #[test]
    fn supplier_sds_product_evidence_must_match_an_immutable_sds_acquisition() {
        let acquisition = serde_json::json!({
            "code": "sds-acquisition-1", "documentType": "SDS", "sha256": "c".repeat(64),
            "providerId": "croda-public", "sourceProduct": {"supplierItemCode": "CRODA-001"}
        });
        let crosswalk = serde_json::json!({
            "code": "croda-public::supplier_products::CRODA-001::CommercialProduct",
            "sourceSystemId": "croda-public", "sourceEntity": "supplier_products", "sourceRecordId": "CRODA-001",
            "canonicalEntity": "CommercialProduct", "canonicalRecordId": "commercial-product-1", "status": "active"
        });
        let record = serde_json::json!({
            "schemaVersion": "1.0", "code": "sds-evidence-1", "acquisitionCode": "sds-acquisition-1",
            "extractionStatus": "unreviewed", "createdAt": "2026-10-26T10:00:00Z",
            "evidence": {
                "schemaVersion": "1.0", "id": "sds-evidence-1", "commercialProductId": "commercial-product-1",
                "section1": {"sectionNumber": 1, "sourceDocumentHash": "c".repeat(64)},
                "section3": {"sectionNumber": 3, "sourceDocumentHash": "c".repeat(64), "components": []},
                "reconciliations": []
            }
        });
        validate_supplier_sds_product_evidence_record(&record, &acquisition, &[crosswalk.clone()]).unwrap();
        let mut wrong_hash = record.clone();
        wrong_hash["evidence"]["section3"]["sourceDocumentHash"] = serde_json::json!("d".repeat(64));
        assert!(validate_supplier_sds_product_evidence_record(&wrong_hash, &acquisition, &[crosswalk.clone()]).unwrap_err().contains("match the acquired SDS hash"));
        let mut wrong_kind = acquisition.clone();
        wrong_kind["documentType"] = serde_json::json!("TDS");
        assert!(validate_supplier_sds_product_evidence_record(&record, &wrong_kind, &[crosswalk.clone()]).unwrap_err().contains("match the acquired SDS hash"));
        let mut wrong_product = record.clone();
        wrong_product["evidence"]["commercialProductId"] = serde_json::json!("different-product");
        assert!(validate_supplier_sds_product_evidence_record(&wrong_product, &acquisition, &[crosswalk]).unwrap_err().contains("active exact supplier-product crosswalk"));
        let forged_crosswalk_code = serde_json::json!({
            "code": "caller-invented", "sourceSystemId": "croda-public", "sourceEntity": "supplier_products", "sourceRecordId": "CRODA-001",
            "canonicalEntity": "CommercialProduct", "canonicalRecordId": "commercial-product-1", "status": "active"
        });
        assert!(validate_supplier_sds_product_evidence_record(&record, &acquisition, &[forged_crosswalk_code]).unwrap_err().contains("active exact supplier-product crosswalk"));
        let crosswalk = serde_json::json!({
            "code": "croda-public::supplier_products::CRODA-001::CommercialProduct",
            "sourceSystemId": "croda-public", "sourceEntity": "supplier_products", "sourceRecordId": "CRODA-001",
            "canonicalEntity": "CommercialProduct", "canonicalRecordId": "commercial-product-1", "status": "active"
        });
        let mut duplicate_component = record.clone();
        duplicate_component["evidence"]["section3"]["components"] = serde_json::json!([
            {"id": "duplicate", "disclosure": "disclosed"}, {"id": "duplicate", "disclosure": "disclosed"}
        ]);
        assert!(validate_supplier_sds_product_evidence_record(&duplicate_component, &acquisition, &[crosswalk.clone()]).unwrap_err().contains("identities must be unique"));
        let mut broken_reconciliation = record.clone();
        broken_reconciliation["evidence"]["section1"]["declaredChemicalName"] = serde_json::json!({"id": "s1-name", "rawValue": "Product", "evidenceRefs": ["sds:p1:name"]});
        broken_reconciliation["evidence"]["section3"]["components"] = serde_json::json!([{"id": "component-1", "disclosure": "disclosed"}]);
        broken_reconciliation["evidence"]["reconciliations"] = serde_json::json!([{
            "section1FactId": "missing-fact", "section3ComponentId": "component-1", "outcome": "unresolved",
            "basis": "insufficient_evidence", "evidenceRefs": ["sds:p1:name"], "rationaleCode": "unresolved"
        }]);
        assert!(validate_supplier_sds_product_evidence_record(&broken_reconciliation, &acquisition, &[crosswalk]).unwrap_err().contains("reference existing product facts"));
        let crosswalk = serde_json::json!({
            "code": "croda-public::supplier_products::CRODA-001::CommercialProduct",
            "sourceSystemId": "croda-public", "sourceEntity": "supplier_products", "sourceRecordId": "CRODA-001",
            "canonicalEntity": "CommercialProduct", "canonicalRecordId": "commercial-product-1", "status": "active"
        });
        let mut incorrect_exact_match = record.clone();
        incorrect_exact_match["evidence"]["section1"]["casNumber"] = serde_json::json!({"id": "s1-cas", "rawValue": "64-17-5", "evidenceRefs": ["sds:p1:cas"]});
        incorrect_exact_match["evidence"]["section3"]["components"] = serde_json::json!([{
            "id": "component-1", "casNumber": {"id": "s3-cas", "rawValue": "7647-14-5", "evidenceRefs": ["sds:p3:cas"]}, "disclosure": "disclosed"
        }]);
        incorrect_exact_match["evidence"]["reconciliations"] = serde_json::json!([{
            "section1FactId": "s1-cas", "section3ComponentId": "component-1", "outcome": "consistent",
            "basis": "exact_cas", "evidenceRefs": ["sds:p1:cas", "sds:p3:cas"], "rationaleCode": "claimed_match"
        }]);
        assert!(validate_supplier_sds_product_evidence_record(&incorrect_exact_match, &acquisition, &[crosswalk.clone()]).unwrap_err().contains("outcome must match"));
        incorrect_exact_match["evidence"]["section3"]["components"][0]["casNumber"]["rawValue"] = serde_json::json!("64-17-5");
        incorrect_exact_match["evidence"]["reconciliations"][0]["evidenceRefs"] = serde_json::json!(["sds:p1:cas"]);
        assert!(validate_supplier_sds_product_evidence_record(&incorrect_exact_match, &acquisition, &[crosswalk]).unwrap_err().contains("must cite both linked"));
    }

    #[test]
    fn newer_sds_revision_does_not_retarget_historical_extraction_evidence() {
        let acquisition_v1 = serde_json::json!({
            "code": "sds-acquisition-v1", "documentType": "SDS", "sha256": "c".repeat(64),
            "providerId": "croda-public", "sourceProduct": {"supplierItemCode": "CRODA-001"}
        });
        let acquisition_v2 = serde_json::json!({
            "code": "sds-acquisition-v2", "documentType": "SDS", "sha256": "d".repeat(64),
            "providerId": "croda-public", "sourceProduct": {"supplierItemCode": "CRODA-001"},
            "sourceRevision": "Rev 2", "supersedesCode": "sds-acquisition-v1"
        });
        let evidence_v1 = serde_json::json!({
            "schemaVersion": "1.0", "code": "sds-evidence-v1", "acquisitionCode": "sds-acquisition-v1",
            "extractionStatus": "unreviewed", "createdAt": "2026-10-26T10:00:00Z",
            "evidence": {
                "schemaVersion": "1.0", "id": "sds-evidence-v1", "commercialProductId": "commercial-product-1",
                "section1": {"sectionNumber": 1, "sourceDocumentHash": "c".repeat(64)},
                "section3": {"sectionNumber": 3, "sourceDocumentHash": "c".repeat(64), "components": []},
                "reconciliations": []
            }
        });
        let evidence_v2 = serde_json::json!({
            "schemaVersion": "1.0", "code": "sds-evidence-v2", "acquisitionCode": "sds-acquisition-v2",
            "extractionStatus": "unreviewed", "createdAt": "2026-10-27T10:00:00Z",
            "evidence": {
                "schemaVersion": "1.0", "id": "sds-evidence-v2", "commercialProductId": "commercial-product-1",
                "section1": {"sectionNumber": 1, "sourceDocumentHash": "d".repeat(64)},
                "section3": {"sectionNumber": 3, "sourceDocumentHash": "d".repeat(64), "components": []},
                "reconciliations": []
            }
        });
        let crosswalk = serde_json::json!({
            "code": "croda-public::supplier_products::CRODA-001::CommercialProduct",
            "sourceSystemId": "croda-public", "sourceEntity": "supplier_products", "sourceRecordId": "CRODA-001",
            "canonicalEntity": "CommercialProduct", "canonicalRecordId": "commercial-product-1", "status": "active"
        });

        validate_supplier_sds_product_evidence_record(&evidence_v1, &acquisition_v1, &[crosswalk.clone()]).unwrap();
        validate_supplier_sds_product_evidence_record(&evidence_v2, &acquisition_v2, &[crosswalk.clone()]).unwrap();
        assert!(validate_supplier_sds_product_evidence_record(&evidence_v1, &acquisition_v2, &[crosswalk.clone()])
            .unwrap_err().contains("match the acquired SDS hash"));

        let (acquisitions, inserted, updated) = apply_upsert(
            vec![acquisition_v1.clone()], vec![acquisition_v2], true, "supplier_document_acquisitions",
        ).unwrap();
        assert_eq!((inserted, updated), (1, 0));
        assert_eq!(acquisitions[0], acquisition_v1);
        let (extractions, inserted, updated) = apply_upsert(
            vec![evidence_v1.clone()], vec![evidence_v2], true, "supplier_sds_product_evidence",
        ).unwrap();
        assert_eq!((inserted, updated), (1, 0));
        assert_eq!(extractions[0], evidence_v1);
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
        let phase_source = serde_json::json!({
            "identityCandidates": [],
            "ingredientLines": [],
            "procedureSteps": [{
                "id": "step-1", "rawInstruction": "Add and mix.",
                "phase": { "rawValue": "A", "evidence": {
                    "excerpt": "Phase A", "pageNumber": 2, "blockIndex": 5, "rowIndex": 3, "cellIndex": 1
                } },
                "conditions": []
            }]
        });
        let phase_review = serde_json::json!({
            "targetType": "procedure", "targetKey": "procedure:step-1:phase",
            "fieldPath": "procedureSteps[step-1].phase", "sourceValue": "A", "evidenceExcerpt": "Phase A",
            "pageNumber": 2, "blockIndex": 5, "rowIndex": 3, "cellIndex": 1
        });
        validate_review_evidence(&phase_review, &phase_source).unwrap();
        let mut forged = stamped.clone();
        forged["evidenceExcerpt"] = serde_json::json!("invented evidence");
        assert!(validate_review_evidence(&forged, &source).unwrap_err().contains("immutable source evidence"));
        assert!(ensure_generic_collection_write_allowed("reference_formulation_reviews").is_err());
        assert!(ensure_generic_collection_write_allowed("reference_formulations").is_err());
    }

    #[test]
    fn identical_reference_formulation_review_retry_returns_same_append_only_decision() {
        let first = serde_json::json!({
            "id": "rfreview-stable-key", "code": "rfreview-stable-key",
            "referenceFormulationRecordId": "reference-1", "sourceDocumentHash": "a".repeat(64),
            "targetType": "identity", "targetKey": "identity:formulation_code:0",
            "fieldPath": "identityCandidates[0].formulation_code", "sourceValue": "HC/DW/22",
            "evidenceExcerpt": "Formulation HC/DW/22", "decision": "accepted",
            "reviewer": { "userId": "chemist-1", "displayName": "Chemist" },
            "reviewedAt": "2026-10-27T08:00:00Z"
        });
        let retry = serde_json::json!({
            "id": "rfreview-stable-key", "code": "rfreview-stable-key",
            "referenceFormulationRecordId": "reference-1", "sourceDocumentHash": "a".repeat(64),
            "targetType": "identity", "targetKey": "identity:formulation_code:0",
            "fieldPath": "identityCandidates[0].formulation_code", "sourceValue": "HC/DW/22",
            "evidenceExcerpt": "Formulation HC/DW/22", "decision": "accepted",
            "reviewer": { "userId": "chemist-1", "displayName": "Chemist" },
            "reviewedAt": "2026-10-27T08:05:00Z"
        });
        assert!(reference_formulation_review_retry_matches(&first, &retry));

        let mut conflicting_retry = retry.clone();
        conflicting_retry["decision"] = serde_json::json!("rejected");
        assert!(!reference_formulation_review_retry_matches(&first, &conflicting_retry));
    }

    #[test]
    fn reference_formulation_review_id_binds_content_to_authenticated_reviewer() {
        let payload = serde_json::json!({
            "schemaVersion": "1.0", "id": "pending", "code": "pending",
            "referenceFormulationRecordId": "reference-1", "sourceDocumentHash": "a".repeat(64),
            "targetType": "identity", "targetKey": "identity:formulation_code:0",
            "fieldPath": "identityCandidates[0].formulation_code", "sourceValue": "HC/DW/22",
            "evidenceExcerpt": "Formulation HC/DW/22", "decision": "accepted",
            "reviewer": { "userId": "untrusted", "displayName": "Untrusted" }
        });
        let stamped = stamp_reference_formulation_review(
            payload, "chemist-1", "Chemist", "2026-10-27T08:00:00Z",
        ).unwrap();
        let expected = reference_formulation_review_id(&stamped).unwrap();
        assert!(expected.strip_prefix("rfreview-").map_or(false, is_sha256_hex));

        let mut fresh_arbitrary_id = stamped.clone();
        fresh_arbitrary_id["id"] = serde_json::json!("rfreview-fresh-random-id");
        fresh_arbitrary_id["code"] = serde_json::json!("rfreview-fresh-random-id");
        assert_ne!(fresh_arbitrary_id["id"].as_str(), Some(expected.as_str()));
        assert_eq!(stamped["reviewer"]["userId"], "chemist-1");
        assert_eq!(reference_formulation_review_id(&fresh_arbitrary_id).unwrap(), expected);
        let mut untrusted_reviewer = stamped.clone();
        untrusted_reviewer["reviewer"]["userId"] = serde_json::json!("untrusted");
        assert_ne!(reference_formulation_review_id(&untrusted_reviewer).unwrap(), expected);
    }

    #[test]
    fn normalization_versions_must_match_source_lines_and_commercial_product_candidates() {
        let source = serde_json::json!({
            "id": "source-1", "sourceDocumentHash": "a".repeat(64),
            "ingredientLines": [{
                "id": "line-1", "sourceDocumentHash": "a".repeat(64),
                "ingredientName": { "rawValue": "Known Product", "evidence": { "sourceDocumentHash": "a".repeat(64), "pageNumber": 1, "blockIndex": 1, "rowIndex": 0, "cellIndex": 0 } },
                "amount": { "rawValue": "4.0", "evidence": { "sourceDocumentHash": "a".repeat(64), "pageNumber": 1, "blockIndex": 1, "rowIndex": 0, "cellIndex": 2 } },
                "function": { "rawValue": "Supplier wording", "evidence": { "sourceDocumentHash": "a".repeat(64), "pageNumber": 1, "blockIndex": 1, "rowIndex": 0, "cellIndex": 5 } },
                "unit": { "rawValue": "%", "evidence": { "sourceDocumentHash": "a".repeat(64), "pageNumber": 1, "blockIndex": 1, "rowIndex": 0, "cellIndex": 3 } },
                "basis": { "rawValue": "w/w", "evidence": { "sourceDocumentHash": "a".repeat(64), "pageNumber": 1, "blockIndex": 1, "rowIndex": 0, "cellIndex": 4 } }
            }],
            "procedureWarnings": [],
            "procedureSteps": [{
                "id": "source-1:process:p2:b1:1:1", "sequenceOrder": 1, "rawInstruction": "Add and mix at 70°C for 10 min.",
                "phase": { "rawValue": "A", "evidence": { "sourceDocumentHash": "a".repeat(64), "pageNumber": 2, "blockIndex": 1, "rowIndex": 1, "cellIndex": 1, "excerpt": "A", "source": "digital" } },
                "actions": ["addition", "mix"], "conditions": [
                    { "kind": "temperature", "rawValue": "70°C", "evidence": { "sourceDocumentHash": "a".repeat(64), "pageNumber": 2, "blockIndex": 1, "rowIndex": 1, "cellIndex": 2, "excerpt": "70°C", "source": "digital" } },
                    { "kind": "time", "rawValue": "10 min", "evidence": { "sourceDocumentHash": "a".repeat(64), "pageNumber": 2, "blockIndex": 1, "rowIndex": 1, "cellIndex": 2, "excerpt": "10 min", "source": "digital" } }
                ],
                "evidence": { "sourceDocumentHash": "a".repeat(64), "pageNumber": 2, "blockIndex": 1, "rowIndex": 1, "cellIndex": 2, "excerpt": "Add and mix at 70°C for 10 min.", "source": "digital" }
            }],
            "targetWarnings": [],
            "targetCandidates": [{
                "id": "source-1:target:p3:b1:r1:c0:1", "field": "ph", "rawPropertyLabel": "Target pH", "rawValue": "5.0-5.5",
                "valueShape": "range", "resultSemantics": "target", "reviewRequired": true,
                "evidence": { "sourceDocumentHash": "a".repeat(64), "pageNumber": 3, "blockIndex": 1, "rowIndex": 1, "cellIndex": 0, "excerpt": "Target pH: 5.0-5.5", "source": "digital" }
            }],
            "productMatches": [{ "ingredientLineId": "line-1", "candidates": [{ "commercialProductId": "product-source-candidate" }] }]
        });
        let normalization = serde_json::json!({
            "schemaVersion": "1.0", "recordKind": "reference_formulation_normalization",
            "id": "normalization-1", "code": "normalization-1",
            "referenceFormulationRecordId": "source-1", "sourceDocumentHash": "A".repeat(64),
            "normalizerVersion": "formulab-reference-formulation-normalization-v1", "version": 1,
            "processNormalization": {
                "normalizerVersion": "formulab-reference-formulation-process-normalization-v1", "sourceStatus": "available",
                "steps": [{
                    "sourceProcedureStepId": "source-1:process:p2:b1:1:1", "sequenceOrder": 1,
                    "originalInstruction": "Add and mix at 70°C for 10 min.", "actionCandidates": ["addition", "mix"],
                    "phaseCandidates": { "status": "proposed", "candidateValues": [{ "rawValue": "A", "evidenceRefs": [format!("formula:{}:2:1:1:1", "a".repeat(64))] }] },
                    "conditions": [
                        { "kind": "temperature", "rawValue": "70°C", "evidenceRefs": [format!("formula:{}:2:1:1:2", "a".repeat(64))], "reviewRequired": true },
                        { "kind": "time", "rawValue": "10 min", "evidenceRefs": [format!("formula:{}:2:1:1:2", "a".repeat(64))], "reviewRequired": true }
                    ],
                    "evidenceRefs": [format!("formula:{}:2:1:1:2", "a".repeat(64))], "reviewRequired": true
                }], "sourceWarnings": [], "reviewRequired": true
            },
            "targetNormalization": {
                "normalizerVersion": "formulab-reference-formulation-target-normalization-v1", "sourceStatus": "available",
                "targets": [{
                    "sourceTargetId": "source-1:target:p3:b1:r1:c0:1", "property": "ph", "originalLabel": "Target pH", "originalValue": "5.0-5.5",
                    "valueShape": "range", "resultSemantics": "target", "sourceContext": "Target pH: 5.0-5.5",
                    "evidenceRefs": [format!("formula:{}:3:1:1:0", "a".repeat(64))], "reviewRequired": true
                }], "sourceWarnings": [], "reviewRequired": true
            },
            "lines": [{
                "sourceLineId": "line-1",
                "commercialProduct": { "status": "proposed", "candidateIds": ["product-source-candidate"] },
                "canonicalChemistry": { "status": "unresolved", "candidateIds": [] },
                "functionNormalization": {
                    "supplierFunction": { "status": "stated", "originalValue": "Supplier wording", "evidenceRefs": [format!("formula:{}:1:1:0:5", "a".repeat(64))] },
                    "canonicalFunction": { "status": "proposed", "candidateIds": ["nonionic_surfactant"] },
                    "reviewRequired": true
                },
                "componentContributions": []
            }]
        });
        validate_normalization_version(&normalization, &source, &[], &[], &[]).unwrap();
        let mut forged_function = normalization.clone();
        forged_function["lines"][0]["functionNormalization"]["supplierFunction"]["originalValue"] = serde_json::json!("Changed wording");
        assert!(validate_normalization_version(&forged_function, &source, &[], &[], &[]).unwrap_err().contains("supplier function wording and citation must match the immutable source line"));
        let mut invalid_function_candidate = normalization.clone();
        invalid_function_candidate["lines"][0]["functionNormalization"]["canonicalFunction"]["candidateIds"] = serde_json::json!(["invented_function"]);
        assert!(validate_normalization_version(&invalid_function_candidate, &source, &[], &[], &[]).unwrap_err().contains("shared MaterialFunction vocabulary"));
        let mut forged_process_condition = normalization.clone();
        forged_process_condition["processNormalization"]["steps"][0]["conditions"][0]["rawValue"] = serde_json::json!("100°C");
        assert!(validate_normalization_version(&forged_process_condition, &source, &[], &[], &[]).unwrap_err().contains("match immutable source facts"));
        let mut invented_process_phase = normalization.clone();
        invented_process_phase["processNormalization"]["steps"][0]["phaseCandidates"]["candidateValues"][0]["rawValue"] = serde_json::json!("B");
        assert!(validate_normalization_version(&invented_process_phase, &source, &[], &[], &[]).unwrap_err().contains("process phase candidates must retain explicit wording and source evidence"));
        let mut forged_target = normalization.clone();
        forged_target["targetNormalization"]["targets"][0]["originalValue"] = serde_json::json!("7.0");
        assert!(validate_normalization_version(&forged_target, &source, &[], &[], &[]).unwrap_err().contains("match the immutable source candidate"));
        let mut forged = normalization.clone();
        forged["lines"][0]["commercialProduct"]["candidateIds"] = serde_json::json!(["forged-product"]);
        assert!(validate_normalization_version(&forged, &source, &[], &[], &[]).unwrap_err().contains("match the immutable source"));
        let mut extra_field = normalization.clone();
        extra_field["approved"] = serde_json::json!(true);
        assert!(validate_normalization_version(&extra_field, &source, &[], &[], &[]).unwrap_err().contains("unsupported field"));

        let mut with_contribution = normalization.clone();
        let formula_refs = vec![
            format!("formula:{}:1:1:0:0", "a".repeat(64)),
            format!("formula:{}:1:1:0:2", "a".repeat(64)),
            format!("formula:{}:1:1:0:3", "a".repeat(64)),
            format!("formula:{}:1:1:0:4", "a".repeat(64)),
        ];
        let mut all_refs = formula_refs.clone();
        all_refs.push("sds:p3:concentration".to_string());
        with_contribution["lines"][0]["componentContributions"] = serde_json::json!([{
            "schemaVersion": "1.0", "id": "contribution-1", "quantityKind": "component_contribution", "status": "exact",
            "sourceFormulationRecordId": "source-1", "sourceFormulaDocumentHash": "a".repeat(64), "sourceFormulaLineId": "line-1",
            "commercialProductId": "product-source-candidate",
            "formulaAmount": { "originalValue": "4.0", "unit": "%", "basis": "w/w", "interpretation": "exact", "percentRange": { "lowerBound": 4.0, "upperBound": 4.0 }, "evidenceRefs": formula_refs },
            "sourceSds": { "status": "available", "evidenceId": "sds-1", "commercialProductId": "product-source-candidate", "documentHash": "c".repeat(64), "sectionNumber": 3,
                "sourceComponentId": "component-1", "disclosure": "disclosed", "sourceFactId": "concentration-1", "originalValue": "30% w/w", "fractionRange": { "lowerBound": 0.3, "upperBound": 0.3 }, "interpretation": "exact", "evidenceRefs": ["sds:p3:concentration"] },
            "canonicalChemistry": { "status": "unresolved", "candidateIds": [] },
            "contributionPercentRange": { "lowerBound": 1.2, "upperBound": 1.2 }, "unknownReasons": [], "evidenceRefs": all_refs, "reviewRequired": true
        }]);
        let source_with_supplier = serde_json::json!({"source": {"supplierId": "supplier-croda"}});
        let mut persisted_source = source.clone();
        persisted_source["source"] = source_with_supplier["source"].clone();
        let sds_evidence_row = serde_json::json!({
            "schemaVersion": "1.0", "code": "sds-1", "acquisitionCode": "sds-acquisition-1", "extractionStatus": "unreviewed",
            "evidence": {
                "schemaVersion": "1.0", "id": "sds-1", "commercialProductId": "product-source-candidate",
                "section1": {"sectionNumber": 1, "sourceDocumentHash": "c".repeat(64)},
                "section3": {"sectionNumber": 3, "sourceDocumentHash": "c".repeat(64), "components": [{
                    "id": "component-1", "concentration": {"id": "concentration-1", "rawValue": "30% w/w", "evidenceRefs": ["sds:p3:concentration"]}, "disclosure": "disclosed"
                }]},
                "reconciliations": []
            }
        });
        let acquisition_row = serde_json::json!({"code": "sds-acquisition-1", "supplierId": "supplier-croda", "documentType": "SDS", "sha256": "c".repeat(64)});
        let sds_evidence_rows = vec![sds_evidence_row];
        let acquisition_rows = vec![acquisition_row];
        with_contribution["lines"][0]["componentContributions"][0]["sourceSds"]["acquisitionCode"] = serde_json::json!("sds-acquisition-1");
        validate_normalization_version(&with_contribution, &persisted_source, &[], &sds_evidence_rows, &acquisition_rows).unwrap();
        assert!(validate_normalization_version(&with_contribution, &persisted_source, &[], &[], &acquisition_rows).unwrap_err().contains("persisted extraction evidence"));
        let mut altered_sds_lineage = with_contribution.clone();
        altered_sds_lineage["lines"][0]["componentContributions"][0]["sourceSds"]["originalValue"] = serde_json::json!("31% w/w");
        let altered_lineage_error = validate_normalization_version(&altered_sds_lineage, &persisted_source, &[], &sds_evidence_rows, &acquisition_rows).unwrap_err();
        assert!(!altered_lineage_error.is_empty(), "altered SDS lineage must remain rejected");
        let mut unknown_without_component = with_contribution.clone();
        let unknown_row = &mut unknown_without_component["lines"][0]["componentContributions"][0];
        unknown_row["status"] = serde_json::json!("unknown");
        unknown_row.as_object_mut().unwrap().remove("contributionPercentRange");
        unknown_row["unknownReasons"] = serde_json::json!(["sds_component_unresolved"]);
        let unknown_sds = &mut unknown_row["sourceSds"];
        for key in ["sourceComponentId", "disclosure", "sourceFactId", "originalValue", "fractionRange"] {
            unknown_sds.as_object_mut().unwrap().remove(key);
        }
        unknown_sds["interpretation"] = serde_json::json!("unknown");
        unknown_sds["evidenceRefs"] = serde_json::json!([]);
        unknown_row["evidenceRefs"] = serde_json::json!(formula_refs);
        let mut no_component_evidence_rows = sds_evidence_rows.clone();
        no_component_evidence_rows[0]["evidence"]["section3"]["components"] = serde_json::json!([]);
        validate_normalization_version(&unknown_without_component, &persisted_source, &[], &no_component_evidence_rows, &acquisition_rows).unwrap();
        with_contribution["lines"][0]["componentContributions"][0]["contributionPercentRange"]["lowerBound"] = serde_json::json!(2.0);
        let altered_contribution_error = validate_normalization_version(&with_contribution, &persisted_source, &[], &sds_evidence_rows, &acquisition_rows).unwrap_err();
        assert!(!altered_contribution_error.is_empty(), "altered contribution bounds must remain rejected");

        let mut absent_optional_source = source.clone();
        absent_optional_source["ingredientLines"][0].as_object_mut().unwrap().remove("unit");
        absent_optional_source["ingredientLines"][0].as_object_mut().unwrap().remove("basis");
        absent_optional_source["ingredientLines"][0]["amount"]["rawValue"] = serde_json::json!("4% w/w");
        let mut absent_optional_fields = with_contribution.clone();
        let formula_amount = &mut absent_optional_fields["lines"][0]["componentContributions"][0]["formulaAmount"];
        formula_amount["originalValue"] = serde_json::json!("4% w/w");
        formula_amount.as_object_mut().unwrap().remove("unit");
        formula_amount.as_object_mut().unwrap().remove("basis");
        let reduced_formula_refs = vec![formula_refs[0].clone(), formula_refs[1].clone()];
        formula_amount["evidenceRefs"] = serde_json::json!(reduced_formula_refs);
        absent_optional_fields["lines"][0]["componentContributions"][0]["evidenceRefs"] = serde_json::json!([
            formula_refs[0], formula_refs[1], "sds:p3:concentration"
        ]);
        absent_optional_fields["lines"][0]["componentContributions"][0]["contributionPercentRange"]["lowerBound"] = serde_json::json!(1.2);
        absent_optional_source["source"] = source_with_supplier["source"].clone();
        validate_normalization_version(&absent_optional_fields, &absent_optional_source, &[], &sds_evidence_rows, &acquisition_rows).unwrap();
        let mut malformed_unit = absent_optional_fields.clone();
        malformed_unit["lines"][0]["componentContributions"][0]["formulaAmount"]["unit"] = serde_json::json!(12);
        assert!(validate_normalization_version(&malformed_unit, &absent_optional_source, &[], &sds_evidence_rows, &acquisition_rows).unwrap_err().contains("optional field unit must be a string"));
        let mut malformed_basis = absent_optional_fields.clone();
        malformed_basis["lines"][0]["componentContributions"][0]["formulaAmount"]["basis"] = serde_json::json!({});
        assert!(validate_normalization_version(&malformed_basis, &absent_optional_source, &[], &sds_evidence_rows, &acquisition_rows).unwrap_err().contains("optional field basis must be a string"));
        let mut malformed_product_id = normalization.clone();
        malformed_product_id["lines"][0]["componentContributions"] = absent_optional_fields["lines"][0]["componentContributions"].clone();
        malformed_product_id["lines"][0]["componentContributions"][0]["commercialProductId"] = serde_json::json!({});
        assert!(validate_normalization_version(&malformed_product_id, &absent_optional_source, &[], &sds_evidence_rows, &acquisition_rows).unwrap_err().contains("optional field commercialProductId must be a string"));
        let duplicate = serde_json::json!({ "status": "ambiguous", "candidateIds": ["chemical-1", "chemical-1"] });
        assert!(validate_normalization_candidates(&duplicate, "canonical chemistry").unwrap_err().contains("must be unique"));
        let padded = serde_json::json!({ "status": "proposed", "candidateIds": [" chemical-1 "] });
        assert!(validate_normalization_candidates(&padded, "canonical chemistry").unwrap_err().contains("identity is invalid"));
        assert!(!normalization_candidate_status_matches(Some("accepted"), 1));
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
    fn supplier_product_cards_and_versions_survive_a_simulated_restart() {
        assert_eq!(collection_spec("supplier_product_evidence").unwrap(), ("supplier_product_evidence", true));
        let dir = std::env::temp_dir().join(format!(
            "formulab-masterdata-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("supplier_product_evidence.json");

        let rows = vec![serde_json::json!({
            "recordType": "document",
            "id": "sds-evidence-1",
            "productCardId": "product-1",
            "documentType": "SDS",
            "documentHash": "a".repeat(64),
            "claims": [{"id": "claim-cas", "fieldCode": "product_cas", "evidence": [{"documentHash": "a".repeat(64), "pageNumber": 1, "excerpt": "CAS 123", "source": "digital"}]}]
        }), serde_json::json!({
            "recordType": "card_version",
            "id": "product-1-v1",
            "productCardId": "product-1",
            "version": 1,
            "evidenceRecordIds": ["sds-evidence-1"],
            "claimIds": ["claim-cas"],
            "createdAt": "2026-10-28T08:00:00Z"
        })];
        write_array(&path, &rows).unwrap();

        // Simulate restart: nothing in memory carries over, only the file.
        let reloaded = read_array(&path);
        assert_eq!(reloaded, rows);

        // A second write-then-read (as an upsert would do) still round-trips.
        let mut rows2 = reloaded.clone();
        rows2.push(serde_json::json!({
            "recordType": "document",
            "id": "tds-evidence-1",
            "productCardId": "product-1",
            "documentType": "TDS",
            "documentHash": "b".repeat(64),
            "claims": [{"id": "claim-active", "fieldCode": "active_matter", "basis": "as_supplied", "rawValue": "38%", "evidence": [{"documentHash": "b".repeat(64), "pageNumber": 2, "excerpt": "Active 38%", "source": "digital"}]}]
        }));
        rows2.push(serde_json::json!({
            "recordType": "card_version",
            "id": "product-1-v2",
            "productCardId": "product-1",
            "version": 2,
            "evidenceRecordIds": ["sds-evidence-1", "tds-evidence-1"],
            "claimIds": ["claim-cas", "claim-active"],
            "createdAt": "2026-10-28T08:01:00Z"
        }));
        rows2.push(serde_json::json!({
            "recordType": "claim_review",
            "id": "claim-active-review-1",
            "productCardId": "product-1",
            "sourceEvidenceId": "tds-evidence-1",
            "claimId": "claim-active",
            "reviewedBy": "reviewer-1",
            "evidenceRefs": [format!("{}:p2", "b".repeat(64))]
        }));
        write_array(&path, &rows2).unwrap();
        let after_second_restart = read_array(&path);
        assert_eq!(after_second_restart, rows2);
        assert_eq!(after_second_restart[1]["version"], 1);
        assert_eq!(after_second_restart[3]["evidenceRecordIds"].as_array().unwrap().len(), 2);
        assert_eq!(after_second_restart[4]["evidenceRefs"][0], format!("{}:p2", "b".repeat(64)));

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

    #[test]
    fn generic_rule_upsert_requires_the_native_verify_capability_for_verified_status() {
        let verified = serde_json::json!({ "id": "rule-1", "status": "verified", "verificationStatus": "verified" });
        assert!(rule_write_requires_verify("safety_rules", &[], &verified));
        assert!(crate::role_policy::can("production_manager", "rawMaterials", "verify"));
        assert!(validate_verified_rule_writes("safety_rules", &[], vec![verified.clone()], "production_manager").is_err(), "new rules cannot be created already verified");
        let draft = serde_json::json!({ "id": "rule-1", "status": "draft", "verificationStatus": "not_verified", "name": "Rule" });
        let promoted = serde_json::json!({ "id": "rule-1", "status": "verified", "verificationStatus": "verified", "name": "Rule" });
        assert!(rule_write_requires_verify("compatibility_rules", &[draft.clone()], &promoted));
        assert!(validate_verified_rule_writes("compatibility_rules", &[draft.clone()], vec![promoted.clone()], "production_manager").is_ok());
        let edited_while_verifying = serde_json::json!({ "id": "rule-1", "status": "verified", "verificationStatus": "verified", "name": "Changed" });
        assert!(validate_verified_rule_writes("compatibility_rules", &[draft], vec![edited_while_verifying], "production_manager").is_err());
        assert!(validate_verified_rule_writes("safety_rules", &[], vec![verified.clone()], "raw_material").is_err());
        let draft = serde_json::json!({ "id": "rule-1", "status": "draft", "verificationStatus": "not_verified" });
        assert!(!rule_write_requires_verify("safety_rules", &[], &draft));
        assert!(validate_verified_rule_writes("safety_rules", &[], vec![draft], "raw_material").is_ok());
    }

    #[test]
    fn generic_safety_resolution_write_overrides_caller_attribution_with_trusted_actor() {
        let actor = authz::TrustedActor { user_id: "user-7".into(), role: "researcher".into(), display_name: "Researcher Seven".into() };
        let record = serde_json::json!({
            "schemaVersion": "1.0", "id": "safety-1", "formulationId": "formula-1", "versionId": "v1",
            "findingId": "finding-1", "reviewerName": "forged", "reviewerRole": "administrator",
            "resolvedAt": "2026-10-27T10:00:00Z", "resolutionReason": "Reviewed evidence.", "resolutionKind": "accepted_risk"
        });
        let stamped = stamp_safety_resolution(record, &actor).unwrap();
        assert_eq!(stamped["reviewerName"], "user-7");
        assert_eq!(stamped["reviewerRole"], "researcher");
    }

    #[test]
    fn raw_migration_cannot_create_or_rewrite_safety_resolutions() {
        let existing = vec![serde_json::json!({
            "schemaVersion": "1.0", "id": "safety-1", "formulationId": "formula-1", "versionId": "v1",
            "findingId": "finding-1", "reviewerName": "user-7", "reviewerRole": "researcher",
            "resolvedAt": "2026-10-27T10:00:00Z", "resolutionReason": "Reviewed evidence.", "resolutionKind": "accepted_risk"
        })];
        assert!(validate_raw_sensitive_write("safety_resolutions", &existing, &existing, "administrator").is_ok());
        assert!(validate_raw_sensitive_write("safety_resolutions", &existing, &[], "administrator").is_err());
        let forged = vec![serde_json::json!({
            "schemaVersion": "1.0", "id": "safety-1", "formulationId": "formula-1", "versionId": "v1",
            "findingId": "finding-1", "reviewerName": "forged", "reviewerRole": "administrator",
            "resolvedAt": "2026-10-27T10:00:00Z", "resolutionReason": "Reviewed evidence.", "resolutionKind": "accepted_risk"
        })];
        assert!(validate_raw_sensitive_write("safety_resolutions", &existing, &forged, "administrator").is_err());
        let second = serde_json::json!({ "id": "safety-2", "reviewerName": "user-8", "reviewerRole": "quality" });
        let two_existing = vec![existing[0].clone(), second.clone()];
        let duplicate_first = vec![existing[0].clone(), existing[0].clone()];
        assert!(validate_raw_sensitive_write("safety_resolutions", &two_existing, &duplicate_first, "administrator").is_err());
    }

    #[test]
    fn raw_migration_cannot_promote_or_remove_a_verified_safety_rule() {
        let existing = vec![serde_json::json!({ "id": "rule-1", "status": "verified", "verificationStatus": "verified" })];
        assert!(validate_raw_sensitive_write("safety_rules", &existing, &existing, "raw_material").is_ok());
        assert!(validate_raw_sensitive_write("safety_rules", &existing, &[], "administrator").is_err());
        let edited_content = vec![serde_json::json!({ "id": "rule-1", "status": "verified", "verificationStatus": "verified", "message": "Changed meaning" })];
        let prior_content = vec![serde_json::json!({ "id": "rule-1", "status": "verified", "verificationStatus": "verified", "message": "Original meaning" })];
        assert!(validate_raw_sensitive_write("safety_rules", &prior_content, &edited_content, "administrator").is_err());
        let duplicate_verified = vec![existing[0].clone(), existing[0].clone()];
        assert!(validate_raw_sensitive_write("safety_rules", &existing, &duplicate_verified, "administrator").is_err());
        let promoted = vec![serde_json::json!({ "id": "rule-2", "status": "verified", "verificationStatus": "verified" })];
        assert!(validate_raw_sensitive_write("safety_rules", &[], &promoted, "administrator").is_err());
        let demoted = vec![serde_json::json!({ "id": "rule-1", "status": "draft", "verificationStatus": "not_verified" })];
        assert!(validate_raw_sensitive_write("safety_rules", &existing, &demoted, "administrator").is_err());
    }

    #[test]
    fn supplier_product_claim_reviews_require_the_exact_ordered_citation_list() {
        let expected = vec!["a:p1:l1".to_string(), "b:p2:l3".to_string()];
        let exact = vec![serde_json::json!("a:p1:l1"), serde_json::json!("b:p2:l3")];
        let duplicate = vec![serde_json::json!("a:p1:l1"), serde_json::json!("a:p1:l1")];
        let reordered = vec![serde_json::json!("b:p2:l3"), serde_json::json!("a:p1:l1")];
        assert!(supplier_product_review_citations_match(&exact, &expected));
        assert!(!supplier_product_review_citations_match(&duplicate, &expected));
        assert!(!supplier_product_review_citations_match(&reordered, &expected));
    }
}
