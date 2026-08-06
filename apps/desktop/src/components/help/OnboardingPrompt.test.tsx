/**
 * First-use onboarding coverage (Phase 10 Session 4): shows once, stays
 * dismissed, and can launch a real tour. `vi.resetModules()` + a dynamic
 * import per test gives each test its own fresh `useOnboardingStore`/
 * `useTourStore` module instance — the same pattern `onboardingStore.test.ts`
 * uses — since both stores read their initial value once at module load.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const DISMISSED_KEY = "formulab.onboarding.dismissed.v1";

beforeEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

async function renderFresh() {
  const { OnboardingPrompt } = await import("./OnboardingPrompt");
  return render(<OnboardingPrompt />);
}

describe("OnboardingPrompt — appears once, respects dismissal", () => {
  it("appears on first render when nothing has been dismissed yet", async () => {
    await renderFresh();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not render at all after a prior dismissal — a fresh load stays dismissed", async () => {
    window.localStorage.setItem(DISMISSED_KEY, "1");
    await renderFresh();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers a start-tour option for every real tour", async () => {
    await renderFresh();
    expect(screen.getByRole("button", { name: "Formulation tour" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Design of Experiments tour" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dossiers tour" })).toBeInTheDocument();
  });
});

describe("OnboardingPrompt — dismiss and launch", () => {
  it("picking a tour dismisses the prompt, persists the dismissal, and starts that tour", async () => {
    const user = userEvent.setup();
    await renderFresh();
    const { useTourStore } = await import("@/lib/help/tourStore");

    await user.click(screen.getByRole("button", { name: "Design of Experiments tour" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useTourStore.getState().activeTourId).toBe("doe");
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBe("1");
  });

  it("the close button dismisses without starting any tour", async () => {
    const user = userEvent.setup();
    await renderFresh();
    const { useTourStore } = await import("@/lib/help/tourStore");

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useTourStore.getState().activeTourId).toBeNull();
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBe("1");
  });

  it("Maybe later dismisses without starting any tour", async () => {
    const user = userEvent.setup();
    await renderFresh();
    await user.click(screen.getByRole("button", { name: "Maybe later" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBe("1");
  });
});
