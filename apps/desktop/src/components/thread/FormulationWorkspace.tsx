import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FileText, Loader2, Plus, TriangleAlert } from "lucide-react";
import type { ThreadBlock } from "@ai4s/shared";
import { DRAFT_KEY, useRuntimeStore } from "@/lib/runtime";
import { AgentMessage } from "./atoms";
import { FormulationStudio } from "./FormulationStudio";

/**
 * The one and only formulation surface — a fixed three-region layout (nav
 * sidebar ~1/8, studio form ~3/8, result ~4/8). It backs BOTH the home
 * (`/live`, a fresh draft) and an opened past session (`/live/:sessionId`), so
 * the user always sees the same three panes; clicking a session in the sidebar
 * loads its card into the right pane instead of swapping to a full-width chat.
 *
 * The form stays put; "Generate" runs the pipeline through the agent WITHOUT
 * unmounting, and the right pane shows only the finished formulation card —
 * every intermediate tool call / helper file is hidden (just "Working…" then
 * the card).
 */

// Only the FINISHED card is shown — narration ("…synthesize a formulation
// card…") must not match, so require the real structure: a "# Formulation
// Card" heading, or an ingredient table with a Weight-% column.
function isCard(markdown: string): boolean {
  return (
    /^#{1,3}\s*Formulation Card/im.test(markdown) ||
    (/\|\s*(#|Ingredient)/i.test(markdown) && /weight\s*%/i.test(markdown))
  );
}

export function FormulationWorkspace() {
  const { t } = useTranslation(["session", "common"]);
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { status, startDraft, openSession, sendPrompt, interrupt, threads, currentId, runningSessions, sending } =
    useRuntimeStore();
  const connected = status === "ready";

  // Follow the URL: open the session it names, or make sure a blank draft exists
  // for the home route. openSession sets currentId to the opened session.
  useEffect(() => {
    if (!connected) return;
    if (sessionId) void openSession(sessionId);
    else if (!useRuntimeStore.getState().currentId) startDraft();
  }, [connected, sessionId, openSession, startDraft]);

  const activeId = currentId ?? DRAFT_KEY;
  const thread = threads[activeId];
  const blocks: ThreadBlock[] = thread?.blocks ?? [];
  const running = !!(currentId && runningSessions[currentId]);

  // Opening a PAST session (URL has an id) must show its saved card, never
  // resume generating — if the sidecar re-runs an unfinished turn on reconnect,
  // stop it so the stored answer stays put.
  useEffect(() => {
    if (sessionId && running) void interrupt();
  }, [sessionId, running, interrupt]);
  const working = sending || running;
  const hasRun = blocks.some((b) => b.kind === "user");
  // Opening a session fetches its history — show a spinner until it lands.
  const loadingHistory = !!sessionId && !!connected && !thread?.loaded;

  const card = [...blocks]
    .reverse()
    .find((b): b is Extract<ThreadBlock, { kind: "agent" }> => b.kind === "agent" && isCard(b.markdown));
  const cardFile = [...blocks]
    .reverse()
    .find(
      (b): b is Extract<ThreadBlock, { kind: "artifact" }> =>
        b.kind === "artifact" && b.filename.toLowerCase() === "formulation-card.md",
    );
  const fallback =
    !card && hasRun && !working
      ? [...blocks].reverse().find((b): b is Extract<ThreadBlock, { kind: "agent" }> => b.kind === "agent")
      : undefined;

  // Generate always lands on a fresh session once the current one has a run, so
  // a new product never appends to an old card.
  const onGenerate = (prompt: string) => {
    const st = useRuntimeStore.getState();
    const cur = st.currentId ? st.threads[st.currentId] : st.threads[DRAFT_KEY];
    if ((cur?.blocks ?? []).some((b) => b.kind === "user")) {
      st.startDraft();
      if (sessionId) navigate("/live");
    }
    void sendPrompt(prompt);
  };

  const onNew = () => {
    startDraft();
    if (sessionId) navigate("/live");
  };

  return (
    <div className="flex h-full min-w-0">
      {/* Studio form — ~3/7 of the content area (≈ 3/8 of the screen). */}
      <div className="flex-[3] min-w-[300px] overflow-hidden border-r border-border">
        <FormulationStudio onPick={onGenerate} />
      </div>

      {/* Result — ~4/7 of the content area (≈ 4/8 of the screen). */}
      <div className="flex flex-[4] min-w-0 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
          <div className="text-xs font-medium uppercase tracking-wider text-muted">
            {t("studio.result.heading")}
          </div>
          {hasRun && (
            <button
              onClick={onNew}
              className="flex items-center gap-1 rounded-input px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text"
            >
              <Plus size={13} /> {t("studio.result.new")}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {!connected ? (
            <Placeholder icon={<TriangleAlert size={18} />}>{t("studio.result.connect")}</Placeholder>
          ) : card ? (
            <>
              <AgentMessage markdown={card.markdown} />
              {cardFile && (
                <div className="mt-4 inline-flex items-center gap-1.5 rounded-input border border-border bg-surface px-2.5 py-1 text-xs text-muted">
                  <FileText size={13} /> {cardFile.filename}
                </div>
              )}
            </>
          ) : working || loadingHistory ? (
            <div className="flex items-start gap-3 rounded-card border border-border bg-surface p-5">
              <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin text-accent" />
              <div className="text-sm text-text">{t("studio.result.working")}</div>
            </div>
          ) : fallback ? (
            <AgentMessage markdown={fallback.markdown} />
          ) : (
            <Placeholder icon={<FileText size={18} />}>{t("studio.result.empty")}</Placeholder>
          )}
        </div>
      </div>
    </div>
  );
}

function Placeholder({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-[20vh] max-w-[340px] text-center text-sm text-muted">
      <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-muted ring-1 ring-border">
        {icon}
      </div>
      {children}
    </div>
  );
}
