import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Loader2, Plus, TriangleAlert } from "lucide-react";
import type { ThreadBlock } from "@ai4s/shared";
import { DRAFT_KEY, useRuntimeStore } from "@/lib/runtime";
import { AgentMessage } from "./atoms";
import { FormulationStudio } from "./FormulationStudio";

/**
 * The formulation home: a fixed three-region layout (nav sidebar ~1/8, studio
 * form ~3/8, result ~4/8). The form stays put; "Generate" sends the brief to
 * the agent WITHOUT navigating, and the right pane shows only the finished
 * formulation card — every intermediate tool call / helper file is hidden, so
 * the user sees "Working…" and then the card, nothing else.
 */

// Only the agent's formulation card is shown — narration and tool chatter are
// filtered out by matching the card's shape (its title or its table).
function isCard(markdown: string): boolean {
  return /formulation card/i.test(markdown) || (markdown.includes("|") && /weight\s*%/i.test(markdown));
}

export function FormulationWorkspace() {
  const { t } = useTranslation(["session", "common"]);
  const { status, startDraft, sendPrompt, threads, currentId, runningSessions, sending } =
    useRuntimeStore();
  const connected = status === "ready";

  // Ensure a blank draft exists so the first Generate has somewhere to land.
  useEffect(() => {
    if (connected && !useRuntimeStore.getState().currentId) startDraft();
  }, [connected, startDraft]);

  const thread = currentId ? threads[currentId] : threads[DRAFT_KEY];
  const blocks: ThreadBlock[] = thread?.blocks ?? [];
  const running = !!(currentId && runningSessions[currentId]);
  const working = sending || running;
  const hasRun = blocks.some((b) => b.kind === "user");

  const card = [...blocks]
    .reverse()
    .find((b): b is Extract<ThreadBlock, { kind: "agent" }> => b.kind === "agent" && isCard(b.markdown));
  const cardFile = [...blocks]
    .reverse()
    .find(
      (b): b is Extract<ThreadBlock, { kind: "artifact" }> =>
        b.kind === "artifact" && b.filename.toLowerCase() === "formulation-card.md",
    );
  // Finished the turn but produced no recognizable card — show the agent's last
  // words rather than a blank pane.
  const fallback =
    !card && hasRun && !working
      ? [...blocks].reverse().find((b): b is Extract<ThreadBlock, { kind: "agent" }> => b.kind === "agent")
      : undefined;

  return (
    <div className="flex h-full min-w-0">
      {/* Studio form — ~3/7 of the content area (≈ 3/8 of the screen). */}
      <div className="flex-[3] min-w-[300px] overflow-hidden border-r border-border">
        <FormulationStudio onPick={(p) => void sendPrompt(p)} />
      </div>

      {/* Result — ~4/7 of the content area (≈ 4/8 of the screen). */}
      <div className="flex flex-[4] min-w-0 flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
          <div className="text-xs font-medium uppercase tracking-wider text-muted">
            {t("studio.result.heading")}
          </div>
          {hasRun && (
            <button
              onClick={() => startDraft()}
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
          ) : working ? (
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
