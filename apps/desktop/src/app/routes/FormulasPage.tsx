import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, GitCompare, Plus, Wallet } from "lucide-react";
import {
  buildKenyaCatalog,
  createVersion,
  draftDiffersFrom,
  draftFromVersion,
  emptyDraft,
  nextVersionNumber,
  templateForFamily,
  type Formulation,
  type FormulationDraft,
  type FormulationLine,
  type FormulationVersion,
  type RawMaterial,
} from "@ai4s/shared";
import { FormulaBuilder } from "@/components/formula/FormulaBuilder";
import { VersionCompare } from "@/components/formula/VersionCompare";
import { CostPanel } from "@/components/formula/CostPanel";
import { NewProjectDialog } from "@/components/formula/NewProjectDialog";
import { SaveVersionDialog } from "@/components/formula/SaveVersionDialog";
import { useUndoable } from "@/components/formula/useUndoable";
import {
  appendAudit,
  auditEvent,
  discardDraft,
  listFormulations,
  readDraft,
  readFormulation,
  saveDraft,
  saveFormulation,
  saveFormulationVersion,
} from "@/lib/formulations";
import { listRecords } from "@/lib/masterdata";
import { cn } from "@/lib/cn";

type Tab = "builder" | "versions" | "cost";

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

  const draft = useUndoable<FormulationDraft | null>(null);
  // Bound before the JSX: a tab key written inline reads as display text to the
  // i18n lint rule, and these are route-ish identifiers, not labels.
  const goTo = {
    builder: () => setTab("builder"),
    versions: () => setTab("versions"),
    cost: () => setTab("cost"),
  };
  const active = projects.find((p) => p.id === activeId) ?? null;
  const baseVersion = versions.find((v) => v.id === draft.value?.baseVersionId);

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
  }, [refreshProjects]);

  const openProject = useCallback(
    async (id: string) => {
      setActiveId(id);
      setTab("builder");
      setError(null);
      const { versions: vs } = await readFormulation(id);
      setVersions(vs);

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
        nextVersionNumber: nextVersionNumber(versions),
        validation: {
          requiresPreservative: template?.requiresPreservative,
          requiresPhAdjuster: template?.requiresPhAdjuster,
          requiresInci: template?.requiresInci,
        },
      });
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
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  /** Load an old version into a NEW draft. Never edits the version in place. */
  const onRestore = async (version: FormulationVersion) => {
    draft.reset(draftFromVersion(version));
    setTab("builder");
    if (active) {
      await appendAudit(
        auditEvent(active.id, "version.restored_to_draft", { versionId: version.id }),
      );
    }
  };

  const onLinesChange = (lines: FormulationLine[], opts?: { checkpoint?: boolean }) => {
    draft.set((d) => (d ? { ...d, lines } : d), opts);
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
          />
        )}

        {tab === "versions" && (
          <VersionsTab versions={versions} onRestore={onRestore} />
        )}

        {tab === "cost" && draft.value && (
          <CostPanel
            formulation={active}
            versionId={baseVersion?.id}
            lines={draft.value.lines}
            batchKg={draft.value.basisBatchKg}
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
    </div>
  );
}

function VersionsTab({
  versions,
  onRestore,
}: {
  versions: FormulationVersion[];
  onRestore: (v: FormulationVersion) => void;
}) {
  const { t } = useTranslation("session");
  const [mode, setMode] = useState<"list" | "compare">(versions.length > 1 ? "compare" : "list");
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
            {versions.map((v) => (
              <li key={v.id} className="flex items-start gap-3 px-4 py-3">
                <span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted">
                  {v.versionLabel ?? `0.${v.versionNumber}`}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-text">{v.changeReason ?? "—"}</div>
                  {v.changeNotes && <div className="text-[11px] text-muted">{v.changeNotes}</div>}
                  <div className="mt-0.5 text-[11px] text-muted">
                    {v.status} · {v.author} · {new Date(v.createdAt).toLocaleString()}
                    {v.totalsSnapshot && ` · ${v.totalsSnapshot.totalPercent}%`}
                    {v.validationSnapshot &&
                      ` · ${t("builder.findingSummary", {
                        errors: v.validationSnapshot.errorCount + v.validationSnapshot.blockingCount,
                        warnings: v.validationSnapshot.warningCount,
                      })}`}
                  </div>
                </div>
                <button
                  onClick={() => onRestore(v)}
                  title={t("builder.restoreTitle")}
                  className="shrink-0 rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text"
                >
                  {t("builder.restore")}
                </button>
              </li>
            ))}
          </ul>
        )}
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
