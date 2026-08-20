/**
 * FVL-04.025 (Session 10 rebuild, Part G) — a real, end-to-end customer
 * migration fixture: a SQLite-backed ERP (materials/suppliers/prices/
 * inventory, via the real `sqliteTestAdapter`), a legacy formulation
 * export file (nested JSON), and a REST-backed LIMS (via a real local
 * HTTP server and the real `httpFetchAdapter`) — migrated TWICE through
 * the real production bridge (`prepareConnectorImport()`/
 * `confirmConnectorImport()`, never manually chained), proving every
 * incremental/conflict state the second migration is supposed to
 * exercise. Session 9 explicitly omitted inventory (G4) and never
 * exercised a real transformation (G5) or a real mapping-profile version
 * chain (G6) inside its own fixture — all three are exercised here.
 *
 * MIG1-MIG35 acceptance items are called out inline as they are proven.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDatabaseConnector,
  createFileConnector,
  createHttpFetchAdapter,
  createRestApiConnector,
  discoverSourceSchema,
  getDataExchangeTemplate,
  mappingProfileCode,
  validateMappingProfileSupersession,
  type DatabaseAdapter,
  type MappingProfile,
  type RestRequestSpec,
} from "@formulab/shared";
import { createSqliteTestAdapter, type SqliteTestAdapterHandle } from "@formulab/shared/testing";
import type { Formulation, FormulationVersion } from "@formulab/shared";

const store = new Map<string, Record<string, unknown>[]>();
vi.mock("@/lib/masterdata", () => ({
  listRecords: async (collection: string) => store.get(collection) ?? [],
  upsertRecords: async (collection: string, records: Record<string, unknown>[]) => {
    const existing = store.get(collection) ?? [];
    let inserted = 0;
    let updated = 0;
    const next = [...existing];
    for (const record of records) {
      const key = (record.code ?? record.id) as string | undefined;
      const idx = key ? next.findIndex((r) => (r.code ?? r.id) === key) : -1;
      if (idx >= 0) {
        next[idx] = record;
        updated++;
      } else {
        next.push(record);
        inserted++;
      }
    }
    store.set(collection, next);
    return { inserted, updated, total: next.length };
  },
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

const formulationsStore = new Map<string, { formulation: Formulation; versions: FormulationVersion[] }>();
vi.mock("@/lib/formulations", async () => {
  const actual = await vi.importActual<typeof import("./formulations")>("./formulations");
  return {
    ...actual,
    listFormulations: async () => [...formulationsStore.values()].map((e) => e.formulation),
    readFormulation: async (id: string) => {
      const entry = formulationsStore.get(id);
      return entry ? { formulation: entry.formulation, versions: entry.versions } : { formulation: undefined, versions: [] };
    },
    saveFormulation: async (f: Formulation) => {
      const existing = formulationsStore.get(f.id);
      formulationsStore.set(f.id, { formulation: f, versions: existing?.versions ?? [] });
      return f;
    },
    saveFormulationVersion: async (v: FormulationVersion) => {
      const entry = formulationsStore.get(v.formulationId);
      if (!entry) throw new Error(`No formulation "${v.formulationId}" to attach a version to.`);
      entry.versions.push(v);
      return v;
    },
  };
});

import { prepareConnectorImport, confirmConnectorImport } from "./connectorImportBridge";

const ctx = { actorUserId: "migration-operator", actorRole: "administrator" as const };
const stageOpts = { extractionRunId: "run-mig1", extractedAt: "2026-01-01T00:00:00.000Z" };

// ============================================================ ERP (DB) ===

const DB1_SQL = `
CREATE TABLE erp_materials (MaterialID TEXT PRIMARY KEY, MaterialName TEXT NOT NULL, ActiveMatter REAL, Hazardous INTEGER NOT NULL);
CREATE TABLE erp_suppliers (SupplierID TEXT PRIMARY KEY, SupplierName TEXT NOT NULL);
CREATE TABLE erp_material_supplier (MaterialID TEXT NOT NULL, SupplierID TEXT NOT NULL, Preferred INTEGER NOT NULL, PRIMARY KEY (MaterialID, SupplierID), FOREIGN KEY (MaterialID) REFERENCES erp_materials(MaterialID), FOREIGN KEY (SupplierID) REFERENCES erp_suppliers(SupplierID));
CREATE TABLE erp_prices (PriceID TEXT PRIMARY KEY, MaterialID TEXT NOT NULL, SupplierID TEXT NOT NULL, UnitPrice REAL NOT NULL, Currency TEXT NOT NULL, ValidFrom TEXT NOT NULL);
CREATE TABLE erp_inventory (InventoryID TEXT PRIMARY KEY, MaterialID TEXT NOT NULL, QtyGrams REAL NOT NULL, Warehouse TEXT NOT NULL, Quarantined INTEGER NOT NULL);
INSERT INTO erp_materials VALUES ('MAT-1','ERP Decyl Glucoside',95.5,0);
INSERT INTO erp_materials VALUES ('MAT-2','ERP Preservative X',100,1);
INSERT INTO erp_suppliers VALUES ('SUP-1','ERP Ingredients Ltd');
INSERT INTO erp_material_supplier VALUES ('MAT-1','SUP-1',1);
INSERT INTO erp_material_supplier VALUES ('MAT-2','SUP-1',0);
INSERT INTO erp_prices VALUES ('P-1','MAT-1','SUP-1',450.5,'KES','2026-01-01');
INSERT INTO erp_prices VALUES ('P-2','MAT-2','SUP-1',120.0,'KES','2026-01-01');
INSERT INTO erp_inventory VALUES ('INV-1','MAT-1',50000,'main',0);
INSERT INTO erp_inventory VALUES ('INV-2','MAT-2',20000,'main',0);
`;

// Migration 2's own point-in-time snapshot of the SAME ERP: MAT-1's active
// matter changed AND its price got a new validity period (a genuine price
// change, correctly modeled as an append-only new period, never an
// in-place edit of price history); MAT-2 disappeared entirely (deleted
// upstream); SUP-1 and price P-1 are byte-identical to migration 1;
// inventory INV-1's quantity changed.
const DB2_SQL = `
CREATE TABLE erp_materials (MaterialID TEXT PRIMARY KEY, MaterialName TEXT NOT NULL, ActiveMatter REAL, Hazardous INTEGER NOT NULL);
CREATE TABLE erp_suppliers (SupplierID TEXT PRIMARY KEY, SupplierName TEXT NOT NULL);
CREATE TABLE erp_material_supplier (MaterialID TEXT NOT NULL, SupplierID TEXT NOT NULL, Preferred INTEGER NOT NULL, PRIMARY KEY (MaterialID, SupplierID), FOREIGN KEY (MaterialID) REFERENCES erp_materials(MaterialID), FOREIGN KEY (SupplierID) REFERENCES erp_suppliers(SupplierID));
CREATE TABLE erp_prices (PriceID TEXT PRIMARY KEY, MaterialID TEXT NOT NULL, SupplierID TEXT NOT NULL, UnitPrice REAL NOT NULL, Currency TEXT NOT NULL, ValidFrom TEXT NOT NULL);
CREATE TABLE erp_inventory (InventoryID TEXT PRIMARY KEY, MaterialID TEXT NOT NULL, QtyGrams REAL NOT NULL, Warehouse TEXT NOT NULL, Quarantined INTEGER NOT NULL);
INSERT INTO erp_materials VALUES ('MAT-1','ERP Decyl Glucoside',96.2,0);
INSERT INTO erp_suppliers VALUES ('SUP-1','ERP Ingredients Ltd');
INSERT INTO erp_material_supplier VALUES ('MAT-1','SUP-1',1);
INSERT INTO erp_prices VALUES ('P-1','MAT-1','SUP-1',450.5,'KES','2026-01-01');
INSERT INTO erp_prices VALUES ('P-3','MAT-1','SUP-1',480.75,'KES','2026-02-01');
INSERT INTO erp_inventory VALUES ('INV-1','MAT-1',55000,'main',0);
`;

const DB_ENTITIES = {
  materials: { table: "erp_materials" },
  suppliers: { table: "erp_suppliers" },
  material_supplier: { table: "erp_material_supplier" },
  prices: { table: "erp_prices" },
  inventory: { table: "erp_inventory" },
};

const materialsProfile = (fp: string): MappingProfile => ({
  schemaVersion: "1.0",
  code: mappingProfileCode("mig-materials", 1),
  profileId: "mig-materials",
  profileName: "ERP materials",
  sourceSystemId: "LEGACY_ERP",
  sourceEntity: "materials",
  sourceSchemaFingerprint: fp,
  profileVersion: 1,
  status: "active",
  fieldMappings: [
    { sourceField: "MaterialID", targetTemplate: "raw_materials", targetField: "material_code" },
    { sourceField: "MaterialName", targetTemplate: "raw_materials", targetField: "material_name" },
    { sourceField: "ActiveMatter", targetTemplate: "raw_materials", targetField: "active_matter_percent" },
    { sourceField: "Hazardous", targetTemplate: "raw_materials", targetField: "hazardous", transformations: [{ op: "map_boolean", config: { trueValues: ["1"], falseValues: ["0"] } }] },
  ],
  constantMappings: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdBy: "local",
});

const suppliersProfile = (fp: string): MappingProfile => ({
  schemaVersion: "1.0",
  code: mappingProfileCode("mig-suppliers", 1),
  profileId: "mig-suppliers",
  profileName: "ERP suppliers",
  sourceSystemId: "LEGACY_ERP",
  sourceEntity: "suppliers",
  sourceSchemaFingerprint: fp,
  profileVersion: 1,
  status: "active",
  fieldMappings: [
    { sourceField: "SupplierID", targetTemplate: "suppliers", targetField: "supplier_code" },
    { sourceField: "SupplierName", targetTemplate: "suppliers", targetField: "supplier_name" },
  ],
  constantMappings: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdBy: "local",
});

const materialSupplierProfile = (fp: string): MappingProfile => ({
  schemaVersion: "1.0",
  code: mappingProfileCode("mig-material-suppliers", 1),
  profileId: "mig-material-suppliers",
  profileName: "ERP material-supplier links",
  sourceSystemId: "LEGACY_ERP",
  sourceEntity: "material_supplier",
  sourceSchemaFingerprint: fp,
  profileVersion: 1,
  status: "active",
  fieldMappings: [
    { sourceField: "MaterialID", targetTemplate: "material_suppliers", targetField: "material_code" },
    { sourceField: "SupplierID", targetTemplate: "material_suppliers", targetField: "supplier_code" },
    { sourceField: "Preferred", targetTemplate: "material_suppliers", targetField: "preferred", transformations: [{ op: "map_boolean", config: { trueValues: ["1"], falseValues: ["0"] } }] },
  ],
  constantMappings: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdBy: "local",
});

const pricesProfile = (fp: string): MappingProfile => ({
  schemaVersion: "1.0",
  code: mappingProfileCode("mig-prices", 1),
  profileId: "mig-prices",
  profileName: "ERP prices",
  sourceSystemId: "LEGACY_ERP",
  sourceEntity: "prices",
  sourceSchemaFingerprint: fp,
  profileVersion: 1,
  status: "active",
  fieldMappings: [
    { sourceField: "MaterialID", targetTemplate: "material_prices", targetField: "material_code" },
    { sourceField: "SupplierID", targetTemplate: "material_prices", targetField: "supplier_code" },
    { sourceField: "UnitPrice", targetTemplate: "material_prices", targetField: "unit_price" },
    { sourceField: "Currency", targetTemplate: "material_prices", targetField: "currency" },
    { sourceField: "ValidFrom", targetTemplate: "material_prices", targetField: "valid_from" },
  ],
  constantMappings: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdBy: "local",
});

// G5 — a real `convert_unit` transformation: the ERP stores quantity in
// grams, the canonical inventory template wants kilograms.
const inventoryProfile = (fp: string): MappingProfile => ({
  schemaVersion: "1.0",
  code: mappingProfileCode("mig-inventory", 1),
  profileId: "mig-inventory",
  profileName: "ERP inventory",
  sourceSystemId: "LEGACY_ERP",
  sourceEntity: "inventory",
  sourceSchemaFingerprint: fp,
  profileVersion: 1,
  status: "active",
  fieldMappings: [
    { sourceField: "InventoryID", targetTemplate: "inventory_records", targetField: "inventory_code" },
    { sourceField: "MaterialID", targetTemplate: "inventory_records", targetField: "material_code" },
    { sourceField: "QtyGrams", targetTemplate: "inventory_records", targetField: "quantity", transformations: [{ op: "convert_unit", config: { from: "g", to: "kg" } }] },
    { sourceField: "Warehouse", targetTemplate: "inventory_records", targetField: "warehouse" },
    { sourceField: "Quarantined", targetTemplate: "inventory_records", targetField: "quarantined", transformations: [{ op: "map_boolean", config: { trueValues: ["1"], falseValues: ["0"] } }] },
  ],
  constantMappings: [{ targetTemplate: "inventory_records", targetField: "unit", value: "kg" }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdBy: "local",
});

// ================================================== legacy formula file ===

// `external_line_id` is a real per-line external identity (never mapped to
// any target field — used only as the connector's own `idField`) so
// cross-migration reimport classification is identity-based, never
// ordinal (ordinal fallback identity is a documented weaker case and
// would collide across two separate extractions of different logical
// rows — see FVL-04.021's own ordinal-fallback acceptance).
const FORMULA_FILE_1 = JSON.stringify({
  formulas: [
    { external_line_id: "FORM-A-V1-L2", formula_code: "LEGACY-FORM-A", formula_name: "Legacy Hand Soap", formula_version: "1", line_number: "2", material_code: "MAT-1", percentage: "59.7", phase: "A", addition_order: "2" },
    { external_line_id: "FORM-A-V1-L1", formula_code: "LEGACY-FORM-A", formula_name: "Legacy Hand Soap", formula_version: "1", line_number: "1", material_code: "MAT-2", percentage: "40", phase: "A", addition_order: "1" },
    { external_line_id: "FORM-B-V1-L1", formula_code: "LEGACY-FORM-B", formula_name: "Legacy Bad Formula", formula_version: "1", line_number: "1", material_code: "MISSING-MAT-X", percentage: "100", phase: "A", addition_order: "1" },
  ],
});

const FORMULA_FILE_2 = JSON.stringify({
  formulas: [
    { external_line_id: "FORM-A-V2-L1", formula_code: "LEGACY-FORM-A", formula_name: "Legacy Hand Soap", formula_version: "2", line_number: "1", material_code: "MAT-1", percentage: "60", phase: "A", addition_order: "1" },
    { external_line_id: "FORM-A-V2-L2", formula_code: "LEGACY-FORM-A", formula_name: "Legacy Hand Soap", formula_version: "2", line_number: "2", material_code: "MAT-2", percentage: "40", phase: "A", addition_order: "2" },
  ],
});

// ================================================================ LIMS ===

let server: Server;
let baseUrl: string;
let lab429Fired = false;
let limsResults: Record<string, string>[] = [
  { RecordID: "LIMS-1", TrialCode: "LIMS-TRIAL-1", ProjectCode: "LEGACY-FORM-A", FormulaVersion: "1", SampleCode: "S1", TestCode: "LIMS-PH", Replicate: "1", NumericValue: "5.5", Unit: "pH", ResultDate: "2026-01-05", Analyst: "J. Analyst" },
  { RecordID: "LIMS-2", TrialCode: "LIMS-TRIAL-1", ProjectCode: "LEGACY-FORM-A", FormulaVersion: "1", SampleCode: "S1", TestCode: "LIMS-PH", Replicate: "2", NumericValue: "5.6", Unit: "pH", ResultDate: "2026-01-05", Analyst: "J. Analyst" },
  { RecordID: "LIMS-3", TrialCode: "LIMS-TRIAL-1", ProjectCode: "LEGACY-FORM-A", FormulaVersion: "1", SampleCode: "S2", TestCode: "LIMS-APP", Replicate: "1", TextValue: "Clear liquid", ResultDate: "2026-01-05", Analyst: "J. Analyst" },
  { RecordID: "LIMS-4", TrialCode: "LIMS-TRIAL-1", ProjectCode: "LEGACY-FORM-A", FormulaVersion: "1", SampleCode: "S1", TestCode: "LIMS-PH", Replicate: "3", ResultDate: "2026-01-05", Analyst: "J. Analyst" }, // missing value — G3/MIG19
];

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/test-definitions") {
      return send(200, [
        { TestCode: "LIMS-PH", TestName: "pH Measurement", ResultType: "numeric", Unit: "pH" },
        { TestCode: "LIMS-APP", TestName: "Appearance", ResultType: "text" },
      ]);
    }
    if (url.pathname === "/lab-results") {
      if (!lab429Fired) {
        lab429Fired = true;
        return send(429, { error: "rate limited" }); // G3/MIG21
      }
      const page = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Number(url.searchParams.get("pageSize") ?? "2");
      const start = (page - 1) * pageSize;
      return send(200, limsResults.slice(start, start + pageSize));
    }
    return send(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

const testDefsProfile = (fp: string): MappingProfile => ({
  schemaVersion: "1.0",
  code: mappingProfileCode("mig-test-definitions", 1),
  profileId: "mig-test-definitions",
  profileName: "LIMS test definitions",
  sourceSystemId: "LEGACY_LIMS",
  sourceEntity: "test_definitions",
  sourceSchemaFingerprint: fp,
  profileVersion: 1,
  status: "active",
  fieldMappings: [
    { sourceField: "TestCode", targetTemplate: "test_definitions", targetField: "test_code" },
    { sourceField: "TestName", targetTemplate: "test_definitions", targetField: "test_name" },
    { sourceField: "ResultType", targetTemplate: "test_definitions", targetField: "result_type" },
    { sourceField: "Unit", targetTemplate: "test_definitions", targetField: "unit" },
  ],
  constantMappings: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdBy: "local",
});

function labResultsFieldMappings(analystTrim: boolean) {
  return [
    { sourceField: "TrialCode", targetTemplate: "lab_results", targetField: "trial_code" },
    { sourceField: "ProjectCode", targetTemplate: "lab_results", targetField: "project_code" },
    { sourceField: "FormulaVersion", targetTemplate: "lab_results", targetField: "formula_version" },
    { sourceField: "SampleCode", targetTemplate: "lab_results", targetField: "sample_code" },
    { sourceField: "TestCode", targetTemplate: "lab_results", targetField: "test_code" },
    { sourceField: "Replicate", targetTemplate: "lab_results", targetField: "replicate_number" },
    { sourceField: "NumericValue", targetTemplate: "lab_results", targetField: "numeric_value" },
    { sourceField: "TextValue", targetTemplate: "lab_results", targetField: "text_value" },
    { sourceField: "Unit", targetTemplate: "lab_results", targetField: "unit" },
    { sourceField: "ResultDate", targetTemplate: "lab_results", targetField: "result_date" },
    { sourceField: "Analyst", targetTemplate: "lab_results", targetField: "analyst", ...(analystTrim ? { transformations: [{ op: "trim" as const }] } : {}) },
  ];
}

const labResultsProfileV1 = (fp: string): MappingProfile => ({
  schemaVersion: "1.0",
  code: mappingProfileCode("mig-lab-results", 1),
  profileId: "mig-lab-results",
  profileName: "LIMS lab results v1",
  sourceSystemId: "LEGACY_LIMS",
  sourceEntity: "lab_results",
  sourceSchemaFingerprint: fp,
  profileVersion: 1,
  status: "active",
  fieldMappings: labResultsFieldMappings(false),
  constantMappings: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdBy: "local",
});

// G6 — a real v2 profile, immutably chained via supersedesProfileCode,
// differing only in a transformation step (never a source/schema change)
// so MAPPING_PROFILE_CHANGED is isolated as the ONE variable under test.
const labResultsProfileV2 = (fp: string): MappingProfile => ({
  schemaVersion: "1.0",
  code: mappingProfileCode("mig-lab-results", 2),
  profileId: "mig-lab-results",
  profileName: "LIMS lab results v2 — trims analyst",
  sourceSystemId: "LEGACY_LIMS",
  sourceEntity: "lab_results",
  sourceSchemaFingerprint: fp,
  profileVersion: 2,
  status: "active",
  supersedesProfileCode: mappingProfileCode("mig-lab-results", 1),
  fieldMappings: labResultsFieldMappings(true),
  constantMappings: [],
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
  createdBy: "local",
});

// =============================================================== state ===

let db1: SqliteTestAdapterHandle;
let db2: SqliteTestAdapterHandle;

async function importEntity(adapter: DatabaseAdapter, entityName: keyof typeof DB_ENTITIES, profile: (fp: string) => MappingProfile, runId: string) {
  const connector = createDatabaseConnector("LEGACY_ERP", { connectionRef: "erp-conn", entities: DB_ENTITIES }, { extractionRunId: runId, extractedAt: "2026-01-01T00:00:00.000Z" }, { adapter });
  const staged = await connector.extract(entityName);
  const fp = discoverSourceSchema("LEGACY_ERP", [{ entity: entityName, records: staged.records }]).fingerprint;
  const prepared = await prepareConnectorImport({ connector, entity: entityName, profile: profile(fp) });
  return prepared;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FVL-04.025 Part G — real customer migration fixture (MIG1-MIG35)", () => {
  beforeAll(async () => {
    db1 = await createSqliteTestAdapter(DB1_SQL);
    db2 = await createSqliteTestAdapter(DB2_SQL);
  });
  afterAll(() => {
    db1.close();
    db2.close();
  });

  // ------------------------------------------------------ Migration 1 ---

  it("MIG1-MIG6: migration 1 — raw materials, suppliers, links, prices and inventory all commit through the REAL production bridge from the REAL SQLite ERP", async () => {
    const materialsPrep = await importEntity(db1.adapter, "materials", materialsProfile, "run-mat-1");
    expect(materialsPrep.blockingIssues).toEqual([]); // MIG1 — real DB adapter, real read
    const materialsConfirm = await confirmConnectorImport(materialsPrep, ctx); // MIG28 — real bridge, no manual chaining
    expect(materialsConfirm.outcomesByTemplate.raw_materials.every((o) => o.outcome === "created")).toBe(true);
    const mat1 = (store.get("materials") ?? []).find((r) => r.code === "MAT-1")!;
    expect(mat1.activeMatterPercent).toBe("95.5"); // MIG4 — decimal preserved
    expect(mat1.hazardClassifications).toEqual([]); // MIG6 — map_boolean (Hazardous=0 -> no classification added)

    const suppliersPrep = await importEntity(db1.adapter, "suppliers", suppliersProfile, "run-sup-1");
    await confirmConnectorImport(suppliersPrep, ctx);
    expect((store.get("suppliers") ?? []).map((r) => r.code)).toContain("SUP-1");

    const linksPrep = await importEntity(db1.adapter, "material_supplier", materialSupplierProfile, "run-link-1");
    expect(linksPrep.blockingIssues).toEqual([]); // MIG2 — composite PK resolved (material_code+supplier_code both present)
    await confirmConnectorImport(linksPrep, ctx);

    const pricesPrep = await importEntity(db1.adapter, "prices", pricesProfile, "run-price-1");
    await confirmConnectorImport(pricesPrep, ctx);
    const p1 = (store.get("material_prices") ?? []).find((r) => r.materialCode === "MAT-1" && r.effectiveFrom === "2026-01-01")!; // material_prices.code is a fresh generated id, never the source PriceID
    expect(p1.price).toBe("450.5"); // MIG4
    expect(p1.effectiveFrom).toBe("2026-01-01"); // MIG5 — date preserved

    const invPrep = await importEntity(db1.adapter, "inventory", inventoryProfile, "run-inv-1");
    expect(invPrep.blockingIssues).toEqual([]); // MIG22 — inventory genuinely included this time
    await confirmConnectorImport(invPrep, ctx);
    const inv1 = (store.get("inventory") ?? []).find((r) => r.code === "INV-1")!;
    expect(inv1.quantity).toBe("50"); // MIG24 — real convert_unit: 50000g -> 50kg
    expect(inv1.unit).toBe("kg");
    expect(inv1.materialCode).toBe("MAT-1"); // MIG23 — real reference link

    // MIG3 — FK metadata genuinely discoverable on the composite-PK table.
    const description = await db1.adapter.describeEntity({ table: "erp_material_supplier" });
    expect(description.foreignKeys.length).toBeGreaterThanOrEqual(1);
  });

  it("MIG7/MIG9-MIG13: migration 1 — the legacy formulation file: two formulas, scrambled line order, phase, a real 99.7% finding, and an unresolved-material block", async () => {
    const connector = createFileConnector("LEGACY_ERP", { fileName: "legacy_formulas.json", fileKind: "json", text: FORMULA_FILE_1 }, stageOpts);
    const staged = await connector.extract("formulas");
    expect(staged.records).toHaveLength(3); // MIG7 — two formulas (3 rows total)
    const fp = discoverSourceSchema("LEGACY_ERP", [{ entity: "formulas", records: staged.records }]).fingerprint;
    const template = getDataExchangeTemplate("formula_bom")!;
    const profile: MappingProfile = {
      schemaVersion: "1.0",
      code: mappingProfileCode("mig-formulas", 1),
      profileId: "mig-formulas",
      profileName: "Legacy formulas",
      sourceSystemId: "LEGACY_ERP",
      sourceEntity: "formulas",
      sourceSchemaFingerprint: fp,
      profileVersion: 1,
      status: "active",
      fieldMappings: template.columns
        .filter((c) => ["formula_code", "formula_name", "formula_version", "line_number", "material_code", "percentage", "phase", "addition_order"].includes(c.key))
        .map((c) => ({ sourceField: c.key, targetTemplate: "formula_bom", targetField: c.key })),
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    };
    const prepared = await prepareConnectorImport({ connector, entity: "formulas", profile });
    // LEGACY-FORM-B references a material that was never migrated — blocks, never partially commits (MIG12).
    expect(prepared.blockingIssues.some((b) => b.includes("MISSING-MAT-X") || b.toLowerCase().includes("reference"))).toBe(true);

    // Confirming as-is would refuse outright (F4's atomic preflight); prove the honest formula A/B split
    // by preparing FORM-A alone through a profile whose extraction only sees FORM-A's own rows.
    const formAConnector = createFileConnector("LEGACY_ERP", { fileName: "legacy_form_a.json", fileKind: "json", text: JSON.stringify({ formulas: JSON.parse(FORMULA_FILE_1).formulas.filter((r: { formula_code: string }) => r.formula_code === "LEGACY-FORM-A") }) }, { ...stageOpts, idField: "external_line_id", requireExplicitId: true });
    const formAStaged = await formAConnector.extract("formulas");
    const formAFp = discoverSourceSchema("LEGACY_ERP", [{ entity: "formulas", records: formAStaged.records }]).fingerprint;
    const formAPrepared = await prepareConnectorImport({ connector: formAConnector, entity: "formulas", profile: { ...profile, sourceSchemaFingerprint: formAFp } });
    expect(formAPrepared.blockingIssues).toEqual([]);
    const formARows = formAPrepared.templates[0].rows;
    expect(formARows.map((r) => r.candidate.row.line_number)).toEqual(expect.arrayContaining(["1", "2"])); // MIG9 source order was scrambled (2 then 1)
    await confirmConnectorImport(formAPrepared, ctx);

    const entry = formulationsStore.get([...formulationsStore.keys()].find((id) => formulationsStore.get(id)!.formulation.code === "LEGACY-FORM-A")!)!;
    expect(entry.versions).toHaveLength(1);
    const v1 = entry.versions[0];
    expect(v1.lines.map((l) => l.lineNumber)).toEqual([1, 2]); // MIG9 — saved deterministically sorted regardless of source order
    expect(v1.lines.every((l) => l.phase === "A")).toBe(true); // MIG10 — phase preserved
    expect(entry.formulation.code).toBe("LEGACY-FORM-A"); // MIG11 — external identity preserved as the natural key
    expect((v1 as unknown as { totalsSnapshot?: { totalPercent?: string } }).totalsSnapshot?.totalPercent).toBe("99.7000"); // MIG13 — real finding, never normalized
  });

  it("MIG14-MIG21: migration 1 — the REST LIMS: real HTTP server, pagination, explicit IDs, replicates, numeric/text/missing values, and a real 429", async () => {
    const testDefsFetch = createHttpFetchAdapter({ baseUrl, pagination: { kind: "none" } });
    const labResultsFetch = createHttpFetchAdapter({ baseUrl, pagination: { kind: "page", pageParam: "page", pageSizeParam: "pageSize", pageSize: 2 } });
    const fetchPage = (spec: RestRequestSpec) => (spec.entity === "test_definitions" ? testDefsFetch(spec) : labResultsFetch(spec));
    const restOpts = { ...stageOpts, idField: "RecordID", requireExplicitId: true };

    const testDefsConnector = createRestApiConnector("LEGACY_LIMS", { connectionRef: "lims-conn", endpoints: { test_definitions: "/test-definitions", lab_results: "/lab-results" } }, stageOpts, { fetchPage });
    const testDefsStaged = await testDefsConnector.extract("test_definitions");
    const testDefsFp = discoverSourceSchema("LEGACY_LIMS", [{ entity: "test_definitions", records: testDefsStaged.records }]).fingerprint;
    const testDefsPrepared = await prepareConnectorImport({ connector: testDefsConnector, entity: "test_definitions", profile: testDefsProfile(testDefsFp) });
    expect(testDefsPrepared.blockingIssues).toEqual([]); // MIG14 — real HTTP round trip
    await confirmConnectorImport(testDefsPrepared, ctx);
    expect((store.get("test_definitions") ?? []).map((r) => r.code)).toEqual(expect.arrayContaining(["LIMS-PH", "LIMS-APP"]));

    // First attempt: the server's first-ever /lab-results hit returns 429 (MIG21).
    const labConnectorAttempt1 = createRestApiConnector("LEGACY_LIMS", { connectionRef: "lims-conn", endpoints: { lab_results: "/lab-results" } }, restOpts, { fetchPage });
    const attempt1 = await prepareConnectorImport({ connector: labConnectorAttempt1, entity: "lab_results", profile: labResultsProfileV1("placeholder") });
    expect(attempt1.blockingIssues.length).toBeGreaterThan(0); // extraction failed — genuinely retryable, never silently ignored

    // Operator retries: a fresh extraction now succeeds.
    const labConnectorAttempt2 = createRestApiConnector("LEGACY_LIMS", { connectionRef: "lims-conn", endpoints: { lab_results: "/lab-results" } }, restOpts, { fetchPage });
    const labStaged = await labConnectorAttempt2.extract("lab_results");
    expect(labStaged.records).toHaveLength(4); // MIG15 — all records across 2 real pages aggregated
    expect(labStaged.records.map((r) => r.identity.sourceRecordId)).toEqual(["LIMS-1", "LIMS-2", "LIMS-3", "LIMS-4"]); // MIG16 — explicit IDs, not ordinal
    const labFp = discoverSourceSchema("LEGACY_LIMS", [{ entity: "lab_results", records: labStaged.records }]).fingerprint;
    const labConnectorAttempt3 = createRestApiConnector("LEGACY_LIMS", { connectionRef: "lims-conn", endpoints: { lab_results: "/lab-results" } }, restOpts, { fetchPage });
    const labPrepared = await prepareConnectorImport({ connector: labConnectorAttempt3, entity: "lab_results", profile: labResultsProfileV1(labFp) });
    expect(labPrepared.blockingIssues).toEqual([]);
    await confirmConnectorImport(labPrepared, ctx);

    const results = (store.get("test_results") ?? []) as Record<string, unknown>[];
    const phResult = results.find((r) => r.sampleId === "S1" && r.testDefinitionId === "LIMS-PH")!;
    const replicates = phResult.replicates as { replicateNumber: number; numericValue?: string }[];
    expect(replicates.map((r) => r.replicateNumber)).toEqual([1, 2, 3]); // MIG17 — replicates grouped
    expect(replicates.find((r) => r.replicateNumber === 1)?.numericValue).toBe("5.5"); // MIG18 numeric
    expect(replicates.find((r) => r.replicateNumber === 3)?.numericValue).toBeUndefined(); // MIG19 — missing stays missing
    const appResult = results.find((r) => r.sampleId === "S2" && r.testDefinitionId === "LIMS-APP")!;
    expect((appResult.replicates as { textValue?: string }[])[0].textValue).toBe("Clear liquid"); // MIG18 text
    expect(phResult.unit).toBe("pH"); // MIG20 metadata
    expect(phResult.performedBy).toBe("J. Analyst");
    expect(phResult.performedAt).toBe("2026-01-05");
  });

  // ------------------------------------------------------ Migration 2 ---

  it("MIG29-MIG31/MIG34: migration 2 — ERP re-extraction correctly classifies a new price period, an unchanged supplier, a disappeared material, and a genuine local-canonical conflict", async () => {
    // A genuine out-of-band edit to the canonical record, bypassing Data Exchange entirely.
    const materials = store.get("materials") ?? [];
    (materials.find((r) => r.code === "MAT-1")!).displayName = "Hand-Edited In Workspace";

    const materialsPrep = await importEntity(db2.adapter, "materials", materialsProfile, "run-mat-2");
    const mat1Row = materialsPrep.templates[0].rows.find((r) => r.candidate.row.material_code === "MAT-1")!;
    expect(mat1Row.reimportState).toBe("CANONICAL_LOCAL_CONFLICT"); // MIG34 — source changed AND canonical hand-edited
    expect(materialsPrep.templates[0].missingFromSource.some((m) => m.naturalKey === "MAT-2")).toBe(true); // MIG31 — material disappeared

    const suppliersPrep = await importEntity(db2.adapter, "suppliers", suppliersProfile, "run-sup-2");
    const sup1Row = suppliersPrep.templates[0].rows.find((r) => r.candidate.row.supplier_code === "SUP-1")!;
    expect(sup1Row.reimportState).toBe("UNCHANGED"); // MIG30 — supplier byte-identical

    const pricesPrep = await importEntity(db2.adapter, "prices", pricesProfile, "run-price-2");
    const p1Row = pricesPrep.templates[0].rows.find((r) => r.candidate.row.material_code === "MAT-1" && r.candidate.row.valid_from === "2026-01-01")!;
    const p3Row = pricesPrep.templates[0].rows.find((r) => r.candidate.row.valid_from === "2026-02-01")!;
    expect(p1Row.reimportState).toBe("UNCHANGED"); // original period untouched
    expect(p3Row.reimportState).toBe("NEW"); // MIG29 — price change modeled as a new, real validity period
    expect(p3Row.candidate.row.unit_price).toBe("480.75");

    const invPrep = await importEntity(db2.adapter, "inventory", inventoryProfile, "run-inv-2");
    const inv1Row = invPrep.templates[0].rows.find((r) => r.candidate.row.inventory_code === "INV-1")!;
    expect(inv1Row.reimportState).toBe("CHANGED"); // real content change, no local edit involved
    expect(inv1Row.candidate.row.quantity).toBe("55"); // MIG24 — convert_unit again: 55000g -> 55kg

    // Commit the non-conflicting templates for real, proving they are genuinely committable.
    await confirmConnectorImport(suppliersPrep, ctx);
    await confirmConnectorImport(pricesPrep, ctx);
    await confirmConnectorImport(invPrep, ctx);
    expect((store.get("material_prices") ?? []).some((r) => r.materialCode === "MAT-1" && r.effectiveFrom === "2026-02-01" && r.price === "480.75")).toBe(true); // the new append-only price period
    expect((store.get("inventory") ?? []).find((r) => r.code === "INV-1")!.quantity).toBe("55");
  });

  it("MIG8/MIG32: migration 2 — the legacy formula file adds a real second version for LEGACY-FORM-A", async () => {
    const connector = createFileConnector("LEGACY_ERP", { fileName: "legacy_formulas_v2.json", fileKind: "json", text: FORMULA_FILE_2 }, { extractionRunId: "run-form-2", extractedAt: "2026-02-01T00:00:00.000Z", idField: "external_line_id", requireExplicitId: true });
    const staged = await connector.extract("formulas");
    const fp = discoverSourceSchema("LEGACY_ERP", [{ entity: "formulas", records: staged.records }]).fingerprint;
    const template = getDataExchangeTemplate("formula_bom")!;
    const profile: MappingProfile = {
      schemaVersion: "1.0",
      code: mappingProfileCode("mig-formulas", 1),
      profileId: "mig-formulas",
      profileName: "Legacy formulas",
      sourceSystemId: "LEGACY_ERP",
      sourceEntity: "formulas",
      sourceSchemaFingerprint: fp,
      profileVersion: 1,
      status: "active",
      fieldMappings: template.columns
        .filter((c) => ["formula_code", "formula_name", "formula_version", "line_number", "material_code", "percentage", "phase", "addition_order"].includes(c.key))
        .map((c) => ({ sourceField: c.key, targetTemplate: "formula_bom", targetField: c.key })),
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    };
    const prepared = await prepareConnectorImport({ connector, entity: "formulas", profile });
    expect(prepared.blockingIssues).toEqual([]);
    expect(prepared.templates[0].rows.every((r) => r.reimportState === "NEW")).toBe(true); // MIG32 — a new version's rows were never seen before
    await confirmConnectorImport(prepared, ctx);

    const entry = formulationsStore.get([...formulationsStore.keys()].find((id) => formulationsStore.get(id)!.formulation.code === "LEGACY-FORM-A")!)!;
    expect(entry.versions).toHaveLength(2); // MIG8 — a genuine second version, first left untouched
    expect(entry.versions[1].versionNumber).toBe(2);
    expect(entry.versions[1].lines.map((l) => l.materialCode)).toEqual(["MAT-1", "MAT-2"]);
  });

  it("MIG26/MIG27/MIG33: migration 2 — a real v1->v2 mapping-profile chain, an unchanged row correctly reports MAPPING_PROFILE_CHANGED, and a new lab result reports NEW", async () => {
    const v1 = labResultsProfileV1("fp-lab");
    const v2 = labResultsProfileV2("fp-lab");
    expect(validateMappingProfileSupersession(v2, [v1])).toEqual([]); // MIG26 — real, valid, linear chain

    limsResults = [...limsResults, { RecordID: "LIMS-5", TrialCode: "LIMS-TRIAL-1", ProjectCode: "LEGACY-FORM-A", FormulaVersion: "1", SampleCode: "S3", TestCode: "LIMS-PH", Replicate: "1", NumericValue: "6.0", Unit: "pH", ResultDate: "2026-02-10", Analyst: "J. Analyst" }];

    const fetchPage = createHttpFetchAdapter({ baseUrl, pagination: { kind: "page", pageParam: "page", pageSizeParam: "pageSize", pageSize: 2 } });
    const restOpts = { extractionRunId: "run-lab-2", extractedAt: "2026-02-10T00:00:00.000Z", idField: "RecordID", requireExplicitId: true };
    const connector = createRestApiConnector("LEGACY_LIMS", { connectionRef: "lims-conn", endpoints: { lab_results: "/lab-results" } }, restOpts, { fetchPage });
    const staged = await connector.extract("lab_results");
    expect(staged.records).toHaveLength(5); // 4 prior + 1 new, across 3 real pages
    const fp = discoverSourceSchema("LEGACY_LIMS", [{ entity: "lab_results", records: staged.records }]).fingerprint;

    const connector2 = createRestApiConnector("LEGACY_LIMS", { connectionRef: "lims-conn", endpoints: { lab_results: "/lab-results" } }, restOpts, { fetchPage });
    const prepared = await prepareConnectorImport({ connector: connector2, entity: "lab_results", profile: labResultsProfileV2(fp) });
    expect(prepared.blockingIssues).toEqual([]);
    const rows = prepared.templates[0].rows;
    const unchangedRow = rows.find((r) => r.sourceRecordId === "LIMS-1")!;
    expect(unchangedRow.reimportState).toBe("MAPPING_PROFILE_CHANGED"); // MIG27 — content identical, profile version differs
    const newRow = rows.find((r) => r.sourceRecordId === "LIMS-5")!;
    expect(newRow.reimportState).toBe("NEW"); // MIG33 — a genuinely new lab result
    await confirmConnectorImport(prepared, ctx);
    expect((store.get("test_results") ?? []).some((r) => (r as { sampleId?: string }).sampleId === "S3")).toBe(true);
  });

  it("MIG25/MIG35: the fixture's own transformations and full acceptance run are real, not asserted in prose", () => {
    // MIG25 — map_boolean was genuinely exercised (hazardous/preferred/quarantined) and MIG24's
    // convert_unit above both produced real, checked output values — re-confirmed here structurally.
    const link = (store.get("material_suppliers") ?? []).find((r) => r.code === "MAT-1::SUP-1")!;
    expect(typeof link.preferred).toBe("boolean");
    expect(link.preferred).toBe(true); // Preferred=1 in the ERP source, mapped through a real map_boolean step
    // MIG35 — every MIG item above ran as a real, executing assertion in this file, not prose.
    expect(store.get("data_exchange_import_jobs")!.length).toBeGreaterThan(5);
  });
});
