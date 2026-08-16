/**
 * Phase 13 Session 4A — the canonical masterdata collection -> PolicyArea
 * contract. Session 4 built this mapping Rust-only, inside
 * `masterdata.rs`'s `area_for_collection()` — a real, working gate, but
 * with no TypeScript equivalent to stay in parity with, and no mechanism
 * forcing the two to agree if either side changed. This file closes that:
 * it is now the ONE place the 90 allow-listed collection names are grouped
 * by domain, generated to a JSON fixture
 * (`scripts/generate-role-policy-matrix.ts` ->
 * `masterdataCollectionAreas.generated.json`) that Rust's `role_policy.rs`
 * reads via `include_str!`, replacing its own hand-typed `match`. Neither
 * language holds a mapping the other doesn't provably agree with — same
 * shared-fixture mechanism `rolePolicyMatrix.generated.json`/
 * `formulaStatusTransitions.json` already use (architecture doc §9.3.1).
 *
 * The grouping itself is unchanged from Session 4: built from
 * `masterdata.rs`'s own Phase-by-Phase domain-grouping doc comments and,
 * where one already existed, `dataExchangeRegistry.ts`'s `targetCollection`/
 * per-template `authorization` role lists — real, pre-existing domain
 * judgment, not reinvented here. A first-draft judgment call, same caveat
 * as §6's matrix itself — flagged for the domain review, not presented as
 * final (architecture doc §9.3.6/Risks item 12).
 */
import { POLICY_AREAS, type PolicyArea } from "./rolePolicy";

/** The 90 allow-listed masterdata collection names — the TypeScript mirror
 *  of `masterdata.rs`'s `COLLECTIONS` array (names only; append-only-ness
 *  is a Rust-side storage detail, not a policy concern). Order matches
 *  `apps/desktop/src/lib/masterdata.ts`'s `Collection` union, which now
 *  derives from this list rather than declaring its own. */
export const MASTERDATA_COLLECTIONS = [
  "materials",
  "suppliers",
  "material_prices",
  "inventory",
  "packaging_components",
  "packaging_boms",
  "exchange_rates",
  "factory_profiles",
  "cost_snapshots",
  "material_suppliers",
  "compatibility_rules",
  "compatibility_snapshots",
  "safety_rules",
  "safety_snapshots",
  "safety_resolutions",
  "material_hazard_records",
  "optimization_profiles",
  "optimization_runs",
  "optimization_scenarios",
  "substitution_runs",
  "laboratory_trials",
  "test_definitions",
  "test_results",
  "trial_comparisons",
  "trial_deviations",
  "corrective_actions",
  "laboratory_standards",
  "laboratory_test_methods",
  "stability_studies",
  "stability_samples",
  "stability_results",
  "stability_failures",
  "approval_policies",
  "approval_policy_revisions",
  "formula_version_equivalences",
  "regulatory_rules",
  "regulatory_rule_revisions",
  "regulatory_reviews",
  "regulatory_review_revocations",
  "regulatory_evidence_confirmations",
  "regulatory_evidence_confirmation_revocations",
  "regulatory_review_equivalences",
  "regulatory_dossiers",
  "regulatory_dossier_requirements",
  "regulatory_evidence_items",
  "regulatory_requirement_evidence_links",
  "regulatory_dossier_reviews",
  "regulatory_dossier_review_revocations",
  "regulatory_dossier_submissions",
  "regulatory_dossier_manual_requirement_actions",
  "product_claims",
  "claim_evidence_links",
  "claim_reviews",
  "claim_review_revocations",
  "product_labels",
  "label_content_blocks",
  "label_artworks",
  "label_reviews",
  "label_review_revocations",
  "doe_studies",
  "doe_factors",
  "doe_constraints",
  "doe_responses",
  "doe_designs",
  "doe_runs",
  "doe_observations",
  "doe_analyses",
  "doe_candidates",
  "doe_review_actions",
  "product_families",
  "finished_products",
  "material_documents",
  "process_parameters",
  "formula_cost_overrides",
  "data_exchange_import_jobs",
  "data_exchange_import_row_results",
  "data_exchange_export_jobs",
  "data_exchange_schema_versions",
  "reverse_formulation_studies",
  "benchmark_products",
  "benchmark_evidence_items",
  "ingredient_declaration_lines",
  "analytical_composition_results",
  "target_product_profiles",
  "reverse_constraint_sets",
  "ingredient_mappings",
  "substitution_rules",
  "reverse_formula_candidates",
  "candidate_score_explanations",
  "generated_document_records",
] as const;
export type MasterdataCollection = (typeof MASTERDATA_COLLECTIONS)[number];

/** Every one of the 90 collections mapped to exactly one `PolicyArea`.
 *  `Record<MasterdataCollection, PolicyArea>` makes an unmapped collection
 *  a compile error, not just a test failure — TypeScript won't build if a
 *  new entry is added to `MASTERDATA_COLLECTIONS` without a matching entry
 *  here. */
export const MASTERDATA_COLLECTION_POLICY_AREAS: Record<MasterdataCollection, PolicyArea> = {
  // Raw-material / supplier master data.
  materials: "rawMaterials",
  suppliers: "rawMaterials",
  material_prices: "rawMaterials",
  inventory: "rawMaterials",
  packaging_components: "rawMaterials",
  packaging_boms: "rawMaterials",
  material_suppliers: "rawMaterials",
  material_hazard_records: "rawMaterials",
  material_documents: "rawMaterials",
  product_families: "rawMaterials",
  finished_products: "rawMaterials",
  compatibility_rules: "rawMaterials",
  safety_rules: "rawMaterials",

  // Formulation content/costing/safety-check results.
  exchange_rates: "formulation",
  factory_profiles: "formulation",
  cost_snapshots: "formulation",
  formula_cost_overrides: "formulation",
  process_parameters: "formulation",
  compatibility_snapshots: "formulation",
  safety_snapshots: "formulation",
  safety_resolutions: "formulation",

  // Laboratory.
  laboratory_trials: "laboratory",
  test_definitions: "laboratory",
  test_results: "laboratory",
  trial_comparisons: "laboratory",
  trial_deviations: "laboratory",
  corrective_actions: "laboratory",
  laboratory_standards: "laboratory",
  laboratory_test_methods: "laboratory",
  analytical_composition_results: "laboratory",
  formula_version_equivalences: "laboratory",

  // Stability.
  stability_studies: "stability",
  stability_samples: "stability",
  stability_results: "stability",
  stability_failures: "stability",

  // Approval policy configuration.
  approval_policies: "approvalProduction",
  approval_policy_revisions: "approvalProduction",

  // Regulatory (rules, dossiers/evidence, claims, labels).
  regulatory_rules: "regulatory",
  regulatory_rule_revisions: "regulatory",
  regulatory_reviews: "regulatory",
  regulatory_review_revocations: "regulatory",
  regulatory_evidence_confirmations: "regulatory",
  regulatory_evidence_confirmation_revocations: "regulatory",
  regulatory_review_equivalences: "regulatory",
  regulatory_dossiers: "regulatory",
  regulatory_dossier_requirements: "regulatory",
  regulatory_evidence_items: "regulatory",
  regulatory_requirement_evidence_links: "regulatory",
  regulatory_dossier_reviews: "regulatory",
  regulatory_dossier_review_revocations: "regulatory",
  regulatory_dossier_submissions: "regulatory",
  regulatory_dossier_manual_requirement_actions: "regulatory",
  product_claims: "regulatory",
  claim_evidence_links: "regulatory",
  claim_reviews: "regulatory",
  claim_review_revocations: "regulatory",
  product_labels: "regulatory",
  label_content_blocks: "regulatory",
  label_artworks: "regulatory",
  label_reviews: "regulatory",
  label_review_revocations: "regulatory",

  // Optimization (Advanced Optimizer, DOE, Reverse Formulation).
  optimization_profiles: "optimization",
  optimization_runs: "optimization",
  optimization_scenarios: "optimization",
  substitution_runs: "optimization",
  doe_studies: "optimization",
  doe_factors: "optimization",
  doe_constraints: "optimization",
  doe_responses: "optimization",
  doe_designs: "optimization",
  doe_runs: "optimization",
  doe_observations: "optimization",
  doe_analyses: "optimization",
  doe_candidates: "optimization",
  doe_review_actions: "optimization",
  reverse_formulation_studies: "optimization",
  benchmark_products: "optimization",
  benchmark_evidence_items: "optimization",
  ingredient_declaration_lines: "optimization",
  target_product_profiles: "optimization",
  reverse_constraint_sets: "optimization",
  ingredient_mappings: "optimization",
  substitution_rules: "optimization",
  reverse_formula_candidates: "optimization",
  candidate_score_explanations: "optimization",

  // Data Exchange Center's own bookkeeping.
  data_exchange_import_jobs: "dataExchange",
  data_exchange_import_row_results: "dataExchange",
  data_exchange_export_jobs: "dataExchange",
  data_exchange_schema_versions: "dataExchange",

  // Document export history.
  generated_document_records: "documentControl",
};

/** Every `PolicyArea` used above is a real, recognized area — a typo here
 *  would be a compile error via the `Record<MasterdataCollection,
 *  PolicyArea>` type above, but this loop exists so a runtime consumer
 *  (the generation script, a future admin view) can validate a value
 *  without re-deriving the type check. */
export function isKnownPolicyArea(value: string): value is PolicyArea {
  return (POLICY_AREAS as readonly string[]).includes(value);
}
