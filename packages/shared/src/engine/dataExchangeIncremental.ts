/**
 * FVL-04.023 — Incremental Re-import / Conflict Handling.
 *
 * Most of what this task asks for already exists, reused here rather
 * than reimplemented: "same external record maps to the same canonical
 * identity" and "detect mapping conflicts" are the EXISTING External ID
 * Crosswalk's own job (`crosswalk.ts`'s `resolveCrosswalk()`/
 * `upsertCrosswalk()`, proven XW1-XW9 — a conflicting write is refused,
 * never silently overwritten). "New vs updated vs unchanged" and "no
 * duplicate canonical records" are the EXISTING Data Exchange preview's
 * own job (`dataExchangeValidation.ts`'s natural-key-driven
 * `valid_create`/`valid_update`/`unchanged` classification). "Dry-run/
 * preview before commit" and "preserve import batch/job lineage" are the
 * EXISTING `data_exchange_import_jobs`/`data_exchange_import_row_results`
 * import-history model. None of that is duplicated here.
 *
 * The one genuinely missing piece: nothing anywhere detected a source
 * record that existed in a PRIOR import batch for this template but is
 * ABSENT from the CURRENT one — a real signal the source record may
 * have been deleted, renamed, or moved upstream. `detectMissingFromSource()`
 * is a pure, non-destructive comparison against the prior batch's own
 * natural keys, read from the EXISTING import-history model (never a
 * second batch-tracking store). It never deletes, archives, or mutates a
 * canonical record — that decision belongs to a human; this only
 * surfaces a structured finding for review, the same "detect and
 * surface, never auto-act on a destructive inference" discipline every
 * other Data Exchange classification already follows.
 */
import type { DataExchangeRowState } from "../schemas/dataExchange";
import { fingerprint } from "./connectorFingerprint";

/** The exact committable-state set the real production dialog already
 *  uses (`DataExchangeImportDialog.tsx`) — defined once here and
 *  imported by the dialog, rather than a second hand-rolled literal. A
 *  row only ever had a real canonical presence to go missing FROM if it
 *  was in one of these states AND actually reached a target collection. */
export const COMMITTABLE_ROW_STATES: readonly DataExchangeRowState[] = ["valid_create", "valid_update", "unchanged", "warning"];

export interface PriorCommittedRow {
  naturalKey: string;
  jobId: string;
  targetCollection?: string;
  targetRecordId?: string;
  /** FVL-04.023 hardening (Part E) — present only for connector-sourced
   *  rows (a hand-authored/direct-CSV row never sets these). See
   *  `classifyReimport()` below. */
  sourceRecordId?: string;
  rawRecordFingerprint?: string;
  mappingProfileCode?: string;
  canonicalCandidateFingerprint?: string;
}

export interface MissingFromSourceFinding {
  naturalKey: string;
  /** The prior job this natural key was last seen committed in. */
  lastSeenJobId: string;
  targetCollection?: string;
  targetRecordId?: string;
}

/**
 * `priorCommittedRows` — every committed row result from the MOST
 * RECENT COMPLETED job for this exact template (the caller's own job,
 * never a merge across multiple historical jobs — an older job's
 * presence is superseded by the newer job's own presence/absence of the
 * same key). `currentBatchNaturalKeys` — every natural key present in
 * THIS preview, regardless of row state: a key that reappears even as
 * `invalid` this time still means the record wasn't dropped from the
 * source, only that this particular re-submission has a problem — a
 * different, already-surfaced signal (the row's own `invalid` state),
 * not a "missing from source" one.
 */
export function detectMissingFromSource(priorCommittedRows: PriorCommittedRow[], currentBatchNaturalKeys: Set<string>): MissingFromSourceFinding[] {
  const seen = new Set<string>();
  const findings: MissingFromSourceFinding[] = [];
  for (const row of priorCommittedRows) {
    if (!row.naturalKey || seen.has(row.naturalKey)) continue;
    seen.add(row.naturalKey);
    if (!currentBatchNaturalKeys.has(row.naturalKey)) {
      findings.push({ naturalKey: row.naturalKey, lastSeenJobId: row.jobId, targetCollection: row.targetCollection, targetRecordId: row.targetRecordId });
    }
  }
  return findings;
}

/**
 * FVL-04.023 hardening (Part E) — the deterministic per-record
 * re-import state model. Repository-convention naming (matching
 * `DATA_EXCHANGE_ROW_STATES`'s own SCREAMING_SNAKE-adjacent style where
 * the brief itself specified it). Nine states total; the five listed
 * here are computed PER RECORD by `classifyReimport()` below.
 * `SCHEMA_CHANGED` (a whole profile/entity is blocked before any
 * per-record classification runs — see `checkSchemaCompatible()`),
 * `SOURCE_MISSING` (the existing `detectMissingFromSource()` above),
 * and `CROSSWALK_CONFLICT` (the EXISTING `upsertCrosswalk()`'s own
 * `CrosswalkConflict` return, `crosswalk.ts`, never reimplemented here)
 * are each a different signal computed at a different level, combined
 * by the bridge — never a single monolithic per-record function trying
 * to own all nine.
 */
export const REIMPORT_STATES = ["NEW", "UNCHANGED", "CHANGED", "CANONICAL_MISSING", "MAPPING_PROFILE_CHANGED", "CANONICAL_LOCAL_CONFLICT", "SCHEMA_CHANGED", "SOURCE_MISSING", "CROSSWALK_CONFLICT"] as const;
export type ReimportState = (typeof REIMPORT_STATES)[number];

export interface ReimportClassificationInput {
  /** This record's CURRENT raw content fingerprint (the same
   *  `StagedSourceRecord.lineage.rawRecordFingerprint` every connector
   *  already computes — never a second hashing scheme). */
  rawRecordFingerprint: string;
  /** The exact immutable `MappingProfile.code` (`profileId::vN`) this
   *  extraction is being mapped through. */
  mappingProfileCode: string;
  /** The current canonical candidate's own deterministic fingerprint —
   *  see `fingerprintCanonicalCandidate()` below. Only meaningful when
   *  `prior` exists; omitted when the caller has no candidate yet
   *  (e.g. the row is itself unresolved/blocked). */
  canonicalCandidateFingerprint?: string;
  /** The prior committed row-result for this EXACT `sourceRecordId`
   *  (read from the existing import-history model), or `undefined` if
   *  this source record was never committed before. */
  prior?: PriorCommittedRow;
  /** Whether the canonical record `prior.targetRecordId` names still
   *  genuinely exists right now. Only meaningful when `prior` exists
   *  and has a `targetRecordId` — the caller looks this up against real
   *  current canonical storage, never guessed. */
  canonicalStillExists?: boolean;
  /** The canonical target's OWN fingerprint AS IT STANDS RIGHT NOW
   *  (computed the same way as `canonicalCandidateFingerprint`, from the
   *  record's real current fields) — compared against
   *  `prior.canonicalCandidateFingerprint` to detect a local edit since
   *  the last import. Only meaningful when `prior` exists. */
  canonicalCurrentFingerprint?: string;
}

/**
 * Deterministic per-record classification. Precedence (most severe /
 * most specific first — a record is never silently the "safer" of two
 * simultaneously-true classifications):
 *
 *   1. no prior commit at all              -> NEW
 *   2. prior committed target no longer exists -> CANONICAL_MISSING
 *   3. source changed AND canonical was locally edited since the prior
 *      import (E6, mandatory)              -> CANONICAL_LOCAL_CONFLICT
 *   4. this extraction's mapping profile differs from the prior one
 *      that produced the currently-committed candidate (E3 — checked
 *      regardless of whether the source content itself changed, "never
 *      silently treat this as unchanged") -> MAPPING_PROFILE_CHANGED
 *   5. source content changed              -> CHANGED
 *   6. otherwise                           -> UNCHANGED
 */
export function classifyReimport(input: ReimportClassificationInput): ReimportState {
  if (!input.prior) return "NEW";

  if (input.prior.targetRecordId && input.canonicalStillExists === false) return "CANONICAL_MISSING";

  const sourceChanged = input.prior.rawRecordFingerprint !== undefined && input.prior.rawRecordFingerprint !== input.rawRecordFingerprint;
  const canonicalLocallyEdited =
    input.prior.canonicalCandidateFingerprint !== undefined &&
    input.canonicalCurrentFingerprint !== undefined &&
    input.prior.canonicalCandidateFingerprint !== input.canonicalCurrentFingerprint;

  if (sourceChanged && canonicalLocallyEdited) return "CANONICAL_LOCAL_CONFLICT";

  if (input.prior.mappingProfileCode !== undefined && input.prior.mappingProfileCode !== input.mappingProfileCode) return "MAPPING_PROFILE_CHANGED";

  if (sourceChanged) return "CHANGED";

  return "UNCHANGED";
}

/**
 * A deterministic fingerprint of a canonical CANDIDATE row (the mapped
 * output about to be — or previously — committed), reusing the SAME
 * FNV-1a `fingerprint()` every other content fingerprint in this
 * codebase already uses (`connectorFingerprint.ts`) — never a second
 * hashing scheme. Sorts keys first so field ORDER in the object never
 * changes the fingerprint, only field VALUES do.
 */
export function fingerprintCanonicalCandidate(row: Record<string, string>): string {
  const sorted = Object.keys(row)
    .sort()
    .reduce<Record<string, string>>((acc, k) => {
      acc[k] = row[k];
      return acc;
    }, {});
  return fingerprint(JSON.stringify(sorted));
}

/**
 * FVL-04.023 hardening (Part E4) — a whole mapping profile/entity is
 * blocked from automatic reuse when the profile's own recorded
 * `sourceSchemaFingerprint` no longer matches the CURRENT source
 * structure. This mirrors `validateMappingProfile()`'s own existing
 * `schema_fingerprint_mismatch` check (`mappingProfile.ts`) — never a
 * second fingerprint-comparison implementation, just exposed here under
 * the SCHEMA_CHANGED name this task's own state model uses, for callers
 * that want the boolean/state directly rather than a validation issue
 * array.
 */
export function isSchemaChanged(profileSourceSchemaFingerprint: string, currentSourceSchemaFingerprint: string): boolean {
  return profileSourceSchemaFingerprint !== currentSourceSchemaFingerprint;
}
