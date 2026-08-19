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
