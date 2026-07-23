import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Beaker, CheckCircle2, ClipboardList, FileText, FlaskConical, FlaskRound, GitCompare, Plus, Scale, ShieldAlert, Sparkles, Wallet } from "lucide-react";
import {
  attemptLifecycleTransition,
  buildKenyaCatalog,
  cloneToDraft,
  createVersion,
  draftDiffersFrom,
  draftFromVersion,
  effectiveStatus,
  emptyDraft,
  nextVersionNumber,
  templateForFamily,
  type Actor,
  type AuditEvent,
  type Formulation,
  type FormulationDraft,
  type FormulationLine,
  type CostSnapshot,
  type FormulationVersion,
  type PackagingBom,
  type RawMaterial,
} from "@ai4s/shared";
import { FormulaBuilder } from "@/components/formula/FormulaBuilder";
import { VersionCompare } from "@/components/formula/VersionCompare";
import { CostPanel } from "@/components/formula/CostPanel";
import { CompatibilityPanel } from "@/components/formula/CompatibilityPanel";
import { SafetyPanel } from "@/components/formula/SafetyPanel";
import { AdvancedOptimizerPanel } from "@/components/formula/AdvancedOptimizerPanel";
import { SubstitutionDialog } from "@/components/formula/SubstitutionPanel";
import { TrialsPanel } from "@/components/formula/TrialsPanel";
import { TestDefinitionsPanel } from "@/components/formula/TestDefinitionsPanel";
import { StabilityPanel } from "@/components/formula/StabilityPanel";
import { CorrectiveActionsPanel } from "@/components/formula/CorrectiveActionsPanel";
import { RegulatoryPanel } from "@/components/formula/RegulatoryPanel";
import { ApprovalPanel } from "@/components/formula/ApprovalPanel";
import { ExportMenu } from "@/components/formula/ExportMenu";
import { NewProjectDialog } from "@/components/formula/NewProjectDialog";
import { SaveVersionDialog } from "@/components/formula/SaveVersionDialog";
import { useUndoable } from "@/components/formula/useUndoable";
import {
  appendAudit,
  auditEvent,
  discardDraft,
  listFormulations,
  readAuditLog,
  readDraft,
  readFormulation,
  saveDraft,
  saveFormulation,
  saveFormulationVersion,
} from "@/lib/formulations";
import { listRecords } from "@/lib/masterdata";
import { cn } from "@/lib/cn";

type Tab = "builder" | "versions" | "cost" | "compatibility" | "safety" | "optimizer" | "trials" | "tests" | "stability" | "correctiveActions" | "regulatory" | "approval";

/**
 * The Formula Builder workspace — FormuLab's primary working surface.
 *
 * The agent thread proposes candidates; this is where a chemist actually works.
 * The split matters: a chat transcript is a conversation, and a formula is a
 * record that a batch sheet and an audit will point at years later. They should
 * not be the same object.
 */
export function FormulasPage() {
  const { t } = useTranslation(["session", "common"]);
  const catalog = useMemo(() => buildKenyaCatalog(), []);

  const [projects, setProjects] = useState<Formulation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [versions, setVersions] = useState<FormulationVersion[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [tab, setTab] = useState<Tab>("builder");
  const [creating, setCreating] = useState(false);
  const [savingVersion, setSavingVersion] = useState(false);
  const [autosave, setAutosave] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [focusLineId, setFocusLineId] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEvent[]>([]);
  const [pendingBranchName, setPendingBranchName] = useState<string | undefined>(undefined);
  const [pendingOptimizationRunCode, setPendingOptimizationRunCode] = useState<string | undefined>(undefined);
  const [pendingSubstitutionRunCode, setPendingSubstitutionRunCode] = useState<string | undefined>(undefined);
  const [substitutingLineId, setSubstitutingLineId] = useState<string | null>(null);
  const [costSnapshots, setCostSnapshots] = useState<CostSnapshot[]>([]);
  const [packagingBoms, setPackagingBoms] = useState<PackagingBom[]>([]);

  const draft = useUndoable<FormulationDraft | null>(null);
  // Bound before the JSX: a tab key written inline reads as display text to the
  // i18n lint rule, and these are route-ish identifiers, not labels.
  const goTo = {
    builder: () => setTab("builder"),
    versions: () => setTab("versions"),
    cost: () => setTab("cost"),
    compatibility: () => setTab("compatibility"),
    safety: () => setTab("safety"),
    optimizer: () => setTab("optimizer"),
    trials: () => setTab("trials"),
    tests: () => setTab("tests"),
    stability: () => setTab("stability"),
    correctiveActions: () => setTab("correctiveActions"),
    regulatory: () => setTab("regulatory"),
    approval: () => setTab("approval"),
  };
  /** Jump to the builder and select/scroll a specific line — used by the
   *  Compatibility/Safety tabs' "go to line" links. */
  const focusLine = (lineId: string) => {
    setTab("builder");
    setFocusLineId(lineId);
  };
  const active = projects.find((p) => p.id === activeId) ?? null;
  const baseVersion = versions.find((v) => v.id === draft.value?.baseVersionId);
  const baseVersionApprovalStatus = baseVersion ? effectiveStatus(baseVersion, auditLog) : "concept";

  const template = active ? templateForFamily(active.productFamilyCode) : undefined;

  // ------------------------------------------------------------- loading ---

  const refreshProjects = useCallback(async () => {
    const list = await listFormulations();
    setProjects(list);
    return list;
  }, []);

  useEffect(() => {
    void refreshProjects();
    void listRecords("materials").then(setMaterials);
    void listRecords("cost_snapshots").then(setCostSnapshots);
    void listRecords("packaging_boms").then(setPackagingBoms);
  }, [refreshProjects]);

  const openProject = useCallback(
    async (id: string) => {
      setActiveId(id);
      setTab("builder");
      setError(null);
      const { versions: vs } = await readFormulation(id);
      setVersions(vs);
      setAuditLog(await readAuditLog(id));

      // Prefer the working draft; fall back to the newest version; else empty.
      const existing = await readDraft(id);
      if (existing) {
        draft.reset(existing);
      } else if (vs.length > 0) {
        draft.reset(draftFromVersion(vs[0]));
      } else {
        const project = projects.find((p) => p.id === id);
        draft.reset(emptyDraft(id, project?.targetBatchKg ?? "100"));
      }
    },
    // `draft` is a stable-enough handle; re-creating this on every draft change
    // would reload the project on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects],
  );

  // --------------------------------------------------------------- autosave ---

  const autosaveTimer = useRef<number | undefined>(undefined);
  const dirty = draft.value ? draftDiffersFrom(draft.value, baseVersion) : false;

  useEffect(() => {
    if (!draft.value || !dirty) return;
    window.clearTimeout(autosaveTimer.current);
    setAutosave("saving");
    // Debounced: autosave keeps work safe without turning every keystroke into
    // a disk write, and it updates the DRAFT only — never a version.
    autosaveTimer.current = window.setTimeout(() => {
      void saveDraft({ ...draft.value!, updatedAt: new Date().toISOString(), dirty: true })
        .then(() => setAutosave("saved"))
        .catch((e) => setError(String(e)));
    }, 1200);
    return () => window.clearTimeout(autosaveTimer.current);
  }, [draft.value, dirty]);

  // Warn before losing unsaved work on a reload.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ---------------------------------------------------------------- actions ---

  const onCreate = async (project: Formulation) => {
    await saveFormulation(project);
    await appendAudit(auditEvent(project.id, "project.created", { detail: project.name }));
    const list = await refreshProjects();
    setCreating(false);
    setActiveId(project.id);
    setVersions([]);
    draft.reset(emptyDraft(project.id, project.targetBatchKg));
    setTab("builder");
    return list;
  };

  const onSaveVersion = async (changeReason: string, changeNotes?: string) => {
    if (!active || !draft.value) return;
    try {
      const version = createVersion({
        formulation: active,
        draft: draft.value,
        changeReason,
        changeNotes,
        author: "local",
        parentVersion: baseVersion,
        branchName: pendingBranchName,
        nextVersionNumber: nextVersionNumber(versions),
        validation: {
          requiresPreservative: template?.requiresPreservative,
          requiresPhAdjuster: template?.requiresPhAdjuster,
          requiresInci: template?.requiresInci,
        },
        appliedOptimizationRunCode: pendingOptimizationRunCode,
        appliedSubstitutionRunCode: pendingSubstitutionRunCode,
      });
      setPendingOptimizationRunCode(undefined);
      setPendingSubstitutionRunCode(undefined);
      await saveFormulationVersion(version);
      await saveFormulation({
        ...active,
        currentVersionId: version.id,
        updatedAt: new Date().toISOString(),
      });
      await appendAudit(
        auditEvent(active.id, "version.saved", {
          versionId: version.id,
          detail: changeReason,
        }),
      );
      // The draft now derives from the version just written, so the builder
      // shows "no changes" until the next edit.
      await discardDraft(active.id);
      setVersions([version, ...versions]);
      draft.reset(draftFromVersion(version));
      await refreshProjects();
      setSavingVersion(false);
      setPendingBranchName(undefined);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  /** Load an old version into a NEW draft. Never edits the version in place —
   *  works the same whether the version is current, retired or rejected. */
  const onRestore = async (version: FormulationVersion) => {
    draft.reset(cloneToDraft(version));
    setTab("builder");
    if (active) {
      await appendAudit(
        auditEvent(active.id, "version.restored_to_draft", { versionId: version.id }),
      );
    }
  };

  /** Start a named variant from a saved version: same mechanism as restore
   *  (a new draft, the saved version untouched), but the next save carries a
   *  branch name so the resulting version is visibly part of that variant. */
  const onCreateVariant = async (version: FormulationVersion, branchName: string) => {
    draft.reset(cloneToDraft(version));
    setPendingBranchName(branchName);
    setTab("builder");
    if (active) {
      await appendAudit(
        auditEvent(active.id, "version.variant_started", { versionId: version.id, detail: branchName }),
      );
    }
  };

  /**
   * Retire, reject or reopen a version. Never rewrites the version file —
   * the change is an audit event, and `effectiveStatus` derives the
   * version's current status from the log. See engine/lifecycle.ts.
   */
  const onLifecycleAction = async (version: FormulationVersion, to: "retired" | "rejected" | "concept", reason: string) => {
    if (!active) return;
    const current = effectiveStatus(version, auditLog);
    const actor: Actor = { kind: "human", role: "chemist", userId: "local" };
    const result = attemptLifecycleTransition(current, to, actor);
    if (!result.allowed || !result.action) {
      setError(result.message ?? t("builder.lifecycle.notAllowed"));
      return;
    }
    await appendAudit(auditEvent(active.id, result.action, { versionId: version.id, detail: reason }));
    setAuditLog(await readAuditLog(active.id));
    setError(null);
  };

  const onLinesChange = (lines: FormulationLine[], opts?: { checkpoint?: boolean }) => {
    draft.set((d) => (d ? { ...d, lines } : d), opts);
  };

  /** An Advanced Optimizer run was applied: it becomes a new working draft
   *  (never overwrites the saved version it started from), and the run's
   *  code is remembered so the NEXT saved version records it — see
   *  `appliedOptimizationRunCode` above and docs/APPROVAL_READINESS.md. */
  const onApplyOptimizationResult = (lines: FormulationLine[], runCode: string) => {
    onLinesChange(lines, { checkpoint: true });
    setPendingOptimizationRunCode(runCode);
    setTab("builder");
  };

  /** A substitution candidate was applied to one line: same never-overwrite-
   *  the-saved-version rule as an optimization result — this becomes part of
   *  the working draft, and the run's code is remembered for the next save. */
  const onApplySubstitution = (newLine: FormulationLine, runCode: string) => {
    if (!draft.value) return;
    const lines = draft.value.lines.map((l) => (l.id === newLine.id ? newLine : l));
    onLinesChange(lines, { checkpoint: true });
    setPendingSubstitutionRunCode(runCode);
    setSubstitutingLineId(null);
  };

  /** A multi-material SYSTEM substitution was applied: every line in
   *  `removedLineIds` is dropped and `newLines` takes its place — same
   *  never-overwrite-the-saved-version rule as a one-to-one substitution. */
  const onApplySystemSubstitution = (removedLineIds: string[], newLines: FormulationLine[], runCode: string) => {
    if (!draft.value) return;
    const removed = new Set(removedLineIds);
    const lines = [...draft.value.lines.filter((l) => !removed.has(l.id)), ...newLines];
    onLinesChange(lines, { checkpoint: true });
    setPendingSubstitutionRunCode(runCode);
    setSubstitutingLineId(null);
  };

  /** A corrective action (from a trial deviation or a stability failure)
   *  produced a new formula draft — same never-overwrite-the-saved-version
   *  rule, and the draft carries no approval status to inherit. */
  const onApplyCorrectiveActionDraft = (lines: FormulationLine[], newBasisBatchKg: string, note: string) => {
    if (!active) return;
    draft.reset({
      schemaVersion: "1.0",
      formulationId: active.id,
      baseVersionId: baseVersion?.id,
      lines,
      basisBatchKg: newBasisBatchKg,
      updatedAt: new Date().toISOString(),
      dirty: true,
    });
    setTab("builder");
    void appendAudit(auditEvent(active.id, "version.restored_to_draft", { detail: note }));
  };

  // ------------------------------------------------------------------- view ---

  if (!active) {
    return (
      <ProjectList
        projects={projects}
        onOpen={openProject}
        onNew={() => setCreating(true)}
        creating={creating}
        onCancelNew={() => setCreating(false)}
        onCreate={onCreate}
        catalog={catalog}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="print-hide flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        <button
          onClick={() => setActiveId(null)}
          className="text-[12px] text-muted hover:text-text"
        >
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
          <TabButton active={tab === "builder"} onClick={goTo.builder} icon={<FileText size={13} />}>
            {t("builder.tabBuilder")}
          </TabButton>
          <TabButton
            active={tab === "versions"}
            onClick={goTo.versions}
            icon={<GitCompare size={13} />}
          >
            {t("builder.tabVersions", { count: versions.length })}
          </TabButton>
          <TabButton active={tab === "cost"} onClick={goTo.cost} icon={<Wallet size={13} />}>
            {t("builder.tabCost")}
          </TabButton>
          <TabButton
            active={tab === "compatibility"}
            onClick={goTo.compatibility}
            icon={<FlaskConical size={13} />}
          >
            {t("builder.tabCompatibility")}
          </TabButton>
          <TabButton active={tab === "safety"} onClick={goTo.safety} icon={<ShieldAlert size={13} />}>
            {t("builder.tabSafety")}
          </TabButton>
          <TabButton active={tab === "optimizer"} onClick={goTo.optimizer} icon={<Sparkles size={13} />}>
            {t("builder.tabOptimizer")}
          </TabButton>
          <TabButton active={tab === "trials"} onClick={goTo.trials} icon={<Beaker size={13} />}>
            {t("builder.tabTrials")}
          </TabButton>
          <TabButton active={tab === "tests"} onClick={goTo.tests} icon={<ClipboardList size={13} />}>
            {t("builder.tabTests")}
          </TabButton>
          <TabButton active={tab === "stability"} onClick={goTo.stability} icon={<FlaskRound size={13} />}>
            {t("builder.tabStability")}
          </TabButton>
          <TabButton active={tab === "correctiveActions"} onClick={goTo.correctiveActions} icon={<ClipboardList size={13} />}>
            {t("builder.tabCorrectiveActions")}
          </TabButton>
          <TabButton active={tab === "regulatory"} onClick={goTo.regulatory} icon={<Scale size={13} />}>
            {t("regulatory.tabLabel")}
          </TabButton>
          <TabButton active={tab === "approval"} onClick={goTo.approval} icon={<CheckCircle2 size={13} />}>
            {t("builder.tabApproval")}
          </TabButton>
        </nav>
      </header>

      {error && (
        <div role="alert" className="shrink-0 bg-error/10 px-4 py-2 text-[12px] text-error">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {tab === "builder" && draft.value && (
          <FormulaBuilder
            lines={draft.value.lines}
            onChange={onLinesChange}
            onSave={() => setSavingVersion(true)}
            batchKg={draft.value.basisBatchKg}
            onBatchChange={(kg) => draft.set((d) => (d ? { ...d, basisBatchKg: kg } : d))}
            validation={{
              requiresPreservative: template?.requiresPreservative,
              requiresPhAdjuster: template?.requiresPhAdjuster,
              requiresInci: template?.requiresInci,
            }}
            materials={materials}
            dirty={dirty}
            autosaveState={autosave}
            onUndo={draft.undo}
            onRedo={draft.redo}
            canUndo={draft.canUndo}
            canRedo={draft.canRedo}
            focusLineId={focusLineId}
            onReplaceMaterial={setSubstitutingLineId}
          />
        )}

        {tab === "versions" && active && (
          <VersionsTab
            formulation={active}
            versions={versions}
            auditLog={auditLog}
            costSnapshots={costSnapshots}
            packagingBoms={packagingBoms}
            onRestore={onRestore}
            onLifecycleAction={onLifecycleAction}
            onCreateVariant={onCreateVariant}
          />
        )}

        {tab === "compatibility" && draft.value && (
          <CompatibilityPanel
            formulation={active}
            versionId={baseVersion?.id}
            lines={draft.value.lines}
            onFocusLine={focusLine}
          />
        )}

        {tab === "safety" && draft.value && (
          <SafetyPanel
            formulation={active}
            versionId={baseVersion?.id}
            lines={draft.value.lines}
            onFocusLine={focusLine}
          />
        )}

        {tab === "cost" && draft.value && (
          <CostPanel
            formulation={active}
            versionId={baseVersion?.id}
            lines={draft.value.lines}
            batchKg={draft.value.basisBatchKg}
          />
        )}

        {tab === "optimizer" && draft.value && (
          <AdvancedOptimizerPanel
            formulation={active}
            batchKg={draft.value.basisBatchKg}
            currentLines={draft.value.lines}
            onApplyResult={onApplyOptimizationResult}
          />
        )}

        {tab === "trials" && draft.value && (
          <TrialsPanel
            formulation={active}
            currentLines={draft.value.lines}
            basisBatchKg={draft.value.basisBatchKg}
            baseVersion={baseVersion}
            approvalStatus={baseVersionApprovalStatus}
            onApplyDraft={onApplyCorrectiveActionDraft}
          />
        )}

        {tab === "tests" && <TestDefinitionsPanel />}

        {tab === "stability" && draft.value && (
          <StabilityPanel
            formulation={active}
            currentLines={draft.value.lines}
            basisBatchKg={draft.value.basisBatchKg}
            baseVersion={baseVersion}
            approvalStatus={baseVersionApprovalStatus}
            packagingBoms={packagingBoms}
            onApplyDraft={onApplyCorrectiveActionDraft}
          />
        )}

        {tab === "correctiveActions" && (
          <CorrectiveActionsPanel
            formulation={active}
            baseVersion={baseVersion}
            approvalStatus={baseVersionApprovalStatus}
            onApplyDraft={(note) => baseVersion && onApplyCorrectiveActionDraft(baseVersion.lines.map((l) => ({ ...l })), baseVersion.basisBatchKg, note)}
          />
        )}

        {tab === "regulatory" && draft.value && (
          <RegulatoryPanel formulation={active} currentLines={draft.value.lines} materials={materials} versions={versions} />
        )}

        {tab === "approval" && (
          <ApprovalPanel
            formulation={active}
            versions={versions}
            baseVersion={baseVersion}
            auditLog={auditLog}
            onFocusLine={focusLine}
            onNavigate={(t) => goTo[t]()}
            onAuditChanged={async () => setAuditLog(await readAuditLog(active.id))}
          />
        )}
      </div>

      {savingVersion && draft.value && (
        <SaveVersionDialog
          versionNumber={nextVersionNumber(versions)}
          parentLabel={baseVersion?.versionLabel}
          onCancel={() => setSavingVersion(false)}
          onSave={onSaveVersion}
        />
      )}

      {substitutingLineId && draft.value && (
        <SubstitutionDialog
          formulation={active}
          line={draft.value.lines.find((l) => l.id === substitutingLineId)!}
          allLines={draft.value.lines}
          onApply={onApplySubstitution}
          onApplySystem={onApplySystemSubstitution}
          onClose={() => setSubstitutingLineId(null)}
        />
      )}
    </div>
  );
}

function VersionsTab({
  formulation,
  versions,
  auditLog,
  costSnapshots,
  packagingBoms,
  onRestore,
  onLifecycleAction,
  onCreateVariant,
}: {
  formulation: Formulation;
  versions: FormulationVersion[];
  auditLog: AuditEvent[];
  costSnapshots: CostSnapshot[];
  packagingBoms: PackagingBom[];
  onRestore: (v: FormulationVersion) => void;
  onLifecycleAction: (v: FormulationVersion, to: "retired" | "rejected" | "concept", reason: string) => Promise<void>;
  onCreateVariant: (v: FormulationVersion, branchName: string) => Promise<void>;
}) {
  const { t } = useTranslation("session");
  const [mode, setMode] = useState<"list" | "compare">(versions.length > 1 ? "compare" : "list");
  const [pendingAction, setPendingAction] = useState<{ version: FormulationVersion; to: "retired" | "rejected" | "concept" } | null>(
    null,
  );
  const [variantSource, setVariantSource] = useState<FormulationVersion | null>(null);
  const showList = () => setMode("list");
  const showCompare = () => setMode("compare");

  if (versions.length === 0) {
    return <p className="px-6 py-8 text-center text-[13px] text-muted">{t("builder.noVersions")}</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="print-hide flex shrink-0 gap-1 border-b border-border-faint px-4 pt-2">
        <SubTab active={mode === "list"} onClick={showList}>
          {t("builder.versionHistory")}
        </SubTab>
        <SubTab
          active={mode === "compare"}
          onClick={showCompare}
          disabled={versions.length < 2}
        >
          {t("builder.compare")}
        </SubTab>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "compare" ? (
          <VersionCompare versions={versions} />
        ) : (
          <ul className="divide-y divide-border-faint">
            {versions.map((v) => {
              const status = effectiveStatus(v, auditLog);
              const canRetire = status === "pilot_approved" || status === "production_approved";
              const canReject = status !== "rejected" && status !== "production_approved" && status !== "retired";
              const canReopen = status === "rejected";
              return (
                <li key={v.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted">
                    {v.versionLabel ?? `0.${v.versionNumber}`}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-text">
                      {v.changeReason ?? "—"}
                      {v.branchName && (
                        <span className="ml-1.5 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                          {v.branchName}
                        </span>
                      )}
                    </div>
                    {v.changeNotes && <div className="text-[11px] text-muted">{v.changeNotes}</div>}
                    <div className="mt-0.5 text-[11px] text-muted">
                      {status} · {v.author} · {new Date(v.createdAt).toLocaleString()}
                      {v.totalsSnapshot && ` · ${v.totalsSnapshot.totalPercent}%`}
                      {v.validationSnapshot &&
                        ` · ${t("builder.findingSummary", {
                          errors: v.validationSnapshot.errorCount + v.validationSnapshot.blockingCount,
                          warnings: v.validationSnapshot.warningCount,
                        })}`}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-start justify-end gap-1">
                    <ExportMenu
                      formulation={formulation}
                      version={v}
                      effectiveStatus={status}
                      costSnapshot={costSnapshots.filter((c) => c.versionId === v.id).sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt))[0]}
                      packagingBom={packagingBoms.find((b) => formulation.targetSkuCodes.includes(b.skuCode))}
                    />
                    <button
                      onClick={() => onRestore(v)}
                      title={t("builder.restoreTitle")}
                      className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
                    >
                      {t("builder.restore")}
                    </button>
                    <button
                      onClick={() => setVariantSource(v)}
                      className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
                    >
                      {t("builder.variant.create")}
                    </button>
                    {canRetire && (
                      <button
                        onClick={() => setPendingAction({ version: v, to: "retired" })}
                        className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
                      >
                        {t("builder.lifecycle.retire")}
                      </button>
                    )}
                    {canReject && (
                      <button
                        onClick={() => setPendingAction({ version: v, to: "rejected" })}
                        className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
                      >
                        {t("builder.lifecycle.reject")}
                      </button>
                    )}
                    {canReopen && (
                      <button
                        onClick={() => setPendingAction({ version: v, to: "concept" })}
                        className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
                      >
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
        <LifecycleReasonDialog
          action={pendingAction.to}
          onCancel={() => setPendingAction(null)}
          onConfirm={async (reason) => {
            await onLifecycleAction(pendingAction.version, pendingAction.to, reason);
            setPendingAction(null);
          }}
        />
      )}

      {variantSource && (
        <VariantNameDialog
          onCancel={() => setVariantSource(null)}
          onConfirm={async (branchName) => {
            await onCreateVariant(variantSource, branchName);
            setVariantSource(null);
          }}
        />
      )}
    </div>
  );
}

function VariantNameDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (branchName: string) => Promise<void>;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onConfirm(name.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("builder.variant.create")}
    >
      <div className="my-auto w-[26rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">
          {t("builder.variant.dialogTitle")}
        </h2>
        <div className="px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted">{t("builder.variant.nameLabel")}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
            />
          </label>
          <p className="mt-2 text-[11px] text-muted">{t("builder.variant.hint")}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text"
          >
            {t("common:actions.cancel")}
          </button>
          <button
            onClick={() => void submit()}
            disabled={!name.trim() || busy}
            className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {t("builder.variant.create")}
          </button>
        </div>
      </div>
    </div>
  );
}

function LifecycleReasonDialog({
  action,
  onCancel,
  onConfirm,
}: {
  action: "retired" | "rejected" | "concept";
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const title =
    action === "retired"
      ? t("builder.lifecycle.retireTitle")
      : action === "rejected"
        ? t("builder.lifecycle.rejectTitle")
        : t("builder.lifecycle.reopenTitle");

  const submit = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true);
    try {
      await onConfirm(reason.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="my-auto w-[28rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">{title}</h2>
        <div className="px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted">{t("builder.lifecycle.reason")}</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              autoFocus
              className="w-full rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text"
          >
            {t("common:actions.cancel")}
          </button>
          <button
            onClick={() => void submit()}
            disabled={!reason.trim() || busy}
            className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {t("common:actions.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectList({
  projects,
  onOpen,
  onNew,
  creating,
  onCancelNew,
  onCreate,
  catalog,
}: {
  projects: Formulation[];
  onOpen: (id: string) => void;
  onNew: () => void;
  creating: boolean;
  onCancelNew: () => void;
  onCreate: (p: Formulation) => Promise<unknown>;
  catalog: ReturnType<typeof buildKenyaCatalog>;
}) {
  const { t } = useTranslation("session");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
        <h1 className="text-[14px] font-medium text-text">{t("builder.projects")}</h1>
        <div className="flex-1" />
        <button
          onClick={onNew}
          className="flex items-center gap-1.5 rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90"
        >
          <Plus size={13} /> {t("builder.newProject")}
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {projects.length === 0 ? (
          <p className="px-6 py-10 text-center text-[13px] text-muted">{t("builder.noProjects")}</p>
        ) : (
          <ul className="divide-y divide-border-faint">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => onOpen(p.id)}
                  className="flex w-full items-baseline gap-3 px-6 py-3 text-left hover:bg-surface-2"
                >
                  <span className="font-mono text-[11px] text-muted">{p.code}</span>
                  <span className="flex-1 text-[13px] text-text">{p.name}</span>
                  <span className="text-[11px] text-muted">{p.productFamilyCode}</span>
                  <span className="text-[11px] text-muted">
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {creating && (
        <NewProjectDialog catalog={catalog} onCancel={onCancelNew} onCreate={onCreate} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-1.5 rounded-input px-2.5 py-1 text-xs",
        active ? "bg-surface-2 font-medium text-text" : "text-muted hover:text-text",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function SubTab({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-t-input border-b-2 px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40",
        active ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}
