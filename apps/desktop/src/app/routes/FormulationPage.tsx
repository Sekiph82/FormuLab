import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, FileText, FlaskConical, GitCompare, Package, Scale, ShieldAlert, TestTube2, Wallet } from "lucide-react";
import { effectiveStatus, type AuditEvent, type CostSnapshot, type Formulation, type FormulationVersion, type PackagingBom } from "@ai4s/shared";
import { FormulaBuilder } from "@/components/formula/FormulaBuilder";
import { VersionCompare } from "@/components/formula/VersionCompare";
import { CostPanel } from "@/components/formula/CostPanel";
import { CompatibilityPanel } from "@/components/formula/CompatibilityPanel";
import { SafetyPanel } from "@/components/formula/SafetyPanel";
import { SubstitutionDialog } from "@/components/formula/SubstitutionPanel";
import { ExportMenu } from "@/components/formula/ExportMenu";
import { SaveVersionDialog } from "@/components/formula/SaveVersionDialog";
import { useFormulationWorkspace } from "@/hooks/useFormulationWorkspace";
import { useProjectParam } from "@/hooks/useProjectParam";
import { ProjectPicker } from "@/components/workspace/ProjectContextBar";
import { cn } from "@/lib/cn";

type Tab = "builder" | "versions" | "cost" | "compatibility" | "safety" | "packaging";
const TAB_LABEL_KEY = {
  builder: "builder.tabBuilder",
  versions: "builder.tabVersions",
  cost: "builder.tabCost",
  compatibility: "builder.tabCompatibility",
  safety: "builder.tabSafety",
  packaging: "builder.tabPackaging",
} as const satisfies Record<Tab, string>;
const TABS: { key: Tab; icon: React.ReactNode }[] = [
  { key: "builder", icon: <FileText size={13} /> },
  { key: "versions", icon: <GitCompare size={13} /> },
  { key: "cost", icon: <Wallet size={13} /> },
  { key: "compatibility", icon: <FlaskConical size={13} /> },
  { key: "safety", icon: <ShieldAlert size={13} /> },
  { key: "packaging", icon: <Package size={13} /> },
];

/**
 * The Formulation workspace — the trimmed-down center of formula editing.
 * Used to carry every downstream module (Trials/Tests/Stability/Corrective
 * Actions/Regulatory/Approval) as a horizontal tab on top of this; those now
 * live in their own workspaces (Laboratory/Stability/Regulatory/Approval),
 * reached via the links in the header. See docs/WORKSPACES.md.
 */
export function FormulationPage() {
  const { t } = useTranslation(["session", "common"]);
  const navigate = useNavigate();
  const { projectId, setProject } = useProjectParam();
  const ws = useFormulationWorkspace(projectId);
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>("builder");
  const [savingVersion, setSavingVersion] = useState(false);
  const [substitutingLineId, setSubstitutingLineId] = useState<string | null>(null);
  const [focusLineId, setFocusLineId] = useState<string | null>(null);

  // A cross-workspace link (e.g. an Approval blocker naming "compatibility",
  // or a specific line to focus) arrives as `?tab=`/`?focusLine=` — read
  // once per navigation so the context that link carried actually lands.
  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (requestedTab && TABS.some((x) => x.key === requestedTab)) setTab(requestedTab as Tab);
    else setTab("builder");
    const requestedLine = searchParams.get("focusLine");
    if (requestedLine) setFocusLineId(requestedLine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, searchParams.get("tab"), searchParams.get("focusLine")]);

  const focusLine = (lineId: string) => {
    setTab("builder");
    setFocusLineId(lineId);
  };

  if (!projectId) {
    return <ProjectPicker onPick={setProject} />;
  }

  if (ws.loading && !ws.project) {
    return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("session:builder.loadingProject")}</p>;
  }

  if (!ws.project) {
    return <p className="px-6 py-8 text-center text-[13px] text-error">{ws.error ?? t("builder.noProjects")}</p>;
  }

  const active = ws.project;
  const draft = ws.draft;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="print-hide flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        <button onClick={() => navigate("/projects")} className="text-[12px] text-muted hover:text-text">
          ← {t("builder.allProjects")}
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-[13px] font-medium text-text">{active.name}</h1>
          <p className="truncate text-[11px] text-muted">
            {active.code} · {active.productFamilyCode} · {active.targetMarkets.join(", ")}
          </p>
        </div>
        <div className="flex-1" />
        <nav className="flex gap-1" aria-label={t("builder.sections")}>
          {TABS.map(({ key, icon }) => (
            <TabButton key={key} active={tab === key} onClick={() => setTab(key)} icon={icon}>
              {t(TAB_LABEL_KEY[key], { count: ws.versions.length })}
            </TabButton>
          ))}
        </nav>
        <div className="flex gap-1 border-l border-border-faint pl-2">
          <Link to={`/laboratory?project=${projectId}`} title={t("builder.openLaboratory")} aria-label={t("builder.openLaboratory")} className="rounded-input px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
            <TestTube2 size={13} />
          </Link>
          <Link to={`/stability?project=${projectId}`} title={t("builder.openStability")} aria-label={t("builder.openStability")} className="rounded-input px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
            <FlaskConical size={13} />
          </Link>
          <Link to={`/regulatory?project=${projectId}`} title={t("builder.openRegulatory")} aria-label={t("builder.openRegulatory")} className="rounded-input px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
            <Scale size={13} />
          </Link>
          <Link to={`/approval?project=${projectId}`} title={t("builder.openApproval")} aria-label={t("builder.openApproval")} className="rounded-input px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
            <CheckCircle2 size={13} />
          </Link>
        </div>
      </header>

      {ws.error && (
        <div role="alert" className="shrink-0 bg-error/10 px-4 py-2 text-[12px] text-error">
          {ws.error}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {tab === "builder" && draft.value && (
          <FormulaBuilder
            lines={draft.value.lines}
            onChange={ws.onLinesChange}
            onSave={() => setSavingVersion(true)}
            batchKg={draft.value.basisBatchKg}
            onBatchChange={(kg) => draft.set((d) => (d ? { ...d, basisBatchKg: kg } : d))}
            validation={{
              requiresPreservative: ws.template?.requiresPreservative,
              requiresPhAdjuster: ws.template?.requiresPhAdjuster,
              requiresInci: ws.template?.requiresInci,
            }}
            materials={ws.materials}
            dirty={ws.dirty}
            autosaveState={ws.autosave}
            onUndo={draft.undo}
            onRedo={draft.redo}
            canUndo={draft.canUndo}
            canRedo={draft.canRedo}
            focusLineId={focusLineId}
            onReplaceMaterial={setSubstitutingLineId}
          />
        )}

        {tab === "versions" && (
          <FormulationVersionsTab
            versions={ws.versions}
            auditLog={ws.auditLog}
            formulation={active}
            costSnapshots={ws.costSnapshots}
            packagingBoms={ws.packagingBoms}
            onRestore={ws.onRestore}
            onLifecycleAction={ws.onLifecycleAction}
            onCreateVariant={ws.onCreateVariant}
          />
        )}

        {tab === "compatibility" && draft.value && (
          <CompatibilityPanel formulation={active} versionId={ws.baseVersion?.id} lines={draft.value.lines} onFocusLine={focusLine} />
        )}

        {tab === "safety" && draft.value && (
          <SafetyPanel formulation={active} versionId={ws.baseVersion?.id} lines={draft.value.lines} onFocusLine={focusLine} />
        )}

        {tab === "cost" && draft.value && (
          <CostPanel formulation={active} versionId={ws.baseVersion?.id} lines={draft.value.lines} batchKg={draft.value.basisBatchKg} />
        )}

        {tab === "packaging" && <PackagingSummaryTab targetSkuCodes={active.targetSkuCodes} packagingBoms={ws.packagingBoms} />}
      </div>

      {savingVersion && draft.value && (
        <SaveVersionDialog
          versionNumber={ws.versions.length + 1}
          parentLabel={ws.baseVersion?.versionLabel}
          onCancel={() => setSavingVersion(false)}
          onSave={async (reason, notes) => {
            await ws.onSaveVersion(reason, notes);
            setSavingVersion(false);
          }}
        />
      )}

      {substitutingLineId && draft.value && (
        <SubstitutionDialog
          formulation={active}
          line={draft.value.lines.find((l) => l.id === substitutingLineId)!}
          allLines={draft.value.lines}
          onApply={(newLine, runCode) => {
            ws.onApplySubstitution(newLine, runCode);
            setSubstitutingLineId(null);
          }}
          onApplySystem={(removed, newLines, runCode) => {
            ws.onApplySystemSubstitution(removed, newLines, runCode);
            setSubstitutingLineId(null);
          }}
          onClose={() => setSubstitutingLineId(null)}
        />
      )}
    </div>
  );
}

function PackagingSummaryTab({ targetSkuCodes, packagingBoms }: { targetSkuCodes: string[]; packagingBoms: PackagingBom[] }) {
  const { t } = useTranslation("session");
  if (targetSkuCodes.length === 0) {
    return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("builder.packaging.noSkus")}</p>;
  }
  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <p className="mb-3 text-[11px] text-muted">{t("builder.packaging.description")}</p>
      <ul className="divide-y divide-border-faint rounded-card border border-border">
        {targetSkuCodes.map((sku) => {
          const bom = packagingBoms.find((b) => b.skuCode === sku);
          return (
            <li key={sku} className="flex items-center gap-3 px-4 py-2.5 text-[12px]">
              <span className="font-mono text-text">{sku}</span>
              {bom ? (
                <span className="text-muted">
                  {t("builder.packaging.fillSummary", { qty: bom.fillQuantity, unit: bom.fillUnit, lines: bom.lines.length })}
                </span>
              ) : (
                <span className="text-warn">{t("builder.packaging.noBom")}</span>
              )}
              <div className="flex-1" />
              <Link to="/administration" className="text-accent hover:underline">
                {t("builder.packaging.manageLink")}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FormulationVersionsTab({
  versions,
  ...rest
}: {
  versions: FormulationVersion[];
  auditLog: AuditEvent[];
  formulation: Formulation;
  costSnapshots: CostSnapshot[];
  packagingBoms: PackagingBom[];
  onRestore: (v: FormulationVersion) => void;
  onLifecycleAction: (v: FormulationVersion, to: "retired" | "rejected" | "concept", reason: string) => Promise<void>;
  onCreateVariant: (v: FormulationVersion, branchName: string) => Promise<void>;
}) {
  const { t } = useTranslation("session");
  const [mode, setMode] = useState<"list" | "compare">(versions.length > 1 ? "compare" : "list");
  const [pendingAction, setPendingAction] = useState<{ version: FormulationVersion; to: "retired" | "rejected" | "concept" } | null>(null);
  const [variantSource, setVariantSource] = useState<FormulationVersion | null>(null);

  if (versions.length === 0) {
    return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("builder.noVersions")}</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="print-hide flex shrink-0 gap-1 border-b border-border-faint px-4 pt-2">
        <button
          onClick={() => setMode("list")}
          className={cn("rounded-t-input border-b-2 px-3 py-1.5 text-xs font-medium", mode === "list" ? "border-accent text-text" : "border-transparent text-muted hover:text-text")}
        >
          {t("builder.versionHistory")}
        </button>
        <button
          disabled={versions.length < 2}
          onClick={() => setMode("compare")}
          className={cn(
            "rounded-t-input border-b-2 px-3 py-1.5 text-xs font-medium disabled:opacity-40",
            mode === "compare" ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
          )}
        >
          {t("builder.compare")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "compare" ? (
          <VersionCompare versions={versions} />
        ) : (
          <ul className="divide-y divide-border-faint">
            {versions.map((v) => {
              const status = effectiveStatus(v, rest.auditLog);
              const canRetire = status === "pilot_approved" || status === "production_approved";
              const canReject = status !== "rejected" && status !== "production_approved" && status !== "retired";
              const canReopen = status === "rejected";
              return (
                <li key={v.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted">{v.versionLabel ?? `0.${v.versionNumber}`}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-text">
                      {v.changeReason ?? "—"}
                      {v.branchName && <span className="ml-1.5 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">{v.branchName}</span>}
                    </div>
                    {v.changeNotes && <div className="text-[11px] text-muted">{v.changeNotes}</div>}
                    <div className="mt-0.5 text-[11px] text-muted">
                      {status} · {v.author} · {new Date(v.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-start justify-end gap-1">
                    <ExportMenu
                      formulation={rest.formulation}
                      version={v}
                      effectiveStatus={status}
                      costSnapshot={rest.costSnapshots.filter((c) => c.versionId === v.id).sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt))[0]}
                      packagingBom={rest.packagingBoms.find((b) => rest.formulation.targetSkuCodes.includes(b.skuCode))}
                    />
                    <button onClick={() => rest.onRestore(v)} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
                      {t("builder.restore")}
                    </button>
                    <button onClick={() => setVariantSource(v)} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
                      {t("builder.variant.create")}
                    </button>
                    {canRetire && (
                      <button onClick={() => setPendingAction({ version: v, to: "retired" })} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
                        {t("builder.lifecycle.retire")}
                      </button>
                    )}
                    {canReject && (
                      <button onClick={() => setPendingAction({ version: v, to: "rejected" })} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
                        {t("builder.lifecycle.reject")}
                      </button>
                    )}
                    {canReopen && (
                      <button onClick={() => setPendingAction({ version: v, to: "concept" })} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text">
                        {t("builder.lifecycle.reopen")}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {pendingAction && (
        <SimpleReasonDialog
          title={
            pendingAction.to === "retired" ? t("builder.lifecycle.retireTitle") : pendingAction.to === "rejected" ? t("builder.lifecycle.rejectTitle") : t("builder.lifecycle.reopenTitle")
          }
          label={t("builder.lifecycle.reason")}
          onCancel={() => setPendingAction(null)}
          onConfirm={async (reason) => {
            await rest.onLifecycleAction(pendingAction.version, pendingAction.to, reason);
            setPendingAction(null);
          }}
        />
      )}

      {variantSource && (
        <SimpleReasonDialog
          title={t("builder.variant.dialogTitle")}
          label={t("builder.variant.nameLabel")}
          onCancel={() => setVariantSource(null)}
          onConfirm={async (name) => {
            await rest.onCreateVariant(variantSource, name);
            setVariantSource(null);
          }}
        />
      )}
    </div>
  );
}

function SimpleReasonDialog({
  title,
  label,
  onCancel,
  onConfirm,
}: {
  title: string;
  label: string;
  onCancel: () => void;
  onConfirm: (value: string) => Promise<void>;
}) {
  const { t } = useTranslation("common");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await onConfirm(value.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="my-auto w-[28rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">{title}</h2>
        <div className="px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>
            <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} autoFocus className="w-full rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onCancel} className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text">
            {t("actions.cancel")}
          </button>
          <button onClick={() => void submit()} disabled={!value.trim() || busy} className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40">
            {t("actions.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn("flex items-center gap-1.5 rounded-input px-2.5 py-1 text-xs", active ? "bg-surface-2 font-medium text-text" : "text-muted hover:text-text")}
    >
      {icon}
      {children}
    </button>
  );
}
