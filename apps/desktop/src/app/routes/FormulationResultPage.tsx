import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  AlertTriangle,
  Beaker,
  ChevronDown,
  ChevronRight,
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
  SlidersHorizontal,
  StickyNote,
  Wallet,
  Wrench,
} from "lucide-react";
import { displayMoney, type CostSnapshot } from "@formulab/shared";
import { readSession, type ArchitectureBasis, type ExperimentalOutcome, type FormulationCard, type LiteratureDocument, type ManufacturingPlan, type ResearchCorpusSummary, type ScientificFormulationRecord, type ScientificFormulationSummary, type SessionDetail } from "@/lib/formulationV2";
import { asGeneratedFormula, ingredientId, normalizeIngredientKey, totalWeightPct, type GeneratedFormula } from "@/lib/generatedFormula";
import { openAndPrintReport } from "@/lib/formulationReport";
import { costGeneratedFormula } from "@/lib/generatedFormulaCost";
import { pickCheapestValidVersion } from "@/lib/costComparison";
import { evaluateGeneratedFormulaInventory, type FormulaInventoryFeasibility } from "@/lib/generatedFormulaInventory";
import { pickMostInventoryFeasibleVersion } from "@/lib/inventoryComparison";
import { buildPromotedFormulation } from "@/lib/promoteGeneratedFormula";
import { saveFormulation, saveFormulationVersion } from "@/lib/formulations";
import { useMasterCostData } from "@/hooks/useMasterCostData";
import { useInventoryData } from "@/hooks/useInventoryData";
import { CostSnapshotSummary } from "@/components/cost/CostSnapshotSummary";
import { InventoryFeasibilitySummary } from "@/components/inventory/InventoryFeasibilitySummary";
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
  // FVL-03.003: real cost, via the authoritative Cost Engine, computed
  // client-side after generation (Python cannot call cost.ts). Every
  // version is costed at the SAME batch size/currency so a "cheapest
  // valid alternative" comparison is actually comparing like with like.
  const [batchKg, setBatchKg] = useState("100");
  const [currency, setCurrency] = useState("KES");
  const costData = useMasterCostData();
  // FVL-03.004: same read-only, client-side pattern as cost — reuses the
  // SAME batchKg control above so cost and inventory compare the same
  // requested batch. Python is never made inventory-aware.
  const inventoryData = useInventoryData();
  // FVL-03.005: the Advanced Optimizer's real input contract needs a real
  // projectId (formulationProblemSchema) a generated session card doesn't
  // have — so "Optimize / Refine" promotes the selected version into a
  // real Formulation/Version first (never fabricating an id), then opens
  // the existing, unchanged Advanced Optimizer workflow there. Cached
  // per-version in memory so repeated clicks within one visit reopen the
  // SAME promoted project instead of creating duplicates.
  const [promotedByVersion, setPromotedByVersion] = useState<Record<string, string>>({});
  const [optimizing, setOptimizing] = useState(false);

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
  // FVL-03.003: real, authoritative per-version cost — computed here (not
  // per-tab) so every version shares one costing pass at the same batch
  // size/currency, letting `pickCheapestValidVersion` compare like with
  // like across the whole session, not just the active tab.
  const costSnapshots: (CostSnapshot | undefined)[] = costData.loading
    ? cards.map(() => undefined)
    : cards.map((c) =>
        c.formula
          ? costGeneratedFormula(sessionId ?? session.id, c.version, c.formula, batchKg, currency, {
              materials: costData.materials,
              prices: costData.prices,
              rates: costData.rates,
            })
          : undefined,
      );
  const cheapestValidIndex = pickCheapestValidVersion(cards, costSnapshots);

  // FVL-03.004: same per-version, batch-shared computation pattern as
  // cost, kept as an entirely separate dimension (task §12) — never
  // merged into `costSnapshots`/`cheapestValidIndex` above.
  const inventoryFeasibilities: (FormulaInventoryFeasibility | undefined)[] = inventoryData.loading
    ? cards.map(() => undefined)
    : cards.map((c) => (c.formula ? evaluateGeneratedFormulaInventory(c.formula, batchKg, inventoryData.records) : undefined));
  const mostFeasibleIndex = pickMostInventoryFeasibleVersion(cards, inventoryFeasibilities);

  // FVL-03.005: promote (once per version, cached) then hand off to the
  // existing, unmodified Advanced Optimizer workflow. The source session
  // and its cards are never written to here — only new Formulation/
  // FormulationVersion records are created.
  const onOptimize = async () => {
    if (!card || !card.formula) return;
    const cached = promotedByVersion[card.version];
    if (cached) {
      navigate(`/optimization?project=${cached}`);
      return;
    }
    setOptimizing(true);
    try {
      const { formulation, version } = buildPromotedFormulation(session, card, batchKg);
      await saveFormulation(formulation);
      await saveFormulationVersion(version);
      setPromotedByVersion((prev) => ({ ...prev, [card.version]: formulation.id }));
      navigate(`/optimization?project=${formulation.id}`);
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar session={session} sessionId={sessionId} t={t} />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <OriginalRequestBanner brief={session.brief} sessionId={sessionId} navigate={navigate} t={t} />
        <PartialResearchNotice corpus={card?.research_corpus} t={t} />

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_260px]">
          <VersionCards
            cards={cards}
            active={activeVersion}
            onSelect={selectVersion}
            t={t}
            costSnapshots={costSnapshots}
            cheapestValidIndex={cheapestValidIndex}
            currency={currency}
          />
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
              allCards={cards}
              formula={formula}
              literature={session.literature ?? []}
              scientificFormulations={session.scientific_formulations}
              selectedIngredient={selectedIngredient}
              onSelectIngredient={setSelectedIngredient}
              costSnapshot={costSnapshots[Math.min(activeVersion, cards.length - 1)]}
              currency={currency}
              batchKg={batchKg}
              onBatchKgChange={setBatchKg}
              onCurrencyChange={setCurrency}
              inventoryFeasibility={inventoryFeasibilities[Math.min(activeVersion, cards.length - 1)]}
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
            <QuickActions
              navigate={navigate}
              t={t}
              // eslint-disable-next-line i18next/no-literal-string -- internal ResultTab id, not display text
              onCostAnalysis={() => setTab("summary")}
              onOptimize={card?.formula ? () => void onOptimize() : undefined}
              optimizing={optimizing}
            />
            <VersionSummaryCard
              card={card}
              formula={formula}
              t={t}
              snapshot={costSnapshots[Math.min(activeVersion, cards.length - 1)]}
              currency={currency}
              isCheapestValid={cheapestValidIndex === Math.min(activeVersion, cards.length - 1)}
              inventoryFeasibility={inventoryFeasibilities[Math.min(activeVersion, cards.length - 1)]}
              isMostFeasible={mostFeasibleIndex === Math.min(activeVersion, cards.length - 1)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- top bar ---

function TopBar({ session, sessionId, t }: { session: SessionDetail; sessionId: string | undefined; t: TFunction<readonly ["session", "common"]> }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
      <span className="text-[13px] font-medium uppercase tracking-wider text-muted">{t("formulationResult.heading")}</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => openAndPrintReport(session, sessionId ?? session.id)}
          className="flex items-center gap-1.5 rounded-input border border-border px-2.5 py-1 text-[11px] text-text hover:bg-surface-2"
        >
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

/** 2026-08-17 correction: a partial research corpus (10-14 full texts)
 *  still produces real formulas — this is a visible notice, never the
 *  error page, and never hidden inside the Evidence tab alone. */
function PartialResearchNotice({
  corpus,
  t,
}: {
  corpus: ResearchCorpusSummary | undefined;
  t: TFunction<readonly ["session", "common"]>;
}) {
  if (!corpus || corpus.status !== "partial") return null;
  return (
    <div className="mt-3 rounded-card border border-warning/40 bg-warning/10 px-4 py-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} className="shrink-0 text-warning" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-warning">
          {t("formulationResult.partialResearch.badge")}
        </span>
        <span className="text-[11px] text-muted">
          {t("formulationResult.partialResearch.counter", { acquired: corpus.full_text_count, target: corpus.target_count })}
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-text">
        {t("formulationResult.partialResearch.body", { acquired: corpus.full_text_count, target: corpus.target_count })}
      </p>
    </div>
  );
}

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
  costSnapshots,
  cheapestValidIndex,
  currency,
}: {
  cards: FormulationCard[];
  active: number;
  onSelect: (i: number) => void;
  t: TFunction<readonly ["session", "common"]>;
  costSnapshots: (CostSnapshot | undefined)[];
  cheapestValidIndex: number | undefined;
  currency: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
        {t("formulationResult.versions.heading")}
      </div>
      {/* FormuLab v1 (FVL-02): up to 3 alternatives read comfortably as a
          fixed 3-column grid; 4-7 switch to a horizontally scrollable strip
          with a real minimum card width, so seven versions never collapse
          into unreadable postage stamps — see §16 of the frozen scope. */}
      <div
        className={cn(
          cards.length <= 3
            ? "grid grid-cols-1 gap-2.5 sm:grid-cols-3"
            : "flex gap-2.5 overflow-x-auto pb-1",
        )}
      >
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
                cards.length > 3 && "w-[200px] shrink-0",
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
                <div className="mt-2 flex items-center justify-between text-[10px] text-muted">
                  <span>
                    {c.score
                      ? t("formulationResult.versions.score", { pct: Math.round(c.score.total * 100) })
                      : t("formulationResult.versions.scoreNotYetAvailable")}
                  </span>
                  {costSnapshots[i]?.totalManufacturingCost && (
                    <span className={cn("tabular-nums", i === cheapestValidIndex && "font-medium text-accent")}>
                      {displayMoney(costSnapshots[i]!.totalManufacturingCost!, currency)}
                    </span>
                  )}
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
  allCards,
  formula,
  literature,
  scientificFormulations,
  selectedIngredient,
  onSelectIngredient,
  costSnapshot,
  currency,
  batchKg,
  onBatchKgChange,
  onCurrencyChange,
  inventoryFeasibility,
  t,
}: {
  tab: ResultTab;
  card: FormulationCard | undefined;
  allCards: FormulationCard[];
  formula: GeneratedFormula | undefined;
  literature: LiteratureDocument[];
  scientificFormulations: SessionDetail["scientific_formulations"];
  selectedIngredient: number | null;
  onSelectIngredient: (i: number) => void;
  costSnapshot: CostSnapshot | undefined;
  currency: string;
  batchKg: string;
  onBatchKgChange: (v: string) => void;
  onCurrencyChange: (v: string) => void;
  inventoryFeasibility: FormulaInventoryFeasibility | undefined;
  t: TFunction<readonly ["session", "common"]>;
}) {
  if (!card) return <EmptyNotice t={t} />;
  if (card.status === "generation_failed") return <GenerationFailedNotice card={card} t={t} />;
  switch (tab) {
    case "formula":
      return <FormulaTab card={card} formula={formula} selectedIngredient={selectedIngredient} onSelectIngredient={onSelectIngredient} t={t} />;
    case "process":
      return card.manufacturing
        ? <ManufacturingProcedureTab plan={card.manufacturing} t={t} />
        : <NotYetAvailableTab icon={<Cog size={16} />} title={t("formulationResult.tabs.process")} body={t("formulationResult.process.notAvailable")} />;
    case "critical":
      return card.manufacturing
        ? <CriticalParametersTab plan={card.manufacturing} t={t} />
        : <NotYetAvailableTab icon={<AlertTriangle size={16} />} title={t("formulationResult.tabs.critical")} body={t("formulationResult.critical.notAvailable")} />;
    case "equipment":
      return card.manufacturing
        ? <EquipmentTab plan={card.manufacturing} t={t} />
        : <NotYetAvailableTab icon={<Wrench size={16} />} title={t("formulationResult.tabs.equipment")} body={t("formulationResult.equipment.notAvailable")} />;
    case "safety":
      return <SafetyTab card={card} t={t} />;
    case "regulatory":
      return <RegulatoryTab card={card} t={t} />;
    case "evidence":
      return <EvidenceTab card={card} formula={formula} literature={literature} scientificFormulations={scientificFormulations} t={t} />;
    case "alternatives":
      return <AlternativesTab cards={allCards} summary={scientificFormulations?.summary} t={t} />;
    case "summary":
      return (
        <SummaryTab
          card={card}
          formula={formula}
          costSnapshot={costSnapshot}
          currency={currency}
          batchKg={batchKg}
          onBatchKgChange={onBatchKgChange}
          onCurrencyChange={onCurrencyChange}
          inventoryFeasibility={inventoryFeasibility}
          t={t}
        />
      );
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
  // Phase 14 Session 4: prefer the deterministic, authoritative
  // `card.mass_balance` (`provenance.py::compute_mass_balance()`) — this IS
  // the fix for the "129.5% w/w accounted for" bug (q.s.-to-100 closing the
  // formula, never double-counted as an additional 100%). Falls back to the
  // client-side (now also bug-fixed) `totalWeightPct` for a pre-Session-4
  // session that has no `mass_balance` at all.
  const mb = card.mass_balance;
  const total = mb?.final_total ?? totalWeightPct(formula);
  const massBalanceOk = mb ? mb.status === "complete" : undefined;
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-input bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase text-text">{card.version}</span>
        <h3 className="text-[13px] font-medium text-text">{formula?.name || t("formulationResult.formula.untitled")}</h3>
      </div>
      {card.architecture_basis && <ArchitectureBasisNotice basis={card.architecture_basis} t={t} />}

      <div className="mb-3 flex flex-wrap gap-3 text-[11px] text-muted">
        <span>{t("formulationResult.formula.totalIngredients", { count: ingredients.length })}</span>
        <span className={massBalanceOk === false ? "font-medium text-error" : undefined}>
          {total !== undefined ? t("formulationResult.formula.totalWeight", { pct: total }) : t("formulationResult.formula.totalWeightUnavailable")}
        </span>
        {formula?.references?.length ? <span>{t("formulationResult.formula.citationCount", { count: formula.references.length })}</span> : null}
      </div>

      {mb && mb.status !== "complete" && (
        <div className="mb-3 rounded-input border border-error/40 bg-error/10 px-3 py-2 text-[11px] text-error">
          {t(`formulationResult.formula.massBalance.${mb.status}`)}
          {mb.issues.length > 0 ? ` — ${mb.issues.join("; ")}` : ""}
        </div>
      )}

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
              <th className="py-1.5 pr-2">{t("formulationResult.formula.columns.origin")}</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map((ing, i) => {
              // Phase 14 Session 3/4 — real per-ingredient evidence and
              // origin, when this session has them; falls back to the
              // honest "—"/not-yet-linked placeholder for a pre-Session-3/4
              // session exactly as before.
              const key = normalizeIngredientKey(ing.inci);
              const rowLinks = (card.evidence_links ?? []).filter((l) => l.ingredient_key === key);
              const strongestClass = rowLinks.length > 0
                ? rowLinks.map((l) => l.evidence_class).sort((a, b) => CLASS_RANK[a] - CLASS_RANK[b])[0]
                : undefined;
              const origins = card.ingredient_origins?.[key] ?? [];
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
                  <td className="py-1.5 pr-2">
                    {origins.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {origins.map((o) => (
                          <OriginBadge key={o} origin={o} t={t} />
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted">{"—"}</span>
                    )}
                  </td>
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

/** §19 — a compact, real, computed architecture-provenance area for this
 *  formula version. Never generic text: a `deterministic_rule` origin
 *  shows the real, specific `reason` `_classify_architecture()` computed;
 *  a scientific origin shows the real source DOI/formulation ID and the
 *  real retained/modified/added/removed counts. */
function ArchitectureBasisNotice({ basis, t }: { basis: ArchitectureBasis; t: TFunction<readonly ["session", "common"]> }) {
  const isScientific = basis.origin === "scientific_formulation" || basis.origin === "scientific_formulation_adapted";
  return (
    <div className="mb-3 rounded-input border border-border-faint bg-surface-2/40 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">
          {t("formulationResult.formula.architecture.basis")}
        </span>
        <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-medium text-text">
          {t(`formulationResult.formula.architecture.origins.${basis.origin}`, { defaultValue: basis.origin })}
        </span>
      </div>
      {isScientific ? (
        <div className="mt-1.5 space-y-1 text-[11px] text-muted">
          <div>
            <span className="text-text">{t("formulationResult.formula.architecture.source")}: </span>
            {basis.source_paper_doi || basis.source_title || "—"}
            {basis.source_formulation_id ? ` — ${basis.source_formulation_id}` : ""}
          </div>
          {basis.origin === "scientific_formulation_adapted" && (
            <div className="flex flex-wrap gap-3">
              <span>{t("formulationResult.formula.architecture.retained", { count: basis.retained })}</span>
              <span>{t("formulationResult.formula.architecture.modified", { count: basis.modified })}</span>
              <span>{t("formulationResult.formula.architecture.added", { count: basis.added })}</span>
              <span>{t("formulationResult.formula.architecture.removed", { count: basis.removed })}</span>
            </div>
          )}
        </div>
      ) : basis.reason ? (
        <p className="mt-1.5 text-[11px] text-muted">{basis.reason}</p>
      ) : null}
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
  // Phase 14 Session 4 — real, strictly-comparable statistics
  // (`evidence.py::compute_comparable_stats()`) when the session has them;
  // `null`/absent means the pipeline itself judged the evidence not
  // strictly comparable enough (§8) — never a fabricated range.
  const stats = card?.comparable_stats?.[key];
  const origins = card?.ingredient_origins?.[key] ?? [];
  const isAiOnly = origins.length === 1 && origins[0] === "ai_formulation_inference";

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

      {isAiOnly && (
        <div className="mb-3 rounded-input border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
          {t("formulationResult.evidencePanel.aiInferenceOnly")}
        </div>
      )}

      {origins.length > 0 && (
        <EvidenceSection title={t("formulationResult.evidencePanel.origin")}>
          <div className="flex flex-wrap gap-1">
            {origins.map((o) => (
              <OriginBadge key={o} origin={o} t={t} />
            ))}
          </div>
        </EvidenceSection>
      )}

      <EvidenceSection title={t("formulationResult.evidencePanel.whyThisIngredient")}>
        <p className="text-[11.5px] leading-relaxed text-muted">
          {ing.function
            ? t("formulationResult.evidencePanel.functionRationale", { function: ing.function })
            : t("formulationResult.evidencePanel.rationaleNotItemized")}
        </p>
      </EvidenceSection>

      <EvidenceSection title={t("formulationResult.evidencePanel.whyThisConcentration", { pct: ing.weight_pct || "—" })}>
        {stats ? (
          <div className="space-y-1">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-text">
              <div>
                <span className="text-muted">{t("formulationResult.evidencePanel.observedRange")}: </span>
                {stats.observed_min}–{stats.observed_max}{stats.unit}
              </div>
              <div>
                <span className="text-muted">{t("formulationResult.evidencePanel.median")}: </span>
                {stats.median}{stats.unit}
              </div>
              <div>
                <span className="text-muted">{t("formulationResult.evidencePanel.studyCount")}: </span>
                {stats.unique_study_count}
              </div>
              <div>
                <span className="text-muted">{t("formulationResult.evidencePanel.confidence")}: </span>
                {t(`formulationResult.evidencePanel.confidenceLevels.${stats.confidence}`)}
              </div>
            </div>
          </div>
        ) : alignment === "evidence_supported" && strongest ? (
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
        {origins.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-4 text-[11.5px] text-muted">
            {origins.map((o) => (
              <li key={o}>{t(`formulationResult.formula.origins.${o}`, { defaultValue: o })}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[11.5px] text-muted">{t("formulationResult.evidencePanel.decisionFactorsNotComputed")}</p>
        )}
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

/** Phase 14 Session 4 §11 — a compact origin/support badge, so an
 *  evidence-free AI-selected ingredient no longer looks identical to an
 *  evidence-supported one in the Formula table. Never hidden behind a
 *  tooltip only — the label itself is always visible text. */
function OriginBadge({ origin, t }: { origin: string; t: TFunction<readonly ["session", "common"]> }) {
  const isAiOnly = origin === "ai_formulation_inference";
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase",
        isAiOnly ? "bg-warning/15 text-warning" : "bg-surface-2 text-muted",
      )}
      title={t(`formulationResult.formula.origins.${origin}`, { defaultValue: origin })}
    >
      {t(`formulationResult.formula.originsShort.${origin}`, { defaultValue: origin })}
    </span>
  );
}

function EvidenceSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      {children}
    </div>
  );
}

// ------------------------------------------------------------ Tab 5 ---

function SafetyFindingRow({ f }: { f: import("@/lib/formulationV2").SafetyFinding }) {
  return (
    <div className="rounded-input border border-border-faint p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-text">{f.subject}</span>
        <StatusBadge tone={statusTone(f.status)} label={f.status.replace(/_/g, " ")} />
      </div>
      {f.actual_value && <div className="mt-1 text-[11px] text-text">{f.actual_value}</div>}
      <div className="mt-1 text-[10.5px] text-muted">{f.rationale}</div>
      {f.required_action && <div className="text-[10.5px] text-muted">→ {f.required_action}</div>}
      <div className="mt-1 text-[9.5px] uppercase tracking-wide text-muted">{f.rule_id}{f.source_type ? ` · ${f.source_type}` : ""}</div>
    </div>
  );
}

function SafetyTab({ card, t }: { card: FormulationCard; t: TFunction<readonly ["session", "common"]> }) {
  const safety = card.safety;
  if (!safety) {
    const violations = card.violations ?? [];
    const status = violations.length > 0 ? "fail" : "incomplete";
    return (
      <div className="rounded-card border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck size={16} className={status === "fail" ? "text-error" : "text-muted"} />
          <span className="text-[13px] font-medium text-text">{t("formulationResult.safety.overallStatus")}</span>
          <StatusBadge tone={status === "fail" ? "error" : "muted"} label={t(`formulationResult.safety.statuses.${status}`)} />
        </div>
        {violations.length > 0 ? (
          <ul className="space-y-1">
            {violations.map((v, i) => (
              <li key={i} className="rounded-input border border-error/30 bg-error/5 px-2.5 py-1.5 text-[11.5px] text-error">{v}</li>
            ))}
          </ul>
        ) : (
          <p className="text-[11.5px] text-muted">{t("formulationResult.safety.notYetEvaluated")}</p>
        )}
      </div>
    );
  }
  const formulaFindings = safety.findings.filter((f) => f.subject_type === "formula");
  const ingredientFindings = safety.findings.filter((f) => f.subject_type === "ingredient");
  const processFindings = safety.findings.filter((f) => f.subject_type === "process_step");
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck size={16} className={statusTone(safety.overall_status) === "error" ? "text-error" : "text-accent"} />
        <span className="text-[13px] font-medium text-text">{t("formulationResult.safety.overallStatus")}</span>
        <StatusBadge tone={statusTone(safety.overall_status)} label={safety.overall_status.replace(/_/g, " ")} />
      </div>
      <EvidenceSection title={t("formulationResult.safety.formulaLevel")}>
        {formulaFindings.length > 0 ? (
          <div className="space-y-1.5">{formulaFindings.map((f, i) => <SafetyFindingRow key={i} f={f} />)}</div>
        ) : (
          <p className="text-[11.5px] text-muted">{t("formulationResult.safety.noDeterministicFindings")}</p>
        )}
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.safety.ingredientLevel")}>
        {ingredientFindings.length > 0 ? (
          <div className="space-y-1.5">{ingredientFindings.map((f, i) => <SafetyFindingRow key={i} f={f} />)}</div>
        ) : (
          <p className="text-[11.5px] text-muted">{t("formulationResult.safety.noDeterministicFindings")}</p>
        )}
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.safety.manufacturing")}>
        {processFindings.length > 0 ? (
          <div className="space-y-1.5">{processFindings.map((f, i) => <SafetyFindingRow key={i} f={f} />)}</div>
        ) : (
          <p className="text-[11.5px] text-muted">{t("formulationResult.safety.noDeterministicFindings")}</p>
        )}
      </EvidenceSection>
    </div>
  );
}

// ------------------------------------------------------------ Tab 6 ---

function RegulatoryFindingRow({ f }: { f: import("@/lib/formulationV2").RegulatoryFinding }) {
  return (
    <div className="rounded-input border border-border-faint p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-text">{f.subject}</span>
        <StatusBadge tone={statusTone(f.status)} label={f.status.replace(/_/g, " ")} />
      </div>
      <div className="mt-1 text-[11px] text-text">{f.condition}</div>
      <div className="mt-1 text-[10.5px] text-muted">{f.rationale}</div>
      {f.required_action && <div className="text-[10.5px] text-muted">→ {f.required_action}</div>}
      <div className="mt-1 text-[9.5px] uppercase tracking-wide text-muted">{f.rule_id} · {f.jurisdiction}</div>
    </div>
  );
}

function RegulatoryTab({ card, t }: { card: FormulationCard; t: TFunction<readonly ["session", "common"]> }) {
  const regulatory = card.regulatory;
  if (!regulatory) {
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
  const ingredientFindings = regulatory.findings.filter((f) => f.subject_type === "ingredient");
  const labelFindings = regulatory.findings.filter((f) => f.subject_type === "label");
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="mb-2 text-[11px] text-muted">
        {t("formulationResult.regulatory.targetMarket")}: <span className="text-text">{regulatory.target_market || t("formulationResult.regulatory.unspecified")}</span>
      </div>
      <div className="mb-3 flex items-center gap-2">
        <Scale size={16} className={statusTone(regulatory.overall_status) === "error" ? "text-error" : "text-accent"} />
        <span className="text-[13px] font-medium text-text">{t("formulationResult.regulatory.overallStatus")}</span>
        <StatusBadge tone={statusTone(regulatory.overall_status)} label={regulatory.overall_status.replace(/_/g, " ")} />
      </div>
      <EvidenceSection title={t("formulationResult.regulatory.ingredientRestrictions")}>
        {ingredientFindings.length > 0 ? (
          <div className="space-y-1.5">{ingredientFindings.map((f, i) => <RegulatoryFindingRow key={i} f={f} />)}</div>
        ) : (
          <p className="text-[11.5px] text-muted">{t("formulationResult.regulatory.noFindings")}</p>
        )}
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.regulatory.claimReview")}>
        {regulatory.claims.length > 0 ? (
          <div className="space-y-1.5">
            {regulatory.claims.map((c, i) => (
              <div key={i} className="rounded-input border border-border-faint p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-medium text-text">{c.claim}</span>
                  <StatusBadge tone={statusTone(c.status)} label={c.status.replace(/_/g, " ")} />
                  <span className="text-[9.5px] uppercase tracking-wide text-muted">{t(`formulationResult.regulatory.claimCheckType.${c.check_type}`)}</span>
                </div>
                <div className="mt-1 text-[10.5px] text-muted">{c.rationale}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11.5px] text-muted">{t("formulationResult.regulatory.noClaims")}</p>
        )}
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.regulatory.labelInci")}>
        {labelFindings.length > 0 ? (
          <div className="space-y-1.5">{labelFindings.map((f, i) => <RegulatoryFindingRow key={i} f={f} />)}</div>
        ) : (
          <p className="text-[11.5px] text-muted">{t("formulationResult.regulatory.noFindings")}</p>
        )}
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.regulatory.coverage")}>
        <div className="mb-1.5">
          <StatusBadge tone={regulatory.coverage === "partial" ? "warning" : "muted"} label={t(`formulationResult.regulatory.coverageLevels.${regulatory.coverage}`)} />
        </div>
        <p className="text-[11.5px] leading-relaxed text-muted">{regulatory.missing_coverage_note}</p>
      </EvidenceSection>
    </div>
  );
}

// -------------------------------------------------- Tabs 2-4 (Session 5) ---

/** Phase 14 Session 5 — a compact, always-visible basis/confidence badge,
 *  the same "never hidden behind a tooltip only" convention `OriginBadge`
 *  already established. */
function BasisBadge({ basis, confidence, t }: { basis: string; confidence: string; t: TFunction<readonly ["session", "common"]> }) {
  const established = confidence === "established";
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase",
        established ? "bg-surface-2 text-muted" : "bg-warning/15 text-warning",
      )}
      title={t(`formulationResult.manufacturing.confidence.${confidence}`, { defaultValue: confidence })}
    >
      {t(`formulationResult.manufacturing.basis.${basis}`, { defaultValue: basis })}
    </span>
  );
}

function NotReadyNotice({ reason, t }: { reason: string; t: TFunction<readonly ["session", "common"]> }) {
  return (
    <div className="rounded-card border border-warning/40 bg-warning/10 p-4">
      <div className="mb-1 flex items-center gap-2 text-[13px] font-medium text-warning">
        <AlertTriangle size={16} />
        {t("formulationResult.manufacturing.notReady")}
      </div>
      <p className="text-[11.5px] leading-relaxed text-warning">{reason}</p>
    </div>
  );
}

function ManufacturingProcedureTab({ plan, t }: { plan: ManufacturingPlan; t: TFunction<readonly ["session", "common"]> }) {
  if (!plan.ready) return <NotReadyNotice reason={plan.not_ready_reason} t={t} />;
  if (plan.steps.length === 0) {
    return <NotYetAvailableTab icon={<Cog size={16} />} title={t("formulationResult.tabs.process")} body={t("formulationResult.process.notAvailable")} />;
  }
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <Cog size={16} className="text-accent" />
        <span className="text-[13px] font-medium text-text">{t("formulationResult.tabs.process")}</span>
        <span className="text-[10px] text-muted">{t(`formulationResult.manufacturing.scale.${plan.batch_scale}`)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border-faint text-left text-[10px] uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-2">#</th>
              <th className="py-1.5 pr-2">{t("formulationResult.manufacturing.columns.phase")}</th>
              <th className="py-1.5 pr-2">{t("formulationResult.manufacturing.columns.ingredients")}</th>
              <th className="py-1.5 pr-2">{t("formulationResult.manufacturing.columns.instruction")}</th>
              <th className="py-1.5 pr-2">{t("formulationResult.manufacturing.columns.mixing")}</th>
              <th className="py-1.5 pr-2">{t("formulationResult.manufacturing.columns.temperature")}</th>
              <th className="py-1.5 pr-2">{t("formulationResult.manufacturing.columns.time")}</th>
              <th className="py-1.5 pr-2">{t("formulationResult.manufacturing.columns.endpoint")}</th>
              <th className="py-1.5 pr-2">{t("formulationResult.manufacturing.columns.basis")}</th>
            </tr>
          </thead>
          <tbody>
            {plan.steps.map((s) => (
              <tr key={s.order} className="border-b border-border-faint/60 align-top">
                <td className="py-1.5 pr-2 text-muted">{s.order}</td>
                <td className="py-1.5 pr-2 text-text">{s.phase}</td>
                <td className="py-1.5 pr-2 text-text">{s.ingredients.join(", ")}</td>
                <td className="py-1.5 pr-2 text-text">{s.instruction}</td>
                <td className="py-1.5 pr-2 text-muted">{s.mixing_method}</td>
                <td className="py-1.5 pr-2 tabular-nums text-text">{s.temperature_c !== null ? `${s.temperature_c}°C` : "—"}</td>
                <td className="py-1.5 pr-2 tabular-nums text-text">{s.time_minutes !== null ? `${s.time_minutes} min` : "—"}</td>
                <td className="py-1.5 pr-2 text-muted">{s.endpoint}</td>
                <td className="py-1.5 pr-2"><BasisBadge basis={s.basis} confidence={s.confidence} t={t} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CriticalParametersTab({ plan, t }: { plan: ManufacturingPlan; t: TFunction<readonly ["session", "common"]> }) {
  if (!plan.ready) return <NotReadyNotice reason={plan.not_ready_reason} t={t} />;
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle size={16} className="text-accent" />
        <span className="text-[13px] font-medium text-text">{t("formulationResult.tabs.critical")}</span>
      </div>
      <div className="space-y-2">
        {plan.critical_parameters.map((p, i) => (
          <div key={i} className="rounded-input border border-border-faint p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium text-text">{p.parameter}</span>
              <StatusBadge tone={p.param_type === "critical_limit" ? "error" : "muted"}
                           label={t(`formulationResult.manufacturing.paramType.${p.param_type}`)} />
              <BasisBadge basis={p.source_type} confidence={p.confidence} t={t} />
            </div>
            <div className="mt-1 text-[11.5px] text-text">{p.range_or_limit}</div>
            <div className="mt-1 text-[10.5px] text-muted">{t("formulationResult.manufacturing.whyItMatters")}: {p.why_it_matters}</div>
            <div className="text-[10.5px] text-muted">{t("formulationResult.manufacturing.consequence")}: {p.consequence_if_violated}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EquipmentTab({ plan, t }: { plan: ManufacturingPlan; t: TFunction<readonly ["session", "common"]> }) {
  if (!plan.ready) return <NotReadyNotice reason={plan.not_ready_reason} t={t} />;
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <Wrench size={16} className="text-accent" />
        <span className="text-[13px] font-medium text-text">{t("formulationResult.tabs.equipment")}</span>
        <span className="text-[10px] text-muted">{t(`formulationResult.manufacturing.scale.${plan.batch_scale}`)}</span>
      </div>
      <div className="space-y-2">
        {plan.equipment.map((e, i) => (
          <div key={i} className="rounded-input border border-border-faint p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium text-text">{e.equipment}</span>
              <StatusBadge tone={e.requirement_level === "required" ? "error" : "muted"}
                           label={t(`formulationResult.manufacturing.requirementLevel.${e.requirement_level}`)} />
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                e.available_in_facility === "yes" ? "bg-success/10 text-success"
                  : e.available_in_facility === "missing" ? "bg-error/10 text-error" : "bg-surface-2 text-muted",
              )}>
                {t(`formulationResult.manufacturing.availability.${e.available_in_facility}`)}
              </span>
            </div>
            <div className="mt-1 text-[11.5px] text-text">{e.purpose}</div>
            <div className="mt-1 text-[10.5px] text-muted">{e.suggested_capacity}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {e.key_capabilities.map((c) => (
                <span key={c} className="rounded-input bg-surface-2 px-1.5 py-0.5 text-[9.5px] text-muted">{c}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Tab 7 ---

function EvidenceTab({
  card,
  formula,
  literature,
  scientificFormulations,
  t,
}: {
  card: FormulationCard;
  formula: GeneratedFormula | undefined;
  literature: LiteratureDocument[];
  scientificFormulations: SessionDetail["scientific_formulations"];
  t: TFunction<readonly ["session", "common"]>;
}) {
  const refs = formula?.references ?? [];
  const corpus = card.research_corpus;
  // Phase 14 Session 4 §7: the FULL research corpus, not merely the 2-3
  // papers linked to this version's own selected ingredients — a 15-
  // provider-hit count must never be presented as "15 studies" (§7's own
  // explicit warning), so this table shows the real, already-deduplicated
  // `literature` list `read_session` now returns, each row's own
  // `unique_source_count` visible rather than implied.
  const linkedDois = new Set((card.evidence_links ?? []).map((l) => l.paper_doi).filter(Boolean));
  // Phase 14 Session 6 — Evidence & Sources UI fix (§13/§14): per-source
  // Evidence Class and Evidence Record count, aggregated from THIS card's
  // own `evidence_links` (already version-scoped, never a second
  // extraction pass) — the best (A > B > C > D > E) class actually linked
  // to each DOI and how many records back it, never a fabricated relevance
  // score this data doesn't carry.
  const EVIDENCE_CLASS_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };
  const evidenceByDoi = new Map<string, { count: number; bestClass: string }>();
  for (const l of card.evidence_links ?? []) {
    if (!l.paper_doi) continue;
    const existing = evidenceByDoi.get(l.paper_doi);
    if (!existing) {
      evidenceByDoi.set(l.paper_doi, { count: 1, bestClass: l.evidence_class });
    } else {
      existing.count += 1;
      if (EVIDENCE_CLASS_RANK[l.evidence_class] < EVIDENCE_CLASS_RANK[existing.bestClass]) {
        existing.bestClass = l.evidence_class;
      }
    }
  }
  const [expanded, setExpanded] = useState<number | null>(null);
  // Phase 14 Session 6 correction gate: the primary gate is FULL-TEXT
  // sources against the 15-document target — never the qualifying
  // (relevant-but-not-necessarily-full-text) count alone, which can read
  // as "15/15 succeeded" even when 0 usable evidence was ever extracted
  // from those documents. Every count stays separately visible — never
  // collapsed into one figure.
  const zeroEvidenceDespiteCorpus = !!corpus && corpus.qualifying_count > 0 && corpus.evidence_record_count === 0;
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      {corpus && (
        <>
          <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <CorpusCounter label={t("formulationResult.evidenceTab.counters.fullTextGate")} value={`${corpus.full_text_count} / ${corpus.target_count}`} />
            <CorpusCounter label={t("formulationResult.evidenceTab.counters.researchSources")} value={`${corpus.qualifying_count} / ${corpus.target_count}`} />
            <CorpusCounter label={t("formulationResult.evidenceTab.counters.rawCandidates")} value={String(corpus.raw_candidate_count)} />
            <CorpusCounter label={t("formulationResult.evidenceTab.counters.abstractOnly")} value={String(corpus.abstract_only_count)} />
            <CorpusCounter label={t("formulationResult.evidenceTab.counters.metadataOnly")} value={String(corpus.metadata_only_count)} />
            <CorpusCounter label={t("formulationResult.evidenceTab.counters.evidenceRecords")} value={String(corpus.evidence_record_count)} />
            <CorpusCounter label={t("formulationResult.evidenceTab.counters.uniqueStudies")} value={String(corpus.unique_evidence_study_count)} />
            <CorpusCounter label={t("formulationResult.evidenceTab.counters.formulaLinked")} value={String(linkedDois.size)} />
          </div>
          {zeroEvidenceDespiteCorpus && (
            <div className="mb-3 rounded-input border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              {t("formulationResult.evidenceTab.zeroEvidenceDespiteCorpus", { count: corpus.qualifying_count })}
            </div>
          )}
        </>
      )}

      <EvidenceSection title={t("formulationResult.evidenceTab.summary")}>
        <p className="text-[11.5px] text-muted">{t("formulationResult.evidenceTab.summaryBody", { count: refs.length })}</p>
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.evidenceTab.qualityDistribution")}>
        <p className="text-[11.5px] text-muted">{t("formulationResult.evidenceTab.qualityNotYetClassified")}</p>
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.evidenceTab.sources")}>
        {literature.length > 0 ? (
          <SourcesTable
            literature={literature}
            evidenceByDoi={evidenceByDoi}
            linkedDois={linkedDois}
            scientificFormulations={scientificFormulations}
            cardVersion={card.version}
            expanded={expanded}
            onToggle={setExpanded}
            t={t}
          />
        ) : refs.length > 0 ? (
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
        <p className="text-[11.5px] text-muted">
          {corpus && corpus.qualifying_count < corpus.target_count
            ? t("formulationResult.evidenceTab.corpusShortfall", { found: corpus.qualifying_count, target: corpus.target_count })
            : t("formulationResult.evidenceTab.gapsBody")}
        </p>
      </EvidenceSection>
    </div>
  );
}

// FormuLab v1 correction (FVL-03) — Evidence & Sources UI redesign (§15/
// §16/§17): a compact PRIMARY table (no ellipsized title, no cramped
// 10-column squeeze) plus a full-width DETAIL PANEL rendered as a sibling
// of the table (never a `colSpan` row constrained to the table's own
// column widths — that constraint was the real, structural reason detail
// content kept clipping). Only one source is expanded at a time; its
// panel renders directly below the table, at the tab's own full content
// width.
function SourcesTable({
  literature,
  evidenceByDoi,
  linkedDois,
  scientificFormulations,
  cardVersion,
  expanded,
  onToggle,
  t,
}: {
  literature: LiteratureDocument[];
  evidenceByDoi: Map<string, { count: number; bestClass: string }>;
  linkedDois: Set<string>;
  scientificFormulations: SessionDetail["scientific_formulations"];
  cardVersion: string;
  expanded: number | null;
  onToggle: (i: number | null) => void;
  t: TFunction<readonly ["session", "common"]>;
}) {
  const formulationsByDoi = new Map<string, ScientificFormulationRecord[]>();
  for (const f of scientificFormulations?.formulations ?? []) {
    const list = formulationsByDoi.get(f.doi) ?? [];
    list.push(f);
    formulationsByDoi.set(f.doi, list);
  }
  return (
    <div>
      <div className="overflow-x-auto rounded-input border border-border-faint">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-border-faint bg-surface-2/60 text-left text-[10px] uppercase text-muted">
              <th className="w-[36px] py-1.5 pl-2 pr-1">#</th>
              <th className="py-1.5 pr-2">{t("formulationResult.evidenceTab.columns.title")}</th>
              <th className="w-[52px] py-1.5 pr-2">{t("formulationResult.evidenceTab.columns.year")}</th>
              <th className="w-[52px] py-1.5 pr-2">{t("formulationResult.evidenceTab.columns.evidenceClass")}</th>
              <th className="w-[76px] py-1.5 pr-2">{t("formulationResult.evidenceTab.columns.fullText")}</th>
              <th className="w-[110px] py-1.5 pr-2">{t("formulationResult.evidenceTab.columns.scientificFormulations")}</th>
              <th className="w-[90px] py-1.5 pr-2">{t("formulationResult.evidenceTab.columns.usedByVersion")}</th>
              <th className="w-[44px] py-1.5 pr-2" />
            </tr>
          </thead>
          <tbody>
            {literature.map((doc, i) => {
              const sciCount = (formulationsByDoi.get(doc.doi) ?? []).length;
              const isOpen = expanded === i;
              return (
                <tr
                  key={i}
                  className={cn("cursor-pointer border-b border-border-faint/60 align-top hover:bg-surface-2", isOpen && "bg-surface-2/70")}
                  onClick={() => onToggle(isOpen ? null : i)}
                >
                  <td className="py-1.5 pl-2 pr-1 text-muted">{i + 1}</td>
                  <td className="whitespace-normal break-words py-1.5 pr-2 text-text">{doc.title || "—"}</td>
                  <td className="py-1.5 pr-2 text-muted">{doc.year || "—"}</td>
                  <td className="py-1.5 pr-2 text-muted">{evidenceByDoi.get(doc.doi)?.bestClass ?? "—"}</td>
                  <td className="py-1.5 pr-2 text-muted">
                    {doc.pdf_file
                      ? t("formulationResult.evidenceTab.fullTextYes")
                      : t("formulationResult.evidenceTab.fullTextNo")}
                  </td>
                  <td className="py-1.5 pr-2 text-muted">{sciCount > 0 ? sciCount : "—"}</td>
                  <td className="py-1.5 pr-2 text-muted">
                    {linkedDois.has(doc.doi) ? cardVersion?.toUpperCase() : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-muted">
                    {isOpen ? <ChevronDown size={13} className="inline" /> : <ChevronRight size={13} className="inline" />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {expanded !== null && literature[expanded] && (
        <SourceDetailPanel
          doc={literature[expanded]}
          evidence={evidenceByDoi.get(literature[expanded].doi)}
          used={linkedDois.has(literature[expanded].doi)}
          cardVersion={cardVersion}
          formulations={formulationsByDoi.get(literature[expanded].doi) ?? []}
          outcomes={scientificFormulations?.outcomes ?? []}
          t={t}
        />
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 break-words text-[11.5px] text-text">{value ?? "—"}</div>
    </div>
  );
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border-faint pt-2 first:border-t-0 first:pt-0">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-accent">{title}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">{children}</div>
    </div>
  );
}

/** §17 — the full-width source detail: IDENTITY / DISCOVERY / FULL TEXT /
 *  EVIDENCE / SCIENTIFIC FORMULATIONS / FORMULAB USAGE. No fabricated
 *  relevance score — this data model carries no such field, so that
 *  section is intentionally omitted rather than invented. */
function SourceDetailPanel({
  doc,
  evidence,
  used,
  cardVersion,
  formulations,
  outcomes,
  t,
}: {
  doc: LiteratureDocument;
  evidence: { count: number; bestClass: string } | undefined;
  used: boolean;
  cardVersion: string;
  formulations: ScientificFormulationRecord[];
  outcomes: ExperimentalOutcome[];
  t: TFunction<readonly ["session", "common"]>;
}) {
  const [openFormulation, setOpenFormulation] = useState<number | null>(null);
  return (
    <div className="mt-2 space-y-3 rounded-card border border-border bg-surface-2/30 p-3">
      <DetailGroup title={t("formulationResult.evidenceTab.detail.identity")}>
        <div className="col-span-2 sm:col-span-3"><DetailField label={t("formulationResult.evidenceTab.columns.title")} value={doc.title} /></div>
        <DetailField label={t("formulationResult.evidenceTab.columns.author")} value={doc.authors} />
        <DetailField label={t("formulationResult.evidenceTab.venue")} value={doc.venue} />
        <DetailField label={t("formulationResult.evidenceTab.columns.year")} value={doc.year} />
        <DetailField label={t("formulationResult.evidenceTab.columns.doi")} value={doc.doi} />
        <DetailField label={t("formulationResult.evidenceTab.citedBy")} value={doc.cited_by} />
      </DetailGroup>
      <DetailGroup title={t("formulationResult.evidenceTab.detail.discovery")}>
        <DetailField label={t("formulationResult.evidenceTab.columns.discoveredVia")} value={(doc.provenance_sources ?? [doc.source_db]).join(" + ")} />
        <DetailField label={t("formulationResult.evidenceTab.detail.providerCount")} value={(doc.provenance_sources ?? [doc.source_db]).length} />
      </DetailGroup>
      <DetailGroup title={t("formulationResult.evidenceTab.detail.fullText")}>
        <DetailField label={t("formulationResult.evidenceTab.columns.fullText")} value={doc.pdf_file ? t("formulationResult.evidenceTab.fullTextYes") : (doc.fulltext || t("formulationResult.evidenceTab.fullTextNo"))} />
        <DetailField label={t("formulationResult.evidenceTab.columns.resolvedVia")} value={doc.resolved_via} />
        <DetailField label={t("formulationResult.evidenceTab.oaLabel")} value={doc.is_oa ? t("formulationResult.evidenceTab.oaYes") : t("formulationResult.evidenceTab.oaNo")} />
      </DetailGroup>
      <DetailGroup title={t("formulationResult.evidenceTab.detail.evidence")}>
        <DetailField label={t("formulationResult.evidenceTab.columns.evidenceClass")} value={evidence?.bestClass} />
        <DetailField label={t("formulationResult.evidenceTab.columns.evidenceRecords")} value={evidence?.count ?? 0} />
      </DetailGroup>
      {formulations.length > 0 && (
        <DetailGroup title={t("formulationResult.evidenceTab.detail.scientificFormulations")}>
          <div className="col-span-2 sm:col-span-3 space-y-1.5">
            {formulations.map((f, i) => {
              const own = outcomes.filter((o) => o.source_formulation_id === f.source_formulation_id);
              const isOpen = openFormulation === i;
              return (
                <div key={f.id} className="rounded-input border border-border-faint bg-surface p-2">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 text-left"
                    onClick={() => setOpenFormulation(isOpen ? null : i)}
                  >
                    <span className="text-[11.5px] font-medium text-text">
                      {f.source_formulation_id || t("formulationResult.evidenceTab.detail.unlabeledFormulation")}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-muted">
                      {t("formulationResult.evidenceTab.detail.ingredientCount", { count: f.ingredients.length })}
                      {own.length > 0 ? ` · ${t("formulationResult.evidenceTab.detail.hasResults")}` : ""}
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="mt-2 space-y-2">
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse text-[10.5px]">
                          <thead>
                            <tr className="border-b border-border-faint text-left uppercase text-muted">
                              <th className="py-1 pr-2">{t("formulationResult.evidenceTab.detail.ingredient")}</th>
                              <th className="py-1 pr-2">{t("formulationResult.evidenceTab.detail.amount")}</th>
                              <th className="py-1 pr-2">{t("formulationResult.evidenceTab.detail.materialMatch")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {f.ingredients.map((row, ri) => (
                              <tr key={ri} className="border-b border-border-faint/50">
                                <td className="py-0.5 pr-2 text-text">{row.source_name}</td>
                                <td className="py-0.5 pr-2 text-muted">{row.value_text}{row.unit ? ` ${row.unit}` : ""}</td>
                                <td className="py-0.5 pr-2 text-muted">
                                  {row.identity_status === "unresolved_material_identity"
                                    ? t("formulationResult.evidenceTab.detail.unresolvedMaterial")
                                    : (row.material_id || row.normalized_key || "—")}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {own.length > 0 && (
                        <div>
                          <div className="mb-1 text-[9px] uppercase tracking-wide text-muted">
                            {t("formulationResult.evidenceTab.detail.experimentalResults")}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {own.slice(0, 12).map((o, oi) => (
                              <span key={oi} className="rounded-input bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">
                                {o.metric}{o.condition ? ` @ ${o.condition}` : ""}: {o.value ?? o.raw_text}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </DetailGroup>
      )}
      <DetailGroup title={t("formulationResult.evidenceTab.detail.formulabUsage")}>
        <DetailField
          label={t("formulationResult.evidenceTab.columns.usedByVersion")}
          value={used ? cardVersion?.toUpperCase() : t("formulationResult.evidenceTab.detail.notUsedThisVersion")}
        />
      </DetailGroup>
    </div>
  );
}

function CorpusCounter({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-input border border-border bg-surface-2/50 p-2">
      <div className="text-[9px] uppercase tracking-wide text-muted">{label}</div>
      <div className="text-[15px] font-semibold text-text">{value}</div>
    </div>
  );
}

// ------------------------------------------------------------ Tab 8 ---

/** §20 — real, computed architecture selection audit: which architecture
 *  each SELECTED version actually used (never generic text — each row is
 *  this version's own real `architecture_basis`), and which scientific
 *  formulation architectures existed but were not selected by ANY
 *  version this run, with the real reason `pipeline.py`'s own
 *  `scientific_formulation_summary` already computed. */
function AlternativesTab({
  cards,
  summary,
  t,
}: {
  cards: FormulationCard[];
  summary: ScientificFormulationSummary | null | undefined;
  t: TFunction<readonly ["session", "common"]>;
}) {
  const selected = cards.filter((c) => c.status !== "generation_failed");
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <ClipboardList size={16} className="text-accent" />
        <span className="text-[13px] font-medium text-text">{t("formulationResult.tabs.alternatives")}</span>
      </div>
      <EvidenceSection title={t("formulationResult.alternatives.selected")}>
        <div className="space-y-2">
          {selected.map((c) => {
            const basis = c.architecture_basis;
            return (
              <div key={c.version} className="rounded-input border border-border-faint p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-input bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-text">{c.version}</span>
                  {c.strategy && (
                    <span className="text-[11.5px] font-medium text-text">{c.strategy.title}</span>
                  )}
                  {basis && (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted">
                      {t(`formulationResult.formula.architecture.origins.${basis.origin}`, { defaultValue: basis.origin })}
                    </span>
                  )}
                </div>
                {basis && (basis.source_paper_doi || basis.source_formulation_id) && (
                  <div className="mt-1 text-[11px] text-muted">
                    {basis.source_paper_doi || basis.source_title}{basis.source_formulation_id ? ` — ${basis.source_formulation_id}` : ""}
                  </div>
                )}
                {basis && (basis.retained > 0 || basis.added > 0) && (
                  <div className="mt-1 text-[11px] text-muted">
                    {t("formulationResult.alternatives.retainedAddedRemoved", {
                      defaultValue: "{{retained}} retained from seed · {{added}} completed from the generic pool · {{removed}} removed/substituted",
                      retained: basis.retained, added: basis.added, removed: basis.removed,
                    })}
                  </div>
                )}
                {basis?.reason && <div className="mt-1 text-[11px] text-muted">{basis.reason}</div>}
                {c.strategy?.rationale && (
                  <div className="mt-1 text-[11px] text-muted">{c.strategy.rationale}</div>
                )}
              </div>
            );
          })}
        </div>
      </EvidenceSection>
      {summary && summary.architectures_rejected.length > 0 && (
        <EvidenceSection title={t("formulationResult.alternatives.rejectedScientific")}>
          <div className="space-y-1.5">
            {summary.architectures_rejected.map((r, i) => (
              <div key={i} className="rounded-input border border-border-faint px-2.5 py-1.5 text-[11.5px]">
                <span className="font-medium text-text">{r.source_formulation_id || "—"}</span>
                <span className="text-muted"> — {r.source_title || r.doi}</span>
              </div>
            ))}
          </div>
        </EvidenceSection>
      )}
      {summary?.rule_only_despite_applicable_scientific_formulation && (
        <div className="mt-3 rounded-input border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          {t("formulationResult.alternatives.allRuleOnlyDespiteApplicable")}
        </div>
      )}
      {!summary && (
        <p className="mt-2 text-[11.5px] text-muted">{t("formulationResult.alternatives.noScientificData")}</p>
      )}
    </div>
  );
}

// ------------------------------------------------------------ Tab 9 ---

function SummaryTab({
  card,
  formula,
  costSnapshot,
  currency,
  batchKg,
  onBatchKgChange,
  onCurrencyChange,
  inventoryFeasibility,
  t,
}: {
  card: FormulationCard;
  formula: GeneratedFormula | undefined;
  costSnapshot: CostSnapshot | undefined;
  currency: string;
  batchKg: string;
  onBatchKgChange: (v: string) => void;
  onCurrencyChange: (v: string) => void;
  inventoryFeasibility: FormulaInventoryFeasibility | undefined;
  t: TFunction<readonly ["session", "common"]>;
}) {
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
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            {t("studio.costing.batch")}
            <input
              value={batchKg}
              onChange={(e) => onBatchKgChange(e.target.value)}
              inputMode="decimal"
              aria-label={t("studio.costing.batch")}
              className="w-20 rounded-input border border-border bg-surface px-2 py-1 text-right text-[12px] text-text outline-none focus:border-accent"
            />
            {t("builder.kgUnit")}
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-muted">
            {t("cost.currency")}
            <select
              value={currency}
              onChange={(e) => onCurrencyChange(e.target.value)}
              aria-label={t("cost.currency")}
              className="rounded-input border border-border bg-surface px-2 py-1 text-[12px] text-text outline-none focus:border-accent"
            >
              {["KES", "USD", "EUR", "GBP", "TRY"].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <CostSnapshotSummary snapshot={costSnapshot} currency={currency} />
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.versionSummary.inventoryFeasibility")}>
        <InventoryFeasibilitySummary feasibility={inventoryFeasibility} />
      </EvidenceSection>
      <EvidenceSection title={t("formulationResult.summary.confidence")}>
        {card.score ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11.5px] text-text">
            <div><span className="text-muted">{t("formulationResult.summary.scoreFactors.hardConstraintCompliance")}: </span>{Math.round(card.score.hard_constraint_compliance * 100)}%</div>
            <div><span className="text-muted">{t("formulationResult.summary.scoreFactors.evidenceStrength")}: </span>{Math.round(card.score.evidence_strength * 100)}%</div>
            <div><span className="text-muted">{t("formulationResult.summary.scoreFactors.formulationCompleteness")}: </span>{Math.round(card.score.formulation_completeness * 100)}%</div>
            <div><span className="text-muted">{t("formulationResult.summary.scoreFactors.evidenceGapPenalty")}: </span>{Math.round(card.score.evidence_gap_penalty * 100)}%</div>
          </div>
        ) : (
          <p className="text-[11.5px] text-muted">{t("formulationResult.summary.confidenceNotYetComputed")}</p>
        )}
      </EvidenceSection>
      {card.quality_gate && card.quality_gate.length > 0 && (
        <EvidenceSection title={t("formulationResult.summary.qualityNotes")}>
          <ul className="space-y-1">
            {card.quality_gate.map((f, i) => (
              <li
                key={i}
                className={cn(
                  "rounded-input px-2.5 py-1.5 text-[11.5px]",
                  f.severity === "warning" ? "border border-warning/30 bg-warning/5 text-warning" : "text-muted",
                )}
              >
                {f.message}
              </li>
            ))}
          </ul>
        </EvidenceSection>
      )}
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
      {(card.safety || card.regulatory) && (
        <EvidenceSection title={t("formulationResult.summary.readiness")}>
          <div className="flex flex-wrap gap-2">
            {card.safety && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase text-muted">{t("formulationResult.safety.overallStatus")}</span>
                <StatusBadge tone={statusTone(card.safety.overall_status)} label={card.safety.overall_status.replace(/_/g, " ")} />
              </div>
            )}
            {card.regulatory && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase text-muted">{t("formulationResult.regulatory.overallStatus")}</span>
                <StatusBadge tone={statusTone(card.regulatory.overall_status)} label={card.regulatory.overall_status.replace(/_/g, " ")} />
              </div>
            )}
            {card.formula_state && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase text-muted">{t("formulationResult.summary.formulaState")}</span>
                <StatusBadge tone={card.formula_state.startsWith("invalid") ? "error" : card.formula_state === "complete" ? "success" : "warning"} label={card.formula_state.replace(/_/g, " ")} />
              </div>
            )}
          </div>
        </EvidenceSection>
      )}
      {card.evidence_gaps && card.evidence_gaps.length > 0 ? (
        <EvidenceSection title={t("formulationResult.summary.evidenceGaps")}>
          <ul className="space-y-1">
            {card.evidence_gaps.map((g, i) => (
              <li key={i} className="rounded-input border border-warning/20 bg-warning/5 px-2 py-1 text-[11px] text-warning">
                <span className="mr-1 text-[9px] uppercase tracking-wide text-muted">{g.category.replace(/_/g, " ")}</span>
                {g.gap}
              </li>
            ))}
          </ul>
        </EvidenceSection>
      ) : card.evidence_gaps ? (
        <EvidenceSection title={t("formulationResult.summary.evidenceGaps")}>
          <p className="text-[11.5px] text-success">{t("formulationResult.summary.noEvidenceGaps")}</p>
        </EvidenceSection>
      ) : null}
      {card.trace_events && card.trace_events.length > 0 && (
        <EvidenceSection title={t("formulationResult.summary.traceability")}>
          <ul className="space-y-1">
            {card.trace_events.map((ev, i) => (
              <li
                key={i}
                className={cn(
                  "rounded-input border px-2 py-1 text-[11px]",
                  ev.result === "rejected" ? "border-border-faint text-muted"
                    : ev.result === "missing" ? "border-warning/20 bg-warning/5 text-warning"
                      : "border-border-faint text-text",
                )}
              >
                <span className="mr-1 text-[9px] uppercase tracking-wide text-muted">{ev.result}</span>
                <span className="font-medium">{ev.subject}</span>
                {ev.rationale && <span className="text-muted"> — {ev.rationale}</span>}
              </li>
            ))}
          </ul>
        </EvidenceSection>
      )}
      <EvidenceSection title={t("formulationResult.summary.validationRequired")}>
        {card.validation_plan && card.validation_plan.length > 0 ? (
          <ul className="space-y-1">
            {card.validation_plan.map((v, i) => (
              <li key={i} className="text-[11.5px] text-muted">
                <span className="font-medium text-text">{v.check}</span> — {v.reason}
              </li>
            ))}
          </ul>
        ) : (
          <ul className="list-disc space-y-0.5 pl-4 text-[11.5px] text-muted">
            {(t("formulationResult.summary.validationChecklist", { returnObjects: true }) as string[]).map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}
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

function QuickActions({
  navigate,
  t,
  onCostAnalysis,
  onOptimize,
  optimizing,
}: {
  navigate: ReturnType<typeof useNavigate>;
  t: TFunction<readonly ["session", "common"]>;
  onCostAnalysis: () => void;
  onOptimize?: () => void;
  optimizing?: boolean;
}) {
  const actions: { icon: React.ReactNode; label: string; onClick?: () => void }[] = [
    { icon: <StickyNote size={13} />, label: t("formulationResult.quickActions.addNote") },
    { icon: <FlaskConical size={13} />, label: t("formulationResult.quickActions.createTrial"), onClick: () => navigate("/laboratory") },
    { icon: <Beaker size={13} />, label: t("formulationResult.quickActions.planStability"), onClick: () => navigate("/stability") },
    { icon: <Wallet size={13} />, label: t("formulationResult.quickActions.costAnalysis"), onClick: onCostAnalysis },
    { icon: <FileDown size={13} />, label: t("formulationResult.quickActions.saveFormula") },
    { icon: <Share2 size={13} />, label: t("formulationResult.quickActions.querySupplier"), onClick: () => navigate("/materials") },
    {
      icon: <SlidersHorizontal size={13} />,
      label: optimizing ? t("formulationResult.quickActions.optimizing") : t("formulationResult.quickActions.optimize"),
      onClick: optimizing ? undefined : onOptimize,
    },
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

function VersionSummaryCard({
  card,
  formula,
  t,
  snapshot,
  currency,
  isCheapestValid,
  inventoryFeasibility,
  isMostFeasible,
}: {
  card: FormulationCard | undefined;
  formula: GeneratedFormula | undefined;
  t: TFunction<readonly ["session", "common"]>;
  snapshot: CostSnapshot | undefined;
  currency: string;
  isCheapestValid: boolean;
  inventoryFeasibility: FormulaInventoryFeasibility | undefined;
  isMostFeasible: boolean;
}) {
  const total = totalWeightPct(formula);
  const costValue = snapshot?.totalManufacturingCost
    ? displayMoney(snapshot.totalManufacturingCost, currency)
    : t("formulationResult.versionSummary.notAvailable");
  const inventoryValue = inventoryFeasibility
    ? t(`inventory.state.${inventoryFeasibility.formulaState}`)
    : t("formulationResult.versionSummary.notAvailable");
  const rows: [string, string][] = [
    [t("formulationResult.versionSummary.totalIngredients"), String(formula?.ingredients?.length ?? "—")],
    [t("formulationResult.versionSummary.estimatedCost"), costValue],
    [t("formulationResult.versionSummary.inventoryFeasibility"), inventoryValue],
    [t("formulationResult.versionSummary.activeMatter"), total !== undefined ? `${total}%` : "—"],
    [t("formulationResult.versionSummary.overallScore"), t("formulationResult.versionSummary.notYetScored")],
  ];
  return (
    <div className="rounded-card border border-border bg-surface p-3">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
        {t("formulationResult.versionSummary.heading", { version: card?.version?.toUpperCase() ?? "" })}
      </div>
      {isCheapestValid && (
        <div className="mb-2 rounded-input bg-accent/10 px-2 py-1 text-[10.5px] font-medium text-accent">
          {t("formulationResult.versionSummary.cheapestValid")}
        </div>
      )}
      {isMostFeasible && (
        <div className="mb-2 rounded-input bg-success/10 px-2 py-1 text-[10.5px] font-medium text-success">
          {t("formulationResult.versionSummary.mostFeasible")}
        </div>
      )}
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

function StatusBadge({ tone, label }: { tone: "error" | "muted" | "success" | "warning"; label: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
        tone === "error" && "bg-error/10 text-error",
        tone === "muted" && "bg-surface-2 text-muted",
        tone === "success" && "bg-success/10 text-success",
        tone === "warning" && "bg-warning/15 text-warning",
      )}
    >
      {label}
    </span>
  );
}

/** Phase 14 Session 6 — the shared PASS/COMPLIANT-family status vocabulary
 *  used by both the Safety and Regulatory tabs. */
function statusTone(status: string): "error" | "muted" | "success" | "warning" {
  if (status === "FAIL" || status === "NON_COMPLIANT") return "error";
  if (status === "PASS_WITH_CONDITIONS" || status === "COMPLIANT_WITH_CONDITIONS") return "warning";
  if (status === "PASS" || status === "COMPLIANT") return "success";
  return "muted"; // DATA_INCOMPLETE
}
