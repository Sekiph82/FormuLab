import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Dna,
  FileText,
  Film,
  FlaskConical,
  Folder,
  Image as ImageIcon,
  Highlighter,
  Loader2,
  NotebookPen,
  Sheet,
} from "lucide-react";
import { extOf, extToKind, previewKindForName, type PreviewKind } from "@/lib/artifacts";
import { listDir, type DirEntry, type FileRoot } from "@/lib/artifactFile";
import { isTauri } from "@/lib/tauri";
import { NotebookEditor } from "@/components/notebook/NotebookEditor";
import { FilePreviewInspector } from "@/components/inspector/FilePreviewInspector";
import { FileContextMenu } from "@/components/files/FileContextMenu";
import { cn } from "@/lib/cn";

const EXT_LANG: Record<string, string> = {
  py: "python", r: "r", jl: "julia", sh: "bash", tex: "latex", md: "markdown",
};

function iconFor(entry: DirEntry) {
  if (entry.isDir) return <Folder size={15} className="text-accent" />;
  const kind = previewKindForName(entry.name);
  const cls = "text-muted";
  if (entry.name.endsWith(".ipynb")) return <NotebookPen size={15} className={cls} />;
  if (kind === "image" || kind === "fits" || kind === "anomaly" || kind === "phase") return <ImageIcon size={15} className={cls} />;
  if (kind === "video") return <Film size={15} className={cls} />;
  if (kind === "table") return <Sheet size={15} className={cls} />;
  if (kind === "molecule" || kind === "dos" || kind === "bands") return <FlaskConical size={15} className={cls} />;
  if (kind === "genome") return <Dna size={15} className={cls} />;
  if (kind === "qcode") return <Highlighter size={15} className={cls} />;
  return <FileText size={15} className={cls} />;
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * File explorer for everything the app produces: `data/` (sessions and the
 * shared literature cache) and `formulas/` (the formula library). Directories
 * are navigable via a breadcrumb; files open in the same viewers used elsewhere
 * (figures, tables, PDF, notebooks), so past work is reachable in one place.
 */
/** The two folders a run produces — the whole of what the app writes. */
const ROOTS = [
  { id: "data" as const, label: "Data" },
  { id: "formulas" as const, label: "Formulas" },
];

export function FilesPage() {
  const { t } = useTranslation(["pages", "common"]);
  const [root, setRoot] = useState<FileRoot>("data");
  const [dir, setDir] = useState(""); // root-relative; "" = the root folder
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DirEntry | null>(null);

  const load = useCallback(async (rel: string, scope: FileRoot) => {
    setEntries(null);
    setError(null);
    try {
      setEntries(await listDir(rel, scope));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void load(dir, root);
  }, [dir, root, load]);

  // Switching folders starts at that folder's top level.
  const switchRoot = (next: FileRoot) => {
    setRoot(next);
    setDir("");
    setSelected(null);
  };

  const open = (entry: DirEntry) => {
    if (entry.isDir) {
      setSelected(null);
      setDir(entry.path);
    } else {
      setSelected(entry);
    }
  };

  const crumbs = dir ? dir.split("/") : [];

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <div className="flex gap-1 border-b border-border px-2 pt-2">
          {ROOTS.map((r) => (
            <button
              key={r.id}
              onClick={() => switchRoot(r.id)}
              className={cn(
                "rounded-t-input border-b-2 px-3 py-1.5 text-xs font-medium transition-colors",
                root === r.id
                  ? "border-accent text-text"
                  : "border-transparent text-muted hover:text-text",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-3 py-2.5 text-[13px]">
          <button
            className={cn("rounded px-1 hover:bg-surface-2", dir ? "text-link" : "font-medium text-text")}
            onClick={() => setDir("")}
          >
            {root}
          </button>
          {crumbs.map((part, i) => {
            const to = crumbs.slice(0, i + 1).join("/");
            const isLast = i === crumbs.length - 1;
            return (
              <span key={to} className="flex items-center gap-0.5">
                <ChevronRight size={13} className="text-muted" />
                <button
                  className={cn("rounded px-1 hover:bg-surface-2", isLast ? "font-medium text-text" : "text-link")}
                  onClick={() => setDir(to)}
                >
                  {part}
                </button>
              </span>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {entries === null && (
            <div className="flex items-center gap-2 p-2 text-sm text-muted">
              <Loader2 size={14} className="animate-spin" /> {t("files.loading")}
            </div>
          )}
          {error && <div className="p-2 text-sm text-error">{error}</div>}
          {entries && entries.length === 0 && !error && (
            <div className="p-2 text-sm text-muted">
              {isTauri ? t("files.folderEmpty") : t("files.explorerUnavailableWeb")}
            </div>
          )}
          {entries?.map((entry) => (
            <FileContextMenu key={entry.path} entry={entry} root={root}>
              <button
                onClick={() => open(entry)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-[13px] hover:bg-surface-2",
                  selected?.path === entry.path ? "bg-surface-2 text-text" : "text-text/90",
                )}
              >
                {iconFor(entry)}
                <span className="flex-1 truncate">{entry.name}</span>
                {!entry.isDir && <span className="shrink-0 text-[11px] text-muted">{humanSize(entry.size)}</span>}
                {entry.isDir && <ChevronRight size={14} className="shrink-0 text-muted" />}
              </button>
            </FileContextMenu>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {selected ? (
          <FilePreview key={selected.path} entry={selected} root={root} onClose={() => setSelected(null)} />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">
            {t("files.selectFilePrompt")}
          </div>
        )}
      </div>
    </div>
  );
}

function FilePreview({
  entry,
  root,
  onClose,
  controls,
}: {
  entry: DirEntry;
  root: FileRoot;
  onClose: () => void;
  controls?: React.ReactNode;
}) {
  const ext = extOf(entry.name);
  if (ext === "ipynb")
    return <NotebookEditor path={entry.path} root={root} onClose={onClose} controls={controls} />;
  const kind: PreviewKind = previewKindForName(entry.name);
  return (
    <FilePreviewInspector
      data={{
        variant: "file",
        path: entry.path,
        filename: entry.name,
        artifact: extToKind(ext),
        language: EXT_LANG[ext] ?? (kind === "text" ? ext : undefined),
        root,
      }}
      onClose={onClose}
      controls={controls}
    />
  );
}

/**
 * Compact browser for the CURRENT session's folder, shown in the right
 * inspector pane beside the conversation (the session-scoped quick entry —
 * the Files page itself is global). Clicking a file swaps the pane to its
 * preview; closing the preview returns to the list.
 */
