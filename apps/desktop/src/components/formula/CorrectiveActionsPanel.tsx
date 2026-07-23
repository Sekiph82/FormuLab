import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  assignOwner,
  cancelCorrectiveAction,
  correctiveActionReportRows,
  draftWatermark,
  markAwaitingVerification,
  markInProgress,
  reopenCorrectiveAction,
  toCsv,
  verifyEffectiveness,
  type Actor,
  type AttachmentReference,
  type CorrectiveAction,
  type Formulation,
  type FormulationVersion,
  type FormulaStatus,
} from "@ai4s/shared";
import { listRecords, upsertRecords } from "@/lib/masterdata";
import { cn } from "@/lib/cn";
import { downloadText } from "@/lib/download";
import { AttachmentField } from "./AttachmentField";

const LOCAL_HUMAN: Actor = { kind: "human", role: "chemist", userId: "local" };

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

export function CorrectiveActionsPanel({
  formulation,
  baseVersion,
  approvalStatus,
  onApplyDraft,
}: {
  formulation: Formulation;
  baseVersion?: FormulationVersion;
  approvalStatus: FormulaStatus;
  onApplyDraft: (note: string) => void;
}) {
  const { t: tRaw } = useTranslation(["session", "common"]);
  const t = tRaw as SimpleT;
  const [actions, setActions] = useState<CorrectiveAction[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listRecords("corrective_actions").then((all) => setActions(all.filter((a) => a.projectId === formulation.id)));
  }, [formulation.id]);

  const persist = async (action: CorrectiveAction) => {
    try {
      await upsertRecords("corrective_actions", [action]);
      setActions((prev) => prev.map((a) => (a.id === action.id ? action : a)));
    } catch (e) {
      setError(String(e));
    }
  };

  const updateAttachments = (action: CorrectiveAction, attachments: AttachmentReference[]) =>
    void persist({ ...action, attachments, updatedAt: new Date().toISOString() });

  const exportCsv = () => {
    const { headers, rows } = correctiveActionReportRows(actions);
    const header = [`# CORRECTIVE ACTIONS — ${formulation.code} — ${draftWatermark(approvalStatus) ?? "production approved"} — ${new Date().toISOString()}`];
    downloadText(`${formulation.code}-corrective-actions.csv`, [...header, toCsv(headers, rows)].join("\n"), "text/csv;charset=utf-8");
  };

  return (
    <div className="h-full overflow-auto px-4 py-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-text">{t("correctiveActions.heading")}</h3>
        <button onClick={exportCsv} disabled={actions.length === 0} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40">
          {t("builder.export.csv")}
        </button>
      </div>
      {error && (
        <div role="alert" className="mb-3 rounded-input bg-error/10 px-3 py-2 text-[12px] text-error">
          {error}
        </div>
      )}
      {actions.length === 0 && <p className="text-[12px] text-muted">{t("correctiveActions.none")}</p>}
      <ul className="space-y-2">
        {actions.map((action) => (
          <li key={action.id} className={cn("rounded-card border px-3 py-2", action.status === "ineffective" ? "border-error/40 bg-error/5" : "border-border")}>
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-text">
              <span className="font-medium">{action.title}</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{action.status}</span>
              <span className="text-[10px] text-muted">{action.sourceType}</span>
              <div className="flex-1" />
              <input
                value={inputs[action.id] ?? ""}
                onChange={(e) => setInputs((prev) => ({ ...prev, [action.id]: e.target.value }))}
                placeholder={t("correctiveActions.notesPlaceholder")}
                className="w-48 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
              />
            </div>
            <p className="mt-1 text-[11px] text-muted">{action.problemStatement}</p>
            <AttachmentField
              formulationId={formulation.id}
              attachments={action.attachments}
              onChange={(attachments) => updateAttachments(action, attachments)}
              t={t}
            />
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {action.status === "open" && (
                <button onClick={() => void persist(markInProgress(action, LOCAL_HUMAN))} className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2">
                  {t("correctiveActions.startProgress")}
                </button>
              )}
              {(action.status === "open" || action.status === "in_progress") && (
                <button onClick={() => void persist(markAwaitingVerification(action, inputs[action.id] ?? t("correctiveActions.defaultResolution"), LOCAL_HUMAN))} className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2">
                  {t("correctiveActions.markComplete")}
                </button>
              )}
              {action.status === "awaiting_verification" && (
                <>
                  <button onClick={() => void persist(verifyEffectiveness(action, LOCAL_HUMAN, { effective: true, notes: inputs[action.id] }))} className="rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
                    {t("correctiveActions.verifyEffective")}
                  </button>
                  <button onClick={() => void persist(verifyEffectiveness(action, LOCAL_HUMAN, { effective: false, notes: inputs[action.id] }))} className="rounded-input border border-error/40 px-2 py-1 text-[11px] text-error hover:bg-error/10">
                    {t("correctiveActions.verifyIneffective")}
                  </button>
                </>
              )}
              {(action.status === "effective" || action.status === "ineffective") && (
                <button onClick={() => void persist(reopenCorrectiveAction(action, LOCAL_HUMAN, inputs[action.id] ?? t("correctiveActions.defaultReopenReason")))} className="rounded-input border border-border px-2 py-1 text-[11px] text-text hover:bg-surface-2">
                  {t("correctiveActions.reopen")}
                </button>
              )}
              {action.status !== "cancelled" && action.status !== "effective" && (
                <button onClick={() => void persist(cancelCorrectiveAction(action, LOCAL_HUMAN, inputs[action.id] ?? t("correctiveActions.defaultCancelReason")))} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2">
                  {t("correctiveActions.cancel")}
                </button>
              )}
              {action.owner && (
                <button onClick={() => void persist(assignOwner(action, action.owner === "local" ? "chemist" : "local", LOCAL_HUMAN))} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2">
                  {t("correctiveActions.reassign")}: {action.owner}
                </button>
              )}
              {baseVersion && (
                <button onClick={() => onApplyDraft(t("stability.draftFromFailure", { code: action.code }))} className="rounded-input border border-border px-2 py-1 text-[11px] text-muted hover:bg-surface-2">
                  {t("trials.createDraft")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
