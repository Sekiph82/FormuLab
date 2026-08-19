import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = { listRecords: vi.fn(), upsertRecords: vi.fn() };
vi.mock("./masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

import { mappingProfileCode } from "@formulab/shared";
import { loadCrosswalks, loadMappingProfiles, persistCrosswalkEntry, saveMappingProfile } from "./connectorPersistence";

function profileFixture(overrides: Partial<Parameters<typeof saveMappingProfile>[0]> = {}) {
  return {
    schemaVersion: "1.0" as const,
    code: "",
    profileId: "profile-1",
    profileName: "Test",
    sourceSystemId: "CHT_LIMS",
    sourceEntity: "materials",
    sourceSchemaFingerprint: "abc",
    profileVersion: 1,
    status: "active" as const,
    fieldMappings: [],
    constantMappings: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "local",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listRecords.mockResolvedValue([]);
  bridge.upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
});

describe("connectorPersistence", () => {
  it("persists a new crosswalk entry through the existing masterdata bridge — using an explicitly configured source identity", async () => {
    const { record } = await persistCrosswalkEntry({
      sourceSystemId: "CHT_LIMS",
      sourceEntity: "MATERIAL",
      sourceIdentity: { sourceRecordId: "883729", idSource: "configured" },
      canonicalEntity: "RawMaterial",
      canonicalRecordId: "RM-00291",
    });
    expect(record?.canonicalRecordId).toBe("RM-00291");
    expect(bridge.upsertRecords).toHaveBeenCalledWith("external_id_crosswalks", expect.arrayContaining([expect.objectContaining({ canonicalRecordId: "RM-00291" })]));
  });

  it("a conflicting crosswalk write is never persisted", async () => {
    bridge.listRecords.mockResolvedValue([
      { schemaVersion: "1.0", code: "CHT_LIMS::MATERIAL::883729::RawMaterial", sourceSystemId: "CHT_LIMS", sourceEntity: "MATERIAL", sourceRecordId: "883729", canonicalEntity: "RawMaterial", canonicalRecordId: "RM-00291", firstSeenAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z", status: "active" },
    ]);
    const result = await persistCrosswalkEntry({
      sourceSystemId: "CHT_LIMS",
      sourceEntity: "MATERIAL",
      sourceIdentity: { sourceRecordId: "883729", idSource: "configured" },
      canonicalEntity: "RawMaterial",
      canonicalRecordId: "RM-99999",
    });
    expect(result.conflict).toBeDefined();
    expect(bridge.upsertRecords).not.toHaveBeenCalled();
  });

  describe("FVL-04.017 hardening (Session 7, Part I): ordinal source identity is refused by the API itself, not by caller discipline", () => {
    it("an ordinal idSource is refused before any storage call is ever made", async () => {
      const result = await persistCrosswalkEntry({
        sourceSystemId: "CHT_LIMS",
        sourceEntity: "MATERIAL",
        sourceIdentity: { sourceRecordId: "7", idSource: "ordinal" },
        canonicalEntity: "RawMaterial",
        canonicalRecordId: "RM-00291",
      });
      expect(result.refused).toMatchObject({ code: "ordinal_identity_not_crosswalk_eligible" });
      expect(result.record).toBeUndefined();
      expect(bridge.listRecords).not.toHaveBeenCalled();
      expect(bridge.upsertRecords).not.toHaveBeenCalled();
    });

    it("a configured idSource is accepted and genuinely persists", async () => {
      const result = await persistCrosswalkEntry({
        sourceSystemId: "CHT_LIMS",
        sourceEntity: "MATERIAL",
        sourceIdentity: { sourceRecordId: "883729", idSource: "configured" },
        canonicalEntity: "RawMaterial",
        canonicalRecordId: "RM-00291",
      });
      expect(result.refused).toBeUndefined();
      expect(result.record?.sourceRecordId).toBe("883729");
    });

    it("the same explicit ID re-imported resolves to the same canonical identity", async () => {
      const params = { sourceSystemId: "CHT_LIMS", sourceEntity: "MATERIAL", sourceIdentity: { sourceRecordId: "883729", idSource: "configured" as const }, canonicalEntity: "RawMaterial", canonicalRecordId: "RM-00291" };
      const first = await persistCrosswalkEntry(params);
      bridge.listRecords.mockResolvedValue([first.record]);
      const second = await persistCrosswalkEntry(params);
      expect(second.record?.canonicalRecordId).toBe("RM-00291");
      expect(second.record?.firstSeenAt).toBe(first.record?.firstSeenAt);
    });
  });

  it("saves a mapping profile as-is", async () => {
    await saveMappingProfile(profileFixture());
    expect(bridge.upsertRecords).toHaveBeenCalledWith("mapping_profiles", expect.arrayContaining([expect.objectContaining({ profileId: "profile-1" })]));
  });

  it("loads crosswalks through the existing bridge", async () => {
    bridge.listRecords.mockResolvedValue([{ code: "x" }]);
    const result = await loadCrosswalks();
    expect(result).toEqual([{ code: "x" }]);
    expect(bridge.listRecords).toHaveBeenCalledWith("external_id_crosswalks");
  });

  describe("FVL-04.016 hardening D1/D6/§9: mapping-profile version immutability", () => {
    it("always derives `code` from profileId/profileVersion, never trusting a caller-supplied value that might drift", async () => {
      await saveMappingProfile({ ...profileFixture(), code: "WRONG-CODE-A-CALLER-MIGHT-HAND-IN" });
      const [, records] = bridge.upsertRecords.mock.calls[0];
      expect(records[0].code).toBe(mappingProfileCode("profile-1", 1));
    });

    it("a second save attempting to change v1's own mappings is rejected by the storage layer (simulated append-only bridge)", async () => {
      // Simulates the real masterdata.rs `upsert_master_records` behavior
      // for an append-only collection: a write reusing an existing `code`
      // is rejected outright, never silently merged.
      const persisted: string[] = [];
      bridge.upsertRecords.mockImplementation(async (_collection: string, records: { code: string }[]) => {
        for (const r of records) {
          if (persisted.includes(r.code)) throw new Error(`mapping_profiles record ${r.code} already exists. This collection is append-only.`);
          persisted.push(r.code);
        }
        return { inserted: records.length, updated: 0, total: persisted.length };
      });

      await saveMappingProfile(profileFixture({ fieldMappings: [{ sourceField: "A", targetTemplate: "raw_materials", targetField: "material_code" }] }));
      let caught: unknown;
      try {
        await saveMappingProfile(profileFixture({ fieldMappings: [{ sourceField: "B", targetTemplate: "raw_materials", targetField: "material_code" }] }));
      } catch (e) {
        caught = e;
      }
      expect(String(caught)).toMatch(/already exists/);
    });

    it("a genuinely new version (v2) is accepted as a separate row, and both v1 and v2 remain independently loadable", async () => {
      const persisted: Record<string, unknown>[] = [];
      bridge.upsertRecords.mockImplementation(async (_collection: string, records: Record<string, unknown>[]) => {
        for (const r of records) persisted.push(r);
        return { inserted: records.length, updated: 0, total: persisted.length };
      });
      bridge.listRecords.mockImplementation(async () => persisted);

      // v1's own stored status reflects its status AT CREATION ("active") —
      // it is never rewritten to "superseded" later; that becomes a
      // DERIVED fact once v2 exists (see effectiveMappingProfileStatus in
      // mappingProfile.test.ts's own Part G hardening coverage).
      const v1 = profileFixture({ profileVersion: 1, status: "active" });
      await saveMappingProfile(v1);
      const v2 = profileFixture({ profileVersion: 2, status: "active", supersedesProfileCode: mappingProfileCode("profile-1", 1), fieldMappings: [{ sourceField: "A", targetTemplate: "raw_materials", targetField: "material_code" }] });
      await saveMappingProfile(v2);

      const all = await loadMappingProfiles();
      expect(all).toHaveLength(2);
      expect(all.find((p) => p.code === mappingProfileCode("profile-1", 1))).toMatchObject({ profileVersion: 1, status: "active" });
      expect(all.find((p) => p.code === mappingProfileCode("profile-1", 2))).toMatchObject({ profileVersion: 2, supersedesProfileCode: "profile-1::v1" });
    });
  });
});
