import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderAt } from "@/test/render";
import { useUiStore } from "@/lib/store";

// so this suite never bleeds a non-English locale into other test files.
afterEach(() => useUiStore.getState().setLocale("en"));

// disconnected default after any test that fakes a "ready" runtime.

describe("NotebooksPage strings (i18n)", () => {
  it("renders the page heading and the desktop-only empty state in English", async () => {
    renderAt("/notebooks");
    expect(await screen.findByRole("heading", { level: 1, name: "Notebooks" })).toBeInTheDocument();
    expect(screen.getByText("Notebooks are available in the desktop app.")).toBeInTheDocument();
    expect(screen.getByText("New notebook")).toBeInTheDocument();
  });
});

describe("FilesPage strings (i18n)", () => {
  it("renders the desktop-only explorer message and the preview prompt in English", async () => {
    renderAt("/files");
    expect(await screen.findByText("The file explorer is available in the desktop app.")).toBeInTheDocument();
    expect(screen.getByText("Select a file to preview it here.")).toBeInTheDocument();
  });
});
