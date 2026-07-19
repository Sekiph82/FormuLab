import { useState } from "react";
import { useTranslation } from "react-i18next";
import { versionLabel } from "@ai4s/shared";

/**
 * Confirm saving a new immutable version.
 *
 * The change reason is required, and the engine refuses without one. A version
 * history where every entry says nothing is worse than no history: it looks
 * like an audit trail while answering none of the questions an audit asks.
 */
export function SaveVersionDialog({
  versionNumber,
  parentLabel,
  onCancel,
  onSave,
}: {
  versionNumber: number;
  parentLabel?: string;
  onCancel: () => void;
  onSave: (changeReason: string, changeNotes?: string) => Promise<void> | void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true);
    try {
      await onSave(reason.trim(), notes.trim() || undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t("builder.saveVersion")}
    >
      <div className="w-[30rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <h2 className="border-b border-border px-5 py-3 text-[14px] font-medium text-text">
          {t("builder.saveVersionTitle", { label: versionLabel(versionNumber) })}
        </h2>

        <div className="space-y-3 px-5 py-4">
          {parentLabel && (
            <p className="text-[11px] text-muted">
              {t("builder.derivedFrom", { label: parentLabel })}
            </p>
          )}

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted">
              {t("builder.changeReason")} <span className="text-error">*</span>
            </span>
            <input
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              placeholder={t("builder.changeReasonPlaceholder")}
              aria-label={t("builder.changeReason")}
              className="w-full rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-muted">
              {t("builder.changeNotes")}
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              aria-label={t("builder.changeNotes")}
              className="w-full resize-y rounded-input border border-border bg-surface px-2 py-1.5 text-[12px] text-text outline-none focus:border-accent"
            />
          </label>

          <p className="rounded-input border border-border bg-surface-2 px-3 py-2 text-[11px] text-muted">
            {t("builder.immutableNote")}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-input border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-text"
          >
            {t("common:actions.cancel")}
          </button>
          <button
            onClick={submit}
            disabled={!reason.trim() || busy}
            className="rounded-input bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {busy ? t("builder.saving") : t("builder.saveVersion")}
          </button>
        </div>
      </div>
    </div>
  );
}
