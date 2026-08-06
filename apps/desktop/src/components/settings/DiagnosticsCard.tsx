import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ClipboardCopy, Download, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  exportSupportBundle,
  getDiagnosticsSummary,
  openLogFolder,
  pickSupportBundleDestination,
  defaultSupportBundleName,
  type DiagnosticsSummary,
} from "@/lib/diagnostics";
import { isTauri } from "@/lib/tauri";
import { copyText } from "@/lib/clipboard";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import { Section } from "./Section";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatWhen(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString();
}

/** `LogErrorLine.at`/`LastBackupInfo.createdAt` for automatic/safety-net
 *  backups are epoch *milliseconds* and *seconds* respectively — different
 *  units by construction (`LastBackupInfo.createdAt` reuses the backup
 *  filename's own epoch-seconds scheme; `debug.log` lines use
 *  `SystemTime`'s millisecond precision) — always format through the
 *  matching helper, never interchange them. */
function formatWhenMillis(epochMillis: number): string {
  if (epochMillis === 0) return "unknown time";
  return new Date(epochMillis).toLocaleString();
}

const BACKUP_KIND_LABELS: Record<NonNullable<DiagnosticsSummary["lastBackup"]>["kind"], string> = {
  preMigration: "pre-migration safety backup",
  preRestore: "pre-restore safety backup",
  automaticDaily: "automatic daily backup",
  automaticWeekly: "automatic weekly backup",
};

function buildSummaryText(s: DiagnosticsSummary): string {
  const current = s.recentErrors.filter((e) => e.currentSession);
  const historical = s.recentErrors.filter((e) => !e.currentSession);
  const lines = [
    `FormuLab ${s.appVersion}${s.buildId ? ` (${s.buildId})` : ""}`,
    `OS: ${s.os} (${s.arch})`,
    `Active data path: ${s.activeDataPath}`,
    `Resolved from: ${s.rootResolutionSource}`,
    `Writable: ${s.writable ? "yes" : "no"}`,
    `Free disk space: ${formatBytes(s.freeDiskSpaceBytes)}`,
    `Schema version: ${s.globalSchemaVersion} (${s.schemaStatus})`,
    `Pending migrations: ${s.pendingMigrationCount}`,
    `Last migration: ${s.lastMigration ? `${s.lastMigration.status} at ${formatWhen(s.lastMigration.at)}` : "none"}`,
    `Last automatic/safety backup: ${
      s.lastBackup
        ? `${BACKUP_KIND_LABELS[s.lastBackup.kind]} — ${s.lastBackup.filename} (${formatWhen(s.lastBackup.createdAt)})`
        : "none found in the default location (a standalone backup you saved elsewhere isn't tracked here)"
    }`,
    `Storage health: ${s.storageHealth.healthyCount} healthy, ${s.storageHealth.unhealthy.length} unhealthy`,
    ...s.storageHealth.unhealthy.map((c) => `  - ${c.name}: unreadable`),
    `Log directories: ${s.logDirectories.join(", ")}`,
    `Root warnings (informational — not necessarily an error): ${s.rootWarnings.length === 0 ? "none" : ""}`,
    ...s.rootWarnings.map((w) => `  - ${w}`),
    `Current-session log lines mentioning an error (${current.length}):`,
    ...current.map((e) => `  [${formatWhenMillis(e.at)}] ${e.message}`),
    `Historical log lines mentioning an error, from before this run (${historical.length}):`,
    ...historical.map((e) => `  [${formatWhenMillis(e.at)}] ${e.message}`),
  ];
  return lines.join("\n");
}

/**
 * Phase 11 Session 5 — Diagnostics Center. Read-mostly: the only writes
 * are the sanitized support-bundle file the user explicitly chooses to
 * save. No crash-dump capability is implied anywhere here — "recent
 * errors" is a bounded, best-effort scan of `debug.log`, not a structured
 * error log.
 */
export function DiagnosticsCard() {
  const { t } = useTranslation(["settings", "common"]);
  const [summary, setSummary] = useState<DiagnosticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauri) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSummary(await getDiagnosticsSummary());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openLogs = useCallback(async () => {
    try {
      await openLogFolder();
    } catch (e) {
      toast.error(`${t("diagnostics.toast.openLogFolderFailed")}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [t]);

  const copySummary = useCallback(async () => {
    if (!summary) return;
    try {
      await copyText(buildSummaryText(summary));
      toast.success(t("diagnostics.toast.copied"));
    } catch (e) {
      toast.error(`${t("diagnostics.toast.copyFailed")}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [summary, t]);

  const exportBundle = useCallback(async () => {
    const destination = await pickSupportBundleDestination(defaultSupportBundleName());
    if (!destination) return;
    setExporting(true);
    try {
      await exportSupportBundle(destination);
      toast.success(t("diagnostics.toast.exported"));
    } catch (e) {
      toast.error(`${t("diagnostics.toast.exportFailed")}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  }, [t]);

  const currentErrors = summary?.recentErrors.filter((e) => e.currentSession) ?? [];
  const historicalErrors = summary?.recentErrors.filter((e) => !e.currentSession) ?? [];

  return (
    <Section
      title={t("diagnostics.title")}
      hint={t("diagnostics.hint")}
      action={
        isTauri ? (
          <button
            className="inline-flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[12px] text-muted hover:text-text"
            onClick={() => void refresh()}
            disabled={loading}
            title={t("diagnostics.refresh")}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}{" "}
            {t("diagnostics.refresh")}
          </button>
        ) : undefined
      }
    >
      {!isTauri ? (
        <p className="text-[13px] text-muted">{t("diagnostics.unavailable")}</p>
      ) : error ? (
        <p className="text-[13px] text-error">{error}</p>
      ) : loading || !summary ? (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Loader2 size={14} className="animate-spin" />
          {t("diagnostics.checking")}
        </div>
      ) : (
        <div className="space-y-3 text-[13px]">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">{t("diagnostics.appVersion")}</dt>
            <dd className="text-text">{summary.appVersion}</dd>
            <dt className="text-muted">{t("diagnostics.os")}</dt>
            <dd className="text-text">
              {summary.os} ({summary.arch})
            </dd>
            <dt className="text-muted">{t("diagnostics.activeDataPath")}</dt>
            <dd className="select-all truncate font-mono text-[11px] text-text">{summary.activeDataPath}</dd>
            <dt className="text-muted">{t("diagnostics.writable")}</dt>
            <dd className="text-text">{summary.writable ? t("diagnostics.writableYes") : t("diagnostics.writableNo")}</dd>
            <dt className="text-muted">{t("diagnostics.freeDiskSpace")}</dt>
            <dd className="text-text">{formatBytes(summary.freeDiskSpaceBytes)}</dd>
            <dt className="text-muted">{t("diagnostics.schemaVersion")}</dt>
            <dd className="text-text">
              {summary.globalSchemaVersion} · {summary.pendingMigrationCount}{" "}
              {t("diagnostics.pendingMigrations")}
            </dd>
            <dt className="text-muted">{t("diagnostics.lastBackup")}</dt>
            <dd className="text-text">
              {summary.lastBackup
                ? `${BACKUP_KIND_LABELS[summary.lastBackup.kind]} — ${formatWhen(summary.lastBackup.createdAt)}`
                : t("diagnostics.none")}
            </dd>
            <dt className="text-muted">{t("diagnostics.storageHealth")}</dt>
            <dd className={cn("text-text", summary.storageHealth.unhealthy.length > 0 && "text-error")}>
              {t("diagnostics.storageHealthValue", {
                healthy: summary.storageHealth.healthyCount,
                unhealthy: summary.storageHealth.unhealthy.length,
              })}
            </dd>
          </dl>

          {summary.rootWarnings.length > 0 && (
            <div className="rounded-input border border-warn/40 bg-warn/10 p-2.5">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
                    {t("diagnostics.informational")}
                  </p>
                  <ul className="list-disc space-y-1 pl-4 text-xs text-text">
                    {summary.rootWarnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {currentErrors.length > 0 && (
            <div>
              <p className="text-xs font-medium text-error">
                {t("diagnostics.currentErrors", { count: currentErrors.length })}
              </p>
              <div className="mt-1 max-h-32 overflow-y-auto rounded-input border border-error/40 bg-error/5 p-2 font-mono text-[11px] text-text">
                {currentErrors.map((line, i) => (
                  <div key={i} className="truncate" title={line.message}>
                    <span className="text-muted">[{formatWhenMillis(line.at)}]</span> {line.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {historicalErrors.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted">
                {t("diagnostics.historicalErrors", { count: historicalErrors.length })}
              </p>
              <div className="mt-1 max-h-32 overflow-y-auto rounded-input border border-border bg-surface-2 p-2 font-mono text-[11px] text-muted opacity-75">
                {historicalErrors.map((line, i) => (
                  <div key={i} className="truncate" title={line.message}>
                    <span>[{formatWhenMillis(line.at)}]</span> {line.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button className={btnGhost()} onClick={() => void openLogs()}>
              <FolderOpen size={13} /> {t("diagnostics.openLogFolder")}
            </button>
            <button className={btnGhost()} onClick={() => void copySummary()}>
              <ClipboardCopy size={13} /> {t("diagnostics.copySummary")}
            </button>
            <button className={btnGhost()} onClick={() => void exportBundle()} disabled={exporting}>
              {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}{" "}
              {t("diagnostics.exportBundle")}
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

const btnGhost = (extra = "") =>
  cn(
    "flex h-9 shrink-0 items-center gap-1 rounded-input border border-border bg-surface px-3.5",
    "text-[13px] text-text transition-colors hover:bg-surface-2 disabled:text-muted",
    extra,
  );
