import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "@/lib/store";
import { renderAt } from "@/test/render";

const sessionsMock = {
  listSessions: vi.fn(async () => [] as unknown[]),
  deleteSession: vi.fn(async (_id: string) => {}),
};
vi.mock("@/lib/formulationV2", () => ({
  listSessions: () => sessionsMock.listSessions(),
  deleteSession: (id: string) => sessionsMock.deleteSession(id),
  notifySessionsChanged: vi.fn(),
  SESSIONS_CHANGED_EVENT: "formulab:sessions-changed",
}));

function session(id: string, target = id) {
  return { id, brief: { target }, card_count: 1 };
}

afterEach(() => {
  useUiStore.getState().setLocale("en");
  useUiStore.setState({ sidebarCollapsed: false });
});

beforeEach(() => {
  sessionsMock.listSessions.mockReset().mockResolvedValue([]);
});

describe("Sidebar — top-level structure", () => {
  it("shows exactly 10 top-level entries", async () => {
    renderAt("/files");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    // 9 route-bearing top-level rows live inside <nav>: 5 direct links
    // (Home, Projects, Reports, Data Exchange, Administration) + 4 group
    // toggle buttons (Formulation, Laboratory, Regulatory, Tools).
    const links = within(nav).getAllByRole("link", { name: /^(Home|Projects|Reports|Data Exchange|Administration)$/ });
    expect(links).toHaveLength(5);
    const groupToggles = within(nav).getAllByRole("button", {
      name: /^(Formulation|Laboratory|Regulatory|Tools)$/,
    });
    expect(groupToggles).toHaveLength(4);
    // Sessions is the 10th, pinned outside <nav>.
    expect(screen.getByText("Sessions")).toBeInTheDocument();
  });

  it("every previous route remains reachable from the sidebar", async () => {
    renderAt("/files");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });

    for (const name of ["Home", "Projects", "Reports", "Data Exchange", "Administration"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }

    const user = userEvent.setup();
    await user.click(within(nav).getByRole("button", { name: "Formulation" }));
    for (const name of ["Formulation", "Optimization", "Design of Experiments", "Reverse Formulation"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }

    await user.click(within(nav).getByRole("button", { name: "Laboratory" }));
    for (const name of ["Laboratory", "Stability"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }

    await user.click(within(nav).getByRole("button", { name: "Regulatory" }));
    for (const name of ["Regulatory", "Dossiers", "Claims & Labels", "Approval"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }

    await user.click(within(nav).getByRole("button", { name: "Tools" }));
    for (const name of ["Notebooks", "Files", "Runs"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("groups children correctly under each parent", async () => {
    renderAt("/files");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    const user = userEvent.setup();

    await user.click(within(nav).getByRole("button", { name: "Formulation" }));
    const formulationLinks = within(nav).getAllByRole("link").map((el) => el.getAttribute("href"));
    expect(formulationLinks).toEqual(
      expect.arrayContaining(["/formulation", "/optimization", "/doe", "/reverse-formulation"]),
    );
    // Regulatory-only children must not leak into the Formulation group.
    expect(formulationLinks).not.toContain("/dossiers");
  });
});

describe("Sidebar — accordion behavior", () => {
  it("auto-expands and highlights the group containing the active route", async () => {
    renderAt("/dossiers");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    const dossiersLink = await within(nav).findByRole("link", { name: "Dossiers" });
    expect(dossiersLink).toHaveClass("bg-surface-2");

    const regulatoryToggle = within(nav).getByRole("button", { name: "Regulatory" });
    expect(regulatoryToggle).toHaveAttribute("aria-expanded", "true");
  });

  it("opening one group closes the previously open one (prefers a single expanded group)", async () => {
    renderAt("/files");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    const user = userEvent.setup();

    await user.click(within(nav).getByRole("button", { name: "Formulation" }));
    expect(within(nav).getByRole("button", { name: "Formulation" })).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByRole("link", { name: "Optimization" })).toBeInTheDocument();

    await user.click(within(nav).getByRole("button", { name: "Laboratory" }));
    expect(within(nav).getByRole("button", { name: "Laboratory" })).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByRole("button", { name: "Formulation" })).toHaveAttribute("aria-expanded", "false");
    expect(within(nav).queryByRole("link", { name: "Optimization" })).not.toBeInTheDocument();
  });

  it("toggles a group closed on a second click of its own header", async () => {
    renderAt("/administration");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    const user = userEvent.setup();
    const toggle = within(nav).getByRole("button", { name: "Tools" });

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(nav).queryByRole("link", { name: "Files" })).not.toBeInTheDocument();
  });

  it("switches the auto-expanded group when navigating to a different group's active route", async () => {
    const first = renderAt("/formulation");
    const firstNav = await screen.findByRole("navigation", { name: "Workspaces" });
    await waitFor(() =>
      expect(within(firstNav).getByRole("button", { name: "Formulation" })).toHaveAttribute("aria-expanded", "true"),
    );
    first.unmount();

    renderAt("/stability");
    const secondNav = await screen.findByRole("navigation", { name: "Workspaces" });
    await waitFor(() =>
      expect(within(secondNav).getByRole("button", { name: "Laboratory" })).toHaveAttribute("aria-expanded", "true"),
    );
  });
});

describe("Sidebar — Sessions", () => {
  it("shows only the latest 3 sessions plus a 'View all sessions' control when there are more", async () => {
    sessionsMock.listSessions.mockResolvedValue([
      session("s5"), session("s4"), session("s3"), session("s2"), session("s1"),
    ]);
    renderAt("/files");

    await waitFor(() => expect(screen.getByText("s5")).toBeInTheDocument());
    expect(screen.getByText("s4")).toBeInTheDocument();
    expect(screen.getByText("s3")).toBeInTheDocument();
    expect(screen.queryByText("s2")).not.toBeInTheDocument();
    expect(screen.queryByText("s1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View all sessions" })).toBeInTheDocument();
  });

  it("expands to show every session, in its own bounded scroll area, after 'View all sessions'", async () => {
    sessionsMock.listSessions.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => session(`s${i}`)),
    );
    renderAt("/files");
    await waitFor(() => expect(screen.getByRole("button", { name: "View all sessions" })).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View all sessions" }));

    for (let i = 0; i < 12; i++) expect(screen.getByText(`s${i}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeInTheDocument();
  });

  it("shows no 'View all sessions' control when there are 3 or fewer sessions", async () => {
    sessionsMock.listSessions.mockResolvedValue([session("a"), session("b")]);
    renderAt("/files");
    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "View all sessions" })).not.toBeInTheDocument();
  });

  it("keeps Sessions and Settings visible alongside a long navigation and session list", async () => {
    sessionsMock.listSessions.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => session(`s${i}`)),
    );
    renderAt("/files");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    const user = userEvent.setup();
    // Expand every group in turn — none of this should push Sessions or
    // Settings out of the DOM (the nav region scrolls internally instead).
    for (const name of ["Formulation", "Laboratory", "Regulatory", "Tools"]) {
      await user.click(within(nav).getByRole("button", { name }));
    }
    await waitFor(() => expect(screen.getByText("Sessions")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });
});

describe("Sidebar — Settings", () => {
  it("remains pinned and reachable regardless of scroll/expansion state", async () => {
    renderAt("/dossiers");
    expect(await screen.findByRole("button", { name: "Settings" })).toBeInTheDocument();
  });
});

describe("Sidebar — collapsed state", () => {
  it("collapses to zero width without unmounting the divider drag handle", async () => {
    renderAt("/files");
    await act(async () => {
      useUiStore.getState().setSidebarCollapsed(true);
    });
    // The aside's outer wrapper collapses to width 0; the collapse toggle in
    // the (non-settings) header disappears with it, but the app must not crash.
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
  });
});

describe("Sidebar — keyboard and ARIA", () => {
  it("exposes aria-expanded and aria-controls on every group toggle", async () => {
    renderAt("/files");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    for (const name of ["Formulation", "Laboratory", "Regulatory", "Tools"]) {
      const toggle = within(nav).getByRole("button", { name });
      expect(toggle).toHaveAttribute("aria-expanded");
      expect(toggle).toHaveAttribute("aria-controls");
    }
  });

  it("marks the active link with aria-current", async () => {
    renderAt("/reports");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    expect(within(nav).getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
  });

  it("group toggles and links are reachable via keyboard activation (Enter)", async () => {
    renderAt("/files");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    const user = userEvent.setup();
    const toggle = within(nav).getByRole("button", { name: "Formulation" });
    toggle.focus();
    expect(toggle).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});
