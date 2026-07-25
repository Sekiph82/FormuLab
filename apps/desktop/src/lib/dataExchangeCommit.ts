/**
 * Data Exchange Center — the commit layer.
 *
 * `dataExchangeValidation.ts` (shared, pure) decides which rows are safe to
 * write; this file is the one place that actually writes them, per
 * template. It is deliberately NOT part of the shared package: writing
 * requires live collection access (`listRecords`/`upsertRecords`,
 * `apps/desktop/src/lib/masterdata.ts`) and the desktop-only formulation
 * session store (`formulations.ts`), neither of which the pure validation
 * engine knows about.
 *
 * One rule holds across every template here: a record that needs a real
 * parent (a formulation, a DOE study, a stability study, a regulatory
 * dossier, a product label) is only ever attached to an EXISTING parent,
 * resolved by its human-readable code through a live lookup. Nothing here
 * fabricates a parent record from spreadsheet data — a formula/packaging
 * snapshot, a DOE design, a dossier's jurisdiction scope are all decisions
 * a human makes through the parent's own workspace, not data a CSV row can
 * safely stand in for. A missing parent is reported, never invented.
 *
 * Verification/approval fields are never taken from the file, for the same
 * reason the registry documents on each column: `approved`,
 * `verificationStatus`, `status` (claims/labels) all get fixed, unverified/
 * draft values here regardless of what the row said.
 */
import {
  newId,
  type ApprovalRole,
  type DataExchangeRowResult,
  type DataExchangeTemplateDefinition,
  type FinishedProduct,
  type FormulaCostOverride,
  type MasterProductFamily,
  type MaterialDocument,
  type MaterialPrice,
  type PackagingBom,
  type ProcessParameter,
  type RawMaterial,
  type Supplier,
  DOE_FACTOR_SOURCE_TYPES,
  DOE_FACTOR_TYPES,
  DOE_RESPONSE_OBJECTIVES,
  DOE_RESPONSE_TYPES,
  REGULATORY_RULE_TYPES,
  CLAIM_CATEGORIES,
} from "@ai4s/shared";
import { listRecords, upsertRecords, nowIso, type Collection } from "./masterdata";

const PHYSICAL_FORMS = ["liquid", "powder", "granule", "paste", "flake", "pellet", "gas", "solid", "gel"] as const;
import { listFormulations, readFormulation, saveFormulation, saveFormulationVersion, newFormulation, newVersion } from "./formulations";

export interface DataExchangeRowCommitOutcome {
  rowNumber: number;
  naturalKey: string;
  outcome: "created" | "updated" | "unchanged" | "skipped" | "failed";
  targetCollection?: string;
  targetRecordId?: string;
  message?: string;
}

interface CommitCtx {
  actorUserId: string;
  actorRole: ApprovalRole;
}

const nn = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : undefined);
const multi = (v: string | undefined) => (v ? v.split(";").map((s) => s.trim()).filter(Boolean) : []);
const bool = (v: string | undefined, fallback = false) => (v === undefined || v === "" ? fallback : v === "true");

async function findByCode<T extends Record<string, unknown>>(
  collection: Collection,
  codeField: string,
  code: string,
): Promise<T | undefined> {
  const rows = (await listRecords(collection)) as unknown as T[];
  return rows.find((r) => r[codeField] === code);
}

/** Templates where several source rows form one target record (a formula
 *  version's lines, most notably — a version is saved whole or not at all,
 *  so its lines cannot be committed one row at a time the way every other
 *  template's rows can). Grouped by this key prefix before committing;
 *  every row in a group gets the same outcome. */
const GROUPED_TEMPLATES: Partial<Record<string, (record: RowRecord) => string>> = {
  formula_bom: (r) => `${r.formula_code}::${r.formula_version || "__next__"}`,
  lab_results: (r) => `${r.trial_code}::${r.sample_code}::${r.test_code}`,
};

/** Builds the `__lines` payload a grouped template's handler reads back out
 *  (see `commitFormulaBom`/`commitLabResults`) — one function per grouped
 *  template, since what "one logical unit" means differs (formula lines vs.
 *  replicate measurements). */
const GROUPED_LINE_BUILDERS: Partial<Record<string, (rows: DataExchangeRowResult[]) => unknown[]>> = {
  formula_bom: (rows) =>
    rows
      .slice()
      .sort((a, b) => Number.parseInt(a.record.line_number || "0", 10) - Number.parseInt(b.record.line_number || "0", 10))
      .map((row) => ({
        lineNumber: Number.parseInt(row.record.line_number || "0", 10),
        materialCode: row.record.material_code,
        percent: row.record.percentage,
        phase: row.record.phase,
        notes: nn(row.record.notes),
        isQs: bool(row.record.is_qs_material),
      })),
  lab_results: (rows) =>
    rows
      .slice()
      .sort((a, b) => Number.parseInt(a.record.replicate_number || "0", 10) - Number.parseInt(b.record.replicate_number || "0", 10))
      .map((row) => ({
        replicateNumber: Number.parseInt(row.record.replicate_number || "1", 10),
        numericValue: nn(row.record.numeric_value),
        textValue: nn(row.record.text_value),
      })),
};

/** Commit every committable row (`valid_create`/`valid_update`/`unchanged`/
 *  `warning`) of one preview. Rows in any other state were never passed to
 *  this function by the caller — the UI only ever hands over rows the
 *  preview already classified as safe to write, or explicitly chosen for a
 *  partial import. */
export async function commitDataExchangeRows(
  template: DataExchangeTemplateDefinition,
  rows: DataExchangeRowResult[],
  ctx: CommitCtx,
): Promise<DataExchangeRowCommitOutcome[]> {
  const handler = COMMIT_HANDLERS[template.templateCode];
  if (!handler) {
    return rows.map((r) => ({
      rowNumber: r.rowNumber,
      naturalKey: r.naturalKey,
      outcome: "skipped",
      message: `No commit handler is wired for template "${template.templateCode}" yet.`,
    }));
  }

  const groupKeyFor = GROUPED_TEMPLATES[template.templateCode];
  const outcomes: DataExchangeRowCommitOutcome[] = [];

  if (groupKeyFor) {
    const groups = new Map<string, DataExchangeRowResult[]>();
    for (const row of rows) {
      if (row.state === "unchanged") {
        outcomes.push({ rowNumber: row.rowNumber, naturalKey: row.naturalKey, outcome: "unchanged" });
        continue;
      }
      const key = groupKeyFor(row.record);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    const buildLines = GROUPED_LINE_BUILDERS[template.templateCode] ?? (() => []);
    for (const groupRows of groups.values()) {
      const first = groupRows[0].record;
      const grouped: RowRecord & { __lines?: unknown } = { ...first };
      (grouped as { __lines: unknown }).__lines = buildLines(groupRows);
      try {
        const result = await handler(grouped, ctx);
        for (const row of groupRows) outcomes.push({ rowNumber: row.rowNumber, naturalKey: row.naturalKey, ...result });
      } catch (e) {
        const message = String(e instanceof Error ? e.message : e);
        for (const row of groupRows) outcomes.push({ rowNumber: row.rowNumber, naturalKey: row.naturalKey, outcome: "failed", message });
      }
    }
    return outcomes;
  }

  for (const row of rows) {
    if (row.state === "unchanged") {
      outcomes.push({ rowNumber: row.rowNumber, naturalKey: row.naturalKey, outcome: "unchanged" });
      continue;
    }
    try {
      const result = await handler(row.record, ctx);
      outcomes.push({ rowNumber: row.rowNumber, naturalKey: row.naturalKey, ...result });
    } catch (e) {
      outcomes.push({ rowNumber: row.rowNumber, naturalKey: row.naturalKey, outcome: "failed", message: String(e instanceof Error ? e.message : e) });
    }
  }
  return outcomes;
}

type RowRecord = Record<string, string>;
type Handler = (record: RowRecord, ctx: CommitCtx) => Promise<Omit<DataExchangeRowCommitOutcome, "rowNumber" | "naturalKey">>;
interface FormulaBomLine {
  lineNumber: number;
  materialCode: string;
  percent: string;
  phase: string;
  notes?: string;
  isQs: boolean;
}

// ===================================================== master data (1-8) ===

const commitRawMaterials: Handler = async (r) => {
  const existing = await findByCode<RawMaterial>("materials", "code", r.material_code);
  const record: RawMaterial = {
    schemaVersion: "1.0",
    code: r.material_code,
    displayName: r.material_name,
    inciName: nn(r.inci_name),
    casNumbers: multi(r.cas_number),
    ecNumbers: multi(r.ec_number),
    manufacturer: nn(r.manufacturer_name),
    countryOfOrigin: nn(r.country_of_origin),
    physicalForm: PHYSICAL_FORMS.includes(r.physical_form as (typeof PHYSICAL_FORMS)[number]) ? (r.physical_form as RawMaterial["physicalForm"]) : undefined,
    activeMatterPercent: nn(r.active_matter_percent),
    activeMatterState: nn(r.active_matter_percent) ? "known" : "missing",
    density: nn(r.density),
    functions: [],
    storageConditions: nn(r.storage_condition),
    shelfLifeMonths: r.shelf_life_months ? Number.parseInt(r.shelf_life_months, 10) : undefined,
    documents: existing?.documents ?? [],
    regulatoryStatuses: existing?.regulatoryStatuses ?? (r.regulatory_status ? [{ market: "KE", status: "not_verified" as const, notes: r.regulatory_status }] : []),
    hazardClassifications: existing?.hazardClassifications ?? (bool(r.hazardous) ? ["hazardous (imported)"] : []),
    allergens: existing?.allergens ?? (bool(r.allergen) ? ["allergen (imported)"] : []),
    incompatibilities: existing?.incompatibilities ?? [],
    substituteCodes: existing?.substituteCodes ?? [],
    notes: [nn(r.notes), r.tags ? `tags: ${r.tags}` : undefined, r.manufacturer_code ? `manufacturer_code: ${r.manufacturer_code}` : undefined, r.preferred_supplier_code ? `preferred_supplier_code: ${r.preferred_supplier_code}` : undefined]
      .filter(Boolean)
      .join(" | ") || undefined,
    active: true,
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("materials", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "materials", targetRecordId: record.code };
};

const commitSuppliers: Handler = async (r) => {
  const existing = await findByCode<Supplier>("suppliers", "code", r.supplier_code);
  const record: Supplier = {
    schemaVersion: "1.0",
    code: r.supplier_code,
    legalName: nn(r.legal_name) ?? r.supplier_name,
    displayName: r.supplier_name,
    country: nn(r.country),
    contactPerson: nn(r.contact_name),
    email: nn(r.email),
    phone: nn(r.phone),
    currency: nn(r.currency) ?? "KES",
    paymentTerms: nn(r.payment_terms),
    defaultLeadTimeDays: r.lead_time_days ? Number.parseInt(r.lead_time_days, 10) : undefined,
    // approved_supplier from the file is never taken as-is — see module doc.
    approved: existing?.approved ?? false,
    qualityStatus: (nn(r.qualification_status) as Supplier["qualityStatus"]) ?? existing?.qualityStatus ?? "not_assessed",
    notes: [nn(r.notes), r.website ? `website: ${r.website}` : undefined, r.city ? `city: ${r.city}` : undefined, r.address ? `address: ${r.address}` : undefined, r.minimum_order_value ? `minimum_order_value: ${r.minimum_order_value}` : undefined, r.last_audit_date ? `last_audit_date: ${r.last_audit_date}` : undefined, r.next_audit_date ? `next_audit_date: ${r.next_audit_date}` : undefined, r.rating ? `rating: ${r.rating}` : undefined, r.tags ? `tags: ${r.tags}` : undefined]
      .filter(Boolean)
      .join(" | ") || undefined,
    active: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("suppliers", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "suppliers", targetRecordId: record.code };
};

const commitMaterialPrices: Handler = async (r) => {
  const record: MaterialPrice = {
    schemaVersion: "1.0",
    code: newId("price"),
    materialCode: r.material_code,
    supplierCode: nn(r.supplier_code),
    price: r.unit_price,
    currency: r.currency,
    priceUnit: nn(r.price_unit) ?? "kg",
    moq: nn(r.minimum_order_quantity),
    effectiveFrom: r.valid_from,
    effectiveTo: nn(r.valid_until),
    incoterm: nn(r.incoterm),
    allocationBasis: "per_kg",
    verification: "not_verified",
    notes: [nn(r.notes), r.supplier_material_code ? `supplier_material_code: ${r.supplier_material_code}` : undefined, r.manufacturer_name ? `manufacturer_name: ${r.manufacturer_name}` : undefined, r.brand_name ? `brand_name: ${r.brand_name}` : undefined, r.pack_size ? `pack_size: ${r.pack_size}` : undefined, r.country_of_origin ? `country_of_origin: ${r.country_of_origin}` : undefined, bool(r.preferred) ? "preferred" : undefined, bool(r.approved) ? "approved(imported-note-only)" : undefined]
      .filter(Boolean)
      .join(" | ") || undefined,
    recordedAt: nowIso(),
    recordedBy: "data-exchange-import",
  };
  await upsertRecords("material_prices", [record]);
  return { outcome: "created", targetCollection: "material_prices", targetRecordId: record.code };
};

const commitMaterialDocuments: Handler = async (r) => {
  const naturalCode = `${r.material_code}-${r.document_type}-${r.document_number || "nodocnum"}`;
  const existing = await findByCode<MaterialDocument>("material_documents", "code", naturalCode);
  const record: MaterialDocument = {
    schemaVersion: "1.0",
    code: naturalCode,
    materialCode: r.material_code,
    supplierCode: nn(r.supplier_code),
    documentType: r.document_type as MaterialDocument["documentType"],
    documentNumber: nn(r.document_number),
    documentTitle: r.document_title,
    revision: nn(r.revision),
    language: nn(r.language),
    issuer: nn(r.issuer),
    issueDate: nn(r.issue_date),
    expiryDate: nn(r.expiry_date),
    fileName: nn(r.file_name),
    expectedSha256: nn(r.expected_sha256),
    // Never taken from the file — always unverified until a human verifies it.
    verificationStatus: "unverified",
    tags: multi(r.tags),
    notes: nn(r.notes),
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("material_documents", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "material_documents", targetRecordId: record.code };
};

const commitProductFamilies: Handler = async (r) => {
  const existing = await findByCode<MasterProductFamily>("product_families", "code", r.family_code);
  const record: MasterProductFamily = {
    schemaVersion: "1.0",
    code: r.family_code,
    name: r.family_name,
    category: nn(r.category),
    subcategory: nn(r.subcategory),
    defaultUnit: nn(r.default_unit),
    defaultBatchSize: nn(r.default_batch_size),
    targetMarket: nn(r.target_market),
    defaultJurisdictions: multi(r.default_jurisdictions),
    defaultPackagingType: nn(r.default_packaging_type),
    active: bool(r.active, true),
    tags: multi(r.tags),
    notes: nn(r.notes),
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("product_families", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "product_families", targetRecordId: record.code };
};

const commitFinishedProducts: Handler = async (r) => {
  const existing = await findByCode<FinishedProduct>("finished_products", "code", r.sku_code);
  const record: FinishedProduct = {
    schemaVersion: "1.0",
    code: r.sku_code,
    name: r.sku_name,
    productFamilyCode: nn(r.product_family_code),
    brand: nn(r.brand),
    formulaCode: nn(r.formula_code),
    formulaVersion: r.formula_version ? Number.parseInt(r.formula_version, 10) : undefined,
    packagingSkuCode: nn(r.packaging_sku_code),
    netQuantity: nn(r.net_quantity),
    quantityUnit: nn(r.quantity_unit),
    barcode: nn(r.barcode),
    targetMarkets: multi(r.target_markets),
    languages: multi(r.languages),
    status: (nn(r.status) as FinishedProduct["status"]) ?? "draft",
    manufactureSite: nn(r.manufacture_site),
    shelfLifeMonths: r.shelf_life_months ? Number.parseInt(r.shelf_life_months, 10) : undefined,
    tags: multi(r.tags),
    notes: nn(r.notes),
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("finished_products", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "finished_products", targetRecordId: record.code };
};

const commitPackagingComponents: Handler = async (r) => {
  const existing = await findByCode<Record<string, unknown>>("packaging_components", "code", r.component_code);
  const record = {
    schemaVersion: "1.0" as const,
    code: r.component_code,
    description: r.component_name,
    componentType: r.component_type,
    supplierCode: nn(r.supplier_code),
    unit: "piece",
    unitPrice: nn(r.unit_price),
    currency: nn(r.currency) ?? "KES",
    moq: nn(r.minimum_order_quantity),
    effectiveFrom: undefined as string | undefined,
    weightG: nn(r.weight),
    materialType: nn(r.material_type),
    wasteFactorPercent: "0",
    notes: [nn(r.notes), r.manufacturer_name ? `manufacturer_name: ${r.manufacturer_name}` : undefined, r.capacity ? `capacity: ${r.capacity} ${r.capacity_unit ?? ""}`.trim() : undefined, r.color ? `color: ${r.color}` : undefined, r.dimensions ? `dimensions: ${r.dimensions}` : undefined, r.closure_type ? `closure_type: ${r.closure_type}` : undefined, r.lead_time_days ? `lead_time_days: ${r.lead_time_days}` : undefined, r.tags ? `tags: ${r.tags}` : undefined]
      .filter(Boolean)
      .join(" | ") || undefined,
    active: true,
    updatedAt: nowIso(),
  };
  await upsertRecords("packaging_components", [record as never]);
  return { outcome: existing ? "updated" : "created", targetCollection: "packaging_components", targetRecordId: record.code };
};

const commitPackagingBom: Handler = async (r) => {
  const existing = await findByCode<PackagingBom>("packaging_boms", "skuCode", r.packaging_sku_code);
  const lines = [...(existing?.lines ?? []).filter((l) => l.componentCode !== r.component_code), { componentCode: r.component_code, quantityPerUnit: r.component_quantity, notes: nn(r.notes) }];
  const record: PackagingBom = {
    schemaVersion: "1.0",
    code: existing?.code ?? newId("pkgbom"),
    skuCode: r.packaging_sku_code,
    description: nn(r.packaging_sku_name) ?? existing?.description,
    lines,
    fillQuantity: nn(r.fill_volume) ?? existing?.fillQuantity ?? "0",
    fillUnit: (nn(r.fill_volume) ? "ml" : existing?.fillUnit) ?? "ml",
    fillLossPercent: existing?.fillLossPercent ?? "0",
    notes: nn(r.notes) ?? existing?.notes,
    updatedAt: nowIso(),
  };
  await upsertRecords("packaging_boms", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "packaging_boms", targetRecordId: record.code };
};

// =============================================== formulation/costing (9-12) ===

const commitFormulaBom: Handler = async (r, ctx) => {
  const formulations = await listFormulations();
  let formulation = formulations.find((f) => f.code === r.formula_code);
  if (!formulation) {
    formulation = newFormulation(r.formula_name || r.formula_code, r.product_family_code || "UNASSIGNED", { code: r.formula_code });
    formulation = await saveFormulation(formulation);
  }
  const { versions } = await readFormulation(formulation.id);
  const nextNumber = versions.length === 0 ? 1 : Math.max(...versions.map((v) => v.versionNumber)) + 1;
  const requested = r.formula_version ? Number.parseInt(r.formula_version, 10) : undefined;
  if (requested !== undefined && versions.some((v) => v.versionNumber === requested)) {
    throw new Error(`Formula "${r.formula_code}" version ${requested} already exists and is immutable. Leave formula_version blank to append version ${nextNumber} instead.`);
  }
  // All rows for this (formula_code, formula_version) were grouped by the
  // caller before this handler runs (see GROUPED_TEMPLATES) — `record`
  // here already carries the full set of lines under `__lines`.
  const linesJson = (r as unknown as { __lines: FormulaBomLine[] }).__lines;
  const lines = linesJson.map((l) => ({
    id: newId("line"),
    lineNumber: l.lineNumber,
    phase: l.phase || "A",
    materialCode: l.materialCode,
    displayName: l.materialCode,
    percent: l.percent || "0",
    isQsToHundred: l.isQs,
    functions: [],
    provenance: { origin: "chemist_override" as const, evidenceClaimIds: [] },
    notes: l.notes,
  }));
  const version = newVersion(formulation.id, lines, {
    versionNumber: requested ?? nextNumber,
    changeReason: `Imported via Data Exchange by ${ctx.actorUserId} (${ctx.actorRole}).`,
  });
  await saveFormulationVersion(version);
  return { outcome: "created", targetCollection: "formulations", targetRecordId: `${formulation.code}#v${version.versionNumber}` };
};

const commitProcessParameters: Handler = async (r) => {
  const code = `${r.formula_code}-v${r.formula_version}-step${r.step_number}`;
  const existing = await findByCode<ProcessParameter>("process_parameters", "code", code);
  const record: ProcessParameter = {
    schemaVersion: "1.0",
    code,
    formulaCode: r.formula_code,
    formulaVersion: Number.parseInt(r.formula_version, 10),
    stepNumber: Number.parseInt(r.step_number, 10),
    stepName: nn(r.step_name),
    phase: nn(r.phase),
    equipmentType: nn(r.equipment_type),
    temperatureMin: nn(r.temperature_min),
    temperatureTarget: nn(r.temperature_target),
    temperatureMax: nn(r.temperature_max),
    mixingSpeedMin: nn(r.mixing_speed_min),
    mixingSpeedTarget: nn(r.mixing_speed_target),
    mixingSpeedMax: nn(r.mixing_speed_max),
    mixingTimeMinutes: nn(r.mixing_time_minutes),
    additionRate: nn(r.addition_rate),
    holdTimeMinutes: nn(r.hold_time_minutes),
    criticalParameter: bool(r.critical_parameter),
    instruction: nn(r.instruction),
    notes: nn(r.notes),
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("process_parameters", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "process_parameters", targetRecordId: record.code };
};

const commitCostingAssumptions: Handler = async (r) => {
  const code = r.costing_profile_code;
  const existing = await findByCode<Record<string, unknown>>("factory_profiles", "code", code);
  const unmapped = [
    r.freight_percent ? `freight_percent: ${r.freight_percent}` : undefined,
    r.duty_percent ? `duty_percent: ${r.duty_percent}` : undefined,
    r.tax_percent ? `tax_percent: ${r.tax_percent}` : undefined,
    r.target_margin_percent ? `target_margin_percent: ${r.target_margin_percent}` : undefined,
  ]
    .filter(Boolean)
    .join(" | ");
  const record = {
    schemaVersion: "1.0" as const,
    code,
    name: `Imported costing profile ${code}`,
    currency: nn(r.currency) ?? "KES",
    electricityPerKwh: nn(r.energy_cost_per_kwh),
    waterPerM3: nn(r.water_cost_per_m3),
    steamPerKg: nn(r.steam_cost_per_kg),
    directLabourPerHour: nn(r.labor_cost_per_hour),
    processLossPercent: nn(r.manufacturing_loss_percent) ?? "0",
    wasteDisposalPerBatch: nn(r.waste_cost_per_kg),
    overheadPercent: nn(r.overhead_percent),
    effectiveFrom: r.effective_date,
    verification: "not_verified" as const,
    notes: [nn(r.notes), unmapped || undefined, "Imported via Data Exchange — freight/duty/tax/target-margin percentages are kept as notes; this profile schema does not have dedicated fields for them yet."].filter(Boolean).join(" | "),
    active: true,
    updatedAt: nowIso(),
  };
  await upsertRecords("factory_profiles", [record as never]);
  return { outcome: existing ? "updated" : "created", targetCollection: "factory_profiles", targetRecordId: code };
};

const commitFormulaCostOverrides: Handler = async (r) => {
  const record: FormulaCostOverride = {
    schemaVersion: "1.0",
    code: newId("costoverride"),
    formulaCode: r.formula_code,
    formulaVersion: Number.parseInt(r.formula_version, 10),
    materialCode: r.material_code,
    supplierCode: nn(r.supplier_code),
    overridePrice: r.override_price,
    currency: r.currency,
    priceUnit: nn(r.price_unit) ?? "kg",
    effectiveFrom: r.effective_from,
    effectiveUntil: nn(r.effective_until),
    reason: nn(r.reason),
    // approved_by text is a note only — never grants approval. See module doc.
    approvedByNote: nn(r.approved_by),
    approved: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("formula_cost_overrides", [record]);
  return { outcome: "created", targetCollection: "formula_cost_overrides", targetRecordId: record.code };
};

// ====================================================== laboratory (13-14) ===

const TEST_RESULT_TYPES = ["numeric", "text", "boolean", "pass_fail", "categorical", "visual_rating"] as const;

const commitTestDefinitions: Handler = async (r) => {
  const existing = await findByCode<Record<string, unknown>>("test_definitions", "code", r.test_code);
  const record = {
    schemaVersion: "1.0" as const,
    code: r.test_code,
    name: r.test_name,
    category: nn(r.test_category) ?? "general",
    description: [nn(r.decimal_places) ? `decimal_places: ${r.decimal_places}` : undefined, r.tags ? `tags: ${r.tags}` : undefined, nn(r.notes)].filter(Boolean).join(" | ") || undefined,
    methodReference: nn(r.method_reference),
    resultType: (TEST_RESULT_TYPES.includes(r.result_type as (typeof TEST_RESULT_TYPES)[number]) ? r.result_type : "numeric") as (typeof TEST_RESULT_TYPES)[number],
    unit: nn(r.unit),
    targetValue: nn(r.target_value),
    minimum: nn(r.lower_limit),
    maximum: nn(r.upper_limit),
    replicatesRequired: r.replicate_count ? Number.parseInt(r.replicate_count, 10) : 1,
    requiredEquipment: [] as string[],
    requiredAttachment: false,
    applicableProductFamilies: [] as string[],
    applicableProductSkus: [] as string[],
    requiredByDefault: bool(r.required_for_release),
    criticalTestFlag: bool(r.destructive_test),
    // Never "verified" from an import — see module doc.
    verificationStatus: "imported_unverified" as const,
    active: bool(r.active, true),
    createdAt: (existing?.createdAt as string) ?? nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("test_definitions", [record as never]);
  return { outcome: existing ? "updated" : "created", targetCollection: "test_definitions", targetRecordId: record.code };
};

const commitLabResults: Handler = async (r) => {
  const trial = await findByCode<{ id: string }>("laboratory_trials", "code", r.trial_code);
  if (!trial) throw new Error(`No laboratory trial with code "${r.trial_code}" exists yet — create it in the Laboratory workspace first.`);
  const testDef = await findByCode<{ id: string; resultType: string }>("test_definitions", "code", r.test_code);
  if (!testDef) throw new Error(`No test definition with code "${r.test_code}" exists yet — import or create it first.`);

  const replicates = (r as unknown as { __lines: { replicateNumber: number; numericValue?: string; textValue?: string }[] }).__lines;
  const record = {
    schemaVersion: "1.0" as const,
    id: newId("testresult"),
    trialId: trial.id,
    testDefinitionId: testDef.id,
    sampleId: nn(r.sample_code),
    resultType: (TEST_RESULT_TYPES.includes(testDef.resultType as (typeof TEST_RESULT_TYPES)[number]) ? testDef.resultType : "numeric") as (typeof TEST_RESULT_TYPES)[number],
    replicates: replicates.map((rep) => ({
      replicateNumber: rep.replicateNumber,
      numericValue: rep.numericValue,
      textValue: rep.textValue,
      isOutlier: false,
    })),
    passFail: "not_evaluated" as const,
    unit: nn(r.unit),
    notes: nn(r.notes),
    attachments: [] as unknown[],
    performedBy: nn(r.analyst) ?? "data-exchange-import",
    performedAt: nn(r.result_date) ?? nowIso(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("test_results", [record as never]);
  return { outcome: "created", targetCollection: "test_results", targetRecordId: record.id };
};

// ===================================================== regulatory (17-19) ===

const commitRegulatoryRules: Handler = async (r) => {
  const existing = await findByCode<Record<string, unknown>>("regulatory_rules", "code", r.rule_code);
  // No catch-all "other" exists in this enum — an unrecognized rule_type is
  // reported rather than silently mis-filed under a wrong category.
  if (r.rule_type && !REGULATORY_RULE_TYPES.includes(r.rule_type as (typeof REGULATORY_RULE_TYPES)[number])) {
    throw new Error(`"${r.rule_type}" is not a recognized rule_type. Expected one of: ${REGULATORY_RULE_TYPES.join(", ")}.`);
  }
  const record = {
    schemaVersion: "1.0" as const,
    id: (existing?.id as string) ?? newId("rule"),
    code: r.rule_code,
    name: r.rule_code,
    jurisdiction: r.jurisdiction,
    authority: nn(r.authority) ?? "Imported — authority not yet confirmed",
    ruleType: (nn(r.rule_type) ?? "document_requirement") as (typeof REGULATORY_RULE_TYPES)[number],
    productCategories: [] as string[],
    requirement: r.requirement,
    severity: (nn(r.severity) as "info" | "warning" | "blocking") ?? "warning",
    status: "draft" as const,
    conditions: (existing?.conditions as unknown[]) ?? [],
    claimKeywordsAny: multi(r.claim_keyword),
    requiredEvidenceTypes: [] as string[],
    requiredLabelElements: multi(r.required_label_element),
    requiredWarnings: multi(r.required_warning),
    requiredDocumentTypes: multi(r.required_document_type),
    requiredTestTypes: [] as string[],
    requiredPackagingElements: [] as string[],
    requiredLanguages: [] as string[],
    requiresRegistration: false,
    requiresNotification: false,
    requiresResponsiblePartyInMarket: false,
    requiresMarketSpecificIdentifier: false,
    version: existing ? ((existing.version as number) ?? 1) + 1 : 1,
    effectiveDate: nn(r.effective_date),
    expiryDate: nn(r.expiry_date),
    sourceReference: nn(r.source_reference),
    // Never taken from the file — an import always resets verification.
    verificationStatus: "not_verified" as const,
    humanReviewStatus: "review_required" as const,
    active: true,
    createdBy: "data-exchange-import",
    createdAt: (existing?.createdAt as string) ?? nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("regulatory_rules", [record as never]);
  return { outcome: existing ? "updated" : "created", targetCollection: "regulatory_rules", targetRecordId: record.code };
};

const commitDossierRequirements: Handler = async (r) => {
  const dossier = await findByCode<{ id: string; revision: number }>("regulatory_dossiers", "dossierCode", r.dossier_code);
  if (!dossier) throw new Error(`No dossier with code "${r.dossier_code}" exists yet — create it in the Dossiers workspace first.`);
  const record = {
    schemaVersion: "1.0" as const,
    id: newId("dossierreq"),
    dossierId: dossier.id,
    dossierRevision: dossier.revision,
    jurisdiction: r.jurisdiction,
    requirementCode: r.requirement_code,
    requirementType: nn(r.requirement_type) ?? "other",
    title: r.title,
    description: nn(r.description),
    sourceReference: nn(r.source_rule_code),
    isManual: true,
    mandatory: bool(r.mandatory),
    critical: bool(r.critical),
    applicabilityStatus: (nn(r.applicability_status) as "applicable" | "not_applicable" | "excluded") ?? "applicable",
    applicabilityReason: "Set via Data Exchange import.",
    evidenceRequirement: true,
    documentTypesAccepted: [] as string[],
    minimumEvidenceCount: r.minimum_evidence_count ? Number.parseInt(r.minimum_evidence_count, 10) : 1,
    expiryPolicy: nn(r.expiry_policy),
    createdAt: nowIso(),
  };
  await upsertRecords("regulatory_dossier_requirements", [record as never]);
  return { outcome: "created", targetCollection: "regulatory_dossier_requirements", targetRecordId: record.id };
};

const commitDossierEvidence: Handler = async (r) => {
  const dossier = await findByCode<{ id: string; formulationId: string; formulaVersionId: string }>("regulatory_dossiers", "dossierCode", r.dossier_code);
  if (!dossier) throw new Error(`No dossier with code "${r.dossier_code}" exists yet — create it in the Dossiers workspace first.`);
  const record = {
    schemaVersion: "1.0" as const,
    id: newId("evidence"),
    dossierId: dossier.id,
    formulationId: dossier.formulationId,
    formulaVersionId: dossier.formulaVersionId,
    jurisdictions: ["KE"] as string[],
    evidenceType: nn(r.evidence_type) ?? "other",
    documentType: nn(r.document_type),
    title: r.title,
    description: nn(r.notes),
    // Always draft/present_unverified from an import — see module doc.
    status: "draft" as const,
    sourceType: "uploaded" as const,
    attachmentIds: [] as unknown[],
    documentNumber: nn(r.document_number),
    issuer: nn(r.issuer),
    issuedAt: nn(r.issue_date),
    expiresAt: nn(r.expiry_date),
    language: nn(r.language),
    confidentiality: "normal" as const,
    createdBy: "data-exchange-import",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("regulatory_evidence_items", [record as never]);
  return { outcome: "created", targetCollection: "regulatory_evidence_items", targetRecordId: record.id };
};

// =================================================== claims / labels (20-22) ===

const commitProductClaims: Handler = async (r) => {
  const formulations = await listFormulations();
  const formulation = formulations.find((f) => f.code === r.project_code);
  if (!formulation) throw new Error(`No project/formulation with code "${r.project_code}" exists yet.`);
  const { versions } = await readFormulation(formulation.id);
  const version = r.formula_version ? versions.find((v) => v.versionNumber === Number.parseInt(r.formula_version, 10)) : versions[versions.length - 1];
  if (!version) throw new Error(`Formula "${r.project_code}" has no saved version ${r.formula_version || ""}.`);
  const record = {
    schemaVersion: "1.0" as const,
    id: newId("claim"),
    claimCode: r.claim_code,
    claimText: r.claim_text,
    normalizedClaim: r.claim_text.trim().toLowerCase().replace(/\s+/g, " "),
    claimCategory: (CLAIM_CATEGORIES.includes(r.claim_category as (typeof CLAIM_CATEGORIES)[number]) ? r.claim_category : "other") as (typeof CLAIM_CATEGORIES)[number],
    formulationId: formulation.id,
    formulaVersionId: version.id,
    packagingSkuCode: nn(r.packaging_sku_code),
    jurisdictions: multi(r.jurisdictions).length ? multi(r.jurisdictions) : ["KE"],
    languages: multi(r.languages).length ? multi(r.languages) : ["en"],
    // Always draft from an import — see module doc.
    status: "draft" as const,
    riskLevel: (nn(r.risk_level) as "low" | "medium" | "high") ?? "unknown",
    proposedBy: "data-exchange-import",
    proposedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("product_claims", [record as never]);
  return { outcome: "created", targetCollection: "product_claims", targetRecordId: record.claimCode };
};

const commitLabelContent: Handler = async (r) => {
  const label = await findByCode<{ id: string }>("product_labels", "labelCode", r.label_code);
  if (!label) throw new Error(`No label with code "${r.label_code}" exists yet — create it in the Claims & Labels workspace first.`);
  const record = {
    schemaVersion: "1.0" as const,
    id: newId("labelblock"),
    labelId: label.id,
    labelRevision: Number.parseInt(r.label_revision, 10) || 1,
    blockType: nn(r.block_type) ?? "other",
    text: r.content_text,
    language: r.language,
    position: 0,
    mandatory: bool(r.mandatory),
    source: "imported" as const,
    translationStatus: "draft" as const,
    status: "draft" as const,
    createdBy: "data-exchange-import",
    createdAt: nowIso(),
  };
  await upsertRecords("label_content_blocks", [record as never]);
  return { outcome: "created", targetCollection: "label_content_blocks", targetRecordId: record.id };
};

const commitArtworkRegister: Handler = async (r) => {
  const label = await findByCode<{ id: string }>("product_labels", "labelCode", r.label_code);
  if (!label) throw new Error(`No label with code "${r.label_code}" exists yet — create it in the Claims & Labels workspace first.`);
  const existing = await findByCode<{ id: string }>("label_artworks", "artworkCode", r.artwork_code);
  if (existing) throw new Error(`Artwork "${r.artwork_code}" already exists — use supersedes_artwork_code with a new artwork_code to record a replacement.`);
  const record = {
    schemaVersion: "1.0" as const,
    id: newId("artwork"),
    labelId: label.id,
    labelRevision: Number.parseInt(r.label_revision || "1", 10),
    artworkCode: r.artwork_code,
    attachmentIds: [] as unknown[],
    format: nn(r.format),
    dimensions: r.width && r.height ? `${r.width}x${r.height}${r.dimension_unit ? ` ${r.dimension_unit}` : ""}` : undefined,
    colorMode: nn(r.color_mode),
    languageSet: multi(r.languages),
    createdBy: nn(r.created_by) ?? "data-exchange-import",
    createdAt: nn(r.created_at) ?? nowIso(),
    // Never "approved" from an import — see module doc.
    status: "draft" as const,
    supersedesArtworkId: undefined as string | undefined,
  };
  await upsertRecords("label_artworks", [record as never]);
  return { outcome: "created", targetCollection: "label_artworks", targetRecordId: record.artworkCode };
};

// ================================================================ DOE (23-24) ===

const commitDoeFactorsResponses: Handler = async (r) => {
  const study = await findByCode<{ id: string; revision: number }>("doe_studies", "studyCode", r.study_code);
  if (!study) throw new Error(`No DOE study with code "${r.study_code}" exists yet — create it in the Design of Experiments workspace first.`);
  if (r.record_type === "response") {
    const existing = await findByCode<{ id: string }>("doe_responses", "responseCode", r.factor_or_response_code);
    const record = {
      schemaVersion: "1.0" as const,
      id: existing?.id ?? newId("doeresp"),
      studyId: study.id,
      studyRevision: study.revision,
      responseCode: r.factor_or_response_code,
      name: r.name,
      responseType: (DOE_RESPONSE_TYPES.includes(r.name as never) ? r.name : "continuous") as (typeof DOE_RESPONSE_TYPES)[number],
      unit: nn(r.unit),
      objective: (DOE_RESPONSE_OBJECTIVES.includes(r.objective as never) ? r.objective : "observe_only") as (typeof DOE_RESPONSE_OBJECTIVES)[number],
      targetValue: nn(r.target_value),
      lowerLimit: nn(r.lower_limit),
      upperLimit: nn(r.upper_limit),
      weight: nn(r.weight) ?? "1",
      desirabilityShape: "linear" as const,
      createdAt: nowIso(),
    };
    await upsertRecords("doe_responses", [record as never]);
    return { outcome: existing ? "updated" : "created", targetCollection: "doe_responses", targetRecordId: record.responseCode };
  }
  const existing = await findByCode<{ id: string }>("doe_factors", "factorCode", r.factor_or_response_code);
  const record = {
    schemaVersion: "1.0" as const,
    id: existing?.id ?? newId("doefactor"),
    studyId: study.id,
    studyRevision: study.revision,
    factorCode: r.factor_or_response_code,
    name: r.name,
    factorType: (DOE_FACTOR_TYPES.includes(r.factor_type as never) ? r.factor_type : "continuous") as (typeof DOE_FACTOR_TYPES)[number],
    sourceType: (DOE_FACTOR_SOURCE_TYPES.includes(r.source_type as never) ? r.source_type : "custom") as (typeof DOE_FACTOR_SOURCE_TYPES)[number],
    unit: nn(r.unit),
    lowValue: nn(r.low_value),
    centerValue: nn(r.center_value),
    highValue: nn(r.high_value),
    categoricalLevels: multi(r.categorical_levels),
    transformation: "none" as const,
    precision: 2,
    isMixtureComponent: false,
    isProcessFactor: r.source_type === "process_parameter",
    isControlled: true,
    createdAt: nowIso(),
  };
  await upsertRecords("doe_factors", [record as never]);
  return { outcome: existing ? "updated" : "created", targetCollection: "doe_factors", targetRecordId: record.factorCode };
};

const commitDoeObservations: Handler = async (r) => {
  const study = await findByCode<{ id: string; revision: number }>("doe_studies", "studyCode", r.study_code);
  if (!study) throw new Error(`No DOE study with code "${r.study_code}" exists yet — create it in the Design of Experiments workspace first.`);
  const runs = (await listRecords("doe_runs")) as unknown as { id: string; studyId: string; runNumber: number }[];
  const run = runs.find((run_) => run_.studyId === study.id && run_.runNumber === Number.parseInt(r.run_number, 10));
  if (!run) throw new Error(`Run ${r.run_number} does not exist for study "${r.study_code}" — generate the design in the DOE workspace first.`);
  const responses = (await listRecords("doe_responses")) as unknown as { id: string; studyId: string; responseCode: string }[];
  const response = responses.find((res) => res.studyId === study.id && res.responseCode === r.response_code);
  if (!response) throw new Error(`Response "${r.response_code}" does not exist for study "${r.study_code}".`);

  const observations = (await listRecords("doe_observations")) as unknown as { id: string; runId: string; responseId: string }[];
  const existing = observations.find((o) => o.runId === run.id && o.responseId === response.id);
  const status = nn(r.numeric_value) || nn(r.text_value) ? "recorded" : "missing";
  const record = {
    schemaVersion: "1.0" as const,
    id: existing?.id ?? newId("doeobs"),
    studyId: study.id,
    studyRevision: study.revision,
    runId: run.id,
    responseId: response.id,
    value: nn(r.numeric_value),
    textValue: nn(r.text_value),
    // Import can only ever write recorded/missing — never excluded/outlier_confirmed.
    status: status as "recorded" | "missing",
    recordedBy: nn(r.analyst) ?? "data-exchange-import",
    recordedAt: nn(r.measured_at) ?? nowIso(),
  };
  await upsertRecords("doe_observations", [record as never]);
  return { outcome: existing ? "updated" : "created", targetCollection: "doe_observations", targetRecordId: record.id };
};

// =================================================== registry dispatch table ===

export const COMMIT_HANDLERS: Partial<Record<string, Handler>> = {
  raw_materials: commitRawMaterials,
  suppliers: commitSuppliers,
  material_prices: commitMaterialPrices,
  material_documents: commitMaterialDocuments,
  product_families: commitProductFamilies,
  finished_products: commitFinishedProducts,
  packaging_components: commitPackagingComponents,
  packaging_bom: commitPackagingBom,
  formula_bom: commitFormulaBom,
  process_parameters: commitProcessParameters,
  costing_assumptions: commitCostingAssumptions,
  formula_cost_overrides: commitFormulaCostOverrides,
  test_definitions: commitTestDefinitions,
  lab_results: commitLabResults,
  regulatory_rules: commitRegulatoryRules,
  dossier_requirements: commitDossierRequirements,
  dossier_evidence: commitDossierEvidence,
  product_claims: commitProductClaims,
  label_content: commitLabelContent,
  artwork_register: commitArtworkRegister,
  doe_factors_responses: commitDoeFactorsResponses,
  doe_observations: commitDoeObservations,
};

/** DOE_FACTOR_TYPES etc. re-exported so the UI can build the wizard-free
 *  quick-entry helper without importing the schema module directly. */
export { DOE_FACTOR_TYPES, DOE_FACTOR_SOURCE_TYPES, DOE_RESPONSE_TYPES, DOE_RESPONSE_OBJECTIVES };
