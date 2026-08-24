import { describe, expect, it } from "vitest";
import {
  FormulaVersionDoeDatasetExtractionError,
  extractFormulaVersionDoeRows,
  type FormulaVersionDoeDatasetExtractionInput,
} from "./formulaVersionDoeDatasetExtractor";
import {
  DATASET_SCHEMA_VERSION,
  doeDesignRunsSchema,
  doeRunObservationsSchema,
  formulaVersionDoeRowSchema,
} from "../schemas/dataset";
import { extractFormulaVersionDoeRows as extractFromPublicEntryPoint } from "../index";
import { doeDesignSchema, doeObservationSchema, doeRunSchema } from "../schemas/doe";
import type { Formulation, FormulationVersion } from "../schemas/formulation";
import type { DoeDesign, DoeDesignDiagnostics, DoeObservation, DoeRun, DoeStudy } from "../schemas/doe";

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

function study(over: Partial<DoeStudy> = {}): DoeStudy {
  return {
    schemaVersion: "1.0",
    id: "STUDY-0001",
    studyCode: "DOE-0001",
    title: "Study 1",
    projectId: "FORM-0001",
    formulationId: "FORM-0001",
    baselineFormulaVersionId: "VER-0001",
    status: "runs_generated",
    designType: "full_factorial",
    randomizationEnabled: true,
    blockingEnabled: false,
    replicatePolicy: "none",
    centerPointPolicy: "none",
    revision: 1,
    createdBy: "local",
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    ...over,
  };
}

const diagnostics: DoeDesignDiagnostics = {
  runCount: 1,
  degreesOfFreedom: 0,
  duplicateRunCount: 0,
  estimableTerms: [],
  aliasedTerms: [],
  isOrthogonal: true,
  isBalanced: true,
  centerPointCount: 0,
  replicateCount: 0,
  constraintViolationCount: 0,
  warnings: [],
};

function response(over: Partial<DoeDesign["responseSnapshot"][number]> = {}) {
  return {
    schemaVersion: "1.0" as const,
    id: "RESP-0001",
    studyId: "STUDY-0001",
    studyRevision: 1,
    responseCode: "VISC",
    name: "Viscosity",
    responseType: "continuous" as const,
    objective: "target" as const,
    weight: "1",
    desirabilityShape: "linear" as const,
    createdAt: "2026-01-03T00:00:00.000Z",
    ...over,
  };
}

function factor(over: Partial<DoeDesign["factorSnapshot"][number]> = {}) {
  return {
    schemaVersion: "1.0" as const,
    id: "FACTOR-0001",
    studyId: "STUDY-0001",
    studyRevision: 1,
    factorCode: "TEMP",
    name: "Temperature",
    factorType: "continuous" as const,
    sourceType: "process_parameter" as const,
    categoricalLevels: [],
    transformation: "none" as const,
    precision: 2,
    isMixtureComponent: false,
    isProcessFactor: true,
    isControlled: true,
    createdAt: "2026-01-03T00:00:00.000Z",
    ...over,
  };
}

function design(over: Partial<DoeDesign> = {}): DoeDesign {
  return {
    schemaVersion: "1.0",
    id: "DESIGN-0001",
    studyId: "STUDY-0001",
    studyRevision: 1,
    designType: "full_factorial",
    factorSnapshot: [factor()],
    constraintSnapshot: [],
    responseSnapshot: [response()],
    generationSettings: {},
    seed: 42,
    runCount: 1,
    replicateCount: 0,
    centerPointCount: 0,
    blockCount: 1,
    generatedBy: "local",
    generatedAt: "2026-01-03T01:00:00.000Z",
    diagnostics,
    ...over,
  };
}

function run(over: Partial<DoeRun> = {}): DoeRun {
  return {
    schemaVersion: "1.0",
    id: "RUN-0001",
    studyId: "STUDY-0001",
    studyRevision: 1,
    designId: "DESIGN-0001",
    runNumber: 1,
    standardOrder: 1,
    randomizedOrder: 1,
    block: 1,
    replicate: 1,
    isCenterPoint: false,
    factorSettings: [{ factorCode: "TEMP", codedValue: "-1", actualValue: "20" }],
    status: "planned",
    createdAt: "2026-01-03T02:00:00.000Z",
    ...over,
  };
}

function observation(over: Partial<DoeObservation> = {}): DoeObservation {
  return {
    schemaVersion: "1.0",
    id: "OBS-0001",
    studyId: "STUDY-0001",
    studyRevision: 1,
    runId: "RUN-0001",
    responseId: "RESP-0001",
    value: "4.5",
    status: "recorded",
    recordedBy: "alice",
    recordedAt: "2026-01-03T10:00:00.000Z",
    ...over,
  };
}

function buildInput(
  over: Partial<FormulaVersionDoeDatasetExtractionInput> & { formulationVersions: FormulationVersion[] },
): FormulaVersionDoeDatasetExtractionInput {
  return {
    formulationVersionIds: over.formulationVersions.map((v) => v.id),
    formulations: [formulation()],
    doeStudies: [],
    doeDesigns: [],
    doeRuns: [],
    doeObservations: [],
    ...over,
  };
}

describe("extractFormulaVersionDoeRows", () => {
  it("emits one schema-valid dataset row for one formula version with no linked studies", () => {
    const rows = extractFormulaVersionDoeRows(buildInput({ formulationVersions: [version()] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].studies).toEqual([]);
    expect(formulaVersionDoeRowSchema.safeParse(rows[0]).success).toBe(true);
  });

  it("emits one study with one design, one run, and one observation", () => {
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [design()],
        doeRuns: [run()],
        doeObservations: [observation()],
      }),
    );
    expect(rows[0].studies).toHaveLength(1);
    expect(rows[0].studies[0].studyId).toBe("STUDY-0001");
    expect(rows[0].studies[0].studyRevision).toBe(1);
    expect(rows[0].studies[0].designs).toHaveLength(1);
    expect(rows[0].studies[0].designs[0].design.id).toBe("DESIGN-0001");
    expect(rows[0].studies[0].designs[0].runs).toHaveLength(1);
    expect(rows[0].studies[0].designs[0].runs[0].run.id).toBe("RUN-0001");
    expect(rows[0].studies[0].designs[0].runs[0].observations).toHaveLength(1);
    expect(rows[0].studies[0].designs[0].runs[0].observations[0].id).toBe("OBS-0001");
  });

  it("emits multiple runs with deterministic domain ordering (standardOrder then id) independent of input array order", () => {
    const runs = [
      run({ id: "RUN-3", runNumber: 3, standardOrder: 3, randomizedOrder: 1 }),
      run({ id: "RUN-1", runNumber: 1, standardOrder: 1, randomizedOrder: 3 }),
      run({ id: "RUN-2", runNumber: 2, standardOrder: 2, randomizedOrder: 2 }),
    ];
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [design({ runCount: 3 })],
        doeRuns: runs,
      }),
    );
    expect(rows[0].studies[0].designs[0].runs.map((r) => r.run.id)).toEqual(["RUN-1", "RUN-2", "RUN-3"]);
  });

  it("preserves replicate/block/center-point fields exactly", () => {
    const richRun = run({ id: "R1", block: 2, replicate: 3, isCenterPoint: true });
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [design()],
        doeRuns: [richRun],
      }),
    );
    const emitted = rows[0].studies[0].designs[0].runs[0].run;
    expect(emitted.block).toBe(2);
    expect(emitted.replicate).toBe(3);
    expect(emitted.isCenterPoint).toBe(true);
  });

  it("preserves run factorSettings exactly, including codedValue vs actualValue", () => {
    const richRun = run({ factorSettings: [{ factorCode: "TEMP", codedValue: "1", actualValue: "80.5" }] });
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [design()],
        doeRuns: [richRun],
      }),
    );
    expect(rows[0].studies[0].designs[0].runs[0].run.factorSettings).toEqual([
      { factorCode: "TEMP", codedValue: "1", actualValue: "80.5" },
    ]);
  });

  it("emits multiple observations on one run for different responses", () => {
    const twoResponses = design({ responseSnapshot: [response({ id: "RESP-1" }), response({ id: "RESP-2" })] });
    const observations = [
      observation({ id: "OBS-1", responseId: "RESP-1", value: "4.5" }),
      observation({ id: "OBS-2", responseId: "RESP-2", value: "9.9" }),
    ];
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [twoResponses],
        doeRuns: [run()],
        doeObservations: observations,
      }),
    );
    expect(rows[0].studies[0].designs[0].runs[0].observations.map((o) => o.responseId)).toEqual(["RESP-1", "RESP-2"]);
  });

  it("preserves an explicit zero numeric observation value", () => {
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [design()],
        doeRuns: [run()],
        doeObservations: [observation({ value: "0" })],
      }),
    );
    expect(rows[0].studies[0].designs[0].runs[0].observations[0].value).toBe("0");
  });

  it("preserves text/categorical/pass-fail observation representation exactly", () => {
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [design()],
        doeRuns: [run()],
        doeObservations: [observation({ value: undefined, textValue: "fail — visible phase separation" })],
      }),
    );
    expect(rows[0].studies[0].designs[0].runs[0].observations[0].textValue).toBe("fail — visible phase separation");
    expect(rows[0].studies[0].designs[0].runs[0].observations[0].value).toBeUndefined();
  });

  it("preserves an explicit persisted status: 'missing' observation, distinguished from no observation record existing at all", () => {
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [design()],
        doeRuns: [run()],
        doeObservations: [observation({ value: undefined, status: "missing" })],
      }),
    );
    expect(rows[0].studies[0].designs[0].runs[0].observations).toHaveLength(1);
    expect(rows[0].studies[0].designs[0].runs[0].observations[0].status).toBe("missing");
  });

  it("a run with no observation for a response stays honestly empty, never fabricating a zero/null row", () => {
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [design()],
        doeRuns: [run()],
        doeObservations: [],
      }),
    );
    expect(rows[0].studies[0].designs[0].runs[0].observations).toEqual([]);
  });

  it("preserves excluded/outlier observation status and exclusion metadata exactly", () => {
    const excluded = observation({
      status: "excluded",
      excludedAt: "2026-01-04T00:00:00.000Z",
      exclusionReason: "Contaminated sample",
    });
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [design()],
        doeRuns: [run()],
        doeObservations: [excluded],
      }),
    );
    const emitted = rows[0].studies[0].designs[0].runs[0].observations[0];
    expect(emitted.status).toBe("excluded");
    expect(emitted.excludedAt).toBe("2026-01-04T00:00:00.000Z");
    expect(emitted.exclusionReason).toBe("Contaminated sample");
  });

  it("preserves sourceTrialId/sourceTestResultId verbatim (never resolved — no current writer sets them)", () => {
    const linked = observation({ sourceTrialId: "TRIAL-GHOST", sourceTestResultId: "RESULT-GHOST" });
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [design()],
        doeRuns: [run()],
        doeObservations: [linked],
      }),
    );
    const emitted = rows[0].studies[0].designs[0].runs[0].observations[0];
    expect(emitted.sourceTrialId).toBe("TRIAL-GHOST");
    expect(emitted.sourceTestResultId).toBe("RESULT-GHOST");
  });

  it("preserves a run's linkedTrialId verbatim without requiring it to resolve anywhere (out of this task's title scope)", () => {
    const linkedRun = run({ linkedTrialId: "TRIAL-GHOST" });
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [design()],
        doeRuns: [linkedRun],
      }),
    );
    expect(rows[0].studies[0].designs[0].runs[0].run.linkedTrialId).toBe("TRIAL-GHOST");
  });

  it("no observation from another run/study/revision leaks into a row", () => {
    const studyA = study({ id: "STUDY-A" });
    const studyB = study({ id: "STUDY-B", baselineFormulaVersionId: "VER-OTHER" });
    const designA = design({ id: "DESIGN-A", studyId: "STUDY-A" });
    const designB = design({ id: "DESIGN-B", studyId: "STUDY-B" });
    const runA = run({ id: "RUN-A", studyId: "STUDY-A", designId: "DESIGN-A" });
    const runB = run({ id: "RUN-B", studyId: "STUDY-B", designId: "DESIGN-B" });
    const obsA = observation({ id: "OBS-A", studyId: "STUDY-A", runId: "RUN-A" });
    const obsB = observation({ id: "OBS-B", studyId: "STUDY-B", runId: "RUN-B" });
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version(), version({ id: "VER-OTHER" })],
        formulations: [formulation()],
        doeStudies: [studyA, studyB],
        doeDesigns: [designA, designB],
        doeRuns: [runA, runB],
        doeObservations: [obsA, obsB],
      }),
    );
    const rowForVersion1 = rows.find((r) => r.formulaVersionId === "VER-0001")!;
    expect(rowForVersion1.studies.map((s) => s.studyId)).toEqual(["STUDY-A"]);
    expect(rowForVersion1.studies[0].designs[0].runs[0].observations.map((o) => o.id)).toEqual(["OBS-A"]);
  });

  it("emits multiple DOE studies (revisions) tied to the same baseline version, ordered by createdAt/id", () => {
    const original = study({ id: "STUDY-1", revision: 1, createdAt: "2026-01-03T00:00:00.000Z" });
    const revised = study({
      id: "STUDY-2",
      revision: 2,
      createdAt: "2026-01-04T00:00:00.000Z",
      supersedesStudyId: "STUDY-1",
    });
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [revised, original],
      }),
    );
    expect(rows[0].studies.map((s) => s.studyId)).toEqual(["STUDY-1", "STUDY-2"]);
    expect(rows[0].studies[1].supersedesStudyId).toBe("STUDY-1");
  });

  it("emits multiple designs for one study, ordered by generatedAt then id, each with its own runs (a superseded design's runs are not dropped)", () => {
    const designOld = design({ id: "DESIGN-OLD", generatedAt: "2026-01-03T01:00:00.000Z" });
    const designNew = design({ id: "DESIGN-NEW", generatedAt: "2026-01-03T02:00:00.000Z", supersedesDesignId: "DESIGN-OLD" });
    const runOld = run({ id: "RUN-OLD", designId: "DESIGN-OLD" });
    const runNew = run({ id: "RUN-NEW", designId: "DESIGN-NEW" });
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [designNew, designOld],
        doeRuns: [runNew, runOld],
      }),
    );
    expect(rows[0].studies[0].designs.map((d) => d.design.id)).toEqual(["DESIGN-OLD", "DESIGN-NEW"]);
    expect(rows[0].studies[0].designs[0].runs.map((r) => r.run.id)).toEqual(["RUN-OLD"]);
    expect(rows[0].studies[0].designs[1].runs.map((r) => r.run.id)).toEqual(["RUN-NEW"]);
  });

  it("emits one row per requested identity, including a duplicate-requested version id twice in order", () => {
    const rows = extractFormulaVersionDoeRows(
      buildInput({ formulationVersionIds: ["VER-0001", "VER-0001"], formulationVersions: [version()] }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(rows[1]);
  });

  it("fails closed when a requested formula version id is not found", () => {
    const input = buildInput({ formulationVersionIds: ["VER-GHOST"], formulationVersions: [version()] });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionDoeDatasetExtractionError);
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("formula_version_not_found");
    }
  });

  it("fails closed on duplicate/ambiguous exact formula version identities", () => {
    const input = buildInput({ formulationVersions: [version(), version()] });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("duplicate_formula_version_id");
    }
  });

  it("fails closed on duplicate/ambiguous exact owning-formulation identities", () => {
    const input = buildInput({ formulationVersions: [version()], formulations: [formulation(), formulation()] });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("duplicate_formulation_id");
    }
  });

  it("fails closed when a formula version references a formula that was not supplied", () => {
    const input = buildInput({ formulationVersions: [version({ formulationId: "FORM-GHOST" })] });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("formulation_not_found");
    }
  });

  it("fails closed on duplicate/ambiguous exact study identities in the supplied pool", () => {
    const input = buildInput({ formulationVersions: [version()], doeStudies: [study(), study()] });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("duplicate_doe_study_id");
    }
  });

  it("fails closed on a study whose baselineFormulaVersionId matches but whose formulationId does not resolve to the owning formulation (conflicting link)", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study({ formulationId: "FORM-OTHER" })],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("doe_study_formula_link_conflict");
      expect((err as FormulaVersionDoeDatasetExtractionError).studyId).toBe("STUDY-0001");
    }
  });

  it("fails closed on a study with a createdAt value that is not the canonical toISOString() format", () => {
    const input = buildInput({ formulationVersions: [version()], doeStudies: [study({ createdAt: "2026-01-03" })] });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("invalid_timestamp_format");
    }
  });

  it("fails closed on a dangling supersedesStudyId", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study({ supersedesStudyId: "STUDY-GHOST" })],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("dangling_doe_study_supersession_reference");
    }
  });

  it("fails closed on a self-superseding study", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study({ supersedesStudyId: "STUDY-0001" })],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("doe_study_supersession_cycle_detected");
    }
  });

  it("fails closed on a longer supersedesStudyId cycle (length 2)", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [
        study({ id: "STUDY-1", supersedesStudyId: "STUDY-2" }),
        study({ id: "STUDY-2", supersedesStudyId: "STUDY-1" }),
      ],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("doe_study_supersession_cycle_detected");
    }
  });

  it("fails closed on duplicate/ambiguous exact design identities in the supplied pool, pool-wide", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study()],
      doeDesigns: [design(), design()],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("duplicate_doe_design_id");
    }
  });

  it("fails closed when a design's studyId does not resolve to any supplied study, pool-wide", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [],
      doeDesigns: [design()],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("doe_design_study_not_found");
    }
  });

  it("fails closed when a design's studyRevision contradicts its resolved study's own revision", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study({ revision: 1 })],
      doeDesigns: [design({ studyRevision: 2 })],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("doe_design_study_conflict");
    }
  });

  it("fails closed on a design with a generatedAt value that is not the canonical toISOString() format", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study()],
      doeDesigns: [design({ generatedAt: "not-a-date" })],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("invalid_timestamp_format");
    }
  });

  it("fails closed on a dangling supersedesDesignId", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study()],
      doeDesigns: [design({ supersedesDesignId: "DESIGN-GHOST" })],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("dangling_doe_design_supersession_reference");
    }
  });

  it("fails closed on a self-superseding design", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study()],
      doeDesigns: [design({ supersedesDesignId: "DESIGN-0001" })],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("doe_design_supersession_cycle_detected");
    }
  });

  it("fails closed on duplicate/ambiguous exact run identities in the supplied pool, pool-wide", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study()],
      doeDesigns: [design()],
      doeRuns: [run(), run()],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("duplicate_doe_run_id");
    }
  });

  it("fails closed when a run's designId does not resolve to any supplied design, pool-wide", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study()],
      doeDesigns: [],
      doeRuns: [run()],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("doe_run_design_not_found");
    }
  });

  it("fails closed when a run's studyId contradicts its resolved design's studyId", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study(), study({ id: "STUDY-OTHER", studyCode: "DOE-OTHER" })],
      doeDesigns: [design()],
      doeRuns: [run({ studyId: "STUDY-OTHER" })],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("doe_run_design_conflict");
    }
  });

  it("fails closed when a run's studyRevision contradicts its resolved design's studyRevision", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study()],
      doeDesigns: [design()],
      doeRuns: [run({ studyRevision: 2 })],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("doe_run_design_conflict");
    }
  });

  it("fails closed when a run's linkedFormulaVersionId does not resolve to any supplied formulation version", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study()],
      doeDesigns: [design()],
      doeRuns: [run({ linkedFormulaVersionId: "VER-GHOST" })],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("doe_run_linked_formula_version_not_found");
    }
  });

  it("a run's linkedFormulaVersionId that resolves within the supplied formulation versions is preserved and accepted", () => {
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [design()],
        doeRuns: [run({ linkedFormulaVersionId: "VER-0001", linkedTrialId: "TRIAL-1" })],
      }),
    );
    expect(rows[0].studies[0].designs[0].runs[0].run.linkedFormulaVersionId).toBe("VER-0001");
  });

  it("fails closed on duplicate/ambiguous exact observation identities in the supplied pool, pool-wide", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study()],
      doeDesigns: [design()],
      doeRuns: [run()],
      doeObservations: [observation(), observation()],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("duplicate_doe_observation_id");
    }
  });

  it("fails closed when an observation's runId does not resolve to any supplied run, pool-wide", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study()],
      doeDesigns: [design()],
      doeRuns: [],
      doeObservations: [observation()],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("doe_observation_run_not_found");
    }
  });

  it("fails closed when an observation's studyId contradicts its resolved run's studyId", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study(), study({ id: "STUDY-OTHER", studyCode: "DOE-OTHER" })],
      doeDesigns: [design()],
      doeRuns: [run()],
      doeObservations: [observation({ studyId: "STUDY-OTHER" })],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("doe_observation_run_conflict");
    }
  });

  it("fails closed when an observation's studyRevision contradicts its resolved run's studyRevision", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study()],
      doeDesigns: [design()],
      doeRuns: [run()],
      doeObservations: [observation({ studyRevision: 2 })],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("doe_observation_run_conflict");
    }
  });

  it("fails closed when an observation's responseId does not resolve within its run's design's frozen responseSnapshot", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study()],
      doeDesigns: [design()],
      doeRuns: [run()],
      doeObservations: [observation({ responseId: "RESP-GHOST" })],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("doe_observation_response_not_found");
    }
  });

  it("fails closed on an observation with a recordedAt value that is not the canonical toISOString() format", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study()],
      doeDesigns: [design()],
      doeRuns: [run()],
      doeObservations: [observation({ recordedAt: "2026-01-03 10:00:00" })],
    });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("invalid_timestamp_format");
    }
  });

  it("frozen design factorSnapshot/responseSnapshot are not silently replaced by anything live — the design record is embedded verbatim", () => {
    const richFactor = factor({ id: "FACTOR-RICH", lowValue: "10", centerValue: "50", highValue: "90" });
    const richResponse = response({ id: "RESP-RICH", lowerLimit: "1", upperLimit: "9", targetValue: "5" });
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [design({ factorSnapshot: [richFactor], responseSnapshot: [richResponse] })],
        doeRuns: [run()],
      }),
    );
    expect(rows[0].studies[0].designs[0].design.factorSnapshot).toEqual([richFactor]);
    expect(rows[0].studies[0].designs[0].design.responseSnapshot).toEqual([richResponse]);
  });

  it("fails closed, and emits nothing, when a constructed row would fail its own schema (malformed source data)", () => {
    const malformed = { ...study(), revision: 0 } as unknown as DoeStudy;
    const input = buildInput({ formulationVersions: [version()], doeStudies: [malformed] });
    try {
      extractFormulaVersionDoeRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionDoeDatasetExtractionError).code).toBe("row_schema_validation_failed");
    }
  });

  it("does not mutate its inputs, including on a failure path", () => {
    const studies = Object.freeze([Object.freeze(study())]);
    const designs = Object.freeze([Object.freeze(design())]);
    const runs = Object.freeze([Object.freeze(run())]);
    const observations = Object.freeze([Object.freeze(observation())]);
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: studies as unknown as DoeStudy[],
      doeDesigns: designs as unknown as DoeDesign[],
      doeRuns: runs as unknown as DoeRun[],
      doeObservations: observations as unknown as DoeObservation[],
    });
    expect(() => extractFormulaVersionDoeRows(input)).not.toThrow();

    const badInput = buildInput({
      formulationVersions: [version()],
      doeStudies: studies as unknown as DoeStudy[],
      doeDesigns: designs as unknown as DoeDesign[],
      doeRuns: runs as unknown as DoeRun[],
      doeObservations: Object.freeze([Object.freeze(observation({ responseId: "RESP-GHOST" }))]) as unknown as DoeObservation[],
    });
    expect(() => extractFormulaVersionDoeRows(badInput)).toThrow();
  });

  it("does not let mutating returned nested output mutate the source fixtures", () => {
    const sourceRun = run();
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [design()],
        doeRuns: [sourceRun],
      }),
    );
    const emittedRun = rows[0].studies[0].designs[0].runs[0].run;
    (emittedRun.factorSettings as unknown as { push: (...args: unknown[]) => void }).push({
      factorCode: "X",
      codedValue: "1",
      actualValue: "1",
    });
    expect(sourceRun.factorSettings).toHaveLength(1);
  });

  it("is deterministic: repeated extraction on identical inputs produces deeply equal results", () => {
    const input = buildInput({
      formulationVersions: [version()],
      doeStudies: [study()],
      doeDesigns: [design()],
      doeRuns: [run()],
      doeObservations: [observation()],
    });
    expect(extractFormulaVersionDoeRows(input)).toEqual(extractFormulaVersionDoeRows(input));
  });

  it("preserves the exact payload through JSON serialization and parsing, and the row schema accepts it", () => {
    const rows = extractFormulaVersionDoeRows(
      buildInput({
        formulationVersions: [version()],
        doeStudies: [study()],
        doeDesigns: [design()],
        doeRuns: [run()],
        doeObservations: [observation()],
      }),
    );
    const roundTripped = JSON.parse(JSON.stringify(rows[0]));
    expect(roundTripped).toEqual(rows[0]);
    expect(formulaVersionDoeRowSchema.safeParse(roundTripped).success).toBe(true);
  });

  it("rejects a payload missing mandatory identity fields via the schema, and rejects a non-row payload", () => {
    expect(formulaVersionDoeRowSchema.safeParse({}).success).toBe(false);
    expect(formulaVersionDoeRowSchema.safeParse({ foo: "bar" }).success).toBe(false);
  });

  it("is available from the shared package's public export path", () => {
    expect(extractFromPublicEntryPoint).toBe(extractFormulaVersionDoeRows);
  });

  describe("delimiter-rich and Unicode ids", () => {
    it("remains unambiguous and deterministic under reordering", () => {
      const idA = "STUDY|α-001";
      const idB = "STUDY,β-002";
      const studies = [study({ id: idB, createdAt: "2026-01-04T00:00:00.000Z" }), study({ id: idA, createdAt: "2026-01-03T00:00:00.000Z" })];
      const rows = extractFormulaVersionDoeRows(buildInput({ formulationVersions: [version()], doeStudies: studies }));
      expect(rows[0].studies.map((s) => s.studyId)).toEqual([idA, idB]);
    });
  });

  describe("ordinal (locale-independent) ordering", () => {
    it("ordering is environment-independent ordinal comparison, not locale-collation-aware — proven on a case pair where the two disagree", () => {
      expect("a".localeCompare("B")).toBeLessThan(0);
      expect("a" > "B").toBe(true);
      const observations = [
        observation({ id: "a-obs", recordedAt: "2026-01-03T10:00:00.000Z" }),
        observation({ id: "B-obs", recordedAt: "2026-01-03T10:00:00.000Z" }),
      ];
      const rows = extractFormulaVersionDoeRows(
        buildInput({
          formulationVersions: [version()],
          doeStudies: [study()],
          doeDesigns: [design({ responseSnapshot: [response()] })],
          doeRuns: [run()],
          doeObservations: observations,
        }),
      );
      expect(rows[0].studies[0].designs[0].runs[0].observations.map((o) => o.id)).toEqual(["B-obs", "a-obs"]);
    });
  });

  describe("dataset schema version + canonical schema reuse", () => {
    it("VERSION: DATASET_SCHEMA_VERSION reflects this task's brand-new row type, shared with every other FVL-05 row type", () => {
      const rows = extractFormulaVersionDoeRows(buildInput({ formulationVersions: [version()] }));
      expect(rows[0].datasetSchemaVersion).toBe(DATASET_SCHEMA_VERSION);
      expect(formulaVersionDoeRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.0" }).success).toBe(false);
      expect(formulaVersionDoeRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.1" }).success).toBe(false);
      expect(formulaVersionDoeRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.2" }).success).toBe(false);
      expect(formulaVersionDoeRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.3" }).success).toBe(false);
      expect(formulaVersionDoeRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.4" }).success).toBe(false);
    });

    it("PARITY: the embedded design/run/observation element schemas are the literal same schema objects as the canonical source — never re-modeled copies", () => {
      expect(doeDesignRunsSchema.shape.design).toBe(doeDesignSchema);
      expect(doeRunObservationsSchema.shape.run).toBe(doeRunSchema);
      expect(doeRunObservationsSchema.shape.observations.element).toBe(doeObservationSchema);
    });
  });
});
