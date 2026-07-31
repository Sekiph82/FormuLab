import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { HelpCircle } from "lucide-react";
import { topicForRoute } from "@/lib/help/registry";
import { useHelpStore } from "@/lib/help/store";

/**
 * The single, global page-Help entry point — mounted once in `AppShell`
 * (same "mounted for every route" placement as `CommandPalette`/`Toaster`),
 * not per-page, so there is exactly one place resolving "what page is
 * this" via `topicForRoute()`. Renders nothing on a route with no help
 * coverage (an intentional `HELP_EXCLUSIONS` entry or a genuine gap) —
 * never a dead button pointing nowhere.
 */
export function HelpButton() {
  const { t } = useTranslation("help");
  const { pathname } = useLocation();
  const openTopic = useHelpStore((s) => s.openTopic);
  const topic = topicForRoute(pathname);

  if (!topic) return null;

  return (
    <button
      onClick={() => openTopic(topic.id)}
      aria-label={t("ui.buttonLabel")}
      title={t("ui.buttonTooltip")}
      className="fixed bottom-4 right-4 z-40 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-muted shadow-card hover:bg-surface-2 hover:text-text"
    >
      <HelpCircle size={16} />
    </button>
  );
}
