import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Wand2, XCircle } from "lucide-react";
import {
  SEED_COMPATIBILITY_RULES,
  SEED_SAFETY_RULES,
  activeEquivalentPercent,
  buildCandidateRecord,
  evaluateCompatibility,
  evaluateSafety,
  newId,
  priceFor,
  rankCandidates,
  scoreCandidate,
  type Formulation,
  type FormulationLine,
  type InventoryRecord,
  type MaterialPrice,
  type RawMaterial,
  type Supplier,
  type SubstitutionCandidate,
  type SubstitutionCandidateInput,
  type SubstitutionReason,
} from "@ai4s/shared";
import { listRecords, upsertRecords } from "@/lib/masterdata";
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

export function SubstitutionDialog({
  formulation,
  line,
  allLines,
  onApply,
  onClose,
}: {
  formulation: Formulation;
  line: FormulationLine;
  allLines: FormulationLine[];
  onApply: (line: FormulationLine, runCode: string) => void;
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
        </div>
      </div>
    </div>
  );
}
