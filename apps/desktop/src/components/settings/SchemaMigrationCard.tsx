import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, PlayCircle, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  checkForInterruptedMigration,
  checkSchemaCompatibility,
  computeMigrationPlan,
  dryRunMigration,
  recoverInterruptedMigration,
  runMigration,
  type DryRunResult,
  type InterruptedMigration,
  type MigrationPlan,
  type MigrationRunStatus,
  type SchemaCompatibility,
} from "@/lib/migrationRunner";
import { isTauri } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import { Section } from "./Section";

type Phase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "dryRunning" }
  | { kind: "dryRunDone"; result: DryRunResult }
  | { kind: "dryRunFailed"; message: string }
  | { kind: "running" }
  | { kind: "runDone"; result: Extract<MigrationRunStatus, { kind: "completed" }> }
  | { kind: "runFailed"; result: Extract<MigrationRunStatus, { kind: "failed" }> }
  | { kind: "rejected"; currentVersion: string; supportedVersion: string };

/**
 * Phase 11 Session 3 — Schema Migration status and controls. Bounded scope:
 * shows the current global schema version, any pending migrations, lets the
 * user dry-run or run them, and surfaces an interrupted-run recovery
 * prompt. Never migrates automatically — every run is a deliberate click,
 * per this session's own instruction.
 */
export function SchemaMigrationCard() {
  const { t } = useTranslation(["settings", "common"]);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [compat, setCompat] = useState<SchemaCompatibility | null>(null);
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [interrupted, setInterrupted] = useState<InterruptedMigration | null>(null);
  const [recovering, setRecovering] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauri) return;
    setPhase({ kind: "loading" });
    try {
      const [foundInterrupted, compatibility] = await Promise.all([
        checkForInterruptedMigration(),
        checkSchemaCompatibility(),
      ]);
      setInterrupted(foundInterrupted);
      setCompat(compatibility);
      if (compatibility.status === "futureUnsupported") {
        setPhase({ kind: "rejected", currentVersion: compatibility.currentVersion, supportedVersion: compatibility.supportedVersion });
        return;
      }
      const computedPlan = await computeMigrationPlan();
      setPlan(computedPlan);
      setPhase({ kind: "ready" });
    } catch (e) {
      setPhase({ kind: "ready" });
      toast.error(`${t("migration.toast.loadFailed")}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runDryRun = useCallback(async () => {
    setPhase({ kind: "dryRunning" });
    try {
      const result = await dryRunMigration();
      setPhase({ kind: "dryRunDone", result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPhase({ kind: "dryRunFailed", message });
      toast.error(`${t("migration.toast.dryRunFailed")}: ${message}`);
    }
  }, [t]);

  const runReal = useCallback(async () => {
    setPhase({ kind: "running" });
    try {
      const status = await runMigration();
      if (status.kind === "completed") {
        setPhase({ kind: "runDone", result: status });
        toast.success(t("migration.toast.completed"));
      } else if (status.kind === "failed") {
        setPhase({ kind: "runFailed", result: status });
        toast.error(`${t("migration.toast.failed")}: ${status.message}`);
      } else if (status.kind === "rejected_future_version") {
        setPhase({ kind: "rejected", currentVersion: status.currentVersion, supportedVersion: status.supportedVersion });
      } else {
        setPhase({ kind: "ready" });
        toast.success(t("migration.toast.nothingPending"));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPhase({ kind: "runFailed", result: { kind: "failed", runId: "", message, backupPath: "", rolledBack: false } });
      toast.error(`${t("migration.toast.failed")}: ${message}`);
    }
  }, [t]);

  const recover = useCallback(async () => {
    if (!interrupted) return;
    setRecovering(true);
    try {
      await recoverInterruptedMigration(interrupted.runId, interrupted.backupPath ?? "");
      toast.success(t("migration.toast.recovered"));
      setInterrupted(null);
      await refresh();
    } catch (e) {
      toast.error(`${t("migration.toast.recoverFailed")}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRecovering(false);
    }
  }, [interrupted, refresh, t]);

  const pendingCount = plan?.steps.length ?? 0;

  return (
    <Section title={t("migration.title")} hint={t("migration.hint")}>
      {!isTauri ? (
        <p className="text-[13px] text-muted">{t("migration.unavailable")}</p>
      ) : (
        <div className="space-y-3">
          {interrupted && (
            <div className="rounded-input border border-error/40 bg-error/10 p-3 text-[13px] text-error">
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium">{t("migration.interruptedTitle")}</p>
                  <p className="mt-1 text-xs">{t("migration.interruptedHint")}</p>
                  <button
                    className="mt-2 flex h-8 items-center gap-1.5 rounded-input bg-error px-3 text-[13px] font-medium text-white hover:bg-error/90 disabled:opacity-60"
                    onClick={() => void recover()}
                    disabled={recovering}
                  >
                    {recovering ? <Loader2 size={12} className="animate-spin" /> : null}
                    {t("migration.recoverButton")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {phase.kind === "loading" && (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 size={14} className="animate-spin" />
              {t("migration.checking")}
            </div>
          )}

          {phase.kind !== "loading" && compat && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted">{t("migration.currentVersion")}</dt>
              <dd className="text-text">{compat.currentVersion}</dd>
              <dt className="text-muted">{t("migration.pendingCount")}</dt>
              <dd className="text-text">{pendingCount}</dd>
            </dl>
          )}

          {phase.kind === "rejected" && (
            <div className="rounded-input border border-error/40 bg-error/10 p-3 text-[13px] text-error">
              <p className="font-medium">{t("migration.rejectedTitle")}</p>
              <p className="mt-1 text-xs">
                {t("migration.rejectedHint", { current: phase.currentVersion, supported: phase.supportedVersion })}
              </p>
            </div>
          )}

          {(phase.kind === "ready" || phase.kind === "dryRunDone" || phase.kind === "dryRunFailed") && (
            <div className="flex flex-wrap gap-2">
              <button className={btnGhost()} onClick={() => void runDryRun()}>
                <FlaskConical size={13} /> {t("migration.dryRunButton")}
              </button>
              <button className={btnAccent()} onClick={() => void runReal()} disabled={pendingCount === 0}>
                <PlayCircle size={13} /> {t("migration.runButton")}
              </button>
            </div>
          )}

          {(phase.kind === "dryRunning" || phase.kind === "running") && (
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Loader2 size={14} className="animate-spin" />
              {phase.kind === "dryRunning" ? t("migration.dryRunningLabel") : t("migration.runningLabel")}
            </div>
          )}

          {phase.kind === "dryRunDone" && (
            <div className="rounded-input border border-border bg-surface-2 p-3 text-[13px] text-text">
              <p className="font-medium">{t("migration.dryRunDoneTitle")}</p>
              {phase.result.collections.length === 0 ? (
                <p className="mt-1 text-xs text-muted">{t("migration.nothingPending")}</p>
              ) : (
                <ul className="mt-2 space-y-1 text-xs">
                  {phase.result.collections.map((c) => (
                    <li key={c.collection}>
                      {t("migration.dryRunRow", {
                        collection: c.collection,
                        from: c.currentVersion,
                        to: c.targetVersion,
                        changed: c.rowsThatWouldChange,
                        total: c.rowsInspected,
                      })}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {phase.kind === "runDone" && (
            <div className="rounded-input border border-ok/40 bg-ok/10 p-3 text-[13px] text-text">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 size={15} className="text-ok" />
                {t("migration.runDoneTitle")}
              </div>
              <p className="mt-1 text-xs text-muted">
                {t("migration.runDoneHint", {
                  count: phase.result.migratedCollections.length,
                  version: phase.result.newVersion,
                })}
              </p>
            </div>
          )}

          {(phase.kind === "runFailed" || phase.kind === "dryRunFailed") && (
            <div className="rounded-input border border-error/40 bg-error/10 p-3 text-[13px] text-error">
              <div className="flex items-center gap-2 font-medium">
                <XCircle size={15} />
                {t("migration.failedTitle")}
              </div>
              <p className="mt-1 text-xs">
                {phase.kind === "runFailed" ? phase.result.message : phase.message}
              </p>
              {phase.kind === "runFailed" && (
                <p className="mt-1 text-xs">
                  {phase.result.rolledBack ? t("migration.rolledBackYes") : t("migration.rolledBackNo")}
                </p>
              )}
            </div>
          )}
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

const btnAccent = (extra = "") =>
  cn(
    "flex h-9 shrink-0 items-center gap-1.5 rounded-input bg-accent px-3.5 text-[13px] font-medium",
    "text-accent-fg transition-colors hover:bg-accent/90 disabled:bg-accent/50",
    extra,
  );
