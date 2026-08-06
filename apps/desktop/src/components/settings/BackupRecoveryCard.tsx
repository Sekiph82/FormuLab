import { useCallback, useRef, useState } from "react";
import { AlertTriangle, Archive, CheckCircle2, Loader2, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  cancelBackup,
  cancelRestore,
  createBackup,
  inspectBackup,
  isTauri,
  pickBackupDestination,
  pickBackupSource,
  restoreBackup,
  verifyBackup,
  watchBackupProgress,
  watchRestoreProgress,
  type BackupManifest,
  type BackupProgress,
  type RestoreResult,
  type VerificationReport,
  type VerificationStatus,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import { Section } from "./Section";

/** `1234567` -> `"1.18 MB"`. Binary (1024) units, matching how OS file
 *  pickers on this platform report size. */
function formatBytes(bytes: number): string {
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

function defaultBackupName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `formulab-backup-${stamp}.formulab-backup`;
}

type Phase =
  | { kind: "idle" }
  | { kind: "creating"; progress: BackupProgress | null }
  | { kind: "backupDone"; manifest: BackupManifest }
  | { kind: "backupFailed"; message: string }
  | { kind: "inspecting"; source: string }
  | { kind: "confirmRestore"; source: string; manifest: BackupManifest }
  | { kind: "restoring"; progress: BackupProgress | null }
  | { kind: "restoreDone"; result: RestoreResult }
  | { kind: "restoreFailed"; message: string }
  | { kind: "verifying" }
  | { kind: "verifyDone"; report: VerificationReport }
  | { kind: "verifyFailed"; message: string };

const STATUS_TONE: Record<VerificationStatus, "ok" | "warn" | "error"> = {
  valid: "ok",
  validWithWarnings: "warn",
  incompatible: "warn",
  corrupted: "error",
  unsafe: "error",
};

/**
 * Phase 11 Session 1 — Backup and Recovery. Bounded scope: create a full
 * `.formulab-backup` package, inspect one, and run a full restore with an
 * explicit confirmation step first (restore overwrites live data). Backup
 * history, standalone verification-only mode, and automatic backups are
 * deliberately out of scope for this session — see
 * docs/PHASE11_BACKUP_RESTORE_ARCHITECTURE.md.
 */
export function BackupRecoveryCard() {
  const { t } = useTranslation(["settings", "common"]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const unlistenRef = useRef<(() => void) | null>(null);

  const stopWatching = useCallback(() => {
    unlistenRef.current?.();
    unlistenRef.current = null;
  }, []);

  const startBackup = useCallback(async () => {
    if (!isTauri) return;
    const destination = await pickBackupDestination(defaultBackupName());
    if (!destination) return;

    setPhase({ kind: "creating", progress: null });
    unlistenRef.current = await watchBackupProgress((p) => {
      setPhase((prev) => (prev.kind === "creating" ? { kind: "creating", progress: p } : prev));
    });
    try {
      const manifest = await createBackup(destination);
      setPhase({ kind: "backupDone", manifest });
      toast.success(t("backup.toast.created"));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message === "cancelled") {
        setPhase({ kind: "idle" });
      } else {
        setPhase({ kind: "backupFailed", message });
        toast.error(`${t("backup.toast.createFailed")}: ${message}`);
      }
    } finally {
      stopWatching();
    }
  }, [stopWatching, t]);

  const startInspect = useCallback(async () => {
    if (!isTauri) return;
    const source = await pickBackupSource();
    if (!source) return;
    setPhase({ kind: "inspecting", source });
    try {
      const manifest = await inspectBackup(source);
      setPhase({ kind: "confirmRestore", source, manifest });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPhase({ kind: "restoreFailed", message });
      toast.error(`${t("backup.toast.inspectFailed")}: ${message}`);
    }
  }, [t]);

  const confirmRestore = useCallback(
    async (source: string) => {
      setPhase({ kind: "restoring", progress: null });
      unlistenRef.current = await watchRestoreProgress((p) => {
        setPhase((prev) => (prev.kind === "restoring" ? { kind: "restoring", progress: p } : prev));
      });
      try {
        const result = await restoreBackup(source);
        setPhase({ kind: "restoreDone", result });
        toast.success(t("backup.toast.restored"));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message === "cancelled") {
          setPhase({ kind: "idle" });
        } else {
          setPhase({ kind: "restoreFailed", message });
          toast.error(`${t("backup.toast.restoreFailed")}: ${message}`);
        }
      } finally {
        stopWatching();
      }
    },
    [stopWatching, t],
  );

  const startVerify = useCallback(async () => {
    if (!isTauri) return;
    const source = await pickBackupSource();
    if (!source) return;
    setPhase({ kind: "verifying" });
    try {
      const report = await verifyBackup(source);
      setPhase({ kind: "verifyDone", report });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPhase({ kind: "verifyFailed", message });
      toast.error(`${t("backup.toast.verifyFailed")}: ${message}`);
    }
  }, [t]);

  const cancelRunning = useCallback(async () => {
    if (phase.kind === "creating") await cancelBackup();
    if (phase.kind === "restoring") await cancelRestore();
  }, [phase.kind]);

  const reset = () => setPhase({ kind: "idle" });

  return (
    <Section title={t("backup.title")} hint={t("backup.hint")}>
      {!isTauri ? (
        <p className="text-[13px] text-muted">{t("backup.unavailable")}</p>
      ) : (
        <div className="space-y-3">
          {(phase.kind === "idle" ||
            phase.kind === "backupFailed" ||
            phase.kind === "restoreFailed" ||
            phase.kind === "verifyFailed") && (
            <div className="flex flex-wrap gap-2">
              <button className={btnAccent()} onClick={() => void startBackup()}>
                <Archive size={13} /> {t("backup.createButton")}
              </button>
              <button className={btnGhost()} onClick={() => void startInspect()}>
                <RotateCcw size={13} /> {t("backup.restoreButton")}
              </button>
              <button className={btnGhost()} onClick={() => void startVerify()}>
                <ShieldCheck size={13} /> {t("backup.verifyButton")}
              </button>
            </div>
          )}

          {(phase.kind === "creating" || phase.kind === "restoring") && (
            <div className="rounded-input border border-border bg-surface-2 p-3">
              <div className="flex items-center gap-2 text-[13px] text-text">
                <Loader2 size={14} className="animate-spin" />
                {phase.kind === "creating" ? t("backup.creatingLabel") : t("backup.restoringLabel")}
              </div>
              {phase.progress && (
                <div className="mt-1.5 truncate text-xs text-muted" title={phase.progress.message}>
                  {t(`backup.phase.${phase.progress.phase}`, { defaultValue: phase.progress.phase })}
                  {phase.progress.total > 0 && ` — ${phase.progress.current}/${phase.progress.total}`}
                  {phase.progress.message ? ` · ${phase.progress.message}` : ""}
                </div>
              )}
              <button className={cn(btnGhost(), "mt-2")} onClick={() => void cancelRunning()}>
                {t("backup.cancel")}
              </button>
            </div>
          )}

          {phase.kind === "inspecting" && (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 size={14} className="animate-spin" />
              {t("backup.inspecting")}
            </div>
          )}

          {phase.kind === "verifying" && (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 size={14} className="animate-spin" />
              {t("backup.verifying")}
            </div>
          )}

          {phase.kind === "verifyDone" && <VerifyResult report={phase.report} onDone={reset} />}

          {phase.kind === "confirmRestore" && (
            <div className="rounded-input border border-warn/40 bg-warn/10 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
                <div className="min-w-0 text-[13px] text-text">
                  <p className="font-medium">{t("backup.confirmTitle")}</p>
                  <p className="mt-1 text-xs text-muted">{t("backup.confirmHint")}</p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted">{t("backup.summary.appVersion")}</dt>
                    <dd className="text-text">{phase.manifest.formulabAppVersion}</dd>
                    <dt className="text-muted">{t("backup.summary.created")}</dt>
                    <dd className="text-text">
                      {new Date(phase.manifest.createdAt * 1000).toLocaleString()}
                    </dd>
                    <dt className="text-muted">{t("backup.summary.files")}</dt>
                    <dd className="text-text">{phase.manifest.fileInventory.length}</dd>
                    <dt className="text-muted">{t("backup.summary.size")}</dt>
                    <dd className="text-text">{formatBytes(phase.manifest.totalBytes)}</dd>
                  </dl>
                  {phase.manifest.warnings.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted">
                      {phase.manifest.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      className="flex h-8 items-center gap-1.5 rounded-input bg-error px-3 text-[13px] font-medium text-white hover:bg-error/90"
                      onClick={() => void confirmRestore(phase.source)}
                    >
                      {t("backup.confirmRestoreButton")}
                    </button>
                    <button className={btnGhost()} onClick={reset}>
                      {t("common:actions.cancel")}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {phase.kind === "backupDone" && (
            <div className="rounded-input border border-ok/40 bg-ok/10 p-3 text-[13px] text-text">
              <p className="font-medium">{t("backup.doneTitle")}</p>
              <p className="mt-1 text-xs text-muted">
                {t("backup.summary.filesAndSize", {
                  count: phase.manifest.fileInventory.length,
                  size: formatBytes(phase.manifest.totalBytes),
                })}
              </p>
              {phase.manifest.warnings.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted">
                  {phase.manifest.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              <button className={cn(btnGhost(), "mt-2")} onClick={reset}>
                {t("backup.done")}
              </button>
            </div>
          )}

          {phase.kind === "restoreDone" && (
            <div className="rounded-input border border-ok/40 bg-ok/10 p-3 text-[13px] text-text">
              <p className="font-medium">{t("backup.restoreDoneTitle")}</p>
              <p className="mt-1 text-xs text-muted">
                {t("backup.summary.restoredCount", { count: phase.result.restoredPaths.length })}
              </p>
              <p className="mt-1 text-xs text-muted">
                {t("backup.summary.safetyBackupAt")}{" "}
                <span className="select-all font-mono">{phase.result.safetyBackupPath}</span>
              </p>
              <button className={cn(btnGhost(), "mt-2")} onClick={reset}>
                {t("backup.done")}
              </button>
            </div>
          )}

          {(phase.kind === "backupFailed" || phase.kind === "restoreFailed" || phase.kind === "verifyFailed") && (
            <div className="rounded-input border border-error/40 bg-error/10 p-3 text-[13px] text-error">
              <p className="font-medium">{t("backup.failedTitle")}</p>
              <p className="mt-1 text-xs">{phase.message}</p>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

/** The result panel for a completed verification — a status badge, every
 *  error/warning the checks found, and the manifest summary when one could
 *  be read (even an `unsafe`/`corrupted` result may still carry a manifest,
 *  if only a later check failed). Read-only: nothing here can restore or
 *  otherwise touch the active data root. */
function VerifyResult({ report, onDone }: { report: VerificationReport; onDone: () => void }) {
  const { t } = useTranslation(["settings", "common"]);
  const tone = STATUS_TONE[report.status];
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? AlertTriangle : XCircle;
  const toneCls =
    tone === "ok" ? "border-ok/40 bg-ok/10 text-text" : tone === "warn" ? "border-warn/40 bg-warn/10 text-text" : "border-error/40 bg-error/10 text-error";
  const iconCls = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-error";

  return (
    <div className={cn("rounded-input border p-3 text-[13px]", toneCls)}>
      <div className="flex items-center gap-2 font-medium">
        <Icon size={15} className={iconCls} />
        {t(`backup.status.${report.status}`)}
      </div>
      {report.manifest && (
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted">{t("backup.summary.appVersion")}</dt>
          <dd>{report.manifest.formulabAppVersion}</dd>
          <dt className="text-muted">{t("backup.summary.created")}</dt>
          <dd>{new Date(report.manifest.createdAt * 1000).toLocaleString()}</dd>
          <dt className="text-muted">{t("backup.summary.files")}</dt>
          <dd>{report.manifest.fileInventory.length}</dd>
          <dt className="text-muted">{t("backup.summary.size")}</dt>
          <dd>{formatBytes(report.manifest.totalBytes)}</dd>
        </dl>
      )}
      {report.errors.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium">{t("backup.errorsHeading")}</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs">
            {report.errors.map((e, i) => (
              <li key={`${e.code}-${i}`}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}
      {report.warnings.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-muted">{t("backup.warningsHeading")}</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs text-muted">
            {report.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}
      <button className={cn(btnGhost(), "mt-3")} onClick={onDone}>
        {t("backup.done")}
      </button>
    </div>
  );
}

const btnGhost = (extra = "") =>
  cn(
    "flex h-9 shrink-0 items-center gap-1 rounded-input border border-border bg-surface px-3.5",
    "text-[13px] text-text transition-colors hover:bg-surface-2 disabled:text-muted",
    extra,
  );

const btnAccent = (extra = "") =>
  cn(
    "flex h-9 shrink-0 items-center gap-1.5 rounded-input bg-accent px-3.5 text-[13px] font-medium",
    "text-accent-fg transition-colors hover:bg-accent/90 disabled:bg-accent/50",
    extra,
  );
