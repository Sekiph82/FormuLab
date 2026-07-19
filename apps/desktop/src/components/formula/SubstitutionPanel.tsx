import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Wand2, XCircle } from "lucide-react";
import {
  SEED_COMPATIBILITY_RULES,
  SEED_SAFETY_RULES,
  activeEquivalentPercent,
  blockingExclusionConstraints,
  buildCandidateRecord,
  buildSystemSubstitutionProblem,
  evaluateCompatibility,
  evaluateSafety,
  generateSystemCandidates,
  newId,
  priceFor,
  rankCandidates,
  scoreCandidate,
  scoreSystemResult,
  OPTIMIZER_FUNCTION_GROUPS,
  type AdvancedOptimizationResult,
  type Formulation,
  type FormulationLine,
  type FormulationProblem,
  type InventoryRecord,
  type MaterialFunction,
  type MaterialPrice,
  type OptimizationMaterial,
  type RawMaterial,
  type RejectedSystemCandidate,
  type Supplier,
  type SubstitutionCandidate,
  type SubstitutionCandidateInput,
  type SubstitutionReason,
  type SubstitutionRequest,
  type SystemCandidateLimits,
  type SystemCandidateProposal,
} from "@ai4s/shared";
import { listRecords, upsertRecords } from "@/lib/masterdata";
import { runAdvancedFormulationOptimize } from "@/lib/tauri";
import { cn } from "@/lib/cn";

const REASONS: SubstitutionReason[] = [
  "out_of_stock",
  "too_expensive",
  "supplier_risk",
  "long_lead_time",
  "regulatory_restriction",
  "compatibility_issue",
  "safety_issue",
  "performance_issue",
  "customer_requirement",
  "localization",
  "manual",
];

const DEFAULT_LIMITS: SystemCandidateLimits = {
  maxCandidateMaterials: 30,
  maxMaterialsPerSystem: 3,
  maxCandidateSystems: 8,
  maxSolverTimeSeconds: 15,
};

interface SystemResultEntry {
  proposal: SystemCandidateProposal;
  problem: FormulationProblem;
  result: AdvancedOptimizationResult;
  score: number;
}

export function SubstitutionDialog({
  formulation,
  line,
  allLines,
  onApply,
  onApplySystem,
  onClose,
}: {
  formulation: Formulation;
  line: FormulationLine;
  allLines: FormulationLine[];
  onApply: (line: FormulationLine, runCode: string) => void;
  /** Multi-material system substitution: replaces every line in
   *  `removedLineIds` with `newLines` in one step. Optional only so a
   *  caller that has not wired the multi-line draft-update path yet still
   *  compiles — every real call site should pass it (see FormulasPage.tsx). */
  onApplySystem?: (removedLineIds: string[], newLines: FormulationLine[], runCode: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [prices, setPrices] = useState<MaterialPrice[]>([]);
  const [inventory, setInventory] = useState<InventoryRecord[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [reason, setReason] = useState<SubstitutionReason>("manual");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [noBlockingOnly, setNoBlockingOnly] = useState(true);
  const [applying, setApplying] = useState(false);

  // ---------------------------------------------------------- system mode ---
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set([line.id]));
  const [preserveFunctions, setPreserveFunctions] = useState<MaterialFunction[]>([]);
  const [limits, setLimits] = useState<SystemCandidateLimits>(DEFAULT_LIMITS);
  const [systemCostCeiling, setSystemCostCeiling] = useState("");
  const [requireStock, setRequireStock] = useState(false);
  const [requireApprovedSupplier, setRequireApprovedSupplier] = useState(false);
  const [preferKenyaLocal, setPreferKenyaLocal] = useState(false);
  const [systemProposals, setSystemProposals] = useState<SystemCandidateProposal[]>([]);
  const [systemRejected, setSystemRejected] = useState<RejectedSystemCandidate[]>([]);
  const [systemResults, setSystemResults] = useState<SystemResultEntry[]>([]);
  const [systemGenerating, setSystemGenerating] = useState(false);
  const [systemError, setSystemError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [m, p, i, s] = await Promise.all([
        listRecords("materials"),
        listRecords("material_prices"),
        listRecords("inventory"),
        listRecords("suppliers"),
      ]);
      setMaterials(m);
      setPrices(p);
      setInventory(i);
      setSuppliers(s);
    })();
  }, []);

  const targetMaterial = materials.find((m) => m.code === line.materialCode);
  const asOf = new Date().toISOString();
  const isSystemMode = selectedLineIds.size > 1;
  const sourceLines = useMemo(() => allLines.filter((l) => selectedLineIds.has(l.id)), [allLines, selectedLineIds]);

  useEffect(() => {
    // Default the preserved-function set to the union of the selected
    // lines' own functions whenever the selection changes — the chemist can
    // still narrow or widen it afterward.
    const union = new Set<MaterialFunction>();
    for (const l of sourceLines) for (const f of l.functions) union.add(f);
    setPreserveFunctions([...union]);
    setSystemProposals([]);
    setSystemRejected([]);
    setSystemResults([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLineIds]);

  const toggleLine = (id: string) => {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (id !== line.id) next.delete(id); // the dialog's own line can never be deselected.
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const candidates = useMemo(() => {
    if (materials.length === 0) return [];
    const target = {
      materialId: line.materialId ?? line.id,
      materialCode: line.materialCode ?? "",
      linePercent: line.percent,
      functions: targetMaterial?.functions ?? line.functions,
      ionicCharacter: targetMaterial?.ionicCharacter,
      activeMatterPercent: line.activeMatterPercent ?? targetMaterial?.activeMatterPercent,
      hlb: targetMaterial?.hlb,
      phMin: targetMaterial?.phMin,
      phMax: targetMaterial?.phMax,
      landedCost: line.unitPrice,
    };

    const pool = materials.filter((m) => m.active && m.code !== line.materialCode);
    const scored: SubstitutionCandidate[] = pool.map((m) => {
      const priceChoice = priceFor(prices, m.code, asOf);
      const stockRecords = inventory.filter((r) => r.materialCode === m.code);
      const availableKg = stockRecords.reduce(
        (sum, r) => sum + (Number(r.quantity) - Number(r.reservedQuantity || "0")),
        0,
      );
      const substitutedLines = allLines.map((l) => (l.id === line.id ? { ...l, materialCode: m.code, functions: m.functions } : l));
      const compatFindings = evaluateCompatibility(substitutedLines, SEED_COMPATIBILITY_RULES, { materials });
      const safetyFindings = evaluateSafety(substitutedLines, SEED_SAFETY_RULES, { materials });

      const input: SubstitutionCandidateInput = {
        materialId: m.code,
        materialCode: m.code,
        name: m.displayName,
        functions: m.functions,
        ionicCharacter: m.ionicCharacter,
        activeMatterPercent: m.activeMatterPercent,
        hlb: m.hlb,
        phMin: m.phMin,
        phMax: m.phMax,
        recommendedMinPercent: m.recommendedMinPercent,
        recommendedMaxPercent: m.recommendedMaxPercent,
        technicalMaxPercent: m.technicalMaxPercent,
        landedCost: priceChoice?.price.price,
        currency: priceChoice?.price.currency,
        availableStockKg: stockRecords.length > 0 ? String(availableKg) : undefined,
        supplierApproved: suppliers.find((s) => s.code === priceChoice?.price.supplierCode)?.approved,
        kenyaLocal: suppliers.find((s) => s.code === priceChoice?.price.supplierCode)?.country === "Kenya",
        compatibilityFindingIds: compatFindings.map((f) => f.id),
        hasBlockingCompatibilityFinding: compatFindings.some((f) => f.severity === "blocking"),
        safetyFindingIds: safetyFindings.map((f) => f.id),
        hasBlockingSafetyFinding: safetyFindings.some((f) => f.severity === "blocking"),
      };

      const result = scoreCandidate(target, input);
      return buildCandidateRecord(target, input, result);
    });

    let filtered = scored;
    if (inStockOnly) filtered = filtered.filter((c) => c.stockAvailable !== false);
    if (approvedOnly) filtered = filtered.filter((c) => !c.hasBlockingCompatibilityFinding); // approved-supplier proxy folded into ranking reason
    if (noBlockingOnly) filtered = filtered.filter((c) => !c.hasBlockingCompatibilityFinding && !c.hasBlockingSafetyFinding);

    return rankCandidates(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materials, prices, inventory, suppliers, line, allLines, inStockOnly, approvedOnly, noBlockingOnly]);

  const apply = async (candidate: SubstitutionCandidate) => {
    setApplying(true);
    try {
      const runCode = newId("subrun");
      const requestedAt = new Date().toISOString();
      await upsertRecords("substitution_runs", [
        {
          schemaVersion: "1.0",
          code: runCode,
          projectId: formulation.id,
          request: {
            schemaVersion: "1.0",
            code: newId("subreq"),
            projectId: formulation.id,
            formulaVersionId: formulation.currentVersionId ?? "",
            lineId: line.id,
            materialId: line.materialId ?? line.id,
            reason,
            targetMarketIds: formulation.targetMarkets,
            preserveActiveContribution: true,
            preserveFunction: true,
            requestedAt,
            requestedBy: "local",
          },
          result: {
            schemaVersion: "1.0",
            requestCode: newId("subreq"),
            status: "candidates_found",
            candidates,
            recommendedCandidateId: candidates[0]?.id,
            rejectedSystemCandidates: [],
            warnings: [],
            computedAt: requestedAt,
          },
          selectedCandidateId: candidate.id,
          appliedAt: requestedAt,
          appliedToDraftBy: "local",
          createdAt: requestedAt,
        },
      ]);

      const newMaterial = materials.find((m) => m.code === candidate.materialCode);
      const suggestedPercent =
        candidate.activeEquivalentPercent ??
        activeEquivalentPercent(line.percent, line.activeMatterPercent, newMaterial?.activeMatterPercent) ??
        line.percent;
      const newLine: FormulationLine = {
        ...line,
        materialId: candidate.materialId,
        materialCode: candidate.materialCode,
        displayName: candidate.name,
        tradeName: newMaterial?.tradeName,
        inciName: newMaterial?.inciName,
        functions: newMaterial?.functions ?? line.functions,
        percent: suggestedPercent,
        activeMatterPercent: newMaterial?.activeMatterPercent,
        technicalMaxPercent: newMaterial?.technicalMaxPercent,
        provenance: {
          origin: "model_estimate",
          evidenceClaimIds: [],
          notes: t("substitution.provenanceNote", { runId: runCode }),
        },
      };
      onApply(newLine, runCode);
    } finally {
      setApplying(false);
    }
  };

  // -------------------------------------------------- system substitution ---

  function toOptimizationMaterial(m: RawMaterial, over: Partial<OptimizationMaterial> = {}): OptimizationMaterial {
    const priceChoice = priceFor(prices, m.code, asOf);
    const stockRecords = inventory.filter((r) => r.materialCode === m.code);
    const availableKg = stockRecords.reduce((sum, r) => sum + (Number(r.quantity) - Number(r.reservedQuantity || "0")), 0);
    return {
      id: m.code,
      materialCode: m.code,
      name: m.displayName,
      price: priceChoice ? { value: priceChoice.price.price, state: "known" } : { state: "missing" },
      currency: priceChoice?.price.currency ?? "KES",
      activeMatterPercent: m.activeMatterPercent ? { value: m.activeMatterPercent, state: "known" } : { state: "missing" },
      functions: m.functions,
      ionicCharacter: m.ionicCharacter,
      maxUsePercent: m.recommendedMaxPercent,
      minUsePercent: m.recommendedMinPercent,
      technicalMaxPercent: m.technicalMaxPercent,
      stock: stockRecords.length > 0 ? { value: String(availableKg), state: "known" } : undefined,
      casNumbers: m.casNumbers,
      excluded: true,
      ...over,
    };
  }

  /** Every material NOT among the source lines being replaced: the
   *  unaffected formula lines (locked at their current percentage) plus the
   *  full replacement candidate pool (excluded, until a specific proposal's
   *  members are un-excluded per solve — see `buildSystemSubstitutionProblem`). */
  const buildSystemBasis = () => {
    const sourceCodes = new Set(sourceLines.map((l) => l.materialCode).filter((c): c is string => !!c));
    const lockedLines = allLines.filter((l) => !selectedLineIds.has(l.id) && l.materialCode);
    const lockedCodes = new Set(lockedLines.map((l) => l.materialCode));
    const lockedMaterials = lockedLines.map((l) => {
      const m = materials.find((mm) => mm.code === l.materialCode);
      return m
        ? toOptimizationMaterial(m, { excluded: false, lockedPercent: l.percent })
        : {
            id: l.materialCode!,
            materialCode: l.materialCode!,
            name: l.displayName,
            price: { state: "missing" as const },
            currency: "KES",
            activeMatterPercent: l.activeMatterPercent ? { value: l.activeMatterPercent, state: "known" as const } : { state: "missing" as const },
            functions: l.functions,
            casNumbers: [],
            excluded: false,
            lockedPercent: l.percent,
          };
    });
    const poolMaterials = materials
      .filter((m) => m.active && !sourceCodes.has(m.code) && !lockedCodes.has(m.code))
      .map((m) => toOptimizationMaterial(m));

    const allCandidates = [...lockedMaterials, ...poolMaterials];

    const problem: FormulationProblem = {
      schemaVersion: "1.0",
      id: newId("subsysprob"),
      projectId: formulation.id,
      productFamilyId: formulation.productFamilyCode,
      packagingSkuIds: formulation.targetSkuCodes,
      marketProfileIds: formulation.targetMarkets,
      batch: { sizeKg: formulation.targetBatchKg ?? "100" },
      materials: allCandidates,
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
      functionalConstraints: [],
      ratioConstraints: [],
      conditionalConstraints: blockingExclusionConstraints(
        materials.filter((m) => allCandidates.some((c) => c.materialCode === m.code)),
        materials,
      ),
      propertyTargets: [],
      compatibilityPolicy: { mode: "exclude_blocking" },
      safetyPolicy: { mode: "exclude_blocking" },
      objectiveConfig: { type: "weighted", objectives: [{ metric: "raw_material_cost", direction: "minimize", weight: "1" }] },
      solverConfig: { solver: "cbc", timeoutSeconds: limits.maxSolverTimeSeconds, cancellable: true, exportLpFile: false },
      precisionPolicyVersion: "1.0",
      createdAt: asOf,
    };
    return problem;
  };

  const buildRequest = (): SubstitutionRequest => ({
    schemaVersion: "1.0",
    code: newId("subreq"),
    projectId: formulation.id,
    formulaVersionId: formulation.currentVersionId ?? "",
    lineId: line.id,
    materialId: line.materialId ?? line.id,
    lineIds: [...selectedLineIds],
    materialIds: sourceLines.map((l) => l.materialId ?? l.id),
    reason,
    targetMarketIds: formulation.targetMarkets,
    preserveActiveContribution: true,
    preserveFunction: true,
    preserveFunctions,
    maxReplacementMaterials: limits.maxMaterialsPerSystem,
    costCeiling: systemCostCeiling || undefined,
    requireStock,
    requireApprovedSupplier,
    preferKenyaLocal,
    requestedAt: new Date().toISOString(),
    requestedBy: "local",
  });

  const generateSystems = () => {
    setSystemGenerating(true);
    setSystemError(null);
    setSystemResults([]);
    try {
      const sourceCodes = new Set(sourceLines.map((l) => l.materialCode).filter((c): c is string => !!c));
      const pool = materials
        .filter((m) => m.active && !sourceCodes.has(m.code))
        .map((m) => {
          const priceChoice = priceFor(prices, m.code, asOf);
          const stockRecords = inventory.filter((r) => r.materialCode === m.code);
          const availableKg = stockRecords.reduce((sum, r) => sum + (Number(r.quantity) - Number(r.reservedQuantity || "0")), 0);
          return {
            materialId: m.code,
            materialCode: m.code,
            functions: m.functions,
            stockAvailableKg: stockRecords.length > 0 ? String(availableKg) : undefined,
            supplierApproved: suppliers.find((s) => s.code === priceChoice?.price.supplierCode)?.approved,
            kenyaLocal: suppliers.find((s) => s.code === priceChoice?.price.supplierCode)?.country === "Kenya",
          };
        });
      const { proposals, rejected } = generateSystemCandidates(
        { sourceMaterialIds: sourceLines.map((l) => l.materialCode ?? l.id), preserveFunctions },
        pool,
        limits,
        { requireStock, requireApprovedSupplier, preferKenyaLocal },
      );
      setSystemProposals(proposals);
      setSystemRejected(rejected);
    } finally {
      setSystemGenerating(false);
    }
  };

  const runSystemProposals = async () => {
    setSystemGenerating(true);
    setSystemError(null);
    const request = buildRequest();
    const basis = buildSystemBasis();
    const originalActive = sourceLines.reduce((sum, l) => {
      const active = l.activeMatterPercent !== undefined ? Number(l.activeMatterPercent) : undefined;
      return active !== undefined ? sum + (Number(l.percent) * active) / 100 : sum;
    }, 0);
    const results: SystemResultEntry[] = [];
    try {
      for (const proposal of systemProposals) {
        const problem = buildSystemSubstitutionProblem({
          baseProblem: basis,
          sourceMaterialIds: sourceLines.map((l) => l.materialCode ?? l.id),
          proposal,
          request,
          originalActiveContributionPercent: originalActive > 0 ? String(originalActive) : undefined,
        });
        try {
          const res = (await runAdvancedFormulationOptimize(problem)) as AdvancedOptimizationResult | null;
          if (!res || (res as unknown as { status: string }).status === "error") continue;
          const { totalScore } = scoreSystemResult(res, undefined);
          results.push({ proposal, problem, result: res, score: totalScore });
        } catch (e) {
          setSystemError(String(e));
        }
      }
      results.sort((a, b) => b.score - a.score);
      setSystemResults(results);
    } finally {
      setSystemGenerating(false);
    }
  };

  const applySystem = async (entry: SystemResultEntry) => {
    if (!onApplySystem) return;
    setApplying(true);
    try {
      const runCode = newId("subrun");
      const optRunCode = newId("optrun");
      const requestedAt = new Date().toISOString();
      const request = buildRequest();

      await upsertRecords("optimization_runs", [
        {
          schemaVersion: "1.0",
          code: optRunCode,
          projectId: formulation.id,
          problem: entry.problem,
          result: entry.result,
          createdAt: requestedAt,
        },
      ]);

      const candidateRecord: SubstitutionCandidate = {
        id: entry.proposal.materialIds.join("+"),
        name: entry.proposal.materialCodes.join(" + "),
        isSystem: true,
        systemMaterialIds: entry.proposal.materialIds,
        totalScore: entry.score,
        scoreDimensions: [],
        compatibilityFindingIds: [],
        safetyFindingIds: [],
        hasBlockingCompatibilityFinding: false,
        hasBlockingSafetyFinding: false,
        regulatoryUncertain: false,
        rankingReason: t("substitution.system.scoreReason", { score: (entry.score * 100).toFixed(0), status: entry.result.status }),
        requiredFormulaChanges: entry.result.formulaLines
          .filter((l) => entry.proposal.materialCodes.includes(l.materialCode))
          .map((l) => ({ materialCode: l.materialCode, description: `${l.materialCode} ${l.percent}%` })),
        requiresOptimization: true,
      };

      await upsertRecords("substitution_runs", [
        {
          schemaVersion: "1.0",
          code: runCode,
          projectId: formulation.id,
          request,
          result: {
            schemaVersion: "1.0",
            requestCode: request.code,
            status: "candidates_found",
            candidates: [candidateRecord],
            recommendedCandidateId: candidateRecord.id,
            rejectedSystemCandidates: systemRejected,
            candidateLimits: limits,
            warnings: [],
            computedAt: requestedAt,
          },
          selectedCandidateId: candidateRecord.id,
          appliedAt: requestedAt,
          appliedToDraftBy: "local",
          optimizationRunCode: optRunCode,
          createdAt: requestedAt,
        },
      ]);

      const materialByCode = new Map(materials.map((m) => [m.code, m]));
      const removedLineIds = sourceLines.map((l) => l.id);
      const newLines: FormulationLine[] = entry.result.formulaLines
        .filter((l) => entry.proposal.materialCodes.includes(l.materialCode))
        .map((l, i) => {
          const mat = materialByCode.get(l.materialCode);
          return {
            id: newId("line"),
            lineNumber: i,
            phase: line.phase,
            materialId: l.materialId,
            materialCode: l.materialCode,
            displayName: l.name,
            tradeName: mat?.tradeName,
            inciName: mat?.inciName,
            functions: mat?.functions ?? [],
            percent: l.percent,
            isQsToHundred: false,
            activeMatterPercent: mat?.activeMatterPercent,
            technicalMaxPercent: mat?.technicalMaxPercent,
            provenance: {
              origin: "model_estimate" as const,
              evidenceClaimIds: [],
              notes: t("substitution.provenanceNote", { runId: runCode }),
            },
          };
        });
      onApplySystem(removedLineIds, newLines, runCode);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("substitution.title")}
    >
      <div className="my-auto w-[52rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-[14px] font-medium text-text">
            {t("substitution.title")} — {line.displayName}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-text" aria-label={t("common:actions.cancel")}>
            <XCircle size={16} />
          </button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto px-5 py-4">
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted">{t("substitution.reason")}</span>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as SubstitutionReason)}
                className="rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text"
              >
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-text">
              <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
              {t("substitution.filterInStock")}
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-text">
              <input type="checkbox" checked={approvedOnly} onChange={(e) => setApprovedOnly(e.target.checked)} />
              {t("substitution.filterApproved")}
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-text">
              <input type="checkbox" checked={noBlockingOnly} onChange={(e) => setNoBlockingOnly(e.target.checked)} />
              {t("substitution.filterNoBlocking")}
            </label>
          </div>

          {candidates.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted">{t("substitution.noCandidates")}</p>
          ) : (
            <ul className="space-y-2">
              {candidates.map((c) => (
                <li
                  key={c.id}
                  className={cn(
                    "rounded-card border px-3 py-2.5",
                    c.hasBlockingCompatibilityFinding || c.hasBlockingSafetyFinding
                      ? "border-error/40 bg-error/5"
                      : "border-border bg-surface-2",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[12px] font-medium text-text">
                        {c.hasBlockingCompatibilityFinding || c.hasBlockingSafetyFinding ? (
                          <XCircle size={13} className="text-error" />
                        ) : (
                          <CheckCircle2 size={13} className="text-accent" />
                        )}
                        {c.name}
                        <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted">
                          {(c.totalScore * 100).toFixed(0)}%
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted">{c.rankingReason}</p>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
                        <span>
                          {t("substitution.suggestedPercent")}: {c.suggestedPercent ?? "—"}%
                        </span>
                        {c.activeEquivalentPercent && (
                          <span>
                            {t("substitution.activeEquivalent")}: {c.activeEquivalentPercent}%
                          </span>
                        )}
                        {c.costImpact && (
                          <span>
                            {t("substitution.costImpact")}: {c.costImpact}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {c.scoreDimensions
                          .filter((d) => !d.missingData)
                          .map((d) => (
                            <span
                              key={d.dimension}
                              title={d.explanation}
                              className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted"
                            >
                              {d.dimension}: {((d.normalizedScore ?? 0) * 100).toFixed(0)}%
                            </span>
                          ))}
                      </div>
                    </div>
                    <button
                      onClick={() => void apply(c)}
                      disabled={applying}
                      className="flex shrink-0 items-center gap-1.5 rounded-input border border-accent px-2.5 py-1.5 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
                    >
                      <Wand2 size={12} /> {t("substitution.apply")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <section className="mt-5 rounded-card border border-border bg-surface-2 p-3">
            <h3 className="mb-2 text-[12px] font-medium text-text">{t("substitution.system.heading")}</h3>

            <div className="mb-2">
              <span className="mb-1 block text-[11px] font-medium text-muted">{t("substitution.system.selectLines")}</span>
              <div className="max-h-28 overflow-auto rounded-input border border-border">
                {allLines
                  .filter((l) => l.materialCode)
                  .map((l) => (
                    <label
                      key={l.id}
                      className="flex items-center gap-2 border-b border-border-faint px-2 py-1 text-[11px] last:border-0 hover:bg-surface"
                    >
                      <input
                        type="checkbox"
                        checked={selectedLineIds.has(l.id)}
                        disabled={l.id === line.id}
                        onChange={() => toggleLine(l.id)}
                      />
                      <span className="truncate">{l.displayName}</span>
                      <span className="ml-auto shrink-0 text-muted">{l.percent}%</span>
                    </label>
                  ))}
              </div>
            </div>

            <div className="mb-2">
              <span className="mb-1 block text-[11px] font-medium text-muted">{t("substitution.system.preserveFunctions")}</span>
              <select
                multiple
                value={preserveFunctions}
                onChange={(e) => setPreserveFunctions(Array.from(e.target.selectedOptions, (o) => o.value as MaterialFunction))}
                className="h-16 w-full rounded-input border border-border bg-surface text-[11px]"
              >
                {OPTIMIZER_FUNCTION_GROUPS.map((fg) => (
                  <option key={fg} value={fg}>
                    {fg}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-text">
              <label className="flex items-center gap-1">
                {t("substitution.system.maxMaterials")}
                <input
                  value={limits.maxCandidateMaterials}
                  onChange={(e) => setLimits((l) => ({ ...l, maxCandidateMaterials: Number(e.target.value) || 1 }))}
                  inputMode="numeric"
                  className="w-14 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                />
              </label>
              <label className="flex items-center gap-1">
                {t("substitution.system.maxPerSystem")}
                <input
                  value={limits.maxMaterialsPerSystem}
                  onChange={(e) => setLimits((l) => ({ ...l, maxMaterialsPerSystem: Number(e.target.value) || 1 }))}
                  inputMode="numeric"
                  className="w-14 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                />
              </label>
              <label className="flex items-center gap-1">
                {t("substitution.system.maxSystems")}
                <input
                  value={limits.maxCandidateSystems}
                  onChange={(e) => setLimits((l) => ({ ...l, maxCandidateSystems: Number(e.target.value) || 1 }))}
                  inputMode="numeric"
                  className="w-14 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                />
              </label>
              <label className="flex items-center gap-1">
                {t("substitution.system.costCeiling")}
                <input
                  value={systemCostCeiling}
                  onChange={(e) => setSystemCostCeiling(e.target.value)}
                  inputMode="decimal"
                  className="w-20 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
                />
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={requireStock} onChange={(e) => setRequireStock(e.target.checked)} />
                {t("substitution.system.requireStock")}
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={requireApprovedSupplier}
                  onChange={(e) => setRequireApprovedSupplier(e.target.checked)}
                />
                {t("substitution.system.requireApprovedSupplier")}
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={preferKenyaLocal} onChange={(e) => setPreferKenyaLocal(e.target.checked)} />
                {t("substitution.system.preferKenyaLocal")}
              </label>
            </div>

            <div className="mb-2 flex items-center gap-2">
              <button
                onClick={generateSystems}
                disabled={systemGenerating || !isSystemMode}
                className="rounded-input border border-border px-2.5 py-1.5 text-[11px] text-text hover:bg-surface disabled:opacity-40"
              >
                {t("substitution.system.generate")}
              </button>
              <button
                onClick={() => void runSystemProposals()}
                disabled={systemGenerating || systemProposals.length === 0}
                className="rounded-input border border-accent px-2.5 py-1.5 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
              >
                {t("substitution.system.evaluate")}
              </button>
              {!isSystemMode && <span className="text-[10px] text-muted">{t("substitution.system.needMultipleLines")}</span>}
            </div>

            {systemError && (
              <div role="alert" className="mb-2 rounded-input bg-error/10 px-2 py-1.5 text-[11px] text-error">
                {systemError}
              </div>
            )}

            {systemProposals.length > 0 && systemResults.length === 0 && (
              <p className="mb-2 text-[11px] text-muted">
                {t("substitution.system.proposalsGenerated", { count: systemProposals.length })}
              </p>
            )}

            {systemRejected.length > 0 && (
              <div className="mb-2">
                <span className="text-[11px] font-medium text-muted">{t("substitution.system.rejectedHeading")}</span>
                <ul className="mt-1 space-y-1">
                  {systemRejected.map((r, i) => (
                    <li key={i} className="rounded-input border border-border-faint px-2 py-1 text-[10px] text-muted">
                      {r.materialCodes.join(" + ") || t("substitution.system.noneMatch")} — {r.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {systemResults.length > 0 && (
              <ul className="space-y-2">
                {systemResults.map((entry) => (
                  <li
                    key={entry.proposal.materialIds.join("+")}
                    className={cn(
                      "rounded-card border px-3 py-2.5",
                      entry.result.status === "infeasible" ? "border-error/40 bg-error/5" : "border-border bg-surface",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[12px] font-medium text-text">
                          {entry.result.status === "infeasible" ? (
                            <XCircle size={13} className="text-error" />
                          ) : (
                            <CheckCircle2 size={13} className="text-accent" />
                          )}
                          {entry.proposal.materialCodes.join(" + ")}
                          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                            {(entry.score * 100).toFixed(0)}%
                          </span>
                          <span className="text-[10px] text-muted">{entry.result.status}</span>
                        </div>
                        {entry.result.status === "infeasible" ? (
                          <ul className="ml-4 mt-1 list-disc text-[11px] text-muted">
                            {(entry.result.infeasibility?.causes ?? []).map((c, i) => (
                              <li key={i}>{c.message}</li>
                            ))}
                          </ul>
                        ) : (
                          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
                            <span>
                              {t("optimizer.cost")}: {entry.result.totals?.totalRawMaterialCost ?? "—"}
                            </span>
                            <span>
                              {t("optimizer.statusLabel")}: {entry.result.status}
                            </span>
                            {entry.result.constraintResults.some((c) => c.strictness === "soft" && !c.satisfied) && (
                              <span className="text-warn">{t("optimizer.softConstraints")}</span>
                            )}
                          </div>
                        )}
                      </div>
                      {entry.result.status !== "infeasible" && onApplySystem && (
                        <button
                          onClick={() => void applySystem(entry)}
                          disabled={applying}
                          className="flex shrink-0 items-center gap-1.5 rounded-input border border-accent px-2.5 py-1.5 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
                        >
                          <Wand2 size={12} /> {t("substitution.apply")}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
