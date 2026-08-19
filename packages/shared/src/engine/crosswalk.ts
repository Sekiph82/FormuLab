/**
 * FVL-04.017 — External ID Crosswalk Registry, pure resolution logic.
 * Persistence itself lives desktop-side through the existing masterdata
 * bridge (`external_id_crosswalks`, mirroring every other collection's own
 * pure-engine/desktop-persistence split) — this module never touches
 * storage, only decides what a set of crosswalk records means.
 *
 * Absolutely no fuzzy/name-based matching exists anywhere in this file.
 * The only inputs that ever resolve an identity are the explicit tuple
 * (sourceSystemId, sourceEntity, sourceRecordId, canonicalEntity).
 */
import type { CrosswalkConflict, ExternalIdCrosswalk } from "../schemas/connector";

export function crosswalkCode(sourceSystemId: string, sourceEntity: string, sourceRecordId: string, canonicalEntity: string): string {
  return `${sourceSystemId}::${sourceEntity}::${sourceRecordId}::${canonicalEntity}`;
}

/** The one legitimate identity-resolution lookup: an exact tuple match,
 *  nothing else. Returns the canonical record ID, or `undefined` when
 *  genuinely unresolved — never a best-guess. */
export function resolveCrosswalk(
  crosswalks: ExternalIdCrosswalk[],
  sourceSystemId: string,
  sourceEntity: string,
  sourceRecordId: string,
  canonicalEntity: string,
): string | undefined {
  const code = crosswalkCode(sourceSystemId, sourceEntity, sourceRecordId, canonicalEntity);
  return crosswalks.find((c) => c.code === code && c.status === "active")?.canonicalRecordId;
}

/**
 * Records a new crosswalk relationship, or re-confirms an existing one
 * (bumping `lastSeenAt`) when the same tuple points at the same canonical
 * record again — the deterministic "re-import resolves to the same
 * identity" guarantee FVL-04.023's future incremental re-import will build
 * on. If the same tuple already points at a DIFFERENT canonical record, a
 * conflict is returned instead and nothing is silently overwritten — a
 * human must resolve it.
 */
export function upsertCrosswalk(
  existing: ExternalIdCrosswalk[],
  params: {
    sourceSystemId: string;
    sourceEntity: string;
    sourceRecordId: string;
    canonicalEntity: string;
    canonicalRecordId: string;
    mappingProfileId?: string;
    mappingProfileVersion?: number;
    sourceFingerprint?: string;
    now: string;
  },
): { crosswalks: ExternalIdCrosswalk[]; conflict?: CrosswalkConflict; record?: ExternalIdCrosswalk } {
  const code = crosswalkCode(params.sourceSystemId, params.sourceEntity, params.sourceRecordId, params.canonicalEntity);
  const current = existing.find((c) => c.code === code);

  if (current && current.status === "active" && current.canonicalRecordId !== params.canonicalRecordId) {
    return {
      crosswalks: existing,
      conflict: {
        code,
        sourceSystemId: params.sourceSystemId,
        sourceEntity: params.sourceEntity,
        sourceRecordId: params.sourceRecordId,
        canonicalEntity: params.canonicalEntity,
        existingCanonicalRecordId: current.canonicalRecordId,
        attemptedCanonicalRecordId: params.canonicalRecordId,
      },
    };
  }

  if (current) {
    const updated: ExternalIdCrosswalk = { ...current, lastSeenAt: params.now, sourceFingerprint: params.sourceFingerprint ?? current.sourceFingerprint };
    return { crosswalks: existing.map((c) => (c.code === code ? updated : c)), record: updated };
  }

  const record: ExternalIdCrosswalk = {
    schemaVersion: "1.0",
    code,
    sourceSystemId: params.sourceSystemId,
    sourceEntity: params.sourceEntity,
    sourceRecordId: params.sourceRecordId,
    canonicalEntity: params.canonicalEntity,
    canonicalRecordId: params.canonicalRecordId,
    mappingProfileId: params.mappingProfileId,
    mappingProfileVersion: params.mappingProfileVersion,
    firstSeenAt: params.now,
    lastSeenAt: params.now,
    status: "active",
    sourceFingerprint: params.sourceFingerprint,
  };
  return { crosswalks: [...existing, record], record };
}
