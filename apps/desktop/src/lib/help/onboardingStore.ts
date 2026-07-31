import { create } from "zustand";

/** New key only — this is genuinely new state with nothing to migrate from
 *  (no prior onboarding prompt ever existed), unlike `lib/store.ts`'s
 *  `formulab.*` keys that migrate a real pre-rename value. Same
 *  `formulab.<feature>.<name>` naming convention. */
const ONBOARDING_DISMISSED_KEY = "formulab.onboarding.dismissed.v1";

function initialDismissed(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "1";
}

/**
 * Whether the first-use onboarding prompt has been dismissed — "dismissed"
 * covers both explicitly closing it and picking a tour from it, since both
 * mean "the user has seen it," matching "appears only once per profile."
 * There is no login/session-identity system in this app (see
 * `TestMethodDrawer`'s own acting-role note in PHASE10_CURRENT.md), so
 * "per profile" here means per local machine profile — the same scope
 * every other `formulab.*` preference already uses.
 */
interface OnboardingUiState {
  dismissed: boolean;
  dismiss: () => void;
}

export const useOnboardingStore = create<OnboardingUiState>((set) => ({
  dismissed: initialDismissed(),
  dismiss: () => {
    if (typeof window !== "undefined") window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
    set({ dismissed: true });
  },
}));
