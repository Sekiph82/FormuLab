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
  CompatibilityRule,
  CompatibilitySnapshot,
  CorrectiveAction,
  CostSnapshot,
  ExchangeRate,
  FactoryCostProfile,
  FormulaVersionEquivalence,
  InventoryRecord,
  LaboratoryTrial,
  MaterialHazardRecord,
  MaterialPrice,
  MaterialSupplier,
  OptimizationProfile,
  OptimizationRun,
  OptimizationScenario,
  PackagingBom,
  PackagingComponent,
  RawMaterial,
  RegulatoryEvidenceConfirmation,
  RegulatoryEvidenceConfirmationRevocation,
  RegulatoryReview,
  RegulatoryReviewEquivalence,
  RegulatoryReviewRevocation,
  RegulatoryRule,
  RegulatoryRuleRevision,
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
} from "@ai4s/shared";
import { isTauri } from "./tauri";

export type Collection =
  | "materials"
  | "suppliers"
  | "material_prices"
  | "inventory"
  | "packaging_components"
  | "packaging_boms"
  | "exchange_rates"
  | "factory_profiles"
  | "cost_snapshots"
  | "material_suppliers"
  | "compatibility_rules"
  | "compatibility_snapshots"
  | "safety_rules"
  | "safety_snapshots"
  | "safety_resolutions"
  | "material_hazard_records"
  | "optimization_profiles"
  | "optimization_runs"
  | "optimization_scenarios"
  | "substitution_runs"
  | "laboratory_trials"
  | "test_definitions"
  | "test_results"
  | "trial_comparisons"
  | "trial_deviations"
  | "corrective_actions"
  | "stability_studies"
  | "stability_samples"
  | "stability_results"
  | "stability_failures"
  | "approval_policies"
  | "approval_policy_revisions"
  | "formula_version_equivalences"
  | "regulatory_rules"
  | "regulatory_rule_revisions"
  | "regulatory_reviews"
  | "regulatory_review_revocations"
  | "regulatory_evidence_confirmations"
  | "regulatory_evidence_confirmation_revocations"
  | "regulatory_review_equivalences";

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
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isTauri) throw new Error("not-desktop");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
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
 */
export async function listRecordsSeeded<C extends Collection>(
  collection: C,
  seed: CollectionTypes[C][],
): Promise<CollectionTypes[C][]> {
  const existing = await listRecords(collection);
  if (existing.length > 0 || seed.length === 0) return existing;
  await upsertRecords(collection, seed);
  return listRecords(collection);
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
