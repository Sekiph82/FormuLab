import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/cn";

/** GitHub-slug-compatible heading anchor. Mirrors
 *  `lib/userGuideExport/markdown.ts`'s `slugifyHeading` (the guide export
 *  pipeline's own heading-id logic) so a `docs/USER_GUIDE.md` cross-reference
 *  like `[§18](#18-corrective-actions)` resolves to a real in-DOM anchor
 *  here too, not just in GitHub's own rendering. Kept as a small local
 *  copy rather than an import: this component has no dependency today on
 *  `apps/desktop/src/lib/userGuideExport/` (a Node-fs-using, doc-generation
 *  module) and must not gain one just for a slug function used by every
 *  document this viewer renders, not only the user guide. */
function slugifyHeadingText(node: React.ReactNode): string {
  return extractText(node)
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

/** A Markdown image that hasn't been captured yet (every
 *  `docs/USER_GUIDE.md` screenshot reference, as of Phase 10 Session 6 —
 *  see `docs/PHASE10_SCREENSHOT_MANIFEST.json`) must not render as a
 *  broken-image icon. Same "not yet captured" wording as the PDF/DOCX
 *  exporters' own placeholder (`lib/userGuideExport/{pdf,docx}.ts`) — one
 *  honest message across all three render paths. `title` (the optional
 *  Markdown image title, `![alt](src "title")`) is preferred as the
 *  caption when present, since the guide uses it for real captions. */
function MarkdownImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  const { t } = useTranslation("session");
  const [failed, setFailed] = useState(false);
  const caption = title || alt || t("guide.screenshotFallbackCaption");
  if (!src || failed) {
    return (
      <span className="my-3 block rounded-input border border-dashed border-border bg-surface-2 px-3 py-2.5 text-[12px] italic text-muted">
        {t("guide.screenshotNotCaptured", { caption })}
      </span>
    );
  }
  return (
    <span className="my-3 block">
      <img src={src} alt={alt ?? ""} title={title} onError={() => setFailed(true)} className="max-w-full rounded-input border border-border" />
      {title && <span className="mt-1 block text-[12px] italic text-muted">{title}</span>}
    </span>
  );
}

/** Two contexts render markdown: chat bubbles (theme colors, compact) and the
 *  file-preview "paper" (document-neutral black-on-white, editorial scale —
 *  like the Office previews, a document keeps its own colors in dark mode). */
type Variant = "chat" | "document";

const STYLES: Record<Variant, Record<string, string>> = {
  chat: {
    root: "text-[15px] leading-relaxed text-text",
    p: "my-2 first:mt-0 last:mb-0",
    a: "text-link underline underline-offset-2",
    code: "rounded bg-surface-2 px-1 py-0.5 font-mono text-[13px] text-link",
    pre: "my-3 overflow-x-auto rounded-input bg-surface-2 p-3 font-mono text-[13px] leading-5 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-text",
    ul: "my-2 ml-5 list-disc space-y-1",
    ol: "my-2 ml-5 list-decimal space-y-1",
    h1: "mb-3 mt-5 text-2xl font-semibold first:mt-0",
    h2: "mb-2 mt-5 text-xl font-semibold first:mt-0",
    h3: "mb-2 mt-4 text-lg font-semibold first:mt-0",
    h4: "mb-1.5 mt-3 text-base font-semibold first:mt-0",
    blockquote: "my-2 border-l-2 border-border pl-3 text-muted",
    hr: "my-4 border-border",
    table: "border-collapse text-sm",
    th: "border border-border bg-surface-2 px-3 py-1.5 text-left font-semibold",
    td: "border border-border px-3 py-1.5",
  },
  // Editorial-blog paper: warm ink on white, serif headings, terracotta accent
  // (#c15f3c — the app's brand). Theme-independent by design: a document reads
  // the same in light or dark mode, so colors are fixed, not tokens.
  //
  // Two font stacks, both explicit so the paper never inherits the app's UI
  // font. Body: a comfortable reading sans (SF/Segoe + PingFang for Chinese).
  // Headings: the finest reading serifs that actually ship on macOS/Windows
  // (Iowan/Charter → Georgia), CJK falling back to Songti.
  document: {
    root: "text-[16px] leading-[1.8] text-[#2b2620] antialiased [font-feature-settings:'liga','kern'] [font-family:-apple-system,'SF_Pro_Text','Segoe_UI','PingFang_SC','Microsoft_YaHei',sans-serif] selection:bg-[#f2d9cd]",
    p: "my-4 tracking-[0.006em] [text-wrap:pretty] first:mt-0 last:mb-0",
    a: "font-medium text-[#bf5a34] underline decoration-[#e2bdac] decoration-1 underline-offset-[3px] transition-colors hover:decoration-[#bf5a34]",
    code: "rounded-[4px] bg-[#f7f0ea] px-1.5 py-0.5 font-mono text-[13px] text-[#a94e2c] ring-1 ring-[#eee0d6]",
    pre: "my-5 overflow-x-auto rounded-lg bg-[#faf6f2] p-4 font-mono text-[13px] leading-6 ring-1 ring-[#ece2d9] [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[#4b433a] [&_code]:ring-0",
    ul: "my-4 ml-[1.15em] list-disc space-y-2 marker:text-[#c98a6b]",
    ol: "my-4 ml-[1.15em] list-decimal space-y-2 marker:text-[13px] marker:font-medium marker:text-[#c98a6b]",
    // Serif display headings give the editorial/blog feel; the stack falls back
    // to system CJK serif so Chinese posts read as editorial too. Tracking stays
    // near-zero — negative tracking crams CJK glyphs.
    h1: "mb-3 mt-10 text-[33px] font-bold leading-[1.25] tracking-[-0.01em] text-[#1c1915] [text-wrap:balance] first:mt-0 [font-family:'Iowan_Old_Style','Charter',Georgia,'Songti_SC','Noto_Serif_CJK_SC',serif]",
    h2: "mb-4 mt-11 flex items-baseline gap-2.5 text-[23px] font-semibold leading-snug tracking-[-0.005em] text-[#1c1915] [text-wrap:balance] before:relative before:top-[0.14em] before:h-[0.82em] before:w-[3px] before:shrink-0 before:rounded-full before:bg-[#c15f3c] before:content-[''] first:mt-0 [font-family:'Iowan_Old_Style','Charter',Georgia,'Songti_SC','Noto_Serif_CJK_SC',serif]",
    h3: "mb-2 mt-8 text-[18.5px] font-semibold leading-snug text-[#2b2620] first:mt-0 [font-family:'Iowan_Old_Style','Charter',Georgia,'Songti_SC','Noto_Serif_CJK_SC',serif]",
    h4: "mb-2 mt-6 text-[12.5px] font-semibold uppercase tracking-[0.08em] text-[#9a8d7c] first:mt-0",
    blockquote: "my-5 rounded-r-md border-l-[3px] border-[#d98c6a] bg-[#faf6f2] py-1.5 pl-5 pr-4 text-[#6b6155] [&_p]:my-1.5",
    hr: "mx-auto my-10 w-12 border-t-2 border-[#e6ddd2]",
    table: "border-collapse text-[14px] tabular-nums",
    th: "border-b-2 border-[#e2d5c8] px-4 py-2.5 text-left font-semibold text-[#1c1915]",
    td: "border-b border-[#efe8df] px-4 py-2.5",
  },
};

export function MarkdownViewer({
  children,
  className,
  variant = "chat",
}: {
  children: string;
  className?: string;
  variant?: Variant;
}) {
  const s = STYLES[variant];
  return (
    <div className={cn(s.root, className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className={s.p}>{children}</p>,
          a: ({ children, href }) => (
            <a href={href} className={s.a}>
              {children}
            </a>
          ),
          code: ({ children }) => <code className={s.code}>{children}</code>,
          // Block code: the plain wrapper — its inner <code> is restyled via [&_code].
          pre: ({ children }) => <pre className={s.pre}>{children}</pre>,
          ul: ({ children }) => <ul className={s.ul}>{children}</ul>,
          ol: ({ children }) => <ol className={s.ol}>{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          // Document elements (headings, quotes, tables, rules) — Tailwind's
          // preflight strips the browser defaults, so each needs explicit style.
          h1: ({ children }) => <h1 id={slugifyHeadingText(children)} className={s.h1}>{children}</h1>,
          h2: ({ children }) => <h2 id={slugifyHeadingText(children)} className={s.h2}>{children}</h2>,
          h3: ({ children }) => <h3 id={slugifyHeadingText(children)} className={s.h3}>{children}</h3>,
          h4: ({ children }) => <h4 id={slugifyHeadingText(children)} className={s.h4}>{children}</h4>,
          blockquote: ({ children }) => <blockquote className={s.blockquote}>{children}</blockquote>,
          hr: () => <hr className={s.hr} />,
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto">
              <table className={s.table}>{children}</table>
            </div>
          ),
          th: ({ children }) => <th className={s.th}>{children}</th>,
          td: ({ children }) => <td className={s.td}>{children}</td>,
          img: ({ src, alt, title }) => <MarkdownImage src={typeof src === "string" ? src : undefined} alt={alt} title={title} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
