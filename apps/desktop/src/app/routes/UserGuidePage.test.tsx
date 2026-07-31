import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserGuidePage } from "./UserGuidePage";

describe("UserGuidePage — in-app guide entry", () => {
  it("renders the real docs/USER_GUIDE.md content through MarkdownViewer", async () => {
    render(<UserGuidePage />);
    // The page chrome has its own <h1>"User Guide"</h1>, and the guide's
    // body text mentions "FormuLab" many times elsewhere — level:1 plus
    // the name filter narrows to the document's one real title heading
    // ("FormuLab User Guide"), never the page chrome's or a body heading.
    const title = await screen.findByRole("heading", { level: 1, name: /formulab user guide/i });
    expect(title).toBeInTheDocument();
  });

  it("labels the guide as English-only", async () => {
    render(<UserGuidePage />);
    expect(await screen.findByText("This guide is currently available in English only.")).toBeInTheDocument();
  });
});
