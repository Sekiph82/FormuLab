/**
 * Data Exchange Center — the schema-driven template registry.
 *
 * One registry, one shared pipeline, 24 templates — not 24 unrelated
 * importers. Every template is a plain data object (columns, natural key,
 * duplicate/update policy, authorization, example rows); the CSV engine
 * (`dataExchangeCsv.ts`), the validation/preview engine
 * (`dataExchangeValidation.ts`) and the desktop-side Excel engine
 * (`apps/desktop/src/lib/dataExchangeXlsx.ts`) all walk this same
 * structure generically. Adding template #25 in a later phase means adding
 * a `DataExchangeTemplateDefinition`, not writing a new importer.
 *
 * `columns[].key` is also the literal CSV/Excel header — the 24 templates
 * below are specified with fixed, documented column names, so there is no
 * ambiguity to resolve via aliases the way the older single-table
 * `importer.ts` `FieldSpec` aliasing does.
 */
import type { ApprovalRole } from "../schemas/status";
import { DOE_FACTOR_SOURCE_TYPES, DOE_FACTOR_TYPES, DOE_RESPONSE_OBJECTIVES } from "../schemas/doe";
import { MATERIAL_DOCUMENT_TYPES } from "../schemas/dataExchange";
import { REGULATORY_JURISDICTIONS, REGULATORY_RULE_TYPES } from "../schemas/regulatory";
import { DOSSIER_APPLICABILITY_STATUSES, DOSSIER_EVIDENCE_TYPES, DOSSIER_REQUIREMENT_TYPES } from "../schemas/dossier";
import { CLAIM_CATEGORIES, LABEL_CONTENT_BLOCK_TYPES } from "../schemas/claimsLabels";

// ------------------------------------------------------------------ types ---

export type DataExchangeColumnDataType =
  | "string"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "datetime"
  | "currency"
  | "percentage"
  | "enum"
  | "multi_value"
  | "code_reference"
  | "file_name"
  | "sha256"
  | "url"
  | "json";

export interface DataExchangeColumnDefinition {
  key: string;
  header: string;
  description: string;
  dataType: DataExchangeColumnDataType;
  required: boolean;
  nullable: boolean;
  defaultValue?: string;
  enumValues?: readonly string[];
  /** For `code_reference` columns: which template's natural key this points at. */
  referenceTemplate?: string;
  referenceField?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  precision?: number;
  example?: string;
  sensitive?: boolean;
  importable: boolean;
  exportable: boolean;
}

export type DataExchangeDuplicatePolicy =
  | "create_only"
  | "create_or_update"
  | "append_history"
  | "new_revision"
  | "reject_conflict";

export interface DataExchangeTemplateDefinition {
  templateId: string;
  templateCode: string;
  title: string;
  description: string;
  module: string;
  schemaVersion: string;
  supportedFormats: readonly ("csv" | "xlsx")[];
  columns: DataExchangeColumnDefinition[];
  primaryKey: string;
  naturalKey: string[];
  duplicatePolicy: DataExchangeDuplicatePolicy;
  updatePolicy: string;
  /** Roles allowed to import this template. Checked against the acting
   *  human's selected role before anything is parsed. */
  authorization: readonly ApprovalRole[];
  exampleRows: Record<string, string>[];
  targetCollection: string;
  enabled: boolean;
  disabledReason?: string;
  createdAt: string;
  updatedAt: string;
}

function col(def: Partial<DataExchangeColumnDefinition> & { key: string; dataType: DataExchangeColumnDataType; description: string }): DataExchangeColumnDefinition {
  return {
    header: def.key,
    required: false,
    nullable: true,
    importable: true,
    exportable: true,
    ...def,
  };
}

const REQ = { required: true, nullable: false };
const SCHEMA_VERSION = "1.0";
const CREATED = "2026-07-25T00:00:00.000Z";

// ============================================================ Template 1 ===
// Raw Materials Master

const MATERIAL_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "material_code", dataType: "code_reference", description: "Stable internal material code — the natural key.", ...REQ, example: "TEST-MAT-001" }),
  col({ key: "material_name", dataType: "string", description: "Display name.", ...REQ, example: "TEST Decyl Glucoside" }),
  col({ key: "inci_name", dataType: "string", description: "INCI name." , example: "Decyl Glucoside"}),
  col({ key: "cas_number", dataType: "multi_value", description: "CAS number(s), semicolon-separated.", example: "68515-73-1" }),
  col({ key: "ec_number", dataType: "multi_value", description: "EC number(s), semicolon-separated." }),
  col({ key: "material_category", dataType: "string", description: "Broad category, e.g. Surfactant, Preservative." , example: "Surfactant"}),
  col({ key: "material_function", dataType: "multi_value", description: "Functional role(s), semicolon-separated.", example: "nonionic_surfactant" }),
  col({ key: "physical_form", dataType: "string", description: "Liquid, powder, paste, ...", example: "liquid" }),
  col({ key: "active_matter_percent", dataType: "percentage", description: "As-supplied active content.", example: "50.0" }),
  col({ key: "density", dataType: "decimal", description: "g/mL at 20°C.", example: "1.05" }),
  col({ key: "default_unit", dataType: "string", description: "Default quantity unit, e.g. kg.", defaultValue: "kg", example: "kg" }),
  col({ key: "currency", dataType: "enum", description: "Default price currency.", enumValues: ["KES", "USD", "EUR", "GBP", "TZS", "UGX"], example: "KES" }),
  col({ key: "default_price", dataType: "currency", description: "Reference price; historical pricing lives on the Material-Supplier Price List template.", example: "450.00" }),
  col({ key: "price_basis_quantity", dataType: "decimal", description: "Quantity the default_price is per (default 1).", example: "1" }),
  col({ key: "manufacturer_name", dataType: "string", example: "TEST Chemicals Ltd" , description: "Manufacturer name."}),
  col({ key: "manufacturer_code", dataType: "string", description: "Manufacturer's own code for this material." }),
  col({ key: "preferred_supplier_code", dataType: "code_reference", description: "Preferred supplier.", referenceTemplate: "suppliers", referenceField: "supplier_code" }),
  col({ key: "country_of_origin", dataType: "string", example: "KE", description: "ISO country of origin." }),
  col({ key: "manufacture_date", dataType: "date", description: "Reference batch manufacture date (metadata, not a lot record)." }),
  col({ key: "expiry_date", dataType: "date", description: "Reference batch expiry date (metadata, not a lot record)." }),
  col({ key: "shelf_life_months", dataType: "integer", example: "24", description: "Typical shelf life." }),
  col({ key: "minimum_order_quantity", dataType: "decimal", description: "MOQ in default_unit." }),
  col({ key: "lead_time_days", dataType: "integer", description: "Typical lead time." }),
  col({ key: "storage_condition", dataType: "string", example: "Store below 25C, away from light.", description: "Storage instructions." }),
  col({ key: "hazardous", dataType: "boolean", description: "GHS-hazardous flag.", defaultValue: "false" }),
  col({ key: "allergen", dataType: "boolean", description: "Contains a declarable allergen.", defaultValue: "false" }),
  col({ key: "vegan", dataType: "boolean", description: "Vegan-suitable.", defaultValue: "false" }),
  col({ key: "natural_origin_percent", dataType: "percentage", description: "ISO 16128 natural-origin index." }),
  col({ key: "renewable_carbon_percent", dataType: "percentage", description: "Renewable-carbon index." }),
  col({ key: "biodegradable", dataType: "boolean", description: "Readily biodegradable per OECD 301." }),
  col({ key: "regulatory_status", dataType: "string", description: "Free-text regulatory status summary; does not itself verify a regulatory rule." }),
  col({ key: "tags", dataType: "multi_value", description: "Semicolon-separated tags." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// ============================================================ Template 2 ===
// Suppliers Master

const SUPPLIER_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "supplier_code", dataType: "code_reference", description: "Stable internal supplier code — the natural key.", ...REQ, example: "TEST-SUP-001" }),
  col({ key: "supplier_name", dataType: "string", description: "Display name.", ...REQ, example: "TEST Ingredients Africa" }),
  col({ key: "legal_name", dataType: "string", description: "Registered legal name." }),
  col({ key: "contact_name", dataType: "string", description: "Primary contact." }),
  col({ key: "email", dataType: "string", description: "Contact email." }),
  col({ key: "phone", dataType: "string", description: "Contact phone." }),
  col({ key: "website", dataType: "url", description: "Supplier website." }),
  col({ key: "country", dataType: "string", example: "KE", description: "ISO country." }),
  col({ key: "city", dataType: "string", description: "City." }),
  col({ key: "address", dataType: "string", description: "Postal address." }),
  col({ key: "currency", dataType: "enum", description: "Quoting currency.", enumValues: ["KES", "USD", "EUR", "GBP", "TZS", "UGX"], defaultValue: "KES" }),
  col({ key: "payment_terms", dataType: "string", example: "Net 30", description: "Payment terms." }),
  col({ key: "lead_time_days", dataType: "integer", description: "Typical lead time." }),
  col({ key: "minimum_order_value", dataType: "currency", description: "MOQ expressed as a value." }),
  col({ key: "approved_supplier", dataType: "boolean", description: "Approved-supplier status is a quality decision; import never sets this true on its own — see docs/DATA_EXCHANGE_SECURITY.md.", defaultValue: "false" }),
  col({ key: "qualification_status", dataType: "enum", description: "Qualification status.", enumValues: ["approved", "conditional", "under_review", "suspended", "not_assessed"], defaultValue: "not_assessed" }),
  col({ key: "last_audit_date", dataType: "date", description: "Date of last audit." }),
  col({ key: "next_audit_date", dataType: "date", description: "Date of next scheduled audit." }),
  col({ key: "rating", dataType: "decimal", description: "0-5 supplier rating.", minimum: 0, maximum: 5 }),
  col({ key: "tags", dataType: "multi_value", description: "Semicolon-separated tags." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// ============================================================ Template 3 ===
// Material-Supplier Price List

const PRICE_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "material_code", dataType: "code_reference", description: "Material this price is for.", ...REQ, referenceTemplate: "raw_materials", referenceField: "material_code", example: "TEST-MAT-001" }),
  col({ key: "supplier_code", dataType: "code_reference", description: "Quoting supplier.", ...REQ, referenceTemplate: "suppliers", referenceField: "supplier_code", example: "TEST-SUP-001" }),
  col({ key: "supplier_material_code", dataType: "string", description: "Supplier's own code for the material." }),
  col({ key: "manufacturer_name", dataType: "string", description: "Manufacturer name." }),
  col({ key: "brand_name", dataType: "string", description: "Brand/trade name." }),
  col({ key: "currency", dataType: "enum", description: "Quote currency.", ...REQ, enumValues: ["KES", "USD", "EUR", "GBP", "TZS", "UGX"], example: "KES" }),
  col({ key: "unit_price", dataType: "currency", description: "Price per price_unit.", ...REQ, example: "450.00" }),
  col({ key: "price_unit", dataType: "string", description: "Unit the price is quoted per.", defaultValue: "kg", example: "kg" }),
  col({ key: "minimum_order_quantity", dataType: "decimal", description: "MOQ for this quote." }),
  col({ key: "pack_size", dataType: "string", description: "Supplier pack size, e.g. 25kg drum." }),
  col({ key: "valid_from", dataType: "date", description: "Validity start.", ...REQ, example: "2026-01-01" }),
  col({ key: "valid_until", dataType: "date", description: "Validity end, open-ended if blank." }),
  col({ key: "lead_time_days", dataType: "integer", description: "Lead time for this quote." }),
  col({ key: "incoterm", dataType: "string", example: "FOB", description: "Incoterm." }),
  col({ key: "country_of_origin", dataType: "string", description: "Country of origin for this quote." }),
  col({ key: "preferred", dataType: "boolean", description: "Preferred quote for this material.", defaultValue: "false" }),
  col({ key: "approved", dataType: "boolean", description: "Approved for use is a quality decision; never set true by import alone.", defaultValue: "false" }),
  col({ key: "certificate_available", dataType: "boolean", description: "A certificate of analysis type is available." }),
  col({ key: "coa_available", dataType: "boolean", description: "COA available." }),
  col({ key: "sds_available", dataType: "boolean", description: "SDS available." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// ============================================================ Template 4 ===
// Material Documents Register

const MATERIAL_DOCUMENT_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "material_code", dataType: "code_reference", description: "Material the document is for.", ...REQ, referenceTemplate: "raw_materials", referenceField: "material_code", example: "TEST-MAT-001" }),
  col({ key: "supplier_code", dataType: "code_reference", description: "Issuing/related supplier.", referenceTemplate: "suppliers", referenceField: "supplier_code", example: "TEST-SUP-001" }),
  col({ key: "document_type", dataType: "enum", description: "Document type.", ...REQ, enumValues: MATERIAL_DOCUMENT_TYPES, example: "SDS" }),
  col({ key: "document_number", dataType: "string", description: "Issuer's document number." }),
  col({ key: "document_title", dataType: "string", description: "Document title.", ...REQ, example: "TEST Safety Data Sheet v3" }),
  col({ key: "revision", dataType: "string", description: "Revision label." }),
  col({ key: "language", dataType: "string", example: "en", description: "Document language." }),
  col({ key: "issuer", dataType: "string", description: "Issuing organization." }),
  col({ key: "issue_date", dataType: "date", description: "Issue date." }),
  col({ key: "expiry_date", dataType: "date", description: "Expiry date, if applicable." }),
  col({ key: "file_name", dataType: "file_name", description: "Name of a locally-selected file to match against — importing metadata never attaches a file by itself." }),
  col({ key: "expected_sha256", dataType: "sha256", description: "Expected SHA-256 of the matched file, for integrity checking." }),
  col({ key: "verification_status", dataType: "enum", description: "Metadata only from a file — an import can never set this to \"verified\"; it is always recorded as unverified regardless of the file's content.", enumValues: ["unverified", "verified", "expired", "superseded"] }),
  col({ key: "tags", dataType: "multi_value", description: "Semicolon-separated tags." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// ============================================================ Template 5 ===
// Product Families

const PRODUCT_FAMILY_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "family_code", dataType: "code_reference", description: "Stable family code — natural key.", ...REQ, example: "TEST-FAM-001" }),
  col({ key: "family_name", dataType: "string", description: "Display name.", ...REQ, example: "TEST Hand Soaps" }),
  col({ key: "category", dataType: "string", example: "Personal Care", description: "Category." }),
  col({ key: "subcategory", dataType: "string", example: "Hand Wash", description: "Subcategory." }),
  col({ key: "default_unit", dataType: "string", defaultValue: "kg", description: "Default batch-size unit." }),
  col({ key: "default_batch_size", dataType: "decimal", example: "100", description: "Default batch size in default_unit." }),
  col({ key: "target_market", dataType: "string", example: "KE", description: "Primary target market." }),
  col({ key: "default_jurisdictions", dataType: "multi_value", example: "KE;EAC", description: "Default regulatory jurisdictions, semicolon-separated." }),
  col({ key: "default_packaging_type", dataType: "string", example: "bottle", description: "Default packaging type." }),
  col({ key: "active", dataType: "boolean", defaultValue: "true", description: "Active flag." }),
  col({ key: "tags", dataType: "multi_value", description: "Semicolon-separated tags." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// ============================================================ Template 6 ===
// Finished Products / SKU Master

const FINISHED_PRODUCT_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "sku_code", dataType: "code_reference", description: "Stable SKU code — natural key.", ...REQ, example: "TEST-SKU-001" }),
  col({ key: "sku_name", dataType: "string", description: "Display name.", ...REQ, example: "TEST Gentle Hand Soap 250ml" }),
  col({ key: "product_family_code", dataType: "code_reference", description: "Owning product family.", referenceTemplate: "product_families", referenceField: "family_code", example: "TEST-FAM-001" }),
  col({ key: "brand", dataType: "string", description: "Brand name." }),
  col({ key: "formula_code", dataType: "code_reference", description: "Formula this SKU is filled from.", referenceTemplate: "formula_bom", referenceField: "formula_code" }),
  col({ key: "formula_version", dataType: "integer", description: "Specific saved formula version, if pinned." }),
  col({ key: "packaging_sku_code", dataType: "code_reference", description: "Packaging BOM used.", referenceTemplate: "packaging_bom", referenceField: "packaging_sku_code" }),
  col({ key: "net_quantity", dataType: "decimal", example: "250", description: "Net fill quantity." }),
  col({ key: "quantity_unit", dataType: "string", example: "ml", description: "Unit for net_quantity." }),
  col({ key: "barcode", dataType: "string", description: "EAN/UPC barcode." }),
  col({ key: "target_markets", dataType: "multi_value", example: "KE", description: "Target markets, semicolon-separated." }),
  col({ key: "languages", dataType: "multi_value", example: "en;sw", description: "Label languages, semicolon-separated." }),
  col({ key: "status", dataType: "enum", enumValues: ["draft", "active", "discontinued"], defaultValue: "draft", description: "Lifecycle status." }),
  col({ key: "manufacture_site", dataType: "string", description: "Manufacturing site." }),
  col({ key: "shelf_life_months", dataType: "integer", description: "Shelf life." }),
  col({ key: "tags", dataType: "multi_value", description: "Semicolon-separated tags." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// ============================================================ Template 7 ===
// Packaging Components

const PACKAGING_COMPONENT_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "component_code", dataType: "code_reference", description: "Stable component code — natural key.", ...REQ, example: "TEST-PKG-001" }),
  col({ key: "component_name", dataType: "string", description: "Display name.", ...REQ, example: "TEST 250ml PET Bottle" }),
  col({ key: "component_type", dataType: "string", example: "bottle", description: "Component type.", ...REQ }),
  col({ key: "material_type", dataType: "string", example: "PET", description: "Packaging material." }),
  col({ key: "supplier_code", dataType: "code_reference", referenceTemplate: "suppliers", referenceField: "supplier_code", description: "Supplier." }),
  col({ key: "manufacturer_name", dataType: "string", description: "Manufacturer name." }),
  col({ key: "capacity", dataType: "decimal", example: "250", description: "Capacity." }),
  col({ key: "capacity_unit", dataType: "string", example: "ml", description: "Capacity unit." }),
  col({ key: "weight", dataType: "decimal", description: "Component weight." }),
  col({ key: "weight_unit", dataType: "string", example: "g", description: "Weight unit." }),
  col({ key: "color", dataType: "string", description: "Color." }),
  col({ key: "dimensions", dataType: "string", description: "Free-text dimensions." }),
  col({ key: "closure_type", dataType: "string", description: "Closure type." }),
  col({ key: "food_contact", dataType: "boolean", description: "Food-contact grade." }),
  col({ key: "recyclable", dataType: "boolean", description: "Recyclable." }),
  col({ key: "recycled_content_percent", dataType: "percentage", description: "Recycled content." }),
  col({ key: "unit_price", dataType: "currency", description: "Unit price." }),
  col({ key: "currency", dataType: "enum", enumValues: ["KES", "USD", "EUR", "GBP", "TZS", "UGX"], description: "Price currency." }),
  col({ key: "minimum_order_quantity", dataType: "decimal", description: "MOQ." }),
  col({ key: "lead_time_days", dataType: "integer", description: "Lead time." }),
  col({ key: "tags", dataType: "multi_value", description: "Semicolon-separated tags." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// ============================================================ Template 8 ===
// Packaging SKU / Packaging BOM — one row per (packaging_sku, component)

const PACKAGING_BOM_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "packaging_sku_code", dataType: "code_reference", description: "Packaging BOM code — several rows share one; the natural key together with component_code.", ...REQ, example: "TEST-PKGBOM-001" }),
  col({ key: "packaging_sku_name", dataType: "string", description: "Display name (only needs to appear on one row of the group).", example: "TEST 250ml Bottle Pack" }),
  col({ key: "product_family_code", dataType: "code_reference", referenceTemplate: "product_families", referenceField: "family_code", description: "Owning product family." }),
  col({ key: "component_code", dataType: "code_reference", description: "Component used in this line.", ...REQ, referenceTemplate: "packaging_components", referenceField: "component_code", example: "TEST-PKG-001" }),
  col({ key: "component_quantity", dataType: "decimal", description: "Quantity of this component per unit.", ...REQ, example: "1" }),
  col({ key: "quantity_unit", dataType: "string", defaultValue: "pieces", description: "Unit for component_quantity." }),
  col({ key: "primary_packaging", dataType: "boolean", description: "Primary packaging flag." }),
  col({ key: "secondary_packaging", dataType: "boolean", description: "Secondary packaging flag." }),
  col({ key: "tertiary_packaging", dataType: "boolean", description: "Tertiary packaging flag." }),
  col({ key: "fill_volume", dataType: "decimal", description: "Fill volume (header fact, first non-empty row wins)." }),
  col({ key: "fill_weight", dataType: "decimal", description: "Fill weight (header fact, first non-empty row wins)." }),
  col({ key: "line_code", dataType: "string", description: "Filling line code." }),
  col({ key: "unit_cost", dataType: "currency", description: "Unit cost." }),
  col({ key: "currency", dataType: "enum", enumValues: ["KES", "USD", "EUR", "GBP", "TZS", "UGX"], description: "Cost currency." }),
  col({ key: "effective_from", dataType: "date", description: "Validity start." }),
  col({ key: "effective_until", dataType: "date", description: "Validity end." }),
  col({ key: "tags", dataType: "multi_value", description: "Semicolon-separated tags." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// ============================================================ Template 9 ===
// Formula / BOM Import — one row per formula line, grouped by (formula_code, formula_version)

const FORMULA_BOM_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "formula_code", dataType: "code_reference", description: "Formula code — rows sharing (formula_code, formula_version) form one saved version.", ...REQ, example: "TEST-FORM-001" }),
  col({ key: "formula_name", dataType: "string", description: "Formula/product display name (header fact)." , example: "TEST Gentle Hand Soap"}),
  col({ key: "formula_version", dataType: "integer", description: "Target version number. If it already exists as a saved version, the import is refused — saved versions are immutable; leave blank to append the next version automatically.", example: "1" }),
  col({ key: "project_code", dataType: "string", description: "Originating project code, if any." }),
  col({ key: "product_family_code", dataType: "code_reference", referenceTemplate: "product_families", referenceField: "family_code", description: "Product family (header fact)." }),
  col({ key: "line_number", dataType: "integer", description: "Line number within the formula; must be unique per formula/version.", ...REQ, example: "1" }),
  col({ key: "material_code", dataType: "code_reference", description: "Material for this line.", ...REQ, referenceTemplate: "raw_materials", referenceField: "material_code", example: "TEST-MAT-001" }),
  col({ key: "quantity", dataType: "decimal", description: "As-supplied quantity at the batch basis." }),
  col({ key: "quantity_unit", dataType: "string", defaultValue: "kg", description: "Unit for quantity." }),
  col({ key: "percentage", dataType: "percentage", description: "As-supplied percent of the total formula.", ...REQ, example: "12.0" }),
  col({ key: "phase", dataType: "string", defaultValue: "A", description: "Manufacturing phase." }),
  col({ key: "addition_order", dataType: "integer", description: "Addition order within the phase." }),
  col({ key: "process_temperature", dataType: "decimal", description: "Process temperature for this addition." }),
  col({ key: "mixing_speed", dataType: "string", description: "Mixing speed for this addition." }),
  col({ key: "mixing_time", dataType: "string", description: "Mixing time for this addition." }),
  col({ key: "is_qs_material", dataType: "boolean", description: "True for the line that absorbs the remainder to 100% — its percentage is computed, not authored.", defaultValue: "false" }),
  col({ key: "function", dataType: "string", description: "Functional role of this line." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// =========================================================== Template 10 ===
// Process Parameters

const PROCESS_PARAMETER_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "formula_code", dataType: "code_reference", description: "Formula this process belongs to.", ...REQ, referenceTemplate: "formula_bom", referenceField: "formula_code", example: "TEST-FORM-001" }),
  col({ key: "formula_version", dataType: "integer", description: "Formula version this process belongs to.", ...REQ, example: "1" }),
  col({ key: "step_number", dataType: "integer", description: "Step order.", ...REQ, example: "1" }),
  col({ key: "step_name", dataType: "string", description: "Step name.", example: "Heat and mix phase A" }),
  col({ key: "phase", dataType: "string", description: "Manufacturing phase." }),
  col({ key: "equipment_type", dataType: "string", description: "Equipment used." }),
  col({ key: "temperature_min", dataType: "decimal", description: "Minimum acceptable temperature." }),
  col({ key: "temperature_target", dataType: "decimal", description: "Target temperature." }),
  col({ key: "temperature_max", dataType: "decimal", description: "Maximum acceptable temperature." }),
  col({ key: "mixing_speed_min", dataType: "decimal", description: "Minimum mixing speed." }),
  col({ key: "mixing_speed_target", dataType: "decimal", description: "Target mixing speed." }),
  col({ key: "mixing_speed_max", dataType: "decimal", description: "Maximum mixing speed." }),
  col({ key: "mixing_time_minutes", dataType: "decimal", description: "Mixing duration." }),
  col({ key: "addition_rate", dataType: "string", description: "Rate of addition, free text." }),
  col({ key: "hold_time_minutes", dataType: "decimal", description: "Hold time." }),
  col({ key: "critical_parameter", dataType: "boolean", description: "Flags a critical process parameter.", defaultValue: "false" }),
  col({ key: "instruction", dataType: "string", description: "Operator instruction text." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// =========================================================== Template 11 ===
// Costing Assumptions

const COSTING_ASSUMPTIONS_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "costing_profile_code", dataType: "code_reference", description: "Stable profile code — natural key.", ...REQ, example: "TEST-COST-001" }),
  col({ key: "currency", dataType: "enum", enumValues: ["KES", "USD", "EUR", "GBP", "TZS", "UGX"], description: "Profile currency.", ...REQ, example: "KES" }),
  col({ key: "effective_date", dataType: "date", description: "Effective date.", ...REQ, example: "2026-01-01" }),
  col({ key: "labor_cost_per_hour", dataType: "currency", description: "Direct labour cost per hour." }),
  col({ key: "energy_cost_per_kwh", dataType: "currency", description: "Electricity cost per kWh." }),
  col({ key: "water_cost_per_m3", dataType: "currency", description: "Water cost per m3." }),
  col({ key: "steam_cost_per_kg", dataType: "currency", description: "Steam cost per kg." }),
  col({ key: "waste_cost_per_kg", dataType: "currency", description: "Waste disposal cost per kg." }),
  col({ key: "overhead_percent", dataType: "percentage", description: "Overhead percent." }),
  col({ key: "manufacturing_loss_percent", dataType: "percentage", description: "Expected manufacturing loss." }),
  col({ key: "freight_percent", dataType: "percentage", description: "Freight allocation percent." }),
  col({ key: "duty_percent", dataType: "percentage", description: "Duty percent." }),
  col({ key: "tax_percent", dataType: "percentage", description: "Tax percent." }),
  col({ key: "target_margin_percent", dataType: "percentage", description: "Target margin." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// =========================================================== Template 12 ===
// Formula Cost Overrides

const FORMULA_COST_OVERRIDE_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "formula_code", dataType: "code_reference", description: "Formula this override applies to.", ...REQ, referenceTemplate: "formula_bom", referenceField: "formula_code", example: "TEST-FORM-001" }),
  col({ key: "formula_version", dataType: "integer", description: "Formula version.", ...REQ, example: "1" }),
  col({ key: "material_code", dataType: "code_reference", description: "Material being overridden.", ...REQ, referenceTemplate: "raw_materials", referenceField: "material_code", example: "TEST-MAT-001" }),
  col({ key: "supplier_code", dataType: "code_reference", referenceTemplate: "suppliers", referenceField: "supplier_code", description: "Supplier for the override price." }),
  col({ key: "override_price", dataType: "currency", description: "Override unit price.", ...REQ, example: "480.00" }),
  col({ key: "currency", dataType: "enum", enumValues: ["KES", "USD", "EUR", "GBP", "TZS", "UGX"], description: "Currency.", ...REQ }),
  col({ key: "price_unit", dataType: "string", defaultValue: "kg", description: "Unit the override price is per." }),
  col({ key: "effective_from", dataType: "date", description: "Validity start.", ...REQ, example: "2026-01-01" }),
  col({ key: "effective_until", dataType: "date", description: "Validity end." }),
  col({ key: "reason", dataType: "string", description: "Reason for the override." }),
  col({ key: "approved_by", dataType: "string", description: "Kept as a note only — text in this column never grants approval; a real approval requires the existing authorization workflow, separately, after import." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// =========================================================== Template 13 ===
// Laboratory Test Definitions

const TEST_DEFINITION_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "test_code", dataType: "code_reference", description: "Stable test code — natural key.", ...REQ, example: "TEST-TST-001" }),
  col({ key: "test_name", dataType: "string", description: "Display name.", ...REQ, example: "TEST pH Measurement" }),
  col({ key: "test_category", dataType: "string", description: "Category, e.g. physicochemical." }),
  col({ key: "method_reference", dataType: "string", description: "Method reference/standard." }),
  col({ key: "unit", dataType: "string", description: "Result unit." }),
  col({ key: "result_type", dataType: "enum", description: "Result type.", enumValues: ["numeric", "text", "pass_fail"], defaultValue: "numeric" }),
  col({ key: "lower_limit", dataType: "decimal", description: "Acceptable lower limit." }),
  col({ key: "target_value", dataType: "decimal", description: "Target value." }),
  col({ key: "upper_limit", dataType: "decimal", description: "Acceptable upper limit." }),
  col({ key: "decimal_places", dataType: "integer", description: "Display decimal places." }),
  col({ key: "replicate_count", dataType: "integer", description: "Required replicate count.", defaultValue: "1" }),
  col({ key: "destructive_test", dataType: "boolean", description: "Destructive test flag." }),
  col({ key: "required_for_release", dataType: "boolean", description: "Required for batch release.", defaultValue: "false" }),
  col({ key: "required_for_stability", dataType: "boolean", description: "Required for stability protocols.", defaultValue: "false" }),
  col({ key: "active", dataType: "boolean", defaultValue: "true", description: "Active flag." }),
  col({ key: "tags", dataType: "multi_value", description: "Semicolon-separated tags." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// =========================================================== Template 14 ===
// Laboratory Results — one row per (trial, sample, test, replicate)

const LAB_RESULT_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "project_code", dataType: "string", description: "Owning project/formulation code." }),
  col({ key: "formula_version", dataType: "integer", description: "Formula version tested." }),
  col({ key: "trial_code", dataType: "code_reference", description: "Laboratory trial this result belongs to.", ...REQ, example: "TEST-TRIAL-001" }),
  col({ key: "sample_code", dataType: "string", description: "Sample identifier.", ...REQ, example: "S1" }),
  col({ key: "test_code", dataType: "code_reference", description: "Test performed.", ...REQ, referenceTemplate: "test_definitions", referenceField: "test_code", example: "TEST-TST-001" }),
  col({ key: "replicate_number", dataType: "integer", description: "Replicate number.", ...REQ, defaultValue: "1", example: "1" }),
  col({ key: "numeric_value", dataType: "decimal", description: "Numeric result. Left blank the value is stored as missing, never as zero." }),
  col({ key: "text_value", dataType: "string", description: "Text/pass-fail result." }),
  col({ key: "unit", dataType: "string", description: "Result unit." }),
  col({ key: "result_date", dataType: "date", description: "Date measured." }),
  col({ key: "analyst", dataType: "string", description: "Analyst." }),
  col({ key: "instrument", dataType: "string", description: "Instrument used." }),
  col({ key: "status", dataType: "enum", description: "Import always writes an unreviewed result; formal review happens afterward in the Laboratory workspace.", enumValues: ["recorded", "missing", "invalid"], defaultValue: "recorded" }),
  col({ key: "deviation_code", dataType: "string", description: "Deviation reference, if any." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// =========================================================== Template 15 ===
// Stability Protocols — one row per (protocol, condition, time point, test)

const STABILITY_PROTOCOL_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "protocol_code", dataType: "code_reference", description: "Protocol code — natural key together with condition_code/time_point/test_code.", ...REQ, example: "TEST-PROT-001" }),
  col({ key: "protocol_name", dataType: "string", description: "Display name (header fact).", example: "TEST 6-Month Accelerated Stability" }),
  col({ key: "product_family_code", dataType: "code_reference", referenceTemplate: "product_families", referenceField: "family_code", description: "Product family (header fact)." }),
  col({ key: "packaging_sku_code", dataType: "code_reference", referenceTemplate: "packaging_bom", referenceField: "packaging_sku_code", description: "Packaging used (header fact)." }),
  col({ key: "condition_code", dataType: "string", description: "Storage condition code.", ...REQ, example: "40C-75RH" }),
  col({ key: "temperature", dataType: "decimal", description: "Condition temperature." }),
  col({ key: "humidity", dataType: "decimal", description: "Condition humidity." }),
  col({ key: "light_condition", dataType: "string", description: "Light exposure condition." }),
  col({ key: "orientation", dataType: "string", description: "Sample orientation." }),
  col({ key: "time_point", dataType: "string", description: "Time point label.", ...REQ, example: "M3" }),
  col({ key: "time_unit", dataType: "string", defaultValue: "months", description: "Unit for the time point." }),
  col({ key: "test_code", dataType: "code_reference", description: "Test required at this time point.", ...REQ, referenceTemplate: "test_definitions", referenceField: "test_code", example: "TEST-TST-001" }),
  col({ key: "sample_quantity", dataType: "integer", description: "Samples required." }),
  col({ key: "acceptance_criteria", dataType: "string", description: "Free-text acceptance criteria." }),
  col({ key: "active", dataType: "boolean", defaultValue: "true", description: "Active flag." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// =========================================================== Template 16 ===
// Stability Results

const STABILITY_RESULT_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "study_code", dataType: "code_reference", description: "Stability study code.", ...REQ, example: "TEST-STAB-001" }),
  col({ key: "sample_code", dataType: "string", description: "Sample identifier.", ...REQ, example: "S1" }),
  col({ key: "formula_version", dataType: "integer", description: "Formula version." }),
  col({ key: "packaging_sku_code", dataType: "code_reference", referenceTemplate: "packaging_bom", referenceField: "packaging_sku_code", description: "Packaging used." }),
  col({ key: "condition_code", dataType: "string", description: "Storage condition.", ...REQ, example: "40C-75RH" }),
  col({ key: "time_point", dataType: "string", description: "Time point.", ...REQ, example: "M3" }),
  col({ key: "test_code", dataType: "code_reference", description: "Test performed.", ...REQ, referenceTemplate: "test_definitions", referenceField: "test_code", example: "TEST-TST-001" }),
  col({ key: "numeric_value", dataType: "decimal", description: "Numeric result. A future time point that has not been tested yet is never converted to zero or to a failure — leave it out of the file." }),
  col({ key: "text_value", dataType: "string", description: "Text result." }),
  col({ key: "unit", dataType: "string", description: "Result unit." }),
  col({ key: "result_date", dataType: "date", description: "Date measured." }),
  col({ key: "analyst", dataType: "string", description: "Analyst." }),
  col({ key: "status", dataType: "enum", enumValues: ["recorded", "missing", "invalid"], defaultValue: "recorded", description: "Import always writes an unreviewed result." }),
  col({ key: "observation", dataType: "string", description: "Free-text observation." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// =========================================================== Template 17 ===
// Regulatory Rules

const REGULATORY_RULE_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "rule_code", dataType: "code_reference", description: "Stable rule code — natural key.", ...REQ, example: "TEST-RULE-001" }),
  col({ key: "jurisdiction", dataType: "enum", description: "Jurisdiction code.", ...REQ, enumValues: REGULATORY_JURISDICTIONS, example: "KE" }),
  col({ key: "authority", dataType: "string", description: "Issuing authority." }),
  col({ key: "rule_type", dataType: "enum", description: "Rule type.", enumValues: REGULATORY_RULE_TYPES, example: "label_requirement" }),
  col({ key: "product_family_code", dataType: "code_reference", referenceTemplate: "product_families", referenceField: "family_code", description: "Scoping product family, if any." }),
  col({ key: "material_code", dataType: "code_reference", referenceTemplate: "raw_materials", referenceField: "material_code", description: "Scoping material, if any." }),
  col({ key: "claim_keyword", dataType: "string", description: "Scoping claim keyword, if any." }),
  col({ key: "requirement", dataType: "string", description: "Requirement text.", ...REQ }),
  col({ key: "severity", dataType: "enum", enumValues: ["info", "warning", "blocking"], defaultValue: "warning", description: "Severity." }),
  col({ key: "mandatory", dataType: "boolean", defaultValue: "false", description: "Mandatory flag." }),
  col({ key: "required_document_type", dataType: "string", description: "Required document type, if any." }),
  col({ key: "required_label_element", dataType: "string", description: "Required label element, if any." }),
  col({ key: "required_warning", dataType: "string", description: "Required warning text, if any." }),
  col({ key: "source_reference", dataType: "string", description: "Citation/reference." }),
  col({ key: "source_url", dataType: "url", description: "Source URL." }),
  col({ key: "effective_date", dataType: "date", description: "Effective date." }),
  col({ key: "expiry_date", dataType: "date", description: "Expiry date." }),
  col({ key: "verification_status", dataType: "enum", description: "Ignored on import: every imported rule enters as \"not_verified\" regardless of this column's content — only an authorized regulatory/quality/administrator human can verify a rule, through the Regulatory workspace.", enumValues: ["not_verified", "verified", "disputed", "superseded"] }),
  col({ key: "verified_by", dataType: "string", description: "Ignored on import — see verification_status." }),
  col({ key: "verified_at", dataType: "datetime", description: "Ignored on import — see verification_status." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// =========================================================== Template 18 ===
// Dossier Requirements

const DOSSIER_REQUIREMENT_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "dossier_code", dataType: "code_reference", description: "Dossier code.", ...REQ, example: "TEST-DOSS-001" }),
  col({ key: "jurisdiction", dataType: "enum", description: "Jurisdiction.", ...REQ, enumValues: REGULATORY_JURISDICTIONS, example: "KE" }),
  col({ key: "requirement_code", dataType: "code_reference", description: "Requirement code — natural key together with dossier_code.", ...REQ, example: "TEST-REQ-001" }),
  col({ key: "requirement_type", dataType: "enum", description: "Requirement type.", enumValues: DOSSIER_REQUIREMENT_TYPES, example: "label_content" }),
  col({ key: "title", dataType: "string", description: "Title.", ...REQ }),
  col({ key: "description", dataType: "string", description: "Description." }),
  col({ key: "mandatory", dataType: "boolean", defaultValue: "false", description: "Mandatory flag." }),
  col({ key: "critical", dataType: "boolean", defaultValue: "false", description: "Critical flag." }),
  col({ key: "applicability_status", dataType: "enum", enumValues: DOSSIER_APPLICABILITY_STATUSES, defaultValue: "applicable", description: "Applicability." }),
  col({ key: "accepted_evidence_types", dataType: "multi_value", description: "Accepted evidence types, semicolon-separated." }),
  col({ key: "minimum_evidence_count", dataType: "integer", description: "Minimum evidence items required." }),
  col({ key: "expiry_policy", dataType: "string", description: "Evidence expiry policy text." }),
  col({ key: "source_rule_code", dataType: "code_reference", referenceTemplate: "regulatory_rules", referenceField: "rule_code", description: "Source regulatory rule, if any." }),
  col({ key: "notes", dataType: "string", description: "Free text. A frozen historical dossier revision is never rewritten by import — a change always creates a new revision through the Dossiers workspace." }),
];

// =========================================================== Template 19 ===
// Dossier Evidence Metadata

const DOSSIER_EVIDENCE_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "dossier_code", dataType: "code_reference", description: "Owning dossier.", ...REQ, example: "TEST-DOSS-001" }),
  col({ key: "requirement_code", dataType: "code_reference", description: "Requirement this evidence supports.", ...REQ, example: "TEST-REQ-001" }),
  col({ key: "evidence_code", dataType: "code_reference", description: "Evidence code — natural key.", ...REQ, example: "TEST-EVID-001" }),
  col({ key: "evidence_type", dataType: "enum", enumValues: DOSSIER_EVIDENCE_TYPES, description: "Evidence type." }),
  col({ key: "document_type", dataType: "string", description: "Free-text document type/sub-type, if document-based (e.g. \"regulatory declaration\") — not validated against the Material Documents template's document-type list, since a dossier evidence document is not necessarily a material document." }),
  col({ key: "title", dataType: "string", description: "Title.", ...REQ }),
  col({ key: "document_number", dataType: "string", description: "Document number." }),
  col({ key: "issuer", dataType: "string", description: "Issuer." }),
  col({ key: "issue_date", dataType: "date", description: "Issue date." }),
  col({ key: "expiry_date", dataType: "date", description: "Expiry date." }),
  col({ key: "language", dataType: "string", description: "Language." }),
  col({ key: "file_name", dataType: "file_name", description: "Name of a locally-selected file to match — import never fabricates the attachment itself." }),
  col({ key: "source_entity_code", dataType: "string", description: "Code of the FormuLab record this evidence was discovered from, if any." }),
  col({ key: "status", dataType: "enum", description: "Import always writes evidence as draft/present_unverified, regardless of this column — verification is a separate, authorized, human action.", enumValues: ["draft", "present_unverified"] }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// =========================================================== Template 20 ===
// Product Claims

const PRODUCT_CLAIM_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "claim_code", dataType: "code_reference", description: "Stable claim code — natural key.", ...REQ, example: "TEST-CLAIM-001" }),
  col({ key: "project_code", dataType: "string", description: "Owning project/formulation code." }),
  col({ key: "formula_version", dataType: "integer", description: "Formula version this claim targets." }),
  col({ key: "packaging_sku_code", dataType: "code_reference", referenceTemplate: "packaging_bom", referenceField: "packaging_sku_code", description: "SKU this claim targets." }),
  col({ key: "claim_text", dataType: "string", description: "Claim text.", ...REQ, example: "TEST gentle on sensitive skin" }),
  col({ key: "claim_category", dataType: "enum", description: "Claim category.", enumValues: CLAIM_CATEGORIES, example: "sensitive" }),
  col({ key: "jurisdictions", dataType: "multi_value", description: "Applicable jurisdictions, semicolon-separated." }),
  col({ key: "languages", dataType: "multi_value", description: "Languages, semicolon-separated." }),
  col({ key: "risk_level", dataType: "enum", enumValues: ["low", "medium", "high"], description: "Risk level." }),
  col({ key: "status", dataType: "enum", description: "Every imported claim starts as draft, regardless of this column — supported/prohibited/reviewed statuses require the Claims & Labels review workflow.", enumValues: ["draft"] }),
  col({ key: "evidence_code", dataType: "code_reference", referenceTemplate: "dossier_evidence", referenceField: "evidence_code", description: "Supporting evidence, if any." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// =========================================================== Template 21 ===
// Label Content

const LABEL_CONTENT_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "label_code", dataType: "code_reference", description: "Label code — natural key together with label_revision/panel/block_type/language.", ...REQ, example: "TEST-LBL-001" }),
  col({ key: "formula_version", dataType: "integer", description: "Formula version this label reflects." }),
  col({ key: "packaging_sku_code", dataType: "code_reference", referenceTemplate: "packaging_bom", referenceField: "packaging_sku_code", description: "SKU this label is for." }),
  col({ key: "jurisdiction", dataType: "string", description: "Jurisdiction.", example: "KE" }),
  col({ key: "language", dataType: "string", description: "Language.", ...REQ, example: "en" }),
  col({ key: "label_revision", dataType: "string", description: "Revision label.", ...REQ, example: "1" }),
  col({ key: "panel", dataType: "string", description: "Label panel, e.g. front, back.", ...REQ }),
  col({ key: "block_type", dataType: "enum", description: "Content block type.", ...REQ, enumValues: LABEL_CONTENT_BLOCK_TYPES, example: "product_name" }),
  col({ key: "content_text", dataType: "string", description: "Block text.", ...REQ }),
  col({ key: "mandatory", dataType: "boolean", defaultValue: "false", description: "Mandatory flag." }),
  col({ key: "source", dataType: "enum", description: "Always recorded as \"imported\", matching this template — the schema was designed with this exact source value.", enumValues: ["imported"] }),
  col({ key: "status", dataType: "enum", description: "Imported label content is always draft — an approved label review is a separate, authorized action.", enumValues: ["draft"] }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// =========================================================== Template 22 ===
// Artwork Register

const ARTWORK_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "artwork_code", dataType: "code_reference", description: "Stable artwork code — natural key.", ...REQ, example: "TEST-ART-001" }),
  col({ key: "label_code", dataType: "code_reference", referenceTemplate: "label_content", referenceField: "label_code", description: "Related label.", ...REQ, example: "TEST-LBL-001" }),
  col({ key: "label_revision", dataType: "string", description: "Related label revision." }),
  col({ key: "file_name", dataType: "file_name", description: "Name of a locally-selected file to match — metadata import never fabricates the attachment." }),
  col({ key: "format", dataType: "string", example: "AI", description: "File format." }),
  col({ key: "width", dataType: "decimal", description: "Width." }),
  col({ key: "height", dataType: "decimal", description: "Height." }),
  col({ key: "dimension_unit", dataType: "string", example: "mm", description: "Unit for width/height." }),
  col({ key: "color_mode", dataType: "string", example: "CMYK", description: "Color mode." }),
  col({ key: "languages", dataType: "multi_value", description: "Languages present, semicolon-separated." }),
  col({ key: "status", dataType: "enum", description: "Imported artwork always starts as draft/uploaded — it can never be approved automatically.", enumValues: ["draft", "uploaded"] }),
  col({ key: "created_by", dataType: "string", description: "Original creator, metadata only." }),
  col({ key: "created_at", dataType: "datetime", description: "Original creation timestamp, metadata only." }),
  col({ key: "supersedes_artwork_code", dataType: "code_reference", referenceTemplate: "artwork_register", referenceField: "artwork_code", description: "Prior artwork this replaces, if any — a replacement is always a new revision, never an overwrite." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// =========================================================== Template 23 ===
// DOE Factors and Responses

const DOE_FACTOR_RESPONSE_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "study_code", dataType: "code_reference", description: "DOE study code.", ...REQ, example: "TEST-DOE-001" }),
  col({ key: "record_type", dataType: "enum", description: "Distinguishes a factor row from a response row.", ...REQ, enumValues: ["factor", "response"], example: "factor" }),
  col({ key: "factor_or_response_code", dataType: "code_reference", description: "Factor or response code — natural key together with study_code.", ...REQ, example: "TEST-FACTOR-A" }),
  col({ key: "name", dataType: "string", description: "Display name.", ...REQ }),
  col({ key: "factor_type", dataType: "enum", description: "Factor rows only.", enumValues: DOE_FACTOR_TYPES }),
  col({ key: "source_type", dataType: "enum", description: "Factor rows only.", enumValues: DOE_FACTOR_SOURCE_TYPES }),
  col({ key: "unit", dataType: "string", description: "Unit." }),
  col({ key: "low_value", dataType: "decimal", description: "Factor rows: low level." }),
  col({ key: "center_value", dataType: "decimal", description: "Factor rows: center level." }),
  col({ key: "high_value", dataType: "decimal", description: "Factor rows: high level." }),
  col({ key: "categorical_levels", dataType: "multi_value", description: "Factor rows: categorical levels, semicolon-separated." }),
  col({ key: "objective", dataType: "enum", description: "Response rows only.", enumValues: DOE_RESPONSE_OBJECTIVES }),
  col({ key: "target_value", dataType: "decimal", description: "Response rows: target value." }),
  col({ key: "lower_limit", dataType: "decimal", description: "Response rows: lower limit." }),
  col({ key: "upper_limit", dataType: "decimal", description: "Response rows: upper limit." }),
  col({ key: "weight", dataType: "decimal", description: "Response rows: desirability weight." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// =========================================================== Template 24 ===
// DOE Observations

const DOE_OBSERVATION_COLUMNS: DataExchangeColumnDefinition[] = [
  col({ key: "study_code", dataType: "code_reference", description: "DOE study code.", ...REQ, example: "TEST-DOE-001" }),
  col({ key: "design_code", dataType: "string", description: "Design code, for cross-checking." }),
  col({ key: "run_number", dataType: "integer", description: "Run number within the design.", ...REQ, example: "1" }),
  col({ key: "trial_code", dataType: "string", description: "Linked laboratory trial code, if any." }),
  col({ key: "response_code", dataType: "code_reference", description: "Response being observed.", ...REQ, referenceTemplate: "doe_factors_responses", referenceField: "factor_or_response_code", example: "TEST-RESPONSE-1" }),
  col({ key: "numeric_value", dataType: "decimal", description: "Numeric observation. Left blank the observation is recorded as missing, never as zero." }),
  col({ key: "text_value", dataType: "string", description: "Text observation." }),
  col({ key: "unit", dataType: "string", description: "Unit." }),
  col({ key: "status", dataType: "enum", description: "Import always writes \"recorded\" or \"missing\" — outlier/excluded status is never accepted as a formal human confirmation from import alone.", enumValues: ["recorded", "missing"], defaultValue: "recorded" }),
  col({ key: "measured_at", dataType: "datetime", description: "Measurement timestamp." }),
  col({ key: "analyst", dataType: "string", description: "Analyst." }),
  col({ key: "exclusion_reason", dataType: "string", description: "Recorded as a note only; it does not exclude the observation from analysis by itself." }),
  col({ key: "notes", dataType: "string", description: "Free text." }),
];

// ================================================================ registry ===

function template(def: {
  templateCode: string;
  title: string;
  description: string;
  module: string;
  columns: DataExchangeColumnDefinition[];
  naturalKey: string[];
  duplicatePolicy: DataExchangeDuplicatePolicy;
  updatePolicy: string;
  authorization: readonly ApprovalRole[];
  exampleRows: Record<string, string>[];
  targetCollection: string;
  enabled?: boolean;
  disabledReason?: string;
}): DataExchangeTemplateDefinition {
  return {
    templateId: `dxtpl-${def.templateCode}`,
    templateCode: def.templateCode,
    title: def.title,
    description: def.description,
    module: def.module,
    schemaVersion: SCHEMA_VERSION,
    supportedFormats: ["csv", "xlsx"],
    columns: def.columns,
    primaryKey: def.naturalKey[0],
    naturalKey: def.naturalKey,
    duplicatePolicy: def.duplicatePolicy,
    updatePolicy: def.updatePolicy,
    authorization: def.authorization,
    exampleRows: def.exampleRows,
    targetCollection: def.targetCollection,
    enabled: def.enabled ?? true,
    disabledReason: def.disabledReason,
    createdAt: CREATED,
    updatedAt: CREATED,
  };
}

const MASTER_DATA_ROLES: readonly ApprovalRole[] = ["administrator"];
const QUALITY_MASTER_DATA_ROLES: readonly ApprovalRole[] = ["quality", "administrator"];
const FORMULATION_ROLES: readonly ApprovalRole[] = ["researcher", "chemist", "administrator"];
const COST_ROLES: readonly ApprovalRole[] = ["chemist", "quality", "administrator"];
const LAB_ROLES: readonly ApprovalRole[] = ["researcher", "chemist", "quality", "administrator"];
const REGULATORY_ROLES: readonly ApprovalRole[] = ["regulatory", "quality", "administrator"];
const DRAFT_CONTENT_ROLES: readonly ApprovalRole[] = ["researcher", "chemist", "quality", "regulatory", "administrator"];
const DOE_ROLES: readonly ApprovalRole[] = ["researcher", "chemist", "administrator"];

export const DATA_EXCHANGE_TEMPLATES: DataExchangeTemplateDefinition[] = [
  template({
    templateCode: "raw_materials",
    title: "Raw Materials Master",
    description: "Master raw-material records: identity, physical/chemical properties, sourcing, sustainability and regulatory-status metadata.",
    module: "materials",
    columns: MATERIAL_COLUMNS,
    naturalKey: ["material_code"],
    duplicatePolicy: "create_or_update",
    updatePolicy: "material_code updates mutable material fields on the existing record; the code itself is immutable once created.",
    authorization: MASTER_DATA_ROLES,
    targetCollection: "materials",
    exampleRows: [
      { material_code: "TEST-MAT-001", material_name: "TEST Decyl Glucoside", inci_name: "Decyl Glucoside", cas_number: "68515-73-1", ec_number: "", material_category: "Surfactant", material_function: "nonionic_surfactant", physical_form: "liquid", active_matter_percent: "50.0", density: "1.05", default_unit: "kg", currency: "KES", default_price: "450.00", price_basis_quantity: "1", manufacturer_name: "TEST Chemicals Ltd", manufacturer_code: "DG-50", preferred_supplier_code: "TEST-SUP-001", country_of_origin: "KE", manufacture_date: "2026-01-01", expiry_date: "2028-01-01", shelf_life_months: "24", minimum_order_quantity: "25", lead_time_days: "14", storage_condition: "Store below 25C, away from light.", hazardous: "false", allergen: "false", vegan: "true", natural_origin_percent: "95.0", renewable_carbon_percent: "90.0", biodegradable: "true", regulatory_status: "Permitted KE/EAC", tags: "surfactant;mild", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "suppliers",
    title: "Suppliers Master",
    description: "Master supplier records: contact details, commercial terms and qualification status.",
    module: "materials",
    columns: SUPPLIER_COLUMNS,
    naturalKey: ["supplier_code"],
    duplicatePolicy: "create_or_update",
    updatePolicy: "supplier_code updates mutable supplier fields; approved_supplier is never set true by import alone.",
    authorization: MASTER_DATA_ROLES,
    targetCollection: "suppliers",
    exampleRows: [
      { supplier_code: "TEST-SUP-001", supplier_name: "TEST Ingredients Africa", legal_name: "TEST Ingredients Africa Ltd", contact_name: "Jane Tester", email: "jane@example.test", phone: "+254700000000", website: "https://example.test", country: "KE", city: "Nairobi", address: "1 Test Road", currency: "KES", payment_terms: "Net 30", lead_time_days: "14", minimum_order_value: "50000", approved_supplier: "false", qualification_status: "under_review", last_audit_date: "2025-06-01", next_audit_date: "2026-06-01", rating: "4", tags: "surfactants", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "material_prices",
    title: "Material-Supplier Price List",
    description: "Time-bound material prices per supplier, appended as new validity periods rather than overwritten.",
    module: "materials",
    columns: PRICE_COLUMNS,
    naturalKey: ["material_code", "supplier_code", "valid_from"],
    duplicatePolicy: "append_history",
    updatePolicy: "Every row is a new price-validity period; re-importing an identical period is a duplicate, never a silent overwrite of a prior quote.",
    authorization: MASTER_DATA_ROLES,
    targetCollection: "material_prices",
    exampleRows: [
      { material_code: "TEST-MAT-001", supplier_code: "TEST-SUP-001", supplier_material_code: "DG-50", manufacturer_name: "TEST Chemicals Ltd", brand_name: "TEST Glucoside", currency: "KES", unit_price: "450.00", price_unit: "kg", minimum_order_quantity: "25", pack_size: "25kg drum", valid_from: "2026-01-01", valid_until: "2026-12-31", lead_time_days: "14", incoterm: "FOB", country_of_origin: "KE", preferred: "true", approved: "false", certificate_available: "true", coa_available: "true", sds_available: "true", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "material_documents",
    title: "Material Documents Register",
    description: "SDS/TDS/COA and other material document metadata, matched to a locally-selected file rather than uploaded directly.",
    module: "materials",
    columns: MATERIAL_DOCUMENT_COLUMNS,
    naturalKey: ["material_code", "document_type", "document_number"],
    duplicatePolicy: "create_or_update",
    updatePolicy: "Metadata updates on match; verification_status/verified_by/verified_at are never set by import.",
    authorization: QUALITY_MASTER_DATA_ROLES,
    targetCollection: "material_documents",
    exampleRows: [
      { material_code: "TEST-MAT-001", supplier_code: "TEST-SUP-001", document_type: "SDS", document_number: "SDS-DG50-03", document_title: "TEST Safety Data Sheet v3", revision: "3", language: "en", issuer: "TEST Chemicals Ltd", issue_date: "2025-11-01", expiry_date: "", file_name: "test-sds-dg50-v3.pdf", expected_sha256: "", verification_status: "unverified", tags: "sds", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "product_families",
    title: "Product Families",
    description: "Live, mutable product-family master data (distinct from the static reference catalog).",
    module: "product",
    columns: PRODUCT_FAMILY_COLUMNS,
    naturalKey: ["family_code"],
    duplicatePolicy: "create_or_update",
    updatePolicy: "family_code updates mutable fields on the existing record.",
    authorization: MASTER_DATA_ROLES,
    targetCollection: "product_families",
    exampleRows: [
      { family_code: "TEST-FAM-001", family_name: "TEST Hand Soaps", category: "Personal Care", subcategory: "Hand Wash", default_unit: "kg", default_batch_size: "100", target_market: "KE", default_jurisdictions: "KE;EAC", default_packaging_type: "bottle", active: "true", tags: "handwash", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "finished_products",
    title: "Finished Products / SKU Master",
    description: "Sellable SKU master data, referencing a product family, formula version and packaging BOM.",
    module: "product",
    columns: FINISHED_PRODUCT_COLUMNS,
    naturalKey: ["sku_code"],
    duplicatePolicy: "create_or_update",
    updatePolicy: "sku_code updates mutable fields on the existing record.",
    authorization: MASTER_DATA_ROLES,
    targetCollection: "finished_products",
    exampleRows: [
      { sku_code: "TEST-SKU-001", sku_name: "TEST Gentle Hand Soap 250ml", product_family_code: "TEST-FAM-001", brand: "TEST Brand", formula_code: "TEST-FORM-001", formula_version: "1", packaging_sku_code: "TEST-PKGBOM-001", net_quantity: "250", quantity_unit: "ml", barcode: "6009000000015", target_markets: "KE", languages: "en;sw", status: "draft", manufacture_site: "TEST Site", shelf_life_months: "24", tags: "handwash", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "packaging_components",
    title: "Packaging Components",
    description: "Individual packaging component master data.",
    module: "packaging",
    columns: PACKAGING_COMPONENT_COLUMNS,
    naturalKey: ["component_code"],
    duplicatePolicy: "create_or_update",
    updatePolicy: "component_code updates mutable fields on the existing record.",
    authorization: MASTER_DATA_ROLES,
    targetCollection: "packaging_components",
    exampleRows: [
      { component_code: "TEST-PKG-001", component_name: "TEST 250ml PET Bottle", component_type: "bottle", material_type: "PET", supplier_code: "TEST-SUP-001", manufacturer_name: "TEST Packaging Ltd", capacity: "250", capacity_unit: "ml", weight: "18", weight_unit: "g", color: "clear", dimensions: "H180xD50mm", closure_type: "flip-top", food_contact: "false", recyclable: "true", recycled_content_percent: "30", unit_price: "12.50", currency: "KES", minimum_order_quantity: "5000", lead_time_days: "21", tags: "bottle", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "packaging_bom",
    title: "Packaging SKU / Packaging BOM",
    description: "Packaging bill-of-materials: one or more component rows grouped under a packaging SKU code.",
    module: "packaging",
    columns: PACKAGING_BOM_COLUMNS,
    naturalKey: ["packaging_sku_code", "component_code"],
    duplicatePolicy: "create_or_update",
    updatePolicy: "An existing (packaging_sku_code, component_code) line updates in place — the packaging BOM record itself is mutable, unlike price history.",
    authorization: MASTER_DATA_ROLES,
    targetCollection: "packaging_boms",
    exampleRows: [
      { packaging_sku_code: "TEST-PKGBOM-001", packaging_sku_name: "TEST 250ml Bottle Pack", product_family_code: "TEST-FAM-001", component_code: "TEST-PKG-001", component_quantity: "1", quantity_unit: "pieces", primary_packaging: "true", secondary_packaging: "false", tertiary_packaging: "false", fill_volume: "250", fill_weight: "", line_code: "L1", unit_cost: "12.50", currency: "KES", effective_from: "2026-01-01", effective_until: "", tags: "bottle-pack", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "formula_bom",
    title: "Formula / BOM Import",
    description: "Formula composition rows grouped by (formula_code, formula_version) into a new saved formula version — never a silent overwrite of an existing one.",
    module: "formulation",
    columns: FORMULA_BOM_COLUMNS,
    naturalKey: ["formula_code", "formula_version", "line_number"],
    duplicatePolicy: "new_revision",
    updatePolicy: "An existing (formula_code, formula_version) is immutable and refused; a new version number is created (or the next one auto-assigned when left blank).",
    authorization: FORMULATION_ROLES,
    targetCollection: "formulations",
    exampleRows: [
      { formula_code: "TEST-FORM-001", formula_name: "TEST Gentle Hand Soap", formula_version: "1", project_code: "TEST-PROJ-001", product_family_code: "TEST-FAM-001", line_number: "1", material_code: "TEST-MAT-WATER", quantity: "", quantity_unit: "kg", percentage: "", phase: "A", addition_order: "1", process_temperature: "25", mixing_speed: "low", mixing_time: "5 min", is_qs_material: "true", function: "solvent", notes: "Synthetic test row." },
      { formula_code: "TEST-FORM-001", formula_name: "TEST Gentle Hand Soap", formula_version: "1", project_code: "TEST-PROJ-001", product_family_code: "TEST-FAM-001", line_number: "2", material_code: "TEST-MAT-001", quantity: "12", quantity_unit: "kg", percentage: "12.0", phase: "A", addition_order: "2", process_temperature: "25", mixing_speed: "medium", mixing_time: "10 min", is_qs_material: "false", function: "surfactant", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "process_parameters",
    title: "Process Parameters",
    description: "Manufacturing process steps for a specific formula version.",
    module: "formulation",
    columns: PROCESS_PARAMETER_COLUMNS,
    naturalKey: ["formula_code", "formula_version", "step_number"],
    duplicatePolicy: "create_or_update",
    updatePolicy: "(formula_code, formula_version, step_number) updates the existing step.",
    authorization: FORMULATION_ROLES,
    targetCollection: "process_parameters",
    exampleRows: [
      { formula_code: "TEST-FORM-001", formula_version: "1", step_number: "1", step_name: "Heat and mix phase A", phase: "A", equipment_type: "jacketed vessel", temperature_min: "60", temperature_target: "65", temperature_max: "70", mixing_speed_min: "50", mixing_speed_target: "80", mixing_speed_max: "120", mixing_time_minutes: "15", addition_rate: "steady", hold_time_minutes: "10", critical_parameter: "true", instruction: "Heat phase A to target and hold.", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "costing_assumptions",
    title: "Costing Assumptions",
    description: "Factory costing profile: utility/labour/overhead rates used by the cost engine.",
    module: "costing",
    columns: COSTING_ASSUMPTIONS_COLUMNS,
    naturalKey: ["costing_profile_code", "effective_date"],
    duplicatePolicy: "append_history",
    updatePolicy: "A new effective_date for an existing profile code is appended, preserving historical costing snapshots.",
    authorization: COST_ROLES,
    targetCollection: "factory_cost_profiles",
    exampleRows: [
      { costing_profile_code: "TEST-COST-001", currency: "KES", effective_date: "2026-01-01", labor_cost_per_hour: "500", energy_cost_per_kwh: "25", water_cost_per_m3: "150", steam_cost_per_kg: "5", waste_cost_per_kg: "10", overhead_percent: "15", manufacturing_loss_percent: "2", freight_percent: "3", duty_percent: "0", tax_percent: "16", target_margin_percent: "30", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "formula_cost_overrides",
    title: "Formula Cost Overrides",
    description: "Per-formula material price overrides, kept separate from the shared material price list.",
    module: "costing",
    columns: FORMULA_COST_OVERRIDE_COLUMNS,
    naturalKey: ["formula_code", "formula_version", "material_code", "effective_from"],
    duplicatePolicy: "append_history",
    updatePolicy: "A new effective_from period is appended; approved_by text is stored as a note only and never grants approval.",
    authorization: COST_ROLES,
    targetCollection: "formula_cost_overrides",
    exampleRows: [
      { formula_code: "TEST-FORM-001", formula_version: "1", material_code: "TEST-MAT-001", supplier_code: "TEST-SUP-001", override_price: "480.00", currency: "KES", price_unit: "kg", effective_from: "2026-01-01", effective_until: "", reason: "Negotiated volume discount (test).", approved_by: "", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "test_definitions",
    title: "Laboratory Test Definitions",
    description: "Reusable laboratory test method definitions with acceptance limits.",
    module: "laboratory",
    columns: TEST_DEFINITION_COLUMNS,
    naturalKey: ["test_code"],
    duplicatePolicy: "create_or_update",
    updatePolicy: "test_code updates mutable fields on the existing definition.",
    authorization: LAB_ROLES,
    targetCollection: "test_definitions",
    exampleRows: [
      { test_code: "TEST-TST-001", test_name: "TEST pH Measurement", test_category: "physicochemical", method_reference: "internal method TP-01", unit: "pH", result_type: "numeric", lower_limit: "4.5", target_value: "5.5", upper_limit: "6.5", decimal_places: "1", replicate_count: "2", destructive_test: "false", required_for_release: "true", required_for_stability: "true", active: "true", tags: "physicochemical", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "lab_results",
    title: "Laboratory Results",
    description: "Individual replicate-level laboratory results, grouped into a trial/sample/test result record. Missing values stay missing.",
    module: "laboratory",
    columns: LAB_RESULT_COLUMNS,
    naturalKey: ["trial_code", "sample_code", "test_code", "replicate_number"],
    duplicatePolicy: "new_revision",
    updatePolicy: "Laboratory results are append-only history — re-importing the same (trial, sample, test, replicate) creates a new result revision rather than overwriting the original measurement; the new revision stays unreviewed until a human reviews it in the Laboratory workspace.",
    authorization: LAB_ROLES,
    targetCollection: "test_results",
    exampleRows: [
      { project_code: "TEST-PROJ-001", formula_version: "1", trial_code: "TEST-TRIAL-001", sample_code: "S1", test_code: "TEST-TST-001", replicate_number: "1", numeric_value: "5.4", text_value: "", unit: "pH", result_date: "2026-01-15", analyst: "Test Analyst", instrument: "TEST pH meter", status: "recorded", deviation_code: "", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "stability_protocols",
    title: "Stability Protocols",
    description: "Stability testing protocol: conditions, time points and required tests.",
    module: "stability",
    columns: STABILITY_PROTOCOL_COLUMNS,
    naturalKey: ["protocol_code", "condition_code", "time_point", "test_code"],
    duplicatePolicy: "create_or_update",
    updatePolicy: "Matching (protocol, condition, time point, test) rows update that row within the protocol.",
    authorization: LAB_ROLES,
    targetCollection: "stability_studies",
    exampleRows: [
      { protocol_code: "TEST-PROT-001", protocol_name: "TEST 6-Month Accelerated Stability", product_family_code: "TEST-FAM-001", packaging_sku_code: "TEST-PKGBOM-001", condition_code: "40C-75RH", temperature: "40", humidity: "75", light_condition: "dark", orientation: "upright", time_point: "M3", time_unit: "months", test_code: "TEST-TST-001", sample_quantity: "3", acceptance_criteria: "pH within 4.5-6.5", active: "true", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "stability_results",
    title: "Stability Results",
    description: "Stability test results per sample/condition/time point/test. Untested future time points are never zero or a failure.",
    module: "stability",
    columns: STABILITY_RESULT_COLUMNS,
    naturalKey: ["study_code", "sample_code", "condition_code", "time_point", "test_code"],
    duplicatePolicy: "new_revision",
    updatePolicy: "Stability results are append-only history — a matching (study, sample, condition, time point, test) row creates a new result revision; stays unreviewed until reviewed in the Stability workspace.",
    authorization: LAB_ROLES,
    targetCollection: "stability_results",
    exampleRows: [
      { study_code: "TEST-STAB-001", sample_code: "S1", formula_version: "1", packaging_sku_code: "TEST-PKGBOM-001", condition_code: "40C-75RH", time_point: "M3", test_code: "TEST-TST-001", numeric_value: "5.3", text_value: "", unit: "pH", result_date: "2026-04-15", analyst: "Test Analyst", status: "recorded", observation: "No visible change.", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "regulatory_rules",
    title: "Regulatory Rules",
    description: "Regulatory requirement rules by jurisdiction. Every imported rule is unverified until a human verifies it in the Regulatory workspace.",
    module: "regulatory",
    columns: REGULATORY_RULE_COLUMNS,
    naturalKey: ["rule_code"],
    duplicatePolicy: "create_or_update",
    updatePolicy: "rule_code updates mutable content fields in place; verification_status/verified_by/verified_at are never taken from the file — every import resets verification_status to not_verified, so an updated rule always needs re-verification.",
    authorization: REGULATORY_ROLES,
    targetCollection: "regulatory_rules",
    exampleRows: [
      { rule_code: "TEST-RULE-001", jurisdiction: "KE", authority: "TEST Authority", rule_type: "label_requirement", product_family_code: "TEST-FAM-001", material_code: "", claim_keyword: "", requirement: "Label must state net contents in metric units.", severity: "blocking", mandatory: "true", required_document_type: "", required_label_element: "net_contents", required_warning: "", source_reference: "Test Reg 12(3)", source_url: "", effective_date: "2026-01-01", expiry_date: "", verification_status: "not_verified", verified_by: "", verified_at: "", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "dossier_requirements",
    title: "Dossier Requirements",
    description: "Requirement checklist items for a regulatory dossier. Frozen historical revisions are never rewritten.",
    module: "dossier",
    columns: DOSSIER_REQUIREMENT_COLUMNS,
    naturalKey: ["dossier_code", "requirement_code"],
    duplicatePolicy: "reject_conflict",
    updatePolicy: "Updates a non-frozen requirement in place; a requirement on a frozen dossier revision is refused and reported as a conflict.",
    authorization: REGULATORY_ROLES,
    targetCollection: "regulatory_dossier_requirements",
    exampleRows: [
      { dossier_code: "TEST-DOSS-001", jurisdiction: "KE", requirement_code: "TEST-REQ-001", requirement_type: "label_content", title: "Net contents statement", description: "Label must declare net contents.", mandatory: "true", critical: "true", applicability_status: "applicable", accepted_evidence_types: "label_content;regulatory_declaration", minimum_evidence_count: "1", expiry_policy: "none", source_rule_code: "TEST-RULE-001", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "dossier_evidence",
    title: "Dossier Evidence Metadata",
    description: "Evidence metadata supporting a dossier requirement. Always imported as draft/present_unverified.",
    module: "dossier",
    columns: DOSSIER_EVIDENCE_COLUMNS,
    naturalKey: ["dossier_code", "requirement_code", "evidence_code"],
    duplicatePolicy: "create_or_update",
    updatePolicy: "Matching evidence_code updates metadata; status is always draft/present_unverified regardless of the file.",
    authorization: REGULATORY_ROLES,
    targetCollection: "regulatory_evidence_items",
    exampleRows: [
      { dossier_code: "TEST-DOSS-001", requirement_code: "TEST-REQ-001", evidence_code: "TEST-EVID-001", evidence_type: "other", document_type: "regulatory_declaration", title: "TEST net-contents declaration", document_number: "DECL-001", issuer: "TEST QA", issue_date: "2026-01-10", expiry_date: "", language: "en", file_name: "test-declaration.pdf", source_entity_code: "", status: "draft", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "product_claims",
    title: "Product Claims",
    description: "Marketing/technical claims proposed for a product. Always imported as draft, never supported/prohibited/reviewed.",
    module: "claims_labels",
    columns: PRODUCT_CLAIM_COLUMNS,
    naturalKey: ["claim_code"],
    duplicatePolicy: "new_revision",
    updatePolicy: "A changed claim_text for an existing claim_code creates a new claim revision rather than editing the reviewed text in place.",
    authorization: DRAFT_CONTENT_ROLES,
    targetCollection: "product_claims",
    exampleRows: [
      { claim_code: "TEST-CLAIM-001", project_code: "TEST-PROJ-001", formula_version: "1", packaging_sku_code: "TEST-PKGBOM-001", claim_text: "TEST gentle on sensitive skin", claim_category: "sensitive", jurisdictions: "KE", languages: "en", risk_level: "low", status: "draft", evidence_code: "", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "label_content",
    title: "Label Content",
    description: "Structured label panel/block content per language and revision. Always imported as draft.",
    module: "claims_labels",
    columns: LABEL_CONTENT_COLUMNS,
    naturalKey: ["label_code", "label_revision", "panel", "block_type", "language"],
    duplicatePolicy: "new_revision",
    updatePolicy: "Label content blocks are append-only history — a matching (label_code, revision, panel, block_type, language) row is a new content revision, never an edit of previously reviewed text; source is always \"imported\" and status always \"draft\".",
    authorization: DRAFT_CONTENT_ROLES,
    targetCollection: "label_content_blocks",
    exampleRows: [
      { label_code: "TEST-LBL-001", formula_version: "1", packaging_sku_code: "TEST-PKGBOM-001", jurisdiction: "KE", language: "en", label_revision: "1", panel: "front", block_type: "product_name", content_text: "TEST Gentle Hand Soap", mandatory: "true", source: "imported", status: "draft", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "artwork_register",
    title: "Artwork Register",
    description: "Artwork file metadata linked to label content. Never approved automatically.",
    module: "claims_labels",
    columns: ARTWORK_COLUMNS,
    naturalKey: ["artwork_code"],
    duplicatePolicy: "new_revision",
    updatePolicy: "A repeated artwork_code with different content is refused; use supersedes_artwork_code to record a replacement as a new revision.",
    authorization: DRAFT_CONTENT_ROLES,
    targetCollection: "label_artworks",
    exampleRows: [
      { artwork_code: "TEST-ART-001", label_code: "TEST-LBL-001", label_revision: "1", file_name: "test-artwork-v1.ai", format: "AI", width: "180", height: "60", dimension_unit: "mm", color_mode: "CMYK", languages: "en", status: "draft", created_by: "Test Designer", created_at: "2026-01-05T00:00:00.000Z", supersedes_artwork_code: "", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "doe_factors_responses",
    title: "DOE Factors and Responses",
    description: "Factor and response definitions for a Design of Experiments study.",
    module: "doe",
    columns: DOE_FACTOR_RESPONSE_COLUMNS,
    naturalKey: ["study_code", "factor_or_response_code"],
    duplicatePolicy: "create_or_update",
    updatePolicy: "Matching (study_code, code) updates that factor/response definition, respecting the same immutable-once-analyzed study rule as the DOE workspace itself.",
    authorization: DOE_ROLES,
    targetCollection: "doe_factors",
    exampleRows: [
      { study_code: "TEST-DOE-001", record_type: "factor", factor_or_response_code: "TEST-FACTOR-A", name: "TEST Surfactant Level", factor_type: "continuous", source_type: "process_parameter", unit: "%", low_value: "8", center_value: "11.5", high_value: "15", categorical_levels: "", objective: "", target_value: "", lower_limit: "", upper_limit: "", weight: "", notes: "Synthetic test row." },
      { study_code: "TEST-DOE-001", record_type: "response", factor_or_response_code: "TEST-RESPONSE-1", name: "TEST Viscosity Response", factor_type: "", source_type: "", unit: "cPs", low_value: "", center_value: "", high_value: "", categorical_levels: "", objective: "within_range", target_value: "12000", lower_limit: "9000", upper_limit: "15000", weight: "1", notes: "Synthetic test row." },
    ],
  }),
  template({
    templateCode: "doe_observations",
    title: "DOE Observations",
    description: "Response observations recorded against DOE study runs. Always imported unvalidated; missing stays missing.",
    module: "doe",
    columns: DOE_OBSERVATION_COLUMNS,
    naturalKey: ["study_code", "run_number", "response_code"],
    duplicatePolicy: "create_or_update",
    updatePolicy: "Matching (study_code, run_number, response_code) updates that observation; status is limited to recorded/missing from import, never excluded/outlier_confirmed.",
    authorization: DOE_ROLES,
    targetCollection: "doe_observations",
    exampleRows: [
      { study_code: "TEST-DOE-001", design_code: "", run_number: "1", trial_code: "", response_code: "TEST-RESPONSE-1", numeric_value: "12500", text_value: "", unit: "cPs", status: "recorded", measured_at: "2026-01-20T09:00:00.000Z", analyst: "Test Analyst", exclusion_reason: "", notes: "Synthetic test row." },
    ],
  }),
];

export function getDataExchangeTemplate(templateCode: string): DataExchangeTemplateDefinition | undefined {
  return DATA_EXCHANGE_TEMPLATES.find((t) => t.templateCode === templateCode);
}

export function listDataExchangeTemplates(): DataExchangeTemplateDefinition[] {
  return DATA_EXCHANGE_TEMPLATES;
}

export function isDataExchangeRoleAuthorized(template: DataExchangeTemplateDefinition, role: ApprovalRole): boolean {
  return template.authorization.includes(role);
}
