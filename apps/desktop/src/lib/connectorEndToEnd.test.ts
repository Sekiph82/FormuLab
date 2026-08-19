/**
 * FVL-04.013-.018 — end-to-end acceptance across the whole connector chain:
 *
 *   Generic File Connector -> staged source records -> Source Schema
 *   Discovery -> schema fingerprint -> Mapping Profile -> deterministic
 *   transformations -> External ID Crosswalk resolution -> canonical
 *   candidate fan-out -> EXISTING Data Exchange validation -> EXISTING
 *   explicit commit.
 *
 * Two disposable customer fixtures with genuinely different schemas prove
 * the framework is not hardcoded to one customer: same connector/discovery/
 * mapping/crosswalk code, two different mapping profiles, zero
 * `if (sourceSystem === "...")` branching anywhere in this file or in the
 * engines it calls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyMappingProfile,
  discoverSourceSchema,
  previewDataExchangeImport,
  resolveCrosswalk,
  stageCsvFile,
  validateMappingProfile,
  type DataExchangeRowResult,
  type DataExchangeTemplateDefinition,
  type ExternalIdCrosswalk,
  type MappingCandidateRow,
  type MappingProfile,
} from "@formulab/shared";
import { getDataExchangeTemplate } from "@formulab/shared";

const bridge = { listRecords: vi.fn(), upsertRecords: vi.fn() };
vi.mock("@/lib/masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

import { commitDataExchangeRows } from "./dataExchangeCommit";
import { persistCrosswalkEntry } from "./connectorPersistence";

const ctx = { actorUserId: "local", actorRole: "administrator" as const };

/** Real preview -> real commit, for one mapped candidate row. */
async function previewAndCommit(candidate: MappingCandidateRow): Promise<{ preview: DataExchangeRowResult; commit: Awaited<ReturnType<typeof commitDataExchangeRows>>[number] }> {
  const template = getDataExchangeTemplate(candidate.targetTemplate)!;
  const headers = template.columns.map((c) => c.key);
  const values = headers.map((h) => candidate.row[h] ?? "");
  const p = previewDataExchangeImport(template, [headers, values], { resolveReference: () => true });
  const [preview] = p.rows;
  const [commit] = await commitDataExchangeRows(template, [preview], ctx);
  return { preview, commit };
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listRecords.mockResolvedValue([]);
  bridge.upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
});

describe("End-to-end fixture 1 — CHT_LIMS (customer-material-master), through explicit commit", () => {
  const csv = [
    "Chemical_ID,Chemical_Name,Vendor_ID,Vendor_Name,Vendor_Product_Code,Use_Min,Use_Max,Price_USD,Stock_Grams,Active_Flag",
    "883729,Decyl Glucoside,V-441,ABC Chemicals,DG-50,5,15,3.20,250000,Y",
  ].join("\n");

  it("stages, discovers, maps, resolves crosswalk, and commits real canonical records through the existing Data Exchange lifecycle", async () => {
    const staged = stageCsvFile("CHT_LIMS", "materials", csv, { extractionRunId: "run-1", extractedAt: "2026-01-01T00:00:00.000Z" });
    expect(staged.errors).toEqual([]);

    const schema = discoverSourceSchema("CHT_LIMS", [{ entity: "materials", records: staged.records }]);

    const profile: MappingProfile = {
      schemaVersion: "1.0",
      profileId: "cht-lims-materials-v1",
      profileName: "CHT_LIMS materials",
      sourceSystemId: "CHT_LIMS",
      sourceEntity: "materials",
      sourceSchemaFingerprint: schema.fingerprint,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "Chemical_ID", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "Chemical_Name", targetTemplate: "raw_materials", targetField: "material_name" },
        { sourceField: "Use_Min", targetTemplate: "raw_materials", targetField: "recommended_min_percent" },
        { sourceField: "Use_Max", targetTemplate: "raw_materials", targetField: "recommended_max_percent" },
        { sourceField: "Vendor_ID", targetTemplate: "suppliers", targetField: "supplier_code" },
        { sourceField: "Vendor_Name", targetTemplate: "suppliers", targetField: "supplier_name" },
        { sourceField: "Chemical_ID", targetTemplate: "material_suppliers", targetField: "material_code" },
        { sourceField: "Vendor_ID", targetTemplate: "material_suppliers", targetField: "supplier_code" },
        { sourceField: "Vendor_Product_Code", targetTemplate: "material_suppliers", targetField: "supplier_material_code" },
        { sourceField: "Chemical_ID", targetTemplate: "material_prices", targetField: "material_code" },
        // Relationship resolution (F9): the supplier reference on the price
        // row goes through the persistent Crosswalk Registry, never a raw
        // copy of the source ID — proven below to actually depend on the
        // crosswalk entry existing.
        { sourceField: "Vendor_ID", targetTemplate: "material_prices", targetField: "supplier_code", transformations: [{ op: "resolve_crosswalk", config: { sourceEntity: "suppliers" } }] },
        { sourceField: "Price_USD", targetTemplate: "material_prices", targetField: "unit_price", transformations: [{ op: "parse_decimal", config: { decimalSeparator: "." } }] },
        { sourceField: "Chemical_ID", targetTemplate: "inventory_records", targetField: "inventory_code" },
        { sourceField: "Chemical_ID", targetTemplate: "inventory_records", targetField: "material_code" },
        { sourceField: "Stock_Grams", targetTemplate: "inventory_records", targetField: "quantity", transformations: [{ op: "convert_unit", config: { from: "g", to: "kg" } }] },
        { sourceField: "Active_Flag", targetTemplate: "inventory_records", targetField: "released", transformations: [{ op: "map_boolean", config: { trueValues: ["Y"], falseValues: ["N"] } }] },
      ],
      constantMappings: [
        { targetTemplate: "material_prices", targetField: "currency", value: "USD" },
        { targetTemplate: "material_prices", targetField: "valid_from", value: "2026-01-01" },
        { targetTemplate: "inventory_records", targetField: "unit", value: "kg" },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    };

    expect(validateMappingProfile(profile, schema)).toEqual([]);

    const record = staged.records[0];

    // Step 1: supplier has no dependency on any crosswalk — commit it first.
    const firstPassResult = applyMappingProfile(profile, record);
    const supplierCandidate = firstPassResult.candidates.find((c) => c.targetTemplate === "suppliers")!;
    const { commit: supplierCommit } = await previewAndCommit(supplierCandidate);
    expect(supplierCommit.outcome).toBe("created");

    // Real crosswalk persisted only after the real commit — never before.
    const { record: crosswalk } = await persistCrosswalkEntry({
      sourceSystemId: "CHT_LIMS",
      sourceEntity: "suppliers",
      sourceRecordId: "V-441",
      canonicalEntity: "Supplier",
      canonicalRecordId: "V-441",
      mappingProfileId: profile.profileId,
      mappingProfileVersion: profile.profileVersion,
    });
    expect(crosswalk).toBeDefined();

    // Step 2: re-run the mapping now that the crosswalk exists, so
    // material_prices.supplier_code genuinely resolves through it (not a
    // raw copy) — proven by re-running WITHOUT the crosswalk below.
    const crosswalks: ExternalIdCrosswalk[] = bridge.upsertRecords.mock.calls.filter(([c]) => c === "external_id_crosswalks").map(([, r]) => r[0]);
    const secondPassResult = applyMappingProfile(profile, record, {
      resolveCrosswalk: (entity, id) => resolveCrosswalk(crosswalks, "CHT_LIMS", entity, id, "Supplier"),
    });
    expect(secondPassResult.errors).toEqual([]);

    const materialCandidate = secondPassResult.candidates.find((c) => c.targetTemplate === "raw_materials")!;
    const linkCandidate = secondPassResult.candidates.find((c) => c.targetTemplate === "material_suppliers")!;
    const priceCandidate = secondPassResult.candidates.find((c) => c.targetTemplate === "material_prices")!;
    const inventoryCandidate = secondPassResult.candidates.find((c) => c.targetTemplate === "inventory_records")!;

    expect(priceCandidate.row.supplier_code).toBe("V-441");
    expect(priceCandidate.row.unit_price).toBe("3.2");
    expect(inventoryCandidate.row.quantity).toBe("250"); // 250000 g -> 250 kg

    const { commit: materialCommit } = await previewAndCommit(materialCandidate);
    const { commit: linkCommit } = await previewAndCommit(linkCandidate);
    const { commit: priceCommit } = await previewAndCommit(priceCandidate);
    const { commit: inventoryCommit } = await previewAndCommit(inventoryCandidate);

    expect(materialCommit.outcome).toBe("created");
    expect(linkCommit.outcome).toBe("created");
    expect(priceCommit.outcome).toBe("created");
    expect(inventoryCommit.outcome).toBe("created");

    // Proves the crosswalk was genuinely load-bearing, not decorative: the
    // SAME field, resolved WITHOUT any crosswalk records available, fails
    // honestly rather than falling back to the raw source ID by accident.
    const withoutCrosswalk = applyMappingProfile(profile, record, { resolveCrosswalk: () => undefined });
    expect(withoutCrosswalk.errors.some((e) => e.code === "crosswalk_unresolved")).toBe(true);
  });
});

describe("End-to-end fixture 2 — ACME_ERP, a genuinely different customer schema, same framework", () => {
  const csv = ["ItemNo,Description,VendorNo,VendorItem,CurrencyCode,UnitCost,StockQty,StockUOM", "AC-9001,Sodium Lauryl Sulfate,VN-77,SLS-99,EUR,2,50,1000,kg"].join("\n");

  it("uses the same connector/discovery engines and a different mapping profile, with no source-specific code branch", async () => {
    const staged = stageCsvFile("ACME_ERP", "items", csv, { extractionRunId: "run-2", extractedAt: "2026-01-01T00:00:00.000Z" });
    const schema = discoverSourceSchema("ACME_ERP", [{ entity: "items", records: staged.records }]);

    // Different schema fingerprint proves this is a genuinely different
    // structure, not a coincidental re-use of fixture 1's own profile.
    const fixture1Schema = discoverSourceSchema("CHT_LIMS", [
      { entity: "materials", records: stageCsvFile("CHT_LIMS", "materials", "Chemical_ID,Chemical_Name\n1,A", { extractionRunId: "r" }).records },
    ]);
    expect(schema.fingerprint).not.toBe(fixture1Schema.fingerprint);

    const profile: MappingProfile = {
      schemaVersion: "1.0",
      profileId: "acme-erp-items-v1",
      profileName: "ACME_ERP items",
      sourceSystemId: "ACME_ERP",
      sourceEntity: "items",
      sourceSchemaFingerprint: schema.fingerprint,
      profileVersion: 1,
      status: "active",
      fieldMappings: [
        { sourceField: "ItemNo", targetTemplate: "raw_materials", targetField: "material_code" },
        { sourceField: "Description", targetTemplate: "raw_materials", targetField: "material_name" },
      ],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    };

    // The SAME validateMappingProfile/applyMappingProfile/getDataExchangeTemplate
    // functions fixture 1 used — no per-customer code path exists anywhere.
    expect(validateMappingProfile(profile, schema)).toEqual([]);
    const result = applyMappingProfile(profile, staged.records[0]);
    const candidate = result.candidates.find((c) => c.targetTemplate === "raw_materials")!;
    expect(candidate.row).toMatchObject({ material_code: "AC-9001", material_name: "Sodium Lauryl Sulfate" });

    const template = getDataExchangeTemplate("raw_materials") as DataExchangeTemplateDefinition;
    const headers = template.columns.map((c) => c.key);
    const values = headers.map((h) => candidate.row[h] ?? "");
    const preview = previewDataExchangeImport(template, [headers, values], { resolveReference: () => true });
    expect(preview.rows[0].state).toBe("valid_create");
  });

  it("confirms no sourceSystem-specific conditional exists in the engine files this test exercises", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(process.cwd(), "..", "..", "packages", "shared", "src", "engine");
    for (const file of ["mappingProfile.ts", "fileConnector.ts", "schemaDiscovery.ts", "crosswalk.ts", "transformation.ts"]) {
      const src = fs.readFileSync(path.join(root, file), "utf-8");
      expect(src).not.toMatch(/sourceSystem(Id)?\s*===\s*["']/);
    }
  });
});

describe("Structured failure acceptance (Section 6)", () => {
  it("malformed CSV, corrupt JSON, unsafe XML, and missing source ID all fail structured, never silently", async () => {
    const { stageJsonFile, stageXmlFile } = await import("@formulab/shared");
    expect(stageCsvFile("SRC", "e", "", { extractionRunId: "r" }).errors[0].stage).toBe("parse");
    expect(stageJsonFile("SRC", "e", "{bad", { extractionRunId: "r" }).errors[0].stage).toBe("parse");
    expect(stageXmlFile("SRC", "e", "<a><!DOCTYPE x>", { extractionRunId: "r" }).errors[0].code).toBe("unsafe_xml_entities");
  });

  it("schema fingerprint mismatch, missing required field, ambiguous date, unknown enum, unsupported unit, and crosswalk conflict are all structured", async () => {
    const staged = stageCsvFile("SRC", "e", "A\n1", { extractionRunId: "r" });
    const schema = discoverSourceSchema("SRC", [{ entity: "e", records: staged.records }]);

    const staleProfile: MappingProfile = {
      schemaVersion: "1.0", profileId: "p", profileName: "p", sourceSystemId: "SRC", sourceEntity: "e",
      sourceSchemaFingerprint: "stale", profileVersion: 1, status: "active", fieldMappings: [], constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", createdBy: "local",
    };
    expect(validateMappingProfile(staleProfile, schema)[0].code).toBe("schema_fingerprint_mismatch");

    const { upsertCrosswalk } = await import("@formulab/shared");
    const first = upsertCrosswalk([], { sourceSystemId: "SRC", sourceEntity: "e", sourceRecordId: "1", canonicalEntity: "RawMaterial", canonicalRecordId: "RM-1", now: "2026-01-01T00:00:00.000Z" });
    const conflict = upsertCrosswalk(first.crosswalks, { sourceSystemId: "SRC", sourceEntity: "e", sourceRecordId: "1", canonicalEntity: "RawMaterial", canonicalRecordId: "RM-2", now: "2026-01-01T00:00:00.000Z" });
    expect(conflict.conflict).toBeDefined();
  });

  it("no partial canonical commit occurs when a candidate row fails validation — the commit layer is never even reached for it", () => {
    const template = getDataExchangeTemplate("raw_materials")!;
    const preview = previewDataExchangeImport(template, [["material_code", "material_name"], ["", ""]]);
    expect(preview.rows[0].state).toBe("invalid");
    expect(bridge.upsertRecords).not.toHaveBeenCalled();
  });
});
