/**
 * Phase 12 — window-close fix.
 *
 * A tiny cross-page registry of "this page has an unsaved draft right now."
 * `useFormulationWorkspace` (and the legacy standalone copy in
 * `FormulasPage.tsx`) register/unregister an entry keyed by formulation id
 * whenever their own `dirty` flag flips. This lets the single native
 * close-request handler in `automaticBackup.ts` ask one question — "is
 * there unsaved work anywhere right now" — without importing page-level
 * hooks, and without the two previous per-page `beforeunload` listeners
 * (removed: `beforeunload` is a browser/reload event, not Tauri's native
 * window-close event, and never reliably surfaces a dialog inside the
 * desktop webview — it could silently swallow the close request with no
 * visible UI at all).
 */
import { create } from "zustand";
import { logDebug } from "./tauri";

interface UnsavedWorkEntry {
  /** Persists this entry's draft immediately (bypassing the normal
   *  autosave debounce). The resolved value is ignored — only whether it
   *  rejects matters. */
  save: () => Promise<unknown>;
}

export type UnsavedCloseChoice = "save" | "discard" | "cancel";

interface PendingCloseRequest {
  count: number;
  resolve: (choice: UnsavedCloseChoice) => void;
}

interface UnsavedWorkStoreState {
  entries: Map<string, UnsavedWorkEntry>;
  pendingClose: PendingCloseRequest | null;
}

const useUnsavedWorkStore = create<UnsavedWorkStoreState>(() => ({
  entries: new Map(),
  pendingClose: null,
}));

export function registerUnsavedWork(id: string, entry: UnsavedWorkEntry): void {
  useUnsavedWorkStore.setState((s) => {
    const entries = new Map(s.entries);
    entries.set(id, entry);
    return { entries };
  });
}

export function unregisterUnsavedWork(id: string): void {
  useUnsavedWorkStore.setState((s) => {
    if (!s.entries.has(id)) return s;
    const entries = new Map(s.entries);
    entries.delete(id);
    return { entries };
  });
}

export function hasUnsavedWork(): boolean {
  return useUnsavedWorkStore.getState().entries.size > 0;
}

/** Best-effort: a single entry's save failing must not stop the others
 *  from saving, and must never throw back into the close flow — logged
 *  here (not silently dropped) so a real failure is still discoverable. */
export async function saveAllUnsavedWork(): Promise<void> {
  const entries = Array.from(useUnsavedWorkStore.getState().entries.entries());
  await Promise.all(
    entries.map(([id, entry]) =>
      entry.save().catch((e) => {
        void logDebug(`window close: saving unsaved work (${id}) failed: ${e instanceof Error ? e.message : String(e)}`);
      }),
    ),
  );
}

export function usePendingUnsavedClose(): PendingCloseRequest | null {
  return useUnsavedWorkStore((s) => s.pendingClose);
}

/** Shows the Save/Discard/Cancel prompt and resolves with the user's
 *  choice. Only one prompt can be pending at a time — matches there only
 *  ever being one native close request in flight. */
export function requestUnsavedCloseDecision(): Promise<UnsavedCloseChoice> {
  return new Promise((resolve) => {
    useUnsavedWorkStore.setState((s) => ({
      pendingClose: { count: s.entries.size, resolve },
    }));
  });
}

export function resolvePendingUnsavedClose(choice: UnsavedCloseChoice): void {
  const pending = useUnsavedWorkStore.getState().pendingClose;
  if (!pending) return;
  useUnsavedWorkStore.setState({ pendingClose: null });
  pending.resolve(choice);
}
