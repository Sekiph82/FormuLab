import { useTranslation } from "react-i18next";
import { MarkdownViewer } from "@/components/markdown-viewer/MarkdownViewer";
// Bundled at build time via Vite's `?raw` import — `docs/USER_GUIDE.md`
// stays the single source of truth (never duplicated into locale JSON or a
// second copy here); this page renders exactly that file's real content
// through the same `MarkdownViewer` the file-preview "paper" already uses.
// `docs/generated/FormuLab-User-Guide.{pdf,docx}` are the same source
// rendered by `lib/userGuideExport/` instead — one Markdown source, three
// outputs.
import guideMarkdown from "../../../../../docs/USER_GUIDE.md?raw";

/**
 * The in-app illustrated user guide (Phase 10 Session 6). English-only in
 * v1 — the same documented policy `docs/PHASE10_SCREENSHOT_MANIFEST.json`'s
 * `locale: "en"` entries and the guide's own "Known limitations" section
 * already state; labelled here rather than silently assumed.
 */
export function UserGuidePage() {
  const { t } = useTranslation("session");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="print-hide shrink-0 border-b border-border px-4 py-2">
        <h1 className="text-[13px] font-medium text-text">{t("guide.title")}</h1>
        <p className="text-[11px] text-muted">{t("guide.englishOnlyNotice")}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl">
          <MarkdownViewer variant="document">{guideMarkdown}</MarkdownViewer>
        </div>
      </div>
    </div>
  );
}
