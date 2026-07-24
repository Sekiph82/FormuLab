/**
 * Spec Part 5 coverage that doesn't need per-page mocking: primary
 * navigation, Administration's existing-configuration links, Reports'
 * navigation shell, and route backward-compatibility (spec 4.16 — the old
 * `/formulas` deep link must keep working, and the page it pointed at must
 * not be deleted).
 */
import { screen, within } from "@testing-library/react";
import { isValidElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useUiStore } from "@/lib/store";
import { renderAt } from "@/test/render";
import { routes } from "@/app/router";

afterEach(() => useUiStore.getState().setLocale("en"));

describe("primary navigation", () => {
  it("renders all ten workspaces", async () => {
    renderAt("/home");
    const nav = await screen.findByRole("navigation");
    for (const label of ["Home", "Projects", "Formulation", "Laboratory", "Stability", "Optimization", "Regulatory", "Approval", "Reports", "Administration"]) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
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
    expect(screen.getByText(/no user-management backend/i)).toBeInTheDocument();
  });
});

describe("Reports workspace", () => {
  it("is a navigation shell over existing exports, marking the PDF/DOCX engine as not yet implemented", async () => {
    renderAt("/reports");
    await screen.findByRole("heading", { name: "Reports" });
    expect(screen.getAllByRole("link", { name: "Open" }).length).toBe(6);
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
