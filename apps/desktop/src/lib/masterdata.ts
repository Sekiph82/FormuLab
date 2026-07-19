/**
 * Master-data access: materials, suppliers, prices, inventory, packaging,
 * exchange rates, factory profiles and cost snapshots.
 *
 * Thin bindings over the Rust store. The collection names are the same
 * allow-list the Rust side enforces — repeating them here as a union type means
 * a typo is a compile error rather than a runtime "unknown collection".
 */
import type {
  CompatibilityRule,
  CompatibilitySnapshot,
  CostSnapshot,
  ExchangeRate,
  FactoryCostProfile,
  InventoryRecord,
  MaterialHazardRecord,
  MaterialPrice,
  MaterialSupplier,
  PackagingBom,
  PackagingComponent,
  RawMaterial,
  SafetyResolution,
  SafetyRule,
  SafetySnapshot,
  Supplier,
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
  | "material_hazard_records";

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
