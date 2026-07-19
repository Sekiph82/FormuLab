import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { compareVersions, type FormulationVersion } from "@ai4s/shared";
import { cn } from "@/lib/cn";

/**
 * Side-by-side comparison of two saved versions.
 *
 * Everything shown is a fact about the two records: what was added, removed and
 * changed. There is deliberately no "this will improve foam" narrative — that
 * would be a model's guess wearing the clothes of a measurement, and this
 * screen is what a change record gets copied from.
 */
export function VersionCompare({
  versions,
  initialBeforeId,
  initialAfterId,
}: {
  versions: FormulationVersion[];
  initialBeforeId?: string;
  initialAfterId?: string;
}) {
  const { t } = useTranslation(["session", "common"]);
  const sorted = useMemo(
    () => [...versions].sort((a, b) => b.versionNumber - a.versionNumber),
    [versions],
  );

  const [afterId, setAfterId] = useState(initialAfterId ?? sorted[0]?.id);
  const [beforeId, setBeforeId] = useState(initialBeforeId ?? sorted[1]?.id ?? sorted[0]?.id);
  const [showUnchanged, setShowUnchanged] = useState(false);

  const before = sorted.find((v) => v.id === beforeId);
  const after = sorted.find((v) => v.id === afterId);

  if (!before || !after) {
    return (
      <p className="px-6 py-8 text-center text-[13px] text-muted">{t("compare.needTwo")}</p>
    );
  }

  const c = compareVersions(before, after);
  const rows = showUnchanged ? c.lines : c.lines.filter((l) => l.kind !== "unchanged");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="print-hide flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        <VersionSelect
          label={t("compare.before")}
          value={beforeId}
          versions={sorted}
          onChange={setBeforeId}
        />
        <span className="text-muted">→</span>
        <VersionSelect
          label={t("compare.after")}
          value={afterId}
          versions={sorted}
          onChange={setAfterId}
        />
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          <input
            type="checkbox"
            checked={showUnchanged}
            onChange={(e) => setShowUnchanged(e.target.checked)}
          />
          {t("compare.showUnchanged")}
        </label>
        <div className="flex-1" />
        <Summary label={t("compare.added")} value={c.added} tone="ok" />
        <Summary label={t("compare.removed")} value={c.removed} tone="error" />
        <Summary label={t("compare.changed")} value={c.changed} tone="warn" />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {/* Headline deltas */}
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label={t("compare.totalPercent")}
            before={`${c.totalPercentBefore}%`}
            after={`${c.totalPercentAfter}%`}
          />
          <Stat
            label={t("compare.activeMatter")}
            before={`${c.activeMatterBefore}%`}
            after={`${c.activeMatterAfter}%`}
            delta={`${c.activeMatterDelta} pp`}
          />
          <Stat label={t("compare.batch")} before={`${c.batchKgBefore} kg`} after={`${c.batchKgAfter} kg`} />
          <Stat label={t("compare.status")} before={c.statusBefore} after={c.statusAfter} />
        </div>

        {(c.claimsAdded.length > 0 ||
          c.claimsRemoved.length > 0 ||
          c.skusAdded.length > 0 ||
          c.skusRemoved.length > 0) && (
          <div className="mb-4 space-y-1 text-[12px]">
            {c.claimsAdded.length > 0 && (
              <ChangeLine label={t("compare.claimsAdded")} values={c.claimsAdded} tone="ok" />
            )}
            {c.claimsRemoved.length > 0 && (
              <ChangeLine label={t("compare.claimsRemoved")} values={c.claimsRemoved} tone="error" />
            )}
            {c.skusAdded.length > 0 && (
              <ChangeLine label={t("compare.skusAdded")} values={c.skusAdded} tone="ok" />
            )}
            {c.skusRemoved.length > 0 && (
              <ChangeLine label={t("compare.skusRemoved")} values={c.skusRemoved} tone="error" />
            )}
          </div>
        )}

        {/* Line diff */}
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-border text-left text-muted">
              <th className="w-8 px-2 py-1.5 font-medium" />
              <th className="px-2 py-1.5 font-medium">{t("compare.material")}</th>
              <th className="w-24 px-2 py-1.5 text-right font-medium">{c.beforeLabel}</th>
              <th className="w-24 px-2 py-1.5 text-right font-medium">{c.afterLabel}</th>
              <th className="w-24 px-2 py-1.5 text-right font-medium">{t("compare.delta")}</th>
              <th className="px-2 py-1.5 font-medium">{t("compare.otherChanges")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr
                key={l.lineId}
                className={cn(
                  "border-b border-border-faint align-top",
                  l.kind === "added" && "bg-ok/5",
                  l.kind === "removed" && "bg-error/5",
                )}
              >
                {/* The marker carries the meaning; colour alone would not. */}
                <td className="px-2 py-1 text-center font-mono text-muted">
                  {l.kind === "added" ? "+" : l.kind === "removed" ? "−" : l.kind === "changed" ? "~" : ""}
                  <span className="sr-only">{l.kind}</span>
                </td>
                <td className="px-2 py-1 text-text">{l.displayName}</td>
                <td className="px-2 py-1 text-right tabular-nums text-muted">
                  {l.beforePercent ? `${l.beforePercent}%` : "—"}
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-text">
                  {l.afterPercent ? `${l.afterPercent}%` : "—"}
                </td>
                <td
                  className={cn(
                    "px-2 py-1 text-right tabular-nums",
                    l.percentDelta?.startsWith("-") ? "text-error" : "text-ok",
                  )}
                >
                  {l.percentDelta ? `${l.percentDelta}` : ""}
                </td>
                <td className="px-2 py-1 text-muted">
                  {l.changes
                    .filter((x) => x.kind !== "percent")
                    .map((x, i) => (
                      <div key={i}>
                        {x.kind}: {x.before} → {x.after}
                      </div>
                    ))}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-muted">
                  {t("compare.identical")}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Change reasons, which is what makes the diff comprehensible. */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ReasonCard version={before} label={c.beforeLabel} />
          <ReasonCard version={after} label={c.afterLabel} />
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-[12px] text-muted">
            {t("compare.copyable")}
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-input border border-border bg-surface-2 p-3 font-mono text-[11px] text-text">
            {c.diffText || t("compare.identical")}
          </pre>
        </details>
      </div>
    </div>
  );
}

function ReasonCard({ version, label }: { version: FormulationVersion; label: string }) {
  const { t } = useTranslation("session");
  return (
    <div className="rounded-card border border-border p-3 text-[12px]">
      <div className="mb-1 font-medium text-text">{label}</div>
      <dl className="space-y-0.5 text-muted">
        <div>
          <dt className="inline">{t("compare.reason")}: </dt>
          <dd className="inline text-text">{version.changeReason ?? "—"}</dd>
        </div>
        {version.changeNotes && (
          <div>
            <dt className="inline">{t("compare.notes")}: </dt>
            <dd className="inline">{version.changeNotes}</dd>
          </div>
        )}
        <div>
          <dt className="inline">{t("compare.author")}: </dt>
          <dd className="inline">{version.author}</dd>
        </div>
        <div>
          <dt className="inline">{t("compare.created")}: </dt>
          <dd className="inline">{new Date(version.createdAt).toLocaleString()}</dd>
        </div>
      </dl>
    </div>
  );
}

function VersionSelect({
  label,
  value,
  versions,
  onChange,
}: {
  label: string;
  value: string;
  versions: FormulationVersion[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-input border border-border bg-surface px-2 py-1 text-[12px] text-text outline-none focus:border-accent"
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.versionLabel ?? `0.${v.versionNumber}`} — {v.changeReason ?? v.status}
          </option>
        ))}
      </select>
    </label>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone: "ok" | "warn" | "error" }) {
  return (
    <span
      className={cn(
        "rounded-input px-2 py-1 text-[11px] tabular-nums",
        tone === "ok" && "bg-ok/10 text-ok",
        tone === "warn" && "bg-warn/10 text-warn",
        tone === "error" && "bg-error/10 text-error",
      )}
    >
      {label} <strong>{value}</strong>
    </span>
  );
}

function Stat({
  label,
  before,
  after,
  delta,
}: {
  label: string;
  before: string;
  after: string;
  delta?: string;
}) {
  const changed = before !== after;
  return (
    <div className="rounded-card border border-border px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5 text-[13px]">
        <span className="tabular-nums text-muted">{before}</span>
        <span className="text-muted">→</span>
        <span className={cn("tabular-nums", changed ? "font-medium text-text" : "text-muted")}>
          {after}
        </span>
      </div>
      {delta && changed && <div className="text-[11px] tabular-nums text-muted">{delta}</div>}
    </div>
  );
}

function ChangeLine({
  label,
  values,
  tone,
}: {
  label: string;
  values: string[];
  tone: "ok" | "error";
}) {
  return (
    <div>
      <span className="text-muted">{label}: </span>
      <span className={tone === "ok" ? "text-ok" : "text-error"}>{values.join(", ")}</span>
    </div>
  );
}
