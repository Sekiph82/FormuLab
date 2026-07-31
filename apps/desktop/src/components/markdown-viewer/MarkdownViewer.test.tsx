import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownViewer } from "./MarkdownViewer";

describe("MarkdownViewer — heading anchors (Phase 10 Session 6)", () => {
  it("gives each heading a real, GitHub-slug-compatible id so an internal #anchor link resolves", () => {
    render(<MarkdownViewer>{"## 18. Corrective actions"}</MarkdownViewer>);
    const heading = screen.getByRole("heading", { name: "18. Corrective actions" });
    expect(heading).toHaveAttribute("id", "18-corrective-actions");
  });

  it("strips a slash the same way the guide-export slugifier does, matching the guide's own PDF/DOCX-style anchors", () => {
    render(<MarkdownViewer>{"## 21a. Dossier PDF/DOCX export"}</MarkdownViewer>);
    const heading = screen.getByRole("heading", { name: "21a. Dossier PDF/DOCX export" });
    expect(heading).toHaveAttribute("id", "21a-dossier-pdfdocx-export");
  });

  it("still renders ordinary markdown content correctly", () => {
    render(<MarkdownViewer>{"Some **bold** text."}</MarkdownViewer>);
    expect(screen.getByText("bold")).toBeInTheDocument();
  });
});

describe("MarkdownViewer — graceful missing-image handling (Phase 10 Session 6)", () => {
  it("renders a real <img> for a present source, with its title as a caption", () => {
    render(<MarkdownViewer>{'![Formulation generation](screenshots/a.png "The composer")'}</MarkdownViewer>);
    const img = screen.getByRole("img", { name: "Formulation generation" });
    expect(img).toHaveAttribute("src", "screenshots/a.png");
    expect(screen.getByText("The composer")).toBeInTheDocument();
  });

  it("falls back to a clear, non-broken placeholder when the image fails to load", () => {
    render(<MarkdownViewer>{'![Formulation generation](screenshots/does-not-exist.png "The composer")'}</MarkdownViewer>);
    const img = screen.getByRole("img", { name: "Formulation generation" });
    fireEvent.error(img);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/Screenshot not yet captured: The composer/)).toBeInTheDocument();
  });
});
