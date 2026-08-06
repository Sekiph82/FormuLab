import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { resolvePendingUnsavedClose, usePendingUnsavedClose } from "@/lib/unsavedWork";

/**
 * Phase 12 — window-close fix. Mounted once (`AppShell`); renders only
 * while a native close request (X / Alt+F4 / fullscreen close — all the
 * same Tauri `onCloseRequested` event) is waiting on a decision about
 * unsaved formulation drafts. See `lib/unsavedWork.ts` for the mechanism
 * and `lib/automaticBackup.ts` for the close-request handler that awaits
 * this dialog's answer.
 */
export function UnsavedCloseDialog() {
  const { t } = useTranslation("common");
  const pending = usePendingUnsavedClose();

  useEffect(() => {
    if (!pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") resolvePendingUnsavedClose("cancel");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pending]);

  if (!pending) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={() => resolvePendingUnsavedClose("cancel")}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={t("unsavedClose.title")}
        className="w-[400px] rounded-card border border-border bg-surface p-4 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-medium text-text">{t("unsavedClose.title")}</div>
        <p className="mt-1.5 text-sm text-muted">{t("unsavedClose.body")}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            autoFocus
            className="rounded-input border border-border px-3 py-1.5 text-sm text-text hover:bg-surface-2"
            onClick={() => resolvePendingUnsavedClose("cancel")}
          >
            {t("actions.cancel")}
          </button>
          <button
            className="rounded-input border border-error/40 px-3 py-1.5 text-sm text-error hover:bg-error/10"
            onClick={() => resolvePendingUnsavedClose("discard")}
          >
            {t("unsavedClose.closeWithoutSaving")}
          </button>
          <button
            className="rounded-input bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90"
            onClick={() => resolvePendingUnsavedClose("save")}
          >
            {t("unsavedClose.saveAndClose")}
          </button>
        </div>
      </div>
    </div>
  );
}
