/**
 * Phase 10 Session 8 navigation correction: collapsing the sidebar on a
 * page that owns its own titlebar (currently only `/live`, the app's
 * default landing route) left NO way to reopen it — the pre-existing
 * expand-button strip in `AppShell` was gated behind `!pageOwnsTitlebar`,
 * and neither `FormulationStudio` nor `FormulationWorkspaceV2` rendered
 * any restore control of their own. `Ctrl/Cmd+B` still worked, but a
 * mouse-only user on `/live` had no way back. Fixed with a floating
 * restore button reusing the exact same `sidebarCollapsed`/
 * `setSidebarCollapsed` state `Sidebar.tsx`'s own collapse button already
 * uses — no second sidebar state introduced.
 */
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "@/lib/store";
import { renderAt } from "@/test/render";

vi.mock("@/lib/formulationV2", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/formulationV2")>();
  return {
    ...actual,
    listSessions: vi.fn(async () => []),
    deleteSession: vi.fn(async () => {}),
    notifySessionsChanged: vi.fn(),
  };
});

afterEach(() => {
  useUiStore.getState().setLocale("en");
  useUiStore.setState({ sidebarCollapsed: false });
});

beforeEach(() => {
  useUiStore.setState({ sidebarCollapsed: false });
});

describe("AppShell — restore navigation after collapse (/live owns its own titlebar)", () => {
  it("shows no restore button while the sidebar is open", async () => {
    renderAt("/live");
    await screen.findByRole("navigation", { name: "Workspaces" });
    expect(screen.queryByRole("button", { name: "Expand sidebar" })).not.toBeInTheDocument();
  });

  it("shows a restore button after collapsing, and it reopens the sidebar", async () => {
    renderAt("/live");
    await screen.findByRole("navigation", { name: "Workspaces" });

    await act(async () => {
      useUiStore.getState().setSidebarCollapsed(true);
    });

    const restore = await screen.findByRole("button", { name: "Expand sidebar" });
    expect(restore).toHaveAttribute("aria-expanded", "false");

    const user = userEvent.setup();
    await user.click(restore);

    await waitFor(() => expect(useUiStore.getState().sidebarCollapsed).toBe(false));
    expect(screen.queryByRole("button", { name: "Expand sidebar" })).not.toBeInTheDocument();
  });

  it("supports keyboard activation of the restore button", async () => {
    renderAt("/live");
    await screen.findByRole("navigation", { name: "Workspaces" });
    await act(async () => {
      useUiStore.getState().setSidebarCollapsed(true);
    });

    const restore = await screen.findByRole("button", { name: "Expand sidebar" });
    restore.focus();
    expect(restore).toHaveFocus();

    const user = userEvent.setup();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(useUiStore.getState().sidebarCollapsed).toBe(false));
  });

  it("Ctrl/Cmd+B remains a working additional way to reopen", async () => {
    renderAt("/live");
    await screen.findByRole("navigation", { name: "Workspaces" });
    await act(async () => {
      useUiStore.getState().setSidebarCollapsed(true);
    });
    await screen.findByRole("button", { name: "Expand sidebar" });

    const user = userEvent.setup();
    await user.keyboard("{Control>}b{/Control}");

    await waitFor(() => expect(useUiStore.getState().sidebarCollapsed).toBe(false));
  });
});

describe("AppShell — restore navigation still works on non-live routes (existing behavior preserved)", () => {
  it("shows a restore button after collapsing on /files and it reopens the sidebar", async () => {
    renderAt("/files");
    await screen.findByRole("navigation", { name: "Workspaces" });
    await act(async () => {
      useUiStore.getState().setSidebarCollapsed(true);
    });

    const restore = await screen.findByRole("button", { name: "Expand sidebar" });
    expect(restore).toHaveAttribute("aria-expanded", "false");

    const user = userEvent.setup();
    await user.click(restore);
    await waitFor(() => expect(useUiStore.getState().sidebarCollapsed).toBe(false));
  });

  it("collapsing and reopening does not change the current route", async () => {
    renderAt("/reports");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    expect(within(nav).getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");

    await act(async () => {
      useUiStore.getState().setSidebarCollapsed(true);
    });
    const restore = await screen.findByRole("button", { name: "Expand sidebar" });
    const user = userEvent.setup();
    await user.click(restore);

    await waitFor(() => expect(useUiStore.getState().sidebarCollapsed).toBe(false));
    const navAfter = await screen.findByRole("navigation", { name: "Workspaces" });
    expect(within(navAfter).getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
  });

  it("reopening still renders the Sessions preview and Settings entry", async () => {
    renderAt("/files");
    await screen.findByRole("navigation", { name: "Workspaces" });
    await act(async () => {
      useUiStore.getState().setSidebarCollapsed(true);
    });
    const restore = await screen.findByRole("button", { name: "Expand sidebar" });
    const user = userEvent.setup();
    await user.click(restore);

    await waitFor(() => expect(useUiStore.getState().sidebarCollapsed).toBe(false));
    expect(await screen.findByText("Sessions")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("the Help button still opens the panel correctly while the sidebar is collapsed", async () => {
    renderAt("/reports");
    await screen.findByRole("navigation", { name: "Workspaces" });
    await act(async () => {
      useUiStore.getState().setSidebarCollapsed(true);
    });
    await screen.findByRole("button", { name: "Expand sidebar" });

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Help" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
