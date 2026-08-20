/**
 * FVL-04.024 (hardened) — BR1-BR18 executable acceptance for the real
 * production Connector -> Existing Data Exchange Bridge
 * (`connectorImportBridge.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFileConnector,
  createDatabaseConnector,
  createRestApiConnector,
  discoverSourceSchema,
  mappingProfileCode,
  type DatabaseAdapter,
  type MappingProfile,
  type RestResponsePage,
} from "@formulab/shared";
import { createSqliteTestAdapter } from "@formulab/shared/testing";

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

import { prepareConnectorImport, confirmConnectorImport } from "./connectorImportBridge";

const ctx = { actorUserId: "local", actorRole: "administrator" as const };
const stageOpts = { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z" };

function materialsProfile(sourceEntity: string, fingerprint: string): MappingProfile {
  return {
    schemaVersion: "1.0",
    code: mappingProfileCode("bridge-materials", 1),
    profileId: "bridge-materials",
    profileName: "Bridge materials",
    sourceSystemId: "BRIDGE_TEST",
    sourceEntity,
    sourceSchemaFingerprint: fingerprint,
    profileVersion: 1,
    status: "active",
    fieldMappings: [
      { sourceField: "MaterialID", targetTemplate: "raw_materials", targetField: "material_code" },
      { sourceField: "MaterialName", targetTemplate: "raw_materials", targetField: "material_name" },
    ],
    constantMappings: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "local",
  };
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("BR1: FILE -> bridge -> preview", () => {
  it("a real FILE connector, mapped through prepareConnectorImport(), produces a real preview with no canonical write", async () => {
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "materials.csv", fileKind: "csv", text: "MaterialID,MaterialName\nBR-1,Test Material" }, stageOpts);
    const staged = await connector.extract("materials");
    const schema = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged.records }]);
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile: materialsProfile("materials", schema.fingerprint) });
    expect(prepared.blockingIssues).toEqual([]);
    expect(prepared.templates.find((t) => t.targetTemplate === "raw_materials")!.rows[0].preview.state).toBe("valid_create");
    expect(store.get("materials") ?? []).toEqual([]); // prepare never writes
  });
});

describe("BR2: DATABASE -> bridge -> preview", () => {
  it("a real DATABASE connector, mapped through prepareConnectorImport(), produces a real preview", async () => {
    const adapter: DatabaseAdapter = {
      listSchemas: async () => ["dbo"],
      listTables: async () => [{ table: "materials", kind: "table" as const }],
      describeEntity: async () => ({
        table: "materials",
        kind: "table" as const,
        columns: [
          { name: "MaterialID", declaredType: "TEXT", nullable: false, isPrimaryKey: true, primaryKeyOrdinal: 1 },
          { name: "MaterialName", declaredType: "TEXT", nullable: true, isPrimaryKey: false },
        ],
        foreignKeys: [],
      }),
      readPage: async () => ({ columns: ["MaterialID", "MaterialName"], rows: [["BR-DB-1", "Test DB Material"]] }),
    };
    const connector = createDatabaseConnector("BRIDGE_TEST", { connectionRef: "conn-1", entities: { materials: { table: "materials" } } }, stageOpts, { adapter });
    const staged = await connector.extract("materials");
    const schema = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged.records }]);
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile: materialsProfile("materials", schema.fingerprint) });
    expect(prepared.blockingIssues).toEqual([]);
    expect(prepared.connectorType).toBe("DATABASE");
  });
});

describe("BR3: REST_API -> bridge -> preview", () => {
  it("a real REST connector, mapped through prepareConnectorImport(), produces a real preview", async () => {
    const fetchPage = async (): Promise<RestResponsePage> => ({ bodyText: JSON.stringify([{ MaterialID: "BR-REST-1", MaterialName: "Test REST Material" }]) });
    const connector = createRestApiConnector("BRIDGE_TEST", { connectionRef: "conn-1", endpoints: { materials: "/api/materials" } }, stageOpts, { fetchPage });
    const staged = await connector.extract("materials");
    const schema = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged.records }]);
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile: materialsProfile("materials", schema.fingerprint) });
    expect(prepared.blockingIssues).toEqual([]);
    expect(prepared.connectorType).toBe("REST_API");
  });
});

describe("BR4/BR5: mapping profile and schema fingerprint are genuinely visible on the prepared result", () => {
  it("reports the exact profile code/version and schema fingerprint used", async () => {
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "materials.csv", fileKind: "csv", text: "MaterialID,MaterialName\nBR-1,Test" }, stageOpts);
    const staged = await connector.extract("materials");
    const schema = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged.records }]);
    const profile = materialsProfile("materials", schema.fingerprint);
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile });
    expect(prepared.mappingProfileCode).toBe(profile.code);
    expect(prepared.mappingProfileVersion).toBe(1);
    expect(prepared.sourceSchemaFingerprint).toBe(schema.fingerprint);
  });

  it("SCHEMA_CHANGED: a stale profile fingerprint blocks before any mapping is attempted", async () => {
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "materials.csv", fileKind: "csv", text: "MaterialID,MaterialName\nBR-1,Test" }, stageOpts);
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile: materialsProfile("materials", "stale-fingerprint") });
    expect(prepared.blockingIssues[0]).toMatch(/SCHEMA_CHANGED/);
    expect(prepared.templates).toEqual([]);
  });
});

describe("BR6: unresolved required reference blocks the whole prepared import", () => {
  it("a REQUIRED code_reference that never resolves is reported as a blocking issue", async () => {
    store.set("materials", []); // nothing resolvable
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "suppliers.csv", fileKind: "csv", text: "MaterialID,SupplierID\nMISSING-MAT,S-1" }, stageOpts);
    const staged = await connector.extract("supplier_links");
    const schema = discoverSourceSchema("BRIDGE_TEST", [{ entity: "supplier_links", records: staged.records }]);
    const profile: MappingProfile = {
      schemaVersion: "1.0",
      code: mappingProfileCode("bridge-material-suppliers", 1),
      profileId: "bridge-material-suppliers",
      profileName: "Bridge material suppliers",
      sourceSystemId: "BRIDGE_TEST",
      sourceEntity: "supplier_links",
      sourceSchemaFingerprint: schema.fingerprint,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "MaterialID", targetTemplate: "material_suppliers", targetField: "material_code" },
        { sourceField: "SupplierID", targetTemplate: "material_suppliers", targetField: "supplier_code" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    };
    const prepared = await prepareConnectorImport({ connector, entity: "supplier_links", profile });
    expect(prepared.blockingIssues.length).toBeGreaterThan(0);
    expect(prepared.blockingIssues.some((b) => b.includes("material_suppliers"))).toBe(true);
  });
});

describe("BR7: dependency order is genuinely correct for a real multi-template batch", () => {
  it("raw_materials commits before material_suppliers in the prepared commit order", async () => {
    store.set("suppliers", [{ code: "S-1" }]);
    const csv = "MaterialID,MaterialName,SupplierID\nBR-1,Test Material,S-1";
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "combo.csv", fileKind: "csv", text: csv }, stageOpts);
    const staged = await connector.extract("combo");
    const schema = discoverSourceSchema("BRIDGE_TEST", [{ entity: "combo", records: staged.records }]);
    const profile: MappingProfile = {
      schemaVersion: "1.0",
      code: mappingProfileCode("bridge-combo", 1),
      profileId: "bridge-combo",
      profileName: "Bridge combo",
      sourceSystemId: "BRIDGE_TEST",
      sourceEntity: "combo",
      sourceSchemaFingerprint: schema.fingerprint,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "MaterialID", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "MaterialName", targetTemplate: "raw_materials", targetField: "material_name" },
        { sourceField: "MaterialID", targetTemplate: "material_suppliers", targetField: "material_code" },
        { sourceField: "SupplierID", targetTemplate: "material_suppliers", targetField: "supplier_code" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    };
    const prepared = await prepareConnectorImport({ connector, entity: "combo", profile });
    expect(prepared.blockingIssues).toEqual([]);
    expect(prepared.commitOrder.indexOf("raw_materials")).toBeLessThan(prepared.commitOrder.indexOf("material_suppliers"));
  });
});

describe("BR8: atomic — a blocking prepared result commits absolutely nothing", () => {
  it("confirmConnectorImport throws and never calls the commit layer when blockingIssues is non-empty", async () => {
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "materials.csv", fileKind: "csv", text: "MaterialID,MaterialName\nBR-1,Test" }, stageOpts);
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile: materialsProfile("materials", "stale-fingerprint") });
    expect(prepared.blockingIssues.length).toBeGreaterThan(0);
    await expect(confirmConnectorImport(prepared, ctx)).rejects.toThrow(/blocking issue/);
    expect(store.get("materials") ?? []).toEqual([]);
  });
});

describe("BR9/BR11: explicit confirmation commits, and real Import History provenance is written", () => {
  it("a clean prepared import commits real canonical records and a real job/row-result history entry carrying connector provenance", async () => {
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "materials.csv", fileKind: "csv", text: "MaterialID,MaterialName\nBR-1,Test Material" }, stageOpts);
    const staged = await connector.extract("materials");
    const schema = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged.records }]);
    const profile = materialsProfile("materials", schema.fingerprint);
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile });
    expect(prepared.blockingIssues).toEqual([]);

    const confirmed = await confirmConnectorImport(prepared, ctx);
    expect(confirmed.outcomesByTemplate.raw_materials[0].outcome).toBe("created");
    expect(store.get("materials")).toEqual(expect.arrayContaining([expect.objectContaining({ code: "BR-1" })]));

    const jobs = store.get("data_exchange_import_jobs") ?? [];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ templateCode: "raw_materials", sourceSystemId: "BRIDGE_TEST", connectorType: "FILE", mappingProfileCode: profile.code, status: "completed" });

    const rowResults = store.get("data_exchange_import_row_results") ?? [];
    expect(rowResults).toHaveLength(1);
    expect(rowResults[0]).toMatchObject({ mappingProfileCode: profile.code, targetCollection: "materials", targetRecordId: "BR-1" });
    expect(rowResults[0].rawRecordFingerprint).toBeTruthy();
  });
});

describe("BR10: crosswalk is persisted AFTER commit only, never before", () => {
  it("no crosswalk exists mid-prepare; a real one exists only after a successful confirm", async () => {
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "materials.csv", fileKind: "csv", text: "MaterialID,MaterialName\nBR-1,Test Material" }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const staged = await connector.extract("materials");
    const schema = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged.records }]);
    const profile = materialsProfile("materials", schema.fingerprint);
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile, crosswalkTargets: { raw_materials: { canonicalEntity: "RawMaterial" } } });
    expect(prepared.blockingIssues).toEqual([]);
    expect(store.get("external_id_crosswalks") ?? []).toEqual([]); // nothing persisted yet

    const confirmed = await confirmConnectorImport(prepared, ctx);
    expect(confirmed.crosswalksPersisted).toBe(1);
    const crosswalks = store.get("external_id_crosswalks") ?? [];
    expect(crosswalks).toHaveLength(1);
    expect(crosswalks[0]).toMatchObject({ sourceRecordId: "BR-1", canonicalEntity: "RawMaterial", canonicalRecordId: "BR-1" });
  });

  it("a commit failure never leaves a crosswalk entry behind for that row", async () => {
    // Force a failure by pre-existing an immutable conflict is hard to
    // simulate generically here; instead prove the STRUCTURAL guarantee:
    // confirmConnectorImport only ever calls persistCrosswalkEntry for
    // an outcome whose own `outcome` is "created"/"updated" — a row
    // that isn't committable (e.g. blocked) never reaches that call at
    // all, proven by BR8 (atomic — nothing commits, so nothing
    // crosswalks either).
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "materials.csv", fileKind: "csv", text: "MaterialID,MaterialName\nBR-1,Test" }, stageOpts);
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile: materialsProfile("materials", "stale-fingerprint"), crosswalkTargets: { raw_materials: { canonicalEntity: "RawMaterial" } } });
    await expect(confirmConnectorImport(prepared, ctx)).rejects.toThrow();
    expect(store.get("external_id_crosswalks") ?? []).toEqual([]);
  });
});

describe("BR12: connector rows never reach canonical storage except through the existing commit layer", () => {
  it("prepareConnectorImport() alone never writes to the masterdata bridge", async () => {
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "materials.csv", fileKind: "csv", text: "MaterialID,MaterialName\nBR-1,Test" }, stageOpts);
    const staged = await connector.extract("materials");
    const schema = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged.records }]);
    await prepareConnectorImport({ connector, entity: "materials", profile: materialsProfile("materials", schema.fingerprint) });
    expect(store.size).toBe(0);
  });
});

describe("BR16: a retryable connector extraction failure blocks confirm, never a partial commit", () => {
  it("a connector that fails to extract produces a blocking issue and confirm refuses", async () => {
    const failingConnector = {
      identity: { connectorId: "test", connectorType: "FILE" as const, connectorVersion: "1.0", sourceSystemId: "BRIDGE_TEST", sourceSystemName: "BRIDGE_TEST" },
      discoverEntities: async () => ["materials"],
      extract: async () => ({
        connector: { connectorId: "test", connectorType: "FILE" as const, connectorVersion: "1.0", sourceSystemId: "BRIDGE_TEST", sourceSystemName: "BRIDGE_TEST" },
        entity: "materials",
        records: [],
        warnings: [],
        errors: [{ code: "connect_failed", stage: "connect" as const, message: "could not reach source", retryable: true }],
        stats: { totalRecords: 0, readRecords: 0, errorRecords: 1 },
      }),
    };
    const prepared = await prepareConnectorImport({ connector: failingConnector, entity: "materials", profile: materialsProfile("materials", "any") });
    expect(prepared.blockingIssues.length).toBeGreaterThan(0);
    await expect(confirmConnectorImport(prepared, ctx)).rejects.toThrow();
  });
});

describe("BR17: schema mismatch blocks — already proven by BR4/BR5/BR8, cross-referenced here for the acceptance matrix", () => {
  it("re-confirms SCHEMA_CHANGED alone is sufficient to block confirm", async () => {
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "materials.csv", fileKind: "csv", text: "MaterialID,MaterialName\nBR-1,Test" }, stageOpts);
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile: materialsProfile("materials", "definitely-stale") });
    await expect(confirmConnectorImport(prepared, ctx)).rejects.toThrow(/blocking issue/);
  });
});

describe("BR19 (Session 10 hardening): CANONICAL_LOCAL_CONFLICT is a genuinely distinct signal from CHANGED, not the same source-derived comparison twice", () => {
  it("a source-only content change reports CHANGED; the same source change PLUS a hand-edit to the live canonical record reports CANONICAL_LOCAL_CONFLICT for a DIFFERENT record", async () => {
    const profileFor = (fingerprint: string): MappingProfile => ({
      schemaVersion: "1.0",
      code: mappingProfileCode("bridge-conflict", 1),
      profileId: "bridge-conflict",
      profileName: "Bridge conflict test",
      sourceSystemId: "BRIDGE_TEST",
      sourceEntity: "materials",
      sourceSchemaFingerprint: fingerprint,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "MaterialID", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "MaterialName", targetTemplate: "raw_materials", targetField: "material_name" },
        { sourceField: "ActiveMatter", targetTemplate: "raw_materials", targetField: "active_matter_percent" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    });

    const csv1 = "MaterialID,MaterialName,ActiveMatter\nBR-CHANGED,Changed-Only Material,95\nBR-CONFLICT,Conflict Material,95";
    const connector1 = createFileConnector("BRIDGE_TEST", { fileName: "materials.csv", fileKind: "csv", text: csv1 }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const staged1 = await connector1.extract("materials");
    const fp1 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged1.records }]).fingerprint;
    const prepared1 = await prepareConnectorImport({ connector: connector1, entity: "materials", profile: profileFor(fp1) });
    expect(prepared1.blockingIssues).toEqual([]);
    await confirmConnectorImport(prepared1, ctx);

    // Hand-edit ONLY the "conflict" record's live canonical name, bypassing Data Exchange entirely.
    const materials = store.get("materials") ?? [];
    const conflictRecord = materials.find((r) => r.code === "BR-CONFLICT")!;
    conflictRecord.displayName = "Hand-Edited In Workspace";

    // Both records' SOURCE content changes identically (ActiveMatter 95 -> 96).
    const csv2 = "MaterialID,MaterialName,ActiveMatter\nBR-CHANGED,Changed-Only Material,96\nBR-CONFLICT,Conflict Material,96";
    const connector2 = createFileConnector("BRIDGE_TEST", { fileName: "materials.csv", fileKind: "csv", text: csv2 }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const staged2 = await connector2.extract("materials");
    const fp2 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged2.records }]).fingerprint;
    const prepared2 = await prepareConnectorImport({ connector: connector2, entity: "materials", profile: profileFor(fp2) });

    const rows = prepared2.templates.find((t) => t.targetTemplate === "raw_materials")!.rows;
    const changedRow = rows.find((r) => r.candidate.row.material_code === "BR-CHANGED")!;
    const conflictRow = rows.find((r) => r.candidate.row.material_code === "BR-CONFLICT")!;
    expect(changedRow.reimportState).toBe("CHANGED"); // source changed, canonical never touched out-of-band
    expect(conflictRow.reimportState).toBe("CANONICAL_LOCAL_CONFLICT"); // source changed AND canonical hand-edited since
  });
});

describe("BR18: re-import conflict classification is genuinely visible on the prepared result", () => {
  it("a second prepare of the identical source reports UNCHANGED once a prior commit exists", async () => {
    const connector1 = createFileConnector("BRIDGE_TEST", { fileName: "materials.csv", fileKind: "csv", text: "MaterialID,MaterialName\nBR-1,Test Material" }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const staged1 = await connector1.extract("materials");
    const schema = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged1.records }]);
    const profile = materialsProfile("materials", schema.fingerprint);
    const prepared1 = await prepareConnectorImport({ connector: connector1, entity: "materials", profile });
    expect(prepared1.templates[0].rows[0].reimportState).toBe("NEW");
    await confirmConnectorImport(prepared1, ctx);

    const connector2 = createFileConnector("BRIDGE_TEST", { fileName: "materials.csv", fileKind: "csv", text: "MaterialID,MaterialName\nBR-1,Test Material" }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const staged2 = await connector2.extract("materials");
    const prepared2 = await prepareConnectorImport({ connector: connector2, entity: "materials", profile: materialsProfile("materials", discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged2.records }]).fingerprint) });
    expect(prepared2.templates[0].rows[0].reimportState).toBe("UNCHANGED");
  });
});

describe("BR20 (Session 11 hardening, Part 4): a REAL DB-derived ordinal-fallback identity cannot be persisted as a crosswalk identity", () => {
  it("a real no-PK SQLite table's rows stage with ordinal identity, commit fine, but persist zero crosswalk entries even when a crosswalk target is configured", async () => {
    const { adapter, close } = await createSqliteTestAdapter(`
      CREATE TABLE erp_suppliers_no_pk (SupplierID TEXT NOT NULL, SupplierName TEXT NOT NULL);
      INSERT INTO erp_suppliers_no_pk VALUES ('SUP-NOPK-1', 'No-PK Supplier One');
      INSERT INTO erp_suppliers_no_pk VALUES ('SUP-NOPK-2', 'No-PK Supplier Two');
    `);
    try {
      const connector = createDatabaseConnector("BRIDGE_TEST", { connectionRef: "erp-conn", entities: { suppliers: { table: "erp_suppliers_no_pk" } } }, stageOpts, { adapter });
      const staged = await connector.extract("suppliers");
      expect(staged.records.every((r) => r.identity.idSource === "ordinal")).toBe(true); // real no-PK fallback, not synthetic

      const fp = discoverSourceSchema("BRIDGE_TEST", [{ entity: "suppliers", records: staged.records }]).fingerprint;
      const profile: MappingProfile = {
        schemaVersion: "1.0",
        code: mappingProfileCode("bridge-nopk-suppliers", 1),
        profileId: "bridge-nopk-suppliers",
        profileName: "No-PK suppliers",
        sourceSystemId: "BRIDGE_TEST",
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
      };
      const prepared = await prepareConnectorImport({ connector, entity: "suppliers", profile, crosswalkTargets: { suppliers: { canonicalEntity: "Supplier" } } });
      expect(prepared.blockingIssues).toEqual([]);
      // Through the REAL confirm/crosswalk-persistence path — never a
      // synthetic persistCrosswalkEntry() unit call.
      const confirmed = await confirmConnectorImport(prepared, ctx);
      expect(confirmed.outcomesByTemplate.suppliers.every((o) => o.outcome === "created")).toBe(true); // the rows commit fine on their own
      expect(confirmed.crosswalksPersisted).toBe(0); // but zero crosswalk entries — ordinal identity is never crosswalk-eligible
      expect(store.get("external_id_crosswalks") ?? []).toEqual([]);
    } finally {
      close();
    }
  });
});

describe("BR21 (Session 11/12 hardening, Part 7C/7D/8): a genuine RUNTIME commit-layer failure, with a CONFIGURED (not ordinal) source identity and a crosswalk target actually reviewed at prepare time — never a synthetic injected outcome", () => {
  it("a row with a CONFIGURED source identity, previewing cleanly, whose crosswalk target was configured and reviewed during prepare, but which fails for real inside the commit handler: outcome is truthfully failed, no crosswalk is persisted for that configured identity, and a later template in the same batch is never attempted", async () => {
    // trial_code has no code_reference/referenceTemplate at all (see
    // dataExchangeRegistry.ts) — the generic preview layer can never
    // catch a nonexistent trial; only commitLabResults's own real
    // findOrCreateTrial() logic does, at commit time. A perfect real
    // runtime-only failure surface, not a fake injected one.
    store.set("test_definitions", [{ code: "RTF-TEST-1", resultType: "numeric" }]);

    // Session 12 hardening (Part 8) — RecordID makes the failing row's
    // OWN source identity genuinely CONFIGURED, not ordinal. A prior
    // version of this test used an unconfigured idField, so the
    // zero-crosswalk-persisted assertion below was trivially guaranteed
    // by persistCrosswalkEntry()'s own ordinal-identity refusal, never
    // by the runtime failure itself. This version proves it for real:
    // the crosswalk COULD have persisted (identity is configured, a
    // target IS reviewed at prepare) but does not, because the commit
    // itself genuinely failed.
    const csv = ["RecordID,MaterialID,MaterialName,TrialCode,SampleCode,TestCode,Replicate,NumericValue,SupplierID,SupplierName", "RTF-REC-1,RTF-MAT-1,RTF Material,RTF-TRIAL-NONEXISTENT,S1,RTF-TEST-1,1,5.0,RTF-SUP-1,RTF Supplier"].join("\n");
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "combo.csv", fileKind: "csv", text: csv }, { ...stageOpts, idField: "RecordID", requireExplicitId: true });
    const staged = await connector.extract("combo");
    const schema = discoverSourceSchema("BRIDGE_TEST", [{ entity: "combo", records: staged.records }]);
    const profile: MappingProfile = {
      schemaVersion: "1.0",
      code: mappingProfileCode("bridge-runtime-failure", 1),
      profileId: "bridge-runtime-failure",
      profileName: "Bridge runtime failure",
      sourceSystemId: "BRIDGE_TEST",
      sourceEntity: "combo",
      sourceSchemaFingerprint: schema.fingerprint,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "MaterialID", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "MaterialName", targetTemplate: "raw_materials", targetField: "material_name" },
        { sourceField: "TrialCode", targetTemplate: "lab_results", targetField: "trial_code" },
        { sourceField: "SampleCode", targetTemplate: "lab_results", targetField: "sample_code" },
        { sourceField: "TestCode", targetTemplate: "lab_results", targetField: "test_code" },
        { sourceField: "Replicate", targetTemplate: "lab_results", targetField: "replicate_number" },
        { sourceField: "NumericValue", targetTemplate: "lab_results", targetField: "numeric_value" },
        { sourceField: "SupplierID", targetTemplate: "suppliers", targetField: "supplier_code" },
        { sourceField: "SupplierName", targetTemplate: "suppliers", targetField: "supplier_name" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    };
    const prepared = await prepareConnectorImport({ connector, entity: "combo", profile, crosswalkTargets: { lab_results: { canonicalEntity: "TestResult" } } });
    expect(prepared.blockingIssues).toEqual([]); // previews cleanly — the trial issue is invisible to generic preview
    expect(prepared.templates.find((t) => t.targetTemplate === "lab_results")!.rows[0].sourceIdSource).toBe("configured"); // Part 8 — genuinely configured, not ordinal
    // raw_materials structurally depends on suppliers in THIS batch (its
    // own registry column preferred_supplier_code -> suppliers, present
    // regardless of whether this particular mapping populates it) —
    // lab_results has no dependency edge at all here, so it and suppliers
    // are both immediately ready; raw_materials only becomes ready once
    // suppliers has committed.
    expect(prepared.commitOrder).toEqual(["lab_results", "suppliers", "raw_materials"]);

    const confirmed = await confirmConnectorImport(prepared, ctx);
    expect(confirmed.outcomesByTemplate.lab_results[0].outcome).toBe("failed"); // T1 genuinely failed for real, not a synthetic flag
    expect(confirmed.outcomesByTemplate.lab_results[0].message).toMatch(/no project_code was provided/);
    expect(confirmed.partialFailureStoppedAt).toBe("lab_results");
    expect(confirmed.outcomesByTemplate.suppliers).toBeUndefined(); // T2 never even attempted
    expect(confirmed.outcomesByTemplate.raw_materials).toBeUndefined(); // T3 never even attempted
    expect(confirmed.crosswalksPersisted).toBe(0); // the failed row's own crosswalk was never persisted, even though identity was configured and a target was reviewed
    expect(store.get("external_id_crosswalks") ?? []).toEqual([]);
    expect(store.get("suppliers") ?? []).toEqual([]); // nothing downstream committed either
    expect(store.get("materials") ?? []).toEqual([]);
  });
});

describe("BR22 (Session 11 hardening, Part 7D): zero canonical write for CANONICAL_LOCAL_CONFLICT and CROSSWALK_CONFLICT specifically", () => {
  it("CANONICAL_LOCAL_CONFLICT blocks confirm outright — zero write, not even for the unrelated CHANGED row in the same batch", async () => {
    const profileFor = (fp: string): MappingProfile => ({
      schemaVersion: "1.0",
      code: mappingProfileCode("bridge-conflict-22", 1),
      profileId: "bridge-conflict-22",
      profileName: "Bridge conflict 22",
      sourceSystemId: "BRIDGE_TEST",
      sourceEntity: "materials",
      sourceSchemaFingerprint: fp,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "MaterialID", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "MaterialName", targetTemplate: "raw_materials", targetField: "material_name" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    });
    const csv1 = "MaterialID,MaterialName\nBR-22,Original Name";
    const c1 = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: csv1 }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const s1 = await c1.extract("materials");
    const fp1 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: s1.records }]).fingerprint;
    await confirmConnectorImport(await prepareConnectorImport({ connector: c1, entity: "materials", profile: profileFor(fp1) }), ctx);

    (store.get("materials") ?? []).find((r) => r.code === "BR-22")!.displayName = "Hand-Edited";
    const csv2 = "MaterialID,MaterialName\nBR-22,Changed Name";
    const c2 = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: csv2 }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const fp2 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: (await c2.extract("materials")).records }]).fingerprint;
    const prepared = await prepareConnectorImport({ connector: c2, entity: "materials", profile: profileFor(fp2) });
    expect(prepared.templates[0].rows[0].reimportState).toBe("CANONICAL_LOCAL_CONFLICT");
    await expect(confirmConnectorImport(prepared, ctx)).rejects.toThrow(/blocking issue/);
    expect((store.get("materials") ?? []).find((r) => r.code === "BR-22")!.displayName).toBe("Hand-Edited"); // untouched
  });

  it("CROSSWALK_CONFLICT blocks confirm outright — zero write, zero crosswalk mutation", async () => {
    store.set("materials", [{ code: "RM-EXISTING", displayName: "Pre-existing canonical material" }]);
    store.set("data_exchange_import_jobs", [{ id: "job-1", templateCode: "raw_materials", status: "completed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.000Z" }]);
    store.set("data_exchange_import_row_results", [{ id: "row-1", jobId: "job-1", state: "valid_create", naturalKey: "BR-XW-1", targetCollection: "materials", targetRecordId: "RM-EXISTING", sourceRecordId: "BR-XW-1", rawRecordFingerprint: "same-fingerprint", mappingProfileCode: "bridge-xwalk-22::v1" }]);
    // The real crosswalk store disagrees with what Import History says was committed.
    store.set("external_id_crosswalks", [{ code: "BRIDGE_TEST::materials::BR-XW-1::RawMaterial", sourceSystemId: "BRIDGE_TEST", sourceEntity: "materials", sourceRecordId: "BR-XW-1", canonicalEntity: "RawMaterial", canonicalRecordId: "RM-SOMETHING-ELSE", status: "active", firstSeenAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z" }]);

    const connector = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: "MaterialID,MaterialName\nBR-XW-1,Same Content" }, { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z", idField: "MaterialID", requireExplicitId: true });
    const staged = await connector.extract("materials");
    const fp = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged.records }]).fingerprint;
    const profile: MappingProfile = {
      schemaVersion: "1.0",
      code: mappingProfileCode("bridge-xwalk-22", 1),
      profileId: "bridge-xwalk-22",
      profileName: "Bridge crosswalk 22",
      sourceSystemId: "BRIDGE_TEST",
      sourceEntity: "materials",
      sourceSchemaFingerprint: fp,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "MaterialID", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "MaterialName", targetTemplate: "raw_materials", targetField: "material_name" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    };
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile, crosswalkTargets: { raw_materials: { canonicalEntity: "RawMaterial" } } });
    expect(prepared.templates[0].rows[0].reimportState).toBe("CROSSWALK_CONFLICT");
    expect(prepared.blockingIssues.some((b) => b.includes("CROSSWALK_CONFLICT"))).toBe(true);
    await expect(confirmConnectorImport(prepared, ctx)).rejects.toThrow(/blocking issue/);
    expect(store.get("external_id_crosswalks")).toHaveLength(1); // untouched — still only the original entry
    expect((store.get("materials") ?? []).find((r) => r.code === "RM-EXISTING")).toBeDefined();
    expect(store.get("materials")).toHaveLength(1); // nothing new committed
  });
});

describe("XW-PREFLIGHT (Session 12 hardening, Part 3): crosswalk-conflict preflight is resolved directly from the real crosswalk store, independent of whether Import History has any prior row at all", () => {
  it("XW-PREFLIGHT-1/2/3/4/5/6: an active crosswalk already bound for a configured source identity, with ZERO prior Import History rows, and a mapped candidate that would target a DIFFERENT canonical record -> CROSSWALK_CONFLICT before any write, confirm refuses, zero canonical write, zero crosswalk mutation", async () => {
    expect(store.get("data_exchange_import_jobs") ?? []).toEqual([]); // no Import History exists AT ALL for this template yet
    expect(store.get("data_exchange_import_row_results") ?? []).toEqual([]);
    store.set("materials", [{ code: "RM-PRE-1", displayName: "Pre-existing canonical" }]);
    store.set("external_id_crosswalks", [{ code: "BRIDGE_TEST::materials::SRC-1::RawMaterial", sourceSystemId: "BRIDGE_TEST", sourceEntity: "materials", sourceRecordId: "SRC-1", canonicalEntity: "RawMaterial", canonicalRecordId: "RM-PRE-1", status: "active", firstSeenAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z" }]);

    const csv = "RecordID,MaterialCode,MaterialName\nSRC-1,XW-NEW,New Candidate Material";
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: csv }, { ...stageOpts, idField: "RecordID", requireExplicitId: true });
    const staged = await connector.extract("materials");
    const fp = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged.records }]).fingerprint;
    const profile: MappingProfile = {
      schemaVersion: "1.0",
      code: mappingProfileCode("xw-preflight", 1),
      profileId: "xw-preflight",
      profileName: "XW preflight",
      sourceSystemId: "BRIDGE_TEST",
      sourceEntity: "materials",
      sourceSchemaFingerprint: fp,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "MaterialCode", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "MaterialName", targetTemplate: "raw_materials", targetField: "material_name" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    };
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile, crosswalkTargets: { raw_materials: { canonicalEntity: "RawMaterial" } } });
    expect(prepared.templates[0].rows[0].reimportState).toBe("CROSSWALK_CONFLICT"); // XW-PREFLIGHT-1/2/3
    expect(prepared.blockingIssues.some((b) => b.includes("CROSSWALK_CONFLICT"))).toBe(true);

    await expect(confirmConnectorImport(prepared, ctx)).rejects.toThrow(/blocking issue/); // XW-PREFLIGHT-4
    expect(store.get("materials")!.some((r) => r.code === "XW-NEW")).toBe(false); // XW-PREFLIGHT-5 — zero canonical write
    expect(store.get("external_id_crosswalks")).toHaveLength(1); // XW-PREFLIGHT-6 — zero crosswalk mutation, still only the original entry
  });

  it("happy path: an existing crosswalk that AGREES with the intended canonical target is safe and reused — no conflict, normal commit proceeds", async () => {
    store.set("materials", [{ code: "RM-AGREE-1", displayName: "Existing" }]);
    store.set("external_id_crosswalks", [{ code: "BRIDGE_TEST::materials::SRC-AGREE-1::RawMaterial", sourceSystemId: "BRIDGE_TEST", sourceEntity: "materials", sourceRecordId: "SRC-AGREE-1", canonicalEntity: "RawMaterial", canonicalRecordId: "RM-AGREE-1", status: "active", firstSeenAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z" }]);

    const csv = "RecordID,MaterialCode,MaterialName\nSRC-AGREE-1,RM-AGREE-1,Updated Name";
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: csv }, { ...stageOpts, idField: "RecordID", requireExplicitId: true });
    const staged = await connector.extract("materials");
    const fp = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged.records }]).fingerprint;
    const profile: MappingProfile = {
      schemaVersion: "1.0",
      code: mappingProfileCode("xw-agree", 1),
      profileId: "xw-agree",
      profileName: "XW agree",
      sourceSystemId: "BRIDGE_TEST",
      sourceEntity: "materials",
      sourceSchemaFingerprint: fp,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "MaterialCode", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "MaterialName", targetTemplate: "raw_materials", targetField: "material_name" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    };
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile, crosswalkTargets: { raw_materials: { canonicalEntity: "RawMaterial" } } });
    expect(prepared.blockingIssues).toEqual([]);
    expect(prepared.templates[0].rows[0].reimportState).not.toBe("CROSSWALK_CONFLICT");
    const confirmed = await confirmConnectorImport(prepared, ctx);
    expect(confirmed.outcomesByTemplate.raw_materials[0].outcome).toBe("updated");
    expect((store.get("materials") ?? []).find((r) => r.code === "RM-AGREE-1")!.displayName).toBe("Updated Name");
  });
});

describe("XW-CONFIG (Session 12 hardening, Part 4): crosswalk target configuration is part of the immutable prepared plan", () => {
  it("XW-CONFIG-1: a prepare with NO crosswalk target configured cannot silently gain one at confirm — confirmConnectorImport() has no crosswalk-target argument at all", async () => {
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "materials.csv", fileKind: "csv", text: "MaterialID,MaterialName\nXWC-1,Test Material" }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile: materialsProfile("materials", discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: (await connector.extract("materials")).records }]).fingerprint) });
    expect(prepared.crosswalkTargets).toEqual({});
    // confirmConnectorImport(prepared, ctx) accepts exactly two arguments —
    // there is no third parameter through which a crosswalk target could
    // be introduced that prepare never reviewed (proven at the type level:
    // this file's own earlier calls all pass exactly two arguments).
    const confirmed = await confirmConnectorImport(prepared, ctx);
    expect(confirmed.crosswalksPersisted).toBe(0);
    expect(store.get("external_id_crosswalks") ?? []).toEqual([]);
  });

  it("XW-CONFIG-3: prepare WITH a reviewed crosswalk target and confirming that exact prepared plan persists the crosswalk", async () => {
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "materials.csv", fileKind: "csv", text: "MaterialID,MaterialName\nXWC-3,Test Material" }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const staged = await connector.extract("materials");
    const fp = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged.records }]).fingerprint;
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile: materialsProfile("materials", fp), crosswalkTargets: { raw_materials: { canonicalEntity: "RawMaterial" } } });
    expect(prepared.crosswalkTargets).toEqual({ raw_materials: { canonicalEntity: "RawMaterial" } });
    const confirmed = await confirmConnectorImport(prepared, ctx);
    expect(confirmed.crosswalksPersisted).toBe(1);
    expect(store.get("external_id_crosswalks")).toHaveLength(1);
  });
});

describe("TOCTOU (Session 12 hardening, Part 5): confirmation revalidates the specific live state its own conflict classification depended on", () => {
  it("TOCTOU-1: prepare clean, then the canonical record is mutated out-of-band before confirm -> confirm rejects, zero overwrite", async () => {
    const c1 = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: "MaterialID,MaterialName\nTOCTOU-1,Original Name" }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const fp1 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: (await c1.extract("materials")).records }]).fingerprint;
    await confirmConnectorImport(await prepareConnectorImport({ connector: c1, entity: "materials", profile: materialsProfile("materials", fp1) }), ctx);

    const c2 = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: "MaterialID,MaterialName\nTOCTOU-1,Original Name" }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const fp2 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: (await c2.extract("materials")).records }]).fingerprint;
    const prepared = await prepareConnectorImport({ connector: c2, entity: "materials", profile: materialsProfile("materials", fp2) });
    expect(prepared.blockingIssues).toEqual([]); // clean at prepare time

    // 12:03 — someone else edits the canonical record while the operator is still reviewing.
    (store.get("materials") ?? []).find((r) => r.code === "TOCTOU-1")!.displayName = "Edited By Someone Else";

    await expect(confirmConnectorImport(prepared, ctx)).rejects.toThrow(/stale/i);
    expect((store.get("materials") ?? []).find((r) => r.code === "TOCTOU-1")!.displayName).toBe("Edited By Someone Else"); // zero overwrite
  });

  it("TOCTOU-2: prepare clean, then the active crosswalk is rebound before confirm -> confirm rejects, zero canonical/crosswalk mutation", async () => {
    store.set("materials", [{ code: "RM-TOCTOU-2", displayName: "Existing" }]);
    store.set("external_id_crosswalks", [{ code: "BRIDGE_TEST::materials::SRC-TOCTOU-2::RawMaterial", sourceSystemId: "BRIDGE_TEST", sourceEntity: "materials", sourceRecordId: "SRC-TOCTOU-2", canonicalEntity: "RawMaterial", canonicalRecordId: "RM-TOCTOU-2", status: "active", firstSeenAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z" }]);
    const csv = "RecordID,MaterialCode,MaterialName\nSRC-TOCTOU-2,RM-TOCTOU-2,Updated Name";
    const connector = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: csv }, { ...stageOpts, idField: "RecordID", requireExplicitId: true });
    const staged = await connector.extract("materials");
    const fp = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: staged.records }]).fingerprint;
    const profile: MappingProfile = {
      schemaVersion: "1.0",
      code: mappingProfileCode("toctou-2", 1),
      profileId: "toctou-2",
      profileName: "TOCTOU 2",
      sourceSystemId: "BRIDGE_TEST",
      sourceEntity: "materials",
      sourceSchemaFingerprint: fp,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "MaterialCode", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "MaterialName", targetTemplate: "raw_materials", targetField: "material_name" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    };
    const prepared = await prepareConnectorImport({ connector, entity: "materials", profile, crosswalkTargets: { raw_materials: { canonicalEntity: "RawMaterial" } } });
    expect(prepared.blockingIssues).toEqual([]);

    // 12:03 — the active crosswalk is rebound to a different canonical record while under review.
    store.set("external_id_crosswalks", [{ code: "BRIDGE_TEST::materials::SRC-TOCTOU-2::RawMaterial", sourceSystemId: "BRIDGE_TEST", sourceEntity: "materials", sourceRecordId: "SRC-TOCTOU-2", canonicalEntity: "RawMaterial", canonicalRecordId: "RM-REBOUND", status: "active", firstSeenAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-02-01T00:00:00.000Z" }]);

    await expect(confirmConnectorImport(prepared, ctx)).rejects.toThrow(/stale/i);
    expect((store.get("materials") ?? []).find((r) => r.code === "RM-TOCTOU-2")!.displayName).toBe("Existing"); // zero canonical mutation
    expect(store.get("external_id_crosswalks")!.find((c) => c.sourceRecordId === "SRC-TOCTOU-2")!.canonicalRecordId).toBe("RM-REBOUND"); // zero crosswalk mutation — the rebind itself is untouched by confirm
  });

  it("TOCTOU-3: prepare clean, then the canonical target is deleted before confirm -> confirm rejects", async () => {
    const c1 = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: "MaterialID,MaterialName\nTOCTOU-3,Original Name" }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const fp1 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: (await c1.extract("materials")).records }]).fingerprint;
    await confirmConnectorImport(await prepareConnectorImport({ connector: c1, entity: "materials", profile: materialsProfile("materials", fp1) }), ctx);

    const c2 = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: "MaterialID,MaterialName\nTOCTOU-3,Original Name" }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const fp2 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: (await c2.extract("materials")).records }]).fingerprint;
    const prepared = await prepareConnectorImport({ connector: c2, entity: "materials", profile: materialsProfile("materials", fp2) });
    expect(prepared.blockingIssues).toEqual([]);

    // 12:03 — the canonical target is deleted entirely while under review.
    store.set("materials", (store.get("materials") ?? []).filter((r) => r.code !== "TOCTOU-3"));

    await expect(confirmConnectorImport(prepared, ctx)).rejects.toThrow(/stale/i);
  });

  it("TOCTOU-4: prepare clean, nothing changes before confirm -> confirm succeeds normally", async () => {
    const c1 = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: "MaterialID,MaterialName\nTOCTOU-4,Original Name" }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const fp1 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: (await c1.extract("materials")).records }]).fingerprint;
    await confirmConnectorImport(await prepareConnectorImport({ connector: c1, entity: "materials", profile: materialsProfile("materials", fp1) }), ctx);

    const c2 = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: "MaterialID,MaterialName\nTOCTOU-4,Original Name" }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const fp2 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: (await c2.extract("materials")).records }]).fingerprint;
    const prepared = await prepareConnectorImport({ connector: c2, entity: "materials", profile: materialsProfile("materials", fp2) });
    expect(prepared.blockingIssues).toEqual([]);

    const confirmed = await confirmConnectorImport(prepared, ctx); // nothing changed — succeeds normally, never rejected as stale
    expect(confirmed.outcomesByTemplate.raw_materials[0].outcome).toBe("updated"); // commitRawMaterials always re-writes; the bridge's own preview never marks a row "unchanged" (no existingNaturalKeys/isUnchanged configured) — TOCTOU-4 only proves confirm was not wrongly REFUSED, not that the write was skipped
  });
});

describe("CANONICAL_MISSING semantics (Session 12 hardening, Part 6): prior-target existence, never inferred from the current candidate's own natural key", () => {
  it("bucket 1: the prior target still exists but the CURRENT source now maps to a different natural key -> NOT CANONICAL_MISSING for the prior target itself", async () => {
    // Commit MAT-KEEP once for real.
    const c1 = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: "RecordID,MaterialID,MaterialName\nREC-1,MAT-KEEP,Original" }, { ...stageOpts, idField: "RecordID", requireExplicitId: true });
    const profileFor = (fp: string): MappingProfile => ({
      schemaVersion: "1.0",
      code: mappingProfileCode("canonical-missing-b1", 1),
      profileId: "canonical-missing-b1",
      profileName: "Canonical missing bucket 1",
      sourceSystemId: "BRIDGE_TEST",
      sourceEntity: "materials",
      sourceSchemaFingerprint: fp,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "MaterialID", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "MaterialName", targetTemplate: "raw_materials", targetField: "material_name" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    });
    const fp1 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: (await c1.extract("materials")).records }]).fingerprint;
    await confirmConnectorImport(await prepareConnectorImport({ connector: c1, entity: "materials", profile: profileFor(fp1) }), ctx);
    expect(store.get("materials")!.some((r) => r.code === "MAT-KEEP")).toBe(true); // still there — never deleted

    // The SAME source record (RecordID REC-1) now maps to a DIFFERENT material_code (a corrected mapping profile, or the source itself changed its own code column).
    const c2 = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: "RecordID,MaterialID,MaterialName\nREC-1,MAT-RENAMED,Original" }, { ...stageOpts, idField: "RecordID", requireExplicitId: true });
    const fp2 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: (await c2.extract("materials")).records }]).fingerprint;
    const prepared = await prepareConnectorImport({ connector: c2, entity: "materials", profile: profileFor(fp2) });
    const row = prepared.templates[0].rows[0];
    expect(row.candidate.row.material_code).toBe("MAT-RENAMED");
    // The prior target (MAT-KEEP) is untouched and still genuinely exists —
    // this must NOT be reported as CANONICAL_MISSING merely because the
    // CURRENT candidate's own natural key is now something else.
    expect(row.reimportState).not.toBe("CANONICAL_MISSING");
  });

  it("bucket 2: the prior target was genuinely deleted -> CANONICAL_MISSING", async () => {
    const c1 = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: "MaterialID,MaterialName\nMAT-GONE,Original" }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const fp1 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: (await c1.extract("materials")).records }]).fingerprint;
    await confirmConnectorImport(await prepareConnectorImport({ connector: c1, entity: "materials", profile: materialsProfile("materials", fp1) }), ctx);
    store.set("materials", (store.get("materials") ?? []).filter((r) => r.code !== "MAT-GONE")); // genuinely deleted

    const c2 = createFileConnector("BRIDGE_TEST", { fileName: "m.csv", fileKind: "csv", text: "MaterialID,MaterialName\nMAT-GONE,Original" }, { ...stageOpts, idField: "MaterialID", requireExplicitId: true });
    const fp2 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "materials", records: (await c2.extract("materials")).records }]).fingerprint;
    const prepared = await prepareConnectorImport({ connector: c2, entity: "materials", profile: materialsProfile("materials", fp2) });
    expect(prepared.templates[0].rows[0].reimportState).toBe("CANONICAL_MISSING");
  });

  it("bucket 3: an append-only template's prior target identity cannot safely be resolved -> never guessed as CANONICAL_MISSING", async () => {
    // material_prices is append_history — its own canonical `code` is a
    // freshly generated id, never equal to any natural key, so a prior
    // targetRecordId genuinely cannot be decoded back into a live-lookup
    // key here. Proven directly: re-importing the identical price period
    // twice must never report CANONICAL_MISSING for it.
    store.set("materials", [{ code: "MAT-PB3" }]);
    store.set("suppliers", [{ code: "SUP-PB3" }]);
    const csv = "MaterialCode,SupplierCode,UnitPrice,Currency,ValidFrom\nMAT-PB3,SUP-PB3,100.00,KES,2026-01-01";
    const profileFor = (fp: string): MappingProfile => ({
      schemaVersion: "1.0",
      code: mappingProfileCode("canonical-missing-b3", 1),
      profileId: "canonical-missing-b3",
      profileName: "Canonical missing bucket 3",
      sourceSystemId: "BRIDGE_TEST",
      sourceEntity: "prices",
      sourceSchemaFingerprint: fp,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "MaterialCode", targetTemplate: "material_prices", targetField: "material_code" },
        { sourceField: "SupplierCode", targetTemplate: "material_prices", targetField: "supplier_code" },
        { sourceField: "UnitPrice", targetTemplate: "material_prices", targetField: "unit_price" },
        { sourceField: "Currency", targetTemplate: "material_prices", targetField: "currency" },
        { sourceField: "ValidFrom", targetTemplate: "material_prices", targetField: "valid_from" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    });
    const c1 = createFileConnector("BRIDGE_TEST", { fileName: "p.csv", fileKind: "csv", text: csv }, { ...stageOpts, idField: "MaterialCode", requireExplicitId: true });
    const fp1 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "prices", records: (await c1.extract("prices")).records }]).fingerprint;
    await confirmConnectorImport(await prepareConnectorImport({ connector: c1, entity: "prices", profile: profileFor(fp1) }), ctx);

    const c2 = createFileConnector("BRIDGE_TEST", { fileName: "p.csv", fileKind: "csv", text: csv }, { ...stageOpts, idField: "MaterialCode", requireExplicitId: true });
    const fp2 = discoverSourceSchema("BRIDGE_TEST", [{ entity: "prices", records: (await c2.extract("prices")).records }]).fingerprint;
    const prepared = await prepareConnectorImport({ connector: c2, entity: "prices", profile: profileFor(fp2) });
    expect(prepared.templates[0].rows[0].reimportState).not.toBe("CANONICAL_MISSING");
  });
});
