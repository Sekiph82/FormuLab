import { describe, expect, it } from "vitest";
import {
  FormulaVersionProcessDatasetExtractionError,
  extractFormulaVersionProcessRows,
  type FormulaVersionProcessDatasetExtractionInput,
} from "./formulaVersionProcessDatasetExtractor";
import { DATASET_SCHEMA_VERSION, formulaVersionProcessRowSchema } from "../schemas/dataset";
import { extractFormulaVersionProcessRows as extractFromPublicEntryPoint } from "../index";
import type { Formulation, FormulationVersion } from "../schemas/formulation";
import type { LaboratoryTrial, TrialObservation, TrialProcessStep } from "../schemas/laboratory";

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

function step(over: Partial<TrialProcessStep> = {}): TrialProcessStep {
  return {
    id: "step-1",
    stepNumber: 1,
    phase: "A",
    plannedInstruction: "Heat to 70C",
    requiredEquipment: [],
    status: "planned",
    unplanned: false,
    attachments: [],
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    ...over,
  };
}

function observation(over: Partial<TrialObservation> = {}): TrialObservation {
  return {
    id: "obs-1",
    type: "color_change",
    description: "Slight yellowing observed.",
    observedBy: "alice",
    observedAt: "2026-01-03T01:00:00.000Z",
    attachments: [],
    ...over,
  };
}

function trial(over: Partial<LaboratoryTrial> = {}): LaboratoryTrial {
  return {
    schemaVersion: "1.0",
    id: "TRIAL-0001",
    code: "TRL-0001",
    projectId: "FORM-0001",
    sourceType: "saved_version",
    sourceFormulaVersionId: "VER-0001",
    formulaSnapshot: { lines: [], basisBatchKg: "100", capturedAt: "2026-01-03T00:00:00.000Z" },
    productFamilyId: "PF-0001",
    targetPackagingSkuIds: [],
    title: "Trial 1",
    batchSize: "10",
    batchUnit: "kg",
    status: "completed",
    priority: "normal",
    equipmentIds: [],
    materialUsage: [],
    processSteps: [],
    observations: [],
    hasOpenCriticalDeviation: false,
    createdAt: "2026-01-03T00:00:00.000Z",
    createdBy: "local",
    updatedAt: "2026-01-03T00:00:00.000Z",
    ...over,
  };
}

function buildInput(
  over: Partial<FormulaVersionProcessDatasetExtractionInput> & { formulationVersions: FormulationVersion[] },
): FormulaVersionProcessDatasetExtractionInput {
  return {
    formulationVersionIds: over.formulationVersions.map((v) => v.id),
    formulations: [formulation()],
    trials: [],
    ...over,
  };
}

describe("extractFormulaVersionProcessRows", () => {
  it("emits one schema-valid dataset row for one formula version with no linked trials", () => {
    const rows = extractFormulaVersionProcessRows(buildInput({ formulationVersions: [version()] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].trials).toEqual([]);
    expect(formulaVersionProcessRowSchema.safeParse(rows[0]).success).toBe(true);
  });

  it("emits the correct multi-step planned procedure in stepNumber order regardless of source array order", () => {
    const steps = [
      step({ id: "s2", stepNumber: 2, plannedInstruction: "Add surfactant", phase: "B" }),
      step({ id: "s1", stepNumber: 1, plannedInstruction: "Heat water phase", phase: "A" }),
      step({ id: "s3", stepNumber: 3, plannedInstruction: "Cool and pH adjust", phase: "C" }),
    ];
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial({ processSteps: steps })],
    });
    const rows = extractFormulaVersionProcessRows(input);
    const plannedSteps = rows[0].trials[0].plannedSteps;
    expect(plannedSteps.map((s) => s.processStepId)).toEqual(["s1", "s2", "s3"]);
    expect(plannedSteps.map((s) => s.plannedInstruction)).toEqual([
      "Heat water phase",
      "Add surfactant",
      "Cool and pH adjust",
    ]);
    expect(plannedSteps.map((s) => s.stepNumber)).toEqual([1, 2, 3]);
  });

  it("never presents a planned target as an actual observation", () => {
    const plannedOnly = step({
      id: "s1",
      stepNumber: 1,
      plannedTemperatureMinC: "60",
      plannedTemperatureMaxC: "70",
      plannedMixingSpeedMinRpm: "100",
      status: "planned",
    });
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial({ processSteps: [plannedOnly] })],
    });
    const rows = extractFormulaVersionProcessRows(input);
    const planEntry = rows[0].trials[0];
    expect(planEntry.plannedSteps).toHaveLength(1);
    expect(planEntry.plannedSteps[0].plannedTemperatureMinC).toBe("60");
    expect(planEntry.actualStepObservations).toHaveLength(0);
    expect("actualTemperatureC" in planEntry.plannedSteps[0]).toBe(false);
  });

  it("extracts multiple actual step observations and discrete observations with exact values, units, ordering, and trial identity", () => {
    const steps = [
      step({
        id: "s2",
        stepNumber: 2,
        status: "completed",
        actualStart: "2026-01-03T10:10:00.000Z",
        actualTemperatureC: "72.5",
        actualMixingSpeedRpm: "150",
        actualViscosity: "4200",
        viscosityUnit: "cP",
        operator: "bob",
      }),
      step({
        id: "s1",
        stepNumber: 1,
        status: "completed",
        actualStart: "2026-01-03T10:00:00.000Z",
        actualTemperatureC: "65.0",
        operator: "bob",
      }),
    ];
    const observations = [
      observation({ id: "obs-2", observedAt: "2026-01-03T10:20:00.000Z", type: "foaming_issue", description: "Excess foam." }),
      observation({ id: "obs-1", observedAt: "2026-01-03T10:05:00.000Z", type: "color_change", description: "Pale yellow." }),
    ];
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial({ id: "TRIAL-0001", code: "TRL-0001", processSteps: steps, observations })],
    });
    const rows = extractFormulaVersionProcessRows(input);
    const entry = rows[0].trials[0];
    expect(entry.trialId).toBe("TRIAL-0001");
    expect(entry.trialCode).toBe("TRL-0001");
    expect(entry.actualStepObservations.map((s) => s.processStepId)).toEqual(["s1", "s2"]);
    expect(entry.actualStepObservations[1].actualTemperatureC).toBe("72.5");
    expect(entry.actualStepObservations[1].viscosityUnit).toBe("cP");
    expect(entry.observations.map((o) => o.id)).toEqual(["obs-1", "obs-2"]);
    expect(entry.observations[0].description).toBe("Pale yellow.");
    expect(rows[0].sourceRecords).toContainEqual({ sourceEntity: "laboratoryTrial", sourceRecordId: "TRIAL-0001" });
    expect(rows[0].sourceRecords).toContainEqual({ sourceEntity: "trialProcessStep", sourceRecordId: "TRIAL-0001:s1" });
    expect(rows[0].sourceRecords).toContainEqual({ sourceEntity: "trialProcessStep", sourceRecordId: "TRIAL-0001:s2" });
    expect(rows[0].sourceRecords).toContainEqual({ sourceEntity: "trialObservation", sourceRecordId: "TRIAL-0001:obs-1" });
    expect(rows[0].sourceRecords).toContainEqual({ sourceEntity: "trialObservation", sourceRecordId: "TRIAL-0001:obs-2" });
  });

  it("keeps multiple trials for one formula version distinct and orders them deterministically by createdAt/id regardless of input order", () => {
    const trialA = trial({ id: "TRIAL-A", code: "TRL-A", createdAt: "2026-01-03T00:00:00.000Z" });
    const trialB = trial({ id: "TRIAL-B", code: "TRL-B", createdAt: "2026-01-04T00:00:00.000Z" });
    const forward = extractFormulaVersionProcessRows(
      buildInput({ formulationVersions: [version()], trials: [trialA, trialB] }),
    );
    const reversed = extractFormulaVersionProcessRows(
      buildInput({ formulationVersions: [version()], trials: [trialB, trialA] }),
    );
    expect(forward[0].trials.map((t) => t.trialId)).toEqual(["TRIAL-A", "TRIAL-B"]);
    expect(reversed[0].trials.map((t) => t.trialId)).toEqual(["TRIAL-A", "TRIAL-B"]);
    expect(forward[0]).toEqual(reversed[0]);
  });

  it("does not collapse two different trials' process steps or observations into one lineage citation when their (trial-scoped, not global) ids happen to collide", () => {
    const trialA = trial({
      id: "TRIAL-A",
      code: "TRL-A",
      createdAt: "2026-01-03T00:00:00.000Z",
      processSteps: [step({ id: "s1", stepNumber: 1, status: "completed", actualStart: "2026-01-03T10:00:00.000Z" })],
      observations: [observation({ id: "obs-1", observedAt: "2026-01-03T10:05:00.000Z" })],
    });
    const trialB = trial({
      id: "TRIAL-B",
      code: "TRL-B",
      createdAt: "2026-01-04T00:00:00.000Z",
      processSteps: [step({ id: "s1", stepNumber: 1, status: "completed", actualStart: "2026-01-04T10:00:00.000Z" })],
      observations: [observation({ id: "obs-1", observedAt: "2026-01-04T10:05:00.000Z" })],
    });
    const input = buildInput({ formulationVersions: [version()], trials: [trialA, trialB] });

    const rows = extractFormulaVersionProcessRows(input);

    expect(rows).toHaveLength(1);
    expect(formulaVersionProcessRowSchema.safeParse(rows[0]).success).toBe(true);
    expect(rows[0].trials[0].plannedSteps[0].processStepId).toBe("s1");
    expect(rows[0].trials[1].plannedSteps[0].processStepId).toBe("s1");
    expect(rows[0].sourceRecords).toContainEqual({ sourceEntity: "trialProcessStep", sourceRecordId: "TRIAL-A:s1" });
    expect(rows[0].sourceRecords).toContainEqual({ sourceEntity: "trialProcessStep", sourceRecordId: "TRIAL-B:s1" });
    expect(rows[0].sourceRecords).toContainEqual({ sourceEntity: "trialObservation", sourceRecordId: "TRIAL-A:obs-1" });
    expect(rows[0].sourceRecords).toContainEqual({ sourceEntity: "trialObservation", sourceRecordId: "TRIAL-B:obs-1" });
  });

  it("never lets a trial or observation linked to another formula version leak into this row", () => {
    const otherVersionTrial = trial({ id: "TRIAL-OTHER", sourceFormulaVersionId: "VER-OTHER" });
    const input = buildInput({
      formulationVersions: [version({ id: "VER-0001" })],
      trials: [otherVersionTrial],
    });
    const rows = extractFormulaVersionProcessRows(input);
    expect(rows[0].trials).toEqual([]);
  });

  it("emits no fabricated actual observations for a plan with no actual trial records", () => {
    const plannedOnlySteps = [step({ id: "s1", stepNumber: 1 }), step({ id: "s2", stepNumber: 2 })];
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial({ processSteps: plannedOnlySteps })],
    });
    const rows = extractFormulaVersionProcessRows(input);
    expect(rows[0].trials[0].plannedSteps).toHaveLength(2);
    expect(rows[0].trials[0].actualStepObservations).toHaveLength(0);
    expect(rows[0].trials[0].observations).toHaveLength(0);
  });

  it("emits no fabricated observations for a trial with no process observations", () => {
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial({ processSteps: [step({ status: "completed", actualStart: "2026-01-03T10:00:00.000Z" })], observations: [] })],
    });
    const rows = extractFormulaVersionProcessRows(input);
    expect(rows[0].trials[0].observations).toEqual([]);
  });

  it("keeps optional missing fields missing, following the existing dataset contract", () => {
    const bareStep = step({ id: "s1", stepNumber: 1 });
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial({ processSteps: [bareStep] })],
    });
    const rows = extractFormulaVersionProcessRows(input);
    const plan = rows[0].trials[0].plannedSteps[0];
    expect(plan.plannedTemperatureMinC).toBeUndefined();
    expect(plan.plannedAdditionOrder).toBeUndefined();
    const roundTripped = JSON.parse(JSON.stringify(plan));
    expect("plannedTemperatureMinC" in roundTripped).toBe(false);
    expect("plannedAdditionOrder" in roundTripped).toBe(false);
  });

  it("preserves explicit zero and false values through extraction", () => {
    const zeroStep = step({
      id: "s1",
      stepNumber: 1,
      plannedAdditionOrder: 0,
      status: "completed",
      actualAdditionOrder: 0,
      unplanned: false,
    });
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial({ processSteps: [zeroStep] })],
    });
    const rows = extractFormulaVersionProcessRows(input);
    const entry = rows[0].trials[0];
    expect(entry.plannedSteps[0].plannedAdditionOrder).toBe(0);
    expect(entry.actualStepObservations[0].actualAdditionOrder).toBe(0);
    expect(entry.actualStepObservations[0].unplanned).toBe(false);
  });

  it("excludes an unplanned step from plannedSteps but still records it as an actual observation", () => {
    const unplannedStep = step({ id: "s-extra", stepNumber: 4, unplanned: true, status: "completed" });
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial({ processSteps: [unplannedStep] })],
    });
    const rows = extractFormulaVersionProcessRows(input);
    const entry = rows[0].trials[0];
    expect(entry.plannedSteps).toHaveLength(0);
    expect(entry.actualStepObservations).toHaveLength(1);
    expect(entry.actualStepObservations[0].unplanned).toBe(true);
  });

  it("emits one row per requested identity, including a duplicate-requested version id twice in order", () => {
    const input = buildInput({
      formulationVersions: [version({ id: "VER-0001" })],
      formulationVersionIds: ["VER-0001", "VER-0001"],
    });
    const rows = extractFormulaVersionProcessRows(input);
    expect(rows).toHaveLength(2);
    expect(rows[0].formulaVersionId).toBe("VER-0001");
    expect(rows[1].formulaVersionId).toBe("VER-0001");
    expect(rows[0]).toEqual(rows[1]);
  });

  it("counts a step with only viscosityUnit set (no actualViscosity) as real actual-execution evidence, not silently dropped", () => {
    const unitOnlyStep = step({ id: "s1", stepNumber: 1, viscosityUnit: "cP" });
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial({ processSteps: [unitOnlyStep] })],
    });
    const rows = extractFormulaVersionProcessRows(input);
    const entry = rows[0].trials[0];
    expect(entry.actualStepObservations).toHaveLength(1);
    expect(entry.actualStepObservations[0].viscosityUnit).toBe("cP");
    expect(entry.actualStepObservations[0].actualViscosity).toBeUndefined();
  });

  it("fails closed when a requested formula version id is not found", () => {
    const input = buildInput({
      formulationVersions: [version({ id: "VER-0001" })],
      formulationVersionIds: ["VER-DOES-NOT-EXIST"],
    });
    try {
      extractFormulaVersionProcessRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionProcessDatasetExtractionError);
      expect((err as FormulaVersionProcessDatasetExtractionError).code).toBe("formula_version_not_found");
    }
  });

  it("fails closed on duplicate/ambiguous exact formula version identities", () => {
    const input = buildInput({
      formulationVersions: [version({ id: "VER-0001" }), version({ id: "VER-0001", versionNumber: 2 })],
    });
    try {
      extractFormulaVersionProcessRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionProcessDatasetExtractionError).code).toBe("duplicate_formula_version_id");
    }
  });

  it("fails closed on duplicate/ambiguous exact owning-formulation identities", () => {
    const input = buildInput({
      formulationVersions: [version()],
      formulations: [formulation(), formulation({ code: "DUP", name: "Duplicate" })],
    });
    try {
      extractFormulaVersionProcessRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionProcessDatasetExtractionError).code).toBe("duplicate_formulation_id");
    }
  });

  it("fails closed when a formula version references a formula that was not supplied", () => {
    const input = buildInput({ formulationVersions: [version()], formulations: [] });
    try {
      extractFormulaVersionProcessRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionProcessDatasetExtractionError).code).toBe("formulation_not_found");
    }
  });

  it("fails closed on duplicate/ambiguous exact trial identities in the supplied pool", () => {
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial({ id: "TRIAL-0001" }), trial({ id: "TRIAL-0001", code: "TRL-DUP" })],
    });
    try {
      extractFormulaVersionProcessRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionProcessDatasetExtractionError).code).toBe("duplicate_trial_id");
    }
  });

  it("fails closed on a duplicate process step identity within one trial", () => {
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial({ processSteps: [step({ id: "s1", stepNumber: 1 }), step({ id: "s1", stepNumber: 2 })] })],
    });
    try {
      extractFormulaVersionProcessRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionProcessDatasetExtractionError).code).toBe("duplicate_process_step_id");
    }
  });

  it("fails closed on a duplicate trial observation identity within one trial", () => {
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial({ observations: [observation({ id: "obs-1" }), observation({ id: "obs-1", description: "Duplicate" })] })],
    });
    try {
      extractFormulaVersionProcessRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionProcessDatasetExtractionError).code).toBe("duplicate_trial_observation_id");
    }
  });

  it("fails closed on a trial whose sourceFormulaVersionId matches but whose projectId does not resolve to the owning formulation (conflicting link)", () => {
    const input = buildInput({
      formulationVersions: [version({ id: "VER-0001", formulationId: "FORM-0001" })],
      trials: [trial({ sourceFormulaVersionId: "VER-0001", projectId: "FORM-OTHER" })],
    });
    try {
      extractFormulaVersionProcessRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionProcessDatasetExtractionError);
      expect((err as FormulaVersionProcessDatasetExtractionError).code).toBe("trial_formula_link_conflict");
    }
  });

  it("fails closed, and emits nothing, when a constructed row would fail its own schema (malformed source data)", () => {
    const input = buildInput({
      formulationVersions: [version()],
      formulations: [formulation({ code: "   " })],
    });
    try {
      extractFormulaVersionProcessRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionProcessDatasetExtractionError).code).toBe("row_schema_validation_failed");
    }
  });

  it("reorders equivalent input collections to stable output, except where persisted process order (stepNumber) is authoritative", () => {
    const steps = [step({ id: "s1", stepNumber: 1 }), step({ id: "s2", stepNumber: 2 })];
    const observations = [
      observation({ id: "obs-1", observedAt: "2026-01-03T10:00:00.000Z" }),
      observation({ id: "obs-2", observedAt: "2026-01-03T11:00:00.000Z" }),
    ];
    const canonical = extractFormulaVersionProcessRows(
      buildInput({ formulationVersions: [version()], trials: [trial({ processSteps: steps, observations })] }),
    );
    const reordered = extractFormulaVersionProcessRows(
      buildInput({
        formulationVersions: [version()],
        trials: [trial({ processSteps: [...steps].reverse(), observations: [...observations].reverse() })],
      }),
    );
    expect(reordered).toEqual(canonical);
  });

  it("does not mutate its inputs, including on a failure path", () => {
    const trials = Object.freeze([Object.freeze(trial({ processSteps: [Object.freeze(step())] }))]);
    const formulations = Object.freeze([Object.freeze(formulation())]);
    const versions = Object.freeze([Object.freeze(version())]);
    const snapshotBefore = JSON.parse(JSON.stringify({ formulations, versions, trials }));

    expect(() =>
      extractFormulaVersionProcessRows({
        formulationVersionIds: [versions[0]!.id],
        formulations: [...formulations],
        formulationVersions: [...versions],
        trials: [...trials],
      }),
    ).not.toThrow();

    const failingInput: FormulaVersionProcessDatasetExtractionInput = {
      formulationVersionIds: ["VER-BAD"],
      formulations: [...formulations],
      formulationVersions: [version({ id: "VER-BAD" }), version({ id: "VER-BAD", versionNumber: 2 })],
      trials: [...trials],
    };
    expect(() => extractFormulaVersionProcessRows(failingInput)).toThrow(FormulaVersionProcessDatasetExtractionError);

    expect(JSON.parse(JSON.stringify({ formulations, versions, trials }))).toEqual(snapshotBefore);
  });

  it("does not let mutating returned nested output mutate the source fixtures", () => {
    const sourceStep = step({ requiredEquipment: ["mixer"] });
    const sourceTrial = trial({ processSteps: [sourceStep] });
    const input = buildInput({ formulationVersions: [version()], trials: [sourceTrial] });
    const rows = extractFormulaVersionProcessRows(input);

    rows[0].trials[0].plannedSteps[0].requiredEquipment.push("homogenizer");
    (rows[0].trials[0].plannedSteps[0] as { plannedInstruction: string }).plannedInstruction = "mutated";

    expect(sourceStep.requiredEquipment).toEqual(["mixer"]);
    expect(sourceStep.plannedInstruction).toBe("Heat to 70C");
  });

  it("is deterministic: repeated extraction on identical inputs produces deeply equal results", () => {
    const input = buildInput({
      formulationVersions: [version()],
      trials: [trial({ processSteps: [step()], observations: [observation()] })],
    });
    const first = extractFormulaVersionProcessRows(input);
    const second = extractFormulaVersionProcessRows(input);
    expect(first).toEqual(second);
  });

  it("preserves the exact payload through JSON serialization and parsing, and the row schema accepts it", () => {
    const rows = extractFormulaVersionProcessRows(
      buildInput({
        formulationVersions: [version()],
        trials: [trial({ processSteps: [step()], observations: [observation()] })],
      }),
    );
    const roundTripped = JSON.parse(JSON.stringify(rows[0]));
    expect(roundTripped).toEqual(rows[0]);
    expect(formulaVersionProcessRowSchema.safeParse(roundTripped).success).toBe(true);
    expect(roundTripped.datasetSchemaVersion).toBe(DATASET_SCHEMA_VERSION);
  });

  it("rejects a payload missing mandatory identity fields via the schema, and rejects a non-row payload", () => {
    const rows = extractFormulaVersionProcessRows(buildInput({ formulationVersions: [version()] }));
    const { formulaVersionId, ...withoutVersionId } = rows[0];
    expect(formulaVersionProcessRowSchema.safeParse(withoutVersionId).success).toBe(false);
    expect(formulaVersionProcessRowSchema.safeParse({ not: "a row" }).success).toBe(false);
    void formulaVersionId;
  });

  it("is available from the shared package's public export path", () => {
    const rows = extractFromPublicEntryPoint(buildInput({ formulationVersions: [version()] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].formulaVersionId).toBe("VER-0001");
  });
});
