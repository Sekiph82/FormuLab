import { describe, expect, it } from "vitest";
import {
  FormulaVersionCorrectiveCostContextDatasetExtractionError,
  extractFormulaVersionCorrectiveCostContextRows,
  type FormulaVersionCorrectiveCostContextDatasetExtractionInput,
} from "./formulaVersionCorrectiveCostContextDatasetExtractor";
import {
  DATASET_SCHEMA_VERSION,
  formulaVersionCorrectiveCostContextRowSchema,
  stabilityStudyPackagingContextSchema,
} from "../schemas/dataset";
import { extractFormulaVersionCorrectiveCostContextRows as extractFromPublicEntryPoint } from "../index";
import { correctiveActionSchema } from "../schemas/correctiveActions";
import { costSnapshotSchema } from "../schemas/costing";
import { packagingSystemSnapshotSchema } from "../schemas/stability";
import type { CorrectiveAction } from "../schemas/correctiveActions";
import type { CostSnapshot } from "../schemas/costing";
import type { Formulation, FormulationVersion } from "../schemas/formulation";
import type { LaboratoryTrial } from "../schemas/laboratory";
import type { StabilityStudy } from "../schemas/stability";

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

function correctiveAction(over: Partial<CorrectiveAction> = {}): CorrectiveAction {
  return {
    schemaVersion: "1.0",
    id: "CAPA-0001",
    code: "CAPA-CODE-0001",
    projectId: "FORM-0001",
    sourceType: "trial_deviation",
    sourceRecordId: "TRIAL-0001",
    title: "Fix viscosity drift",
    problemStatement: "Viscosity dropped below spec at 25C.",
    actionType: "reformulation",
    owner: "alice",
    status: "open",
    auditHistory: [],
    createdAt: "2026-01-04T00:00:00.000Z",
    createdBy: "local",
    updatedAt: "2026-01-04T00:00:00.000Z",
    ...over,
  };
}

function costSnapshot(over: Partial<CostSnapshot> = {}): CostSnapshot {
  return {
    schemaVersion: "1.0",
    code: "COST-0001",
    formulationId: "FORM-0001",
    versionId: "VER-0001",
    currency: "KES",
    batchKg: "100",
    calculatedAt: "2026-01-05T00:00:00.000Z",
    calculatedBy: "local",
    priceRecordCodes: [],
    exchangeRateCodes: [],
    packagingComponentCodes: [],
    lines: [],
    skuCosts: [],
    missingDataWarnings: [],
    ...over,
  };
}

function buildInput(
  over: Partial<FormulaVersionCorrectiveCostContextDatasetExtractionInput> & { formulationVersions: FormulationVersion[] },
): FormulaVersionCorrectiveCostContextDatasetExtractionInput {
  return {
    formulationVersionIds: over.formulationVersions.map((v) => v.id),
    formulations: [formulation()],
    correctiveActions: [],
    laboratoryTrials: [],
    stabilityStudies: [],
    costSnapshots: [],
    ...over,
  };
}

describe("extractFormulaVersionCorrectiveCostContextRows", () => {
  it("emits one schema-valid dataset row for one formula version with nothing linked", () => {
    const rows = extractFormulaVersionCorrectiveCostContextRows(buildInput({ formulationVersions: [version()] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].correctiveActions).toEqual([]);
    expect(rows[0].costSnapshots).toEqual([]);
    expect(rows[0].packagingContext).toEqual([]);
    expect(formulaVersionCorrectiveCostContextRowSchema.safeParse(rows[0]).success).toBe(true);
  });

  describe("corrective actions", () => {
    it("resolves a trial_deviation action via the trials pool and includes it", () => {
      const rows = extractFormulaVersionCorrectiveCostContextRows(
        buildInput({
          formulationVersions: [version()],
          laboratoryTrials: [trial()],
          correctiveActions: [correctiveAction()],
        }),
      );
      expect(rows[0].correctiveActions).toHaveLength(1);
      expect(rows[0].correctiveActions[0].id).toBe("CAPA-0001");
    });

    it("resolves a stability_failure action via the stability studies pool and includes it", () => {
      const action = correctiveAction({ id: "CAPA-STAB", sourceType: "stability_failure", sourceRecordId: "STUDY-0001" });
      const rows = extractFormulaVersionCorrectiveCostContextRows(
        buildInput({
          formulationVersions: [version()],
          stabilityStudies: [study()],
          correctiveActions: [action],
        }),
      );
      expect(rows[0].correctiveActions.map((a) => a.id)).toEqual(["CAPA-STAB"]);
    });

    it("resolves an unevidenced sourceType (manual) against whichever pool the id actually matches", () => {
      const action = correctiveAction({ id: "CAPA-MANUAL", sourceType: "manual", sourceRecordId: "STUDY-0001" });
      const rows = extractFormulaVersionCorrectiveCostContextRows(
        buildInput({
          formulationVersions: [version()],
          stabilityStudies: [study()],
          correctiveActions: [action],
        }),
      );
      expect(rows[0].correctiveActions.map((a) => a.id)).toEqual(["CAPA-MANUAL"]);
    });

    it("orders multiple actions by createdAt then id regardless of input order", () => {
      const actions = [
        correctiveAction({ id: "CAPA-2", createdAt: "2026-01-05T00:00:00.000Z" }),
        correctiveAction({ id: "CAPA-1", createdAt: "2026-01-04T00:00:00.000Z" }),
      ];
      const rows = extractFormulaVersionCorrectiveCostContextRows(
        buildInput({ formulationVersions: [version()], laboratoryTrials: [trial()], correctiveActions: actions }),
      );
      expect(rows[0].correctiveActions.map((a) => a.id)).toEqual(["CAPA-1", "CAPA-2"]);
    });

    it("preserves the full CorrectiveAction record verbatim, including resolution/effectivenessCheck/auditHistory/attachments", () => {
      const rich = correctiveAction({
        rootCauseNotes: "Supplier changed thickener lot.",
        dueDate: "2026-02-01T00:00:00.000Z",
        status: "effective",
        resolution: "Switched thickener supplier.",
        effectivenessCheck: { checkedBy: "bob", checkedAt: "2026-02-10T00:00:00.000Z", effective: true, notes: "Retested, in spec." },
        closedBy: "bob",
        closedAt: "2026-02-10T00:00:00.000Z",
        deviationOrFailureId: "DEV-0001",
        auditHistory: [{ action: "corrective_action.created", actorId: "alice", actorKind: "human", at: "2026-01-04T00:00:00.000Z" }],
      });
      const rows = extractFormulaVersionCorrectiveCostContextRows(
        buildInput({ formulationVersions: [version()], laboratoryTrials: [trial()], correctiveActions: [rich] }),
      );
      expect(rows[0].correctiveActions[0]).toEqual(rich);
    });

    it("preserves deviationOrFailureId verbatim without requiring it to resolve anywhere (out of this task's title scope)", () => {
      const linked = correctiveAction({ deviationOrFailureId: "DEV-GHOST" });
      const rows = extractFormulaVersionCorrectiveCostContextRows(
        buildInput({ formulationVersions: [version()], laboratoryTrials: [trial()], correctiveActions: [linked] }),
      );
      expect(rows[0].correctiveActions[0].deviationOrFailureId).toBe("DEV-GHOST");
    });

    it("excludes (never errors on) an action whose resolved trial belongs to a different formula version", () => {
      const otherTrial = trial({ id: "TRIAL-OTHER", sourceFormulaVersionId: "VER-OTHER" });
      const action = correctiveAction({ sourceRecordId: "TRIAL-OTHER" });
      const rows = extractFormulaVersionCorrectiveCostContextRows(
        buildInput({
          formulationVersions: [version()],
          laboratoryTrials: [otherTrial],
          correctiveActions: [action],
        }),
      );
      expect(rows[0].correctiveActions).toEqual([]);
    });

    it("fails closed on duplicate/ambiguous exact corrective action identities in the supplied pool", () => {
      const input = buildInput({
        formulationVersions: [version()],
        laboratoryTrials: [trial()],
        correctiveActions: [correctiveAction(), correctiveAction()],
      });
      try {
        extractFormulaVersionCorrectiveCostContextRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("duplicate_corrective_action_id");
      }
    });

    it("fails closed when an action's sourceRecordId resolves to neither the trials nor the stability studies pool, pool-wide", () => {
      const input = buildInput({
        formulationVersions: [version()],
        correctiveActions: [correctiveAction({ sourceRecordId: "GHOST-0001" })],
      });
      try {
        extractFormulaVersionCorrectiveCostContextRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("corrective_action_source_record_not_found");
      }
    });

    it("fails closed when a linked action's own projectId contradicts the resolved formulation", () => {
      const input = buildInput({
        formulationVersions: [version()],
        laboratoryTrials: [trial()],
        correctiveActions: [correctiveAction({ projectId: "FORM-OTHER" })],
      });
      try {
        extractFormulaVersionCorrectiveCostContextRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("corrective_action_formula_link_conflict");
      }
    });

    it("fails closed when a linked trial's projectId contradicts the owning formulation (conflicting link)", () => {
      const input = buildInput({
        formulationVersions: [version()],
        laboratoryTrials: [trial({ projectId: "FORM-OTHER" })],
        correctiveActions: [correctiveAction()],
      });
      try {
        extractFormulaVersionCorrectiveCostContextRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("laboratory_trial_formula_link_conflict");
      }
    });

    it("fails closed when a linked study's projectId contradicts the owning formulation (conflicting link)", () => {
      const input = buildInput({
        formulationVersions: [version()],
        stabilityStudies: [study({ projectId: "FORM-OTHER" })],
        correctiveActions: [correctiveAction({ sourceType: "stability_failure", sourceRecordId: "STUDY-0001" })],
      });
      try {
        extractFormulaVersionCorrectiveCostContextRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("stability_study_formula_link_conflict");
      }
    });

    it("fails closed on duplicate/ambiguous exact trial identities in the supplied pool, pool-wide", () => {
      const input = buildInput({ formulationVersions: [version()], laboratoryTrials: [trial(), trial()] });
      try {
        extractFormulaVersionCorrectiveCostContextRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("duplicate_laboratory_trial_id");
      }
    });

    it("fails closed on duplicate/ambiguous exact study identities in the supplied pool, pool-wide", () => {
      const input = buildInput({ formulationVersions: [version()], stabilityStudies: [study(), study()] });
      try {
        extractFormulaVersionCorrectiveCostContextRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("duplicate_stability_study_id");
      }
    });

    it("fails closed on an action with a createdAt value that is not the canonical toISOString() format", () => {
      const input = buildInput({
        formulationVersions: [version()],
        laboratoryTrials: [trial()],
        correctiveActions: [correctiveAction({ createdAt: "2026-01-04" })],
      });
      try {
        extractFormulaVersionCorrectiveCostContextRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("invalid_timestamp_format");
      }
    });
  });

  describe("cost snapshots", () => {
    it("includes a cost snapshot whose versionId matches the requested version", () => {
      const rows = extractFormulaVersionCorrectiveCostContextRows(
        buildInput({ formulationVersions: [version()], costSnapshots: [costSnapshot()] }),
      );
      expect(rows[0].costSnapshots.map((s) => s.code)).toEqual(["COST-0001"]);
    });

    it("preserves the full CostSnapshot record verbatim, including lines/warnings/skuCosts", () => {
      const rich = costSnapshot({
        lines: [{ lineId: "L1", displayName: "Water", percent: "60", quantityKg: "60", lineCost: "0" }],
        skuCosts: [{ skuCode: "SKU-0001", fillQuantity: "250", fillUnit: "ml", warnings: [] }],
        missingDataWarnings: ["No price for material X"],
        rawMaterialCost: "12.50",
        costPerKg: "12.50",
      });
      const rows = extractFormulaVersionCorrectiveCostContextRows(buildInput({ formulationVersions: [version()], costSnapshots: [rich] }));
      expect(rows[0].costSnapshots[0]).toEqual(rich);
    });

    it("excludes (never errors on) a snapshot linked to a different formula version", () => {
      const rows = extractFormulaVersionCorrectiveCostContextRows(
        buildInput({ formulationVersions: [version()], costSnapshots: [costSnapshot({ versionId: "VER-OTHER" })] }),
      );
      expect(rows[0].costSnapshots).toEqual([]);
    });

    it("orders multiple snapshots by calculatedAt then code regardless of input order", () => {
      const snapshots = [
        costSnapshot({ code: "COST-2", calculatedAt: "2026-01-06T00:00:00.000Z" }),
        costSnapshot({ code: "COST-1", calculatedAt: "2026-01-05T00:00:00.000Z" }),
      ];
      const rows = extractFormulaVersionCorrectiveCostContextRows(buildInput({ formulationVersions: [version()], costSnapshots: snapshots }));
      expect(rows[0].costSnapshots.map((s) => s.code)).toEqual(["COST-1", "COST-2"]);
    });

    it("preserves an explicit zero cost line and a missingReason without fabricating a silent zero", () => {
      const rich = costSnapshot({
        lines: [{ lineId: "L1", displayName: "Free sample material", percent: "0", quantityKg: "0", lineCost: "0" }, { lineId: "L2", displayName: "New Material", percent: "5", quantityKg: "5", missingReason: "no_price" }],
      });
      const rows = extractFormulaVersionCorrectiveCostContextRows(buildInput({ formulationVersions: [version()], costSnapshots: [rich] }));
      expect(rows[0].costSnapshots[0].lines[0].lineCost).toBe("0");
      expect(rows[0].costSnapshots[0].lines[1].missingReason).toBe("no_price");
    });

    it("fails closed on duplicate/ambiguous exact cost snapshot codes in the supplied pool", () => {
      const input = buildInput({ formulationVersions: [version()], costSnapshots: [costSnapshot(), costSnapshot()] });
      try {
        extractFormulaVersionCorrectiveCostContextRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("duplicate_cost_snapshot_code");
      }
    });

    it("fails closed when a version-matching snapshot's formulationId contradicts the owning formulation", () => {
      const input = buildInput({
        formulationVersions: [version()],
        costSnapshots: [costSnapshot({ formulationId: "FORM-OTHER" })],
      });
      try {
        extractFormulaVersionCorrectiveCostContextRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("cost_snapshot_formula_link_conflict");
      }
    });

    it("fails closed on a snapshot with a calculatedAt value that is not the canonical toISOString() format", () => {
      const input = buildInput({ formulationVersions: [version()], costSnapshots: [costSnapshot({ calculatedAt: "2026-01-05" })] });
      try {
        extractFormulaVersionCorrectiveCostContextRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("invalid_timestamp_format");
      }
    });
  });

  describe("packaging/context (StabilityStudy.packagingSnapshot)", () => {
    it("extracts packaging context for a linked stability study, exactly", () => {
      const richPackaging = study({
        packagingSkuCode: "SKU-RICH",
        packagingSnapshot: {
          skuCode: "SKU-RICH",
          bomCode: "BOM-1",
          lines: [{ componentCode: "BOTTLE-250", quantityPerUnit: "1" }],
          fillQuantity: "250",
          fillUnit: "ml",
          fillLossPercent: "2",
          capturedAt: "2026-01-03T00:00:00.000Z",
        },
      });
      const rows = extractFormulaVersionCorrectiveCostContextRows(buildInput({ formulationVersions: [version()], stabilityStudies: [richPackaging] }));
      expect(rows[0].packagingContext).toHaveLength(1);
      expect(rows[0].packagingContext[0]).toEqual({
        studyId: "STUDY-0001",
        studyCode: "STB-0001",
        packagingSkuCode: "SKU-RICH",
        packagingSnapshot: richPackaging.packagingSnapshot,
      });
    });

    it("orders multiple linked studies' packaging context by createdAt then id regardless of input order", () => {
      const studyA = study({ id: "STUDY-A", code: "STB-A", createdAt: "2026-01-03T00:00:00.000Z" });
      const studyB = study({ id: "STUDY-B", code: "STB-B", createdAt: "2026-01-04T00:00:00.000Z" });
      const rows = extractFormulaVersionCorrectiveCostContextRows(
        buildInput({ formulationVersions: [version()], stabilityStudies: [studyB, studyA] }),
      );
      expect(rows[0].packagingContext.map((p) => p.studyId)).toEqual(["STUDY-A", "STUDY-B"]);
    });

    it("excludes (never errors on) a study linked to a different formula version", () => {
      const rows = extractFormulaVersionCorrectiveCostContextRows(
        buildInput({ formulationVersions: [version()], stabilityStudies: [study({ sourceFormulaVersionId: "VER-OTHER" })] }),
      );
      expect(rows[0].packagingContext).toEqual([]);
    });

    it("does not duplicate FVL-05.006's own sample/result/condition/time-point evidence — only studyId/studyCode/packagingSkuCode/packagingSnapshot are present", () => {
      const rows = extractFormulaVersionCorrectiveCostContextRows(buildInput({ formulationVersions: [version()], stabilityStudies: [study()] }));
      expect(Object.keys(rows[0].packagingContext[0]).sort()).toEqual(["packagingSkuCode", "packagingSnapshot", "studyCode", "studyId"]);
    });
  });

  it("emits one row per requested identity, including a duplicate-requested version id twice in order", () => {
    const rows = extractFormulaVersionCorrectiveCostContextRows(
      buildInput({ formulationVersionIds: ["VER-0001", "VER-0001"], formulationVersions: [version()] }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(rows[1]);
  });

  it("fails closed when a requested formula version id is not found", () => {
    const input = buildInput({ formulationVersionIds: ["VER-GHOST"], formulationVersions: [version()] });
    try {
      extractFormulaVersionCorrectiveCostContextRows(input);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(FormulaVersionCorrectiveCostContextDatasetExtractionError);
      expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("formula_version_not_found");
    }
  });

  it("fails closed on duplicate/ambiguous exact formula version identities", () => {
    const input = buildInput({ formulationVersions: [version(), version()] });
    try {
      extractFormulaVersionCorrectiveCostContextRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("duplicate_formula_version_id");
    }
  });

  it("fails closed on duplicate/ambiguous exact owning-formulation identities", () => {
    const input = buildInput({ formulationVersions: [version()], formulations: [formulation(), formulation()] });
    try {
      extractFormulaVersionCorrectiveCostContextRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("duplicate_formulation_id");
    }
  });

  it("fails closed when a formula version references a formula that was not supplied", () => {
    const input = buildInput({ formulationVersions: [version({ formulationId: "FORM-GHOST" })] });
    try {
      extractFormulaVersionCorrectiveCostContextRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("formulation_not_found");
    }
  });

  it("fails closed, and emits nothing, when a constructed row would fail its own schema (malformed source data)", () => {
    const malformed = { ...costSnapshot(), code: "" } as unknown as CostSnapshot;
    const input = buildInput({ formulationVersions: [version()], costSnapshots: [malformed] });
    try {
      extractFormulaVersionCorrectiveCostContextRows(input);
      expect.unreachable();
    } catch (err) {
      expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("row_schema_validation_failed");
    }
  });

  it("does not mutate its inputs, including on a failure path", () => {
    const trials = Object.freeze([Object.freeze(trial())]);
    const studies = Object.freeze([Object.freeze(study())]);
    const actions = Object.freeze([Object.freeze(correctiveAction())]);
    const snapshots = Object.freeze([Object.freeze(costSnapshot())]);
    const input = buildInput({
      formulationVersions: [version()],
      laboratoryTrials: trials as unknown as LaboratoryTrial[],
      stabilityStudies: studies as unknown as StabilityStudy[],
      correctiveActions: actions as unknown as CorrectiveAction[],
      costSnapshots: snapshots as unknown as CostSnapshot[],
    });
    expect(() => extractFormulaVersionCorrectiveCostContextRows(input)).not.toThrow();

    const badInput = buildInput({
      formulationVersions: [version()],
      correctiveActions: [Object.freeze(correctiveAction({ sourceRecordId: "GHOST" })) as unknown as CorrectiveAction],
    });
    expect(() => extractFormulaVersionCorrectiveCostContextRows(badInput)).toThrow();
  });

  it("does not let mutating returned nested output mutate the source fixtures", () => {
    const sourceAction = correctiveAction();
    const rows = extractFormulaVersionCorrectiveCostContextRows(
      buildInput({ formulationVersions: [version()], laboratoryTrials: [trial()], correctiveActions: [sourceAction] }),
    );
    const emittedActions = rows[0].correctiveActions;
    (emittedActions as unknown as { push: (...args: unknown[]) => void }).push(correctiveAction({ id: "EXTRA" }));
    const sourceRows = extractFormulaVersionCorrectiveCostContextRows(
      buildInput({ formulationVersions: [version()], laboratoryTrials: [trial()], correctiveActions: [sourceAction] }),
    );
    expect(sourceRows[0].correctiveActions).toHaveLength(1);
  });

  it("is deterministic: repeated extraction on identical inputs produces deeply equal results", () => {
    const input = buildInput({
      formulationVersions: [version()],
      laboratoryTrials: [trial()],
      stabilityStudies: [study()],
      correctiveActions: [correctiveAction()],
      costSnapshots: [costSnapshot()],
    });
    expect(extractFormulaVersionCorrectiveCostContextRows(input)).toEqual(extractFormulaVersionCorrectiveCostContextRows(input));
  });

  it("preserves the exact payload through JSON serialization and parsing, and the row schema accepts it", () => {
    const rows = extractFormulaVersionCorrectiveCostContextRows(
      buildInput({
        formulationVersions: [version()],
        laboratoryTrials: [trial()],
        stabilityStudies: [study()],
        correctiveActions: [correctiveAction()],
        costSnapshots: [costSnapshot()],
      }),
    );
    const roundTripped = JSON.parse(JSON.stringify(rows[0]));
    expect(roundTripped).toEqual(rows[0]);
    expect(formulaVersionCorrectiveCostContextRowSchema.safeParse(roundTripped).success).toBe(true);
  });

  it("rejects a payload missing mandatory identity fields via the schema, and rejects a non-row payload", () => {
    expect(formulaVersionCorrectiveCostContextRowSchema.safeParse({}).success).toBe(false);
    expect(formulaVersionCorrectiveCostContextRowSchema.safeParse({ foo: "bar" }).success).toBe(false);
  });

  it("is available from the shared package's public export path", () => {
    expect(extractFromPublicEntryPoint).toBe(extractFormulaVersionCorrectiveCostContextRows);
  });

  describe("delimiter-rich and Unicode ids", () => {
    it("remains unambiguous and deterministic under reordering", () => {
      const idA = "CAPA|α-001";
      const idB = "CAPA,β-002";
      const actions = [
        correctiveAction({ id: idB, createdAt: "2026-01-05T00:00:00.000Z" }),
        correctiveAction({ id: idA, createdAt: "2026-01-04T00:00:00.000Z" }),
      ];
      const rows = extractFormulaVersionCorrectiveCostContextRows(
        buildInput({ formulationVersions: [version()], laboratoryTrials: [trial()], correctiveActions: actions }),
      );
      expect(rows[0].correctiveActions.map((a) => a.id)).toEqual([idA, idB]);
    });
  });

  describe("ordinal (locale-independent) ordering", () => {
    it("ordering is environment-independent ordinal comparison, not locale-collation-aware — proven on a case pair where the two disagree", () => {
      expect("a".localeCompare("B")).toBeLessThan(0);
      expect("a" > "B").toBe(true);
      const actions = [
        correctiveAction({ id: "a-action", createdAt: "2026-01-04T00:00:00.000Z" }),
        correctiveAction({ id: "B-action", createdAt: "2026-01-04T00:00:00.000Z" }),
      ];
      const rows = extractFormulaVersionCorrectiveCostContextRows(
        buildInput({ formulationVersions: [version()], laboratoryTrials: [trial()], correctiveActions: actions }),
      );
      expect(rows[0].correctiveActions.map((a) => a.id)).toEqual(["B-action", "a-action"]);
    });
  });

  describe("dataset schema version + canonical schema reuse", () => {
    it("VERSION: DATASET_SCHEMA_VERSION reflects this task's brand-new row type, shared with every other FVL-05 row type", () => {
      const rows = extractFormulaVersionCorrectiveCostContextRows(buildInput({ formulationVersions: [version()] }));
      expect(rows[0].datasetSchemaVersion).toBe(DATASET_SCHEMA_VERSION);
      expect(formulaVersionCorrectiveCostContextRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.0" }).success).toBe(false);
      expect(formulaVersionCorrectiveCostContextRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.1" }).success).toBe(false);
      expect(formulaVersionCorrectiveCostContextRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.2" }).success).toBe(false);
      expect(formulaVersionCorrectiveCostContextRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.3" }).success).toBe(false);
      expect(formulaVersionCorrectiveCostContextRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.4" }).success).toBe(false);
      expect(formulaVersionCorrectiveCostContextRowSchema.safeParse({ ...rows[0], datasetSchemaVersion: "1.5" }).success).toBe(false);
    });

    it("PARITY: the embedded correctiveAction/costSnapshot/packagingSnapshot element schemas are the literal same schema objects as the canonical source — never re-modeled copies", () => {
      expect(formulaVersionCorrectiveCostContextRowSchema.shape.correctiveActions.element).toBe(correctiveActionSchema);
      expect(formulaVersionCorrectiveCostContextRowSchema.shape.costSnapshots.element).toBe(costSnapshotSchema);
      expect(stabilityStudyPackagingContextSchema.shape.packagingSnapshot).toBe(packagingSystemSnapshotSchema);
    });
  });

  describe("corrective cycle (AUDIT_FVL05_GPT_000011): cross-namespace sourceRecordId ambiguity", () => {
    it("fails closed when a corrective action's sourceRecordId exists in BOTH the trial and study pools", () => {
      const collidingTrial = trial({ id: "SHARED-ID" });
      const collidingStudy = study({ id: "SHARED-ID" });
      const action = correctiveAction({ sourceRecordId: "SHARED-ID" });
      const input = buildInput({
        formulationVersions: [version()],
        laboratoryTrials: [collidingTrial],
        stabilityStudies: [collidingStudy],
        correctiveActions: [action],
      });
      try {
        extractFormulaVersionCorrectiveCostContextRows(input);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(FormulaVersionCorrectiveCostContextDatasetExtractionError);
        expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("corrective_action_source_record_ambiguous");
        expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).actionId).toBe(action.id);
      }
    });

    it("does not use sourceType to silently disambiguate a same-id collision — fails closed even when sourceType names one branch", () => {
      const collidingTrial = trial({ id: "SHARED-ID" });
      const collidingStudy = study({ id: "SHARED-ID" });
      const action = correctiveAction({ sourceRecordId: "SHARED-ID", sourceType: "stability_failure" });
      const input = buildInput({
        formulationVersions: [version()],
        laboratoryTrials: [collidingTrial],
        stabilityStudies: [collidingStudy],
        correctiveActions: [action],
      });
      try {
        extractFormulaVersionCorrectiveCostContextRows(input);
        expect.unreachable();
      } catch (err) {
        expect((err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code).toBe("corrective_action_source_record_ambiguous");
      }
    });

    it("a same-id collision elsewhere in the supplied pools does not affect an action pointing to a genuinely unique id", () => {
      const collidingTrial = trial({ id: "SHARED-ID" });
      const collidingStudy = study({ id: "SHARED-ID" });
      const uniqueTrial = trial({ id: "TRIAL-UNIQUE" });
      const action = correctiveAction({ sourceRecordId: "TRIAL-UNIQUE" });
      const rows = extractFormulaVersionCorrectiveCostContextRows(
        buildInput({
          formulationVersions: [version()],
          laboratoryTrials: [collidingTrial, uniqueTrial],
          stabilityStudies: [collidingStudy],
          correctiveActions: [action],
        }),
      );
      expect(rows[0].correctiveActions.map((a) => a.id)).toEqual([action.id]);
    });

    it("exactly-one-match resolution is unaffected by an unrelated collision present in the supplied pools", () => {
      const collidingTrial = trial({ id: "SHARED-ID" });
      const collidingStudy = study({ id: "SHARED-ID" });
      const uniqueStudy = study({ id: "STUDY-UNIQUE" });
      const action = correctiveAction({ sourceType: "stability_failure", sourceRecordId: "STUDY-UNIQUE" });
      const rows = extractFormulaVersionCorrectiveCostContextRows(
        buildInput({
          formulationVersions: [version()],
          laboratoryTrials: [collidingTrial],
          stabilityStudies: [collidingStudy, uniqueStudy],
          correctiveActions: [action],
        }),
      );
      expect(rows[0].correctiveActions.map((a) => a.id)).toEqual([action.id]);
    });

    it("collision-detection result is deterministic and independent of supplied pool order", () => {
      const collidingTrial = trial({ id: "SHARED-ID" });
      const collidingStudy = study({ id: "SHARED-ID" });
      const action = correctiveAction({ sourceRecordId: "SHARED-ID" });
      const forward = buildInput({
        formulationVersions: [version()],
        laboratoryTrials: [collidingTrial],
        stabilityStudies: [collidingStudy],
        correctiveActions: [action],
      });
      const reversedPools = buildInput({
        formulationVersions: [version()],
        laboratoryTrials: [collidingTrial],
        stabilityStudies: [collidingStudy],
        correctiveActions: [action],
      });
      let forwardCode: string | undefined;
      let reversedCode: string | undefined;
      try {
        extractFormulaVersionCorrectiveCostContextRows(forward);
      } catch (err) {
        forwardCode = (err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code;
      }
      try {
        extractFormulaVersionCorrectiveCostContextRows(reversedPools);
      } catch (err) {
        reversedCode = (err as FormulaVersionCorrectiveCostContextDatasetExtractionError).code;
      }
      expect(forwardCode).toBe("corrective_action_source_record_ambiguous");
      expect(reversedCode).toBe("corrective_action_source_record_ambiguous");
    });

    it("does not mutate its inputs on the new ambiguity failure path", () => {
      const collidingTrial = Object.freeze(trial({ id: "SHARED-ID" }));
      const collidingStudy = Object.freeze(study({ id: "SHARED-ID" }));
      const action = Object.freeze(correctiveAction({ sourceRecordId: "SHARED-ID" }));
      const input = buildInput({
        formulationVersions: [version()],
        laboratoryTrials: [collidingTrial as unknown as LaboratoryTrial],
        stabilityStudies: [collidingStudy as unknown as StabilityStudy],
        correctiveActions: [action as unknown as CorrectiveAction],
      });
      expect(() => extractFormulaVersionCorrectiveCostContextRows(input)).toThrow(FormulaVersionCorrectiveCostContextDatasetExtractionError);
    });
  });
});
