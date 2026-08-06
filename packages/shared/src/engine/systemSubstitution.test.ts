import { describe, expect, it } from "vitest";
import { buildSystemSubstitutionProblem, generateSystemCandidates, scoreSystemResult } from "./systemSubstitution";
import type { SystemCandidateLimits, SubstitutionRequest } from "../schemas/substitution";
import type { AdvancedOptimizationResult, FormulationProblem, OptimizationMaterial } from "../schemas/optimization";

const LIMITS: SystemCandidateLimits = {
  maxCandidateMaterials: 30,
  maxMaterialsPerSystem: 3,
  maxCandidateSystems: 8,
  maxSolverTimeSeconds: 15,
};

function poolMaterial(over: { materialId: string; materialCode: string; functions: string[]; stockAvailableKg?: string; supplierApproved?: boolean; kenyaLocal?: boolean }) {
  return over as never;
}

describe("generateSystemCandidates", () => {
  it("generates one-material proposals covering the preserved function", () => {
    const pool = [
      poolMaterial({ materialId: "m1", materialCode: "M1", functions: ["anionic_surfactant"] }),
      poolMaterial({ materialId: "m2", materialCode: "M2", functions: ["preservative"] }),
    ];
    const { proposals } = generateSystemCandidates(
      { sourceMaterialIds: ["orig"], preserveFunctions: ["anionic_surfactant"] as never },
      pool,
      LIMITS,
    );
    expect(proposals.some((p) => p.materialIds.length === 1 && p.materialIds[0] === "m1")).toBe(true);
    expect(proposals.every((p) => !p.materialIds.includes("m2"))).toBe(true);
  });

  it("generates multi-material combinations when no single material covers every function", () => {
    const pool = [
      poolMaterial({ materialId: "anionic", materialCode: "ANI", functions: ["anionic_surfactant"] }),
      poolMaterial({ materialId: "amph", materialCode: "AMPH", functions: ["amphoteric_surfactant"] }),
    ];
    const { proposals } = generateSystemCandidates(
      { sourceMaterialIds: ["orig"], preserveFunctions: ["anionic_surfactant", "amphoteric_surfactant"] as never },
      pool,
      LIMITS,
    );
    const twoMaterialProposal = proposals.find((p) => p.materialIds.length === 2);
    expect(twoMaterialProposal).toBeDefined();
    expect(twoMaterialProposal?.missingFunctions).toEqual([]);
  });

  it("never generates a system larger than maxMaterialsPerSystem", () => {
    const pool = Array.from({ length: 6 }, (_, i) =>
      poolMaterial({ materialId: `m${i}`, materialCode: `M${i}`, functions: ["anionic_surfactant"] }),
    );
    const { proposals } = generateSystemCandidates(
      { sourceMaterialIds: [], preserveFunctions: ["anionic_surfactant"] as never },
      pool,
      { ...LIMITS, maxMaterialsPerSystem: 2, maxCandidateSystems: 100 },
    );
    expect(proposals.every((p) => p.materialIds.length <= 2)).toBe(true);
  });

  it("never evaluates more than maxCandidateSystems combinations", () => {
    const pool = Array.from({ length: 10 }, (_, i) =>
      poolMaterial({ materialId: `m${i}`, materialCode: `M${i}`, functions: ["anionic_surfactant"] }),
    );
    const { proposals } = generateSystemCandidates(
      { sourceMaterialIds: [], preserveFunctions: [] as never },
      pool,
      { ...LIMITS, maxCandidateSystems: 5 },
    );
    expect(proposals.length).toBeLessThanOrEqual(5);
  });

  it("caps the candidate pool at maxCandidateMaterials before generating combinations", () => {
    const pool = Array.from({ length: 50 }, (_, i) =>
      poolMaterial({ materialId: `m${i}`, materialCode: `M${String(i).padStart(3, "0")}`, functions: ["anionic_surfactant"] }),
    );
    const { proposals } = generateSystemCandidates(
      { sourceMaterialIds: [], preserveFunctions: [] as never },
      pool,
      { ...LIMITS, maxCandidateMaterials: 3, maxCandidateSystems: 100, maxMaterialsPerSystem: 1 },
    );
    // Only the first 3 (by materialCode) should ever appear.
    const codes = new Set(proposals.map((p) => p.materialCodes[0]));
    expect(codes).toEqual(new Set(["M000", "M001", "M002"]));
  });

  it("rejects a combination that does not cover every preserved function", () => {
    // Passes the prefilter (it matches ONE of the two preserved functions)
    // but a size-1 combo of just this material still leaves the other
    // preserved function uncovered.
    const pool = [poolMaterial({ materialId: "m1", materialCode: "M1", functions: ["anionic_surfactant"] })];
    const { proposals, rejected } = generateSystemCandidates(
      { sourceMaterialIds: [], preserveFunctions: ["anionic_surfactant", "preservative"] as never },
      pool,
      { ...LIMITS, maxMaterialsPerSystem: 1 },
    );
    expect(proposals).toHaveLength(0);
    expect(rejected.some((r) => r.reason === "missing_required_function")).toBe(true);
  });

  it("reports candidate_pool_exhausted when nothing in the pool matches at all", () => {
    const { proposals, rejected } = generateSystemCandidates(
      { sourceMaterialIds: [], preserveFunctions: ["anionic_surfactant"] as never },
      [],
      LIMITS,
    );
    expect(proposals).toHaveLength(0);
    expect(rejected[0].reason).toBe("candidate_pool_exhausted");
  });

  it("requireStock excludes materials with no available stock", () => {
    const pool = [
      poolMaterial({ materialId: "instock", materialCode: "A", functions: ["anionic_surfactant"], stockAvailableKg: "50" }),
      poolMaterial({ materialId: "outofstock", materialCode: "B", functions: ["anionic_surfactant"], stockAvailableKg: "0" }),
    ];
    const { proposals } = generateSystemCandidates(
      { sourceMaterialIds: [], preserveFunctions: [] as never },
      pool,
      LIMITS,
      { requireStock: true },
    );
    expect(proposals.every((p) => !p.materialIds.includes("outofstock"))).toBe(true);
  });

  it("generation is deterministic — the same input always produces the same proposals in the same order", () => {
    const pool = [
      poolMaterial({ materialId: "b", materialCode: "B", functions: ["anionic_surfactant"] }),
      poolMaterial({ materialId: "a", materialCode: "A", functions: ["anionic_surfactant"] }),
    ];
    const target = { sourceMaterialIds: [], preserveFunctions: ["anionic_surfactant"] as never };
    const r1 = generateSystemCandidates(target, pool, LIMITS);
    const r2 = generateSystemCandidates(target, pool, LIMITS);
    expect(r1.proposals).toEqual(r2.proposals);
  });
});

function baseProblem(): FormulationProblem {
  const materials: OptimizationMaterial[] = [
    {
      id: "locked",
      materialCode: "LOCKED",
      name: "Locked",
      price: { value: "1", state: "known" },
      currency: "KES",
      activeMatterPercent: { value: "100", state: "known" },
      functions: [],
      minUsePercent: "0",
      maxUsePercent: "100",
      lockedPercent: "50",
      casNumbers: [],
      excluded: false,
    },
    {
      id: "source",
      materialCode: "SOURCE",
      name: "Source",
      price: { value: "2", state: "known" },
      currency: "KES",
      activeMatterPercent: { value: "70", state: "known" },
      functions: ["anionic_surfactant"],
      minUsePercent: "0",
      maxUsePercent: "100",
      lockedPercent: "50",
      casNumbers: [],
      excluded: false,
    },
    {
      id: "candidate",
      materialCode: "CAND",
      name: "Candidate",
      price: { value: "3", state: "known" },
      currency: "KES",
      activeMatterPercent: { value: "60", state: "known" },
      functions: ["anionic_surfactant"],
      minUsePercent: "0",
      maxUsePercent: "100",
      excluded: true,
      casNumbers: [],
    },
  ];
  return {
    schemaVersion: "1.0",
    id: "prob-1",
    projectId: "proj-1",
    productFamilyId: "fam-1",
    packagingSkuIds: [],
    marketProfileIds: [],
    batch: { sizeKg: "100" },
    materials,
    compositionConstraints: [
      { id: "total", displayName: "Total", constraintType: "total_equals_100", severity: "blocking", strictness: "hard", verificationStatus: "verified", active: true },
    ],
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
  };
}

function baseRequest(over: Partial<SubstitutionRequest> = {}): SubstitutionRequest {
  return {
    schemaVersion: "1.0",
    code: "req-1",
    projectId: "proj-1",
    formulaVersionId: "ver-1",
    lineId: "source",
    materialId: "source",
    reason: "manual",
    targetMarketIds: [],
    preserveActiveContribution: true,
    preserveFunction: true,
    requestedAt: "2026-01-01T00:00:00.000Z",
    requestedBy: "local",
    ...over,
    requireStock: over.requireStock ?? false,
    requireApprovedSupplier: over.requireApprovedSupplier ?? false,
    preferKenyaLocal: over.preferKenyaLocal ?? false,
  };
}

describe("buildSystemSubstitutionProblem", () => {
  it("removes the source material as a candidate entirely", () => {
    const result = buildSystemSubstitutionProblem({
      baseProblem: baseProblem(),
      sourceMaterialIds: ["source"],
      proposal: { materialIds: ["candidate"], materialCodes: ["CAND"], matchedFunctions: ["anionic_surfactant"] as never, missingFunctions: [] },
      request: baseRequest(),
    });
    expect(result.materials.some((m) => m.id === "source")).toBe(false);
  });

  it("unlocks the proposed system material and clears its excluded flag", () => {
    const result = buildSystemSubstitutionProblem({
      baseProblem: baseProblem(),
      sourceMaterialIds: ["source"],
      proposal: { materialIds: ["candidate"], materialCodes: ["CAND"], matchedFunctions: ["anionic_surfactant"] as never, missingFunctions: [] },
      request: baseRequest(),
    });
    const candidate = result.materials.find((m) => m.id === "candidate");
    expect(candidate?.excluded).toBe(false);
    expect(candidate?.lockedPercent).toBeUndefined();
  });

  it("leaves unaffected materials' locks untouched", () => {
    const result = buildSystemSubstitutionProblem({
      baseProblem: baseProblem(),
      sourceMaterialIds: ["source"],
      proposal: { materialIds: ["candidate"], materialCodes: ["CAND"], matchedFunctions: [] as never, missingFunctions: [] },
      request: baseRequest(),
    });
    const locked = result.materials.find((m) => m.id === "locked");
    expect(locked?.lockedPercent).toBe("50");
  });

  it("adds a preserve-function constraint for every requested function", () => {
    const result = buildSystemSubstitutionProblem({
      baseProblem: baseProblem(),
      sourceMaterialIds: ["source"],
      proposal: { materialIds: ["candidate"], materialCodes: ["CAND"], matchedFunctions: [] as never, missingFunctions: [] },
      request: baseRequest({ preserveFunctions: ["anionic_surfactant"] as never }),
    });
    expect(result.functionalConstraints.some((c) => c.id === "sys_preserve_fn_anionic_surfactant")).toBe(true);
  });

  it("adds a soft active-contribution ratio constraint when preserveActiveContribution and an original value are given", () => {
    const result = buildSystemSubstitutionProblem({
      baseProblem: baseProblem(),
      sourceMaterialIds: ["source"],
      proposal: { materialIds: ["candidate"], materialCodes: ["CAND"], matchedFunctions: [] as never, missingFunctions: [] },
      request: baseRequest({ preserveActiveContribution: true }),
      originalActiveContributionPercent: "35",
    });
    const ratio = result.ratioConstraints.find((c) => c.id === "sys_preserve_active_contribution");
    expect(ratio).toBeDefined();
    expect(ratio?.strictness).toBe("soft");
    expect(ratio?.value).toBe("0.35");
  });

  it("skips the active-contribution constraint when no original value is supplied", () => {
    const result = buildSystemSubstitutionProblem({
      baseProblem: baseProblem(),
      sourceMaterialIds: ["source"],
      proposal: { materialIds: ["candidate"], materialCodes: ["CAND"], matchedFunctions: [] as never, missingFunctions: [] },
      request: baseRequest({ preserveActiveContribution: true }),
    });
    expect(result.ratioConstraints.find((c) => c.id === "sys_preserve_active_contribution")).toBeUndefined();
  });

  it("applies a requested cost ceiling", () => {
    const result = buildSystemSubstitutionProblem({
      baseProblem: baseProblem(),
      sourceMaterialIds: ["source"],
      proposal: { materialIds: ["candidate"], materialCodes: ["CAND"], matchedFunctions: [] as never, missingFunctions: [] },
      request: baseRequest({ costCeiling: "500" }),
    });
    expect(result.costCeiling?.value).toBe("500");
  });

  it("merges in caller-provided compatibility/safety exclusion constraints", () => {
    const result = buildSystemSubstitutionProblem({
      baseProblem: baseProblem(),
      sourceMaterialIds: ["source"],
      proposal: { materialIds: ["candidate"], materialCodes: ["CAND"], matchedFunctions: [] as never, missingFunctions: [] },
      request: baseRequest(),
      exclusionConstraints: [
        {
          id: "excl-1",
          displayName: "excl",
          conditionType: "if_present_then_excluded",
          trigger: { materialId: "candidate" },
          target: { materialId: "locked" },
          severity: "blocking",
          strictness: "hard",
          verificationStatus: "not_verified",
          presenceThresholdPercent: "0.001",
          active: true,
        },
      ],
    });
    expect(result.conditionalConstraints.some((c) => c.id === "excl-1")).toBe(true);
  });
});

describe("scoreSystemResult", () => {
  function result(over: Partial<AdvancedOptimizationResult> = {}): AdvancedOptimizationResult {
    return {
      schemaVersion: "1.0",
      runId: "run-1",
      problemId: "prob-1",
      status: "optimal",
      formulaLines: [],
      objectiveResults: [],
      constraintResults: [],
      propertyResults: [],
      warnings: [],
      solverMetadata: { solver: "cbc", solveTimeMs: 10, variableCount: 1, constraintCount: 1, isMixedInteger: false, timeoutSeconds: 30, cancelled: false },
      completedAt: "2026-01-01T00:00:00.000Z",
      ...over,
    };
  }

  it("scores an optimal, unpenalized result higher than a feasible_with_penalties one", () => {
    const optimal = scoreSystemResult(result({ status: "optimal" }));
    const penalized = scoreSystemResult(
      result({
        status: "feasible_with_penalties",
        constraintResults: [{ constraintId: "c1", kind: "composition", strictness: "soft", satisfied: false }],
      }),
    );
    expect(optimal.totalScore).toBeGreaterThan(penalized.totalScore);
  });

  it("is deterministic", () => {
    const r = result();
    expect(scoreSystemResult(r)).toEqual(scoreSystemResult(r));
  });

  it("marks compatibility/safety risk dimensions missingData when the objective was not included", () => {
    const { dimensions } = scoreSystemResult(result());
    const compat = dimensions.find((d) => d.dimension === "compatibility_risk");
    expect(compat?.missingData).toBe(true);
  });

  it("scores lower cost above higher cost, all else equal", () => {
    const cheap = scoreSystemResult(result({ totals: { batchKg: "100.0000", totalPercent: "100.0000", totalActiveMatterPercent: "100.0000", totalRawMaterialCost: "50.00" } }), 100);
    const expensive = scoreSystemResult(result({ totals: { batchKg: "100.0000", totalPercent: "100.0000", totalActiveMatterPercent: "100.0000", totalRawMaterialCost: "200.00" } }), 100);
    expect(cheap.totalScore).toBeGreaterThan(expensive.totalScore);
  });
});
