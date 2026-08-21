import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * NR3 — proves the REAL `NewFormulationRequestPage` submit handler reaches
 * the REAL native command boundary, distinct from
 * `NewFormulationRequestPage.test.tsx` (which mocks `@/lib/formulationV2`
 * wholesale — correct for that file's own component-behavior scope, but not
 * strong enough to prove the frontend genuinely reaches
 * `invoke("generate_formulation", ...)`).
 *
 * This file mocks NOTHING in `@/lib/formulationV2` — `generateFormulation()`,
 * `loadProviderConfig()`, `notifySessionsChanged()` all run for real. Only
 * the Tauri IPC boundary itself is intercepted (`@/lib/tauri`'s `isTauri`
 * flag, forced true so `formulationV2.ts`'s own `call()` doesn't throw
 * "not-desktop"; `@tauri-apps/api/core`'s `invoke`), matching this repo's
 * own established mocking convention for exercising a real bridge module
 * against a mocked native boundary (see `migrationRunner.test.ts`'s
 * identical pattern for `append_migration_journal`/etc.). Never a second,
 * parallel fake bridge — the real `call()`/`generateFormulation()`
 * implementation is what runs.
 */

vi.mock("@/lib/tauri", () => ({ isTauri: true }));

const invokeMock = vi.fn(async (cmd: string, _args?: Record<string, unknown>) => {
  if (cmd === "generate_formulation") {
    return { status: "ok", session_id: "nr3-session" };
  }
  throw new Error(`unexpected invoke in NR3 test: ${cmd}`);
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: [string, Record<string, unknown>?]) => invokeMock(...a),
}));

import { NewFormulationRequestPage } from "./NewFormulationRequestPage";

/** Mounts the real page at "/" alongside the REAL production route shape
 *  (`app/router.tsx`'s own `"formulation-result/:sessionId"` path) so a
 *  real `navigate()` call is observable as a real route change — never a
 *  fabricated router or a synthetic "navigate was called" spy. The target
 *  route's own element is a tiny marker rendering the real `:sessionId`
 *  param, sufficient to prove the exact real destination without pulling
 *  in `FormulationResultPage`'s own unrelated data-loading concerns. */
function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<NewFormulationRequestPage />} />
        <Route path="/formulation-result/:sessionId" element={<FormulationResultRouteMarker />} />
        <Route path="/live" element={<div>live-fallback-route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function FormulationResultRouteMarker() {
  const { sessionId } = useParams();
  return <div data-testid="formulation-result-route">formulation-result-route:{sessionId}</div>;
}

describe("NR3: the real New Request submit handler reaches the real generate_formulation Tauri command boundary", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    window.localStorage.clear();
  });

  it("clicking Start Formulation Request invokes the exact production command name with the real payload shape — no second bridge", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(
      screen.getByPlaceholderText(/sulfate-free anti-dandruff shampoo/i),
      "A gentle sulfate-free shampoo for an oily scalp.",
    );
    await user.click(screen.getByTestId("formula-count-5"));
    await user.click(screen.getByRole("button", { name: "Start Formulation Request" }));

    // The real submit handler is async (generateFormulation -> call ->
    // dynamic import of @tauri-apps/api/core -> invoke) — wait for it to
    // actually land rather than asserting synchronously.
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

    // NR3E/NR3F — the exact real command name and the exact real payload
    // shape formulationV2.ts's own generateFormulation()/call() build,
    // never a fabricated shape.
    expect(invokeMock).toHaveBeenCalledWith(
      "generate_formulation",
      expect.objectContaining({
        token: expect.any(String), // real currentSessionToken() — "" when no session persisted, still a real string
        request: expect.objectContaining({
          brief: expect.objectContaining({ target: "A gentle sulfate-free shampoo for an oily scalp." }),
          provider: expect.any(String),
          model: expect.any(String),
          api_key: expect.any(String),
          n: 5,
        }),
      }),
    );
  });

  it("navigates to the real /formulation-result/:sessionId route on a real ok response — the real result contract, not a fabricated one", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(
      screen.getByPlaceholderText(/sulfate-free anti-dandruff shampoo/i),
      "A gentle shampoo.",
    );
    await user.click(screen.getByRole("button", { name: "Start Formulation Request" }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    // The real submit() handler's own status branch
    // (res.status === "ok" && res.session_id -> navigate(`/formulation-result/${res.session_id}`))
    // genuinely fired — proven by a real route change to the real
    // production path shape, carrying the exact session_id the mocked
    // invoke() response returned ("nr3-session"), not a synthetic
    // navigate() spy assertion.
    await waitFor(() => expect(screen.getByTestId("formulation-result-route")).toBeInTheDocument());
    expect(screen.getByTestId("formulation-result-route")).toHaveTextContent("formulation-result-route:nr3-session");
    // The New Request form itself is gone — this really was a route change,
    // not content rendered alongside it.
    expect(screen.queryByRole("button", { name: "Start Formulation Request" })).not.toBeInTheDocument();
  });
});
