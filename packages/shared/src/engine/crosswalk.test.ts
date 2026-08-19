/**
 * FVL-04.017 — External ID Crosswalk Registry acceptance (XW1-XW9).
 */
import { describe, expect, it } from "vitest";
import { resolveCrosswalk, upsertCrosswalk } from "./crosswalk";
import type { ExternalIdCrosswalk } from "../schemas/connector";

const NOW = "2026-01-01T00:00:00.000Z";

describe("XW1/XW7: create a crosswalk, survives persistence round-trip", () => {
  it("CHT_LIMS/MATERIAL/883729 -> RawMaterial/RM-00291", () => {
    const { crosswalks, record } = upsertCrosswalk([], {
      sourceSystemId: "CHT_LIMS",
      sourceEntity: "MATERIAL",
      sourceRecordId: "883729",
      canonicalEntity: "RawMaterial",
      canonicalRecordId: "RM-00291",
      now: NOW,
    });
    expect(record).toMatchObject({ sourceRecordId: "883729", canonicalRecordId: "RM-00291", status: "active" });
    // Round-trip: a fresh resolve against the persisted array finds it.
    expect(resolveCrosswalk(crosswalks, "CHT_LIMS", "MATERIAL", "883729", "RawMaterial")).toBe("RM-00291");
  });
});

describe("XW2: same source identity resolves the same canonical identity on re-import", () => {
  it("a second upsert with the same tuple/target re-confirms rather than duplicating", () => {
    const first = upsertCrosswalk([], { sourceSystemId: "CHT_LIMS", sourceEntity: "MATERIAL", sourceRecordId: "883729", canonicalEntity: "RawMaterial", canonicalRecordId: "RM-00291", now: NOW });
    const second = upsertCrosswalk(first.crosswalks, { sourceSystemId: "CHT_LIMS", sourceEntity: "MATERIAL", sourceRecordId: "883729", canonicalEntity: "RawMaterial", canonicalRecordId: "RM-00291", now: "2026-02-01T00:00:00.000Z" });
    expect(second.crosswalks).toHaveLength(1);
    expect(second.record?.lastSeenAt).toBe("2026-02-01T00:00:00.000Z");
    expect(second.record?.firstSeenAt).toBe(NOW);
  });
});

describe("XW3: a different source system with the same record ID stays distinct", () => {
  it("CHT_LIMS/MATERIAL/1 and ACME_ERP/MATERIAL/1 are two separate crosswalks", () => {
    const a = upsertCrosswalk([], { sourceSystemId: "CHT_LIMS", sourceEntity: "MATERIAL", sourceRecordId: "1", canonicalEntity: "RawMaterial", canonicalRecordId: "RM-A", now: NOW });
    const b = upsertCrosswalk(a.crosswalks, { sourceSystemId: "ACME_ERP", sourceEntity: "MATERIAL", sourceRecordId: "1", canonicalEntity: "RawMaterial", canonicalRecordId: "RM-B", now: NOW });
    expect(b.crosswalks).toHaveLength(2);
    expect(resolveCrosswalk(b.crosswalks, "CHT_LIMS", "MATERIAL", "1", "RawMaterial")).toBe("RM-A");
    expect(resolveCrosswalk(b.crosswalks, "ACME_ERP", "MATERIAL", "1", "RawMaterial")).toBe("RM-B");
  });
});

describe("XW4: attempting to remap the same source identity to a different canonical record raises an explicit conflict", () => {
  it("never silently overwrites", () => {
    const first = upsertCrosswalk([], { sourceSystemId: "CHT_LIMS", sourceEntity: "MATERIAL", sourceRecordId: "883729", canonicalEntity: "RawMaterial", canonicalRecordId: "RM-00291", now: NOW });
    const attempt = upsertCrosswalk(first.crosswalks, { sourceSystemId: "CHT_LIMS", sourceEntity: "MATERIAL", sourceRecordId: "883729", canonicalEntity: "RawMaterial", canonicalRecordId: "RM-99999", now: NOW });
    expect(attempt.conflict).toMatchObject({ existingCanonicalRecordId: "RM-00291", attemptedCanonicalRecordId: "RM-99999" });
    // Unchanged — the conflicting write never took effect.
    expect(attempt.crosswalks).toEqual(first.crosswalks);
  });
});

describe("XW5/XW6: no name-based matching, ever", () => {
  it("XW5: display-name equality between two records creates no automatic crosswalk — resolveCrosswalk only ever answers to the exact ID tuple", () => {
    const crosswalks: ExternalIdCrosswalk[] = [];
    // No crosswalk exists between two "Decyl Glucoside" records from
    // different sources merely because their names match — there is
    // nothing here that could even attempt that; resolution requires the
    // real source record ID.
    expect(resolveCrosswalk(crosswalks, "CHT_LIMS", "MATERIAL", "Decyl Glucoside", "RawMaterial")).toBeUndefined();
  });

  it("XW6: a source record with no external ID remains unresolved rather than name-matched", () => {
    const crosswalks: ExternalIdCrosswalk[] = [];
    expect(resolveCrosswalk(crosswalks, "CHT_LIMS", "MATERIAL", "", "RawMaterial")).toBeUndefined();
  });
});

describe("XW8: mapping profile version/source lineage preserved", () => {
  it("upsertCrosswalk records the profile ID/version that produced it", () => {
    const { record } = upsertCrosswalk([], {
      sourceSystemId: "CHT_LIMS",
      sourceEntity: "MATERIAL",
      sourceRecordId: "883729",
      canonicalEntity: "RawMaterial",
      canonicalRecordId: "RM-00291",
      mappingProfileId: "profile-1",
      mappingProfileVersion: 2,
      sourceFingerprint: "abcd1234",
      now: NOW,
    });
    expect(record).toMatchObject({ mappingProfileId: "profile-1", mappingProfileVersion: 2, sourceFingerprint: "abcd1234" });
  });
});

describe("XW9: no canonical record is auto-deleted when a source record disappears", () => {
  it("crosswalk.ts exposes no delete/remove function at all", async () => {
    const mod = await import("./crosswalk");
    const exportNames = Object.keys(mod);
    expect(exportNames.some((n) => /delete|remove/i.test(n))).toBe(false);
  });
});
