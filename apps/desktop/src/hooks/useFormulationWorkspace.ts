import { useCallback, useEffect, useRef, useState } from "react";
import {
  attemptLifecycleTransition,
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
  type CostSnapshot,
  type Formulation,
  type FormulationDraft,
  type FormulationLine,
  type FormulationVersion,
  type PackagingBom,
  type RawMaterial,
} from "@ai4s/shared";
import {
  appendAudit,
  auditEvent,
  discardDraft,
  readAuditLog,
  readDraft,
  readFormulation,
  saveDraft,
  saveFormulation,
  saveFormulationVersion,
} from "@/lib/formulations";
import { listRecords } from "@/lib/masterdata";
import { useUndoable } from "@/components/formula/useUndoable";

/**
 * Everything a formulation-project workspace page needs to load and act on
 * one project: the project record, its versions, the working draft (with
 * undo/redo and debounced autosave), and the shared collections (materials,
 * cost snapshots, packaging BOMs, audit log) every downstream workspace
 * (Formulation/Laboratory/Stability/Optimization/Regulatory/Approval) reads.
 *
 * Extracted from the single-page FormulasPage.tsx (spec: information-
 * architecture simplification) so every workspace route shares one loading
 * and mutation path instead of re-implementing it — moved, not duplicated.
 * Each page still owns its own local UI state (which tab/section is open).
 */
export function useFormulationWorkspace(formulationId: string | null) {
  const [project, setProject] = useState<Formulation | null>(null);
  const [versions, setVersions] = useState<FormulationVersion[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [costSnapshots, setCostSnapshots] = useState<CostSnapshot[]>([]);
  const [packagingBoms, setPackagingBoms] = useState<PackagingBom[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autosave, setAutosave] = useState<"idle" | "saving" | "saved">("idle");
  const [pendingBranchName, setPendingBranchName] = useState<string | undefined>(undefined);
  const [pendingOptimizationRunCode, setPendingOptimizationRunCode] = useState<string | undefined>(undefined);
  const [pendingSubstitutionRunCode, setPendingSubstitutionRunCode] = useState<string | undefined>(undefined);

  const draft = useUndoable<FormulationDraft | null>(null);

  const refreshAuditLog = useCallback(async () => {
    if (!formulationId) return;
    setAuditLog(await readAuditLog(formulationId));
  }, [formulationId]);

  useEffect(() => {
    let cancelled = false;
    if (!formulationId) {
      setProject(null);
      setVersions([]);
      draft.reset(null);
      return;
    }
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [{ formulation, versions: vs }, allMaterials, allCost, allPackaging, log, existingDraft] = await Promise.all([
          readFormulation(formulationId),
          listRecords("materials") as Promise<RawMaterial[]>,
          listRecords("cost_snapshots") as Promise<CostSnapshot[]>,
          listRecords("packaging_boms") as Promise<PackagingBom[]>,
          readAuditLog(formulationId),
          readDraft(formulationId),
        ]);
        if (cancelled) return;
        setProject(formulation);
        setVersions(vs);
        setMaterials(allMaterials);
        setCostSnapshots(allCost);
        setPackagingBoms(allPackaging);
        setAuditLog(log);
        if (existingDraft) {
          draft.reset(existingDraft);
        } else if (vs.length > 0) {
          draft.reset(draftFromVersion(vs[0]));
        } else {
          draft.reset(emptyDraft(formulationId, formulation?.targetBatchKg ?? "100"));
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `draft` is a stable-enough handle; including it would reload the
    // project on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formulationId]);

  const baseVersion = versions.find((v) => v.id === draft.value?.baseVersionId);
  const baseVersionApprovalStatus = baseVersion ? effectiveStatus(baseVersion, auditLog) : "concept";
  const template = project ? templateForFamily(project.productFamilyCode) : undefined;
  const dirty = draft.value ? draftDiffersFrom(draft.value, baseVersion) : false;

  // ------------------------------------------------------------- autosave ---
  const autosaveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!draft.value || !dirty) return;
    window.clearTimeout(autosaveTimer.current);
    setAutosave("saving");
    autosaveTimer.current = window.setTimeout(() => {
      void saveDraft({ ...draft.value!, updatedAt: new Date().toISOString(), dirty: true })
        .then(() => setAutosave("saved"))
        .catch((e) => setError(String(e)));
    }, 1200);
    return () => window.clearTimeout(autosaveTimer.current);
  }, [draft.value, dirty]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ---------------------------------------------------------------- actions ---

  const onSaveVersion = useCallback(
    async (changeReason: string, changeNotes?: string) => {
      if (!project || !draft.value) return;
      try {
        const version = createVersion({
          formulation: project,
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
        await saveFormulation({ ...project, currentVersionId: version.id, updatedAt: new Date().toISOString() });
        await appendAudit(auditEvent(project.id, "version.saved", { versionId: version.id, detail: changeReason }));
        await discardDraft(project.id);
        setVersions((prev) => [version, ...prev]);
        draft.reset(draftFromVersion(version));
        setPendingBranchName(undefined);
        setError(null);
        return version;
      } catch (e) {
        setError(String(e));
        return undefined;
      }
    },
    [project, draft, baseVersion, pendingBranchName, versions, template, pendingOptimizationRunCode, pendingSubstitutionRunCode],
  );

  const onRestore = useCallback(
    async (version: FormulationVersion) => {
      draft.reset(cloneToDraft(version));
      if (project) await appendAudit(auditEvent(project.id, "version.restored_to_draft", { versionId: version.id }));
    },
    [draft, project],
  );

  const onCreateVariant = useCallback(
    async (version: FormulationVersion, branchName: string) => {
      draft.reset(cloneToDraft(version));
      setPendingBranchName(branchName);
      if (project) await appendAudit(auditEvent(project.id, "version.variant_started", { versionId: version.id, detail: branchName }));
    },
    [draft, project],
  );

  const onLifecycleAction = useCallback(
    async (version: FormulationVersion, to: "retired" | "rejected" | "concept", reason: string) => {
      if (!project) return;
      const current = effectiveStatus(version, auditLog);
      const actor: Actor = { kind: "human", role: "chemist", userId: "local" };
      const result = attemptLifecycleTransition(current, to, actor);
      if (!result.allowed || !result.action) {
        setError(result.message ?? "That transition is not allowed.");
        return;
      }
      await appendAudit(auditEvent(project.id, result.action, { versionId: version.id, detail: reason }));
      await refreshAuditLog();
      setError(null);
    },
    [project, auditLog, refreshAuditLog],
  );

  const onLinesChange = useCallback(
    (lines: FormulationLine[], opts?: { checkpoint?: boolean }) => {
      draft.set((d) => (d ? { ...d, lines } : d), opts);
    },
    [draft],
  );

  const onApplyOptimizationResult = useCallback(
    (lines: FormulationLine[], runCode: string) => {
      onLinesChange(lines, { checkpoint: true });
      setPendingOptimizationRunCode(runCode);
    },
    [onLinesChange],
  );

  const onApplySubstitution = useCallback(
    (newLine: FormulationLine, runCode: string) => {
      if (!draft.value) return;
      const lines = draft.value.lines.map((l) => (l.id === newLine.id ? newLine : l));
      onLinesChange(lines, { checkpoint: true });
      setPendingSubstitutionRunCode(runCode);
    },
    [draft.value, onLinesChange],
  );

  const onApplySystemSubstitution = useCallback(
    (removedLineIds: string[], newLines: FormulationLine[], runCode: string) => {
      if (!draft.value) return;
      const removed = new Set(removedLineIds);
      const lines = [...draft.value.lines.filter((l) => !removed.has(l.id)), ...newLines];
      onLinesChange(lines, { checkpoint: true });
      setPendingSubstitutionRunCode(runCode);
    },
    [draft.value, onLinesChange],
  );

  const onApplyCorrectiveActionDraft = useCallback(
    (lines: FormulationLine[], newBasisBatchKg: string, note: string) => {
      if (!project) return;
      draft.reset({
        schemaVersion: "1.0",
        formulationId: project.id,
        baseVersionId: baseVersion?.id,
        lines,
        basisBatchKg: newBasisBatchKg,
        updatedAt: new Date().toISOString(),
        dirty: true,
      });
      void appendAudit(auditEvent(project.id, "version.restored_to_draft", { detail: note }));
    },
    [project, draft, baseVersion],
  );

  return {
    project,
    versions,
    materials,
    costSnapshots,
    packagingBoms,
    auditLog,
    loading,
    error,
    setError,
    draft,
    baseVersion,
    baseVersionApprovalStatus,
    template,
    dirty,
    autosave,
    refreshAuditLog,
    onSaveVersion,
    onRestore,
    onCreateVariant,
    onLifecycleAction,
    onLinesChange,
    onApplyOptimizationResult,
    onApplySubstitution,
    onApplySystemSubstitution,
    onApplyCorrectiveActionDraft,
  };
}
