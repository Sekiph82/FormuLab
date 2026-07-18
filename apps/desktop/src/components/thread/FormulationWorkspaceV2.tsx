import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { FileText, Loader2, Plus, TriangleAlert, Trash2, FlaskConical, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  generateFormulation,
  listSessions,
  readSession,
  deleteSession,
  type FormulationBrief,
  type FormulationCard,
  type ProviderConfig,
  type SessionSummary,
} from "@/lib/formulationV2";
import { AgentMessage } from "./atoms";
import { FormulationStudio } from "./FormulationStudio";
import { ProviderBar } from "./ProviderBar";

/**
 * FormuLab v2 workspace — the direct-pipeline surface, no OpenCode. Three
 * regions: sessions sidebar · studio form · multi-card result (v1…vN tabs).
 *
 * Generate → `generate_formulation` (one request/response). Opening a past
 * session → `read_session` (saved cards, READ-ONLY, never re-runs the model).
 * Only successful runs are saved as sessions; failures/refusals never persist.
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

  const [cfg, setCfg] = useState<ProviderConfig | null>(null);
  const [view, setView] = useState<View>({ mode: "empty" });
  const [active, setActive] = useState(0);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  const refreshSessions = useCallback(() => {
    void listSessions().then(setSessions).catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

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
    if (!cfg) return;
    setActive(0);
    setView({ mode: "loading" });
    // A new run must not append to an opened past session.
    if (sessionId) navigate("/live");
    try {
      const res = await generateFormulation(brief, cfg, 3);
      if (res.status === "ok" && res.cards?.length) {
        setView({ mode: "cards", cards: res.cards, readOnly: false, papers: res.papers, slug: res.slug });
        refreshSessions();
      } else if (res.status === "refused") {
        setView({ mode: "refused", message: res.message ?? "Refused." });
      } else {
        setView({ mode: "error", message: res.message ?? "Generation failed." });
      }
    } catch (e) {
      setView({ mode: "error", message: String(e) });
    }
  };

  const onNew = () => {
    setView({ mode: "empty" });
    setActive(0);
    if (sessionId) navigate("/live");
  };

  const onDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSession(id).catch(() => {});
    refreshSessions();
    if (sessionId === id) navigate("/live");
  };

  const keyMissing = !!cfg && cfg.provider !== "ollama" && cfg.apiKey.trim().length === 0;

  return (
    <div className="flex h-full min-w-0">
      {/* Sessions sidebar. */}
      <aside className="flex w-[210px] shrink-0 flex-col border-r border-border bg-surface-2/30">
        <div className="flex items-center justify-between px-3 py-3">
          <span className="text-xs font-medium uppercase tracking-wider text-muted">
            {t("studio.sessions.heading", "Sessions")}
          </span>
          <button
            onClick={onNew}
            title={t("studio.result.new")}
            className="grid h-6 w-6 place-items-center rounded-input text-muted hover:bg-surface-2 hover:text-text"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {sessions.length === 0 ? (
            <p className="px-2 py-4 text-[11px] leading-relaxed text-muted">
              {t("studio.sessions.empty", "Saved formulations appear here.")}
            </p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => navigate(`/live/${s.id}`)}
                className={cn(
                  "group mb-1 flex w-full items-start gap-2 rounded-input px-2 py-2 text-left text-[12px] transition-colors",
                  sessionId === s.id ? "bg-surface-2 text-text" : "text-muted hover:bg-surface-2/60",
                )}
              >
                <FlaskConical size={13} className="mt-0.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-text">
                    {s.brief?.target ?? s.id}
                  </span>
                  <span className="block truncate text-[10px] text-muted">
                    {s.card_count} {s.card_count === 1 ? "card" : "cards"}
                    {s.brief?.market && s.brief.market !== "any" ? ` · ${s.brief.market}` : ""}
                  </span>
                </span>
                <span
                  onClick={(e) => onDelete(s.id, e)}
                  className="hidden shrink-0 text-muted hover:text-red-500 group-hover:block"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* Studio form. */}
      <div className="flex-[3] min-w-[300px] overflow-hidden border-r border-border">
        <FormulationStudio
          onSubmit={onSubmit}
          busy={busy && !sessionId}
          headerSlot={<ProviderBar onChange={setCfg} />}
        />
      </div>

      {/* Result — v1…vN tabs. */}
      <div className="flex flex-[4] min-w-0 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
          <div className="text-xs font-medium uppercase tracking-wider text-muted">
            {t("studio.result.heading")}
            {view.mode === "cards" && view.readOnly && (
              <span className="ml-2 rounded-input bg-surface-2 px-1.5 py-0.5 text-[10px] normal-case text-muted">
                {t("studio.result.readOnly", "saved · read-only")}
              </span>
            )}
          </div>
          {view.mode === "cards" && view.papers != null && (
            <span className="text-[11px] text-muted">{view.papers} sources</span>
          )}
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
    const card = view.cards[Math.min(active, view.cards.length - 1)];
    return (
      <div className="flex h-full flex-col">
        {view.cards.length > 1 && (
          <div className="flex shrink-0 gap-1 border-b border-border-faint px-6 pt-3">
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
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <AgentMessage markdown={card.markdown} />
        </div>
      </div>
    );
  }
  // empty
  return (
    <div className="px-6 py-5">
      <div className="mx-auto mt-[18vh] max-w-[360px] text-center text-sm text-muted">
        <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-muted ring-1 ring-border">
          <FileText size={18} />
        </div>
        {keyMissing
          ? t("studio.result.needKey", "Add an API key on the left, then Generate.")
          : t("studio.result.empty")}
      </div>
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
