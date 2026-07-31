import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Command } from "cmdk";
import { BookOpen } from "lucide-react";
import { GLOSSARY_TERMS } from "@/lib/help/glossary";
import { HELP_TOPICS } from "@/lib/help/registry";
import { useHelpStore } from "@/lib/help/store";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Global, keyboard-reachable Help Center search — reuses `cmdk`, the same
 * dependency/pattern `CommandPalette.tsx` already uses (`Command`/
 * `Command.Input`/`Command.List`/`Command.Item`/`Command.Empty`), not a
 * second search framework. Mounted once in `AppShell`, next to
 * `CommandPalette`. Selecting a result opens the page Help panel — reading
 * help never requires navigating away from the current route.
 */
export function HelpCenter() {
  const { t: tRaw } = useTranslation("help");
  const t = tRaw as SimpleT;
  const centerOpen = useHelpStore((s) => s.centerOpen);
  const centerOpenerElement = useHelpStore((s) => s.centerOpenerElement);
  const closeCenter = useHelpStore((s) => s.closeCenter);
  const openTopic = useHelpStore((s) => s.openTopic);
  const openGlossaryTerm = useHelpStore((s) => s.openGlossaryTerm);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        useHelpStore.getState().toggleCenter();
      }
      if (e.key === "Escape" && useHelpStore.getState().centerOpen) {
        e.preventDefault();
        useHelpStore.getState().closeCenter();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!centerOpen && centerOpenerElement instanceof HTMLElement) {
      centerOpenerElement.focus();
    }
    // Runs on close only — `centerOpenerElement` is captured once at open
    // time (openCenter) and consumed here, not re-captured on close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerOpen]);

  if (!centerOpen) return null;

  const close = () => closeCenter();

  const selectTopic = (id: string) => {
    openTopic(id);
    close();
  };
  const selectGlossaryTerm = (id: string) => {
    openGlossaryTerm(id);
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[16vh]" onClick={close} role="presentation">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg">
        <Command label={t("ui.centerAriaLabel")} className="overflow-hidden rounded-card border border-border bg-surface shadow-pop">
          <Command.Input autoFocus placeholder={t("ui.searchPlaceholder")} className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-text outline-none placeholder:text-muted" />
          <Command.List className="max-h-96 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted">{t("ui.noResults")}</Command.Empty>
            <Command.Group heading={t("ui.topicsGroup")} className="text-[11px] text-muted [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
              {HELP_TOPICS.map((topic) => {
                const searchValue = [
                  t(topic.titleKey),
                  t(topic.summaryKey),
                  topic.module,
                  ...topic.keywords,
                  ...topic.quickStartStepKeys.map((k) => t(k)),
                ].join(" ");
                return (
                  <Command.Item
                    key={topic.id}
                    value={searchValue}
                    onSelect={() => selectTopic(topic.id)}
                    className="flex cursor-pointer flex-col gap-0.5 rounded-input px-3 py-2 text-sm text-text data-[selected=true]:bg-surface-2"
                  >
                    <span className="font-medium">{t(topic.titleKey)}</span>
                    <span className="text-[11px] text-muted">{t(topic.summaryKey)}</span>
                  </Command.Item>
                );
              })}
            </Command.Group>
            <Command.Group heading={t("ui.glossaryGroup")} className="text-[11px] text-muted [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
              {GLOSSARY_TERMS.map((term) => (
                <Command.Item
                  key={term.id}
                  value={[t(term.termKey), t(term.definitionKey)].join(" ")}
                  onSelect={() => selectGlossaryTerm(term.id)}
                  className="flex cursor-pointer items-center gap-2 rounded-input px-3 py-2 text-sm text-text data-[selected=true]:bg-surface-2"
                >
                  <BookOpen size={13} className="shrink-0 text-muted" />
                  {t(term.termKey)}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
