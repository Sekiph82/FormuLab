import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { routes } from "./router";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

const rootRoutes = routes[0].children ?? [];

describe("formulation route defaults", () => {
  it("lands on the new request flow by default", async () => {
    const indexRoute = rootRoutes.find((route) => route.index);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={indexRoute?.element} />
          <Route path="/formulation-request" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/formulation-request"));
  });

  it("retains the old live composer and saved-session paths as compatibility routes", () => {
    expect(rootRoutes.some((route) => route.path === "live")).toBe(true);
    expect(rootRoutes.some((route) => route.path === "live/:sessionId")).toBe(true);
  });

  it("retains the project-bound formulation and historical legacy routes", () => {
    expect(rootRoutes.some((route) => route.path === "formulation")).toBe(true);
    expect(rootRoutes.some((route) => route.path === "formulas/legacy")).toBe(true);
  });
});
