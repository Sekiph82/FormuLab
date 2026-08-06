import { describe, expect, it } from "vitest";
import {
  applyProfileToProblem,
  cloneScenario,
  compareOptimizationRuns,
  createScenario,
  currentScenariosByGroup,
  renameScenario,
  restoreRetiredScenarioAsNew,
  retireScenario,
  saveScenarioRevision,
  scenarioHistory,
} from "./scenarios";
import type {
  AdvancedOptimizationResult,
  FormulationProblem,
  OptimizationProfile,
  OptimizationRun,
} from "../schemas/optimization";

function problem(over: Partial<FormulationProblem> = {}): FormulationProblem {
  return {
    schemaVersion: "1.0",
    id: "prob-1",
    projectId: "proj-1",
    productFamilyId: "fam-1",
    packagingSkuIds: [],
    marketProfileIds: [],
    batch: { sizeKg: "100" },
    materials: [
      {
        id: "a",
        materialCode: "A",
        name: "A",
        price: { value: "1", state: "known" },
        currency: "KES",
        activeMatterPercent: { value: "100", state: "known" },
        functions: [],
        minUsePercent: "0",
        maxUsePercent: "100",
        casNumbers: [],
        excluded: false,
      },
    ],
    compositionConstraints: [],
    functionalConstraints: [],
    ratioConstraints: [],
    conditionalConstraints: [],
    propertyTargets: [],
    compatibilityPolicy: { mode: "exclude_blocking" },
    safetyPolicy: { mode: "exclude_blocking" },
    objectiveConfig: { type: "weighted", objectives: [{ metric: "raw_material_cost", direction: "minimize", weight: "1" }] },
    solverConfig: { solver: "cbc", timeoutSeconds: 30, cancellable: true, exportLpFile: false },
    precisionPolicyVersion: "1.0",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("scenario lifecycle", () => {
  it("creates a scenario as revision 1 of a new group", () => {
    const s = createScenario({
      projectId: "proj-1",
      name: "Lowest cost",
      problem: problem(),
      priceSnapshotAt: "2026-01-01T00:00:00.000Z",
      inventorySnapshotAt: "2026-01-01T00:00:00.000Z",
    });
    expect(s.revision).toBe(1);
    expect(s.status).toBe("active");
    expect(s.previousCode).toBeUndefined();
    expect(s.scenarioGroupId).toBeTruthy();
  });

  it("save-edits create a new record in the same group, one revision higher", () => {
    const s1 = createScenario({
      projectId: "proj-1",
      name: "Lowest cost",
      problem: problem(),
      priceSnapshotAt: "2026-01-01T00:00:00.000Z",
      inventorySnapshotAt: "2026-01-01T00:00:00.000Z",
    });
    const s2 = saveScenarioRevision(s1, { description: "updated" });
    expect(s2.code).not.toBe(s1.code);
    expect(s2.scenarioGroupId).toBe(s1.scenarioGroupId);
    expect(s2.revision).toBe(2);
    expect(s2.previousCode).toBe(s1.code);
    expect(s2.description).toBe("updated");
  });

  it("rename produces a new revision with only the name changed", () => {
    const s1 = createScenario({
      projectId: "proj-1",
      name: "Draft 1",
      problem: problem(),
      priceSnapshotAt: "2026-01-01T00:00:00.000Z",
      inventorySnapshotAt: "2026-01-01T00:00:00.000Z",
    });
    const s2 = renameScenario(s1, "Draft 1 (renamed)");
    expect(s2.name).toBe("Draft 1 (renamed)");
    expect(s2.scenarioGroupId).toBe(s1.scenarioGroupId);
    expect(s2.revision).toBe(2);
  });

  it("retire marks a new revision retired and refuses to retire twice", () => {
    const s1 = createScenario({
      projectId: "proj-1",
      name: "X",
      problem: problem(),
      priceSnapshotAt: "2026-01-01T00:00:00.000Z",
      inventorySnapshotAt: "2026-01-01T00:00:00.000Z",
    });
    const s2 = retireScenario(s1);
    expect(s2.status).toBe("retired");
    expect(s2.scenarioGroupId).toBe(s1.scenarioGroupId);
    expect(() => retireScenario(s2)).toThrow(/already retired/);
  });

  it("clone starts a brand-new group, revision 1, with a clonedFromCode link", () => {
    const s1 = createScenario({
      projectId: "proj-1",
      name: "Original",
      problem: problem(),
      priceSnapshotAt: "2026-01-01T00:00:00.000Z",
      inventorySnapshotAt: "2026-01-01T00:00:00.000Z",
    });
    const clone = cloneScenario(s1, { name: "Original (copy)" });
    expect(clone.scenarioGroupId).not.toBe(s1.scenarioGroupId);
    expect(clone.revision).toBe(1);
    expect(clone.clonedFromCode).toBe(s1.code);
    expect(clone.previousCode).toBeUndefined();
    expect(clone.status).toBe("active");
  });

  it("restoring a retired scenario creates a new scenario, never un-retires the old one", () => {
    const s1 = createScenario({
      projectId: "proj-1",
      name: "X",
      problem: problem(),
      priceSnapshotAt: "2026-01-01T00:00:00.000Z",
      inventorySnapshotAt: "2026-01-01T00:00:00.000Z",
    });
    const retired = retireScenario(s1);
    const restored = restoreRetiredScenarioAsNew(retired);
    expect(restored.scenarioGroupId).not.toBe(retired.scenarioGroupId);
    expect(restored.status).toBe("active");
    expect(restored.clonedFromCode).toBe(retired.code);
    // The retired record itself is untouched — restoring never mutates it.
    expect(retired.status).toBe("retired");
  });

  it("refuses to restore a scenario that is not retired", () => {
    const s1 = createScenario({
      projectId: "proj-1",
      name: "X",
      problem: problem(),
      priceSnapshotAt: "2026-01-01T00:00:00.000Z",
      inventorySnapshotAt: "2026-01-01T00:00:00.000Z",
    });
    expect(() => restoreRetiredScenarioAsNew(s1)).toThrow(/not retired/);
  });

  it("currentScenariosByGroup picks the highest revision per group", () => {
    const s1 = createScenario({
      projectId: "proj-1",
      name: "X",
      problem: problem(),
      priceSnapshotAt: "2026-01-01T00:00:00.000Z",
      inventorySnapshotAt: "2026-01-01T00:00:00.000Z",
    });
    const s2 = renameScenario(s1, "X renamed");
    const s3 = renameScenario(s2, "X renamed again");
    const current = currentScenariosByGroup([s1, s2, s3]);
    expect(current).toHaveLength(1);
    expect(current[0].code).toBe(s3.code);
  });

  it("scenarioHistory returns every revision oldest first", () => {
    const s1 = createScenario({
      projectId: "proj-1",
      name: "X",
      problem: problem(),
      priceSnapshotAt: "2026-01-01T00:00:00.000Z",
      inventorySnapshotAt: "2026-01-01T00:00:00.000Z",
    });
    const s2 = renameScenario(s1, "X2");
    const history = scenarioHistory([s2, s1], s1.scenarioGroupId);
    expect(history.map((s) => s.revision)).toEqual([1, 2]);
  });
});

describe("applyProfileToProblem", () => {
  const profile: OptimizationProfile = {
    schemaVersion: "1.0",
    code: "OPT-TEST",
    productFamilyCode: "fam-1",
    displayName: "Test profile",
    requiredFunctionGroups: ["anionic_surfactant"],
    allowedFunctionGroups: [],
    forbiddenFunctionGroups: [],
    defaultCompositionConstraints: [
      {
        id: "profile_total",
        displayName: "Total",
        constraintType: "total_equals_100",
        severity: "blocking",
        strictness: "hard",
        verificationStatus: "not_verified",
        active: true,
      },
    ],
    defaultFunctionalConstraints: [],
    defaultRatioConstraints: [],
    defaultConditionalConstraints: [],
    defaultPropertyTargets: [],
    applicableCompatibilityRuleIds: [],
    applicableSafetyRuleIds: [],
    suggestedObjectivePresets: [],
    verificationStatus: "not_verified",
    requiresChemistReview: true,
    editable: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("apply_missing adds only what is not already present", () => {
    const p = problem();
    const result = applyProfileToProblem(p, profile, "apply_missing");
    expect(result.addedCompositionConstraints).toBe(1);
    expect(result.problem.compositionConstraints).toHaveLength(1);
  });

  it("apply_missing never re-adds a constraint that already has the same id", () => {
    const p = problem({
      compositionConstraints: [
        {
          id: "profile_total",
          displayName: "Already there",
          constraintType: "total_equals_100",
          severity: "blocking",
          strictness: "hard",
          verificationStatus: "verified",
          active: true,
        },
      ],
    });
    const result = applyProfileToProblem(p, profile, "apply_missing");
    expect(result.addedCompositionConstraints).toBe(0);
    expect(result.problem.compositionConstraints).toHaveLength(1);
    expect(result.problem.compositionConstraints[0].displayName).toBe("Already there"); // untouched
  });

  it("replace discards existing constraints and uses the profile's defaults", () => {
    const p = problem({
      compositionConstraints: [
        {
          id: "existing",
          displayName: "Existing",
          constraintType: "total_equals_100",
          severity: "blocking",
          strictness: "hard",
          verificationStatus: "not_verified",
          active: true,
        },
      ],
    });
    const result = applyProfileToProblem(p, profile, "replace");
    expect(result.problem.compositionConstraints).toHaveLength(1);
    expect(result.problem.compositionConstraints[0].id).toBe("profile_total");
  });

  it("reports required function groups the current pool has no material for", () => {
    const p = problem(); // material "a" has no functions at all.
    const result = applyProfileToProblem(p, profile, "apply_missing");
    expect(result.requiredFunctionGroupsMissing).toEqual(["anionic_surfactant"]);
  });

  it("never touches materials or batch", () => {
    const p = problem();
    const result = applyProfileToProblem(p, profile, "replace");
    expect(result.problem.materials).toBe(p.materials);
    expect(result.problem.batch).toBe(p.batch);
  });
});

describe("compareOptimizationRuns", () => {
  function run(code: string, over: Partial<AdvancedOptimizationResult> = {}, scenarioId?: string): OptimizationRun {
    return {
      schemaVersion: "1.0",
      code,
      projectId: "proj-1",
      scenarioId,
      problem: problem(),
      result: {
        schemaVersion: "1.0",
        runId: code,
        problemId: "prob-1",
        status: "optimal",
        formulaLines: [],
        totals: { batchKg: "100.0000", totalPercent: "100.0000", totalActiveMatterPercent: "100.0000", totalRawMaterialCost: "100.00" },
        objectiveResults: [],
        constraintResults: [],
        propertyResults: [],
        warnings: [],
        solverMetadata: { solver: "cbc", solveTimeMs: 10, variableCount: 1, constraintCount: 1, isMixedInteger: false, timeoutSeconds: 30, cancelled: false },
        completedAt: "2026-01-01T00:00:00.000Z",
        ...over,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("reports one row per run with cost, soft violations and solve time", () => {
    const runs = [run("r1"), run("r2", { totals: { batchKg: "100.0000", totalPercent: "100.0000", totalActiveMatterPercent: "100.0000", totalRawMaterialCost: "50.00" } })];
    const { rows } = compareOptimizationRuns(runs);
    expect(rows).toHaveLength(2);
    expect(rows[0].totalRawMaterialCost).toBe(100);
    expect(rows[1].totalRawMaterialCost).toBe(50);
  });

  it("highlights the unambiguous lowest cost", () => {
    const runs = [
      run("expensive", { totals: { batchKg: "100.0000", totalPercent: "100.0000", totalActiveMatterPercent: "100.0000", totalRawMaterialCost: "200.00" } }),
      run("cheap", { totals: { batchKg: "100.0000", totalPercent: "100.0000", totalActiveMatterPercent: "100.0000", totalRawMaterialCost: "50.00" } }),
    ];
    const { highlights } = compareOptimizationRuns(runs);
    const costHighlight = highlights.find((h) => h.rule === "lowest_cost");
    expect(costHighlight?.runCode).toBe("cheap");
  });

  it("never highlights a tie", () => {
    const runs = [
      run("a", { totals: { batchKg: "100.0000", totalPercent: "100.0000", totalActiveMatterPercent: "100.0000", totalRawMaterialCost: "100.00" } }),
      run("b", { totals: { batchKg: "100.0000", totalPercent: "100.0000", totalActiveMatterPercent: "100.0000", totalRawMaterialCost: "100.00" } }),
    ];
    const { highlights } = compareOptimizationRuns(runs);
    expect(highlights.find((h) => h.rule === "lowest_cost")).toBeUndefined();
  });

  it("never produces a 'best overall' highlight — only per-rule ones", () => {
    const runs = [run("a"), run("b", { totals: { batchKg: "100.0000", totalPercent: "100.0000", totalActiveMatterPercent: "100.0000", totalRawMaterialCost: "1.00" } })];
    const { highlights } = compareOptimizationRuns(runs);
    for (const h of highlights) {
      expect(
        ["lowest_cost", "lowest_safety_risk", "lowest_compatibility_risk", "fewest_soft_violations", "highest_stock_utilization"],
      ).toContain(h.rule);
    }
  });

  it("excludes infeasible runs from highlight consideration", () => {
    const runs = [
      run("infeasible-but-cheap-looking", { status: "infeasible", totals: undefined, formulaLines: [] }),
      run("feasible", { totals: { batchKg: "100.0000", totalPercent: "100.0000", totalActiveMatterPercent: "100.0000", totalRawMaterialCost: "500.00" } }),
    ];
    const { highlights } = compareOptimizationRuns(runs);
    const costHighlight = highlights.find((h) => h.rule === "lowest_cost");
    expect(costHighlight?.runCode).toBe("feasible");
  });

  it("resolves scenario names from the provided map", () => {
    const runs = [run("r1", {}, "group-1")];
    const names = new Map([["group-1", "My Scenario"]]);
    const { rows } = compareOptimizationRuns(runs, names);
    expect(rows[0].scenarioName).toBe("My Scenario");
  });
});
