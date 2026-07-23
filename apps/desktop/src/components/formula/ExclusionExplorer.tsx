/**
 * Included-vs-excluded test-definition explorer — spec §1.6. Every
 * definition considered for a trial/study's applicability resolution is
 * shown, not just the ones that made it in: an excluded definition is
 * labelled with every deterministic reason it failed
 * (`engine/testApplicability.ts`'s `evaluateApplicability`), never
 * silently dropped from view.
 */
import { useMemo, useState } from "react";
import { CheckCircle2, Search, XCircle } from "lucide-react";
import { evaluateApplicability } from "@ai4s/shared";
import type { ExclusionReason, TestApplicabilityContext } from "@ai4s/shared";
import type { TestDefinition } from "@ai4s/shared";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

export function ExclusionExplorer({
  definitions,
  ctx,
  onClose,
  t,
}: {
  definitions: TestDefinition[];
  ctx: TestApplicabilityContext;
  onClose: () => void;
  t: SimpleT;
}) {
  const [tab, setTab] = useState<"included" | "excluded">("included");
  const [reasonFilter, setReasonFilter] = useState<ExclusionReason | "">("");
  const [search, setSearch] = useState("");

  const { included, excluded } = useMemo(() => evaluateApplicability(definitions, ctx), [definitions, ctx]);

  const filteredIncluded = included.filter((r) => r.definition.name.toLowerCase().includes(search.toLowerCase()));
  const filteredExcluded = excluded
    .filter((e) => !reasonFilter || e.reasons.includes(reasonFilter))
    .filter((e) => e.definition.name.toLowerCase().includes(search.toLowerCase()));

  const allReasons = Array.from(new Set(excluded.flatMap((e) => e.reasons)));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" role="dialog" aria-modal="true" aria-label={t("applicability.heading")}>
      <div className="my-auto w-[36rem] max-w-full rounded-card border border-border bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-[14px] font-medium text-text">{t("applicability.heading")}</h2>
          <button onClick={onClose} className="text-[12px] text-muted hover:text-text">
            {t("common:actions.cancel")}
          </button>
        </div>
        <div className="px-5 py-3">
          <div className="mb-2 flex gap-1 border-b border-border-faint">
            <button
              onClick={() => setTab("included")}
              className={tab === "included" ? "border-b-2 border-accent px-2 py-1 text-[12px] font-medium text-text" : "px-2 py-1 text-[12px] text-muted"}
            >
              {t("applicability.included", { count: included.length })}
            </button>
            <button
              onClick={() => setTab("excluded")}
              className={tab === "excluded" ? "border-b-2 border-accent px-2 py-1 text-[12px] font-medium text-text" : "px-2 py-1 text-[12px] text-muted"}
            >
              {t("applicability.excluded", { count: excluded.length })}
            </button>
          </div>

          <div className="mb-2 flex items-center gap-2">
            <Search size={12} className="text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("approval.scopeSearch")}
              className="min-w-0 flex-1 rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]"
            />
            {tab === "excluded" && allReasons.length > 0 && (
              <select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value as ExclusionReason | "")} className="rounded-input border border-border bg-surface px-1.5 py-1 text-[11px]">
                <option value="">{t("applicability.allReasons")}</option>
                {allReasons.map((r) => (
                  <option key={r} value={r}>
                    {t(`applicability.reason.${r}`)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="max-h-96 overflow-auto">
            {tab === "included" ? (
              <ul className="space-y-1">
                {filteredIncluded.map((r) => (
                  <li key={r.definition.code} className="flex items-start gap-2 rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                    <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-text">{r.definition.name}</span>
                        {r.required && <span className="rounded bg-accent/10 px-1 py-0.5 text-[9px] text-accent">{t("trials.required")}</span>}
                      </div>
                      <p className="text-muted">{r.reason}</p>
                    </div>
                  </li>
                ))}
                {filteredIncluded.length === 0 && <p className="text-[11px] text-muted">{t("applicability.noMatches")}</p>}
              </ul>
            ) : (
              <ul className="space-y-1">
                {filteredExcluded.map((e) => (
                  <li key={e.definition.code} className="flex items-start gap-2 rounded-input border border-border-faint px-2 py-1.5 text-[11px]">
                    <XCircle size={13} className="mt-0.5 shrink-0 text-error" />
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-text">{e.definition.name}</span>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {e.reasons.map((r) => (
                          <span key={r} className="rounded bg-error/10 px-1 py-0.5 text-[9px] text-error">
                            {t(`applicability.reason.${r}`)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
                {filteredExcluded.length === 0 && <p className="text-[11px] text-muted">{t("applicability.noMatches")}</p>}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
