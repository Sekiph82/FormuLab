import { saveBinaryFile, saveTextFile, type SaveResult } from "./tauri";
import { toast } from "./toast";

/** Save a Blob as a file via a browser download. No-op outside the browser. */
export function downloadBlob(filename: string, blob: Blob): void {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Save text as a file via a Blob download. No-op outside the browser. */
export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

/**
 * Save text with user feedback: native "Save As" dialog in the desktop app
 * (toast on success/failure, silent on cancel), Blob download in the browser.
 */
export async function saveTextWithFeedback(
  filename: string,
  text: string,
  mime = "text/plain",
): Promise<void> {
  try {
    const result = await saveTextFile(filename, text);
    if (result.kind === "saved") {
      toast.success(`Saved to ${result.path}`);
    } else if (result.kind === "not-desktop") {
      downloadText(filename, text, mime);
      toast.success(`Downloaded ${filename}`);
    }
    // "canceled": the user closed the dialog — no feedback needed.
  } catch (err) {
    toast.error(`Could not save ${filename}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Save bytes with user feedback: native "Save As" dialog in the desktop app
 * (toast on success/failure, silent on cancel), Blob download in the
 * browser. Mirrors `saveTextWithFeedback`'s user-facing behavior, for
 * binary payloads (e.g. a generated PDF/DOCX) — never a second, parallel
 * save mechanism. Unlike `saveTextWithFeedback`, this returns the
 * resolved `SaveResult` (so a caller can tell "saved"/"not-desktop" apart
 * from "canceled") and re-throws a write failure after showing the error
 * toast, so a caller that needs to record the outcome (e.g. export
 * history) can still catch it.
 */
export async function saveBinaryWithFeedback(filename: string, bytes: Uint8Array, mime: string): Promise<SaveResult> {
  try {
    const result = await saveBinaryFile(filename, bytes);
    if (result.kind === "saved") {
      toast.success(`Saved to ${result.path}`);
    } else if (result.kind === "not-desktop") {
      downloadBlob(filename, new Blob([new Uint8Array(bytes)], { type: mime }));
      toast.success(`Downloaded ${filename}`);
    }
    // "canceled": the user closed the dialog — no feedback needed.
    return result;
  } catch (err) {
    toast.error(`Could not save ${filename}: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}
