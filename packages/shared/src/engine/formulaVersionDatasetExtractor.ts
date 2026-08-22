/**
 * FVL-05.003 — the extractor: turns persisted `Formulation`/`FormulationVersion`
 * records (plus the `RawMaterial`/`ProductFamily` records they reference) into
 * versioned `FormulaVersionCompositionRow` dataset rows for the future
 * Historical Experiment Dataset Builder.
 *
 * Pure and deterministic: no persistence, no mutation of its inputs, no
 * generated ids/timestamps. Every value on a row is either copied byte-for-byte
 * from a source record or is a citation of one (`sourceRecords`, from
 * `schemas/dataset.ts`). Ambiguous or missing exact source relationships throw
 * a `FormulaVersionDatasetExtractionError` rather than silently omitting or
 * repairing data — a caller decides what to do with a batch that contains a
 * bad relationship, this module never decides for them by dropping a row.
 *
 * Every constructed row is validated against `formulaVersionCompositionRowSchema`
 * before it is returned. That single `safeParse` call does two jobs at once:
 * it fails closed on a malformed row instead of letting one leak out, and —
 * because zod's object/array parsing always rebuilds nested structures rather
 * than reusing the input references — it also guarantees the returned row
 * shares no mutable array/object with the source records it was built from.
 */
import type { Formulation, FormulationLine, FormulationVersion } from "../schemas/formulation";
import type { RawMaterial } from "../schemas/materials";
import type { ProductFamily } from "../schemas/product";
import {
  DATASET_SCHEMA_VERSION,
  formulaVersionCompositionRowSchema,
  type FormulaVersionCompositionRow,
  type SourceRecordReference,
} from "../schemas/dataset";

export interface FormulaVersionDatasetExtractionInput {
  /** The exact formula version ids requested for extraction, in the order
   *  rows should be produced. Each is resolved against `formulationVersions`
   *  — a requested id absent from that pool fails closed rather than being
   *  silently skipped. */
  formulationVersionIds: string[];
  /** The pool of formula versions available to resolve `formulationVersionIds`
   *  against. Not all pool entries need be requested. */
  formulationVersions: FormulationVersion[];
  formulations: Formulation[];
  materials: RawMaterial[];
  /** Optional: a `ProductFamily` record only ends up on a row when this
   *  collection was supplied AND contains an exact match for the
   *  formulation's `productFamilyCode`. Omitting the collection entirely is
   *  legitimate — `productFamilyCode` itself is still always extracted. But
   *  supplying the collection is an explicit request to resolve the family,
   *  so a supplied collection with no matching code fails closed instead of
   *  silently leaving the row without a `productFamily`. */
  productFamilies?: ProductFamily[];
}

export type FormulaVersionDatasetExtractionErrorCode =
  | "formula_version_not_found"
  | "duplicate_formula_version_id"
  | "formulation_not_found"
  | "material_not_found"
  | "duplicate_material_code"
  | "product_family_not_found"
  | "duplicate_product_family_code"
  | "row_schema_validation_failed";

export class FormulaVersionDatasetExtractionError extends Error {
  readonly code: FormulaVersionDatasetExtractionErrorCode;
  readonly formulationVersionId: string;
  readonly materialCode?: string;

  constructor(
    code: FormulaVersionDatasetExtractionErrorCode,
    formulationVersionId: string,
    message: string,
    materialCode?: string,
  ) {
    super(message);
    this.name = "FormulaVersionDatasetExtractionError";
    this.code = code;
    this.formulationVersionId = formulationVersionId;
    this.materialCode = materialCode;
  }
}

/** Builds the exact-id formula version lookup, failing closed on a duplicate
 *  `FormulationVersion.id` rather than silently letting the last one win —
 *  an ambiguous exact identity must never be resolved by guessing which of
 *  two conflicting records a requested id actually means. */
function buildVersionsById(formulationVersions: FormulationVersion[]): Map<string, FormulationVersion> {
  const byId = new Map<string, FormulationVersion>();
  for (const version of formulationVersions) {
    if (byId.has(version.id)) {
      throw new FormulaVersionDatasetExtractionError(
        "duplicate_formula_version_id",
        version.id,
        `Ambiguous exact formula version identity: more than one supplied formulation version has id "${version.id}".`,
      );
    }
    byId.set(version.id, version);
  }
  return byId;
}

/** Builds the exact-code material lookup, failing closed on a duplicate
 *  `RawMaterial.code` rather than silently letting the last one win — an
 *  ambiguous exact identity must never be resolved by guessing. */
function buildMaterialsByCode(materials: RawMaterial[], formulationVersionId: string): Map<string, RawMaterial> {
  const byCode = new Map<string, RawMaterial>();
  for (const material of materials) {
    if (byCode.has(material.code)) {
      throw new FormulaVersionDatasetExtractionError(
        "duplicate_material_code",
        formulationVersionId,
        `Ambiguous exact material identity: more than one supplied material has code "${material.code}".`,
        material.code,
      );
    }
    byCode.set(material.code, material);
  }
  return byCode;
}

/** Resolves `formulation.productFamilyCode` against the optional supplied
 *  `productFamilies` collection. Supplying the collection is an explicit
 *  request to resolve the family: a match embeds it, more than one match is
 *  an ambiguous exact identity, and no match is a required-but-unresolved
 *  reference — both of the latter fail closed rather than silently leaving
 *  the row without a `productFamily`. Omitting the collection entirely means
 *  no resolution was requested, so the row legitimately carries only
 *  `productFamilyCode`. */
function resolveProductFamily(
  formulation: Formulation,
  productFamilies: ProductFamily[] | undefined,
  formulationVersionId: string,
): ProductFamily | undefined {
  if (!productFamilies) return undefined;
  const matches = productFamilies.filter((family) => family.code === formulation.productFamilyCode);
  if (matches.length > 1) {
    throw new FormulaVersionDatasetExtractionError(
      "duplicate_product_family_code",
      formulationVersionId,
      `Ambiguous exact product family identity: more than one supplied product family has code "${formulation.productFamilyCode}".`,
    );
  }
  if (matches.length === 0) {
    throw new FormulaVersionDatasetExtractionError(
      "product_family_not_found",
      formulationVersionId,
      `Formulation "${formulation.id}" references product family code "${formulation.productFamilyCode}", which was not found among the supplied product families.`,
    );
  }
  return matches[0];
}

/** Resolves every material a version's composition lines reference, in the
 *  deterministic order those lines first mention them, deduplicated. Lines
 *  with no `materialCode` (a draft naming a material not yet in the library)
 *  are legitimately unresolved and simply contribute nothing here — only an
 *  exact `materialCode` citation is ever resolved or required to resolve. */
function resolveReferencedMaterials(
  lines: FormulationLine[],
  materialsByCode: Map<string, RawMaterial>,
  formulationVersionId: string,
): RawMaterial[] {
  const resolved: RawMaterial[] = [];
  const seenCodes = new Set<string>();
  for (const line of lines) {
    if (!line.materialCode) continue;
    if (seenCodes.has(line.materialCode)) continue;
    const material = materialsByCode.get(line.materialCode);
    if (!material) {
      throw new FormulaVersionDatasetExtractionError(
        "material_not_found",
        formulationVersionId,
        `Composition line "${line.id}" references material code "${line.materialCode}", which was not found among the supplied materials.`,
        line.materialCode,
      );
    }
    seenCodes.add(line.materialCode);
    resolved.push(material);
  }
  return resolved;
}

function buildLineage(
  formulation: Formulation,
  version: FormulationVersion,
  materials: RawMaterial[],
  productFamily: ProductFamily | undefined,
): SourceRecordReference[] {
  const refs: SourceRecordReference[] = [
    { sourceEntity: "formulation", sourceRecordId: formulation.id },
    { sourceEntity: "formulationVersion", sourceRecordId: version.id },
  ];
  for (const material of materials) {
    refs.push({ sourceEntity: "rawMaterial", sourceRecordId: material.code });
  }
  if (productFamily) {
    refs.push({ sourceEntity: "productFamily", sourceRecordId: productFamily.id });
  }
  return refs;
}

function extractOne(
  version: FormulationVersion,
  formulationsById: Map<string, Formulation>,
  materials: RawMaterial[],
  productFamilies: ProductFamily[] | undefined,
): FormulaVersionCompositionRow {
  const formulation = formulationsById.get(version.formulationId);
  if (!formulation) {
    throw new FormulaVersionDatasetExtractionError(
      "formulation_not_found",
      version.id,
      `FormulationVersion "${version.id}" references formulationId "${version.formulationId}", which was not found among the supplied formulations.`,
    );
  }

  const materialsByCode = buildMaterialsByCode(materials, version.id);
  const referencedMaterials = resolveReferencedMaterials(version.lines, materialsByCode, version.id);
  const productFamily = resolveProductFamily(formulation, productFamilies, version.id);

  const row = {
    datasetSchemaVersion: DATASET_SCHEMA_VERSION,
    sourceRecords: buildLineage(formulation, version, referencedMaterials, productFamily),
    formulaId: formulation.id,
    formulaCode: formulation.code,
    formulaVersionId: version.id,
    formulaVersionNumber: version.versionNumber,
    composition: version.lines,
    materials: referencedMaterials,
    productFamilyCode: formulation.productFamilyCode,
    ...(productFamily ? { productFamily } : {}),
  };

  const parsed = formulaVersionCompositionRowSchema.safeParse(row);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new FormulaVersionDatasetExtractionError(
      "row_schema_validation_failed",
      version.id,
      `Extracted row for formula version "${version.id}" failed schema validation: ${issues}`,
    );
  }
  return parsed.data;
}

/** Emits exactly one `FormulaVersionCompositionRow` per requested formula
 *  version id, in the requested order. Throws (fails closed) on the first
 *  requested id, formula, or composition material reference that cannot be
 *  resolved to an exact, unambiguous source record, or on the first
 *  constructed row that fails schema validation — it never silently drops
 *  or partially emits a row instead. */
export function extractFormulaVersionDatasetRows(
  input: FormulaVersionDatasetExtractionInput,
): FormulaVersionCompositionRow[] {
  const formulationsById = new Map(input.formulations.map((formulation) => [formulation.id, formulation]));
  const versionsById = buildVersionsById(input.formulationVersions);
  return input.formulationVersionIds.map((requestedId) => {
    const version = versionsById.get(requestedId);
    if (!version) {
      throw new FormulaVersionDatasetExtractionError(
        "formula_version_not_found",
        requestedId,
        `Requested formula version id "${requestedId}" was not found among the supplied formulation versions.`,
      );
    }
    return extractOne(version, formulationsById, input.materials, input.productFamilies);
  });
}
