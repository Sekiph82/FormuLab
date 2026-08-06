import { useCallback, useEffect } from "react";
import { AlertTriangle, CheckCircle2, Download, EyeOff, Loader2, RefreshCw, WifiOff, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_FREQUENCY_HOURS,
  FREQUENCY_OPTIONS_HOURS,
  useUpdateStore,
  type UpdateCheckStatus,
} from "@/lib/update";
import { isTauri, openExternal } from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";
import { Row, Section, Switch } from "./Section";
import { selectCls } from "./inputCls";

/** Release notes are rendered as plain text only — this string is put
 *  directly into JSX text content below (React escapes it; it is never
 *  passed to `dangerouslySetInnerHTML` or a Markdown/HTML renderer), and
 *  truncated so a very long changelog can't blow out the settings page. */
const MAX_NOTES_CHARS = 2000;

function truncateNotes(notes: string): string {
  return notes.length > MAX_NOTES_CHARS ? `${notes.slice(0, MAX_NOTES_CHARS)}…` : notes;
}

const STATUS_TONE: Record<UpdateCheckStatus, "ok" | "warn" | "error" | "muted"> = {
  idle: "muted",
  checking: "muted",
  upToDate: "ok",
  updateAvailable: "warn",
  error: "error",
  offline: "error",
};

/**
 * Phase 11 Session 9 — Update Checker. Check-only: this card never
 * downloads or installs anything, and says so explicitly. Extends
 * `lib/update.ts`'s existing store (current version, manual/automatic
 * check, badge) with configurable frequency, release notes, platform-
 * availability info, and per-version ignore/clear controls.
 */
export function UpdateCheckerCard() {
  const { t } = useTranslation(["settings", "common"]);
  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const status = useUpdateStore((s) => s.status);
  const error = useUpdateStore((s) => s.error);
  const latest = useUpdateStore((s) => s.latest);
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);
  const ignoredVersion = useUpdateStore((s) => s.ignoredVersion);
  const lastCheckedAt = useUpdateStore((s) => s.lastCheckedAt);
  const enabled = useUpdateStore((s) => s.enabled);
  const badgeEnabled = useUpdateStore((s) => s.badgeEnabled);
  const frequencyHours = useUpdateStore((s) => s.frequencyHours);
  const setEnabled = useUpdateStore((s) => s.setEnabled);
  const setBadgeEnabled = useUpdateStore((s) => s.setBadgeEnabled);
  const setFrequencyHours = useUpdateStore((s) => s.setFrequencyHours);
  const check = useUpdateStore((s) => s.check);
  const ignoreVersion = useUpdateStore((s) => s.ignoreVersion);
  const clearIgnoredVersion = useUpdateStore((s) => s.clearIgnoredVersion);

  useEffect(() => {
    if (status === "error" && error) {
      toast.error(t("updates.toast.checkFailed", { message: error }));
    }
    // Only react to a fresh error — not to `t` identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, error]);

  const runCheck = useCallback(() => {
    void check({ manual: true });
  }, [check]);

  const isVersionIgnored = Boolean(latest && ignoredVersion && !hasUpdate && status === "updateAvailable");

  if (!isTauri) {
    return (
      <Section title={t("updates.title")} hint={t("updates.hint")}>
        <p className="text-[13px] text-muted">{t("updates.unavailable")}</p>
      </Section>
    );
  }

  const tone = STATUS_TONE[status];
  const StatusIcon =
    status === "checking"
      ? Loader2
      : status === "upToDate"
        ? CheckCircle2
        : status === "updateAvailable"
          ? Download
          : status === "offline"
            ? WifiOff
            : status === "error"
              ? XCircle
              : CheckCircle2;
  const iconCls = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "error" ? "text-error" : "text-muted";
  const statusLabel = status === "idle" ? t("updates.status.idle") : t(`updates.status.${status}`);

  return (
    <Section title={t("updates.title")} hint={t("updates.hint")} flush>
      <div className="divide-y divide-faint">
        <Row
          title={t("updates.currentVersionLabel")}
          control={
            <span className="select-all font-mono text-[13px] text-text">{currentVersion}</span>
          }
        />

        <Row
          title={
            <span className="inline-flex items-center gap-1.5">
              <StatusIcon size={14} className={cn(iconCls, status === "checking" && "animate-spin")} />
              {statusLabel}
            </span>
          }
          hint={lastCheckedAt ? t("updates.lastChecked", { date: new Date(lastCheckedAt).toLocaleString() }) : t("updates.neverChecked")}
          control={
            <button className={btnGhost("gap-1.5")} onClick={runCheck} disabled={status === "checking"}>
              {status === "checking" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {t("updates.checkNow")}
            </button>
          }
        >
          {status === "error" && error && <div className="mt-2 text-xs text-error">{t("updates.checkFailed", { message: error })}</div>}
          {status === "offline" && <div className="mt-2 text-xs text-muted">{t("updates.offlineHint")}</div>}

          {status === "updateAvailable" && hasUpdate && latest && (
            <div className="mt-3 rounded-input border border-warn/40 bg-warn/10 p-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
                <dt className="text-muted">{t("updates.availableSummary.versionLabel")}</dt>
                <dd className="text-text">{latest.name || latest.version}</dd>
                {latest.publishedAt && (
                  <>
                    <dt className="text-muted">{t("updates.availableSummary.publishedLabel")}</dt>
                    <dd className="text-text">{new Date(latest.publishedAt).toLocaleString()}</dd>
                  </>
                )}
              </dl>
              <p className="mt-2 text-xs text-muted">
                {latest.platformSupported ? t("updates.platformNote") : t("updates.platformMissingNote")}
              </p>
              {latest.notes && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-text">{t("updates.notesHeading")}</p>
                  {/* Plain text only — never dangerouslySetInnerHTML or a
                      Markdown/HTML renderer. React escapes this string. */}
                  <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-muted">
                    {truncateNotes(latest.notes)}
                  </p>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button className={btnAccent()} onClick={() => void openExternal(latest.url)}>
                  <Download size={13} /> {t("updates.viewRelease")}
                </button>
                <button className={btnGhost()} onClick={() => ignoreVersion()}>
                  <EyeOff size={13} /> {t("updates.ignoreVersion")}
                </button>
              </div>
            </div>
          )}

          {isVersionIgnored && latest && (
            <div className="mt-3 flex items-start gap-2 rounded-input border border-border bg-surface-2 p-3">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-muted" />
              <div className="min-w-0 flex-1 text-xs text-muted">
                {t("updates.ignoredNote", { version: latest.version })}
              </div>
            </div>
          )}

          {ignoredVersion && (
            <button className={cn(btnGhost(), "mt-2")} onClick={clearIgnoredVersion}>
              {t("updates.clearIgnored")}
            </button>
          )}
        </Row>

        <Row
          title={t("updates.autoCheck")}
          hint={t("updates.autoCheckHint")}
          control={<Switch checked={enabled} onChange={setEnabled} label={t("updates.autoCheck")} />}
        />

        <Row
          title={t("updates.frequencyLabel")}
          hint={t("updates.frequencyHint")}
          control={
            <select
              value={frequencyHours}
              onChange={(e) => setFrequencyHours(Number(e.target.value) || DEFAULT_FREQUENCY_HOURS)}
              aria-label={t("updates.frequencyLabel")}
              className={selectCls("w-40")}
              disabled={!enabled}
            >
              {FREQUENCY_OPTIONS_HOURS.map((hours) => (
                <option key={hours} value={hours}>
                  {t(`updates.frequency.${hours}`)}
                </option>
              ))}
            </select>
          }
        />

        <Row
          title={t("updates.showBadge")}
          hint={t("updates.showBadgeHint")}
          control={<Switch checked={badgeEnabled} onChange={setBadgeEnabled} label={t("updates.showBadge")} />}
        />

        <div className="px-4 py-3 text-xs leading-relaxed text-muted">{t("updates.disclaimer")}</div>
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
