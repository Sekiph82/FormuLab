import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderAt } from "@/test/render";
import { useUiStore } from "@/lib/store";
import { useRuntimeStore } from "@/lib/runtime";
import { shippedLocales } from "@/i18n/config";

describe("Settings language selector", () => {
  it("shows a Language select with one option per shipped locale", async () => {
    renderAt("/settings/appearance");
    const select = await screen.findByRole("combobox", { name: "Language" });
    expect(within(select).getAllByRole("option")).toHaveLength(shippedLocales().length);
  });

  it("updates the store locale on change", async () => {
    renderAt("/settings/appearance");
    const select = await screen.findByRole("combobox", { name: "Language" });
    await userEvent.selectOptions(select, "ja");
    expect(useUiStore.getState().locale).toBe("ja");
    useUiStore.getState().setLocale("en");
  });
});

describe("Settings page strings (i18n)", () => {
  it("renders the General section with the settings sidebar navigation", async () => {
    renderAt("/settings");
    expect(await screen.findByRole("heading", { level: 1, name: "General" })).toBeInTheDocument();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("available in the desktop app")).toBeInTheDocument();
    // The sidebar became the settings navigation with a way back to the app.
    expect(screen.getByRole("button", { name: "Back to app" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connectors" })).toBeInTheDocument();
  });

  it("renders each section's own title and disconnected-runtime prompt", async () => {
    const runtime = renderAt("/settings/runtime");
    expect(await screen.findByText("Agent runtime")).toBeInTheDocument();
    runtime.unmount();

    const connectors = renderAt("/settings/connectors");
    expect(await screen.findByText("MCP servers")).toBeInTheDocument();
    expect(screen.getByText("Connect the runtime to configure MCP servers.")).toBeInTheDocument();
    connectors.unmount();

    // The model section belongs to the direct formulation pipeline, so it needs
    // no runtime connection — it renders its selector straight away.
    renderAt("/settings/models");
    expect(await screen.findByRole("heading", { level: 2, name: "Model" })).toBeInTheDocument();
  });

  it("renders the formulation model/key surface without a runtime connection", async () => {
    const original = useRuntimeStore.getState();
    let view: ReturnType<typeof renderAt> | undefined;
    try {
      // Disconnected on purpose: provider/model/key are local settings now.
      useRuntimeStore.setState({ status: "idle", defaultModel: null });
      view = renderAt("/settings/models");
      expect(
        await screen.findByText("The model and API key used to generate formulations"),
      ).toBeInTheDocument();
      expect(screen.getByText("Provider")).toBeInTheDocument();
      expect(screen.getByText("API key")).toBeInTheDocument();
    } finally {
      view?.unmount();
      useRuntimeStore.setState({ status: original.status, defaultModel: original.defaultModel });
    }
  });
});
