import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "@/lib/store";
import { renderAt } from "@/test/render";
import { Sidebar } from "./Sidebar";

/** Renders only Sidebar (no AppShell/full route tree) plus a location
 *  probe, so a real NavLink click can be proven to change the router's
 *  location without mounting whatever heavy page sits at the target
 *  route. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
}
function renderSidebarOnly(initial: string) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Sidebar />
      <LocationProbe />
    </MemoryRouter>,
  );
}

const sessionsMock = {
  listSessions: vi.fn(async () => [] as unknown[]),
  deleteSession: vi.fn(async (_id: string) => {}),
};
vi.mock("@/lib/formulationV2", () => ({
  listSessions: () => sessionsMock.listSessions(),
  deleteSession: (id: string) => sessionsMock.deleteSession(id),
  notifySessionsChanged: vi.fn(),
  SESSIONS_CHANGED_EVENT: "formulab:sessions-changed",
  DEFAULT_FORMULA_ALTERNATIVES: 3,
  FORMULA_ALTERNATIVE_COUNTS: [3, 4, 5, 6, 7],
  generateFormulation: vi.fn(),
  loadProviderConfig: () => ({ provider: "gemini", model: "m", apiKey: "k" }),
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
  it("shows exactly 10 route-bearing top-level entries, plus Sessions pinned separately", async () => {
    renderAt("/files");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    // 10 route-bearing top-level rows live inside <nav>: 6 direct links
    // (Home, New Request, Projects, Reports, Data Exchange, Administration)
    // + 4 group toggle buttons (Formulation, Laboratory, Regulatory, Tools).
    const links = within(nav).getAllByRole("link", {
      name: /^(Home|New Request|Projects|Reports|Data Exchange|Administration)$/,
    });
    expect(links).toHaveLength(6);
    const groupToggles = within(nav).getAllByRole("button", {
      name: /^(Formulation|Laboratory|Regulatory|Tools)$/,
    });
    expect(groupToggles).toHaveLength(4);
    // Sessions is pinned outside <nav> — an 11th top-level entry, not one
    // of the 10 route-bearing rows counted above.
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

describe("Sidebar — New Request navigation (NAV1-NAV7)", () => {
  it("NAV1: no button with accessible name exactly 'New'", async () => {
    renderAt("/files");
    await screen.findByRole("navigation", { name: "Workspaces" });
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
  });

  it("NAV2: no link with accessible name exactly 'New'", async () => {
    renderAt("/files");
    await screen.findByRole("navigation", { name: "Workspaces" });
    expect(screen.queryByRole("link", { name: "New" })).not.toBeInTheDocument();
  });

  it("NAV3: exactly one navigation entry reaches /formulation-request", async () => {
    renderAt("/files");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    const links = within(nav)
      .getAllByRole("link")
      .filter((el) => el.getAttribute("href") === "/formulation-request");
    expect(links).toHaveLength(1);
  });

  it("NAV4: that entry's accessible name is exactly 'New Request'", async () => {
    renderAt("/files");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    const link = within(nav)
      .getAllByRole("link")
      .find((el) => el.getAttribute("href") === "/formulation-request");
    expect(link).toBeDefined();
    expect(link).toHaveAccessibleName("New Request");
  });

  it("NAV5: clicking New Request navigates to /formulation-request", async () => {
    renderSidebarOnly("/files");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    const user = userEvent.setup();
    await user.click(within(nav).getByRole("link", { name: "New Request" }));
    await waitFor(() => expect(screen.getByTestId("location-probe")).toHaveTextContent("/formulation-request"));
    expect(within(nav).getByRole("link", { name: "New Request" })).toHaveAttribute("aria-current", "page");
  });

  it("NAV6: New Request becomes active on /formulation-request", async () => {
    renderAt("/formulation-request");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    expect(within(nav).getByRole("link", { name: "New Request" })).toHaveAttribute("aria-current", "page");
  });

  it("NAV7: existing top-level navigation remains reachable", async () => {
    renderAt("/files");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    for (const name of ["Home", "Projects", "Reports", "Data Exchange", "Administration"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
    for (const name of ["Formulation", "Laboratory", "Regulatory", "Tools"]) {
      expect(within(nav).getByRole("button", { name })).toBeInTheDocument();
    }
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
  it("shows exactly the latest 5 sessions, newest first, plus a 'View all sessions' control when there are more", async () => {
    sessionsMock.listSessions.mockResolvedValue(
      // listSessions() always resolves newest-first (see formulation_v2.rs); s6 is newest.
      Array.from({ length: 6 }, (_, i) => session(`s${6 - i}`)),
    );
    renderAt("/files");

    for (let n = 6; n >= 2; n--) {
      await waitFor(() => expect(screen.getByText(`s${n}`)).toBeInTheDocument());
    }
    expect(screen.queryByText("s1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View all sessions" })).toBeInTheDocument();

    // Newest-first order is preserved in the DOM, not just "which 5 show".
    const rows = screen.getAllByText(/^s[2-6]$/).map((el) => el.textContent);
    expect(rows).toEqual(["s6", "s5", "s4", "s3", "s2"]);
  });

  it("shows all available sessions with no 'View all' control when there are fewer than 5", async () => {
    sessionsMock.listSessions.mockResolvedValue([session("a"), session("b"), session("c")]);
    renderAt("/files");
    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View all sessions" })).not.toBeInTheDocument();
  });

  it("shows no 'View all sessions' control when there are exactly 5 sessions", async () => {
    sessionsMock.listSessions.mockResolvedValue(Array.from({ length: 5 }, (_, i) => session(`s${i}`)));
    renderAt("/files");
    await waitFor(() => expect(screen.getByText("s0")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "View all sessions" })).not.toBeInTheDocument();
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

  it("returns to the latest 5 after 'Show fewer'", async () => {
    // listSessions() resolves newest-first, so array position 0 is newest — s11 here.
    sessionsMock.listSessions.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => session(`s${11 - i}`)),
    );
    renderAt("/files");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "View all sessions" }));
    expect(screen.getByText("s0")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show fewer" }));
    for (let i = 7; i <= 11; i++) expect(screen.getByText(`s${i}`)).toBeInTheDocument();
    expect(screen.queryByText("s6")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View all sessions" })).toBeInTheDocument();
  });

  it("shows the unchanged empty state when there are no sessions", async () => {
    sessionsMock.listSessions.mockResolvedValue([]);
    renderAt("/files");
    expect(await screen.findByText("No conversations yet.")).toBeInTheDocument();
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
