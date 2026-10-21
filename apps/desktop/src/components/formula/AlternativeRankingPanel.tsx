import { useTranslation } from "react-i18next";
import { ArrowUpRight, BookmarkPlus, CircleAlert, CircleCheck, CircleHelp, ShieldX } from "lucide-react";
import type { AlternativeRankingRecord, RankedAlternative } from "@formulab/shared";
import { cn } from "@/lib/cn";

const DIMENSIONS = [
  "performance", "uncertainty", "cost", "availability", "compatibility", "safety", "regulatory", "manufacturing", "evidence",
] as const;
const RANKING_COPY = {
  title: "title",
  policy: "policy",
  saving: "saving",
  record: "record",
  predictionNotice: "predictionNotice",
  rank: "rank",
  optimize: "optimize",
  gateReasons: "gateReasons",
  history: "history",
  noHistory: "noHistory",
  empty: "empty",
  policyVersion: "policyVersion",
  checksum: "checksum",
  checksumAlgorithm: "checksumAlgorithm",
  class: "class",
  sources: "sources",
  reviewWarning: "reviewWarning",
  predictionLineage: "predictionLineage",
} as const;

function humanizeRankingKey(key: string): string {
  return (key.split(".").pop() ?? key).replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function AlternativeRankingPanel({
  rankings,
  records,
  canPersist,
  recording,
  recordError,
  onRecord,
  onOptimize,
}: {
  rankings: RankedAlternative[];
  records: AlternativeRankingRecord[];
  canPersist: boolean;
  recording: boolean;
  recordError?: string;
  onRecord: () => void;
  onOptimize: (alternativeId: string) => void;
}) {
  const { t } = useTranslation(["session", "common"]);
  const rankingText = (key: string, options?: Record<string, string | number>) => t(`formulationResult.ranking.${key}`, { ...options, defaultValue: humanizeRankingKey(key) });
  if (rankings.length === 0) return null;

  return (
    <section aria-labelledby="alternative-ranking-title" className="rounded-card border border-border bg-surface p-4">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="alternative-ranking-title" className="text-[14px] font-semibold text-text">{rankingText(RANKING_COPY.title)}</h2>
          <p className="mt-1 max-w-3xl text-[11.5px] leading-relaxed text-muted">
            {rankingText(RANKING_COPY.policy)}
          </p>
        </div>
        <button
          type="button"
          onClick={onRecord}
          disabled={!canPersist || recording}
          className="inline-flex items-center gap-1.5 rounded-input border border-accent/40 bg-accent/5 px-2.5 py-1.5 text-[11px] font-medium text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <BookmarkPlus size={13} />
          {recording ? rankingText(RANKING_COPY.saving) : rankingText(RANKING_COPY.record)}
        </button>
      </header>

      {rankings.every(({ candidate }) => candidate.dimensions.performance.status === "UNAVAILABLE_MODEL") && (
        <p className="mb-3 rounded-input border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] text-muted">
          {rankingText(RANKING_COPY.predictionNotice)}
        </p>
      )}
      {recordError && <p role="alert" className="mb-3 rounded-input border border-error/30 bg-error/5 px-3 py-2 text-[11px] text-error">{recordError}</p>}

      <ol className="space-y-3">
        {rankings.map((entry) => {
          const { candidate, rank, disposition, gateReasons } = entry;
          return (
            <li key={candidate.candidateId} className={cn("rounded-card border p-3", disposition === "BLOCKED" ? "border-error/40 bg-error/5" : disposition === "ELIGIBLE" ? "border-success/30 bg-success/5" : "border-border-faint bg-surface-2/40")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-input border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase text-text">{rankingText(RANKING_COPY.rank, { rank })}</span>
                  <span className="text-[12px] font-semibold text-text">{candidate.versionLabel}</span>
                  <Disposition disposition={disposition} label={rankingText} />
                </div>
                <button
                  type="button"
                  onClick={() => onOptimize(candidate.alternativeId)}
                  disabled={disposition === "BLOCKED" || disposition === "UNAVAILABLE" || candidate.formulaStatus === "UNAVAILABLE" || candidate.formulaStatus === "INVALID"}
                  aria-describedby={gateReasons.length > 0 ? `ranking-reasons-${candidate.candidateId}` : undefined}
                  title={disposition === "BLOCKED" ? gateReasons.map((reason) => rankingText(`reason.${reason}`)).join("; ") : undefined}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
                >
                  {rankingText(RANKING_COPY.optimize)}
                  <ArrowUpRight size={12} />
                </button>
              </div>
              {gateReasons.length > 0 && (
                <p id={`ranking-reasons-${candidate.candidateId}`} className="mt-2 text-[10.5px] leading-relaxed text-muted">
                  <span className="font-semibold text-text">{rankingText(RANKING_COPY.gateReasons)}: </span>{gateReasons.map((reason) => rankingText(`reason.${reason}`)).join(" · ")}
                </p>
              )}
              {disposition === "REVIEW_REQUIRED" && (
                <p role="status" className="mt-2 text-[10.5px] leading-relaxed text-warning">
                  {rankingText(RANKING_COPY.reviewWarning)}
                </p>
              )}
              <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {DIMENSIONS.map((name) => <Dimension key={name} name={name} entry={entry} label={rankingText} />)}
              </dl>
            </li>
          );
        })}
      </ol>

      <section aria-label={rankingText(RANKING_COPY.history)} className="mt-4 border-t border-border-faint pt-3">
        <h3 className="text-[11px] font-semibold text-text">{rankingText(RANKING_COPY.history)}</h3>
        {records.length === 0
          ? <p className="mt-1 text-[10.5px] text-muted">{rankingText(RANKING_COPY.noHistory)}</p>
          : <ul className="mt-2 space-y-1.5">
              {records.map((record) => (
                <li key={record.code} className="flex flex-wrap items-center gap-x-2 rounded-input border border-border-faint px-2.5 py-1.5 text-[10.5px] text-muted">
                  <span className="font-medium text-text">{record.rankings[0]?.candidate.versionLabel ?? rankingText(RANKING_COPY.empty)}</span>
                  <span>{new Date(record.capturedAt).toLocaleString()}</span>
                  <span>{rankingText(RANKING_COPY.policyVersion, { version: record.rankingPolicyVersion })}</span>
                  <span aria-label={rankingText(RANKING_COPY.checksum)}>{rankingText(RANKING_COPY.checksumAlgorithm)} {record.artifactChecksum.digest.slice(0, 12)}…</span>
                </li>
              ))}
            </ul>}
      </section>
    </section>
  );
}

function Disposition({ disposition, label }: { disposition: RankedAlternative["disposition"]; label: (key: string, options?: Record<string, string | number>) => string }) {
  const style = disposition === "ELIGIBLE" ? "text-success" : disposition === "BLOCKED" ? "text-error" : "text-warning";
  const icon = disposition === "ELIGIBLE" ? <CircleCheck size={12} /> : disposition === "BLOCKED" ? <ShieldX size={12} /> : disposition === "UNAVAILABLE" ? <CircleHelp size={12} /> : <CircleAlert size={12} />;
  const title = disposition === "ELIGIBLE" ? "eligible" : disposition === "REVIEW_REQUIRED" ? "reviewRequired" : disposition === "BLOCKED" ? "blocked" : "unavailable";
  return <span className={cn("inline-flex items-center gap-1 text-[10.5px] font-semibold", style)}>{icon}{label(`disposition.${title}`)}</span>;
}

function Dimension({ name, entry, label }: { name: (typeof DIMENSIONS)[number]; entry: RankedAlternative; label: (key: string, options?: Record<string, string | number>) => string }) {
  const dimension = entry.candidate.dimensions[name];
  const status = dimension.status;
  let value = "";
  let predictionLineage: string | undefined;
  if (name === "performance") {
    const performance = entry.candidate.dimensions.performance;
    value = performance.numericValue !== undefined ? `${performance.numericValue}${performance.unit ? ` ${performance.unit}` : ""}` : performance.categoryValue ?? "";
    if (performance.status === "PREDICTED") {
      predictionLineage = [
        performance.modelId ? `model ${performance.modelId}` : undefined,
        performance.modelVersion ? `v${performance.modelVersion}` : undefined,
        performance.targetKey ? `target ${performance.targetKey}` : undefined,
      ].filter(Boolean).join(" · ");
    }
  } else if (name === "uncertainty") {
    const uncertainty = entry.candidate.dimensions.uncertainty;
    value = uncertainty.numericValue !== undefined ? `${uncertainty.numericValue}${uncertainty.unit ? ` ${uncertainty.unit}` : ""}` : "";
  } else if (name === "cost") {
    const cost = entry.candidate.dimensions.cost;
    value = cost.costPerKg !== undefined ? `${cost.costPerKg} ${cost.currency ?? ""}/kg` : "";
  } else if (name === "evidence") {
    const evidence = entry.candidate.dimensions.evidence;
    value = `${evidence.linkedIngredientCount}/${evidence.ingredientCount} · ${evidence.bestEvidenceClass ? `${label(RANKING_COPY.class)} ${evidence.bestEvidenceClass} · ` : ""}${evidence.uniqueSourceCount} ${label(RANKING_COPY.sources)}`;
  }
  const statusLabel = label(`status.${status}`);
  const authority = dimension.sourceSnapshot?.authority;
  return (
    <div className="rounded-input border border-border-faint bg-surface px-2.5 py-2">
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted">{label(`dimension.${name}`)}</dt>
      <dd className="mt-0.5 text-[11px] text-text">{statusLabel}{value ? <span className="ml-1 text-muted">· {value}</span> : null}</dd>
      {predictionLineage && <dd aria-label={label(RANKING_COPY.predictionLineage)} className="mt-0.5 text-[9px] text-muted">{predictionLineage}</dd>}
      {typeof authority === "string" && <dd className="mt-0.5 text-[9px] text-muted">{authority}</dd>}
    </div>
  );
}
