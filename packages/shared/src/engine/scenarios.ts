/**
 * Optimization scenario lifecycle, product-family profile application, and
 * scenario/run comparison (spec §A6).
 *
 * `optimization_scenarios` is an append-only master-data collection (see
 * `apps/desktop/src-tauri/src/masterdata.rs`) — the same immutability
 * `OptimizationRun` already has. So "rename", "retire" and "save an edit"
 * cannot rewrite an existing scenario record; each instead produces a NEW
 * record in the same `scenarioGroupId` with a higher `revision`. This
 * module is the only place that constructs those records, so the
 * revision/lineage bookkeeping happens in exactly one place. See
 * `docs/OPTIMIZATION_SCENARIOS.md`.
 */
import { newId } from "./versioning";
import type { MaterialFunction } from "../schemas/formulation";
import type {
  FormulationProblem,
  OptimizationProfile,
  OptimizationRun,
  OptimizationScenario,
  ScenarioStatus,
} from "../schemas/optimization";

// ---------------------------------------------------------------------------
// Create / save / clone / retire / restore
// ---------------------------------------------------------------------------

export interface CreateScenarioInput {
  projectId: string;
  name: string;
  description?: string;
  baseFormulaVersionId?: string;
  sourceDraftId?: string;
  problem: FormulationProblem;
  priceSnapshotAt: string;
  inventorySnapshotAt: string;
  createdBy?: string;
}

/** A new scenario, revision 1 of a brand-new group. Exactly one of
 *  `baseFormulaVersionId` / `sourceDraftId` is expected — a scenario always
 *  starts from a saved version OR the current working draft, never neither
 *  (the caller passes whichever is actually being used, both stay optional
 *  in the schema for round-trip flexibility). */
export function createScenario(input: CreateScenarioInput): OptimizationScenario {
  const now = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    code: newId("scenario"),
    scenarioGroupId: newId("scengroup"),
    revision: 1,
    status: "active",
    projectId: input.projectId,
    name: input.name,
    description: input.description,
    baseFormulaVersionId: input.baseFormulaVersionId,
    sourceDraftId: input.sourceDraftId,
    includedMaterialIds: input.problem.materials.filter((m) => !m.excluded).map((m) => m.id),
    excludedMaterialIds: input.problem.materials.filter((m) => m.excluded).map((m) => m.id),
    problem: input.problem,
    priceSnapshotAt: input.priceSnapshotAt,
    inventorySnapshotAt: input.inventorySnapshotAt,
    createdBy: input.createdBy ?? "local",
    createdAt: now,
    updatedAt: now,
  };
}

export interface ScenarioRevisionUpdates {
  name?: string;
  description?: string;
  problem?: FormulationProblem;
  includedMaterialIds?: string[];
  excludedMaterialIds?: string[];
  priceSnapshotAt?: string;
  inventorySnapshotAt?: string;
  runCode?: string;
  status?: ScenarioStatus;
  createdBy?: string;
}

/** The one primitive every lifecycle action below is built from: a new
 *  record, same group, `revision + 1`, `previousCode` pointing back at
 *  `previous`. Exported directly too, for a plain "save my edits" action
 *  that is not specifically a rename or a retire. */
export function saveScenarioRevision(
  previous: OptimizationScenario,
  updates: ScenarioRevisionUpdates,
): OptimizationScenario {
  const now = new Date().toISOString();
  return {
    ...previous,
    code: newId("scenario"),
    revision: previous.revision + 1,
    previousCode: previous.code,
    clonedFromCode: undefined,
    status: updates.status ?? previous.status,
    name: updates.name ?? previous.name,
    description: updates.description ?? previous.description,
    problem: updates.problem ?? previous.problem,
    includedMaterialIds: updates.includedMaterialIds ?? previous.includedMaterialIds,
    excludedMaterialIds: updates.excludedMaterialIds ?? previous.excludedMaterialIds,
    priceSnapshotAt: updates.priceSnapshotAt ?? previous.priceSnapshotAt,
    inventorySnapshotAt: updates.inventorySnapshotAt ?? previous.inventorySnapshotAt,
    runCode: updates.runCode ?? previous.runCode,
    createdBy: updates.createdBy ?? previous.createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

export function renameScenario(previous: OptimizationScenario, name: string): OptimizationScenario {
  return saveScenarioRevision(previous, { name });
}

export function retireScenario(previous: OptimizationScenario): OptimizationScenario {
  if (previous.status === "retired") {
    throw new Error(`scenario ${previous.code} is already retired`);
  }
  return saveScenarioRevision(previous, { status: "retired" });
}

export interface CloneScenarioOptions {
  name: string;
  createdBy?: string;
}

/** A genuinely different scenario going forward — a NEW `scenarioGroupId`,
 *  revision 1, `clonedFromCode` pointing at the source (a different kind of
 *  link than `previousCode`, which only ever connects revisions within one
 *  group). The clone's own run history starts empty. */
export function cloneScenario(source: OptimizationScenario, opts: CloneScenarioOptions): OptimizationScenario {
  const now = new Date().toISOString();
  return {
    ...source,
    code: newId("scenario"),
    scenarioGroupId: newId("scengroup"),
    revision: 1,
    previousCode: undefined,
    clonedFromCode: source.code,
    status: "active",
    name: opts.name,
    runCode: undefined,
    createdBy: opts.createdBy ?? "local",
    createdAt: now,
    updatedAt: now,
  };
}

export interface RestoreScenarioOptions {
  name?: string;
  createdBy?: string;
}

/** Spec: "Restore retired scenario AS A NEW scenario" — deliberately never
 *  un-retires the old record (which would mean silently editing an
 *  append-only record's status in place). Just `cloneScenario` under a
 *  different name, restricted to a genuinely retired source. */
export function restoreRetiredScenarioAsNew(
  retired: OptimizationScenario,
  opts: RestoreScenarioOptions = {},
): OptimizationScenario {
  if (retired.status !== "retired") {
    throw new Error(`scenario ${retired.code} is not retired`);
  }
  return cloneScenario(retired, { name: opts.name ?? `${retired.name} (restored)`, createdBy: opts.createdBy });
}

/** The current record for every distinct scenario in a list of records that
 *  may include several revisions of the same one — the highest-`revision`
 *  record per `scenarioGroupId`. */
export function currentScenariosByGroup(all: OptimizationScenario[]): OptimizationScenario[] {
  const byGroup = new Map<string, OptimizationScenario>();
  for (const s of all) {
    const existing = byGroup.get(s.scenarioGroupId);
    if (!existing || s.revision > existing.revision) byGroup.set(s.scenarioGroupId, s);
  }
  return [...byGroup.values()];
}

/** Every revision of one scenario, oldest first. */
export function scenarioHistory(all: OptimizationScenario[], scenarioGroupId: string): OptimizationScenario[] {
  return all.filter((s) => s.scenarioGroupId === scenarioGroupId).sort((a, b) => a.revision - b.revision);
}

// ---------------------------------------------------------------------------
// Profile application
// ---------------------------------------------------------------------------

export type ProfileApplyMode = "apply_missing" | "merge" | "replace";

export interface ApplyProfileResult {
  problem: FormulationProblem;
  addedCompositionConstraints: number;
  addedFunctionalConstraints: number;
  addedRatioConstraints: number;
  addedConditionalConstraints: number;
  addedPropertyTargets: number;
  objectivePresetApplied: boolean;
  /** A profile's `requiredFunctionGroups` the current candidate pool has no
   *  material for at all — reported, never silently ignored, and never
   *  auto-added as a fabricated candidate. */
  requiredFunctionGroupsMissing: MaterialFunction[];
}

/**
 * Apply an `OptimizationProfile`'s structural defaults to a problem.
 *
 * - `apply_missing` / `merge` — add only constraints/targets the problem
 *   does not already have (matched by `id`), append-only, existing
 *   configuration untouched. The two names exist for the UI to frame the
 *   same operation differently ("fill in what's missing" vs. "merge this
 *   profile in") — the algorithm is identical, because both promise never
 *   to silently overwrite.
 * - `replace` — the profile's defaults become the ENTIRE constraint/
 *   property-target/objective configuration, discarding whatever was there.
 *   The caller must have already gotten explicit confirmation before
 *   calling this — this function itself does not ask.
 *
 * Never touches `problem.materials`, `batch`, or the compatibility/safety
 * policy — a profile is a structural starting point for constraints and
 * objectives, never a claim about which materials to use or how strict
 * exclusion should be.
 */
export function applyProfileToProblem(
  problem: FormulationProblem,
  profile: OptimizationProfile,
  mode: ProfileApplyMode,
): ApplyProfileResult {
  const presentFunctions = new Set(problem.materials.flatMap((m) => m.functions));
  const requiredFunctionGroupsMissing = profile.requiredFunctionGroups.filter((fg) => !presentFunctions.has(fg));

  if (mode === "replace") {
    const preset = profile.suggestedObjectivePresets[0];
    return {
      problem: {
        ...problem,
        compositionConstraints: profile.defaultCompositionConstraints,
        functionalConstraints: profile.defaultFunctionalConstraints,
        ratioConstraints: profile.defaultRatioConstraints,
        conditionalConstraints: profile.defaultConditionalConstraints,
        propertyTargets: profile.defaultPropertyTargets,
        objectiveConfig: preset ?? problem.objectiveConfig,
      },
      addedCompositionConstraints: profile.defaultCompositionConstraints.length,
      addedFunctionalConstraints: profile.defaultFunctionalConstraints.length,
      addedRatioConstraints: profile.defaultRatioConstraints.length,
      addedConditionalConstraints: profile.defaultConditionalConstraints.length,
      addedPropertyTargets: profile.defaultPropertyTargets.length,
      objectivePresetApplied: preset !== undefined,
      requiredFunctionGroupsMissing,
    };
  }

  const existingCompIds = new Set(problem.compositionConstraints.map((c) => c.id));
  const newComp = profile.defaultCompositionConstraints.filter((c) => !existingCompIds.has(c.id));
  const existingFuncIds = new Set(problem.functionalConstraints.map((c) => c.id));
  const newFunc = profile.defaultFunctionalConstraints.filter((c) => !existingFuncIds.has(c.id));
  const existingRatioIds = new Set(problem.ratioConstraints.map((c) => c.id));
  const newRatio = profile.defaultRatioConstraints.filter((c) => !existingRatioIds.has(c.id));
  const existingCondIds = new Set(problem.conditionalConstraints.map((c) => c.id));
  const newCond = profile.defaultConditionalConstraints.filter((c) => !existingCondIds.has(c.id));
  const existingPropIds = new Set(problem.propertyTargets.map((t) => t.id));
  const newProp = profile.defaultPropertyTargets.filter((t) => !existingPropIds.has(t.id));

  return {
    problem: {
      ...problem,
      compositionConstraints: [...problem.compositionConstraints, ...newComp],
      functionalConstraints: [...problem.functionalConstraints, ...newFunc],
      ratioConstraints: [...problem.ratioConstraints, ...newRatio],
      conditionalConstraints: [...problem.conditionalConstraints, ...newCond],
      propertyTargets: [...problem.propertyTargets, ...newProp],
    },
    addedCompositionConstraints: newComp.length,
    addedFunctionalConstraints: newFunc.length,
    addedRatioConstraints: newRatio.length,
    addedConditionalConstraints: newCond.length,
    addedPropertyTargets: newProp.length,
    objectivePresetApplied: false,
    requiredFunctionGroupsMissing,
  };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export interface ScenarioComparisonRow {
  runCode: string;
  scenarioGroupId?: string;
  scenarioName?: string;
  status: string;
  materials: { materialId: string; materialCode: string; percent: string }[];
  totalRawMaterialCost?: number;
  totalLandedCost?: number;
  softViolationCount: number;
  propertyResultCount: number;
  compatibilityRisk?: number;
  safetyRisk?: number;
  supplyRisk?: number;
  carbonScore?: number;
  stockUtilization?: number;
  evidenceConfidence?: number;
  missingDataWarningCount: number;
  solveTimeMs: number;
}

export const SCENARIO_COMPARISON_HIGHLIGHT_RULES = [
  "lowest_cost",
  "lowest_safety_risk",
  "lowest_compatibility_risk",
  "fewest_soft_violations",
  "highest_stock_utilization",
] as const;
export type ScenarioComparisonHighlightRule = (typeof SCENARIO_COMPARISON_HIGHLIGHT_RULES)[number];

export interface ScenarioComparisonHighlight {
  rule: ScenarioComparisonHighlightRule;
  runCode: string;
}

export interface ScenarioComparison {
  rows: ScenarioComparisonRow[];
  /** Never a "best overall" pick — one entry per rule above, and only when
   *  that rule has a single, unambiguous winner (a tie names no one). */
  highlights: ScenarioComparisonHighlight[];
}

const USABLE_STATUSES = new Set(["optimal", "feasible", "feasible_with_penalties"]);

/** Compare two or more persisted `OptimizationRun`s — the same shape
 *  whether they came from different scenarios, different revisions of one
 *  scenario, or ad-hoc runs with no scenario at all. Every number here is
 *  read straight from the run's own stored result; nothing is recomputed
 *  or re-solved. */
export function compareOptimizationRuns(
  runs: OptimizationRun[],
  scenarioNameByGroupId?: Map<string, string>,
): ScenarioComparison {
  const rows: ScenarioComparisonRow[] = runs.map((run) => {
    const r = run.result;
    const objectiveByMetric = new Map(r.objectiveResults.map((o) => [String(o.metric), o]));
    const readMetric = (metric: string) => {
      const o = objectiveByMetric.get(metric);
      return o ? Number(o.rawValue) : undefined;
    };
    return {
      runCode: run.code,
      scenarioGroupId: run.scenarioId,
      scenarioName: run.scenarioId ? scenarioNameByGroupId?.get(run.scenarioId) : undefined,
      status: r.status,
      materials: r.formulaLines.map((l) => ({ materialId: l.materialId, materialCode: l.materialCode, percent: l.percent })),
      totalRawMaterialCost: r.totals?.totalRawMaterialCost !== undefined ? Number(r.totals.totalRawMaterialCost) : undefined,
      totalLandedCost: r.totals?.totalLandedCost !== undefined ? Number(r.totals.totalLandedCost) : undefined,
      softViolationCount: r.constraintResults.filter((c) => c.strictness === "soft" && !c.satisfied).length,
      propertyResultCount: r.propertyResults.length,
      compatibilityRisk: readMetric("compatibility_risk"),
      safetyRisk: readMetric("safety_risk"),
      supplyRisk: readMetric("supply_risk"),
      carbonScore: readMetric("carbon_score"),
      stockUtilization: readMetric("stock_utilization"),
      evidenceConfidence: readMetric("evidence_confidence"),
      missingDataWarningCount: r.warnings.length,
      solveTimeMs: r.solverMetadata.solveTimeMs,
    };
  });

  const usable = rows.filter((r) => USABLE_STATUSES.has(r.status));
  const highlights: ScenarioComparisonHighlight[] = [];

  function highlightLowest(key: keyof ScenarioComparisonRow, rule: ScenarioComparisonHighlightRule) {
    const withValue = usable.filter((r) => typeof r[key] === "number");
    if (withValue.length === 0) return;
    const min = Math.min(...withValue.map((r) => r[key] as number));
    const winners = withValue.filter((r) => (r[key] as number) === min);
    if (winners.length === 1) highlights.push({ rule, runCode: winners[0].runCode });
  }

  function highlightHighest(key: keyof ScenarioComparisonRow, rule: ScenarioComparisonHighlightRule) {
    const withValue = usable.filter((r) => typeof r[key] === "number");
    if (withValue.length === 0) return;
    const max = Math.max(...withValue.map((r) => r[key] as number));
    const winners = withValue.filter((r) => (r[key] as number) === max);
    if (winners.length === 1) highlights.push({ rule, runCode: winners[0].runCode });
  }

  highlightLowest("totalRawMaterialCost", "lowest_cost");
  highlightLowest("safetyRisk", "lowest_safety_risk");
  highlightLowest("compatibilityRisk", "lowest_compatibility_risk");
  highlightLowest("softViolationCount", "fewest_soft_violations");
  highlightHighest("stockUtilization", "highest_stock_utilization");

  return { rows, highlights };
}
