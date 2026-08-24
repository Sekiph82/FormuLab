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
import { processParameterSchema } from "./dataExchange";
import { doeDesignSchema, doeObservationSchema, doeRunSchema } from "./doe";
import { formulationLineSchema } from "./formulation";
import { trialObservationSchema, trialProcessStepSchema } from "./laboratory";
import { rawMaterialSchema } from "./materials";
import { productFamilySchema } from "./product";
import {
  stabilityConditionSchema,
  stabilityResultSchema,
  stabilitySampleSchema,
  stabilityTimePointSchema,
} from "./stability";
import { testResultSchema } from "./testDefinitions";

/** Current dataset (row/lineage) schema version. Bump when the shape of a
 *  dataset row changes (a field is added, removed, or renamed by one of
 *  the FVL-05.003-.008 extractors). */
export const DATASET_SCHEMA_VERSION = "1.5" as const;

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
