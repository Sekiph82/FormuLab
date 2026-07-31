/**
 * Integration coverage for the route-aware page Help entry point
 * (`HelpButton`) and panel (`HelpPanel`) — Phase 10 Session 2. Renders the
 * real app via `renderAt` (same helper `CommandPalette.test.tsx` uses) so
 * `topicForRoute()`, the real `AppShell` mounting, and real `help.json`
 * content are all exercised together, not mocked.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useHelpStore } from "@/lib/help/store";
import { renderAt } from "@/test/render";

beforeEach(() => {
  useHelpStore.setState({ panelOpen: false, centerOpen: false, target: null });
});

describe("HelpButton — route coverage", () => {
  it("appears on a covered route", async () => {
    renderAt("/home");
    expect(await screen.findByRole("button", { name: "Help" })).toBeInTheDocument();
  });

  it("does not render on a documented exclusion route", async () => {
    renderAt("/formulas/legacy");
    await screen.findByRole("heading", { level: 1 }).catch(() => undefined);
    expect(screen.queryByRole("button", { name: "Help" })).not.toBeInTheDocument();
  });
});

describe("HelpPanel — opening and content", () => {
  it("opens the resolved topic for the current exact route", async () => {
    const user = userEvent.setup();
    renderAt("/home");
    await user.click(await screen.findByRole("button", { name: "Help" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "Home");
  });

  it("uses the intended parent fallback for a nested route (settings section)", async () => {
    const user = userEvent.setup();
    renderAt("/settings/appearance");
    await user.click(await screen.findByRole("button", { name: "Help" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "Settings");
  });

  it("shows the Laboratory topic's Test Standards and Methods section (Session 1A integration)", async () => {
    const user = userEvent.setup();
    renderAt("/laboratory");
    await user.click(await screen.findByRole("button", { name: "Help" }));
    await screen.findByRole("dialog");
    expect(screen.getByText("Test Standards and Methods")).toBeInTheDocument();
  });

  it("closes on the close button and restores focus to the opener", async () => {
    const user = userEvent.setup();
    renderAt("/home");
    const opener = await screen.findByRole("button", { name: "Help" });
    await user.click(opener);
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderAt("/home");
    await user.click(await screen.findByRole("button", { name: "Help" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("HelpPanel — related topics and glossary", () => {
  it("navigates to a related topic in place, without leaving the panel", async () => {
    const user = userEvent.setup();
    renderAt("/formulation");
    await user.click(await screen.findByRole("button", { name: "Help" }));
    let dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "Formulation");
    await user.click(within(dialog).getByRole("button", { name: "Laboratory" }));
    dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "Laboratory");
  });

  it("opens a glossary term and can navigate back to a related topic", async () => {
    const user = userEvent.setup();
    renderAt("/formulation");
    await user.click(await screen.findByRole("button", { name: "Help" }));
    let dialog = await screen.findByRole("dialog");
    // Formulation's glossaryTermIds includes "workingDraft".
    await user.click(within(dialog).getByRole("button", { name: "Working draft" }));
    dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "Working draft");
    expect(within(dialog).getByRole("button", { name: "Back" })).toBeInTheDocument();
  });
});
