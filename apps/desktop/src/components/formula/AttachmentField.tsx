/**
 * Safe attachment references, shared by every record type that can carry
 * evidence (spec §6): trial observations, trial deviations, process steps,
 * test results, stability results, stability failures, corrective actions.
 *
 * "Add" copies a user-picked file into the project via
 * `copyAttachmentIntoProject` (never a raw absolute path from the renderer —
 * see `src-tauri/src/attachments.rs`'s allow-list). "Remove" is only offered
 * while `disabled` is false; a caller passes `disabled` once the parent
 * record is finalized (a completed trial, a recorded test result revision),
 * so a completed record's evidence cannot be silently edited — removing or
 * replacing evidence after that point needs a new revision, not an edit here.
 */
import { useState } from "react";
import { File, FileSpreadsheet, FileText, Image as ImageIcon, Paperclip, Trash2 } from "lucide-react";
import type { AttachmentReference } from "@ai4s/shared";
import { newId } from "@ai4s/shared";
import { copyAttachmentIntoProject, openAttachment } from "@/lib/formulations";
import { pickFile } from "@/lib/tauri";

type SimpleT = (key: string, opts?: Record<string, unknown>) => string;

const ALL_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "tif", "tiff",
  "pdf",
  "xlsx", "xls", "csv", "tsv", "ods",
  "doc", "docx", "txt", "md", "rtf", "odt",
];

function CategoryIcon({ category }: { category?: string }) {
  if (category === "image") return <ImageIcon size={12} />;
  if (category === "pdf") return <FileText size={12} />;
  if (category === "spreadsheet") return <FileSpreadsheet size={12} />;
  if (category === "text_document") return <FileText size={12} />;
  return <File size={12} />;
}

export function AttachmentField({
  formulationId,
  attachments,
  onChange,
  disabled,
  t,
}: {
  formulationId: string;
  attachments: AttachmentReference[] | undefined;
  onChange: (next: AttachmentReference[]) => void;
  disabled?: boolean;
  t: SimpleT;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = attachments ?? [];

  const add = async () => {
    setError(null);
    const path = await pickFile(ALL_EXTENSIONS);
    if (!path) return;
    setBusy(true);
    try {
      const copied = await copyAttachmentIntoProject(formulationId, path);
      const ref: AttachmentReference = {
        id: newId("attachment"),
        kind: "document",
        title: copied.originalFileName,
        location: copied.location,
        capturedAt: new Date().toISOString(),
        fileCategory: copied.fileCategory,
        originalFileName: copied.originalFileName,
        mimeType: copied.mimeType,
        sizeBytes: copied.sizeBytes,
        checksumSha256: copied.checksumSha256,
        addedAt: new Date().toISOString(),
      };
      onChange([...list, ref]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string) => onChange(list.filter((a) => a.id !== id));
  const open = (location: string) => void openAttachment(formulationId, location).catch((e) => setError(String(e)));

  return (
    <div className="mt-1.5">
      {list.length > 0 && (
        <ul className="mb-1.5 space-y-1">
          {list.map((a) => (
            <li key={a.id} className="flex items-center gap-1.5 rounded-input border border-border-faint px-1.5 py-1 text-[10px] text-muted">
              <CategoryIcon category={a.fileCategory} />
              <button onClick={() => open(a.location)} className="min-w-0 flex-1 truncate text-left text-text hover:underline">
                {a.originalFileName ?? a.title}
              </button>
              {a.sizeBytes !== undefined && <span>{Math.max(1, Math.round(a.sizeBytes / 1024))} KB</span>}
              {!disabled && (
                <button onClick={() => remove(a.id)} className="text-muted hover:text-error" aria-label={t("attachments.remove")}>
                  <Trash2 size={11} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <button
          onClick={() => void add()}
          disabled={busy}
          className="flex items-center gap-1 rounded-input border border-border px-1.5 py-0.5 text-[10px] text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40"
        >
          <Paperclip size={10} /> {t("attachments.add")}
        </button>
      )}
      {error && <p className="mt-1 text-[10px] text-error">{error}</p>}
    </div>
  );
}
