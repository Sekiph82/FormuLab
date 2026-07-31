import { create } from "zustand";

/**
 * Ephemeral UI state for the page Help panel and the Help Center search —
 * a dedicated small store, same convention as `useUiStore`/`useUpdateStore`
 * (each a separate `create()` instance, not one app-wide store). Nothing
 * here is persisted: search text and the open/active state reset on
 * reload, matching "do not persist search text."
 */
export type HelpTarget = { kind: "topic"; id: string } | { kind: "glossary"; id: string };

interface HelpUiState {
  panelOpen: boolean;
  centerOpen: boolean;
  target: HelpTarget | null;
  /** The element that had focus right before the Help Center opened —
   *  captured synchronously at the trigger site (keydown handler, command
   *  palette action), never in a post-render effect: cmdk's `autoFocus`
   *  on its own input steals focus before any `useEffect` would run,
   *  so capturing it there would record the search input, not the real
   *  opener, and focus restoration on close would silently no-op. */
  centerOpenerElement: Element | null;
  openTopic: (id: string) => void;
  openGlossaryTerm: (id: string) => void;
  closePanel: () => void;
  openCenter: () => void;
  closeCenter: () => void;
  toggleCenter: () => void;
}

export const useHelpStore = create<HelpUiState>((set, get) => ({
  panelOpen: false,
  centerOpen: false,
  target: null,
  centerOpenerElement: null,
  openTopic: (id) => set({ target: { kind: "topic", id }, panelOpen: true, centerOpen: false }),
  openGlossaryTerm: (id) => set({ target: { kind: "glossary", id }, panelOpen: true, centerOpen: false }),
  closePanel: () => set({ panelOpen: false }),
  openCenter: () => set({ centerOpen: true, centerOpenerElement: document.activeElement }),
  closeCenter: () => set({ centerOpen: false }),
  toggleCenter: () => (get().centerOpen ? get().closeCenter() : get().openCenter()),
}));
