/**
 * Data Exchange Center — existing-record lookups for preview classification
 * and current-data export.
 *
 * Two things every template needs that only live data can answer: "which
 * natural keys already exist?" (so preview can tell create from update) and
 * "what does the current data look like as a flat row?" (for current-data
 * export). Both are per-template because every target collection has its
 * own field names — but, like the commit layer, this stays one small
 * lookup table rather than 24 bespoke exporters.
 *
 * Not every template has a clean reverse mapping yet (grouped/nested
 * records — packaging BOM lines, DOE factors mixed with responses — need
 * more flattening than this pass had time for). Where a template is
 * missing here, the UI shows "not yet available for this template" rather
 * than a fabricated or silently empty export — see
 * docs/DATA_EXCHANGE_EXPORTS.md.
 */
import { listRecords, type Collection } from "./masterdata";
import { listFormulations, readFormulation } from "./formulations";

export interface ExistingLookup {
  /** Natural keys already present, for create-vs-update classification. */
  naturalKeys: Set<string>;
  /** Current records flattened to template rows, for current-data export. */
  rows: Record<string, string>[];
}

const s = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const j = (v: unknown): string => (Array.isArray(v) ? v.join(";") : s(v));

type Loader = () => Promise<ExistingLookup>;

async function flat(collection: Collection, keyField: string, toRow: (r: Record<string, unknown>) => Record<string, string>): Promise<ExistingLookup> {
  const records = (await listRecords(collection)) as unknown as Record<string, unknown>[];
  return {
    naturalKeys: new Set(records.map((r) => s(r[keyField]))),
    rows: records.map(toRow),
  };
}

const LOADERS: Partial<Record<string, Loader>> = {
  raw_materials: () =>
    flat("materials", "code", (r) => ({
      material_code: s(r.code),
      material_name: s(r.displayName),
      inci_name: s(r.inciName),
      cas_number: j(r.casNumbers),
      ec_number: j(r.ecNumbers),
      manufacturer_name: s(r.manufacturer),
      country_of_origin: s(r.countryOfOrigin),
      physical_form: s(r.physicalForm),
      active_matter_percent: s(r.activeMatterPercent),
      density: s(r.density),
      storage_condition: s(r.storageConditions),
      shelf_life_months: s(r.shelfLifeMonths),
      notes: s(r.notes),
    })),
  suppliers: () =>
    flat("suppliers", "code", (r) => ({
      supplier_code: s(r.code),
      supplier_name: s(r.displayName),
      legal_name: s(r.legalName),
      country: s(r.country),
      contact_name: s(r.contactPerson),
      email: s(r.email),
      phone: s(r.phone),
      currency: s(r.currency),
      payment_terms: s(r.paymentTerms),
      lead_time_days: s(r.defaultLeadTimeDays),
      approved_supplier: s(r.approved),
      qualification_status: s(r.qualityStatus),
      notes: s(r.notes),
    })),
  material_prices: () =>
    flat("material_prices", "code", (r) => ({
      material_code: s(r.materialCode),
      supplier_code: s(r.supplierCode),
      currency: s(r.currency),
      unit_price: s(r.price),
      price_unit: s(r.priceUnit),
      minimum_order_quantity: s(r.moq),
      valid_from: s(r.effectiveFrom),
      valid_until: s(r.effectiveTo),
      incoterm: s(r.incoterm),
      notes: s(r.notes),
    })),
  material_documents: () =>
    flat("material_documents", "code", (r) => ({
      material_code: s(r.materialCode),
      supplier_code: s(r.supplierCode),
      document_type: s(r.documentType),
      document_number: s(r.documentNumber),
      document_title: s(r.documentTitle),
      revision: s(r.revision),
      language: s(r.language),
      issuer: s(r.issuer),
      issue_date: s(r.issueDate),
      expiry_date: s(r.expiryDate),
      file_name: s(r.fileName),
      verification_status: s(r.verificationStatus),
      tags: j(r.tags),
      notes: s(r.notes),
    })),
  product_families: () =>
    flat("product_families", "code", (r) => ({
      family_code: s(r.code),
      family_name: s(r.name),
      category: s(r.category),
      subcategory: s(r.subcategory),
      default_unit: s(r.defaultUnit),
      default_batch_size: s(r.defaultBatchSize),
      target_market: s(r.targetMarket),
      default_jurisdictions: j(r.defaultJurisdictions),
      default_packaging_type: s(r.defaultPackagingType),
      active: s(r.active),
      tags: j(r.tags),
      notes: s(r.notes),
    })),
  finished_products: () =>
    flat("finished_products", "code", (r) => ({
      sku_code: s(r.code),
      sku_name: s(r.name),
      product_family_code: s(r.productFamilyCode),
      brand: s(r.brand),
      formula_code: s(r.formulaCode),
      formula_version: s(r.formulaVersion),
      packaging_sku_code: s(r.packagingSkuCode),
      net_quantity: s(r.netQuantity),
      quantity_unit: s(r.quantityUnit),
      barcode: s(r.barcode),
      target_markets: j(r.targetMarkets),
      languages: j(r.languages),
      status: s(r.status),
      manufacture_site: s(r.manufactureSite),
      shelf_life_months: s(r.shelfLifeMonths),
      tags: j(r.tags),
      notes: s(r.notes),
    })),
  packaging_components: () =>
    flat("packaging_components", "code", (r) => ({
      component_code: s(r.code),
      component_name: s(r.description),
      component_type: s(r.componentType),
      supplier_code: s(r.supplierCode),
      unit_price: s(r.unitPrice),
      currency: s(r.currency),
      minimum_order_quantity: s(r.moq),
      weight: s(r.weightG),
      material_type: s(r.materialType),
      notes: s(r.notes),
    })),
  process_parameters: () =>
    flat("process_parameters", "code", (r) => ({
      formula_code: s(r.formulaCode),
      formula_version: s(r.formulaVersion),
      step_number: s(r.stepNumber),
      step_name: s(r.stepName),
      phase: s(r.phase),
      equipment_type: s(r.equipmentType),
      temperature_min: s(r.temperatureMin),
      temperature_target: s(r.temperatureTarget),
      temperature_max: s(r.temperatureMax),
      critical_parameter: s(r.criticalParameter),
      instruction: s(r.instruction),
      notes: s(r.notes),
    })),
  costing_assumptions: () =>
    flat("factory_profiles", "code", (r) => ({
      costing_profile_code: s(r.code),
      currency: s(r.currency),
      effective_date: s(r.effectiveFrom),
      labor_cost_per_hour: s(r.directLabourPerHour),
      energy_cost_per_kwh: s(r.electricityPerKwh),
      water_cost_per_m3: s(r.waterPerM3),
      steam_cost_per_kg: s(r.steamPerKg),
      overhead_percent: s(r.overheadPercent),
      manufacturing_loss_percent: s(r.processLossPercent),
      notes: s(r.notes),
    })),
  formula_cost_overrides: () =>
    flat("formula_cost_overrides", "code", (r) => ({
      formula_code: s(r.formulaCode),
      formula_version: s(r.formulaVersion),
      material_code: s(r.materialCode),
      supplier_code: s(r.supplierCode),
      override_price: s(r.overridePrice),
      currency: s(r.currency),
      price_unit: s(r.priceUnit),
      effective_from: s(r.effectiveFrom),
      effective_until: s(r.effectiveUntil),
      reason: s(r.reason),
      notes: s(r.notes),
    })),
  test_definitions: () =>
    flat("test_definitions", "code", (r) => ({
      test_code: s(r.code),
      test_name: s(r.name),
      test_category: s(r.category),
      method_reference: s(r.methodReference),
      unit: s(r.unit),
      result_type: s(r.resultType),
      lower_limit: s(r.minimum),
      target_value: s(r.targetValue),
      upper_limit: s(r.maximum),
      replicate_count: s(r.replicatesRequired),
      required_for_release: s(r.requiredByDefault),
      active: s(r.active),
    })),
  regulatory_rules: () =>
    flat("regulatory_rules", "code", (r) => ({
      rule_code: s(r.code),
      jurisdiction: s(r.jurisdiction),
      authority: s(r.authority),
      rule_type: s(r.ruleType),
      requirement: s(r.requirement),
      severity: s(r.severity),
      mandatory: s(r.requiresRegistration),
      effective_date: s(r.effectiveDate),
      expiry_date: s(r.expiryDate),
      verification_status: s(r.verificationStatus),
      verified_by: s(r.verifiedBy),
      verified_at: s(r.verifiedAt),
    })),
};

export function hasExistingLookup(templateCode: string): boolean {
  return templateCode in LOADERS;
}

export async function loadExisting(templateCode: string): Promise<ExistingLookup> {
  const loader = LOADERS[templateCode];
  if (!loader) return { naturalKeys: new Set(), rows: [] };
  return loader();
}

/** Formula/BOM's current-data export is flattened from the session-based
 *  formulation store, not a masterdata collection — kept separate since it
 *  needs `listFormulations`/`readFormulation`, not `listRecords`. */
export async function loadExistingFormulaBom(): Promise<ExistingLookup> {
  const formulations = await listFormulations();
  const naturalKeys = new Set<string>();
  const rows: Record<string, string>[] = [];
  for (const f of formulations) {
    const { versions } = await readFormulation(f.id);
    for (const v of versions) {
      naturalKeys.add(`${f.code}::${v.versionNumber}`);
      for (const line of v.lines) {
        rows.push({
          formula_code: f.code,
          formula_name: f.name,
          formula_version: String(v.versionNumber),
          product_family_code: f.productFamilyCode,
          line_number: String(line.lineNumber),
          material_code: line.materialCode ?? "",
          percentage: line.percent,
          phase: line.phase,
          is_qs_material: String(line.isQsToHundred),
          notes: line.notes ?? "",
        });
      }
    }
  }
  return { naturalKeys, rows };
}
