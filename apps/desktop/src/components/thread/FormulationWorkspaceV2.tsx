import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { FileText, Loader2, Printer, TriangleAlert, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  generateFormulation,
  readSession,
  loadProviderConfig,
  notifySessionsChanged,
  type FormulationBrief,
  type FormulationCard,
} from "@/lib/formulationV2";
import { AgentMessage } from "./atoms";
import { FormulationStudio } from "./FormulationStudio";
import { CostingPanel } from "./CostingPanel";
import { FormulaBuilder } from "@/components/formula/FormulaBuilder";
import { linesFromGeneratedFormula } from "@/lib/formulations";
import type { FormulationLine } from "@ai4s/shared";

/**
 * FormuLab v2 workspace — the direct-pipeline surface, no OpenCode. Two regions:
 * studio form · multi-card result (v1…vN tabs). Saved formulations live in the
 * app sidebar's history list, so this surface stays a two-pane workspace.
 *
 * Generate → `generate_formulation` (one request/response). Opening a past
 * session → `read_session` (saved cards, READ-ONLY, never re-runs the model).
 * Only successful runs are saved as sessions; failures/refusals never persist.
 *
 * Provider/model/key are chosen in Settings → Model, not here; this reads the
 * stored config at generate time.
 */

type View =
  | { mode: "empty" }
  | { mode: "loading" }
  | { mode: "cards"; cards: FormulationCard[]; readOnly: boolean; papers?: number; slug?: string }
  | { mode: "refused"; message: string }
  | { mode: "error"; message: string };

export function FormulationWorkspaceV2() {
  const { t } = useTranslation(["session", "common"]);
  const { sessionId } = useParams();
  const navigate = useNavigate();

  const [view, setView] = useState<View>({ mode: "empty" });
  const [active, setActive] = useState(0);

  // Follow the URL: an id opens that saved session read-only; no id is a fresh draft.
  useEffect(() => {
    let cancelled = false;
    if (!sessionId) {
      setView({ mode: "empty" });
      setActive(0);
      return;
    }
    setView({ mode: "loading" });
    readSession(sessionId)
      .then((s) => {
        if (cancelled) return;
        setActive(0);
        setView({ mode: "cards", cards: s.cards, readOnly: true });
      })
      .catch((e) => {
        if (!cancelled) setView({ mode: "error", message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const busy = view.mode === "loading";

  const onSubmit = async (brief: FormulationBrief) => {
    const cfg = loadProviderConfig(); // chosen in Settings → Model
    if (cfg.provider !== "ollama" && !cfg.apiKey.trim()) {
      setView({ mode: "error", message: t("studio.result.needKey") });
      return;
    }
    setActive(0);
    setView({ mode: "loading" });
    // A new run must not append to an opened past session.
    if (sessionId) navigate("/live");
    try {
      const res = await generateFormulation(brief, cfg, 3);
      if (res.status === "ok" && res.cards?.length) {
        setView({ mode: "cards", cards: res.cards, readOnly: false, papers: res.papers, slug: res.slug });
        notifySessionsChanged(); // refresh the sidebar's saved list
      } else if (res.status === "refused") {
        setView({ mode: "refused", message: res.message ?? "Refused." });
      } else {
        setView({ mode: "error", message: res.message ?? "Generation failed." });
      }
    } catch (e) {
      setView({ mode: "error", message: String(e) });
    }
  };

  // Provider config lives in Settings → Model; read it to tell the user when a
  // key is still missing rather than letting Generate fail.
  const cfg = loadProviderConfig();
  const keyMissing = cfg.provider !== "ollama" && cfg.apiKey.trim().length === 0;

  return (
    <div className="flex h-full min-w-0">
      {/* Studio form. */}
      <div className="print-hide flex-[3] min-w-[300px] overflow-hidden border-r border-border">
        <FormulationStudio onSubmit={onSubmit} busy={busy && !sessionId} />
      </div>

      {/* Result — v1…vN tabs. */}
      <div className="flex flex-[4] min-w-0 flex-col">
        <div className="print-hide flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
          <div className="text-xs font-medium uppercase tracking-wider text-muted">
            {t("studio.result.heading")}
            {view.mode === "cards" && view.readOnly && (
              <span className="ml-2 rounded-input bg-surface-2 px-1.5 py-0.5 text-[10px] normal-case text-muted">
                {t("studio.result.readOnly", "saved · read-only")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {view.mode === "cards" && view.papers != null && (
              <span className="text-[11px] text-muted">
                {t("studio.result.sourcesCount", { count: view.papers })}
              </span>
            )}
            {view.mode === "cards" && (
              // The OS print dialog reaches every installed printer, and its
              // "Print to PDF" target produces the PDF without a PDF engine here.
              <button
                onClick={() => window.print()}
                title={t("studio.result.printTitle")}
                className="flex items-center gap-1.5 rounded-input border border-border bg-surface px-2.5 py-1 text-xs text-text transition-colors hover:bg-surface-2"
              >
                <Printer size={13} className="text-muted" />
                {t("studio.result.print")}
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <ResultBody
            view={view}
            active={active}
            setActive={setActive}
            keyMissing={keyMissing}
            t={t}
          />
        </div>
      </div>
    </div>
  );
}

function ResultBody({
  view,
  active,
  setActive,
  keyMissing,
  t,
}: {
  view: View;
  active: number;
  setActive: (i: number) => void;
  keyMissing: boolean;
  t: TFunction<readonly ["session", "common"]>;
}) {
  if (view.mode === "loading") {
    return (
      <div className="px-6 py-5">
        <div className="flex items-start gap-3 rounded-card border border-border bg-surface p-5">
          <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-accent" />
          <div className="text-sm text-text">{t("studio.result.working")}</div>
        </div>
      </div>
    );
  }
  if (view.mode === "refused") {
    return (
      <Notice
        icon={<ShieldAlert size={18} className="text-amber-500" />}
        tone="amber"
        title={t("studio.result.refusedTitle", "Request declined")}
        body={view.message}
      />
    );
  }
  if (view.mode === "error") {
    return (
      <Notice
        icon={<TriangleAlert size={18} className="text-red-500" />}
        tone="red"
        title={t("studio.result.errorTitle", "Something went wrong")}
        body={view.message}
      />
    );
  }
  if (view.mode === "cards") {
    return <CardsView view={view} active={active} setActive={setActive} t={t} />;
  }
  // empty
  return (
    <div className="px-6 py-5">
      <div className="mx-auto mt-[18vh] max-w-[360px] text-center text-sm text-muted">
        <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-muted ring-1 ring-border">
          <FileText size={18} />
        </div>
        {keyMissing
          ? t("studio.result.needKey")
          : t("studio.result.empty")}
      </div>
    </div>
  );
}

/**
 * The generated card, and the editable formula behind it.
 *
 * A generated card is a starting point, not the end of the workflow: the
 * chemist edits it here and saves a version. The card stays available as the
 * printable, citable record of what was generated.
 */
function CardsView({
  view,
  active,
  setActive,
  t,
}: {
  view: Extract<View, { mode: "cards" }>;
  active: number;
  setActive: (i: number) => void;
  t: TFunction<readonly ["session", "common"]>;
}) {
  const card = view.cards[Math.min(active, view.cards.length - 1)];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FormulationLine[]>([]);
  const [batchKg, setBatchKg] = useState("100");

  // Entering edit mode seeds the grid from the generated formula, carrying each
  // ingredient's origin through as a model estimate rather than a fact.
  const startEditing = () => {
    if (draft.length === 0 && card.formula) {
      setDraft(linesFromGeneratedFormula(card.formula));
    }
    setEditing(true);
  };

    return (
      <div className="flex h-full flex-col">
        <div className="print-hide flex shrink-0 items-center gap-1 border-b border-border-faint px-6 pt-3">
          <button
            onClick={() => setEditing(false)}
            className={cn(
              "rounded-t-input border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
              !editing ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
            )}
          >
            {t("builder.cardTab")}
          </button>
          {card.formula ? (
            <button
              onClick={startEditing}
              className={cn(
                "rounded-t-input border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
                editing ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
              )}
            >
              {t("builder.editTab")}
            </button>
          ) : null}
        </div>
        {view.cards.length > 1 && (
          <div className="print-hide flex shrink-0 gap-1 border-b border-border-faint px-6 pt-3">
            {view.cards.map((c, i) => (
              <button
                key={c.version}
                onClick={() => setActive(i)}
                className={cn(
                  "rounded-t-input border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
                  i === active
                    ? "border-accent text-text"
                    : "border-transparent text-muted hover:text-text",
                )}
              >
                {c.version.toUpperCase()}
                {c.violations && c.violations.length > 0 && (
                  <span className="ml-1 text-amber-500">•</span>
                )}
              </button>
            ))}
          </div>
        )}
        {editing && card.formula ? (
          <FormulaBuilder
            lines={draft}
            onChange={setDraft}
            batchKg={batchKg}
            onBatchChange={setBatchKg}
            dirty={draft.length > 0}
          />
        ) : (
          /* print-area: the only thing that reaches paper (see index.css). */
          <div className="print-area min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <AgentMessage markdown={card.markdown} />
            {card.formula ? <CostingPanel formula={card.formula} /> : null}
          </div>
        )}
      </div>
  );
}

function Notice({
  icon,
  title,
  body,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tone: "amber" | "red";
}) {
  return (
    <div className="px-6 py-5">
      <div
        className={cn(
          "rounded-card border p-5",
          tone === "amber" ? "border-amber-500/40 bg-amber-500/5" : "border-red-500/40 bg-red-500/5",
        )}
      >
        <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-text">
          {icon}
          {title}
        </div>
        <p className="text-[13px] leading-relaxed text-muted">{body}</p>
      </div>
    </div>
  );
}
