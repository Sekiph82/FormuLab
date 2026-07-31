import { create } from "zustand";

/**
 * Ephemeral UI state for the guided-tour overlay — a dedicated small store,
 * same convention as `useHelpStore`/`useUiStore` (each a separate `create()`
 * instance). Nothing here is persisted: which tour is active and which step
 * it's on reset on reload, matching every other transient UI-overlay state
 * in this app. (Compare `formulab.onboarding.dismissed.v1` in
 * `onboardingStore.ts`, which *is* persisted — a one-time "seen" flag, not
 * mid-tour progress.)
 */
interface TourUiState {
  activeTourId: string | null;
  stepIndex: number;
  /** The element focused right before the tour started — captured
   *  synchronously at the trigger site (`startTour`'s own call site: a
   *  button's onClick, never a post-render effect), same discipline as
   *  `useHelpStore.openCenter` and for the same reason: capturing it in an
   *  effect risks recording focus the overlay itself already moved. */
  openerElement: Element | null;
  startTour: (id: string) => void;
  goToStep: (index: number) => void;
  next: (totalSteps: number) => void;
  back: () => void;
  skip: () => void;
  finish: () => void;
}

export const useTourStore = create<TourUiState>((set, get) => ({
  activeTourId: null,
  stepIndex: 0,
  openerElement: null,
  startTour: (id) =>
    set({ activeTourId: id, stepIndex: 0, openerElement: typeof document !== "undefined" ? document.activeElement : null }),
  goToStep: (index) => set({ stepIndex: Math.max(0, index) }),
  next: (totalSteps) => {
    const nextIndex = get().stepIndex + 1;
    if (nextIndex >= totalSteps) {
      get().finish();
      return;
    }
    set({ stepIndex: nextIndex });
  },
  back: () => set({ stepIndex: Math.max(0, get().stepIndex - 1) }),
  // Skip and Finish are the same terminal action from the state machine's
  // point of view (close, restore focus) — kept as two store methods only
  // because callers (Skip button vs. the last step's Finish button) are
  // semantically distinct actions worth telling apart in a test/log, not
  // because the resulting state differs.
  skip: () => get().finish(),
  finish: () => {
    const opener = get().openerElement;
    set({ activeTourId: null, stepIndex: 0, openerElement: null });
    if (opener instanceof HTMLElement) opener.focus();
  },
}));
