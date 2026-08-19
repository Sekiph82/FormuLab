// `areas()`/`roles()` are public introspection helpers (mirroring
// `rolePolicy.ts`'s own `POLICY_AREAS`/`ROLES` exports) exercised by this
// module's own tests but not yet consumed elsewhere in the crate — same
// module-level `#[allow(dead_code)]` convention `identity.rs` already uses
// for primitives ahead of their first non-test caller.
#![allow(dead_code)]
// Phase 13 Session 4 — the Rust half of the canonical, cross-language
// authorization policy. This module holds no hand-typed permission matrix
// and no hand-typed workflow-transition graph of its own: both are read at
// first use, via `include_str!`, from the exact same JSON fixtures
// `packages/shared/src/engine/rolePolicy.ts`'s
// `scripts/generate-role-policy-matrix.ts` generates from `MATRIX`/
// `ALLOWED_NEXT` — the identical mechanism `identity.rs`'s
// `role_vocabulary_matches_the_shared_json_fixture` test already uses for
// the 12-role vocabulary (Session 3). A change to `rolePolicy.ts`'s MATRIX
// that isn't followed by regenerating the fixture fails
// `rolePolicy.matrixParity.test.ts` on the TypeScript side, not silently
// here — this file has nothing to independently drift.
//
// See docs/PHASE13_IDENTITY_SECURITY_ARCHITECTURE.md §7/§9.3.
use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;

const MATRIX_FIXTURE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packages/shared/src/engine/rolePolicyMatrix.generated.json"
));
const TRANSITIONS_FIXTURE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packages/shared/src/engine/formulaStatusTransitions.json"
));
const MASTERDATA_AREAS_FIXTURE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packages/shared/src/engine/masterdataCollectionAreas.generated.json"
));

#[derive(Debug, Deserialize)]
struct MatrixFixture {
    areas: Vec<String>,
    roles: Vec<String>,
    #[allow(dead_code)] // parsed for completeness; can() only needs `matrix`
    capabilities: Vec<String>,
    matrix: HashMap<String, HashMap<String, Vec<String>>>,
}

#[derive(Debug, Deserialize)]
struct TransitionsFixture {
    #[allow(dead_code)]
    statuses: Vec<String>,
    #[serde(rename = "allowedNext")]
    allowed_next: HashMap<String, Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct MasterdataAreasFixture {
    #[allow(dead_code)]
    collections: Vec<String>,
    areas: HashMap<String, String>,
}

fn matrix() -> &'static MatrixFixture {
    static MATRIX: OnceLock<MatrixFixture> = OnceLock::new();
    MATRIX.get_or_init(|| {
        serde_json::from_str(MATRIX_FIXTURE)
            .expect("rolePolicyMatrix.generated.json must be valid JSON matching MatrixFixture")
    })
}

fn transitions() -> &'static TransitionsFixture {
    static TRANSITIONS: OnceLock<TransitionsFixture> = OnceLock::new();
    TRANSITIONS.get_or_init(|| {
        serde_json::from_str(TRANSITIONS_FIXTURE)
            .expect("formulaStatusTransitions.json must be valid JSON matching TransitionsFixture")
    })
}

fn masterdata_areas() -> &'static MasterdataAreasFixture {
    static AREAS: OnceLock<MasterdataAreasFixture> = OnceLock::new();
    AREAS.get_or_init(|| {
        serde_json::from_str(MASTERDATA_AREAS_FIXTURE).expect(
            "masterdataCollectionAreas.generated.json must be valid JSON matching MasterdataAreasFixture",
        )
    })
}

/// Phase 13 Session 4A (architecture doc §9.3.6/§9.4): the masterdata
/// collection -> `PolicyArea` mapping, read from the same shared fixture
/// `masterdataPolicyAreas.ts`'s `MASTERDATA_COLLECTION_POLICY_AREAS`
/// generates — replaces Session 4's hand-typed Rust `match` with a single
/// source both languages read. Default-deny: an unmapped or unrecognized
/// collection name returns `None`, never a fallback area.
pub fn masterdata_area_for(collection: &str) -> Option<&'static str> {
    masterdata_areas().areas.get(collection).map(|s| s.as_str())
}

/// May `role` ever perform `capability` in `area`? Default-deny, exactly
/// mirroring `rolePolicy.ts`'s `can()`: an unrecognized area, an
/// unrecognized role, or a capability absent from that role's grants in
/// that area all fall through to `false` via plain `HashMap` lookups — there
/// is no "allow unless denied" branch anywhere in this function.
pub fn can(role: &str, area: &str, capability: &str) -> bool {
    matrix()
        .matrix
        .get(area)
        .and_then(|roles| roles.get(role))
        .map(|caps| caps.iter().any(|c| c == capability))
        .unwrap_or(false)
}

/// Every fixed policy area name, for validating an area string before using
/// it elsewhere (e.g. the masterdata collection -> area mapping).
pub fn areas() -> &'static [String] {
    &matrix().areas
}

/// Every fixed role name — the Rust-side mirror of `rolePolicy.ts`'s
/// `ROLES`, sourced from the same fixture `identity::Role` is already
/// checked against (Session 3's `roleVocabulary.json` parity mechanism).
pub fn roles() -> &'static [String] {
    &matrix().roles
}

/// May a `FormulaStatus` move from `from` to `to`? Default-deny: an
/// unrecognized `from` or a `to` not present in its allowed-next list both
/// return `false`. Mirrors `status.ts`'s `ALLOWED_NEXT` graph via the shared
/// fixture — no independently-typed copy of the state machine.
pub fn is_valid_transition(from: &str, to: &str) -> bool {
    transitions()
        .allowed_next
        .get(from)
        .map(|next| next.iter().any(|s| s == to))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_deny_for_unknown_area_role_or_capability() {
        assert!(!can("administrator", "not_a_real_area", "view"));
        assert!(!can("not_a_real_role", "formulation", "view"));
        assert!(!can("administrator", "formulation", "not_a_real_capability"));
        assert!(!can("", "", ""));
    }

    #[test]
    fn every_role_has_view_on_home() {
        for role in roles() {
            assert!(can(role, "home", "view"), "{role} should have view on home");
        }
    }

    #[test]
    fn only_administrator_can_manage_users_or_view_security_history() {
        // Phase 13 Session 5 — the structural proof "non-admin cannot
        // manage users" rests on: no other role has ANY capability in
        // either administration area.
        for role in roles() {
            let expected_admin_only = role == "administrator";
            for capability in ["view", "create", "edit", "administer"] {
                assert_eq!(
                    can(role, "administrationUsers", capability),
                    expected_admin_only,
                    "administrationUsers/{capability} must be administrator-only, got role={role}"
                );
            }
            assert_eq!(
                can(role, "administrationSecurity", "view"),
                expected_admin_only,
                "administrationSecurity/view must be administrator-only, got role={role}"
            );
        }
    }

    #[test]
    fn only_administrator_has_any_capability_on_system_administration() {
        for role in roles() {
            let expected_admin_only = role == "administrator";
            assert_eq!(
                can(role, "systemAdministration", "administer"),
                expected_admin_only,
                "systemAdministration/administer must be administrator-only, got role={role}"
            );
        }
    }

    #[test]
    fn administrator_never_holds_create_or_edit_on_any_scientific_content_area() {
        // Session 6 (privilege-escalation / authorization-bypass suite):
        // the direct, positive-denial proof of architecture doc §9's
        // "administrator is view-only on scientific content by explicit
        // design" rule — not merely inferred from the absence of a
        // positive grant elsewhere. Every area below is scientific/
        // business content administrator must never create or edit,
        // regardless of the narrow, explicit gate-decide exceptions
        // (verify/approve/reject) §15.4 grants on four of them.
        for area in [
            "formulation",
            "laboratory",
            "stability",
            "optimization",
            "rawMaterials",
            "supplierDocuments",
            "regulatory",
            "productionEngineering",
            "production",
        ] {
            for capability in ["create", "edit"] {
                assert!(
                    !can("administrator", area, capability),
                    "administrator must never hold {capability} on {area} — view-only by explicit design (§9)"
                );
            }
            assert!(can("administrator", area, "view"), "administrator should still view {area}");
        }
    }

    #[test]
    fn approval_pilot_approve_matches_the_known_manager_tier_plus_administrator() {
        for role in ["research_manager", "quality_manager", "administrator"] {
            assert!(can(role, "approvalPilot", "approve"), "{role} should approve pilot_approved");
        }
        for role in ["researcher", "quality", "regulatory", "raw_material", "procurement", "production_engineering", "production", "production_manager", "document_control"] {
            assert!(!can(role, "approvalPilot", "approve"), "{role} must NOT approve pilot_approved");
        }
    }

    #[test]
    fn approval_production_approve_matches_the_known_authority_set() {
        for role in ["quality_manager", "regulatory", "production_manager", "administrator"] {
            assert!(can(role, "approvalProduction", "approve"), "{role} should approve production_approved");
        }
        for role in ["researcher", "research_manager", "quality", "raw_material", "procurement", "production_engineering", "production", "document_control"] {
            assert!(!can(role, "approvalProduction", "approve"), "{role} must NOT approve production_approved");
        }
    }

    #[test]
    fn worker_tier_cannot_approve_even_though_it_can_submit() {
        // The exact worker/manager separation Session 4's brief requires
        // proof of: a worker role has `submit` but never `approve`/`reject`.
        assert!(can("researcher", "approvalPilot", "submit"));
        assert!(!can("researcher", "approvalPilot", "approve"));
        assert!(!can("researcher", "approvalPilot", "reject"));
        assert!(can("quality", "approvalProduction", "submit"));
        assert!(!can("quality", "approvalProduction", "approve"));
    }

    #[test]
    fn production_manager_verify_on_raw_materials_and_supplier_documents_session1_closure_gates() {
        // architecture doc §15.4 — the discrepancy-resolution addition.
        assert!(can("production_manager", "rawMaterials", "verify"));
        assert!(can("production_manager", "supplierDocuments", "verify"));
    }

    #[test]
    fn quality_does_not_hold_the_raw_material_gate_decide_capability() {
        // Phase 13 closure-session correction (rolePolicy.ts's own
        // "Correction #4" doc comment): production_manager (plus
        // administrator) is this gate's sole decide authority — `quality`'s
        // stale pre-gate `verify` grant on `rawMaterials` quietly acted as
        // a second one and has been removed from the canonical matrix.
        assert!(!can("quality", "rawMaterials", "verify"));
        assert!(can("quality", "rawMaterials", "view"));
    }

    #[test]
    fn regulatory_verify_extends_to_quality_and_administrator() {
        // architecture doc §8 — AUTHORIZED_REGULATORY_ROLES-derived addition.
        for role in ["regulatory", "quality", "administrator"] {
            assert!(can(role, "regulatory", "verify"), "{role} should verify regulatory evidence");
        }
        assert!(!can("researcher", "regulatory", "verify"));
    }

    #[test]
    fn transition_graph_allows_known_valid_moves_and_denies_invalid_ones() {
        assert!(is_valid_transition("pilot_candidate", "pilot_approved"));
        assert!(is_valid_transition("pilot_approved", "production_approved"));
        assert!(is_valid_transition("concept", "rejected"));
        assert!(is_valid_transition("rejected", "concept"));
        // Not adjacent: concept cannot jump straight to pilot_approved.
        assert!(!is_valid_transition("concept", "pilot_approved"));
        // production_approved's only forward move is retired.
        assert!(!is_valid_transition("production_approved", "pilot_candidate"));
        assert!(is_valid_transition("production_approved", "retired"));
        // retired is terminal.
        assert!(!is_valid_transition("retired", "concept"));
        // Unknown statuses default-deny.
        assert!(!is_valid_transition("not_a_real_status", "concept"));
    }

    #[test]
    fn fixture_vocabularies_have_the_expected_shape() {
        assert_eq!(roles().len(), 12);
        assert!(areas().contains(&"systemAdministration".to_string()));
        assert!(areas().contains(&"formulation".to_string()));
    }

    // -------------------------------------------- masterdata_area_for ---

    #[test]
    fn masterdata_area_for_has_all_91_collections_mapped() {
        assert_eq!(masterdata_areas().collections.len(), 91);
        for collection in &masterdata_areas().collections {
            assert!(
                masterdata_area_for(collection).is_some(),
                "{collection} has no policy area mapping"
            );
        }
    }

    #[test]
    fn masterdata_area_for_denies_an_unknown_collection() {
        assert_eq!(masterdata_area_for("not_a_real_collection"), None);
        assert_eq!(masterdata_area_for(""), None);
        assert_eq!(masterdata_area_for("../../etc/passwd"), None);
    }

    #[test]
    fn masterdata_area_for_matches_representative_collections() {
        assert_eq!(masterdata_area_for("materials"), Some("rawMaterials"));
        assert_eq!(masterdata_area_for("stability_studies"), Some("stability"));
        assert_eq!(masterdata_area_for("test_results"), Some("laboratory"));
        assert_eq!(masterdata_area_for("regulatory_rules"), Some("regulatory"));
        assert_eq!(masterdata_area_for("doe_studies"), Some("optimization"));
        assert_eq!(masterdata_area_for("data_exchange_import_jobs"), Some("dataExchange"));
        assert_eq!(masterdata_area_for("generated_document_records"), Some("documentControl"));
    }

    #[test]
    fn every_masterdata_area_is_a_real_policy_area() {
        let known: std::collections::HashSet<&str> = areas().iter().map(|s| s.as_str()).collect();
        for collection in &masterdata_areas().collections {
            let area = masterdata_area_for(collection).unwrap();
            assert!(known.contains(area), "{collection} -> {area} is not a real PolicyArea");
        }
    }
}
