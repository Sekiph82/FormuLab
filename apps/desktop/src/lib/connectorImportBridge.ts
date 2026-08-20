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
 *
 * Session 12 hardening — `crosswalkTargets` is now decided ONLY at
 * `prepareConnectorImport()` time and carried inside the returned
 * `PreparedConnectorImport` itself; `confirmConnectorImport()` no
 * longer accepts an independent crosswalk-target argument at all, so a
 * confirmation can never introduce (or silently change) crosswalk
 * persistence the human reviewer never actually saw. Confirmation also
 * now revalidates the specific live state its own conflict
 * classification depended on (canonical fingerprint, crosswalk
 * binding) immediately before committing each template — a prepared
 * plan that has gone stale since review (someone else edited the
 * canonical record, rebound the crosswalk, or deleted the target) is
 * refused outright, never silently trusted.
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
  resolveCrosswalk,
  validateMappingProfile,
  type ApprovalRole,
  type DataExchangeImportJob,
  type DataExchangeImportRowResult,
  type DataExchangeRowResult,
  type DataExchangeTemplateDefinition,
  type MappingCandidateRow,
  type MappingProfile,
  type MappingProfileValidationIssue,
  type PriorCommittedRow,
  type ReimportState,
  type SourceConnector,
} from "@formulab/shared";
import { buildReferenceResolver, loadLiveCandidateFields, loadPriorCommittedRows, priorTargetExists } from "./dataExchangeExisting";
import { commitDataExchangeRows, type DataExchangeRowCommitOutcome } from "./dataExchangeCommit";
import { loadCrosswalks, persistCrosswalkEntry } from "./connectorPersistence";
import { upsertRecords, nowIso } from "./masterdata";

/**
 * Session 11 hardening (Part 6) — reimport states that must NEVER
 * auto-enter the normal committable path. Each represents a case where
 * silently proceeding would risk a silent overwrite of something a human
 * needs to look at first: a canonical record that was hand-edited
 * out-of-band since the last import (CANONICAL_LOCAL_CONFLICT), a prior
 * import target that no longer exists (CANONICAL_MISSING — recreating or
 * updating blind is never assumed safe), a mapping-profile version change
 * applied to an already-committed record without explicit review
 * (MAPPING_PROFILE_CHANGED), or a source identity already bound to a
 * DIFFERENT canonical record than this batch would produce
 * (CROSSWALK_CONFLICT). None of these get an auto-merge — the required
 * default is "block, and require an explicit human decision."
 */
const UNSAFE_REIMPORT_STATES = new Set<ReimportState>(["CANONICAL_LOCAL_CONFLICT", "CANONICAL_MISSING", "MAPPING_PROFILE_CHANGED", "CROSSWALK_CONFLICT"]);
const COMMITTABLE_STATES = new Set(["valid_create", "valid_update", "unchanged", "warning"]);

/**
 * The ONE deterministic commit-eligibility authority — considers BOTH the
 * existing Data Exchange preview validity AND the re-import/conflict
 * safety state, never just one. Reused by `confirmConnectorImport()`'s own
 * commit filter; exported so a future UI surface has the same single
 * authority to consult rather than re-deriving this decision itself.
 */
export function isRowCommittable(row: Pick<PreparedRow, "preview" | "reimportState">): boolean {
  return COMMITTABLE_STATES.has(row.preview.state) && !UNSAFE_REIMPORT_STATES.has(row.reimportState);
}

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

/**
 * Session 11 hardening (Part 6, corrected Part 12) — the ONE place that
 * decides "what canonical record id would this row's own natural key
 * identify". Every `create_or_update` template in this registry has its
 * own commit handler use the record's natural key AS its canonical
 * `code`/id directly (`materials.code = material_code`,
 * `suppliers.code = supplier_code`, ...) — confirmed per-handler in
 * `dataExchangeCommit.ts`, never assumed. For an `append_history`/
 * `new_revision` template (`material_prices`, `exchange_rates`,
 * `formula_bom`, `lab_results`) every import creates a genuinely NEW
 * record with a freshly generated id — there is no deterministic way to
 * decode a natural key into "the" canonical id for those, so this
 * function honestly returns `undefined` rather than guessing. Centralized
 * here so `CANONICAL_MISSING` (Part 6) and the crosswalk-conflict
 * preflight (Part 12) share exactly one decoding rule instead of two.
 */
function canonicalIdentityFor(template: Pick<DataExchangeTemplateDefinition, "duplicatePolicy">, naturalKey: string): string | undefined {
  return template.duplicatePolicy === "create_or_update" ? naturalKey : undefined;
}

/**
 * Part A3 (FVL-04 close-out) — whether the canonical record a PRIOR
 * commit targeted still exists RIGHT NOW, decoded directly from that
 * prior commit's OWN real `targetCollection`/`targetRecordId`
 * (`data_exchange_import_row_results`, captured for every duplicatePolicy
 * — see `priorTargetExists()`, `dataExchangeExisting.ts`) — never
 * inferred from the CURRENT candidate's own natural key, which may have
 * drifted, and no longer restricted to `create_or_update`: an
 * `append_history`/`new_revision` row's generated id was previously
 * unresolvable here because the old check used the natural-key-indexed
 * `liveCandidateFields` map (Session 12), which a generated id can never
 * appear in — `priorTargetExists()` looks the real id up directly against
 * the real target collection instead, closing that blind spot for every
 * duplicatePolicy uniformly.
 */
function priorTargetStillExists(prior: PriorCommittedRow | undefined): Promise<boolean | undefined> {
  return priorTargetExists(prior?.targetCollection, prior?.targetRecordId);
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
  /** Session 12 hardening (Part 5, TOCTOU) — the live canonical record's
   *  fingerprint AS OBSERVED AT PREPARE TIME, projected onto exactly the
   *  fields this profile maps (`undefined` when no live record existed
   *  yet at prepare time). `confirmConnectorImport()` re-derives this
   *  fresh immediately before committing and refuses the whole batch if
   *  it no longer matches — the human reviewed THIS state, never
   *  whatever the canonical record has since become. */
  canonicalFingerprintAtPrepare?: string;
  /** The crosswalk binding observed at prepare time for this row's own
   *  source identity — `undefined` when no crosswalk target was
   *  configured for this template at all (revalidation is skipped
   *  entirely in that case); `null` explicitly means "a crosswalk
   *  target WAS configured and no active crosswalk existed yet".
   *  Re-derived fresh at confirm time the same way. */
  crosswalkBindingAtPrepare?: string | null;
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
  /** Session 12 hardening (Part 12) — the EXACT crosswalk target
   *  configuration this prepared plan was reviewed under (whatever
   *  `PrepareConnectorImportInput.crosswalkTargets` named, `{}` when
   *  none). `confirmConnectorImport()` reads this back rather than
   *  accepting an independent argument — a confirmation can never
   *  persist a crosswalk under a configuration the human never actually
   *  saw at prepare/preview time. */
  crosswalkTargets: Record<string, CrosswalkTarget>;
}

export interface PrepareConnectorImportInput {
  connector: SourceConnector;
  entity: string;
  profile: MappingProfile;
  resolveCrosswalk?: (sourceEntity: string, sourceRecordId: string, canonicalEntity: string) => string | undefined;
  /** Session 11/12 hardening (Part 6C/3/4) — the crosswalk target
   *  configuration for this import, decided HERE and only here.
   *  `prepareConnectorImport()` preflights CROSSWALK_CONFLICT (Part 3 —
   *  resolved independently of Import History, straight from the real
   *  crosswalk store) BEFORE any canonical write, and
   *  `confirmConnectorImport()` reads this exact configuration back off
   *  the returned `PreparedConnectorImport` — it accepts no separate
   *  crosswalk-target argument of its own (Part 4). A template with no
   *  entry here simply commits with no crosswalk persistence, exactly
   *  like a direct Data Exchange import always has. */
  crosswalkTargets?: Record<string, CrosswalkTarget>;
}

/**
 * Session 11 hardening (Part 7B) — a candidate satisfies a same-batch
 * forward reference ONLY when it comes from a template that commits
 * STRICTLY BEFORE the current one in the real dependency-safe order
 * (`plan.order`). The prior implementation checked the FULL
 * `candidatesByTemplate` map unfiltered by order, so a LATER-committing
 * template's own candidates could incorrectly satisfy an EARLIER
 * template's reference — exactly the bug this batch overlay's own doc
 * comment claimed could never happen. `earlierTemplates` is a snapshot
 * Set of every target template already processed in THIS call's
 * `plan.order` loop before the current one — never every template in the
 * batch.
 */
function withBatchOverlay(
  live: (referenceTemplate: string, referenceField: string, key: string) => boolean,
  candidatesByTemplate: Map<string, { candidate: MappingCandidateRow }[]>,
  earlierTemplates: ReadonlySet<string>,
): (referenceTemplate: string, referenceField: string, key: string) => boolean {
  return (referenceTemplate, referenceField, key) => {
    if (live(referenceTemplate, referenceField, key)) return true;
    if (!earlierTemplates.has(referenceTemplate)) return false;
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
  const crosswalkTargets = input.crosswalkTargets ?? {};

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
    crosswalkTargets,
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
  // Session 11 hardening (Part 7B) — grows as each target template is
  // processed, so `withBatchOverlay()` only ever sees templates that
  // genuinely commit BEFORE the current one.
  const earlierTemplates = new Set<string>();
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
    const referenceResolver = withBatchOverlay(liveResolver, candidatesByTemplate, earlierTemplates);

    const priorRows: PriorCommittedRow[] = await loadPriorCommittedRows(targetTemplate);
    const priorBySourceId = new Map(priorRows.filter((r) => r.sourceRecordId).map((r) => [r.sourceRecordId!, r]));
    // Session 10 hardening (Part E6 gap fix) — the LIVE canonical
    // record's own current fields, indexed by natural key, loaded ONCE
    // per template. Comparing against this (never against this pass's
    // own freshly re-mapped source candidate) is what makes
    // CANONICAL_LOCAL_CONFLICT a genuinely distinct signal from CHANGED
    // — see `loadLiveCandidateFields()`'s own doc comment.
    const liveCandidateFields = await loadLiveCandidateFields(targetTemplate);

    // Session 11/12 hardening (Part 6C/3) — real crosswalk-conflict
    // preflight, resolved directly from the real crosswalk store,
    // independent of whether Import History has any prior row at all.
    // Loaded once per template, only when a crosswalk target is
    // actually configured for it.
    const crosswalkTarget = crosswalkTargets[targetTemplate];
    const crosswalks = crosswalkTarget ? await loadCrosswalks() : undefined;

    const rows: PreparedRow[] = await Promise.all(entries.map(async (entry) => {
      const values = headers.map((h) => entry.candidate.row[h] ?? "");
      const preview = previewDataExchangeImport(template, [headers, values], { resolveReference: referenceResolver }).rows[0];
      const prior = priorBySourceId.get(entry.sourceRecordId);
      // Part A2/A3 (FVL-04 close-out) — the candidate side is fingerprinted
      // over exactly the KEYS this profile actually maps
      // (`entry.candidate.row`'s own key set — never the template's full
      // column set, which would pull in `defaultValue` columns the
      // profile never touched and the live-record loaders don't even
      // export, a false-mismatch source of its own), but using the
      // VALIDATED/NORMALIZED VALUE for each of those keys
      // (`preview.record`, what `commitDataExchangeRows()` actually
      // commits — e.g. a `decimal`/`currency`/`percentage` column's raw
      // "100.00" is normalized to "100" by `validateCell()`), never the
      // raw pre-validation string. Fingerprinting the raw string here was
      // a genuine false-positive bug: the LIVE record on a later reimport
      // always reflects the NORMALIZED value (since that's what got
      // committed), so comparing it against a raw, un-normalized
      // candidate fingerprint made a byte-identical decimal value (just
      // formatted differently in the source) look like a local edit every
      // time, wrongly forcing CANONICAL_LOCAL_CONFLICT on a perfectly
      // safe reimport.
      const candidateKeys = Object.keys(entry.candidate.row);
      const canonicalCandidateFingerprint = fingerprintCanonicalCandidate(Object.fromEntries(candidateKeys.map((k) => [k, preview.record[k] ?? ""])));
      // The live canonical record's CURRENT values, projected onto
      // exactly the fields this profile maps (never the record's full
      // field set — fields the profile never touches must never count
      // as a "local edit"), fingerprinted the same way as the candidate
      // so the two are directly comparable.
      const liveRow = liveCandidateFields.get(preview.naturalKey);
      const canonicalFingerprintAtPrepare = liveRow ? fingerprintCanonicalCandidate(Object.fromEntries(candidateKeys.map((k) => [k, liveRow[k] ?? ""]))) : undefined;
      let reimportState = classifyReimport({
        rawRecordFingerprint: entry.rawRecordFingerprint,
        mappingProfileCode: profile.code,
        canonicalCandidateFingerprint,
        prior,
        // Part A3 (FVL-04 close-out) — the ACTUAL prior committed target's
        // real existence, decoded directly from `prior.targetCollection`/
        // `targetRecordId` (never inferred from the CURRENT candidate's
        // own natural key, and no longer restricted to `create_or_update`
        // — see `priorTargetStillExists()`).
        canonicalStillExists: await priorTargetStillExists(prior),
        canonicalCurrentFingerprint: canonicalFingerprintAtPrepare,
      });

      // Session 12 / Part A2 hardening — crosswalk-conflict preflight,
      // resolved independently of whether Import History has a row for
      // THIS batch, but using Import History as the reconciliation
      // reference for templates whose canonical id can't be predicted
      // from a natural key.
      let crosswalkBindingAtPrepare: string | null | undefined;
      if (crosswalkTarget && crosswalks) {
        if (entry.sourceIdSource !== "configured") {
          // Part 3, Rule E — an ordinal identity is never crosswalk-authoritative.
          crosswalkBindingAtPrepare = undefined;
        } else {
          const boundCanonicalId = resolveCrosswalk(crosswalks, identity.sourceSystemId, entity, entry.sourceRecordId, crosswalkTarget.canonicalEntity);
          crosswalkBindingAtPrepare = boundCanonicalId ?? null;
          if (boundCanonicalId !== undefined) {
            if (template.duplicatePolicy === "create_or_update") {
              // What canonical identity would THIS row's own natural key
              // represent — deterministic and decodable for this policy.
              const intendedTarget = canonicalIdentityFor(template, preview.naturalKey);
              if (intendedTarget !== undefined) {
                if (boundCanonicalId !== intendedTarget) {
                  // Part 3, Rule C — bound to a DIFFERENT canonical record.
                  reimportState = "CROSSWALK_CONFLICT";
                } else if (!liveCandidateFields.has(boundCanonicalId)) {
                  // Part 3, Rule D — agrees, but that target itself is gone.
                  reimportState = "CANONICAL_MISSING";
                }
                // else Rule B — agrees and exists: safe, no override.
              }
            } else {
              // Part A2 (FVL-04 close-out) — `append_history`/`new_revision`:
              // there is no natural-key-derived "intended target"
              // (`canonicalIdentityFor()` is honestly `undefined` here — a
              // fresh id is generated on every real commit). The real prior
              // COMMITTED target for this EXACT source identity (Import
              // History's own `prior.targetRecordId`) is the only safe
              // reconciliation reference — never the current candidate's
              // natural key, and never the crosswalk binding trusted alone.
              if (prior?.targetRecordId === undefined) {
                // An active crosswalk exists but Import History has no
                // reconcilable prior target for this exact source identity
                // — never silently trust the crosswalk alone (it could be
                // stale, or from a run whose history was since pruned);
                // require explicit human resolution rather than risk a
                // silent duplicate.
                reimportState = "CROSSWALK_CONFLICT";
              } else if (boundCanonicalId !== prior.targetRecordId) {
                // The crosswalk and Import History disagree about which
                // canonical record this source identity belongs to.
                reimportState = "CROSSWALK_CONFLICT";
              } else if (!(await priorTargetExists(prior.targetCollection, prior.targetRecordId))) {
                // They agree, but that agreed-upon target no longer exists.
                reimportState = "CANONICAL_MISSING";
              }
              // else: crosswalk agrees with Import History and the target
              // still exists — safe, no override. This row's own CHANGED/
              // UNCHANGED classification (above) still decides whether a
              // new history row is actually appended; the crosswalk is a
              // reconciliation reference here, never a write target.
            }
          }
          // Rule A (no crosswalk at all, boundCanonicalId undefined) — no override.
        }
      }

      if (preview.state === "invalid" || preview.state === "reference_missing") {
        blockingIssues.push(`Template "${targetTemplate}" row (source ${entry.sourceRecordId}) is blocking: ${preview.messages.join(" ")}`);
      } else if (UNSAFE_REIMPORT_STATES.has(reimportState)) {
        // Section 6 — never silently commit an unsafe re-import state.
        // The whole batch is blocked, same F4 atomic-preflight discipline
        // already used for invalid/reference_missing rows — this is not a
        // new partial-skip semantic, just the SAME one applied to a wider
        // set of unsafe conditions, requiring an explicit human decision
        // before this row (and therefore this batch) can commit.
        blockingIssues.push(`Template "${targetTemplate}" row (source ${entry.sourceRecordId}) requires explicit human resolution before it can commit: ${reimportState}.`);
      }
      return {
        candidate: entry.candidate,
        sourceRecordId: entry.sourceRecordId,
        sourceIdSource: entry.sourceIdSource,
        rawRecordFingerprint: entry.rawRecordFingerprint,
        preview,
        reimportState,
        canonicalFingerprintAtPrepare,
        crosswalkBindingAtPrepare,
      };
    }));

    const currentKeys = new Set(rows.map((r) => r.preview.naturalKey).filter(Boolean));
    const missingFromSource = detectMissingFromSource(priorRows, currentKeys);

    templates.push({ targetTemplate, rows, missingFromSource });
    earlierTemplates.add(targetTemplate);
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
 * Session 12 hardening (Part 5, TOCTOU) — re-derives exactly the live
 * state each committable row's own prepared classification depended on
 * (canonical fingerprint, crosswalk binding) and compares it against
 * what was observed at prepare time. Never reruns the whole migration —
 * only the specific state a stale plan could silently trust wrongly.
 * Returns a description per stale row found; an empty array means the
 * prepared plan is still genuinely safe to confirm as reviewed.
 */
async function findStaleRows(prepared: PreparedConnectorImport): Promise<string[]> {
  const stale: string[] = [];
  for (const templateImport of prepared.templates) {
    const committableRows = templateImport.rows.filter(isRowCommittable);
    if (committableRows.length === 0) continue;
    const needsLiveCheck = committableRows.some((r) => r.canonicalFingerprintAtPrepare !== undefined);
    const needsCrosswalkCheck = committableRows.some((r) => r.crosswalkBindingAtPrepare !== undefined);
    const liveCandidateFieldsNow = needsLiveCheck ? await loadLiveCandidateFields(templateImport.targetTemplate) : undefined;
    const crosswalkTarget = prepared.crosswalkTargets[templateImport.targetTemplate];
    const crosswalksNow = needsCrosswalkCheck && crosswalkTarget ? await loadCrosswalks() : undefined;

    for (const row of committableRows) {
      if (liveCandidateFieldsNow) {
        const liveRowNow = liveCandidateFieldsNow.get(row.preview.naturalKey);
        const currentFp = liveRowNow ? fingerprintCanonicalCandidate(Object.fromEntries(Object.keys(row.candidate.row).map((k) => [k, liveRowNow[k] ?? ""]))) : undefined;
        if (currentFp !== row.canonicalFingerprintAtPrepare) {
          stale.push(`Template "${templateImport.targetTemplate}" row (source ${row.sourceRecordId}): the canonical record changed since this import was reviewed — re-prepare and review again before confirming.`);
          continue;
        }
      }
      if (crosswalksNow && crosswalkTarget && row.sourceIdSource === "configured") {
        const boundNow = resolveCrosswalk(crosswalksNow, prepared.sourceSystemId, prepared.sourceEntity, row.sourceRecordId, crosswalkTarget.canonicalEntity) ?? null;
        if (boundNow !== (row.crosswalkBindingAtPrepare ?? null)) {
          stale.push(`Template "${templateImport.targetTemplate}" row (source ${row.sourceRecordId}): the external-ID crosswalk binding changed since this import was reviewed — re-prepare and review again before confirming.`);
        }
      }
    }
  }
  return stale;
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
 * tries to route around that refusal). `prepared.crosswalkTargets` is
 * optional per template — a template with no configured crosswalk
 * target simply commits with no crosswalk persistence, exactly like a
 * direct Data Exchange import always has.
 *
 * Session 12 hardening (Part 5, TOCTOU) — before committing anything at
 * all, revalidates the live state each row's prepared conflict
 * classification depended on (`findStaleRows()`); any staleness refuses
 * the WHOLE confirmation, the same atomic-preflight discipline
 * `blockingIssues` already uses — never a silent partial re-trust.
 */
export async function confirmConnectorImport(prepared: PreparedConnectorImport, ctx: ConfirmConnectorImportCtx): Promise<ConfirmedConnectorImport> {
  if (prepared.blockingIssues.length > 0) {
    throw new Error(`Cannot confirm this import — ${prepared.blockingIssues.length} blocking issue(s) present: ${prepared.blockingIssues[0]}${prepared.blockingIssues.length > 1 ? ` (+${prepared.blockingIssues.length - 1} more)` : ""}`);
  }

  const staleRows = await findStaleRows(prepared);
  if (staleRows.length > 0) {
    throw new Error(`Cannot confirm this import — the prepared plan is stale: ${staleRows[0]}${staleRows.length > 1 ? ` (+${staleRows.length - 1} more)` : ""}`);
  }

  const crosswalkTargets = prepared.crosswalkTargets;
  const outcomesByTemplate: Record<string, DataExchangeRowCommitOutcome[]> = {};
  let partialFailureStoppedAt: string | undefined;
  let crosswalksPersisted = 0;

  for (const targetTemplate of prepared.commitOrder) {
    const templateImport = prepared.templates.find((t) => t.targetTemplate === targetTemplate);
    if (!templateImport) continue;
    const template = getDataExchangeTemplate(targetTemplate)!;
    const committableRows = templateImport.rows.filter(isRowCommittable);
    // Part A2 (FVL-04 close-out) — the connector bridge never supplies
    // `existingNaturalKeys`/`isUnchanged` to `previewDataExchangeImport()`
    // (Session 12's own TOCTOU-4 comment already documents this: every
    // row's OWN `preview.state` is `"valid_create"`, never `"unchanged"`,
    // through this path), so `commitDataExchangeRows()`'s EXISTING
    // `row.state === "unchanged"` skip (`dataExchangeCommit.ts`) never
    // fires here on its own. That is harmless for `create_or_update`
    // templates (their own commit handler re-upserts the SAME natural key
    // idempotently — proven by TOCTOU-4, which deliberately still expects
    // `"updated"`, not a skip, for a genuinely no-op reimport there) but
    // is a real duplicate-row bug for `append_history`/`new_revision`
    // templates, whose commit handlers unconditionally INSERT a fresh
    // record every call. The bridge's OWN `reimportState` already
    // correctly classifies a genuine no-op reimport as `"UNCHANGED"`
    // (`classifyReimport()`, source-fingerprint-driven, works for every
    // duplicatePolicy) — reusing that EXISTING signal here, scoped to
    // non-`create_or_update` templates only, to drive the EXISTING
    // commit-layer skip rather than inventing a second one.
    const previewsForCommit = committableRows.map((r) => (template.duplicatePolicy !== "create_or_update" && r.reimportState === "UNCHANGED" ? { ...r.preview, state: "unchanged" as const } : r.preview));
    const outcomes = await commitDataExchangeRows(template, previewsForCommit, ctx);
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
      // Session 11 hardening (Part 7A) — a DATABASE/REST_API/FILE
      // connector import has no uploaded file at all; claiming "csv" and
      // a fabricated fileSize/sha256 was an outright lie in the
      // provenance record. fileType is genuinely "connector" here;
      // fileSize/sha256 are correctly left unset (optional on the
      // schema); extractionRunId gets its own honestly-named field.
      fileName: `connector:${prepared.sourceSystemId}:${prepared.sourceEntity}`,
      fileType: "connector",
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
      connectorVersion: prepared.connectorVersion || undefined,
      sourceEntity: prepared.sourceEntity || undefined,
      extractionRunId: prepared.extractionRunId || undefined,
      sourceSchemaFingerprint: prepared.sourceSchemaFingerprint || undefined,
      mappingProfileVersion: prepared.mappingProfileVersion || undefined,
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
      // Computed the SAME way as prepare-time (`candidateKeys` restricted
      // to the profile's own mapped fields, values from the VALIDATED
      // `preview.record`) so a future reimport's comparison against this
      // stored value is apples-to-apples — see the prepare-time comment
      // above for why both the key restriction and the value
      // normalization matter.
      canonicalCandidateFingerprint: fingerprintCanonicalCandidate(Object.fromEntries(Object.keys(row.candidate.row).map((k) => [k, row.preview.record[k] ?? ""]))),
    }));
    if (rowResults.length > 0) await upsertRecords("data_exchange_import_row_results", rowResults);

    const crosswalkTarget = crosswalkTargets[targetTemplate];
    if (crosswalkTarget) {
      for (let i = 0; i < committableRows.length; i++) {
        const row = committableRows[i];
        const outcome = outcomes[i];
        if (!outcome || (outcome.outcome !== "created" && outcome.outcome !== "updated") || !outcome.targetRecordId) continue;
        if (row.sourceIdSource !== "configured") continue; // persistCrosswalkEntry would refuse this anyway — skip the call, same outcome, no noisy refusal to surface
        const { refused, conflict } = await persistCrosswalkEntry({
          sourceSystemId: prepared.sourceSystemId,
          sourceEntity: prepared.sourceEntity,
          sourceIdentity: { sourceRecordId: row.sourceRecordId, idSource: "configured" },
          canonicalEntity: crosswalkTarget.canonicalEntity,
          canonicalRecordId: outcome.targetRecordId,
          mappingProfileId: prepared.mappingProfileCode.split("::")[0],
          mappingProfileVersion: prepared.mappingProfileVersion,
          sourceFingerprint: row.rawRecordFingerprint,
        });
        // Part A2 (FVL-04 close-out) — `persistCrosswalkEntry()` reports a
        // genuine mismatch as `{ conflict }`, distinct from `{ refused }`
        // (an ordinal identity). Both mean nothing was actually persisted
        // — `crosswalksPersisted` must never count a silently-conflicted
        // attempt as a real mutation (this is expected/harmless for an
        // append_history row whose crosswalk preflight already confirmed
        // it agrees with Import History for the PRIOR record, since this
        // NEW row's own generated id necessarily differs).
        if (!refused && !conflict) crosswalksPersisted++;
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
