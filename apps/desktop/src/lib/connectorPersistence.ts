/**
 * FVL-04.016/.017 — thin persistence bindings for mapping profiles and the
 * external-ID crosswalk, over the existing masterdata bridge. All real
 * decision logic (profile validation/application, crosswalk resolution/
 * conflict detection) stays in the pure shared-package engines
 * (`mappingProfile.ts`/`crosswalk.ts`) — this file only reads/writes.
 */
import { upsertCrosswalk, type CrosswalkConflict, type ExternalIdCrosswalk, type MappingProfile } from "@formulab/shared";
import { listRecords, upsertRecords, nowIso } from "./masterdata";

export async function loadMappingProfiles(): Promise<MappingProfile[]> {
  return listRecords("mapping_profiles");
}

export async function saveMappingProfile(profile: MappingProfile): Promise<void> {
  await upsertRecords("mapping_profiles", [profile]);
}

export async function loadCrosswalks(): Promise<ExternalIdCrosswalk[]> {
  return listRecords("external_id_crosswalks");
}

/**
 * Persists (or re-confirms) one crosswalk entry after a real Data Exchange
 * commit has produced a real canonical record — never before. On conflict,
 * nothing is written; the conflict is returned for a human to resolve.
 */
export async function persistCrosswalkEntry(params: {
  sourceSystemId: string;
  sourceEntity: string;
  sourceRecordId: string;
  canonicalEntity: string;
  canonicalRecordId: string;
  mappingProfileId?: string;
  mappingProfileVersion?: number;
  sourceFingerprint?: string;
}): Promise<{ record?: ExternalIdCrosswalk; conflict?: CrosswalkConflict }> {
  const existing = await loadCrosswalks();
  const result = upsertCrosswalk(existing, { ...params, now: nowIso() });
  if (result.conflict) return { conflict: result.conflict };
  if (result.record) await upsertRecords("external_id_crosswalks", [result.record]);
  return { record: result.record };
}
