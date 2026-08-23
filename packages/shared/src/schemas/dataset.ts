/**
 * FVL-05.001 — dataset schema version + feature schema version.
 *
 * Two independent version identifiers for the future Historical Experiment
 * Dataset Builder (FVL-05.002 onward): the DATASET schema versions the
 * shape of a dataset ROW (lineage + extracted fields, FVL-05.002-.008),
 * and the FEATURE schema versions the shape of a derived FEATURE VECTOR
 * (normalization + target-variable definitions, FVL-05.009-.010). They
 * change on independent timelines — adding a new extractor field bumps the
 * dataset schema without touching the feature schema, and changing a
 * normalization rule bumps the feature schema without touching the
 * dataset schema — so they are deliberately two separate literals, never
 * one shared "schema version".
 *
 * Each is a literal, not a free-form string, matching the existing
 * `schemaVersion: z.literal("1.0")` convention every other record schema
 * in this package already uses (e.g. `schemas/doe.ts`). Bumping either
 * constant here is the explicit, deterministic signal a future FVL-05
 * migration step (`engine/migrations.ts`'s `SchemaMigration.fromVersion`/
 * `toVersion`) would key off, exactly as that module already does for
 * other collections.
 *
 * This module defines the two versions only — not the dataset row shape,
 * the feature vector shape, or any extractor/normalizer. That is
 * FVL-05.002 onward.
 */
import { z } from "zod";
import { processParameterSchema } from "./dataExchange";
import { decimalString, formulationLineSchema } from "./formulation";
import { TRIAL_PROCESS_STEP_STATUSES, trialObservationSchema } from "./laboratory";
import { rawMaterialSchema } from "./materials";
import { productFamilySchema } from "./product";
import { attachmentReferenceSchema } from "./testDefinitions";

/** Current dataset (row/lineage) schema version. Bump when the shape of a
 *  dataset row changes (a field is added, removed, or renamed by one of
 *  the FVL-05.003-.008 extractors). */
export const DATASET_SCHEMA_VERSION = "1.0" as const;

/** Validates the literal current dataset schema version. */
export const datasetSchemaVersionSchema = z.literal(DATASET_SCHEMA_VERSION);

/** A record that carries the dataset schema version. Future dataset row
 *  types (FVL-05.002) compose this rather than inventing their own field
 *  name for the same concept. */
export const datasetSchemaVersionedSchema = z.object({
  datasetSchemaVersion: datasetSchemaVersionSchema,
});
export type DatasetSchemaVersioned = z.infer<typeof datasetSchemaVersionedSchema>;

/** Current feature (derived feature-vector) schema version. Bump when
 *  normalization or target-variable definitions change (FVL-05.009-.010)
 *  in a way that changes the shape or meaning of a feature vector. */
export const FEATURE_SCHEMA_VERSION = "1.0" as const;

/** Validates the literal current feature schema version. */
export const featureSchemaVersionSchema = z.literal(FEATURE_SCHEMA_VERSION);

/** A record that carries the feature schema version. Future feature-vector
 *  types (FVL-05.009-.010) compose this rather than inventing their own
 *  field name for the same concept. */
export const featureSchemaVersionedSchema = z.object({
  featureSchemaVersion: featureSchemaVersionSchema,
});
export type FeatureSchemaVersioned = z.infer<typeof featureSchemaVersionedSchema>;

/**
 * FVL-05.002 — row/entity lineage model.
 *
 * A dataset row is only trustworthy if every value on it can be traced back
 * to the exact source record it came from. `sourceRecordReferenceSchema` is
 * that trace: WHICH source entity/collection the record lives in
 * (`sourceEntity` — e.g. "formulation", "labResult", "correctiveAction";
 * deliberately an open string, not a frozen enum, since later FVL-05.003-.008
 * extractors will cite entities that don't exist yet) plus the EXACT id of
 * the record within it (`sourceRecordId`, opaque and case-sensitive — never
 * trimmed, normalized, or reformatted, because a source system's real id may
 * itself carry meaningful casing/whitespace and silently rewriting it would
 * make the citation stop matching the source of truth).
 *
 * `sourceRecordLineageSchema` is the non-empty, deduplicated list of those
 * references a row carries (one when assembled from a single record, several
 * when assembled by joining more than one). `datasetRowBaseSchema` is the
 * composable envelope every future dataset row/payload schema
 * (FVL-05.003-.008) extends or embeds: it requires both the existing
 * `datasetSchemaVersion` (never a second version literal) and `sourceRecords`,
 * so a row is structurally unable to validate without exact lineage.
 */
const nonBlankString = (label: string) =>
  z.string().refine((value) => value.trim().length > 0, `${label} must not be blank`);

/** WHICH source entity/collection a record lives in, e.g. "formulation",
 *  "labResult". Intentionally an open string, not an enum: FVL-05.003-.008
 *  extractors will cite entity kinds this task must not freeze in advance. */
export const sourceEntitySchema = nonBlankString("sourceEntity");

/** The exact id of a record within `sourceEntity`, preserved opaque and
 *  case-sensitive — never trimmed, normalized, hashed, or shortened. */
export const sourceRecordIdSchema = nonBlankString("sourceRecordId");

/**
 * One exact citation of a source record: which entity, which id, and —
 * ONLY for a record whose true addressable identity is scoped inside a
 * parent record rather than globally unique on its own (e.g. an embedded
 * `TrialProcessStep`/`TrialObservation` array item, scoped to its owning
 * `LaboratoryTrial`) — the exact id of that owning parent.
 *
 * FVL-05.004 REOPEN (independent GPT re-audit, 2026-08-23) FINDING C:
 * an earlier corrective cycle solved cross-trial nested-id collision
 * safety by synthesizing `sourceRecordId: JSON.stringify([trial.id, step.id])`
 * — collision-safe, but it violated THIS schema's own documented contract
 * immediately above ("the exact id of a record... never reformatted"):
 * the emitted `sourceRecordId` was no longer the exact persisted child id,
 * it was a synthesized compound string. `parentRecordId` is the correct,
 * additive fix: `sourceRecordId` stays the exact unmodified persisted
 * child id; nesting/scope is represented structurally in its own field,
 * never folded into `sourceRecordId`. A citation with no parent scope
 * (the overwhelming majority — every FVL-05.003 citation, and every
 * FVL-05.004 top-level `formulation`/`formulationVersion`/`processParameter`
 * citation) simply omits `parentRecordId`; it is not a general-purpose
 * "extra context" field for other unrelated uses. */
export const sourceRecordReferenceSchema = z.object({
  sourceEntity: sourceEntitySchema,
  sourceRecordId: sourceRecordIdSchema,
  parentRecordId: sourceRecordIdSchema.optional(),
});
export type SourceRecordReference = z.infer<typeof sourceRecordReferenceSchema>;

/** The full lineage of a dataset row: at least one exact source-record
 *  reference, preserving the caller's order, with exact duplicate
 *  `(sourceEntity, parentRecordId, sourceRecordId)` triples rejected as
 *  ambiguous. The same `sourceRecordId` under a different `sourceEntity`
 *  OR under a different `parentRecordId` (including present vs. absent)
 *  is not a duplicate — this is exactly what lets two different
 *  `LaboratoryTrial`s legitimately embed a process step or observation
 *  that happens to share the same trial-scoped id (FVL-05.004
 *  LINEAGE1/LINEAGE2) without a false-positive ambiguity rejection. */
export const sourceRecordLineageSchema = z
  .array(sourceRecordReferenceSchema)
  .min(1, "a dataset row requires at least one source record reference")
  .superRefine((refs, ctx) => {
    const seen = new Set<string>();
    refs.forEach((ref, index) => {
      const key = JSON.stringify([ref.sourceEntity, ref.parentRecordId ?? null, ref.sourceRecordId]);
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `duplicate source record reference: sourceEntity="${ref.sourceEntity}" parentRecordId=${ref.parentRecordId ? `"${ref.parentRecordId}"` : "(none)"} sourceRecordId="${ref.sourceRecordId}"`,
        });
      }
      seen.add(key);
    });
  });
export type SourceRecordLineage = z.infer<typeof sourceRecordLineageSchema>;

/** Composable envelope every future dataset row/payload schema
 *  (FVL-05.003-.008) extends or embeds. Requires the existing dataset schema
 *  version and mandatory lineage — never introduces a second version field. */
export const datasetRowBaseSchema = datasetSchemaVersionedSchema.extend({
  sourceRecords: sourceRecordLineageSchema,
});
export type DatasetRowBase = z.infer<typeof datasetRowBaseSchema>;

/**
 * FVL-05.003 — formula version + exact composition + materials + material
 * properties + product family payload.
 *
 * One row per `FormulationVersion`. Reuses the repository's own canonical
 * record schemas verbatim (`formulationLineSchema`, `rawMaterialSchema`,
 * `productFamilySchema`) rather than re-modeling their fields, so a change to
 * one of those schemas is felt here automatically instead of silently
 * drifting out of sync.
 *
 * `formulaId`/`formulaCode` and `formulaVersionId`/`formulaVersionNumber` are
 * the exact persisted identities of the `Formulation` and `FormulationVersion`
 * records the row was extracted from — never regenerated or normalized.
 * `composition` is `FormulationVersion.lines` verbatim (order, ids, values,
 * casing/whitespace preserved exactly). `materials` is the deduplicated,
 * order-of-first-reference snapshot of every `RawMaterial` record an
 * `composition` line's `materialCode` resolves to. `productFamilyCode` is
 * `Formulation.productFamilyCode` copied exactly (always present on a
 * `Formulation`); `productFamily` is the matching `ProductFamily` record
 * embedded verbatim ONLY when the extractor was given that collection and it
 * contained an exact match — otherwise honestly absent, never inferred.
 */
export const formulaVersionCompositionRowSchema = datasetRowBaseSchema.extend({
  formulaId: nonBlankString("formulaId"),
  formulaCode: nonBlankString("formulaCode"),
  formulaVersionId: nonBlankString("formulaVersionId"),
  formulaVersionNumber: z.number().int().positive(),
  composition: z.array(formulationLineSchema),
  materials: z.array(rawMaterialSchema),
  productFamilyCode: nonBlankString("productFamilyCode"),
  productFamily: productFamilySchema.optional(),
});
export type FormulaVersionCompositionRow = z.infer<typeof formulaVersionCompositionRowSchema>;

/**
 * FVL-05.004 — process plan + actual process observations payload.
 *
 * MANUFACTURING PROCEDURE SOURCE (established, unchanged by the 2026-08-23
 * reopen): a persisted process-plan record that is independent of any
 * `LaboratoryTrial` DOES exist — the Data Exchange `process_parameters`
 * template/masterdata collection (`schemas/dataExchange.ts`'s
 * `processParameterSchema`, registry entry `templateCode: "process_parameters"`,
 * Rust-registered mutable collection `process_parameters`; real read
 * consumer: `ProcessParametersPanel.tsx`, which documents it as "the real
 * Manufacturing Procedure consumer"). It is deterministically linkable to
 * an exact formula version by its own natural key
 * `(formulaCode, formulaVersion, stepNumber)` against
 * `Formulation.code`/`FormulationVersion.versionNumber` — never a fabricated
 * or fuzzy match. `plannedProcedure` on `formulaVersionProcessRowSchema`
 * below carries these rows verbatim (the literal `processParameterSchema`
 * shape, not a re-modeled subset, so this dataset can never silently drift
 * from the canonical source), independent of whether any trial is linked —
 * a version can have a persisted plan with zero trials (nothing executed
 * yet), trials with no independent plan, both, or neither.
 * `FormulationVersion` itself still carries no process fields at all, and
 * the generated-session `ManufacturingPlan`/`ProcessStep` shape
 * (`apps/desktop/src/lib/formulationV2.ts`, driven by
 * `runtime/pipeline/manufacturing.py`) is a session/card PROPOSAL with no
 * persisted, formula-version-linkable identity — `promoteGeneratedFormula.ts`
 * (the one seam from a generated card to a real `FormulationVersion`) never
 * carries a card's `manufacturing` field onto the saved version — so that
 * shape stays out of scope here, unchanged from the original conclusion.
 *
 * PROCESS_PARAMETERS AUTHORITATIVE IDENTITY (independent GPT re-audit,
 * 2026-08-23, FINDING B): the registry's own natural key is
 * `(formula_code, formula_version, step_number)` — `ProcessParameter.code`
 * is NOT an independently-authored identity; the real commit path
 * (`apps/desktop/src/lib/dataExchangeCommit.ts`'s `commitProcessParameters`)
 * derives it mechanically as
 * `` `${formula_code}-v${formula_version}-step${step_number}` `` and
 * upserts on it (`findByCode` + `upsertRecords`), so two legitimately
 * committed rows can never share a natural key with different codes
 * through that path. But this extractor accepts an arbitrary supplied
 * `ProcessParameter[]` pool — nothing at the type level stops a caller
 * (a test fixture, a future non-conforming writer) from handing it two
 * records with the same `(formulaCode, formulaVersion, stepNumber)` and
 * different `code`s. The extractor (not this schema) now fails closed on
 * that natural-key collision, in addition to the pre-existing exact-`code`
 * collision check — see `formulaVersionProcessDatasetExtractor.ts`'s
 * `buildProcessParametersByNaturalKey`.
 *
 * NESTED LINEAGE (independent GPT re-audit, 2026-08-23, FINDING C): see
 * `sourceRecordReferenceSchema`'s own header comment above for the full
 * resolution — cross-trial-collision-safety is now achieved via the
 * additive `parentRecordId` field, not by synthesizing `sourceRecordId`.
 *
 * The only OTHER structured, shared-package-visible process data is
 * `LaboratoryTrial`'s own embedded `processSteps`/`observations`
 * (`schemas/laboratory.ts`) — each `TrialProcessStep` co-locates PLANNED,
 * ACTUAL, and record-management fields on one record.
 * `processStepPlanSchema`/`processStepActualObservationSchema` below split
 * it into two honestly-scoped views — a planned target must never be
 * presented as an actual observation. Full field-by-field disposition
 * (FINDING G — a durable parity test, `PARITY1` in
 * `formulaVersionProcessDatasetExtractor.test.ts`, asserts every key of
 * `trialProcessStepSchema.shape` is accounted for below, so a future
 * source field addition fails the test instead of silently drifting):
 *
 * | source field                                    | plan | actual | reason |
 * |--------------------------------------------------|------|--------|--------|
 * | `id`                                              | yes (`processStepId`) | yes (`processStepId`) | exact persisted identity both views cite |
 * | `stepNumber`                                      | yes  | yes    | ordering key both views need |
 * | `phase`                                           | yes  |        | authored-at-planning attribute |
 * | `plannedInstruction`                              | yes  |        | planning field |
 * | `requiredEquipment`                               | yes  |        | planning field |
 * | `plannedTemperatureMinC`/`MaxC`                   | yes  |        | planning field |
 * | `plannedMixingSpeedMinRpm`/`MaxRpm`               | yes  |        | planning field |
 * | `plannedDurationMinutes`                          | yes  |        | planning field |
 * | `plannedAdditionOrder`                            | yes  |        | planning field |
 * | `status`                                          |      | yes    | execution-state field |
 * | `unplanned`                                       |      | yes    | the step's very presence is itself an actual-execution fact |
 * | `skipReason`                                      |      | yes    | execution-state field |
 * | `actualStart`/`actualEnd`                         |      | yes    | execution field |
 * | `actualTemperatureC`                              |      | yes    | execution field |
 * | `actualMixingSpeedRpm`                            |      | yes    | execution field |
 * | `actualDurationMinutes`                           |      | yes    | execution field |
 * | `actualAdditionOrder`                             |      | yes    | execution field |
 * | `actualPh`                                        |      | yes    | execution field |
 * | `actualViscosity`/`viscosityUnit`                 |      | yes    | execution field |
 * | `operator`                                        |      | yes    | execution field |
 * | `observation`                                     |      | yes    | execution free-text note |
 * | `deviationNote`                                   |      | yes    | execution field |
 * | `attachments`                                     |      | yes    | FINDING F: evidence attached during/after execution (photos, scan of a filled-in log) reads as actual-execution evidence, the same bucket as `operator`/`observation`/`deviationNote` on this same merged record — never a plan-authored field. `stepHasActualData()` now treats a non-empty `attachments` array as actual-execution evidence on its own, the same principle as the prior cycle's `viscosityUnit`-only fix. |
 * | `createdAt`/`updatedAt`                           |      |        | record-management metadata (when the STEP RECORD itself was created/edited in the system) — not a process observation. Consistent with FVL-05.003 also omitting `FormulationVersion.createdAt`/`.updatedAt` from its row. |
 *
 * `trialObservationSchema` is reused VERBATIM in `processTrialSchema.observations`
 * (never re-modeled), so no parity test is needed there — drift is
 * structurally impossible by construction.
 *
 * A step marked `unplanned: true` (added mid-execution, not part of the
 * original plan) is deliberately excluded from `plannedSteps` — it was never
 * planned — while still counting as real actual-execution evidence in
 * `actualStepObservations`.
 *
 * `processTrialSchema` groups both step views plus the trial's own discrete
 * `TrialObservation` records (reused verbatim from `schemas/laboratory.ts`)
 * under the exact trial identity (`trialId`/`trialCode`) they were recorded
 * against, so multiple trials for one formula version stay distinct. A
 * `TrialObservation.processStepId`, when present, must resolve to exactly
 * one process step within that SAME trial (FINDING E) — the extractor
 * fails closed on a dangling reference rather than emitting it as if it
 * were valid process evidence.
 *
 * `LaboratoryTrial.sourceFormulaVersionId` is documented (comment only, not
 * Zod-enforced — see `schemas/laboratory.ts`) as required when
 * `sourceType === "saved_version"`. FINDING D: the extractor now fails
 * closed on a `"saved_version"` trial with a missing/blank
 * `sourceFormulaVersionId` in the supplied pool, rather than silently
 * treating it as merely "not linked to any requested version" — a
 * narrowly-scoped extractor-side fix (not a change to the shared,
 * broadly-consumed `laboratoryTrialSchema`, which is out of this task's
 * scope and blast radius).
 *
 * One row per `FormulationVersion`, same convention as FVL-05.003:
 * `trials` is empty when no `LaboratoryTrial` is linked to the version via
 * an exact `sourceType === "saved_version"` + `sourceFormulaVersionId` match
 * — never a fabricated plan or observation; `plannedProcedure` is
 * independently empty when no `process_parameters` row matches the
 * version's exact `(formulaCode, formulaVersion)` — this is the ROW-LEVEL
 * grouping/match criterion that gathers every step for that formula
 * version, NOT the per-record authoritative natural key (which is the
 * full `(formulaCode, formulaVersion, stepNumber)` — see FINDING B above
 * and `buildProcessParametersByCode`'s natural-key collision check).
 * FINDING H:
 * `Formulation.code` is NOT enforced globally unique by any authoritative
 * repository contract (`save_formulation` in `formulations.rs` keys
 * storage by `id` only, never checks `code` for a collision) — the
 * extractor now fails closed if the supplied `formulations` pool contains
 * two different formulation ids sharing the same `code`, since that makes
 * the `process_parameters` plan-key namespace genuinely ambiguous.
 *
 * DATASET_SCHEMA_VERSION (FINDING A): stays `"1.0"`, not bumped, for this
 * `plannedProcedure` addition. Evidence: (1) `SchemaMigration` exists to
 * protect PERSISTED records at an old version from becoming unreadable —
 * a repo-wide grep for `formulaVersionProcessRowSchema`/
 * `formulaVersionCompositionRowSchema`/`extractFormulaVersionProcessRows`/
 * `extractFormulaVersionDatasetRows` outside this package's own engine/
 * schema/test files returns ZERO matches: no persistence layer, UI, or
 * downstream package reads a row of this family today, so there is
 * nothing "old" anywhere to invalidate. (2) Established precedent: three
 * prior additions to this same row family — FVL-05.002 (`sourceRecords`),
 * FVL-05.003 (the whole `formulaVersionCompositionRowSchema` type), and
 * FVL-05.004's own original `formulaVersionProcessRowSchema` — all added
 * dataset-row shape under the same `"1.0"` without a bump. The row family
 * is still being incrementally assembled behind a pure, in-memory-only
 * extractor boundary; the version must bump the first time a row of this
 * family becomes reachable outside `packages/shared`'s own extractor
 * return values (persisted, exported, or consumed elsewhere) or the first
 * time an already-external-facing row shape changes thereafter — whichever
 * FVL-05 task first builds that consumer must re-verify this conclusion
 * before shipping.
 */
export const processStepPlanSchema = z.object({
  processStepId: nonBlankString("processStepId"),
  stepNumber: z.number().int().positive(),
  phase: z.string(),
  plannedInstruction: nonBlankString("plannedInstruction"),
  requiredEquipment: z.array(z.string()),
  plannedTemperatureMinC: decimalString.optional(),
  plannedTemperatureMaxC: decimalString.optional(),
  plannedMixingSpeedMinRpm: decimalString.optional(),
  plannedMixingSpeedMaxRpm: decimalString.optional(),
  plannedDurationMinutes: decimalString.optional(),
  plannedAdditionOrder: z.number().int().nonnegative().optional(),
});
export type ProcessStepPlan = z.infer<typeof processStepPlanSchema>;

export const processStepActualObservationSchema = z.object({
  processStepId: nonBlankString("processStepId"),
  stepNumber: z.number().int().positive(),
  status: z.enum(TRIAL_PROCESS_STEP_STATUSES),
  unplanned: z.boolean(),
  skipReason: z.string().optional(),
  actualStart: z.string().optional(),
  actualEnd: z.string().optional(),
  actualTemperatureC: decimalString.optional(),
  actualMixingSpeedRpm: decimalString.optional(),
  actualDurationMinutes: decimalString.optional(),
  actualAdditionOrder: z.number().int().nonnegative().optional(),
  actualPh: decimalString.optional(),
  actualViscosity: decimalString.optional(),
  viscosityUnit: z.string().optional(),
  operator: z.string().optional(),
  observation: z.string().optional(),
  deviationNote: z.string().optional(),
  attachments: z.array(attachmentReferenceSchema),
});
export type ProcessStepActualObservation = z.infer<typeof processStepActualObservationSchema>;

export const processTrialSchema = z.object({
  trialId: nonBlankString("trialId"),
  trialCode: nonBlankString("trialCode"),
  plannedSteps: z.array(processStepPlanSchema),
  actualStepObservations: z.array(processStepActualObservationSchema),
  observations: z.array(trialObservationSchema),
});
export type ProcessTrial = z.infer<typeof processTrialSchema>;

export const formulaVersionProcessRowSchema = datasetRowBaseSchema.extend({
  formulaId: nonBlankString("formulaId"),
  formulaCode: nonBlankString("formulaCode"),
  formulaVersionId: nonBlankString("formulaVersionId"),
  formulaVersionNumber: z.number().int().positive(),
  /** The version-level canonical Manufacturing Procedure, verbatim
   *  `process_parameters` rows (`processParameterSchema`) whose own
   *  `(formulaCode, formulaVersion)` matches this row's exact formula/
   *  version identity — the grouping criterion, not the per-record
   *  authoritative natural key (`(formulaCode, formulaVersion, stepNumber)`,
   *  enforced by `buildProcessParametersByCode`). Empty when no such persisted row exists —
   *  never fabricated. Independent of `trials`: a version may have a
   *  persisted procedure with no trial ever run against it. */
  plannedProcedure: z.array(processParameterSchema),
  trials: z.array(processTrialSchema),
});
export type FormulaVersionProcessRow = z.infer<typeof formulaVersionProcessRowSchema>;
