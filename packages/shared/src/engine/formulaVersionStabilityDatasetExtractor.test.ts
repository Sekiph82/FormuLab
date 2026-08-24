import { describe, expect, it } from "vitest";
import {
  FormulaVersionStabilityDatasetExtractionError,
  extractFormulaVersionStabilityRows,
  type FormulaVersionStabilityDatasetExtractionInput,
} from "./formulaVersionStabilityDatasetExtractor";
import {
  DATASET_SCHEMA_VERSION,
  formulaVersionStabilityRowSchema,
  stabilitySampleResultsSchema,
  stabilityStudySamplesSchema,
} from "../schemas/dataset";
import { extractFormulaVersionStabilityRows as extractFromPublicEntryPoint } from "../index";
import { stabilityConditionSchema, stabilityResultSchema, stabilitySampleSchema, stabilityTimePointSchema } from "../schemas/stability";
import type { Formulation, FormulationVersion } from "../schemas/formulation";
import type { StabilityCondition, StabilityResult, StabilitySample, StabilityStudy, StabilityTimePoint } from "../schemas/stability";

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
    lines: [],
    basisBatchKg: "100",
    sourceRunIds: [],
    regulatoryFindingIds: [],
    compatibilityFindingIds: [],
    safetyFindingIds: [],
    approvalRecordIds: [],
    ...over,
  };
}

function study(over: Partial<StabilityStudy> = {}): StabilityStudy {
  return {
    schemaVersion: "1.0",
    id: "STUDY-0001",
    code: "STB-0001",
    projectId: "FORM-0001",
    sourceType: "saved_version",
    sourceFormulaVersionId: "VER-0001",
    formulaSnapshot: { lines: [], basisBatchKg: "100", capturedAt: "2026-01-03T00:00:00.000Z" },
    productFamilyId: "PF-0001",
    packagingSkuCode: "SKU-0001",
    packagingSnapshot: { skuCode: "SKU-0001", lines: [], capturedAt: "2026-01-03T00:00:00.000Z" },
    title: "Study 1",
    owner: "local",
    status: "active",
    conditionIds: ["COND-0001"],
    timePointIds: ["TP-0001"],
    requiredTestDefinitionIds: [],
    replicatesPerPullPoint: 1,
    hasOpenCriticalFailure: false,
    createdAt: "2026-01-03T00:00:00.000Z",
    createdBy: "local",
    updatedAt: "2026-01-03T00:00:00.000Z",
    ...over,
  };
}

function condition(over: Partial<StabilityCondition> = {}): StabilityCondition {
  return {
    schemaVersion: "1.0",
    id: "COND-0001",
    code: "25C",
    label: "25°C / long-term",
    verificationStatus: "not_verified",
    active: true,
    lightCondition: "none",
    orientation: "not_applicable",
    ...over,
  };
}

function timePoint(over: Partial<StabilityTimePoint> = {}): StabilityTimePoint {
  return {
    schemaVersion: "1.0",
    id: "TP-0001",
    code: "1MO",
    label: "1 month",
    daysFromStart: 30,
    custom: false,
    ...over,
  };
}

function sample(over: Partial<StabilitySample> = {}): StabilitySample {
  return {
    schemaVersion: "1.0",
    id: "SAMPLE-0001",
    sampleCode: "SMP-0001",
    studyId: "STUDY-0001",
    conditionId: "COND-0001",
    timePointId: "TP-0001",
    packagingSkuCode: "SKU-0001",
    replicateNumber: 1,
    status: "completed",
    testDefinitionIds: [],
    createdAt: "2026-01-03T00:00:00.000Z",
    ...over,
  };
}

function result(over: Partial<StabilityResult> = {}): StabilityResult {
  return {
    schemaVersion: "1.0",
    id: "RESULT-0001",
    studyId: "STUDY-0001",
    sampleId: "SAMPLE-0001",
    conditionId: "COND-0001",
    timePointId: "TP-0001",
    testDefinitionId: "TESTDEF-0001",
    resultType: "numeric",
    replicates: [],
    passFail: "not_evaluated",
    attachments: [],
    performedBy: "alice",
    performedAt: "2026-01-03T10:00:00.000Z",
    createdAt: "2026-01-03T10:05:00.000Z",
    updatedAt: "2026-01-03T10:05:00.000Z",
    ...over,
  };
}

function buildInput(
  over: Partial<FormulaVersionStabilityDatasetExtractionInput> & { formulationVersions: FormulationVersion[] },
): FormulaVersionStabilityDatasetExtractionInput {
  return {
    formulationVersionIds: over.formulationVersions.map((v) => v.id),
    formulations: [formulation()],
    stabilityStudies: [],
    stabilitySamples: [],
    stabilityResults: [],
    stabilityConditions: [condition()],
    stabilityTimePoints: [timePoint()],
    ...over,
  };
}

describe("extractFormulaVersionStabilityRows", () => {
  it("emits one schema-valid dataset row for one formula version with no linked studies", () => {
    const rows = extractFormulaVersionStabilityRows(buildInput({ formulationVersions: [version()] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].studies).toEqual([]);
    expect(formulaVersionStabilityRowSchema.safeParse(rows[0]).success).toBe(true);
  });

  it("emits one study with one sample and one result, including its resolved condition and time point", () => {
    const rows = extractFormulaVersionStabilityRows(
      buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sample()],
        stabilityResults: [result()],
      }),
    );
    expect(rows[0].studies).toHaveLength(1);
    expect(rows[0].studies[0].studyId).toBe("STUDY-0001");
    expect(rows[0].studies[0].samples).toHaveLength(1);
    expect(rows[0].studies[0].samples[0].sample.id).toBe("SAMPLE-0001");
    expect(rows[0].studies[0].samples[0].results).toHaveLength(1);
    expect(rows[0].studies[0].samples[0].results[0].id).toBe("RESULT-0001");
    expect(rows[0].studies[0].conditions).toHaveLength(1);
    expect(rows[0].studies[0].conditions[0].id).toBe("COND-0001");
    expect(rows[0].studies[0].timePoints).toHaveLength(1);
    expect(rows[0].studies[0].timePoints[0].id).toBe("TP-0001");
  });

  it("emits multiple results on one sample, ordered by performedAt then id regardless of input order", () => {
    const results = [
      result({ id: "R2", performedAt: "2026-01-03T11:00:00.000Z" }),
      result({ id: "R1", performedAt: "2026-01-03T10:00:00.000Z" }),
      result({ id: "R3", performedAt: "2026-01-03T11:00:00.000Z" }),
    ];
    const rows = extractFormulaVersionStabilityRows(
      buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sample()],
        stabilityResults: results,
      }),
    );
    expect(rows[0].studies[0].samples[0].results.map((r) => r.id)).toEqual(["R1", "R2", "R3"]);
  });

  it("emits multiple samples on one study, each with own results, ordered by createdAt/id regardless of input order", () => {
    const sampleA = sample({ id: "SAMPLE-A", sampleCode: "SMP-A", createdAt: "2026-01-03T00:00:00.000Z" });
    const sampleB = sample({ id: "SAMPLE-B", sampleCode: "SMP-B", createdAt: "2026-01-04T00:00:00.000Z" });
    const resultA = result({ id: "RESULT-A", sampleId: "SAMPLE-A" });
    const resultB = result({ id: "RESULT-B", sampleId: "SAMPLE-B" });
    const forward = extractFormulaVersionStabilityRows(
      buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sampleA, sampleB],
        stabilityResults: [resultA, resultB],
      }),
    );
    const reversed = extractFormulaVersionStabilityRows(
      buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sampleB, sampleA],
        stabilityResults: [resultB, resultA],
      }),
    );
    expect(forward[0].studies[0].samples.map((s) => s.sample.id)).toEqual(["SAMPLE-A", "SAMPLE-B"]);
    expect(reversed[0]).toEqual(forward[0]);
  });

  it("emits multiple studies for one formula version, ordered by createdAt/id regardless of input order", () => {
    const studyA = study({ id: "STUDY-A", code: "STB-A", createdAt: "2026-01-03T00:00:00.000Z" });
    const studyB = study({ id: "STUDY-B", code: "STB-B", createdAt: "2026-01-04T00:00:00.000Z" });
    const rows = extractFormulaVersionStabilityRows(
      buildInput({ formulationVersions: [version()], stabilityStudies: [studyB, studyA] }),
    );
    expect(rows[0].studies.map((s) => s.studyId)).toEqual(["STUDY-A", "STUDY-B"]);
  });

  it("preserves exact result value/unit/status/timestamp/method fields", () => {
    const richResult = result({
      id: "R1",
      resultType: "numeric",
      replicates: [{ replicateNumber: 1, numericValue: "4.5", isOutlier: false }],
      unit: "cP",
      passFail: "pass",
      performedAt: "2026-01-03T10:00:00.000Z",
      notes: "Ran twice to confirm.",
      testDefinitionId: "TESTDEF-VISC",
    });
    const rows = extractFormulaVersionStabilityRows(
      buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sample()],
        stabilityResults: [richResult],
      }),
    );
    const emitted = rows[0].studies[0].samples[0].results[0];
    expect(emitted.unit).toBe("cP");
    expect(emitted.passFail).toBe("pass");
    expect(emitted.performedAt).toBe("2026-01-03T10:00:00.000Z");
    expect(emitted.replicates).toEqual([{ replicateNumber: 1, numericValue: "4.5", isOutlier: false }]);
    expect(emitted.notes).toBe("Ran twice to confirm.");
    expect(emitted.testDefinitionId).toBe("TESTDEF-VISC");
  });

  it("preserves the sample's own context fields verbatim (storage condition, time point, packaging, disposal)", () => {
    const richSample = sample({
      id: "S1",
      storageLocation: "Chamber-04",
      dueDate: "2026-02-01T00:00:00.000Z",
      disposedAt: "2026-02-05T00:00:00.000Z",
      status: "disposed",
    });
    const rows = extractFormulaVersionStabilityRows(
      buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [richSample],
        stabilityResults: [],
      }),
    );
    const emittedSample = rows[0].studies[0].samples[0].sample;
    expect(emittedSample.storageLocation).toBe("Chamber-04");
    expect(emittedSample.dueDate).toBe("2026-02-01T00:00:00.000Z");
    expect(emittedSample.disposedAt).toBe("2026-02-05T00:00:00.000Z");
    expect(emittedSample.status).toBe("disposed");
  });

  it("preserves exact canonical StabilityCondition evidence — temperature/tolerance, humidity/tolerance, light, orientation, freeze-thaw, custom instructions, verification, active", () => {
    const richCondition = condition({
      id: "COND-RICH",
      code: "FREEZE_THAW",
      label: "Freeze-thaw cycling",
      temperatureC: "-10",
      temperatureToleranceC: "2",
      humidityPercent: "60",
      humidityTolerancePercent: "5",
      lightCondition: "uv",
      orientation: "inverted",
      freezeThawCycleDefinition: "24h at -10C, 24h at 25C, repeat",
      customInstructions: "Rotate samples daily.",
      verificationStatus: "verified",
      active: true,
    });
    const richStudy = study({ conditionIds: ["COND-RICH"], timePointIds: ["TP-0001"] });
    const richSample = sample({ conditionId: "COND-RICH" });
    const rows = extractFormulaVersionStabilityRows(
      buildInput({
        formulationVersions: [version()],
        stabilityStudies: [richStudy],
        stabilitySamples: [richSample],
        stabilityConditions: [richCondition],
      }),
    );
    const emitted = rows[0].studies[0].conditions[0];
    expect(emitted.id).toBe("COND-RICH");
    expect(emitted.code).toBe("FREEZE_THAW");
    expect(emitted.label).toBe("Freeze-thaw cycling");
    expect(emitted.temperatureC).toBe("-10");
    expect(emitted.temperatureToleranceC).toBe("2");
    expect(emitted.humidityPercent).toBe("60");
    expect(emitted.humidityTolerancePercent).toBe("5");
    expect(emitted.lightCondition).toBe("uv");
    expect(emitted.orientation).toBe("inverted");
    expect(emitted.freezeThawCycleDefinition).toBe("24h at -10C, 24h at 25C, repeat");
    expect(emitted.customInstructions).toBe("Rotate samples daily.");
    expect(emitted.verificationStatus).toBe("verified");
    expect(emitted.active).toBe(true);
  });

  it("preserves exact canonical StabilityTimePoint evidence — code, label, daysFromStart, custom, notes", () => {
    const richTimePoint = timePoint({
      id: "TP-RICH",
      code: "6MO",
      label: "6 months",
      daysFromStart: 180,
      custom: true,
      notes: "Extended pull point for this protocol.",
    });
    const richStudy = study({ conditionIds: ["COND-0001"], timePointIds: ["TP-RICH"] });
    const richSample = sample({ timePointId: "TP-RICH" });
    const rows = extractFormulaVersionStabilityRows(
      buildInput({
        formulationVersions: [version()],
        stabilityStudies: [richStudy],
        stabilitySamples: [richSample],
        stabilityTimePoints: [richTimePoint],
      }),
    );
    const emitted = rows[0].studies[0].timePoints[0];
    expect(emitted.id).toBe("TP-RICH");
    expect(emitted.code).toBe("6MO");
    expect(emitted.label).toBe("6 months");
    expect(emitted.daysFromStart).toBe(180);
    expect(emitted.custom).toBe(true);
    expect(emitted.notes).toBe("Extended pull point for this protocol.");
  });

  it("keeps missing optional fields absent, following the existing dataset contract", () => {
    const bareResult = result({ id: "R1" });
    const rows = extractFormulaVersionStabilityRows(
      buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sample()],
        stabilityResults: [bareResult],
      }),
    );
    const emitted = rows[0].studies[0].samples[0].results[0];
    expect(emitted.unit).toBeUndefined();
    expect(emitted.revisesResultId).toBeUndefined();
    const roundTripped = JSON.parse(JSON.stringify(emitted));
    expect("unit" in roundTripped).toBe(false);
    expect("revisesResultId" in roundTripped).toBe(false);
  });

  it("preserves explicit zero, false, and empty-but-valid values through extraction", () => {
    const edgeResult = result({
      id: "R1",
      booleanValue: false,
      replicates: [{ replicateNumber: 1, numericValue: "0", isOutlier: false }],
      passFail: "fail",
    });
    const rows = extractFormulaVersionStabilityRows(
      buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sample()],
        stabilityResults: [edgeResult],
      }),
    );
    const emitted = rows[0].studies[0].samples[0].results[0];
    expect(emitted.booleanValue).toBe(false);
    expect(emitted.replicates[0].numericValue).toBe("0");
    expect(emitted.passFail).toBe("fail");
  });

  it("preserves attachments exactly, verbatim, since stabilityResultSchema is reused wholesale", () => {
    const attachment = { id: "att-1", kind: "photo" as const, title: "Result photo", location: "s3://bucket/photo.jpg" };
    const resultWithAttachment = result({ id: "R1", attachments: [attachment] });
    const rows = extractFormulaVersionStabilityRows(
      buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sample()],
        stabilityResults: [resultWithAttachment],
      }),
    );
    expect(rows[0].studies[0].samples[0].results[0].attachments).toEqual([attachment]);
  });

  it("emits no fabricated result for a sample with zero recorded results", () => {
    const rows = extractFormulaVersionStabilityRows(
      buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sample()],
        stabilityResults: [],
      }),
    );
    expect(rows[0].studies[0].samples[0].results).toEqual([]);
  });

  it("never lets a study linked to another formula version leak into this row", () => {
    const otherVersionStudy = study({ id: "STUDY-OTHER", sourceFormulaVersionId: "VER-OTHER" });
    const rows = extractFormulaVersionStabilityRows(
      buildInput({ formulationVersions: [version({ id: "VER-0001" })], stabilityStudies: [otherVersionStudy] }),
    );
    expect(rows[0].studies).toEqual([]);
  });

  it("never lets a sample/result belonging to a study linked to a different formula version leak into this row", () => {
    const relevantStudy = study({ id: "STUDY-REL", sourceFormulaVersionId: "VER-0001" });
    const otherStudy = study({ id: "STUDY-OTHER", sourceFormulaVersionId: "VER-OTHER" });
    const relevantSample = sample({ id: "SAMPLE-REL", studyId: "STUDY-REL" });
    const otherSample = sample({ id: "SAMPLE-OTHER", studyId: "STUDY-OTHER" });
    const relevantResult = result({ id: "R-REL", studyId: "STUDY-REL", sampleId: "SAMPLE-REL" });
    const otherResult = result({ id: "R-OTHER", studyId: "STUDY-OTHER", sampleId: "SAMPLE-OTHER" });
    const rows = extractFormulaVersionStabilityRows(
      buildInput({
        formulationVersions: [version({ id: "VER-0001" })],
        stabilityStudies: [relevantStudy, otherStudy],
        stabilitySamples: [relevantSample, otherSample],
        stabilityResults: [relevantResult, otherResult],
      }),
    );
    expect(rows[0].studies).toHaveLength(1);
    expect(rows[0].studies[0].studyId).toBe("STUDY-REL");
    expect(rows[0].studies[0].samples[0].results.map((r) => r.id)).toEqual(["R-REL"]);
  });

  it("emits one row per requested identity, including a duplicate-requested version id twice in order", () => {
    const rows = extractFormulaVersionStabilityRows(
      buildInput({
        formulationVersions: [version({ id: "VER-0001" })],
        formulationVersionIds: ["VER-0001", "VER-0001"],
        stabilityStudies: [study()],
        stabilitySamples: [sample()],
        stabilityResults: [result()],
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(rows[1]);
  });

  it("fails closed when a requested formula version id is not found", () => {
    const input = buildInput({
      formulationVersions: [version({ id: "VER-0001" })],
      formulationVersionIds: ["VER-DOES-NOT-EXIST"],
    });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionStabilityDatasetExtractionError);
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("formula_version_not_found");
    }
  });

  it("fails closed on duplicate/ambiguous exact formula version identities", () => {
    const input = buildInput({
      formulationVersions: [version({ id: "VER-0001" }), version({ id: "VER-0001", versionNumber: 2 })],
    });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("duplicate_formula_version_id");
    }
  });

  it("fails closed on duplicate/ambiguous exact owning-formulation identities", () => {
    const input = buildInput({
      formulationVersions: [version()],
      formulations: [formulation(), formulation({ code: "DUP", name: "Duplicate" })],
    });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("duplicate_formulation_id");
    }
  });

  it("fails closed when a formula version references a formula that was not supplied", () => {
    const input = buildInput({ formulationVersions: [version()], formulations: [] });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("formulation_not_found");
    }
  });

  it("fails closed on duplicate/ambiguous exact study identities in the supplied pool", () => {
    const input = buildInput({
      formulationVersions: [version()],
      stabilityStudies: [study({ id: "STUDY-0001" }), study({ id: "STUDY-0001", code: "STB-DUP" })],
    });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("duplicate_stability_study_id");
    }
  });

  it("fails closed on a study whose sourceFormulaVersionId matches but whose projectId does not resolve to the owning formulation (conflicting link)", () => {
    const input = buildInput({
      formulationVersions: [version({ id: "VER-0001", formulationId: "FORM-0001" })],
      stabilityStudies: [study({ sourceFormulaVersionId: "VER-0001", projectId: "FORM-OTHER" })],
    });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionStabilityDatasetExtractionError);
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("study_formula_link_conflict");
    }
  });

  it("fails closed on a saved_version study with a missing sourceFormulaVersionId, rather than silently treating it as unlinked", () => {
    const malformedStudy = study({ sourceType: "saved_version", sourceFormulaVersionId: undefined });
    const input = buildInput({ formulationVersions: [version()], stabilityStudies: [malformedStudy] });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionStabilityDatasetExtractionError);
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("invalid_saved_version_study_link");
    }
  });

  it("a working_draft study with no sourceFormulaVersionId at all remains legitimate (not a saved_version study)", () => {
    const draftStudy = study({ sourceType: "working_draft", sourceFormulaVersionId: undefined, sourceDraftId: "FORM-0001" });
    const rows = extractFormulaVersionStabilityRows(buildInput({ formulationVersions: [version()], stabilityStudies: [draftStudy] }));
    expect(rows[0].studies).toEqual([]);
  });

  it("fails closed on a duplicate sample identity in the supplied pool, pool-wide, regardless of relevance", () => {
    const input = buildInput({
      formulationVersions: [version()],
      stabilityStudies: [study()],
      stabilitySamples: [sample({ id: "S-DUP" }), sample({ id: "S-DUP", sampleCode: "SMP-DUP2" })],
    });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("duplicate_stability_sample_id");
    }
  });

  it("fails closed when a sample's studyId does not resolve to any supplied study, pool-wide", () => {
    const input = buildInput({
      formulationVersions: [version()],
      stabilityStudies: [],
      stabilitySamples: [sample({ id: "S1", studyId: "STUDY-DOES-NOT-EXIST" })],
    });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("stability_sample_study_not_found");
    }
  });

  describe("StabilityCondition/StabilityTimePoint resolution (AUDIT_FVL05_GPT_000007 corrective cycle)", () => {
    it("fails closed on a duplicate condition id in the supplied pool", () => {
      const input = buildInput({
        formulationVersions: [version()],
        stabilityConditions: [condition({ id: "COND-DUP" }), condition({ id: "COND-DUP", code: "DUP2" })],
      });
      try {
        extractFormulaVersionStabilityRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("duplicate_stability_condition_id");
      }
    });

    it("fails closed on a duplicate time point id in the supplied pool", () => {
      const input = buildInput({
        formulationVersions: [version()],
        stabilityTimePoints: [timePoint({ id: "TP-DUP" }), timePoint({ id: "TP-DUP", code: "DUP2" })],
      });
      try {
        extractFormulaVersionStabilityRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("duplicate_stability_time_point_id");
      }
    });

    it("fails closed when a sample's conditionId does not resolve to any supplied condition", () => {
      const input = buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study({ conditionIds: ["COND-GHOST"] })],
        stabilitySamples: [sample({ conditionId: "COND-GHOST" })],
      });
      try {
        extractFormulaVersionStabilityRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("stability_sample_condition_not_found");
      }
    });

    it("fails closed when a sample's timePointId does not resolve to any supplied time point", () => {
      const input = buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study({ timePointIds: ["TP-GHOST"] })],
        stabilitySamples: [sample({ timePointId: "TP-GHOST" })],
      });
      try {
        extractFormulaVersionStabilityRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("stability_sample_time_point_not_found");
      }
    });

    it("fails closed when a sample's conditionId resolves in the pool but is not a member of its own study's conditionIds (study-membership invariant)", () => {
      const outsideCondition = condition({ id: "COND-OUTSIDE" });
      const input = buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study({ conditionIds: ["COND-0001"] })],
        stabilitySamples: [sample({ conditionId: "COND-OUTSIDE" })],
        stabilityConditions: [condition(), outsideCondition],
      });
      try {
        extractFormulaVersionStabilityRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("stability_sample_condition_not_in_study");
        expect((err as FormulaVersionStabilityDatasetExtractionError).sampleId).toBe("SAMPLE-0001");
        expect((err as FormulaVersionStabilityDatasetExtractionError).studyId).toBe("STUDY-0001");
      }
    });

    it("fails closed when a sample's timePointId resolves in the pool but is not a member of its own study's timePointIds (study-membership invariant)", () => {
      const outsideTimePoint = timePoint({ id: "TP-OUTSIDE" });
      const input = buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study({ timePointIds: ["TP-0001"] })],
        stabilitySamples: [sample({ timePointId: "TP-OUTSIDE" })],
        stabilityTimePoints: [timePoint(), outsideTimePoint],
      });
      try {
        extractFormulaVersionStabilityRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("stability_sample_time_point_not_in_study");
        expect((err as FormulaVersionStabilityDatasetExtractionError).sampleId).toBe("SAMPLE-0001");
        expect((err as FormulaVersionStabilityDatasetExtractionError).studyId).toBe("STUDY-0001");
      }
    });

    it("multiple samples in the same study sharing one condition/time point stay deterministic without duplicate/ambiguous lineage", () => {
      const sampleA = sample({ id: "SAMPLE-A", sampleCode: "SMP-A" });
      const sampleB = sample({ id: "SAMPLE-B", sampleCode: "SMP-B" });
      const rows = extractFormulaVersionStabilityRows(
        buildInput({
          formulationVersions: [version()],
          stabilityStudies: [study()],
          stabilitySamples: [sampleA, sampleB],
        }),
      );
      expect(rows[0].studies[0].conditions).toHaveLength(1);
      expect(rows[0].studies[0].timePoints).toHaveLength(1);
      const conditionCitations = rows[0].sourceRecords.filter((r) => r.sourceEntity === "stabilityCondition");
      const timePointCitations = rows[0].sourceRecords.filter((r) => r.sourceEntity === "stabilityTimePoint");
      expect(conditionCitations).toEqual([{ sourceEntity: "stabilityCondition", sourceRecordId: "COND-0001" }]);
      expect(timePointCitations).toEqual([{ sourceEntity: "stabilityTimePoint", sourceRecordId: "TP-0001" }]);
    });

    it("two different studies referencing the same condition/time point cite it exactly once at the row level, but each study's own array still lists it", () => {
      const studyA = study({ id: "STUDY-A", code: "STB-A", createdAt: "2026-01-03T00:00:00.000Z" });
      const studyB = study({ id: "STUDY-B", code: "STB-B", createdAt: "2026-01-04T00:00:00.000Z" });
      const sampleA = sample({ id: "SAMPLE-A", studyId: "STUDY-A" });
      const sampleB = sample({ id: "SAMPLE-B", studyId: "STUDY-B" });
      const rows = extractFormulaVersionStabilityRows(
        buildInput({
          formulationVersions: [version()],
          stabilityStudies: [studyA, studyB],
          stabilitySamples: [sampleA, sampleB],
        }),
      );
      expect(rows[0].studies[0].conditions.map((c) => c.id)).toEqual(["COND-0001"]);
      expect(rows[0].studies[1].conditions.map((c) => c.id)).toEqual(["COND-0001"]);
      const conditionCitations = rows[0].sourceRecords.filter((r) => r.sourceEntity === "stabilityCondition");
      expect(conditionCitations).toEqual([{ sourceEntity: "stabilityCondition", sourceRecordId: "COND-0001" }]);
    });

    it("delimiter-containing and Unicode condition/time-point ids remain unambiguous and deterministic", () => {
      const weirdCondition = condition({ id: "COND:Ω" });
      const weirdTimePoint = timePoint({ id: "TP:α" });
      const weirdStudy = study({ conditionIds: ["COND:Ω"], timePointIds: ["TP:α"] });
      const weirdSample = sample({ conditionId: "COND:Ω", timePointId: "TP:α" });
      const rows = extractFormulaVersionStabilityRows(
        buildInput({
          formulationVersions: [version()],
          stabilityStudies: [weirdStudy],
          stabilitySamples: [weirdSample],
          stabilityConditions: [weirdCondition],
          stabilityTimePoints: [weirdTimePoint],
        }),
      );
      expect(rows[0].studies[0].conditions[0].id).toBe("COND:Ω");
      expect(rows[0].studies[0].timePoints[0].id).toBe("TP:α");
      expect(rows[0].sourceRecords).toContainEqual({ sourceEntity: "stabilityCondition", sourceRecordId: "COND:Ω" });
      expect(rows[0].sourceRecords).toContainEqual({ sourceEntity: "stabilityTimePoint", sourceRecordId: "TP:α" });
    });

    it("reordering the stabilityConditions/stabilityTimePoints pools does not change normalized output", () => {
      const conditionA = condition({ id: "COND-A" });
      const conditionB = condition({ id: "COND-B" });
      const timePointA = timePoint({ id: "TP-A" });
      const timePointB = timePoint({ id: "TP-B" });
      const twoCondStudy = study({ conditionIds: ["COND-A", "COND-B"], timePointIds: ["TP-A", "TP-B"] });
      const sampleA = sample({ id: "SAMPLE-A", conditionId: "COND-A", timePointId: "TP-A" });
      const sampleB = sample({ id: "SAMPLE-B", conditionId: "COND-B", timePointId: "TP-B" });
      const forward = extractFormulaVersionStabilityRows(
        buildInput({
          formulationVersions: [version()],
          stabilityStudies: [twoCondStudy],
          stabilitySamples: [sampleA, sampleB],
          stabilityConditions: [conditionA, conditionB],
          stabilityTimePoints: [timePointA, timePointB],
        }),
      );
      const reversed = extractFormulaVersionStabilityRows(
        buildInput({
          formulationVersions: [version()],
          stabilityStudies: [twoCondStudy],
          stabilitySamples: [sampleB, sampleA],
          stabilityConditions: [conditionB, conditionA],
          stabilityTimePoints: [timePointB, timePointA],
        }),
      );
      expect(forward[0].studies[0].conditions.map((c) => c.id)).toEqual(["COND-A", "COND-B"]);
      expect(reversed[0]).toEqual(forward[0]);
    });

    it("does not let mutating returned nested condition/time-point objects mutate the source fixtures", () => {
      const sourceCondition = condition({ id: "COND-0001", label: "original label" });
      const input = buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sample()],
        stabilityConditions: [sourceCondition],
      });
      const rows = extractFormulaVersionStabilityRows(input);
      (rows[0].studies[0].conditions[0] as { label?: string }).label = "mutated";
      expect(sourceCondition.label).toBe("original label");
    });

    it("does not mutate stabilityConditions/stabilityTimePoints inputs on the new failure paths", () => {
      const conditions = Object.freeze([Object.freeze(condition())]);
      const timePoints = Object.freeze([Object.freeze(timePoint())]);
      const studies = Object.freeze([Object.freeze(study({ conditionIds: ["COND-GHOST"] }))]);
      const samples = Object.freeze([Object.freeze(sample({ conditionId: "COND-GHOST" }))]);
      const formulations = Object.freeze([Object.freeze(formulation())]);
      const versions = Object.freeze([Object.freeze(version())]);
      const snapshotBefore = JSON.parse(JSON.stringify({ formulations, versions, studies, samples, conditions, timePoints }));

      const failingInput: FormulaVersionStabilityDatasetExtractionInput = {
        formulationVersionIds: [versions[0]!.id],
        formulations: [...formulations],
        formulationVersions: [...versions],
        stabilityStudies: [...studies],
        stabilitySamples: [...samples],
        stabilityResults: [],
        stabilityConditions: [...conditions],
        stabilityTimePoints: [...timePoints],
      };
      expect(() => extractFormulaVersionStabilityRows(failingInput)).toThrow(FormulaVersionStabilityDatasetExtractionError);
      expect(JSON.parse(JSON.stringify({ formulations, versions, studies, samples, conditions, timePoints }))).toEqual(snapshotBefore);
    });
  });

  it("fails closed on a duplicate result identity in the supplied pool, pool-wide, regardless of relevance", () => {
    const input = buildInput({
      formulationVersions: [version()],
      stabilityStudies: [study()],
      stabilitySamples: [sample()],
      stabilityResults: [result({ id: "R-DUP" }), result({ id: "R-DUP", performedAt: "2026-01-03T11:00:00.000Z" })],
    });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("duplicate_stability_result_id");
    }
  });

  it("fails closed when a result's sampleId does not resolve to any supplied sample, pool-wide", () => {
    const input = buildInput({
      formulationVersions: [version()],
      stabilityStudies: [],
      stabilitySamples: [],
      stabilityResults: [result({ id: "R1", sampleId: "SAMPLE-DOES-NOT-EXIST" })],
    });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("stability_result_sample_not_found");
    }
  });

  it("fails closed when a result's studyId contradicts its resolved sample's studyId", () => {
    const otherStudy = study({ id: "STUDY-OTHER", code: "STB-OTHER" });
    const input = buildInput({
      formulationVersions: [version()],
      stabilityStudies: [study(), otherStudy],
      stabilitySamples: [sample()],
      stabilityResults: [result({ studyId: "STUDY-OTHER" })],
    });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("stability_result_sample_conflict");
    }
  });

  it("fails closed when a result's conditionId contradicts its resolved sample's conditionId", () => {
    const input = buildInput({
      formulationVersions: [version()],
      stabilityStudies: [study()],
      stabilitySamples: [sample()],
      stabilityResults: [result({ conditionId: "COND-OTHER" })],
    });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("stability_result_sample_conflict");
    }
  });

  it("fails closed when a result's timePointId contradicts its resolved sample's timePointId", () => {
    const input = buildInput({
      formulationVersions: [version()],
      stabilityStudies: [study()],
      stabilitySamples: [sample()],
      stabilityResults: [result({ timePointId: "TP-OTHER" })],
    });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("stability_result_sample_conflict");
    }
  });

  it("fails closed on a study with a createdAt value that is not the canonical toISOString() format", () => {
    const input = buildInput({ formulationVersions: [version()], stabilityStudies: [study({ createdAt: "2026-01-03 00:00:00" })] });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("invalid_timestamp_format");
    }
  });

  it("fails closed on a sample with a createdAt value that is not the canonical toISOString() format", () => {
    const input = buildInput({
      formulationVersions: [version()],
      stabilityStudies: [study()],
      stabilitySamples: [sample({ createdAt: "2026-01-03 00:00:00" })],
    });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("invalid_timestamp_format");
    }
  });

  it("fails closed on a result with a performedAt value that is not the canonical toISOString() format", () => {
    const input = buildInput({
      formulationVersions: [version()],
      stabilityStudies: [study()],
      stabilitySamples: [sample()],
      stabilityResults: [result({ performedAt: "not-a-real-timestamp" })],
    });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("invalid_timestamp_format");
    }
  });

  it("fails closed, and emits nothing, when a constructed row would fail its own schema (malformed source data)", () => {
    const input = buildInput({ formulationVersions: [version()], formulations: [formulation({ code: "   " })] });
    try {
      extractFormulaVersionStabilityRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("row_schema_validation_failed");
    }
  });

  it("does not mutate its inputs, including on a failure path", () => {
    const studies = Object.freeze([Object.freeze(study())]);
    const samples = Object.freeze([Object.freeze(sample())]);
    const results = Object.freeze([Object.freeze(result())]);
    const formulations = Object.freeze([Object.freeze(formulation())]);
    const versions = Object.freeze([Object.freeze(version())]);
    const conditions = Object.freeze([Object.freeze(condition())]);
    const timePoints = Object.freeze([Object.freeze(timePoint())]);
    const snapshotBefore = JSON.parse(JSON.stringify({ formulations, versions, studies, samples, results, conditions, timePoints }));

    expect(() =>
      extractFormulaVersionStabilityRows({
        formulationVersionIds: [versions[0]!.id],
        formulations: [...formulations],
        formulationVersions: [...versions],
        stabilityStudies: [...studies],
        stabilitySamples: [...samples],
        stabilityResults: [...results],
        stabilityConditions: [...conditions],
        stabilityTimePoints: [...timePoints],
      }),
    ).not.toThrow();

    const failingInput: FormulaVersionStabilityDatasetExtractionInput = {
      formulationVersionIds: ["VER-BAD"],
      formulations: [...formulations],
      formulationVersions: [version({ id: "VER-BAD" }), version({ id: "VER-BAD", versionNumber: 2 })],
      stabilityStudies: [...studies],
      stabilitySamples: [...samples],
      stabilityResults: [...results],
      stabilityConditions: [...conditions],
      stabilityTimePoints: [...timePoints],
    };
    expect(() => extractFormulaVersionStabilityRows(failingInput)).toThrow(FormulaVersionStabilityDatasetExtractionError);

    expect(JSON.parse(JSON.stringify({ formulations, versions, studies, samples, results, conditions, timePoints }))).toEqual(snapshotBefore);
  });

  it("does not let mutating returned nested output mutate the source fixtures", () => {
    const sourceResult = result({ id: "R1", notes: "original" });
    const input = buildInput({
      formulationVersions: [version()],
      stabilityStudies: [study()],
      stabilitySamples: [sample()],
      stabilityResults: [sourceResult],
    });
    const rows = extractFormulaVersionStabilityRows(input);

    (rows[0].studies[0].samples[0].results[0] as { notes?: string }).notes = "mutated";
    rows[0].studies[0].samples[0].results[0].replicates.push({ replicateNumber: 99, isOutlier: false });

    expect(sourceResult.notes).toBe("original");
    expect(sourceResult.replicates).toEqual([]);
  });

  it("is deterministic: repeated extraction on identical inputs produces deeply equal results", () => {
    const input = buildInput({
      formulationVersions: [version()],
      stabilityStudies: [study()],
      stabilitySamples: [sample()],
      stabilityResults: [result()],
    });
    const first = extractFormulaVersionStabilityRows(input);
    const second = extractFormulaVersionStabilityRows(input);
    expect(first).toEqual(second);
  });

  it("preserves the exact payload through JSON serialization and parsing, and the row schema accepts it", () => {
    const rows = extractFormulaVersionStabilityRows(
      buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sample()],
        stabilityResults: [result()],
      }),
    );
    const roundTripped = JSON.parse(JSON.stringify(rows[0]));
    expect(roundTripped).toEqual(rows[0]);
    expect(formulaVersionStabilityRowSchema.safeParse(roundTripped).success).toBe(true);
    expect(roundTripped.datasetSchemaVersion).toBe(DATASET_SCHEMA_VERSION);
  });

  it("rejects a payload missing mandatory identity fields via the schema, and rejects a non-row payload", () => {
    const rows = extractFormulaVersionStabilityRows(buildInput({ formulationVersions: [version()] }));
    const { formulaVersionId, ...withoutVersionId } = rows[0];
    expect(formulaVersionStabilityRowSchema.safeParse(withoutVersionId).success).toBe(false);
    expect(formulaVersionStabilityRowSchema.safeParse({ not: "a row" }).success).toBe(false);
    void formulaVersionId;
  });

  it("is available from the shared package's public export path", () => {
    const rows = extractFromPublicEntryPoint(buildInput({ formulationVersions: [version()] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].formulaVersionId).toBe("VER-0001");
  });

  describe("global sample/result identity (no parent-scoped lineage)", () => {
    it("two different studies may each hold samples — samples never collide because StabilitySample.id is a genuinely global identity, never needing parentRecordId", () => {
      const studyA = study({ id: "STUDY-A", code: "STB-A", createdAt: "2026-01-03T00:00:00.000Z" });
      const studyB = study({ id: "STUDY-B", code: "STB-B", createdAt: "2026-01-04T00:00:00.000Z" });
      const sampleA = sample({ id: "SAMPLE-A", studyId: "STUDY-A" });
      const sampleB = sample({ id: "SAMPLE-B", studyId: "STUDY-B" });
      const rows = extractFormulaVersionStabilityRows(
        buildInput({
          formulationVersions: [version()],
          stabilityStudies: [studyA, studyB],
          stabilitySamples: [sampleA, sampleB],
        }),
      );
      const citations = rows[0].sourceRecords.filter((r) => r.sourceEntity === "stabilitySample");
      expect(citations).toHaveLength(2);
      expect(citations).toContainEqual({ sourceEntity: "stabilitySample", sourceRecordId: "SAMPLE-A" });
      expect(citations).toContainEqual({ sourceEntity: "stabilitySample", sourceRecordId: "SAMPLE-B" });
      for (const citation of citations) {
        expect(citation.parentRecordId).toBeUndefined();
      }
      const conditionCitations = rows[0].sourceRecords.filter((r) => r.sourceEntity === "stabilityCondition");
      for (const citation of conditionCitations) {
        expect(citation.parentRecordId).toBeUndefined();
      }
    });

    it("delimiter-containing and Unicode study/sample/result ids remain unambiguous and deterministic", () => {
      const studyA = study({ id: "A:B", createdAt: "2026-01-03T00:00:00.000Z" });
      const sampleA = sample({ id: "C:D", studyId: "A:B" });
      const resultA = result({ id: "E:F", sampleId: "C:D", studyId: "A:B" });
      const rows = extractFormulaVersionStabilityRows(
        buildInput({
          formulationVersions: [version()],
          stabilityStudies: [studyA],
          stabilitySamples: [sampleA],
          stabilityResults: [resultA],
        }),
      );
      expect(rows[0].studies[0].samples[0].results[0].id).toBe("E:F");
      expect(rows[0].sourceRecords).toContainEqual({ sourceEntity: "stabilityResult", sourceRecordId: "E:F" });

      const studyOmega = study({ id: "STUDY-Ω", createdAt: "2026-01-03T00:00:00.000Z" });
      const studyAlpha = study({ id: "STUDY-α", createdAt: "2026-01-03T00:00:00.000Z" });
      const forward = extractFormulaVersionStabilityRows(
        buildInput({ formulationVersions: [version()], stabilityStudies: [studyOmega, studyAlpha] }),
      );
      const reversed = extractFormulaVersionStabilityRows(
        buildInput({ formulationVersions: [version()], stabilityStudies: [studyAlpha, studyOmega] }),
      );
      expect(forward).toEqual(reversed);
    });
  });

  describe("ordinal (locale-independent) ordering", () => {
    it("ordering is environment-independent ordinal comparison, not locale-collation-aware — proven on a case pair where the two disagree", () => {
      expect("a".localeCompare("B")).toBeLessThan(0);
      expect("a" > "B").toBe(true);

      const results = [
        result({ id: "a-result", performedAt: "2026-01-03T10:00:00.000Z" }),
        result({ id: "B-result", performedAt: "2026-01-03T10:00:00.000Z" }),
      ];
      const rows = extractFormulaVersionStabilityRows(
        buildInput({
          formulationVersions: [version()],
          stabilityStudies: [study()],
          stabilitySamples: [sample()],
          stabilityResults: results,
        }),
      );
      expect(rows[0].studies[0].samples[0].results.map((r) => r.id)).toEqual(["B-result", "a-result"]);
    });
  });

  describe("dataset schema version + canonical schema reuse", () => {
    it("VERSION: DATASET_SCHEMA_VERSION reflects the corrective-cycle bump this task's new condition/time-point fields required, shared with every other FVL-05 row type", () => {
      const rows = extractFormulaVersionStabilityRows(buildInput({ formulationVersions: [version()] }));
      expect(rows[0].datasetSchemaVersion).toBe(DATASET_SCHEMA_VERSION);
      expect(formulaVersionStabilityRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.0" }).success).toBe(false);
      expect(formulaVersionStabilityRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.1" }).success).toBe(false);
      expect(formulaVersionStabilityRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.2" }).success).toBe(false);
      expect(formulaVersionStabilityRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.3" }).success).toBe(false);
      expect(formulaVersionStabilityRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.4" }).success).toBe(false);
      expect(formulaVersionStabilityRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.5" }).success).toBe(false);
    });

    it("PARITY: the embedded sample/result/condition/time-point element schemas are the literal same schema objects as the canonical source — never re-modeled copies", () => {
      expect(stabilitySampleResultsSchema.shape.sample).toBe(stabilitySampleSchema);
      expect(stabilitySampleResultsSchema.shape.results.element).toBe(stabilityResultSchema);
      expect(stabilityStudySamplesSchema.shape.conditions.element).toBe(stabilityConditionSchema);
      expect(stabilityStudySamplesSchema.shape.timePoints.element).toBe(stabilityTimePointSchema);
    });
  });

  describe("revisesResultId referential integrity (StabilityResult has no retestOf field)", () => {
    it("a valid revisesResultId chain (same sample) still passes and both records are fully preserved", () => {
      const original = result({ id: "R1", performedAt: "2026-01-03T10:00:00.000Z" });
      const revision = result({ id: "R2", performedAt: "2026-01-03T11:00:00.000Z", revisesResultId: "R1" });
      const rows = extractFormulaVersionStabilityRows(
        buildInput({
          formulationVersions: [version()],
          stabilityStudies: [study()],
          stabilitySamples: [sample()],
          stabilityResults: [revision, original],
        }),
      );
      expect(rows[0].studies[0].samples[0].results.map((r) => r.id)).toEqual(["R1", "R2"]);
      expect(rows[0].studies[0].samples[0].results[1].revisesResultId).toBe("R1");
    });

    it("a dangling revisesResultId fails closed", () => {
      const input = buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sample()],
        stabilityResults: [result({ id: "R1", revisesResultId: "R-GHOST" })],
      });
      try {
        extractFormulaVersionStabilityRows(input);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(FormulaVersionStabilityDatasetExtractionError);
        expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("dangling_stability_result_revision_reference");
        expect((err as FormulaVersionStabilityDatasetExtractionError).resultId).toBe("R1");
      }
    });

    it("a cross-sample revisesResultId fails closed — no source evidence proves cross-sample revision linkage is legitimate (a sample is tested once then disposed)", () => {
      const sampleA = sample({ id: "SAMPLE-A", createdAt: "2026-01-03T00:00:00.000Z" });
      const sampleB = sample({ id: "SAMPLE-B", createdAt: "2026-01-04T00:00:00.000Z" });
      const original = result({ id: "R1", sampleId: "SAMPLE-A" });
      const revision = result({ id: "R2", sampleId: "SAMPLE-B", revisesResultId: "R1", performedAt: "2026-01-04T10:00:00.000Z" });
      const input = buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sampleA, sampleB],
        stabilityResults: [original, revision],
      });
      try {
        extractFormulaVersionStabilityRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("cross_sample_stability_result_revision_reference");
        expect((err as FormulaVersionStabilityDatasetExtractionError).resultId).toBe("R2");
        expect((err as FormulaVersionStabilityDatasetExtractionError).sampleId).toBe("SAMPLE-B");
      }
    });

    it("a self-revising result fails closed", () => {
      const input = buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sample()],
        stabilityResults: [result({ id: "R1", revisesResultId: "R1" })],
      });
      try {
        extractFormulaVersionStabilityRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("stability_result_revision_cycle_detected");
        expect((err as FormulaVersionStabilityDatasetExtractionError).resultId).toBe("R1");
      }
    });

    it("a longer revisesResultId cycle (length 2) fails closed", () => {
      const input = buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sample()],
        stabilityResults: [
          result({ id: "R1", performedAt: "2026-01-03T10:00:00.000Z", revisesResultId: "R2" }),
          result({ id: "R2", performedAt: "2026-01-03T11:00:00.000Z", revisesResultId: "R1" }),
        ],
      });
      expect(() => extractFormulaVersionStabilityRows(input)).toThrow(FormulaVersionStabilityDatasetExtractionError);
      try {
        extractFormulaVersionStabilityRows(input);
      } catch (err) {
        expect((err as FormulaVersionStabilityDatasetExtractionError).code).toBe("stability_result_revision_cycle_detected");
      }
    });

    it("does not mutate its inputs on any of the new referential-integrity failure paths", () => {
      const studies = Object.freeze([Object.freeze(study())]);
      const samples = Object.freeze([Object.freeze(sample())]);
      const results = Object.freeze([Object.freeze(result({ id: "R1", revisesResultId: "R-GHOST" }))]);
      const formulations = Object.freeze([Object.freeze(formulation())]);
      const versions = Object.freeze([Object.freeze(version())]);
      const snapshotBefore = JSON.parse(JSON.stringify({ formulations, versions, studies, samples, results }));

      const failingInput: FormulaVersionStabilityDatasetExtractionInput = {
        formulationVersionIds: [versions[0]!.id],
        formulations: [...formulations],
        formulationVersions: [...versions],
        stabilityStudies: [...studies],
        stabilitySamples: [...samples],
        stabilityResults: [...results],
        stabilityConditions: [condition()],
        stabilityTimePoints: [timePoint()],
      };
      expect(() => extractFormulaVersionStabilityRows(failingInput)).toThrow(FormulaVersionStabilityDatasetExtractionError);
      expect(JSON.parse(JSON.stringify({ formulations, versions, studies, samples, results }))).toEqual(snapshotBefore);
    });

    it("reordering the stabilityResults input does not change whether a cycle is detected", () => {
      const cyclicResults = [
        result({ id: "R1", performedAt: "2026-01-03T10:00:00.000Z", revisesResultId: "R2" }),
        result({ id: "R2", performedAt: "2026-01-03T11:00:00.000Z", revisesResultId: "R1" }),
      ];
      const forward = buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sample()],
        stabilityResults: cyclicResults,
      });
      const backward = buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study()],
        stabilitySamples: [sample()],
        stabilityResults: [...cyclicResults].reverse(),
      });
      expect(() => extractFormulaVersionStabilityRows(forward)).toThrow(FormulaVersionStabilityDatasetExtractionError);
      expect(() => extractFormulaVersionStabilityRows(backward)).toThrow(FormulaVersionStabilityDatasetExtractionError);
    });
  });
});
