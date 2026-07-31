import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { X, ArrowLeft } from "lucide-react";
import { GLOSSARY_TERMS } from "@/lib/help/glossary";
import { getTopic, relatedTopics, HELP_TOPICS } from "@/lib/help/registry";
import { useHelpStore } from "@/lib/help/store";
import type { HelpTopic } from "@/lib/help/types";

/** Help content keys (`topic.titleKey`, `sectionKeys[i]`, ...) are dynamic
 *  string paths into help.json, not statically known literals — same
 *  reason `TestDefinitionsPanel.tsx`/`TestMethodDrawer.tsx` cast their `t`
 *  to this shape rather than fighting i18next's literal-key typing. */
type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Route-aware page help — a side drawer, same overlay/Escape/focus-restore
 * conventions as `TestMethodDrawer.tsx`/`ConfirmDialog.tsx`. Reads only
 * `useHelpStore`'s `target`; never mutates project data. Handles both a
 * topic view and a glossary-term view in one panel/state model rather than
 * a second panel, per the "one coordinated shell" requirement.
 */
export function HelpPanel() {
  const { t: tRaw } = useTranslation("help");
  const t = tRaw as SimpleT;
  const navigate = useNavigate();
  const panelOpen = useHelpStore((s) => s.panelOpen);
  const target = useHelpStore((s) => s.target);
  const closePanel = useHelpStore((s) => s.closePanel);
  const openTopic = useHelpStore((s) => s.openTopic);
  const openGlossaryTerm = useHelpStore((s) => s.openGlossaryTerm);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerFocusRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!panelOpen) return;
    openerFocusRef.current = document.activeElement;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (openerFocusRef.current instanceof HTMLElement) openerFocusRef.current.focus();
    };
  }, [panelOpen, closePanel]);

  if (!panelOpen || !target) return null;

  const topic = target.kind === "topic" ? getTopic(target.id) : undefined;
  const glossaryTerm = target.kind === "glossary" ? GLOSSARY_TERMS.find((g) => g.id === target.id) : undefined;

  // A dangling id (a stale reference, or a topic/term removed since the
  // panel opened) closes safely rather than rendering a broken shell.
  if ((target.kind === "topic" && !topic) || (target.kind === "glossary" && !glossaryTerm)) {
    return null;
  }

  const label = topic ? t(topic.titleKey) : glossaryTerm ? t(glossaryTerm.termKey) : t("ui.panelTitle");

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" role="presentation" onClick={closePanel}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="flex h-full w-full max-w-[420px] flex-col border-l border-border bg-surface shadow-card outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border-faint px-4 py-3">
          <div className="flex items-center gap-1.5">
            {target.kind === "glossary" && (
              <button aria-label={t("ui.back")} onClick={() => topic && openTopic(topic.id)} className="rounded-input p-1 text-muted hover:bg-surface-2 hover:text-text">
                <ArrowLeft size={14} />
              </button>
            )}
            <h2 className="text-[13px] font-medium text-text">{label}</h2>
          </div>
          <button aria-label={t("ui.close")} onClick={closePanel} className="rounded-input p-1 text-muted hover:bg-surface-2 hover:text-text">
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3 text-[12px] text-text">
          {topic && <TopicContent topic={topic} t={t} onOpenGlossaryTerm={openGlossaryTerm} onOpenTopic={openTopic} onOpenPage={(route) => { navigate(route); closePanel(); }} />}
          {glossaryTerm && (
            <div className="space-y-3">
              <p className="text-muted">{t(glossaryTerm.definitionKey)}</p>
              <RelatedTopicsForGlossaryTerm termId={glossaryTerm.id} t={t} onOpenTopic={openTopic} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{title}</h3>
      <div>{children}</div>
    </div>
  );
}

function TopicContent({
  topic,
  t,
  onOpenGlossaryTerm,
  onOpenTopic,
  onOpenPage,
}: {
  topic: HelpTopic;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onOpenGlossaryTerm: (id: string) => void;
  onOpenTopic: (id: string) => void;
  onOpenPage: (route: string) => void;
}) {
  const related = relatedTopics(topic);
  const primaryRoute = topic.routes[0]?.path;
  return (
    <>
      <p className="mb-3 text-muted">{t(topic.summaryKey)}</p>
      <Section title={t("ui.purpose")}>
        <p>{t(topic.purposeKey)}</p>
      </Section>
      {topic.prerequisiteKeys.length > 0 && (
        <Section title={t("ui.prerequisites")}>
          <ul className="list-disc pl-4">
            {topic.prerequisiteKeys.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
        </Section>
      )}
      {topic.quickStartStepKeys.length > 0 && (
        <Section title={t("ui.quickStart")}>
          <ol className="list-decimal pl-4">
            {topic.quickStartStepKeys.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ol>
        </Section>
      )}
      {topic.sectionKeys.length > 0 && (
        <Section title={t("ui.sections")}>
          <ul className="list-disc pl-4">
            {topic.sectionKeys.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
        </Section>
      )}
      {topic.warningKeys.length > 0 && (
        <Section title={t("ui.warnings")}>
          <ul className="list-disc pl-4 text-warning">
            {topic.warningKeys.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
        </Section>
      )}
      {topic.roleNoteKeys.length > 0 && (
        <Section title={t("ui.roleNotes")}>
          <ul className="list-disc pl-4">
            {topic.roleNoteKeys.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
        </Section>
      )}
      {topic.knownLimitationKeys.length > 0 && (
        <Section title={t("ui.limitations")}>
          <ul className="list-disc pl-4">
            {topic.knownLimitationKeys.map((k) => (
              <li key={k}>{t(k)}</li>
            ))}
          </ul>
        </Section>
      )}
      {topic.glossaryTermIds.length > 0 && (
        <Section title={t("ui.glossaryHeading")}>
          <div className="flex flex-wrap gap-1.5">
            {topic.glossaryTermIds.map((id) => (
              <button key={id} onClick={() => onOpenGlossaryTerm(id)} className="rounded-input border border-border px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent/10">
                {t(`glossary.${id}.term`)}
              </button>
            ))}
          </div>
        </Section>
      )}
      {related.length > 0 && (
        <Section title={t("ui.relatedTopics")}>
          <div className="flex flex-wrap gap-1.5">
            {related.map((r) => (
              <button key={r.id} onClick={() => onOpenTopic(r.id)} className="rounded-input border border-border px-1.5 py-0.5 text-[11px] text-text hover:bg-surface-2">
                {t(r.titleKey)}
              </button>
            ))}
          </div>
        </Section>
      )}
      {primaryRoute && !primaryRoute.includes(":") && (
        <button onClick={() => onOpenPage(primaryRoute)} className="mt-1 rounded-input border border-accent px-2 py-1 text-[11px] text-accent hover:bg-accent/10">
          {t("ui.openPage")}
        </button>
      )}
    </>
  );
}

function RelatedTopicsForGlossaryTerm({ termId, t, onOpenTopic }: { termId: string; t: (key: string) => string; onOpenTopic: (id: string) => void }) {
  const topics = HELP_TOPICS.filter((topic) => topic.glossaryTermIds.includes(termId));
  if (topics.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{t("ui.relatedTopics")}</h3>
      <div className="flex flex-wrap gap-1.5">
        {topics.map((topic) => (
          <button key={topic.id} onClick={() => onOpenTopic(topic.id)} className="rounded-input border border-border px-1.5 py-0.5 text-[11px] text-text hover:bg-surface-2">
            {t(topic.titleKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
