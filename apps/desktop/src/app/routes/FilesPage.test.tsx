import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntry } from "@/lib/artifactFile";
import { FilesPage } from "./FilesPage";

const listDir = vi.fn();
vi.mock("@/lib/artifactFile", () => ({
  listDir: (rel: string, root?: string) => listDir(rel, root),
}));
vi.mock("@/components/inspector/FilePreviewInspector", () => ({
  FilePreviewInspector: ({ data }: { data: { filename: string } }) => (
    <div data-testid="preview">preview:{data.filename}</div>
  ),
}));
vi.mock("@/components/notebook/NotebookEditor", () => ({
  NotebookEditor: ({ path }: { path: string }) => <div data-testid="nb">nb:{path}</div>,
}));

// data/ holds the runs; formulas/ holds the library. The page shows both.
const dataRoot: DirEntry[] = [
  { path: "sessions", name: "sessions", isDir: true, size: 0, modified: 2 },
  { path: "figure.png", name: "figure.png", isDir: false, size: 2048, modified: 3 },
  { path: "run.ipynb", name: "run.ipynb", isDir: false, size: 500, modified: 1 },
];
const sessionsDir: DirEntry[] = [
  { path: "sessions/papers.json", name: "papers.json", isDir: false, size: 120, modified: 4 },
];
const formulasRoot: DirEntry[] = [
  {
    path: "Formulation_Card_2026-07-18-1638-body-wash_v1.md",
    name: "Formulation_Card_2026-07-18-1638-body-wash_v1.md",
    isDir: false,
    size: 1800,
    modified: 5,
  },
];

describe("FilesPage", () => {
  beforeEach(() => {
    listDir.mockReset();
    listDir.mockImplementation((rel: string, root?: string) => {
      if (root === "formulas") return Promise.resolve(formulasRoot);
      return Promise.resolve(rel === "sessions" ? sessionsDir : dataRoot);
    });
  });

  it("lists entries with sizes and opens a file in the previewer", async () => {
    render(<FilesPage />);
    expect(await screen.findByText("figure.png")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();

    await userEvent.click(screen.getByText("figure.png"));
    expect(screen.getByTestId("preview")).toHaveTextContent("preview:figure.png");
  });

  it("opens notebooks in the runnable editor", async () => {
    render(<FilesPage />);
    await userEvent.click(await screen.findByText("run.ipynb"));
    expect(screen.getByTestId("nb")).toHaveTextContent("nb:run.ipynb");
  });

  it("navigates into a folder and back via the breadcrumb", async () => {
    render(<FilesPage />);
    await userEvent.click(await screen.findByText("sessions"));
    expect(await screen.findByText("papers.json")).toBeInTheDocument();
    // Listings resolve inside the data root, not a runtime workspace.
    expect(listDir).toHaveBeenCalledWith("sessions", "data");

    await userEvent.click(screen.getByRole("button", { name: "data" }));
    await waitFor(() => expect(screen.getByText("figure.png")).toBeInTheDocument());
  });

  it("switches to the formulas library", async () => {
    render(<FilesPage />);
    await screen.findByText("figure.png");

    await userEvent.click(screen.getByRole("button", { name: "Formulas" }));
    expect(
      await screen.findByText("Formulation_Card_2026-07-18-1638-body-wash_v1.md"),
    ).toBeInTheDocument();
    expect(listDir).toHaveBeenCalledWith("", "formulas");
  });
});
