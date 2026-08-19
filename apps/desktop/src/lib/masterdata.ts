/**
 * Master-data access: materials, suppliers, prices, inventory, packaging,
 * exchange rates, factory profiles and cost snapshots.
 *
 * Thin bindings over the Rust store. The collection names are the same
 * allow-list the Rust side enforces — repeating them here as a union type means
 * a typo is a compile error rather than a runtime "unknown collection".
 */
import type {
  ApprovalPolicy,
  ApprovalPolicyRevision,
  ClaimEvidenceLink,
  ClaimReview,
  ClaimReviewRevocation,
  CompatibilityRule,
  CompatibilitySnapshot,
  CorrectiveAction,
  CostSnapshot,
  DataExchangeExportJob,
  DataExchangeImportJob,
  DataExchangeImportRowResult,
  DataExchangeSchemaVersion,
  DoeAnalysis,
  DoeCandidate,
  DoeConstraint,
  DoeDesign,
  DoeFactor,
  DoeObservation,
  DoeResponse,
  DoeReviewAction,
  DoeRun,
  DoeStudy,
  ExchangeRate,
  FactoryCostProfile,
  FinishedProduct,
  FinishedProductSpecification,
  FormulaCostOverride,
  FormulaVersionEquivalence,
  GeneratedDocumentRecord,
  InventoryRecord,
  LabelArtwork,
  LabelContentBlock,
  LabelReview,
  LabelReviewRevocation,
  LaboratoryStandard,
  LaboratoryTestMethod,
  LaboratoryTrial,
  MasterProductFamily,
  MaterialDocument,
  MaterialHazardRecord,
  MaterialPrice,
  MaterialSupplier,
  OptimizationProfile,
  OptimizationRun,
  OptimizationScenario,
  PackagingBom,
  PackagingComponent,
  ProcessParameter,
  ProductClaim,
  ProductLabel,
  RawMaterial,
  RegulatoryDossier,
  RegulatoryDossierEvidenceItem,
  RegulatoryDossierManualRequirementAction,
  RegulatoryDossierRequirement,
  RegulatoryDossierReview,
  RegulatoryDossierReviewRevocation,
  RegulatoryDossierSubmission,
  RegulatoryEvidenceConfirmation,
  RegulatoryEvidenceConfirmationRevocation,
  RegulatoryRequirementEvidenceLink,
  RegulatoryReview,
  RegulatoryReviewEquivalence,
  RegulatoryReviewRevocation,
  RegulatoryRule,
  RegulatoryRuleRevision,
  ReverseFormulationStudy,
  BenchmarkProduct,
  BenchmarkEvidenceItem,
  IngredientDeclarationLine,
  AnalyticalCompositionResult,
  TargetProductProfile,
  ReverseConstraintSet,
  IngredientMapping,
  SubstitutionRule,
  ReverseFormulaCandidate,
  CandidateScoreExplanation,
  SafetyResolution,
  SafetyRule,
  SafetySnapshot,
  StabilityFailure,
  StabilityResult,
  StabilitySample,
  StabilityStudy,
  SubstitutionRun,
  Supplier,
  TestDefinition,
  TestResult,
  TrialComparison,
  TrialDeviation,
} from "@formulab/shared";
import { isTauri } from "./tauri";
import { currentSessionToken } from "./sessionToken";
import type { MasterdataCollection } from "@formulab/shared";

/** Phase 13 Session 4A: now derived from `@formulab/shared`'s
 *  `MasterdataCollection` (`masterdataPolicyAreas.ts`) — the same 90-name
 *  list `masterdata.rs`'s `COLLECTIONS` and the generated policy-area
 *  fixture both answer to, not a second hand-typed union that could drift
 *  from either. */
export type Collection = MasterdataCollection;

interface CollectionTypes {
  materials: RawMaterial;
  suppliers: Supplier;
  material_prices: MaterialPrice;
  inventory: InventoryRecord;
  packaging_components: PackagingComponent;
  packaging_boms: PackagingBom;
  exchange_rates: ExchangeRate;
  factory_profiles: FactoryCostProfile;
  cost_snapshots: CostSnapshot;
  material_suppliers: MaterialSupplier;
  compatibility_rules: CompatibilityRule;
  compatibility_snapshots: CompatibilitySnapshot;
  safety_rules: SafetyRule;
  safety_snapshots: SafetySnapshot;
  safety_resolutions: SafetyResolution;
  material_hazard_records: MaterialHazardRecord;
  optimization_profiles: OptimizationProfile;
  optimization_runs: OptimizationRun;
  optimization_scenarios: OptimizationScenario;
  substitution_runs: SubstitutionRun;
  laboratory_trials: LaboratoryTrial;
  test_definitions: TestDefinition;
  test_results: TestResult;
  trial_comparisons: TrialComparison;
  trial_deviations: TrialDeviation;
  corrective_actions: CorrectiveAction;
  laboratory_standards: LaboratoryStandard;
  laboratory_test_methods: LaboratoryTestMethod;
  stability_studies: StabilityStudy;
  stability_samples: StabilitySample;
  stability_results: StabilityResult;
  stability_failures: StabilityFailure;
  approval_policies: ApprovalPolicy;
  approval_policy_revisions: ApprovalPolicyRevision;
  formula_version_equivalences: FormulaVersionEquivalence;
  regulatory_rules: RegulatoryRule;
  regulatory_rule_revisions: RegulatoryRuleRevision;
  regulatory_reviews: RegulatoryReview;
  regulatory_review_revocations: RegulatoryReviewRevocation;
  regulatory_evidence_confirmations: RegulatoryEvidenceConfirmation;
  regulatory_evidence_confirmation_revocations: RegulatoryEvidenceConfirmationRevocation;
  regulatory_review_equivalences: RegulatoryReviewEquivalence;
  regulatory_dossiers: RegulatoryDossier;
  regulatory_dossier_requirements: RegulatoryDossierRequirement;
  regulatory_evidence_items: RegulatoryDossierEvidenceItem;
  regulatory_requirement_evidence_links: RegulatoryRequirementEvidenceLink;
  regulatory_dossier_reviews: RegulatoryDossierReview;
  regulatory_dossier_review_revocations: RegulatoryDossierReviewRevocation;
  regulatory_dossier_submissions: RegulatoryDossierSubmission;
  regulatory_dossier_manual_requirement_actions: RegulatoryDossierManualRequirementAction;
  product_claims: ProductClaim;
  claim_evidence_links: ClaimEvidenceLink;
  claim_reviews: ClaimReview;
  claim_review_revocations: ClaimReviewRevocation;
  product_labels: ProductLabel;
  label_content_blocks: LabelContentBlock;
  label_artworks: LabelArtwork;
  label_reviews: LabelReview;
  label_review_revocations: LabelReviewRevocation;
  doe_studies: DoeStudy;
  doe_factors: DoeFactor;
  doe_constraints: DoeConstraint;
  doe_responses: DoeResponse;
  doe_designs: DoeDesign;
  doe_runs: DoeRun;
  doe_observations: DoeObservation;
  doe_analyses: DoeAnalysis;
  doe_candidates: DoeCandidate;
  doe_review_actions: DoeReviewAction;
  product_families: MasterProductFamily;
  finished_products: FinishedProduct;
  finished_product_specifications: FinishedProductSpecification;
  material_documents: MaterialDocument;
  process_parameters: ProcessParameter;
  formula_cost_overrides: FormulaCostOverride;
  data_exchange_import_jobs: DataExchangeImportJob;
  data_exchange_import_row_results: DataExchangeImportRowResult;
  data_exchange_export_jobs: DataExchangeExportJob;
  data_exchange_schema_versions: DataExchangeSchemaVersion;
  reverse_formulation_studies: ReverseFormulationStudy;
  benchmark_products: BenchmarkProduct;
  benchmark_evidence_items: BenchmarkEvidenceItem;
  ingredient_declaration_lines: IngredientDeclarationLine;
  analytical_composition_results: AnalyticalCompositionResult;
  target_product_profiles: TargetProductProfile;
  reverse_constraint_sets: ReverseConstraintSet;
  ingredient_mappings: IngredientMapping;
  substitution_rules: SubstitutionRule;
  reverse_formula_candidates: ReverseFormulaCandidate;
  candidate_score_explanations: CandidateScoreExplanation;
  generated_document_records: GeneratedDocumentRecord;
}

/** Phase 13 Session 4: `token` is attached here, once, for every command in
 *  this file that expects it (all but `list_master_collections`, which
 *  takes no arguments at all — an extra field Tauri's command deserializer
 *  doesn't declare is simply ignored, so this stays a single shared
 *  helper). See `formulations.ts`'s `call()` for the full rationale. */
async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri) throw new Error("not-desktop");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, { token: currentSessionToken(), ...args });
}

export async function listRecords<C extends Collection>(
  collection: C,
): Promise<CollectionTypes[C][]> {
  if (!isTauri) return [];
  return call<CollectionTypes[C][]>("list_master_records", { collection });
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  total: number;
}

/**
 * Insert or update by stable code.
 *
 * Append-only collections (prices, exchange rates, cost snapshots) reject an
 * existing code at the storage layer — historical records are not editable, and
 * the error says so rather than silently overwriting.
 */
export async function upsertRecords<C extends Collection>(
  collection: C,
  records: CollectionTypes[C][],
): Promise<UpsertResult> {
  return call<UpsertResult>("upsert_master_records", { collection, records });
}

export async function deleteRecord(collection: Collection, code: string): Promise<void> {
  await call("delete_master_record", { collection, code });
}

/** Copy a collection aside before a destructive change. Returns the path. */
export async function backupCollection(collection: Collection): Promise<string> {
  return call<string>("backup_master_collection", { collection });
}

/**
 * Load a collection, seeding it from `seed` the first time it is ever empty.
 *
 * Used for the compatibility/safety rule libraries: they ship as code
 * (`SEED_COMPATIBILITY_RULES` / `SEED_SAFETY_RULES`) so the app has a rule
 * set on first run with no import step, but from that point on they live in
 * the project's own data and are editable — re-seeding never overwrites an
 * edit, because it only runs when the collection is still empty.
 *
 * Outside Tauri (a non-desktop context, e.g. a component test), there is no
 * collection to persist into at all — `listRecords` already degrades to `[]`
 * for exactly this reason. Mirror that here by returning `seed` directly
 * rather than attempting `upsertRecords`, which would otherwise throw
 * `"not-desktop"` (`call()`'s own guard) on every render.
 */
export async function listRecordsSeeded<C extends Collection>(
  collection: C,
  seed: CollectionTypes[C][],
): Promise<CollectionTypes[C][]> {
  if (!isTauri) return seed;
  const existing = await listRecords(collection);
  if (existing.length > 0 || seed.length === 0) return existing;
  await upsertRecords(collection, seed);
  return listRecords(collection);
}

/** Every allow-listed collection name and whether it is append-only — read
 *  directly from the Rust `COLLECTIONS` array (`masterdata.rs`), so this
 *  never drifts from what the storage layer actually enforces. Used by the
 *  schema migration runner to enumerate collections without a second,
 *  hand-maintained list. */
export async function listMasterCollections(): Promise<Array<[string, boolean]>> {
  if (!isTauri) return [];
  return call<Array<[string, boolean]>>("list_master_collections");
}

/**
 * Migration-only: overwrites an entire collection file, including an
 * append-only one — bypasses `upsertRecords`'s refusal to update an
 * existing key. Never call this outside the migration runner, which only
 * reaches it after a verified pre-migration backup already exists.
 */
export async function writeMasterCollectionRaw(
  collection: Collection,
  records: unknown[],
): Promise<void> {
  await call("write_master_collection_raw", { collection, records });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newMaterial(code: string, displayName: string): RawMaterial {
  return {
    schemaVersion: "1.0",
    code,
    displayName,
    casNumbers: [],
    ecNumbers: [],
    functions: [],
    // "missing" rather than a zero: nobody has told us the active content yet,
    // and a 0 would silently zero out every active-matter total it appears in.
    activeMatterState: "missing",
    documents: [],
    regulatoryStatuses: [],
    hazardClassifications: [],
    allergens: [],
    incompatibilities: [],
    substituteCodes: [],
    active: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

export function newSupplier(code: string, displayName: string): Supplier {
  return {
    schemaVersion: "1.0",
    code,
    legalName: displayName,
    displayName,
    currency: "KES",
    // Approval is a quality decision, so a new supplier starts unapproved.
    approved: false,
    qualityStatus: "not_assessed",
    active: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}
