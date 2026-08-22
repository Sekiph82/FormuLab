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
import { decimalString, formulationLineSchema } from "./formulation";
import { TRIAL_PROCESS_STEP_STATUSES, trialObservationSchema } from "./laboratory";
import { rawMaterialSchema } from "./materials";
import { productFamilySchema } from "./product";

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

/** One exact citation of a source record: which entity, which id. */
export const sourceRecordReferenceSchema = z.object({
  sourceEntity: sourceEntitySchema,
  sourceRecordId: sourceRecordIdSchema,
});
export type SourceRecordReference = z.infer<typeof sourceRecordReferenceSchema>;

/** The full lineage of a dataset row: at least one exact source-record
 *  reference, preserving the caller's order, with exact duplicate
 *  `(sourceEntity, sourceRecordId)` pairs rejected as ambiguous. The same
 *  record id under two different `sourceEntity` values is not a duplicate. */
export const sourceRecordLineageSchema = z
  .array(sourceRecordReferenceSchema)
  .min(1, "a dataset row requires at least one source record reference")
  .superRefine((refs, ctx) => {
    const seen = new Set<string>();
    refs.forEach((ref, index) => {
      const key = JSON.stringify([ref.sourceEntity, ref.sourceRecordId]);
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `duplicate source record reference: sourceEntity="${ref.sourceEntity}" sourceRecordId="${ref.sourceRecordId}"`,
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
 * There is no persisted "manufacturing procedure" record independent of a
 * trial: `FormulationVersion` carries no process fields at all, and the only
 * structured, shared-package-visible process data is `LaboratoryTrial`'s own
 * embedded `processSteps`/`observations` (`schemas/laboratory.ts`) — each
 * `TrialProcessStep` co-locates its PLANNED fields (`plannedInstruction`,
 * `plannedTemperature*`, `plannedMixingSpeed*`, `plannedDurationMinutes`,
 * `plannedAdditionOrder`) and its ACTUAL execution fields
 * (`actualStart`/`actualEnd`, `actualTemperature*`, `actualMixingSpeedRpm`,
 * `actualDurationMinutes`, `actualAdditionOrder`, `actualPh`,
 * `actualViscosity`, `operator`, `observation`, `deviationNote`) on the same
 * record. `processStepPlanSchema` and `processStepActualObservationSchema`
 * below split that one record into two honestly-scoped views — a planned
 * target must never be presented as an actual observation — without
 * inventing a second source model for either half.
 *
 * A step marked `unplanned: true` (added mid-execution, not part of the
 * original plan) is deliberately excluded from `plannedSteps` — it was never
 * planned — while still counting as real actual-execution evidence in
 * `actualStepObservations`.
 *
 * `processTrialSchema` groups both step views plus the trial's own discrete
 * `TrialObservation` records (reused verbatim from `schemas/laboratory.ts`)
 * under the exact trial identity (`trialId`/`trialCode`) they were recorded
 * against, so multiple trials for one formula version stay distinct.
 *
 * One row per `FormulationVersion`, same convention as FVL-05.003:
 * `trials` is empty when no `LaboratoryTrial` is linked to the version via
 * an exact `sourceType === "saved_version"` + `sourceFormulaVersionId` match
 * — never a fabricated plan or observation.
 */
export const processStepPlanSchema = z.object({
  processStepId: nonBlankString("processStepId"),
  stepNumber: z.number().int().positive(),
  phase: nonBlankString("phase"),
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
  trials: z.array(processTrialSchema),
});
export type FormulaVersionProcessRow = z.infer<typeof formulaVersionProcessRowSchema>;
