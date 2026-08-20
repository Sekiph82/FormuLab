/**
 * FVL-04.024 (hardened) — the actual production Connector -> Existing
 * Data Exchange Bridge. Session 9 proved the chain worked by manually
 * chaining connector -> discovery -> mapping -> preview -> commit
 * INSIDE tests; nothing outside a test ever called that sequence as one
 * real operation. This module is that one real operation:
 * `prepareConnectorImport()` / `confirmConnectorImport()`.
 *
 * `prepareConnectorImport()` orchestrates, in order: connector
 * extraction -> Source Schema Discovery -> schema-fingerprint
 * compatibility check -> mapping-profile structural validation ->
 * `applyMappingProfile()` -> per-target-template dependency ordering
 * (`connectorImportBridge.ts`, shared) -> the EXISTING per-template
 * reference resolver/preview (`buildReferenceResolver()`/
 * `previewDataExchangeImport()`) -> incremental re-import classification
 * (`classifyReimport()`/`detectMissingFromSource()`). It NEVER writes
 * to canonical storage — the returned `PreparedConnectorImport` is a
 * structured, inspectable plan, not a side effect.
 *
 * `confirmConnectorImport()` requires that exact prepared result plus
 * explicit actor context, and does nothing but call the EXISTING
 * `commitDataExchangeRows()` (`dataExchangeCommit.ts`) per target
 * template in the prepared commit order, then persist crosswalk entries
 * ONLY for rows that just committed successfully. No alternate write
 * path exists anywhere in this file — every canonical write still goes
 * through the one real commit authority.
 */
import {
  applyMappingProfile,
  classifyReimport,
  detectMissingFromSource,
  discoverSourceSchema,
  fingerprintCanonicalCandidate,
  getDataExchangeTemplate,
  isSchemaChanged,
  newId,
  planImportOrder,
  previewDataExchangeImport,
  resolveColumnReferenceField,
  validateMappingProfile,
  type ApprovalRole,
  type DataExchangeImportJob,
  type DataExchangeImportRowResult,
  type DataExchangeRowResult,
  type MappingCandidateRow,
  type MappingProfile,
  type MappingProfileValidationIssue,
  type PriorCommittedRow,
  type ReimportState,
  type SourceConnector,
} from "@formulab/shared";
import { buildReferenceResolver, loadLiveCandidateFields, loadPriorCommittedRows } from "./dataExchangeExisting";
import { commitDataExchangeRows, type DataExchangeRowCommitOutcome } from "./dataExchangeCommit";
import { persistCrosswalkEntry } from "./connectorPersistence";
import { upsertRecords, nowIso } from "./masterdata";

/** entity name -> the two field-level requirements a template's own
 *  `code_reference` columns need, mirroring the EXACT logic
 *  `DataExchangeImportDialog.tsx` and `connectorEndToEnd.test.ts`
 *  already use — one real authority (`resolveColumnReferenceField`),
 *  never a fourth copy of this loop. */
function referenceRequirementsFor(template: ReturnType<typeof getDataExchangeTemplate> & object) {
  return template.columns
    .filter((c) => c.dataType === "code_reference" && c.referenceTemplate)
    .map((c) => {
      const resolved = resolveColumnReferenceField(c);
      return "field" in resolved ? { referenceTemplate: c.referenceTemplate!, referenceField: resolved.field } : null;
    })
    .filter((r): r is { referenceTemplate: string; referenceField: string } => r !== null);
}

export interface CrosswalkTarget {
  /** The canonical entity name to persist a crosswalk under for rows
   *  committed to this target template (e.g. `"RawMaterial"`) — never
   *  guessed; the caller (a real migration's own connector config)
   *  names it explicitly, the same discipline `resolve_crosswalk`'s own
   *  `canonicalEntity` config already requires. */
  canonicalEntity: string;
}

export interface PreparedRow {
  candidate: MappingCandidateRow;
  /** The staged source record's own real identity/content — present
   *  only when the connector extraction produced one (it always does),
   *  carried through so `confirmConnectorImport()` can persist a
   *  crosswalk entry AFTER a successful commit, and so incremental
   *  classification has real data to compare against. */
  sourceRecordId: string;
  sourceIdSource: "configured" | "ordinal";
  rawRecordFingerprint: string;
  preview: DataExchangeRowResult;
  reimportState: ReimportState;
}

export interface PreparedTemplateImport {
  targetTemplate: string;
  rows: PreparedRow[];
  missingFromSource: ReturnType<typeof detectMissingFromSource>;
}

export interface PreparedConnectorImport {
  sourceSystemId: string;
  connectorType: string;
  connectorVersion: string;
  sourceEntity: string;
  extractionRunId: string;
  sourceSchemaFingerprint: string;
  mappingProfileCode: string;
  mappingProfileVersion: number;
  /** Target templates in real dependency-safe commit order. */
  commitOrder: string[];
  stagedCount: number;
  mappedCount: number;
  unresolvedMappings: string[];
  templates: PreparedTemplateImport[];
  /** Any one of these being non-empty means `confirmConnectorImport()`
   *  refuses to run at all — schema mismatch, a mapping-profile
   *  structural issue, a dependency cycle, or connector extraction
   *  errors. Zero commit happens when this is non-empty (F4). */
  blockingIssues: string[];
  warnings: string[];
}

export interface PrepareConnectorImportInput {
  connector: SourceConnector;
  entity: string;
  profile: MappingProfile;
  resolveCrosswalk?: (sourceEntity: string, sourceRecordId: string, canonicalEntity: string) => string | undefined;
}

const COMMITTABLE_STATES = new Set(["valid_create", "valid_update", "unchanged", "warning"]);

function withBatchOverlay(
  live: (referenceTemplate: string, referenceField: string, key: string) => boolean,
  candidatesByTemplate: Map<string, { candidate: MappingCandidateRow }[]>,
): (referenceTemplate: string, referenceField: string, key: string) => boolean {
  return (referenceTemplate, referenceField, key) => {
    if (live(referenceTemplate, referenceField, key)) return true;
    const entries = candidatesByTemplate.get(referenceTemplate);
    if (!entries) return false;
    return entries.some((e) => e.candidate.row[referenceField] === key);
  };
}

export async function prepareConnectorImport(input: PrepareConnectorImportInput): Promise<PreparedConnectorImport> {
  const { connector, entity, profile } = input;
  const identity = connector.identity;
  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  const staged = await connector.extract(entity);
  for (const e of staged.errors) blockingIssues.push(`[${e.stage}] ${e.message}`);
  for (const w of staged.warnings) warnings.push(w.message);

  const sourceSchema = discoverSourceSchema(identity.sourceSystemId, [{ entity, records: staged.records }]);

  const base = {
    sourceSystemId: identity.sourceSystemId,
    connectorType: identity.connectorType,
    connectorVersion: identity.connectorVersion,
    sourceEntity: entity,
    extractionRunId: staged.records[0]?.extraction.extractionRunId ?? "",
    sourceSchemaFingerprint: sourceSchema.fingerprint,
    mappingProfileCode: profile.code,
    mappingProfileVersion: profile.profileVersion,
    commitOrder: [] as string[],
    stagedCount: staged.records.length,
    mappedCount: 0,
    unresolvedMappings: [] as string[],
    templates: [] as PreparedTemplateImport[],
  };

  // FVL-04.023 Part E4 — a whole profile is blocked from automatic reuse
  // when its own recorded schema fingerprint no longer matches the
  // CURRENT source structure. Checked BEFORE structural validation or
  // any mapping is attempted — never auto-remapped.
  if (isSchemaChanged(profile.sourceSchemaFingerprint, sourceSchema.fingerprint)) {
    blockingIssues.push(`SCHEMA_CHANGED: mapping profile "${profile.code}" was authored against schema fingerprint "${profile.sourceSchemaFingerprint}", but the current source structure fingerprints as "${sourceSchema.fingerprint}". A compatible mapping profile version is required — this batch is not auto-remapped.`);
    return { ...base, blockingIssues, warnings };
  }

  const profileIssues: MappingProfileValidationIssue[] = validateMappingProfile(profile, sourceSchema);
  if (profileIssues.length > 0) {
    blockingIssues.push(...profileIssues.map((i) => `[${i.code}] ${i.message}`));
    return { ...base, blockingIssues, warnings };
  }

  if (staged.records.length === 0) return { ...base, blockingIssues, warnings };

  // Map every staged record, keeping each candidate linked back to the
  // real source record it came from (never flattened away) — needed for
  // both incremental classification and post-commit crosswalk timing.
  const mappingResults = staged.records.map((record) => applyMappingProfile(profile, record, { resolveCrosswalk: input.resolveCrosswalk }));
  const unresolvedMappings = mappingResults.flatMap((m) => m.unresolved);
  for (const m of mappingResults) for (const e of m.errors) warnings.push(`${e.code}: ${e.message}`);

  const candidatesByTemplate = new Map<string, { candidate: MappingCandidateRow; sourceRecordId: string; sourceIdSource: "configured" | "ordinal"; rawRecordFingerprint: string }[]>();
  staged.records.forEach((record, i) => {
    const mapped = mappingResults[i];
    for (const candidate of mapped.candidates) {
      if (!candidatesByTemplate.has(candidate.targetTemplate)) candidatesByTemplate.set(candidate.targetTemplate, []);
      candidatesByTemplate.get(candidate.targetTemplate)!.push({
        candidate,
        sourceRecordId: record.identity.sourceRecordId,
        sourceIdSource: record.identity.idSource,
        rawRecordFingerprint: record.lineage.rawRecordFingerprint ?? "",
      });
    }
  });

  const targetTemplates = [...candidatesByTemplate.keys()];
  const plan = planImportOrder(targetTemplates);
  if ("cycle" in plan) {
    blockingIssues.push(`Dependency cycle detected among target templates in this batch: ${plan.cycle.join(", ")}. Nothing can be safely committed until this registry-level cycle is resolved.`);
    return { ...base, unresolvedMappings, blockingIssues, warnings };
  }

  const templates: PreparedTemplateImport[] = [];
  let mappedCount = 0;
  for (const targetTemplate of plan.order) {
    const template = getDataExchangeTemplate(targetTemplate)!;
    const entries = candidatesByTemplate.get(targetTemplate)!;
    mappedCount += entries.length;
    const headers = template.columns.map((c) => c.key);
    // F3's own reason dependency ordering matters: a row in THIS batch
    // may reference another row in the SAME batch that hasn't committed
    // yet (e.g. a material_suppliers row referencing a raw_materials row
    // extracted from the identical source file). Existing Data Exchange
    // reference resolution only ever checks LIVE canonical storage —
    // same-file forward references are documented as unsupported there
    // (Session 8, SELF3). The bridge is the one place that DOES need to
    // resolve this, since it knows the full batch and its own commit
    // order: `withBatchOverlay()` accepts a reference the live resolver
    // missed ONLY when the referenced value is produced by an EARLIER
    // template's own candidate rows in `plan.order` — which, by the time
    // `confirmConnectorImport()` actually reaches this template, will
    // genuinely already be committed. A reference to something that
    // exists in neither live storage nor an earlier-ordered template's
    // own candidates is never accepted — it remains a real block (BR6).
    const liveResolver = await buildReferenceResolver(referenceRequirementsFor(template));
    const referenceResolver = withBatchOverlay(liveResolver, candidatesByTemplate);

    const priorRows: PriorCommittedRow[] = await loadPriorCommittedRows(targetTemplate);
    const priorBySourceId = new Map(priorRows.filter((r) => r.sourceRecordId).map((r) => [r.sourceRecordId!, r]));
    // Session 10 hardening (Part E6 gap fix) — the LIVE canonical
    // record's own current fields, indexed by natural key, loaded ONCE
    // per template. Comparing against this (never against this pass's
    // own freshly re-mapped source candidate) is what makes
    // CANONICAL_LOCAL_CONFLICT a genuinely distinct signal from CHANGED
    // — see `loadLiveCandidateFields()`'s own doc comment.
    const liveCandidateFields = await loadLiveCandidateFields(targetTemplate);

    const rows: PreparedRow[] = entries.map((entry) => {
      const values = headers.map((h) => entry.candidate.row[h] ?? "");
      const preview = previewDataExchangeImport(template, [headers, values], { resolveReference: referenceResolver }).rows[0];
      const prior = priorBySourceId.get(entry.sourceRecordId);
      const canonicalCandidateFingerprint = fingerprintCanonicalCandidate(entry.candidate.row);
      // The live canonical record's CURRENT values, projected onto
      // exactly the fields this profile maps (never the record's full
      // field set — fields the profile never touches must never count
      // as a "local edit"), fingerprinted the same way as the candidate
      // so the two are directly comparable.
      const liveRow = liveCandidateFields.get(preview.naturalKey);
      const canonicalCurrentFingerprint = liveRow ? fingerprintCanonicalCandidate(Object.fromEntries(Object.keys(entry.candidate.row).map((k) => [k, liveRow[k] ?? ""]))) : undefined;
      const reimportState = classifyReimport({
        rawRecordFingerprint: entry.rawRecordFingerprint,
        mappingProfileCode: profile.code,
        canonicalCandidateFingerprint,
        prior,
        // A row's own preview reaching a committable state with a real
        // target is the honest signal its canonical target still
        // resolves; a row that no longer previews clean says nothing
        // reliable about whether the OLD target still exists, so
        // "still exists" is left unproven (`undefined`) rather than
        // guessed true/false in that case.
        canonicalStillExists: prior?.targetRecordId ? preview.state !== "invalid" : undefined,
        canonicalCurrentFingerprint,
      });
      if (preview.state === "invalid" || preview.state === "reference_missing") {
        blockingIssues.push(`Template "${targetTemplate}" row (source ${entry.sourceRecordId}) is blocking: ${preview.messages.join(" ")}`);
      }
      return { candidate: entry.candidate, sourceRecordId: entry.sourceRecordId, sourceIdSource: entry.sourceIdSource, rawRecordFingerprint: entry.rawRecordFingerprint, preview, reimportState };
    });

    const currentKeys = new Set(rows.map((r) => r.preview.naturalKey).filter(Boolean));
    const missingFromSource = detectMissingFromSource(priorRows, currentKeys);

    templates.push({ targetTemplate, rows, missingFromSource });
  }

  return { ...base, commitOrder: plan.order, mappedCount, unresolvedMappings, templates, blockingIssues, warnings };
}

export interface ConfirmConnectorImportCtx {
  actorUserId: string;
  actorRole: ApprovalRole;
}

export interface ConfirmedConnectorImport {
  outcomesByTemplate: Record<string, DataExchangeRowCommitOutcome[]>;
  crosswalksPersisted: number;
  /** F4 — the real, disclosed residual boundary: this storage layer has
   *  no cross-collection transaction, so "atomic" here means the
   *  STRONGEST SAFE PREFLIGHT (nothing commits at all if any row was
   *  blocking at prepare time — see the `blockingIssues` throw below),
   *  never a false claim of true rollback. If a LATER template in
   *  `commitOrder` depends on rows an EARLIER template was SUPPOSED to
   *  have just committed (an optimistic same-batch forward reference —
   *  see `withBatchOverlay()`), and that earlier template's commit
   *  genuinely failed at runtime for one or more rows, this field names
   *  the template where confirmation stopped rather than continuing to
   *  commit rows whose own dependency may not actually exist. `undefined`
   *  means every template in `commitOrder` was attempted. */
  partialFailureStoppedAt?: string;
}

/**
 * F4 — refuses outright when `prepared.blockingIssues` is non-empty;
 * zero canonical write happens in that case. F3/dependency ordering was
 * already applied by `prepareConnectorImport()` — `prepared.commitOrder`
 * is trusted here, never recomputed. F5 — a crosswalk entry for a given
 * row is persisted ONLY after that row's own commit outcome is
 * `"created"`/`"updated"`, and only for a row whose source identity was
 * genuinely `"configured"` (an ordinal identity is refused by
 * `persistCrosswalkEntry()` itself either way — this function never
 * tries to route around that refusal). `crosswalkTargets` is optional
 * per template — a template with no configured crosswalk target simply
 * commits with no crosswalk persistence, exactly like a direct Data
 * Exchange import always has.
 */
export async function confirmConnectorImport(prepared: PreparedConnectorImport, ctx: ConfirmConnectorImportCtx, crosswalkTargets: Record<string, CrosswalkTarget> = {}): Promise<ConfirmedConnectorImport> {
  if (prepared.blockingIssues.length > 0) {
    throw new Error(`Cannot confirm this import — ${prepared.blockingIssues.length} blocking issue(s) present: ${prepared.blockingIssues[0]}${prepared.blockingIssues.length > 1 ? ` (+${prepared.blockingIssues.length - 1} more)` : ""}`);
  }

  const outcomesByTemplate: Record<string, DataExchangeRowCommitOutcome[]> = {};
  let partialFailureStoppedAt: string | undefined;
  let crosswalksPersisted = 0;

  for (const targetTemplate of prepared.commitOrder) {
    const templateImport = prepared.templates.find((t) => t.targetTemplate === targetTemplate);
    if (!templateImport) continue;
    const template = getDataExchangeTemplate(targetTemplate)!;
    const committableRows = templateImport.rows.filter((r) => COMMITTABLE_STATES.has(r.preview.state));
    const outcomes = await commitDataExchangeRows(template, committableRows.map((r) => r.preview), ctx);
    outcomesByTemplate[targetTemplate] = outcomes;

    // F6 — real Import History provenance, through the EXISTING
    // data_exchange_import_jobs/row_results model (never a second one).
    // One job per target template, matching the file-upload dialog's
    // own established convention (`DataExchangeImportDialog.tsx`).
    const created = outcomes.filter((o) => o.outcome === "created").length;
    const updated = outcomes.filter((o) => o.outcome === "updated").length;
    const unchanged = outcomes.filter((o) => o.outcome === "unchanged").length;
    const failed = outcomes.filter((o) => o.outcome === "failed").length;
    const job: DataExchangeImportJob = {
      schemaVersion: "1.0",
      id: newId("dxjob"),
      templateCode: targetTemplate,
      templateSchemaVersion: template.schemaVersion,
      fileName: `connector:${prepared.sourceSystemId}:${prepared.sourceEntity}`,
      fileType: "csv",
      fileSize: 0,
      sha256: prepared.extractionRunId || "n/a",
      status: failed > 0 ? (created + updated > 0 ? "completed_with_warnings" : "failed") : "completed",
      mode: "atomic",
      totalRows: templateImport.rows.length,
      validRows: committableRows.length,
      invalidRows: templateImport.rows.length - committableRows.length,
      createdRows: created,
      updatedRows: updated,
      unchangedRows: unchanged,
      duplicateRows: 0,
      warningRows: templateImport.rows.filter((r) => r.preview.state === "warning").length,
      startedBy: ctx.actorUserId,
      startedAt: nowIso(),
      committedBy: ctx.actorUserId,
      committedAt: nowIso(),
      completedAt: nowIso(),
      notes: failed > 0 ? `${failed} row(s) failed to commit via the connector bridge.` : undefined,
      sourceSystemId: prepared.sourceSystemId,
      connectorType: prepared.connectorType,
      mappingProfileCode: prepared.mappingProfileCode,
    };
    await upsertRecords("data_exchange_import_jobs", [job]);
    const rowResults: DataExchangeImportRowResult[] = committableRows.map((row, i) => ({
      schemaVersion: "1.0",
      id: newId("dxrow"),
      jobId: job.id,
      rowNumber: i + 1,
      naturalKey: row.preview.naturalKey,
      state: outcomes[i]?.outcome === "failed" ? "invalid" : row.preview.state,
      messages: outcomes[i]?.message ? [outcomes[i].message!] : [],
      targetCollection: outcomes[i]?.targetCollection,
      targetRecordId: outcomes[i]?.targetRecordId,
      sourceRecordId: row.sourceRecordId,
      rawRecordFingerprint: row.rawRecordFingerprint,
      mappingProfileCode: prepared.mappingProfileCode,
      canonicalCandidateFingerprint: fingerprintCanonicalCandidate(row.candidate.row),
    }));
    if (rowResults.length > 0) await upsertRecords("data_exchange_import_row_results", rowResults);

    const crosswalkTarget = crosswalkTargets[targetTemplate];
    if (crosswalkTarget) {
      for (let i = 0; i < committableRows.length; i++) {
        const row = committableRows[i];
        const outcome = outcomes[i];
        if (!outcome || (outcome.outcome !== "created" && outcome.outcome !== "updated") || !outcome.targetRecordId) continue;
        if (row.sourceIdSource !== "configured") continue; // persistCrosswalkEntry would refuse this anyway — skip the call, same outcome, no noisy refusal to surface
        const { refused } = await persistCrosswalkEntry({
          sourceSystemId: prepared.sourceSystemId,
          sourceEntity: prepared.sourceEntity,
          sourceIdentity: { sourceRecordId: row.sourceRecordId, idSource: "configured" },
          canonicalEntity: crosswalkTarget.canonicalEntity,
          canonicalRecordId: outcome.targetRecordId,
          mappingProfileId: prepared.mappingProfileCode.split("::")[0],
          mappingProfileVersion: prepared.mappingProfileVersion,
          sourceFingerprint: row.rawRecordFingerprint,
        });
        if (!refused) crosswalksPersisted++;
      }
    }

    // F4's disclosed residual boundary — this storage layer has no
    // cross-collection transaction. If any row in THIS template
    // genuinely failed at runtime, a later template in `commitOrder`
    // may have optimistically assumed one of this template's rows would
    // exist (`withBatchOverlay()` in `prepareConnectorImport()`) — that
    // assumption can no longer be trusted, so confirmation stops here
    // rather than risking a later template committing against a
    // dependency that never actually landed.
    if (failed > 0) {
      partialFailureStoppedAt = targetTemplate;
      break;
    }
  }

  return { outcomesByTemplate, crosswalksPersisted, ...(partialFailureStoppedAt ? { partialFailureStoppedAt } : {}) };
}

/**
 * F8 — the smallest honest bridge from a source's own discovered schema
 * to a real, USABLE `MappingProfile`, for the common case a customer's
 * source field names already match (or are trivially close to) a target
 * template's own column keys — e.g. a customer export whose own headers
 * are literally `material_code`/`material_name`. Maps a source field to
 * a target column ONLY on an exact (case-insensitive) name match — never
 * a fuzzy/guessed pairing, and never invents a mapping for a required
 * field that has no matching source field (the profile's own
 * `missing_required_target_field` validation surfaces that honestly,
 * exactly like a hand-authored profile would). A real migration with
 * genuinely different column names still needs a hand-authored
 * `MappingProfile` — this is a convenience for the identity case only,
 * not a substitute for real mapping authorship.
 */
export function buildIdentityMappingProfile(sourceSystemId: string, sourceEntity: string, template: ReturnType<typeof getDataExchangeTemplate> & object, sourceSchemaFingerprint: string, sourceFieldPaths: string[]): MappingProfile {
  const byLower = new Map(sourceFieldPaths.map((f) => [f.toLowerCase(), f]));
  const fieldMappings = template.columns
    .map((c) => {
      const match = byLower.get(c.key.toLowerCase());
      return match ? { sourceField: match, targetTemplate: template.templateCode, targetField: c.key } : null;
    })
    .filter((m): m is { sourceField: string; targetTemplate: string; targetField: string } => m !== null);
  const now = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    code: `identity-${sourceSystemId}-${template.templateCode}::v1`,
    profileId: `identity-${sourceSystemId}-${template.templateCode}`,
    profileName: `Identity mapping — ${sourceSystemId} -> ${template.templateCode}`,
    sourceSystemId,
    sourceEntity,
    sourceSchemaFingerprint,
    profileVersion: 1,
    status: "active",
    fieldMappings,
    constantMappings: [],
    createdAt: now,
    updatedAt: now,
    createdBy: "local",
  };
}
