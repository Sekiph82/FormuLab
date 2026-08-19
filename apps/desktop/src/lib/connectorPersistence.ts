/**
 * FVL-04.016/.017 — thin persistence bindings for mapping profiles and the
 * external-ID crosswalk, over the existing masterdata bridge. All real
 * decision logic (profile validation/application, crosswalk resolution/
 * conflict detection) stays in the pure shared-package engines
 * (`mappingProfile.ts`/`crosswalk.ts`) — this file only reads/writes.
 */
import { mappingProfileCode, upsertCrosswalk, validateMappingProfileSupersession, type CrosswalkConflict, type ExternalIdCrosswalk, type MappingProfile } from "@formulab/shared";
import { listRecords, upsertRecords, nowIso } from "./masterdata";

export async function loadMappingProfiles(): Promise<MappingProfile[]> {
  return listRecords("mapping_profiles");
}

/**
 * `mapping_profiles` is registered append-only in `masterdata.rs`, so a
 * second write reusing an existing `code` (`profileId::vN`) is rejected by
 * the storage layer itself — a changed mapping must arrive here as a NEW
 * `profileVersion`, never a same-version overwrite. `code` is always
 * re-derived from `profileId`/`profileVersion` here, defensively, so it can
 * never drift from what the immutable identity actually requires even if a
 * caller constructed the object by hand.
 *
 * FVL-04.016 hardening (Session 7, Part G): before ever reaching storage,
 * `validateMappingProfileSupersession()` checks the new version's own
 * `supersedesProfileCode` linkage (rejects self-supersession, a
 * nonexistent target, cross-family supersession, and an outright
 * already-persisted `code`) against the real, currently-persisted set —
 * a clean, structured rejection instead of relying solely on the storage
 * layer's own generic append-only error text.
 */
export async function saveMappingProfile(profile: MappingProfile): Promise<void> {
  const record: MappingProfile = { ...profile, code: mappingProfileCode(profile.profileId, profile.profileVersion) };
  const existing = await loadMappingProfiles();
  const issues = validateMappingProfileSupersession(record, existing);
  if (issues.length > 0) {
    throw new Error(`Mapping profile "${record.code}" failed version-lifecycle validation: ${issues.map((i) => i.message).join(" ")}`);
  }
  await upsertRecords("mapping_profiles", [record]);
}

export async function loadCrosswalks(): Promise<ExternalIdCrosswalk[]> {
  return listRecords("external_id_crosswalks");
}

export interface CrosswalkRefusal {
  code: string;
  message: string;
}

/**
 * Persists (or re-confirms) one crosswalk entry after a real Data Exchange
 * commit has produced a real canonical record — never before. On conflict,
 * nothing is written; the conflict is returned for a human to resolve.
 *
 * FVL-04.017 hardening (Session 7, Part I) — MANDATORY, API-enforced, not
 * caller-discipline-enforced: `sourceIdentity.idSource` is a REQUIRED part
 * of the call, not an optional hint. When it is `"ordinal"` (a staging-row
 * position, never a real external identifier — see
 * `SourceRecordIdentity`'s own three-tier identity doc comment in
 * `schemas/connector.ts`), persistence is REFUSED outright, before
 * `upsertCrosswalk()` or any storage call ever runs. A prior session only
 * ever avoided this by test-usage convention ("we never called this with
 * an ordinal ID"); this session makes it structurally impossible to call
 * this function with an ordinal identity and have it actually persist.
 */
export async function persistCrosswalkEntry(params: {
  sourceSystemId: string;
  sourceEntity: string;
  sourceIdentity: { sourceRecordId: string; idSource: "configured" | "ordinal" };
  canonicalEntity: string;
  canonicalRecordId: string;
  mappingProfileId?: string;
  mappingProfileVersion?: number;
  sourceFingerprint?: string;
}): Promise<{ record?: ExternalIdCrosswalk; conflict?: CrosswalkConflict; refused?: CrosswalkRefusal }> {
  if (params.sourceIdentity.idSource === "ordinal") {
    return {
      refused: {
        code: "ordinal_identity_not_crosswalk_eligible",
        message: `"${params.sourceIdentity.sourceRecordId}" is a staging-only ordinal position, not an explicit external source ID — a persistent crosswalk was refused rather than built on an identity that isn't real.`,
      },
    };
  }
  const existing = await loadCrosswalks();
  const result = upsertCrosswalk(existing, {
    sourceSystemId: params.sourceSystemId,
    sourceEntity: params.sourceEntity,
    sourceRecordId: params.sourceIdentity.sourceRecordId,
    canonicalEntity: params.canonicalEntity,
    canonicalRecordId: params.canonicalRecordId,
    mappingProfileId: params.mappingProfileId,
    mappingProfileVersion: params.mappingProfileVersion,
    sourceFingerprint: params.sourceFingerprint,
    now: nowIso(),
  });
  if (result.conflict) return { conflict: result.conflict };
  if (result.record) await upsertRecords("external_id_crosswalks", [result.record]);
  return { record: result.record };
}
