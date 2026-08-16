import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  AlertTriangle,
  Beaker,
  ClipboardList,
  Cog,
  FileDown,
  FlaskConical,
  GitCompare,
  Loader2,
  Pencil,
  Scale,
  Share2,
  ShieldCheck,
  StickyNote,
  Wallet,
  Wrench,
} from "lucide-react";
import { readSession, type FormulationCard, type SessionDetail } from "@/lib/formulationV2";
import { asGeneratedFormula, ingredientId, normalizeIngredientKey, totalWeightPct, type GeneratedFormula } from "@/lib/generatedFormula";
import { cn } from "@/lib/cn";

/**
 * Phase 14 — "Formulation Result" screen, built directly from the approved
 * visual reference (`docs/assets/phase14/formulation-reply-screen.png`) and
 * its full specification (`docs/PHASE14_FRONTEND_UI_SPECIFICATION.md`).
 *
 * Real data only: every field below either comes from the actual
 * `read_session`-returned formula (ingredients, functions, weight %,
 * references, purpose, warnings, deterministic `violations`) or is
 * explicitly, visibly marked as not yet available — architecture doc §5's
 * "never fabricate a statistic; say so explicitly" rule, applied to every
 * tab, not just the ingredient-evidence panel it was originally written
 * for. Phase 14's evidence engine (observed ranges, medians, confidence,
 * evidence classes, process parameters, safety/regulatory determinations)
 * is Sessions 2/5/6 work, not yet built — this screen never pretends
 * otherwise.
 */

type ResultTab = "formula" | "process" | "critical" | "equipment" | "safety" | "regulatory" | "evidence" | "alternatives" | "summary";

const TABS: ResultTab[] = ["formula", "process", "critical", "equipment", "safety", "regulatory", "evidence", "alternatives", "summary"];

export function FormulationResultPage() {
  const { t } = useTranslation(["session", "common"]);
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeVersion, setActiveVersion] = useState(0);
  const [tab, setTab] = useState<ResultTab>("formula");
  const [selectedIngredient, setSelectedIngredient] = useState<number | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    readSession(sessionId)
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        // Default to the first successfully-generated version — a session
        // whose v1 failed but v2/v3 succeeded must not open on a dead tab
        // (architecture doc §16's partial-failure handling).
        const firstOk = s.cards.findIndex((c) => c.status !== "generation_failed");
        setActiveVersion(firstOk === -1 ? 0 : firstOk);
        setSelectedIngredient(null);
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Evidence from a previous version must never remain displayed after
  // switching versions (architecture doc §9) — resetting the selection and
  // the active tab's ingredient context on every version change is what
  // enforces that, not just a UI nicety.
  const selectVersion = (i: number) => {
    setActiveVersion(i);
    setSelectedIngredient(null);
  };

  if (error) {
    return (
      <div className="px-8 py-6">
        <div role="alert" className="rounded-card border border-error/40 bg-error/10 px-4 py-3 text-[13px] text-error">
          {error}
        </div>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const cards = session.cards;
  const card = cards[Math.min(activeVersion, cards.length - 1)];
  const formula = asGeneratedFormula(card?.formula);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar t={t} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <OriginalRequestBanner brief={session.brief} sessionId={sessionId} navigate={navigate} t={t} />

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_260px]">
          <VersionCards cards={cards} active={activeVersion} onSelect={selectVersion} t={t} />
          <VersionComparisonCard t={t} />
        </div>

        <div className="mt-4 flex gap-1 overflow-x-auto border-b border-border-faint" role="tablist">
          {TABS.map((tb) => (
            <button
              key={tb}
              role="tab"
              aria-selected={tab === tb}
              onClick={() => setTab(tb)}
              className={cn(
                "shrink-0 rounded-t-input border-b-2 px-3 py-2 text-[12px] font-medium transition-colors",
                tab === tb ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
              )}
            >
              {t(`formulationResult.tabs.${tb}`)}
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            <TabContent
              tab={tab}
              card={card}
              formula={formula}
              selectedIngredient={selectedIngredient}
              onSelectIngredient={setSelectedIngredient}
              t={t}
            />
          </div>

          <div className="flex flex-col gap-4">
            {tab === "formula" && (
              <IngredientEvidencePanel
                card={card}
                formula={formula}
                selectedIndex={selectedIngredient}
                onClose={() => setSelectedIngredient(null)}
                t={t}
              />
            )}
            <QuickActions navigate={navigate} t={t} />
            <VersionSummaryCard card={card} formula={formula} t={t} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- top bar ---

function TopBar({ t }: { t: TFunction<readonly ["session", "common"]> }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
      <span className="text-[13px] font-medium uppercase tracking-wider text-muted">{t("formulationResult.heading")}</span>
      <div className="flex items-center gap-2">
        <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-input border border-border px-2.5 py-1 text-[11px] text-text hover:bg-surface-2">
          <FileDown size={13} className="text-muted" />
          {t("formulationResult.actions.downloadReport")}
        </button>
        <button className="flex items-center gap-1.5 rounded-input border border-border px-2.5 py-1 text-[11px] text-text hover:bg-surface-2">
          <Share2 size={13} className="text-muted" />
          {t("formulationResult.actions.share")}
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------- original request ---

function OriginalRequestBanner({
  brief,
  sessionId,
  navigate,
  t,
}: {
  brief: SessionDetail["brief"];
  sessionId: string | undefined;
  navigate: ReturnType<typeof useNavigate>;
  t: TFunction<readonly ["session", "common"]>;
}) {
  return (
    <div className="rounded-card border border-accent/30 bg-accent/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wide text-accent">{t("formulationResult.originalRequest.heading")}</div>
          <p className="mt-1 text-[13px] leading-relaxed text-text">{brief?.target ?? t("formulationResult.originalRequest.unavailable")}</p>
        </div>
        <button
          onClick={() => navigate("/formulation-request", { state: { editSessionId: sessionId, priorBrief: brief } })}
          className="flex shrink-0 items-center gap-1.5 rounded-input border border-border bg-surface px-2.5 py-1.5 text-[11px] text-text hover:bg-surface-2"
        >
          <Pencil size={13} className="text-muted" />
          {t("formulationResult.originalRequest.edit")}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------- version cards ---

/** Phase 14 Session 3 — real, Python-derived strategy title when the
 *  session carries one (`card.strategy.title`, matched by index in
 *  `pipeline.py::run()`, never something the model itself could invent).
 *  Falls back to the model's OWN generated `name` for a pre-Session-3
 *  session, then the raw version id when even that is missing (a
 *  malformed/failed candidate) — never a fabricated label. */
function strategyLabel(card: FormulationCard, formula: GeneratedFormula | undefined, fallback: string): string {
  return card.strategy?.title || formula?.name?.trim() || fallback;
}

/** Real rationale when this session has one; otherwise the model's own
 *  `purpose` text (pre-Session-3 sessions), never a fabricated summary. */
function strategyDescription(card: FormulationCard, formula: GeneratedFormula | undefined): string | undefined {
  return card.strategy?.rationale || formula?.purpose || undefined;
}

function VersionCards({
  cards,
  active,
  onSelect,
  t,
}: {
  cards: FormulationCard[];
  active: number;
  onSelect: (i: number) => void;
  t: TFunction<readonly ["session", "common"]>;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
        {t("formulationResult.versions.heading")}
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {cards.map((c, i) => {
          const failed = c.status === "generation_failed";
          const formula = asGeneratedFormula(c.formula);
          const isActive = i === active;
          return (
            <button
              key={c.version}
              onClick={() => onSelect(i)}
              disabled={failed}
              className={cn(
                "rounded-card border p-3 text-left transition-colors",
                failed ? "cursor-not-allowed border-error/30 bg-error/5 opacity-70"
                  : isActive ? "border-accent bg-accent/5" : "border-border bg-surface hover:bg-surface-2",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="rounded-input bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-text">
                  {c.version}
                </span>
                {isActive && !failed && <span className="text-[10px] font-medium text-accent">{t("formulationResult.versions.selected")}</span>}
                {failed && <span className="text-[10px] font-medium text-error">{t("formulationResult.versions.failed")}</span>}
              </div>
              <div className="mt-1.5 text-[12.5px] font-medium text-text">{strategyLabel(c, formula, c.version.toUpperCase())}</div>
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">
                {failed ? c.failure_reason : strategyDescription(c, formula) || t("formulationResult.versions.noSummary")}
              </p>
              {!failed && (
                <div className="mt-2 text-[10px] text-muted">
                  {c.score
                    ? t("formulationResult.versions.score", { pct: Math.round(c.score.total * 100) })
                    : t("formulationResult.versions.scoreNotYetAvailable")}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VersionComparisonCard({ t }: { t: TFunction<readonly ["session", "common"]> }) {
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-text">
        <GitCompare size={14} className="text-accent" />
        {t("formulationResult.comparison.heading")}
      </div>
      <p className="text-[11px] text-muted">{t("formulationResult.comparison.body")}</p>
      <button
        disabled
        title={t("formulationResult.comparison.notYetAvailable")}
        className="mt-2 w-full rounded-input border border-border px-2 py-1.5 text-[11px] text-muted disabled:opacity-50"
      >
        {t("formulationResult.comparison.open")}
      </button>
    </div>
  );
}

// -------------------------------------------------------- tab content ---

function TabContent({
  tab,
  card,
  formula,
  selectedIngredient,
  onSelectIngredient,
  t,
}: {
  tab: ResultTab;
  card: FormulationCard | undefined;
  formula: GeneratedFormula | undefined;
  selectedIngredient: number | null;
  onSelectIngredient: (i: number) => void;
  t: TFunction<readonly ["session", "common"]>;
}) {
  if (!card) return <EmptyNotice t={t} />;
  if (card.status === "generation_failed") return <GenerationFailedNotice card={card} t={t} />;
  switch (tab) {
    case "formula":
      return <FormulaTab card={card} formula={formula} selectedIngredient={selectedIngredient} onSelectIngredient={onSelectIngredient} t={t} />;
    case "process":
      return <NotYetAvailableTab icon={<Cog size={16} />} title={t("formulationResult.tabs.process")} body={t("formulationResult.process.notAvailable")} />;
    case "critical":
      return <NotYetAvailableTab icon={<AlertTriangle size={16} />} title={t("formulationResult.tabs.critical")} body={t("formulationResult.critical.notAvailable")} />;
    case "equipment":
      return <NotYetAvailableTab icon={<Wrench size={16} />} title={t("formulationResult.tabs.equipment")} body={t("formulationResult.equipment.notAvailable")} />;
    case "safety":
      return <SafetyTab card={card} t={t} />;
    case "regulatory":
      return <RegulatoryTab t={t} />;
    case "evidence":
      return <EvidenceTab formula={formula} t={t} />;
    case "alternatives":
      return <NotYetAvailableTab icon={<ClipboardList size={16} />} title={t("formulationResult.tabs.alternatives")} body={t("formulationResult.alternatives.notAvailable")} />;
    case "summary":
      return <SummaryTab card={card} formula={formula} t={t} />;
    default:
      return null;
  }
}

function EmptyNotice({ t }: { t: TFunction<readonly ["session", "common"]> }) {
  return <div className="rounded-card border border-border bg-surface p-5 text-[12px] text-muted">{t("formulationResult.noCandidate")}</div>;
}

/** A version that failed to generate (architecture doc §16: preserve the
 *  real failure reason, never a fabricated formula in its place). */
function GenerationFailedNotice({ card, t }: { card: FormulationCard; t: TFunction<readonly ["session", "common"]> }) {
  return (
    <div className="rounded-card border border-error/30 bg-error/5 p-5">
      <div className="flex items-center gap-2 text-[13px] font-medium text-error">
        <AlertTriangle size={16} />
        {t("formulationResult.generationFailed.heading", { version: card.version.toUpperCase() })}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">{card.failure_reason}</p>
    </div>
  );
}

function NotYetAvailableTab({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <div className="flex items-center gap-2 text-[13px] font-medium text-text">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

// ------------------------------------------------------------ Tab 1 ---

function FormulaTab({
  card,
  formula,
  selectedIngredient,
  onSelectIngredient,
  t,
}: {
  card: FormulationCard;
  formula: GeneratedFormula | undefined;
  selectedIngredient: number | null;
  onSelectIngredient: (i: number) => void;
  t: TFunction<readonly ["session", "common"]>;
}) {
  const ingredients = formula?.ingredients ?? [];
  const total = totalWeightPct(formula);
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-input bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase text-text">{card.version}</span>
        <h3 className="text-[13px] font-medium text-text">{formula?.name || t("formulationResult.formula.untitled")}</h3>
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-[11px] text-muted">
        <span>{t("formulationResult.formula.totalIngredients", { count: ingredients.length })}</span>
        <span>{total !== undefined ? t("formulationResult.formula.totalWeight", { pct: total }) : t("formulationResult.formula.totalWeightUnavailable")}</span>
        {formula?.references?.length ? <span>{t("formulationResult.formula.citationCount", { count: formula.references.length })}</span> : null}
      </div>

      {card.violations && card.violations.length > 0 && (
        <div className="mb-3 rounded-input border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          {card.violations.join(" · ")}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border-faint text-left text-[10px] uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-2">#</th>
              <th className="py-1.5 pr-2">{t("formulationResult.formula.columns.ingredient")}</th>
              <th className="py-1.5 pr-2">{t("formulationResult.formula.columns.function")}</th>
              <th className="py-1.5 pr-2">{t("formulationResult.formula.columns.weightPct")}</th>
              <th className="py-1.5 pr-2">{t("formulationResult.formula.columns.evidence")}</th>
              <th className="py-1.5 pr-2">{t("formulationResult.formula.columns.evidenceClass")}</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((ing, i) => {
              // Phase 14 Session 3 — real per-ingredient evidence, when this
              // session has it; falls back to the honest "—"/not-yet-linked
              // placeholder for a pre-Session-3 session exactly as before.
              const key = normalizeIngredientKey(ing.inci);
              const rowLinks = (card.evidence_links ?? []).filter((l) => l.ingredient_key === key);
              const strongestClass = rowLinks.length > 0
                ? rowLinks.map((l) => l.evidence_class).sort((a, b) => CLASS_RANK[a] - CLASS_RANK[b])[0]
                : undefined;
              return (
                <tr
                  key={ingredientId(i, ing)}
                  onClick={() => onSelectIngredient(i)}
                  className={cn(
                    "cursor-pointer border-b border-border-faint/60 hover:bg-surface-2",
                    selectedIngredient === i && "bg-accent/10",
                  )}
                >
                  <td className="py-1.5 pr-2 text-muted">{i + 1}</td>
                  <td className="py-1.5 pr-2 text-text">{ing.inci || "—"}</td>
                  <td className="py-1.5 pr-2 text-muted">{ing.function || "—"}</td>
                  <td className="py-1.5 pr-2 tabular-nums text-text">{ing.weight_pct || "—"}</td>
                  {rowLinks.length > 0 ? (
                    <>
                      <td className="py-1.5 pr-2 text-text">{t("formulationResult.formula.evidenceCount", { count: rowLinks.length })}</td>
                      <td className="py-1.5 pr-2 text-text">{strongestClass}</td>
                    </>
                  ) : (
                    <>
                      <td className="py-1.5 pr-2 text-muted" title={t("formulationResult.formula.perIngredientEvidenceNotYetLinked")}>
                        {"—"}
                      </td>
                      <td className="py-1.5 pr-2 text-muted" title={t("formulationResult.formula.perIngredientEvidenceNotYetLinked")}>
                        {"—"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[10px] text-muted">{t("formulationResult.formula.evidenceLegend")}</p>
    </div>
  );
}

// ------------------------------------------------------ right panel ---

function IngredientEvidencePanel({
  card,
  formula,
  selectedIndex,
  onClose,
  t,
}: {
  card: FormulationCard | undefined;
  formula: GeneratedFormula | undefined;
  selectedIndex: number | null;
  onClose: () => void;
  t: TFunction<readonly ["session", "common"]>;
}) {
  if (selectedIndex === null || !formula?.ingredients?.[selectedIndex]) {
    return (
      <div className="rounded-card border border-border bg-surface p-4">
        <div className="mb-1 text-[12px] font-medium text-text">{t("formulationResult.evidencePanel.heading")}</div>
        <p className="text-[11px] text-muted">{t("formulationResult.evidencePanel.selectPrompt")}</p>
      </div>
    );
  }
  const ing = formula.ingredients[selectedIndex];
  // Phase 14 Session 3 — real per-version evidence, when this session has
  // it (`strategy.py::link_evidence_to_version()`), keyed by the SAME
  // normalized ingredient key Python computed. Absent on a pre-Session-3
  // session — every section below falls back to its honest "not yet
  // available" wording exactly as before, never fabricated.
  const key = normalizeIngredientKey(ing.inci);
  const links = (card?.evidence_links ?? []).filter((l) => l.ingredient_key === key);
  const alignment = card?.concentration_alignment?.[key];
  const strongest = links.length > 0 ? links.slice().sort((a, b) => CLASS_RANK[a.evidence_class] - CLASS_RANK[b.evidence_class])[0] : undefined;

  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <div className="text-[12px] font-medium text-text">{t("formulationResult.evidencePanel.heading")}</div>
          <div className="text-[11px] text-muted">
            {card?.version?.toUpperCase()} &gt; {ing.inci || "—"}
          </div>
        </div>
        <button onClick={onClose} aria-label={t("common:actions.close", { defaultValue: "Close" })} className="text-muted hover:text-text">
          ×
        </button>
      </div>

      <div className="mb-3 rounded-input bg-surface-2 p-2.5">
        <div className="text-[10px] uppercase tracking-wide text-muted">{t("formulationResult.evidencePanel.selectedConcentration")}</div>
        <div className="text-[18px] font-semibold text-text">{ing.weight_pct || "—"}</div>
      </div>

      <EvidenceSection title={t("formulationResult.evidencePanel.whyThisIngredient")}>
        <p className="text-[11.5px] leading-relaxed text-muted">
          {ing.function
            ? t("formulationResult.evidencePanel.functionRationale", { function: ing.function })
            : t("formulationResult.evidencePanel.rationaleNotItemized")}
        </p>
      </EvidenceSection>

      <EvidenceSection title={t("formulationResult.evidencePanel.whyThisConcentration", { pct: ing.weight_pct || "—" })}>
        {alignment === "evidence_supported" && strongest ? (
          <p className="text-[11.5px] leading-relaxed text-text">
            {t("formulationResult.evidencePanel.evidenceSupported", {
              class: strongest.evidence_class,
              doi: strongest.paper_doi || t("formulationResult.evidencePanel.noDoi"),
            })}
          </p>
        ) : alignment === "evidence_context_only" ? (
          <p className="text-[11.5px] leading-relaxed text-warning">{t("formulationResult.evidencePanel.evidenceContextOnly")}</p>
        ) : (
          <p className="text-[11.5px] leading-relaxed text-warning">{t("formulationResult.evidencePanel.insufficientEvidence")}</p>
        )}
      </EvidenceSection>

      <EvidenceSection title={t("formulationResult.evidencePanel.decisionFactors")}>
        <p className="text-[11.5px] text-muted">{t("formulationResult.evidencePanel.decisionFactorsNotComputed")}</p>
      </EvidenceSection>

      <EvidenceSection title={t("formulationResult.evidencePanel.supportingSources")}>
        {links.length > 0 ? (
          <>
            <p className="mb-1.5 text-[10px] text-muted">{t("formulationResult.evidencePanel.sourcesScopeNote")}</p>
            <ul className="space-y-1.5">
              {links.slice(0, 5).map((l, i) => (
                <li key={i} className="text-[11px] text-text">
                  <span className="mr-1 rounded-input bg-surface-2 px-1 py-0.5 text-[9px] font-semibold uppercase text-muted">
                    {l.evidence_class}
                  </span>
                  {t("formulationResult.evidencePanel.sourceLine", {
                    author: l.paper_authors || t("formulationResult.evidencePanel.unknownAuthor"),
                    year: l.paper_year || "",
                    doi: l.paper_doi || t("formulationResult.evidencePanel.noDoi"),
                  })}
                  {l.outcome && <p className="mt-0.5 text-[10.5px] text-muted">{l.outcome}</p>}
                </li>
              ))}
            </ul>
          </>
        ) : formula.references && formula.references.length > 0 ? (
          <>
            <p className="mb-1.5 text-[10px] text-muted">{t("formulationResult.evidencePanel.sourcesScopeNote")}</p>
            <ul className="space-y-1">
              {formula.references.slice(0, 5).map((r, i) => (
                <li key={i} className="text-[11px] text-text">
                  {t("formulationResult.evidencePanel.sourceLine", {
                    author: r.author || t("formulationResult.evidencePanel.unknownAuthor"),
                    year: r.year || "",
                    doi: r.doi || t("formulationResult.evidencePanel.noDoi"),
                  })}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-[11.5px] text-muted">{t("formulationResult.evidencePanel.noSources")}</p>
        )}
      </EvidenceSection>

      <EvidenceSection title={t("formulationResult.evidencePanel.relatedConstraints")}>
        <p className="text-[11.5px] text-muted">{t("formulationResult.evidencePanel.constraintsNotAvailable")}</p>
      </EvidenceSection>
    </div>
  );
}

/** Lower rank = stronger evidence, for picking the single strongest linked
 *  record to summarize in "Why this concentration?" above. */
const CLASS_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

function EvidenceSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      {children}
    </div>
  );
}

// ------------------------------------------------------------ Tab 5 ---

function SafetyTab({ card, t }: { card: FormulationCard; t: TFunction<readonly ["session", "common"]> }) {
  const violations = card.violations ?? [];
  const status = violations.length > 0 ? "fail" : "incomplete";
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={16} className={status === "fail" ? "text-error" : "text-muted"} />
        <span className="text-[13px] font-medium text-text">{t("formulationResult.safety.overallStatus")}</span>
        <StatusBadge tone={status === "fail" ? "error" : "muted"} label={t(`formulationResult.safety.statuses.${status}`)} />
      </div>
      <EvidenceSection title={t("formulationResult.safety.formulaLevel")}>
        {violations.length > 0 ? (
          <ul className="space-y-1">
            {violations.map((v, i) => (
              <li key={i} className="rounded-input border border-error/30 bg-error/5 px-2.5 py-1.5 text-[11.5px] text-error">
                {v}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11.5px] text-muted">{t("formulationResult.safety.noDeterministicFindings")}</p>
        )}
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.safety.ingredientLevel")}>
        <p className="text-[11.5px] text-muted">{t("formulationResult.safety.notYetEvaluated")}</p>
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.safety.manufacturing")}>
        <p className="text-[11.5px] text-muted">{t("formulationResult.safety.notYetEvaluated")}</p>
      </EvidenceSection>
    </div>
  );
}

// ------------------------------------------------------------ Tab 6 ---

function RegulatoryTab({ t }: { t: TFunction<readonly ["session", "common"]> }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <Scale size={16} className="text-muted" />
        <span className="text-[13px] font-medium text-text">{t("formulationResult.regulatory.overallStatus")}</span>
        <StatusBadge tone="muted" label={t("formulationResult.regulatory.statuses.incomplete")} />
      </div>
      <p className="text-[11.5px] leading-relaxed text-muted">{t("formulationResult.regulatory.notYetEvaluated")}</p>
    </div>
  );
}

// ------------------------------------------------------------ Tab 7 ---

function EvidenceTab({ formula, t }: { formula: GeneratedFormula | undefined; t: TFunction<readonly ["session", "common"]> }) {
  const refs = formula?.references ?? [];
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <EvidenceSection title={t("formulationResult.evidenceTab.summary")}>
        <p className="text-[11.5px] text-muted">{t("formulationResult.evidenceTab.summaryBody", { count: refs.length })}</p>
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.evidenceTab.qualityDistribution")}>
        <p className="text-[11.5px] text-muted">{t("formulationResult.evidenceTab.qualityNotYetClassified")}</p>
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.evidenceTab.sources")}>
        {refs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-border-faint text-left text-[10px] uppercase text-muted">
                  <th className="py-1 pr-2">{t("formulationResult.evidenceTab.columns.author")}</th>
                  <th className="py-1 pr-2">{t("formulationResult.evidenceTab.columns.year")}</th>
                  <th className="py-1 pr-2">{t("formulationResult.evidenceTab.columns.doi")}</th>
                </tr>
              </thead>
              <tbody>
                {refs.map((r, i) => (
                  <tr key={i} className="border-b border-border-faint/60">
                    <td className="py-1 pr-2 text-text">{r.author || "—"}</td>
                    <td className="py-1 pr-2 text-muted">{r.year || "—"}</td>
                    <td className="py-1 pr-2 text-muted">{r.doi || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[11.5px] text-muted">{t("formulationResult.evidenceTab.noSources")}</p>
        )}
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.evidenceTab.gaps")}>
        <p className="text-[11.5px] text-muted">{t("formulationResult.evidenceTab.gapsBody")}</p>
      </EvidenceSection>
    </div>
  );
}

// ------------------------------------------------------------ Tab 9 ---

function SummaryTab({ card, formula, t }: { card: FormulationCard; formula: GeneratedFormula | undefined; t: TFunction<readonly ["session", "common"]> }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <EvidenceSection title={t("formulationResult.summary.strategy")}>
        <p className="text-[11.5px] leading-relaxed text-text">{formula?.purpose || t("formulationResult.summary.strategyUnavailable")}</p>
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.summary.characteristics")}>
        <p className="text-[11.5px] text-muted">
          {t("formulationResult.summary.ingredientCount", { count: formula?.ingredients?.length ?? 0 })}
        </p>
      </EvidenceSection>
      {formula?.how_it_works && formula.how_it_works.length > 0 && (
        <EvidenceSection title={t("formulationResult.summary.performance")}>
          <ul className="space-y-1.5">
            {formula.how_it_works.map((h, i) => (
              <li key={i} className="text-[11.5px] text-muted">
                <span className="font-medium text-text">{h.title}: </span>
                {h.text}
              </li>
            ))}
          </ul>
        </EvidenceSection>
      )}
      <EvidenceSection title={t("formulationResult.summary.cost")}>
        <p className="text-[11.5px] text-muted">{t("formulationResult.summary.costNotAvailable")}</p>
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.summary.confidence")}>
        <p className="text-[11.5px] text-muted">{t("formulationResult.summary.confidenceNotYetComputed")}</p>
      </EvidenceSection>
      {formula?.warnings && formula.warnings.length > 0 && (
        <EvidenceSection title={t("formulationResult.summary.risks")}>
          <ul className="space-y-1">
            {formula.warnings.map((w, i) => (
              <li key={i} className="text-[11.5px] text-warning">
                {w}
              </li>
            ))}
          </ul>
        </EvidenceSection>
      )}
      <EvidenceSection title={t("formulationResult.summary.validationRequired")}>
        <ul className="list-disc space-y-0.5 pl-4 text-[11.5px] text-muted">
          {(t("formulationResult.summary.validationChecklist", { returnObjects: true }) as string[]).map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </EvidenceSection>
      {card.violations && card.violations.length > 0 && (
        <EvidenceSection title={t("formulationResult.summary.nextAction")}>
          <p className="text-[11.5px] text-text">{t("formulationResult.summary.nextActionSuggestion")}</p>
        </EvidenceSection>
      )}
    </div>
  );
}

// -------------------------------------------------------- side cards ---

function QuickActions({ navigate, t }: { navigate: ReturnType<typeof useNavigate>; t: TFunction<readonly ["session", "common"]> }) {
  const actions: { icon: React.ReactNode; label: string; onClick?: () => void }[] = [
    { icon: <StickyNote size={13} />, label: t("formulationResult.quickActions.addNote") },
    { icon: <FlaskConical size={13} />, label: t("formulationResult.quickActions.createTrial"), onClick: () => navigate("/laboratory") },
    { icon: <Beaker size={13} />, label: t("formulationResult.quickActions.planStability"), onClick: () => navigate("/stability") },
    { icon: <Wallet size={13} />, label: t("formulationResult.quickActions.costAnalysis") },
    { icon: <FileDown size={13} />, label: t("formulationResult.quickActions.saveFormula") },
    { icon: <Share2 size={13} />, label: t("formulationResult.quickActions.querySupplier"), onClick: () => navigate("/materials") },
  ];
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">{t("formulationResult.quickActions.heading")}</div>
      <div className="flex flex-col gap-1">
        {actions.map((a) => (
          <button
            key={a.label}
            onClick={a.onClick}
            disabled={!a.onClick}
            className="flex items-center gap-2 rounded-input px-2 py-1.5 text-left text-[11.5px] text-text hover:bg-surface-2 disabled:opacity-40"
          >
            <span className="text-muted">{a.icon}</span>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function VersionSummaryCard({ card, formula, t }: { card: FormulationCard | undefined; formula: GeneratedFormula | undefined; t: TFunction<readonly ["session", "common"]> }) {
  const total = totalWeightPct(formula);
  const rows: [string, string][] = [
    [t("formulationResult.versionSummary.totalIngredients"), String(formula?.ingredients?.length ?? "—")],
    [t("formulationResult.versionSummary.estimatedCost"), t("formulationResult.versionSummary.notAvailable")],
    [t("formulationResult.versionSummary.activeMatter"), total !== undefined ? `${total}%` : "—"],
    [t("formulationResult.versionSummary.overallScore"), t("formulationResult.versionSummary.notYetScored")],
  ];
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
        {t("formulationResult.versionSummary.heading", { version: card?.version?.toUpperCase() ?? "" })}
      </div>
      <dl className="space-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between text-[11.5px]">
            <dt className="text-muted">{label}</dt>
            <dd className="font-medium text-text">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StatusBadge({ tone, label }: { tone: "error" | "muted" | "success"; label: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
        tone === "error" && "bg-error/10 text-error",
        tone === "muted" && "bg-surface-2 text-muted",
        tone === "success" && "bg-success/10 text-success",
      )}
    >
      {label}
    </span>
  );
}
