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
  type DoeFactor,
  type DoeObservation,
  type DoeResponse,
  type ExchangeRate,
  type FactoryCostProfile,
  type FinishedProduct,
  type FormulaCostOverride,
  type InventoryRecord,
  type LabelArtwork,
  type LabelContentBlock,
  type MasterProductFamily,
  type MaterialDocument,
  type MaterialPrice,
  type MaterialSupplier,
  type PackagingBom,
  type PackagingComponent,
  type PackagingComponentType,
  type ProcessParameter,
  type ProductClaim,
  type RawMaterial,
  type RegulatoryDossier,
  type RegulatoryDossierEvidenceItem,
  type RegulatoryDossierRequirement,
  type RegulatoryDossierReview,
  type RegulatoryDossierReviewRevocation,
  type RegulatoryDossierSubmission,
  type RegulatoryJurisdiction,
  type RegulatoryRequirementEvidenceLink,
  type RegulatoryRule,
  type StabilityResult,
  type StabilitySample,
  type StabilityStudy,
  type Supplier,
  type ReverseFormulationStudy,
  type BenchmarkProduct,
  type BenchmarkEvidenceItem,
  type IngredientDeclarationLine,
  type AnalyticalCompositionResult,
  type TargetProductProfile,
  type ReverseConstraintSet,
  type IngredientMapping,
  type SubstitutionRule,
  type ReverseFormulaCandidate,
  type CandidateScoreExplanation,
  assertStudyEditable,
  MATERIAL_FUNCTIONS,
  PACKAGING_COMPONENT_TYPES,
  SEED_STABILITY_CONDITIONS,
  SEED_STABILITY_TIME_POINTS,
  DOE_FACTOR_SOURCE_TYPES,
  DOE_FACTOR_TYPES,
  DOE_RESPONSE_OBJECTIVES,
  DOE_RESPONSE_TYPES,
  DOSSIER_APPLICABILITY_STATUSES,
  DOSSIER_EVIDENCE_TYPES,
  DOSSIER_REQUIREMENT_TYPES,
  LABEL_CONTENT_BLOCK_TYPES,
  REGULATORY_JURISDICTIONS,
  REGULATORY_RULE_TYPES,
  CLAIM_CATEGORIES,
} from "@formulab/shared";
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
/** Filters a multi_value jurisdiction list down to real
 *  `REGULATORY_JURISDICTIONS` members — an unrecognized code is dropped,
 *  never fabricated as a real jurisdiction. Returns `undefined` (not `[]`)
 *  when nothing recognized remains, so a caller can fall back to a real
 *  default instead of persisting an empty jurisdiction list. */
const validJurisdictions = (v: string | undefined): RegulatoryJurisdiction[] | undefined => {
  const found = multi(v).filter((code): code is RegulatoryJurisdiction => (REGULATORY_JURISDICTIONS as readonly string[]).includes(code));
  return found.length > 0 ? found : undefined;
};

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
  // One study's whole protocol (every condition/time-point/test combo the
  // file names for it) is resolved and written in one atomic group — if
  // any line names an unrecognized condition/time-point/test, the entire
  // group fails together rather than leaving the study with half a
  // protocol attached.
  stability_protocols: (r) => r.protocol_code,
  reverse_formula_candidates: (r) => r.candidate_code,
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
  stability_protocols: (rows) =>
    rows.map((row) => ({
      condition_code: row.record.condition_code,
      time_point: row.record.time_point,
      test_code: row.record.test_code,
    })),
  reverse_formula_candidates: (rows) =>
    rows.map((row) => ({
      materialCode: row.record.material_code,
      percentage: row.record.percentage,
      function: nn(row.record.line_function),
      notes: nn(row.record.notes),
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
    // FVL-04.001: real, canonical `MaterialFunction` values only —
    // `engine.py`'s candidate pool matches formula roles against this exact
    // field; an unrecognized token is dropped rather than let through as a
    // fabricated role (same "validate, never invent" convention
    // `physicalForm` below already uses). Refreshed on every import, like
    // every other mutable material field here — never merely preserved
    // from the prior record, so a corrected CSV can actually fix a role.
    functions: multi(r.material_function).filter((f): f is RawMaterial["functions"][number] =>
      (MATERIAL_FUNCTIONS as readonly string[]).includes(f),
    ),
    // FVL-04.001: `resolve_concentration()`'s own Tier 4 reads exactly
    // these three fields — genuinely required by the Phase 14 candidate
    // pool. Absent stays absent; `nn()` never substitutes a zero.
    recommendedMinPercent: nn(r.recommended_min_percent),
    recommendedMaxPercent: nn(r.recommended_max_percent),
    technicalMaxPercent: nn(r.technical_max_percent),
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

// FVL-04.011 hardening: pure material-supplier relationship, independent
// of MaterialPrice — the approved enterprise connector architecture
// (FVL-04.016) anticipates a source row producing this shape with no
// price at all. `code` is deterministic from (material_code,
// supplier_code) so a repeated import updates the same link.
const commitMaterialSuppliers: Handler = async (r) => {
  const code = `${r.material_code}::${r.supplier_code}`;
  const existing = await findByCode<MaterialSupplier>("material_suppliers", "code", code);
  const record: MaterialSupplier = {
    code,
    materialCode: r.material_code,
    supplierCode: r.supplier_code,
    supplierTradeName: nn(r.supplier_trade_name),
    supplierMaterialCode: nn(r.supplier_material_code),
    preferred: bool(r.preferred),
    // Never set true by import alone — a quality decision, same
    // convention as approved_supplier/approved elsewhere in this file.
    qualified: existing?.qualified ?? false,
    notes: nn(r.notes),
  };
  await upsertRecords("material_suppliers", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "material_suppliers", targetRecordId: record.code };
};

// FVL-04.007: imports facts only (quantity/reserved/quarantine/release/
// expiry) onto the real InventoryRecord shape — usable availability is
// always derived afterward by the canonical evaluateMaterialAvailability(),
// never computed here. inventory_code updates an existing lot's mutable
// fields in place, matching a physical count/status correction, not a new
// lot creation.
const commitInventoryRecords: Handler = async (r) => {
  const existing = await findByCode<InventoryRecord>("inventory", "code", r.inventory_code);
  const record: InventoryRecord = {
    schemaVersion: "1.0",
    code: r.inventory_code,
    materialCode: r.material_code,
    warehouse: nn(r.warehouse) ?? "main",
    lot: nn(r.lot),
    supplierLot: nn(r.supplier_lot),
    quantity: r.quantity,
    unit: nn(r.unit) ?? "kg",
    reservedQuantity: nn(r.reserved_quantity) ?? "0",
    manufacturedAt: nn(r.manufactured_at),
    expiresAt: nn(r.expires_at),
    coaStatus: (nn(r.coa_status) as InventoryRecord["coaStatus"]) ?? "pending",
    quarantined: bool(r.quarantined),
    released: bool(r.released),
    unitCost: nn(r.unit_cost),
    currency: nn(r.currency),
    notes: nn(r.notes),
    updatedAt: nowIso(),
  };
  await upsertRecords("inventory", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "inventory", targetRecordId: record.code };
};

// FVL-04.008: imports rate facts only. `findRate()` (engine/cost.ts) remains
// the sole selection/conversion authority — this handler performs no FX
// math and never derives a rate. entryMethod is honestly "imported" (it
// really was); verification is never taken from the file, same convention
// as every other verification-shaped column in this file.
const commitExchangeRates: Handler = async (r) => {
  const record: ExchangeRate = {
    schemaVersion: "1.0",
    code: newId("rate"),
    baseCurrency: r.base_currency,
    quoteCurrency: r.quote_currency,
    rate: r.rate,
    effectiveFrom: r.effective_from,
    source: r.source,
    entryMethod: "imported",
    verification: "not_verified",
    notes: nn(r.notes),
    recordedAt: nowIso(),
  };
  await upsertRecords("exchange_rates", [record]);
  return { outcome: "created", targetCollection: "exchange_rates", targetRecordId: record.code };
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
  const existing = await findByCode<PackagingComponent>("packaging_components", "code", r.component_code);
  // No fabricated component type — an unrecognized value falls back to the
  // schema's own real "other" member, never silently miscategorized as one
  // of the specific types.
  const componentType = (PACKAGING_COMPONENT_TYPES.includes(r.component_type as PackagingComponentType) ? r.component_type : "other") as PackagingComponentType;
  const record: PackagingComponent = {
    schemaVersion: "1.0",
    code: r.component_code,
    description: r.component_name,
    componentType,
    supplierCode: nn(r.supplier_code),
    unit: "piece",
    unitPrice: nn(r.unit_price),
    currency: nn(r.currency) ?? "KES",
    moq: nn(r.minimum_order_quantity),
    effectiveFrom: undefined,
    weightG: nn(r.weight),
    materialType: nn(r.material_type),
    wasteFactorPercent: "0",
    notes: [nn(r.notes), r.manufacturer_name ? `manufacturer_name: ${r.manufacturer_name}` : undefined, r.capacity ? `capacity: ${r.capacity} ${r.capacity_unit ?? ""}`.trim() : undefined, r.color ? `color: ${r.color}` : undefined, r.dimensions ? `dimensions: ${r.dimensions}` : undefined, r.closure_type ? `closure_type: ${r.closure_type}` : undefined, r.lead_time_days ? `lead_time_days: ${r.lead_time_days}` : undefined, r.tags ? `tags: ${r.tags}` : undefined]
      .filter(Boolean)
      .join(" | ") || undefined,
    active: true,
    updatedAt: nowIso(),
  };
  await upsertRecords("packaging_components", [record]);
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
    productFamilyCode: nn(r.product_family_code) ?? existing?.productFamilyCode,
    tags: multi(r.tags).length ? multi(r.tags) : (existing?.tags ?? []),
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
  const existing = await findByCode<FactoryCostProfile>("factory_profiles", "code", code);
  const record: FactoryCostProfile = {
    schemaVersion: "1.0",
    code,
    name: existing?.name ?? `Imported costing profile ${code}`,
    currency: nn(r.currency) ?? "KES",
    electricityPerKwh: nn(r.energy_cost_per_kwh),
    waterPerM3: nn(r.water_cost_per_m3),
    steamPerKg: nn(r.steam_cost_per_kg),
    directLabourPerHour: nn(r.labor_cost_per_hour),
    processLossPercent: nn(r.manufacturing_loss_percent) ?? "0",
    wasteDisposalPerBatch: nn(r.waste_cost_per_kg),
    overheadPercent: nn(r.overhead_percent),
    // Real structured costing inputs, not notes-text — see
    // factoryCostProfileSchema and `landedUnitCost`'s fallback use of
    // freight/duty/taxPercent, and `buildCostSnapshot`'s use of
    // targetMarginPercent for the (purely informational)
    // impliedTargetSellingPricePerKg.
    freightPercent: nn(r.freight_percent),
    dutyPercent: nn(r.duty_percent),
    taxPercent: nn(r.tax_percent),
    targetMarginPercent: nn(r.target_margin_percent),
    effectiveFrom: r.effective_date,
    verification: "not_verified",
    notes: nn(r.notes),
    active: true,
    updatedAt: nowIso(),
  };
  await upsertRecords("factory_profiles", [record]);
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
  const testDef = await findByCode<{ code: string; resultType: string }>("test_definitions", "code", r.test_code);
  if (!testDef) throw new Error(`No test definition with code "${r.test_code}" exists yet — import or create it first.`);

  const replicates = (r as unknown as { __lines: { replicateNumber: number; numericValue?: string; textValue?: string }[] }).__lines;
  const record = {
    schemaVersion: "1.0" as const,
    id: newId("testresult"),
    trialId: trial.id,
    // `test_definitions` records have no separate `id` field — their code
    // is their identity, matching `TrialsPanel.tsx`'s
    // `testDefinitionId: definition.code` for a human-recorded result.
    testDefinitionId: testDef.code,
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

// ====================================================== stability (15-16) ===
//
// Neither handler ever creates a `stability_studies` record, and neither
// ever fabricates a `formulaSnapshot`/`packagingSnapshot` — a study can
// only be created by a human through the real Stability workspace, which
// captures those frozen snapshots properly at the moment of creation. What
// these handlers DO safely support: attaching real protocol elements
// (existing seed storage conditions, existing seed time points, existing
// test definitions) to an ALREADY-CREATED study, and recording results
// against ALREADY-GENERATED pull-point samples. `assertStudyEditable`
// (shared engine — the exact same guard the Stability workspace itself
// calls) refuses any of this once a study is terminal, so a completed
// historical study's protocol can never be silently rewritten by import.

const STABILITY_CONDITION_CODES = SEED_STABILITY_CONDITIONS.map((c) => c.code).join(", ");
const STABILITY_TIME_POINT_CODES = SEED_STABILITY_TIME_POINTS.map((t) => t.code).join(", ");

const commitStabilityProtocols: Handler = async (r) => {
  const study = await findByCode<StabilityStudy>("stability_studies", "code", r.protocol_code);
  if (!study) throw new Error(`No stability study with code "${r.protocol_code}" exists yet — create it in the Stability workspace first.`);
  assertStudyEditable(study);
  if (r.packaging_sku_code && r.packaging_sku_code !== study.packagingSkuCode) {
    throw new Error(`packaging_sku_code "${r.packaging_sku_code}" does not match study "${r.protocol_code}"'s actual packaging SKU "${study.packagingSkuCode}".`);
  }

  const lines = (r as unknown as { __lines: { condition_code: string; time_point: string; test_code: string }[] }).__lines;
  const conditionIds = new Set(study.conditionIds ?? []);
  const timePointIds = new Set(study.timePointIds ?? []);
  const requiredTestDefinitionIds = new Set(study.requiredTestDefinitionIds ?? []);
  const before = conditionIds.size + timePointIds.size + requiredTestDefinitionIds.size;

  for (const line of lines) {
    const condition = SEED_STABILITY_CONDITIONS.find((c) => c.code === line.condition_code);
    if (!condition) throw new Error(`"${line.condition_code}" is not a recognized storage condition code. Expected one of: ${STABILITY_CONDITION_CODES}.`);
    const timePoint = SEED_STABILITY_TIME_POINTS.find((tp) => tp.code === line.time_point);
    if (!timePoint) throw new Error(`"${line.time_point}" is not a recognized time point code. Expected one of: ${STABILITY_TIME_POINT_CODES}.`);
    const testDef = await findByCode<{ code: string }>("test_definitions", "code", line.test_code);
    if (!testDef) throw new Error(`No test definition with code "${line.test_code}" exists yet — import or create it first.`);
    conditionIds.add(condition.id);
    timePointIds.add(timePoint.id);
    // `test_definitions` records carry no separate `id` field — their code
    // IS their identity, exactly as `stability_samples.testDefinitionIds`
    // and `StabilityStudy.testRequirementSnapshot` already store it. Using
    // a nonexistent `.id` here silently wrote `null` into the array (found
    // via live verification: re-importing the same file never converged to
    // "unchanged").
    requiredTestDefinitionIds.add(testDef.code);
  }

  const after = conditionIds.size + timePointIds.size + requiredTestDefinitionIds.size;
  const updated: StabilityStudy = {
    ...study,
    conditionIds: [...conditionIds],
    timePointIds: [...timePointIds],
    requiredTestDefinitionIds: [...requiredTestDefinitionIds],
    updatedAt: nowIso(),
  };
  await upsertRecords("stability_studies", [updated]);
  return { outcome: after > before ? "updated" : "unchanged", targetCollection: "stability_studies", targetRecordId: study.code };
};

const commitStabilityResults: Handler = async (r) => {
  const study = await findByCode<StabilityStudy>("stability_studies", "code", r.study_code);
  if (!study) throw new Error(`No stability study with code "${r.study_code}" exists yet — create it in the Stability workspace first.`);
  const samples = (await listRecords("stability_samples")) as unknown as StabilitySample[];
  const sample = samples.find((s) => s.studyId === study.id && s.sampleCode === r.sample_code);
  if (!sample) throw new Error(`No stability sample "${r.sample_code}" exists yet for study "${r.study_code}" — generate the pull-point samples in the Stability workspace first.`);
  const testDef = await findByCode<{ code: string; resultType: string }>("test_definitions", "code", r.test_code);
  if (!testDef) throw new Error(`No test definition with code "${r.test_code}" exists yet — import or create it first.`);
  // `test_definitions` records have no separate `id` — `sample.testDefinitionIds`
  // (copied from `study.requiredTestDefinitionIds` at sample-generation time,
  // see `generateStabilitySamples`) holds codes, same as `StabilityPanel.tsx`
  // writes `testDefinitionId: definition.code` for a human-recorded result.
  if (!sample.testDefinitionIds.includes(testDef.code)) {
    throw new Error(`Test "${r.test_code}" is not required for sample "${r.sample_code}" under study "${r.study_code}"'s protocol.`);
  }
  const sampleCondition = SEED_STABILITY_CONDITIONS.find((c) => c.id === sample.conditionId);
  if (r.condition_code && sampleCondition && r.condition_code !== sampleCondition.code) {
    throw new Error(`condition_code "${r.condition_code}" does not match sample "${r.sample_code}"'s actual condition "${sampleCondition.code}".`);
  }
  const sampleTimePoint = SEED_STABILITY_TIME_POINTS.find((tp) => tp.id === sample.timePointId);
  if (r.time_point && sampleTimePoint && r.time_point !== sampleTimePoint.code) {
    throw new Error(`time_point "${r.time_point}" does not match sample "${r.sample_code}"'s actual time point "${sampleTimePoint.code}".`);
  }

  if (!nn(r.numeric_value) && !nn(r.text_value)) {
    // A blank value for a not-yet-tested pull point stays missing — no
    // result record is written at all, since any stored row here would
    // misrepresent the sample as measured.
    return { outcome: "skipped", targetCollection: "stability_results", message: "No value provided — left missing, no record written." };
  }

  const existingResults = (await listRecords("stability_results")) as unknown as StabilityResult[];
  const priorResult = existingResults
    .filter((res) => res.sampleId === sample.id && res.testDefinitionId === testDef.code)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const record: StabilityResult = {
    schemaVersion: "1.0",
    id: newId("stabresult"),
    studyId: study.id,
    sampleId: sample.id,
    conditionId: sample.conditionId,
    timePointId: sample.timePointId,
    testDefinitionId: testDef.code,
    resultType: (TEST_RESULT_TYPES.includes(testDef.resultType as (typeof TEST_RESULT_TYPES)[number]) ? testDef.resultType : "numeric") as (typeof TEST_RESULT_TYPES)[number],
    replicates: nn(r.numeric_value) ? [{ replicateNumber: 1, numericValue: r.numeric_value, isOutlier: false }] : [],
    textValue: nn(r.text_value),
    passFail: "not_evaluated",
    unit: nn(r.unit),
    notes: [nn(r.observation), nn(r.notes)].filter(Boolean).join(" | ") || undefined,
    attachments: [],
    performedBy: nn(r.analyst) ?? "data-exchange-import",
    performedAt: nn(r.result_date) ?? nowIso(),
    // Append-only: a matching (sample, test) result is never overwritten —
    // this always creates a new revision, chaining `revisesResultId` to
    // whatever the most recent prior result for this sample/test was.
    revisesResultId: priorResult?.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("stability_results", [record]);
  return { outcome: priorResult ? "updated" : "created", targetCollection: "stability_results", targetRecordId: record.id };
};

// ===================================================== regulatory (17-19) ===

const commitRegulatoryRules: Handler = async (r) => {
  const existing = await findByCode<RegulatoryRule>("regulatory_rules", "code", r.rule_code);
  // No catch-all "other" exists in this enum — an unrecognized rule_type is
  // reported rather than silently mis-filed under a wrong category.
  if (r.rule_type && !REGULATORY_RULE_TYPES.includes(r.rule_type as (typeof REGULATORY_RULE_TYPES)[number])) {
    throw new Error(`"${r.rule_type}" is not a recognized rule_type. Expected one of: ${REGULATORY_RULE_TYPES.join(", ")}.`);
  }
  const record: RegulatoryRule = {
    schemaVersion: "1.0",
    id: existing?.id ?? newId("rule"),
    code: r.rule_code,
    name: r.rule_code,
    // Safe: the registry's `jurisdiction` column is `dataType: "enum"`
    // (REGULATORY_JURISDICTIONS) — previewDataExchangeImport already
    // refused any row with an unrecognized jurisdiction before this
    // handler ever runs.
    jurisdiction: r.jurisdiction as RegulatoryJurisdiction,
    authority: nn(r.authority) ?? "Imported — authority not yet confirmed",
    ruleType: (nn(r.rule_type) ?? "document_requirement") as (typeof REGULATORY_RULE_TYPES)[number],
    productCategories: [],
    requirement: r.requirement,
    severity: (nn(r.severity) as "info" | "warning" | "blocking") ?? "warning",
    status: "draft",
    conditions: existing?.conditions ?? [],
    claimKeywordsAny: multi(r.claim_keyword),
    requiredEvidenceTypes: [],
    requiredLabelElements: multi(r.required_label_element),
    requiredWarnings: multi(r.required_warning),
    requiredDocumentTypes: multi(r.required_document_type),
    requiredTestTypes: [],
    requiredPackagingElements: [],
    requiredLanguages: [],
    requiresRegistration: false,
    requiresNotification: false,
    requiresResponsiblePartyInMarket: false,
    requiresMarketSpecificIdentifier: false,
    version: existing ? (existing.version ?? 1) + 1 : 1,
    effectiveDate: nn(r.effective_date),
    expiryDate: nn(r.expiry_date),
    sourceReference: nn(r.source_reference),
    // Never taken from the file — an import always resets verification.
    verificationStatus: "not_verified",
    humanReviewStatus: "review_required",
    active: true,
    createdBy: "data-exchange-import",
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("regulatory_rules", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "regulatory_rules", targetRecordId: record.code };
};

const commitDossierRequirements: Handler = async (r) => {
  const dossier = await findByCode<{ id: string; revision: number }>("regulatory_dossiers", "dossierCode", r.dossier_code);
  if (!dossier) throw new Error(`No dossier with code "${r.dossier_code}" exists yet — create it in the Dossiers workspace first.`);
  const record: RegulatoryDossierRequirement = {
    schemaVersion: "1.0",
    id: newId("dossierreq"),
    dossierId: dossier.id,
    dossierRevision: dossier.revision,
    // Safe: both columns are registry `enum` types
    // (REGULATORY_JURISDICTIONS / DOSSIER_REQUIREMENT_TYPES) — an
    // unrecognized value never reaches this handler; see
    // `commitRegulatoryRules` above.
    jurisdiction: r.jurisdiction as RegulatoryJurisdiction,
    requirementCode: r.requirement_code,
    requirementType: (nn(r.requirement_type) ?? "other") as (typeof DOSSIER_REQUIREMENT_TYPES)[number],
    title: r.title,
    description: nn(r.description),
    sourceReference: nn(r.source_rule_code),
    isManual: true,
    mandatory: bool(r.mandatory),
    critical: bool(r.critical),
    // Safe: registry `enum` type (DOSSIER_APPLICABILITY_STATUSES).
    applicabilityStatus: (nn(r.applicability_status) as (typeof DOSSIER_APPLICABILITY_STATUSES)[number]) ?? "applicable",
    applicabilityReason: "Set via Data Exchange import.",
    evidenceRequirement: true,
    documentTypesAccepted: [],
    minimumEvidenceCount: r.minimum_evidence_count ? Number.parseInt(r.minimum_evidence_count, 10) : 1,
    // An imported requirement is always active — "excluded" is only ever
    // reachable through a human's authorized manual-exclusion action, the
    // same rule this field's own schema doc states.
    status: "active",
    expiryPolicy: nn(r.expiry_policy),
    createdAt: nowIso(),
  };
  await upsertRecords("regulatory_dossier_requirements", [record]);
  return { outcome: "created", targetCollection: "regulatory_dossier_requirements", targetRecordId: record.id };
};

const commitDossierEvidence: Handler = async (r) => {
  const dossier = await findByCode<{ id: string; formulationId: string; formulaVersionId: string }>("regulatory_dossiers", "dossierCode", r.dossier_code);
  if (!dossier) throw new Error(`No dossier with code "${r.dossier_code}" exists yet — create it in the Dossiers workspace first.`);
  const requirements = (await listRecords("regulatory_dossier_requirements")) as unknown as RegulatoryDossierRequirement[];
  const requirement = requirements.find((req) => req.dossierId === dossier.id && req.requirementCode === r.requirement_code);
  if (!requirement) throw new Error(`No requirement "${r.requirement_code}" exists on dossier "${r.dossier_code}" yet — import or create it first.`);

  const evidenceItems = (await listRecords("regulatory_evidence_items")) as unknown as RegulatoryDossierEvidenceItem[];
  const existing = evidenceItems.find((e) => e.dossierId === dossier.id && e.evidenceCode === r.evidence_code);
  const record: RegulatoryDossierEvidenceItem = {
    schemaVersion: "1.0",
    id: existing?.id ?? newId("evidence"),
    dossierId: dossier.id,
    evidenceCode: r.evidence_code,
    formulationId: dossier.formulationId,
    formulaVersionId: dossier.formulaVersionId,
    jurisdictions: ["KE"],
    // Safe: registry `enum` type (DOSSIER_EVIDENCE_TYPES).
    evidenceType: (nn(r.evidence_type) ?? "other") as (typeof DOSSIER_EVIDENCE_TYPES)[number],
    documentType: nn(r.document_type),
    title: r.title,
    description: nn(r.notes),
    // Always draft/present_unverified from an import — see module doc.
    status: "draft",
    sourceType: "uploaded",
    attachmentIds: existing?.attachmentIds ?? [],
    documentNumber: nn(r.document_number),
    issuer: nn(r.issuer),
    issuedAt: nn(r.issue_date),
    expiresAt: nn(r.expiry_date),
    language: nn(r.language),
    confidentiality: "normal",
    createdBy: existing?.createdBy ?? "data-exchange-import",
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("regulatory_evidence_items", [record]);

  // Suggest, never accept, the requirement link this row names. A
  // `linkStatus: "accepted"` link is the only kind `evaluateEvidenceEligibility`
  // ever counts toward satisfying a requirement, and creating one requires
  // a genuine human actor (`requireHumanActor`/`acceptEvidenceLink`) — an
  // import can never satisfy that gate. `linkStatus: "proposed"` with
  // `linkedBy: "data-exchange-import"` mirrors this schema's own
  // documented `linkedBy: "system"` convention for an automatic-discovery
  // suggestion (see `regulatoryRequirementEvidenceLinkSchema`): visible in
  // the Dossiers workspace, but a human must still review and accept it.
  if (!existing) {
    const links = (await listRecords("regulatory_requirement_evidence_links")) as unknown as RegulatoryRequirementEvidenceLink[];
    const alreadyLinked = links.some((l) => l.dossierId === dossier.id && l.requirementId === requirement.id && l.evidenceItemId === record.id && l.linkStatus !== "revoked");
    if (!alreadyLinked) {
      const link: RegulatoryRequirementEvidenceLink = {
        schemaVersion: "1.0",
        id: newId("dossierlink"),
        dossierId: dossier.id,
        requirementId: requirement.id,
        evidenceItemId: record.id,
        linkStatus: "proposed",
        linkedBy: "data-exchange-import",
        linkedAt: nowIso(),
      };
      await upsertRecords("regulatory_requirement_evidence_links", [link]);
    }
  }

  return { outcome: existing ? "updated" : "created", targetCollection: "regulatory_evidence_items", targetRecordId: record.id };
};

// ============================================ dossier expansion (30-35) ===
// Phase 8 final Data Exchange expansion. `dossier_reviews` and
// `dossier_manual_requirement_actions` have no handler here at all — see
// their `disabledReason` in dataExchangeRegistry.ts; `enabled: false`
// already refuses them at preview time, so no row from those templates
// can ever reach this file.

const commitDossierHeaders: Handler = async (r, ctx) => {
  const existing = await findByCode<{ id: string }>("regulatory_dossiers", "dossierCode", r.dossier_code);
  if (existing) throw new Error(`A dossier with code "${r.dossier_code}" already exists — dossiers are revised through the Dossiers workspace (a new revision), never overwritten by import.`);
  const formulations = await listFormulations();
  const formulation = formulations.find((f) => f.code === r.formula_code);
  if (!formulation) throw new Error(`No formula with code "${r.formula_code}" exists yet — create it first; import never fabricates a formulation.`);
  const { versions } = await readFormulation(formulation.id);
  const version = r.formula_version ? versions.find((v) => v.versionNumber === Number.parseInt(r.formula_version, 10)) : versions[versions.length - 1];
  if (!version) throw new Error(`Formula "${r.formula_code}" has no saved version ${r.formula_version || ""} — a dossier must bind to a real, saved formula version.`);
  const jurisdictions = validJurisdictions(r.jurisdictions);
  if (!jurisdictions) throw new Error(`"${r.jurisdictions}" contains no recognized jurisdiction — a dossier must name at least one.`);
  const record: RegulatoryDossier = {
    schemaVersion: "1.0",
    id: newId("dossier"),
    dossierCode: r.dossier_code,
    title: r.title || r.dossier_code,
    formulationId: formulation.id,
    formulaVersionId: version.id,
    packagingSkuCode: nn(r.packaging_sku_code),
    jurisdictions,
    productFamilyCode: nn(r.product_family_code) ?? formulation.productFamilyCode,
    targetMarkets: jurisdictions,
    // Always draft/revision 1 from an import — status/revision, and every
    // lifecycle field below them, only ever advance through a real human
    // action in the Dossiers workspace.
    status: "draft",
    revision: 1,
    createdBy: `data-exchange-import:${ctx.actorUserId}`,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("regulatory_dossiers", [record]);
  return { outcome: "created", targetCollection: "regulatory_dossiers", targetRecordId: record.id };
};

const commitDossierSubmissions: Handler = async (r, ctx) => {
  const dossier = await findByCode<{ id: string; revision: number }>("regulatory_dossiers", "dossierCode", r.dossier_code);
  if (!dossier) throw new Error(`No dossier with code "${r.dossier_code}" exists yet — create it in the Dossiers workspace first.`);
  const jurisdiction = (REGULATORY_JURISDICTIONS as readonly string[]).includes(r.jurisdiction) ? (r.jurisdiction as RegulatoryJurisdiction) : undefined;
  if (!jurisdiction) throw new Error(`"${r.jurisdiction}" is not a recognized jurisdiction.`);
  const record: RegulatoryDossierSubmission = {
    schemaVersion: "1.0",
    id: newId("dossiersubmission"),
    dossierId: dossier.id,
    dossierRevision: r.dossier_revision ? Number.parseInt(r.dossier_revision, 10) : dossier.revision,
    jurisdiction,
    submissionReference: nn(r.submission_reference),
    submittedBy: r.submitted_by || ctx.actorUserId,
    submittedAt: nn(r.submitted_at) ?? nowIso(),
    submissionChannel: nn(r.submission_channel),
    // Always "prepared" from an import — an authority's actual response is
    // never taken from a file; see module doc.
    status: "prepared",
    notes: nn(r.notes),
    attachmentIds: [],
    updatedAt: nowIso(),
  };
  await upsertRecords("regulatory_dossier_submissions", [record]);
  return { outcome: "created", targetCollection: "regulatory_dossier_submissions", targetRecordId: record.id };
};

const commitDossierEvidenceLinks: Handler = async (r) => {
  const dossier = await findByCode<{ id: string }>("regulatory_dossiers", "dossierCode", r.dossier_code);
  if (!dossier) throw new Error(`No dossier with code "${r.dossier_code}" exists yet — create it in the Dossiers workspace first.`);
  const requirements = (await listRecords("regulatory_dossier_requirements")) as unknown as RegulatoryDossierRequirement[];
  const requirement = requirements.find((req) => req.dossierId === dossier.id && req.requirementCode === r.requirement_code);
  if (!requirement) throw new Error(`No requirement "${r.requirement_code}" exists on dossier "${r.dossier_code}" yet.`);
  const evidenceItems = (await listRecords("regulatory_evidence_items")) as unknown as RegulatoryDossierEvidenceItem[];
  const evidence = evidenceItems.find((e) => e.dossierId === dossier.id && e.evidenceCode === r.evidence_code);
  if (!evidence) throw new Error(`No evidence "${r.evidence_code}" exists on dossier "${r.dossier_code}" yet — import or create it first.`);
  const record: RegulatoryRequirementEvidenceLink = {
    schemaVersion: "1.0",
    id: newId("dossierlink"),
    dossierId: dossier.id,
    requirementId: requirement.id,
    evidenceItemId: evidence.id,
    // Always "proposed" from an import — accepting, rejecting, or
    // revoking a mapping is a human review action; see module doc.
    linkStatus: "proposed",
    linkedBy: r.linked_by || "data-exchange-import",
    linkedAt: nn(r.linked_at) ?? nowIso(),
    notes: nn(r.notes),
  };
  await upsertRecords("regulatory_requirement_evidence_links", [record]);
  return { outcome: "created", targetCollection: "regulatory_requirement_evidence_links", targetRecordId: record.id };
};

const commitDossierReviewRevocations: Handler = async (r, ctx) => {
  const dossier = await findByCode<{ id: string }>("regulatory_dossiers", "dossierCode", r.dossier_code);
  if (!dossier) throw new Error(`No dossier with code "${r.dossier_code}" exists yet.`);
  const reviews = (await listRecords("regulatory_dossier_reviews")) as unknown as RegulatoryDossierReview[];
  const review = reviews.find(
    (rv) => rv.dossierId === dossier.id && rv.dossierRevision === Number.parseInt(r.dossier_revision, 10) && rv.reviewedAt === r.reviewed_at,
  );
  if (!review) throw new Error(`No review found for dossier "${r.dossier_code}" revision ${r.dossier_revision} at ${r.reviewed_at} — a revocation must reference a real, existing review.`);
  const record: RegulatoryDossierReviewRevocation = {
    schemaVersion: "1.0",
    id: newId("dossierreviewrevoke"),
    revokesReviewId: review.id,
    revokedBy: r.revoked_by || ctx.actorUserId,
    revokedByRole: (nn(r.revoked_by_role) as ApprovalRole) ?? ctx.actorRole,
    revokedAt: nowIso(),
    reason: r.reason,
  };
  await upsertRecords("regulatory_dossier_review_revocations", [record]);
  return { outcome: "created", targetCollection: "regulatory_dossier_review_revocations", targetRecordId: record.id };
};

// =================================================== claims / labels (20-22) ===

const commitProductClaims: Handler = async (r) => {
  const formulations = await listFormulations();
  const formulation = formulations.find((f) => f.code === r.project_code);
  if (!formulation) throw new Error(`No project/formulation with code "${r.project_code}" exists yet.`);
  const { versions } = await readFormulation(formulation.id);
  const version = r.formula_version ? versions.find((v) => v.versionNumber === Number.parseInt(r.formula_version, 10)) : versions[versions.length - 1];
  if (!version) throw new Error(`Formula "${r.project_code}" has no saved version ${r.formula_version || ""}.`);
  const record: ProductClaim = {
    schemaVersion: "1.0",
    id: newId("claim"),
    claimCode: r.claim_code,
    claimText: r.claim_text,
    normalizedClaim: r.claim_text.trim().toLowerCase().replace(/\s+/g, " "),
    claimCategory: (CLAIM_CATEGORIES.includes(r.claim_category as (typeof CLAIM_CATEGORIES)[number]) ? r.claim_category : "other") as (typeof CLAIM_CATEGORIES)[number],
    formulationId: formulation.id,
    formulaVersionId: version.id,
    packagingSkuCode: nn(r.packaging_sku_code),
    // `jurisdictions` is a multi_value column, not an enum one (a
    // semicolon list can't be enum-validated column-wide) — an
    // unrecognized code is dropped here rather than fabricated as a real
    // jurisdiction; falls back to KE only if nothing recognized remains.
    jurisdictions: validJurisdictions(r.jurisdictions) ?? ["KE"],
    languages: multi(r.languages).length ? multi(r.languages) : ["en"],
    // Always draft from an import — see module doc.
    status: "draft",
    riskLevel: (nn(r.risk_level) as "low" | "medium" | "high") ?? "unknown",
    proposedBy: "data-exchange-import",
    proposedAt: nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("product_claims", [record]);
  return { outcome: "created", targetCollection: "product_claims", targetRecordId: record.claimCode };
};

const commitLabelContent: Handler = async (r) => {
  const label = await findByCode<{ id: string }>("product_labels", "labelCode", r.label_code);
  if (!label) throw new Error(`No label with code "${r.label_code}" exists yet — create it in the Claims & Labels workspace first.`);
  const record: LabelContentBlock = {
    schemaVersion: "1.0",
    id: newId("labelblock"),
    labelId: label.id,
    labelRevision: Number.parseInt(r.label_revision, 10) || 1,
    // Safe: registry `enum` type (LABEL_CONTENT_BLOCK_TYPES).
    blockType: (nn(r.block_type) ?? "other") as (typeof LABEL_CONTENT_BLOCK_TYPES)[number],
    panel: nn(r.panel),
    text: r.content_text,
    language: r.language,
    position: 0,
    mandatory: bool(r.mandatory),
    source: "imported",
    translationStatus: "draft",
    status: "draft",
    createdBy: "data-exchange-import",
    createdAt: nowIso(),
  };
  await upsertRecords("label_content_blocks", [record]);
  return { outcome: "created", targetCollection: "label_content_blocks", targetRecordId: record.id };
};

const commitArtworkRegister: Handler = async (r) => {
  const label = await findByCode<{ id: string }>("product_labels", "labelCode", r.label_code);
  if (!label) throw new Error(`No label with code "${r.label_code}" exists yet — create it in the Claims & Labels workspace first.`);
  const existing = await findByCode<{ id: string }>("label_artworks", "artworkCode", r.artwork_code);
  if (existing) throw new Error(`Artwork "${r.artwork_code}" already exists — use supersedes_artwork_code with a new artwork_code to record a replacement.`);
  const record: LabelArtwork = {
    schemaVersion: "1.0",
    id: newId("artwork"),
    labelId: label.id,
    labelRevision: Number.parseInt(r.label_revision || "1", 10),
    artworkCode: r.artwork_code,
    attachmentIds: [],
    format: nn(r.format),
    dimensions: r.width && r.height ? `${r.width}x${r.height}${r.dimension_unit ? ` ${r.dimension_unit}` : ""}` : undefined,
    colorMode: nn(r.color_mode),
    languageSet: multi(r.languages),
    createdBy: nn(r.created_by) ?? "data-exchange-import",
    createdAt: nn(r.created_at) ?? nowIso(),
    // Never "approved" from an import — see module doc.
    status: "draft",
    supersedesArtworkId: undefined,
  };
  await upsertRecords("label_artworks", [record]);
  return { outcome: "created", targetCollection: "label_artworks", targetRecordId: record.artworkCode };
};

// ================================================================ DOE (23-24) ===

const commitDoeFactorsResponses: Handler = async (r) => {
  const study = await findByCode<{ id: string; revision: number }>("doe_studies", "studyCode", r.study_code);
  if (!study) throw new Error(`No DOE study with code "${r.study_code}" exists yet — create it in the Design of Experiments workspace first.`);
  if (r.record_type === "response") {
    const existing = await findByCode<DoeResponse>("doe_responses", "responseCode", r.factor_or_response_code);
    // `.includes()` on a `readonly Tuple[number][]` requires the queried
    // value to already be that literal union — widening the array's own
    // type to `readonly string[]` for the membership check (rather than
    // casting the row's plain-string value) keeps this a real, sound
    // check with no `as never` anywhere.
    const responseType = ((DOE_RESPONSE_TYPES as readonly string[]).includes(r.name) ? r.name : "continuous") as (typeof DOE_RESPONSE_TYPES)[number];
    const objective = ((DOE_RESPONSE_OBJECTIVES as readonly string[]).includes(r.objective) ? r.objective : "observe_only") as (typeof DOE_RESPONSE_OBJECTIVES)[number];
    const record: DoeResponse = {
      schemaVersion: "1.0",
      id: existing?.id ?? newId("doeresp"),
      studyId: study.id,
      studyRevision: study.revision,
      responseCode: r.factor_or_response_code,
      name: r.name,
      responseType,
      unit: nn(r.unit),
      objective,
      targetValue: nn(r.target_value),
      lowerLimit: nn(r.lower_limit),
      upperLimit: nn(r.upper_limit),
      weight: nn(r.weight) ?? "1",
      desirabilityShape: "linear",
      createdAt: nowIso(),
    };
    await upsertRecords("doe_responses", [record]);
    return { outcome: existing ? "updated" : "created", targetCollection: "doe_responses", targetRecordId: record.responseCode };
  }
  const existing = await findByCode<DoeFactor>("doe_factors", "factorCode", r.factor_or_response_code);
  const factorType = ((DOE_FACTOR_TYPES as readonly string[]).includes(r.factor_type) ? r.factor_type : "continuous") as (typeof DOE_FACTOR_TYPES)[number];
  const sourceType = ((DOE_FACTOR_SOURCE_TYPES as readonly string[]).includes(r.source_type) ? r.source_type : "custom") as (typeof DOE_FACTOR_SOURCE_TYPES)[number];
  const record: DoeFactor = {
    schemaVersion: "1.0",
    id: existing?.id ?? newId("doefactor"),
    studyId: study.id,
    studyRevision: study.revision,
    factorCode: r.factor_or_response_code,
    name: r.name,
    factorType,
    sourceType,
    unit: nn(r.unit),
    lowValue: nn(r.low_value),
    centerValue: nn(r.center_value),
    highValue: nn(r.high_value),
    categoricalLevels: multi(r.categorical_levels),
    transformation: "none",
    precision: 2,
    isMixtureComponent: false,
    isProcessFactor: r.source_type === "process_parameter",
    isControlled: true,
    createdAt: nowIso(),
  };
  await upsertRecords("doe_factors", [record]);
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

  const observations = (await listRecords("doe_observations")) as unknown as DoeObservation[];
  const existing = observations.find((o) => o.runId === run.id && o.responseId === response.id);
  const status: "recorded" | "missing" = nn(r.numeric_value) || nn(r.text_value) ? "recorded" : "missing";
  const record: DoeObservation = {
    schemaVersion: "1.0",
    id: existing?.id ?? newId("doeobs"),
    studyId: study.id,
    studyRevision: study.revision,
    runId: run.id,
    responseId: response.id,
    value: nn(r.numeric_value),
    textValue: nn(r.text_value),
    // Import can only ever write recorded/missing — never excluded/outlier_confirmed.
    status,
    recordedBy: nn(r.analyst) ?? "data-exchange-import",
    recordedAt: nn(r.measured_at) ?? nowIso(),
  };
  await upsertRecords("doe_observations", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "doe_observations", targetRecordId: record.id };
};

// ============================================= reverse formulation (25-35) ===
//
// These 11 collections are real members of `./masterdata`'s `Collection`
// union (added in Phase 7 Session 6, closing the Session 4/5 known gap), so
// every handler below calls `listRecords`/`upsertRecords`/`findByCode`
// directly — the local `ReverseFormulationCollection` bridge type and its
// `rfList`/`rfUpsert`/`rfFindByCode` wrappers are gone.

const commitReverseFormulationStudies: Handler = async (r) => {
  const existing = await findByCode<ReverseFormulationStudy>("reverse_formulation_studies", "code", r.study_code);
  const record: ReverseFormulationStudy = {
    id: existing?.id ?? newId("rfstudy"),
    code: r.study_code,
    name: r.study_name,
    description: nn(r.description),
    projectId: r.project_code,
    productFamilyCode: r.product_family_code,
    // Every import starts (or leaves) a study at draft — workflow
    // progression happens only in the Reverse Formulation workspace.
    status: existing?.status ?? "draft",
    benchmarkProductIds: existing?.benchmarkProductIds ?? [],
    targetProfileId: existing?.targetProfileId,
    constraintSetId: existing?.constraintSetId,
    selectedCandidateId: existing?.selectedCandidateId,
    createdAt: existing?.createdAt ?? nowIso(),
    createdBy: existing?.createdBy ?? "data-exchange-import",
    updatedAt: nowIso(),
    revision: existing ? existing.revision + 1 : 0,
  };
  await upsertRecords("reverse_formulation_studies", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "reverse_formulation_studies", targetRecordId: record.code };
};

const commitBenchmarkProducts: Handler = async (r) => {
  const existing = await findByCode<BenchmarkProduct>("benchmark_products", "code", r.product_code);
  const record: BenchmarkProduct = {
    id: existing?.id ?? newId("bmprod"),
    code: r.product_code,
    name: r.product_name,
    brand: nn(r.brand),
    manufacturer: nn(r.manufacturer_name),
    country: nn(r.country),
    market: nn(r.market),
    productCategory: nn(r.product_category),
    productSubcategory: nn(r.product_subcategory),
    packagingType: nn(r.packaging_type),
    declaredNetContent: nn(r.declared_net_content) ? Number(r.declared_net_content) : undefined,
    purchaseDate: nn(r.purchase_date),
    batchCode: nn(r.batch_code),
    manufacturingDate: nn(r.manufacturing_date),
    expiryDate: nn(r.expiry_date),
    price: nn(r.price) ? Number(r.price) : undefined,
    currency: nn(r.currency),
    source: nn(r.source),
    notes: nn(r.notes),
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("benchmark_products", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "benchmark_products", targetRecordId: record.code };
};

const commitBenchmarkEvidenceItems: Handler = async (r) => {
  const product = await findByCode<BenchmarkProduct>("benchmark_products", "code", r.product_code);
  if (!product) throw new Error(`No benchmark product with code "${r.product_code}" exists yet — import or create it first.`);
  const existingItems = await listRecords("benchmark_evidence_items");
  const existing = existingItems.find(
    (e) => e.benchmarkProductId === product.id && e.evidenceType === r.evidence_type && e.sourceName === r.source_name,
  );
  const record: BenchmarkEvidenceItem = {
    id: existing?.id ?? newId("bmevid"),
    benchmarkProductId: product.id,
    evidenceType: r.evidence_type as BenchmarkEvidenceItem["evidenceType"],
    sourceName: r.source_name,
    sourceReference: nn(r.source_reference),
    fileName: nn(r.file_name),
    sha256: nn(r.evidence_sha256),
    capturedAt: nn(r.captured_at) ?? nowIso(),
    capturedBy: nn(r.captured_by) ?? "data-exchange-import",
    confidence: nn(r.confidence) ? Number(r.confidence) : undefined,
    notes: nn(r.notes),
  };
  await upsertRecords("benchmark_evidence_items", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "benchmark_evidence_items", targetRecordId: record.id };
};

const commitIngredientDeclarationLines: Handler = async (r) => {
  const product = await findByCode<BenchmarkProduct>("benchmark_products", "code", r.product_code);
  if (!product) throw new Error(`No benchmark product with code "${r.product_code}" exists yet — import or create it first.`);
  const order = Number.parseInt(r.declared_order, 10);
  const existingLines = await listRecords("ingredient_declaration_lines");
  const existing = existingLines.find((l) => l.benchmarkProductId === product.id && l.declaredOrder === order);
  const record: IngredientDeclarationLine = {
    id: existing?.id ?? newId("declline"),
    benchmarkProductId: product.id,
    rawText: nn(r.raw_text) ?? r.declared_name,
    normalizedText: r.declared_name.trim().toLowerCase(),
    declaredOrder: order,
    declaredName: r.declared_name,
    INCI: nn(r.inci_name),
    CAS: nn(r.cas_number),
    functionHint: nn(r.function_hint),
    concentrationHint: nn(r.concentration_hint),
    regulatoryNotes: nn(r.regulatory_notes),
    // Every imported line starts unmapped — mapping is a separate,
    // deliberate step, never fabricated from this file.
    mappingStatus: existing?.mappingStatus ?? "unmapped",
    mappedMaterialIds: existing?.mappedMaterialIds ?? [],
    confidence: existing?.confidence,
    notes: nn(r.notes),
  };
  await upsertRecords("ingredient_declaration_lines", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "ingredient_declaration_lines", targetRecordId: record.id };
};

const commitAnalyticalCompositionResults: Handler = async (r) => {
  const product = await findByCode<BenchmarkProduct>("benchmark_products", "code", r.product_code);
  if (!product) throw new Error(`No benchmark product with code "${r.product_code}" exists yet — import or create it first.`);
  const record: AnalyticalCompositionResult = {
    id: newId("analresult"),
    benchmarkProductId: product.id,
    analysisType: r.analysis_type,
    analyte: r.analyte,
    // Preserved as the exact decimal string the validator already
    // normalized — never coerced through a floating-point round trip.
    value: r.value,
    unit: r.unit,
    method: nn(r.method),
    detectionLimit: nn(r.detection_limit) ? Number(r.detection_limit) : undefined,
    uncertainty: nn(r.uncertainty) ? Number(r.uncertainty) : undefined,
    laboratory: nn(r.laboratory),
    sampleCode: nn(r.sample_code),
    testDate: nn(r.test_date),
    sourceEvidenceId: undefined,
    // Never "verified" from an import — see module doc.
    verificationStatus: "unverified",
    notes: nn(r.notes),
  };
  // Append-only: every import row is a new measurement, never an
  // in-place edit of a previously recorded reading.
  await upsertRecords("analytical_composition_results", [record]);
  return { outcome: "created", targetCollection: "analytical_composition_results", targetRecordId: record.id };
};

const commitTargetProductProfiles: Handler = async (r) => {
  const existing = await findByCode<TargetProductProfile>("target_product_profiles", "code", r.profile_code);
  const record: TargetProductProfile = {
    id: existing?.id ?? newId("tpp"),
    code: r.profile_code,
    name: r.profile_name,
    productFamilyCode: r.product_family_code,
    form: nn(r.form),
    appearance: nn(r.appearance),
    color: nn(r.color),
    odor: nn(r.odor),
    pHMin: nn(r.ph_min) ? Number(r.ph_min) : undefined,
    pHMax: nn(r.ph_max) ? Number(r.ph_max) : undefined,
    viscosityMin: nn(r.viscosity_min) ? Number(r.viscosity_min) : undefined,
    viscosityMax: nn(r.viscosity_max) ? Number(r.viscosity_max) : undefined,
    densityMin: nn(r.density_min) ? Number(r.density_min) : undefined,
    densityMax: nn(r.density_max) ? Number(r.density_max) : undefined,
    activeMatterMin: nn(r.active_matter_min) ? Number(r.active_matter_min) : undefined,
    activeMatterMax: nn(r.active_matter_max) ? Number(r.active_matter_max) : undefined,
    performanceTargets: existing?.performanceTargets,
    sensoryTargets: existing?.sensoryTargets,
    costTargetPerKg: nn(r.cost_target_per_kg) ? Number(r.cost_target_per_kg) : undefined,
    currency: nn(r.currency),
    packagingConstraints: nn(r.packaging_constraints),
    market: nn(r.market),
    jurisdictions: multi(r.jurisdictions),
    claimsTargets: existing?.claimsTargets,
    excludedClaims: existing?.excludedClaims,
    notes: nn(r.notes),
  };
  await upsertRecords("target_product_profiles", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "target_product_profiles", targetRecordId: record.code };
};

const commitReverseConstraintSets: Handler = async (r) => {
  const study = await findByCode<ReverseFormulationStudy>("reverse_formulation_studies", "code", r.study_code);
  if (!study) throw new Error(`No Reverse Formulation study with code "${r.study_code}" exists yet — import or create it first.`);
  const existing = await findByCode<ReverseConstraintSet>("reverse_constraint_sets", "code", r.constraint_set_code);
  const record: ReverseConstraintSet = {
    id: existing?.id ?? newId("rconstraint"),
    code: r.constraint_set_code,
    name: r.constraint_set_name,
    studyId: study.id,
    requiredMaterials: multi(r.required_materials),
    preferredMaterials: multi(r.preferred_materials),
    excludedMaterials: multi(r.excluded_materials),
    requiredFunctions: multi(r.required_functions),
    minimumPercentages: existing?.minimumPercentages ?? {},
    maximumPercentages: existing?.maximumPercentages ?? {},
    totalActiveMatterRange:
      nn(r.total_active_matter_min) && nn(r.total_active_matter_max)
        ? [Number(r.total_active_matter_min), Number(r.total_active_matter_max)]
        : existing?.totalActiveMatterRange,
    pHRange: nn(r.ph_min) && nn(r.ph_max) ? [Number(r.ph_min), Number(r.ph_max)] : existing?.pHRange,
    viscosityRange: existing?.viscosityRange,
    densityRange: existing?.densityRange,
    costRange: nn(r.cost_min) && nn(r.cost_max) ? [Number(r.cost_min), Number(r.cost_max)] : existing?.costRange,
    regulatoryRestrictions: existing?.regulatoryRestrictions,
    allergenRestrictions: existing?.allergenRestrictions,
    sustainabilityRequirements: existing?.sustainabilityRequirements,
    supplierRestrictions: existing?.supplierRestrictions,
    countryOfOriginRestrictions: existing?.countryOfOriginRestrictions,
    notes: nn(r.notes),
  };
  await upsertRecords("reverse_constraint_sets", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "reverse_constraint_sets", targetRecordId: record.code };
};

const commitIngredientMappings: Handler = async (r) => {
  const study = await findByCode<ReverseFormulationStudy>("reverse_formulation_studies", "code", r.study_code);
  if (!study) throw new Error(`No Reverse Formulation study with code "${r.study_code}" exists yet — import or create it first.`);
  const product = await findByCode<BenchmarkProduct>("benchmark_products", "code", r.product_code);
  if (!product) throw new Error(`No benchmark product with code "${r.product_code}" exists yet — import or create it first.`);
  const order = Number.parseInt(r.declared_order, 10);
  const lines = await listRecords("ingredient_declaration_lines");
  const line = lines.find((l) => l.benchmarkProductId === product.id && l.declaredOrder === order);
  if (!line) throw new Error(`No declaration line at position ${order} exists yet for product "${r.product_code}" — import it first.`);
  const material = await findByCode<RawMaterial>("materials", "code", r.candidate_material_code);
  if (!material) throw new Error(`No material with code "${r.candidate_material_code}" exists yet.`);

  const existingMappings = await listRecords("ingredient_mappings");
  const existing = existingMappings.find((m) => m.declarationLineId === line.id && m.candidateMaterialId === material.code);
  const record: IngredientMapping = {
    id: existing?.id ?? newId("imapping"),
    studyId: study.id,
    benchmarkProductId: product.id,
    declarationLineId: line.id,
    candidateMaterialId: material.code,
    mappingMethod: r.mapping_method as IngredientMapping["mappingMethod"],
    confidence: Number(r.confidence),
    evidence: nn(r.evidence),
    assumptions: nn(r.assumptions),
    // Every imported mapping starts as proposed — confirm/reject require
    // the mapping review workflow.
    status: existing?.status ?? "proposed",
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
  await upsertRecords("ingredient_mappings", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "ingredient_mappings", targetRecordId: record.id };
};

const commitSubstitutionRules: Handler = async (r) => {
  const source = await findByCode<RawMaterial>("materials", "code", r.source_material_code);
  if (!source) throw new Error(`No material with code "${r.source_material_code}" exists yet.`);
  const target = await findByCode<RawMaterial>("materials", "code", r.target_material_code);
  if (!target) throw new Error(`No material with code "${r.target_material_code}" exists yet.`);

  const existingRules = await listRecords("substitution_rules");
  const familyKey = nn(r.product_family_code);
  const existing = existingRules.find(
    (rule) => rule.sourceMaterialId === source.code && rule.targetMaterialId === target.code && (rule.productFamilyCode ?? undefined) === familyKey,
  );
  const record: SubstitutionRule = {
    id: existing?.id ?? newId("subrule"),
    sourceMaterialId: source.code,
    targetMaterialId: target.code,
    productFamilyCode: familyKey,
    function: nn(r.function),
    substitutionRatioMin: nn(r.substitution_ratio_min) ? Number(r.substitution_ratio_min) : undefined,
    substitutionRatioMax: nn(r.substitution_ratio_max) ? Number(r.substitution_ratio_max) : undefined,
    conditions: nn(r.conditions),
    limitations: nn(r.limitations),
    confidence: nn(r.confidence) ? Number(r.confidence) : undefined,
    evidence: nn(r.evidence),
    // Every imported rule starts as proposed — validation requires the
    // substitution review workflow.
    status: existing?.status ?? "proposed",
  };
  await upsertRecords("substitution_rules", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "substitution_rules", targetRecordId: record.id };
};

interface ReverseFormulaCandidateLine {
  materialCode: string;
  percentage: string;
  function?: string;
  notes?: string;
}

const commitReverseFormulaCandidates: Handler = async (r) => {
  const study = await findByCode<ReverseFormulationStudy>("reverse_formulation_studies", "code", r.study_code);
  if (!study) throw new Error(`No Reverse Formulation study with code "${r.study_code}" exists yet — import or create it first.`);

  // All rows for this candidate_code were grouped by the caller before this
  // handler runs (see GROUPED_TEMPLATES) — `r` here already carries every
  // line under `__lines`.
  const lines = (r as unknown as { __lines: ReverseFormulaCandidateLine[] }).__lines;
  for (const line of lines) {
    const material = await findByCode<RawMaterial>("materials", "code", line.materialCode);
    if (!material) throw new Error(`No material with code "${line.materialCode}" exists yet.`);
  }

  const existing = await findByCode<ReverseFormulaCandidate>("reverse_formula_candidates", "candidateCode", r.candidate_code);
  const record: ReverseFormulaCandidate = {
    id: existing?.id ?? newId("rfcand"),
    studyId: study.id,
    candidateCode: r.candidate_code,
    name: nn(r.candidate_name) ?? r.candidate_code,
    revision: existing ? existing.revision + 1 : 0,
    generationMethod: r.generation_method,
    // Every imported candidate starts as generated — validation/selection
    // require the candidate review workflow, never this file.
    status: existing?.status ?? "generated",
    formulaLines: lines.map((l) => ({
      materialId: l.materialCode,
      percentage: Number(l.percentage),
      function: l.function,
      notes: l.notes,
    })) as ReverseFormulaCandidate["formulaLines"],
    processSteps: existing?.processSteps,
    predictedProperties: existing?.predictedProperties,
    estimatedCost: existing?.estimatedCost,
    regulatoryAssessment: existing?.regulatoryAssessment,
    evidenceCoverage: existing?.evidenceCoverage,
    confidenceScore: existing?.confidenceScore,
    similarityScore: existing?.similarityScore,
    performanceScore: existing?.performanceScore,
    costScore: existing?.costScore,
    regulatoryScore: existing?.regulatoryScore,
    manufacturabilityScore: existing?.manufacturabilityScore,
    assumptions: existing?.assumptions,
    warnings: existing?.warnings,
    createdAt: existing?.createdAt ?? nowIso(),
    createdBy: existing?.createdBy ?? "data-exchange-import",
  };
  await upsertRecords("reverse_formula_candidates", [record]);
  return { outcome: existing ? "updated" : "created", targetCollection: "reverse_formula_candidates", targetRecordId: record.candidateCode };
};

const commitCandidateScoreExplanations: Handler = async (r) => {
  const candidate = await findByCode<ReverseFormulaCandidate>("reverse_formula_candidates", "candidateCode", r.candidate_code);
  if (!candidate) throw new Error(`No candidate with code "${r.candidate_code}" exists yet — import or create it first.`);
  const record: CandidateScoreExplanation = {
    id: newId("scoreexpl"),
    candidateId: candidate.id,
    scoreType: r.score_type as CandidateScoreExplanation["scoreType"],
    score: Number(r.score),
    weight: Number(r.weight),
    reason: r.reason,
    evidenceReferences: multi(r.evidence_references).length ? multi(r.evidence_references) : undefined,
    limitations: multi(r.limitations).length ? multi(r.limitations) : undefined,
  };
  // Append-only: every import row is a new score-explanation record, never
  // an in-place edit of a previously recorded rationale.
  await upsertRecords("candidate_score_explanations", [record]);
  return { outcome: "created", targetCollection: "candidate_score_explanations", targetRecordId: record.id };
};

// =================================================== registry dispatch table ===

export const COMMIT_HANDLERS: Partial<Record<string, Handler>> = {
  raw_materials: commitRawMaterials,
  suppliers: commitSuppliers,
  material_prices: commitMaterialPrices,
  material_documents: commitMaterialDocuments,
  material_suppliers: commitMaterialSuppliers,
  inventory_records: commitInventoryRecords,
  exchange_rates: commitExchangeRates,
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
  stability_protocols: commitStabilityProtocols,
  stability_results: commitStabilityResults,
  regulatory_rules: commitRegulatoryRules,
  dossier_requirements: commitDossierRequirements,
  dossier_evidence: commitDossierEvidence,
  dossier_headers: commitDossierHeaders,
  dossier_submissions: commitDossierSubmissions,
  dossier_evidence_links: commitDossierEvidenceLinks,
  dossier_review_revocations: commitDossierReviewRevocations,
  product_claims: commitProductClaims,
  label_content: commitLabelContent,
  artwork_register: commitArtworkRegister,
  doe_factors_responses: commitDoeFactorsResponses,
  doe_observations: commitDoeObservations,
  reverse_formulation_studies: commitReverseFormulationStudies,
  benchmark_products: commitBenchmarkProducts,
  benchmark_evidence_items: commitBenchmarkEvidenceItems,
  ingredient_declaration_lines: commitIngredientDeclarationLines,
  analytical_composition_results: commitAnalyticalCompositionResults,
  target_product_profiles: commitTargetProductProfiles,
  reverse_constraint_sets: commitReverseConstraintSets,
  ingredient_mappings: commitIngredientMappings,
  substitution_rules: commitSubstitutionRules,
  reverse_formula_candidates: commitReverseFormulaCandidates,
  candidate_score_explanations: commitCandidateScoreExplanations,
};

/** DOE_FACTOR_TYPES etc. re-exported so the UI can build the wizard-free
 *  quick-entry helper without importing the schema module directly. */
export { DOE_FACTOR_TYPES, DOE_FACTOR_SOURCE_TYPES, DOE_RESPONSE_TYPES, DOE_RESPONSE_OBJECTIVES };

/** Whether a real commit handler exists for this template at all — checked
 *  by the UI before ever offering "Commit import", so an unwired template
 *  gets an honest, distinct "unsupported" job status instead of a
 *  misleading "completed" with zero rows written. Every one of the 24
 *  Phase 6 templates has a real handler as of this closure pass; this stays
 *  exported for whatever future template ships registered before its
 *  handler does. */
export function isTemplateCommitSupported(templateCode: string): boolean {
  return templateCode in COMMIT_HANDLERS;
}
