import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderAt } from "@/test/render";
import { useUiStore } from "@/lib/store";

// COPYCAT RULE: useUiStore is module-global; reset the locale after each test
// so this suite never bleeds a non-English locale into other test files.
afterEach(() => useUiStore.getState().setLocale("en"));

describe("FormulationWorkspaceV2 strings (i18n)", () => {
  it("renders the studio and its result pane in English (direct pipeline, no sidecar)", async () => {
    // "/live" renders the v2 workspace: studio + result, no OpenCode runtime, so
    // it shows immediately without a connection. Provider/model live in Settings,
    // so no provider UI appears here.
    renderAt("/live");
    expect(await screen.findByText("Formulation card")).toBeInTheDocument();
    expect(screen.queryByText("Provider")).not.toBeInTheDocument();
  });
});
