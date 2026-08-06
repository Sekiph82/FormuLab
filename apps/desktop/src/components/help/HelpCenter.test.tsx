/**
 * Integration coverage for the global, keyboard-reachable Help Center
 * search (Phase 10 Session 2). Reuses `cmdk`, same pattern as
 * `CommandPalette.test.tsx` — renders the real app via `renderAt`.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useHelpStore } from "@/lib/help/store";
import { useUiStore } from "@/lib/store";
import { renderAt } from "@/test/render";

beforeEach(() => {
  useHelpStore.setState({ panelOpen: false, centerOpen: false, target: null });
  useUiStore.setState({ paletteOpen: false });
});

describe("HelpCenter — opening", () => {
  it("opens on Ctrl//Cmd+/ and closes on Escape", async () => {
    const user = userEvent.setup();
    renderAt("/settings/appearance");
    expect(screen.queryByPlaceholderText("Search help…")).not.toBeInTheDocument();
    await user.keyboard("{Control>}/{/Control}");
    expect(await screen.findByPlaceholderText("Search help…")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByPlaceholderText("Search help…")).not.toBeInTheDocument();
  });

  it("does not open on Ctrl/Cmd+K (no shortcut conflict with the command palette)", async () => {
    const user = userEvent.setup();
    renderAt("/settings/appearance");
    await user.keyboard("{Control>}k{/Control}");
    expect(await screen.findByPlaceholderText("Type a command…")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search help…")).not.toBeInTheDocument();
  });

  it("opens from the command palette's Search help action", async () => {
    const user = userEvent.setup();
    renderAt("/settings/appearance");
    await user.keyboard("{Control>}k{/Control}");
    const input = await screen.findByPlaceholderText("Type a command…");
    await user.type(input, "search help");
    await user.click(screen.getByText("Search help"));
    expect(await screen.findByPlaceholderText("Search help…")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Type a command…")).not.toBeInTheDocument();
  });
});

describe("HelpCenter — search", () => {
  it("finds a topic by title", async () => {
    const user = userEvent.setup();
    renderAt("/settings/appearance");
    await user.keyboard("{Control>}/{/Control}");
    const input = await screen.findByPlaceholderText("Search help…");
    await user.type(input, "Laboratory");
    expect(await screen.findByText("Laboratory")).toBeInTheDocument();
  });

  it("finds a topic by keyword content", async () => {
    const user = userEvent.setup();
    renderAt("/settings/appearance");
    await user.keyboard("{Control>}/{/Control}");
    const input = await screen.findByPlaceholderText("Search help…");
    // "viscometer" is a data-exchange-unrelated keyword on the laboratory topic.
    await user.type(input, "deviation");
    expect(await screen.findByText("Laboratory")).toBeInTheDocument();
  });

  it("finds a glossary term", async () => {
    const user = userEvent.setup();
    renderAt("/settings/appearance");
    await user.keyboard("{Control>}/{/Control}");
    const input = await screen.findByPlaceholderText("Search help…");
    await user.type(input, "Working draft");
    expect(await screen.findByText("Working draft")).toBeInTheDocument();
  });

  it("includes link-only topics (materials, optimizer) as searchable results", async () => {
    const user = userEvent.setup();
    renderAt("/settings/appearance");
    await user.keyboard("{Control>}/{/Control}");
    const input = await screen.findByPlaceholderText("Search help…");
    await user.type(input, "Materials");
    expect(await screen.findByText("Materials")).toBeInTheDocument();
  });

  it("shows a no-results state for a query matching nothing", async () => {
    const user = userEvent.setup();
    renderAt("/settings/appearance");
    await user.keyboard("{Control>}/{/Control}");
    const input = await screen.findByPlaceholderText("Search help…");
    await user.type(input, "zzzznonexistentqueryzzzz");
    expect(await screen.findByText("No results.")).toBeInTheDocument();
  });

  it("clearing the search restores the full result list", async () => {
    const user = userEvent.setup();
    renderAt("/settings/appearance");
    await user.keyboard("{Control>}/{/Control}");
    const input = await screen.findByPlaceholderText("Search help…");
    await user.type(input, "zzzznonexistentqueryzzzz");
    await screen.findByText("No results.");
    await user.clear(input);
    expect(await screen.findByText("Laboratory")).toBeInTheDocument();
  });

  it("selecting a topic result opens the page Help panel without navigating away", async () => {
    const user = userEvent.setup();
    renderAt("/settings/appearance");
    await user.keyboard("{Control>}/{/Control}");
    const input = await screen.findByPlaceholderText("Search help…");
    await user.type(input, "Laboratory");
    await user.click(await screen.findByText("Laboratory"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "Laboratory");
    // Still on Settings underneath the panel — the current route's own
    // content (the Appearance nav item) never unmounted.
    expect(screen.getByRole("link", { name: /Appearance/ })).toBeInTheDocument();
  });

  it("selecting a glossary result opens the panel in glossary view", async () => {
    const user = userEvent.setup();
    renderAt("/settings/appearance");
    await user.keyboard("{Control>}/{/Control}");
    const input = await screen.findByPlaceholderText("Search help…");
    await user.type(input, "Working draft");
    await user.click(await screen.findByText("Working draft"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-label", "Working draft");
  });
});

describe("HelpCenter — focus restoration", () => {
  it("restores focus to the previously focused element on close", async () => {
    const user = userEvent.setup();
    renderAt("/settings/appearance");
    const button = await screen.findByRole("button", { name: "Help" });
    button.focus();
    await user.keyboard("{Control>}/{/Control}");
    await screen.findByPlaceholderText("Search help…");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(button).toHaveFocus());
  });
});
