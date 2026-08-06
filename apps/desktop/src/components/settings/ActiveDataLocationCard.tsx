import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderInput,
  FolderOpen,
  FolderSearch,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  activeDataRootStatus,
  cancelDataMove,
  checkInterruptedDataMove,
  cleanupOldDataLocation,
  isTauri,
  moveDataLocation,
  openActiveDataRoot,
  pickFolder,
  resumeInterruptedDataMove,
  restoreDefaultDataLocation,
  activateExistingDataLocation,
  validateDataMoveDestination,
  watchDataMoveProgress,
  type DataMoveJournalEntry,
  type DataMoveProgress,
  type DataMoveRecoveryResult,
  type DataMoveResult,
  type DataRootStatus,
  type DestinationValidation,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import { Section } from "./Section";

type Intent = "move" | "useExisting";

type Phase =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "validated"; validation: DestinationValidation }
  | { kind: "confirmMove"; validation: DestinationValidation }
  | { kind: "moving"; progress: DataMoveProgress | null }
  | { kind: "moveDone"; result: DataMoveResult; oldRoot: string }
  | { kind: "moveFailed"; message: string }
  | { kind: "confirmUseExisting"; validation: DestinationValidation }
  | { kind: "switching" }
  | { kind: "confirmRestoreDefault" }
  | { kind: "restoringDefault" }
  | { kind: "restoreDefaultDone" }
  | { kind: "confirmCleanup"; oldRoot: string }
  | { kind: "cleaningUp" }
  | { kind: "cleanupDone" };

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

/**
 * Phase 11 Session 8 — Data Location Manager. Extends Session 4's
 * read-only Active Data Location card with a safe way to actually
 * relocate the active data root (validate -> safety backup -> stage ->
 * verify -> activate -> confirm), point at an already-existing FormuLab
 * root without copying anything, or restore the built-in default. The
 * previous location is never deleted automatically — only a separate,
 * explicitly-confirmed cleanup action does that.
 */
export function ActiveDataLocationCard() {
  const { t } = useTranslation(["settings", "common"]);
  const [status, setStatus] = useState<DataRootStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState<DataMoveJournalEntry | null>(null);
  const [recovery, setRecovery] = useState<DataMoveRecoveryResult | null>(null);
  const [resuming, setResuming] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const intentRef = useRef<Intent>("move");
  const unlistenRef = useRef<(() => void) | null>(null);

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

  useEffect(() => {
    if (!isTauri) return;
    void checkInterruptedDataMove().then(setInterrupted);
  }, []);

  const stopWatching = useCallback(() => {
    unlistenRef.current?.();
    unlistenRef.current = null;
  }, []);

  const reveal = useCallback(async () => {
    try {
      await openActiveDataRoot();
    } catch (e) {
      toast.error(`${t("dataLocation.toast.openFailed")}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [t]);

  const pickAndValidate = useCallback(
    async (intent: Intent) => {
      const picked = await pickFolder();
      if (!picked) return;
      intentRef.current = intent;
      setPhase({ kind: "validating" });
      try {
        const validation = await validateDataMoveDestination(picked);
        setPhase({ kind: "validated", validation });
      } catch (e) {
        setPhase({ kind: "moveFailed", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [],
  );

  const proceedToConfirm = useCallback((validation: DestinationValidation) => {
    if (intentRef.current === "move") setPhase({ kind: "confirmMove", validation });
    else setPhase({ kind: "confirmUseExisting", validation });
  }, []);

  const runMove = useCallback(
    async (validation: DestinationValidation) => {
      const oldRoot = status?.path ?? "";
      setPhase({ kind: "moving", progress: null });
      unlistenRef.current = await watchDataMoveProgress((p) => {
        setPhase((prev) => (prev.kind === "moving" ? { kind: "moving", progress: p } : prev));
      });
      try {
        const result = await moveDataLocation(validation.path);
        setPhase({ kind: "moveDone", result, oldRoot });
        toast.success(t("dataLocation.toast.moved"));
        void refresh();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message === "cancelled") {
          setPhase({ kind: "idle" });
        } else {
          setPhase({ kind: "moveFailed", message });
          toast.error(`${t("dataLocation.toast.moveFailed")}: ${message}`);
        }
      } finally {
        stopWatching();
      }
    },
    [refresh, status, stopWatching, t],
  );

  const runUseExisting = useCallback(
    async (validation: DestinationValidation) => {
      setPhase({ kind: "switching" });
      try {
        const result = await activateExistingDataLocation(validation.path);
        setPhase({ kind: "moveDone", result, oldRoot: status?.path ?? "" });
        toast.success(t("dataLocation.toast.switched"));
        void refresh();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setPhase({ kind: "moveFailed", message });
        toast.error(`${t("dataLocation.toast.switchFailed")}: ${message}`);
      }
    },
    [refresh, status, t],
  );

  const runRestoreDefault = useCallback(async () => {
    setPhase({ kind: "restoringDefault" });
    try {
      await restoreDefaultDataLocation();
      setPhase({ kind: "restoreDefaultDone" });
      toast.success(t("dataLocation.toast.restoredDefault"));
      void refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`${t("dataLocation.toast.restoreDefaultFailed")}: ${message}`);
      setPhase({ kind: "idle" });
    }
  }, [refresh, t]);

  const runCleanup = useCallback(
    async (oldRoot: string) => {
      setPhase({ kind: "cleaningUp" });
      try {
        await cleanupOldDataLocation(oldRoot);
        setPhase({ kind: "cleanupDone" });
        toast.success(t("dataLocation.toast.cleanedUp"));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        toast.error(`${t("dataLocation.toast.cleanupFailed")}: ${message}`);
        setPhase({ kind: "idle" });
      }
    },
    [t],
  );

  const runResume = useCallback(async () => {
    setResuming(true);
    try {
      const result = await resumeInterruptedDataMove();
      setRecovery(result);
      setInterrupted(null);
      void refresh();
    } catch (e) {
      toast.error(`${t("dataLocation.toast.resumeFailed")}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setResuming(false);
    }
  }, [refresh, t]);

  const reset = () => setPhase({ kind: "idle" });

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
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {t("dataLocation.refresh")}
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
          {interrupted && (
            <div className="rounded-input border border-warn/40 bg-warn/10 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
                <div className="min-w-0 flex-1 text-[13px] text-text">
                  <p className="font-medium">{t("dataLocation.interruptedTitle")}</p>
                  <p className="mt-1 text-xs text-muted">
                    {t("dataLocation.interruptedHint", { destination: interrupted.destinationRoot })}
                  </p>
                  <button className={cn(btnGhost(), "mt-2")} onClick={() => void runResume()} disabled={resuming}>
                    {resuming ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                    {t("dataLocation.resumeButton")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {recovery && (
            <div
              className={cn(
                "rounded-input border p-3 text-[13px]",
                recovery.action === "completed" ? "border-ok/40 bg-ok/10 text-text" : "border-warn/40 bg-warn/10 text-text",
              )}
            >
              <p className="font-medium">
                {recovery.action === "completed" ? t("dataLocation.recoveredCompleted") : t("dataLocation.recoveredRolledBack")}
              </p>
              <p className="mt-1 text-xs text-muted">{recovery.detail}</p>
              <button className={cn(btnGhost(), "mt-2")} onClick={() => setRecovery(null)}>
                {t("dataLocation.done")}
              </button>
            </div>
          )}

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

          {phase.kind === "idle" && (
            <div className="flex flex-wrap gap-2 border-t border-faint pt-3">
              <button className={btnGhost()} onClick={() => void pickAndValidate("move")}>
                <FolderInput size={13} /> {t("dataLocation.changeLocation")}
              </button>
              <button className={btnGhost()} onClick={() => void pickAndValidate("useExisting")}>
                <FolderSearch size={13} /> {t("dataLocation.useExistingLocation")}
              </button>
              <button className={btnGhost()} onClick={() => setPhase({ kind: "confirmRestoreDefault" })}>
                <RotateCcw size={13} /> {t("dataLocation.restoreDefaultButton")}
              </button>
            </div>
          )}

          {phase.kind === "validating" && (
            <div className="flex items-center gap-2 border-t border-faint pt-3 text-[13px] text-muted">
              <Loader2 size={14} className="animate-spin" />
              {t("dataLocation.validating")}
            </div>
          )}

          {phase.kind === "validated" && (
            <ValidationPanel
              validation={phase.validation}
              onProceed={() => proceedToConfirm(phase.validation)}
              onCancel={reset}
            />
          )}

          {phase.kind === "confirmMove" && (
            <ConfirmPanel
              icon={<FolderInput size={15} className="text-warn" />}
              title={t("dataLocation.confirmMoveTitle")}
              hint={t("dataLocation.confirmMoveHint", { destination: phase.validation.path })}
              confirmLabel={t("dataLocation.moveButton")}
              onConfirm={() => void runMove(phase.validation)}
              onCancel={reset}
            />
          )}

          {phase.kind === "confirmUseExisting" && (
            <ConfirmPanel
              icon={<FolderSearch size={15} className="text-warn" />}
              title={t("dataLocation.confirmUseExistingTitle")}
              hint={t("dataLocation.confirmUseExistingHint", { destination: phase.validation.path })}
              confirmLabel={t("dataLocation.useExistingLocation")}
              onConfirm={() => void runUseExisting(phase.validation)}
              onCancel={reset}
            />
          )}

          {phase.kind === "confirmRestoreDefault" && (
            <ConfirmPanel
              icon={<RotateCcw size={15} className="text-warn" />}
              title={t("dataLocation.confirmRestoreDefaultTitle")}
              hint={t("dataLocation.confirmRestoreDefaultHint")}
              confirmLabel={t("dataLocation.restoreDefaultButton")}
              onConfirm={() => void runRestoreDefault()}
              onCancel={reset}
            />
          )}

          {(phase.kind === "moving" || phase.kind === "switching" || phase.kind === "restoringDefault" || phase.kind === "cleaningUp") && (
            <div className="rounded-input border border-border bg-surface-2 p-3">
              <div className="flex items-center gap-2 text-[13px] text-text">
                <Loader2 size={14} className="animate-spin" />
                {phase.kind === "moving" && t("dataLocation.movingLabel")}
                {phase.kind === "switching" && t("dataLocation.switchingLabel")}
                {phase.kind === "restoringDefault" && t("dataLocation.restoringLabel")}
                {phase.kind === "cleaningUp" && t("dataLocation.cleaningUpLabel")}
              </div>
              {phase.kind === "moving" && phase.progress && (
                <div className="mt-1.5 truncate text-xs text-muted" title={phase.progress.message}>
                  {t(`dataLocation.phase.${phase.progress.phase}`, { defaultValue: phase.progress.phase })}
                  {phase.progress.total > 0 && ` — ${phase.progress.current}/${phase.progress.total}`}
                  {phase.progress.message ? ` · ${phase.progress.message}` : ""}
                </div>
              )}
              {phase.kind === "moving" && (
                <button className={cn(btnGhost(), "mt-2")} onClick={() => void cancelDataMove()}>
                  {t("dataLocation.cancel")}
                </button>
              )}
            </div>
          )}

          {phase.kind === "moveDone" && (
            <MoveDoneSummary
              result={phase.result}
              oldRoot={phase.oldRoot}
              onDone={reset}
              // eslint-disable-next-line i18next/no-literal-string -- internal phase-kind tag, not display text
              onCleanup={() => setPhase({ kind: "confirmCleanup", oldRoot: phase.oldRoot })}
            />
          )}

          {phase.kind === "confirmCleanup" && (
            <ConfirmPanel
              icon={<Trash2 size={15} className="text-error" />}
              title={t("dataLocation.confirmCleanupTitle")}
              hint={t("dataLocation.confirmCleanupHint", { path: phase.oldRoot })}
              confirmLabel={t("dataLocation.cleanupButton")}
              danger
              onConfirm={() => void runCleanup(phase.oldRoot)}
              onCancel={reset}
            />
          )}

          {phase.kind === "cleanupDone" && (
            <div className="rounded-input border border-ok/40 bg-ok/10 p-3 text-[13px] text-text">
              <p className="font-medium">{t("dataLocation.cleanupDoneTitle")}</p>
              <button className={cn(btnGhost(), "mt-2")} onClick={reset}>
                {t("dataLocation.done")}
              </button>
            </div>
          )}

          {phase.kind === "restoreDefaultDone" && (
            <div className="rounded-input border border-ok/40 bg-ok/10 p-3 text-[13px] text-text">
              <p className="font-medium">{t("dataLocation.restoreDefaultDoneTitle")}</p>
              <button className={cn(btnGhost(), "mt-2")} onClick={reset}>
                {t("dataLocation.done")}
              </button>
            </div>
          )}

          {phase.kind === "moveFailed" && (
            <div className="rounded-input border border-error/40 bg-error/10 p-3 text-[13px] text-error">
              <p className="font-medium">{t("dataLocation.failedTitle")}</p>
              <p className="mt-1 text-xs">{phase.message}</p>
              <button className={cn(btnGhost(), "mt-2")} onClick={reset}>
                {t("dataLocation.done")}
              </button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function ValidationPanel({
  validation,
  onProceed,
  onCancel,
}: {
  validation: DestinationValidation;
  onProceed: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  const ok = validation.canMove || validation.canUseExisting;
  const Icon = ok ? CheckCircle2 : XCircle;
  const toneCls = ok ? "border-ok/40 bg-ok/10 text-text" : "border-error/40 bg-error/10 text-error";
  const iconCls = ok ? "text-ok" : "text-error";

  return (
    <div className={cn("rounded-input border p-3 text-[13px]", toneCls)}>
      <div className="flex items-center gap-2 font-medium">
        <Icon size={15} className={iconCls} />
        {t(`dataLocation.kind.${validation.kind}`)}
      </div>
      <p className="mt-1 truncate font-mono text-xs text-muted" title={validation.path}>
        {validation.path}
      </p>
      {validation.requiredBytes > 0 && (
        <p className="mt-1 text-xs text-muted">
          {t("dataLocation.spaceSummary", {
            required: formatBytes(validation.requiredBytes),
            available: formatBytes(validation.availableBytes),
          })}
        </p>
      )}
      {validation.blockers.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs">
          {validation.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {validation.warnings.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted">
          {validation.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        {ok && (
          <button className={btnAccent()} onClick={onProceed}>
            {validation.canMove ? t("dataLocation.moveButton") : t("dataLocation.useExistingLocation")}
          </button>
        )}
        <button className={btnGhost()} onClick={onCancel}>
          {t("common:actions.cancel")}
        </button>
      </div>
    </div>
  );
}

function ConfirmPanel({
  icon,
  title,
  hint,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("common");
  return (
    <div className="rounded-input border border-warn/40 bg-warn/10 p-3">
      <div className="flex items-start gap-2">
        {icon}
        <div className="min-w-0 flex-1 text-[13px] text-text">
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-xs text-muted">{hint}</p>
          <div className="mt-3 flex gap-2">
            <button
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-input px-3 text-[13px] font-medium text-white",
                danger ? "bg-error hover:bg-error/90" : "bg-accent text-accent-fg hover:bg-accent/90",
              )}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
            <button className={btnGhost()} onClick={onCancel}>
              {t("actions.cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MoveDoneSummary({
  result,
  oldRoot,
  onDone,
  onCleanup,
}: {
  result: DataMoveResult;
  oldRoot: string;
  onDone: () => void;
  onCleanup: () => void;
}) {
  const { t } = useTranslation(["settings", "common"]);
  return (
    <div className="rounded-input border border-ok/40 bg-ok/10 p-3 text-[13px] text-text">
      <p className="font-medium">{t("dataLocation.moveDoneTitle")}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">{t("dataLocation.newLocation")}</dt>
        <dd className="truncate font-mono">{result.destinationRoot}</dd>
        {result.filesMoved > 0 && (
          <>
            <dt className="text-muted">{t("dataLocation.filesMoved")}</dt>
            <dd>{t("dataLocation.filesAndSize", { count: result.filesMoved, size: formatBytes(result.totalBytes) })}</dd>
          </>
        )}
        <dt className="text-muted">{t("dataLocation.safetyBackup")}</dt>
        <dd className="truncate font-mono">{result.safetyBackupPath}</dd>
      </dl>
      {result.automaticBackup.adjusted && (
        <p className="mt-2 text-xs text-muted">{result.automaticBackup.note}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button className={btnGhost()} onClick={onDone}>
          {t("dataLocation.done")}
        </button>
        {oldRoot && oldRoot !== result.destinationRoot && (
          <button className={cn(btnGhost(), "text-error")} onClick={onCleanup}>
            <Trash2 size={13} /> {t("dataLocation.cleanupOldLocation")}
          </button>
        )}
      </div>
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
