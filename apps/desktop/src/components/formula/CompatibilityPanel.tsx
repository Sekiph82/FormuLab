import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, RefreshCw } from "lucide-react";
import {
  SEED_COMPATIBILITY_RULES,
  buildKenyaCatalog,
  evaluateCompatibility,
  newId,
  summarizeCompatibilityFindings,
  type CompatibilityFinding,
  type CompatibilityRule,
  type Formulation,
  type FormulationLine,
  type PackagingBom,
  type PackagingComponent,
  type RawMaterial,
  type RuleSeverity,
} from "@ai4s/shared";
import { listRecords, listRecordsSeeded, upsertRecords } from "@/lib/masterdata";
import { RuleManager } from "./RuleManager";
import { cn } from "@/lib/cn";

const SEVERITY_TONE: Record<RuleSeverity, string> = {
  blocking: "border-error/50 bg-error/10 text-error",
  error: "border-error/40 bg-error/5 text-error",
  warning: "border-warn/40 bg-warn/5 text-warn",
  info: "border-border bg-surface-2 text-muted",
};

const SEVERITIES: readonly RuleSeverity[] = ["blocking", "error", "warning", "info"];

export function CompatibilityPanel({
  formulation,
  versionId,
  lines,
  onFocusLine,
}: {
  formulation: Formulation;
  versionId?: string;
  lines: FormulationLine[];
  onFocusLine: (lineId: string) => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [tab, setTab] = useState<"findings" | "rules">("findings");
  const [rules, setRules] = useState<CompatibilityRule[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [boms, setBoms] = useState<PackagingBom[]>([]);
  const [components, setComponents] = useState<PackagingComponent[]>([]);
  const [phTarget, setPhTarget] = useState("");
  const [processTempC, setProcessTempC] = useState("");
  const [severityFilter, setSeverityFilter] = useState<RuleSeverity | "">("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [r, m, b, c] = await Promise.all([
      listRecordsSeeded("compatibility_rules", SEED_COMPATIBILITY_RULES),
      listRecords("materials"),
      listRecords("packaging_boms"),
      listRecords("packaging_components"),
    ]);
    setRules(r);
    setMaterials(m);
    setBoms(b);
    setComponents(c);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const catalog = useMemo(() => buildKenyaCatalog(), []);
  const family = catalog.families.find((f) => f.code === formulation.productFamilyCode);

  const packagingComponentTypes = useMemo(() => {
    const componentByCode = new Map(components.map((c) => [c.code, c]));
    const types = new Set<string>();
    for (const bom of boms) {
      if (!formulation.targetSkuCodes.includes(bom.skuCode)) continue;
      for (const line of bom.lines) {
        const comp = componentByCode.get(line.componentCode);
        if (comp) types.add(comp.componentType);
      }
    }
    return [...types];
  }, [boms, components, formulation.targetSkuCodes]);

  const findings = useMemo(
    () =>
      evaluateCompatibility(lines, rules, {
        materials,
        phTarget: phTarget || undefined,
        processTempC: processTempC || undefined,
        productDomain: family?.domain,
        packagingComponentTypes,
      }),
    [lines, rules, materials, phTarget, processTempC, family?.domain, packagingComponentTypes],
  );

  const summary = summarizeCompatibilityFindings(findings);
  const visible = severityFilter ? findings.filter((f) => f.severity === severityFilter) : findings;
  const lineName = (lineId: string) => lines.find((l) => l.id === lineId)?.displayName ?? lineId;

  const saveSnapshot = async () => {
    if (!versionId) {
      setStatus(t("compatibility.needVersion"));
      return;
    }
    setSaving(true);
    try {
      await upsertRecords("compatibility_snapshots", [
        {
          schemaVersion: "1.0",
          code: newId("compatsnap"),
          formulationId: formulation.id,
          versionId,
          calculatedAt: new Date().toISOString(),
          ruleVersionsUsed: rules.map((r) => ({ ruleId: r.id, version: r.version })),
          findings,
        },
      ]);
      setStatus(t("compatibility.snapshotSaved"));
    } catch (e) {
      setStatus(String(e));
    } finally {
      setSaving(false);
    }
  };

  const showFindings = () => setTab("findings");
  const showRules = () => setTab("rules");

  if (tab === "rules") {
    return <RuleManager kind="compatibility" rules={rules} onBack={showFindings} onReload={load} />;
  }

  return (
    <div className="h-full overflow-auto px-5 py-4">
      <div className="print-hide mb-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-muted">{t("compatibility.phTarget")}</span>
          <input
            value={phTarget}
            onChange={(e) => setPhTarget(e.target.value)}
            inputMode="decimal"
            placeholder={t("compatibility.phPlaceholder")}
            aria-label={t("compatibility.phTarget")}
            className="w-28 rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-muted">{t("compatibility.processTemp")}</span>
          <input
            value={processTempC}
            onChange={(e) => setProcessTempC(e.target.value)}
            inputMode="decimal"
            placeholder={t("compatibility.tempPlaceholder")}
            aria-label={t("compatibility.processTemp")}
            className="w-28 rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
          />
        </label>
        <div className="flex-1" />
        <button
          onClick={showRules}
          className="rounded-input border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-2"
        >
          {t("compatibility.manageRules")}
        </button>
        <button
          onClick={() => void saveSnapshot()}
          disabled={saving || !versionId}
          title={versionId ? t("compatibility.snapshotTitle") : t("cost.needVersion")}
          className="flex items-center gap-1.5 rounded-input border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-2 disabled:opacity-40"
        >
          <RefreshCw size={13} /> {t("compatibility.saveSnapshot")}
        </button>
      </div>

      {status && (
        <div role="status" className="mb-3 rounded-input bg-surface-2 px-3 py-2 text-[12px] text-text">
          {status}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2 text-[12px]">
        {SEVERITIES.map((sev) => (
          <button
            key={sev}
            onClick={() => setSeverityFilter(severityFilter === sev ? "" : sev)}
            className={cn(
              "rounded-input border px-2.5 py-1 tabular-nums",
              SEVERITY_TONE[sev],
              severityFilter === sev && "ring-2 ring-accent/50",
            )}
          >
            {t(`compatibility.severity.${sev}`)} <strong>{summary[sev]}</strong>
          </button>
        ))}
        {summary.dataIncomplete > 0 && (
          <span className="rounded-input border border-border bg-surface-2 px-2.5 py-1 text-muted">
            {t("compatibility.dataIncompleteCount", { count: summary.dataIncomplete })}
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted">{t("compatibility.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((f) => (
            <FindingCard key={f.id} finding={f} lineName={lineName} onFocusLine={onFocusLine} t={t} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FindingCard({
  finding,
  lineName,
  onFocusLine,
  t,
}: {
  finding: CompatibilityFinding;
  lineName: (lineId: string) => string;
  onFocusLine: (lineId: string) => void;
  t: TFunction<readonly ["session", "common"]>;
}) {
  return (
    <li className={cn("rounded-card border px-3 py-2.5", SEVERITY_TONE[finding.severity])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-medium">
            <AlertTriangle size={13} aria-hidden />
            {t(`compatibility.severity.${finding.severity}`)}
            {finding.dataIncomplete && (
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                {t("compatibility.unknown")}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] text-text">{finding.message}</p>
          {finding.scientificReason && (
            <p className="mt-1 text-[11px] text-muted">{finding.scientificReason}</p>
          )}
          {finding.recommendedAction && (
            <p className="mt-1 text-[11px] text-text">
              <strong>{t("compatibility.recommendedAction")}:</strong> {finding.recommendedAction}
            </p>
          )}
          <p className="mt-1 text-[11px] text-muted">
            {t("compatibility.verification")}: {finding.verificationStatus.replace(/_/g, " ")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {finding.lineIds.map((id) => (
            <button
              key={id}
              onClick={() => onFocusLine(id)}
              className="rounded-input border border-border bg-surface px-2 py-1 text-[11px] text-text hover:bg-surface-2"
            >
              {lineName(id)}
            </button>
          ))}
        </div>
      </div>
    </li>
  );
}
