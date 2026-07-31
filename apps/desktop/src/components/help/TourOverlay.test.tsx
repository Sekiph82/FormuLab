/**
 * Behavior coverage for the guided-tour overlay (Phase 10 Session 4):
 * step navigation, Escape/focus-restore, missing-target handling, and that
 * it never touches project data. `TourOverlay` reads the DOM for its
 * targets rather than owning any page content itself, so most tests render
 * plain `data-tour`-tagged fixture elements alongside it — the real pages
 * carry the real attributes (see `DoePanel.test.tsx` /
 * `DossierPanel.test.tsx` / `FormulationWorkspaceV2.test.tsx` for
 * "does every tour target actually resolve on the real page" coverage).
 */
import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TourOverlay } from "./TourOverlay";
import { useTourStore } from "@/lib/help/tourStore";

vi.mock("@/lib/masterdata", () => ({
  listRecords: vi.fn(),
  listRecordsSeeded: vi.fn(),
  upsertRecords: vi.fn(),
}));

function resetStore() {
  useTourStore.setState({ activeTourId: null, stepIndex: 0, openerElement: null });
}

beforeEach(() => {
  resetStore();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

/** Every doe-tour target, pre-mounted — used by tests that exercise manual
 *  Next/Back/Skip/Finish navigation so the 800ms missing-target timeout
 *  (see "missing-target handling" below) can never race a real-timer test
 *  and auto-advance out from under an assertion. */
function DoeTabFixtures() {
  return (
    <>
      {/* eslint-disable i18next/no-literal-string -- test fixtures, not user-facing copy */}
      <div data-tour="doe.tab.design">Design</div>
      <div data-tour="doe.tab.responses">Responses</div>
      <div data-tour="doe.tab.runs">Runs</div>
      <div data-tour="doe.tab.analysis">Analysis</div>
      {/* eslint-enable i18next/no-literal-string */}
    </>
  );
}

function renderOverlay(initialPath: string, extra?: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      {extra}
      <TourOverlay />
    </MemoryRouter>,
  );
}

describe("TourOverlay — rendering", () => {
  it("renders nothing when no tour is active", () => {
    renderOverlay("/doe");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders nothing for a dangling/unknown active tour id rather than crashing", () => {
    renderOverlay("/doe");
    act(() => useTourStore.setState({ activeTourId: "not-a-real-tour", stepIndex: 0 }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("TourOverlay — start, Next/Back, Skip, Finish", () => {
  it("starting a tour shows its first step with step-1-of-N progress", async () => {
    renderOverlay("/doe", <DoeTabFixtures />);
    act(() => useTourStore.getState().startTour("doe"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Factors");
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("Next advances through steps and Back returns to the previous one", async () => {
    const user = userEvent.setup();
    renderOverlay("/doe", <DoeTabFixtures />);
    act(() => useTourStore.getState().startTour("doe"));
    await screen.findByText("Factors");

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Levels")).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 5")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Factors")).toBeInTheDocument();
  });

  it("the last step's primary button reads Finish and closes the tour", async () => {
    const user = userEvent.setup();
    renderOverlay("/doe", <DoeTabFixtures />);
    act(() => useTourStore.getState().startTour("doe"));
    await screen.findByText("Factors");
    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(await screen.findByText("Interpretation limits")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useTourStore.getState().activeTourId).toBeNull();
  });

  it("Skip closes the tour immediately regardless of step", async () => {
    const user = userEvent.setup();
    renderOverlay("/doe", <DoeTabFixtures />);
    act(() => useTourStore.getState().startTour("doe"));
    await screen.findByText("Factors");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Levels");
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useTourStore.getState().activeTourId).toBeNull();
  });

  it("a tour can be restarted after finishing and begins again at step 1", async () => {
    const user = userEvent.setup();
    renderOverlay("/doe", <DoeTabFixtures />);
    act(() => useTourStore.getState().startTour("doe"));
    await screen.findByText("Factors");
    await user.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    act(() => useTourStore.getState().startTour("doe"));
    expect(await screen.findByText("Factors")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
  });
});

describe("TourOverlay — Escape and focus restoration", () => {
  it("Escape closes the tour and returns focus to the element that opened it", async () => {
    const user = userEvent.setup();
    renderOverlay(
      "/doe",
      <>
        <DoeTabFixtures />
        {/* eslint-disable-next-line i18next/no-literal-string -- test fixture, not user-facing copy */}
        <button data-testid="opener">Open</button>
      </>,
    );
    const opener = screen.getByTestId("opener");
    opener.focus();
    act(() => useTourStore.getState().startTour("doe"));
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
  });
});

describe("TourOverlay — missing-target handling", () => {
  it("auto-advances past a step whose target never renders, and finishes cleanly without crashing", async () => {
    vi.useFakeTimers();
    renderOverlay("/doe"); // no [data-tour] fixtures mounted — every step's target is missing
    act(() => useTourStore.getState().startTour("doe"));
    expect(useTourStore.getState().stepIndex).toBe(0);

    // 5 steps total — each one waits out its own timeout before advancing,
    // so reaching "finished" (past the last step) takes 5 timeout cycles.
    for (let i = 0; i < 5; i++) {
      act(() => {
        vi.advanceTimersByTime(900);
      });
    }
    expect(useTourStore.getState().activeTourId).toBeNull();
  });

  it("resolves the step once its target mounts after a delay, instead of skipping it", async () => {
    vi.useFakeTimers();
    const { rerender } = renderOverlay("/doe");
    act(() => useTourStore.getState().startTour("doe"));

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(useTourStore.getState().stepIndex).toBe(0); // still waiting, not yet timed out

    rerender(
      <MemoryRouter initialEntries={["/doe"]}>
        {/* eslint-disable-next-line i18next/no-literal-string -- test fixture */}
        <div data-tour="doe.tab.design">Design</div>
        <TourOverlay />
      </MemoryRouter>,
    );
    // Well past the missing-target timeout — if the element had NOT been
    // found, this alone would have auto-advanced the step (see the
    // preceding test). Staying on step 0 here proves the target was found
    // and polling stopped, not merely that the timeout hadn't hit yet.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(useTourStore.getState().stepIndex).toBe(0);
  });
});

describe("TourOverlay — accessibility", () => {
  it("exposes role=dialog with an accessible name and a described body", async () => {
    renderOverlay("/doe", <DoeTabFixtures />);
    act(() => useTourStore.getState().startTour("doe"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-describedby");
    const describedBy = dialog.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)).toHaveTextContent(/factor/i);
  });

  it("Next, Back, and Skip are real, keyboard-reachable buttons", async () => {
    const user = userEvent.setup();
    renderOverlay("/doe", <DoeTabFixtures />);
    act(() => useTourStore.getState().startTour("doe"));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: "Back" }).tagName).toBe("BUTTON");
    expect(screen.getByRole("button", { name: "Skip" }).tagName).toBe("BUTTON");
  });
});

describe("TourOverlay — never touches project data", () => {
  it("stepping through a full tour to Finish calls no masterdata function", async () => {
    const masterdata = await import("@/lib/masterdata");
    const user = userEvent.setup();
    renderOverlay("/doe", <DoeTabFixtures />);
    act(() => useTourStore.getState().startTour("doe"));
    await screen.findByText("Factors");
    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByRole("button", { name: "Next" }));
    }
    await user.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(masterdata.upsertRecords).not.toHaveBeenCalled();
    expect(masterdata.listRecords).not.toHaveBeenCalled();
    expect(masterdata.listRecordsSeeded).not.toHaveBeenCalled();
  });
});
