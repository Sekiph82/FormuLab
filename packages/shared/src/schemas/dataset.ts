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
import { formulationLineSchema } from "./formulation";
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
