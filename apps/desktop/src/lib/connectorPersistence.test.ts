import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = { listRecords: vi.fn(), upsertRecords: vi.fn() };
vi.mock("./masterdata", () => ({
  listRecords: (...a: [string]) => bridge.listRecords(...a),
  upsertRecords: (...a: [string, unknown[]]) => bridge.upsertRecords(...a),
  nowIso: () => "2026-01-01T00:00:00.000Z",
}));

import { loadCrosswalks, persistCrosswalkEntry, saveMappingProfile } from "./connectorPersistence";

beforeEach(() => {
  vi.clearAllMocks();
  bridge.listRecords.mockResolvedValue([]);
  bridge.upsertRecords.mockResolvedValue({ inserted: 1, updated: 0, total: 1 });
});

describe("connectorPersistence", () => {
  it("persists a new crosswalk entry through the existing masterdata bridge", async () => {
    const { record } = await persistCrosswalkEntry({
      sourceSystemId: "CHT_LIMS",
      sourceEntity: "MATERIAL",
      sourceRecordId: "883729",
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
      sourceRecordId: "883729",
      canonicalEntity: "RawMaterial",
      canonicalRecordId: "RM-99999",
    });
    expect(result.conflict).toBeDefined();
    expect(bridge.upsertRecords).not.toHaveBeenCalled();
  });

  it("saves a mapping profile as-is", async () => {
    await saveMappingProfile({
      schemaVersion: "1.0",
      profileId: "profile-1",
      profileName: "Test",
      sourceSystemId: "CHT_LIMS",
      sourceEntity: "materials",
      sourceSchemaFingerprint: "abc",
      profileVersion: 1,
      status: "active",
      fieldMappings: [],
      constantMappings: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "local",
    });
    expect(bridge.upsertRecords).toHaveBeenCalledWith("mapping_profiles", expect.arrayContaining([expect.objectContaining({ profileId: "profile-1" })]));
  });

  it("loads crosswalks through the existing bridge", async () => {
    bridge.listRecords.mockResolvedValue([{ code: "x" }]);
    const result = await loadCrosswalks();
    expect(result).toEqual([{ code: "x" }]);
    expect(bridge.listRecords).toHaveBeenCalledWith("external_id_crosswalks");
  });
});
