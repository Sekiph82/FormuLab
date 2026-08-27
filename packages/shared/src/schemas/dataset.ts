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
 * At FVL-05.001 completion this module defined only the two version
 * constants above — not yet the dataset row shape, the feature vector
 * shape, or any extractor/normalizer. That historical scope note is
 * stale: this module has since been extended in place by every later
 * FVL-05 task that needed a schema here rather than a new file, and now
 * also contains the FVL-05.002 lineage model
 * (`sourceRecordReferenceSchema`/`sourceRecordLineageSchema`/
 * `datasetRowBaseSchema`), the FVL-05.003 formula-version composition row
 * (`formulaVersionCompositionRowSchema`), the FVL-05.004 process row
 * (`processStepPlanSchema`/`processStepActualObservationSchema`/
 * `processTrialSchema`/`formulaVersionProcessRowSchema`), and the
 * FVL-05.005 trial/test-result row (`trialTestResultsSchema`/
 * `formulaVersionTestResultRowSchema`), and the FVL-05.006 stability
 * study/sample/result row (`stabilitySampleResultsSchema`/
 * `stabilityStudySamplesSchema`/`formulaVersionStabilityRowSchema`) — see
 * each section's own header comment below for its specific contract.
 */
import { z } from "zod";
import { correctiveActionSchema } from "./correctiveActions";
import { costSnapshotSchema } from "./costing";
import { decimalString } from "./primitives";
import { processParameterSchema } from "./dataExchange";
import { doeDesignSchema, doeObservationSchema, doeRunSchema } from "./doe";
import { formulationLineSchema } from "./formulation";
import { trialObservationSchema, trialProcessStepSchema } from "./laboratory";
import { testMethodSnapshotSchema } from "./laboratoryStandards";
import { rawMaterialSchema } from "./materials";
import { productFamilySchema } from "./product";
import {
  packagingSystemSnapshotSchema,
  stabilityConditionSchema,
  stabilityResultSchema,
  stabilitySampleSchema,
  stabilityTimePointSchema,
} from "./stability";
import { testResultSchema } from "./testDefinitions";

/** Current dataset (row/lineage) schema version. Bump when the shape of a
 *  dataset row changes (a field is added, removed, or renamed by one of
 *  the FVL-05.003-.008 extractors). */
export const DATASET_SCHEMA_VERSION = "1.6" as const;

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
 *  in a way that changes the shape or meaning of a feature vector.
 *
 *  FIRST BUMP (FVL-05.010, 2026-08-27): `"1.0"` -> `"1.1"`. FVL-05.009
 *  defined the first feature-family shape (`formulaVersionFeatureRowSchema`)
 *  at `"1.0"` with no prior shape to diverge from — the same "nothing
 *  existed before, nothing changed" case `DATASET_SCHEMA_VERSION` itself
 *  was in when FVL-05.002 defined the first dataset row shape and did NOT
 *  bump. FVL-05.010 adds `formulaVersionTargetRowSchema`, a SECOND,
 *  brand-new feature-family row type — the exact situation
 *  `DATASET_SCHEMA_VERSION`'s own SECOND BUMP (FVL-05.005) already
 *  resolved: "a new row type is a shape change and must bump, with no
 *  exception for being additive/new rather than a field edit to an
 *  existing type." Direct, already-established precedent applied here
 *  without exception — `formulaVersionFeatureRowSchema` (FVL-05.009's own
 *  predictor row) is UNCHANGED in field shape, but shares this ONE literal
 *  with every feature-family row, so it now requires `"1.1"` too, the same
 *  way every unrelated dataset row already requires the current
 *  `DATASET_SCHEMA_VERSION` regardless of whether ITS OWN shape changed in
 *  a given bump. Compatibility: a repo-wide grep for
 *  `formulaVersionFeatureRowSchema`/`extractFormulaVersionFeatureRows`
 *  outside this package's own engine/schema/test files returns ZERO
 *  matches — no persisted feature row exists anywhere, so there is nothing
 *  to migrate, and no `SchemaMigration` entry is registered for this bump
 *  (none is applicable). `featureSchemaVersionSchema` is a `z.literal` — a
 *  row still carrying `featureSchemaVersion: "1.0"` is now explicitly,
 *  structurally REJECTED (proven by `dataset.test.ts`). */
export const FEATURE_SCHEMA_VERSION = "1.2" as const;

/** SECOND BUMP (FVL-05.010 corrective cycle, `AUDIT_FVL05_GPT_000015`,
 *  2026-08-27): `"1.1"` -> `"1.2"`. The corrective cycle added
 *  `timePoint`/`storageCondition` to `targetDefinitionSchema` (finding
 *  B — `testResult` target identity needed persisted measurement context
 *  the original shape structurally forbade) and a new `context` field to
 *  `targetObservationSchema` (`sampleId`/`instrument`/`methodSnapshot`).
 *  Both are ADDITIVE and OPTIONAL, but the standing rule draws no
 *  distinction — the direct, already-established precedent is
 *  `DATASET_SCHEMA_VERSION`'s own fourth corrective cycle (FVL-05.004,
 *  `AUDIT_FVL05_GPT_000001` finding C), which bumped for an additive
 *  OPTIONAL `parentRecordId` field exactly like this one, and
 *  `DATASET_SCHEMA_VERSION`'s own fourth bump (FVL-05.006 corrective
 *  cycle), which bumped again for a REQUIRED field added to an
 *  ALREADY-SHIPPED row type it had itself introduced one bump earlier —
 *  the exact same "corrective cycle changes a shape this same row family
 *  already shipped" situation FVL-05.010's target row is now in.
 *  Compatibility unchanged: still zero persisted feature rows of any kind
 *  anywhere (repo-wide grep re-confirmed), so no `SchemaMigration` entry
 *  is applicable; `"1.1"` (and `"1.0"`) are now both structurally
 *  rejected. */

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
export const nonBlankString = (label: string) =>
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
 * DATASET_SCHEMA_VERSION (GPT audit 000002, finding 1 — RESOLVED): a
 * prior cycle left `DATASET_SCHEMA_VERSION` at `"1.0"` after adding
 * `plannedProcedure`, reasoning from usage evidence (no consumers exist
 * yet) rather than from the ORIGINAL, pre-existing, still-authoritative
 * rule stated on `DATASET_SCHEMA_VERSION` itself: "bump when the shape
 * of a dataset row changes (a field is added, removed, or renamed by one
 * of the FVL-05.003-.008 extractors)". That usage-based exception was
 * never actually written into that rule, so it directly contradicted it
 * — two competing rules cannot both be authoritative. There is exactly
 * ONE rule, unchanged since FVL-05.001's original commit (`78c6866`):
 * bump on every dataset-row shape change. `DATASET_SCHEMA_VERSION` is
 * therefore bumped `"1.0"` -> `"1.1"` in THIS cycle, covering every
 * shape change this row family has accumulated since `"1.0"` was first
 * defined and never bumped (FVL-05.002's `sourceRecords`, FVL-05.003's
 * whole row type, FVL-05.004's original row type, `plannedProcedure`,
 * and this same cycle's additive `parentRecordId`) — a single bump now
 * catches up every previously-un-bumped change in one step, and every
 * FUTURE shape change bumps again, with no further exception. Compatibility:
 * `SchemaMigration` (`engine/migrations.ts`) exists to convert PERSISTED
 * records at an old version forward; a repo-wide grep for
 * `formulaVersionProcessRowSchema`/`formulaVersionCompositionRowSchema`/
 * `extractFormulaVersionProcessRows`/`extractFormulaVersionDatasetRows`
 * outside this package's own engine/schema/test files returns ZERO
 * matches — no persisted row of this family exists anywhere, so there is
 * nothing to migrate, and no `SchemaMigration` entry is registered for
 * this bump (none is applicable). `datasetSchemaVersionSchema` is a
 * `z.literal` — a row still carrying `datasetSchemaVersion: "1.0"` is now
 * explicitly, structurally REJECTED by every schema in this row family
 * (proven by `dataset.test.ts`), so an old- and new-shaped row can never
 * be ambiguously accepted as the same version.
 *
 * SECOND BUMP (FVL-05.005, 2026-08-24): `"1.1"` -> `"1.2"`. FVL-05.005
 * adds `trialTestResultsSchema`/`formulaVersionTestResultRowSchema`, a
 * brand-new row type — under the ONE rule above (and its own direct
 * precedent: the first bump explicitly counted FVL-05.003's brand-new
 * row type as a "shape change"), a new row type is a shape change and
 * must bump, with no exception for being additive/new rather than a
 * field edit to an existing type. Compatibility: same reasoning as the
 * first bump — repo-wide grep re-confirmed zero persisted rows of any
 * FVL-05 row family exist anywhere, so no `SchemaMigration` entry is
 * registered for this bump either (still not applicable); the superseded
 * `"1.1"` literal is now itself structurally rejected, same as `"1.0"`
 * before it.
 *
 * THIRD BUMP (FVL-05.006, 2026-08-24): `"1.2"` -> `"1.3"`. Same reasoning
 * again: `stabilitySampleResultsSchema`/`stabilityStudySamplesSchema`/
 * `formulaVersionStabilityRowSchema` are a brand-new row type, which the
 * standing rule (and its own now-twice-applied precedent) requires a
 * bump for. Compatibility unchanged from the prior two bumps — still
 * zero persisted rows of any FVL-05 row family anywhere, so no
 * `SchemaMigration` entry is applicable; `"1.2"` (and `"1.1"`, `"1.0"`)
 * are now all structurally rejected.
 *
 * FOURTH BUMP (FVL-05.006 corrective cycle, independent GPT re-audit
 * `AUDIT_FVL05_GPT_000007`, 2026-08-24): `"1.3"` -> `"1.4"`. The original
 * FVL-05.006 shape omitted the persisted `StabilityCondition`/
 * `StabilityTimePoint` catalog records that give
 * `StabilitySample.conditionId`/`.timePointId` their real domain meaning
 * — a HIGH finding, since `stabilityStudySamplesSchema` now gains new
 * `conditions`/`timePoints` fields (see that schema's own header comment
 * below for the full corrective rationale). This is a dataset-row shape
 * change under the same standing rule the prior three bumps applied —
 * adding required fields to an existing row type is exactly the "field
 * is added" case the rule's own text names, no different in kind from a
 * brand-new row type. Compatibility unchanged: still zero persisted rows
 * of any FVL-05 row family anywhere (repo-wide grep re-confirmed), so no
 * `SchemaMigration` entry is applicable; `"1.3"` (and `"1.2"`, `"1.1"`,
 * `"1.0"`) are now all structurally rejected.
 *
 * FIFTH BUMP (FVL-05.007, 2026-08-24): `"1.4"` -> `"1.5"`. Same standing
 * rule, same direct precedent (every prior brand-new row type bumped):
 * `doeStudyRunsSchema`/`doeDesignRunsSchema`/`doeRunObservationsSchema`/
 * `formulaVersionDoeRowSchema` are a brand-new row type. Compatibility
 * unchanged: still zero persisted rows of any FVL-05 row family anywhere
 * (repo-wide grep re-confirmed), so no `SchemaMigration` entry is
 * applicable; `"1.4"` (and `"1.3"`, `"1.2"`, `"1.1"`, `"1.0"`) are now all
 * structurally rejected.
 *
 * SIXTH BUMP (FVL-05.008, 2026-08-24): `"1.5"` -> `"1.6"`. Same standing
 * rule, same direct precedent: `stabilityStudyPackagingContextSchema`/
 * `formulaVersionCorrectiveCostContextRowSchema` are a brand-new row
 * type. Compatibility unchanged: still zero persisted rows of any FVL-05
 * row family anywhere (repo-wide grep re-confirmed), so no
 * `SchemaMigration` entry is applicable; `"1.5"` (and every prior
 * superseded literal) are now all structurally rejected.
 */
/**
 * GPT audit 000002, finding 2 (RESOLVED): `processStepPlanSchema`/
 * `processStepActualObservationSchema` previously hand-modeled each
 * selected field's type/optionality/default independently of
 * `trialProcessStepSchema` — `PARITY1` (below, in the extractor test)
 * could only catch a field NAME missing from both views, never a
 * SEMANTIC drift (a source field's default/optional/enum/refinement
 * changing while the dataset view stayed stale, e.g. the `phase`
 * mismatch AUDIT_000018 found). Fixed by deriving both views via `.pick()`
 * directly from `trialProcessStepSchema` — each picked field is the
 * EXACT SAME zod schema instance as the source, so a semantic change to
 * an already-selected source field is felt here automatically, not just
 * a renamed/removed/added key. Two independent `.pick()` calls both
 * legitimately include `stepNumber` (needed by both views for ordering);
 * `id` is renamed to `processStepId` by extending with
 * `trialProcessStepSchema.shape.id` directly (the same constraint
 * object, not a re-typed copy) rather than picking it under its
 * original name. `PARITY1` is KEPT, not removed — composition guarantees
 * an already-picked field can never semantically drift, but it does
 * NOT automatically surface a brand-new source field (`.pick()` only
 * includes what it's explicitly told to); `PARITY1`'s key-membership
 * check is still the only guard against that case, so together the two
 * mechanisms catch both required cases per audit 000002.
 */
export const processStepPlanSchema = trialProcessStepSchema
  .pick({
    stepNumber: true,
    phase: true,
    plannedInstruction: true,
    requiredEquipment: true,
    plannedTemperatureMinC: true,
    plannedTemperatureMaxC: true,
    plannedMixingSpeedMinRpm: true,
    plannedMixingSpeedMaxRpm: true,
    plannedDurationMinutes: true,
    plannedAdditionOrder: true,
  })
  .extend({
    processStepId: trialProcessStepSchema.shape.id,
  });
export type ProcessStepPlan = z.infer<typeof processStepPlanSchema>;

export const processStepActualObservationSchema = trialProcessStepSchema
  .pick({
    stepNumber: true,
    status: true,
    unplanned: true,
    skipReason: true,
    actualStart: true,
    actualEnd: true,
    actualTemperatureC: true,
    actualMixingSpeedRpm: true,
    actualDurationMinutes: true,
    actualAdditionOrder: true,
    actualPh: true,
    actualViscosity: true,
    viscosityUnit: true,
    operator: true,
    observation: true,
    deviationNote: true,
    attachments: true,
  })
  .extend({
    processStepId: trialProcessStepSchema.shape.id,
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

/**
 * FVL-05.005 — LaboratoryTrial + TestResult payload.
 *
 * SOURCE CONTRACT (recovered directly from repository source, not
 * inferred from the tracker's intentionally short task title):
 * `TestResult` (`schemas/testDefinitions.ts`'s `testResultSchema`) links
 * to its owning trial by a single, direct, exact field —
 * `trialId: z.string().min(1)` — never a composite/fuzzy match, and
 * never invented here: this is the ONLY relationship between
 * `LaboratoryTrial` and `TestResult` that exists in source. Unlike
 * `TrialProcessStep`/`TrialObservation` (FVL-05.004), `TestResult` is
 * NOT an embedded array on `LaboratoryTrial` — it is its own real,
 * top-level, APPEND-ONLY masterdata collection (`test_results`,
 * `append_only: true` in `masterdata.rs`, vs. `laboratory_trials`'
 * `append_only: false`): recording a result is an event, and
 * `engine/testResults.ts`'s `reviseTestResult` never mutates a prior
 * result in place, it creates a NEW record with `revisesResultId`
 * pointing at the one being revised, so a full revision history is
 * multiple real, distinct, separately-identified `TestResult` records.
 * `trialTestResultsSchema` below therefore embeds `testResultSchema`
 * VERBATIM (never re-modeled — no plan/actual split is needed the way
 * FVL-05.004 needed one, since a `TestResult` is already purely an
 * ACTUAL recorded measurement event start to finish, never a plan), and
 * this extractor emits EVERY persisted `TestResult` for a linked trial —
 * including every entry in a revision chain — never collapsing to
 * "latest revision only", which would be an extractor-invented business
 * rule this task was never asked to apply.
 *
 * Because `TestResult.id` is a genuinely GLOBAL identity (its own
 * top-level collection, not an embedded array scoped to one trial the
 * way `TrialProcessStep.id`/`TrialObservation.id` are), lineage citations
 * for a `testResult` never set `parentRecordId` — per the current FVL-05
 * lineage contract (`sourceRecordReferenceSchema`'s own header comment),
 * `parentRecordId` is used ONLY when a record's true addressable
 * identity is parent-scoped, which a `TestResult` genuinely is not.
 *
 * `TestDefinition` (the test's own method/unit/spec-limit template) is
 * deliberately NOT embedded in this row: the task title names exactly
 * two entities (`LaboratoryTrial` + `TestResult`), `TestResult` already
 * carries everything needed to interpret a recorded value on its own
 * (`resultType`, `unit`, `instrument`, `methodSnapshot` — an immutable
 * snapshot of the method actually used, captured at creation), and
 * `TestDefinition.targetValue`/`.minimum`/`.maximum` are PLANNED
 * spec/reference values, never a measured actual — presenting them
 * alongside `TestResult` here would risk exactly the planned-vs-actual
 * conflation FVL-05.004 was so deliberate about avoiding. A future task
 * that needs test-definition context can add it without touching this
 * row's already-correct trial/result identity.
 *
 * A trial is "linked" via the exact same rule FVL-05.004 established:
 * `sourceType === "saved_version"` AND `sourceFormulaVersionId` exactly
 * matches the requested version's id; a linked trial whose `projectId`
 * does not resolve to the version's owning formulation fails closed
 * (`trial_formula_link_conflict`), never silently attributed or dropped.
 * A `TestResult` whose `trialId` does not resolve to ANY trial in the
 * supplied pool fails closed (`test_result_trial_not_found`) — the same
 * "audit the whole pool up front" discipline `formulation_not_found`
 * already applies to `FormulationVersion.formulationId`; a `TestResult`
 * whose trial DOES exist in the pool but is not linked to the
 * REQUESTED version is legitimately irrelevant to this row and is simply
 * not included (never an error) — this is what keeps a result linked to
 * the wrong trial/version from ever leaking into a row.
 *
 * One row per `FormulationVersion`, same convention as FVL-05.003/.004:
 * `trials` is empty when no `LaboratoryTrial` is linked to the version.
 */
export const trialTestResultsSchema = z.object({
  trialId: nonBlankString("trialId"),
  trialCode: nonBlankString("trialCode"),
  testResults: z.array(testResultSchema),
});
export type TrialTestResults = z.infer<typeof trialTestResultsSchema>;

export const formulaVersionTestResultRowSchema = datasetRowBaseSchema.extend({
  formulaId: nonBlankString("formulaId"),
  formulaCode: nonBlankString("formulaCode"),
  formulaVersionId: nonBlankString("formulaVersionId"),
  formulaVersionNumber: z.number().int().positive(),
  trials: z.array(trialTestResultsSchema),
});
export type FormulaVersionTestResultRow = z.infer<typeof formulaVersionTestResultRowSchema>;

/**
 * FVL-05.006 — stability studies/samples/results payload.
 *
 * SOURCE CONTRACT (recovered directly from repository source, not
 * inferred from the tracker's short task title). `StabilityStudy`
 * (`schemas/stability.ts`) links to a formula version by the EXACT SAME
 * pattern `LaboratoryTrial` uses (FVL-05.004/.005):
 * `sourceType: z.enum(["saved_version","working_draft"])` +
 * `sourceFormulaVersionId?: string`, plus `projectId` naming the owning
 * `Formulation.id`. `laboratoryTrialId?: string` is a SEPARATE, optional
 * cross-reference to a specific trial — it plays no role in
 * study-to-version linkage (that is exclusively via
 * `sourceFormulaVersionId`) and is not resolved/embedded here, matching
 * this task's own title scope.
 *
 * THREE REAL, SEPARATE TOP-LEVEL PERSISTED COLLECTIONS form the
 * hierarchy (confirmed in `masterdata.rs`): `stability_studies`
 * (mutable), `stability_samples` (mutable), `stability_results`
 * (APPEND-ONLY, same convention as `test_results` — recording a result
 * is an event; `revisesResultId` — see below — points at a prior record,
 * never mutates it). Because all three are independent top-level
 * collections, `StabilityStudy.id`/`StabilitySample.id`/
 * `StabilityResult.id` are each GENUINELY GLOBAL identities — none of
 * them are embedded-array-scoped the way `TrialProcessStep`/
 * `TrialObservation` are, so lineage citations for all three never set
 * `parentRecordId` (per the current FVL-05 lineage contract's "only when
 * true source identity is parent-scoped" rule) — the exact same
 * reasoning FVL-05.005 established for `TestResult`.
 *
 * `StabilityTrend` (`schemas/stability.ts`) is deliberately NOT
 * extracted: `engine/stability.ts`'s `computeStabilityTrend` is a PURE
 * COMPUTED function — confirmed it has NO registered `masterdata.rs`
 * collection at all — so it is derived analytics, not raw persisted
 * source evidence, the same category `TestDefinition` fell into for
 * FVL-05.005. `StabilityFailure` is also NOT extracted: it is a separate
 * incident-tracking collection (the stability analog of `TrialDeviation`,
 * which FVL-05.004 also did not extract), out of this task's own
 * "studies/results" title scope.
 *
 * HIERARCHY PRESERVATION: a study groups its samples
 * (`sample.studyId === study.id`); a sample groups its results
 * (`result.sampleId === sample.id`). `StabilitySample` is embedded
 * VERBATIM in full (`stabilitySampleSchema`, unlike the id+code-only
 * treatment `LaboratoryTrial`/`StabilityStudy` get at their own grouping
 * level) because a sample's own fields — `conditionId`, `timePointId`,
 * `replicateNumber`, `status`, `storageLocation` — are genuine
 * MEASUREMENT CONTEXT needed to interpret its nested results (which
 * condition/time-point/replicate produced them), not administrative
 * project-management metadata the way a study's `title`/`owner`/
 * `protocol` are. `StabilityResult` is embedded verbatim too
 * (`stabilityResultSchema`, no re-modeling, zero parity risk).
 *
 * CORRECTIVE CYCLE (`AUDIT_FVL05_GPT_000007`, 2026-08-24) —
 * `StabilityCondition`/`StabilityTimePoint` ARE resolved and embedded,
 * superseding the original implementation's exclusion of them. The
 * original rationale ("reference/template data, not part of the
 * measurement hierarchy, same as `TestDefinition`") was DIRECTLY
 * CONTRADICTED by `stabilityConditionSchema`'s own source comment, which
 * says a condition's `label`/tolerance fields are "fine to read live
 * since it does not retroactively change what was already measured" —
 * the exact opposite of a frozen, capture-once snapshot field. Direct
 * source evidence: `engine/stability.ts`'s `generateStabilitySamples(
 * study, conditions, timePoints)` is the ONLY function anywhere in the
 * codebase that constructs a `StabilitySample` (confirmed by a
 * repo-wide grep for `newId("stabsample")` — exactly one call site) —
 * it takes real `StabilityCondition[]`/`StabilityTimePoint[]` records as
 * direct parameters and copies `condition.id`/`timePoint.id` onto the
 * sample it creates, and its ONLY production caller
 * (`StabilityPanel.tsx`) resolves those arrays from
 * `SEED_STABILITY_CONDITIONS`/`SEED_STABILITY_TIME_POINTS`
 * (`catalog/stabilityConditions.ts`) — these are causal source records
 * a sample is generated FROM, not decorative display-only lookups.
 * Unlike `StabilityStudy`/`StabilitySample`/`StabilityResult`, conditions
 * and time points are NOT registered as their own mutable
 * `masterdata.rs` collection — `apps/desktop/src/lib/dataExchangeCommit.ts`
 * confirms the Data Exchange import path resolves an imported
 * `condition_code`/`time_point` against this exact same
 * `SEED_STABILITY_CONDITIONS`/`SEED_STABILITY_TIME_POINTS` catalog
 * (rejecting anything not in it), proving it is the one, single,
 * canonical source of every condition/time-point identity in the
 * system, not an arbitrary caller-suppliable pool the way
 * `stabilityStudies`/`stabilitySamples`/`stabilityResults` are. The
 * extractor accordingly takes it as a required resolution pool (same
 * calling convention as the other three pools) rather than importing
 * the catalog module directly, keeping the extractor itself free of any
 * import of application/UI-layer data and fully testable with synthetic
 * fixtures.
 *
 * STUDY-MEMBERSHIP INVARIANT (proven from source, not invented, per the
 * audit's explicit instruction not to assume it): every legitimately
 * generated sample's `conditionId`/`timePointId` was, at generation
 * time, a member of its own study's `conditionIds`/`timePointIds` —
 * `StabilityPanel.tsx`'s sample-generation call site filters
 * `SEED_STABILITY_CONDITIONS`/`SEED_STABILITY_TIME_POINTS` by
 * `study.conditionIds`/`study.timePointIds` BEFORE calling
 * `generateStabilitySamples`, and since `generateStabilitySamples` is
 * the only sample constructor anywhere, every real sample's
 * `conditionId`/`timePointId` is drawn exclusively from that
 * pre-filtered set. `study.conditionIds`/`.timePointIds` is proven
 * MONOTONICALLY GROWING, never shrinking: a repo-wide grep for every
 * write site found exactly two — `StabilityPanel.tsx`'s study-creation
 * flow (sets the initial array once) and
 * `dataExchangeCommit.ts`'s `commitStabilityProtocols` import handler
 * (`Set`-based union-only `conditionIds.add(...)`/`timePointIds.add(...)`,
 * never a deletion) — so a condition/time-point membership true at
 * generation time remains true forever after. This extractor therefore
 * fails closed when a supplied sample's `conditionId`/`timePointId` is
 * not a member of its own study's `conditionIds`/`timePointIds` array,
 * the same "prove it from the real writer/lifecycle contract, do not
 * invent an unproven rule" discipline every other fail-closed check in
 * this file already follows.
 *
 * `StabilityResult` also carries `studyId`/`conditionId`/`timePointId`
 * directly, denormalized against its own resolved sample's identical
 * fields — a genuine redundant-field contradiction (the result claims a
 * different study/condition/time-point than the sample it belongs to)
 * fails closed, the same "contradictory link" discipline
 * `trial_formula_link_conflict` established in FVL-05.004.
 *
 * `revisesResultId` REFERENTIAL INTEGRITY: `engine/resultHistory.ts`'s
 * own module comment states its revision-chain helpers are "shared by
 * laboratory TestResult and StabilityResult" — the SAME authoritative
 * domain semantics FVL-05.005's `AUDIT_FVL05_GPT_000005` corrective
 * cycle recovered for `TestResult.revisesResultId` apply directly here.
 * `StabilityResult` has NO `retestOf` field (confirmed by direct
 * inspection of `stabilityResultSchema` — only `TestResult` has that
 * field), so only `revisesResultId` is validated. The natural scope
 * analog to "same trial" (which doesn't exist on `StabilityResult`) is
 * SAME SAMPLE: `StabilitySample`'s own schema comment says a sample is
 * "tested once then disposed" — a revision is a correction of THAT one
 * physical measurement, so a `revisesResultId` pointing at a result on a
 * DIFFERENT sample is not a legitimate revision (it would be revising a
 * different physical pull-point entirely). No source evidence proves
 * cross-sample revision linkage is legitimate, so — per the same
 * "enforce the tightest defensible scope unless proven otherwise"
 * instruction FVL-05.005 followed — this extractor fails closed on a
 * dangling reference, a cross-sample reference, a self-reference, or any
 * longer cycle, matching FVL-05.005's fail-closed (not
 * warn-and-continue) design for the same reason: a historical dataset
 * has no way to hand a downstream consumer a dismissible warning.
 *
 * One row per `FormulationVersion`, same convention as FVL-05.003/.004/
 * .005: `studies` is empty when no `StabilityStudy` is linked to the
 * version.
 */
export const stabilitySampleResultsSchema = z.object({
  sample: stabilitySampleSchema,
  results: z.array(stabilityResultSchema),
});
export type StabilitySampleResults = z.infer<typeof stabilitySampleResultsSchema>;

/**
 * Corrective addition (`AUDIT_FVL05_GPT_000007`): `conditions`/
 * `timePoints` hold the exact, deduplicated `StabilityCondition`/
 * `StabilityTimePoint` catalog records actually referenced by at least
 * one of this study's `samples` — a per-study set, not one copy per
 * sample, avoiding wasteful duplication when several samples in the
 * same study (as they normally do — one sample per condition x time
 * point x replicate) share a condition/time point. `stabilityConditionSchema`/
 * `stabilityTimePointSchema` are reused 100% VERBATIM (zero re-modeling,
 * zero parity risk, same discipline as `stabilitySampleSchema`/
 * `stabilityResultSchema`). Each sample's own `conditionId`/`timePointId`
 * remains the join key into these arrays — resolving a specific sample's
 * condition/time-point record is `conditions.find(c => c.id ===
 * sample.conditionId)`, never a second copy embedded per sample.
 */
export const stabilityStudySamplesSchema = z.object({
  studyId: nonBlankString("studyId"),
  studyCode: nonBlankString("studyCode"),
  conditions: z.array(stabilityConditionSchema),
  timePoints: z.array(stabilityTimePointSchema),
  samples: z.array(stabilitySampleResultsSchema),
});
export type StabilityStudySamples = z.infer<typeof stabilityStudySamplesSchema>;

export const formulaVersionStabilityRowSchema = datasetRowBaseSchema.extend({
  formulaId: nonBlankString("formulaId"),
  formulaCode: nonBlankString("formulaCode"),
  formulaVersionId: nonBlankString("formulaVersionId"),
  formulaVersionNumber: z.number().int().positive(),
  studies: z.array(stabilityStudySamplesSchema),
});
export type FormulaVersionStabilityRow = z.infer<typeof formulaVersionStabilityRowSchema>;

/**
 * FVL-05.007 — DOE studies/designs/runs/observations payload.
 *
 * SOURCE CONTRACT (recovered directly from repository source, not inferred
 * from the tracker's short task title). `DoeStudy` (`schemas/doe.ts`) links
 * to a formula version by a DIRECT field, not the `sourceType`/
 * `sourceFormulaVersionId` pattern FVL-05.004/.005/.006 used:
 * `baselineFormulaVersionId: z.string().min(1)` — always required, never
 * optional, and documented + enforced by `engine/doeDesign.ts`'s
 * `createDoeStudy` as "a saved `FormulationVersion.id` — never a working
 * draft" (it throws if the caller passes a draft's placeholder status).
 * `DoeStudy` ALSO carries its own `formulationId: z.string().min(1)`,
 * separate from `projectId` — unlike `StabilityStudy`, which only had
 * `projectId`. The one real production writer
 * (`DoePanel.tsx`'s `handleCreateStudy`) always sets BOTH
 * `projectId: formulation.id` AND `formulationId: formulation.id` to the
 * exact same value, so `formulationId` (the more specifically-named field,
 * matching this extractor's own `formulaId` join target) is used as the
 * owning-formulation link; a study whose `formulationId` does not resolve
 * to the requested version's owning formulation fails closed
 * (`doe_study_formula_link_conflict`), the same "conflicting link" pattern
 * FVL-05.004/.005/.006 established for `trial_formula_link_conflict`/
 * `study_formula_link_conflict`.
 *
 * FOUR REAL, SEPARATE TOP-LEVEL PERSISTED COLLECTIONS form the hierarchy
 * this task extracts (confirmed in `masterdata.rs`): `doe_studies`,
 * `doe_designs`, `doe_runs`, `doe_observations` — all four MUTABLE
 * (`append_only: false`), unlike `stability_results`/`test_results`.
 * Because all four are independent top-level collections,
 * `DoeStudy.id`/`DoeDesign.id`/`DoeRun.id`/`DoeObservation.id` are each
 * GENUINELY GLOBAL identities, so lineage citations for all four never set
 * `parentRecordId` — the same reasoning FVL-05.005/.006 established for
 * `TestResult`/`StabilitySample`/`StabilityResult`.
 *
 * `DoeFactor`/`DoeConstraint`/`DoeResponse` ARE also real, separate
 * top-level collections (`doe_factors`/`doe_constraints`/`doe_responses`),
 * but this extractor deliberately does NOT accept them as separate
 * resolution pools, because `DoeDesign.factorSnapshot`/`.constraintSnapshot`/
 * `.responseSnapshot` (`schemas/doe.ts`) are FROZEN COPIES of exactly those
 * records, captured at design-generation time specifically "to prevent live
 * record edits from reinterpreting historical designs" (that schema's own
 * header comment) — the current, single production writer
 * (`generateDoeDesign`, `engine/doeDesign.ts`) embeds the live
 * factor/constraint/response rows it was called with directly into the
 * design record it returns, and `DoePanel.tsx`'s only call site persists
 * `doe_factors`/`doe_constraints`/`doe_responses` and the design in the
 * SAME atomic wizard submission — so a design's own frozen snapshot is
 * already the authoritative, exact source for interpreting that design's
 * runs' `factorSettings.factorCode` and that design's runs' observations'
 * `responseId`, with no live-catalog drift possible. Embedding `DoeDesign`
 * verbatim (`doeDesignSchema`, unmodified) therefore already carries every
 * factor/constraint/response fact needed, without a second, separately
 * resolved and independently-driftable pool.
 *
 * `DoeAnalysis`/`DoeCandidate`/`DoeReviewAction` are deliberately NOT
 * extracted. `DoeAnalysis`/`DoeCandidate` are computed statistical outputs
 * and desirability-ranked predictions, not raw persisted measurement
 * evidence — the DOE analog of `StabilityTrend`'s exclusion in FVL-05.006,
 * and directly named by the governing prompt: "`DoeAnalysis`/candidate
 * predictions/desirability are not automatically part of 'observations'."
 * `DoeReviewAction` is a separate append-only human-sign-off log (who
 * validated/confirmed/approved what), administrative record-keeping
 * outside this task's own "studies/runs/observations" title scope — the
 * DOE analog of `StabilityFailure`'s exclusion in FVL-05.006.
 *
 * HIERARCHY PRESERVATION: a study groups its designs
 * (`design.studyId === study.id`, cross-checked against
 * `design.studyRevision === study.revision` — a genuine redundant-field
 * contradiction check, since each study REVISION is its own distinct
 * top-level `DoeStudy` record with its own stable `id`, never mutated
 * after creation, per `engine/doeDesign.ts`'s `reviseDoeStudy`, which
 * always mints a brand-new `id` rather than incrementing `revision` on the
 * existing record); a design groups its runs
 * (`run.designId === design.id`, cross-checked against
 * `run.studyId === design.studyId` and `run.studyRevision ===
 * design.studyRevision`); a run groups its observations
 * (`observation.runId === run.id`, cross-checked against
 * `observation.studyId === run.studyId` and `observation.studyRevision ===
 * run.studyRevision`) — the same "resolve both sides of a denormalized
 * relationship and fail closed on contradiction" discipline FVL-05.004
 * established for `trial_formula_link_conflict` and FVL-05.006 established
 * for `stability_result_sample_conflict`.
 *
 * MULTIPLE STUDY REVISIONS PER BASELINE VERSION (proven from source, not
 * assumed): `reviseDoeStudy` copies `baselineFormulaVersionId` forward
 * unchanged unless the caller explicitly overrides it, and `DoePanel.tsx`'s
 * own revise button (`onRevise`) calls it with an EMPTY changes object —
 * so a revised study legitimately keeps the same baseline version as its
 * predecessor. This extractor therefore links EVERY `DoeStudy` (any
 * revision) whose `baselineFormulaVersionId` exactly matches the requested
 * version's id, exactly like FVL-05.006 already had to handle "multiple
 * studies for one version."
 *
 * `DoeStudy.supersedesStudyId` / `DoeDesign.supersedesDesignId`
 * REFERENTIAL INTEGRITY: both fields exist specifically to model "this
 * record replaces an older one of the same kind" (a study revision; a
 * regenerated design for the same study+revision — `DoePanel.tsx`'s own
 * `studyDesign` selector proves more than one `DoeDesign` can legitimately
 * exist for the same `(studyId, studyRevision)`, picking the most recent
 * by `generatedAt` for DISPLAY purposes only). This extractor does NOT
 * silently pick a single "latest" design/study and drop the others — every
 * design linked to a returned study is embedded, each with its own exact
 * runs (an older, superseded design's runs are still real, physically
 * executed experimental data, not fabricated or excluded) — but it DOES
 * fail closed on a dangling, self, or cyclical `supersedesStudyId`/
 * `supersedesDesignId` reference (pool-wide, same two-function
 * self-check-first / cycle-walk pattern FVL-05.005/.006 established for
 * `revisesResultId`), since an inconsistent supersession chain would make
 * the row's own revision lineage untrustworthy.
 *
 * FROZEN FACTOR/RESPONSE SNAPSHOT AS THE INTERPRETIVE SOURCE: a run's
 * `factorSettings[].factorCode` and an observation's `responseId` are
 * resolved for MEANING against the run's OWN design's frozen
 * `factorSnapshot`/`responseSnapshot` (never a live catalog) — concretely,
 * `observation.responseId` must exactly match the `id` of one entry in the
 * owning run's design's `responseSnapshot`, or the extraction fails closed
 * (`doe_observation_response_not_found`); this is the "resolve the
 * observation -> response reference" rule the governing prompt requires,
 * satisfied via the already-embedded frozen snapshot rather than a second
 * live `doe_responses` pool. `factorSettings` themselves are never
 * recomputed from any live/frozen factor definition — `DoeRun` is embedded
 * 100% verbatim, so a run's actually-persisted `codedValue`/`actualValue`
 * pair for each factor survives completely untouched.
 *
 * `DoeRun.linkedTrialId` and `DoeObservation.sourceTrialId`/
 * `.sourceTestResultId` are cross-references to `LaboratoryTrial`/
 * `TestResult` — entities entirely outside this task's own "studies/runs/
 * observations" title scope, the exact same category as
 * `StabilityStudy.laboratoryTrialId` in FVL-05.006 ("plays no role in
 * study-to-version linkage... not resolved/embedded here, matching this
 * task's own title scope"). A repo-wide search for the one documented
 * automatic-import concept, `importDoeObservationsFromResults`
 * (`doeResponseSchema`'s own header comment), found it named in exactly two
 * places — that comment and `docs/DOE_RESPONSES.md` — and implemented
 * NOWHERE: the ONE real `DoeObservation` writer
 * (`DoePanel.tsx`'s `recordObservation`) never sets `sourceTrialId` or
 * `sourceTestResultId` on any record it creates. Per the governing prompt's
 * own rule ("do not enforce a cross-reference unless current writer/domain
 * source proves it is required"), this extractor does NOT require a
 * `LaboratoryTrial[]`/`TestResult[]` resolution pool and does NOT validate
 * these two optional fields referentially — `DoeObservation` is embedded
 * 100% verbatim (`doeObservationSchema`, unmodified), so whatever value
 * either field carries (including absent) survives exactly, honestly
 * unresolved. `DoeRun.linkedFormulaVersionId` is treated differently: the
 * ONE real writer (`DoePanel.tsx`'s `generateTrialForRun`) sets it in the
 * SAME statement as `linkedTrialId`, always to the study's own baseline
 * `FormulationVersion.id` — and this extractor already requires a
 * `formulationVersions` pool for its own top-level version resolution, so
 * validating `linkedFormulaVersionId` against that SAME already-required
 * pool costs nothing extra and catches a genuinely corrupt/dangling link
 * (`doe_run_linked_formula_version_not_found`) — unlike `linkedTrialId`,
 * this does not require inventing a brand-new resolution pool this task's
 * title does not call for.
 *
 * DETERMINISTIC ORDERING: studies by `createdAt` then `id` (matching every
 * prior FVL-05 top-level grouping entity); designs within a study by
 * `generatedAt` then `id`; runs within a design by `standardOrder` (an
 * integer domain field — `generateDoeDesign` always sets
 * `standardOrder = runNumber = standardIndex + 1`, the design algorithm's
 * own systematic sequence, independent of the separately-randomized
 * `randomizedOrder` a lab actually executes in) then `id`; observations
 * within a run by `recordedAt` (always present, unlike optional
 * `measuredAt`) then `id`. Every timestamp used as a sort key
 * (`study.createdAt`, `design.generatedAt`, `observation.recordedAt`) is
 * validated as canonical `toISOString()` format before use, failing closed
 * on a non-conforming value, matching FVL-05.004/.005/.006. Opaque-id
 * tie-breakers use locale-independent ordinal comparison, never
 * `localeCompare`.
 *
 * One row per `FormulationVersion`, same convention as FVL-05.003-.006:
 * `studies` is empty when no `DoeStudy` is linked to the version.
 */
export const doeRunObservationsSchema = z.object({
  run: doeRunSchema,
  observations: z.array(doeObservationSchema),
});
export type DoeRunObservations = z.infer<typeof doeRunObservationsSchema>;

export const doeDesignRunsSchema = z.object({
  design: doeDesignSchema,
  runs: z.array(doeRunObservationsSchema),
});
export type DoeDesignRuns = z.infer<typeof doeDesignRunsSchema>;

export const doeStudyRunsSchema = z.object({
  studyId: nonBlankString("studyId"),
  studyCode: nonBlankString("studyCode"),
  studyRevision: z.number().int().positive(),
  supersedesStudyId: z.string().optional(),
  designs: z.array(doeDesignRunsSchema),
});
export type DoeStudyRuns = z.infer<typeof doeStudyRunsSchema>;

export const formulaVersionDoeRowSchema = datasetRowBaseSchema.extend({
  formulaId: nonBlankString("formulaId"),
  formulaCode: nonBlankString("formulaCode"),
  formulaVersionId: nonBlankString("formulaVersionId"),
  formulaVersionNumber: z.number().int().positive(),
  studies: z.array(doeStudyRunsSchema),
});
export type FormulaVersionDoeRow = z.infer<typeof formulaVersionDoeRowSchema>;

/**
 * FVL-05.008 — corrective actions (when relevant) + cost snapshots +
 * packaging/context payload.
 *
 * SOURCE-RECOVERY CONCLUSIONS (recovered directly from repository source,
 * not inferred from the tracker's title — see the FVL-05.008 tracker row
 * and `project-control/claude/logs/FormuLab-FVL05-Dataset-Schema-Versioning-Log.md`'s
 * own cycle section for the full evidence trail):
 *
 * 1. CORRECTIVE ACTIONS: `CorrectiveAction` (`schemas/correctiveActions.ts`)
 *    is a real, top-level, MUTABLE masterdata collection (`corrective_actions`,
 *    `append_only: false` in `masterdata.rs`) — a genuinely GLOBAL identity,
 *    never `parentRecordId`-scoped. It links to a specific `LaboratoryTrial`
 *    or `StabilityStudy` via `sourceRecordId` — its own schema comment states
 *    plainly "the trial or stability study id this action belongs to,"
 *    unconditional on `sourceType`. The two real production writers
 *    (`TrialsPanel.tsx`'s `createCorrectiveActionForDeviation`,
 *    `StabilityPanel.tsx`'s `createFailureCorrectiveAction`) confirm exactly
 *    this: `sourceType: "trial_deviation"` pairs with
 *    `sourceRecordId: selectedTrial.id`; `sourceType: "stability_failure"`
 *    pairs with `sourceRecordId: selectedStudy.id`; both also set
 *    `projectId: formulation.id` — the SAME owning-formulation identifier
 *    every other FVL-05 extractor already uses (`LaboratoryTrial.projectId`/
 *    `StabilityStudy.projectId` are documented as `Formulation.id`, not a
 *    separate "project" concept). `sourceType: "trial_failure"` and
 *    `"manual"` are real enum values with NO current writer evidence at
 *    all — a repo-wide grep found zero call sites — so this extractor does
 *    NOT invent a different resolution rule for them; per the schema's own
 *    unconditional comment, EVERY `CorrectiveAction.sourceRecordId` is
 *    resolved against the union of the supplied `laboratoryTrials`/
 *    `stabilityStudies` pools regardless of its `sourceType` label, failing
 *    closed (pool-wide) when it resolves to neither
 *    (`corrective_action_source_record_not_found`). A `CorrectiveAction`
 *    whose resolved trial/study IS linked (via the SAME `sourceType ===
 *    "saved_version"` + exact `sourceFormulaVersionId` rule FVL-05.004-.006
 *    established) to the REQUESTED formula version is included in that
 *    version's row; a `CorrectiveAction` whose resolved trial/study exists
 *    in the pool but belongs to a DIFFERENT version is legitimately
 *    irrelevant and simply excluded (never an error) — the same convention
 *    every prior FVL-05 extractor uses. When an action IS attributed to a
 *    row, its own denormalized `projectId` and the resolved trial's/study's
 *    `projectId` must BOTH agree with the row's owning `Formulation.id`, or
 *    the extraction fails closed (`corrective_action_formula_link_conflict`)
 *    — the same "resolve both sides of a redundant field and fail closed on
 *    contradiction" discipline `trial_formula_link_conflict`/
 *    `stability_result_sample_conflict` established. `CorrectiveAction` is
 *    embedded 100% VERBATIM (`correctiveActionSchema`, unmodified) — the
 *    whole record IS the historical evidence (problem statement, owner,
 *    resolution, effectiveness check, full audit history), not
 *    administrative metadata to trim. `CorrectiveAction.deviationOrFailureId`
 *    is preserved verbatim but NOT referentially validated: `TrialDeviation`/
 *    `StabilityFailure` are entities this whole FVL-05 family has
 *    consistently kept out of scope (`schemas/stability.ts`'s own header
 *    comment: `StabilityFailure` is "the stability analog of
 *    `TrialDeviation`, which FVL-05.004 also did not extract") — pooling
 *    either merely to validate one optional field would be scope creep
 *    beyond this task's own "corrective actions" title, the same
 *    preserve-but-do-not-enforce precedent FVL-05.007 established for
 *    `DoeObservation.sourceTrialId`/`.sourceTestResultId`.
 *    `LaboratoryTrial`/`StabilityStudy` themselves are supplied ONLY as
 *    resolution pools (never embedded in the row — out of this task's own
 *    title scope), but a trial/study that legitimately resolves an
 *    included action still contributes an exact lineage citation
 *    (`laboratoryTrial`/`stabilityStudy`), the same convention
 *    FVL-05.005's `trialTestResultsSchema` established for a trial that
 *    contributes context without being embedded whole.
 *
 * 2. COST SNAPSHOTS: `CostSnapshot` (`schemas/costing.ts`) is a real,
 *    top-level, APPEND-ONLY masterdata collection (`cost_snapshots`,
 *    `append_only: true`) — its own header comment states it is
 *    "immutable," recording every input (price/exchange-rate/packaging
 *    codes, factory profile) it used so "the number can be explained and
 *    reproduced later, even after all of those have moved on." Unlike
 *    every other entity this file embeds, `CostSnapshot` has NO separate
 *    `id` field — `code` IS its exact persisted identity — so lineage
 *    citations and duplicate-identity checks use `code`, still a
 *    GENUINELY GLOBAL identity (its own flat top-level collection, no
 *    parent scoping), never `parentRecordId`. It links to a formula
 *    version DIRECTLY, via its own `formulationId`/`versionId` fields —
 *    no multi-hop resolution needed, unlike corrective actions. A snapshot
 *    whose `versionId` matches the requested version's id but whose
 *    `formulationId` does not resolve to that version's owning formulation
 *    is a genuine denormalized-field contradiction and fails closed
 *    (`cost_snapshot_formula_link_conflict`). `CostSnapshot` is embedded
 *    100% VERBATIM (`costSnapshotSchema`, unmodified) — a historical
 *    costing IS the evidence, not a value to re-derive.
 *    `PackagingComponent`/`PackagingBom`/`FactoryCostProfile`/
 *    `ExchangeRate` (the CURRENT, MUTABLE catalog/reference data a
 *    snapshot's `priceRecordCodes`/`exchangeRateCodes`/
 *    `packagingComponentCodes`/`factoryProfileCode` merely CITE by code)
 *    are deliberately NOT resolved or embedded — presenting today's live
 *    catalog alongside a frozen historical snapshot would be exactly the
 *    planned/current-vs-actual/historical conflation this whole FVL-05
 *    family has consistently refused (the same reasoning FVL-05.005 kept
 *    `TestDefinition` out of its own row); the snapshot's own embedded
 *    `costLineSchema` rows already carry every cost figure the
 *    calculation actually produced.
 *
 * 3. PACKAGING/CONTEXT: a repo-wide search for a packaging record that is
 *    genuinely HISTORICAL experiment context (frozen, capture-once) rather
 *    than current mutable catalog metadata found exactly ONE:
 *    `StabilityStudy.packagingSnapshot` (`packagingSystemSnapshotSchema`,
 *    `schemas/stability.ts`) — its own header comment states it is
 *    "captured once, at study creation, so a later packaging-component
 *    price or BOM edit cannot silently change what an in-progress study is
 *    protocol-bound to," mirroring `TrialFormulaSnapshot`'s "capture once,
 *    never re-read live" principle. `LaboratoryTrial` carries only
 *    `targetPackagingSkuIds` (mutable id references, no frozen snapshot);
 *    `DoeStudy` carries no packaging field at all; `PackagingComponent`/
 *    `PackagingBom` (`schemas/costing.ts`) are confirmed CURRENT, MUTABLE
 *    catalog collections (`packaging_components`/`packaging_boms`,
 *    `append_only: false`), never historical snapshots. FVL-05.006
 *    deliberately did NOT embed `StabilityStudy.packagingSnapshot` (its own
 *    "administrative-metadata-only" treatment of `StabilityStudy` embedded
 *    only `studyId`/`studyCode`) — so this genuinely missing historical
 *    context, for every `StabilityStudy` already resolved as linked to the
 *    requested version (the SAME resolution this extractor performs for
 *    corrective-action linkage), is extracted here as
 *    `stabilityStudyPackagingContextSchema`
 *    (`{ studyId, studyCode, packagingSkuCode, packagingSnapshot }`,
 *    `packagingSystemSnapshotSchema` reused 100% verbatim) — never a
 *    second copy of FVL-05.006's own sample/result/condition/time-point
 *    evidence, which stays exclusively that task's own row.
 *
 * 4. ENVIRONMENTAL/TEST CONDITIONS: independently audited and found ALREADY
 *    FULLY REPRESENTED by prior FVL-05 rows, with no genuinely missing
 *    context to add — `TestResult.storageCondition`/`.timePoint`
 *    (`schemas/testDefinitions.ts`) are embedded verbatim by FVL-05.005's
 *    `trialTestResultsSchema`; `StabilityCondition`/`StabilityTimePoint`
 *    are embedded verbatim by FVL-05.006's `stabilityStudySamplesSchema`
 *    (corrective cycle); `DoeDesign.factorSnapshot`/`.responseSnapshot`
 *    (the DOE analog of environmental/method conditions — temperature,
 *    humidity, and similar process factors) are embedded verbatim by
 *    FVL-05.007's `doeDesignRunsSchema`. Inventing a second, parallel
 *    environmental-condition model here would duplicate already-extracted
 *    measured evidence, which the governing prompt explicitly forbids —
 *    so this row contributes NOTHING new under this heading, by design,
 *    not by omission.
 *
 * One row per `FormulationVersion`, same convention as FVL-05.003-.007:
 * `correctiveActions`/`costSnapshots`/`packagingContext` are each
 * independently empty when nothing of that kind is linked to the version
 * — a row with all three empty is legitimate (the tracker's own "when
 * relevant" qualifier for corrective actions), never fabricated.
 */
export const stabilityStudyPackagingContextSchema = z.object({
  studyId: nonBlankString("studyId"),
  studyCode: nonBlankString("studyCode"),
  packagingSkuCode: nonBlankString("packagingSkuCode"),
  packagingSnapshot: packagingSystemSnapshotSchema,
});
export type StabilityStudyPackagingContext = z.infer<typeof stabilityStudyPackagingContextSchema>;

export const formulaVersionCorrectiveCostContextRowSchema = datasetRowBaseSchema.extend({
  formulaId: nonBlankString("formulaId"),
  formulaCode: nonBlankString("formulaCode"),
  formulaVersionId: nonBlankString("formulaVersionId"),
  formulaVersionNumber: z.number().int().positive(),
  correctiveActions: z.array(correctiveActionSchema),
  costSnapshots: z.array(costSnapshotSchema),
  packagingContext: z.array(stabilityStudyPackagingContextSchema),
});
export type FormulaVersionCorrectiveCostContextRow = z.infer<typeof formulaVersionCorrectiveCostContextRowSchema>;

/**
 * FVL-05.009 — normalization: units, categorical, numeric.
 *
 * SOURCE RECOVERY (not inferred from the tracker's short title — the
 * tracker's own `Depends on` column names ALL SIX prior extractors,
 * FVL-05.003-.008, so this task normalizes across the full existing
 * dataset-row surface, not one hand-picked family). This is a NORMALIZATION
 * LAYER over the six already-extracted, already-versioned `FormulaVersion*
 * Row` families — it never re-derives anything from raw masterdata pools,
 * never re-embeds a dataset row's own fields (that would violate the
 * standing "reuse canonical schemas, do not copy a field list into a
 * parallel schema" rule six times over), and never designates any field as
 * a training TARGET (that is FVL-05.010's own explicit job — see its own
 * tracker row, "Depends on: FVL-05.009").
 *
 * WHAT "NORMALIZATION" MEANS HERE (the one genuinely new thing this task
 * adds — everything else already exists verbatim in the six input rows):
 * a repository-wide field-by-field audit of every FVL-05.003-.008 row
 * family found exactly ONE recurring, well-defined ambiguity a downstream
 * numeric consumer cannot resolve on its own — a decimal VALUE paired with
 * a free-text UNIT string that may or may not be a physical unit this
 * codebase already knows how to convert. `normalizedQuantitySchema` below
 * is that one concept, applied uniformly via `normalizeQuantity()`
 * (`engine/formulaVersionFeatureExtractor.ts`) to every such pair found:
 *
 * | path                                | source field (value + unit)                                                    | family      |
 * |--------------------------------------|---------------------------------------------------------------------------------|-------------|
 * | `composition.line.quantity`           | `FormulationLine.quantity` + `.quantityUnit`                                    | FVL-05.003  |
 * | `process.actualStep.viscosity`        | `TrialProcessStep.actualViscosity` + `.viscosityUnit`                           | FVL-05.004  |
 * | `testResult.replicate.numericValue`   | `TestReplicate.numericValue` + owning `TestResult.unit`                         | FVL-05.005  |
 * | `testResult.stats.mean`/`.minimum`/`.maximum`/`.standardDeviation` | `ReplicateStats.*` + owning `TestResult.unit`             | FVL-05.005  |
 * | `stabilityResult.replicate.numericValue` | `TestReplicate.numericValue` + owning `StabilityResult.unit`                 | FVL-05.006  |
 * | `stabilityResult.stats.mean`/`.minimum`/`.maximum`/`.standardDeviation` | `ReplicateStats.*` + owning `StabilityResult.unit`     | FVL-05.006  |
 * | `doe.factorSetting.actualValue`       | `DoeFactorSetting.actualValue` + the owning design's `DoeFactor.unit` (resolved by `factorCode` against the run's own design's frozen `factorSnapshot`, the exact index FVL-05.007's own `buildDesignSnapshotIndex` already proves unambiguous — re-checked defensively here since a caller need not have gone through that extractor) | FVL-05.007  |
 * | `doe.observation.value`               | `DoeObservation.value` + the owning design's `DoeResponse.unit` (resolved by `responseId` against the same frozen `responseSnapshot`) | FVL-05.007  |
 * | `costSnapshot.costLine.quantityKg`    | `CostLine.quantityKg` (unit is fixed "kg" by the field's own name — no companion field exists, still run through the same function for one uniform code path) | FVL-05.008  |
 * | `costSnapshot.skuCost.fillQuantity`   | `SkuCost.fillQuantity` + `.fillUnit`                                             | FVL-05.008  |
 * | `packagingContext.fillQuantity`       | `PackagingSystemSnapshot.fillQuantity` + `.fillUnit`                            | FVL-05.008  |
 *
 * DELIBERATELY EXCLUDED value+unit-shaped fields, each for a concrete,
 * disqualifying reason found in source — never merely overlooked:
 *
 * - `FormulationLine.unitPrice`/`.priceUnit` (and every other `*PerUnit`/
 *   `*Cost` + unit-ish field across `costing.ts`): a PRICE PER UNIT is a
 *   RATE, not a simple quantity — canonicalizing a rate requires DIVIDING
 *   by the same factor a plain quantity conversion MULTIPLIES by (kes/L ->
 *   kes/mL is ÷1000, while L -> mL is ×1000). `engine/unitConversion.ts`'s
 *   `convertUnit` is documented as "generic, density-free DIMENSIONAL
 *   conversion" — it has no rate-safe inverse mode, and inventing one here
 *   (a brand-new arithmetic direction with no existing authority or test
 *   coverage) is exactly the kind of unproven, non-source-supported
 *   normalization the governing rule forbids. Left raw and unconverted,
 *   not fabricated.
 * - `DoeFactor.lowValue`/`.centerValue`/`.highValue`, `DoeResponse.
 *   targetValue`/`.lowerLimit`/`.upperLimit`, `TestDefinition.targetValue`/
 *   `.minimum`/`.maximum`: PLANNED/SPEC/OBJECTIVE values, not measured
 *   actuals — including them here would be exactly the "DOE objectives...
 *   into measured actual features" leak this task's own governing
 *   invariants forbid. `DoeFactorSetting.actualValue` and `DoeObservation.
 *   value` (the realized run/response values) are the only DOE-family
 *   fields normalized, precisely because they alone are actuals.
 *   `TestDefinition` was already out of FVL-05.005's own row entirely, so
 *   there is nothing of its to exclude here beyond restating why.
 * - `DataExchange.processParameterSchema` (the `plannedProcedure` embedded
 *   in every FVL-05.004 row): audited field-by-field — `temperatureMin/
 *   Target/Max`, `mixingSpeedMin/Target/Max`, `mixingTimeMinutes`,
 *   `holdTimeMinutes` are ALL fixed-unit-by-name (°C/rpm/minutes) with NO
 *   companion unit field anywhere on the schema — there is no unit
 *   ambiguity to resolve, so nothing here needs `normalizeQuantity()`.
 * - `RawMaterial.viscosityMin`/`.viscosityMax`/`.phMin`/`.phMax`/`.hlb`,
 *   `TrialProcessStep.actualPh`, every `*Percent` field across all six
 *   families (`percent`, `activeMatterPercent`, `humidityPercent`, ...):
 *   each is fixed-unit-by-domain-convention (unitless pH/HLB, or already a
 *   percentage of a stated total) with no companion unit field — nothing to
 *   resolve, left as plain numeric passthrough by every row that already
 *   embeds them verbatim.
 * - `StabilitySample.fillQuantity`: genuinely has NO companion unit
 *   anywhere in its own row family (`stabilitySampleSchema` has no
 *   `fillUnit` field, and FVL-05.006 never pools the packaging catalog that
 *   would supply one) — resolving it would require inventing a brand-new
 *   resolution pool this task's own "normalize what FVL-05.003-.008 already
 *   extracted" scope does not call for. Left exactly as its own row already
 *   carries it, honestly un-normalizable rather than guessed.
 * - `TrialMaterialUsage.actualWeight`/`.weightUnit`: `TrialMaterialUsage`
 *   (the trial's weighing log) is not embedded by ANY existing FVL-05.003-
 *   .008 row (`schemas/dataset.ts`'s own FVL-05.004 header comment: "The
 *   only OTHER structured, shared-package-visible process data is
 *   `LaboratoryTrial`'s own embedded `processSteps`/`observations`" —
 *   material usage was never in scope). A field this task's own inputs
 *   never contain cannot be normalized by it.
 *
 * `normalized: false` (raw value preserved, `canonicalUnit`/`canonicalValue`
 * both absent) covers BOTH "no unit was ever recorded" and "the recorded
 * unit is not one `engine/unitConversion.ts` knows how to convert" — the
 * governing rule's own "remain raw exactly as contract requires, never
 * guessed" language makes no distinction between the two, so neither does
 * this schema. A `path` never appears for a source field that is itself
 * absent — missing stays missing, never coerced into a zero-valued entry.
 *
 * `detail` disambiguates the rare case where more than one entry can cite
 * the exact same source record (a `TestResult`'s several replicates all
 * share one `TestResult.id`; a `DoeRun`'s several `factorSettings` all
 * share one `DoeRun.id`) — the replicate's own `replicateNumber` or the
 * setting's own `factorCode`, respectively. Every other `path` already
 * cites a source record with its own unique, unshared identity (a
 * `DoeObservation.id`, a `TestResult.id` for its OWN stats fields, a
 * `CostSnapshot.code`, a `StabilityStudy.id`) and leaves `detail` absent.
 *
 * NOT PART OF THIS TASK'S CONTRACT (Q7, answered from source, not assumed):
 * no schema anywhere in this package models a persisted, fitted scaling
 * statistic (a stored min/max or mean/stddev meant to be REPLAYED against
 * future data) — `dataset.ts`/`costing.ts`/`doe.ts` were all re-checked for
 * exactly this shape and found none. Min-max/z-score scaling is therefore
 * NOT implemented here: inventing a fitted-statistic contract with no
 * source authority, no persistence model, and no leakage/reproducibility
 * design proven anywhere would be exactly the unproven normalization rule
 * this task's own governing invariants forbid. A future task that adds a
 * real, persisted, fitted-statistic contract can layer scaling on top of
 * `canonicalValue` without revisiting this decision.
 *
 * FEATURE_SCHEMA_VERSION stays `"1.0"` (NOT bumped by this task): this is
 * the FIRST feature-vector shape ever defined — `FEATURE_SCHEMA_VERSION`'s
 * own header comment already said "FVL-05.009-.010 are the tasks that
 * would bump it" only once an EXISTING feature-vector shape later changes.
 * The direct, already-established precedent is `DATASET_SCHEMA_VERSION`
 * itself: FVL-05.001 defined it at `"1.0"` with no row shape yet, and
 * FVL-05.002's `sourceRecordReferenceSchema`/`datasetRowBaseSchema` — the
 * FIRST dataset row shape — did NOT bump it; only a LATER change to an
 * ALREADY-SHIPPED shape ever bumps a schema-version literal in this file.
 * Defining the first feature-vector shape is that same "nothing existed
 * before, nothing changed" case, not a shape change to bump against.
 *
 * `DATASET_SCHEMA_VERSION` is untouched (stays `"1.6"`) — this task adds no
 * field to, and removes no field from, any FVL-05.003-.008 row shape; it
 * only reads them.
 *
 * ANTI-LEAKAGE (Q10): every `path` above resolves to a genuinely REALIZED/
 * MEASURED value (`FormulationLine.quantity` — the source's own recorded
 * absolute weight, not a target; `TrialProcessStep.actual*` — recorded
 * execution evidence; `TestResult`/`StabilityResult` replicate & stats
 * values — recorded measurements; `DoeFactorSetting.actualValue`/
 * `DoeObservation.value` — the run's actually-used setting and its
 * actually-recorded response; `CostSnapshot`/packaging context — historical
 * recorded evidence). No `path` here ever resolves to a spec, a target, a
 * DOE objective, a candidate prediction, or a desirability score — see the
 * "DELIBERATELY EXCLUDED" list above for the specific fields that WOULD
 * have been exactly that, and why each is excluded. This task also does
 * NOT designate any of these normalized values as "the" target variable
 * for anything — that designation is FVL-05.010's own explicit job.
 */
export const NORMALIZED_QUANTITY_SOURCE_PATHS = [
  "composition.line.quantity",
  "process.actualStep.viscosity",
  "testResult.replicate.numericValue",
  "testResult.stats.mean",
  "testResult.stats.minimum",
  "testResult.stats.maximum",
  "testResult.stats.standardDeviation",
  "stabilityResult.replicate.numericValue",
  "stabilityResult.stats.mean",
  "stabilityResult.stats.minimum",
  "stabilityResult.stats.maximum",
  "stabilityResult.stats.standardDeviation",
  "doe.factorSetting.actualValue",
  "doe.observation.value",
  "costSnapshot.costLine.quantityKg",
  "costSnapshot.skuCost.fillQuantity",
  "packagingContext.fillQuantity",
] as const;
export type NormalizedQuantitySourcePath = (typeof NORMALIZED_QUANTITY_SOURCE_PATHS)[number];

/** The two canonical target units every normalized mass/volume quantity is
 *  expressed in — chosen once, fixed, never per-field: "g" for anything
 *  `engine/unitConversion.ts`'s `unitDimension()` resolves as "mass", "mL"
 *  for anything it resolves as "volume". A quantity whose unit is absent or
 *  unrecognized never gets either — `canonicalUnit`/`canonicalValue` are a
 *  matched pair, always both present or both absent. */
export const NORMALIZED_QUANTITY_CANONICAL_UNITS = ["g", "mL"] as const;
export type NormalizedQuantityCanonicalUnit = (typeof NORMALIZED_QUANTITY_CANONICAL_UNITS)[number];

/** The raw+canonical quantity fields alone, with no `path`/`detail`/
 *  `sourceRecords` — factored out so FVL-05.010's target numeric value
 *  (one quantity per observation, not an array of named paths) can reuse
 *  the exact same fields/validation via composition rather than copying
 *  the field list into a parallel shape. */
const normalizedQuantityValueSchema = z.object({
  /** The exact source value, unmodified — never re-rounded, never
   *  dropped even when `normalized` is false. */
  raw: decimalString,
  /** The exact source unit string, unmodified. Absent only when the
   *  source field itself carries no unit companion at all (as opposed to
   *  an unrecognized one, which IS present here, just unconverted). */
  rawUnit: z.string().optional(),
  canonicalUnit: z.enum(NORMALIZED_QUANTITY_CANONICAL_UNITS).optional(),
  /** Present if and only if `canonicalUnit` is present — a deterministic
   *  conversion via `engine/unitConversion.ts`'s `convertUnit`, formatted
   *  through `engine/decimal.ts`'s own `PRECISION.quantity` (4 dp),
   *  never a second, parallel rounding rule. */
  canonicalValue: decimalString.optional(),
  /** True iff `canonicalUnit`/`canonicalValue` are both present. Kept as
   *  its own explicit boolean (not merely inferred from presence) so a
   *  downstream consumer never has to reverse-engineer the pairing rule. */
  normalized: z.boolean(),
});

function requireNormalizedPairing<T extends { canonicalUnit?: string; canonicalValue?: string; normalized: boolean }>(
  entry: T,
  ctx: z.RefinementCtx,
  label: string,
): void {
  const hasCanonical = entry.canonicalUnit !== undefined && entry.canonicalValue !== undefined;
  if (entry.normalized !== hasCanonical) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `normalized must be true if and only if both canonicalUnit and canonicalValue are present (${label})`,
    });
  }
}

export const normalizedQuantitySchema = normalizedQuantityValueSchema
  .extend({
    path: z.enum(NORMALIZED_QUANTITY_SOURCE_PATHS),
    /** Disambiguates a `path` whose source record legitimately repeats
     *  (a replicate number, a DOE factor code) — see this section's own
     *  header comment. Absent whenever the citation below is already
     *  unique on its own. */
    detail: z.string().optional(),
    sourceRecords: sourceRecordLineageSchema,
  })
  .superRefine((entry, ctx) => requireNormalizedPairing(entry, ctx, `path="${entry.path}"`));
export type NormalizedQuantity = z.infer<typeof normalizedQuantitySchema>;

/** Composable envelope for the feature-vector family, mirroring
 *  `datasetRowBaseSchema` one level up: the existing feature schema version
 *  (never a second version literal) plus the same lineage contract every
 *  dataset row already uses — a feature row is exactly as source-traceable
 *  as the dataset rows it was normalized from. */
export const featureRowBaseSchema = featureSchemaVersionedSchema.extend({
  sourceRecords: sourceRecordLineageSchema,
});
export type FeatureRowBase = z.infer<typeof featureRowBaseSchema>;

/** One row per `FormulationVersion`, same convention as every FVL-05.003-
 *  .008 dataset row. `sourceRecords` here is the DEDUPLICATED UNION of
 *  every source-record citation contributed by whichever of the six input
 *  rows were supplied (row-level lineage, proving which underlying records
 *  this feature row as a whole was built from) — `normalizedQuantities[].
 *  sourceRecords` is the separate, finer-grained per-VALUE citation.
 *  `normalizedQuantities` is empty when none of the source rows contained
 *  any resolvable value+unit pair — legitimate (e.g. a version with
 *  composition but no quantity/unit ever entered on any line), never an
 *  error. */
export const formulaVersionFeatureRowSchema = featureRowBaseSchema.extend({
  formulaId: nonBlankString("formulaId"),
  formulaCode: nonBlankString("formulaCode"),
  formulaVersionId: nonBlankString("formulaVersionId"),
  formulaVersionNumber: z.number().int().positive(),
  normalizedQuantities: z.array(normalizedQuantitySchema),
});
export type FormulaVersionFeatureRow = z.infer<typeof formulaVersionFeatureRowSchema>;

/**
 * FVL-05.010 — exact target-variable definitions (per product family /
 * measured response).
 *
 * SOURCE RECOVERY (not inferred from the tracker's short title): a
 * SECOND, brand-new feature-family row, sibling to FVL-05.009's own
 * `formulaVersionFeatureRowSchema` — both share ONE `featureSchemaVersion`
 * literal (see `FEATURE_SCHEMA_VERSION`'s own header comment for the
 * FIRST BUMP this row family caused), neither embeds or duplicates the
 * other's fields. Where FVL-05.009 normalizes PREDICTOR evidence
 * (composition, process, cost/packaging — see its own row's excluded-
 * field list), this row extracts LABEL evidence: the measured response
 * values a future FVL-07 "Predictive Performance Engine (supervised ML)"
 * would train against. Neither task designates which normalized
 * predictor fields "are" inputs to a model or which target fields "are"
 * outputs — that remains FVL-05.011+/FVL-07's own job; this task only
 * makes target evidence extractable, exact, and traceable.
 *
 * WHICH SOURCE FAMILIES ARE MEASURED RESPONSES (Q3, answered from source):
 * exactly three, each already extracted verbatim by an existing FVL-05
 * extractor and reused here by row, never re-derived from raw pools:
 * `TestResult` (FVL-05.005), `StabilityResult` (FVL-05.006),
 * `DoeObservation` (FVL-05.007). `CorrectiveAction`/`CostSnapshot`
 * (FVL-05.008) were independently checked and found to carry no
 * measured-response-shaped field at all (a corrective action is a
 * problem/resolution narrative; a cost snapshot is a computed financial
 * figure, not a product-performance measurement) — genuinely nothing to
 * extract there, not merely unexamined.
 *
 * WHAT IS **NOT** A MEASURED RESPONSE, deliberately excluded (Q6, the
 * anti-leakage core of this task): `TestDefinition.targetValue`/
 * `.minimum`/`.maximum` (planned spec/reference, and `TestDefinition`
 * itself was never even pooled by FVL-05.005 — nothing to exclude twice
 * over); `DoeResponse.targetValue`/`.lowerLimit`/`.upperLimit`/
 * `.objective`/`.desirabilityShape` (planned DOE objective metadata, the
 * exact fields FVL-05.009's own header comment already excluded from
 * PREDICTOR normalization for the identical reason); `DoeAnalysis`/
 * `DoeCandidate` (computed predictions/desirability, never pooled by any
 * FVL-05 extractor); `TestResult.passFail === "not_evaluated"` (the
 * absence of a judgment, not a label — only `"pass"`/`"fail"` are real
 * evidence); a `DoeObservation` whose `status` is `"missing"`/
 * `"invalid"`/`"excluded"` (explicitly non-evidence by the domain's own
 * vocabulary — produces no target observation at all, the same
 * "excluded/invalid/pending never silently becomes a label" discipline
 * the governing prompt requires).
 *
 * PRODUCT-FAMILY IDENTITY (Q1/Q2): the one, already-authoritative source
 * is `Formulation.productFamilyCode` — FVL-05.003's own row already
 * established it as "always present on a Formulation" and copies it
 * verbatim into every `FormulaVersionCompositionRow`. A repository-wide
 * search for a productFamilyCode MUTATION path found exactly one writer,
 * `newFormulation()` (`apps/desktop/src/lib/formulations.ts`), which sets
 * it once at creation time; no edit/update call site was found anywhere
 * that changes an EXISTING formulation's `productFamilyCode`. No separate
 * historical/frozen snapshot of it exists on any other schema
 * (`LaboratoryTrial`/`StabilityStudy` carry a DIFFERENT field,
 * `productFamilyId`, not a copy of this one). This task therefore reuses
 * `compositionRow.productFamilyCode` directly — the SAME already-trusted
 * value FVL-05.009 already carries in via its own required
 * `compositionRows` input — rather than re-resolving `Formulation` a
 * second time.
 *
 * TARGET IDENTITY TUPLE (Q8, `targetDefinitionSchema` below, enforced by
 * its own `superRefine` rather than left to convention): `productFamilyCode`
 * + `sourceEntity` + EITHER `testDefinitionId` (testResult/stabilityResult)
 * OR `responseId` (doeObservation) + — for `stabilityResult` only —
 * `conditionId`/`timePointId`. Q5's own finding: a stability condition/
 * time-point pair is part of WHAT the target IS ("viscosity at 40°C /
 * 3 months" is a different target than "viscosity at 25°C / 1 month"),
 * never a predictor field this task could leak — `StabilityResult`
 * carries its own `conditionId`/`timePointId` directly (no join needed).
 * `unit` is deliberately NOT part of the identity tuple: the SAME
 * `testDefinitionId`/`responseId` is definitionally the same measured
 * concept regardless of which unit a given record happened to be entered
 * in — unit variation is a per-observation RECORDING fact (normalized
 * below, exactly like FVL-05.009 already does), not a different target.
 *
 * VALUE REPRESENTATION (Q9/Q10): `targetObservationValueSchema` is a
 * discriminated union over `kind` — `"numeric"` reuses
 * `normalizedQuantityValueSchema` (the FVL-05.009 quantity shape,
 * factored out for exactly this reuse) via `.merge()`, never a
 * re-modeled copy; `"text"`/`"categorical"`/`"boolean"`/`"passFail"`
 * carry their own single required value field. WHICH kind a `TestResult`/
 * `StabilityResult` contributes is read directly from that record's own
 * `resultType` — the field the domain itself uses to say which OTHER
 * field is authoritative — never guessed from which fields happen to be
 * populated: `"numeric"`/`"visual_rating"` -> `kind: "numeric"` (a
 * repository-wide check confirmed `"visual_rating"` has no dedicated
 * value field anywhere in this codebase — `replicates[].numericValue` is
 * structurally the only field capable of holding it, not an assumption
 * about its meaning); `"text"` -> `kind: "text"`; `"categorical"` ->
 * `kind: "categorical"`; `"boolean"` -> `kind: "boolean"`; `"pass_fail"`
 * -> `kind: "passFail"`, ONLY when the record's own `passFail` is
 * `"pass"` or `"fail"` (never `"not_evaluated"`). `DoeObservation` has no
 * `resultType` — its own `value`/`textValue` fields are read directly and
 * independently (both are independently optional on the source schema,
 * so both may legitimately be populated; neither is forced exclusive of
 * the other here). Explicit zero/false stay distinct from absence exactly
 * as `normalizedQuantityValueSchema` and `z.boolean()` already guarantee
 * (proven by dedicated tests) — never coerced, never silently imputed.
 *
 * MULTIPLICITY / NO SILENT AGGREGATION (Q7/Q11): every `TestResult`/
 * `StabilityResult` (including every entry in a `revisesResultId`
 * revision chain — FVL-05.005's own established "never collapse to
 * latest" precedent applies unchanged) and every `TestReplicate` produces
 * its OWN observation; `ReplicateStats` (`mean`/`minimum`/`maximum`/
 * `standardDeviation`) additionally produces its own observations,
 * `detail`-tagged `"stats.mean"` etc — the exact same already-persisted,
 * already-computed-by-the-source-system aggregate FVL-05.009's own
 * `testResult.stats.*`/`stabilityResult.stats.*` paths already treat as
 * real evidence, not a NEW aggregation this task invents. `isOutlier`
 * (from `TestReplicate.isOutlier`, or `true` for a `DoeObservation`
 * status of `"outlier_flagged"`/`"outlier_confirmed"`) is preserved as an
 * explicit flag, never silently dropped — "flagged, not deleted, the
 * caller's choice" is the same precedent `TestReplicate.isOutlier`'s own
 * schema comment already established; downstream partitioning/training
 * (FVL-05.012+) decides what to do with a flagged point, not this
 * extraction step.
 *
 * `detail` disambiguates a citation that legitimately repeats (a
 * replicate number; a `"stats.*"` field name) — the identical convention
 * `normalizedQuantitySchema` already established; every other case (one
 * `TestResult`'s own text/categorical/boolean/passFail value; one
 * `DoeObservation`) already has a unique source-record citation and
 * leaves `detail` absent.
 *
 * FEATURE_SCHEMA_VERSION bumps `"1.0"` -> `"1.1"` for this brand-new row
 * type (see the constant's own header comment for the full precedent
 * chain). `DATASET_SCHEMA_VERSION` is untouched (stays `"1.6"`) — this
 * task adds no field to, and removes no field from, any FVL-05.003-.008
 * row shape; it only reads them.
 */
export const TARGET_SOURCE_ENTITIES = ["testResult", "stabilityResult", "doeObservation"] as const;
export type TargetSourceEntity = (typeof TARGET_SOURCE_ENTITIES)[number];

export const targetDefinitionSchema = z
  .object({
    productFamilyCode: nonBlankString("productFamilyCode"),
    sourceEntity: z.enum(TARGET_SOURCE_ENTITIES),
    /** Required for `testResult`/`stabilityResult`; must be absent for `doeObservation`. */
    testDefinitionId: nonBlankString("testDefinitionId").optional(),
    /** Required for `doeObservation`; must be absent for `testResult`/`stabilityResult`. */
    responseId: nonBlankString("responseId").optional(),
    /** Required for `stabilityResult` only — part of target IDENTITY, not
     *  a predictor dimension (see this section's own header comment). */
    conditionId: nonBlankString("conditionId").optional(),
    /** Required for `stabilityResult` only. */
    timePointId: nonBlankString("timePointId").optional(),
    /** `testResult` ONLY (AUDIT_FVL05_GPT_000015 corrective finding B) —
     *  `TestResult.timePoint`/`.storageCondition` verbatim, present only
     *  when the source record actually carries them. Mirrors the exact
     *  optionality of `testResultSchema` itself (plain `z.string().optional()`,
     *  not `nonBlankString` — this task does not impose a stricter
     *  constraint than the source already has). Part of target IDENTITY,
     *  not mere observation context, for the same reason
     *  `stabilityResult`'s `conditionId`/`timePointId` already are: "pH at
     *  hour 0" and "pH at hour 24" recorded under the SAME
     *  `testDefinitionId` during one trial are conceptually different
     *  measured targets, not replicates of one target. Both absent (the
     *  overwhelming majority of current production data — see this
     *  section's own header comment for the writer evidence) is the
     *  ordinary case and collapses to the SAME definition, correctly. */
    timePoint: z.string().optional(),
    /** `testResult` ONLY — see `timePoint` immediately above; identical
     *  reasoning and identical current-writer-evidence disclosure. */
    storageCondition: z.string().optional(),
  })
  .superRefine((def, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (def.sourceEntity === "testResult") {
      if (def.testDefinitionId === undefined) fail("testResult target definitions require testDefinitionId");
      if (def.responseId !== undefined) fail("testResult target definitions must not carry responseId");
      if (def.conditionId !== undefined || def.timePointId !== undefined) {
        fail("testResult target definitions must not carry conditionId/timePointId");
      }
    } else if (def.sourceEntity === "stabilityResult") {
      if (def.testDefinitionId === undefined) fail("stabilityResult target definitions require testDefinitionId");
      if (def.conditionId === undefined) fail("stabilityResult target definitions require conditionId");
      if (def.timePointId === undefined) fail("stabilityResult target definitions require timePointId");
      if (def.responseId !== undefined) fail("stabilityResult target definitions must not carry responseId");
      if (def.timePoint !== undefined || def.storageCondition !== undefined) {
        fail("stabilityResult target definitions must not carry testResult-only timePoint/storageCondition");
      }
    } else {
      if (def.responseId === undefined) fail("doeObservation target definitions require responseId");
      if (
        def.testDefinitionId !== undefined ||
        def.conditionId !== undefined ||
        def.timePointId !== undefined ||
        def.timePoint !== undefined ||
        def.storageCondition !== undefined
      ) {
        fail("doeObservation target definitions must not carry testDefinitionId/conditionId/timePointId/timePoint/storageCondition");
      }
    }
  });
export type TargetDefinition = z.infer<typeof targetDefinitionSchema>;

export const targetObservationValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("numeric") }).merge(normalizedQuantityValueSchema).superRefine((entry, ctx) => requireNormalizedPairing(entry, ctx, "target numeric value")),
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("categorical"), categorical: z.string() }),
  z.object({ kind: z.literal("boolean"), boolean: z.boolean() }),
  z.object({ kind: z.literal("passFail"), passFail: z.enum(["pass", "fail"]) }),
]);
export type TargetObservationValue = z.infer<typeof targetObservationValueSchema>;

/** `testResult` ONLY (`AUDIT_FVL05_GPT_000015` corrective finding B) —
 *  `TestResult.sampleId`/`.instrument`/`.methodSnapshot` verbatim.
 *  Deliberately NOT part of target IDENTITY (unlike `timePoint`/
 *  `storageCondition` on `targetDefinitionSchema`): which physical
 *  specimen was tested or which device/method version measured it does
 *  not change WHAT is being predicted, only which measurement INSTANCE
 *  produced this exact value — the same "instance context, not identity"
 *  treatment `TestReplicate.replicateNumber` already gets. `methodSnapshot`
 *  has zero current production-writer evidence anywhere in this
 *  repository (`buildTestMethodSnapshot()`, `engine/laboratoryStandards.ts`,
 *  is defined but has no call site) — kept here only so a FUTURE writer
 *  that does populate it is preserved rather than silently dropped;
 *  absence today does not make it identity, since two records can never
 *  currently differ on it. Present only when at least one field is
 *  actually defined — `undefined` entirely for `stabilityResult`/
 *  `doeObservation` observations, and for the ordinary `testResult` case
 *  (the human-recorded `TrialsPanel.tsx` writer path) where none of these
 *  three fields are ever set. */
export const targetObservationContextSchema = z.object({
  sampleId: z.string().optional(),
  instrument: z.string().optional(),
  methodSnapshot: testMethodSnapshotSchema.optional(),
});
export type TargetObservationContext = z.infer<typeof targetObservationContextSchema>;

export const targetObservationSchema = z.object({
  targetDefinition: targetDefinitionSchema,
  value: targetObservationValueSchema,
  /** Disambiguates a source-record citation that legitimately repeats —
   *  see this section's own header comment. */
  detail: z.string().optional(),
  /** `TestReplicate.isOutlier`, or `true` for a `DoeObservation` status of
   *  `"outlier_flagged"`/`"outlier_confirmed"` — flagged, never dropped. */
  isOutlier: z.boolean().default(false),
  /** See `targetObservationContextSchema`'s own header comment. */
  context: targetObservationContextSchema.optional(),
  sourceRecords: sourceRecordLineageSchema,
});
export type TargetObservation = z.infer<typeof targetObservationSchema>;

/** One row per `FormulationVersion`, same convention as every FVL-05.003-
 *  .009 row. `productFamilyCode` is copied verbatim from the SAME
 *  `FormulaVersionCompositionRow` this extractor already requires (see
 *  this section's own header comment) — never re-resolved independently.
 *  `targetObservations` is empty when none of the three measured-response
 *  source families contributed any usable evidence for this version —
 *  legitimate, never an error. */
export const formulaVersionTargetRowSchema = featureRowBaseSchema.extend({
  formulaId: nonBlankString("formulaId"),
  formulaCode: nonBlankString("formulaCode"),
  formulaVersionId: nonBlankString("formulaVersionId"),
  formulaVersionNumber: z.number().int().positive(),
  productFamilyCode: nonBlankString("productFamilyCode"),
  targetObservations: z.array(targetObservationSchema),
});
export type FormulaVersionTargetRow = z.infer<typeof formulaVersionTargetRowSchema>;
