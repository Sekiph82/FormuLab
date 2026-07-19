import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Ban, Loader2, Play, Wand2 } from "lucide-react";
import {
  SEED_COMPATIBILITY_RULES,
  SEED_SAFETY_RULES,
  evaluateCompatibility,
  evaluateSafety,
  newId,
  priceFor,
  type AdvancedOptimizationResult,
  type ConditionalConstraint,
  type Formulation,
  type FormulationLine,
  type FormulationProblem,
  type InventoryRecord,
  type MaterialFunction,
  type MaterialPrice,
  type OptimizationMetric,
  type ObjectiveDirection,
  type RawMaterial,
} from "@ai4s/shared";
import { listRecords, upsertRecords } from "@/lib/masterdata";
import { runAdvancedFormulationOptimize, cancelAdvancedFormulationOptimize } from "@/lib/tauri";

const METRICS: OptimizationMetric[] = [
  "raw_material_cost",
  "landed_cost",
  "supply_risk",
  "carbon_score",
  "stock_utilization",
  "evidence_confidence",
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
  warnings?: Array<{ code: string; message: string }>;
  infeasibility?: { causes: Array<{ code: string; message: string; suggestedActions: string[] }> };
  solverMetadata?: { isMixedInteger: boolean; solveTimeMs: number };
  runId?: string;
}

/** Build a minimal, schema-valid two-line formulation so the real
 *  compatibility/safety engines can be asked "would these two candidates,
 *  substituted into a formula together, produce a blocking finding?" —
 *  this is the ONLY thing these synthetic lines are for; they are never
 *  displayed or persisted. */
function syntheticLine(m: RawMaterial, lineNumber: number): FormulationLine {
  return {
    id: `synthetic-${m.code}`,
    lineNumber,
    phase: "A",
    materialCode: m.code,
    displayName: m.displayName,
    functions: m.functions,
    percent: "10",
    isQsToHundred: false,
    activeMatterPercent: m.activeMatterPercent,
    provenance: { origin: "model_estimate", evidenceClaimIds: [] },
  };
}

/**
 * The real implementation of `compatibilityPolicy`/`safetyPolicy`'s
 * `"exclude_blocking"` mode (spec: "reuse the current Compatibility and
 * Safety engines... do not duplicate their rules inside the optimizer").
 * Every pair of candidate materials is checked with the SAME engines the
 * Compatibility/Safety tabs use; a pair that produces a `blocking` finding
 * becomes an `if_present_then_excluded` conditional constraint, so the
 * solver can never select both. O(n²) rule evaluations over the candidate
 * pool — fine at the pool sizes (tens of materials) this screen deals with,
 * not attempted for a full raw-material library.
 */
function blockingExclusionConstraints(
  chosen: RawMaterial[],
  allMaterials: RawMaterial[],
): ConditionalConstraint[] {
  const constraints: ConditionalConstraint[] = [];
  for (let i = 0; i < chosen.length; i++) {
    for (let j = i + 1; j < chosen.length; j++) {
      const a = chosen[i];
      const b = chosen[j];
      const lines = [syntheticLine(a, 0), syntheticLine(b, 1)];
      const compat = evaluateCompatibility(lines, SEED_COMPATIBILITY_RULES, { materials: allMaterials });
      const safety = evaluateSafety(lines, SEED_SAFETY_RULES, { materials: allMaterials });
      const blocked = compat.some((f) => f.severity === "blocking") || safety.some((f) => f.severity === "blocking");
      if (!blocked) continue;
      constraints.push({
        id: newId("cond"),
        displayName: `${a.code} excludes ${b.code}`,
        conditionType: "if_present_then_excluded",
        trigger: { materialId: a.code },
        target: { materialId: b.code },
        severity: "blocking",
        strictness: "hard",
        verificationStatus: "not_verified",
        presenceThresholdPercent: "0.001",
        active: true,
      });
    }
  }
  return constraints;
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
  const [objectives, setObjectives] = useState<ObjectiveRow[]>([
    { metric: "raw_material_cost", direction: "minimize", weight: "1" },
  ]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizeResult | null>(null);

  useEffect(() => {
    void (async () => {
      const [m, p, i] = await Promise.all([
        listRecords("materials"),
        listRecords("material_prices"),
        listRecords("inventory"),
      ]);
      setMaterials(m);
      setPrices(p);
      setInventory(i);
      // Default candidate set: whatever the current draft already uses.
      const codes = new Set(currentLines.map((l) => l.materialCode).filter((c): c is string => !!c));
      setSelected(codes);
    })();
    // Only seed the default selection once, on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      ],
      functionalConstraints: functional.map((f) => ({
        id: f.id,
        displayName: f.functionGroups.join(", "),
        functionGroups: f.functionGroups,
        basis: "raw_material",
        constraintType: f.constraintType,
        value: f.value,
        severity: "blocking",
        strictness: "hard",
        verificationStatus: "not_verified",
        active: true,
      })),
      ratioConstraints: [],
      conditionalConstraints: blockingExclusionConstraints(chosen, materials),
      propertyTargets: [],
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
  }, [materials, selected, prices, inventory, formulation, batchKg, functional, objectives, t]);

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
      if (res.status === "optimal" || res.status === "feasible") {
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
            problem,
            result: { ...res, runId: res.runId ?? runCode } as unknown as AdvancedOptimizationResult,
            createdAt: new Date().toISOString(),
          },
        ]);
        setResult({ ...res, runId: runCode });
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
      { id: newId("func"), functionGroups: [], constraintType: "min_total", value: "0" },
    ]);
  };

  const addObjectiveRow = () => {
    setObjectives((rows) => [...rows, { metric: "supply_risk", direction: "minimize", weight: "0.2" }]);
  };

  const sortedMaterials = useMemo(
    () => [...materials].filter((m) => m.active).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [materials],
  );

  return (
    <div className="h-full overflow-auto px-5 py-4">
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
        {result?.formulaLines && (result.status === "optimal" || result.status === "feasible") && (
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

  if (result.status !== "optimal" && result.status !== "feasible") {
    return (
      <div className="rounded-card border border-border bg-surface-2 px-3 py-2 text-[12px] text-muted">
        {t("optimizer.statusLabel")}: {result.status}
      </div>
    );
  }

  return (
    <div>
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
