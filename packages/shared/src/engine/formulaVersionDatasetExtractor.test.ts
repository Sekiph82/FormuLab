import { describe, expect, it } from "vitest";
import {
  FormulaVersionDatasetExtractionError,
  extractFormulaVersionDatasetRows,
  type FormulaVersionDatasetExtractionInput,
} from "./formulaVersionDatasetExtractor";
import { DATASET_SCHEMA_VERSION, formulaVersionCompositionRowSchema } from "../schemas/dataset";
import { extractFormulaVersionDatasetRows as extractFromPublicEntryPoint } from "../index";
import type { Formulation, FormulationLine, FormulationVersion } from "../schemas/formulation";
import type { RawMaterial } from "../schemas/materials";
import type { ProductFamily } from "../schemas/product";

function line(over: Partial<FormulationLine> = {}): FormulationLine {
  return {
    id: "line-1",
    lineNumber: 1,
    phase: "A",
    displayName: "Sodium Laureth Sulfate",
    percent: "12.00",
    isQsToHundred: false,
    functions: ["anionic_surfactant"],
    provenance: { origin: "chemist_override", evidenceClaimIds: [] },
    ...over,
  };
}

function formulation(over: Partial<Formulation> = {}): Formulation {
  return {
    schemaVersion: "1.0",
    id: "FORM-0001",
    code: "HC-SHAMPOO-REG-001",
    name: "Regular Shampoo",
    productFamilyCode: "HC-SHAMPOO-REG",
    targetSkuCodes: [],
    targetMarkets: ["KE"],
    targetClaims: [],
    targetBatchKg: "100",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archived: false,
    ...over,
  };
}

function version(over: Partial<FormulationVersion> = {}): FormulationVersion {
  return {
    schemaVersion: "1.0",
    id: "VER-0001",
    formulationId: "FORM-0001",
    versionNumber: 1,
    status: "concept",
    author: "local",
    createdAt: "2026-01-02T00:00:00.000Z",
    lines: [line()],
    basisBatchKg: "100",
    sourceRunIds: [],
    regulatoryFindingIds: [],
    compatibilityFindingIds: [],
    safetyFindingIds: [],
    approvalRecordIds: [],
    ...over,
  };
}

function material(over: Partial<RawMaterial> = {}): RawMaterial {
  return {
    schemaVersion: "1.0",
    code: "SLES-70",
    displayName: "Sodium Laureth Sulfate",
    casNumbers: [],
    ecNumbers: [],
    functions: ["anionic_surfactant"],
    documents: [],
    regulatoryStatuses: [],
    hazardClassifications: [],
    allergens: [],
    incompatibilities: [],
    substituteCodes: [],
    activeMatterState: "known",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function productFamily(over: Partial<ProductFamily> = {}): ProductFamily {
  return {
    schemaVersion: "1.0",
    id: "PF-0001",
    code: "HC-SHAMPOO-REG",
    name: "Regular Shampoo Family",
    domain: "hair_care",
    subtype: "regular",
    intendedUsers: [],
    intendedUse: "daily cleansing",
    targetMarkets: ["KE"],
    defaultRegulatoryProfile: "KE-EAC",
    hazardClass: "ordinary",
    ...over,
  };
}

/** Builds a full extraction input requesting exactly the given version ids
 *  (defaulting to every supplied version's id, in order). */
function buildInput(
  over: Partial<FormulaVersionDatasetExtractionInput> & { formulationVersions: FormulationVersion[] },
): FormulaVersionDatasetExtractionInput {
  return {
    formulationVersionIds: over.formulationVersions.map((v) => v.id),
    formulations: [formulation()],
    materials: [material()],
    ...over,
  };
}

describe("extractFormulaVersionDatasetRows", () => {
  it("emits one schema-valid dataset row for one formula version", () => {
    const input = buildInput({
      formulationVersions: [version()],
    });
    const rows = extractFormulaVersionDatasetRows(input);
    expect(rows).toHaveLength(1);
    const result = formulaVersionCompositionRowSchema.safeParse(rows[0]);
    expect(result.success).toBe(true);
  });

  it("emits distinct rows with exact formula-version identities for multiple versions", () => {
    const input = buildInput({
      formulationVersions: [
        version({ id: "VER-0001", versionNumber: 1 }),
        version({ id: "VER-0002", versionNumber: 2, lines: [line({ id: "line-2" })] }),
      ],
    });
    const rows = extractFormulaVersionDatasetRows(input);
    expect(rows).toHaveLength(2);
    expect(rows[0].formulaVersionId).toBe("VER-0001");
    expect(rows[0].formulaVersionNumber).toBe(1);
    expect(rows[1].formulaVersionId).toBe("VER-0002");
    expect(rows[1].formulaVersionNumber).toBe(2);
    expect(rows[0]).not.toEqual(rows[1]);
  });

  it("preserves composition order, line identities, material ids, values, units, casing and whitespace exactly", () => {
    const lines = [
      line({ id: "  Line-B  ", lineNumber: 2, materialCode: "sles-70", percent: "0012.500", quantityUnit: "kg" }),
      line({ id: "Line-A", lineNumber: 1, materialCode: "SLES-70", percent: "12.5" }),
    ];
    const input = buildInput({
      formulationVersions: [version({ lines })],
      materials: [material({ code: "sles-70" }), material({ code: "SLES-70", displayName: "Other case" })],
    });
    const rows = extractFormulaVersionDatasetRows(input);
    expect(rows[0].composition).toEqual(lines);
    expect(rows[0].composition[0].id).toBe("  Line-B  ");
    expect(rows[0].composition[0].percent).toBe("0012.500");
    expect(rows[0].composition[1].id).toBe("Line-A");
  });

  it("keeps duplicate-looking composition lines distinct, not aggregated", () => {
    const lines = [
      line({ id: "line-1", materialCode: "SLES-70", percent: "5.00" }),
      line({ id: "line-2", materialCode: "SLES-70", percent: "5.00" }),
    ];
    const input = buildInput({ formulationVersions: [version({ lines })] });
    const rows = extractFormulaVersionDatasetRows(input);
    expect(rows[0].composition).toHaveLength(2);
    expect(rows[0].composition[0].id).not.toBe(rows[0].composition[1].id);
  });

  it("keeps missing optional composition data missing, never defaulted", () => {
    const bareLine = line({ id: "line-1", materialCode: undefined, quantity: undefined, quantityUnit: undefined, tradeName: undefined });
    const input = buildInput({ formulationVersions: [version({ lines: [bareLine] })] });
    const rows = extractFormulaVersionDatasetRows(input);
    expect(rows[0].composition[0].materialCode).toBeUndefined();
    expect(rows[0].composition[0].quantity).toBeUndefined();
    expect(rows[0].composition[0].quantityUnit).toBeUndefined();
    expect(rows[0].composition[0].tradeName).toBeUndefined();
    const roundTripped = JSON.parse(JSON.stringify(rows[0].composition[0]));
    expect("quantity" in roundTripped).toBe(false);
    expect("quantityUnit" in roundTripped).toBe(false);
    expect("materialCode" in roundTripped).toBe(false);
    // Since the line names no material, it contributes nothing to `materials`.
    expect(rows[0].materials).toHaveLength(0);
  });

  it("resolves every referenced material exactly and represents it once, regardless of how many lines cite it", () => {
    const lines = [
      line({ id: "line-1", materialCode: "SLES-70" }),
      line({ id: "line-2", materialCode: "SLES-70" }),
      line({ id: "line-3", materialCode: "COCAMIDE-DEA" }),
    ];
    const input = buildInput({
      formulationVersions: [version({ lines })],
      materials: [material({ code: "SLES-70" }), material({ code: "COCAMIDE-DEA", displayName: "Cocamide DEA" })],
    });
    const rows = extractFormulaVersionDatasetRows(input);
    expect(rows[0].materials).toHaveLength(2);
    expect(rows[0].materials.map((m) => m.code)).toEqual(["SLES-70", "COCAMIDE-DEA"]);
  });

  it("round-trips material properties and units unchanged", () => {
    const richMaterial = material({
      density: "1.050",
      phMin: "6.50",
      phMax: "7.50",
      viscosityMin: "200",
      viscosityMax: "400",
      hlb: "12.9",
      activeMatterPercent: "70.00",
    });
    const input = buildInput({
      formulationVersions: [version({ lines: [line({ materialCode: "SLES-70" })] })],
      materials: [richMaterial],
    });
    const rows = extractFormulaVersionDatasetRows(input);
    expect(rows[0].materials[0]).toEqual(richMaterial);
  });

  it("keeps material properties attached to the correct material when several materials are resolved", () => {
    const lines = [
      line({ id: "line-1", materialCode: "SLES-70" }),
      line({ id: "line-2", materialCode: "COCAMIDE-DEA" }),
    ];
    const materialA = material({
      code: "SLES-70",
      density: "1.050",
      hlb: "12.9",
      ionicCharacter: "anionic",
    });
    const materialB = material({
      code: "COCAMIDE-DEA",
      displayName: "Cocamide DEA",
      density: "0.980",
      hlb: "9.3",
      ionicCharacter: "nonionic",
    });
    const input = buildInput({
      formulationVersions: [version({ lines })],
      materials: [materialA, materialB],
    });
    const rows = extractFormulaVersionDatasetRows(input);
    const resolvedA = rows[0].materials.find((m) => m.code === "SLES-70");
    const resolvedB = rows[0].materials.find((m) => m.code === "COCAMIDE-DEA");
    expect(resolvedA).toEqual(materialA);
    expect(resolvedB).toEqual(materialB);
    expect(resolvedA?.density).toBe("1.050");
    expect(resolvedB?.density).toBe("0.980");
    expect(resolvedA?.ionicCharacter).toBe("anionic");
    expect(resolvedB?.ionicCharacter).toBe("nonionic");
  });

  it("resolves materials by exact code only, never conflating distinct records with similar/identical display names", () => {
    const materialA = material({ code: "SLES-70", displayName: "Sodium Laureth Sulfate" });
    const materialB = material({ code: "SLES-70-ALT", displayName: "Sodium Laureth Sulfate" });
    const input = buildInput({
      formulationVersions: [version({ lines: [line({ materialCode: "SLES-70-ALT" })] })],
      materials: [materialA, materialB],
    });
    const rows = extractFormulaVersionDatasetRows(input);
    expect(rows[0].materials).toHaveLength(1);
    expect(rows[0].materials[0].code).toBe("SLES-70-ALT");
    expect(rows[0].materials[0]).toEqual(materialB);
    expect(rows[0].materials[0]).not.toEqual(materialA);
  });

  it("keeps missing optional material properties missing, never defaulted to zero/empty/placeholder", () => {
    const sparseMaterial = material();
    expect(sparseMaterial.hlb).toBeUndefined();
    expect(sparseMaterial.density).toBeUndefined();
    const input = buildInput({
      formulationVersions: [version({ lines: [line({ materialCode: "SLES-70" })] })],
      materials: [sparseMaterial],
    });
    const rows = extractFormulaVersionDatasetRows(input);
    expect(rows[0].materials[0].hlb).toBeUndefined();
    expect(rows[0].materials[0].density).toBeUndefined();
    expect("hlb" in JSON.parse(JSON.stringify(rows[0].materials[0]))).toBe(false);
  });

  it("copies product family exactly when present, and stays honestly absent when not supplied", () => {
    const family = productFamily();
    const withFamily = extractFormulaVersionDatasetRows(
      buildInput({ formulationVersions: [version()], productFamilies: [family] }),
    );
    expect(withFamily[0].productFamilyCode).toBe("HC-SHAMPOO-REG");
    expect(withFamily[0].productFamily).toEqual(family);

    const withoutFamilyCollection = extractFormulaVersionDatasetRows(buildInput({ formulationVersions: [version()] }));
    expect(withoutFamilyCollection[0].productFamilyCode).toBe("HC-SHAMPOO-REG");
    expect(withoutFamilyCollection[0].productFamily).toBeUndefined();
  });

  it("cites every contributing record exactly, includes multiple materials, keeps stable ordering, and has no duplicate pairs", () => {
    const lines = [
      line({ id: "line-1", materialCode: "SLES-70" }),
      line({ id: "line-2", materialCode: "COCAMIDE-DEA" }),
    ];
    const family = productFamily();
    const rows = extractFormulaVersionDatasetRows(
      buildInput({
        formulationVersions: [version({ lines })],
        materials: [material({ code: "SLES-70" }), material({ code: "COCAMIDE-DEA" })],
        productFamilies: [family],
      }),
    );
    expect(rows[0].sourceRecords).toEqual([
      { sourceEntity: "formulation", sourceRecordId: "FORM-0001" },
      { sourceEntity: "formulationVersion", sourceRecordId: "VER-0001" },
      { sourceEntity: "rawMaterial", sourceRecordId: "SLES-70" },
      { sourceEntity: "rawMaterial", sourceRecordId: "COCAMIDE-DEA" },
      { sourceEntity: "productFamily", sourceRecordId: "PF-0001" },
    ]);
    const pairs = rows[0].sourceRecords.map((r) => `${r.sourceEntity}:${r.sourceRecordId}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("fails closed when a requested formula version id is not found", () => {
    const input = buildInput({
      formulationVersions: [version({ id: "VER-0001" })],
      formulationVersionIds: ["VER-DOES-NOT-EXIST"],
    });
    try {
      extractFormulaVersionDatasetRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionDatasetExtractionError);
      expect((err as FormulaVersionDatasetExtractionError).code).toBe("formula_version_not_found");
    }
  });

  it("fails closed when duplicate/ambiguous exact formula version identities are supplied in the pool", () => {
    const input = buildInput({
      formulationVersions: [version({ id: "VER-0001" }), version({ id: "VER-0001", versionNumber: 2 })],
    });
    try {
      extractFormulaVersionDatasetRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionDatasetExtractionError);
      expect((err as FormulaVersionDatasetExtractionError).code).toBe("duplicate_formula_version_id");
    }
  });

  it("fails closed when a referenced material cannot be resolved", () => {
    const input = buildInput({
      formulationVersions: [version({ lines: [line({ materialCode: "MISSING-MAT" })] })],
      materials: [material({ code: "SLES-70" })],
    });
    expect(() => extractFormulaVersionDatasetRows(input)).toThrow(FormulaVersionDatasetExtractionError);
    try {
      extractFormulaVersionDatasetRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionDatasetExtractionError);
      expect((err as FormulaVersionDatasetExtractionError).code).toBe("material_not_found");
    }
  });

  it("fails closed when duplicate/ambiguous exact material source identities are supplied", () => {
    const input = buildInput({
      formulationVersions: [version({ lines: [line({ materialCode: "SLES-70" })] })],
      materials: [material({ code: "SLES-70" }), material({ code: "SLES-70", displayName: "Duplicate" })],
    });
    try {
      extractFormulaVersionDatasetRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionDatasetExtractionError);
      expect((err as FormulaVersionDatasetExtractionError).code).toBe("duplicate_material_code");
    }
  });

  it("fails closed when a required product family reference cannot be resolved (collection supplied, no exact match)", () => {
    const input = buildInput({
      formulationVersions: [version()],
      productFamilies: [productFamily({ code: "OTHER-FAMILY" })],
    });
    try {
      extractFormulaVersionDatasetRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionDatasetExtractionError);
      expect((err as FormulaVersionDatasetExtractionError).code).toBe("product_family_not_found");
    }
  });

  it("fails closed when duplicate/ambiguous exact product family source identities are supplied", () => {
    const input = buildInput({
      formulationVersions: [version()],
      productFamilies: [productFamily(), productFamily({ id: "PF-0002", name: "Duplicate" })],
    });
    try {
      extractFormulaVersionDatasetRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionDatasetExtractionError);
      expect((err as FormulaVersionDatasetExtractionError).code).toBe("duplicate_product_family_code");
    }
  });

  it("fails closed when a formula version references a formula that was not supplied", () => {
    const input = buildInput({
      formulationVersions: [version()],
      formulations: [],
    });
    try {
      extractFormulaVersionDatasetRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionDatasetExtractionError);
      expect((err as FormulaVersionDatasetExtractionError).code).toBe("formulation_not_found");
    }
  });

  it("fails closed, and emits nothing, when a constructed row would fail its own schema (malformed source data)", () => {
    const input = buildInput({
      formulationVersions: [version({ id: "VER-0001" }), version({ id: "VER-0002", versionNumber: 2 })],
      formulationVersionIds: ["VER-0001", "VER-0002"],
      formulations: [formulation({ id: "FORM-0001", code: "   " })],
    });
    try {
      extractFormulaVersionDatasetRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionDatasetExtractionError);
      expect((err as FormulaVersionDatasetExtractionError).code).toBe("row_schema_validation_failed");
    }
  });

  it("rejects a payload missing mandatory formula/version identity via the schema", () => {
    const rows = extractFormulaVersionDatasetRows(buildInput({ formulationVersions: [version()] }));
    const { formulaId, ...withoutFormulaId } = rows[0];
    expect(formulaVersionCompositionRowSchema.safeParse(withoutFormulaId).success).toBe(false);

    const { formulaVersionId, ...withoutVersionId } = rows[0];
    expect(formulaVersionCompositionRowSchema.safeParse(withoutVersionId).success).toBe(false);

    expect(formulaVersionCompositionRowSchema.safeParse({ not: "a row" }).success).toBe(false);
    void formulaId;
    void formulaVersionId;
  });

  it("does not mutate its inputs, including on a failure path", () => {
    const frozenLine = Object.freeze(line({ materialCode: "SLES-70" }));
    const linesForVersion = [frozenLine];
    const builtVersion = version({ lines: linesForVersion });
    Object.freeze(linesForVersion);

    const formulations = Object.freeze([Object.freeze(formulation())]);
    const versions = Object.freeze([Object.freeze(builtVersion)]);
    const materials = Object.freeze([Object.freeze(material())]);
    const snapshotBefore = JSON.parse(JSON.stringify({ formulations, versions, materials }));

    expect(() =>
      extractFormulaVersionDatasetRows({
        formulationVersionIds: [builtVersion.id],
        formulations: [...formulations],
        formulationVersions: [...versions],
        materials: [...materials],
      }),
    ).not.toThrow();

    const failingInput: FormulaVersionDatasetExtractionInput = {
      formulationVersionIds: ["VER-BAD"],
      formulations: [...formulations],
      formulationVersions: [version({ id: "VER-BAD", lines: [line({ materialCode: "NOT-THERE" })] })],
      materials: [...materials],
    };
    expect(() => extractFormulaVersionDatasetRows(failingInput)).toThrow(FormulaVersionDatasetExtractionError);

    expect(JSON.parse(JSON.stringify({ formulations, versions, materials }))).toEqual(snapshotBefore);
  });

  it("does not let mutating returned nested output mutate the source fixtures", () => {
    const sourceLine = line({ materialCode: "SLES-70" });
    const sourceMaterial = material({ functions: ["anionic_surfactant"] });
    const sourceFamily = productFamily({ intendedUsers: ["adults"] });
    const input = buildInput({
      formulationVersions: [version({ lines: [sourceLine] })],
      materials: [sourceMaterial],
      productFamilies: [sourceFamily],
    });
    const rows = extractFormulaVersionDatasetRows(input);

    rows[0].composition[0].functions.push("preservative");
    rows[0].materials[0].functions.push("preservative");
    (rows[0].composition[0] as { displayName: string }).displayName = "mutated";
    if (rows[0].productFamily) {
      rows[0].productFamily.intendedUsers.push("infants");
    }

    expect(sourceLine.functions).toEqual(["anionic_surfactant"]);
    expect(sourceMaterial.functions).toEqual(["anionic_surfactant"]);
    expect(sourceFamily.intendedUsers).toEqual(["adults"]);
    expect(sourceLine.displayName).toBe("Sodium Laureth Sulfate");
  });

  it("is deterministic: repeated extraction on identical inputs produces deeply equal results", () => {
    const input = buildInput({
      formulationVersions: [version({ lines: [line({ materialCode: "SLES-70" })] })],
      productFamilies: [productFamily()],
    });
    const first = extractFormulaVersionDatasetRows(input);
    const second = extractFormulaVersionDatasetRows(input);
    expect(first).toEqual(second);
  });

  it("preserves the exact payload and lineage identities through JSON serialization and parsing", () => {
    const rows = extractFormulaVersionDatasetRows(
      buildInput({
        formulationVersions: [version({ lines: [line({ materialCode: "SLES-70" })] })],
        productFamilies: [productFamily()],
      }),
    );
    const roundTripped = JSON.parse(JSON.stringify(rows[0]));
    expect(roundTripped).toEqual(rows[0]);
    expect(formulaVersionCompositionRowSchema.safeParse(roundTripped).success).toBe(true);
    expect(roundTripped.datasetSchemaVersion).toBe(DATASET_SCHEMA_VERSION);
  });

  it("is available from the shared package's public export path", () => {
    const rows = extractFromPublicEntryPoint(buildInput({ formulationVersions: [version()] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].formulaVersionId).toBe("VER-0001");
  });
});
