/**
 * Spec Part 5 coverage that doesn't need per-page mocking: primary
 * navigation, Administration's existing-configuration links, Reports'
 * navigation shell, and route backward-compatibility (spec 4.16 — the old
 * `/formulas` deep link must keep working, and the page it pointed at must
 * not be deleted).
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { isValidElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "@/lib/store";
import { renderAt } from "@/test/render";
import { routes } from "@/app/router";

// HomePage (rendered by the "renders all ten workspaces" test below) seeds
// `regulatory_rules` via `listRecordsSeeded`, which — unmocked — would call
// the real `upsertRecords` and throw "not-desktop" outside Tauri. Every
// collection here resolves empty/seed, matching HomePage.test.tsx's own
// mocking discipline.
vi.mock("@/lib/masterdata", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/masterdata")>();
  return {
    ...actual,
    listRecords: () => Promise.resolve([]),
    listRecordsSeeded: (_collection: string, seed: unknown[]) => Promise.resolve(seed),
  };
});

afterEach(() => useUiStore.getState().setLocale("en"));

describe("primary navigation", () => {
  it("renders the 10 top-level entries: 5 direct links, 4 accordion groups, and Sessions", async () => {
    renderAt("/home");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });
    for (const label of ["Home", "Projects", "Reports", "Data Exchange", "Administration"]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
    for (const label of ["Formulation", "Laboratory", "Regulatory", "Tools"]) {
      expect(within(nav).getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText("Sessions")).toBeInTheDocument();
  });

  it("reaches every workspace once its group is expanded", async () => {
    const user = userEvent.setup();
    renderAt("/home");
    const nav = await screen.findByRole("navigation", { name: "Workspaces" });

    await user.click(within(nav).getByRole("button", { name: "Laboratory" }));
    for (const label of ["Laboratory", "Stability"]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }

    await user.click(within(nav).getByRole("button", { name: "Formulation" }));
    expect(within(nav).getByRole("link", { name: "Optimization" })).toBeInTheDocument();

    await user.click(within(nav).getByRole("button", { name: "Regulatory" }));
    expect(within(nav).getByRole("link", { name: "Approval" })).toBeInTheDocument();
  });
});

describe("Administration workspace", () => {
  it("exposes existing configuration modules by linking to them, not reimplementing them", async () => {
    renderAt("/administration");
    await screen.findByRole("heading", { name: "Administration" });
    expect(screen.getByRole("link", { name: /^Materials, suppliers/ })).toHaveAttribute("href", "/materials");
    expect(screen.getByRole("link", { name: /^Regulatory rules/ })).toHaveAttribute("href", "/regulatory");
    expect(screen.getByRole("link", { name: /^Approval policies/ })).toHaveAttribute("href", "/approval");
    expect(screen.getByRole("link", { name: /^Application settings/ })).toHaveAttribute("href", "/settings");
  });

  it("Phase 13 Session 5: has a Users tab (Administration → Users)", async () => {
    const user = userEvent.setup();
    renderAt("/administration");
    await screen.findByRole("heading", { name: "Administration" });
    await user.click(screen.getByRole("button", { name: "Users" }));
    // Outside a real AuthProvider (this test's render path), useTrustedActor()
    // returns null and UsersPanel falls back to visible, the same convention
    // every other useTrustedActor() site uses — so the real user list loads.
    expect(await screen.findByText("New user")).toBeInTheDocument();
  });
});

describe("Reports workspace", () => {
  it("is a navigation shell over existing exports, marking the PDF/DOCX engine as not yet implemented", async () => {
    renderAt("/reports");
    await screen.findByRole("heading", { name: "Reports" });
    expect(screen.getAllByRole("link", { name: "Open" }).length).toBe(17);
    expect(screen.getByText("Not yet implemented")).toBeInTheDocument();
    expect(screen.getByText("Audit reports")).toBeInTheDocument();
  });
});

describe("route backward-compatibility", () => {
  // Exercised against the route config directly rather than by mounting a
  // live client-side <Navigate> — this vitest/jsdom/undici combination
  // throws on react-router's data-router request construction for a
  // replace-navigate, independent of anything this task changed.
  const appChildren = routes[0].children ?? [];
  const findRoute = (path: string) => appChildren.find((r) => r.path === path);

  it("redirects the old /formulas deep link to /projects rather than 404ing", () => {
    const formulasRoute = findRoute("formulas");
    expect(formulasRoute).toBeDefined();
    expect(isValidElement(formulasRoute!.element)).toBe(true);
    expect((formulasRoute!.element as React.ReactElement<{ to: string }>).props.to).toBe("/projects");
  });

  it("keeps the old single-page Formula Builder reachable — it is not deleted", async () => {
    expect(findRoute("formulas/legacy")).toBeDefined();
    renderAt("/formulas/legacy");
    expect(await screen.findByText("Formula projects")).toBeInTheDocument();
  });
});
