import { useCallback, useEffect } from "react";
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2, PlayCircle, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DAY_MS,
  WEEK_MS,
  nextEligibleAt,
  useAutomaticBackupStore,
} from "@/lib/automaticBackup";
import { isTauri, openAutomaticBackupDestination, pickFolder, type AutomaticBackupConfig } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import { Row, Section, Switch } from "./Section";
import { inputCls } from "./inputCls";

function formatWhen(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleString();
}

type NextRun = "disabled" | "now" | number;

/** "disabled" when this class isn't active at all; "now" when active and
 *  either never run or its interval has already elapsed; otherwise the
 *  concrete epoch-ms it next becomes eligible. */
function classNextRun(active: boolean, lastAt: number | null, intervalMs: number, now: number): NextRun {
  if (!active) return "disabled";
  const next = nextEligibleAt(lastAt, intervalMs);
  if (next === null || next <= now) return "now";
  return next;
}

/** The more eager of two classes' next-run state — "now" beats a future
 *  time, a future time beats "disabled". */
function combineNextRun(a: NextRun, b: NextRun): NextRun {
  if (a === "now" || b === "now") return "now";
  if (typeof a === "number" && typeof b === "number") return Math.min(a, b);
  if (typeof a === "number") return a;
  if (typeof b === "number") return b;
  return "disabled";
}

function clampRetention(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(99, n));
}

function RetentionInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <input
      type="number"
      min={1}
      max={99}
      value={value}
      onChange={(e) => onChange(clampRetention(e.target.value))}
      aria-label={label}
      className={inputCls("w-16 text-center")}
    />
  );
}

/**
 * Phase 11 Session 7 — Automatic Backups. Extends Backup and Recovery
 * (Sessions 1-2's manual create/restore/verify, unchanged) with scheduled
 * daily/weekly backups, a backup-on-exit trigger, and retention for those
 * plus the pre-migration backups Session 3 already creates on every
 * migration run. Every backup this card ever triggers goes through the
 * same `.formulab-backup` engine (`lib/automaticBackup.ts` -> the Rust
 * `run_automatic_backup` command -> `backup::try_create_backup`) manual
 * backup already uses — no second mechanism, no second format.
 */
export function AutomaticBackupCard() {
  const { t } = useTranslation(["settings", "common"]);
  const config = useAutomaticBackupStore((s) => s.config);
  const lastDailyAt = useAutomaticBackupStore((s) => s.lastDailyAt);
  const lastWeeklyAt = useAutomaticBackupStore((s) => s.lastWeeklyAt);
  const lastSuccess = useAutomaticBackupStore((s) => s.lastSuccess);
  const lastFailure = useAutomaticBackupStore((s) => s.lastFailure);
  const running = useAutomaticBackupStore((s) => s.running);
  const refresh = useAutomaticBackupStore((s) => s.refresh);
  const setConfig = useAutomaticBackupStore((s) => s.setConfig);
  const runNow = useAutomaticBackupStore((s) => s.runNow);

  useEffect(() => {
    if (isTauri) void refresh();
  }, [refresh]);

  const patch = useCallback(
    async (partial: Partial<AutomaticBackupConfig>) => {
      try {
        await setConfig({ ...config, ...partial });
      } catch (e) {
        toast.error(`${t("automaticBackup.toast.saveFailed")}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [config, setConfig, t],
  );

  const chooseDestination = useCallback(async () => {
    const picked = await pickFolder();
    if (!picked) return;
    await patch({ destinationFolder: picked });
  }, [patch]);

  const openDestination = useCallback(() => {
    if (config.destinationFolder) void openAutomaticBackupDestination(config.destinationFolder);
  }, [config.destinationFolder]);

  const runNowClicked = useCallback(async () => {
    try {
      // Manually triggered runs are always the "daily" class — see
      // lib/automaticBackup.ts's module doc for why on-exit shares this
      // classification too.
      await runNow("daily");
    } catch (e) {
      // `runNow` itself already toasts a *result* that came back failed —
      // this only catches a thrown desktop-boundary/concurrency error.
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [runNow]);

  if (!isTauri) {
    return (
      <Section title={t("automaticBackup.title")} hint={t("automaticBackup.hint")}>
        <p className="text-[13px] text-muted">{t("automaticBackup.unavailable")}</p>
      </Section>
    );
  }

  const now = Date.now();
  const dailyNext = classNextRun(config.enabled && config.dailyEnabled, lastDailyAt, DAY_MS, now);
  const weeklyNext = classNextRun(config.enabled && config.weeklyEnabled, lastWeeklyAt, WEEK_MS, now);
  const combined = combineNextRun(dailyNext, weeklyNext);
  const nextRunLabel =
    combined === "disabled" ? t("automaticBackup.disabled") : combined === "now" ? t("automaticBackup.now") : new Date(combined).toLocaleString();

  const canRunNow = config.enabled && Boolean(config.destinationFolder) && running === null;

  return (
    <Section title={t("automaticBackup.title")} hint={t("automaticBackup.hint")} flush>
      <div className="divide-y divide-faint">
        <Row
          title={t("automaticBackup.enabledLabel")}
          hint={t("automaticBackup.enabledHint")}
          control={
            <Switch
              checked={config.enabled}
              onChange={(enabled) => void patch({ enabled })}
              label={t("automaticBackup.enabledLabel")}
            />
          }
        />

        {config.enabled && (
          <>
            <Row title={t("automaticBackup.destinationLabel")} hint={t("automaticBackup.destinationHint")}>
              <div className="mt-2 flex items-center gap-2">
                <span className={cn(inputCls("min-w-0 flex-1 truncate font-mono leading-9"), "select-all bg-surface-2 text-muted")}>
                  {config.destinationFolder ?? t("automaticBackup.destinationUnset")}
                </span>
                <button className={btnGhost()} onClick={() => void chooseDestination()}>
                  {t("automaticBackup.chooseFolder")}
                </button>
                {config.destinationFolder && (
                  <button className={btnGhost("px-2")} onClick={openDestination} title={t("automaticBackup.openFolder")}>
                    <FolderOpen size={13} />
                  </button>
                )}
              </div>
            </Row>

            <Row
              title={t("automaticBackup.dailyLabel")}
              hint={t("automaticBackup.dailyHint")}
              control={
                <div className="flex shrink-0 items-center gap-2.5">
                  <RetentionInput
                    label={t("automaticBackup.retentionDailyLabel")}
                    value={config.retentionDaily}
                    onChange={(retentionDaily) => void patch({ retentionDaily })}
                  />
                  <Switch
                    checked={config.dailyEnabled}
                    onChange={(dailyEnabled) => void patch({ dailyEnabled })}
                    label={t("automaticBackup.dailyLabel")}
                  />
                </div>
              }
            />

            <Row
              title={t("automaticBackup.weeklyLabel")}
              hint={t("automaticBackup.weeklyHint")}
              control={
                <div className="flex shrink-0 items-center gap-2.5">
                  <RetentionInput
                    label={t("automaticBackup.retentionWeeklyLabel")}
                    value={config.retentionWeekly}
                    onChange={(retentionWeekly) => void patch({ retentionWeekly })}
                  />
                  <Switch
                    checked={config.weeklyEnabled}
                    onChange={(weeklyEnabled) => void patch({ weeklyEnabled })}
                    label={t("automaticBackup.weeklyLabel")}
                  />
                </div>
              }
            />

            <Row
              title={t("automaticBackup.onExitLabel")}
              hint={t("automaticBackup.onExitHint")}
              control={
                <Switch
                  checked={config.backupOnExitEnabled}
                  onChange={(backupOnExitEnabled) => void patch({ backupOnExitEnabled })}
                  label={t("automaticBackup.onExitLabel")}
                />
              }
            />
          </>
        )}

        <Row
          title={t("automaticBackup.preMigrationLabel")}
          hint={t("automaticBackup.preMigrationHint")}
          control={
            <RetentionInput
              label={t("automaticBackup.retentionPreMigrationLabel")}
              value={config.retentionPreMigration}
              onChange={(retentionPreMigration) => void patch({ retentionPreMigration })}
            />
          }
        />

        {config.enabled && (
          <Row
            title={t("automaticBackup.statusLabel")}
            control={
              <button className={btnAccent()} onClick={() => void runNowClicked()} disabled={!canRunNow}>
                {running ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={13} />}
                {t("automaticBackup.runNowButton")}
              </button>
            }
          >
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted">{t("automaticBackup.nextEligible")}</dt>
              <dd className="text-text">{nextRunLabel}</dd>
              <dt className="text-muted">{t("automaticBackup.lastSuccess")}</dt>
              <dd className="flex items-center gap-1 text-text">
                {lastSuccess ? (
                  <>
                    <CheckCircle2 size={12} className="shrink-0 text-ok" />
                    {t(`automaticBackup.class.${lastSuccess.class}`, { defaultValue: lastSuccess.class })} —{" "}
                    {formatWhen(lastSuccess.finishedAt)}
                  </>
                ) : (
                  t("automaticBackup.none")
                )}
              </dd>
              <dt className="text-muted">{t("automaticBackup.lastFailure")}</dt>
              <dd className="flex items-center gap-1 text-text">
                {lastFailure ? (
                  <>
                    <XCircle size={12} className="shrink-0 text-error" />
                    {t(`automaticBackup.class.${lastFailure.class}`, { defaultValue: lastFailure.class })} —{" "}
                    {formatWhen(lastFailure.finishedAt)}
                  </>
                ) : (
                  t("automaticBackup.none")
                )}
              </dd>
            </dl>
            {lastFailure?.error && <p className="mt-1.5 text-xs text-error">{lastFailure.error}</p>}
          </Row>
        )}

        <div className="flex items-start gap-1.5 px-4 py-3 text-xs leading-relaxed text-muted">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {t("automaticBackup.limitationNote")}
        </div>
      </div>
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
