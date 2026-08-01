import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  activeDataRootStatus,
  isTauri,
  openActiveDataRoot,
  type DataRootStatus,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import { Section } from "./Section";

/**
 * Phase 11 Session 4 — Active Data Location. Read-only status: the
 * resolved active data root, which pointer (if any) produced it, whether
 * it's writable, and any warning a malformed/missing/divergent pointer or
 * a conflicting second root produced. Relocation and a data-moving "Data
 * Location Manager" are deliberately out of scope this session — this
 * card only ever reads and reveals, never writes or merges.
 */
export function ActiveDataLocationCard() {
  const { t } = useTranslation(["settings", "common"]);
  const [status, setStatus] = useState<DataRootStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauri) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setStatus(await activeDataRootStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reveal = useCallback(async () => {
    try {
      await openActiveDataRoot();
    } catch (e) {
      toast.error(`${t("dataLocation.toast.openFailed")}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [t]);

  return (
    <Section
      title={t("dataLocation.title")}
      hint={t("dataLocation.hint")}
      action={
        isTauri ? (
          <button
            className="inline-flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[12px] text-muted hover:text-text"
            onClick={() => void refresh()}
            disabled={loading}
            title={t("dataLocation.refresh")}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}{" "}
            {t("dataLocation.refresh")}
          </button>
        ) : undefined
      }
    >
      {!isTauri ? (
        <p className="text-[13px] text-muted">{t("dataLocation.unavailable")}</p>
      ) : error ? (
        <p className="text-[13px] text-error">{error}</p>
      ) : loading || !status ? (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 size={14} className="animate-spin" />
          {t("dataLocation.checking")}
        </div>
      ) : (
        <div className="space-y-3 text-[13px]">
          <div className="flex items-center gap-2">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", status.writable ? "bg-ok" : "bg-error")} />
            <span className="min-w-0 flex-1 select-all truncate font-mono text-[12px] text-text">{status.path}</span>
            <button
              className="flex h-8 shrink-0 items-center gap-1 rounded-input border border-border bg-surface px-2.5 text-[12px] text-text hover:bg-surface-2"
              onClick={() => void reveal()}
            >
              <FolderOpen size={13} /> {t("dataLocation.openFolder")}
            </button>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">{t("dataLocation.source")}</dt>
            <dd className="text-text">{t(`dataLocation.sourceLabel.${status.source}`)}</dd>
            <dt className="text-muted">{t("dataLocation.writable")}</dt>
            <dd className="text-text">{status.writable ? t("dataLocation.writableYes") : t("dataLocation.writableNo")}</dd>
          </dl>
          {status.warnings.length > 0 && (
            <div className="rounded-input border border-warn/40 bg-warn/10 p-2.5">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
                <ul className="min-w-0 flex-1 list-disc space-y-1 pl-4 text-xs text-text">
                  {status.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
