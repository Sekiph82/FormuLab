/**
 * Dedicated result-history browser — spec §2. Replaces the inline-only
 * "revision of X" text that `TrialsPanel`/`StabilityPanel` used to show
 * next to each result: this dialog walks the full revision chain, retest
 * lineage, and attachment-replacement history via `@ai4s/shared`'s
 * `resultHistory.ts` helpers, and lets a user compare any two revisions.
 *
 * Works for both `TestResult` and `StabilityResult` — both structurally
 * satisfy `HistoricalResult`, so this component is written against that
 * shared shape rather than either concrete type.
 */
import { useMemo, useState } from "react";
import { Copy, X } from "lucide-react";
import {
  buildResultRevisionChain,
  compareResultRevisions,
  groupRetestLineage,
  resolveAttachmentReplacementChain,
  resolveEffectiveResultRevision,
} from "@ai4s/shared";
import type { HistoricalResult } from "@ai4s/shared";
import { cn } from "@/lib/cn";
import { AttachmentField } from "./AttachmentField";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

type HistoryFilter = "all" | "current" | "retests" | "overrides" | "attachments";

const FILTERS: HistoryFilter[] = ["all", "current", "retests", "overrides", "attachments"];

const COMPARISON_FIELDS = ["mean", "minimum", "maximum", "standardDeviation", "coefficientOfVariationPercent"] as const;

export function ResultHistoryBrowser<T extends HistoricalResult>({
  formulationId,
  pool,
  startResultId,
  onClose,
  t,
}: {
  formulationId: string;
  /** Every result sharing this result's lineage (same test definition,
   *  same trial/sample) — scoped by the caller so revision and retest
   *  chains resolve against the right pool, not the whole project. */
  pool: T[];
  startResultId: string;
  onClose: () => void;
  t: SimpleT;
}) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>("");

  const { chain, warnings: chainWarnings } = useMemo(
    () => buildResultRevisionChain(pool, startResultId),
    [pool, startResultId],
  );
  const effective = resolveEffectiveResultRevision(chain);
  const chainIds = useMemo(() => new Set(chain.map((r) => r.id)), [chain]);

  const { groups: retestGroups, warnings: retestWarnings } = useMemo(() => groupRetestLineage(pool), [pool]);
  const myLineage = retestGroups.find((g) => g.results.some((r) => chainIds.has(r.id)));
  const retestOnly = (myLineage?.results ?? []).filter((r) => !chainIds.has(r.id) || r.id !== effective?.id);

  const allAttachments = useMemo(() => chain.flatMap((r) => r.attachments), [chain]);
  const { chains: attachmentChains, warnings: attachmentWarnings } = useMemo(
    () => resolveAttachmentReplacementChain(allAttachments),
    [allAttachments],
  );

  const warnings = [...chainWarnings, ...retestWarnings, ...attachmentWarnings];

  const filteredChain = chain.filter((r) => {
    if (filter === "current") return r.id === effective?.id;
    if (filter === "overrides") return !!r.override;
    if (filter === "attachments") return r.attachments.length > 0;
    return true;
  });

  const comparison =
    compareA && compareB
      ? compareResultRevisions(
          chain.find((r) => r.id === compareA) ?? pool.find((r) => r.id === compareA)!,
          chain.find((r) => r.id === compareB) ?? pool.find((r) => r.id === compareB)!,
        )
      : null;

  const copyId = (id: string) => void navigator.clipboard?.writeText(id);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" role="dialog" aria-modal="true" aria-label={t("resultHistory.heading")}>
      <div className="my-auto w-[44rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-[14px] font-medium text-text">{t("resultHistory.heading")}</h2>
          <button onClick={onClose} className="text-muted hover:text-text" aria-label={t("common:actions.cancel")}>
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-3">
          {warnings.length > 0 && (
            <ul className="mb-2 space-y-0.5 rounded-input bg-error/10 px-2 py-1.5 text-[10px] text-error" role="alert">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          <div className="mb-2 flex flex-wrap gap-1 border-b border-border-faint pb-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded px-2 py-1 text-[11px]",
                  filter === f ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-surface-2",
                )}
              >
                {t(`resultHistory.filter.${f}`)}
              </button>
            ))}
          </div>

          <div className="max-h-[26rem] space-y-2 overflow-auto">
            {filter !== "retests" &&
              filteredChain.map((r, i) => {
                const isEffective = r.id === effective?.id;
                return (
                  <div
                    key={r.id}
                    className={cn(
                      "rounded-card border px-3 py-2 text-[11px]",
                      isEffective ? "border-accent bg-accent/5" : "border-border-faint",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-text">{t("resultHistory.revision", { n: i + 1 })}</span>
                      <button onClick={() => copyId(r.id)} className="flex items-center gap-0.5 text-muted hover:text-text" title={r.id}>
                        <Copy size={10} /> {r.id}
                      </button>
                      {isEffective && <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">{t("resultHistory.current")}</span>}
                      {r.override && <span className="rounded bg-error/10 px-1 py-0.5 text-[9px] text-error">{t("resultHistory.overridden")}</span>}
                      {r.revisesResultId && <span className="text-[10px] text-muted">{t("trials.revisionOf", { id: r.revisesResultId })}</span>}
                      {r.retestOf && <span className="text-[10px] text-muted">{t("resultHistory.retestOf", { id: r.retestOf })}</span>}
                    </div>

                    <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted">
                      <span>{t("resultHistory.performedBy", { who: r.performedBy, at: r.performedAt })}</span>
                      {r.reviewedBy && <span>{t("resultHistory.reviewedBy", { who: r.reviewedBy, at: r.reviewedAt ?? "—" })}</span>}
                      <span>{t("trials.resultSummary", { mean: r.stats?.mean ?? "—", count: r.stats?.count ?? 0, passFail: r.passFail })}</span>
                      {r.stats && (
                        <span>
                          {t("resultHistory.stats", {
                            min: r.stats.minimum ?? "—",
                            max: r.stats.maximum ?? "—",
                            stddev: r.stats.standardDeviation ?? "—",
                            cv: r.stats.coefficientOfVariationPercent ?? "—",
                          })}
                        </span>
                      )}
                      {r.replicates.length > 0 && (
                        <span className="col-span-2">
                          {t("resultHistory.replicateValues", { values: r.replicates.map((rep) => rep.numericValue ?? rep.textValue ?? "—").join(", ") })}
                        </span>
                      )}
                      {r.override && (
                        <span className="col-span-2">
                          {t("resultHistory.overrideReason", { who: r.override.reviewerId, reason: r.override.reason, from: r.override.originalEvaluation, to: r.override.overriddenEvaluation })}
                        </span>
                      )}
                    </div>

                    <AttachmentField formulationId={formulationId} attachments={r.attachments} onChange={() => {}} disabled showSuperseded t={t} />
                  </div>
                );
              })}

            {filter === "retests" &&
              (retestOnly.length === 0 ? (
                <p className="text-[11px] text-muted">{t("resultHistory.noRetests")}</p>
              ) : (
                retestOnly.map((r) => (
                  <div key={r.id} className="rounded-card border border-border-faint px-3 py-2 text-[11px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button onClick={() => copyId(r.id)} className="flex items-center gap-0.5 text-muted hover:text-text" title={r.id}>
                        <Copy size={10} /> {r.id}
                      </button>
                      <span className="text-[10px] text-muted">{t("resultHistory.retestOf", { id: r.retestOf ?? r.id })}</span>
                    </div>
                    <div className="mt-1 text-muted">
                      {t("trials.resultSummary", { mean: r.stats?.mean ?? "—", count: r.stats?.count ?? 0, passFail: r.passFail })}
                    </div>
                    <AttachmentField formulationId={formulationId} attachments={r.attachments} onChange={() => {}} disabled showSuperseded t={t} />
                  </div>
                ))
              ))}
          </div>

          {attachmentChains.some((c) => c.chain.length > 1) && (
            <div className="mt-3 border-t border-border-faint pt-2">
              <p className="mb-1 text-[11px] font-medium text-muted">{t("resultHistory.attachmentHistoryHeading")}</p>
              <ul className="space-y-1">
                {attachmentChains
                  .filter((c) => c.chain.length > 1)
                  .map((c, i) => (
                    <li key={i} className="text-[11px] text-muted">
                      {c.chain.map((a) => a.originalFileName ?? a.title).join(" → ")}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="mt-3 border-t border-border-faint pt-2">
            <p className="mb-1 text-[11px] font-medium text-muted">{t("resultHistory.compareHeading")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={compareA} onChange={(e) => setCompareA(e.target.value)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                <option value="">{t("resultHistory.compareSelectA")}</option>
                {chain.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    {t("resultHistory.revision", { n: i + 1 })} ({r.id})
                  </option>
                ))}
              </select>
              <select value={compareB} onChange={(e) => setCompareB(e.target.value)} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                <option value="">{t("resultHistory.compareSelectB")}</option>
                {chain.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    {t("resultHistory.revision", { n: i + 1 })} ({r.id})
                  </option>
                ))}
              </select>
            </div>

            {comparison && (
              <table className="mt-2 w-full text-[11px]">
                <tbody>
                  {COMPARISON_FIELDS.map((key) => {
                    const field = comparison[key];
                    return field ? (
                      <tr key={key} className="border-b border-border-faint">
                        <td className="py-1 pr-2 text-muted">{t(`resultHistory.field.${key}`)}</td>
                        <td className="py-1 pr-2 text-text">{field.a ?? "—"}</td>
                        <td className="py-1 font-medium text-accent">{field.b ?? "—"}</td>
                      </tr>
                    ) : null;
                  })}
                  <tr className={cn("border-b border-border-faint", comparison.passFail.changed && "bg-accent/5")}>
                    <td className="py-1 pr-2 text-muted">{t("resultHistory.field.passFail")}</td>
                    <td className="py-1 pr-2 text-text">{comparison.passFail.a}</td>
                    <td className="py-1 font-medium text-accent">{comparison.passFail.b}</td>
                  </tr>
                  <tr className={cn("border-b border-border-faint", comparison.reviewedBy.changed && "bg-accent/5")}>
                    <td className="py-1 pr-2 text-muted">{t("resultHistory.field.reviewedBy")}</td>
                    <td className="py-1 pr-2 text-text">{comparison.reviewedBy.a ?? "—"}</td>
                    <td className="py-1 font-medium text-accent">{comparison.reviewedBy.b ?? "—"}</td>
                  </tr>
                  <tr className={cn(comparison.overrideReason.changed && "bg-accent/5")}>
                    <td className="py-1 pr-2 text-muted">{t("resultHistory.field.overrideReason")}</td>
                    <td className="py-1 pr-2 text-text">{comparison.overrideReason.a ?? "—"}</td>
                    <td className="py-1 font-medium text-accent">{comparison.overrideReason.b ?? "—"}</td>
                  </tr>
                </tbody>
              </table>
            )}
            {comparison && (comparison.attachmentsAdded.length > 0 || comparison.attachmentsRemoved.length > 0) && (
              <div className="mt-1.5 space-y-0.5 text-[11px] text-muted">
                {comparison.attachmentsAdded.length > 0 && (
                  <p>{t("resultHistory.attachmentsAdded", { names: comparison.attachmentsAdded.map((a) => a.originalFileName ?? a.title).join(", ") })}</p>
                )}
                {comparison.attachmentsRemoved.length > 0 && (
                  <p>{t("resultHistory.attachmentsRemoved", { names: comparison.attachmentsRemoved.map((a) => a.originalFileName ?? a.title).join(", ") })}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
