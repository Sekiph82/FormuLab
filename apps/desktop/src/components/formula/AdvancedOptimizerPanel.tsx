import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Ban, Loader2, Play, Wand2 } from "lucide-react";
import {
  applyProfileToProblem,
  blockingExclusionConstraints,
  cloneScenario,
  compareOptimizationRuns,
  createScenario,
  currentScenariosByGroup,
  gradedRiskScores,
  newId,
  priceFor,
  renameScenario,
  restoreRetiredScenarioAsNew,
  retireScenario,
  saveScenarioRevision,
  SEED_OPTIMIZATION_PROFILES,
  FORMULATION_PROPERTIES,
  type AdvancedOptimizationResult,
  type CompositionConstraint,
  type ConditionalConstraint,
  type Formulation,
  type FormulationLine,
  type FormulationProblem,
  type FormulationProperty,
  type InventoryRecord,
  type MaterialFunction,
  type MaterialPrice,
  type OptimizationMetric,
  type ObjectiveDirection,
  type OptimizationProfile,
  type OptimizationRun,
  type OptimizationScenario,
  type ProfileApplyMode,
  type RatioConstraint,
  type RawMaterial,
  type ScenarioComparison,
} from "@ai4s/shared";
import { listRecords, listRecordsSeeded, upsertRecords } from "@/lib/masterdata";
import { runAdvancedFormulationOptimize, cancelAdvancedFormulationOptimize } from "@/lib/tauri";
import { cn } from "@/lib/cn";

/** A run whose formula lines are real and safe to persist/apply — includes
 *  `feasible_with_penalties` (every hard constraint held; at least one soft
 *  constraint was relaxed) alongside a clean `optimal`/`feasible`. */
const USABLE_RESULT_STATUSES = new Set(["optimal", "feasible", "feasible_with_penalties"]);

const METRICS: OptimizationMetric[] = [
  "raw_material_cost",
  "landed_cost",
  "supply_risk",
  "carbon_score",
  "stock_utilization",
  "evidence_confidence",
  "compatibility_risk",
  "safety_risk",
];

interface ObjectiveRow {
  metric: OptimizationMetric;
  direction: ObjectiveDirection;
  weight: string;
}

interface FunctionalRow {
  id: string;
  functionGroups: MaterialFunction[];
  constraintType: "min_total" | "max_total";
  value: string;
  strictness: "hard" | "soft";
  penaltyWeight: string;
  allowedDeviation: string;
}

interface PropertyTargetRow {
  id: string;
  property: FormulationProperty;
  minValue: string;
  maxValue: string;
  enforceAs: "reported_only" | "hard" | "soft";
  penaltyWeight: string;
}

// Loosely typed — the real shape is `AdvancedOptimizationResult`
// (@ai4s/shared), but the Rust command returns `serde_json::Value` and we
// don't want a hard runtime dependency on Zod-parsing an IPC payload here.
interface OptimizeResult {
  status: string;
  formulaLines?: Array<{
    materialId: string;
    materialCode: string;
    name: string;
    percent: string;
    activeContributionPercent: string;
    quantityKg: string;
    rawMaterialCost?: string;
  }>;
  totals?: { totalPercent: string; totalActiveMatterPercent: string; totalRawMaterialCost?: string };
  objectiveResults?: Array<{ metric: string; rawValue: string; normalizedValue?: string }>;
  constraintResults?: Array<{
    constraintId: string;
    kind: string;
    strictness: string;
    satisfied: boolean;
    requestedTarget?: string;
    achievedValue?: string;
    deviation?: string;
    penaltyApplied?: string;
  }>;
  propertyResults?: Array<{
    targetId: string;
    property: string;
    value?: string;
    method?: string;
    dataCompleteness: string;
    classification: string;
    constraintStatus: string;
    laboratoryConfirmationRequired: boolean;
  }>;
  warnings?: Array<{ code: string; message: string }>;
  infeasibility?: { causes: Array<{ code: string; message: string; suggestedActions: string[] }> };
  solverMetadata?: { isMixedInteger: boolean; solveTimeMs: number };
  runId?: string;
}

export function AdvancedOptimizerPanel({
  formulation,
  batchKg,
  currentLines,
  onApplyResult,
}: {
  formulation: Formulation;
  batchKg: string;
  currentLines: FormulationLine[];
  onApplyResult: (lines: FormulationLine[], runCode: string) => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [prices, setPrices] = useState<MaterialPrice[]>([]);
  const [inventory, setInventory] = useState<InventoryRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [functional, setFunctional] = useState<FunctionalRow[]>([]);
  const [propertyTargets, setPropertyTargets] = useState<PropertyTargetRow[]>([]);
  const [costCeiling, setCostCeiling] = useState<string>("");
  const [objectives, setObjectives] = useState<ObjectiveRow[]>([
    { metric: "raw_material_cost", direction: "minimize", weight: "1" },
  ]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizeResult | null>(null);

  // ---------------------------------------------------------------- scenarios ---
  const [scenarios, setScenarios] = useState<OptimizationScenario[]>([]);
  const [profiles, setProfiles] = useState<OptimizationProfile[]>([]);
  const [runs, setRuns] = useState<OptimizationRun[]>([]);
  const [activeScenarioCode, setActiveScenarioCode] = useState<string | null>(null);
  const [scenarioNameInput, setScenarioNameInput] = useState("");
  const [selectedProfileCode, setSelectedProfileCode] = useState("");
  /** Constraints a loaded scenario or an applied profile contributed, beyond
   *  what this screen's own candidate/functional/objective editors cover —
   *  merged into every built problem, and shown as a plain read-only list
   *  (see "What this is not" in docs/ADVANCED_OPTIMIZER.md: there is no
   *  ratio/conditional/composition constraint builder here yet) rather than
   *  silently dropped. */
  const [profileExtras, setProfileExtras] = useState<{
    compositionConstraints: CompositionConstraint[];
    ratioConstraints: RatioConstraint[];
    conditionalConstraints: ConditionalConstraint[];
  }>({ compositionConstraints: [], ratioConstraints: [], conditionalConstraints: [] });
  const [compareSelection, setCompareSelection] = useState<Set<string>>(new Set());
  const [comparison, setComparison] = useState<ScenarioComparison | null>(null);
  const [confirmReplaceProfile, setConfirmReplaceProfile] = useState(false);
  const [scenarioBusy, setScenarioBusy] = useState(false);

  const currentScenarios = useMemo(() => currentScenariosByGroup(scenarios), [scenarios]);
  const activeScenario = useMemo(
    () => currentScenarios.find((s) => s.code === activeScenarioCode) ?? null,
    [currentScenarios, activeScenarioCode],
  );
  const scenarioRunHistory = useMemo(
    () => (activeScenario ? runs.filter((r) => r.scenarioId === activeScenario.scenarioGroupId) : []),
    [runs, activeScenario],
  );
  const scenarioNameByGroupId = useMemo(
    () => new Map(currentScenarios.map((s) => [s.scenarioGroupId, s.name])),
    [currentScenarios],
  );

  useEffect(() => {
    void (async () => {
      const [m, p, i, s, pf, r] = await Promise.all([
        listRecords("materials"),
        listRecords("material_prices"),
        listRecords("inventory"),
        listRecords("optimization_scenarios"),
        listRecordsSeeded("optimization_profiles", SEED_OPTIMIZATION_PROFILES),
        listRecords("optimization_runs"),
      ]);
      setMaterials(m);
      setPrices(p);
      setInventory(i);
      setScenarios(s);
      setProfiles(pf);
      setRuns(r.filter((run) => run.projectId === formulation.id));
      // Default candidate set: whatever the current draft already uses.
      const codes = new Set(currentLines.map((l) => l.materialCode).filter((c): c is string => !!c));
      setSelected(codes);
    })();
    // Only seed the default selection once, on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshScenarios = useCallback(async () => {
    setScenarios(await listRecords("optimization_scenarios"));
  }, []);

  const refreshRuns = useCallback(async () => {
    const r = await listRecords("optimization_runs");
    setRuns(r.filter((run) => run.projectId === formulation.id));
  }, [formulation.id]);

  const toggleMaterial = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const buildProblem = useCallback(() => {
    const asOf = new Date().toISOString();
    const chosen = materials.filter((m) => selected.has(m.code) && m.active);
    const { compatibilityRisk, safetyRisk } = gradedRiskScores(chosen, materials);
    const optMaterials = chosen.map((m) => {
      const priceChoice = priceFor(prices, m.code, asOf);
      const stockRecords = inventory.filter((r) => r.materialCode === m.code);
      const availableKg = stockRecords.reduce(
        (sum, r) => sum + (Number(r.quantity) - Number(r.reservedQuantity || "0")),
        0,
      );
      return {
        id: m.code,
        materialCode: m.code,
        name: m.displayName,
        price: priceChoice
          ? { value: priceChoice.price.price, state: "known" as const }
          : { state: "missing" as const },
        currency: priceChoice?.price.currency ?? "KES",
        activeMatterPercent: m.activeMatterPercent
          ? { value: m.activeMatterPercent, state: "known" as const }
          : { state: "missing" as const },
        functions: m.functions,
        ionicCharacter: m.ionicCharacter,
        maxUsePercent: m.recommendedMaxPercent,
        minUsePercent: m.recommendedMinPercent,
        technicalMaxPercent: m.technicalMaxPercent,
        stock: stockRecords.length > 0 ? { value: String(availableKg), state: "known" as const } : undefined,
        casNumbers: m.casNumbers,
        excluded: false,
        compatibilityRiskScore: compatibilityRisk[m.code],
        safetyRiskScore: safetyRisk[m.code],
      };
    });

    const problem: FormulationProblem = {
      schemaVersion: "1.0",
      id: newId("optprob"),
      projectId: formulation.id,
      productFamilyId: formulation.productFamilyCode,
      packagingSkuIds: formulation.targetSkuCodes,
      marketProfileIds: formulation.targetMarkets,
      batch: { sizeKg: batchKg },
      materials: optMaterials,
      compositionConstraints: [
        {
          id: "total",
          displayName: t("optimizer.totalConstraint"),
          constraintType: "total_equals_100",
          severity: "blocking",
          strictness: "hard",
          verificationStatus: "verified",
          active: true,
        },
        ...profileExtras.compositionConstraints,
      ],
      functionalConstraints: functional.map((f) => ({
        id: f.id,
        displayName: f.functionGroups.join(", "),
        functionGroups: f.functionGroups,
        basis: "raw_material",
        constraintType: f.constraintType,
        value: f.value,
        severity: "blocking",
        strictness: f.strictness,
        penaltyWeight: f.strictness === "soft" ? f.penaltyWeight : undefined,
        penaltyType: f.strictness === "soft" ? "linear_absolute" : undefined,
        allowedDeviation: f.strictness === "soft" ? f.allowedDeviation : undefined,
        verificationStatus: "not_verified",
        active: true,
      })),
      ratioConstraints: profileExtras.ratioConstraints,
      conditionalConstraints: [...blockingExclusionConstraints(chosen, materials), ...profileExtras.conditionalConstraints],
      propertyTargets: propertyTargets
        .filter((p) => p.minValue || p.maxValue)
        .map((p) => ({
          id: p.id,
          property: p.property,
          minValue: p.minValue || undefined,
          maxValue: p.maxValue || undefined,
          enforceAs: p.enforceAs === "reported_only" ? undefined : p.enforceAs,
          penaltyWeight: p.enforceAs === "soft" ? p.penaltyWeight : undefined,
          penaltyType: p.enforceAs === "soft" ? "linear_absolute" : undefined,
          requestedClassification: "calculated" as const,
        })),
      costCeiling: costCeiling ? { value: costCeiling, currency: "KES", penaltyWeight: "1" } : undefined,
      compatibilityPolicy: { mode: "exclude_blocking" },
      safetyPolicy: { mode: "exclude_blocking" },
      objectiveConfig: {
        type: "weighted",
        objectives: objectives.map((o) => ({ metric: o.metric, direction: o.direction, weight: o.weight })),
      },
      solverConfig: { solver: "cbc", timeoutSeconds: 30, cancellable: true, exportLpFile: false },
      precisionPolicyVersion: "1.0",
      createdAt: asOf,
    };
    return problem;
  }, [materials, selected, prices, inventory, formulation, batchKg, functional, propertyTargets, costCeiling, profileExtras, objectives, t]);

  const run = async () => {
    if (selected.size === 0) {
      setError(t("optimizer.needCandidates"));
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const problem = buildProblem();
      const res = (await runAdvancedFormulationOptimize(problem)) as OptimizeResult | null;
      if (!res) {
        setError(t("optimizer.desktopOnly"));
        return;
      }
      if (res.status === "error") {
        setError((res as { message?: string }).message ?? t("optimizer.errorTitle"));
        return;
      }
      setResult(res);
      if (USABLE_RESULT_STATUSES.has(res.status)) {
        const runCode = newId("optrun");
        // `res` at this point is a genuine solver AdvancedOptimizationResult
        // (that is exactly what an "optimal"/"feasible" status means) — the
        // frontend's `OptimizeResult` is a deliberately loose subset typed
        // just for what the panel renders, not a re-validation of the IPC
        // payload, so the full shape is asserted here rather than re-declared.
        await upsertRecords("optimization_runs", [
          {
            schemaVersion: "1.0",
            code: runCode,
            projectId: formulation.id,
            scenarioId: activeScenario?.scenarioGroupId,
            problem,
            result: { ...res, runId: res.runId ?? runCode } as unknown as AdvancedOptimizationResult,
            createdAt: new Date().toISOString(),
          },
        ]);
        setResult({ ...res, runId: runCode });
        // The scenario record itself is not touched by running it — its full,
        // append-only run history is every `OptimizationRun` whose
        // `scenarioId` matches this scenario's group (`scenarioRunHistory`),
        // not a field that would need a new scenario revision per run.
        await refreshRuns();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  const cancel = async () => {
    await cancelAdvancedFormulationOptimize();
    setRunning(false);
  };

  const apply = () => {
    if (!result?.formulaLines || !result.runId) return;
    const materialByCode = new Map(materials.map((m) => [m.code, m]));
    const newLines: FormulationLine[] = result.formulaLines.map((line, i) => {
      const mat = materialByCode.get(line.materialCode);
      return {
        id: newId("line"),
        lineNumber: i,
        phase: "A",
        materialId: line.materialId,
        materialCode: line.materialCode,
        displayName: line.name,
        tradeName: mat?.tradeName,
        inciName: mat?.inciName,
        functions: mat?.functions ?? [],
        percent: line.percent,
        isQsToHundred: false,
        activeMatterPercent: mat?.activeMatterPercent,
        technicalMaxPercent: mat?.technicalMaxPercent,
        provenance: {
          origin: "model_estimate" as const,
          evidenceClaimIds: [],
          notes: t("optimizer.provenanceNote", { runId: result.runId }),
        },
      };
    });
    onApplyResult(newLines, result.runId);
  };

  const addFunctionalRow = () => {
    setFunctional((rows) => [
      ...rows,
      {
        id: newId("func"),
        functionGroups: [],
        constraintType: "min_total",
        value: "0",
        strictness: "hard",
        penaltyWeight: "1",
        allowedDeviation: "0",
      },
    ]);
  };

  const addPropertyTargetRow = () => {
    setPropertyTargets((rows) => [
      ...rows,
      { id: newId("proptgt"), property: "active_matter", minValue: "", maxValue: "", enforceAs: "reported_only", penaltyWeight: "1" },
    ]);
  };

  const addObjectiveRow = () => {
    setObjectives((rows) => [...rows, { metric: "supply_risk", direction: "minimize", weight: "0.2" }]);
  };

  // ------------------------------------------------------------- scenarios ---

  const onNewScenario = async () => {
    if (!scenarioNameInput.trim()) return;
    setScenarioBusy(true);
    try {
      const asOf = new Date().toISOString();
      const s = createScenario({
        projectId: formulation.id,
        name: scenarioNameInput.trim(),
        sourceDraftId: formulation.id,
        problem: buildProblem(),
        priceSnapshotAt: asOf,
        inventorySnapshotAt: asOf,
      });
      await upsertRecords("optimization_scenarios", [s]);
      await refreshScenarios();
      setActiveScenarioCode(s.code);
      setScenarioNameInput("");
    } finally {
      setScenarioBusy(false);
    }
  };

  const onSaveScenario = async () => {
    if (!activeScenario) return;
    setScenarioBusy(true);
    try {
      const updated = saveScenarioRevision(activeScenario, { problem: buildProblem() });
      await upsertRecords("optimization_scenarios", [updated]);
      await refreshScenarios();
      setActiveScenarioCode(updated.code);
    } finally {
      setScenarioBusy(false);
    }
  };

  const onCloneScenario = async () => {
    if (!activeScenario) return;
    setScenarioBusy(true);
    try {
      const clone = cloneScenario(activeScenario, { name: `${activeScenario.name} (${t("optimizer.scenario.copySuffix")})` });
      await upsertRecords("optimization_scenarios", [clone]);
      await refreshScenarios();
      setActiveScenarioCode(clone.code);
    } finally {
      setScenarioBusy(false);
    }
  };

  const onRenameScenario = async () => {
    if (!activeScenario || !scenarioNameInput.trim()) return;
    setScenarioBusy(true);
    try {
      const renamed = renameScenario(activeScenario, scenarioNameInput.trim());
      await upsertRecords("optimization_scenarios", [renamed]);
      await refreshScenarios();
      setActiveScenarioCode(renamed.code);
      setScenarioNameInput("");
    } finally {
      setScenarioBusy(false);
    }
  };

  const onRetireScenario = async () => {
    if (!activeScenario) return;
    setScenarioBusy(true);
    try {
      const retired = retireScenario(activeScenario);
      await upsertRecords("optimization_scenarios", [retired]);
      await refreshScenarios();
      setActiveScenarioCode(null);
    } finally {
      setScenarioBusy(false);
    }
  };

  const onRestoreScenario = async (retired: OptimizationScenario) => {
    setScenarioBusy(true);
    try {
      const restored = restoreRetiredScenarioAsNew(retired);
      await upsertRecords("optimization_scenarios", [restored]);
      await refreshScenarios();
      setActiveScenarioCode(restored.code);
    } finally {
      setScenarioBusy(false);
    }
  };

  /** Load a scenario's problem back into this screen's own editor state —
   *  candidate selection, functional constraints and objectives round-trip
   *  exactly; everything else the problem carries that this screen has no
   *  editor for (ratio/conditional/composition constraints beyond the
   *  automatic ones) is preserved in `profileExtras` so it is still sent to
   *  the solver, never silently dropped. */
  const onLoadScenario = (scenario: OptimizationScenario) => {
    setActiveScenarioCode(scenario.code);
    setComparison(null);
    const p = scenario.problem;
    setSelected(new Set(p.materials.filter((m) => !m.excluded).map((m) => m.materialCode)));
    setFunctional(
      p.functionalConstraints.map((f) => ({
        id: f.id,
        functionGroups: f.functionGroups,
        constraintType: f.constraintType === "at_least_one_present" ? "min_total" : f.constraintType,
        value: f.value ?? "0",
        strictness: f.strictness === "soft" ? "soft" : "hard",
        penaltyWeight: f.penaltyWeight ?? "1",
        allowedDeviation: f.allowedDeviation ?? "0",
      })),
    );
    setPropertyTargets(
      p.propertyTargets.map((pt) => ({
        id: pt.id,
        property: pt.property,
        minValue: pt.minValue ?? "",
        maxValue: pt.maxValue ?? "",
        enforceAs: pt.enforceAs ?? "reported_only",
        penaltyWeight: pt.penaltyWeight ?? "1",
      })),
    );
    setCostCeiling(p.costCeiling?.value ?? "");
    setObjectives(p.objectiveConfig.objectives.map((o) => ({ metric: o.metric, direction: o.direction, weight: o.weight ?? "1" })));
    setProfileExtras({
      compositionConstraints: p.compositionConstraints.filter((c) => c.id !== "total"),
      ratioConstraints: p.ratioConstraints,
      conditionalConstraints: [], // regenerated live by blockingExclusionConstraints from the (now-reloaded) candidate set.
    });
  };

  const onApplyProfile = (mode: ProfileApplyMode) => {
    const profile = profiles.find((p) => p.code === selectedProfileCode);
    if (!profile) return;
    if (mode === "replace" && !confirmReplaceProfile) {
      setConfirmReplaceProfile(true);
      return;
    }
    setConfirmReplaceProfile(false);
    const result = applyProfileToProblem(buildProblem(), profile, mode);
    setProfileExtras({
      compositionConstraints: result.problem.compositionConstraints.filter((c) => c.id !== "total"),
      ratioConstraints: result.problem.ratioConstraints,
      conditionalConstraints: [],
    });
    setPropertyTargets(
      result.problem.propertyTargets.map((pt) => ({
        id: pt.id,
        property: pt.property,
        minValue: pt.minValue ?? "",
        maxValue: pt.maxValue ?? "",
        enforceAs: pt.enforceAs ?? "reported_only",
        penaltyWeight: pt.penaltyWeight ?? "1",
      })),
    );
    if (mode === "replace" && result.problem.objectiveConfig.objectives.length > 0) {
      setObjectives(
        result.problem.objectiveConfig.objectives.map((o) => ({ metric: o.metric, direction: o.direction, weight: o.weight ?? "1" })),
      );
    }
  };

  const toggleCompareRun = (code: string) => {
    setCompareSelection((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const runCompare = () => {
    const chosen = runs.filter((r) => compareSelection.has(r.code));
    if (chosen.length < 2) return;
    setComparison(compareOptimizationRuns(chosen, scenarioNameByGroupId));
  };

  const sortedMaterials = useMemo(
    () => [...materials].filter((m) => m.active).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [materials],
  );

  return (
    <div className="h-full overflow-auto px-5 py-4">
      <section className="mb-4 rounded-card border border-border bg-surface-2 p-3">
        <h3 className="mb-2 text-[12px] font-medium text-text">{t("optimizer.scenario.heading")}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={activeScenarioCode ?? ""}
            onChange={(e) => {
              const s = currentScenarios.find((x) => x.code === e.target.value);
              if (s) onLoadScenario(s);
              else {
                setActiveScenarioCode(null);
                setComparison(null);
              }
            }}
            aria-label={t("optimizer.scenario.selector")}
            className="rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text"
          >
            <option value="">{t("optimizer.scenario.none")}</option>
            {currentScenarios
              .filter((s) => s.status === "active")
              .map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
          </select>
          <input
            value={scenarioNameInput}
            onChange={(e) => setScenarioNameInput(e.target.value)}
            placeholder={t("optimizer.scenario.namePlaceholder")}
            className="rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text"
          />
          <button
            onClick={() => void onNewScenario()}
            disabled={scenarioBusy || !scenarioNameInput.trim()}
            className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface disabled:opacity-40"
          >
            {t("optimizer.scenario.new")}
          </button>
          {activeScenario && (
            <>
              <button
                onClick={() => void onSaveScenario()}
                disabled={scenarioBusy}
                className="rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
              >
                {t("optimizer.scenario.save")}
              </button>
              <button
                onClick={() => void onCloneScenario()}
                disabled={scenarioBusy}
                className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface disabled:opacity-40"
              >
                {t("optimizer.scenario.clone")}
              </button>
              <button
                onClick={() => void onRenameScenario()}
                disabled={scenarioBusy || !scenarioNameInput.trim()}
                className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface disabled:opacity-40"
              >
                {t("optimizer.scenario.rename")}
              </button>
              <button
                onClick={() => void onRetireScenario()}
                disabled={scenarioBusy}
                className="rounded-input border border-error/40 px-2 py-1 text-[11px] text-error hover:bg-error/10 disabled:opacity-40"
              >
                {t("optimizer.scenario.retire")}
              </button>
            </>
          )}
        </div>

        {currentScenarios.some((s) => s.status === "retired") && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <span>{t("optimizer.scenario.retiredHeading")}:</span>
            {currentScenarios
              .filter((s) => s.status === "retired")
              .map((s) => (
                <button
                  key={s.code}
                  onClick={() => void onRestoreScenario(s)}
                  className="rounded-input border border-border px-1.5 py-0.5 hover:bg-surface"
                >
                  {s.name} — {t("optimizer.scenario.restore")}
                </button>
              ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border-faint pt-2">
          <span className="text-[11px] font-medium text-muted">{t("optimizer.scenario.profileHeading")}</span>
          <select
            value={selectedProfileCode}
            onChange={(e) => {
              setSelectedProfileCode(e.target.value);
              setConfirmReplaceProfile(false);
            }}
            aria-label={t("optimizer.scenario.profileSelector")}
            className="rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text"
          >
            <option value="">{t("optimizer.scenario.profileNone")}</option>
            {profiles.map((p) => (
              <option key={p.code} value={p.code}>
                {p.displayName}
              </option>
            ))}
          </select>
          <button
            onClick={() => onApplyProfile("apply_missing")}
            disabled={!selectedProfileCode}
            className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface disabled:opacity-40"
          >
            {t("optimizer.scenario.applyMissing")}
          </button>
          <button
            onClick={() => onApplyProfile("merge")}
            disabled={!selectedProfileCode}
            className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface disabled:opacity-40"
          >
            {t("optimizer.scenario.merge")}
          </button>
          <button
            onClick={() => onApplyProfile("replace")}
            disabled={!selectedProfileCode}
            className={cn(
              "rounded-input border px-2 py-1 text-[11px] disabled:opacity-40",
              confirmReplaceProfile ? "border-error bg-error/10 text-error" : "border-border text-text hover:bg-surface",
            )}
          >
            {confirmReplaceProfile ? t("optimizer.scenario.replaceConfirm") : t("optimizer.scenario.replace")}
          </button>
          {selectedProfileCode && (
            <span className="text-[10px] text-muted">{t("optimizer.scenario.requiresChemistReview")}</span>
          )}
        </div>

        {(profileExtras.compositionConstraints.length > 0 ||
          profileExtras.ratioConstraints.length > 0 ||
          propertyTargets.length > 0) && (
          <p className="mt-2 text-[10px] text-muted">
            {t("optimizer.scenario.extrasNote", {
              composition: profileExtras.compositionConstraints.length,
              ratio: profileExtras.ratioConstraints.length,
              property: propertyTargets.length,
            })}
          </p>
        )}

        {scenarioRunHistory.length > 0 && (
          <div className="mt-3 border-t border-border-faint pt-2">
            <span className="text-[11px] font-medium text-muted">{t("optimizer.scenario.runHistory")}</span>
            <ul className="mt-1 space-y-1">
              {scenarioRunHistory.map((r) => (
                <li key={r.code} className="flex items-center gap-2 text-[11px] text-text">
                  <input
                    type="checkbox"
                    checked={compareSelection.has(r.code)}
                    onChange={() => toggleCompareRun(r.code)}
                    aria-label={t("optimizer.scenario.selectForCompare")}
                  />
                  <span>{r.code}</span>
                  <span className="text-muted">{r.result.status}</span>
                  <span className="text-muted tabular-nums">{r.result.totals?.totalRawMaterialCost ?? "—"}</span>
                  <span className="text-muted">{r.createdAt}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {runs.length >= 2 && (
          <div className="mt-3 border-t border-border-faint pt-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted">{t("optimizer.scenario.allRuns")}</span>
              <button
                onClick={runCompare}
                disabled={compareSelection.size < 2}
                className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface disabled:opacity-40"
              >
                {t("optimizer.scenario.compare")}
              </button>
            </div>
            <ul className="max-h-24 space-y-1 overflow-auto">
              {runs.map((r) => (
                <li key={r.code} className="flex items-center gap-2 text-[11px] text-text">
                  <input
                    type="checkbox"
                    checked={compareSelection.has(r.code)}
                    onChange={() => toggleCompareRun(r.code)}
                    aria-label={t("optimizer.scenario.selectForCompare")}
                  />
                  <span>{r.code}</span>
                  <span className="text-muted">{r.result.status}</span>
                  {r.scenarioId && <span className="text-muted">{scenarioNameByGroupId.get(r.scenarioId) ?? r.scenarioId}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {comparison && <ScenarioComparisonView comparison={comparison} t={t} />}
      </section>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 text-[12px] font-medium text-text">
            {t("optimizer.candidatesHeading", { count: selected.size })}
          </h3>
          <div className="max-h-48 overflow-auto rounded-card border border-border">
            {sortedMaterials.map((m) => (
              <label
                key={m.code}
                className="flex items-center gap-2 border-b border-border-faint px-2 py-1.5 text-[12px] last:border-0 hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={selected.has(m.code)}
                  onChange={() => toggleMaterial(m.code)}
                />
                <span className="truncate">{m.displayName}</span>
                <span className="ml-auto shrink-0 text-[10px] text-muted">{m.code}</span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[12px] font-medium text-text">{t("optimizer.functionalConstraints")}</h3>
            <button
              onClick={addFunctionalRow}
              className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2"
            >
              {t("optimizer.addConstraint")}
            </button>
          </div>
          <div className="space-y-1.5">
            {functional.map((row, idx) => (
              <div key={row.id} className="flex flex-wrap items-center gap-1.5 rounded-input border border-border px-2 py-1.5">
                <select
                  multiple
                  value={row.functionGroups}
                  onChange={(e) => {
                    const values = Array.from(e.target.selectedOptions, (o) => o.value as MaterialFunction);
                    setFunctional((rows) => rows.map((r, i) => (i === idx ? { ...r, functionGroups: values } : r)));
                  }}
                  className="h-14 w-40 rounded-input border border-border bg-surface text-[11px]"
                >
                  {FUNCTION_GROUP_OPTIONS.map((fg) => (
                    <option key={fg} value={fg}>
                      {fg}
                    </option>
                  ))}
                </select>
                <select
                  value={row.constraintType}
                  onChange={(e) =>
                    setFunctional((rows) =>
                      rows.map((r, i) => (i === idx ? { ...r, constraintType: e.target.value as "min_total" | "max_total" } : r)),
                    )
                  }
                  className="rounded-input border border-border bg-surface px-1 py-1 text-[11px]"
                >
                  <option value="min_total">{t("optimizer.minTotal")}</option>
                  <option value="max_total">{t("optimizer.maxTotal")}</option>
                </select>
                <input
                  value={row.value}
                  onChange={(e) =>
                    setFunctional((rows) => rows.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))
                  }
                  inputMode="decimal"
                  className="w-16 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                />
                <span className="text-[11px] text-muted">%</span>
              </div>
            ))}
            {functional.length === 0 && <p className="text-[11px] text-muted">{t("optimizer.noConstraints")}</p>}
          </div>
        </section>
      </div>

      <section className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[12px] font-medium text-text">{t("optimizer.propertyTargets")}</h3>
          <button
            onClick={addPropertyTargetRow}
            className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2"
          >
            {t("optimizer.addPropertyTarget")}
          </button>
        </div>
        <div className="space-y-1.5">
          {propertyTargets.map((row, idx) => (
            <div key={row.id} className="flex flex-wrap items-center gap-1.5 rounded-input border border-border px-2 py-1.5">
              <select
                value={row.property}
                onChange={(e) =>
                  setPropertyTargets((rows) => rows.map((r, i) => (i === idx ? { ...r, property: e.target.value as FormulationProperty } : r)))
                }
                className="rounded-input border border-border bg-surface px-1 py-1 text-[11px]"
              >
                {FORMULATION_PROPERTIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                value={row.minValue}
                onChange={(e) => setPropertyTargets((rows) => rows.map((r, i) => (i === idx ? { ...r, minValue: e.target.value } : r)))}
                placeholder={t("optimizer.minValue")}
                inputMode="decimal"
                className="w-16 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
              />
              <input
                value={row.maxValue}
                onChange={(e) => setPropertyTargets((rows) => rows.map((r, i) => (i === idx ? { ...r, maxValue: e.target.value } : r)))}
                placeholder={t("optimizer.maxValue")}
                inputMode="decimal"
                className="w-16 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
              />
              <select
                value={row.enforceAs}
                onChange={(e) =>
                  setPropertyTargets((rows) =>
                    rows.map((r, i) => (i === idx ? { ...r, enforceAs: e.target.value as PropertyTargetRow["enforceAs"] } : r)),
                  )
                }
                className="rounded-input border border-border bg-surface px-1 py-1 text-[11px]"
              >
                <option value="reported_only">{t("optimizer.reportedOnly")}</option>
                <option value="hard">{t("optimizer.hard")}</option>
                <option value="soft">{t("optimizer.soft")}</option>
              </select>
              {row.enforceAs === "soft" && (
                <input
                  value={row.penaltyWeight}
                  onChange={(e) =>
                    setPropertyTargets((rows) => rows.map((r, i) => (i === idx ? { ...r, penaltyWeight: e.target.value } : r)))
                  }
                  placeholder={t("optimizer.penaltyWeight")}
                  inputMode="decimal"
                  className="w-16 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                />
              )}
              <button
                onClick={() => setPropertyTargets((rows) => rows.filter((_, i) => i !== idx))}
                aria-label={t("common:actions.remove")}
                className="ml-auto text-[11px] text-muted hover:text-error"
              >
                ×
              </button>
            </div>
          ))}
          {propertyTargets.length === 0 && <p className="text-[11px] text-muted">{t("optimizer.noPropertyTargets")}</p>}
        </div>
        <label className="mt-2 flex items-center gap-1.5 text-[11px] text-text">
          {t("optimizer.costCeiling")}
          <input
            value={costCeiling}
            onChange={(e) => setCostCeiling(e.target.value)}
            inputMode="decimal"
            placeholder={t("optimizer.costCeilingPlaceholder")}
            className="w-24 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
          />
        </label>
      </section>

      <section className="mb-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[12px] font-medium text-text">{t("optimizer.objectives")}</h3>
          <button
            onClick={addObjectiveRow}
            className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2"
          >
            {t("optimizer.addObjective")}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {objectives.map((obj, idx) => (
            <div key={idx} className="flex items-center gap-1.5 rounded-input border border-border px-2 py-1.5">
              <select
                value={obj.metric}
                onChange={(e) =>
                  setObjectives((rows) => rows.map((r, i) => (i === idx ? { ...r, metric: e.target.value as OptimizationMetric } : r)))
                }
                className="rounded-input border border-border bg-surface px-1 py-1 text-[11px]"
              >
                {METRICS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                value={obj.direction}
                onChange={(e) =>
                  setObjectives((rows) => rows.map((r, i) => (i === idx ? { ...r, direction: e.target.value as ObjectiveDirection } : r)))
                }
                className="rounded-input border border-border bg-surface px-1 py-1 text-[11px]"
              >
                <option value="minimize">{t("optimizer.minimize")}</option>
                <option value="maximize">{t("optimizer.maximize")}</option>
              </select>
              <input
                value={obj.weight}
                onChange={(e) =>
                  setObjectives((rows) => rows.map((r, i) => (i === idx ? { ...r, weight: e.target.value } : r)))
                }
                inputMode="decimal"
                className="w-14 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                aria-label={t("optimizer.weight")}
              />
            </div>
          ))}
        </div>
      </section>

      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => void run()}
          disabled={running}
          className="flex items-center gap-1.5 rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
        >
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {running ? t("optimizer.running") : t("optimizer.run")}
        </button>
        {running && (
          <button
            onClick={() => void cancel()}
            className="flex items-center gap-1.5 rounded-input border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-2"
          >
            <Ban size={13} /> {t("optimizer.cancel")}
          </button>
        )}
        {result?.formulaLines && USABLE_RESULT_STATUSES.has(result.status) && (
          <button
            onClick={apply}
            className="flex items-center gap-1.5 rounded-input border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent/10"
          >
            <Wand2 size={13} /> {t("optimizer.applyToDraft")}
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-input bg-error/10 px-3 py-2 text-[12px] text-error">
          {error}
        </div>
      )}

      {result && <ResultView result={result} t={t} />}
    </div>
  );
}

const FUNCTION_GROUP_OPTIONS: MaterialFunction[] = [
  "anionic_surfactant",
  "nonionic_surfactant",
  "amphoteric_surfactant",
  "cationic_surfactant",
  "builder",
  "chelating_agent",
  "preservative",
  "fragrance",
  "conditioning_agent",
  "rheology_modifier",
  "ph_adjuster",
  "solvent",
  "disinfectant_active",
  "qac_active",
  "chlorhexidine_active",
  "fluoride_active",
];

function ResultView({
  result,
  t,
}: {
  result: OptimizeResult;
  t: TFunction<readonly ["session", "common"]>;
}) {
  if (result.status === "infeasible" && result.infeasibility) {
    return (
      <div className="rounded-card border border-error/40 bg-error/5 p-3">
        <p className="mb-2 text-[12px] font-medium text-error">{t("optimizer.infeasible")}</p>
        <ul className="space-y-2">
          {result.infeasibility.causes.map((c, i) => (
            <li key={i} className="text-[12px] text-text">
              <p>{c.message}</p>
              {c.suggestedActions.length > 0 && (
                <ul className="ml-4 mt-1 list-disc text-[11px] text-muted">
                  {c.suggestedActions.map((a, j) => (
                    <li key={j}>{a}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!USABLE_RESULT_STATUSES.has(result.status)) {
    return (
      <div className="rounded-card border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted">
        {t("optimizer.statusLabel")}: {result.status}
      </div>
    );
  }

  const softResults = (result.constraintResults ?? []).filter((c) => c.strictness === "soft");
  const violatedSoft = softResults.filter((c) => !c.satisfied);

  return (
    <div>
      {result.status === "feasible_with_penalties" && (
        <div role="status" className="mb-3 rounded-input border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
          {t("optimizer.feasibleWithPenalties", { count: violatedSoft.length })}
        </div>
      )}

      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] text-muted">
            <th className="py-1 font-medium">{t("optimizer.material")}</th>
            <th className="py-1 text-right font-medium">%</th>
            <th className="py-1 text-right font-medium">{t("optimizer.activeContribution")}</th>
            <th className="py-1 text-right font-medium">{t("optimizer.qty")}</th>
            <th className="py-1 text-right font-medium">{t("optimizer.cost")}</th>
          </tr>
        </thead>
        <tbody>
          {(result.formulaLines ?? []).map((l) => (
            <tr key={l.materialId} className="border-b border-border-faint">
              <td className="py-1 text-text">{l.name}</td>
              <td className="py-1 text-right tabular-nums">{l.percent}</td>
              <td className="py-1 text-right tabular-nums text-muted">{l.activeContributionPercent}</td>
              <td className="py-1 text-right tabular-nums text-muted">{l.quantityKg}</td>
              <td className="py-1 text-right tabular-nums text-muted">{l.rawMaterialCost ?? "—"}</td>
            </tr>
          ))}
        </tbody>
        {result.totals && (
          <tfoot>
            <tr className="text-[12px] font-medium">
              <td className="py-1.5">{t("optimizer.total")}</td>
              <td className="py-1.5 text-right tabular-nums">{result.totals.totalPercent}</td>
              <td className="py-1.5 text-right tabular-nums">{result.totals.totalActiveMatterPercent}</td>
              <td />
              <td className="py-1.5 text-right tabular-nums">{result.totals.totalRawMaterialCost ?? "—"}</td>
            </tr>
          </tfoot>
        )}
      </table>

      {result.objectiveResults && result.objectiveResults.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
          {result.objectiveResults.map((o, i) => (
            <span key={i} className="rounded-input border border-border px-2 py-1">
              {o.metric}: {o.rawValue}
            </span>
          ))}
        </div>
      )}

      {softResults.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-1 text-[11px] font-medium text-muted">{t("optimizer.softConstraints")}</h4>
          <ul className="space-y-1">
            {softResults.map((c) => (
              <li
                key={c.constraintId}
                className={cn(
                  "rounded-input border px-2 py-1.5 text-[11px]",
                  c.satisfied ? "border-border text-muted" : "border-warn/40 bg-warn/10 text-warn",
                )}
              >
                {c.constraintId} — {c.satisfied ? t("optimizer.satisfied") : t("optimizer.violated")}
                {c.requestedTarget !== undefined && (
                  <span className="ml-2 tabular-nums">
                    {t("optimizer.requestedVsAchieved", { requested: c.requestedTarget, achieved: c.achievedValue ?? "—" })}
                  </span>
                )}
                {c.deviation !== undefined && (
                  <span className="ml-2 tabular-nums">
                    {t("optimizer.deviation")}: {c.deviation}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.propertyResults && result.propertyResults.length > 0 && (
        <div className="mt-3">
          <h4 className="mb-1 text-[11px] font-medium text-muted">{t("optimizer.propertyResultsHeading")}</h4>
          <ul className="space-y-1">
            {result.propertyResults.map((p) => (
              <li key={p.targetId} className="rounded-input border border-border px-2 py-1.5 text-[11px] text-text">
                <span className="font-medium">{p.property}</span>: {p.value ?? t("optimizer.laboratoryRequired")}
                <span className="ml-2 text-muted">
                  ({p.classification}, {p.dataCompleteness}, {p.constraintStatus})
                </span>
                {p.laboratoryConfirmationRequired && (
                  <span className="ml-2 rounded bg-warn/10 px-1 py-0.5 text-warn">{t("optimizer.labConfirmationRequired")}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.warnings && result.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {result.warnings.map((w, i) => (
            <li key={i} className="rounded-input bg-warn/10 px-2 py-1.5 text-[11px] text-warn">
              {w.message}
            </li>
          ))}
        </ul>
      )}

      {result.solverMetadata?.isMixedInteger && (
        <p className="mt-3 text-[10px] text-muted">{t("optimizer.mixedIntegerNote")}</p>
      )}
    </div>
  );
}

const HIGHLIGHT_LABEL_KEY: Record<string, string> = {
  lowest_cost: "optimizer.scenario.highlightLowestCost",
  lowest_safety_risk: "optimizer.scenario.highlightLowestSafetyRisk",
  lowest_compatibility_risk: "optimizer.scenario.highlightLowestCompatibilityRisk",
  fewest_soft_violations: "optimizer.scenario.highlightFewestSoftViolations",
  highest_stock_utilization: "optimizer.scenario.highlightHighestStockUtilization",
};

/** Renders a `ScenarioComparison` — every row read straight from a
 *  persisted `OptimizationRun`'s own stored result, never re-solved. Never
 *  labels one row "best overall": only the per-rule highlights
 *  `compareOptimizationRuns` itself decided (see engine/scenarios.ts), each
 *  shown next to the row it belongs to. */
function ScenarioComparisonView({
  comparison,
  t,
}: {
  comparison: ScenarioComparison;
  t: TFunction<readonly ["session", "common"]>;
}) {
  const highlightsByRun = new Map<string, string[]>();
  for (const h of comparison.highlights) {
    const list = highlightsByRun.get(h.runCode) ?? [];
    const key = HIGHLIGHT_LABEL_KEY[h.rule] ?? h.rule;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- i18next's key union is too large for a dynamic lookup to narrow to.
    list.push(t(key as any));
    highlightsByRun.set(h.runCode, list);
  }

  return (
    <div className="mt-3 border-t border-border-faint pt-2">
      <h4 className="mb-1 text-[11px] font-medium text-muted">{t("optimizer.scenario.comparisonHeading")}</h4>
      <div className="overflow-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-1 font-medium">{t("optimizer.scenario.compareRun")}</th>
              <th className="py-1 font-medium">{t("optimizer.scenario.compareScenario")}</th>
              <th className="py-1 font-medium">{t("optimizer.statusLabel")}</th>
              <th className="py-1 text-right font-medium">{t("optimizer.cost")}</th>
              <th className="py-1 text-right font-medium">{t("optimizer.scenario.compareSoftViolations")}</th>
              <th className="py-1 text-right font-medium">{t("optimizer.scenario.compareCompatRisk")}</th>
              <th className="py-1 text-right font-medium">{t("optimizer.scenario.compareSafetyRisk")}</th>
              <th className="py-1 text-right font-medium">{t("optimizer.scenario.compareStockUtilization")}</th>
              <th className="py-1 text-right font-medium">{t("optimizer.scenario.compareMissingData")}</th>
              <th className="py-1 text-right font-medium">{t("optimizer.scenario.compareSolveTime")}</th>
              <th className="py-1 font-medium">{t("optimizer.scenario.compareHighlights")}</th>
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <tr key={row.runCode} className="border-b border-border-faint">
                <td className="py-1 text-text">{row.runCode}</td>
                <td className="py-1 text-muted">{row.scenarioName ?? "—"}</td>
                <td className="py-1 text-muted">{row.status}</td>
                <td className="py-1 text-right tabular-nums text-muted">{row.totalRawMaterialCost ?? "—"}</td>
                <td className="py-1 text-right tabular-nums text-muted">{row.softViolationCount}</td>
                <td className="py-1 text-right tabular-nums text-muted">{row.compatibilityRisk ?? "—"}</td>
                <td className="py-1 text-right tabular-nums text-muted">{row.safetyRisk ?? "—"}</td>
                <td className="py-1 text-right tabular-nums text-muted">{row.stockUtilization ?? "—"}</td>
                <td className="py-1 text-right tabular-nums text-muted">{row.missingDataWarningCount}</td>
                <td className="py-1 text-right tabular-nums text-muted">
                  {t("optimizer.scenario.compareSolveTimeValue", { ms: row.solveTimeMs.toFixed(0) })}
                </td>
                <td className="py-1 text-accent">{(highlightsByRun.get(row.runCode) ?? []).join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
